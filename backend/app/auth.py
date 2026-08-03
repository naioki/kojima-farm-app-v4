"""
Supabase JWT 認証 — FastAPI バックエンド共通の認可基盤。

## 解決している問題

このプロセスは Supabase の **service-role キー**を持っている（services/supabase_client.py）。
service-role キーは RLS を丸ごとバイパスするため、エンドポイントが無認証だと
URL を知っているだけで次のことができてしまう状態だった：

- `GET  /api/orders/{id}/pdf`   全顧客の出荷情報を取得
- `POST /api/ocr/verify`        受注を勝手に作成
- `PUT  /api/config/email`      IMAP パスワードを上書き（.env.local にも書き込まれる）
- `GET  /api/config/chat`       LINE Works API トークンを平文で読み出し
- `GET  /api/email/fetch`       メールボックスを走らせる

さらに tenant_id は「呼び出し元」ではなく「対象レコード自身」から引いていたため、
マルチテナントのスキーマがあってもテナント境界が検証されていなかった。

## 方針

- Next.js / ブラウザは Supabase のアクセストークンを `Authorization: Bearer <jwt>` で送る。
- 検証は Supabase Auth の `GET /auth/v1/user` に委譲する。ローカルで署名検証をしないので
  **署名アルゴリズムに依存しない**（現在の HS256 でも、非対称鍵へ移行した後でも動く）。
  追加の共有シークレットを backend に置く必要もない。
- 検証結果は短時間キャッシュするので、連続リクエストでも往復は1回に収まる。
- 呼び出し元の tenant_id / role は `profiles` テーブルから引く。
  **リクエストボディや対象レコードからは絶対に取らない。**

## 障害時の逃げ道

`AUTH_ENFORCED=false` を設定すると検証をスキップし、改修前と同じ挙動に戻る。
デプロイし直さずに認証を切れるようにするための緊急用で、恒久的な設定ではない。
詳細は docs/ROLLBACK.md を参照。
"""

from __future__ import annotations

import hashlib
import logging
import os
import time
from dataclasses import dataclass
from typing import Dict, Optional, Tuple

import httpx
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.services.supabase_client import get_supabase

logger = logging.getLogger(__name__)

# 検証済みトークンのキャッシュ保持時間。短くしているのは、Supabase 側で
# ユーザーを無効化した場合の反映を最大この秒数までに抑えるため。
_TOKEN_CACHE_TTL_SECONDS = 60
_TOKEN_CACHE_MAX_ENTRIES = 512
_AUTH_HTTP_TIMEOUT_SECONDS = 10.0

_DEFAULT_TENANT_ID = os.environ.get(
    "DEFAULT_TENANT_ID", "00000000-0000-0000-0000-000000000001"
)

# key: トークンの SHA-256（生のトークンをキーに残さないため）
# value: (キャッシュ失効時刻, 認証コンテキスト)
_token_cache: Dict[str, Tuple[float, "AuthContext"]] = {}

_bearer_scheme = HTTPBearer(auto_error=False, description="Supabase アクセストークン")


@dataclass(frozen=True)
class AuthContext:
    """認証済み呼び出し元。tenant_id と role は profiles 由来で、リクエストからは受け取らない。"""

    user_id: str
    email: str
    tenant_id: str
    role: str

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"


def auth_enforced() -> bool:
    """AUTH_ENFORCED が明示的に偽でなければ認証を有効とする（デフォルト有効）。"""
    return os.environ.get("AUTH_ENFORCED", "true").strip().lower() not in (
        "false",
        "0",
        "no",
        "off",
    )


def missing_required_env() -> list[str]:
    """
    認証に必要な環境変数のうち、設定されていないものを返す。

    改修前のバックエンドは URL と service-role キーだけで動いていたため、
    **ANON キーは既存のデプロイに設定されていない**。これを起動時に検出せずに
    走らせると、全リクエストが 500（サーバー設定エラー）になり、原因が
    ログを読むまで分からない。
    """
    missing: list[str] = []
    if not (
        os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    ):
        missing.append("NEXT_PUBLIC_SUPABASE_URL")
    if not (
        os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
        or os.environ.get("SUPABASE_ANON_KEY")
    ):
        missing.append("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    return missing


def system_context() -> AuthContext:
    """
    外部 Webhook（Discord / LINE Works / Google Chat）など、Supabase ユーザーが
    紐づかない経路で使うコンテキスト。呼び出し元の検証は各 Webhook 側の責務。
    """
    return AuthContext(
        user_id="00000000-0000-0000-0000-000000000000",
        email="system@localhost",
        tenant_id=_DEFAULT_TENANT_ID,
        role="admin",
    )


def _supabase_url() -> str:
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    if not url:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="サーバー設定エラー: SUPABASE_URL が未設定です。",
        )
    return url.rstrip("/")


def _supabase_anon_key() -> str:
    key = os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY") or os.environ.get(
        "SUPABASE_ANON_KEY"
    )
    if not key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="サーバー設定エラー: SUPABASE_ANON_KEY が未設定です。",
        )
    return key


