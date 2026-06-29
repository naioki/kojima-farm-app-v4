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

export async function getAnalytics() {
  const sb = await createClient()

  const [monthly, items, customers, ops] = await Promise.all([
    sb.from('v_sales_monthly' as never).select('*').order('month', { ascending: false }).limit(12),
    sb.from('v_sales_by_item' as never).select('*').order('month', { ascending: false }).limit(50),
    sb.from('v_sales_by_customer' as never).select('*').order('month', { ascending: false }).limit(50),
    sb.from('v_ops_status' as never).select('*').single(),
  ])

  return {
    monthly: (monthly.data ?? []) as MonthlySales[],
    items: (items.data ?? []) as ItemSales[],
    customers: (customers.data ?? []) as CustomerSales[],
    ops: (ops.data ?? {
      pending_review_count: 0,
      approved_count: 0,
      shipped_count: 0,
      today_orders: 0,
      today_deliveries: 0,
    }) as OpsStatus,
  }
}
