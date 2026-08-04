import { describe, expect, it } from "vitest";

import {
  boxBreakdown,
  buildChecklist,
  formatItemTotalBoxes,
  formatLineBoxes,
  lineQuantity,
  loadRowKey,
  type ChecklistLine,
} from "./checklist";

/** 習志野台(1) → 青葉台(2) → 八柱(3) の配送順を想定したデータ。 */
function line(overrides: Partial<ChecklistLine> & { id: string }): ChecklistLine {
  return {
    customer_name: "習志野台",
    product_name: "トマト",
    spec: "M",
    boxes: 0,
    remainder: 0,
    total_qty: 0,
    sort_order: 1,
    ...overrides,
  };
}

describe("boxBreakdown", () => {
  it("端数が無ければ満量の箱だけ", () => {
    expect(boxBreakdown({ boxes: 3, remainder: 0 })).toEqual({
      fullBoxes: 3,
      fractionBoxes: 0,
      fractionQty: 0,
      totalBoxes: 3,
    });
  });

  it("端数があれば端数箱が1つ増える（ラベル生成と同じ規則）", () => {
    expect(boxBreakdown({ boxes: 3, remainder: 5 })).toEqual({
      fullBoxes: 3,
      fractionBoxes: 1,
      fractionQty: 5,
      totalBoxes: 4,
    });
  });

  it("端数だけでも1箱として数える", () => {
    expect(boxBreakdown({ boxes: 0, remainder: 2 }).totalBoxes).toBe(1);
  });

  it("空・負値・小数を安全に扱う", () => {
    expect(boxBreakdown({}).totalBoxes).toBe(0);
    expect(boxBreakdown({ boxes: null, remainder: null }).totalBoxes).toBe(0);
    expect(boxBreakdown({ boxes: -3, remainder: -1 }).totalBoxes).toBe(0);
    expect(boxBreakdown({ boxes: 2.7, remainder: 0 }).fullBoxes).toBe(2);
  });
});

describe("降ろすとき（店舗ごと・配送順）", () => {
  const lines = [
    line({ id: "l1", customer_name: "八柱", sort_order: 3, boxes: 1, remainder: 0, total_qty: 10 }),
    line({ id: "l2", customer_name: "習志野台", sort_order: 1, boxes: 2, remainder: 3, total_qty: 23 }),
    line({ id: "l3", customer_name: "青葉台", sort_order: 2, boxes: 1, remainder: 0, total_qty: 10 }),
  ];

  it("配送順に並ぶ", () => {
    const { unloadGroups } = buildChecklist(lines);
    expect(unloadGroups.map((g) => g.customerName)).toEqual([
      "習志野台",
      "青葉台",
      "八柱",
    ]);
  });

  it("何軒目かの通し番号が付く", () => {
    const { unloadGroups } = buildChecklist(lines);
    expect(unloadGroups.map((g) => g.stopNumber)).toEqual([1, 2, 3]);
  });

  it("店舗ごとの箱数を出す（端数箱を含む）", () => {
    const { unloadGroups } = buildChecklist(lines);
    // 習志野台: 満量2箱 + 端数1箱 = 3箱
    expect(unloadGroups[0].totalBoxes).toBe(3);
    expect(unloadGroups[1].totalBoxes).toBe(1);
  });

  it("同じ店舗の複数明細を1つにまとめる", () => {
    const { unloadGroups } = buildChecklist([
      line({ id: "a", customer_name: "習志野台", product_name: "トマト", boxes: 1, total_qty: 10 }),
      line({ id: "b", customer_name: "習志野台", product_name: "胡瓜", boxes: 2, total_qty: 20 }),
    ]);
    expect(unloadGroups).toHaveLength(1);
    expect(unloadGroups[0].items).toHaveLength(2);
    expect(unloadGroups[0].totalBoxes).toBe(3);
  });

  it("マスタ未登録（配送順なし）の店舗は末尾へ", () => {
    const { unloadGroups } = buildChecklist([
      line({ id: "a", customer_name: "未登録店", sort_order: null, boxes: 1 }),
      line({ id: "b", customer_name: "習志野台", sort_order: 1, boxes: 1 }),
    ]);
    expect(unloadGroups.map((g) => g.customerName)).toEqual(["習志野台", "未登録店"]);
  });

  it("配送順が同じなら店舗名で安定させる（毎回同じ並びになる）", () => {
    const a = buildChecklist([
      line({ id: "a", customer_name: "B店", sort_order: 5, boxes: 1 }),
      line({ id: "b", customer_name: "A店", sort_order: 5, boxes: 1 }),
    ]);
    const b = buildChecklist([
      line({ id: "b", customer_name: "A店", sort_order: 5, boxes: 1 }),
      line({ id: "a", customer_name: "B店", sort_order: 5, boxes: 1 }),
    ]);
    expect(a.unloadGroups.map((g) => g.customerName)).toEqual(["A店", "B店"]);
    expect(b.unloadGroups.map((g) => g.customerName)).toEqual(["A店", "B店"]);
  });

  it("系列付きの供給先表示を使う（帳票と揃える）", () => {
    const { unloadGroups } = buildChecklist([
      line({
        id: "a",
        customer_name: "東道野辺",
        customer_display: "ヨーク 東道野辺",
        boxes: 1,
      }),
    ]);
    expect(unloadGroups[0].customerDisplay).toBe("ヨーク 東道野辺");
  });
});

