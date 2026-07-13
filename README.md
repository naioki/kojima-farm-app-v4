# 小島農園 管理システム (kojima-farm-app-v4)

出荷伝票OCR取り込み・出荷ラベル/一覧表PDF生成・注文管理を行う小島農園向け業務システム。

> **Note**: Cloud Run 上の `kojima app run v4` とは別物です。本リポジトリのバックエンドは
> **kojima farm backend**（FastAPI）として稼働しています。

## 構成

- `app/`, `components/`, `lib/` — フロントエンド（Next.js / TypeScript）
- `backend/` — バックエンド（FastAPI / Python）。OCR解析、出荷ラベル・一覧表PDF生成、注文集計などを担当
- `backend/migrations/` — Supabase 用 SQL マイグレーション
- `docs/` — 設計ドキュメント

## セットアップ

### フロントエンド
```bash
npm install
npm run dev
```

### バックエンド
```bash
cd backend
python -m venv venv
venv/Scripts/activate  # Windows
pip install -r requirements.txt
uvicorn app.main:app --reload
```

環境変数は `backend/.env.local` に配置（Gemini API キー、Supabase 接続情報など）。

## テスト

```bash
cd backend
python -m pytest tests/ -v
```

## 主な機能

- FAXメール添付のOCR解析による注文データ取り込み
- 店舗（customers）の並び順（`sort_order`）に基づく出荷ラベル・出荷一覧表PDF生成
- 商品規格・価格マスタ管理
- 出荷実績の検証・確認フロー

## ドキュメント

- [システム設計](system_design_v4.md)
