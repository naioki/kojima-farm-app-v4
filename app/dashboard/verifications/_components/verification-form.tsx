"use client";

import { useForm, useFieldArray, useWatch, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { useState, useTransition, useEffect, useCallback, useMemo } from "react";
import {
  Plus, Trash2, CheckCircle, Loader2, Sparkles, Download, AlertTriangle, ArrowUp, ArrowDown,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

import { HumanFormSchema, type HumanForm, type HumanLine } from "@/lib/schemas/ocr";
import {
  parseOcrVerification, approveWithFastApi,
  type PendingVerification, type MasterData,
} from "@/app/actions/ocr-actions";
import { fetchPdfBlob } from "@/lib/api-client";
import { cn } from "@/lib/utils";

interface VerificationFormProps {
  verification: PendingVerification;
  masterData: MasterData;
  onApproved?: () => void;
}

// リアルタイム合計計算（行ごと）
function RowTotal({ control, idx }: { control: any; idx: number }) {
  const unit      = useWatch({ control, name: `lines.${idx}.unit` });
  const boxes     = useWatch({ control, name: `lines.${idx}.boxes` });
  const remainder = useWatch({ control, name: `lines.${idx}.remainder` });
  const total     = (Number(unit) || 0) * (Number(boxes) || 0) + (Number(remainder) || 0);
  return (
    <span className={cn("tabular-nums font-mono text-sm", total > 0 ? "font-semibold text-foreground" : "text-muted-foreground")}>
      {total > 0 ? total : "—"}
    </span>
  );
}

// 品目別規格選択コンポーネント（イベント駆動型で状態連動）
function SpecSelector({
  control, idx, masterData, setValue,
}: {
  control: any;
  idx: number;
  masterData: MasterData;
  setValue: any;
}) {
  const itemName = useWatch({ control, name: `lines.${idx}.item` });
  const specVal  = useWatch({ control, name: `lines.${idx}.spec` });

  const product = masterData.products.find((p) => p.name === itemName);
  const availableSpecs = product
    ? masterData.specs.filter((s) => s.productId === product.id)
    : [];

  if (availableSpecs.length === 0) {
    return (
      <Input
        className="h-7 text-xs border-transparent bg-transparent focus:bg-background focus:border-input px-2"
        placeholder="—"
        value={specVal ?? ""}
        onChange={(e) => setValue(`lines.${idx}.spec`, e.target.value)}
      />
    );
  }

  return (
    <Controller
      control={control}
      name={`lines.${idx}.spec`}
      render={({ field }) => (
        <Select
          value={field.value ?? ""}
          onValueChange={(v) => {
            field.onChange(v);
            const spec = availableSpecs.find((s) => s.name === v);
            if (spec && spec.unitSize > 0) {
              setValue(`lines.${idx}.unit`, spec.unitSize);
            }
          }}
        >
          <SelectTrigger className="min-h-7 h-auto text-xs border-transparent bg-transparent focus:bg-background focus:border-input px-2 w-full [&>span]:whitespace-normal [&>span]:break-all [&>span]:text-left">
            <SelectValue placeholder="規格" />
          </SelectTrigger>
          <SelectContent>
            {availableSpecs.map((s) => (
              <SelectItem key={s.name} value={s.name} className="text-xs">
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    />
  );
}

function buildDefaultLine(line: PendingVerification["parsed_lines"][0]): HumanLine {
  return {
    store:     line.store     ?? "",
    item:      line.item      ?? "",
    spec:      line.spec      ?? "",
    unit:      line.unit      ?? 0,
    boxes:     line.boxes     ?? 0,
    remainder: line.remainder ?? 0,
  };
}

const READONLY_STATUSES = ["corrected", "auto_accepted", "rejected"];
const STATUS_LABELS: Record<string, string> = {
  corrected:     "承認済み",
  auto_accepted: "自動承認済み",
  rejected:      "却下済み",
};

export function VerificationForm({ verification, masterData, onApproved }: VerificationFormProps) {
  const isReadOnly = READONLY_STATUSES.includes(verification.status);
  const [isPending,  startTransition] = useTransition();
  const [isParsing,  startParsing]    = useTransition();
  const [confirmOpen,  setConfirmOpen]  = useState(false);
  const [approvedOrderId, setApprovedOrderId] = useState<string | null>(null);
  const [isPdfLoading, setIsPdfLoading] = useState(false);
  const [sortAsc, setSortAsc] = useState(true);

  const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];

  const sortedInitialLines = verification.parsed_lines.length > 0
    ? [...verification.parsed_lines]
        .map(buildDefaultLine)
        .sort((a, b) => {
          const aOrd = masterData.storeOrder[a.store] ?? 999;
          const bOrd = masterData.storeOrder[b.store] ?? 999;
          return aOrd !== bOrd ? aOrd - bOrd : a.store.localeCompare(b.store, "ja");
        })
    : [{ store: "", item: "", spec: "", unit: 0, boxes: 0, remainder: 0 }];

  const form = useForm<HumanForm>({
    resolver: zodResolver(HumanFormSchema),
    defaultValues: {
      order_date: tomorrow,
      lines: sortedInitialLines,
      correction_notes: "",
    },
  });

  const { fields, append, remove, replace } = useFieldArray({
    control: form.control,
    name: "lines",
  });

  // 配送順ソート（フォーム配列は変えず、表示順インデックスだけ計算）
  const currentStores = useWatch({ control: form.control, name: "lines" });
  const displayIndices = useMemo(() => {
    const indices = fields.map((_, i) => i);
    return indices.sort((a, b) => {
      const aStore = currentStores?.[a]?.store ?? "";
      const bStore = currentStores?.[b]?.store ?? "";
      const aOrd = masterData.storeOrder[aStore] ?? 999;
      const bOrd = masterData.storeOrder[bStore] ?? 999;
      const diff = aOrd !== bOrd ? aOrd - bOrd : aStore.localeCompare(bStore, "ja");
      return sortAsc ? diff : -diff;
    });
  }, [fields, currentStores, masterData.storeOrder, sortAsc]);

  // ── エラートースト ─────────────────────────────────────────────────
  function toastError(title: string, detail: string) {
    toast.error(title, {
      description: detail,
      action: {
        label: "コピー",
        onClick: () => navigator.clipboard.writeText(`${title}\n${detail}`),
      },
      duration: 12000,
    });
  }

  // ── Gemini 解析 ───────────────────────────────────────────────────
  function handleParse() {
    startParsing(async () => {
      const result = await parseOcrVerification(verification.id);
      if (result.success) {
        const newLines = result.data.parsed_lines.map((l) => ({
          store:     l.store,
          item:      l.item,
          spec:      l.spec      ?? "",
          unit:      l.unit      ?? 0,
          boxes:     l.boxes     ?? 0,
          remainder: l.remainder ?? 0,
        }));
        replace(newLines as HumanLine[]);
        toast.success(`Gemini 解析完了 — ${newLines.length} 行を読み取りました`);
      } else {
        toastError("Gemini 解析に失敗しました", result.error);
      }
    });
  }

  // ── 承認 ─────────────────────────────────────────────────────────
  function handleApprove(data: HumanForm) {
    startTransition(async () => {
      const result = await approveWithFastApi(
        verification.id,
        data.order_date,
        data.lines,
        data.correction_notes,
      );
      setConfirmOpen(false);
      if (result.success) {
        setApprovedOrderId(result.data.order_id);
        toast.success(`受注登録完了（${result.data.lines_count} 明細）`, {
          description: `受注日: ${result.data.order_date}`,
        });
        handlePdfDownload(result.data.order_id, result.data.order_date);
      } else {
        toastError("承認に失敗しました", result.error);
      }
    });
  }

  // ── PDF ダウンロード ─────────────────────────────────────────────
  async function handlePdfDownload(orderId?: string, orderDate?: string) {
    const id = orderId ?? approvedOrderId;
    if (!id) return;
    setIsPdfLoading(true);
    try {
      const blob = await fetchPdfBlob(id);
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      const dateStr = (orderDate ?? "").replace(/-/g, "");
      a.download = dateStr ? `出荷ラベル_${dateStr}.pdf` : `出荷ラベル_${id.slice(0, 8)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toastError("PDF の取得に失敗しました", String(err));
    } finally {
      setIsPdfLoading(false);
      if (orderId) onApproved?.();
    }
  }

  // ── 読み取り専用 ──────────────────────────────────────────────────
  if (isReadOnly) {
    return (
      <Card className="h-full flex flex-col overflow-hidden">
        <CardHeader className="pb-2 pt-3 px-4 border-b bg-muted/30 shrink-0">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">明細（読み取り専用）</span>
            <Badge variant="outline" className="text-xs">
              {STATUS_LABELS[verification.status] ?? verification.status}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="flex-1 overflow-auto p-0">
          {verification.parsed_lines.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
              明細データがありません
            </div>
          ) : (
            <table className="w-full min-w-[560px] text-xs">
              <thead className="bg-muted sticky top-0">
                <tr>
                  {["店舗","品目","規格","入数","箱","バラ","合計"].map((h) => (
                    <th key={h} className="px-3 py-2 text-left font-semibold text-muted-foreground whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {verification.parsed_lines.map((line, idx) => (
                  <tr key={idx} className="border-t hover:bg-muted/40 transition-colors">
                    <td className="px-3 py-2 font-medium">{line.store || "—"}</td>
                    <td className="px-3 py-2">{line.item}</td>
                    <td className="px-3 py-2 text-muted-foreground">{line.spec || "—"}</td>
                    <td className="px-3 py-2 text-right font-mono">{line.unit}</td>
                    <td className="px-3 py-2 text-right font-mono">{line.boxes}</td>
                    <td className="px-3 py-2 text-right font-mono">{line.remainder}</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold text-foreground">
                      {(() => {
                        const t = (line.unit ?? 0) * (line.boxes ?? 0) + (line.remainder ?? 0);
                        return t > 0 ? t : "—";
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    );
  }

  // ── 承認完了 ──────────────────────────────────────────────────────
  if (approvedOrderId) {
    return (
      <Card className="h-full flex flex-col items-center justify-center gap-5 p-8">
        <div className="rounded-full bg-green-100 p-5">
          <CheckCircle className="h-12 w-12 text-green-600" />
        </div>
        <div className="text-center space-y-1">
          <p className="font-semibold text-lg">受注登録完了</p>
          <p className="text-xs text-muted-foreground">
            出荷ラベル PDF を自動ダウンロードしています
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => handlePdfDownload()}
          disabled={isPdfLoading}
        >
          {isPdfLoading
            ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
            : <Download className="h-4 w-4 mr-1.5" />
          }
          PDF を再ダウンロード
        </Button>
      </Card>
    );
  }

  // ── メインフォーム ────────────────────────────────────────────────
  return (
    <Card className="h-full flex flex-col overflow-hidden">
      {/* ヘッダー */}
      <CardHeader className="pb-0 pt-3 px-4 border-b bg-muted/30 shrink-0">
        <div className="flex items-center justify-between pb-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">明細確認・承認</span>
            <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-300">
              {fields.length} 行
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSortAsc((v) => !v)}
              className="h-7 px-2 rounded text-[11px] flex items-center gap-1 border transition-colors bg-background text-muted-foreground border-input hover:text-foreground"
              title="配送順の昇順/降順を切り替え"
            >
              {sortAsc
                ? <><ArrowUp className="h-3 w-3" />配送順 ▲</>
                : <><ArrowDown className="h-3 w-3" />配送順 ▼</>
              }
            </button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={handleParse}
              disabled={isParsing || isPending}
            >
              {isParsing
                ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />解析中...</>
                : <><Sparkles className="h-3 w-3 mr-1" />Gemini 解析</>
              }
            </Button>
          </div>
        </div>
      </CardHeader>

      <form
        onSubmit={form.handleSubmit(() => setConfirmOpen(true))}
        className="flex flex-col flex-1 overflow-hidden"
      >
        <CardContent className="flex-1 overflow-hidden p-0 flex flex-col">

          {/* 受注日 */}
          <div className="px-4 py-2 border-b bg-background shrink-0 flex items-center gap-3">
            <label className="text-xs font-semibold text-muted-foreground whitespace-nowrap">
              受注日
            </label>
            <Input
              type="date"
              className="h-7 text-xs w-40"
              {...form.register("order_date")}
            />
            {form.formState.errors.order_date && (
              <span className="text-xs text-destructive">
                {form.formState.errors.order_date.message}
              </span>
            )}
          </div>

          {/* 明細テーブル（モバイルは横スクロール） */}
          <div className="flex-1 overflow-auto">
            <table className="w-full min-w-[560px] text-xs border-separate border-spacing-0">
              <thead className="bg-muted/80 sticky top-0 z-10">
                <tr>
                  <th className="px-2 py-2 text-center font-semibold text-muted-foreground w-8">#</th>
                  <th className="px-2 py-2 text-left font-semibold text-muted-foreground min-w-[90px]">店舗</th>
                  <th className="px-2 py-2 text-left font-semibold text-muted-foreground min-w-[80px] max-w-[110px]">品目</th>
                  <th className="px-2 py-2 text-left font-semibold text-muted-foreground min-w-[60px] max-w-[90px]">規格</th>
                  <th className="px-2 py-2 text-center font-semibold text-muted-foreground w-14">入数</th>
                  <th className="px-2 py-2 text-center font-semibold text-muted-foreground w-14">箱</th>
                  <th className="px-2 py-2 text-center font-semibold text-muted-foreground w-14">バラ</th>
                  <th className="px-2 py-2 text-center font-semibold text-muted-foreground w-14">合計</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {displayIndices.map((idx, displayPos) => {
                  const field     = fields[idx];
                  const conf      = (verification.parsed_lines[idx] as any)?.confidence;
                  const isLowConf = conf !== undefined && conf < 0.9;
                  const storeErr  = form.formState.errors.lines?.[idx]?.store;
                  const itemErr   = form.formState.errors.lines?.[idx]?.item;

                  return (
                    <tr
                      key={field.id}
                      className={cn(
                        "border-t transition-colors hover:bg-muted/20",
                        isLowConf && "bg-amber-50/70"
                      )}
                    >
                      {/* 行番号 */}
                      <td className="px-2 py-1 text-center text-muted-foreground">
                        {isLowConf
                          ? <span title="要確認"><AlertTriangle className="h-3.5 w-3.5 text-amber-500 mx-auto" /></span>
                          : <span className="text-[11px]">{displayPos + 1}</span>
                        }
                      </td>

                      {/* 店舗 ▼ ドロップダウン */}
                      <td className="px-1 py-0.5">
                        <Controller
                          control={form.control}
                          name={`lines.${idx}.store`}
                          render={({ field: f }) => (
                            <Select value={f.value ?? ""} onValueChange={f.onChange}>
                              <SelectTrigger className={cn(
                                "h-7 text-xs border-transparent bg-transparent focus:bg-background focus:border-input px-2 w-full",
                                storeErr && "border-destructive"
                              )}>
                                <SelectValue placeholder="店舗" />
                              </SelectTrigger>
                              <SelectContent>
                                {masterData.stores.map((s) => (
                                  <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        />
                      </td>

                      {/* 品目 ▼ ドロップダウン */}
                      <td className="px-1 py-0.5 max-w-[110px]">
                        <Controller
                          control={form.control}
                          name={`lines.${idx}.item`}
                          render={({ field: f }) => (
                            <Select
                              value={f.value ?? ""}
                              onValueChange={(val) => {
                                f.onChange(val);
                                // 品目変更時に規格と入数を自動更新
                                const prod = masterData.products.find((p) => p.name === val);
                                const availableSpecs = prod
                                  ? masterData.specs.filter((s) => s.productId === prod.id)
                                  : [];
                                const firstSpec = availableSpecs[0];
                                if (firstSpec) {
                                  form.setValue(`lines.${idx}.spec`, firstSpec.name);
                                  form.setValue(`lines.${idx}.unit`, firstSpec.unitSize);
                                } else {
                                  form.setValue(`lines.${idx}.spec`, "");
                                  form.setValue(`lines.${idx}.unit`, 0);
                                }
                              }}
                            >
                              <SelectTrigger className={cn(
                                "min-h-7 h-auto text-xs border-transparent bg-transparent focus:bg-background focus:border-input px-2 w-full [&>span]:whitespace-normal [&>span]:break-all [&>span]:text-left",
                                itemErr && "border-destructive"
                              )}>
                                <SelectValue placeholder="品目" />
                              </SelectTrigger>
                              <SelectContent>
                                {masterData.products.map((p) => (
                                  <SelectItem key={p.id} value={p.name} className="text-xs">{p.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        />
                      </td>

                      {/* 規格 ▼ 品目連動ドロップダウン */}
                      <td className="px-1 py-0.5 max-w-[90px]">
                        <SpecSelector
                          control={form.control}
                          idx={idx}
                          masterData={masterData}
                          setValue={form.setValue}
                        />
                      </td>

                      {/* 入数 */}
                      <td className="px-1 py-0.5">
                        <Input
                          type="number" min={0}
                          className="h-7 text-xs text-center border-transparent bg-transparent focus:bg-background focus:border-input px-1"
                          {...form.register(`lines.${idx}.unit`, { valueAsNumber: true })}
                        />
                      </td>

                      {/* 箱数 */}
                      <td className="px-1 py-0.5">
                        <Input
                          type="number" min={0}
                          className="h-7 text-xs text-center border-transparent bg-transparent focus:bg-background focus:border-input px-1"
                          {...form.register(`lines.${idx}.boxes`, { valueAsNumber: true })}
                        />
                      </td>

                      {/* バラ */}
                      <td className="px-1 py-0.5">
                        <Input
                          type="number" min={0}
                          className="h-7 text-xs text-center border-transparent bg-transparent focus:bg-background focus:border-input px-1"
                          {...form.register(`lines.${idx}.remainder`, { valueAsNumber: true })}
                        />
                      </td>

                      {/* 合計 */}
                      <td className="px-2 py-1 text-center">
                        <RowTotal control={form.control} idx={idx} />
                      </td>

                      {/* 削除 */}
                      <td className="px-1 py-0.5 text-center">
                        {fields.length > 1 && (
                          <button
                            type="button"
                            onClick={() => remove(idx)}
                            className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors mx-auto"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* 行追加 + 修正メモ */}
          <div className="shrink-0 border-t px-4 py-3 space-y-2 bg-background">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground hover:text-foreground -ml-2"
              onClick={() =>
                append({ store: "", item: "", spec: "", unit: 0, boxes: 0, remainder: 0 })
              }
            >
              <Plus className="h-3.5 w-3.5 mr-1" />行を追加
            </Button>
            <Textarea
              placeholder="修正メモ（任意）— OCR から修正した箇所など"
              className="text-xs resize-none h-14 min-h-0"
              {...form.register("correction_notes")}
            />
          </div>
        </CardContent>

        {/* フッター */}
        <CardFooter className="border-t px-4 py-3 shrink-0">
          <Button
            type="submit"
            className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold"
            disabled={isPending || isParsing}
          >
            {isPending
              ? <><Loader2 className="h-4 w-4 animate-spin mr-1.5" />処理中...</>
              : <><CheckCircle className="h-4 w-4 mr-1.5" />承認 ＆ PDF 発行</>
            }
          </Button>
        </CardFooter>
      </form>

      {/* 承認確認ダイアログ — 日付確認 ＋ 明細一覧 */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-center text-lg">受注内容の確認</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-4 pt-2">
                <p className="text-muted-foreground text-sm text-center">
                  この内容で受注登録・PDF発行してよいですか？
                </p>
                {/* 受注日 */}
                <div className="flex justify-center">
                  <div className="rounded-xl border-2 border-primary/30 bg-primary/5 py-3 px-6 text-center">
                    <p className="text-2xl font-bold tracking-wide text-foreground">
                      {form.getValues("order_date")}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {form.getValues("lines").length} 明細
                    </p>
                  </div>
                </div>
                {/* 明細一覧 */}
                <div className="rounded-lg border bg-muted/30 overflow-hidden">
                  <div className="max-h-52 overflow-auto divide-y">
                    {form.getValues("lines").map((line, i) => {
                      const total = (line.unit || 0) * (line.boxes || 0) + (line.remainder || 0);
                      return (
                        <div key={i} className="px-3 py-1.5 flex items-center gap-2 text-xs">
                          <span className="font-medium w-16 truncate text-foreground shrink-0">{line.store || "—"}</span>
                          <span className="text-muted-foreground flex-1 truncate">
                            {line.item}{line.spec ? ` (${line.spec})` : ""}
                          </span>
                          <span className="font-mono shrink-0">
                            {line.boxes}箱{line.remainder > 0 ? `+${line.remainder}` : ""}
                            <span className="text-muted-foreground ml-1">= {total}</span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="sm:justify-center gap-3 pt-2">
            <AlertDialogCancel disabled={isPending}>修正する</AlertDialogCancel>
            <AlertDialogAction
              className="bg-green-600 hover:bg-green-700"
              disabled={isPending}
              onClick={form.handleSubmit(handleApprove)}
            >
              {isPending
                ? <><Loader2 className="h-4 w-4 animate-spin mr-1" />処理中...</>
                : "承認 ＆ PDF発行"
              }
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