describe("積むとき（配送順の逆）", () => {
  const lines = [
    line({ id: "l1", customer_name: "八柱", sort_order: 3, boxes: 1 }),
    line({ id: "l2", customer_name: "習志野台", sort_order: 1, boxes: 1 }),
    line({ id: "l3", customer_name: "青葉台", sort_order: 2, boxes: 1 }),
  ];

  it("最初に降ろす店が最後に積まれる", () => {
    // 奥に積むと1軒目で掘り返すことになるため、積む順は配送順の逆にする
    const { loadGroups } = buildChecklist(lines);
    expect(loadGroups.map((g) => g.customerName)).toEqual([
      "八柱",
      "青葉台",
      "習志野台",
    ]);
  });

  it("通し番号は降ろす順のまま（現場で「3軒目の分」と会話できる）", () => {
    const { loadGroups } = buildChecklist(lines);
    expect(loadGroups.map((g) => g.stopNumber)).toEqual([3, 2, 1]);
  });

  it("降ろす順と積む順は同じ集合（取り違えて中身が減らない）", () => {
    const { loadGroups, unloadGroups } = buildChecklist(lines);
    expect(loadGroups).toHaveLength(unloadGroups.length);
    expect([...loadGroups].reverse().map((g) => g.customerName)).toEqual(
      unloadGroups.map((g) => g.customerName),
    );
  });
});

describe("品目ごとの合計（積み込みの検算）", () => {
  it("同じ品目・規格を店舗をまたいで合計する", () => {
    const { itemTotals } = buildChecklist([
      line({ id: "a", customer_name: "習志野台", product_name: "トマト", spec: "M", boxes: 2, total_qty: 20 }),
      line({ id: "b", customer_name: "青葉台", sort_order: 2, product_name: "トマト", spec: "M", boxes: 3, total_qty: 30 }),
    ]);
    expect(itemTotals).toHaveLength(1);
    expect(itemTotals[0].label).toBe("トマト M");
    expect(itemTotals[0].fullBoxes).toBe(5);
    expect(itemTotals[0].totalQty).toBe(50);
    expect(itemTotals[0].storeNames).toEqual(["習志野台", "青葉台"]);
  });

  it("店舗名を配送順に並べる（店舗の追加順ではない）", () => {
    // 青葉台を先に登録しても、配送順（習志野台が先）で並ぶこと
    const { itemTotals } = buildChecklist([
      line({ id: "a", customer_name: "青葉台", sort_order: 2, product_name: "トマト", spec: "M", boxes: 1 }),
      line({ id: "b", customer_name: "習志野台", sort_order: 1, product_name: "トマト", spec: "M", boxes: 1 }),
    ]);
    expect(itemTotals[0].storeNames).toEqual(["習志野台", "青葉台"]);
  });

  it("系列付きの表示名（帳票と同じもの）を使う", () => {
    const { itemTotals } = buildChecklist([
      line({
        id: "a",
        customer_name: "東道野辺",
        customer_display: "ヨーク 東道野辺",
        product_name: "トマト",
        spec: "M",
        boxes: 1,
      }),
    ]);
    expect(itemTotals[0].storeNames).toEqual(["ヨーク 東道野辺"]);
  });

  it("同じ店舗の複数明細（別品目）でも店舗名は重複しない", () => {
    const { itemTotals } = buildChecklist([
      line({ id: "a", customer_name: "習志野台", product_name: "トマト", spec: "M", boxes: 1 }),
      line({ id: "b", customer_name: "習志野台", product_name: "胡瓜", spec: "M", boxes: 1 }),
    ]);
    // トマトは習志野台1店舗のみ向け
    const tomato = itemTotals.find((t) => t.productName === "トマト")!;
    expect(tomato.storeNames).toEqual(["習志野台"]);
  });

  it("規格が違えば別扱いにする", () => {
    const { itemTotals } = buildChecklist([
      line({ id: "a", product_name: "トマト", spec: "M", boxes: 1 }),
      line({ id: "b", product_name: "トマト", spec: "L", boxes: 1 }),
    ]);
    expect(itemTotals.map((t) => t.label)).toEqual(["トマト L", "トマト M"]);
  });

  it("端数箱は店舗をまたいで合算しない（別の箱なので個数で数える）", () => {
    // ここが最重要。A店の端数3個とB店の端数5個は「8個入り1箱」ではなく2箱。
    // 合算すると積み込みで箱が1つ足りなくなる。
    const { itemTotals } = buildChecklist([
      line({ id: "a", customer_name: "習志野台", sort_order: 1, boxes: 0, remainder: 3, total_qty: 3 }),
      line({ id: "b", customer_name: "青葉台", sort_order: 2, boxes: 0, remainder: 5, total_qty: 5 }),
    ]);
    expect(itemTotals[0].fractionBoxes).toBe(2);
    expect(itemTotals[0].totalBoxes).toBe(2);
    expect(itemTotals[0].totalQty).toBe(8);
  });

  it("満量と端数が混ざっても箱数が合う", () => {
    const { itemTotals } = buildChecklist([
      line({ id: "a", customer_name: "習志野台", sort_order: 1, boxes: 2, remainder: 4, total_qty: 24 }),
      line({ id: "b", customer_name: "青葉台", sort_order: 2, boxes: 1, remainder: 0, total_qty: 10 }),
    ]);
    expect(itemTotals[0].fullBoxes).toBe(3);
    expect(itemTotals[0].fractionBoxes).toBe(1);
    expect(itemTotals[0].totalBoxes).toBe(4);
  });
});

