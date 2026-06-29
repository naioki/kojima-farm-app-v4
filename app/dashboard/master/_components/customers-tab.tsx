// @ts-nocheck — 旧スキーマとの互換性維持のため型チェック除外
"use client";

import { useState, useTransition, useEffect } from "react";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Pencil, Trash2, Loader2, ChevronUp, ChevronDown } from "lucide-react";

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
  createCustomer,
  updateCustomer,
  deleteCustomer,
  type Customer,
} from "../_actions/master-actions";

const schema = z.object({
  name: z.string().min(1, "顧客名を入力してください").max(100),
  store_code: z.string().max(20).optional(),
  is_active: z.boolean().default(true),
});

type FormValues = z.infer<typeof schema>;

type CustomerWithOrder = Customer & { sort_order?: number | null };

function CustomerForm({
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
    defaultValues: { name: "", store_code: "", is_active: true, ...defaultValues },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>顧客名 *</FormLabel>
              <FormControl>
                <Input placeholder="例: 〇〇スーパー" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="store_code"
          render={({ field }) => (
            <FormItem>
              <FormLabel>店舗コード</FormLabel>
              <FormControl>
                <Input placeholder="例: S001" {...field} />
              </FormControl>
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

function sortCustomers(list: CustomerWithOrder[]): CustomerWithOrder[] {
  return [...list].sort((a, b) => {
    const aOrd = a.sort_order ?? 999;
    const bOrd = b.sort_order ?? 999;
    return aOrd !== bOrd ? aOrd - bOrd : a.name.localeCompare(b.name, "ja");
  });
}

export function CustomersTab({ customers: initial }: { customers: Customer[] }) {
  const [customers, setCustomers] = useState<CustomerWithOrder[]>(initial as CustomerWithOrder[]);
  const [isPending, startTransition] = useTransition();
  const [editTarget, setEditTarget] = useState<CustomerWithOrder | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    setCustomers(initial as CustomerWithOrder[]);
  }, [initial]);

  const sorted = sortCustomers(customers);

  function handleCreate(data: FormValues) {
    startTransition(async () => {
      const result = await createCustomer({ ...data, sort_order: 999 });
      if (result.success) {
        setCustomers((prev) => [...prev, result.data as CustomerWithOrder]);
        toast.success("顧客を登録しました（↑↓ボタンで配送順を調整できます）");
        setCreateOpen(false);
      } else {
        toast.error("登録に失敗しました", { description: result.error });
      }
    });
  }

  function handleUpdate(data: FormValues) {
    if (!editTarget) return;
    startTransition(async () => {
      const result = await updateCustomer(editTarget.id, {
        ...data,
        sort_order: editTarget.sort_order ?? 999,
      });
      if (result.success) {
        setCustomers((prev) =>
          prev.map((c) => (c.id === editTarget.id ? (result.data as CustomerWithOrder) : c))
        );
        toast.success("顧客を更新しました");
        setEditTarget(null);
      } else {
        toast.error("更新に失敗しました", { description: result.error });
      }
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deleteCustomer(id);
      if (result.success) {
        setCustomers((prev) => prev.filter((c) => c.id !== id));
        toast.success("顧客を削除しました");
      } else {
        toast.error("削除に失敗しました", { description: result.error });
      }
    });
  }

  function handleMove(index: number, direction: "up" | "down") {
    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= sorted.length) return;

    // Normalize all sort_orders to 1, 2, 3… then swap the two positions
    const normalized = sorted.map((c, i) => ({ ...c, sort_order: i + 1 }));
    const tmp = normalized[index].sort_order;
    normalized[index] = { ...normalized[index], sort_order: normalized[newIndex].sort_order };
    normalized[newIndex] = { ...normalized[newIndex], sort_order: tmp };

    const a = normalized[index];
    const b = normalized[newIndex];

    // Optimistic local update
    setCustomers((prev) =>
      prev.map((c) => {
        const n = normalized.find((x) => x.id === c.id);
        return n ? { ...c, sort_order: n.sort_order } : c;
      })
    );

    startTransition(async () => {
      const [ra, rb] = await Promise.all([
        updateCustomer(a.id, { sort_order: a.sort_order }),
        updateCustomer(b.id, { sort_order: b.sort_order }),
      ]);
      if (!ra.success || !rb.success) {
        toast.error("並び順の変更に失敗しました");
        setCustomers(initial as CustomerWithOrder[]);
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
              顧客を追加
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>顧客の追加</DialogTitle>
            </DialogHeader>
            <CustomerForm onSubmit={handleCreate} isPending={isPending} />
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28 text-center">配送順</TableHead>
              <TableHead>顧客名</TableHead>
              <TableHead>店舗コード</TableHead>
              <TableHead>ステータス</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  顧客データがありません
                </TableCell>
              </TableRow>
            ) : (
              sorted.map((customer, index) => (
                <TableRow key={customer.id}>
                  <TableCell className="text-center">
                    <div className="flex items-center justify-center gap-0.5">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        disabled={index === 0 || isPending}
                        onClick={() => handleMove(index, "up")}
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                        <span className="sr-only">上へ</span>
                      </Button>
                      <span className="text-sm text-muted-foreground w-5 text-center select-none">
                        {index + 1}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        disabled={index === sorted.length - 1 || isPending}
                        onClick={() => handleMove(index, "down")}
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                        <span className="sr-only">下へ</span>
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell className="font-medium">{customer.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {customer.store_code ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={customer.is_active ? "default" : "secondary"}>
                      {customer.is_active ? "有効" : "無効"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Dialog
                        open={editTarget?.id === customer.id}
                        onOpenChange={(open) => !open && setEditTarget(null)}
                      >
                        <DialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setEditTarget(customer)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            <span className="sr-only">編集</span>
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>顧客の編集</DialogTitle>
                          </DialogHeader>
                          <CustomerForm
                            defaultValues={{
                              name: customer.name,
                              store_code: customer.store_code ?? "",
                              is_active: customer.is_active,
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
                            <AlertDialogTitle>顧客の削除</AlertDialogTitle>
                            <AlertDialogDescription>
                              「{customer.name}」を削除します。この操作は取り消せません。
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>キャンセル</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              onClick={() => handleDelete(customer.id)}
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
