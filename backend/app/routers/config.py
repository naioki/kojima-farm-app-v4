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
    load_items,
)
from app.services.supabase_client import get_supabase
from app.services import prompt_manager

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



# ─── Chat Config ──────────────────────────────────────────────────────────────

class ChatConfigOut(BaseModel):
    discord_webhook_url: Optional[str] = None
    line_works_bot_id: Optional[str] = None
    line_works_api_token: Optional[str] = None
    google_chat_webhook_url: Optional[str] = None
    allowed_line_users: Optional[str] = None
    allowed_discord_users: Optional[str] = None


@router.get("/chat", response_model=ChatConfigOut)
async def get_chat_config():
    sb = get_supabase()
    try:
        rows = (
            sb.table("chat_config")
            .select("discord_webhook_url, line_works_bot_id, line_works_api_token, google_chat_webhook_url, allowed_line_users, allowed_discord_users")
            .eq("tenant_id", _DEFAULT_TENANT_ID)
            .limit(1)
            .execute()
        )
        if rows.data:
            return ChatConfigOut(**rows.data[0])
    except Exception as e:
        print(f"[chat_config GET] Supabase error: {e}")
    
    # フォールバックとして現在の環境変数を返す
    return ChatConfigOut(
        discord_webhook_url=os.environ.get("DISCORD_WEBHOOK_URL", ""),
        line_works_bot_id=os.environ.get("LINE_WORKS_BOT_ID", ""),
        line_works_api_token=os.environ.get("LINE_WORKS_API_TOKEN", ""),
        google_chat_webhook_url=os.environ.get("GOOGLE_CHAT_WEBHOOK_URL", ""),
        allowed_line_users=os.environ.get("ALLOWED_LINE_USERS", ""),
        allowed_discord_users=os.environ.get("ALLOWED_DISCORD_USERS", ""),
    )


@router.put("/chat", response_model=ChatConfigOut)
async def update_chat_config(body: ChatConfigOut):
    sb = get_supabase()
    payload = {
        "tenant_id": _DEFAULT_TENANT_ID,
        "discord_webhook_url": body.discord_webhook_url or "",
        "line_works_bot_id": body.line_works_bot_id or "",
        "line_works_api_token": body.line_works_api_token or "",
        "google_chat_webhook_url": body.google_chat_webhook_url or "",
        "allowed_line_users": body.allowed_line_users or "",
        "allowed_discord_users": body.allowed_discord_users or "",
    }
    
    try:
        check_row = sb.table("chat_config").select("id").eq("tenant_id", _DEFAULT_TENANT_ID).limit(1).execute()
        if check_row.data:
            sb.table("chat_config").update(payload).eq("tenant_id", _DEFAULT_TENANT_ID).execute()
        else:
            sb.table("chat_config").insert(payload).execute()
    except Exception as e:
        print(f"[chat_config PUT] Supabase upsert failed: {e}")
        raise HTTPException(status_code=500, detail=f"Database save failed: {e}")

    # 環境変数をプロセス内でも即時反映
    os.environ["DISCORD_WEBHOOK_URL"] = body.discord_webhook_url or ""
    os.environ["LINE_WORKS_BOT_ID"] = body.line_works_bot_id or ""
    os.environ["LINE_WORKS_API_TOKEN"] = body.line_works_api_token or ""
    os.environ["GOOGLE_CHAT_WEBHOOK_URL"] = body.google_chat_webhook_url or ""
    os.environ["ALLOWED_LINE_USERS"] = body.allowed_line_users or ""
    os.environ["ALLOWED_DISCORD_USERS"] = body.allowed_discord_users or ""

    return body


# ─── Prompt Config（AIプロンプト設定） ──────────────────────────────────────────

class PromptConfigOut(BaseModel):
    image_prompt: Optional[str] = None
    text_prompt: Optional[str] = None
    is_custom_enabled: bool = False
    version: int = 1
    # フロントが内蔵デフォルトを表示できるよう同梱
    default_image_prompt: str = prompt_manager.DEFAULT_IMAGE_PROMPT
    default_text_prompt: str = prompt_manager.DEFAULT_TEXT_PROMPT
    required_image_placeholders: List[str] = prompt_manager.REQUIRED_IMAGE_PLACEHOLDERS
    required_text_placeholders: List[str] = prompt_manager.REQUIRED_TEXT_PLACEHOLDERS


class PromptConfigIn(BaseModel):
    image_prompt: Optional[str] = None
    text_prompt: Optional[str] = None
    is_custom_enabled: bool = False
    saved_by: Optional[str] = None


class PromptTestIn(BaseModel):
    kind: str  # "image" | "text"
    prompt: str
    sample_text: Optional[str] = None  # text の dry-run 用


class PromptTestOut(BaseModel):
    ok: bool
    missing_placeholders: List[str] = []
    parsed: Optional[List[Dict[str, Any]]] = None
    message: str = ""


class PromptHistoryEntry(BaseModel):
    version: int
    image_prompt: Optional[str] = None
    text_prompt: Optional[str] = None
    is_custom_enabled: bool = False
    saved_by: Optional[str] = None
    created_at: Optional[str] = None