describe("全体の整合性", () => {
  const lines = [
    line({ id: "l1", customer_name: "習志野台", sort_order: 1, product_name: "トマト", boxes: 2, remainder: 3, total_qty: 23 }),
    line({ id: "l2", customer_name: "習志野台", sort_order: 1, product_name: "胡瓜", boxes: 1, remainder: 0, total_qty: 10 }),
    line({ id: "l3", customer_name: "青葉台", sort_order: 2, product_name: "トマト", boxes: 1, remainder: 2, total_qty: 12 }),
  ];

  it("店舗ごとの箱数の合計と品目ごとの箱数の合計が一致する", () => {
    // どちらの画面で数えても同じ数にならないと、現場が混乱する
    const { unloadGroups, itemTotals, totalBoxes } = buildChecklist(lines);
    const byStore = unloadGroups.reduce((sum, g) => sum + g.totalBoxes, 0);
    const byItem = itemTotals.reduce((sum, t) => sum + t.totalBoxes, 0);
    expect(byStore).toBe(byItem);
    expect(totalBoxes).toBe(byStore);
    // 習志野台: (2+1) + 1 = 4箱 / 青葉台: 1+1 = 2箱
    expect(totalBoxes).toBe(6);
  });

  it("店舗数を数える", () => {
    expect(buildChecklist(lines).totalStores).toBe(2);
  });

  it("明細が空でも壊れない", () => {
    const result = buildChecklist([]);
    expect(result.unloadGroups).toEqual([]);
    expect(result.loadGroups).toEqual([]);
    expect(result.itemTotals).toEqual([]);
    expect(result.totalBoxes).toBe(0);
    expect(result.totalStores).toBe(0);
  });

  it("入力配列を変更しない", () => {
    const snapshot = JSON.parse(JSON.stringify(lines));
    buildChecklist(lines);
    expect(lines).toEqual(snapshot);
  });
});

