// @ts-nocheck — 旧スキーマとの互換性維持のため型チェック除外
"use client";

import { useState, useTransition, useEffect } from "react";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Pencil, Trash2, Loader2 } from "lucide-react";

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
  createProductStandard,
  updateProductStandard,
  deleteProductStandard,
  type Product,
  type ProductStandard,
} from "../_actions/master-actions";

const UNIT_TYPES = ["袋", "本", "箱", "束", "kg", "個"] as const;
const RECEIPT_MODE_LABELS: Record<string, string> = {
  box_count: "箱数入力",
  total_count: "総数入力",
};

const schema = z.object({
  product_id: z.string().uuid("商品を選択してください"),
  name: z.string().min(1, "規格名を入力してください").max(100),
  unit_size: z
    .number({ invalid_type_error: "入数は数値で入力してください" })
    .int()
    .min(1, "入数は1以上を入力してください"),
  unit_type: z.enum(["袋", "本", "箱", "束", "kg", "個"], {
    errorMap: () => ({ message: "単位を選択してください" }),
  }),
  receipt_mode: z.enum(["box_count", "total_count"]).default("total_count"),
  is_active: z.boolean().default(true),
});

type FormValues = z.infer<typeof schema>;

interface ProductStandardsTabProps {
  standards: ProductStandard[];
  products: Product[];
}

function StandardForm({
  products,
  defaultValues,
  onSubmit,
  isPending,
  isEdit,
}: {
  products: Product[];
  defaultValues?: Partial<FormValues>;
  onSubmit: (data: FormValues) => void;
  isPending: boolean;
  isEdit?: boolean;
}) {
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      product_id: "",
      name: "",
      unit_size: 1,
      unit_type: "袋",
      receipt_mode: "total_count",
      is_active: true,
      ...defaultValues,
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="product_id"
          render={({ field }) => (
            <FormItem>
              <FormLabel>商品 *</FormLabel>
              <Select
                onValueChange={field.onChange}
                value={field.value}
                disabled={isEdit}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="商品を選択" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {products
                    .filter((p) => p.is_active)
                    .map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
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
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>規格名 *</FormLabel>
              <FormControl>
                <Input placeholder="例: 2L 20本" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="unit_size"
            render={({ field }) => (
              <FormItem>
                <FormLabel>入数 *</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={1}
                    step={1}
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
            name="unit_type"
            render={({ field }) => (
              <FormItem>
                <FormLabel>単位 *</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {UNIT_TYPES.map((u) => (
                      <SelectItem key={u} value={u}>
                        {u}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="receipt_mode"
          render={({ field }) => (
            <FormItem>
              <FormLabel>受注入力方式 *</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="total_count">総数入力</SelectItem>
                  <SelectItem value="box_count">箱数入力</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <DialogFooter>
          <Button type="submit" disabled={isPending}>
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEdit ? "更新" : "登録"}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}

export function ProductStandardsTab({
  standards: initial,
  products,
}: ProductStandardsTabProps) {
  const [standards, setStandards] = useState(initial);
  const [isPending, startTransition] = useTransition();

  // サーバーサイドからのプロップ更新をステートに同期する
  useEffect(() => {
    setStandards(initial);
  }, [initial]);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ProductStandard | null>(null);

  const productMap = Object.fromEntries(products.map((p) => [p.id, p.name]));

  function handleCreate(data: FormValues) {
    startTransition(async () => {
      const result = await createProductStandard(data);
      if (result.success) {
        setStandards((prev) => [...prev, result.data]);
        toast.success("規格を登録しました");
        setCreateOpen(false);
      } else {
        toast.error("登録に失敗しました", { description: result.error });
      }
    });
  }

  function handleUpdate(data: FormValues) {
    if (!editTarget) return;
    startTransition(async () => {
      const result = await updateProductStandard(editTarget.id, {
        name: data.name,
        unit_size: data.unit_size,
        unit_type: data.unit_type,
        receipt_mode: data.receipt_mode,
        is_active: data.is_active,
      });
      if (result.success) {
        setStandards((prev) =>
          prev.map((s) => (s.id === editTarget.id ? result.data : s))
        );
        toast.success("規格を更新しました");
        setEditTarget(null);
      } else {
        toast.error("更新に失敗しました", { description: result.error });
      }
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deleteProductStandard(id);
      if (result.success) {
        setStandards((prev) => prev.filter((s) => s.id !== id));
        toast.success("規格を削除しました");
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
              規格を追加
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>商品規格の追加</DialogTitle>
            </DialogHeader>
            <StandardForm
              products={products}
              onSubmit={handleCreate}
              isPending={isPending}
            />
          </DialogContent>
        </Dialog>
      </div>

      {/* 編集ダイアログ */}
      <Dialog
        open={!!editTarget}
        onOpenChange={(open) => !open && setEditTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>商品規格の編集</DialogTitle>
          </DialogHeader>
          {editTarget && (
            <StandardForm
              key={editTarget.id}
              products={products}
              defaultValues={{
                product_id: editTarget.product_id,
                name: editTarget.name,
                unit_size: editTarget.unit_size,
                unit_type: editTarget.unit_type as FormValues["unit_type"],
                receipt_mode: editTarget.receipt_mode as FormValues["receipt_mode"],
                is_active: editTarget.is_active,
              }}
              onSubmit={handleUpdate}
              isPending={isPending}
              isEdit
            />
          )}
        </DialogContent>
      </Dialog>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>商品名</TableHead>
              <TableHead>規格名</TableHead>
              <TableHead className="text-right">入数</TableHead>
              <TableHead>単位</TableHead>
              <TableHead>入力方式</TableHead>
              <TableHead>ステータス</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {standards.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-center text-muted-foreground py-8"
                >
                  規格データがありません
                </TableCell>
              </TableRow>
            ) : (
              standards.map((std) => (
                <TableRow key={std.id}>
                  <TableCell className="font-medium">
                    {productMap[std.product_id] ?? std.product_id.slice(0, 8)}
                  </TableCell>
                  <TableCell>{std.name}</TableCell>
                  <TableCell className="text-right">{std.unit_size}</TableCell>
                  <TableCell>{std.unit_type}</TableCell>
                  <TableCell>
                    {RECEIPT_MODE_LABELS[std.receipt_mode] ?? std.receipt_mode}
                  </TableCell>
                  <TableCell>
                    <Badge variant={std.is_active ? "default" : "secondary"}>
                      {std.is_active ? "有効" : "無効"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setEditTarget(std)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        <span className="sr-only">編集</span>
                      </Button>

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
                            <AlertDialogTitle>規格の削除</AlertDialogTitle>
                            <AlertDialogDescription>
                              「{std.name}」を削除します。受注または価格マスタに紐づいている場合は削除できません。
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>キャンセル</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              onClick={() => handleDelete(std.id)}
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
