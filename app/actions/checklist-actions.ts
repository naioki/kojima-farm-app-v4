'use server'

/**
 * 積み込み・荷降ろしチェックリストの Server Action。
 *
 * チェック状態は共有する（2人以上で作業する想定）。
 * 保持は7日。運用上それ以降は不要なので、読み出しでも7日で絞っている
 * （掃除ジョブが動かない環境でも古い進捗が画面に出ない）。
 */

import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { buildChecklist, type Checklist, type ChecklistLine } from '@/lib/checklist'

/**
 * DB アクセスだけ型を緩める。
 *
 * lib/types/supabase.ts の生成型は旧スキーマのままで、実際に使っている
 * profiles / order_lines / orders.tenant_id / shipping_checklist_checks を
 * 含んでいない。これが ocr-actions.ts などの @ts-nocheck の原因でもある。
 *
 * ファイル全体の型チェックを切ると自分の変換ロジックまで検査されなくなるため、
 * 境界だけをこのキャストで緩め、それ以外（戻り値・マッピング・分岐）は
 * 型検査を効かせている。
 * 型の再生成は system_design_v4.md の Phase E1。
 */
function db(client: Awaited<ReturnType<typeof createClient>>): SupabaseClient {
  return client as unknown as SupabaseClient
}

type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string }

export type ChecklistMode = 'load' | 'unload'

/** 進捗の保持期間。運用上1週間を過ぎたら不要。 */
const RETENTION_DAYS = 7

export type OrderChecklist = {
  orderId: string
  orderDate: string
  checklist: Checklist
  /** チェック済みの row_key。mode ごとに分けて返す */
  checked: Record<ChecklistMode, string[]>
}

type AuthContext = {
  supabase: Awaited<ReturnType<typeof createClient>>
  userId: string
  tenantId: string
}

type AuthResult = { ok: true; ctx: AuthContext } | { ok: false; error: string }

async function getAuth(): Promise<AuthResult> {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error || !user) return { ok: false, error: 'ログインが必要です。' }

  // RLS の循環参照を避けるためサービスクライアントでプロファイルを取得
  const sb = await createServiceClient()
  const { data: profile } = await db(sb)
    .from('profiles')
    .select('id, tenant_id')
    .eq('id', user.id)
    .single()
  if (!profile?.tenant_id) {
    return { ok: false, error: 'アカウントにテナントが設定されていません。' }
  }
  return {
    ok: true,
    ctx: { supabase, userId: user.id, tenantId: profile.tenant_id as string },
  }
}

function retentionCutoff(): string {
  return new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString()
}

export async function getOrderChecklist(
  orderId: string,
): Promise<ActionResult<OrderChecklist>> {
  try {
    const auth = await getAuth()
    if (!auth.ok) return { success: false, error: auth.error }
    const { supabase, tenantId } = auth.ctx

    const { data: order } = await db(supabase)
      .from('orders')
      .select('id, order_date')
      .eq('id', orderId)
      .eq('tenant_id', tenantId)
      .single()
    if (!order) return { success: false, error: '受注が見つかりません。' }

    const { data: lines, error: linesError } = await db(supabase)
      .from('order_lines')
      .select(`
        id, boxes, remainder, total_qty,
        customers!inner(name, supplier_name, sort_order),
        product_standards!inner(name, products!inner(name))
      `)
      .eq('order_id', orderId)

    if (linesError) {
      console.error('[getOrderChecklist] 明細の取得に失敗:', linesError)
      return { success: false, error: '明細の取得に失敗しました。' }
    }

    const checklistLines: ChecklistLine[] = (lines ?? []).map((row) => {
      // PostgREST の多対一埋め込みは実行時に**オブジェクト**で返る
      // （order-actions.ts の getOrderDetail と同じ扱い）。緩い型では配列に
      // 推論されてしまうため unknown を経由する。
      const customer = row.customers as unknown as {
        name: string
        supplier_name: string | null
        sort_order: number | null
      } | null
      const ps = row.product_standards as unknown as {
        name: string
        products: { name: string }
      } | null
      const storeName = customer?.name ?? '—'
      const supplier = customer?.supplier_name?.trim() || ''
      // 帳票と同じ供給先表示（系列＋店舗。系列のみの業者は店舗名を重ねない）
      const display =
        supplier && supplier !== storeName ? `${supplier} ${storeName}` : storeName

      return {
        id: row.id as string,
        customer_name: storeName,
        customer_display: display,
        product_name: ps?.products?.name ?? '—',
        spec: ps?.name ?? '',
        boxes: (row.boxes as number) ?? 0,
        remainder: (row.remainder as number) ?? 0,
        total_qty: (row.total_qty as number) ?? 0,
        sort_order: customer?.sort_order ?? null,
      }
    })

    const { data: checks } = await db(supabase)
      .from('shipping_checklist_checks')
      .select('mode, row_key')
      .eq('order_id', orderId)
      .eq('tenant_id', tenantId)
      .gte('checked_at', retentionCutoff())

    const checked: Record<ChecklistMode, string[]> = { load: [], unload: [] }
    for (const row of checks ?? []) {
      const mode = row.mode as ChecklistMode
      if (mode === 'load' || mode === 'unload') checked[mode].push(row.row_key as string)
    }

    return {
      success: true,
      data: {
        orderId: order.id as string,
        orderDate: order.order_date as string,
        checklist: buildChecklist(checklistLines),
        checked,
      },
    }
  } catch (err) {
    console.error('[getOrderChecklist] 予期しないエラー:', err)
    return { success: false, error: '予期しないエラーが発生しました。' }
  }
}

