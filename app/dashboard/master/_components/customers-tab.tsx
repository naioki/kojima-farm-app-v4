"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Pencil, Trash2, Loader2, Check, X } from "lucide-react";

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

interface CustomersTabProps {
  customers: Customer[];
}

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

export function CustomersTab({ customers: initial }: CustomersTabProps) {
  const [customers, setCustomers] = useState(initial);
  const [isPending, startTransition] = useTransition();
  const [editTarget, setEditTarget] = useState<Customer | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  function handleCreate(data: FormValues) {
    startTransition(async () => {
      const result = await createCustomer(data);
      if (result.success) {
        setCustomers((prev) => [...prev, result.data]);
        toast.success("顧客を登録しました");
        setCreateOpen(false);
      } else {
        toast.error("登録に失敗しました", { description: result.error });
      }
    });
  }

  function handleUpdate(data: FormValues) {
    if (!editTarget) return;
    startTransition(async () => {
      const result = await updateCustomer(editTarget.id, data);
      if (result.success) {
        setCustomers((prev) =>
          prev.map((c) => (c.id === editTarget.id ? result.data : c))
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
              <TableHead>顧客名</TableHead>
              <TableHead>店舗コード</TableHead>
              <TableHead>ステータス</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {customers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                  顧客データがありません
                </TableCell>
              </TableRow>
            ) : (
              customers.map((customer) => (
                <TableRow key={customer.id}>
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
