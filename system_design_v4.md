# System Design v4 — 小島農園 管理システム

**Version**: 4.1  
**Date**: 2026-05-07  
**Author**: Claude (Senior Full-Stack Engineer)  
**Status**: In Progress

---

## 1. System Overview & Objectives

### Background
v3 は単一ファイルの Streamlit アプリで、メール取得 → AI解析 → 確認編集 → PDF生成 → Google Sheets連携 までを一気通貫で処理する。動作は正しいが：

- **Streamlit cold-start** が1インタラクションごとに 3〜8 秒かかる
- **UI が硬直的**：レイアウト・フォント・インタラクションが Streamlit の制約を受ける
- **永続状態なし**：再レンダリングのたびに設定ファイルを再読み込み
- **単一ユーザー・単一プロセス**：並行処理不可

### v4 Goals
| Goal | 達成基準 |
|---|---|
| サブ秒 UI | クライアント側操作 < 200 ms |
| モダン UI | カスタムダッシュボード、日本語フォント |
| デカップル設計 | フロントエンドとバックエンドを独立デプロイ可能 |
| v3 完全機能対応 | v3 の全機能が v4 で動作すること |
| 保守性 | 関心の分離；1200行ファイルなし |

---

## 2. Tech Stack & Architecture

### Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router, TypeScript, Turbopack) |
| Backend API | FastAPI (Python 3.14) |
| Auth | Supabase Auth (JWT, cookie) |
| Database | Supabase Postgres |
| PDF | ReportLab (v3 から移植) |
| AI Parsing | Gemini 2.0-flash API |
| Storage | Supabase Storage (fax-images bucket) |
| Proxy/Auth Middleware | `proxy.ts` (Next.js 16 命名規則) |

### Architecture

```
Browser (Next.js :3000)
  /login
  /dashboard/verifications   ← メイン画面
  /dashboard/master          ← マスターデータ管理
  /dashboard/settings        ← メール・API設定
        │ HTTP (Supabase JWT cookie)
FastAPI Backend (:8000)
  GET  /api/email/fetch         ← IMAP取得 → Storage → ocr_verifications
  POST /api/ocr/parse           ← verification_id → Gemini → parsed_lines
  POST /api/ocr/verify          ← corrected_lines → approve RPC → order_id
  GET  /api/orders/{id}/pdf     ← order_id → ReportLab → PDF stream
  CRUD /api/config/*            ← stores/items/units/email_config
        │ SQL (RLS)                      │ Supabase Storage
Supabase Postgres               Supabase Storage (fax-images/)
```

---

## 3. 実装済み機能（v4.1 時点）

### ✅ 完了

| 機能 | 場所 |
|---|---|
| Supabase Auth ログイン/リダイレクト | `proxy.ts`, `app/login/page.tsx` |
| OCR 検証ダッシュボード（2カラム） | `app/dashboard/verifications/` |
| 未処理/全件フィルタタブ | `verification-dashboard.tsx` |
| 全ステータス表示（承認済・却下含む） | `verification-list.tsx` |
| 承認済みは読み取り専用表示 | `verification-form.tsx` |
| Gemini 解析ボタン | `verification-form.tsx` → `POST /api/ocr/parse` |
| 承認 & PDF 自動ダウンロード | `verification-form.tsx` → `POST /api/ocr/verify` |
| メール取得ボタン（ヘッダー） | `email-fetch-button.tsx` → `GET /api/email/fetch` |
| IMAP 取得・Storage アップロード | `backend/app/routers/email_fetch.py` |
| HTMLメール本文抽出 | `backend/app/services/email_reader.py` |
| テキスト/HTMLメール → Gemini 即時解析 | `email_fetch.py` |
| 重複メール検出（email_id チェック） | `email_fetch.py` |
| マスターデータ CRUD | `app/dashboard/master/` |
| 設定画面（メール設定） | `app/dashboard/settings/` |

### ⚠️ 未実装・差分（v3 対比）

| v3 機能 | v4 状況 | 優先度 |
|---|---|---|
| メール設定をUIから変更・保存 | 設定ページあるが保存API未結合 | **高** |
| 送信者フィルタ（FROM）をUIから設定 | 環境変数のみ対応 | **高** |
| メール本文のプレビュー（検証画面で確認） | 画像URLが `text://...` のとき表示なし | **高** |
| メール一覧に件名・送信者を表示 | ID の先頭8文字のみ | **中** |
| Gemini API クォータ枯渇時の再解析 | pending のまま放置 | **中** |
| Google Sheets 連携 | 未実装 | **低** |

