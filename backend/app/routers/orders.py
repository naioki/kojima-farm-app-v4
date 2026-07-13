"""
Orders router
GET  /api/orders              — 注文一覧
GET  /api/orders/{id}         — 注文詳細（明細付き）
GET  /api/orders/{id}/pdf     — 出荷ラベル PDF を生成してストリーム返却
POST /api/orders/{id}/sync-sheets — Google Sheets へ同期
"""
from __future__ import annotations

import io
import os
import tempfile
from datetime import date
from typing import Any, Dict, List
from uuid import UUID

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.models import OrderDetail, OrderLineSummary, OrderSummary
from app.services.destination import format_supply_destination, split_supply_destination
from app.services.ocr_parser import generate_labels_from_data, generate_summary_table
from app.services.shipping_sheet import sort_by_customer_order
from app.services.supabase_client import get_supabase

router = APIRouter()

# フォントパス（assets/ に ipaexg.ttf をバンドル）
_FONT_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "assets", "ipaexg.ttf")


# ─── 共通: 注文明細を一括取得してオブジェクトに整形 ─────────────────────────

def _select_customers(sb, customer_ids: List[str]) -> List[Dict[str, Any]]:
    """customers を supplier_name 付きで取得。旧スキーマ（列なし）にもフォールバック。"""
    try:
        rows = (
            sb.table("customers")
            .select("id, name, supplier_name, sort_order")
            .in_("id", customer_ids)
            .execute()
        )
    except Exception:
        rows = (
            sb.table("customers")
            .select("id, name")
            .in_("id", customer_ids)
            .execute()
        )
    return rows.data or []


def _fetch_order_lines(sb, order_id: str) -> List[OrderLineSummary]:
    """
    order_lines + customers + product_standards + products を
    最小クエリ数（N+1 なし）で取得して返す。
    """
    lines_rows = (
        sb.table("order_lines")
        .select(
            "id, customer_id, product_standard_id, boxes, remainder, total_qty, unit_price, line_total"
        )
        .eq("order_id", order_id)
        .execute()
    )
    if not lines_rows.data:
        return []

    # 必要な ID を一括収集
    customer_ids = list({lr["customer_id"] for lr in lines_rows.data if lr.get("customer_id")})
    ps_ids       = list({lr["product_standard_id"] for lr in lines_rows.data if lr.get("product_standard_id")})

    # 一括フェッチ（supplier_name 未適用の環境でも動くようフォールバックする）
    customers: Dict[str, str] = {}
    customer_display: Dict[str, str] = {}
    if customer_ids:
        cust_rows = _select_customers(sb, customer_ids)
        customers = {r["id"]: r["name"] for r in cust_rows}
        customer_display = {
            r["id"]: format_supply_destination(r.get("supplier_name"), r["name"])
            for r in cust_rows
        }

    ps_map: Dict[str, Dict[str, Any]] = {}
    if ps_ids:
        ps_rows = (
            sb.table("product_standards")
            .select("id, name, unit_size, products(name)")
            .in_("id", ps_ids)
            .execute()
        )
        for r in (ps_rows.data or []):
            prod = r.get("products")
            ps_map[r["id"]] = {
                "spec": r.get("name", ""),
                "unit_size": int(r.get("unit_size") or 0),
                "product_name": prod.get("name", "") if isinstance(prod, dict) else "",
            }

    lines: List[OrderLineSummary] = []
    for lr in lines_rows.data:
        ps = ps_map.get(lr.get("product_standard_id", ""), {})
        lines.append(
            OrderLineSummary(
                id=lr["id"],
                customer_name=customers.get(lr.get("customer_id", ""), ""),
                customer_display=customer_display.get(lr.get("customer_id", ""), ""),
                product_name=ps.get("product_name", ""),
                spec=ps.get("spec", ""),
                boxes=lr["boxes"],
                remainder=lr["remainder"],
                total_qty=lr["total_qty"],
                unit_price=float(lr["unit_price"] or 0),
                line_total=float(lr["line_total"] or 0),
            )
        )
    return lines


# ─── GET /api/orders ─────────────────────────────────────────────────────────

