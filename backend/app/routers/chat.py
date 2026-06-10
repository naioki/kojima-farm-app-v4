"""
チャットボット Webhook ルーター (LINE Works & Discord)
"""
from __future__ import annotations

import os
import re
import hashlib
import hmac
import httpx
from datetime import datetime, timedelta
from typing import Any, Dict, Optional
from fastapi import APIRouter, BackgroundTasks, Header, Request, Response, HTTPException
from pydantic import BaseModel

from app.services.chat_automation import fetch_and_parse_for_date, approve_and_queue_print, get_recent_orders, queue_print_for_existing_order, get_pending_verifications, fetch_recent_emails

router = APIRouter()


def _verify_discord_signature(body_bytes: bytes, signature: str, timestamp: str) -> bool:
    """
    Discord Interactions の Ed25519 署名を検証する。
    DISCORD_PUBLIC_KEY 環境変数が未設定の場合はスキップ（開発環境向け）。
    """
    public_key_hex = os.environ.get("DISCORD_PUBLIC_KEY", "")
    if not public_key_hex:
        # 公開鍵未設定 → 検証スキップ（ローカル開発用フォールバック）
        return True

    try:
        from nacl.signing import VerifyKey
        from nacl.exceptions import BadSignatureError

        verify_key = VerifyKey(bytes.fromhex(public_key_hex))
        message = (timestamp.encode() + body_bytes)
        verify_key.verify(message, bytes.fromhex(signature))
        return True
    except Exception:
        return False

def _get_recent_dates_options() -> list[tuple[str, str]]:
    """
    DBから直近3件の受注日を取得して返す。
    受注がない場合は昨日・今日・明日にフォールバック。
    """
    try:
        sb = get_supabase()
        rows = (
            sb.table("orders")
            .select("order_date")
            .eq("tenant_id", _DEFAULT_TENANT_ID)
            .order("order_date", desc=True)
            .limit(10)  # 重複排除のため多めに取得
            .execute()
        )
        if rows.data:
            today = datetime.now().date()
            seen: set[str] = set()
            result: list[tuple[str, str]] = []
            for r in rows.data:
                d: str = r["order_date"]
                if d in seen:
                    continue
                seen.add(d)
                try:
                    dt = datetime.strptime(d, "%Y-%m-%d").date()
                    diff = (dt - today).days
                    if diff == 0:
                        label = f"今日 ({dt.strftime('%m/%d')})"
                    elif diff == -1:
                        label = f"昨日 ({dt.strftime('%m/%d')})"
                    elif diff == 1:
                        label = f"明日 ({dt.strftime('%m/%d')})"
                    else:
                        weekdays = ["月", "火", "水", "木", "金", "土", "日"]
                        label = f"{dt.strftime('%m/%d')}({weekdays[dt.weekday()]})"
                except Exception:
                    label = d
                result.append((label, d))
                if len(result) >= 3:
                    break
            if result:
                return result
    except Exception as e:
        print(f"[recent_dates] DB取得エラー: {e}")

    # フォールバック: 昨日・今日・明日
    today_dt = datetime.now()
    yesterday = today_dt - timedelta(days=1)
    tomorrow = today_dt + timedelta(days=1)
    return [
        (f"昨日 ({yesterday.strftime('%m/%d')})", yesterday.strftime("%Y-%m-%d")),
        (f"今日 ({today_dt.strftime('%m/%d')})", today_dt.strftime("%Y-%m-%d")),
        (f"明日 ({tomorrow.strftime('%m/%d')})", tomorrow.strftime("%Y-%m-%d")),
    ]


from app.services.supabase_client import get_supabase

_DEFAULT_TENANT_ID = os.environ.get("DEFAULT_TENANT_ID", "00000000-0000-0000-0000-000000000001")

def _get_chat_config() -> dict:
    """Supabase DB の chat_config から設定を取得し、無ければ環境変数から取得（フォールバック）"""
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
            r = rows.data[0]
            return {
                "discord_webhook_url": r.get("discord_webhook_url") or os.environ.get("DISCORD_WEBHOOK_URL", ""),
                "line_works_bot_id": r.get("line_works_bot_id") or os.environ.get("LINE_WORKS_BOT_ID", ""),
                "line_works_api_token": r.get("line_works_api_token") or os.environ.get("LINE_WORKS_API_TOKEN", ""),
                "google_chat_webhook_url": r.get("google_chat_webhook_url") or os.environ.get("GOOGLE_CHAT_WEBHOOK_URL", ""),
                "allowed_line_users": [u.strip() for u in (r.get("allowed_line_users") or os.environ.get("ALLOWED_LINE_USERS", "")).split(",") if u.strip()],
                "allowed_discord_users": [u.strip() for u in (r.get("allowed_discord_users") or os.environ.get("ALLOWED_DISCORD_USERS", "")).split(",") if u.strip()]
            }
    except Exception as e:
        print(f"[chat config fetch error] {e}")
        
    return {
        "discord_webhook_url": os.environ.get("DISCORD_WEBHOOK_URL", ""),
        "line_works_bot_id": os.environ.get("LINE_WORKS_BOT_ID", ""),
        "line_works_api_token": os.environ.get("LINE_WORKS_API_TOKEN", ""),
        "google_chat_webhook_url": os.environ.get("GOOGLE_CHAT_WEBHOOK_URL", ""),
        "allowed_line_users": [u.strip() for u in os.environ.get("ALLOWED_LINE_USERS", "").split(",") if u.strip()],
        "allowed_discord_users": [u.strip() for u in os.environ.get("ALLOWED_DISCORD_USERS", "").split(",") if u.strip()]
    }



