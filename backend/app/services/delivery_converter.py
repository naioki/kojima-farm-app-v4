"""
v2 解析結果と納品データ（台帳）形式の相互変換

持込入力（AppSheet）とメール読み取りの両方を同じ「納品データ」台帳で扱うため、
v2 形式 [{"store","item","spec","unit","boxes","remainder"}] と
納品データ行（納品日付・農家・納品先・請求先・品目・規格・納品単価・数量・納品金額・税率 等）を変換する。
"""
from __future__ import annotations

from typing import List, Dict, Any, Optional, Tuple, Union
from datetime import datetime
import uuid
import re

# 日付フォーマット（優先順）
_DATE_FORMATS = ("%Y-%m-%d", "%Y/%m/%d", "%Y%m%d")
_OUTPUT_DATE_FMT = "%Y/%m/%d"


def _normalize_date(date_str: str) -> str:
    """日付文字列を YYYY/MM/DD に統一。解釈できない場合はそのまま返す。"""
    if not date_str or not isinstance(date_str, str):
        return date_str or ""
    s = date_str.strip()
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(s, fmt).strftime(_OUTPUT_DATE_FMT)
        except (ValueError, TypeError):
            continue
    return s


def _safe_int(v: Any, max_val: int = 999_999) -> int:
    """数値に変換可能な値を int に。None/空/非数は 0。巨大値は max_val にクランプ。"""
    if v is None:
        return 0
    if isinstance(v, int):
        return max(0, min(v, max_val)) if v != 0 else 0
    if isinstance(v, float):
        if v != v:  # NaN
            return 0
        return max(0, min(int(v), max_val))
    raw = re.sub(r"\D", "", str(v))
    if not raw:
        return 0
    try:
        n = int(raw)
        return max(0, min(n, max_val))
    except (ValueError, OverflowError):
        return 0


def _lookup_unit_price(
    item: str,
    spec: str,
    prices: Dict[Union[str, Tuple[str, str]], float],
) -> float:
    """(品目, 規格) / 品目 / 品目部分一致の順で単価を検索。"""
    key_spec = (item, spec)
    key_item = item
    if key_spec in prices:
        try:
            return float(prices[key_spec])
        except (TypeError, ValueError):
            pass
    if key_item in prices:
        try:
            return float(prices[key_item])
        except (TypeError, ValueError):
            pass
    for k, val in prices.items():
        if isinstance(k, str) and k and item and k in item:
            try:
                return float(val)
            except (TypeError, ValueError):
                continue
    return 0.0


def v2_result_to_delivery_rows(
    v2_result: List[Dict[str, Any]],
    delivery_date: str,
    carry_date: Optional[str] = None,
    farmer: str = "",
    store_to_dest_billing: Optional[Dict[str, Tuple[str, str]]] = None,
    default_unit_prices: Optional[Dict[Union[str, Tuple[str, str]], float]] = None,
    default_tax_rate: str = "8%",
) -> List[Dict[str, Any]]:
    """
    v2 の解析結果（差し札用）を納品データの1行ずつの形式に変換する。

    Args:
        v2_result: parse_order_image の戻り値 [{"store","item","spec","unit","boxes","remainder"}]
        delivery_date: 納品日付（YYYY-MM-DD または YYYY/MM/DD）
        carry_date: 持込日付。省略時は delivery_date と同じ
        farmer: 農家名。メール読み取り由来の場合は運用で決める（共通名や未設定など）
        store_to_dest_billing: 店舗名 → (納品先, 請求先) のマップ。未指定時は store をそのまま納品先・請求先に使う
        default_unit_prices: (品目, 規格) または 品目 をキーにした単価マップ。未設定の品目は 0 になる
        default_tax_rate: 税率（"8%" または "10%"）

    Returns:
        納品データ行のリスト。各要素は 納品ID, 納品日付, 農家, 納品先, 請求先, 品目, 持込日付, 規格, 納品単価, 数量, 納品金額, 税率, チェック 等のキーを持つ
    """
    if not v2_result or not isinstance(v2_result, list):
        return []

    delivery_date_str = _normalize_date(delivery_date)
    carry_date_str = _normalize_date(carry_date or delivery_date)
    farmer_s = (farmer or "").strip() if isinstance(farmer, str) else ""
    tax_rate = (default_tax_rate or "8%").strip() if isinstance(default_tax_rate, str) else "8%"
    store_map = store_to_dest_billing if isinstance(store_to_dest_billing, dict) else {}
    prices = default_unit_prices if isinstance(default_unit_prices, dict) else {}

    rows: List[Dict[str, Any]] = []
    for rec in v2_result:
        if not isinstance(rec, dict):
            continue
        store = (rec.get("store") or "").strip()
        item = (rec.get("item") or "").strip()
        spec = (rec.get("spec") or "").strip()
        unit = _safe_int(rec.get("unit", 0))
        boxes = _safe_int(rec.get("boxes", 0))
        remainder = _safe_int(rec.get("remainder", 0))
        quantity = (unit * boxes) + remainder
        if quantity <= 0:
            continue

        if store in store_map:
            t = store_map[store]
            dest = (t[0] or store).strip() if isinstance(t, (tuple, list)) and len(t) >= 1 else store
            billing = (t[1] or store).strip() if isinstance(t, (tuple, list)) and len(t) >= 2 else dest
        else:
            dest = store
            billing = store

        unit_price = _lookup_unit_price(item, spec, prices)
        amount = int(round(unit_price * quantity)) if unit_price else 0

        rows.append({
            "納品ID": uuid.uuid4().hex[:8],
            "納品日付": delivery_date_str,
            "農家": farmer_s,
            "納品先": dest,
            "請求先": billing,
            "品目": item,
            "持込日付": carry_date_str,
            "規格": spec,
            "納品単価": unit_price,
            "数量": quantity,
            "納品金額": amount,
            "税率": tax_rate,
            "チェック": "",
        })
    return rows


def delivery_rows_to_v2_format(
    delivery_rows: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """
    納品データ行を v2 形式（差し札用）に戻す。過去データから差し札 PDF を再発行するときに利用する。

    納品データは「数量」を1行で持つため、v2 の unit/boxes/remainder には
    unit=1, boxes=0, remainder=数量 で変換する（1行＝1ラベルとして扱う簡易変換）。
    入数で箱・端数に分けたい場合は、呼び出し側で入数マスタを参照して分割すること。

    Args:
        delivery_rows: 納品データ行のリスト（納品先, 品目, 規格, 数量 等を含む）

    Returns:
        v2 形式のリスト [{"store","item","spec","unit","boxes","remainder"}]
    """
    if not delivery_rows or not isinstance(delivery_rows, list):
        return []
    v2_list: List[Dict[str, Any]] = []
    for row in delivery_rows:
        if not isinstance(row, dict):
            continue
        store = (row.get("納品先") or row.get("store") or "").strip()
        item = (row.get("品目") or row.get("item") or "").strip()
        spec = (row.get("規格") or row.get("spec") or "").strip()
        qty = _safe_int(row.get("数量") or row.get("quantity") or 0)
        if qty <= 0:
            continue
        v2_list.append({
            "store": store,
            "item": item,
            "spec": spec,
            "unit": 1,
            "boxes": 0,
            "remainder": qty,
        })
    return v2_list
