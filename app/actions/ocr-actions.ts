// @ts-nocheck — このファイルは旧スキーマ(ocr_verifications/profiles)を参照しており型定義から除外済み
'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { CorrectedDataSchema, type CorrectedData } from '@/lib/schemas/ocr'
import { parseVerification as apiParse, verifyOcr, type ParsedLine as ApiParsedLine } from '@/lib/api-client'

import type { OcrStatus } from '@/lib/types/supabase'
import { dateRangeCutoff, type DateRange } from '@/lib/verification'

type Json = unknown

type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> }

export type PendingVerificationStatus = OcrStatus

export type PendingVerification = {
  id: string
  image_url: string
  status: PendingVerificationStatus
  confidence_flags: Record<string, Json>
  parsed_lines: ParsedOcrLine[]
  created_at: string
  reviewer: { display_name: string | null } | null
}

export type ParsedOcrLine = {
  store: string
  item: string
  spec: string
  unit: number
  boxes: number
  remainder: number
  total_qty: number
  notes?: string
}

export type ApproveResult = {
  order_id: string
  order_date: string
  lines_count: number
}

/** 1回の取得で読む最大件数。parsed_lines の JSON を含むため上限を設ける。 */
const VERIFICATION_FETCH_LIMIT = 200

export type VerificationPage = {
  items: PendingVerification[]
  /** 上限に達して打ち切られたか。画面で「以降は表示していない」ことを示す。 */
  truncated: boolean
  /** 適用した期間。null は全期間。 */
  dateRange: DateRange
}

async function _fetchVerifications(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  options: { statusFilter?: string[]; dateRange: DateRange },
): Promise<ActionResult<VerificationPage>> {
  let query = supabase
    .from('ocr_verifications')
    .select(`
      id,
      image_url,
      status,
      confidence_flags,
      parsed_lines,
      created_at,
      reviewer:profiles!ocr_verifications_reviewed_by_fkey (
        display_name
      )
    `)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    // 打ち切りを検出するため上限+1件まで読む
    .limit(VERIFICATION_FETCH_LIMIT + 1)

  // 期間の絞り込みをサーバー側で行う。以前は全件を parsed_lines ごと取得して
  // からクライアントで期間フィルタを掛けていたため、件数が増えるほど毎回の
  // 転送量が膨らみ、設計書の目標「クライアント側操作 < 200ms」と衝突していた。
  const cutoff = dateRangeCutoff(options.dateRange, Date.now())
  if (cutoff) {
    query = query.gte('created_at', cutoff.toISOString())
  }

  if (options.statusFilter) {
    query = query.in('status', options.statusFilter as OcrStatus[])
  }

  const { data, error } = await query

  if (error) {
    console.error('[fetchVerifications] DBエラー:', error)
    return { success: false, error: 'データの取得中にエラーが発生しました。' }
  }

  const rows = (data ?? []) as unknown as PendingVerification[]
  const truncated = rows.length > VERIFICATION_FETCH_LIMIT
  return {
    success: true,
    data: {
      items: truncated ? rows.slice(0, VERIFICATION_FETCH_LIMIT) : rows,
      truncated,
      dateRange: options.dateRange,
    },
  }
}

async function _getAuthProfile() {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return { error: 'ログインが必要です。再度ログインしてください。' } as const
  // RLSの循環依存を避けるためサービスクライアントでプロファイルを取得
  const sb = await createServiceClient()
  const { data: profile } = await sb.from('profiles').select('*').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin') return { error: 'この操作には管理者権限が必要です。' } as const
  const tenantId = profile.tenant_id ?? ''
  return { supabase, profile, tenantId }
}

/**
 * 指定期間の受注票を取得する。
 *
 * 未処理／全件の切り替えは、取得した期間内のデータに対してクライアント側で
 * 行う（どちらも同じ窓の部分集合なので再取得は不要）。
 * 一方で期間の絞り込みはサーバー側で行う。全件を parsed_lines ごと読むのを
 * やめるのが目的なので、ここを緩めると意味がなくなる。
 *
 * 旧 getPendingVerifications は呼び出し箇所が無く削除した。
 */
