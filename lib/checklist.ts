/**
 * 積み込み・荷降ろしチェックリストの計算ロジック（純関数）。
 *
 * ## 積む順と降ろす順
 *
 * 実際の運用: 配送順（customers.sort_order）どおりに習志野台から積み、
 * トラックの奥に入る。降ろすときはその逆順（積んだ順の逆）になるので、
 * 習志野台は最後に降ろす。詳細は buildChecklist を参照。
 *
 * ## 数える単位は「箱」
 *
 * 現場で数えるのは数量ではなく**箱（コンテナ）**。既存のラベル生成
 * （`backend/app/services/ocr_parser.py: generate_labels_from_data`）と同じ規則:
 *
 *   通常箱 = boxes 個（各 unit 入り）
 *   端数箱 = remainder > 0 なら 1 個
 *   コンテナ数 = boxes + (remainder > 0 ? 1 : 0)
 *
 * ## 端数箱は絶対に合算しない
 *
 * 品目ごとに集計するとき、**店舗をまたいで端数を足してはいけない**。
 * A店の端数3個とB店の端数5個は「8個入り1箱」ではなく、
 * それぞれ別の箱として2箱ある。ここを間違えると積み込みで箱が足りなくなる。
 */

/** チェックリストの入力。受注明細（OrderLine）がそのまま渡せる形。 */
export type ChecklistLine = {
  id: string;
  customer_name: string;
  /** 帳票表示用の供給先名（系列＋店舗）。無ければ customer_name を使う。 */
  customer_display?: string;
  product_name: string;
  spec: string;
  boxes: number;
  remainder: number;
  /** 入数（規格の unit_size）。数量計算に使う。 */
  unit?: number | null;
  /**
   * DB の total_qty。本番では全行 0 のまま投入されていないため、
   * unit があればそちらから計算する（lineQuantity を参照）。
   */
  total_qty?: number | null;
  /** 配送順。小さいほど先に配達する。未設定は末尾へ。 */
  sort_order?: number | null;
};

const UNKNOWN_SORT_ORDER = 999;

/** 明細1件の箱の内訳。 */
export type BoxBreakdown = {
  /** 満量の箱 */
  fullBoxes: number;
  /** 端数箱（0 か 1） */
  fractionBoxes: number;
  /** 端数箱に入っている数量（端数箱が無ければ 0） */
  fractionQty: number;
  /** 積み下ろしで数える箱の総数 */
  totalBoxes: number;
};

export function boxBreakdown(line: {
  boxes?: number | null;
  remainder?: number | null;
}): BoxBreakdown {
  const fullBoxes = Math.max(0, Math.trunc(Number(line.boxes) || 0));
  const remainder = Math.max(0, Math.trunc(Number(line.remainder) || 0));
  const fractionBoxes = remainder > 0 ? 1 : 0;
  return {
    fullBoxes,
    fractionBoxes,
    fractionQty: remainder,
    totalBoxes: fullBoxes + fractionBoxes,
  };
}

/**
 * 明細1行の数量。
 *
 * `入数 × 箱数 + バラ`。ラベル生成（ocr_parser.generate_labels_from_data）と
 * 同じ規則で、出荷一覧表（generate_summary_table の total_quantity）とも一致する。
 *
 * DB の `order_lines.total_qty` は本番で**全行 0 のまま**投入されていないため、
 * そのまま表示すると「計 0」になってしまう。入数が取れるならそこから計算し、
 * 取れない場合だけ保存値にフォールバックする。
 */
export function lineQuantity(line: {
  unit?: number | null;
  boxes?: number | null;
  remainder?: number | null;
  total_qty?: number | null;
}): number {
  const unit = Number(line.unit) || 0;
  if (unit > 0) {
    const { fullBoxes, fractionQty } = boxBreakdown(line);
    return unit * fullBoxes + fractionQty;
  }
  return Number(line.total_qty) || 0;
}

/** 降ろすとき用: 店舗ごとの1行。 */
export type StoreChecklistItem = {
  lineId: string;
  productName: string;
  spec: string;
  /** 「トマト M」のような表示名 */
  label: string;
  breakdown: BoxBreakdown;
  totalQty: number;
};

/** 降ろすとき用: 店舗単位のまとまり。 */
export type StoreChecklistGroup = {
  customerName: string;
  /** 帳票と同じ供給先表示（系列＋店舗） */
  customerDisplay: string;
  sortOrder: number;
  /** 配送順に振った通し番号（1 始まり）。「3軒目」のように使う */
  stopNumber: number;
  items: StoreChecklistItem[];
  /** この店で降ろす箱の総数 */
  totalBoxes: number;
};

