"""
Config router
GET  /api/config/items          — 品目設定一覧
PUT  /api/config/items/{name}   — 品目設定更新
GET  /api/config/stores         — 店舗（customers）一覧
GET  /api/config/email          — メール設定取得
PUT  /api/config/email          — メール設定更新
"""
from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.models import ItemSetting, ItemSettingUpdate
from app.services.config_manager import (
    DEFAULT_ITEM_SETTINGS,
    load_item_settings,
    set_item_setting,
    load_stores,
)
from app.services.supabase_client import get_supabase

router = APIRouter()

_DEFAULT_TENANT_ID = os.environ.get(
    "DEFAULT_TENANT_ID", "00000000-0000-0000-0000-000000000001"
)

# .env.local のパス（backend/ 直下）
_ENV_FILE = os.path.join(os.path.dirname(__file__), "..", "..", ".env.local")


def _update_env_file(body: "EmailConfigIn") -> None:
    """email_config テーブルがない場合に .env.local を直接更新する"""
    env_path = os.path.abspath(_ENV_FILE)
    lines: list[str] = []
    if os.path.exists(env_path):
        with open(env_path, encoding="utf-8") as f:
            lines = f.readlines()

    def _set(key: str, value: str) -> None:
        """キーが存在すれば置換、なければ追記"""
        for i, line in enumerate(lines):
            if line.startswith(f"{key}="):
                lines[i] = f"{key}={value}\n"
                return
        lines.append(f"{key}={value}\n")

    _set("EMAIL_IMAP_SERVER", body.imap_server)
    _set("EMAIL_IMAP_PORT", str(body.imap_port))
    _set("EMAIL_ADDRESS", body.email_address)
    if body.password:
        _set("EMAIL_PASSWORD", body.password)
    _set("EMAIL_SENDER_FILTER", body.sender_email or "")
    _set("EMAIL_DAYS_BACK", str(body.days_back))

    with open(env_path, "w", encoding="utf-8") as f:
        f.writelines(lines)


# ─── Items ───────────────────────────────────────────────────────────────────

@router.get("/items", response_model=List[ItemSetting])
async def list_item_settings():
    """品目設定一覧（config_manager の JSON ベース）"""
    settings = load_item_settings()
    return [
        ItemSetting(
            name=name,
            default_unit=s.get("default_unit", 0),
            unit_type=s.get("unit_type", "袋"),
            receive_as_boxes=s.get("receive_as_boxes", False),
        )
        for name, s in settings.items()
    ]


@router.put("/items/{item_name}", response_model=ItemSetting)
async def update_item_setting(item_name: str, body: ItemSettingUpdate):
    """品目設定を更新"""
    settings = load_item_settings()
    current = settings.get(item_name, DEFAULT_ITEM_SETTINGS.get(item_name, {}))

    new_unit = body.default_unit if body.default_unit is not None else current.get("default_unit", 0)
    new_type = body.unit_type if body.unit_type is not None else current.get("unit_type", "袋")
    new_rab = (
        body.receive_as_boxes
        if body.receive_as_boxes is not None
        else current.get("receive_as_boxes", False)
    )

    set_item_setting(item_name, new_unit, new_type, new_rab)
    return ItemSetting(
        name=item_name,
        default_unit=new_unit,
        unit_type=new_type,
        receive_as_boxes=new_rab,
    )


# ─── Stores ──────────────────────────────────────────────────────────────────

class StoreEntry(BaseModel):
    id: Optional[str] = None
    name: str
    store_code: Optional[str] = None
    is_active: bool = True


