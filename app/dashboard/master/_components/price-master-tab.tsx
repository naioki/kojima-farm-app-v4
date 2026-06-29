// @ts-nocheck — 旧スキーマとの互換性維持のため型チェック除外
"use client";

import { useState, useTransition, useEffect } from "react";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Trash2, Loader2, CalendarX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  createPriceMaster,
  closePriceMaster,
  deletePriceMaster,
  type PriceMaster,
  type Customer,
  type ProductStandard,
  type Product,
} from "../_actions/master-actions";

const schema = z.object({
  customer_id: z.string().uuid("顧客を選択してください"),
  product_standard_id: z.string().uuid("規格を選択してください"),
  unit_price: z
    .number({ invalid_type_error: "単価は数値で入力してください" })
    .min(0, "単価は0以上を入力してください"),
  valid_from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "日付はYYYY-MM-DD形式で入力してください"),
  valid_to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "日付はYYYY-MM-DD形式で入力してください")
    .nullable()
    .optional(),
});

type FormValues = z.infer<typeof schema>;

interface PriceMasterTabProps {
  priceMaster: PriceMaster[];
  customers: Customer[];
  standards: ProductStandard[];
  products: Product[];
}

function PriceMasterForm({
  customers,
  standards,
  products,
  onSubmit,
  isPending,
}: {
  customers: Customer[];
  standards: ProductStandard[];
  products: Product[];
  onSubmit: (data: FormValues) => void;
  isPending: boolean;
}) {
  const productMap = Object.fromEntries(products.map((p) => [p.id, p.name]));

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      customer_id: "",
      product_standard_id: "",
      unit_price: 0,
      valid_from: new Date().toISOString().split("T")[0],
      valid_to: "",
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="customer_id"
          render={({ field }) => (
            <FormItem>
              <FormLabel>顧客 *</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="顧客を選択" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {customers
                    .filter((c) => c.is_active)
                    .map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="product_standard_id"
          render={({ field }) => (
            <FormItem>
              <FormLabel>商品規格 *</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="規格を選択" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {standards
                    .filter((s) => s.is_active)
                    .map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {productMap[s.product_id] ?? "?"} — {s.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="unit_price"
          render={({ field }) => (
            <FormItem>
              <FormLabel>単価（円）*</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  {...field}
                  onChange={(e) => field.onChange(e.target.valueAsNumber)}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="valid_from"
            render={({ field }) => (
              <FormItem>
                <FormLabel>有効開始日 *</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="valid_to"
            render={({ field }) => (
              <FormItem>
                <FormLabel>有効終了日</FormLabel>
                <FormControl>
                  <Input type="date" {...field} value={field.value ?? ""} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <DialogFooter>
          <Button type="submit" disabled={isPending}>
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            登録
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}

export function PriceMasterTab({
  priceMaster: initial,
  customers,
  standards,
  products,
}: PriceMasterTabProps) {
  const [prices, setPrices] = useState(initial);
  const [isPending, startTransition] = useTransition();

  // サーバーサイドからのプロップ更新をステートに同期する
  useEffect(() => {
    setPrices(initial);
  }, [initial]);
  const [createOpen, setCreateOpen] = useState(false);
  const [closeTarget, setCloseTarget] = useState<PriceMaster | null>(null);
  const [closeDate, setCloseDate] = useState("");

  // 名前検索用マップ
  const customerMap = Object.fromEntries(customers.map((c) => [c.id, c.name]));
  const productMap = Object.fromEntries(products.map((p) => [p.id, p.name]));
  const standardMap = Object.fromEntries(
    standards.map((s) => [
      s.id,
      `${productMap[s.product_id] ?? "?"} — ${s.name}`,
    ])
  );

  function handleCreate(data: FormValues) {
    startTransition(async () => {
      const result = await createPriceMaster({
        ...data,
        valid_to: data.valid_to || null,
      });
      if (result.success) {
        setPrices((prev) => [result.data, ...prev]);
        toast.success("価格を登録しました");
        setCreateOpen(false);
      } else {
        toast.error("登録に失敗しました", { description: result.error });
      }
    });
  }

  function handleClose() {
    if (!closeTarget || !closeDate) return;
    const id = closeTarget.id;
    startTransition(async () => {
      const result = await closePriceMaster(id, closeDate);
      if (result.success) {
        setPrices((prev) =>
          prev.map((p) => (p.id === id ? result.data : p))
        );
        toast.success("終了日を設定しました");
        setCloseTarget(null);
        setCloseDate("");
      } else {
        toast.error("設定に失敗しました", { description: result.error });
      }
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deletePriceMaster(id);
      if (result.success) {
        setPrices((prev) => prev.filter((p) => p.id !== id));
        toast.success("価格を削除しました");
      } else {
        toast.error("削除に失敗しました", { description: result.error });
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4" />
              価格を追加
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>価格の追加</DialogTitle>
            </DialogHeader>
            <PriceMasterForm
              customers={customers}
              standards={standards}
              products={products}
              onSubmit={handleCreate}
              isPending={isPending}
            />
          </DialogContent>
        </Dialog>
      </div>

      {/* 終了日設定ダイアログ */}
      <Dialog
        open={!!closeTarget}
        onOpenChange={(open) => {
          if (!open) { setCloseTarget(null); setCloseDate(""); }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>有効終了日の設定</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {closeTarget && (
              <p className="text-sm font-medium">
                {customerMap[closeTarget.customer_id] ?? "?"} ×{" "}
                {standardMap[closeTarget.product_standard_id] ?? "?"}
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              終了日以降、この価格は無効になります。
            </p>
            <Input
              type="date"
              value={closeDate}
              onChange={(e) => setCloseDate(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setCloseTarget(null); setCloseDate(""); }}
            >
              キャンセル
            </Button>
            <Button onClick={handleClose} disabled={isPending || !closeDate}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              設定
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>顧客</TableHead>
              <TableHead>商品規格</TableHead>
              <TableHead className="text-right">単価（円）</TableHead>
              <TableHead>有効開始日</TableHead>
              <TableHead>有効終了日</TableHead>
              <TableHead>状態</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {prices.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  価格データがありません
                </TableCell>
              </TableRow>
            ) : (
              prices.map((price) => {
                const isActive = !price.valid_to || price.valid_to >= new Date().toISOString().split("T")[0];
                return (
                  <TableRow key={price.id}>
                    <TableCell className="font-medium">
                      {customerMap[price.customer_id] ?? (
                        <span className="font-mono text-xs text-muted-foreground">
                          {price.customer_id.slice(0, 8)}…
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {standardMap[price.product_standard_id] ?? (
                        <span className="font-mono text-xs text-muted-foreground">
                          {price.product_standard_id.slice(0, 8)}…
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      ¥{price.unit_price.toLocaleString("ja-JP")}
                    </TableCell>
                    <TableCell>{price.valid_from}</TableCell>
                    <TableCell>{price.valid_to ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={isActive ? "default" : "secondary"}>
                        {isActive ? "有効" : "終了"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {!price.valid_to && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title="終了日を設定"
                            onClick={() => { setCloseTarget(price); setCloseDate(""); }}
                          >
                            <CalendarX className="h-3.5 w-3.5" />
                            <span className="sr-only">終了日を設定</span>
                          </Button>
                        )}
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              <span className="sr-only">削除</span>
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>価格の削除</AlertDialogTitle>
                              <AlertDialogDescription>
                                「{customerMap[price.customer_id] ?? "?"} × {standardMap[price.product_standard_id] ?? "?"}」の価格設定を削除します。この操作は取り消せません。
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>キャンセル</AlertDialogCancel>
                              <AlertDialogAction
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                onClick={() => handleDelete(price.id)}
                              >
                                削除
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
