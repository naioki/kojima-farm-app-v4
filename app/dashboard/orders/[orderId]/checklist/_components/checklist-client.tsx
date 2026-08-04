"use client";

/**
 * 積み込み・荷降ろしチェックリスト（スマホ前提）。
 *
 * 紙の帳票は現行のまま使うので、こちらは画面でしかできないこと
 * ——「今どこまで進んだか」を共有する——に振っている。
 *
 * 荷降ろしは**今の店舗を1軒だけ大きく出す**。40店舗を一度に並べても
 * トラックの中では読めないため。全体の進捗と各店舗の箱数は上下に添える。
 *
 * 積み込みは品目ごとの合計を主軸にする。冷蔵庫から品目単位で出すので、
 * 店舗ごとに並べても数えにくい。積む順（逆配送順）は下に参考として出す。
 */

import { useMemo, useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Loader2,
  Package,
  RotateCcw,
  Truck,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  clearChecklist,
  setChecklistItem,
  type ChecklistMode,
  type OrderChecklist,
} from "@/app/actions/checklist-actions";
import {
  formatItemTotalBoxes,
  formatLineBoxes,
  loadRowKey,
  type StoreChecklistGroup,
} from "@/lib/checklist";
import { cn } from "@/lib/utils";

type CheckedState = Record<ChecklistMode, Set<string>>;

function ProgressBar({ done, total }: { done: number; total: number }) {
  const ratio = total > 0 ? Math.min(100, (done / total) * 100) : 0;
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-valuenow={done}
      aria-valuemin={0}
      aria-valuemax={total}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-300",
          done >= total && total > 0 ? "bg-green-600" : "bg-primary",
        )}
        style={{ width: `${ratio}%` }}
      />
    </div>
  );
}

/** チェック行。指で押しやすい高さと当たり判定を確保する。 */
function CheckRow({
  checked,
  title,
  detail,
  onToggle,
  disabled,
}: {
  checked: boolean;
  title: string;
  detail: string;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={checked}
      className={cn(
        "flex w-full items-center gap-3 border-b px-4 py-3.5 text-left transition-colors last:border-b-0",
        "min-h-[56px] active:bg-muted/60 disabled:opacity-60",
        checked ? "bg-green-50" : "bg-background",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border-2 transition-colors",
          checked
            ? "border-green-600 bg-green-600 text-white"
            : "border-input bg-background",
        )}
      >
        {checked && <Check className="h-4 w-4" strokeWidth={3} />}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block truncate text-[15px] font-medium",
            checked && "text-muted-foreground line-through",
          )}
        >
          {title}
        </span>
        <span className="block text-xs text-muted-foreground">{detail}</span>
      </span>
    </button>
  );
}

