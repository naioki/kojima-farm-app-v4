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
  reorderCustomers,
  type Customer,
} from "../_actions/master-actions";

const schema = z.object({
  name: z.string().min(1, "顧客名を入力してください").max(100),
  supplier_name: z.string().max(100).optional(),
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
    defaultValues: { name: "", supplier_name: "", store_code: "", is_active: true, ...defaultValues },
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
          name="supplier_name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>系列（中間業者名）</FormLabel>
              <FormControl>
                <Input placeholder="例: ヨーク" {...field} />
              </FormControl>
              <p className="text-xs text-muted-foreground">
                出荷表・ラベルの供給先が「ヨーク 東道野辺」のように表示されます。店舗指定が不要な業者（例: 寺崎）は顧客名と同じ値にすると系列名のみ表示されます。空欄なら顧客名のみ。
              </p>
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

  /**
   * 表示順を丸ごと保存する。
   *
   * 以前は入れ替えた2件だけを保存していたため、DB 側の sort_order が連番でない
   * 状態（migrations の DEFAULT 999 で同値の顧客が複数いる）だと、リロード後に
   * 並びが変わってしまっていた。出荷ラベル・出荷一覧表の順序はこの値で決まる。
   */
  function persistOrder(nextOrder: CustomerWithOrder[]) {
    const previous = customers;
    // 楽観更新（1..N を即座に反映）
    setCustomers((prev) => {
      const rank = new Map(nextOrder.map((c, i) => [c.id, i + 1]));
      return prev.map((c) => ({ ...c, sort_order: rank.get(c.id) ?? c.sort_order }));
    });

    startTransition(async () => {
      const result = await reorderCustomers(nextOrder.map((c) => c.id));
      if (!result.success) {
        toast.error("並び順の変更に失敗しました", { description: result.error });
        setCustomers(previous);
      }
    });
  }

  function handleMove(index: number, direction: "up" | "down") {
    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= sorted.length) return;

    const next = [...sorted];
    [next[index], next[newIndex]] = [next[newIndex], next[index]];
    persistOrder(next);
  }

  /**
   * 順番を直接指定して移動する。
   * 上下ボタンだけだと 30 番目を先頭に持ってくるのに 29 回の操作と往復が必要で、
   * 店舗数が増えるほど実用に耐えなくなるため、1手で動かせる経路を用意する。
   */
  function handleMoveTo(index: number, targetPosition: number) {
    const clamped = Math.min(Math.max(targetPosition, 1), sorted.length);
    if (clamped - 1 === index) return;

    const next = [...sorted];
    const [moved] = next.splice(index, 1);
    next.splice(clamped - 1, 0, moved);
    persistOrder(next);
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
              <TableHead className="w-36 text-center">配送順</TableHead>
              <TableHead>顧客名</TableHead>
              <TableHead>系列</TableHead>
              <TableHead>店舗コード</TableHead>
              <TableHead>ステータス</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
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
                        aria-label={`${customer.name} を1つ上へ`}
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </Button>
                      {/* 順番を直接入力して1手で移動できる（上下ボタンだけだと
                          遠い位置への移動が操作回数分の往復になる） */}
                      <Input
                        type="number"
                        min={1}
                        max={sorted.length}
                        defaultValue={index + 1}
                        key={`${customer.id}-${index}`}
                        disabled={isPending}
                        aria-label={`${customer.name} の配送順（1〜${sorted.length}）`}
                        title="番号を入力して Enter で移動"
                        className="h-6 w-11 px-1 text-center text-sm tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                        onKeyDown={(e) => {
                          if (e.key !== "Enter") return;
                          e.preventDefault();
                          const value = Number((e.target as HTMLInputElement).value);
                          if (Number.isFinite(value)) handleMoveTo(index, value);
                        }}
                        onBlur={(e) => {
                          const value = Number(e.target.value);
                          if (!Number.isFinite(value) || value === index + 1) {
                            e.target.value = String(index + 1);
                            return;
                          }
                          handleMoveTo(index, value);
                        }}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        disabled={index === sorted.length - 1 || isPending}
                        onClick={() => handleMove(index, "down")}
                        aria-label={`${customer.name} を1つ下へ`}
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell className="font-medium">{customer.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {customer.supplier_name ?? "—"}
                  </TableCell>
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
                              supplier_name: customer.supplier_name ?? "",
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