/** 積むとき用: 品目・規格ごとの合計（検算用・チェック対象ではない参考情報）。 */
export type ItemTotal = {
  productName: string;
  spec: string;
  label: string;
  fullBoxes: number;
  /** 端数箱の個数。店舗ごとに1箱なので合算せず「個数」を数える */
  fractionBoxes: number;
  totalBoxes: number;
  totalQty: number;
  /**
   * この品目を降ろす店舗の表示名（帳票と同じ系列＋店舗名）。配送順に並ぶ。
   * 積み込み時に「どの店舗向けか」が分かるようにするためのもの。
   */
  storeNames: string[];
};

export type Checklist = {
  /** 降ろす順（積む順の逆）。荷降ろし用。 */
  unloadGroups: StoreChecklistGroup[];
  /** 積む順（配送順どおり）。積み込み用。 */
  loadGroups: StoreChecklistGroup[];
  /** 品目・規格ごとの合計。積み込みの検算用。 */
  itemTotals: ItemTotal[];
  /** 全体の箱数 */
  totalBoxes: number;
  /** 全体の店舗数 */
  totalStores: number;
};

function displayLabel(productName: string, spec: string): string {
  return spec ? `${productName} ${spec}`.trim() : productName;
}

/**
 * 明細1行の箱の表示。端数箱は必ず1箱なので、その中身の数量を出せる。
 */
export function formatLineBoxes(breakdown: BoxBreakdown): string {
  if (breakdown.fractionBoxes === 0) return `${breakdown.totalBoxes}箱`;
  if (breakdown.fullBoxes === 0) return `端数1箱（${breakdown.fractionQty}）`;
  return `${breakdown.totalBoxes}箱（うち端数1箱・${breakdown.fractionQty}）`;
}

/**
 * 品目ごとの合計の箱の表示。
 *
 * 明細1行と違い、端数箱は**店舗ごとに別の箱**なので個数で数える。
 * 「端数2箱」を「N個入り1箱」と書くと箱が足りなくなるため、中身の数量は
 * 出さない（合計しても意味を持たない）。ItemTotal に fractionQty を
 * 持たせていないのも同じ理由。
 */
export function formatItemTotalBoxes(
  total: Pick<ItemTotal, "fullBoxes" | "fractionBoxes" | "totalBoxes">,
): string {
  if (total.fractionBoxes === 0) return `${total.totalBoxes}箱`;
  if (total.fullBoxes === 0) return `端数${total.fractionBoxes}箱`;
  return `${total.totalBoxes}箱（うち端数${total.fractionBoxes}箱）`;
}

function sortOrderOf(line: ChecklistLine): number {
  return line.sort_order ?? UNKNOWN_SORT_ORDER;
}

/**
 * 店舗ごとにまとめる。
 *
 * 並びは配送順（sort_order 昇順）＝**積む順**。習志野台（sort_order=1）が
 * 最初に積まれてトラックの奥に入り、最後に積んだ店舗が手前になる。
 * stopNumber（何軒目か）はここでは振らない（積む順と降ろす順の両方で
 * 意味が変わるため、呼び出し側の buildChecklist で振る）。
 *
 * 同順位なら店舗名（五十音）で安定させる。
 */
function buildStoreGroups(lines: ChecklistLine[]): Omit<StoreChecklistGroup, "stopNumber">[] {
  const byStore = new Map<string, ChecklistLine[]>();
  for (const line of lines) {
    const key = line.customer_name;
    const bucket = byStore.get(key);
    if (bucket) bucket.push(line);
    else byStore.set(key, [line]);
  }

  const groups = Array.from(byStore.entries()).map(([customerName, storeLines]) => {
    const sortOrder = Math.min(...storeLines.map(sortOrderOf));
    const items: StoreChecklistItem[] = storeLines
      .map((line) => ({
        lineId: line.id,
        productName: line.product_name,
        spec: line.spec,
        label: displayLabel(line.product_name, line.spec),
        breakdown: boxBreakdown(line),
        totalQty: lineQuantity(line),
      }))
      // 店舗内は品目名で並べる（毎回同じ順に出ないと目で追えない）
      .sort((a, b) => a.label.localeCompare(b.label, "ja"));

    return {
      customerName,
      customerDisplay: storeLines[0].customer_display || customerName,
      sortOrder,
      items,
      totalBoxes: items.reduce((sum, item) => sum + item.breakdown.totalBoxes, 0),
    };
  });

  groups.sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.customerName.localeCompare(b.customerName, "ja");
  });

  return groups;
}

