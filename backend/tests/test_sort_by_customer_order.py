"""sort_by_customer_order（店舗マスタ並び順ソート）のテスト"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.shipping_sheet import sort_by_customer_order


def test_sorts_by_sort_order_field():
    data = [
        {"store": "八千代台", "item": "トマト", "spec": "", "_sort_order": 9},
        {"store": "習志野台", "item": "トマト", "spec": "", "_sort_order": 1},
        {"store": "青葉台", "item": "トマト", "spec": "", "_sort_order": 2},
    ]
    result = sort_by_customer_order(data)
    assert [row["store"] for row in result] == ["習志野台", "青葉台", "八千代台"]


def test_removes_internal_sort_order_key():
    data = [{"store": "A", "item": "x", "spec": "", "_sort_order": 1}]
    result = sort_by_customer_order(data)
    assert "_sort_order" not in result[0]


def test_missing_sort_order_sorts_to_end():
    data = [
        {"store": "未登録店", "item": "トマト", "spec": ""},  # _sort_order 未設定 → 999扱い
        {"store": "習志野台", "item": "トマト", "spec": "", "_sort_order": 1},
    ]
    result = sort_by_customer_order(data)
    assert result[0]["store"] == "習志野台"
    assert result[1]["store"] == "未登録店"


def test_same_store_sorted_by_item_then_spec():
    data = [
        {"store": "鎌ケ谷", "item": "胡瓜", "spec": "バラ", "_sort_order": 5},
        {"store": "鎌ケ谷", "item": "胡瓜", "spec": "3本P", "_sort_order": 5},
        {"store": "鎌ケ谷", "item": "トマト", "spec": "", "_sort_order": 5},
    ]
    result = sort_by_customer_order(data)
    assert [(row["item"], row["spec"]) for row in result] == [
        ("トマト", ""),
        ("胡瓜", "3本P"),
        ("胡瓜", "バラ"),
    ]


def test_supplier_first_takes_precedence_over_store_order():
    # supplier="B" 側は _sort_order=1（本来なら先頭）だが、supplier_first=True では
    # supplier の文字列比較が最優先されるため "A" が先に来ることを確認する。
    data = [
        {"supplier": "B", "store": "店舗2", "item": "トマト", "spec": "", "_sort_order": 1},
        {"supplier": "A", "store": "店舗1", "item": "トマト", "spec": "", "_sort_order": 2},
    ]
    result = sort_by_customer_order(data, supplier_first=True)
    assert result[0]["supplier"] == "A"
    assert result[1]["supplier"] == "B"


def test_aggregate_then_sort_preserves_store_order():
    """aggregate_order_data の出現順保持ロジックとの組み合わせ確認"""
    from app.services.shipping_sheet import aggregate_order_data

    data = [
        {"store": "八千代台", "item": "トマト", "spec": "", "unit": 10, "boxes": 1, "remainder": 0, "_sort_order": 9},
        {"store": "習志野台", "item": "トマト", "spec": "", "unit": 10, "boxes": 1, "remainder": 0, "_sort_order": 1},
    ]
    sorted_data = sort_by_customer_order(data)
    merged = aggregate_order_data(sorted_data)
    assert [row["store"] for row in merged] == ["習志野台", "八千代台"]
