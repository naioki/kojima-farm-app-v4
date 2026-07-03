"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FileText, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { fetchShippingSheetPdfBlob } from "@/lib/api-client";
import {
  getProducts,
  type Product,
} from "@/app/dashboard/master/_actions/master-actions";

const ALL_PRODUCTS = "__all__";

/**
 * 品目別出荷票ダイアログ。
 * 「トマトだけの出荷票が欲しい」等の突発要望向け（週2回程度の低頻度）。
 * 品目リストは品目マスター（products）から動的取得 — ハードコード禁止。
 */
export function ItemSheetDialog() {
  const today = new Date().toISOString().split("T")[0];
  const [open, setOpen] = useState(false);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [productId, setProductId] = useState<string>(ALL_PRODUCTS);
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [isDownloading, setIsDownloading] = useState(false);

  // ダイアログを開いた時に品目マスターを遅延取得
  useEffect(() => {
    if (!open || products !== null) return;
    (async () => {
      const result = await getProducts();
      if (result.success) {
        setProducts(result.data.filter((p) => p.is_active));
      } else {
        toast.error("品目の取得に失敗しました", { description: result.error });
        setProducts([]);
      }
    })();
  }, [open, products]);

  async function handleGenerate() {
    if (!dateFrom || !dateTo) {
      toast.error("期間を指定してください");
      return;
    }
    if (dateTo < dateFrom) {
      toast.error("終了日は開始日以降にしてください");
      return;
    }
    setIsDownloading(true);
    try {
      const blob = await fetchShippingSheetPdfBlob({
        dateFrom,
        dateTo,
        productId: productId === ALL_PRODUCTS ? undefined : productId,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const productName =
        productId === ALL_PRODUCTS
          ? "全品目"
          : products?.find((p) => p.id === productId)?.name ?? "品目";
      a.download = `出荷票_${productName}_${dateFrom.replace(/-/g, "")}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("出荷票 PDF をダウンロードしました");
      setOpen(false);
    } catch (err) {
      if (err instanceof Error && err.message === "NO_DATA") {
        toast.info("期間内に該当する注文がありません", {
          description: "品目・期間を変えて再度お試しください。",
        });
      } else {
        toast.error("出荷票の作成に失敗しました", { description: String(err) });
      }
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <FileText className="h-3.5 w-3.5" />
          品目別出荷票
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>品目別出荷票の発行</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>品目</Label>
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_PRODUCTS}>すべての品目</SelectItem>
                {products === null ? (
                  <SelectItem value="__loading__" disabled>
                    読み込み中...
                  </SelectItem>
                ) : (
                  products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>開始日</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>終了日</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            期間内の注文を集計し、同じ店舗・品目・規格は合算して出荷一覧表1枚にまとめます（既定は当日）。
          </p>
        </div>

        <DialogFooter>
          <Button onClick={handleGenerate} disabled={isDownloading} className="w-full gap-1.5">
            {isDownloading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                作成中...
              </>
            ) : (
              <>
                <FileText className="h-4 w-4" />
                出荷票 PDF を作成
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