@router.get("", response_model=List[OrderSummary])
async def list_orders(limit: int = 50, offset: int = 0):
    """最近の注文一覧（ページネーション付き）— 明細数は集計クエリで取得"""
    sb = get_supabase()

    # order_lines の count を orders に join して N+1 を排除
    rows = (
        sb.table("orders")
        .select("id, order_date, status, source, created_at, order_lines(id)")
        .order("order_date", desc=True)
        .range(offset, offset + limit - 1)
        .execute()
    )

    result = []
    for r in (rows.data or []):
        line_count = len(r.get("order_lines") or [])
        result.append(
            OrderSummary(
                id=r["id"],
                order_date=r["order_date"],
                status=r["status"],
                source=r["source"],
                line_count=line_count,
                created_at=r["created_at"],
            )
        )
    return result


# ─── GET /api/orders/{id} ────────────────────────────────────────────────────

# ─── GET /api/orders/shipping-sheet/pdf ─────────────────────────────────────
# 注意: パスパラメータ /{order_id} より前に定義すること（ルーティング順依存）

@router.get("/shipping-sheet/pdf")
async def download_shipping_sheet_pdf(
    target_date: date,
    product_id: str | None = None,
    paper_size: str = "A4",
):
    """
    品目別出荷票（パック作業用の「出荷表」カード）PDF。
    - 指定日の注文を対象（単日。パック時に使うため範囲指定は不要）
    - product_id 省略時は全品目
    - 同一 (店舗, 品目, 規格, 入数) は複数注文をまたいで合算し、1明細=1ページの出荷表にする
    - paper_size は "A4" または "A5"（既定 A4）
    """
    paper_size = paper_size.upper()
    if paper_size not in ("A4", "A5"):
        raise HTTPException(status_code=400, detail="paper_size は A4 または A5 を指定してください")
    from app.services.shipping_sheet import aggregate_order_data

    sb = get_supabase()

    # 指定日の注文（キャンセル除外）
    orders_rows = (
        sb.table("orders")
        .select("id, order_date")
        .eq("order_date", target_date.isoformat())
        .neq("status", "cancelled")
        .execute()
    )
    order_ids = [r["id"] for r in (orders_rows.data or [])]
    if not order_ids:
        raise HTTPException(status_code=404, detail="指定日に該当する注文がありません")

    lines_rows = (
        sb.table("order_lines")
        .select("customer_id, product_standard_id, boxes, remainder")
        .in_("order_id", order_ids)
        .execute()
    )

    customer_ids = list({lr["customer_id"] for lr in (lines_rows.data or []) if lr.get("customer_id")})
    ps_ids       = list({lr["product_standard_id"] for lr in (lines_rows.data or []) if lr.get("product_standard_id")})

    # 供給先は系列（例: ヨーク）と店舗名（東道野辺／寺崎）を分けて持つ。
    # 系列は出荷票タイトル・出荷一覧表の見出しに1回だけ出し、行の店舗名は短く保つ。
    customer_supplier: Dict[str, str] = {}
    customer_store: Dict[str, str] = {}
    customer_sort: Dict[str, int] = {}
    if customer_ids:
        for r in _select_customers(sb, customer_ids):
            supplier, store = split_supply_destination(r.get("supplier_name"), r["name"])
            customer_supplier[r["id"]] = supplier
            customer_store[r["id"]] = store
            customer_sort[r["id"]] = r.get("sort_order") or 999

    ps_map: Dict[str, Dict[str, Any]] = {}
    if ps_ids:
        p = (
            sb.table("product_standards")
            .select("id, name, unit_size, product_id, products(id, name)")
            .in_("id", ps_ids)
            .execute()
        )
        for r in (p.data or []):
            prod = r.get("products")
            ps_map[r["id"]] = {
                "spec": r.get("name", ""),
                "unit_size": int(r.get("unit_size") or 0),
                "product_id": r.get("product_id", ""),
                "product_name": prod.get("name", "") if isinstance(prod, dict) else "",
            }

    # 品目フィルタは必ず products.id（UUID）で行う。名前文字列でのマッチは禁止
    order_data = []
    product_name = None
    for lr in (lines_rows.data or []):
        ps = ps_map.get(lr.get("product_standard_id", ""), {})
        if product_id and ps.get("product_id") != product_id:
            continue
        if product_id:
            product_name = ps.get("product_name") or product_name
        cid = lr.get("customer_id", "")
        order_data.append({
            "supplier": customer_supplier.get(cid, ""),
            "store": customer_store.get(cid, ""),
            "item": ps.get("product_name", ""),
            "spec": ps.get("spec", ""),
            "unit": ps.get("unit_size", 0),
            "boxes": lr["boxes"],
            "remainder": lr["remainder"],
            "_sort_order": customer_sort.get(cid, 999),
        })

    if not order_data:
        raise HTTPException(status_code=404, detail="指定日に該当する品目の注文がありません")

    # Supabase の返却順は ORDER BY 無しでは不定（呼ぶたびにページ順が変わる）ため、
    # 系列→店舗マスタの並び順（customers.sort_order）→品目名→規格で明示的に並べ替えて固定する。
    order_data = sort_by_customer_order(order_data, supplier_first=True)

    # 合算 → 出荷一覧表と同じ集計形式（total_quantity / unit_label 付き）に変換
    merged = aggregate_order_data(order_data)
    entries = generate_summary_table(merged)

    from app.services.pdf_generator import LabelPDFGenerator

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp_path = tmp.name
    try:
        generator = LabelPDFGenerator(font_path=_FONT_PATH)
        generator.generate_shipping_form_pdf(entries, target_date.isoformat(), tmp_path, paper_size=paper_size)
        with open(tmp_path, "rb") as f:
            pdf_bytes = f.read()
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)

    filename = f"shipping_form_{target_date.isoformat()}.pdf"
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{order_id}", response_model=OrderDetail)
async def get_order(order_id: UUID):
    sb = get_supabase()
    order_row = (
        sb.table("orders")
        .select("id, order_date, status, source, created_at")
        .eq("id", str(order_id))
        .single()
        .execute()
    )
    if not order_row.data:
        raise HTTPException(status_code=404, detail="order not found")
    o = order_row.data

    lines = _fetch_order_lines(sb, str(order_id))

    return OrderDetail(
        id=o["id"],
        order_date=o["order_date"],
        status=o["status"],
        source=o["source"],
        line_count=len(lines),
        created_at=o["created_at"],
        lines=lines,
    )