export async function getVerifications(
  dateRange: DateRange = '30d',
): Promise<ActionResult<VerificationPage>> {
  try {
    const auth = await _getAuthProfile()
    if ('error' in auth) return { success: false, error: auth.error! }
    return _fetchVerifications(auth.supabase, auth.tenantId, { dateRange })
  } catch (err) {
    console.error('[getVerifications] 予期しないエラー:', err)
    return { success: false, error: '予期しないエラーが発生しました。' }
  }
}

// ─── updateRawText ──────────────────────────────────────────────────────────
export async function updateRawText(
  verificationId: string,
  newText: string,
): Promise<ActionResult> {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return { success: false, error: 'ログインが必要です。' }

    // 既存 confidence_flags を取得してマージ
    const { data: row } = await supabase
      .from('ocr_verifications')
      .select('confidence_flags')
      .eq('id', verificationId)
      .single()

    const flags = (row?.confidence_flags as Record<string, unknown>) ?? {}
    const { error } = await supabase
      .from('ocr_verifications')
      .update({ confidence_flags: { ...flags, raw_text: newText } })
      .eq('id', verificationId)

    if (error) return { success: false, error: 'テキストの更新に失敗しました。' }
    return { success: true, data: undefined }
  } catch {
    return { success: false, error: '予期しないエラーが発生しました。' }
  }
}

// ─── rejectVerification ─────────────────────────────────────────────────────
/**
 * 受注票を却下して未処理キューから外す。
 *
 * これまで `rejected` は表示だけ実装されていて、却下する手段が UI にも
 * Server Action にも無かった。そのため OCR が失敗した受注票や、注文ではない
 * メールを未処理から外せず、「未処理 N」のバッジが永久に減らないゴミが
 * 溜まり続けていた。
 *
 * 一方で受注削除（order-actions.deleteOrder）は検証を needs_review に戻すため、
 * 未処理を増やす方向の弁しか存在しない状態だった。
 */
export async function rejectVerification(
  verificationId: string,
  reason?: string,
): Promise<ActionResult> {
  try {
    const auth = await _getAuthProfile()
    if ('error' in auth) return { success: false, error: auth.error! }

    const { data: row } = await auth.supabase
      .from('ocr_verifications')
      .select('id, status, order_id, confidence_flags')
      .eq('id', verificationId)
      .eq('tenant_id', auth.tenantId)
      .single()

    if (!row) {
      return { success: false, error: '対象の受注票が見つかりません。' }
    }
    // 受注が作られているものを却下すると帳票と実績が食い違うため止める。
    if (row.order_id) {
      return {
        success: false,
        error: 'すでに受注が作成されています。却下する場合は受注一覧から受注を削除してください。',
      }
    }

    const flags = (row.confidence_flags as Record<string, unknown>) ?? {}
    const { error } = await auth.supabase
      .from('ocr_verifications')
      .update({
        status: 'rejected',
        reviewed_by: auth.profile.id,
        confidence_flags: {
          ...flags,
          rejected_at: new Date().toISOString(),
          rejected_reason: reason?.trim() || null,
        },
      })
      .eq('id', verificationId)
      .eq('tenant_id', auth.tenantId)

    if (error) {
      console.error('[rejectVerification] DBエラー:', error)
      return { success: false, error: '却下の保存に失敗しました。' }
    }

    revalidatePath('/dashboard/verifications')
    return { success: true, data: undefined }
  } catch (err) {
    console.error('[rejectVerification] 予期しないエラー:', err)
    return { success: false, error: '予期しないエラーが発生しました。' }
  }
}

