import { describe, expect, it } from "vitest";

import {
  buildFormLine,
  buildInitialFormLines,
  compareByStoreOrder,
  dateRangeCutoff,
  filterVerifications,
  isDateRange,
  isPendingStatus,
  isReadonlyStatus,
  lineTotal,
  lineWarning,
} from "./verification";

const STORE_ORDER = {
  習志野台: 1,
  青葉台: 2,
  八柱: 3,
};

describe("compareByStoreOrder", () => {
  it("配送順の小さい店舗を先に置く", () => {
    expect(compareByStoreOrder("青葉台", "習志野台", STORE_ORDER)).toBeGreaterThan(0);
    expect(compareByStoreOrder("習志野台", "青葉台", STORE_ORDER)).toBeLessThan(0);
  });

  it("マスタ未登録の店舗は末尾へ寄せる", () => {
    expect(compareByStoreOrder("未登録店", "八柱", STORE_ORDER)).toBeGreaterThan(0);
  });

  it("順位が同じなら店舗名で安定させる（毎回並びが変わらないため）", () => {
    const order = { A店: 5, B店: 5 };
    expect(compareByStoreOrder("A店", "B店", order)).toBeLessThan(0);
    expect(compareByStoreOrder("B店", "A店", order)).toBeGreaterThan(0);
    expect(compareByStoreOrder("A店", "A店", order)).toBe(0);
  });
});

describe("buildFormLine", () => {
  it("null を安全な既定値に落とす", () => {
    expect(buildFormLine({})).toEqual({
      store: "",
      item: "",
      spec: "",
      unit: 0,
      boxes: 0,
      remainder: 0,
      confidence: undefined,
    });
  });

  it("confidence を行データに載せて運ぶ", () => {
    // ここが要点。以前は confidence を parsed_lines の添字で引いていたため、
    // 並べ替えや行の追加・削除で警告が別の行に付いていた。
    expect(buildFormLine({ store: "八柱", confidence: 0 }).confidence).toBe(0);
    expect(buildFormLine({ store: "八柱", confidence: 0.5 }).confidence).toBe(0.5);
  });
});

describe("buildInitialFormLines", () => {
  it("配送順に並べ替えても confidence が行に付いて回る", () => {
    const lines = buildInitialFormLines(
      [
        { store: "八柱", item: "胡瓜", confidence: 0 },
        { store: "習志野台", item: "トマト", confidence: 1 },
        { store: "青葉台", item: "茄子", confidence: 0.5 },
      ],
      STORE_ORDER,
    );

    expect(lines.map((l) => l.store)).toEqual(["習志野台", "青葉台", "八柱"]);
    // 並べ替え後も「胡瓜の行が confidence 0」であること
    const cucumber = lines.find((l) => l.item === "胡瓜");
    expect(cucumber?.confidence).toBe(0);
    expect(lines.find((l) => l.item === "トマト")?.confidence).toBe(1);
    expect(lines.find((l) => l.item === "茄子")?.confidence).toBe(0.5);
  });

  it("警告の対象行が並べ替えでずれない（旧実装の添字方式との対比）", () => {
    const parsed = [
      { store: "八柱", item: "胡瓜", confidence: 0 },
      { store: "習志野台", item: "トマト", confidence: 1 },
    ];
    const lines = buildInitialFormLines(parsed, STORE_ORDER);

    // 旧実装は表示 0 行目の警告を parsed[0]（=胡瓜, confidence 0）から取っていた。
    // 表示 0 行目は習志野台のトマトなので、無関係な行に赤い警告が出ていた。
    expect(lines[0].item).toBe("トマト");
    expect(lineWarning(lines[0].confidence)).toBeNull();
    expect(lines[1].item).toBe("胡瓜");
    expect(lineWarning(lines[1].confidence)).toBe("unresolved");
  });

  it("明細が空なら入力用に1行だけ用意する", () => {
    const lines = buildInitialFormLines([], STORE_ORDER);
    expect(lines).toHaveLength(1);
    expect(lines[0].store).toBe("");
  });
});

describe("lineTotal", () => {
  it("入数 × 箱数 + バラ", () => {
    expect(lineTotal({ unit: 10, boxes: 3, remainder: 4 })).toBe(34);
  });

  it("欠損・空文字は 0 として扱う", () => {
    expect(lineTotal({})).toBe(0);
    expect(lineTotal({ unit: 10, boxes: null, remainder: undefined })).toBe(0);
    // 数値入力欄を空にすると空文字が来る
    expect(lineTotal({ unit: "10", boxes: "", remainder: "5" })).toBe(5);
  });

  it("NaN を混ぜても数値を返す", () => {
    expect(lineTotal({ unit: Number.NaN, boxes: 3, remainder: 1 })).toBe(1);
  });
});

