/**
 * OCR 検証画面のロジック（純関数）。
 *
 * 画面コンポーネントから切り出しているのは、ここが「どの行に警告を出すか」
 * 「どの受注票を未処理として数えるか」を決める箇所で、間違えると
 * ユーザーを誤った修正へ誘導するため。テストで固定しておきたい。
 */

import type { HumanLine } from "@/lib/schemas/ocr";
import type { OcrStatus } from "@/lib/types/supabase";

/** 未処理として扱うステータス。バッジの数とリストの絞り込みで同じ定義を使う。 */
export const PENDING_STATUSES = ["pending", "needs_review"] as const satisfies
  readonly OcrStatus[];

/** 編集不可（承認済み・却下済み）として扱うステータス。 */
export const READONLY_STATUSES = [
  "corrected",
  "auto_accepted",
  "rejected",
] as const satisfies readonly OcrStatus[];

export function isPendingStatus(status: string): boolean {
  return (PENDING_STATUSES as readonly string[]).includes(status);
}

export function isReadonlyStatus(status: string): boolean {
  return (READONLY_STATUSES as readonly string[]).includes(status);
}

/** OCR 由来の1行。confidence は解析時のみ付く。 */
export type ParsedLineLike = {
  store?: string | null;
  item?: string | null;
  spec?: string | null;
  unit?: number | null;
  boxes?: number | null;
  remainder?: number | null;
  confidence?: number | null;
};

/** 店舗名 → 配送順。マスタ未登録の店舗は末尾に寄せる。 */
export type StoreOrder = Record<string, number>;

const UNKNOWN_STORE_ORDER = 999;

/**
 * 配送順で比較する。順位が同じなら店舗名の五十音順で安定させる。
 * （順位が同値のまま名前で崩れると、毎回並びが変わって見える）
 */
export function compareByStoreOrder(
  aStore: string,
  bStore: string,
  storeOrder: StoreOrder
): number {
  const aOrd = storeOrder[aStore] ?? UNKNOWN_STORE_ORDER;
  const bOrd = storeOrder[bStore] ?? UNKNOWN_STORE_ORDER;
  if (aOrd !== bOrd) return aOrd - bOrd;
  return aStore.localeCompare(bStore, "ja");
}

/**
 * OCR の行をフォームの初期値へ変換する。
 *
 * confidence を行に載せたまま運ぶのが要点。以前は
 * `verification.parsed_lines[配列の添字].confidence` で引いていたが、
 * フォーム側は配送順にソートされていたため添字が一致せず、
 * 「マスタ未登録」の赤い警告が無関係な行に付いていた。
 */
export function buildFormLine(line: ParsedLineLike): HumanLine {
  return {
    store: line.store ?? "",
    item: line.item ?? "",
    spec: line.spec ?? "",
    unit: line.unit ?? 0,
    boxes: line.boxes ?? 0,
    remainder: line.remainder ?? 0,
    confidence: line.confidence ?? undefined,
  };
}

export const EMPTY_FORM_LINE: HumanLine = {
  store: "",
  item: "",
  spec: "",
  unit: 0,
  boxes: 0,
  remainder: 0,
  confidence: undefined,
};

/** フォームの初期行。空なら1行だけ用意する（テーブルが空だと入力できない）。 */
export function buildInitialFormLines(
  parsedLines: ParsedLineLike[],
  storeOrder: StoreOrder
): HumanLine[] {
  if (parsedLines.length === 0) return [{ ...EMPTY_FORM_LINE }];
  return parsedLines
    .map(buildFormLine)
    .sort((a, b) => compareByStoreOrder(a.store, b.store, storeOrder));
}

/** 行1件の合計数量。入数 × 箱数 + バラ。 */
export function lineTotal(line: {
  unit?: number | string | null;
  boxes?: number | string | null;
  remainder?: number | string | null;
}): number {
  const unit = Number(line.unit) || 0;
  const boxes = Number(line.boxes) || 0;
  const remainder = Number(line.remainder) || 0;
  return unit * boxes + remainder;
}

export type LineWarning = "unresolved" | "low-confidence" | null;

/**
 * 行に出す警告の種類を決める。
 *
 *   confidence === 0        マスタ未解決で数量を計算できない（赤・最優先）
 *   0 < confidence < 0.9    要確認（橙）
 *   それ以外                 警告なし
 */
export function lineWarning(confidence: number | null | undefined): LineWarning {
  if (confidence === null || confidence === undefined) return null;
  if (confidence === 0) return "unresolved";
  if (confidence > 0 && confidence < 0.9) return "low-confidence";
  return null;
}

/** 日付フィルタの選択肢。 */
export type DateRange = "7d" | "30d" | "all";

export const DATE_RANGE_LABELS: Record<DateRange, string> = {
  "7d": "7日",
  "30d": "30日",
  all: "全期間",
};

export function isDateRange(value: unknown): value is DateRange {
  return value === "7d" || value === "30d" || value === "all";
}

/** 期間の開始時刻。"all" は制限なし（null）。 */
export function dateRangeCutoff(range: DateRange, now: number): Date | null {
  if (range === "all") return null;
  const days = range === "7d" ? 7 : 30;
  return new Date(now - days * 86_400_000);
}

/**
 * リストの絞り込み。
 *
 * 未処理の件数バッジとリストで**同じ絞り込みを通す**のが要点。
 * 以前はバッジが全期間の件数、リストが期間フィルタ後だったため
 * 「未処理 5」と出ているのに3件しか見えない状態が起きていた。
 */
export function filterVerifications<
  T extends { status: string; created_at: string },
>(
  list: T[],
  options: { onlyPending: boolean; dateRange: DateRange; now?: number }
): T[] {
  const cutoff = dateRangeCutoff(options.dateRange, options.now ?? Date.now());
  return list.filter((item) => {
    if (options.onlyPending && !isPendingStatus(item.status)) return false;
    if (cutoff && new Date(item.created_at) < cutoff) return false;
    return true;
  });
}
