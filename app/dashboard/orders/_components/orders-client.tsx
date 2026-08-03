"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  FileDown, RefreshCw, Package, Mail, FileImage,
  CheckCircle, Clock, XCircle, Trash2, ArrowUpDown, X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { Order, OrderDetail } from "@/app/actions/order-actions";
import { getOrderDetail, deleteOrder } from "@/app/actions/order-actions";
import { downloadOrderLabelPdf } from "@/lib/download";
import { ItemSheetDialog } from "./item-sheet-dialog";

type OrderFilterValues = {
  from?: string;
  to?: string;
  status?: string;
};

interface OrdersClientProps {
  initialOrders: Order[];
  /** サーバー側で取得上限に達したか */
  truncated?: boolean;
  /** サーバー側で適用済みの絞り込み（URL と一致する） */
  filters?: OrderFilterValues;
}

const ALL_STATUSES = "__all__";

function SourceBadge({ source }: { source: string }) {
  if (source === "email") {
    return (
      <Badge variant="outline" className="gap-1 text-blue-700 border-blue-300 bg-blue-50">
        <Mail className="h-3 w-3" />メール
      </Badge>
    );
  }
  if (source === "fax") {
    return (
      <Badge variant="outline" className="gap-1 text-purple-700 border-purple-300 bg-purple-50">
        <FileImage className="h-3 w-3" />FAX
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      {source}
    </Badge>
  );
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "confirmed":
      return (
        <Badge className="gap-1 bg-green-100 text-green-800 border-green-300">
          <CheckCircle className="h-3 w-3" />確定
        </Badge>
      );
    case "draft":
      return (
        <Badge className="gap-1 bg-yellow-100 text-yellow-800 border-yellow-300">
          <Clock className="h-3 w-3" />下書き
        </Badge>
      );
    case "cancelled":
      return (
        <Badge className="gap-1 bg-gray-100 text-gray-600 border-gray-300">
          <XCircle className="h-3 w-3" />キャンセル
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

export function OrdersClient({
  initialOrders,
  truncated = false,
  filters = {},
}: OrdersClientProps) {
  const [orders, setOrders] = useState(initialOrders);
  const [selectedOrder, setSelectedOrder] = useState<OrderDetail | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [isPdfLoading, startPdf] = useTransition();
  const [deleteTarget, setDeleteTarget] = useState<Order | null>(null);
  const [isDeleting, startDelete] = useTransition();
  const [isFiltering, startFiltering] = useTransition();
  const router = useRouter();
  const searchParams = useSearchParams();

  // 詳細ダイアログ用の合計計算
  const totalBoxes = selectedOrder
    ? selectedOrder.lines.reduce((sum, l) => sum + (l.boxes || 0), 0)
    : 0;
  const totalRemainder = selectedOrder
    ? selectedOrder.lines.reduce((sum, l) => sum + (l.remainder || 0), 0)
    : 0;
  const totalQty = selectedOrder
    ? selectedOrder.lines.reduce((sum, l) => sum + (l.total_qty || 0), 0)
    : 0;
  // コンテナ数 = 箱数 + 端数箱（バラがあれば +1）
  const containerCount = (l: { boxes?: number | null; remainder?: number | null }) =>
    (l.boxes || 0) + ((l.remainder || 0) > 0 ? 1 : 0);
  const totalContainers = selectedOrder
    ? selectedOrder.lines.reduce((sum, l) => sum + containerCount(l), 0)
    : 0;

  // サーバーサイドからのプロップ更新（リスト更新など）をステートに同期する
  useEffect(() => {
    setOrders(initialOrders);
  }, [initialOrders]);

  async function handleRowClick(orderId: string) {
    setLoadingId(orderId);
    const result = await getOrderDetail(orderId);
    setLoadingId(null);
    if (result.success) {
      setSelectedOrder(result.data);
      setIsDetailOpen(true);
    } else {
      toast.error("詳細の取得に失敗しました", { description: result.error });
    }
  }

  // SSRとクライアントの初期値を一致させるため false で初期化し、
  // hydration 後に localStorage から実際の値を読み込む
  const [reverseStoreOrder, setReverseStoreOrder] = useState(false);

  useEffect(() => {
    setReverseStoreOrder(localStorage.getItem("reverseStoreOrder") === "true");
  }, []);

  function toggleReverseStoreOrder() {
    setReverseStoreOrder((prev) => {
      const next = !prev;
      localStorage.setItem("reverseStoreOrder", String(next));
      return next;
    });
  }

  /**
   * 絞り込みは URL に載せてサーバーに再取得させる。
   * 絞り込みをサーバー側で行っているため、ここで state だけ変えても
   * 取得済みの 200 件の外は見えない。URL なので状態を共有・再訪もできる。
   */
  function pushFilters(next: OrderFilterValues) {
    const params = new URLSearchParams(searchParams.toString());
    for (const key of ["from", "to", "status"] as const) {
      const value = next[key];
      if (value) params.set(key, value);
      else params.delete(key);
    }
    startFiltering(() => {
      router.replace(params.size > 0 ? `?${params.toString()}` : "?", {
        scroll: false,
      });
    });
  }

  function updateFilter(key: keyof OrderFilterValues, value: string) {
    pushFilters({ ...filters, [key]: value });
  }

  function clearFilters() {
    pushFilters({});
  }

  /** 「直近N日」はローカル日付で組み立てる（toISOString は UTC 基準でずれる）。 */
  function applyRecentDays(days: number) {
    const toLocalDate = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate(),
      ).padStart(2, "0")}`;
    const today = new Date();
    const from = new Date();
    from.setDate(from.getDate() - (days - 1));
    pushFilters({ ...filters, from: toLocalDate(from), to: toLocalDate(today) });
  }

  function handleDownloadPdf(orderId: string, orderDate: string) {
    startPdf(async () => {
      try {
        await downloadOrderLabelPdf(orderId, orderDate, reverseStoreOrder);
        toast.success("PDFをダウンロードしました");
      } catch (err) {
        toast.error("PDF生成に失敗しました", {
          description: err instanceof Error ? err.message : String(err),
        });
      }
    });
  }

  function handleDeleteConfirm() {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    startDelete(async () => {
      const result = await deleteOrder(id);
      if (result.success) {
        setOrders((prev) => prev.filter((o) => o.id !== id));
        toast.success("受注を削除しました");
      } else {
        toast.error("削除に失敗しました", { description: result.error });
      }
      setDeleteTarget(null);
    });
  }

  const totalLines = orders.reduce((sum, o) => sum + o.line_count, 0);
  const hasFilters = Boolean(filters.from || filters.to || filters.status);

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      {/* ヘッダー（モバイルでは縦積み。以前は px-6 固定・横並びで見切れていた） */}
      <div className="border-b bg-background px-3 py-3 shrink-0 md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5 text-muted-foreground shrink-0" />
              <h1 className="text-base font-semibold">受注一覧</h1>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>{orders.length} 件</span>
              <span className="text-muted-foreground/40">·</span>
              <span>{totalLines} 明細</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ItemSheetDialog />
            <button
              type="button"
              onClick={toggleReverseStoreOrder}
              aria-pressed={reverseStoreOrder}
              className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border transition-colors ${
                reverseStoreOrder
                  ? "bg-blue-50 border-blue-300 text-blue-700"
                  : "bg-background border-border text-muted-foreground hover:text-foreground"
              }`}
              title="出荷ラベルPDFの店舗順を逆順にする"
            >
              <ArrowUpDown className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">店舗逆順</span>
              {reverseStoreOrder ? "：ON" : "：OFF"}
            </button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.refresh()}
              className="gap-1.5"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">更新</span>
            </Button>
          </div>
        </div>

        {/* 絞り込み。以前は検索も期間指定もなく、作成順の全件（最大200）を
            眺めるしかなかったため「先週の分」を探す手段がなかった。 */}
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="flex items-end gap-1.5">
            <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
              受注日（開始）
              <Input
                type="date"
                value={filters.from ?? ""}
                max={filters.to || undefined}
                onChange={(e) => updateFilter("from", e.target.value)}
                className="h-8 w-[9.5rem] text-xs"
              />
            </label>
            <span className="pb-2 text-xs text-muted-foreground">〜</span>
            <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
              終了
              <Input
                type="date"
                value={filters.to ?? ""}
                min={filters.from || undefined}
                onChange={(e) => updateFilter("to", e.target.value)}
                className="h-8 w-[9.5rem] text-xs"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
            ステータス
            <Select
              value={filters.status ?? ALL_STATUSES}
              onValueChange={(v) =>
                updateFilter("status", v === ALL_STATUSES ? "" : v)
              }
            >
              <SelectTrigger className="h-8 w-32 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_STATUSES} className="text-xs">すべて</SelectItem>
                <SelectItem value="confirmed" className="text-xs">確定</SelectItem>
                <SelectItem value="draft" className="text-xs">下書き</SelectItem>
                <SelectItem value="cancelled" className="text-xs">キャンセル</SelectItem>
              </SelectContent>
            </Select>
          </label>

          <div className="flex items-center gap-1.5">
            {[7, 30].map((days) => (
              <Button
                key={days}
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                disabled={isFiltering}
                onClick={() => applyRecentDays(days)}
              >
                直近{days}日
              </Button>
            ))}
            {hasFilters && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 gap-1 text-xs text-muted-foreground"
                disabled={isFiltering}
                onClick={clearFilters}
              >
                <X className="h-3.5 w-3.5" />解除
              </Button>
            )}
            {isFiltering && (
              <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            )}
          </div>
        </div>

        {/* 上限に達したことを明示する。以前は201件目以降が画面に何の表示もなく
            消えていた。 */}
        {truncated && (
          <p className="mt-2 rounded-md bg-amber-50 px-2.5 py-1.5 text-[11px] leading-snug text-amber-800">
            件数が多いため直近 {orders.length} 件のみ表示しています。
            受注日で絞り込むと残りも確認できます。
          </p>
        )}
      </div>

      {/* テーブル */}
      <div className="flex-1 overflow-auto">
        {orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <Package className="h-12 w-12 mb-3 opacity-30" />
            <p className="text-sm">受注データがありません</p>
          </div>
        ) : (
          // モバイルではテーブル自体を横スクロールさせる。ページ全体が
          // 横に伸びると縦スクロール中に画面がずれて操作しづらい。
          <Table className="min-w-[720px]">
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow>
                <TableHead className="w-32">受注日</TableHead>
                <TableHead className="w-24">ソース</TableHead>
                <TableHead className="w-24">ステータス</TableHead>
                <TableHead className="w-16 text-right">明細数</TableHead>
                <TableHead>メモ</TableHead>
                <TableHead className="w-36 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((order) => (
                <TableRow
                  key={order.id}
                  className="cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => handleRowClick(order.id)}
                >
                  <TableCell className="font-mono text-sm">
                    {order.order_date}
                  </TableCell>
                  <TableCell>
                    <SourceBadge source={order.source} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={order.status} />
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {loadingId === order.id ? (
                      <RefreshCw className="h-3 w-3 animate-spin ml-auto" />
                    ) : (
                      order.line_count
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                    {order.notes || "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDownloadPdf(order.id, order.order_date);
                        }}
                        disabled={isPdfLoading}
                      >
                        <FileDown className="h-3.5 w-3.5" />
                        PDF
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteTarget(order);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* 削除確認ダイアログ */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>受注を削除しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && (
                <>
                  <span className="font-medium">{deleteTarget.order_date}</span> の受注（
                  {deleteTarget.line_count} 明細）を削除します。この操作は取り消せません。
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? "削除中…" : "削除する"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 詳細ダイアログ */}
      <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <DialogContent className="max-w-[calc(100vw-2rem)] md:max-w-3xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <span>受注詳細</span>
              {selectedOrder && (
                <>
                  <span className="font-mono text-base">{selectedOrder.order_date}</span>
                  <SourceBadge source={selectedOrder.source} />
                  <StatusBadge status={selectedOrder.status} />
                </>
              )}
            </DialogTitle>
          </DialogHeader>

          {selectedOrder && (
            <div className="flex-1 overflow-auto mt-2">
              <Table className="min-w-[640px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>顧客名</TableHead>
                    <TableHead>商品</TableHead>
                    <TableHead>規格</TableHead>
                    <TableHead className="text-right">箱数</TableHead>
                    <TableHead className="text-right">バラ</TableHead>
                    <TableHead className="text-right">合計</TableHead>
                    <TableHead className="text-right">コンテナ数</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedOrder.lines.map((line) => (
                    <TableRow key={line.id}>
                      <TableCell className="font-medium">{line.customer_name}</TableCell>
                      <TableCell>{line.product_name}</TableCell>
                      <TableCell className="text-muted-foreground">{line.spec}</TableCell>
                      <TableCell className="text-right font-mono">{line.boxes || "—"}</TableCell>
                      <TableCell className="text-right font-mono">{line.remainder || "—"}</TableCell>
                      <TableCell className="text-right font-mono font-semibold">{line.total_qty}</TableCell>
                      <TableCell className="text-right font-mono">{containerCount(line) || "—"}</TableCell>
                    </TableRow>
                  ))}
                  {/* 合計行 */}
                  <TableRow className="bg-muted/50 font-semibold border-t-2 border-muted-foreground/20">
                    <TableCell colSpan={3} className="text-left font-medium">合計</TableCell>
                    <TableCell className="text-right font-mono">{totalBoxes || "—"}</TableCell>
                    <TableCell className="text-right font-mono">{totalRemainder || "—"}</TableCell>
                    <TableCell className="text-right font-mono">{totalQty}</TableCell>
                    <TableCell className="text-right font-mono text-foreground font-semibold">
                      {totalContainers || "—"}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>

              {selectedOrder.notes && (
                <p className="mt-4 px-1 text-sm text-muted-foreground">
                  <span className="font-semibold text-foreground">メモ: </span>
                  {selectedOrder.notes}
                </p>
              )}

              <div className="mt-4 flex justify-end">
                <Button
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => handleDownloadPdf(selectedOrder.id, selectedOrder.order_date)}
                  disabled={isPdfLoading}
                >
                  <FileDown className="h-4 w-4" />
                  出荷ラベル PDF
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