def _send_google_chat_message(card_payload: dict):
    """Google Chat Webhook経由でメッセージ（またはCard v2）を送信"""
    config = _get_chat_config()
    url = config["google_chat_webhook_url"]
    if not url:
        print("[Google Chat Outbound] GOOGLE_CHAT_WEBHOOK_URL is not set")
        return
    
    try:
        r = httpx.post(url, json=card_payload, timeout=10)
        r.raise_for_status()
    except Exception as e:
        print(f"[Google Chat Outbound] Failed to send message: {e}")



def _build_google_chat_preview_card(verif_id: str, subject: str, sender: str, date_val: str, lines: list) -> dict:
    """Google Chat 向けの Card v2 プレビューデータを構築"""
    lines_desc = ""
    for idx, line in enumerate(lines):
        lines_desc += f"<b>{idx+1}. {line['store']}</b> ➔ {line['item']} {line.get('spec','')} (入数:{line.get('unit', 0)}): <b>{line.get('boxes',0)}箱 {line.get('remainder',0)}バラ</b><br>"
    
    return {
        "cardsV2": [
            {
                "cardId": f"preview_{verif_id}",
                "card": {
                    "header": {
                        "title": f"📥 受注プレビュー: {subject}",
                        "subtitle": f"送信者: {sender} | 日付: {date_val}"
                    },
                    "sections": [
                        {
                            "header": "読み取り明細",
                            "widgets": [
                                {
                                    "textParagraph": {
                                        "text": lines_desc or "明細なし"
                                    }
                                },
                                {
                                    "buttonList": {
                                        "buttons": [
                                            {
                                                "text": "確定して印刷する",
                                                "onClick": {
                                                    "action": {
                                                        "actionMethodName": "approve_order",
                                                        "parameters": [
                                                            {"key": "verif_id", "value": verif_id},
                                                            {"key": "date", "value": date_val}
                                                        ]
                                                    }
                                                }
                                            }
                                        ]
                                    }
                                }
                            ]
                        }
                    ]
                }
            }
        ]
    }



# ─── ヘルパー ─────────────────────────────────────────────────────────────

def _send_discord_message(content: str, embeds: list = None, components: list = None):
    """
    ボタン(components)なし → Webhook で送信
    ボタンあり → Bot Token API で送信（webhookはcomponents非対応）
    """
    bot_token = os.environ.get("DISCORD_BOT_TOKEN", "")
    channel_id = os.environ.get("DISCORD_CHANNEL_ID", "")

    payload = {"content": content}
    if embeds:
        payload["embeds"] = embeds
    if components:
        payload["components"] = components

    if components and bot_token and channel_id:
        # Bot Token API経由（ボタン対応）
        url = f"https://discord.com/api/v10/channels/{channel_id}/messages"
        headers = {
            "Authorization": f"Bot {bot_token}",
            "Content-Type": "application/json",
        }
        try:
            r = httpx.post(url, json=payload, headers=headers, timeout=10)
            r.raise_for_status()
        except Exception as e:
            print(f"[Discord Bot API] Failed to send message: {e}")
        return

    # Webhook経由（ボタンなし）
    config = _get_chat_config()
    url = config["discord_webhook_url"]
    if not url:
        print("[Discord Outbound] DISCORD_WEBHOOK_URL is not set")
        return
    try:
        r = httpx.post(url, json=payload, timeout=10)
        r.raise_for_status()
    except Exception as e:
        print(f"[Discord Outbound] Failed to send message: {e}")


def _send_line_works_message(to_user_id: str, content_object: dict):
    """LINE Works API経由でメッセージを送信"""
    config = _get_chat_config()
    bot_id = config["line_works_bot_id"]
    token = config["line_works_api_token"]
    if not bot_id or not token:
        print("[LINE Works Outbound] Config missing")
        return

    url = f"https://www.worksapis.com/v1.0/bots/{bot_id}/users/{to_user_id}/messages"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }

    try:
        r = httpx.post(url, json=content_object, headers=headers, timeout=10)
        r.raise_for_status()
    except Exception as e:

        print(f"[LINE Works Outbound] Failed to send message: {e}")


