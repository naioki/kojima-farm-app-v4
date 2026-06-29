"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Invoice, InvoiceItem } from "@/app/actions/invoice-actions";
import { updateInvoiceStatus } from "@/app/actions/invoice-actions";
import { NewInvoiceDialog } from "./new-invoice-dialog";
import { InvoicePDFButton } from "./invoice-pdf-button";

const STATUS_LABEL: Record<string, string> = {
  draft: "下書き",
  finalized: "確定",
  sent: "送付済",
  paid: "入金済",
  void: "無効",
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "secondary",
  finalized: "default",
  sent: "default",
  paid: "outline",
  void: "destructive",
};

function fmtYen(n: number) {
  return `¥${Math.round(n).toLocaleString("ja-JP")}`;
}

function fmtDate(s: string | null) {
  if (!s) return "—";
  return s.slice(0, 10);
}

function InvoiceRow({ inv }: { inv: Invoice }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [, startTr] = useTransition();

  async function toggleDetail() {
    if (open) { setOpen(false); return; }
    if (items.length === 0) {
      setLoading(true);
      const { getInvoiceDetail } = await import("@/app/actions/invoice-actions");
      const res = await getInvoiceDetail(inv.id);
      setLoading(false);
      if (res.success) setItems(res.data.items);
    }
    setOpen(true);
  }

  function handleStatusChange(next: Invoice["status"]) {
    startTr(async () => {
      const res = await updateInvoiceStatus(inv.id, next);
      if (res.success) toast.success("ステータスを更新しました");
      else toast.error(res.error);
    });
  }

  return (
    <>
      <tr className="border-b hover:bg-muted/30 cursor-pointer" onClick={toggleDetail}>
        <td className="p-2 pl-3 font-mono text-xs">{inv.invoice_number}</td>
        <td className="p-2">{inv.customer_name}</td>
        <td className="p-2">{inv.billing_month}</td>
        <td className="p-2">{fmtDate(inv.issue_date)}</td>
        <td className="p-2 text-right font-mono">{fmtYen(Number(inv.total_amount))}</td>
        <td className="p-2" onClick={(e) => e.stopPropagation()}>
          <Badge variant={STATUS_VARIANT[inv.status]}>{STATUS_LABEL[inv.status]}</Badge>
        </td>
        <td className="p-2 pr-3 text-center">
          {open ? <ChevronUp className="w-4 h-4 mx-auto" /> : <ChevronDown className="w-4 h-4 mx-auto" />}
        </td>
      </tr>
      {open && (
        <tr className="border-b bg-muted/10">
          <td colSpan={7} className="p-3 pl-6">
            {loading ? (
              <p className="text-sm text-muted-foreground">読込中...</p>
            ) : (
              <div className="space-y-3">
                {/* Header info */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                  <div><span className="text-muted-foreground">対象期間: </span>{fmtDate(inv.period_start)}〜{fmtDate(inv.period_end)}</div>
                  <div><span className="text-muted-foreground">請求日: </span>{fmtDate(inv.issue_date)}</div>
                  <div><span className="text-muted-foreground">支払期日: </span>{fmtDate(inv.due_date)}</div>
                  <div><span className="text-muted-foreground">8%対象: </span>{fmtYen(Number(inv.subtotal_8))} / 税{fmtYen(Number(inv.tax_8))}</div>
                </div>

                {/* Line items */}
                {items.length > 0 && (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left p-1 font-medium">品目</th>
                        <th className="text-right p-1 font-medium">数量</th>
                        <th className="text-right p-1 font-medium">単価</th>
                        <th className="text-right p-1 font-medium">税率</th>
                        <th className="text-right p-1 font-medium">金額</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it) => (
                        <tr key={it.id} className="border-b last:border-0">
                          <td className="p-1">{it.product_name}</td>
                          <td className="p-1 text-right">{Number(it.quantity).toLocaleString("ja-JP")}{it.unit}</td>
                          <td className="p-1 text-right font-mono">{fmtYen(Number(it.unit_price))}</td>
                          <td className="p-1 text-right text-muted-foreground">{it.tax_rate}%</td>
                          <td className="p-1 text-right font-mono">{fmtYen(Number(it.subtotal))}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t">
                        <td colSpan={4} className="p-1 text-right font-medium">合計（税込）</td>
                        <td className="p-1 text-right font-mono font-bold">{fmtYen(Number(inv.total_amount))}</td>
                      </tr>
                    </tfoot>
                  </table>
                )}

                {/* Status actions + PDF */}
                <div className="flex gap-2 flex-wrap items-center">
                  <InvoicePDFButton
                    invoiceId={inv.id}
                    invoiceNumber={inv.invoice_number}
                    customerName={inv.customer_name}
                  />
                  {inv.status === "draft" && (
                    <Button size="sm" onClick={() => handleStatusChange("finalized")}>確定する</Button>
                  )}
                  {inv.status === "finalized" && (
                    <Button size="sm" onClick={() => handleStatusChange("sent")}>送付済にする</Button>
                  )}
                  {inv.status === "sent" && (
                    <Button size="sm" variant="outline" onClick={() => handleStatusChange("paid")}>入金済にする</Button>
                  )}
                  {inv.status !== "void" && inv.status !== "paid" && (
                    <Button size="sm" variant="destructive" onClick={() => handleStatusChange("void")}>無効</Button>
                  )}
                </div>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export function InvoicesClient({
  invoices,
  customers,
}: {
  invoices: Invoice[];
  customers: { id: string; name: string }[];
}) {
  const router = useRouter();

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">請求書</h1>
        <NewInvoiceDialog customers={customers} onCreated={() => router.refresh()} />
      </div>

      {invoices.length === 0 ? (
        <div className="rounded-lg border p-8 text-center text-muted-foreground text-sm">
          請求書がありません
        </div>
      ) : (
        <div className="rounded-lg border overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="text-left p-2 pl-3 font-medium">請求番号</th>
                <th className="text-left p-2 font-medium">請求先</th>
                <th className="text-left p-2 font-medium">対象月</th>
                <th className="text-left p-2 font-medium">発行日</th>
                <th className="text-right p-2 font-medium">合計（税込）</th>
                <th className="text-left p-2 font-medium">状態</th>
                <th className="p-2 pr-3"></th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <InvoiceRow key={inv.id} inv={inv} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