describe("箱数の表示", () => {
  it("端数が無ければ箱数だけ", () => {
    expect(formatLineBoxes(boxBreakdown({ boxes: 3, remainder: 0 }))).toBe("3箱");
  });

  it("明細1行の端数箱は中身の数量まで出す", () => {
    expect(formatLineBoxes(boxBreakdown({ boxes: 3, remainder: 5 }))).toBe(
      "4箱（うち端数1箱・5）",
    );
    expect(formatLineBoxes(boxBreakdown({ boxes: 0, remainder: 5 }))).toBe(
      "端数1箱（5）",
    );
  });

  it("品目ごとの合計は端数を「箱の個数」で出す（数量は出さない）", () => {
    // A店の端数3個とB店の端数5個は「8個入り1箱」ではなく2箱。
    // 数量を出すと箱が足りなくなる誤解を招くので出さない。
    expect(
      formatItemTotalBoxes({ fullBoxes: 3, fractionBoxes: 2, totalBoxes: 5 }),
    ).toBe("5箱（うち端数2箱）");
    expect(
      formatItemTotalBoxes({ fullBoxes: 0, fractionBoxes: 2, totalBoxes: 2 }),
    ).toBe("端数2箱");
    expect(
      formatItemTotalBoxes({ fullBoxes: 4, fractionBoxes: 0, totalBoxes: 4 }),
    ).toBe("4箱");
  });

  it("実データから作った合計と表示が食い違わない", () => {
    const { itemTotals, unloadGroups } = buildChecklist([
      line({ id: "a", customer_name: "習志野台", sort_order: 1, boxes: 2, remainder: 4, total_qty: 24 }),
      line({ id: "b", customer_name: "青葉台", sort_order: 2, boxes: 0, remainder: 6, total_qty: 6 }),
    ]);
    // 満量2箱 + 端数2箱（店舗ごとに1箱）= 4箱
    expect(formatItemTotalBoxes(itemTotals[0])).toBe("4箱（うち端数2箱）");
    expect(formatLineBoxes(unloadGroups[1].items[0].breakdown)).toBe("端数1箱（6）");
  });
});

describe("loadRowKey", () => {
  it("品目と規格の組で一意になる", () => {
    expect(loadRowKey("トマト", "M")).toBe("トマト|M");
    expect(loadRowKey("トマト", "L")).not.toBe(loadRowKey("トマト", "M"));
  });

  it("規格なしでも衝突しない", () => {
    expect(loadRowKey("トマト", "")).toBe("トマト|");
    expect(loadRowKey("トマト", "")).not.toBe(loadRowKey("トマト", "M"));
  });

  it("itemTotals の各行と1対1で対応する（キーが重複しない）", () => {
    const { itemTotals } = buildChecklist([
      line({ id: "a", product_name: "トマト", spec: "M", boxes: 1 }),
      line({ id: "b", product_name: "トマト", spec: "L", boxes: 1 }),
      line({ id: "c", product_name: "胡瓜", spec: "", boxes: 1 }),
    ]);
    const keys = itemTotals.map((t) => loadRowKey(t.productName, t.spec));
    expect(new Set(keys).size).toBe(itemTotals.length);
  });
});

describe("数量の計算（実データ由来）", () => {
  it("入数 × 箱数 + バラ で計算する", () => {
    // 胡瓜 3本（入数30）5箱 → 150
    expect(lineQuantity({ unit: 30, boxes: 5, remainder: 0 })).toBe(150);
    // 胡瓜バラ 100本（入数100）12箱 + 50 → 1250
    expect(lineQuantity({ unit: 100, boxes: 12, remainder: 50 })).toBe(1250);
    // 端数のみ
    expect(lineQuantity({ unit: 50, boxes: 0, remainder: 20 })).toBe(20);
  });

  it("入数が取れないときだけ保存値にフォールバックする", () => {
    // 本番の order_lines.total_qty は全行 0 のままなので、入数から計算する。
    // 入数が無い場合に限り保存値を使う。
    expect(lineQuantity({ unit: 30, boxes: 5, remainder: 0, total_qty: 0 })).toBe(150);
    expect(lineQuantity({ unit: 0, boxes: 5, remainder: 0, total_qty: 999 })).toBe(999);
    expect(lineQuantity({ boxes: 5, remainder: 0 })).toBe(0);
  });
});

