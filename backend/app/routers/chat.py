"""
チャットボット Webhook ルーター (LINE Works & Discord)
"""
from __future__ import annotations

import os
import re
import httpx
from typing import Any, Dict, Optional
from fastapi import APIRouter, Header, Request, Response, HTTPException
from pydantic import BaseModel

from app.services.chat_automation import fetch_and_parse_for_date, approve_and_queue_print

router = APIRouter()

# 外部チャット通知用のトークン・URL設定（環境変数から取得）
DISCORD_WEBHOOK_URL = os.environ.get("DISCORD_WEBHOOK_URL", "")
LINE_WORKS_BOT_ID = os.environ.get("LINE_WORKS_BOT_ID", "")
LINE_WORKS_API_TOKEN = os.environ.get("LINE_WORKS_API_TOKEN", "") # LINE Works API 2.0 用トークン
GOOGLE_CHAT_WEBHOOK_URL = os.environ.get("GOOGLE_CHAT_WEBHOOK_URL", "")

# LINE Works ユーザー制限リスト（許可するユーザーID、環境変数でカンマ区切り）
ALLOWED_LINE_USERS = [
    u.strip() for u in os.environ.get("ALLOWED_LINE_USERS", "").split(",") if u.strip()
]
ALLOWED_DISCORD_USERS = [
    u.strip() for u in os.environ.get("ALLOWED_DISCORD_USERS", "").split(",") if u.strip()
]


def _send_google_chat_message(card_payload: dict):
    """Google Chat Webhook経由でメッセージ（またはCard v2）を送信"""
    if not GOOGLE_CHAT_WEBHOOK_URL:
        print("[Google Chat Outbound] GOOGLE_CHAT_WEBHOOK_URL is not set")
        return
    
    try:
        r = httpx.post(GOOGLE_CHAT_WEBHOOK_URL, json=card_payload, timeout=10)
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
    """Discord Webhook経由でメッセージ（またはインタラクティブボタン）を送信"""
    if not DISCORD_WEBHOOK_URL:
        print("[Discord Outbound] DISCORD_WEBHOOK_URL is not set")
        return
    
    payload = {"content": content}
    if embeds:
        payload["embeds"] = embeds
    if components:
        payload["components"] = components

    try:
        r = httpx.post(DISCORD_WEBHOOK_URL, json=payload, timeout=10)
        r.raise_for_status()
    except Exception as e:
        print(f"[Discord Outbound] Failed to send message: {e}")