def _parse_date(text: str) -> Optional[str]:
    """「2026-06-05」や「06/05」などの日付形式を YYYY-MM-DD に標準化して抽出"""
    # YYYY-MM-DD
    m1 = re.search(r"(\d{4})[-/](\d{1,2})[-/](\d{1,2})", text)
    if m1:
        return f"{m1.group(1)}-{int(m1.group(2)):02d}-{int(m1.group(3)):02d}"
    
    # MM/DD (年を今年と仮定)
    m2 = re.search(r"(\d{1,2})[-/](\d{1,2})", text)
    if m2:
        year = datetime.now().year
        return f"{year}-{int(m2.group(1)):02d}-{int(m2.group(2)):02d}"
    
    return None


def _resolve_date_from_text(text: str) -> Optional[str]:
    """
    「今日」「明日」「昨日」などの相対表記、メニュー番号「1」「2」「3」、および絶対日付を解析して
    YYYY-MM-DD 形式の文字列を返す。
    """
    # 印刷やいんさつなどのノイズを除去して前後の空白をトリム
    cleaned = re.sub(r"(印刷|いんさつ|いんさつする|出荷|しゅっか|print|please|して|する|分)", "", text, flags=re.IGNORECASE)
    cleaned = cleaned.strip()
    
    today = datetime.now()
    
    # 1. 相対表記のチェック
    if cleaned in ["今日", "きょう", "today"]:
        return today.strftime("%Y-%m-%d")
    elif cleaned in ["明日", "あした", "tomorrow"]:
        return (today + timedelta(days=1)).strftime("%Y-%m-%d")
    elif cleaned in ["昨日", "きのう", "yesterday"]:
        return (today - timedelta(days=1)).strftime("%Y-%m-%d")
        
    # 2. 番号・丸数字・全角数字のチェック (1=昨日, 2=今日, 3=明日)
    if cleaned in ["1", "①", "１"]:
        return (today - timedelta(days=1)).strftime("%Y-%m-%d")
    elif cleaned in ["2", "②", "２"]:
        return today.strftime("%Y-%m-%d")
    elif cleaned in ["3", "③", "３"]:
        return (today + timedelta(days=1)).strftime("%Y-%m-%d")
        
    # 3. 通常の日付パース (クレンジングされたテキスト or オリジナルのテキスト)
    return _parse_date(cleaned) or _parse_date(text)



# ─── Discord Interactions Endpoint (Webhook) ───────────────────────────

class DiscordInteraction(BaseModel):
    type: int
    data: Optional[Dict[str, Any]] = None
    member: Optional[Dict[str, Any]] = None
    user: Optional[Dict[str, Any]] = None
    token: Optional[str] = None
    id: Optional[str] = None