# ─── GET /api/orders/{id}/pdf ────────────────────────────────────────────────

@router.get("/{order_id}/pdf")
async def download_pdf(order_id: UUID, reverse: int = 0):
    """
    order_lines → label list → LabelPDFGenerator → PDF stream
    """
    sb = get_supabase()

    order_row = (
        sb.table("orders")
        .select("id, order_date, status")
        .eq("id", str(order_id))
        .single()
        .execute()
    )
    if not order_row.data:
        raise HTTPException(status_code=404, detail="order not found")
    order_date: str = order_row.data["order_date"]

    lines = _fetch_order_lines(sb, str(order_id))

    # v3 互換フォーマットに変換（unit_size が必要なため直接 DB から取得）
    lines_rows = (
        sb.table("order_lines")
        .select("customer_id, product_standard_id, boxes, remainder, total_qty")
        .eq("order_id", str(order_id))
        .execute()
    )

    customer_ids = list({lr["customer_id"] for lr in (lines_rows.data or []) if lr.get("customer_id")})
    ps_ids       = list({lr["product_standard_id"] for lr in (lines_rows.data or []) if lr.get("product_standard_id")})

    # 個装ラベル・出荷一覧表とも店舗名は系列を省いた短い表示にする（系列は一覧表の見出しに1回だけ）。
    customer_supplier: Dict[str, str] = {}
    customer_store_only: Dict[str, str] = {}
    customer_sort: Dict[str, int] = {}
    if customer_ids:
        for r in _select_customers(sb, customer_ids):
            supplier, store_only = split_supply_destination(r.get("supplier_name"), r["name"])
            customer_supplier[r["id"]] = supplier
            customer_store_only[r["id"]] = store_only
            customer_sort[r["id"]] = r.get("sort_order") or 999

    ps_map: Dict[str, Dict[str, Any]] = {}
    if ps_ids:
        p = sb.table("product_standards").select("id, name, unit_size, unit_type, products(name)").in_("id", ps_ids).execute()
        for r in (p.data or []):
            prod = r.get("products")
            ps_map[r["id"]] = {
                "spec": r.get("name", ""),
                "unit_size": int(r.get("unit_size") or 0),
                "unit_type": r.get("unit_type") or "",  # DBの単位を取得
                "product_name": prod.get("name", "") if isinstance(prod, dict) else "",
            }

    order_data = []
    for lr in (lines_rows.data or []):
        ps = ps_map.get(lr.get("product_standard_id", ""), {})
        cid = lr.get("customer_id", "")
        order_data.append({
            "store": customer_store_only.get(cid, ""),
            "supplier": customer_supplier.get(cid, ""),
            "item": ps.get("product_name", ""),
            "spec": ps.get("spec", ""),
            "unit": ps.get("unit_size", 0),
            "unit_type": ps.get("unit_type", ""),  # DBの単位をそのまま渡す
            "boxes": lr["boxes"],
            "remainder": lr["remainder"],
            "_sort_order": customer_sort.get(cid, 999),
        })

    # Supabase の返却順は不定なため、店舗マスタで設定した並び順（customers.sort_order）
    # →品目名→規格の順で明示的に固定する（一覧表・ラベルとも同じ順になる）。
    order_data = sort_by_customer_order(order_data)

    if reverse:
        order_data = list(reversed(order_data))

    labels = generate_labels_from_data(order_data, order_date)
    summary_data = generate_summary_table(order_data)

    from app.services.pdf_generator import LabelPDFGenerator

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp_path = tmp.name

    try:
        generator = LabelPDFGenerator(font_path=_FONT_PATH)
        generator.generate_pdf(labels, summary_data, order_date, tmp_path)
        with open(tmp_path, "rb") as f:
            pdf_bytes = f.read()
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)

    date_str = order_date.replace('-', '')
    from urllib.parse import quote
    encoded = quote(f"出荷ラベル_{date_str}.pdf")
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{encoded}"},
    )