describe("lineWarning", () => {
  it("confidence 0 はマスタ未解決（赤）", () => {
    expect(lineWarning(0)).toBe("unresolved");
  });

  it("0 より大きく 0.9 未満は要確認（橙）", () => {
    expect(lineWarning(0.5)).toBe("low-confidence");
    expect(lineWarning(0.89)).toBe("low-confidence");
  });

  it("0.9 以上は警告なし", () => {
    expect(lineWarning(0.9)).toBeNull();
    expect(lineWarning(1)).toBeNull();
  });

  it("confidence が無い行（手入力など）は警告なし", () => {
    expect(lineWarning(undefined)).toBeNull();
    expect(lineWarning(null)).toBeNull();
  });
});

describe("ステータス判定", () => {
  it("未処理は pending と needs_review", () => {
    expect(isPendingStatus("pending")).toBe(true);
    expect(isPendingStatus("needs_review")).toBe(true);
    expect(isPendingStatus("corrected")).toBe(false);
    expect(isPendingStatus("rejected")).toBe(false);
  });

  it("却下は未処理に含めない（未処理キューから外すのが却下の目的）", () => {
    expect(isPendingStatus("rejected")).toBe(false);
  });

  it("編集不可は承認済み・自動承認・却下", () => {
    expect(isReadonlyStatus("corrected")).toBe(true);
    expect(isReadonlyStatus("auto_accepted")).toBe(true);
    expect(isReadonlyStatus("rejected")).toBe(true);
    expect(isReadonlyStatus("pending")).toBe(false);
    expect(isReadonlyStatus("needs_review")).toBe(false);
  });
});

describe("dateRangeCutoff", () => {
  const now = new Date("2026-08-03T12:00:00Z").getTime();

  it("全期間は制限なし", () => {
    expect(dateRangeCutoff("all", now)).toBeNull();
  });

  it("7日 / 30日はそれぞれの起点を返す", () => {
    expect(dateRangeCutoff("7d", now)?.toISOString()).toBe("2026-07-27T12:00:00.000Z");
    expect(dateRangeCutoff("30d", now)?.toISOString()).toBe("2026-07-04T12:00:00.000Z");
  });
});

describe("isDateRange", () => {
  it("既知の値だけ受け入れる（localStorage の値をそのまま信用しない）", () => {
    expect(isDateRange("7d")).toBe(true);
    expect(isDateRange("30d")).toBe(true);
    expect(isDateRange("all")).toBe(true);
    expect(isDateRange("90d")).toBe(false);
    expect(isDateRange(null)).toBe(false);
    expect(isDateRange("")).toBe(false);
  });
});

describe("filterVerifications", () => {
  const now = new Date("2026-08-03T12:00:00Z").getTime();
  const list = [
    { id: "today-pending", status: "pending", created_at: "2026-08-03T09:00:00Z" },
    { id: "week-review", status: "needs_review", created_at: "2026-07-30T09:00:00Z" },
    { id: "old-review", status: "needs_review", created_at: "2026-06-01T09:00:00Z" },
    { id: "today-done", status: "corrected", created_at: "2026-08-03T10:00:00Z" },
    { id: "today-rejected", status: "rejected", created_at: "2026-08-03T11:00:00Z" },
  ];

  it("未処理のみに絞る", () => {
    const result = filterVerifications(list, {
      onlyPending: true,
      dateRange: "all",
      now,
    });
    expect(result.map((v) => v.id)).toEqual([
      "today-pending",
      "week-review",
      "old-review",
    ]);
  });

  it("期間で絞る", () => {
    const result = filterVerifications(list, {
      onlyPending: false,
      dateRange: "7d",
      now,
    });
    expect(result.map((v) => v.id)).not.toContain("old-review");
    expect(result.map((v) => v.id)).toContain("week-review");
  });

  it("未処理の件数と表示リストが一致する（バッジとリストのずれを防ぐ）", () => {
    // 以前はバッジが全期間の件数、リストが期間フィルタ後だったため
    // 「未処理 3」と出ているのに 2 件しか見えない状態が起きていた。
    const options = { onlyPending: true, dateRange: "7d" as const, now };
    const pending = filterVerifications(list, options);
    expect(pending.map((v) => v.id)).toEqual(["today-pending", "week-review"]);
    // 同じ絞り込みを通すので、件数は必ず表示件数と等しい
    expect(pending.length).toBe(
      filterVerifications(list, options).length,
    );
  });

  it("却下は未処理から外れるが全件には残る", () => {
    const pending = filterVerifications(list, {
      onlyPending: true,
      dateRange: "all",
      now,
    });
    const all = filterVerifications(list, {
      onlyPending: false,
      dateRange: "all",
      now,
    });
    expect(pending.map((v) => v.id)).not.toContain("today-rejected");
    expect(all.map((v) => v.id)).toContain("today-rejected");
  });

  it("元の配列を変更しない", () => {
    const snapshot = [...list];
    filterVerifications(list, { onlyPending: true, dateRange: "7d", now });
    expect(list).toEqual(snapshot);
  });
});
