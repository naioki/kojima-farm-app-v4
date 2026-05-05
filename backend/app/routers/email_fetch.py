"""
Email router
GET /api/email/fetch  — IMAP でメールを取得し、添付画像を Supabase Storage にアップロード、
                        ocr_verifications レコードを作成して返す
"""
from __future__ import annotations

import io
import os
import uuid
from datetime import datetime
from typing import List
from uuid import UUID

from fastapi import APIRouter, HTTPException

from app.models import EmailFetchResponse
from app.services.email_reader import check_email_for_orders
from app.services.ocr_parser import parse_order_text, validate_and_fix_order_data
from app.services.supabase_client import get_supabase

router = APIRouter()

# デフォルトテナント（single-tenant 構成）
_DEFAULT_TENANT_ID = os.environ.get(
    "DEFAULT_TENANT_ID", "00000000-0000-0000-0000-000000000001"
)


def _get_email_config() -> dict:
    """
    Supabase の email_config テーブルからメール設定を取得。
    テーブルが存在しない場合は環境変数にフォールバック。
    """
    sb = get_supabase()
    try:
        row = (
            sb.table("email_config")
            .select("*")
            .eq("tenant_id", _DEFAULT_TENANT_ID)
            .single()
            .execute()
        )
        if row.data:
            return row.data
    except Exception:
        pass

    # 環境変数フォールバック
    return {
        "imap_server": os.environ.get("EMAIL_IMAP_SERVER", ""),
        "imap_port": int(os.environ.get("EMAIL_IMAP_PORT", "993")),
        "email_address": os.environ.get("EMAIL_ADDRESS", ""),
        "password": os.environ.get("EMAIL_PASSWORD", ""),
        "sender_email": os.environ.get("EMAIL_SENDER_FILTER", None),
        "days_back": int(os.environ.get("EMAIL_DAYS_BACK", "1")),
    }


@router.get("/fetch", response_model=EmailFetchResponse)
async def fetch_email_orders():
    """
    1. IMAP でメールを取得（check_email_for_orders — v3 互換）
    2. 各添付画像を Supabase Storage にアップロード
    3. ocr_verifications レコードを status=pending で作成
    4. 作成した verification_id のリストを返す
    """
    config = _get_email_config()

    imap_server: str = config.get("imap_server", "")
    imap_port: int = int(config.get("imap_port", 993))
    email_address: str = config.get("email_address", "")
    password: str = config.get("password", "")

    if not all([imap_server, email_address, password]):
        raise HTTPException(
            status_code=503,
            detail="Email configuration incomplete. Set imap_server, email_address, password.",
        )

    sender_filter = config.get("sender_email") or None
    days_back = int(config.get("days_back", 1))

    # IMAP 取得
    try:
        results = check_email_for_orders(
            imap_server=imap_server,
            email_address=email_address,
            password=password,
            sender_email=sender_filter,
            days_back=days_back,
            imap_port=imap_port,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"IMAP fetch failed: {e}")

    sb = get_supabase()
    verification_ids: List[UUID] = []
    api_key = os.environ.get("GEMINI_API_KEY", "")

    # ── 既登録の email_id を一括取得して重複チェック ────────────────────
    try:
        existing_rows = (
            sb.table("ocr_verifications")
            .select("confidence_flags")
            .eq("tenant_id", _DEFAULT_TENANT_ID)
            .execute()
        )
        registered_email_ids: set[str] = set()
        for row in (existing_rows.data or []):
            flags = row.get("confidence_flags") or {}
            eid = flags.get("email_id")
            if eid:
                registered_email_ids.add(str(eid))
    except Exception:
        registered_email_ids = set()

    for result in results:
        email_date: datetime = result.get("date", datetime.now())
        filename: str = result.get("filename", "order.jpg")
        result_type: str = result.get("type", "image")
        email_id: str = str(result.get("email_id", ""))

        # 重複スキップ
        if email_id and email_id in registered_email_ids:
            print(f"[email_fetch] skip duplicate email_id={email_id}")
            continue
        if email_id:
            registered_email_ids.add(email_id)

        verif_id = str(uuid.uuid4())

        if result_type == "text":
            # ── テキストメール: Gemini に直接解析させる ─────────────────
            text_body: str = result.get("text_body", "")
            subject: str = result.get("subject", "")

            image_url = f"text://{verif_id}"  # テキストメール用ダミー URL
            parsed_lines_with_conf = None
            raw_ocr_json = None
            status = "pending"

            if api_key and text_body:
                try:
                    raw = parse_order_text(text_body, api_key)
                    validated, learned_stores, warnings = validate_and_fix_order_data(raw)
                    parsed_lines_with_conf = [
                        {**e, "confidence": 0.5 if any(e.get("store", "") in w or e.get("item", "") in w for w in warnings) else 1.0}
                        for e in validated
                    ]
                    raw_ocr_json = raw
                    status = "needs_review"
                    print(f"[text parse] {subject}: {len(parsed_lines_with_conf)} lines")
                except Exception as e:
                    print(f"[text parse] failed for '{subject}': {e}")

            sb.table("ocr_verifications").insert(
                {
                    "id": verif_id,
                    "tenant_id": _DEFAULT_TENANT_ID,
                    "image_url": image_url,
                    "status": status,
                    "raw_ocr_json": raw_ocr_json,
                    "parsed_lines": parsed_lines_with_conf,
                    "confidence_flags": {
                        "source": "text_email",
                        "subject": subject,
                        "email_id": email_id,
                    },
                }
            ).execute()
            verification_ids.append(UUID(verif_id))

        else:
            # ── 画像メール: Storage へアップロードしてから処理 ───────────
            image = result["image"]

            # PIL → bytes
            buf = io.BytesIO()
            fmt = "JPEG" if image.format in (None, "JPEG") else image.format
            image.save(buf, format=fmt)
            image_bytes = buf.getvalue()
            content_type = "image/jpeg" if fmt == "JPEG" else f"image/{fmt.lower()}"

            # Storage へアップロード
            date_prefix = email_date.strftime("%Y%m%d")
            storage_path = f"fax-images/{date_prefix}/{uuid.uuid4().hex}_{filename}"
            try:
                sb.storage.from_("fax-images").upload(
                    path=storage_path,
                    file=image_bytes,
                    file_options={"content-type": content_type},
                )
            except Exception as e:
                print(f"Storage upload failed: {e}")
                continue

            # 署名付き URL（1 年有効）
            signed = sb.storage.from_("fax-images").create_signed_url(
                path=storage_path, expires_in=365 * 24 * 3600
            )
            image_url = signed.get("signedURL") or signed.get("signedUrl", storage_path)

            sb.table("ocr_verifications").insert(
                {
                    "id": verif_id,
                    "tenant_id": _DEFAULT_TENANT_ID,
                    "image_url": image_url,
                    "status": "pending",
                    "raw_ocr_json": None,
                    "parsed_lines": None,
                    "confidence_flags": {"source": "image_email", "email_id": email_id},
                }
            ).execute()
            verification_ids.append(UUID(verif_id))

    return EmailFetchResponse(
        fetched=len(verification_ids),
        verification_ids=verification_ids,
    )
