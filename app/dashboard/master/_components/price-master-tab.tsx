"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Trash2, Loader2, CalendarX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  createPriceMaster,
  closePriceMaster,
  deletePriceMaster,
  type PriceMaster,
} from "../_actions/master-actions";

const schema = z.object({
  customer_id: z.string().uuid("顧客IDの形式が正しくありません"),
  product_standard_id: z.string().uuid("規格IDの形式が正しくありません"),
  unit_price: z
    .number({ invalid_type_error: "単価は数値で入力してください" })
    .min(0, "単価は0以上を入力してください"),
  valid_from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "日付はYYYY-MM-DD形式"),
  valid_to: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

interface PriceMasterTabProps {
  priceMaster: PriceMaster[];
}

function PriceMasterForm({
  onSubmit,
  isPending,
}: {
  onSubmit: (data: FormValues) => void;
  isPending: boolean;
}) {
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
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="customer_id"
            render={({ field }) => (
              <FormItem>
                <FormLabel>顧客 ID *</FormLabel>
                <FormControl>
                  <Input placeholder="UUID" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="product_standard_id"
            render={({ field }) => (
              <FormItem>
                <FormLabel>規格 ID *</FormLabel>
                <FormControl>
                  <Input placeholder="UUID" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

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
                  <Input type="date" {...field} />
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

export function PriceMasterTab({ priceMaster: initial }: PriceMasterTabProps) {
  const [prices, setPrices] = useState(initial);
  const [isPending, startTransition] = useTransition();
  const [createOpen, setCreateOpen] = useState(false);
  const [closeTarget, setCloseTarget] = useState<PriceMaster | null>(null);
  const [closeDate, setCloseDate] = useState("");

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
            <PriceMasterForm onSubmit={handleCreate} isPending={isPending} />
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
              <TableHead>顧客 ID</TableHead>
              <TableHead>規格 ID</TableHead>
              <TableHead className="text-right">単価（円）</TableHead>
              <TableHead>有効開始日</TableHead>
              <TableHead>有効終了日</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {prices.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  価格データがありません
                </TableCell>
              </TableRow>
            ) : (
              prices.map((price) => (
                <TableRow key={price.id}>
                  <TableCell className="font-mono text-xs">
                    {price.customer_id.slice(0, 8)}...
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {price.product_standard_id.slice(0, 8)}...
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    ¥{price.unit_price.toLocaleString("ja-JP")}
                  </TableCell>
                  <TableCell>{price.valid_from}</TableCell>
                  <TableCell>{price.valid_to ?? "—"}</TableCell>
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
                            この価格設定を削除します。この操作は取り消せません。
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
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
