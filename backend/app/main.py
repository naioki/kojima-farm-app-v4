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

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import ocr, orders, email_fetch, config, chat

app = FastAPI(
    title="小島農園 管理システム API",
    version="4.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

# ─── CORS ────────────────────────────────────────────────────────────────────
# Next.js dev server (3000) and production Vercel domain
ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "https://kojima-farm-app-v4.vercel.app",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Routers ─────────────────────────────────────────────────────────────────
app.include_router(ocr.router,          prefix="/api/ocr",    tags=["OCR"])
app.include_router(orders.router,       prefix="/api/orders", tags=["Orders"])
app.include_router(email_fetch.router,  prefix="/api/email",  tags=["Email"])
app.include_router(config.router,       prefix="/api/config", tags=["Config"])
app.include_router(chat.router,         prefix="/api/chat",   tags=["Chat"])


@app.get("/api/health")
async def health():
    return {"status": "ok"}