@router.post("/discord")
async def discord_webhook(request: Request, background_tasks: BackgroundTasks):
    """
    Discord からの Interactions Webhook を受信。
    Ed25519 署名検証 + FastAPI BackgroundTasks で確実に処理する。
    """
    # ─── 1. 署名検証（Discord必須）─────────────────────────────────────────
    body_bytes = await request.body()
    signature = request.headers.get("X-Signature-Ed25519", "")
    timestamp = request.headers.get("X-Signature-Timestamp", "")

    if not _verify_discord_signature(body_bytes, signature, timestamp):
        raise HTTPException(status_code=401, detail="Invalid request signature")

    import json
    body = json.loads(body_bytes)
    interaction_type = body.get("type")

    # ─── 2. Discord PING（疎通確認）への即答 ──────────────────────────────
    if interaction_type == 1:
        return {"type": 1}

    # ─── 3. ユーザー情報取得 ────────────────────────────────────────────────
    user_info = body.get("member", {}).get("user", {}) or body.get("user", {})
    user_id = user_info.get("id")
    user_name = user_info.get("username", "Unknown")

    # ─── 4. ユーザー制限 ─────────────────────────────────────────────────────
    cfg = _get_chat_config()
    allowed_users = cfg["allowed_discord_users"]
    if allowed_users and user_id not in allowed_users:
        return {
            "type": 4,
            "data": {
                "content": f"⚠️ {user_name} 様は、このシステムの操作権限がありません。",
                "flags": 64  # Ephemeral（本人のみ表示）
            }
        }

    # ─── 5. スラッシュコマンド（type=2） ────────────────────────────────────
    if interaction_type == 2:
        cmd_data = body.get("data", {})
        cmd_name = cmd_data.get("name")

        if cmd_name in ("未確定", "pending"):
            # 直近3日分のメールを自動取得してから未確定一覧を表示
            background_tasks.add_task(_run_show_pending_discord)
            return {
                "type": 4,
                "data": {"content": "📥 直近3日分のメールを取得中です。少々お待ちください..."}
            }

        elif cmd_name in ("確定済み", "confirmed"):
            # 確定済み受注の最新3件を表示
            weekdays = ["月", "火", "水", "木", "金", "土", "日"]
            recent_orders = get_recent_orders(3)
            if not recent_orders:
                return {"type": 4, "data": {"content": "📭 確定済みの受注がありません。"}}
            buttons = []
            for o in recent_orders:
                d = o["order_date"]
                try:
                    dt = datetime.strptime(d, "%Y-%m-%d")
                    label = f"🖨️ {dt.strftime('%m/%d')}({weekdays[dt.weekday()]}) {o['line_count']}件"
                except Exception:
                    label = f"🖨️ {d} {o['line_count']}件"
                buttons.append({"type": 2, "label": label, "style": 1, "custom_id": f"print_order:{o['id']}:{d}"})
            return {
                "type": 4,
                "data": {
                    "content": "🖨️ 再印刷する受注を選択してください：",
                    "components": [{"type": 1, "components": buttons}]
                }
            }

        elif cmd_name in ("order-print", "印刷"):
            weekdays = ["月", "火", "水", "木", "金", "土", "日"]
            components = []
            lines = []

            # ── 未確定の受注 ──
            pending = get_pending_verifications(3)
            if pending:
                lines.append("📋 **未確定の受注**（タップして確認・承認）")
                pending_buttons = []
                for v in pending:
                    subj = v["subject"][:20] if v["subject"] else "（件名なし）"
                    # created_at から日付を抽出（承認時のデフォルト日付として使用）
                    created_date = v["created_at"][:10] if v["created_at"] else datetime.now().strftime("%Y-%m-%d")
                    pending_buttons.append({
                        "type": 2,
                        "label": f"📋 {subj}",
                        "style": 2,
                        "custom_id": f"preview_verif:{v['verification_id']}:{created_date}"
                    })
                components.append({"type": 1, "components": pending_buttons})

            # ── 確定済みの再印刷 ──
            recent_orders = get_recent_orders(3)
            if recent_orders:
                lines.append("🖨️ **確定済みを再印刷**")
                print_buttons = []
                for o in recent_orders:
                    d = o["order_date"]
                    try:
                        dt = datetime.strptime(d, "%Y-%m-%d")
                        label = f"🖨️ {dt.strftime('%m/%d')}({weekdays[dt.weekday()]}) {o['line_count']}件"
                    except Exception:
                        label = f"🖨️ {d} {o['line_count']}件"
                    print_buttons.append({
                        "type": 2,
                        "label": label,
                        "style": 1,
                        "custom_id": f"print_order:{o['id']}:{d}"
                    })
                components.append({"type": 1, "components": print_buttons})

            if not components:
                return {"type": 4, "data": {"content": "📭 受注データがありません。"}}

            return {
                "type": 4,
                "data": {
                    "content": "\n".join(lines) or "受注を選択してください：",
                    "components": components
                }
            }

    # ─── 6. ボタン押下（type=3） ─────────────────────────────────────────────
    elif interaction_type == 3:
        custom_id = body.get("data", {}).get("custom_id", "")

        if custom_id.startswith("approve:"):
            parts = custom_id.split(":")
            _, verif_id, order_date = parts[0], parts[1], parts[2]
            background_tasks.add_task(_run_approve_and_queue_print_discord, verif_id, order_date, user_id)
            return {"type": 6}

        elif custom_id.startswith("preview_verif:"):
            parts = custom_id.split(":")
            _, verif_id, order_date = parts[0], parts[1], parts[2]
            # 未確定受注のプレビューをボタン付きで返す
            background_tasks.add_task(_run_preview_verif_discord, verif_id, order_date)
            return {"type": 6}

        elif custom_id.startswith("print_order:"):
            parts = custom_id.split(":")
            _, order_id, order_date = parts[0], parts[1], parts[2]
            background_tasks.add_task(_run_print_existing_order_discord, order_id, order_date)
            return {"type": 6}

        elif custom_id.startswith("select_date:"):
            _, order_date = custom_id.split(":")
            background_tasks.add_task(_run_fetch_and_parse_discord, order_date, user_id)
            return {"type": 6}

        elif custom_id.startswith("edit_trigger:"):
            parts = custom_id.split(":")
            _, verif_id, order_date = parts[0], parts[1], parts[2]
            return {
                "type": 9,
                "data": {
                    "title": "注文内容の修正",
                    "custom_id": f"edit_modal:{verif_id}:{order_date}",
                    "components": [
                        {
                            "type": 1,
                            "components": [
                                {
                                    "type": 4,
                                    "custom_id": "notes",
                                    "label": "修正内容を入力（例：1行目を15箱に変更）",
                                    "style": 2,
                                    "placeholder": "例：\n・1行目の数量を 15箱 に変更\n・レタスを 5箱 0バラ に変更",
                                    "required": True
                                }
                            ]
                        }
                    ]
                }
            }

    # ─── 7. モーダル送信（type=5） ───────────────────────────────────────────
    elif interaction_type == 5:
        custom_id = body.get("data", {}).get("custom_id", "")
        if custom_id.startswith("edit_modal:"):
            parts = custom_id.split(":")
            _, verif_id, order_date = parts[0], parts[1], parts[2]
            components = body.get("data", {}).get("components", [])
            notes = ""
            for row in components:
                for comp in row.get("components", []):
                    if comp.get("custom_id") == "notes":
                        notes = comp.get("value", "")

            _send_discord_message(f"⚙️ 注文データを修正しています（指示: 「{notes}」）...")
            background_tasks.add_task(_run_edit_and_preview_discord, verif_id, order_date, notes)
            return {"type": 6}

    return {"type": 4, "data": {"content": "不明なコマンドです。"}}


