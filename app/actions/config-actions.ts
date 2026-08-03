'use server'

/**
 * 設定画面（/dashboard/settings）用の Server Action。
 *
 * 以前は設定画面がブラウザから `fetch(${NEXT_PUBLIC_API_URL}/api/config/...)` を
 * 直接叩いていた。そのため:
 *   - IMAP パスワードや LINE Works API トークンが無認証のエンドポイントを
 *     経由してやり取りされていた
 *   - Server Action 側の管理者チェックを通らない裏口になっていた
 *
 * ここを通すことで、アクセストークンの付与（lib/api-client.ts）と
 * バックエンド側の require_admin（backend/app/auth.py）の両方が必ず効く。
 */

import {
  getBackendConfig,
  putBackendConfig,
  postBackendConfig,
  fetchEmails as apiFetchEmails,
} from '@/lib/api-client'

export type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string }

export type EmailConfig = {
  imap_server: string
  imap_port: number
  email_address: string
  sender_email: string | null
  days_back: number
  password?: string
}

export type ChatConfig = {
  discord_webhook_url: string | null
  line_works_bot_id: string | null
  line_works_api_token: string | null
  google_chat_webhook_url: string | null
  allowed_line_users: string | null
  allowed_discord_users: string | null
}

export type PromptConfig = {
  image_prompt: string | null
  text_prompt: string | null
  is_custom_enabled: boolean
  version: number
  default_image_prompt: string
  default_text_prompt: string
  required_image_placeholders: string[]
  required_text_placeholders: string[]
}

export type PromptHistoryEntry = {
  version: number
  image_prompt: string | null
  text_prompt: string | null
  is_custom_enabled: boolean
  saved_by: string | null
  created_at: string | null
}

export type PromptTestResult = {
  ok: boolean
  missing_placeholders: string[]
  parsed: Record<string, unknown>[] | null
  message: string
}

function toError(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message
  return fallback
}

// ── メール設定 ──────────────────────────────────────────────────────────────

export async function getEmailConfig(): Promise<ActionResult<EmailConfig>> {
  try {
    const data = await getBackendConfig<EmailConfig>('email')
    // パスワードは返ってこないが、万一含まれていてもクライアントへ渡さない
    return { success: true, data: { ...data, password: '' } }
  } catch (err) {
    return { success: false, error: toError(err, 'メール設定の取得に失敗しました。') }
  }
}

export async function saveEmailConfig(
  config: EmailConfig
): Promise<ActionResult<EmailConfig>> {
  try {
    const payload: Record<string, unknown> = {
      imap_server: config.imap_server,
      imap_port: config.imap_port,
      email_address: config.email_address,
      sender_email: config.sender_email,
      days_back: config.days_back,
    }
    // 空文字は「変更しない」の意味。送ると空パスワードで上書きしてしまう。
    if (config.password) payload.password = config.password

    const data = await putBackendConfig<EmailConfig>('email', payload)
    return { success: true, data: { ...data, password: '' } }
  } catch (err) {
    return { success: false, error: toError(err, 'メール設定の保存に失敗しました。') }
  }
}

/**
 * IMAP 接続の確認のみを行う。
 *
 * 以前の「接続テスト」ボタンは `GET /api/email/fetch` を叩いていたため、
 * テストのつもりで押すと本番のメール取り込みが走り、検証レコードが作られていた。
 * 取り込みは fetchEmailsNow() に分離し、こちらは副作用を持たない。
 */
export async function testEmailConnection(): Promise<ActionResult<{ message: string }>> {
  try {
    const data = await postBackendConfig<{ ok: boolean; message: string }>(
      'email/test',
      {}
    )
    if (!data.ok) {
      return { success: false, error: data.message || '接続に失敗しました。' }
    }
    return { success: true, data: { message: data.message || '接続に成功しました。' } }
  } catch (err) {
    return { success: false, error: toError(err, '接続の確認に失敗しました。') }
  }
}

/** メールを実際に取り込む（副作用あり）。 */
export async function fetchEmailsNow(): Promise<ActionResult<{ fetched: number }>> {
  try {
    const data = await apiFetchEmails()
    return { success: true, data }
  } catch (err) {
    return { success: false, error: toError(err, 'メール取得に失敗しました。') }
  }
}

// ── チャット連携設定 ────────────────────────────────────────────────────────

export async function getChatConfig(): Promise<ActionResult<ChatConfig>> {
  try {
    const data = await getBackendConfig<ChatConfig>('chat')
    return { success: true, data }
  } catch (err) {
    return { success: false, error: toError(err, 'チャット連携設定の取得に失敗しました。') }
  }
}

export async function saveChatConfig(
  config: ChatConfig
): Promise<ActionResult<ChatConfig>> {
  try {
    const data = await putBackendConfig<ChatConfig>('chat', config)
    return { success: true, data }
  } catch (err) {
    return { success: false, error: toError(err, 'チャット連携設定の保存に失敗しました。') }
  }
}

// ── AI プロンプト設定 ───────────────────────────────────────────────────────

export async function getPromptConfig(): Promise<ActionResult<PromptConfig>> {
  try {
    const data = await getBackendConfig<PromptConfig>('prompt')
    return { success: true, data }
  } catch (err) {
    return { success: false, error: toError(err, 'プロンプト設定の取得に失敗しました。') }
  }
}

export async function savePromptConfig(body: {
  image_prompt: string | null
  text_prompt: string | null
  is_custom_enabled: boolean
}): Promise<ActionResult<PromptConfig>> {
  try {
    const data = await putBackendConfig<PromptConfig>('prompt', body)
    return { success: true, data }
  } catch (err) {
    return { success: false, error: toError(err, 'プロンプト設定の保存に失敗しました。') }
  }
}

export async function testPrompt(body: {
  kind: 'image' | 'text'
  prompt: string
  sample_text?: string
}): Promise<ActionResult<PromptTestResult>> {
  try {
    const data = await postBackendConfig<PromptTestResult>('prompt/test', body)
    return { success: true, data }
  } catch (err) {
    return { success: false, error: toError(err, 'プロンプトのテストに失敗しました。') }
  }
}

export async function getPromptHistory(): Promise<ActionResult<PromptHistoryEntry[]>> {
  try {
    const data = await getBackendConfig<PromptHistoryEntry[]>('prompt/history')
    return { success: true, data }
  } catch (err) {
    return { success: false, error: toError(err, '変更履歴の取得に失敗しました。') }
  }
}
