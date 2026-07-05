"""出荷表カードPDFが供給先表示名（系列＋店舗）で生成されることのスモークテスト"""
import os
import re
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.destination import format_supply_destination
from app.services.pdf_generator import LabelPDFGenerator


def _generate(entries):
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        path = tmp.name
    try:
        gen = LabelPDFGenerator(font_path="ipaexg.ttf")  # フォント無し環境でもHelveticaで動く
        gen.generate_shipping_form_pdf(entries, "2026-07-05", path)
        with open(path, "rb") as f:
            return f.read()
    finally:
        if os.path.exists(path):
            os.unlink(path)


def test_one_page_per_entry():
    entries = [
        {
            "store": format_supply_destination("ヨーク", "東道野辺"),
            "item": "トマト",
            "spec": "スタンドパック",
            "unit": 15,
            "boxes": 9,
            "remainder": 5,
            "total_quantity": 140,
            "unit_label": "袋",
        },
        {
            "store": format_supply_destination("寺崎", "寺崎"),
            "item": "トウモロコシ",
            "spec": "40本",
            "unit": 40,
            "boxes": 7,
            "remainder": 20,
            "total_quantity": 300,
            "unit_label": "袋",
        },
    ]
    pdf = _generate(entries)
    assert pdf.startswith(b"%PDF")
    # ReportLab の出力は /Type /Page がページ数+Pages分現れる。ページ数のみ数える
    pages = len(re.findall(rb"/Type\s*/Page\b(?!s)", pdf))
    assert pages == 2


def test_display_names_resolve_before_pdf():
    # PDFに渡る前段の store 文字列が正しく解決されていることを保証する
    assert format_supply_destination("ヨーク", "東道野辺") == "ヨーク 東道野辺"
    assert format_supply_destination("寺崎", "寺崎") == "寺崎"
