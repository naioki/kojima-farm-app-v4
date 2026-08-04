"use client";

/**
 * 積み込み・荷降ろしチェックリスト（スマホ前提）。
 *
 * 紙の帳票は現行のまま使うので、こちらは画面でしかできないこと
 * ——「今どこまで進んだか」を共有する——に振っている。
 *
 * 積み込み・荷降ろしは同じ「今の店舗を1軒だけ大きく出す」形式に統一している。
 * 40店舗を一度に並べても現場では読めないため。全体の進捗（対象・完了・残り）
 * を大きく見せ、各店舗の箱数は一覧に添える。
 *
 * 積む順と降ろす順は逆（実際の運用に合わせている。lib/checklist.ts 参照）:
 *   積み込み: 配送順どおり（習志野台から積む） → checklist.loadGroups
 *   荷降ろし: 積んだ順の逆（習志野台を最後に降ろす） → checklist.unloadGroups
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
  type StoreChecklistGroup,
} from "@/lib/checklist";
import { cn } from "@/lib/utils";

type CheckedState = Record<ChecklistMode, Set<string>>;

/** 対象・完了・残りを大きな数字で見せる。「残りが見づらい」というフィードバックへの対応。 */
function StoreStats({ total, done }: { total: number; done: number }) {
  const remaining = total - done;
  return (
    <div className="grid grid-cols-3 gap-2 px-4 py-3">
      <div className="rounded-lg bg-muted/60 px-2 py-2 text-center">
        <p className="text-2xl font-bold tabular-nums leading-none">{total}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">対象店舗</p>
      </div>
      <div className="rounded-lg bg-green-50 px-2 py-2 text-center">
        <p className="text-2xl font-bold tabular-nums leading-none text-green-700">
          {done}
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">完了</p>
      </div>
      <div
        className={cn(
          "rounded-lg px-2 py-2 text-center",
          remaining > 0 ? "bg-amber-50" : "bg-green-50",
        )}
      >
        <p
          className={cn(
            "text-2xl font-bold tabular-nums leading-none",
            remaining > 0 ? "text-amber-700" : "text-green-700",
          )}
        >
          {remaining}
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">残り店舗</p>
      </div>
    </div>
  );
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const ratio = total > 0 ? Math.min(100, (done / total) * 100) : 0;
  return (
    <div
      className="mx-4 h-2 overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-valuenow={done}
      aria-valuemin={0}
      aria-valuemax={Math.max(total, 1)}
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
  // モードごとに個別に「今の店舗」の手動選択を持つ（積み込み中に選んだ位置が
  // 荷降ろしタブに漏れ出さないようにするため）。
  const [indexOverride, setIndexOverride] = useState<Record<ChecklistMode, number | null>>({
    load: null,
    unload: null,
  });

  // サーバーから来たチェック状態。毎レンダーで Set を作り直さないよう固定する。
  const serverChecked = useMemo<CheckedState>(
    () => ({
      load: new Set(initial.checked.load),
      unload: new Set(initial.checked.unload),
    }),
    [initial.checked],
  );

  const [checkedState, applyOptimistic] = useOptimistic<
    CheckedState,
    { mode: ChecklistMode; rowKey: string; checked: boolean }
  >(
    serverChecked,
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
        setIndexOverride((prev) => ({ ...prev, [mode]: null }));
        toast.success(
          mode === "load" ? "積み込みのチェックを外しました" : "荷降ろしのチェックを外しました",
        );
      } else {
        toast.error("解除に失敗しました", { description: result.error });
      }
    });
  }

  // 積み込み・荷降ろしを完全に対称に扱う。使うグループが違うだけ。
  const groups = mode === "load" ? checklist.loadGroups : checklist.unloadGroups;
  const checked = checkedState[mode];

  const storeStatus = useMemo(
    () =>
      groups.map((group) => {
        const doneItems = group.items.filter((item) => checked.has(item.lineId)).length;
        // 残り箱数は「未チェックの行」で数える。店舗単位で数えると、
        // 途中まで終わった店舗の済んだ分まで残りに入って多く出てしまう。
        const remainingBoxes = group.items
          .filter((item) => !checked.has(item.lineId))
          .reduce((sum, item) => sum + item.breakdown.totalBoxes, 0);
        return {
          group,
          doneItems,
          remainingBoxes,
          complete: group.items.length > 0 && doneItems === group.items.length,
        };
      }),
    [groups, checked],
  );

  const doneStores = storeStatus.filter((s) => s.complete).length;
  const remainingBoxes = storeStatus.reduce((sum, s) => sum + s.remainingBoxes, 0);

  // 「今の店舗」は未完了の先頭。手で選んだらそちらを優先する。
  // 選択中に明細が変わって範囲外になっても空白にならないよう丸め込む。
  const autoIndex = storeStatus.findIndex((s) => !s.complete);
  const fallbackIndex = autoIndex >= 0 ? autoIndex : groups.length - 1;
  const override = indexOverride[mode];
  const currentIndex =
    override !== null && override >= 0 && override < groups.length
      ? override
      : fallbackIndex;
  const current: StoreChecklistGroup | undefined = groups[currentIndex];
  const currentStatus = storeStatus[currentIndex];

  function goToNextStore() {
    const nextIncomplete = storeStatus.findIndex(
      (s, i) => i > currentIndex && !s.complete,
    );
    setIndexOverride((prev) => ({
      ...prev,
      [mode]: nextIncomplete >= 0 ? nextIncomplete : null,
    }));
  }

  const allDone = groups.length > 0 && doneStores === groups.length;

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

      {/* 進捗: 対象・完了・残りを大きく見せる */}
      <div className="space-y-2 border-b pb-3">
        <StoreStats total={groups.length} done={doneStores} />
        <div className="flex items-center justify-between px-4 text-xs text-muted-foreground">
          <span>残り {remainingBoxes} 箱</span>
          {allDone && (
            <span className="flex items-center gap-1 font-semibold text-green-700">
              <Check className="h-3.5 w-3.5" strokeWidth={3} />
              {mode === "load" ? "積み込み完了" : "荷降ろし完了"}
            </span>
          )}
        </div>
        <ProgressBar done={doneStores} total={groups.length} />
      </div>

      {/* 今の店舗を1軒だけ大きく表示。積み込み・荷降ろし共通のレイアウト。 */}
      {current && currentStatus ? (
        <div className="border-b bg-primary/5">
          <div className="px-4 pt-3">
            <p className="text-xs font-semibold text-primary">
              {mode === "load" ? "積む順" : "降ろす順"}
              {currentIndex + 1} / {groups.length} 軒目
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
                checked={checked.has(item.lineId)}
                title={item.label}
                detail={`${formatLineBoxes(item.breakdown)} ・ 計 ${item.totalQty}`}
                onToggle={() => toggle(item.lineId, !checked.has(item.lineId))}
              />
            ))}
          </div>
          <div className="px-4 py-3">
            <Button
              type="button"
              className="min-h-[48px] w-full gap-1.5 text-base"
              variant={currentStatus.complete ? "default" : "outline"}
              onClick={goToNextStore}
              disabled={allDone}
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
      {groups.length > 0 && (
        <div className="px-4 py-3">
          <p className="text-xs font-semibold text-muted-foreground">
            店舗一覧（{mode === "load" ? "積む順" : "降ろす順"}・タップで移動）
          </p>
          <ol className="mt-2 space-y-1">
            {storeStatus.map((status, index) => (
              <li key={status.group.customerKey}>
                <button
                  type="button"
                  onClick={() =>
                    setIndexOverride((prev) => ({ ...prev, [mode]: index }))
                  }
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
                        index + 1
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

      {/* 積む前の総数確認（品目ごとの合計）。マニュアルの「1-4. 総数を先に数える」用。
          チェック対象ではなく検算用なので、開いたときだけ出す。 */}
      {mode === "load" && checklist.itemTotals.length > 0 && (
        <details className="border-t px-4 py-3">
          <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">
            品目ごとの合計（積む前の総数確認）
          </summary>
          <ul className="mt-2 space-y-1.5">
            {checklist.itemTotals.map((total) => (
              <li
                key={`${total.productName}|${total.spec}`}
                className="rounded-md bg-muted/40 px-2.5 py-2 text-xs"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate font-medium">{total.label}</span>
                  <span className="shrink-0 font-mono">
                    {formatItemTotalBoxes(total)}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                  {total.storeNames.join("・")}
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
            端数箱は店舗ごとに別の箱です。中身を足して1箱にまとめられません。
          </p>
        </details>
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
