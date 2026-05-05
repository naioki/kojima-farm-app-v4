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
from app.services.ocr_parser import generate_labels_from_data, generate_summary_table
from app.services.supabase_client import get_supabase

router = APIRouter()

# フォントパス（assets/ に ipaexg.ttf をバンドル）
_FONT_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "assets", "ipaexg.ttf")


# ─── 共通: 注文明細を一括取得してオブジェクトに整形 ─────────────────────────

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

    # 一括フェッチ
    customers: Dict[str, str] = {}
    if customer_ids:
        cust_rows = (
            sb.table("customers")
            .select("id, name")
            .in_("id", customer_ids)
            .execute()
        )
        customers = {r["id"]: r["name"] for r in (cust_rows.data or [])}

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
async def download_pdf(order_id: UUID):
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

    customers: Dict[str, str] = {}
    if customer_ids:
        c = sb.table("customers").select("id, name").in_("id", customer_ids).execute()
        customers = {r["id"]: r["name"] for r in (c.data or [])}

    ps_map: Dict[str, Dict[str, Any]] = {}
    if ps_ids:
        p = sb.table("product_standards").select("id, name, unit_size, products(name)").in_("id", ps_ids).execute()
        for r in (p.data or []):
            prod = r.get("products")
            ps_map[r["id"]] = {
                "spec": r.get("name", ""),
                "unit_size": int(r.get("unit_size") or 0),
                "product_name": prod.get("name", "") if isinstance(prod, dict) else "",
            }

    order_data = []
    for lr in (lines_rows.data or []):
        ps = ps_map.get(lr.get("product_standard_id", ""), {})
        order_data.append({
            "store": customers.get(lr.get("customer_id", ""), ""),
            "item": ps.get("product_name", ""),
            "spec": ps.get("spec", ""),
            "unit": ps.get("unit_size", 0),
            "boxes": lr["boxes"],
            "remainder": lr["remainder"],
        })

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

    filename = f"labels_{order_date}_{str(order_id)[:8]}.pdf"
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
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