def _send_line_works_message(to_user_id: str, content_object: dict):
    """LINE Works API経由でメッセージを送信"""
    if not LINE_WORKS_BOT_ID or not LINE_WORKS_API_TOKEN:
        print("[LINE Works Outbound] Config missing")
        return

    url = f"https://www.worksapis.com/v1.0/bots/{LINE_WORKS_BOT_ID}/users/{to_user_id}/messages"
    headers = {
        "Authorization": f"Bearer {LINE_WORKS_API_TOKEN}",
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


# ─── Discord Interactions Endpoint (Webhook) ───────────────────────────

class DiscordInteraction(BaseModel):
    type: int
    data: Optional[Dict[str, Any]] = None
    member: Optional[Dict[str, Any]] = None
    user: Optional[Dict[str, Any]] = None
    token: Optional[str] = None
    id: Optional[str] = None


@router.post("/discord")
async def discord_webhook(request: Request):
    """
    Discord からの Interactions Webhook を受信。
    ※ 簡易的な実装のため、署名検証は必要に応じて有効にしてください。
    """
    body = await request.json()
    interaction_type = body.get("type")

    # Discord の生存確認（PING）への応答
    if interaction_type == 1:
        return {"type": 1}

    # ボタン押下やコマンド送信時
    user_info = body.get("member", {}).get("user", {}) or body.get("user", {})
    user_id = user_info.get("id")
    user_name = user_info.get("username", "Unknown")

    # ユーザー制限
    if ALLOWED_DISCORD_USERS and user_id not in ALLOWED_DISCORD_USERS:
        return {
            "type": 4,
            "data": {
                "content": f"⚠️ {user_name} 様は、このシステムの操作権限がありません。"
            }
        }

    # 1. スラッシュコマンドまたはメッセージ受信
    if interaction_type == 2:
        cmd_data = body.get("data", {})
        cmd_name = cmd_data.get("name")
        
        # 例: /order-print [date]
        if cmd_name == "order-print" or cmd_name == "印刷":
            options = cmd_data.get("options", [])
            date_val = None
            for opt in options:
                if opt.get("name") == "date" or opt.get("name") == "日付":
                    date_val = _parse_date(opt.get("value", ""))
            
            if not date_val:
                return {
                    "type": 4,
                    "data": {"content": "⚠️ 正しい日付を指定してください。（例: 2026-06-05）"}
                }

            # 解析非同期トリガー
            # インタラクション制限（3秒）を避けるため、最初に「処理中」を返しつつ裏で動かす
            _send_discord_message(f"🔍 {date_val} 出荷分の注文メールを取得・解析しています。少々お待ちください...")
            
            # バックグラウンド実行（簡易的）
            import asyncio
            asyncio.create_task(_run_fetch_and_parse_discord(date_val, user_id))
            
            return {
                "type": 4,
                "data": {"content": "処理を開始しました。"}
            }

    # 2. ボタンコンポーネント押下（承認ボタンなど）
    elif interaction_type == 3:
        custom_id = body.get("data", {}).get("custom_id", "")
        
        # 承認処理: approve:[verification_id]:[date]
        if custom_id.startswith("approve:"):
            _, verif_id, order_date = custom_id.split(":")
            
            _send_discord_message(f"⚙️ 注文 {order_date} を確定し、自動印刷ジョブを登録しています...")
            
            res = await approve_and_queue_print(verif_id, order_date, reviewed_by=user_id)
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
            
            return {"type": 6} # 応答なしでInteractionを終了

        # 修正モーダルのトリガー: edit_trigger:[verification_id]:[date]
        elif custom_id.startswith("edit_trigger:"):
            _, verif_id, order_date = custom_id.split(":")
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

    # 3. モーダル送信時 (MODAL_SUBMIT)
    elif interaction_type == 5:
        custom_id = body.get("data", {}).get("custom_id", "")
        if custom_id.startswith("edit_modal:"):
            _, verif_id, order_date = custom_id.split(":")
            components = body.get("data", {}).get("components", [])
            notes = ""
            for row in components:
                for comp in row.get("components", []):
                    if comp.get("custom_id") == "notes":
                        notes = comp.get("value", "")

            _send_discord_message(f"⚙️ 注文データを修正しています（指示: 「{notes}」）...")

            # バックグラウンド実行（Gemini 呼び出し時間を考慮）
            import asyncio
            asyncio.create_task(_run_edit_and_preview_discord(verif_id, order_date, notes))
            
            return {"type": 6}

    return {"type": 4, "data": {"content": "不明なコマンドです。"}}


async def _run_fetch_and_parse_discord(date_val: str, user_id: str):
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



# ─── LINE Works Webhook Endpoint ───────────────────────────────────────

@router.post("/lineworks")
async def lineworks_webhook(request: Request):
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
    if ALLOWED_LINE_USERS and user_id not in ALLOWED_LINE_USERS:
        _send_line_works_message(user_id, {"content": {"type": "text", "text": "⚠️ 操作権限がありません。"}})
        return Response(status_code=200)

    # 1. テキストメッセージ受信時
    if event_type == "message":
        content = body.get("content", {})
        content_type = content.get("type")
        
        if content_type == "text":
            text = content.get("text", "").strip()
            date_val = _parse_date(text)
            
            if date_val:
                _send_line_works_message(user_id, {"content": {"type": "text", "text": f"🔍 {date_val} のメール注文を処理しています。お待ちください..."}})
                
                # 非同期実行
                import asyncio
                asyncio.create_task(_run_fetch_and_parse_line(date_val, user_id))
            else:
                _send_line_works_message(user_id, {
                    "content": {
                        "type": "text", 
                        "text": "日付を送信してください。（例: 6/5 や 2026-06-05 と送信すると自動処理が始まります）"
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
            
            res = await approve_and_queue_print(verif_id, order_date)
            if res["success"]:
                _send_line_works_message(user_id, {
                    "content": {
                        "type": "text",
                        "text": f"✅ 印刷キュー登録成功！\n日付: {order_date}\n受注ID: {res['order_id'][:8]}...\n事務所のプリンターより印刷されます。"
                    }
                })
            else:
                _send_line_works_message(user_id, {
                    "content": {
                        "type": "text",
                        "text": f"❌ 登録に失敗しました:\n{res['error']}"
                    }
                })

    return Response(status_code=200)


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
    Google Chat App からのインタラクション（ボタンクリック等）を受信
    """
    body = await request.json()
    event_type = body.get("type")
    
    # Google Chat アプリ追加時の動作確認（PING）
    if event_type == "ADDED_TO_SPACE":
        return {"text": "Kojima Farm Auto Print Agent が追加されました！"}
    
    # ボタンクリックイベント
    if event_type == "CARD_CLICKED":
        action = body.get("action", {})
        method = action.get("actionMethodName")
        
        if method == "approve_order":
            parameters = action.get("parameters", [])
            params = {p["key"]: p["value"] for p in parameters}
            
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
                
    return {"text": "OK"}


