#!/bin/bash
# バックエンド開発サーバー起動スクリプト

# .env.local を読み込む
if [ -f .env.local ]; then
  export $(grep -v '^#' .env.local | xargs)
fi

uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
