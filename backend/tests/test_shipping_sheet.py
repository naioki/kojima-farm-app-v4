"""aggregate_order_data の合算・remainder 繰り上げ正規化のテスト"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.shipping_sheet import aggregate_order_data


def test_merge_same_key_with_remainder_carry():
    # 胡瓜バラ×複数注文: remainder 合算が unit を超えたら箱に繰り上げる
    data = [
        {"store": "鎌ケ谷", "item": "胡瓜", "spec": "バラ", "unit": 50, "boxes": 2, "remainder": 30},
        {"store": "鎌ケ谷", "item": "胡瓜", "spec": "バラ", "unit": 50, "boxes": 1, "remainder": 40},
    ]
    result = aggregate_order_data(data)
    assert len(result) == 1
    row = result[0]
    # boxes: 2+1=3, remainder: 30+40=70 → boxes+1=4, remainder=20
    assert row["boxes"] == 4
    assert row["remainder"] == 20
    assert row["unit"] == 50


def test_different_spec_not_merged():
    data = [
        {"store": "鎌ケ谷", "item": "胡瓜", "spec": "3本P", "unit": 40, "boxes": 1, "remainder": 0},
        {"store": "鎌ケ谷", "item": "胡瓜", "spec": "バラ", "unit": 50, "boxes": 1, "remainder": 0},
    ]
    result = aggregate_order_data(data)
    assert len(result) == 2


def test_unit_zero_passthrough():
    # unit=0 の行はゼロ除算せずそのまま合算される
    data = [
        {"store": "A", "item": "トマト", "spec": "", "unit": 0, "boxes": 0, "remainder": 5},
        {"store": "A", "item": "トマト", "spec": "", "unit": 0, "boxes": 0, "remainder": 3},
    ]
    result = aggregate_order_data(data)
    assert len(result) == 1
    assert result[0]["remainder"] == 8
