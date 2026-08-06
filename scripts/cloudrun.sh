#!/usr/bin/env bash
#
# Cloud Run へのデプロイと切り戻しを、いつでも戻せる形で行う補助スクリプト。
#
#   ./scripts/cloudrun.sh status     今どのリビジョンが配信しているか
#   ./scripts/cloudrun.sh snapshot   戻す先のリビジョンを記録する（デプロイ前に必ず）
#   ./scripts/cloudrun.sh rollback   記録したリビジョンへトラフィックを戻す
#
# 考え方:
#   Cloud Run は過去のリビジョンを保持しているので、切り戻しは
#   「トラフィックの向き先を変える」だけで済む。再ビルドもデプロイも不要で数秒。
#   ただし**戻す先のリビジョン名を控えていないと**慌てて探すことになるため、
#   デプロイ前に snapshot で記録する。
#
# デプロイ自体は docs/DEPLOY.md の手順に従って gcloud run deploy を実行する。
# このスクリプトは意図的にデプロイを含めていない（何がデプロイされるかを
# コマンドとして目で確認してから実行してほしいため）。
set -euo pipefail

PROJECT="${PROJECT:-kojima-farm}"
REGION="${REGION:-asia-northeast1}"
FRONTEND="${FRONTEND:-kojima-farm-frontend}"
BACKEND="${BACKEND:-kojima-farm-backend}"
SNAPSHOT_FILE="${SNAPSHOT_FILE:-.cloudrun-snapshot}"

SERVICES=("$BACKEND" "$FRONTEND")

log() { printf '%s\n' "$*"; }
err() { printf '%s\n' "$*" >&2; }

require_gcloud() {
  if ! command -v gcloud >/dev/null 2>&1; then
    err "gcloud が見つかりません。Google Cloud SDK をインストールしてください。"
    exit 1
  fi
}

# 今 100% のトラフィックを受けているリビジョン名を取得する。
#
# 単一リビジョンで配信している前提（このプロジェクトの通常運用）。
# カナリアなどで複数に分けている場合は空か不正確になるので、
# そのときは Console の「リビジョン > トラフィックを管理」で確認する。
serving_revision() {
  local svc="$1"
  gcloud run services describe "$svc" \
    --region "$REGION" \
    --project "$PROJECT" \
    --format='value(status.traffic[0].revisionName)' 2>/dev/null || true
}

cmd_status() {
  require_gcloud
  for svc in "${SERVICES[@]}"; do
    log "── ${svc} ────────────────────────────────"
    gcloud run services describe "$svc" \
      --region "$REGION" \
      --project "$PROJECT" \
      --format='table(status.traffic[].revisionName, status.traffic[].percent, status.traffic[].tag)' \
      || err "  取得できませんでした（サービス名・リージョン・権限を確認）"
    log ""
  done
}

cmd_snapshot() {
  require_gcloud
  : > "$SNAPSHOT_FILE.tmp"
  local failed=0

  for svc in "${SERVICES[@]}"; do
    local rev
    rev="$(serving_revision "$svc")"
    if [[ -z "$rev" ]]; then
      err "${svc}: 配信中のリビジョンを特定できませんでした。"
      err "  トラフィックを複数リビジョンに分けている場合は Console で確認してください。"
      failed=1
      continue
    fi
    printf '%s %s\n' "$svc" "$rev" >> "$SNAPSHOT_FILE.tmp"
    log "${svc} → ${rev}"
  done

  if [[ "$failed" -ne 0 ]]; then
    rm -f "$SNAPSHOT_FILE.tmp"
    err ""
    err "記録に失敗したため snapshot を作成しませんでした。"
    exit 1
  fi

  mv "$SNAPSHOT_FILE.tmp" "$SNAPSHOT_FILE"
  log ""
  log "戻す先を ${SNAPSHOT_FILE} に記録しました。"
  log "問題が起きたら ./scripts/cloudrun.sh rollback で戻せます。"
}

cmd_rollback() {
  require_gcloud
  if [[ ! -f "$SNAPSHOT_FILE" ]]; then
    err "${SNAPSHOT_FILE} がありません。デプロイ前に snapshot を実行していない場合は、"
    err "Console の「リビジョン > トラフィックを管理」から手で戻してください。"
    exit 1
  fi

  log "記録されている戻し先:"
  cat "$SNAPSHOT_FILE"
  log ""

  # 依存関係の都合でフロントエンドから戻す。
  # 新フロント + 旧バックエンドは JWT が無視されるだけで動くが、
  # 旧フロント + 新バックエンドは全API が 401 になるため、
  # フロントを先に戻して「旧フロント + 新バックエンド」の状態を作らない。
  local order=("$FRONTEND" "$BACKEND")
  for svc in "${order[@]}"; do
    local rev
    rev="$(awk -v s="$svc" '$1 == s { print $2 }' "$SNAPSHOT_FILE")"
    if [[ -z "$rev" ]]; then
      err "${svc}: 記録が見つかりません。飛ばします。"
      continue
    fi
    log "${svc} → ${rev} に戻します"
    gcloud run services update-traffic "$svc" \
      --region "$REGION" \
      --project "$PROJECT" \
      --to-revisions "${rev}=100"
  done

  log ""
  log "切り戻しました。認証が原因だった場合は、あわせて次も確認してください:"
  log "  gcloud run services update ${BACKEND} --region ${REGION} \\"
  log "    --update-env-vars AUTH_ENFORCED=false"
}

usage() {
  cat <<'USAGE'
使い方: ./scripts/cloudrun.sh <コマンド>

  status     今どのリビジョンが何%のトラフィックを受けているか表示する
  snapshot   戻す先のリビジョンを記録する（デプロイ前に必ず実行）
  rollback   記録したリビジョンへトラフィックを戻す

環境変数で対象を変えられます:
  PROJECT   (既定: kojima-farm)
  REGION    (既定: asia-northeast1)
  FRONTEND  (既定: kojima-farm-frontend)
  BACKEND   (既定: kojima-farm-backend)

デプロイ手順は docs/DEPLOY.md を参照してください。
USAGE
}

case "${1:-}" in
  status)   cmd_status ;;
  snapshot) cmd_snapshot ;;
  rollback) cmd_rollback ;;
  ""|-h|--help|help) usage ;;
  *)
    err "不明なコマンド: $1"
    err ""
    usage
    exit 1
    ;;
esac
