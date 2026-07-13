"""
品目別出荷票（期間×品目フィルタ付き出荷一覧）用の集計サービス。

複数注文にまたがる同一 (supplier, store, item, spec, unit) の行を合算し、
remainder が unit 以上になった場合は箱に繰り上げて正規化する。
既存の generate_summary_table / LabelPDFGenerator には手を入れない。
"""
from __future__ import annotations

from typing import Dict, List, Tuple


def aggregate_order_data(order_data: List[Dict]) -> List[Dict]:
    """
    (supplier, store, item, spec, unit) をキーに boxes / remainder を合算する。
    supplier は省略可（キーに含めるのは、別系列で同名店舗が存在する場合の誤合算を防ぐため）。

    正規化: remainder >= unit のとき boxes += remainder // unit,
    remainder %= unit（system_design_v4.md の「×数字」ルールと整合）。
    unit == 0 の行はラベル生成対象外だが、一覧表には出すためそのまま合算する。
    """
    merged: Dict[Tuple[str, str, str, str, int], Dict] = {}
    order = []  # 出現順を保持

    for entry in order_data:
        key = (
            entry.get("supplier", ""),
            entry.get("store", ""),
            entry.get("item", ""),
            entry.get("spec", ""),
            int(entry.get("unit", 0) or 0),
        )
        if key not in merged:
            merged[key] = {
                "supplier": key[0],
                "store": key[1],
                "item": key[2],
                "spec": key[3],
                "unit": key[4],
                "boxes": 0,
                "remainder": 0,
            }
            order.append(key)
        merged[key]["boxes"] += int(entry.get("boxes", 0) or 0)
        merged[key]["remainder"] += int(entry.get("remainder", 0) or 0)

    result = []
    for key in order:
        row = merged[key]
        unit = row["unit"]
        if unit > 0 and row["remainder"] >= unit:
            row["boxes"] += row["remainder"] // unit
            row["remainder"] %= unit
        result.append(row)
    return result


def sort_by_customer_order(order_data: List[Dict], supplier_first: bool = False) -> List[Dict]:
    """
    店舗マスタの並び順（customers.sort_order）→ 品目名 → 規格 の順で並べ替える。

    各要素は内部キー "_sort_order"（未設定時は末尾扱いの 999）を持つ想定。
    Supabase の返却順は ORDER BY 無しでは不定なため、一覧表・ラベルの出力順を
    店舗一覧の規則（マスタ画面で設定した並び順）に固定するために使う。
    ソート後、内部キー "_sort_order" は取り除かれる。

    supplier_first=True の場合、系列（supplier）を最優先キーにする
    （同名店舗が別系列に存在する場合の並び崩れを防ぐ）。
    """
    if supplier_first:
        key_fn = lambda e: (
            e.get("supplier", ""),
            e.get("_sort_order", 999),
            e.get("item", ""),
            e.get("spec", ""),
        )
    else:
        key_fn = lambda e: (
            e.get("_sort_order", 999),
            e.get("item", ""),
            e.get("spec", ""),
        )
    result = sorted(order_data, key=key_fn)
    for e in result:
        e.pop("_sort_order", None)
    return result
