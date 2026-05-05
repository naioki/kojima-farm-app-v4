"""
OCR router
POST /api/ocr/parse   — Gemini で画像を解析して parsed_lines を保存
POST /api/ocr/verify  — 人間が確認した行を確定し、注文レコードを作成
"""
from __future__ import annotations

import io
import os
import uuid
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException
from PIL import Image

from app.models import ParseRequest, ParseResponse, ParsedLine, VerifyRequest, VerifyResponse
from app.services.ocr_parser import parse_order_image, validate_and_fix_order_data
from app.services.supabase_client import get_supabase

router = APIRouter()


# ─── helpers ─────────────────────────────────────────────────────────────────

def _download_image(image_url: str) -> Image.Image:
    """Supabase Storage の署名付き URL から画像を取得"""
    import httpx
    resp = httpx.get(image_url, timeout=30)
    resp.raise_for_status()
    return Image.open(io.BytesIO(resp.content))


def _get_tenant_id_for_verification(verification_id: str) -> str:
    sb = get_supabase()
    row = (
        sb.table("ocr_verifications")
        .select("tenant_id")
        .eq("id", str(verification_id))
        .single()
        .execute()
    )
    if not row.data:
        raise HTTPException(status_code=404, detail="verification not found")
    return row.data["tenant_id"]


# ─── POST /api/ocr/parse ─────────────────────────────────────────────────────

@router.post("/parse", response_model=ParseResponse)
async def parse_verification(req: ParseRequest):
    """
    1. ocr_verifications から image_url を取得
    2. Supabase Storage から画像をダウンロード
    3. Gemini で解析 → validate_and_fix_order_data
    4. parsed_lines / confidence_flags を DB に保存
    5. status を needs_review に更新
    """
    sb = get_supabase()
    verification_id = str(req.verification_id)

    # 検証レコード取得
    row = (
        sb.table("ocr_verifications")
        .select("id, tenant_id, image_url, status")
        .eq("id", verification_id)
        .single()
        .execute()
    )
    if not row.data:
        raise HTTPException(status_code=404, detail="verification not found")

    verif = row.data
    image_url: str = verif["image_url"]

    # 画像ダウンロード
    try:
        image = _download_image(image_url)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"image download failed: {e}")

    # Gemini 解析
    api_key = os.environ.get("GEMINI_API_KEY", "")
    if not api_key:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not configured")

    try:
        raw_result = parse_order_image(image, api_key)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Gemini parse failed: {e}")

    if not raw_result:
        raise HTTPException(status_code=422, detail="Gemini returned empty result")

    # バリデーション
    validated, learned_stores, warnings = validate_and_fix_order_data(raw_result)

    # confidence_flags: 警告がある行を低信頼度としてマーク
    confidence_flags: Dict[str, Any] = {
        "warnings": warnings,
        "learned_stores": learned_stores,
    }

    # parsed_lines に confidence を付与（警告がある行は低信頼度）
    parsed_lines_with_conf = []
    for entry in validated:
        conf = 1.0
        for w in warnings:
            if entry.get("store", "") in w or entry.get("item", "") in w:
                conf = 0.5
                break
        parsed_lines_with_conf.append({**entry, "confidence": conf})

    # DB 更新
    sb.table("ocr_verifications").update(
        {
            "raw_ocr_json": raw_result,
            "parsed_lines": parsed_lines_with_conf,
            "confidence_flags": confidence_flags,
            "status": "needs_review",
        }
    ).eq("id", verification_id).execute()

    return ParseResponse(
        verification_id=req.verification_id,
        parsed_lines=[ParsedLine(**line) for line in parsed_lines_with_conf],
        confidence_flags=confidence_flags,
    )


# ─── POST /api/ocr/verify ────────────────────────────────────────────────────

@router.post("/verify", response_model=VerifyResponse)
async def verify_and_approve(req: VerifyRequest):
    """
    人間が確認・修正した行を受け取り、既存の approve_ocr_verification RPC を呼び出す。
    RPC が order を作成し order_id を返す。
    """
    sb = get_supabase()
    verification_id = str(req.verification_id)

    # RPC 呼び出し (system_design_v4.md で定義済み)
    # approve_ocr_verification(p_verification_id, p_tenant_id, p_reviewed_by,
    #                           p_order_date, p_correction_notes, p_lines)
    tenant_id = _get_tenant_id_for_verification(verification_id)

    # reviewed_by: JWTからの取得は未実装のため、今はサービスロールで仮ID使用
    # TODO: NextJS から JWT を受け取り、sub (user uuid) を渡す
    reviewed_by = "00000000-0000-0000-0000-000000000000"

    lines_payload = [
        {
            "store": line.store,
            "item": line.item,
            "spec": line.spec,
            "unit": line.unit,
            "boxes": line.boxes,
            "remainder": line.remainder,
        }
        for line in req.corrected_lines
    ]

    result = sb.rpc(
        "approve_ocr_verification",
        {
            "p_verification_id": verification_id,
            "p_tenant_id": tenant_id,
            "p_reviewed_by": reviewed_by,
            "p_order_date": str(req.order_date),
            "p_correction_notes": req.correction_notes or "",
            "p_lines": lines_payload,
        },
    ).execute()

    if not result.data:
        raise HTTPException(status_code=500, detail="RPC returned no order_id")

    order_id = result.data
    return VerifyResponse(order_id=order_id)