async def _run_show_pending_discord():
    """直近3日分のメールを取得・解析してから未確定一覧を表示する"""
    # 直近3日分のメールを取得
    fetch_res = await fetch_recent_emails(3)
    new_count = fetch_res.get("new_count", 0)

    # 未確定一覧を取得
    pending = get_pending_verifications(5)

    if not pending:
        msg = "📭 未確定の受注はありません。"
        if new_count > 0:
            msg += f"（{new_count}件の新規メールを取得しましたが、解析結果がありませんでした）"
        _send_discord_message(msg)
        return

    lines_desc = f"📋 未確定の受注が **{len(pending)}件** あります。"
    if new_count > 0:
        lines_desc += f"（うち {new_count}件 は今回新たに取得）"

    buttons = []
    for v in pending:
        subj = v["subject"][:22] if v["subject"] else "（件名なし）"
        created_date = v["created_at"][:10] if v["created_at"] else datetime.now().strftime("%Y-%m-%d")
        buttons.append({
            "type": 2,
            "label": f"📋 {subj}",
            "style": 2,
            "custom_id": f"preview_verif:{v['verification_id']}:{created_date}"
        })

    # Discordのボタンは1行5個まで、最大5行
    rows = []
    for i in range(0, min(len(buttons), 5), 5):
        rows.append({"type": 1, "components": buttons[i:i+5]})

    _send_discord_message(lines_desc, components=rows)


async def _run_preview_verif_discord(verif_id: str, order_date: str):
    """未確定verificationの内容をプレビュー表示し、承認ボタンを送る"""
    from app.services.supabase_client import get_supabase
    sb = get_supabase()
    try:
        row = sb.table("ocr_verifications").select("parsed_lines, confidence_flags, status").eq("id", verif_id).limit(1).execute()
        if not row.data:
            _send_discord_message(f"❌ 検証レコードが見つかりません: `{verif_id[:8]}...`")
            return
        v = row.data[0]
        flags = v.get("confidence_flags") or {}
        subject = flags.get("subject", "（件名なし）")
        from_addr = flags.get("from", "")
        lines = v.get("parsed_lines") or []
    except Exception as e:
        _send_discord_message(f"❌ データ取得失敗: {e}")
        return

    lines_desc = ""
    for line in lines:
        lines_desc += f"- {line.get('store','')} ➔ {line.get('item','')} {line.get('spec','')} (入数:{line.get('unit',0)}): **{line.get('boxes',0)}箱 {line.get('remainder',0)}バラ**\n"

    embed = {
        "title": f"📋 未確定受注プレビュー: {subject}",
        "description": f"送信者: `{from_addr}`\n出荷日: **{order_date}**\n\n**明細:**\n{lines_desc or '明細なし'}",
        "color": 15105570,
    }
    components = [{
        "type": 1,
        "components": [
            {"type": 2, "label": "✅ 確定して印刷する", "style": 3, "custom_id": f"approve:{verif_id}:{order_date}"},
            {"type": 2, "label": "✏️ 修正する", "style": 2, "custom_id": f"edit_trigger:{verif_id}:{order_date}"},
        ]
    }]
    _send_discord_message("未確定受注の内容を確認してください。", embeds=[embed], components=components)


async def _run_print_existing_order_discord(order_id: str, order_date: str):
    _send_discord_message(f"⚙️ {order_date} の出荷ラベルを生成しています...")
    res = await queue_print_for_existing_order(order_id, order_date)
    if res["success"]:
        embeds = [{
            "title": "✅ 印刷キュー登録完了",
            "description": f"日付: **{order_date}**\n受注ID: `{order_id[:8]}...`\n印刷ジョブID: `{res['job_id'][:8]}...`\n明細数: {res['line_count']} 件",
            "color": 3066993,
        }]
        _send_discord_message("🖨️ 事務所のPCで自動印刷が開始されます。", embeds=embeds)
    else:
        _send_discord_message(f"❌ 印刷キュー登録に失敗しました:\n**{res['error']}**")


