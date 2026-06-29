'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export type Invoice = {
  id: string
  invoice_number: string
  customer_id: string
  customer_name: string
  billing_month: string
  issue_date: string | null
  due_date: string | null
  period_start: string | null
  period_end: string | null
  subtotal_8: number
  tax_8: number
  subtotal_10: number
  tax_10: number
  total_amount: number
  status: 'draft' | 'finalized' | 'sent' | 'paid' | 'void'
  created_at: string
}

export type InvoiceItem = {
  id: string
  invoice_id: string
  order_item_id: string | null
  product_name: string
  quantity: number
  unit: string
  unit_price: number
  tax_rate: 8 | 10
  subtotal: number
  tax_amount: number
  line_total: number
}

export type CompanySettings = {
  id: string
  company_name: string
  company_name_kana: string | null
  postal_code: string | null
  address: string | null
  tel: string | null
  fax: string | null
  email: string | null
  invoice_reg_num: string | null
  bank_info: string | null
  rounding_rule: 'floor' | 'round' | 'ceil'
  sales_basis: 'order_date' | 'delivery_date'
}

export async function getInvoices() {
  const sb = await createClient()
  const { data, error } = await sb
    .from('invoices')
    .select(`
      id, invoice_number, customer_id, billing_month,
      issue_date, due_date, period_start, period_end,
      subtotal_8, tax_8, subtotal_10, tax_10, total_amount,
      status, created_at,
      customers(name)
    `)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) return { success: false as const, error: error.message }
  const rows = (data ?? []).map((r: Record<string, unknown>) => ({
    ...r,
    customer_name: (r.customers as { name: string } | null)?.name ?? '—',
  })) as Invoice[]
  return { success: true as const, data: rows }
}

export async function getInvoiceDetail(id: string) {
  const sb = await createClient()
  const [invRes, itemsRes] = await Promise.all([
    sb.from('invoices').select(`*, customers(name)`).eq('id', id).single(),
    sb.from('invoice_items').select('*').eq('invoice_id', id).order('created_at'),
  ])
  if (invRes.error) return { success: false as const, error: invRes.error.message }
  const inv = { ...invRes.data, customer_name: (invRes.data as Record<string, unknown> & { customers: { name: string } | null }).customers?.name ?? '—' } as Invoice
  return { success: true as const, data: { invoice: inv, items: (itemsRes.data ?? []) as InvoiceItem[] } }
}

export async function getCompanySettings(): Promise<CompanySettings | null> {
  const sb = await createClient()
  const { data } = await sb.from('company_settings').select('*').limit(1).single()
  return (data as CompanySettings | null) ?? null
}

export async function saveCompanySettings(settings: Partial<CompanySettings>) {
  const sb = await createClient()
  const existing = await getCompanySettings()
  let error
  if (existing) {
    const res = await sb.from('company_settings').update(settings).eq('id', existing.id)
    error = res.error
  } else {
    const res = await sb.from('company_settings').insert(settings)
    error = res.error
  }
  if (error) return { success: false as const, error: error.message }
  revalidatePath('/dashboard/settings')
  return { success: true as const }
}

export async function updateInvoiceStatus(
  id: string,
  status: Invoice['status']
) {
  const sb = await createClient()
  const { error } = await sb.from('invoices').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) return { success: false as const, error: error.message }
  revalidatePath('/dashboard/invoices')
  return { success: true as const }
}

export type PreviewLine = {
  order_id: string
  order_line_id?: string
  order_date: string
  product_name: string
  spec: string | null
  quantity: number
  billable_qty: number
  unit: string
  unit_price: number
  tax_rate: 8 | 10
  subtotal: number
}