/**
 * チェックの ON / OFF。
 *
 * 「チェック済み = 行が存在する」という表現にしているので、
 * ON は UPSERT、OFF は DELETE で済む。複数人が同時に触っても
 * 後から書いた側が相手のチェックを消してしまうことがない。
 */
export async function setChecklistItem(
  orderId: string,
  mode: ChecklistMode,
  rowKey: string,
  checked: boolean,
): Promise<ActionResult> {
  try {
    if (mode !== 'load' && mode !== 'unload') {
      return { success: false, error: '不正なモードです。' }
    }
    const auth = await getAuth()
    if (!auth.ok) return { success: false, error: auth.error }
    const { supabase, tenantId, userId } = auth.ctx

    // 対象の受注が自テナントのものか確認する
    const { data: order } = await db(supabase)
      .from('orders')
      .select('id')
      .eq('id', orderId)
      .eq('tenant_id', tenantId)
      .single()
    if (!order) return { success: false, error: '受注が見つかりません。' }

    if (checked) {
      const { error } = await db(supabase)
        .from('shipping_checklist_checks')
        .upsert(
          {
            tenant_id: tenantId,
            order_id: orderId,
            mode,
            row_key: rowKey,
            checked_by: userId,
            checked_at: new Date().toISOString(),
          },
          { onConflict: 'order_id,mode,row_key' },
        )
      if (error) {
        console.error('[setChecklistItem] 保存に失敗:', error)
        return { success: false, error: 'チェックの保存に失敗しました。' }
      }
    } else {
      const { error } = await db(supabase)
        .from('shipping_checklist_checks')
        .delete()
        .eq('order_id', orderId)
        .eq('tenant_id', tenantId)
        .eq('mode', mode)
        .eq('row_key', rowKey)
      if (error) {
        console.error('[setChecklistItem] 解除に失敗:', error)
        return { success: false, error: 'チェックの解除に失敗しました。' }
      }
    }

    revalidatePath(`/dashboard/orders/${orderId}/checklist`)
    return { success: true, data: undefined }
  } catch (err) {
    console.error('[setChecklistItem] 予期しないエラー:', err)
    return { success: false, error: '予期しないエラーが発生しました。' }
  }
}

/** モード単位でチェックを全部外す（やり直し用）。 */
export async function clearChecklist(
  orderId: string,
  mode: ChecklistMode,
): Promise<ActionResult> {
  try {
    if (mode !== 'load' && mode !== 'unload') {
      return { success: false, error: '不正なモードです。' }
    }
    const auth = await getAuth()
    if (!auth.ok) return { success: false, error: auth.error }
    const { supabase, tenantId } = auth.ctx

    const { error } = await db(supabase)
      .from('shipping_checklist_checks')
      .delete()
      .eq('order_id', orderId)
      .eq('tenant_id', tenantId)
      .eq('mode', mode)

    if (error) {
      console.error('[clearChecklist] 解除に失敗:', error)
      return { success: false, error: 'チェックの解除に失敗しました。' }
    }

    revalidatePath(`/dashboard/orders/${orderId}/checklist`)
    return { success: true, data: undefined }
  } catch (err) {
    console.error('[clearChecklist] 予期しないエラー:', err)
    return { success: false, error: '予期しないエラーが発生しました。' }
  }
}