@router.get("/stores", response_model=List[StoreEntry])
async def list_stores():
    """
    Supabase customers テーブルから取得（RLS bypass with service role）。
    テーブルが空の場合は config_manager の JSON にフォールバック。
    """
    try:
        sb = get_supabase()
        rows = (
            sb.table("customers")
            .select("id, name, store_code, is_active")
            .eq("tenant_id", _DEFAULT_TENANT_ID)
            .eq("is_active", True)
            .order("name")
            .execute()
        )
        if rows.data:
            return [
                StoreEntry(
                    id=r["id"],
                    name=r["name"],
                    store_code=r.get("store_code"),
                    is_active=r["is_active"],
                )
                for r in rows.data
            ]
    except Exception as e:
        print(f"[DEBUG] customers table error: {e}")

    # フォールバック: JSON 設定
    return [StoreEntry(name=s) for s in load_stores()]


# ─── Email Config ─────────────────────────────────────────────────────────────

class EmailConfigOut(BaseModel):
    imap_server: str
    imap_port: int = 993
    email_address: str
    sender_email: Optional[str] = None
    days_back: int = 1
    # パスワードは返さない


class EmailConfigIn(EmailConfigOut):
    password: Optional[str] = None  # 更新時のみ


@router.get("/email", response_model=EmailConfigOut)
async def get_email_config():
    sb = get_supabase()
    try:
        # .single() は行なしで例外を投げるため .limit(1) で安全に取得
        rows = (
            sb.table("email_config")
            .select("imap_server, imap_port, email_address, sender_email, days_back")
            .eq("tenant_id", _DEFAULT_TENANT_ID)
            .limit(1)
            .execute()
        )
        if rows.data:
            return EmailConfigOut(**rows.data[0])
    except Exception as e:
        print(f"[email_config GET] Supabase error: {e}")
    return EmailConfigOut(
        imap_server=os.environ.get("EMAIL_IMAP_SERVER", ""),
        imap_port=int(os.environ.get("EMAIL_IMAP_PORT", "993")),
        email_address=os.environ.get("EMAIL_ADDRESS", ""),
        sender_email=os.environ.get("EMAIL_SENDER_FILTER"),
        days_back=int(os.environ.get("EMAIL_DAYS_BACK", "1")),
    )


@router.put("/email", response_model=EmailConfigOut)
async def update_email_config(body: EmailConfigIn):
    """
    メール設定を保存。
    Supabase の email_config テーブルへの保存を試み、
    テーブルが存在しない、または書き込みエラーの場合は backend/.env.local を直接更新する。
    """
    from pathlib import Path

    # ── Supabase 保存を試みる ──────────────────────────────────────────
    sb = get_supabase()
    payload: Dict[str, Any] = {
        "tenant_id": _DEFAULT_TENANT_ID,
        "imap_server": body.imap_server,
        "imap_port": body.imap_port,
        "email_address": body.email_address,
        "sender_email": body.sender_email,
        "days_back": body.days_back,
    }
    if body.password:
        payload["password"] = body.password

    try:
        # ON CONFLICT 一意制約がない場合でも動くように select + update / insert 構成にする
        check_row = sb.table("email_config").select("id").eq("tenant_id", _DEFAULT_TENANT_ID).limit(1).execute()
        if check_row.data:
            sb.table("email_config").update(payload).eq("tenant_id", _DEFAULT_TENANT_ID).execute()
        else:
            sb.table("email_config").insert(payload).execute()
    except Exception as e:
        print(f"[email_config PUT] Supabase upsert failed, falling back to .env.local: {e}")
        # テーブルが存在しない、または接続エラーの場合は .env.local に書き込む
        _update_env_file(body)

    # 環境変数をプロセス内でも即時反映
    os.environ["EMAIL_IMAP_SERVER"] = body.imap_server
    os.environ["EMAIL_IMAP_PORT"] = str(body.imap_port)
    os.environ["EMAIL_ADDRESS"] = body.email_address
    if body.password:
        os.environ["EMAIL_PASSWORD"] = body.password
    if body.sender_email:
        os.environ["EMAIL_SENDER_FILTER"] = body.sender_email
    os.environ["EMAIL_DAYS_BACK"] = str(body.days_back)

    return EmailConfigOut(
        imap_server=body.imap_server,
        imap_port=body.imap_port,
        email_address=body.email_address,
        sender_email=body.sender_email,
        days_back=body.days_back,
    )
