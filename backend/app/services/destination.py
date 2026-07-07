"""
供給先（仕向け先）表示名の解決 — 単一の真実の源

帳票（出荷表・出荷ラベル・出荷一覧表）や画面に出す「供給先」の文字列は
必ずこのモジュールで組み立てる。表記ルールをコード各所に散らばせない。

ルール（Kojima-Farm-Shipping-Management-App の「取引先 ＞ 納入先」と同じ意味論）:
  - 系列あり + 店舗あり            → 「ヨーク 東道野辺」
  - 系列のみ（store == supplier）  → 「寺崎」
  - 系列なし（旧データ互換）       → 「東道野辺」
"""
from __future__ import annotations

from typing import Any, Dict, Optional


def format_supply_destination(supplier_name: Optional[str], store_name: Optional[str]) -> str:
    """系列（中間業者名）と店舗名から帳票用の供給先表示名を返す。

    どちらの引数も None / 空白のみを許容する（DBのNULL・旧データ互換）。
    """
    supplier = (supplier_name or "").strip()
    store = (store_name or "").strip()

    if not supplier:
        return store
    if not store or store == supplier:
        return supplier
    return f"{supplier} {store}"


def customer_display_name(customer: Dict[str, Any]) -> str:
    """customers テーブルの行（dict）から供給先表示名を返す。"""
    return format_supply_destination(customer.get("supplier_name"), customer.get("name"))
