"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
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
  CheckCircle, Clock, XCircle, Trash2, ArrowUpDown,
} from "lucide-react";
import type { Order, OrderDetail } from "@/app/actions/order-actions";
import { getOrderDetail, deleteOrder } from "@/app/actions/order-actions";
import { fetchPdfBlob } from "@/lib/api-client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

interface OrdersClientProps {
  initialOrders: Order[];
}

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

export function OrdersClient({ initialOrders }: OrdersClientProps) {
  const [orders, setOrders] = useState(initialOrders);
  const [selectedOrder, setSelectedOrder] = useState<OrderDetail | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [isPdfLoading, startPdf] = useTransition();
  const [deleteTarget, setDeleteTarget] = useState<Order | null>(null);
  const [isDeleting, startDelete] = useTransition();
  const router = useRouter();

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

  function handleDownloadPdf(orderId: string, orderDate: string) {
    startPdf(async () => {
      try {
        const blob = await fetchPdfBlob(orderId, reverseStoreOrder);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `出荷ラベル_${orderDate.replace(/-/g, "")}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success("PDFをダウンロードしました");
      } catch (err) {
        toast.error("PDF生成に失敗しました", { description: String(err) });
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

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      {/* ヘッダー */}
      <div className="border-b bg-background px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Package className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-base font-semibold">受注一覧</h1>
          </div>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span>{orders.length} 件</span>
            <span className="text-muted-foreground/40">·</span>
            <span>{totalLines} 明細</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleReverseStoreOrder}
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border transition-colors ${
              reverseStoreOrder
                ? "bg-blue-50 border-blue-300 text-blue-700"
                : "bg-background border-border text-muted-foreground hover:text-foreground"
            }`}
            title="PDF店舗順を逆順にする"
          >
            <ArrowUpDown className="h-3.5 w-3.5" />
            店舗逆順{reverseStoreOrder ? "：ON" : "：OFF"}
          </button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.refresh()}
            className="gap-1.5"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            更新
          </Button>
        </div>
      </div>

      {/* テーブル */}
      <div className="flex-1 overflow-auto">
        {orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <Package className="h-12 w-12 mb-3 opacity-30" />
            <p className="text-sm">受注データがありません</p>
          </div>
        ) : (
          <Table>
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
        <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
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
              <Table>
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