async def _run_fetch_and_parse_discord(date_val: str, user_id: str):
    _send_discord_message(f"🔍 {date_val} 出荷分の注文メールを取得・解析しています。少々お待ちください...")
    res = await fetch_and_parse_for_date(date_val)
    if not res["success"]:
        _send_discord_message(f"❌ 解析失敗: {res['error']}")
        return

    verifs = res["verifications"]
    if not verifs:
        _send_discord_message(f"📭 {date_val} 受信の新規の注文メールはありませんでした。")
        return

    # 解析結果をボタン付きで送信
    for v in verifs:
        lines_desc = ""
        for line in v["lines"]:
            lines_desc += f"- {line['store']} ➔ {line['item']} {line.get('spec','')} (入数:{line.get('unit', 0)}): **{line.get('boxes',0)}箱 {line.get('remainder',0)}バラ**\n"

        embed = {
            "title": f"📥 受注プレビュー: {v['subject']}",
            "description": f"送信者: `{v['from']}`\n\n**読み取り明細:**\n{lines_desc or '明細なし'}",
            "color": 3447003
        }

        components = [
            {
                "type": 1,
                "components": [
                    {
                        "type": 2,
                        "label": "確定して印刷する",
                        "style": 1,
                        "custom_id": f"approve:{v['verification_id']}:{date_val}"
                    },
                    {
                        "type": 2,
                        "label": "修正する",
                        "style": 2,
                        "custom_id": f"edit_trigger:{v['verification_id']}:{date_val}"
                    }
                ]
            }
        ]

        _send_discord_message(f"【{date_val}】の注文を確認してください。", embeds=[embed], components=components)

        # Google Chat にもプレビューを送信
        gc_card = _build_google_chat_preview_card(v['verification_id'], v['subject'], v['from'], date_val, v['lines'])
        _send_google_chat_message(gc_card)


async def _run_approve_and_queue_print_discord(verif_id: str, order_date: str, user_id: str):
    _send_discord_message(f"⚙️ 注文 {order_date} を確定し、自動印刷ジョブを登録しています...")
    # Discord user_id はUUID形式ではないのでNoneを渡しadminプロフィールを使用
    res = await approve_and_queue_print(verif_id, order_date, reviewed_by=None)
    if res["success"]:
        # 完了通知
        embeds = [
            {
                "title": "✅ 注文確定 ＆ 印刷キュー登録完了",
                "description": f"日付: **{order_date}**\n受注ID: `{res['order_id'][:8]}...`\n印刷ジョブID: `{res['job_id'][:8]}...`",
                "color": 3066993,
                "fields": [
                    {"name": "注文店舗", "value": ", ".join(list({l["store"] for l in res["lines"]})) or "なし", "inline": True},
                    {"name": "総明細数", "value": f"{len(res['lines'])} 件", "inline": True}
                ]
            }
        ]
        _send_discord_message(f"🖨️ 事務所のPCで自動印刷が開始されます。", embeds=embeds)
    else:
        _send_discord_message(f"❌ 確定処理に失敗しました:\n**{res['error']}**")



# ─── LINE Works Webhook Endpoint ───────────────────────────────────────

@router.post("/lineworks")
async def lineworks_webhook(request: Request, background_tasks: BackgroundTasks):
    """
    LINE Works からの Webhook イベントを受信
    """
    body = await request.json()
    event_type = body.get("type")
    source = body.get("source", {})
    user_id = source.get("userId")

    if not user_id:
        return Response(status_code=200)

    # ユーザー制限
    config = _get_chat_config()
    allowed_users = config["allowed_line_users"]
    if allowed_users and user_id not in allowed_users:
        _send_line_works_message(user_id, {"content": {"type": "text", "text": "⚠️ 操作権限がありません。"}})
        return Response(status_code=200)


    # 1. テキストメッセージ受信時
    if event_type == "message":
        content = body.get("content", {})
        content_type = content.get("type")
        
        if content_type == "text":
            text = content.get("text", "").strip()
            
            if text == "印刷" or text == "いんさつ":
                options = _get_recent_dates_options()
                actions = [
                    {
                        "type": "postback",
                        "label": label,
                        "data": f"action=select_date&date={val}"
                    }
                    for label, val in options
                ]
                
                content_text = "📅 処理する出荷日を選択してください：\n"
                for idx, (label, val) in enumerate(options):
                    content_text += f"\n{idx+1}. {label}"
                content_text += "\n\n上のボタンをタップするか、番号（1〜3）や「今日」「明日」などの文字をそのまま送信してください。"
                
                message_object = {
                    "content": {
                        "type": "button_template",
                        "contentText": content_text,
                        "actions": actions
                    }
                }
                _send_line_works_message(user_id, message_object)
            else:
                date_val = _resolve_date_from_text(text)
                if date_val:
                    _send_line_works_message(user_id, {"content": {"type": "text", "text": f"🔍 {date_val} のメール注文を処理しています。お待ちください..."}})
                    
                    # 非同期実行
                    import asyncio
                    asyncio.create_task(_run_fetch_and_parse_line(date_val, user_id))
                else:
                    _send_line_works_message(user_id, {
                        "content": {
                            "type": "text", 
                            "text": "日付または番号を選択してください。（例: 「今日」「明日」や番号の「2」と送信するか、単に「印刷」と送信すると日付選択ボタンが表示されます）"
                        }
                    })


    # 2. ポストバック（ボタンクリックイベント）
    elif event_type == "postback":
        data = body.get("data", "")
        # データフォーマット: action=approve&id=uuid&date=2026-06-05
        params = dict(x.split("=") for x in data.split("&"))
        
        if params.get("action") == "approve":
            verif_id = params.get("id")
            order_date = params.get("date")
            
            _send_line_works_message(user_id, {"content": {"type": "text", "text": f"⚙️ {order_date} 分を登録し、印刷を開始します..."}})
            background_tasks.add_task(_run_approve_and_queue_print_line, verif_id, order_date, user_id)

        elif params.get("action") == "select_date":
            order_date = params.get("date")
            _send_line_works_message(user_id, {"content": {"type": "text", "text": f"🔍 {order_date} のメール注文を処理しています。お待ちください..."}})
            import asyncio
            asyncio.create_task(_run_fetch_and_parse_line(order_date, user_id))


    return Response(status_code=200)