export function ChecklistClient({ initial }: { initial: OrderChecklist }) {
  const { checklist, orderDate, orderId } = initial;
  const [mode, setMode] = useState<ChecklistMode>("load");
  const [isPending, startTransition] = useTransition();
  const [resetOpen, setResetOpen] = useState(false);
  const [storeIndexOverride, setStoreIndexOverride] = useState<number | null>(null);

  const [checkedState, applyOptimistic] = useOptimistic<
    CheckedState,
    { mode: ChecklistMode; rowKey: string; checked: boolean }
  >(
    {
      load: new Set(initial.checked.load),
      unload: new Set(initial.checked.unload),
    },
    (state, action) => {
      const next: CheckedState = {
        load: new Set(state.load),
        unload: new Set(state.unload),
      };
      if (action.checked) next[action.mode].add(action.rowKey);
      else next[action.mode].delete(action.rowKey);
      return next;
    },
  );

  function toggle(rowKey: string, nextChecked: boolean) {
    startTransition(async () => {
      applyOptimistic({ mode, rowKey, checked: nextChecked });
      const result = await setChecklistItem(orderId, mode, rowKey, nextChecked);
      if (!result.success) {
        // 楽観更新は transition 終了時にサーバー状態へ戻る
        toast.error("チェックを保存できませんでした", {
          description: result.error,
        });
      }
    });
  }

  function handleReset() {
    startTransition(async () => {
      const result = await clearChecklist(orderId, mode);
      setResetOpen(false);
      if (result.success) {
        setStoreIndexOverride(null);
        toast.success(
          mode === "load" ? "積み込みのチェックを外しました" : "荷降ろしのチェックを外しました",
        );
      } else {
        toast.error("解除に失敗しました", { description: result.error });
      }
    });
  }

  // ── 積み込み: 品目ごとの合計 ──────────────────────────────────────────
  const loadRows = checklist.itemTotals;
  const loadDone = loadRows.filter((row) =>
    checkedState.load.has(loadRowKey(row.productName, row.spec)),
  ).length;
  const loadRemainingBoxes = loadRows
    .filter((row) => !checkedState.load.has(loadRowKey(row.productName, row.spec)))
    .reduce((sum, row) => sum + row.totalBoxes, 0);

  // ── 荷降ろし: 店舗ごと ───────────────────────────────────────────────
  const unloadGroups = checklist.unloadGroups;

  const storeStatus = useMemo(
    () =>
      unloadGroups.map((group) => {
        const doneItems = group.items.filter((item) =>
          checkedState.unload.has(item.lineId),
        ).length;
        return {
          group,
          doneItems,
          complete: group.items.length > 0 && doneItems === group.items.length,
        };
      }),
    [unloadGroups, checkedState.unload],
  );

  const doneStores = storeStatus.filter((s) => s.complete).length;
  const remainingBoxes = storeStatus
    .filter((s) => !s.complete)
    .reduce((sum, s) => sum + s.group.totalBoxes, 0);

  // 「今の店舗」は未完了の先頭。手で選んだらそちらを優先する。
  const autoIndex = storeStatus.findIndex((s) => !s.complete);
  const currentIndex =
    storeIndexOverride ?? (autoIndex >= 0 ? autoIndex : unloadGroups.length - 1);
  const current: StoreChecklistGroup | undefined = unloadGroups[currentIndex];
  const currentStatus = storeStatus[currentIndex];

  function goToNextStore() {
    const nextIncomplete = storeStatus.findIndex(
      (s, i) => i > currentIndex && !s.complete,
    );
    setStoreIndexOverride(nextIncomplete >= 0 ? nextIncomplete : null);
  }

  const allDone =
    mode === "load"
      ? loadRows.length > 0 && loadDone === loadRows.length
      : unloadGroups.length > 0 && doneStores === unloadGroups.length;

  return (
    <div className="mx-auto max-w-2xl pb-24">
      {/* ヘッダー */}
      <div className="sticky top-14 z-30 border-b bg-background/95 backdrop-blur">
        <div className="flex items-center gap-2 px-3 py-2">
          <Button asChild variant="ghost" size="sm" className="gap-1 px-2">
            <Link href="/dashboard/orders" aria-label="受注一覧へ戻る">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{orderDate} の出荷</p>
            <p className="text-[11px] text-muted-foreground">
              全 {checklist.totalStores} 軒 / {checklist.totalBoxes} 箱
            </p>
          </div>
          {isPending && (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
          )}
        </div>

        {/* モード切り替え */}
        <div className="grid grid-cols-2">
          {(
            [
              { key: "load" as const, label: "積み込み", icon: Package },
              { key: "unload" as const, label: "荷降ろし", icon: Truck },
            ]
          ).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setMode(key)}
              aria-pressed={mode === key}
              className={cn(
                "flex min-h-[44px] items-center justify-center gap-1.5 border-b-2 text-sm font-semibold transition-colors",
                mode === key
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 進捗 */}
      <div className="space-y-2 border-b px-4 py-3">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-sm font-medium">
            {mode === "load"
              ? `${loadDone} / ${loadRows.length} 品目`
              : `${doneStores} / ${unloadGroups.length} 軒`}
          </p>
          <p className="text-xs text-muted-foreground">
            残り {mode === "load" ? loadRemainingBoxes : remainingBoxes} 箱
          </p>
        </div>
        <ProgressBar
          done={mode === "load" ? loadDone : doneStores}
          total={mode === "load" ? loadRows.length : unloadGroups.length}
        />
        {allDone && (
          <p className="flex items-center gap-1.5 text-sm font-semibold text-green-700">
            <Check className="h-4 w-4" strokeWidth={3} />
            {mode === "load" ? "積み込み完了" : "全店舗の荷降ろし完了"}
          </p>
        )}
      </div>

      {/* ── 積み込み ─────────────────────────────────────────────────── */}
      {mode === "load" && (
        <>
          <div className="border-b">
            <p className="px-4 pt-3 pb-1 text-xs font-semibold text-muted-foreground">
              品目ごとの合計（数え漏れの確認）
            </p>
            {loadRows.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">明細がありません</p>
            ) : (
              loadRows.map((row) => {
                const key = loadRowKey(row.productName, row.spec);
                return (
                  <CheckRow
                    key={key}
                    checked={checkedState.load.has(key)}
                    title={row.label}
                    detail={`${formatItemTotalBoxes(row)} ・ ${row.storeNames.join("、")}`}
                    onToggle={() => toggle(key, !checkedState.load.has(key))}
                  />
                );
              })
            )}
          </div>

          {/* 積む順の参考。最初に降ろす店を最後に積む */}
          {checklist.loadGroups.length > 0 && (
            <div className="px-4 py-3">
              <p className="text-xs font-semibold text-muted-foreground">
                積む順（配送順の逆）
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                最初に降ろす店を最後に積むと、1軒目で掘り返さずに済みます
              </p>
              <ol className="mt-2 space-y-1">
                {checklist.loadGroups.map((group) => (
                  <li
                    key={group.customerName}
                    className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-2.5 py-1.5 text-xs"
                  >
                    <span className="min-w-0 truncate">
                      <span className="mr-1.5 font-mono text-muted-foreground">
                        {group.stopNumber}
                      </span>
                      {group.customerDisplay}
                    </span>
                    <span className="shrink-0 font-mono text-muted-foreground">
                      {group.totalBoxes}箱
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </>
      )}

      {/* ── 荷降ろし ─────────────────────────────────────────────────── */}
      {mode === "unload" && (
        <>
          {current && currentStatus ? (
            <div className="border-b bg-primary/5">
              <div className="px-4 pt-3">
                <p className="text-xs font-semibold text-primary">
                  {current.stopNumber} 軒目 / {unloadGroups.length} 軒
                </p>
                <h2 className="mt-0.5 text-xl font-bold leading-tight">
                  {current.customerDisplay}
                </h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  この店で {current.totalBoxes} 箱
                  {currentStatus.complete && " ・ 完了"}
                </p>
              </div>
              <div className="mt-3 border-t bg-background">
                {current.items.map((item) => (
                  <CheckRow
                    key={item.lineId}
                    checked={checkedState.unload.has(item.lineId)}
                    title={item.label}
                    detail={`${formatLineBoxes(item.breakdown)} ・ 計 ${item.totalQty}`}
                    onToggle={() =>
                      toggle(item.lineId, !checkedState.unload.has(item.lineId))
                    }
                  />
                ))}
              </div>
              <div className="px-4 py-3">
                <Button
                  type="button"
                  className="min-h-[48px] w-full gap-1.5 text-base"
                  variant={currentStatus.complete ? "default" : "outline"}
                  onClick={goToNextStore}
                  disabled={currentIndex >= unloadGroups.length - 1 && currentStatus.complete && doneStores === unloadGroups.length}
                >
                  次の店舗へ
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : (
            <p className="px-4 py-6 text-sm text-muted-foreground">明細がありません</p>
          )}

          {/* 全店舗の一覧。タップで移動できる */}
          {unloadGroups.length > 0 && (
            <div className="px-4 py-3">
              <p className="text-xs font-semibold text-muted-foreground">
                店舗一覧（タップで移動）
              </p>
              <ol className="mt-2 space-y-1">
                {storeStatus.map((status, index) => (
                  <li key={status.group.customerName}>
                    <button
                      type="button"
                      onClick={() => setStoreIndexOverride(index)}
                      aria-current={index === currentIndex ? "true" : undefined}
                      className={cn(
                        "flex min-h-[44px] w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors",
                        index === currentIndex
                          ? "bg-primary/10 ring-1 ring-primary/30"
                          : "bg-muted/40 active:bg-muted",
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span
                          aria-hidden
                          className={cn(
                            "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-mono",
                            status.complete
                              ? "bg-green-600 text-white"
                              : "bg-background text-muted-foreground ring-1 ring-input",
                          )}
                        >
                          {status.complete ? (
                            <Check className="h-3 w-3" strokeWidth={3} />
                          ) : (
                            status.group.stopNumber
                          )}
                        </span>
                        <span
                          className={cn(
                            "truncate",
                            status.complete && "text-muted-foreground",
                          )}
                        >
                          {status.group.customerDisplay}
                        </span>
                      </span>
                      <span className="shrink-0 font-mono text-muted-foreground">
                        {status.doneItems}/{status.group.items.length}・
                        {status.group.totalBoxes}箱
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </>
      )}

      {/* やり直し */}
      <div className="px-4 py-4">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full text-xs text-muted-foreground"
          onClick={() => setResetOpen(true)}
          disabled={isPending}
        >
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
          {mode === "load" ? "積み込み" : "荷降ろし"}のチェックを全部外す
        </Button>
        <p className="mt-2 text-center text-[11px] text-muted-foreground">
          チェックは共有されます（1週間で自動的に消えます）
        </p>
      </div>

      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>チェックを全部外しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              {mode === "load" ? "積み込み" : "荷降ろし"}のチェックがすべて外れます。
              もう一方のモードには影響しません。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending}
              onClick={(e) => {
                e.preventDefault();
                handleReset();
              }}
            >
              全部外す
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
