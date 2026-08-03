#!/usr/bin/env bash
#
# 1コンテナ構成の起動スクリプト（Dockerfile.allinone 用）。
#
#   FastAPI  → 127.0.0.1:${INTERNAL_API_PORT}  外部からは到達できない
#   Next.js  → 0.0.0.0:${PORT}                 Cloud Run が公開する唯一のポート
#
# 一番大事な性質: **どちらかのプロセスが終了したらコンテナ全体を終了させる。**
# uvicorn が死んだのに Next.js が health に 200 を返し続けると、Cloud Run は
# 正常だと判断して壊れたインスタンスに配信し続けてしまう。気づけない障害に
# なるので、必ず落として作り直させる。
set -euo pipefail

PORT="${PORT:-8080}"
INTERNAL_API_PORT="${INTERNAL_API_PORT:-8000}"
# バックエンドの起動を待つ上限（秒）。Cloud Run の起動タイムアウトより短くする
API_READY_TIMEOUT="${API_READY_TIMEOUT:-40}"

api_pid=""
web_pid=""

log() {
  echo "[entrypoint] $*"
}

cleanup() {
  local exit_code=$?
  trap - EXIT INT TERM
  for pid in "$api_pid" "$web_pid"; do
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill -TERM "$pid" 2>/dev/null || true
    fi
  done
  # SIGTERM 後の猶予（Cloud Run は終了まで待ってくれる）
  wait 2>/dev/null || true
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

# ── FastAPI（内部のみ）────────────────────────────────────────────────────
log "FastAPI を 127.0.0.1:${INTERNAL_API_PORT} で起動します"
/opt/venv/bin/uvicorn app.main:app \
  --app-dir /srv/backend \
  --host 127.0.0.1 \
  --port "${INTERNAL_API_PORT}" \
  --log-level info &
api_pid=$!

# ── 起動待ち ─────────────────────────────────────────────────────────────
# ここで待たないと、起動直後のリクエストが接続エラーになる。
# 環境変数不足などで uvicorn が即死した場合は、ループを抜けて下で失敗させる。
log "FastAPI の起動を待ちます（最大 ${API_READY_TIMEOUT} 秒）"
ready=0
for _ in $(seq 1 "${API_READY_TIMEOUT}"); do
  if ! kill -0 "$api_pid" 2>/dev/null; then
    log "FastAPI が起動に失敗しました。上のログを確認してください"
    log "（環境変数不足の場合は NEXT_PUBLIC_SUPABASE_ANON_KEY 等のメッセージが出ます）"
    exit 1
  fi
  if /opt/venv/bin/python -c "
import sys, urllib.request
try:
    with urllib.request.urlopen('http://127.0.0.1:${INTERNAL_API_PORT}/api/health', timeout=2) as r:
        sys.exit(0 if r.status == 200 else 1)
except Exception:
    sys.exit(1)
" 2>/dev/null; then
    ready=1
    break
  fi
  sleep 1
done

if [[ "$ready" -ne 1 ]]; then
  log "FastAPI が ${API_READY_TIMEOUT} 秒以内に応答しませんでした"
  exit 1
fi
log "FastAPI の起動を確認しました"

# ── Next.js（公開ポート）──────────────────────────────────────────────────
log "Next.js を 0.0.0.0:${PORT} で起動します"
node server.js &
web_pid=$!

# どちらかが終了したら cleanup が走り、もう一方も落としてコンテナを終了する。
#
# `|| finished=$?` が必要な理由: set -e があるため、wait -n が非ゼロを返した
# 時点でスクリプトが即中断し、終了コードを記録する行に到達できない。
# 終了自体は trap EXIT が正しく処理するが、原因を示すログが出ないと
# Cloud Run のログから何が落ちたのか分からなくなる。
finished=0
wait -n "$api_pid" "$web_pid" || finished=$?
log "プロセスが終了しました（exit=${finished}）。コンテナを終了します"
exit "$finished"
