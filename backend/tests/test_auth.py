"""API 認証（app/auth.py）のテスト

守りたい性質:
  1. トークンなし／不正なトークンでは業務エンドポイントに到達できない
  2. tenant_id は必ず認証コンテキスト由来で、他テナントのレコードは 404 になる
  3. 設定系（認証情報・外部トークンを扱う）は管理者のみ
  4. 外部 Webhook（chat）は JWT を要求しない — 各 Webhook が自身で送信元を検証する
  5. AUTH_ENFORCED=false で改修前の挙動に戻せる（障害時の逃げ道）
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# app.main の import 時に Supabase クライアントの環境変数が要求されるため先に置く
os.environ.setdefault("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-key")

from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app import auth
from app.auth import AuthContext, assert_tenant
from app.main import app

TENANT_A = "11111111-1111-1111-1111-111111111111"
TENANT_B = "22222222-2222-2222-2222-222222222222"

ADMIN_A = AuthContext(
    user_id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    email="admin@example.com",
    tenant_id=TENANT_A,
    role="admin",
)
MEMBER_A = AuthContext(
    user_id="bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    email="member@example.com",
    tenant_id=TENANT_A,
    role="member",
)

# 業務エンドポイントの代表。ここが素通りしたら認可が壊れている。
PROTECTED_GET = [
    "/api/orders",
    "/api/orders/33333333-3333-3333-3333-333333333333",
    "/api/orders/33333333-3333-3333-3333-333333333333/pdf",
    "/api/orders/shipping-sheet/pdf?target_date=2026-01-01",
    "/api/email/fetch",
]
PROTECTED_POST = [
    "/api/ocr/parse",
    "/api/ocr/verify",
    "/api/orders/33333333-3333-3333-3333-333333333333/sync-sheets",
]
ADMIN_ONLY_POST = [
    "/api/config/email/test",
    "/api/config/prompt/test",
]
ADMIN_ONLY_GET = [
    "/api/config/email",
    "/api/config/chat",
    "/api/config/prompt",
    "/api/config/stores",
    "/api/config/prompt/history",
]
ADMIN_ONLY_PUT = [
    "/api/config/email",
    "/api/config/chat",
    "/api/config/prompt",
]


@pytest.fixture(autouse=True)
def _clean_state(monkeypatch):
    """各テストを既定（認証有効・キャッシュ空）から始める。"""
    monkeypatch.setenv("AUTH_ENFORCED", "true")
    auth.clear_token_cache()
    yield
    auth.clear_token_cache()


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


class _FakeQuery:
    """Supabase のクエリビルダのうち、このコードベースが使う分だけを模したもの。"""

    def __init__(self, data):
        self._data = data

    def select(self, *_a, **_k):
        return self

    def eq(self, *_a, **_k):
        return self

    def neq(self, *_a, **_k):
        return self

    def in_(self, *_a, **_k):
        return self

    def order(self, *_a, **_k):
        return self

    def range(self, *_a, **_k):
        return self

    def limit(self, *_a, **_k):
        return self

    def execute(self):
        return SimpleNamespace(data=self._data)


class _FakeSupabase:
    def __init__(self, tables=None):
        self._tables = tables or {}

    def table(self, name):
        return _FakeQuery(self._tables.get(name, []))


def _stub_identity(monkeypatch, ctx: AuthContext):
    """Supabase Auth と profiles の参照を差し替え、ネットワークなしで検証を通す。"""

    async def fake_user(token: str):
        assert token, "トークンが空のまま検証処理に到達している"
        return {"id": ctx.user_id, "email": ctx.email}

    def fake_profile(user_id: str):
        assert user_id == ctx.user_id
        return {"tenant_id": ctx.tenant_id, "role": ctx.role}

    monkeypatch.setattr(auth, "_fetch_supabase_user", fake_user)
    monkeypatch.setattr(auth, "_fetch_profile", fake_profile)


def _stub_empty_db(monkeypatch):
    """認証の門を越えた先で外部通信させないためのスタブ。"""
    from app.routers import orders as orders_router

    monkeypatch.setattr(orders_router, "get_supabase", lambda: _FakeSupabase())


# ── 1. 未認証は通さない ────────────────────────────────────────────────────

@pytest.mark.parametrize("path", PROTECTED_GET + ADMIN_ONLY_GET)
def test_get_requires_token(client, path):
    res = client.get(path)
    assert res.status_code == 401, f"GET {path} が無認証で {res.status_code} を返した"


@pytest.mark.parametrize("path", PROTECTED_POST + ADMIN_ONLY_POST)
def test_post_requires_token(client, path):
    res = client.post(path, json={})
    assert res.status_code == 401, f"POST {path} が無認証で {res.status_code} を返した"


@pytest.mark.parametrize("path", ADMIN_ONLY_PUT)
def test_put_requires_token(client, path):
    res = client.put(path, json={})
    assert res.status_code == 401, f"PUT {path} が無認証で {res.status_code} を返した"


@pytest.mark.parametrize("path", PROTECTED_GET)
def test_rejects_invalid_token(client, monkeypatch, path):
    async def reject(token: str):
        raise HTTPException(status_code=401, detail="invalid")

    monkeypatch.setattr(auth, "_fetch_supabase_user", reject)
    res = client.get(path, headers={"Authorization": "Bearer bogus"})
    assert res.status_code == 401


def test_malformed_authorization_header_is_rejected(client):
    """Bearer 以外のスキームや空トークンで通ってしまわないこと。"""
    for value in ["", "Bearer", "Bearer ", "Basic abc", "token123"]:
        res = client.get("/api/orders", headers={"Authorization": value})
        assert res.status_code == 401, f"Authorization={value!r} が通ってしまった"


def test_health_stays_public(client):
    """Cloud Run のヘルスチェックが認証で落ちないこと。"""
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


# ── 2. 認証を通ったら 401 ではなくなる ─────────────────────────────────────

def test_authenticated_request_passes_the_auth_gate(client, monkeypatch):
    """認証を通れば業務処理に到達する（一覧はテナントで絞られ、空なら 200 で空配列）。"""
    _stub_identity(monkeypatch, ADMIN_A)
    _stub_empty_db(monkeypatch)
    res = client.get("/api/orders", headers={"Authorization": "Bearer good"})
    assert res.status_code == 200
    assert res.json() == []


def test_orders_list_is_scoped_to_caller_tenant(client, monkeypatch):
    """
    一覧クエリに呼び出し元の tenant_id が渡ること。
    以前はテナント条件が無く、全テナントの受注が返る状態だった。
    """
    from app.routers import orders as orders_router

    seen = {}

    class _RecordingQuery(_FakeQuery):
        def eq(self, column, value):
            seen[column] = value
            return self

    class _RecordingSupabase(_FakeSupabase):
        def table(self, name):
            return _RecordingQuery([])

    _stub_identity(monkeypatch, ADMIN_A)
    monkeypatch.setattr(orders_router, "get_supabase", lambda: _RecordingSupabase())

    client.get("/api/orders", headers={"Authorization": "Bearer good"})
    assert seen.get("tenant_id") == TENANT_A


# ── 3. 設定系は管理者のみ ──────────────────────────────────────────────────

@pytest.mark.parametrize("path", ADMIN_ONLY_GET)
def test_config_get_rejects_non_admin(client, monkeypatch, path):
    _stub_identity(monkeypatch, MEMBER_A)
    res = client.get(path, headers={"Authorization": "Bearer good"})
    assert res.status_code == 403, (
        f"GET {path} に一般ユーザーが到達できてしまう（{res.status_code}）"
    )


@pytest.mark.parametrize("path", ADMIN_ONLY_PUT)
def test_config_put_rejects_non_admin(client, monkeypatch, path):
    """設定の書き込み（IMAP パスワード等）が一般ユーザーに開いていないこと。"""
    _stub_identity(monkeypatch, MEMBER_A)
    res = client.put(path, json={}, headers={"Authorization": "Bearer good"})
    assert res.status_code == 403, (
        f"PUT {path} に一般ユーザーが到達できてしまう（{res.status_code}）"
    )


@pytest.mark.parametrize("path", ADMIN_ONLY_POST)
def test_config_post_rejects_non_admin(client, monkeypatch, path):
    _stub_identity(monkeypatch, MEMBER_A)
    res = client.post(path, json={}, headers={"Authorization": "Bearer good"})
    assert res.status_code == 403, (
        f"POST {path} に一般ユーザーが到達できてしまう（{res.status_code}）"
    )


def test_email_test_endpoint_does_not_fetch_mail(client, monkeypatch):
    """
    接続テストが取り込み処理を呼ばないこと。
    以前は「接続テスト」ボタンが本番のメール取り込みを走らせていた。
    """
    _stub_identity(monkeypatch, ADMIN_A)
    from app.routers import config as config_router
    from app.services import email_reader

    monkeypatch.setattr(config_router, "get_supabase", lambda: _FakeSupabase())

    def boom(*_a, **_k):
        raise AssertionError("接続テストからメール取り込みが呼ばれている")

    monkeypatch.setattr(email_reader, "check_email_for_orders", boom)

    res = client.post("/api/config/email/test", headers={"Authorization": "Bearer good"})
    assert res.status_code == 200
    # 設定が空なので ok=False だが、取り込みは走っていない
    assert res.json()["ok"] is False


def test_config_allows_admin_past_the_gate(client, monkeypatch):
    """管理者は 401/403 で止まらない（この先はフォールバックで環境変数を返す）。"""
    _stub_identity(monkeypatch, ADMIN_A)
    from app.routers import config as config_router

    monkeypatch.setattr(config_router, "get_supabase", lambda: _FakeSupabase())
    res = client.get("/api/config/email", headers={"Authorization": "Bearer good"})
    assert res.status_code == 200


# ── 4. 外部 Webhook は JWT を要求しない ───────────────────────────────────

def test_chat_webhooks_are_not_jwt_gated(client):
    """
    Discord / LINE Works / Google Chat は Supabase の JWT を載せられない。
    JWT を要求してしまうと連携が壊れるため、401 にならないことを固定する。
    （送信元の検証は各 Webhook の責務）
    """
    res = client.post("/api/chat/googlechat", json={"type": "ADDED_TO_SPACE"})
    assert res.status_code != 401


# ── 5. テナント境界 ────────────────────────────────────────────────────────

def test_assert_tenant_allows_same_tenant():
    assert_tenant(TENANT_A, ADMIN_A, "受注")  # 例外が出なければ成功


def test_assert_tenant_blocks_other_tenant_as_not_found():
    """
    他テナントのレコードは 403 ではなく 404。
    403 だと「存在はする」ことが漏れてしまう。
    """
    with pytest.raises(HTTPException) as exc:
        assert_tenant(TENANT_B, ADMIN_A, "受注")
    assert exc.value.status_code == 404


def test_assert_tenant_blocks_missing_tenant():
    with pytest.raises(HTTPException) as exc:
        assert_tenant(None, ADMIN_A, "受注")
    assert exc.value.status_code == 404


# ── 6. profiles に無いユーザーは弾く ──────────────────────────────────────

def test_verify_ignores_client_supplied_reviewed_by(client, monkeypatch):
    """
    承認者はアクセストークンから決める。以前はリクエストの reviewed_by を
    そのまま信用していたため、承認を他人の名義に付け替えられる状態だった。
    """
    from app.models import VerifyRequest

    field = VerifyRequest.model_fields["reviewed_by"]
    assert field.deprecated, "reviewed_by が非推奨として明示されていない"

    src = (
        __import__("pathlib")
        .Path(__file__)
        .parent.parent.joinpath("app/routers/ocr.py")
        .read_text(encoding="utf-8")
    )
    assert "reviewed_by = ctx.user_id" in src
    assert "str(req.reviewed_by)" not in src, "リクエスト由来の承認者がまだ使われている"


def test_user_without_profile_is_forbidden(client, monkeypatch):
    """Supabase Auth 上は正当でも、このアプリのテナントに属していなければ 403。"""

    async def fake_user(token: str):
        return {"id": "cccccccc-cccc-cccc-cccc-cccccccccccc", "email": "x@example.com"}

    def no_profile(user_id: str):
        raise HTTPException(status_code=403, detail="未登録")

    monkeypatch.setattr(auth, "_fetch_supabase_user", fake_user)
    monkeypatch.setattr(auth, "_fetch_profile", no_profile)

    res = client.get("/api/orders", headers={"Authorization": "Bearer good"})
    assert res.status_code == 403


# ── 7. キャッシュ ─────────────────────────────────────────────────────────

def test_token_verification_is_cached(client, monkeypatch):
    """同じトークンの連続リクエストで Supabase への往復が増えないこと。"""
    calls = {"n": 0}

    async def counting_user(token: str):
        calls["n"] += 1
        return {"id": ADMIN_A.user_id, "email": ADMIN_A.email}

    monkeypatch.setattr(auth, "_fetch_supabase_user", counting_user)
    monkeypatch.setattr(
        auth, "_fetch_profile", lambda _uid: {"tenant_id": TENANT_A, "role": "admin"}
    )
    _stub_empty_db(monkeypatch)

    headers = {"Authorization": "Bearer same-token"}
    for _ in range(3):
        client.get("/api/orders", headers=headers)

    assert calls["n"] == 1, f"検証が {calls['n']} 回走っている（キャッシュが効いていない）"


def test_cache_is_keyed_per_token(client, monkeypatch):
    """別トークンはキャッシュを共有しないこと（なりすまし防止）。"""
    seen = []

    async def counting_user(token: str):
        seen.append(token)
        return {"id": ADMIN_A.user_id, "email": ADMIN_A.email}

    monkeypatch.setattr(auth, "_fetch_supabase_user", counting_user)
    monkeypatch.setattr(
        auth, "_fetch_profile", lambda _uid: {"tenant_id": TENANT_A, "role": "admin"}
    )
    _stub_empty_db(monkeypatch)

    client.get("/api/orders", headers={"Authorization": "Bearer token-1"})
    client.get("/api/orders", headers={"Authorization": "Bearer token-2"})
    assert seen == ["token-1", "token-2"]


def test_cache_does_not_grow_without_bound(monkeypatch):
    """トークンを変え続けても上限を超えて溜まらないこと。"""
    for i in range(auth._TOKEN_CACHE_MAX_ENTRIES + 50):
        auth._cache_put(f"hash-{i}", ADMIN_A)
    assert len(auth._token_cache) <= auth._TOKEN_CACHE_MAX_ENTRIES


# ── 8. 緊急時の逃げ道 ─────────────────────────────────────────────────────

def test_auth_enforced_false_restores_open_access(client, monkeypatch):
    """
    AUTH_ENFORCED=false で改修前の「無認証で通る」挙動に戻ること。
    docs/ROLLBACK.md に記載した障害時の退避手段が実際に効くかを確認する。
    """
    monkeypatch.setenv("AUTH_ENFORCED", "false")
    _stub_empty_db(monkeypatch)
    res = client.get("/api/orders")
    assert res.status_code == 200


def test_auth_enforced_defaults_to_on(monkeypatch):
    monkeypatch.delenv("AUTH_ENFORCED", raising=False)
    assert auth.auth_enforced() is True


@pytest.mark.parametrize("value", ["false", "FALSE", "0", "no", "off", " false "])
def test_auth_enforced_accepts_common_falsey_spellings(monkeypatch, value):
    monkeypatch.setenv("AUTH_ENFORCED", value)
    assert auth.auth_enforced() is False


@pytest.mark.parametrize("value", ["true", "1", "yes", "", "anything"])
def test_auth_enforced_stays_on_for_anything_else(monkeypatch, value):
    """設定ミスで認証が黙って外れないこと（既定は安全側）。"""
    monkeypatch.setenv("AUTH_ENFORCED", value)
    assert auth.auth_enforced() is True


# ── 9. API ドキュメントの露出 ─────────────────────────────────────────────

# ── 10. 起動時の設定チェック ───────────────────────────────────────────────

def test_missing_env_is_detected(monkeypatch):
    """
    ANON キーは改修前のバックエンドでは不要だったため、既存のデプロイには
    設定されていない。起動時に検出できることを固定する。
    """
    monkeypatch.delenv("NEXT_PUBLIC_SUPABASE_ANON_KEY", raising=False)
    monkeypatch.delenv("SUPABASE_ANON_KEY", raising=False)
    assert "NEXT_PUBLIC_SUPABASE_ANON_KEY" in auth.missing_required_env()

    monkeypatch.delenv("NEXT_PUBLIC_SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    assert "NEXT_PUBLIC_SUPABASE_URL" in auth.missing_required_env()


def test_no_missing_env_when_configured(monkeypatch):
    monkeypatch.setenv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co")
    monkeypatch.setenv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon")
    assert auth.missing_required_env() == []


def test_alternate_env_names_are_accepted(monkeypatch):
    """SUPABASE_URL / SUPABASE_ANON_KEY でも通ること。"""
    monkeypatch.delenv("NEXT_PUBLIC_SUPABASE_URL", raising=False)
    monkeypatch.delenv("NEXT_PUBLIC_SUPABASE_ANON_KEY", raising=False)
    monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon")
    assert auth.missing_required_env() == []


def test_startup_fails_when_env_missing(monkeypatch):
    """
    設定不足のまま起動を通すと全リクエストが 500 になり原因が分からない。
    起動時に落ちれば Cloud Run は新リビジョンを昇格させず、
    直前のリビジョンが配信を続ける。
    """
    monkeypatch.setenv("AUTH_ENFORCED", "true")
    monkeypatch.delenv("NEXT_PUBLIC_SUPABASE_ANON_KEY", raising=False)
    monkeypatch.delenv("SUPABASE_ANON_KEY", raising=False)

    with pytest.raises(RuntimeError) as exc:
        with TestClient(app):
            pass
    assert "NEXT_PUBLIC_SUPABASE_ANON_KEY" in str(exc.value)


def test_startup_succeeds_when_auth_disabled_even_without_env(monkeypatch):
    """AUTH_ENFORCED=false の退避経路は設定不足でも起動できること。"""
    monkeypatch.setenv("AUTH_ENFORCED", "false")
    monkeypatch.delenv("NEXT_PUBLIC_SUPABASE_ANON_KEY", raising=False)
    monkeypatch.delenv("SUPABASE_ANON_KEY", raising=False)

    with TestClient(app) as c:
        assert c.get("/api/health").status_code == 200


def test_api_docs_are_not_exposed_by_default(client):
    """スキーマは攻撃者への地図になるため既定で非公開。"""
    assert client.get("/api/docs").status_code == 404
    assert client.get("/api/openapi.json").status_code == 404