def _cache_get(token_hash: str) -> Optional[AuthContext]:
    entry = _token_cache.get(token_hash)
    if entry is None:
        return None
    expires_at, ctx = entry
    if expires_at <= time.monotonic():
        _token_cache.pop(token_hash, None)
        return None
    return ctx


def _cache_put(token_hash: str, ctx: AuthContext) -> None:
    # 失効済みを掃除し、それでも上限を超えるなら最も古いものから落とす。
    if len(_token_cache) >= _TOKEN_CACHE_MAX_ENTRIES:
        now = time.monotonic()
        for key in [k for k, (exp, _) in _token_cache.items() if exp <= now]:
            _token_cache.pop(key, None)
        while len(_token_cache) >= _TOKEN_CACHE_MAX_ENTRIES:
            oldest = min(_token_cache, key=lambda k: _token_cache[k][0])
            _token_cache.pop(oldest, None)
    _token_cache[token_hash] = (
        time.monotonic() + _TOKEN_CACHE_TTL_SECONDS,
        ctx,
    )


def clear_token_cache() -> None:
    """テスト用。プロセス内のキャッシュを空にする。"""
    _token_cache.clear()


async def _fetch_supabase_user(token: str) -> dict:
    """Supabase Auth にトークンを検証させ、ユーザー情報を得る。"""
    try:
        async with httpx.AsyncClient(timeout=_AUTH_HTTP_TIMEOUT_SECONDS) as client:
            res = await client.get(
                f"{_supabase_url()}/auth/v1/user",
                headers={
                    "apikey": _supabase_anon_key(),
                    "Authorization": f"Bearer {token}",
                },
            )
    except httpx.HTTPError as exc:
        logger.warning("[auth] Supabase Auth への到達に失敗: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="認証サーバーに接続できません。時間をおいて再度お試しください。",
        ) from exc

    if res.status_code == 401 or res.status_code == 403:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="ログインの有効期限が切れています。再度ログインしてください。",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if res.status_code >= 400:
        logger.warning(
            "[auth] Supabase Auth が予期しない応答を返した: %s %s",
            res.status_code,
            res.text[:200],
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="認証の確認中にエラーが発生しました。",
        )

    user = res.json()
    if not user or not user.get("id"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="認証情報を確認できませんでした。",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


def _fetch_profile(user_id: str) -> dict:
    """profiles から tenant_id / role を引く。RLS 循環を避けるため service client を使う。"""
    sb = get_supabase()
    try:
        row = (
            sb.table("profiles")
            .select("tenant_id, role")
            .eq("id", user_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:  # noqa: BLE001 — Supabase クライアントは多様な例外を投げる
        logger.error("[auth] profiles の取得に失敗: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="ユーザー情報の取得中にエラーが発生しました。",
        ) from exc

    if not row.data:
        # Supabase Auth 上は正当なユーザーだが、このアプリのテナントに属していない。
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="このアカウントはシステムに登録されていません。管理者にお問い合わせください。",
        )

    profile = row.data[0]
    if not profile.get("tenant_id"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="アカウントにテナントが設定されていません。管理者にお問い合わせください。",
        )
    return profile


async def require_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer_scheme),
) -> AuthContext:
    """
    認証済みかつこのアプリのテナントに属しているユーザーを要求する。
    tenant_id はここで確定し、以降のクエリは必ずこの値で絞る。
    """
    if not auth_enforced():
        return system_context()

    if credentials is None or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="ログインが必要です。",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = credentials.credentials
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()

    cached = _cache_get(token_hash)
    if cached is not None:
        return cached

    user = await _fetch_supabase_user(token)
    profile = _fetch_profile(user["id"])

    ctx = AuthContext(
        user_id=user["id"],
        email=user.get("email") or "",
        tenant_id=profile["tenant_id"],
        role=profile.get("role") or "member",
    )
    _cache_put(token_hash, ctx)
    return ctx


def assert_tenant(record_tenant_id: Optional[str], ctx: AuthContext, what: str) -> None:
    """
    対象レコードが呼び出し元のテナントに属していることを確認する。

    不一致でも 403 ではなく 404 を返す。403 は「存在はするが見せない」という
    情報を漏らしてしまうため、他テナントのレコードは存在しないものとして扱う。
    """
    if record_tenant_id != ctx.tenant_id:
        logger.warning(
            "[auth] テナント外アクセスを拒否: user=%s tenant=%s record_tenant=%s target=%s",
            ctx.user_id,
            ctx.tenant_id,
            record_tenant_id,
            what,
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"{what}が見つかりません。",
        )


async def require_admin(ctx: AuthContext = Depends(require_user)) -> AuthContext:
    """
    管理者のみ。認証情報や外部サービスのトークンを読み書きする設定系に使う。
    require_user と同じリクエスト内では FastAPI が依存解決をキャッシュするため、
    検証の往復が増えることはない。
    """
    if not ctx.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="この操作には管理者権限が必要です。",
        )
    return ctx
