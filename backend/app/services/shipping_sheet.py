"""
品目別出荷票（期間×品目フィルタ付き出荷一覧）用の集計サービス。

複数注文にまたがる同一 (store, item, spec, unit) の行を合算し、
remainder が unit 以上になった場合は箱に繰り上げて正規化する。
既存の generate_summary_table / LabelPDFGenerator には手を入れない。
"""
from __future__ import annotations

from typing import Dict, List, Tuple


def aggregate_order_data(order_data: List[Dict]) -> List[Dict]:
    """
    (store, item, spec, unit) をキーに boxes / remainder を合算する。

    正規化: remainder >= unit のとき boxes += remainder // unit,
    remainder %= unit（system_design_v4.md の「×数字」ルールと整合）。
    unit == 0 の行はラベル生成対象外だが、一覧表には出すためそのまま合算する。
    """
    merged: Dict[Tuple[str, str, str, int], Dict] = {}
    order = []  # 出現順を保持

    for entry in order_data:
        key = (
            entry.get("store", ""),
            entry.get("item", ""),
            entry.get("spec", ""),
            int(entry.get("unit", 0) or 0),
        )
        if key not in merged:
            merged[key] = {
                "store": key[0],
                "item": key[1],
                "spec": key[2],
                "unit": key[3],
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
