"use client";

import { useState, useTransition, useEffect } from "react";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Pencil, Trash2, Loader2, Tag } from "lucide-react";

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
  FormDescription,
} from "@/components/ui/form";

import {
  createProduct,
  updateProduct,
  deleteProduct,
  type Product,
} from "../_actions/master-actions";

const schema = z.object({
  name: z.string().min(1, "商品名を入力してください").max(100),
  alt_names_str: z.string(),
  is_active: z.boolean().default(true),
});

type FormValues = z.infer<typeof schema>;

interface ProductsTabProps {
  products: Product[];
}

function ProductForm({
  defaultValues,
  onSubmit,
  isPending,
}: {
  defaultValues?: Partial<FormValues>;
  onSubmit: (data: FormValues) => void;
  isPending: boolean;
}) {
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", alt_names_str: "", is_active: true, ...defaultValues },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>商品名 *</FormLabel>
              <FormControl>
                <Input placeholder="例: ネギ" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="alt_names_str"
          render={({ field }) => (
            <FormItem>
              <FormLabel>別名（OCR 読み取り用）</FormLabel>
              <FormControl>
                <Input placeholder="例: ねぎ, 葱（カンマ区切り）" {...field} />
              </FormControl>
              <FormDescription className="text-xs">
                OCR が認識する可能性のある表記をカンマ区切りで入力
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <DialogFooter>
          <Button type="submit" disabled={isPending}>
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            保存
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}

export function ProductsTab({ products: initial }: ProductsTabProps) {
  const [products, setProducts] = useState(initial);
  const [isPending, startTransition] = useTransition();

  // サーバーサイドからのプロップ更新をステートに同期する
  useEffect(() => {
    setProducts(initial);
  }, [initial]);
  const [editTarget, setEditTarget] = useState<Product | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  function formToInput(data: FormValues) {
    return {
      name: data.name,
      alt_names: data.alt_names_str
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      is_active: data.is_active,
    };
  }

  function handleCreate(data: FormValues) {
    startTransition(async () => {
      const result = await createProduct(formToInput(data));
      if (result.success) {
        setProducts((prev) => [...prev, result.data]);
        toast.success("商品を登録しました");
        setCreateOpen(false);
      } else {
        toast.error("登録に失敗しました", { description: result.error });
      }
    });
  }

  function handleUpdate(data: FormValues) {
    if (!editTarget) return;
    startTransition(async () => {
      const result = await updateProduct(editTarget.id, formToInput(data));
      if (result.success) {
        setProducts((prev) =>
          prev.map((p) => (p.id === editTarget.id ? result.data : p))
        );
        toast.success("商品を更新しました");
        setEditTarget(null);
      } else {
        toast.error("更新に失敗しました", { description: result.error });
      }
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deleteProduct(id);
      if (result.success) {
        setProducts((prev) => prev.filter((p) => p.id !== id));
        toast.success("商品を削除しました");
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
              商品を追加
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>商品の追加</DialogTitle>
            </DialogHeader>
            <ProductForm onSubmit={handleCreate} isPending={isPending} />
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>商品名</TableHead>
              <TableHead>別名（OCR 用）</TableHead>
              <TableHead>ステータス</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                  商品データがありません
                </TableCell>
              </TableRow>
            ) : (
              products.map((product) => (
                <TableRow key={product.id}>
                  <TableCell className="font-medium">{product.name}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {product.alt_names.length > 0 ? (
                        product.alt_names.map((alt) => (
                          <Badge key={alt} variant="outline" className="text-xs gap-1">
                            <Tag className="h-2.5 w-2.5" />
                            {alt}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={product.is_active ? "default" : "secondary"}>
                      {product.is_active ? "有効" : "無効"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Dialog
                        open={editTarget?.id === product.id}
                        onOpenChange={(open) => !open && setEditTarget(null)}
                      >
                        <DialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setEditTarget(product)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            <span className="sr-only">編集</span>
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>商品の編集</DialogTitle>
                          </DialogHeader>
                          <ProductForm
                            defaultValues={{
                              name: product.name,
                              alt_names_str: product.alt_names.join(", "),
                              is_active: product.is_active,
                            }}
                            onSubmit={handleUpdate}
                            isPending={isPending}
                          />
                        </DialogContent>
                      </Dialog>

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
                            <AlertDialogTitle>商品の削除</AlertDialogTitle>
                            <AlertDialogDescription>
                              「{product.name}」を削除します。この操作は取り消せません。
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>キャンセル</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              onClick={() => handleDelete(product.id)}
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