---

## 4. メール読み取り機能 詳細設計（v3 対応）

### 4.1 v3 の動作仕様（参照元）

v3 の「メール自動読み取り」タブは以下の構成：

```
[メール設定] ▼（アコーディオン）
  IMAPサーバー:       imap.lolipop.jp
  メールアドレス:      order@kojimanouen.com
  パスワード:         ●●●●●●（表示切替）
  送信者メール（フィルタ）: kojimamasayuki31@gmail.com
  何日前まで遡るか:    3
  [設定を保存（パスワードは保存されません）] ☐

[メールをチェック]    [設定をリセット]

使用中のメール: order@kojimanouen.com

---（取得後）---
受信リストをクリア

▼ body_text - Fwd: 5/8ヨーク (2026-05-05 19:06:57+09:00)
  [メール本文テキスト表示]
  [解析結果テーブル（編集可）]
  [出荷日入力] [承認・PDF]
```

**ポイント：**
- メール取得 → その場で本文/画像を表示
- 解析結果を即座に編集可能
- 承認するとその場で PDF ダウンロード

### 4.2 v4 の対応設計

v4 はデータベース永続化があるため、v3 と完全同一の UI は不要。  
ただし以下の点を v3 に合わせる：

#### A. メール設定 UI (`/dashboard/settings`)

```
[メール設定]
  IMAPサーバー       [imap.lolipop.jp        ]
  IMAPポート         [993                    ]
  メールアドレス      [order@kojimanouen.com  ]
  パスワード         [●●●●●●●●●●] [👁]
  送信者フィルタ      [kojimamasayuki31@gmail ]  ← 空欄 = 全送信者
  何日前まで遡るか    [3                      ] 日
  
  [保存]  ← PATCH /api/config/email
```

設定は `email_config` テーブルに保存。パスワードは **Supabase Vault** または  
サービスロールで暗号化列に格納（平文保存禁止）。

#### B. メール本文プレビュー（検証画面）

テキスト/HTML メール（`image_url` が `text://...`）の場合：

```
左カラム（現在: 画像ビューアー）
  ↓ image_url が text:// の場合
  [メール情報カード]
  件名: Fwd: 5/8ヨーク
  送信者: kojimamasayuki31@gmail.com
  受信日: 2026-05-05 19:06
  ─────────────────────────
  [本文テキスト（スクロール可）]
```

本文テキストは `confidence_flags.raw_text` または専用カラムに保存。

#### C. メール取得フロー（改善版）

```
1. ユーザーが [メール取得] クリック
2. GET /api/email/fetch
3. IMAP 接続 → メール一覧取得
4. 各メールを処理:
   a. 画像添付あり  → Storage アップロード → ocr_verifications (status: pending)
   b. HTML/テキスト → html_to_text() → Gemini 解析
                    → ocr_verifications (status: needs_review or pending)
5. レスポンス: { fetched: N, verification_ids: [...] }
6. フロントエンド: トースト表示 + 検証リストを自動リフレッシュ
```

#### D. メール情報のメタデータ保存

`confidence_flags` JSON に以下を追加：

```json
{
  "source": "text_email",
  "email_id": "12345",
  "subject": "Fwd: 5/8ヨーク",
  "from": "kojimamasayuki31@gmail.com",
  "date": "2026-05-05T19:06:57+09:00",
  "raw_text": "（本文テキスト）"
}
```

これにより検証画面でメール情報を表示できる。

---

## 5. データフロー（完全版）

