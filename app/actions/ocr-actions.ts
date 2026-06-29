// @ts-nocheck — このファイルは旧スキーマ(ocr_verifications/profiles)を参照しており型定義から除外済み
'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { CorrectedDataSchema, type CorrectedData } from '@/lib/schemas/ocr'
import { parseVerification as apiParse, verifyOcr, type ParsedLine as ApiParsedLine } from '@/lib/api-client'

type OcrStatus = 'pending' | 'processing' | 'done' | 'error' | 'review_needed' | 'approved'
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

async function _fetchVerifications(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  statusFilter?: string[],
): Promise<ActionResult<PendingVerification[]>> {
  const query = supabase
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

  const { data, error } = statusFilter
    ? await query.in('status', statusFilter as OcrStatus[])
    : await query

  if (error) {
    console.error('[fetchVerifications] DBエラー:', error)
    return { success: false, error: 'データの取得中にエラーが発生しました。' }
  }
  return { success: true, data: (data ?? []) as unknown as PendingVerification[] }
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

export async function getPendingVerifications(): Promise<ActionResult<PendingVerification[]>> {
  try {
    const auth = await _getAuthProfile()
    if ('error' in auth) return { success: false, error: auth.error! }
    return _fetchVerifications(auth.supabase, auth.tenantId, ['pending', 'needs_review'])
  } catch (err) {
    console.error('[getPendingVerifications] 予期しないエラー:', err)
    return { success: false, error: '予期しないエラーが発生しました。' }
  }
}

export async function getAllVerifications(): Promise<ActionResult<PendingVerification[]>> {
  try {
    const auth = await _getAuthProfile()
    if ('error' in auth) return { success: false, error: auth.error! }
    return _fetchVerifications(auth.supabase, auth.tenantId)
  } catch (err) {
    console.error('[getAllVerifications] 予期しないエラー:', err)
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
      reviewed_by: user.id,
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
