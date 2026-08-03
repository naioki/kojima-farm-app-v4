"""
kojima-farm-app-v4 — FastAPI Backend
"""
import os
from pathlib import Path
from dotenv import load_dotenv

# backend/.env.local を自動ロード（uvicorn が backend/ から起動していない場合も考慮）
_ENV_FILE = Path(__file__).resolve().parent.parent / ".env.local"
if _ENV_FILE.exists():
    load_dotenv(_ENV_FILE, override=False)

import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.auth import auth_enforced, missing_required_env, require_admin, require_user
from app.routers import ocr, orders, email_fetch, config, chat

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if not auth_enforced():
        logger.warning(
            "AUTH_ENFORCED=false のため API 認証を無効化しています。"
            "障害時の一時退避用の設定です。恒久的に使わないでください。"
        )
        yield
        return

    # 設定不足はここで落とす。
    #
    # 起動を通してしまうと、全リクエストが 500（サーバー設定エラー）になり、
    # ログを読むまで原因が分からない状態で本番が動いてしまう。
    # 起動時に落とせば Cloud Run は新しいリビジョンを昇格させず、
    # 直前のリビジョンがそのまま配信を続けるため無停止で気づける。
    missing = missing_required_env()
    if missing:
        message = (
            "起動を中止します。API 認証に必要な環境変数が未設定です: "
            + ", ".join(missing)
            + "。Supabase の Project Settings > API から値を取得し、"
            "バックエンドの環境変数に設定してください"
            "（ANON キーは公開前提の値で、service-role キーとは別物です）。"
            "緊急時は AUTH_ENFORCED=false で認証を一時的に外せます。"
        )
        logger.critical(message)
        raise RuntimeError(message)

    yield

# API ドキュメントは既定で非公開。スキーマは攻撃者にとって地図になるため、
# 開発時に見たい場合だけ EXPOSE_API_DOCS=true で開ける。
_EXPOSE_DOCS = os.environ.get("EXPOSE_API_DOCS", "false").strip().lower() in (
    "true",
    "1",
    "yes",
    "on",
)

app = FastAPI(
    title="小島農園 管理システム API",
    version="4.0.0",
    docs_url="/api/docs" if _EXPOSE_DOCS else None,
    redoc_url="/api/redoc" if _EXPOSE_DOCS else None,
    openapi_url="/api/openapi.json" if _EXPOSE_DOCS else None,
    lifespan=lifespan,
)

# ─── CORS ────────────────────────────────────────────────────────────────────
# Next.js dev server (3000), Vercel, and Cloud Run frontend
ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "https://kojima-farm-app-v4.vercel.app",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    # Cloud Run のフロントエンドURL（*.run.app の両形式）を許可
    allow_origin_regex=r"https://kojima-farm-frontend-.*\.run\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Routers ─────────────────────────────────────────────────────────────────
# 認証はルーター単位でまとめて掛ける。個別エンドポイントに付け忘れても
# 素通りしないようにするため、ここが唯一の入口になっている。
#
#   ocr / orders / email : ログイン済みユーザー（テナント所属が必須）
#   config               : 管理者のみ。IMAP パスワードや外部サービスの
#                          トークンを読み書きするため一段厳しくする
#   chat                 : 外部サービスからの Webhook。Supabase の JWT は
#                          載らないので JWT は要求せず、各 Webhook が
#                          自身の方式で送信元を検証する（routers/chat.py）
app.include_router(
    ocr.router, prefix="/api/ocr", tags=["OCR"], dependencies=[Depends(require_user)]
)
app.include_router(
    orders.router,
    prefix="/api/orders",
    tags=["Orders"],
    dependencies=[Depends(require_user)],
)
app.include_router(
    email_fetch.router,
    prefix="/api/email",
    tags=["Email"],
    dependencies=[Depends(require_user)],
)
app.include_router(
    config.router,
    prefix="/api/config",
    tags=["Config"],
    dependencies=[Depends(require_admin)],
)
app.include_router(chat.router, prefix="/api/chat", tags=["Chat"])


@app.get("/api/health")
async def health():
    """Cloud Run のヘルスチェック用。認証を要求しない唯一のエンドポイント。"""
    return {"status": "ok", "auth_enforced": auth_enforced()}