```
1. メール取得
   [メール取得] ボタン or 定期実行
        │
        ▼
   GET /api/email/fetch
   └─ IMAP 接続（email_config テーブルまたは環境変数）
   └─ 未取得メール（days_back 日分）を取得
   └─ 重複チェック（confidence_flags.email_id）
   
   画像添付あり:
     Storage アップロード → 署名付きURL → ocr_verifications (pending)
   
   HTML/テキスト:
     html_to_text() → Gemini parse_order_text()
     → ocr_verifications (needs_review / pending)
     → confidence_flags に件名・送信者・本文を保存

2. OCR 解析（画像メール）
   検証画面で [Gemini 解析] ボタン
        │
        ▼
   POST /api/ocr/parse { verification_id }
   → Storage から画像ダウンロード
   → Gemini Vision API（既存プロンプト）
   → parsed_lines, confidence_flags 更新
   → status: needs_review

3. 人間確認・承認
   検証画面でテーブル編集
   [承認・PDF] クリック
        │
        ▼
   POST /api/ocr/verify { verification_id, corrected_lines, order_date }
   → approve_ocr_verification() Supabase RPC
   → orders + order_lines 作成
   → status: corrected

4. PDF 生成
   GET /api/orders/{order_id}/pdf
   → ReportLab で PDF 生成
   → ブラウザが自動ダウンロード
```

---

## 6. 画面構成

### `/dashboard/verifications` — OCR 検証

```
┌─ ヘッダー ─────────────────────────────────────────────────────┐
│ 🌿 小島農園  OCR検証 | マスターデータ | ⚙設定    [📧 メール取得] │
└────────────────────────────────────────────────────────────────┘
┌─ サイドバー ──┐ ┌─ 左ペイン ──────────────────┐ ┌─ 右ペイン ──────────┐
│ [未処理][全件]│ │ 画像メール:                  │ │ 内容確認・修正フォーム │
│              │ │   <FAX画像プレビュー>         │ │ 受注日: [____]        │
│ ▲ ID:abc123 │ │                              │ │ 明細1:               │
│   要確認 3行 │ │ テキスト/HTMLメール:          │ │  店舗 品目 箱 端 入  │
│              │ │   件名: Fwd: 5/8ヨーク        │ │ [Gemini解析][承認PDF] │
│   ID:def456 │ │   送信者: ...@gmail.com       │ │                      │
│   未処理 0行 │ │   受信: 2026-05-05 19:06     │ │                      │
│              │ │   ─────────────────          │ │                      │
│   ID:ghi789 │ │   本文テキスト（スクロール）    │ │                      │
│   承認済  5行│ │                              │ │                      │
└──────────────┘ └─────────────────────────────┘ └────────────────────┘
```

### `/dashboard/settings` — メール設定

```
┌─ メール設定（IMAP） ───────────────────────────────────────┐
│ IMAPサーバー    [imap.lolipop.jp          ]                │
│ ポート          [993                      ]                │
│ メールアドレス   [order@kojimanouen.com    ]                │
│ パスワード       [●●●●●●●●●●●●●] [👁]                │
│ 送信者フィルタ   [kojimamasayuki31@gmail.com] (空=全件)    │
│ 遡り日数        [3] 日                                     │
│                                          [保存]            │
└────────────────────────────────────────────────────────────┘
┌─ Gemini API ──────────────────────────────────────────────┐
│ APIキー          [●●●●●●●●●●●●●●●●●] [👁]          │
│                                          [保存]            │
└────────────────────────────────────────────────────────────┘
```

---

## 7. 残実装タスク（優先順）

### Phase A：メール関連完成（v3 対応）

| # | タスク | ファイル | 概要 |
|---|---|---|---|
| A1 | メール設定 保存 API | `backend/app/routers/config.py` | `PATCH /api/config/email` でDBに保存 |
| A2 | メール設定 UI 保存 | `app/dashboard/settings/page.tsx` | A1を呼び出す保存ボタン |
| A3 | 送信者フィルタ UI | settings ページ | email_config.sender_email を使用 |
| A4 | テキストメール本文保存 | `email_fetch.py` | `confidence_flags.raw_text` に保存 |
| A5 | テキストメールプレビュー | `image-viewer.tsx` | `text://` URL のとき本文カードを表示 |
| A6 | メール件名・送信者表示 | `verification-list.tsx` | ID の代わりに件名を表示 |
| A7 | 取得後リスト自動更新 | `email-fetch-button.tsx` | 取得完了後に `router.refresh()` |

### Phase B：品質向上

| # | タスク | 概要 |
|---|---|---|
| B1 | pending の再解析ボタン | Gemini クォータ回復後に再試行できる UI |
| B2 | 解析進捗インジケータ | Gemini 解析中のスピナー表示 |
| B3 | エラーハンドリング強化 | IMAP 接続失敗時の詳細エラーメッセージ |

