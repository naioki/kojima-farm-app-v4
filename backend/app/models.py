"""
Pydantic models — request / response schemas for all API endpoints.
These mirror the Supabase DB schema defined in system_design_v4.md.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field


# ─── OCR ─────────────────────────────────────────────────────────────────────

class ParseRequest(BaseModel):
    verification_id: UUID = Field(..., description="ocr_verifications.id")


class OrderLineInput(BaseModel):
    """A single parsed/corrected line from OCR."""
    store: str
    item: str
    spec: str = ""
    unit: int = Field(0, ge=0)
    boxes: int = Field(0, ge=0)
    remainder: int = Field(0, ge=0)


class ParsedLine(OrderLineInput):
    confidence: float = Field(1.0, ge=0.0, le=1.0, description="0=low, 1=high")


class ParseResponse(BaseModel):
    verification_id: UUID
    parsed_lines: List[ParsedLine]
    confidence_flags: Dict[str, Any] = {}


class VerifyRequest(BaseModel):
    verification_id: UUID
    order_date: date
    corrected_lines: List[OrderLineInput]
    correction_notes: Optional[str] = None
    reviewed_by: Optional[UUID] = None


class VerifyResponse(BaseModel):
    order_id: UUID


# ─── Orders ──────────────────────────────────────────────────────────────────

class OrderLineSummary(BaseModel):
    id: UUID
    customer_name: str
    # 帳票・画面用の供給先表示名（系列＋店舗。例: 「ヨーク 東道野辺」）。
    # customer_name は名寄せ・Sheets同期の既存キーとして生値のまま維持する。
    customer_display: str = ""
    product_name: str
    spec: str
    boxes: int
    remainder: int
    total_qty: int
    unit_price: float
    line_total: float


class OrderSummary(BaseModel):
    id: UUID
    order_date: date
    status: str
    source: str
    line_count: int
    created_at: datetime


class OrderDetail(OrderSummary):
    lines: List[OrderLineSummary]


# ─── Email ───────────────────────────────────────────────────────────────────

class EmailFetchResponse(BaseModel):
    fetched: int = Field(..., description="Number of images found and queued")
    verification_ids: List[UUID]


# ─── Config ──────────────────────────────────────────────────────────────────

class ItemSetting(BaseModel):
    name: str
    default_unit: int
    unit_type: str
    receive_as_boxes: bool = False


class ItemSettingUpdate(BaseModel):
    default_unit: Optional[int] = None
    unit_type: Optional[str] = None
    receive_as_boxes: Optional[bool] = None