// ─── restoreVerification ────────────────────────────────────────────────────
/** 却下を取り消して未処理に戻す（誤って却下した場合の復帰経路）。 */
export async function restoreVerification(
  verificationId: string,
): Promise<ActionResult> {
  try {
    const auth = await _getAuthProfile()
    if ('error' in auth) return { success: false, error: auth.error! }

    const { error } = await auth.supabase
      .from('ocr_verifications')
      .update({ status: 'needs_review' })
      .eq('id', verificationId)
      .eq('tenant_id', auth.tenantId)
      .eq('status', 'rejected')

    if (error) {
      console.error('[restoreVerification] DBエラー:', error)
      return { success: false, error: '復帰に失敗しました。' }
    }

    revalidatePath('/dashboard/verifications')
    return { success: true, data: undefined }
  } catch (err) {
    console.error('[restoreVerification] 予期しないエラー:', err)
    return { success: false, error: '予期しないエラーが発生しました。' }
  }
}

// ─── parseOcrVerification ───────────────────────────────────────────────────
export async function parseOcrVerification(
  verificationId: string,
): Promise<ActionResult<{ parsed_lines: ApiParsedLine[] }>> {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { success: false, error: 'ログインが必要です。再度ログインしてください。' }
    }
    const result = await apiParse(verificationId)
    // DB の parsed_lines を再取得するため、revalidate して page が最新データを拾う
    revalidatePath('/dashboard/verifications')
    return { success: true, data: { parsed_lines: result.parsed_lines } }
  } catch (err) {
    console.error('[parseOcrVerification] エラー:', err)
    return { success: false, error: `Gemini 解析に失敗しました: ${String(err)}` }
  }
}

// ─── approveWithFastApi ──────────────────────────────────────────────────────
// 人間可読フォームデータ (store/item 名) を FastAPI に送り、UUID解決 + 注文作成を委譲
type LineInput = {
  store: string; item: string; spec: string;
  unit: number; boxes: number; remainder: number;
}

export async function approveWithFastApi(
  verificationId: string,
  orderDate: string,
  lines: LineInput[],
  correctionNotes?: string,
): Promise<ActionResult<ApproveResult>> {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { success: false, error: 'ログインが必要です。再度ログインしてください。' }
    }
    const result = await verifyOcr({
      verification_id: verificationId,
      order_date: orderDate,
      corrected_lines: lines.map((l) => ({
        store: l.store, item: l.item, spec: l.spec,
        unit: l.unit, boxes: l.boxes, remainder: l.remainder,
      })),
      correction_notes: correctionNotes,
      // reviewed_by は送らない。承認者はバックエンドがアクセストークンから決める
      // （クライアント指定を信用すると承認の名義を差し替えられるため）。
    })
    revalidatePath('/dashboard/verifications')
    revalidatePath('/dashboard/orders')
    return {
      success: true,
      data: {
        order_id: result.order_id,
        order_date: orderDate,
        lines_count: lines.length,
      },
    }
  } catch (err) {
    console.error('[approveWithFastApi] エラー:', err)
    return { success: false, error: `承認処理に失敗しました: ${String(err)}` }
  }
}

