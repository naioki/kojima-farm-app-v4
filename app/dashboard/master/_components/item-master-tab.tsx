"use client";

import { useState, useTransition, useEffect } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Save, RotateCcw, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  saveItemMasterRow,
  deleteItemMasterRow,
  type ItemMasterRow,
} from "../_actions/master-actions";

const UNIT_TYPES = ["袋", "本", "箱", "束", "kg", "個"] as const;
const RECEIPT_MODE_LABELS: Record<string, string> = {
  total_count: "総数",
  box_count: "箱数",
};

type LocalRow = ItemMasterRow & {
  _localId: string;
  _isNew: boolean;
  _isDirty: boolean;
  _toDelete: boolean;
};

let _counter = 0;
function newLocalId() {
  return `new_${++_counter}`;
}

function toLocal(row: ItemMasterRow): LocalRow {
  return { ...row, _localId: row.standard_id, _isNew: false, _isDirty: false, _toDelete: false };
}

function emptyRow(): LocalRow {
  return {
    standard_id: "",
    product_id: "",
    item_name: "",
    spec_name: "",
    alt_names_str: "",
    unit_size: 1,
    unit_type: "袋",
    receipt_mode: "total_count",
    _localId: newLocalId(),
    _isNew: true,
    _isDirty: true,
    _toDelete: false,
  };
}

interface Props {
  initialRows: ItemMasterRow[];
}

export function ItemMasterTab({ initialRows }: Props) {
  const [rows, setRows] = useState<LocalRow[]>(initialRows.map(toLocal));
  const [isPending, startTransition] = useTransition();

  // サーバーサイドからのプロップ更新をステートに同期する
  useEffect(() => {
    setRows(initialRows.map(toLocal));
  }, [initialRows]);

  function update(localId: string, patch: Partial<LocalRow>) {
    setRows((prev) =>
      prev.map((r) =>
        r._localId === localId ? { ...r, ...patch, _isDirty: true } : r
      )
    );
  }

  function addRow() {
    setRows((prev) => [...prev, emptyRow()]);
  }

  function markDelete(localId: string) {
    setRows((prev) =>
      prev.map((r) =>
        r._localId === localId ? { ...r, _toDelete: true } : r
      )
    );
  }

  function handleSave() {
    startTransition(async () => {
      const toDelete = rows.filter((r) => r._toDelete && !r._isNew);
      const toSave = rows.filter((r) => !r._toDelete && r._isDirty);

      let errorCount = 0;

      for (const r of toDelete) {
        const res = await deleteItemMasterRow(r.standard_id);
        if (!res.success) {
          toast.error(`削除失敗: ${r.item_name} ${r.spec_name}`, { description: res.error });
          errorCount++;
        }
      }

      const savedRows: LocalRow[] = [];
      for (const r of toSave) {
        if (!r.item_name.trim() || !r.spec_name.trim()) continue;
        const res = await saveItemMasterRow({
          standard_id: r._isNew ? null : r.standard_id,
          product_id: r._isNew ? null : r.product_id,
          item_name: r.item_name,
          spec_name: r.spec_name,
          alt_names_str: r.alt_names_str,
          unit_size: r.unit_size,
          unit_type: r.unit_type,
          receipt_mode: r.receipt_mode,
        });
        if (res.success) {
          savedRows.push(toLocal(res.data));
        } else {
          toast.error(`保存失敗: ${r.item_name} ${r.spec_name}`, { description: res.error });
          errorCount++;
        }
      }

      // ローカル state を再構成
      const savedIds = new Set(toSave.map((r) => r._localId));
      const deletedIds = new Set(toDelete.map((r) => r._localId));
      const kept = rows.filter(
        (r) => !deletedIds.has(r._localId) && !savedIds.has(r._localId)
      );
      setRows([...kept, ...savedRows]);

      if (errorCount === 0) {
        toast.success("マスターデータを保存しました");
      }
    });
  }

  function handleRevert() {
    setRows(initialRows.map(toLocal));
  }

  const visibleRows = rows.filter((r) => !r._toDelete);
  const hasPendingChanges = rows.some((r) => r._isDirty || r._toDelete);

  return (
    <div className="space-y-4">
      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead className="min-w-[110px]">品目</TableHead>
              <TableHead className="min-w-[110px]">規格</TableHead>
              <TableHead className="min-w-[160px]">別表記（カンマ区切り）</TableHead>
              <TableHead className="w-20 text-right">入数</TableHead>
              <TableHead className="w-24">単位</TableHead>
              <TableHead className="w-28">受信方法</TableHead>
              <TableHead className="w-12">削除</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  品目データがありません。「行を追加」から登録してください。
                </TableCell>
              </TableRow>
            ) : (
              visibleRows.map((row) => (
                <TableRow
                  key={row._localId}
                  className={row._isDirty ? "bg-amber-50/60" : undefined}
                >
                  <TableCell className="py-1.5">
                    <Input
                      value={row.item_name}
                      onChange={(e) => update(row._localId, { item_name: e.target.value })}
                      placeholder="胡瓜"
                      className="h-8 text-xs"
                    />
                  </TableCell>
                  <TableCell className="py-1.5">
                    <Input
                      value={row.spec_name}
                      onChange={(e) => update(row._localId, { spec_name: e.target.value })}
                      placeholder="3本"
                      className="h-8 text-xs"
                    />
                  </TableCell>
                  <TableCell className="py-1.5">
                    <Input
                      value={row.alt_names_str}
                      onChange={(e) => update(row._localId, { alt_names_str: e.target.value })}
                      placeholder="きゅうり, キュウリ"
                      className="h-8 text-xs"
                    />
                  </TableCell>
                  <TableCell className="py-1.5">
                    <Input
                      type="number"
                      min={1}
                      value={row.unit_size}
                      onChange={(e) =>
                        update(row._localId, { unit_size: parseInt(e.target.value) || 1 })
                      }
                      className="h-8 text-xs text-right w-16"
                    />
                  </TableCell>
                  <TableCell className="py-1.5">
                    <Select
                      value={row.unit_type}
                      onValueChange={(v) => update(row._localId, { unit_type: v })}
                    >
                      <SelectTrigger className="h-8 text-xs w-20">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {UNIT_TYPES.map((u) => (
                          <SelectItem key={u} value={u}>{u}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="py-1.5">
                    <Select
                      value={row.receipt_mode}
                      onValueChange={(v) => update(row._localId, { receipt_mode: v })}
                    >
                      <SelectTrigger className="h-8 text-xs w-24">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="total_count">総数</SelectItem>
                        <SelectItem value="box_count">箱数</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="py-1.5 text-center">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => markDelete(row._localId)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* 行を追加 */}
      <Button variant="outline" size="sm" onClick={addRow} disabled={isPending}>
        <Plus className="h-4 w-4" />
        行を追加
      </Button>

      {/* 保存・戻す */}
      <div className="flex justify-between items-center pt-2 border-t">
        <Button
          variant="outline"
          size="sm"
          onClick={handleRevert}
          disabled={isPending || !hasPendingChanges}
        >
          <RotateCcw className="h-4 w-4" />
          最新データに戻す
        </Button>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={isPending || !hasPendingChanges}
          className="bg-green-600 hover:bg-green-700 text-white"
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {isPending ? "保存中..." : "マスターデータを保存"}
        </Button>
      </div>
    </div>
  );
}
