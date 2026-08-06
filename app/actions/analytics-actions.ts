'use server'

import { createClient } from '@/lib/supabase/server'

export type MonthlySales = {
  month: string
  order_count: number
  customer_count: number
  subtotal_excl_tax: number
  total_tax: number
  total_incl_tax: number
}

export type ItemSales = {
  product_name: string
  unit: string
  month: string
  total_qty: number
  subtotal_excl_tax: number
  total_incl_tax: number
}

export type CustomerSales = {
  customer_name: string
  month: string
  order_count: number
  subtotal_excl_tax: number
  total_incl_tax: number
}

export type OpsStatus = {
  pending_review_count: number
  approved_count: number
  shipped_count: number
  today_orders: number
  today_deliveries: number
}

const EMPTY_OPS: OpsStatus = {
  pending_review_count: 0,
  approved_count: 0,
  shipped_count: 0,
  today_orders: 0,
  today_deliveries: 0,
}

export type AnalyticsData = {
  monthly: MonthlySales[]
  items: ItemSales[]
  customers: CustomerSales[]
  ops: OpsStatus
  /** 取得に失敗した集計の名前。空でなければ画面に警告を出す。 */
  failed: string[]
}

export async function getAnalytics(): Promise<AnalyticsData> {
  const sb = await createClient()

  const [monthly, items, customers, ops] = await Promise.all([
    sb.from('v_sales_monthly' as never).select('*').order('month', { ascending: false }).limit(12),
    sb.from('v_sales_by_item' as never).select('*').order('month', { ascending: false }).limit(50),
    sb.from('v_sales_by_customer' as never).select('*').order('month', { ascending: false }).limit(50),
    sb.from('v_ops_status' as never).select('*').single(),
  ])

  // 以前は .data ?? [] で失敗を黙って空扱いにしていたため、クエリが
  // エラーでも画面には「データなし」と出て区別がつかなかった。
  const failed: string[] = []
  const results: [string, { error: unknown }][] = [
    ['月別売上', monthly],
    ['品目別売上', items],
    ['納入先別売上', customers],
    ['稼働状況', ops],
  ]
  for (const [label, result] of results) {
    if (result.error) {
      console.error(`[getAnalytics] ${label} の取得に失敗:`, result.error)
      failed.push(label)
    }
  }

  return {
    monthly: (monthly.data ?? []) as MonthlySales[],
    items: (items.data ?? []) as ItemSales[],
    customers: (customers.data ?? []) as CustomerSales[],
    ops: (ops.data ?? EMPTY_OPS) as OpsStatus,
    failed,
  }
}