export async function approveOcrVerification(
  verificationId: string,
  rawData: CorrectedData,
): Promise<ActionResult<ApproveResult>> {
  try {
    const verificationIdSchema = z
      .string()
      .uuid({ message: '検証IDの形式が正しくありません' })
    const idParse = verificationIdSchema.safeParse(verificationId)
    if (!idParse.success) {
      return { success: false, error: idParse.error.errors[0].message }
    }

    const parsed = CorrectedDataSchema.safeParse(rawData)
    if (!parsed.success) {
      const fieldErrors: Record<string, string[]> = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.')
        fieldErrors[key] = [...(fieldErrors[key] ?? []), issue.message]
      }
      return {
        success: false,
        error: '入力内容に誤りがあります。各項目を確認してください。',
        fieldErrors,
      }
    }
    const { order_date, lines, correction_notes } = parsed.data

    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { success: false, error: 'ログインが必要です。再度ログインしてください。' }
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()

    if (!profile || profile.role !== 'admin') {
      return { success: false, error: 'この操作には管理者権限が必要です。' }
    }

    const serviceClient = await createServiceClient()

    const { data: orderId, error: rpcError } = await serviceClient.rpc(
      'approve_ocr_verification',
      {
        p_verification_id:  verificationId,
        p_tenant_id:        profile.tenant_id,
        p_reviewed_by:      user.id,
        p_order_date:       order_date,
        p_correction_notes: correction_notes ?? null,
        p_lines:            lines,
      },
    )

    if (rpcError) {
      console.error('[approveOcrVerification] RPCエラー:', rpcError)
      const domainCodes = ['P0001', 'P0002', 'P0003']
      if (rpcError.code && domainCodes.includes(rpcError.code)) {
        return { success: false, error: rpcError.message }
      }
      return {
        success: false,
        error: '受注の登録中にエラーが発生しました。内容を確認して再試行してください。',
      }
    }

    revalidatePath('/dashboard/verifications')
    revalidatePath('/dashboard/orders')

    return {
      success: true,
      data: {
        order_id:    orderId as string,
        order_date,
        lines_count: lines.length,
      },
    }
  } catch (err) {
    console.error('[approveOcrVerification] 予期しないエラー:', err)
    return {
      success: false,
      error: '予期しないエラーが発生しました。システム管理者にお問い合わせください。',
    }
  }
}

// ─── マスターデータ取得 ────────────────────────────────────────────────
export type MasterData = {
  stores: string[]
  storeOrder: Record<string, number>  // 店舗名 → sort_order
  products: { id: string; name: string }[]
  specs: { productId: string; name: string; unitSize: number }[]
}

export async function fetchMasterData(): Promise<ActionResult<MasterData>> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'ログインが必要です' }

    const { data: profile } = await supabase.from('profiles').select('tenant_id').eq('id', user.id).single()
    if (!profile) return { success: false, error: 'プロファイルが見つかりません' }

    const tenantId = profile.tenant_id

    // 店舗（customers）
    const { data: customers } = await supabase
      .from('customers')
      .select('name, sort_order')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('name')
    const stores = (customers ?? []).map((c) => c.name as string)
    const storeOrder: Record<string, number> = {}
    ;(customers ?? []).forEach((c, i) => {
      storeOrder[c.name as string] = (c.sort_order as number | null) ?? 999
    })

    // 品目（products）
    const { data: products } = await supabase
      .from('products')
      .select('id, name')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('name')

    // 規格（product_standards）
    const { data: standards } = await supabase
      .from('product_standards')
      .select('product_id, name, unit_size')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)

    // 同名品目が複数あると Select が重複表示されるため名前ベースで重複排除
    const nameToFirstId = new Map<string, string>()
    const uniqueProducts: { id: string; name: string }[] = []
    for (const p of (products ?? [])) {
      const name = p.name as string
      if (!nameToFirstId.has(name)) {
        nameToFirstId.set(name, p.id)
        uniqueProducts.push({ id: p.id, name })
      }
    }

    // 規格: 重複品目の product_id を代表 ID に統一して全規格を収集
    const productIdToName = new Map<string, string>()
    for (const p of (products ?? [])) productIdToName.set(p.id, p.name as string)

    const specs = (standards ?? []).map((s) => {
      const productName = productIdToName.get(s.product_id) ?? ''
      const canonicalId = nameToFirstId.get(productName) ?? s.product_id
      return { productId: canonicalId, name: s.name as string, unitSize: (s.unit_size as number) ?? 0 }
    })

    return {
      success: true,
      data: { stores, storeOrder, products: uniqueProducts, specs },
    }
  } catch (err) {
    console.error('[fetchMasterData] エラー:', err)
    return { success: false, error: 'マスターデータの取得に失敗しました' }
  }
}