async def _run_approve_and_queue_print_line(verif_id: str, order_date: str, user_id: str):
    res = await approve_and_queue_print(verif_id, order_date, reviewed_by=None)
    if res["success"]:
        _send_line_works_message(user_id, {
            "content": {
                "type": "text",
                "text": f"✅ 印刷キュー登録成功！\n日付: {order_date}\n受注ID: {res['order_id'][:8]}...\n事務所のプリンターより印刷されます。"
            }
        })
    else:
        _send_line_works_message(user_id, {
            "content": {"type": "text", "text": f"❌ 登録に失敗しました:\n{res['error']}"}
        })


async def _run_fetch_and_parse_line(date_val: str, user_id: str):
    res = await fetch_and_parse_for_date(date_val)
    if not res["success"]:
        _send_line_works_message(user_id, {"content": {"type": "text", "text": f"❌ エラー: {res['error']}"}})
        return

    verifs = res["verifications"]
    if not verifs:
        _send_line_works_message(user_id, {"content": {"type": "text", "text": f"📭 {date_val} の新規注文メールはありませんでした。"}})
        return

    # LINE Works 向けにボタンメッセージ（Link / Action Template）を構築して送信
    for v in verifs:
        lines_desc = ""
        for line in v["lines"]:
            lines_desc += f"・{line['store']}: {line['item']} {line.get('spec','')} ➔ {line.get('boxes',0)}箱 {line.get('remainder',0)}袋\n"

        # 簡易的なボタンプッシュ構成（LINE Works Button Template）
        message_object = {
            "content": {
                "type": "button_template",
                "contentText": f"📥 受注プレビュー: {v['subject']}\n\n{lines_desc}\n登録して自動印刷しますか？",
                "actions": [
                    {
                        "type": "postback",
                        "label": "はい、印刷する",
                        "data": f"action=approve&id={v['verification_id']}&date={date_val}"
                    }
                ]
            }
        }
        _send_line_works_message(user_id, message_object)


async def _run_edit_and_preview_discord(verif_id: str, order_date: str, notes: str):
    """
    ユーザーからのテキスト指示に基づいて注文データを修正し、
    更新されたプレビューと承認・修正ボタンを Discord に送信するバックグラウンドタスク。
    """
    from app.services.chat_automation import modify_verification_lines
    res = await modify_verification_lines(verif_id, notes)
    
    if res["success"]:
        lines_desc = ""
        for idx, line in enumerate(res["lines"]):
            lines_desc += f"{idx+1}. {line['store']} ➔ {line['item']} {line.get('spec','')} (入数:{line.get('unit', 0)}): **{line.get('boxes',0)}箱 {line.get('remainder',0)}バラ**\n"
        
        embed = {
            "title": f"📥 受注プレビュー (修正後): {res['subject']}",
            "description": f"送信者: `{res['from']}`\n\n**修正後の明細:**\n{lines_desc or '明細なし'}",
            "color": 3447003
        }
        
        components = [
            {
                "type": 1,
                "components": [
                    {
                        "type": 2,
                        "label": "確定して印刷する",
                        "style": 1,
                        "custom_id": f"approve:{verif_id}:{order_date}"
                    },
                    {
                        "type": 2,
                        "label": "修正する",
                        "style": 2,
                        "custom_id": f"edit_trigger:{verif_id}:{order_date}"
                    }
                ]
            }
        ]
        _send_discord_message(f"【{order_date}】の注文データを更新しました。確認してください。", embeds=[embed], components=components)

        # Google Chat にも更新後のプレビューを送信
        gc_card = _build_google_chat_preview_card(verif_id, res['subject'], res['from'], order_date, res['lines'])
        _send_google_chat_message(gc_card)
    else:
        _send_discord_message(f"❌ 修正処理に失敗しました:\n**{res['error']}**")


