"""供給先表示名リゾルバ（destination.py）のテスト

表記ルール:
  - 系列あり + 店舗あり            → 「ヨーク 東道野辺」
  - 系列のみ（store == supplier）  → 「寺崎」
  - 系列なし（旧データ互換）       → 「東道野辺」
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.destination import customer_display_name, format_supply_destination


def test_supplier_and_store():
    assert format_supply_destination("ヨーク", "東道野辺") == "ヨーク 東道野辺"


def test_supplier_only_when_same_as_store():
    # 店舗指定不要の業者（寺崎）は name = supplier_name で登録する運用
    assert format_supply_destination("寺崎", "寺崎") == "寺崎"


def test_supplier_only_when_store_empty():
    assert format_supply_destination("寺崎", "") == "寺崎"
    assert format_supply_destination("寺崎", None) == "寺崎"


def test_store_only_backward_compat():
    # supplier_name 未設定の旧データは従来どおり店舗名のみ
    assert format_supply_destination(None, "東道野辺") == "東道野辺"
    assert format_supply_destination("", "東道野辺") == "東道野辺"


def test_whitespace_normalization():
    assert format_supply_destination(" ヨーク ", " 東道野辺 ") == "ヨーク 東道野辺"
    assert format_supply_destination("  ", "東道野辺") == "東道野辺"


def test_both_empty():
    assert format_supply_destination(None, None) == ""


def test_customer_display_name_from_row():
    assert customer_display_name({"name": "東道野辺", "supplier_name": "ヨーク"}) == "ヨーク 東道野辺"
    assert customer_display_name({"name": "寺崎", "supplier_name": "寺崎"}) == "寺崎"
    # supplier_name カラムがまだ無い環境（マイグレーション未適用）でも落ちない
    assert customer_display_name({"name": "東道野辺"}) == "東道野辺"
