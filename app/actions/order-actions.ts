// @ts-nocheck — 旧スキーマ(profiles/tenant_id/ocr_verifications/order_lines)参照のため型チェック除外
'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'

type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string }

export type OrderLine = {
  id: string
  customer_id: string
  product_standard_id: string
  boxes: number
  remainder: number
  total_qty: number
  unit_price: number | null
  line_total: number | null
  // joined
  customer_name: string
  product_name: string
  spec: string
  sort_order: number
}

export type Order = {
  id: string
  order_date: string
  source: string
  status: string
  notes: string | null
  created_at: string
  line_count: number
}

export type OrderDetail = Order & { lines: OrderLine[] }

export async function deleteOrder(orderId: string): Promise<ActionResult> {
  try {
    const auth = await _getAuthProfile()
    if ('error' in auth) return { success: false, error: auth.error! }

    // テナント所有確認（通常クライアントでRLS経由）
    const { data: order } = await auth.supabase
      .from('orders')
      .select('id')
      .eq('id', orderId)
      .eq('tenant_id', auth.tenantId)
      .single()
    if (!order) return { success: false, error: '受注が見つかりません。' }

    // 削除はサービスクライアントで実行（RLS回避）
    const sb = await createServiceClient()

    // ocr_verifications の order_id を NULL に戻し、status も needs_review に戻す
    await sb
      .from('ocr_verifications')
      .update({ order_id: null, status: 'needs_review' })
      .eq('order_id', orderId)

    // 明細を先に削除
    const { error: linesErr } = await sb
      .from('order_lines')
      .delete()
      .eq('order_id', orderId)
    if (linesErr) {
      console.error('[deleteOrder] 明細削除エラー:', linesErr)
      return { success: false, error: '受注明細の削除に失敗しました。' }
    }

    // 受注本体を削除
    const { error } = await sb
      .from('orders')
      .delete()
      .eq('id', orderId)
    if (error) {
      console.error('[deleteOrder] DBエラー:', error)
      return { success: false, error: '受注の削除に失敗しました。' }
    }

    const { revalidatePath } = await import('next/cache')
    revalidatePath('/dashboard/orders')
    return { success: true, data: undefined }
  } catch (err) {
    console.error('[deleteOrder] 予期しないエラー:', err)
    return { success: false, error: '予期しないエラーが発生しました。' }
  }
}

async function _getAuthProfile() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return { error: 'ログインが必要です。' } as const
  const sb = await createServiceClient()
  const { data: profile } = await sb.from('profiles').select('*').eq('id', user.id).single()
  if (!profile) return { error: 'プロフィールが見つかりません。' } as const
  const tenantId = profile.tenant_id ?? ''
  return { supabase, profile, tenantId }
}

/** 1回の取得で読む最大件数。 */
const ORDER_FETCH_LIMIT = 200

export type OrderFilters = {
  /** 受注日の下限（YYYY-MM-DD）。 */
  from?: string
  /** 受注日の上限（YYYY-MM-DD）。 */
  to?: string
  status?: string
}

export type OrderPage = {
  items: Order[]
  /** 上限に達して打ち切られたか。画面で明示する。 */
  truncated: boolean
}

export async function getOrders(
  filters: OrderFilters = {},
): Promise<ActionResult<OrderPage>> {
  try {
    const auth = await _getAuthProfile()
    if ('error' in auth) return { success: false, error: auth.error! }

    let query = auth.supabase
      .from('orders')
      .select(`
        id, order_date, source, status, notes, created_at,
        order_lines(count)
      `)
      .eq('tenant_id', auth.tenantId)
      .order('order_date', { ascending: false })
      .order('created_at', { ascending: false })
      // 打ち切りを検出するため上限+1件まで読む
      .limit(ORDER_FETCH_LIMIT + 1)

    // 絞り込みはサーバー側で行う。以前は無条件で 200 件取得し、201件目以降が
    // 画面に何の表示もなく消えていた（しかも検索も期間指定も無かったため
    // 「先週の○○店の分」を探す手段がなかった）。
    if (filters.from) query = query.gte('order_date', filters.from)
    if (filters.to) query = query.lte('order_date', filters.to)
    if (filters.status) query = query.eq('status', filters.status)

    const { data, error } = await query

    if (error) {
      console.error('[getOrders] DBエラー:', error)
      return { success: false, error: 'データの取得中にエラーが発生しました。' }
    }

    const rows = data ?? []
    const truncated = rows.length > ORDER_FETCH_LIMIT
    const orders: Order[] = (truncated ? rows.slice(0, ORDER_FETCH_LIMIT) : rows).map(
      (row: Record<string, unknown>) => ({
        id: row.id as string,
        order_date: row.order_date as string,
        source: row.source as string,
        status: row.status as string,
        notes: row.notes as string | null,
        created_at: row.created_at as string,
        line_count: (row.order_lines as { count: number }[])?.[0]?.count ?? 0,
      }),
    )

    return { success: true, data: { items: orders, truncated } }
  } catch (err) {
    console.error('[getOrders] 予期しないエラー:', err)
    return { success: false, error: '予期しないエラーが発生しました。' }
  }
}

export async function getOrderDetail(orderId: string): Promise<ActionResult<OrderDetail>> {
  try {
    const auth = await _getAuthProfile()
    if ('error' in auth) return { success: false, error: auth.error! }

    const { data: order, error: orderError } = await auth.supabase
      .from('orders')
      .select('id, order_date, source, status, notes, created_at')
      .eq('id', orderId)
      .eq('tenant_id', auth.tenantId)
      .single()

    if (orderError || !order) {
      return { success: false, error: '受注が見つかりません。' }
    }

    const { data: lines, error: linesError } = await auth.supabase
      .from('order_lines')
      .select(`
        id, customer_id, product_standard_id, boxes, remainder, total_qty, unit_price, line_total,
        customers!inner(name, sort_order),
        product_standards!inner(name, unit_size, products!inner(name))
      `)
      .eq('order_id', orderId)

    if (linesError) {
      console.error('[getOrderDetail] linesError:', linesError)
      return { success: false, error: '明細の取得に失敗しました。' }
    }

    const mappedLines: OrderLine[] = (lines ?? []).map((l: Record<string, unknown>) => {
      const customer = l.customers as { name: string; sort_order: number | null } | null
      const ps = l.product_standards as { name: string; unit_size: number; products: { name: string } } | null
      const boxes = (l.boxes as number) || 0
      const remainder = (l.remainder as number) || 0
      const unitSize = ps?.unit_size || 0
      return {
        id: l.id as string,
        customer_id: l.customer_id as string,
        product_standard_id: l.product_standard_id as string,
        boxes,
        remainder,
        total_qty: (l.total_qty as number) || (boxes * unitSize + remainder),
        unit_price: l.unit_price as number | null,
        line_total: l.line_total as number | null,
        customer_name: customer?.name ?? '—',
        product_name: ps?.products?.name ?? '—',
        spec: ps?.name ?? '—',
        sort_order: customer?.sort_order ?? 999,
      }
    })
    mappedLines.sort((a, b) => (a.sort_order - b.sort_order) || a.customer_name.localeCompare(b.customer_name))

    return {
      success: true,
      data: {
        id: order.id,
        order_date: order.order_date,
        source: order.source,
        status: order.status,
        notes: order.notes,
        created_at: order.created_at,
        line_count: mappedLines.length,
        lines: mappedLines,
      },
    }
  } catch (err) {
    console.error('[getOrderDetail] 予期しないエラー:', err)
    return { success: false, error: '予期しないエラーが発生しました。' }
  }
}