@router.post("/googlechat")
async def googlechat_webhook(request: Request):
    """
    Google Chat App からのインタラクション（メッセージ送信、ボタンクリック等）を受信
    """
    body = await request.json()
    event_type = body.get("type")
    
    # Google Chat アプリ追加時の動作確認（PING）
    if event_type == "ADDED_TO_SPACE":
        return {"text": "Kojima Farm Auto Print Agent が追加されました！"}
    
    # 1. ユーザーからのメッセージ送信時
    if event_type == "MESSAGE":
        text = body.get("message", {}).get("text", "").strip()
        
        if text in ["印刷", "いんさつ", "いんさつする", "print"]:
            # 日付指定なし ➔ 日付選択ボタンをカード形式で返す
            options = _get_recent_dates_options()
            buttons = [
                {
                    "text": label,
                    "onClick": {
                        "action": {
                            "actionMethodName": "select_date",
                            "parameters": [
                                {"key": "date", "value": val}
                            ]
                        }
                    }
                }
                for label, val in options
            ]
            
            card_text = "📅 処理する出荷日を選択してください：<br>"
            for idx, (label, val) in enumerate(options):
                card_text += f"<br><b>{idx+1}. {label}</b>"
            card_text += "<br><br>上のボタンをタップするか、番号（1〜3）や「今日」「明日」などの文字をそのまま送信してください。"
            
            return {
                "cardsV2": [
                    {
                        "cardId": "select_date_card",
                        "card": {
                            "header": {
                                "title": "📅 出荷日の選択",
                                "subtitle": "処理する注文の出荷日を選択してください"
                            },
                            "sections": [
                                {
                                    "widgets": [
                                        {
                                            "textParagraph": {
                                                "text": card_text
                                            }
                                        },
                                        {
                                            "buttonList": {
                                                "buttons": buttons
                                            }
                                        }
                                    ]
                                }
                            ]
                        }
                    }
                ]
            }
        else:
            date_val = _resolve_date_from_text(text)
            if date_val:
                _send_google_chat_message({"text": f"🔍 {date_val} のメール注文を処理しています。お待ちください..."})
                import asyncio
                asyncio.create_task(_run_fetch_and_parse_googlechat(date_val))
                return {"text": "処理を開始しました。"}
            else:
                return {"text": "日付または番号を選択してください。（例: 「今日」「明日」や番号の「2」と送信するか、単に「印刷」と送信すると日付選択ボタンが表示されます）"}

    # 2. ボタンクリック等のカード操作時
    elif event_type == "CARD_CLICKED":
        action = body.get("action", {})
        method = action.get("actionMethodName")
        parameters = action.get("parameters", [])
        params = {p["key"]: p["value"] for p in parameters}
        
        # 確定処理
        if method == "approve_order":
            verif_id = params.get("verif_id")
            order_date = params.get("date")
            user_name = body.get("user", {}).get("displayName", "Google Chat User")
            
            # 確定中の通知
            _send_google_chat_message({
                "text": f"⚙️ 注文 {order_date} を確定し、自動印刷ジョブを登録しています (操作者: {user_name})..."
            })
            
            res = await approve_and_queue_print(verif_id, order_date)
            if res["success"]:
                return {
                    "actionResponse": {
                        "type": "UPDATE_MESSAGE"
                    },
                    "cardsV2": [
                        {
                            "cardId": f"success_{verif_id}",
                            "card": {
                                "header": {
                                    "title": "✅ 注文確定 ＆ 印刷キュー登録完了",
                                    "subtitle": f"日付: {order_date}"
                                },
                                "sections": [
                                    {
                                        "widgets": [
                                            {
                                                "textParagraph": {
                                                    "text": f"注文店舗: {', '.join(list({l['store'] for l in res['lines']})) or 'なし'}<br>総明細数: {len(res['lines'])} 件<br><br>🖨️ 事務所のPCで自動印刷が開始されます。"
                                                }
                                            }
                                        ]
                                    }
                                ]
                            }
                        }
                    ]
                }
            else:
                return {
                    "actionResponse": {
                        "type": "UPDATE_MESSAGE"
                    },
                    "cardsV2": [
                        {
                            "cardId": f"error_{verif_id}",
                            "card": {
                                "header": {
                                    "title": "❌ 確定処理に失敗しました",
                                    "subtitle": res["error"]
                                }
                            }
                        }
                    ]
                }
        
        # 日付選択ボタン押下時
        elif method == "select_date":
            order_date = params.get("date")
            
            _send_google_chat_message({"text": f"🔍 {order_date} 出荷分の注文メールを取得・解析しています。少々お待ちください..."})
            import asyncio
            asyncio.create_task(_run_fetch_and_parse_googlechat(order_date))
            
            return {
                "actionResponse": {
                    "type": "UPDATE_MESSAGE"
                },
                "cardsV2": [
                    {
                        "cardId": f"fetching_{order_date}",
                        "card": {
                            "header": {
                                "title": f"⚙️ 処理を開始しました",
                                "subtitle": f"日付: {order_date}"
                            }
                        }
                    }
                ]
            }
                
    return {"text": "OK"}


async def _run_fetch_and_parse_googlechat(date_val: str):
    """Google Chat 向けの非同期メール取得・解析タスク"""
    res = await fetch_and_parse_for_date(date_val)
    if not res["success"]:
        _send_google_chat_message({"text": f"❌ 解析失敗: {res['error']}"})
        return

    verifs = res["verifications"]
    if not verifs:
        _send_google_chat_message({"text": f"📭 {date_val} 受信の新規の注文メールはありませんでした。"})
        return

    for v in verifs:
        card = _build_google_chat_preview_card(v['verification_id'], v['subject'], v['from'], date_val, v['lines'])
        _send_google_chat_message(card)