/**
 * 品目・規格ごとの合計。
 * 端数箱は**店舗をまたいで合算しない**（別の箱なので個数で数える）。
 */
function buildItemTotals(lines: ChecklistLine[]): ItemTotal[] {
  const byItem = new Map<
    string,
    {
      productName: string;
      spec: string;
      fullBoxes: number;
      fractionBoxes: number;
      totalQty: number;
      // customer_name をキーに、表示名と配送順を持つ。
      // 同じ店舗が複数明細（品目違い）で出てきても1件にまとめるため Map にする。
      stores: Map<string, { display: string; sortOrder: number }>;
    }
  >();

  for (const line of lines) {
    const key = `${line.product_name} ${line.spec}`;
    const breakdown = boxBreakdown(line);
    const storeEntry = {
      display: line.customer_display || line.customer_name,
      sortOrder: sortOrderOf(line),
    };
    const entry = byItem.get(key);
    if (entry) {
      entry.fullBoxes += breakdown.fullBoxes;
      entry.fractionBoxes += breakdown.fractionBoxes;
      entry.totalQty += lineQuantity(line);
      entry.stores.set(line.customer_name, storeEntry);
    } else {
      byItem.set(key, {
        productName: line.product_name,
        spec: line.spec,
        fullBoxes: breakdown.fullBoxes,
        fractionBoxes: breakdown.fractionBoxes,
        totalQty: lineQuantity(line),
        stores: new Map([[line.customer_name, storeEntry]]),
      });
    }
  }

  return Array.from(byItem.values())
    .map((entry) => ({
      productName: entry.productName,
      spec: entry.spec,
      label: displayLabel(entry.productName, entry.spec),
      fullBoxes: entry.fullBoxes,
      fractionBoxes: entry.fractionBoxes,
      totalBoxes: entry.fullBoxes + entry.fractionBoxes,
      totalQty: entry.totalQty,
      // 積み込み時にどの店舗向けかが分かるよう、配送順（降ろす順）に並べる。
      // 店舗一覧や通し番号と見比べやすくするため、積む順（逆順）にはしない。
      storeNames: Array.from(entry.stores.values())
        .sort((a, b) => {
          if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
          return a.display.localeCompare(b.display, "ja");
        })
        .map((s) => s.display),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "ja"));
}

/**
 * チェックリストを組み立てる。
 *
 * 実際の積み下ろしの運用に合わせている:
 *
 *   積む順 = 配送順どおり（習志野台から積む） → トラックの奥から手前へ
 *   降ろす順 = 積んだ順の逆（習志野台は最後に降ろす）
 *
 * - `loadGroups`: 配送順（sort_order 昇順）。積むときに使う。
 * - `unloadGroups`: loadGroups の逆順。降ろすときに使う。
 * - stopNumber（「3軒目」のように現場で会話するための通し番号）は
 *   **降ろす順**を基準に振る。トラックが実際に回る順（＝降ろす順）に
 *   対して数えるのが自然なため。積む順（loadGroups）側は、同じ店舗の
 *   stopNumber をそのまま引き継ぐ（習志野台は積む1番目だが、降ろすのは
 *   最後＝最大の stopNumber になる）。
 * - `itemTotals`: 品目・規格ごとの合計。積み込みの数え漏れ検算用の参考情報。
 */
export function buildChecklist(lines: ChecklistLine[]): Checklist {
  const byLoadOrder = buildStoreGroups(lines);
  const byUnloadOrder = [...byLoadOrder].reverse();

  const unloadGroups: StoreChecklistGroup[] = byUnloadOrder.map((group, index) => ({
    ...group,
    stopNumber: index + 1,
  }));
  const stopNumberByStore = new Map(
    unloadGroups.map((group) => [group.customerName, group.stopNumber]),
  );
  const loadGroups: StoreChecklistGroup[] = byLoadOrder.map((group) => ({
    ...group,
    stopNumber: stopNumberByStore.get(group.customerName)!,
  }));

  return {
    unloadGroups,
    loadGroups,
    itemTotals: buildItemTotals(lines),
    totalBoxes: unloadGroups.reduce((sum, group) => sum + group.totalBoxes, 0),
    totalStores: unloadGroups.length,
  };
}