### Phase C：将来実装

| # | タスク | 概要 |
|---|---|---|
| C1 | Google Sheets 連携 | v3 の delivery_sheet_writer.py を使用 |
| C2 | 自動メールポーリング | FastAPI BackgroundTasks で定期取得 |
| C3 | Vercel + Railway デプロイ | 本番環境構築 |

---

## 8. データベーススキーマ（関連テーブル）

### `ocr_verifications`
| カラム | 型 | 説明 |
|---|---|---|
| id | uuid | PK |
| tenant_id | uuid | テナント |
| image_url | text | `https://...` (画像) または `text://{id}` (テキスト) |
| status | OcrStatus | pending / needs_review / corrected / rejected / auto_accepted |
| raw_ocr_json | jsonb | Gemini の生レスポンス |
| parsed_lines | jsonb[] | 解析済み明細行 |
| confidence_flags | jsonb | **source**, **email_id**, **subject**, **from**, **date**, **raw_text** |
| reviewed_by | uuid | FK → profiles |
| created_at | timestamptz | |

### `email_config`
| カラム | 型 | 説明 |
|---|---|---|
| id | uuid | PK |
| tenant_id | uuid | テナント |
| imap_server | text | 例: imap.lolipop.jp |
| imap_port | int | 例: 993 |
| email_address | text | order@kojimanouen.com |
| password | text | **要暗号化** |
| sender_email | text | フィルタ用送信者（null = 全件） |
| days_back | int | デフォルト 3 |

---

## 9. コア処理ロジック（変更禁止）

### 「×数字」ルール
```python
# receive_as_boxes=False（通常）: 総数 ÷ unit
boxes = total // unit
remainder = total - unit * boxes

# receive_as_boxes=True（胡瓜平箱等）: ×数字 = boxes
boxes = stated_number
remainder = 0
```

### ラベル生成ルール
```python
total_boxes = boxes + (1 if remainder > 0 else 0)
# 通常箱: quantity=unit,  is_fraction=False
# 端数箱: quantity=remainder, is_fraction=True
```

---

## 10. リスク

| リスク | 対策 |
|---|---|
| パスワード平文保存 | Supabase Vault または暗号化カラム使用 |
| Gemini クォータ枯渇 | `status=pending` で保存し再解析ボタンを提供 |
| IMAP SSL 証明書エラー | imaplib の `ssl_context` でホスト検証 |
| HTML メール多様性 | html.parser + テキスト前処理でロバスト対応 |
| 重複取得 | `email_id` を `confidence_flags` に保存して重複排除 |

---

## Appendix: ディレクトリ構成（現状）

```
kojima-farm-app-v4/
├── app/
│   ├── dashboard/
│   │   ├── verifications/       ✅ 実装済み
│   │   │   ├── page.tsx
│   │   │   └── _components/
│   │   │       ├── verification-dashboard.tsx
│   │   │       ├── verification-list.tsx
│   │   │       ├── verification-form.tsx
│   │   │       └── image-viewer.tsx
│   │   ├── master/              ✅ 実装済み
│   │   ├── settings/            ⚠️ UI あり、保存API未結合
│   │   └── _components/
│   │       └── email-fetch-button.tsx  ✅ 実装済み
│   ├── actions/
│   │   └── ocr-actions.ts       ✅ 全ステータス対応
│   └── login/                   ✅ 実装済み
├── lib/
│   ├── api-client.ts            ✅ fetchEmails, parseVerification, verifyOcr
│   ├── supabase/server.ts       ✅ createClient, createServiceClient
│   └── schemas/ocr.ts           ✅ Zod スキーマ
├── proxy.ts                     ✅ Next.js 16 認証ミドルウェア
└── backend/
    └── app/
        ├── main.py              ✅
        ├── routers/
        │   ├── email_fetch.py   ✅ HTML対応・重複排除
        │   ├── ocr.py           ✅
        │   ├── orders.py        ✅
        │   └── config.py        ⚠️ email 保存エンドポイント未実装
        └── services/
            ├── email_reader.py  ✅ HTML → テキスト変換対応
            ├── ocr_parser.py    ✅
            └── config_manager.py ✅
```