describe("本番データでの通し検証（2026-08-04 の受注・先頭3店舗）", () => {
  // Supabase の本番データから採取した実際の明細。
  // 端数箱が店舗をまたぐケース（長ネギ・シシトウ）が実在するため、
  // 合算しない規則の回帰テストとして固定しておく。
  const real: ChecklistLine[] = [
    { id: "1", customer_name: "習志野台", customer_display: "ヨーク 習志野台", sort_order: 1, product_name: "胡瓜", spec: "3本", unit: 30, boxes: 5, remainder: 0 },
    { id: "2", customer_name: "習志野台", customer_display: "ヨーク 習志野台", sort_order: 1, product_name: "長ネギ", spec: "2本", unit: 25, boxes: 1, remainder: 5 },
    { id: "3", customer_name: "咲が丘", customer_display: "ヨーク 咲が丘", sort_order: 2, product_name: "シシトウ", spec: "1袋", unit: 50, boxes: 0, remainder: 20 },
    { id: "4", customer_name: "咲が丘", customer_display: "ヨーク 咲が丘", sort_order: 2, product_name: "胡瓜", spec: "3本", unit: 30, boxes: 1, remainder: 20 },
    { id: "5", customer_name: "咲が丘", customer_display: "ヨーク 咲が丘", sort_order: 2, product_name: "長ネギ", spec: "2本", unit: 25, boxes: 1, remainder: 5 },
    { id: "6", customer_name: "青葉台", customer_display: "ヨーク 青葉台", sort_order: 3, product_name: "シシトウ", spec: "1袋", unit: 50, boxes: 0, remainder: 20 },
    { id: "7", customer_name: "青葉台", customer_display: "ヨーク 青葉台", sort_order: 3, product_name: "トマトバラ", spec: "10k", unit: 1, boxes: 7, remainder: 0 },
    { id: "8", customer_name: "青葉台", customer_display: "ヨーク 青葉台", sort_order: 3, product_name: "胡瓜バラ", spec: "100本", unit: 100, boxes: 12, remainder: 50 },
    { id: "9", customer_name: "青葉台", customer_display: "ヨーク 青葉台", sort_order: 3, product_name: "長ねぎバラ", spec: "バラ", unit: 50, boxes: 6, remainder: 0 },
  ];

  it("配送順どおりに店舗が並び、系列付きで表示される", () => {
    const { unloadGroups } = buildChecklist(real);
    expect(unloadGroups.map((g) => g.customerDisplay)).toEqual([
      "ヨーク 習志野台",
      "ヨーク 咲が丘",
      "ヨーク 青葉台",
    ]);
  });

  it("店舗ごとの箱数が実データと一致する", () => {
    const { unloadGroups } = buildChecklist(real);
    expect(unloadGroups.map((g) => g.totalBoxes)).toEqual([7, 5, 27]);
  });

  it("数量が入数から正しく出る（total_qty が0でも0にならない）", () => {
    const { unloadGroups } = buildChecklist(real);
    const aoba = unloadGroups[2];
    const kyuri = aoba.items.find((i) => i.label === "胡瓜バラ 100本");
    expect(kyuri?.totalQty).toBe(1250);
    expect(formatLineBoxes(kyuri!.breakdown)).toBe("13箱（うち端数1箱・50）");
  });

  it("端数箱が店舗をまたいでも合算されない", () => {
    const { itemTotals } = buildChecklist(real);
    // 長ネギ 2本: 習志野台と咲が丘にそれぞれ端数1箱 → 端数2箱
    const negi = itemTotals.find((t) => t.label === "長ネギ 2本")!;
    expect(negi.fractionBoxes).toBe(2);
    expect(negi.totalBoxes).toBe(4);
    expect(formatItemTotalBoxes(negi)).toBe("4箱（うち端数2箱）");

    // シシトウ 1袋: 2店舗とも端数のみ → 端数2箱
    const shishito = itemTotals.find((t) => t.label === "シシトウ 1袋")!;
    expect(shishito.fullBoxes).toBe(0);
    expect(shishito.fractionBoxes).toBe(2);
    expect(formatItemTotalBoxes(shishito)).toBe("端数2箱");
  });

  it("積み込み画面でどの店舗向けかが配送順・系列付きで分かる", () => {
    const { itemTotals } = buildChecklist(real);
    const negi = itemTotals.find((t) => t.label === "長ネギ 2本")!;
    expect(negi.storeNames).toEqual(["ヨーク 習志野台", "ヨーク 咲が丘"]);

    const kyuri = itemTotals.find((t) => t.label === "胡瓜 3本")!;
    expect(kyuri.storeNames).toEqual(["ヨーク 習志野台", "ヨーク 咲が丘"]);

    // 青葉台だけの品目は1店舗のみ
    const tomato = itemTotals.find((t) => t.label === "トマトバラ 10k")!;
    expect(tomato.storeNames).toEqual(["ヨーク 青葉台"]);
  });

  it("店舗ごとの合計と品目ごとの合計が一致する（39箱）", () => {
    const { unloadGroups, itemTotals, totalBoxes } = buildChecklist(real);
    const byStore = unloadGroups.reduce((s, g) => s + g.totalBoxes, 0);
    const byItem = itemTotals.reduce((s, t) => s + t.totalBoxes, 0);
    expect(byStore).toBe(39);
    expect(byItem).toBe(39);
    expect(totalBoxes).toBe(39);
  });
});
