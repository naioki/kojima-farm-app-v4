"use client";

import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { useState, useTransition } from "react";
import { Plus, Trash2, CheckCircle, Loader2, Sparkles, Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

import { HumanFormSchema, type HumanForm, type HumanLine } from "@/lib/schemas/ocr";
import type { ParsedLine } from "@/lib/api-client";
import {
  parseOcrVerification,
  approveWithFastApi,
  type PendingVerification,
} from "@/app/actions/ocr-actions";
import { fetchPdfBlob } from "@/lib/api-client";

interface VerificationFormProps {
  verification: PendingVerification;
  onApproved?: () => void;
}

function buildDefaultLine(line: PendingVerification["parsed_lines"][0]): HumanLine {
  return {
    store: line.store ?? "",
    item: line.item ?? "",
    spec: line.spec ?? "",
    unit: line.unit ?? 0,
    boxes: line.boxes ?? 0,
    remainder: line.remainder ?? 0,
  };
}

// 信頼度スコアから色を決定
function confidenceColor(confidence?: number): string {
  if (!confidence || confidence >= 0.9) return "";
  if (confidence >= 0.6) return "border-amber-400 bg-amber-50";
  return "border-red-400 bg-red-50";
}

export function VerificationForm({ verification, onApproved }: VerificationFormProps) {
  const [isPending, startTransition] = useTransition();
  const [isParsing, startParsing] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [approvedOrderId, setApprovedOrderId] = useState<string | null>(null);
  const [isPdfDownloading, setIsPdfDownloading] = useState(false);

  const today = new Date().toISOString().split("T")[0];

  const form = useForm<HumanForm>({
    resolver: zodResolver(HumanFormSchema),
    defaultValues: {
      order_date: today,
      lines: verification.parsed_lines.length > 0
        ? verification.parsed_lines.map(buildDefaultLine)
        : [{ store: "", item: "", spec: "", unit: 0, boxes: 0, remainder: 0 }],
      correction_notes: "",
    },
  });

  const { fields, append, remove, replace } = useFieldArray({
    control: form.control,
    name: "lines",
  });

  // ── Gemini 解析 ────────────────────────────────────────────────────────
  function handleParse() {
    startParsing(async () => {
      const result = await parseOcrVerification(verification.id);
      if (result.success) {
        const newLines = result.data.parsed_lines.map((l) => ({
          store: l.store,
          item: l.item,
          spec: l.spec ?? "",
          unit: l.unit ?? 0,
          boxes: l.boxes ?? 0,
          remainder: l.remainder ?? 0,
        }));
        replace(newLines as HumanLine[]);
        toast.success("Gemini 解析が完了しました", {
          description: `${newLines.length} 行を読み取りました`,
        });
      } else {
        toast.error("Gemini 解析に失敗しました", { description: result.error });
      }
    });
  }

  // ── 承認 ──────────────────────────────────────────────────────────────
  function handleApprove(data: HumanForm) {
    startTransition(async () => {
      const result = await approveWithFastApi(
        verification.id,
        data.order_date,
        data.lines as ParsedLine[],
        data.correction_notes,
      );
      if (result.success) {
        setApprovedOrderId(result.data.order_id);
        toast.success(`受注を登録しました（${result.data.lines_count} 明細）`, {
          description: `受注日: ${result.data.order_date}`,
        });
        // PDF 自動ダウンロード
        handlePdfDownload(result.data.order_id);
      } else {
        toast.error("承認に失敗しました", { description: result.error });
      }
      setConfirmOpen(false);
    });
  }

  // ── PDF ダウンロード ──────────────────────────────────────────────────
  async function handlePdfDownload(orderId?: string) {
    const id = orderId ?? approvedOrderId;
    if (!id) return;
    setIsPdfDownloading(true);
    try {
      const blob = await fetchPdfBlob(id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `labels_${id.slice(0, 8)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error("PDF の取得に失敗しました", { description: String(err) });
    } finally {
      setIsPdfDownloading(false);
      // 承認完了後にリストから除去
      if (orderId) onApproved?.();
    }
  }

  // 承認完了状態
  if (approvedOrderId && !isPdfDownloading) {
    return (
      <Card className="flex flex-col items-center justify-center h-64 gap-4">
        <CheckCircle className="h-12 w-12 text-green-500" />
        <p className="text-sm font-medium">受注登録完了</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => handlePdfDownload()}
          disabled={isPdfDownloading}
        >
          <Download className="h-4 w-4 mr-1" />
          PDF を再ダウンロード
        </Button>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col h-full">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">内容確認・修正フォーム</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              OCR 読み取り結果を確認し、必要に応じて修正してから承認してください。
            </p>
          </div>
          {/* Gemini 解析ボタン */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleParse}
            disabled={isParsing || isPending}
            className="shrink-0"
          >
            {isParsing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {isParsing ? "解析中..." : "Gemini 解析"}
          </Button>
        </div>
      </CardHeader>

      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(() => setConfirmOpen(true))}
          className="flex flex-col flex-1"
        >
          <CardContent className="flex-1 space-y-5 overflow-auto">
            {/* 受注日 */}
            <FormField
              control={form.control}
              name="order_date"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>受注日 *</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Separator />

            {/* 明細行 */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">明細（{fields.length} 行）</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    append({ store: "", item: "", spec: "", unit: 0, boxes: 0, remainder: 0 })
                  }
                >
                  <Plus className="h-3.5 w-3.5" />
                  行を追加
                </Button>
              </div>

              {fields.map((field, idx) => {
                const conf = (verification.parsed_lines[idx] as { confidence?: number } | undefined)?.confidence;
                const rowClass = `rounded-lg border p-3 space-y-2.5 relative transition-colors ${confidenceColor(conf)}`;
                return (
                  <div key={field.id} className={rowClass}>
                    {/* 行ヘッダー */}
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-muted-foreground">
                        明細 {idx + 1}
                        {conf !== undefined && conf < 0.9 && (
                          <Badge variant="outline" className="ml-2 text-amber-600 border-amber-400 text-[10px] py-0">
                            要確認
                          </Badge>
                        )}
                      </p>
                      {fields.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-destructive hover:text-destructive"
                          onClick={() => remove(idx)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>

                    {/* 店舗 / 品目 / 規格 */}
                    <div className="grid grid-cols-3 gap-2">
                      <FormField
                        control={form.control}
                        name={`lines.${idx}.store`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">店舗 *</FormLabel>
                            <FormControl>
                              <Input placeholder="鎌ケ谷" className="text-xs h-8" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`lines.${idx}.item`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">品目 *</FormLabel>
                            <FormControl>
                              <Input placeholder="胡瓜" className="text-xs h-8" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`lines.${idx}.spec`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">規格</FormLabel>
                            <FormControl>
                              <Input placeholder="バラ" className="text-xs h-8" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    {/* 入数 / 箱数 / バラ */}
                    <div className="grid grid-cols-3 gap-2">
                      <FormField
                        control={form.control}
                        name={`lines.${idx}.unit`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">入数</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                min={0}
                                className="text-xs h-8"
                                {...field}
                                onChange={(e) => field.onChange(e.target.valueAsNumber)}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`lines.${idx}.boxes`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">箱数</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                min={0}
                                className="text-xs h-8"
                                {...field}
                                onChange={(e) => field.onChange(e.target.valueAsNumber)}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`lines.${idx}.remainder`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">バラ数</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                min={0}
                                className="text-xs h-8"
                                {...field}
                                onChange={(e) => field.onChange(e.target.valueAsNumber)}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <Separator />

            {/* 修正メモ */}
            <FormField
              control={form.control}
              name="correction_notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>修正メモ（任意）</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="OCR 結果から修正した箇所や理由を記録"
                      className="resize-none"
                      rows={2}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>

          <CardFooter className="border-t pt-4">
            <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
              <AlertDialogTrigger asChild>
                <Button type="submit" className="w-full" disabled={isPending || isParsing}>
                  {isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      処理中...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="h-4 w-4" />
                      内容を確認して承認 ＆ PDF
                    </>
                  )}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>承認の確認</AlertDialogTitle>
                  <AlertDialogDescription>
                    入力内容で受注を登録し、出荷ラベル PDF を自動ダウンロードします。
                    この操作は取り消せません。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={isPending}>キャンセル</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={isPending}
                    onClick={form.handleSubmit(handleApprove)}
                  >
                    {isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        処理中...
                      </>
                    ) : (
                      "承認する"
                    )}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