# ─── POST /api/orders/{id}/sync-sheets ──────────────────────────────────────

async def _get_order_data(order_id: UUID) -> OrderDetail:
    """内部ヘルパー: get_order ルートハンドラを直接呼ばず DB から取得"""
    sb = get_supabase()
    order_row = (
        sb.table("orders")
        .select("id, order_date, status, source, created_at")
        .eq("id", str(order_id))
        .single()
        .execute()
    )
    if not order_row.data:
        raise HTTPException(status_code=404, detail="order not found")
    o = order_row.data
    lines = _fetch_order_lines(sb, str(order_id))
    return OrderDetail(
        id=o["id"],
        order_date=o["order_date"],
        status=o["status"],
        source=o["source"],
        line_count=len(lines),
        created_at=o["created_at"],
        lines=lines,
    )


@router.post("/{order_id}/sync-sheets")
async def sync_to_sheets(order_id: UUID):
    """Google Sheets へ delivery rows を追記"""
    from app.services.delivery_converter import v2_result_to_delivery_rows
    from app.services.delivery_sheet_writer import append_delivery_rows, is_sheet_configured

    if not is_sheet_configured():
        raise HTTPException(status_code=503, detail="Google Sheets not configured")

    order_detail = await _get_order_data(order_id)
    v2_data = [
        {
            "store": line.customer_name,
            "item": line.product_name,
            "spec": line.spec,
            "unit": line.total_qty // (line.boxes or 1) if line.boxes else line.total_qty,
            "boxes": line.boxes,
            "remainder": line.remainder,
        }
        for line in order_detail.lines
    ]
    rows = v2_result_to_delivery_rows(v2_data, str(order_detail.order_date))
    append_delivery_rows(rows)
    return {"synced": len(rows)}
