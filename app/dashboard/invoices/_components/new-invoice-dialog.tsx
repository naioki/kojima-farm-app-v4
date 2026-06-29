"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Loader2, ChevronRight, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { previewInvoice, createInvoice } from "@/app/actions/invoice-actions";
import type { PreviewLine } from "@/app/actions/invoice-actions";

function fmtYen(n: number) {
  return `¥${Math.round(n).toLocaleString("ja-JP")}`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(date: string, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

interface Props {
  customers: { id: string; name: string }[];
  onCreated: () => void;
}

export function NewInvoiceDialog({ customers, onCreated }: Props) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [customerId, setCustomerId] = useState("");
  const [billingMonth, setBillingMonth] = useState(currentMonth());
  const [issueDate, setIssueDate] = useState(today());
  const [dueDate, setDueDate] = useState(addDays(today(), 30));
  const [lines, setLines] = useState<PreviewLine[]>([]);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [isPreviewing, startPreview] = useTransition();
  const [isCreating, startCreate] = useTransition();

  function handleOpen() {
    setStep(1);
    setCustomerId("");
    setBillingMonth(currentMonth());
    setIssueDate(today());
    setDueDate(addDays(today(), 30));
    setLines([]);
    setOpen(true);
  }

  function handlePreview() {
    if (!customerId) { toast.error("請求先を選択してください"); return; }
    startPreview(async () => {
      const res = await previewInvoice(customerId, billingMonth);
      if (!res.success) { toast.error(res.error); return; }
      if (res.data.lines.length === 0) {
        toast.warning("該当する受注明細がありません（承認済・出荷済のみ対象）");
        return;
      }
      setLines(res.data.lines);
      setPeriodStart(res.data.period_start);
      setPeriodEnd(res.data.period_end);
      setStep(2);
    });
  }

  function handleCreate() {
    startCreate(async () => {
      const res = await createInvoice({
        customer_id: customerId,
        billing_month: billingMonth,
        period_start: periodStart,
        period_end: periodEnd,
        issue_date: issueDate,
        due_date: dueDate,
        lines,
      });
      if (!res.success) { toast.error(res.error); return; }
      toast.success(`請求書 ${res.data.invoice_number} を作成しました`);
      setOpen(false);
      onCreated();
    });
  }

  const sub8 = lines.filter(l => l.tax_rate === 8).reduce((s, l) => s + l.subtotal, 0);
  const sub10 = lines.filter(l => l.tax_rate === 10).reduce((s, l) => s + l.subtotal, 0);
  const tax8 = Math.floor(sub8 * 0.08);
  const tax10 = Math.floor(sub10 * 0.10);
  const total = sub8 + tax8 + sub10 + tax10;

  return (
    <>
      <Button size="sm" className="gap-1" onClick={handleOpen}>
        <Plus className="w-4 h-4" />
        新規作成
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {step === 1 ? "請求書 新規作成 — 対象選択" : "請求書 新規作成 — 内容確認"}
            </DialogTitle>
          </DialogHeader>

          {step === 1 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>請求先 *</Label>
                <select
                  className="w-full h-9 rounded-md border px-3 text-sm"
                  value={customerId}
                  onChange={e => setCustomerId(e.target.value)}
                >
                  <option value="">選択してください</option>
                  {customers.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label>請求対象月</Label>
                <Input
                  type="month"
                  value={billingMonth}
                  onChange={e => setBillingMonth(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>請求書発行日</Label>
                  <Input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>支払期日</Label>
                  <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                承認済・出荷済の受注を対象月の受注日で集計します。
              </p>

              <div className="flex justify-end">
                <Button onClick={handlePreview} disabled={isPreviewing || !customerId}>
                  {isPreviewing
                    ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />読込中...</>
                    : <>明細を取得 <ChevronRight className="w-4 h-4 ml-1" /></>
                  }
                </Button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              {/* Header summary */}
              <div className="rounded-md bg-muted/40 p-3 text-sm grid grid-cols-2 gap-y-1">
                <span className="text-muted-foreground">請求先</span>
                <span className="font-medium">{customers.find(c => c.id === customerId)?.name}</span>
                <span className="text-muted-foreground">対象月</span>
                <span>{billingMonth}</span>
                <span className="text-muted-foreground">対象期間</span>
                <span>{periodStart} 〜 {periodEnd}</span>
                <span className="text-muted-foreground">請求日</span>
                <span>{issueDate}</span>
                <span className="text-muted-foreground">支払期日</span>
                <span>{dueDate}</span>
              </div>

              {/* Line items */}
              <div className="rounded-md border overflow-x-auto">
                <table className="w-full text-sm min-w-[480px]">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      <th className="text-left p-2 pl-3 font-medium">品目</th>
                      <th className="text-left p-2 font-medium">受注日</th>
                      <th className="text-right p-2 font-medium">数量</th>
                      <th className="text-right p-2 font-medium">単価</th>
                      <th className="text-right p-2 font-medium">税率</th>
                      <th className="text-right p-2 pr-3 font-medium">金額</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="p-2 pl-3">{l.product_name}{l.spec ? ` ${l.spec}` : ""}</td>
                        <td className="p-2 text-muted-foreground text-xs">{l.order_date}</td>
                        <td className="p-2 text-right">{l.billable_qty.toLocaleString()}{l.unit}</td>
                        <td className="p-2 text-right font-mono">{fmtYen(l.unit_price)}</td>
                        <td className="p-2 text-right text-muted-foreground">{l.tax_rate}%</td>
                        <td className="p-2 pr-3 text-right font-mono">{fmtYen(l.subtotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Totals */}
              <div className="rounded-md border p-3 text-sm space-y-1">
                {sub8 > 0 && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">8%対象（税抜）</span>
                      <span className="font-mono">{fmtYen(sub8)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">消費税（8%）</span>
                      <span className="font-mono">{fmtYen(tax8)}</span>
                    </div>
                  </>
                )}
                {sub10 > 0 && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">10%対象（税抜）</span>
                      <span className="font-mono">{fmtYen(sub10)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">消費税（10%）</span>
                      <span className="font-mono">{fmtYen(tax10)}</span>
                    </div>
                  </>
                )}
                <div className="flex justify-between border-t pt-1 font-semibold">
                  <span>合計（税込）</span>
                  <span className="font-mono text-base">{fmtYen(total)}</span>
                </div>
              </div>

              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setStep(1)}>
                  <ChevronLeft className="w-4 h-4 mr-1" />戻る
                </Button>
                <Button onClick={handleCreate} disabled={isCreating}>
                  {isCreating
                    ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />作成中...</>
                    : "請求書を作成する"
                  }
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