export async function previewInvoice(customerId: string, billingMonth: string) {
  const sb = await createClient()
  const [y, m] = billingMonth.split('-').map(Number)
  const start = `${y}-${String(m).padStart(2, '0')}-01`
  const end = new Date(y, m, 0).toISOString().slice(0, 10)

  // 本番DBスキーマ: order_lines → product_standards → products
  const { data, error } = await (sb as any)
    .from('order_lines')
    .select(`
      id,
      total_qty,
      unit_price,
      line_total,
      orders!inner(id, order_date, status),
      product_standards!inner(name, unit_type, products!inner(name))
    `)
    .eq('customer_id', customerId)
    .in('orders.status', ['verified', 'shipped'])
    .gte('orders.order_date', start)
    .lte('orders.order_date', end)

  if (error) return { success: false as const, error: error.message }

  const lines: PreviewLine[] = []
  for (const ol of data ?? []) {
    const qty = Number(ol.total_qty ?? 0)
    const price = Number(ol.unit_price ?? 0)
    const subtotal = ol.line_total != null ? Number(ol.line_total) : Math.round(qty * price)
    lines.push({
      order_id: ol.orders.id,
      order_line_id: ol.id,
      order_date: ol.orders.order_date,
      product_name: ol.product_standards.products.name,
      spec: ol.product_standards.name,
      quantity: qty,
      billable_qty: qty,
      unit: ol.product_standards.unit_type,
      unit_price: price,
      tax_rate: 8, // 農産物は軽減税率8%
      subtotal,
    })
  }

  lines.sort((a, b) => a.order_date.localeCompare(b.order_date) || a.product_name.localeCompare(b.product_name))

  return { success: true as const, data: { lines, period_start: start, period_end: end } }
}

function applyRounding(n: number, rule: string): number {
  if (rule === 'ceil') return Math.ceil(n)
  if (rule === 'round') return Math.round(n)
  return Math.floor(n)
}

export async function createInvoice(input: {
  customer_id: string
  billing_month: string
  period_start: string
  period_end: string
  issue_date: string
  due_date: string
  lines: PreviewLine[]
}) {
  const sb = await createClient()
  const company = await getCompanySettings()
  const rule = company?.rounding_rule ?? 'floor'

  const sub8 = input.lines.filter(l => l.tax_rate === 8).reduce((s, l) => s + l.subtotal, 0)
  const sub10 = input.lines.filter(l => l.tax_rate === 10).reduce((s, l) => s + l.subtotal, 0)
  const tax8 = applyRounding(sub8 * 0.08, rule)
  const tax10 = applyRounding(sub10 * 0.10, rule)
  const total = sub8 + tax8 + sub10 + tax10

  // invoice_number: INV-YYYYMM-NNN
  const monthKey = input.billing_month.replace('-', '')
  const { data: seqData, error: seqErr } = await sb.rpc('get_next_invoice_number', { p_month: input.billing_month })
  if (seqErr) return { success: false as const, error: seqErr.message }
  const seq = String(seqData as number).padStart(3, '0')
  const invoiceNumber = `INV-${monthKey}-${seq}`

  const { data: inv, error: invErr } = await sb
    .from('invoices')
    .insert({
      invoice_number: invoiceNumber,
      customer_id: input.customer_id,
      billing_month: input.billing_month,
      period_start: input.period_start,
      period_end: input.period_end,
      issue_date: input.issue_date,
      due_date: input.due_date,
      subtotal_8: sub8,
      tax_8: tax8,
      subtotal_10: sub10,
      tax_10: tax10,
      total_amount: total,
      invoice_reg_num: company?.invoice_reg_num ?? null,
      status: 'draft',
    })
    .select('id')
    .single()

  if (invErr) return { success: false as const, error: invErr.message }

  const itemRows = input.lines.map(l => ({
    invoice_id: inv.id,
    order_line_id: l.order_line_id ?? null,
    product_name: l.product_name + (l.spec ? ` ${l.spec}` : ''),
    quantity: l.billable_qty,
    unit: l.unit,
    unit_price: l.unit_price,
    tax_rate: l.tax_rate,
    subtotal: l.subtotal,
  }))

  const { error: itemErr } = await (sb as any).from('invoice_items').insert(itemRows)
  if (itemErr) {
    await sb.from('invoices').delete().eq('id', inv.id)
    return { success: false as const, error: itemErr.message }
  }

  revalidatePath('/dashboard/invoices')
  return { success: true as const, data: { invoice_number: invoiceNumber, invoice_id: inv.id } }
}

export async function getCustomers() {
  const sb = await createClient()
  const { data, error } = await sb
    .from('customers')
    .select('id, name')
    .eq('is_active', true)
    .order('name')
  if (error) return []
  return (data ?? []) as { id: string; name: string }[]
}