@router.get("/prompt", response_model=PromptConfigOut)
async def get_prompt_config():
    sb = get_supabase()
    try:
        rows = (
            sb.table("prompt_config")
            .select("image_prompt, text_prompt, is_custom_enabled, version")
            .eq("tenant_id", _DEFAULT_TENANT_ID)
            .limit(1)
            .execute()
        )
        if rows.data:
            r = rows.data[0]
            return PromptConfigOut(
                image_prompt=r.get("image_prompt"),
                text_prompt=r.get("text_prompt"),
                is_custom_enabled=r.get("is_custom_enabled", False),
                version=r.get("version", 1),
            )
    except Exception as e:
        print(f"[prompt_config GET] Supabase error: {e}")
    return PromptConfigOut()


@router.put("/prompt", response_model=PromptConfigOut)
async def update_prompt_config(body: PromptConfigIn):
    """
    プロンプト設定を保存。
    フェイルセーフ:
      - カスタムを有効化する場合は必須プレースホルダ検証を強制（欠落なら 400）
      - 保存前に現行設定を prompt_config_history へ退避（ロールバック用）
    """
    # ── 検証（カスタム有効時のみ厳格に）────────────────────────────────
    if body.is_custom_enabled:
        if body.image_prompt:
            miss = prompt_manager.validate_prompt(body.image_prompt, "image")
            if miss:
                raise HTTPException(
                    status_code=400,
                    detail=f"画像プロンプトに必須項目が不足: {', '.join(miss)}",
                )
        if body.text_prompt:
            miss = prompt_manager.validate_prompt(body.text_prompt, "text")
            if miss:
                raise HTTPException(
                    status_code=400,
                    detail=f"テキストプロンプトに必須項目が不足: {', '.join(miss)}",
                )

    sb = get_supabase()
    try:
        existing = (
            sb.table("prompt_config")
            .select("image_prompt, text_prompt, is_custom_enabled, version")
            .eq("tenant_id", _DEFAULT_TENANT_ID)
            .limit(1)
            .execute()
        )
        prev = existing.data[0] if existing.data else None
        prev_version = (prev or {}).get("version", 0) or 0

        # 現行設定を履歴へ退避
        if prev:
            try:
                sb.table("prompt_config_history").insert({
                    "tenant_id": _DEFAULT_TENANT_ID,
                    "version": prev_version,
                    "image_prompt": prev.get("image_prompt"),
                    "text_prompt": prev.get("text_prompt"),
                    "is_custom_enabled": prev.get("is_custom_enabled", False),
                    "saved_by": body.saved_by,
                }).execute()
            except Exception as he:
                print(f"[prompt_config PUT] history insert skipped: {he}")

        new_version = prev_version + 1
        payload = {
            "tenant_id": _DEFAULT_TENANT_ID,
            "image_prompt": body.image_prompt,
            "text_prompt": body.text_prompt,
            "is_custom_enabled": body.is_custom_enabled,
            "version": new_version,
        }
        if prev:
            sb.table("prompt_config").update(payload).eq("tenant_id", _DEFAULT_TENANT_ID).execute()
        else:
            sb.table("prompt_config").insert(payload).execute()

        return PromptConfigOut(
            image_prompt=body.image_prompt,
            text_prompt=body.text_prompt,
            is_custom_enabled=body.is_custom_enabled,
            version=new_version,
        )
    except HTTPException:
        raise
    except Exception as e:
        print(f"[prompt_config PUT] error: {e}")
        raise HTTPException(status_code=500, detail=f"保存に失敗しました: {e}")


@router.post("/prompt/test", response_model=PromptTestOut)
async def test_prompt(body: PromptTestIn):
    """
    保存前のドライラン。
      1) 必須プレースホルダ検証（常時）
      2) text かつ sample_text あり → 実際に Gemini で解析して結果を返す
    """
    missing = prompt_manager.validate_prompt(body.prompt, body.kind)
    if missing:
        return PromptTestOut(
            ok=False,
            missing_placeholders=missing,
            message=f"必須項目が不足しています: {', '.join(missing)}",
        )

    if body.kind == "text" and body.sample_text:
        api_key = os.environ.get("GEMINI_API_KEY", "")
        if not api_key:
            return PromptTestOut(ok=True, message="検証OK（GEMINI_API_KEY 未設定のため実解析はスキップ）")
        try:
            from app.services.ocr_parser import _generate_with_fallback, _extract_json
            store_list = "、".join(load_stores())
            import json as _json
            norm = _json.dumps(load_items(), ensure_ascii=False, indent=2)
            rendered = prompt_manager.render_prompt(
                body.prompt, store_list=store_list,
                item_normalization=norm, text_body=body.sample_text,
            )
            text = _generate_with_fallback(api_key, [rendered])
            parsed = _extract_json(text)
            return PromptTestOut(
                ok=True, parsed=parsed,
                message=f"解析成功: {len(parsed)} 件を抽出しました",
            )
        except Exception as e:
            return PromptTestOut(ok=False, message=f"解析エラー: {e}")

    return PromptTestOut(ok=True, message="検証OK（必須項目あり）")


@router.get("/prompt/history", response_model=List[PromptHistoryEntry])
async def get_prompt_history():
    sb = get_supabase()
    try:
        rows = (
            sb.table("prompt_config_history")
            .select("version, image_prompt, text_prompt, is_custom_enabled, saved_by, created_at")
            .eq("tenant_id", _DEFAULT_TENANT_ID)
            .order("version", desc=True)
            .limit(20)
            .execute()
        )
        return [PromptHistoryEntry(**r) for r in (rows.data or [])]
    except Exception as e:
        print(f"[prompt_history GET] error: {e}")
        return []

