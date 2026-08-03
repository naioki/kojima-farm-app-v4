# System Design v4 — 小島農園 管理システム

**Version**: 4.2  
**Date**: 2026-08-03  
**Status**: In Progress

> **v4.2 の変更**: 実装済みだが本書に載っていなかった3画面（受注一覧・請求書・売上）を
> 追記し、認証・認可の実装状況を実態に合わせた。§7 の残タスク表は完了分を反映済み。
> 改修の巻き戻し手順は `docs/ROLLBACK.md`。

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
| Auth | Supabase Auth。フロント: cookie セッション（`proxy.ts`）／バックエンド: `Authorization: Bearer` の JWT 検証（`backend/app/auth.py`） |
| Database | Supabase Postgres |
| PDF | ReportLab (v3 から移植) |
| AI Parsing | Gemini 2.0-flash API |
| Storage | Supabase Storage (fax-images bucket) |
| Proxy/Auth Middleware | `proxy.ts` (Next.js 16 命名規則) |

### Architecture

```
Browser (Next.js :3000)
  /login
  /dashboard/verifications   ← メイン画面（OCR検証・承認）
  /dashboard/orders          ← 受注一覧・出荷ラベル再発行・品目別出荷票
  /dashboard/invoices        ← 請求書
  /dashboard/analytics       ← 売上ダッシュボード
  /dashboard/master          ← マスターデータ管理
  /dashboard/settings        ← メール・チャット連携・AIプロンプト・会社情報
        │
        │ ブラウザは FastAPI を直接叩かない。
        │ Server Action（app/actions/）と Route Handler（app/api/）だけが
        │ バックエンドと話し、そこでアクセストークンを付与する。
        │ 理由: トークンは httpOnly cookie にありサーバー側でしか読めず、
        │       直叩きの経路は Server Action 側の認可を素通りする裏口になる。
        ▼
Next.js Server (Server Action / Route Handler)
        │ HTTP + Authorization: Bearer <Supabase access token>
        ▼
FastAPI Backend (:8000)   ※ 全ルーターに認証を掛ける（main.py）
  require_user:
    GET  /api/email/fetch         ← IMAP取得 → Storage → ocr_verifications
    POST /api/ocr/parse           ← verification_id → Gemini → parsed_lines
    POST /api/ocr/verify          ← corrected_lines → approve RPC → order_id
    GET  /api/orders              ← 受注一覧（テナントで絞る）
    GET  /api/orders/{id}/pdf     ← order_id → ReportLab → PDF stream
    GET  /api/orders/shipping-sheet/pdf
  require_admin:
    CRUD /api/config/*            ← stores/items/email/chat/prompt
    POST /api/config/email/test   ← IMAP接続確認（副作用なし）
  認証なし（外部Webhook。送信元検証は各Webhookの責務）:
    POST /api/chat/{discord,lineworks,googlechat}
  認証なし（ヘルスチェック）:
    GET  /api/health
        │ SQL（service-role。tenant_id は必ず JWT 由来の値で絞る）
        ▼                                  │ Supabase Storage
Supabase Postgres               Supabase Storage (fax-images/)
```

### 認可の原則

1. **tenant_id はリクエストからも対象レコードからも取らない。** 必ずアクセス
   トークン → `profiles` で解決した値を使う（`backend/app/auth.py`）。
2. **他テナントのレコードは 404。** 403 は「存在はする」ことを漏らすため。
3. **承認者はトークンから決める。** クライアントが指定した `reviewed_by` は無視する。
4. **設定系は管理者のみ。** IMAP パスワードや外部サービスのトークンを扱うため。
5. 障害時は `AUTH_ENFORCED=false` で認証を一時的に外せる（`docs/ROLLBACK.md`）。

---

## 3. 実装済み機能（v4.2 時点）

### ✅ 完了

| 機能 | 場所 |
|---|---|
| Supabase Auth ログイン/リダイレクト | `proxy.ts`, `app/login/page.tsx` |
| ログアウト・ログイン中ユーザー表示 | `app/dashboard/_components/user-menu.tsx` |
| バックエンドAPIの JWT 認証・管理者判定 | `backend/app/auth.py`, `backend/app/main.py` |
| テナント境界の検証（他テナントは404） | `auth.assert_tenant` + 各ルーター |
| OCR 検証ダッシュボード（3分割 / モバイル縦積み） | `app/dashboard/verifications/` |
| 未処理/全件フィルタタブ・期間絞り込み（サーバー側） | `verification-dashboard.tsx`, `page.tsx` |
| 全ステータス表示（承認済・却下含む） | `verification-list.tsx` |
| 承認済み・却下済みは読み取り専用表示 | `verification-form.tsx` |
| Gemini 解析／再解析（左ペインに集約） | `image-viewer.tsx` → `POST /api/ocr/parse` |
| メール本文の編集 → 再解析 | `image-viewer.tsx` → `updateRawText` + parse |
| 承認 & 出荷ラベル PDF 発行・完了カード・PDF再取得 | `verification-form.tsx` → `POST /api/ocr/verify` |
| 却下・却下の取り消し | `ocr-actions.rejectVerification / restoreVerification` |
| メール取得ボタン（ヘッダー） | `email-fetch-button.tsx` → Server Action |
| IMAP 取得・Storage アップロード | `backend/app/routers/email_fetch.py` |
| IMAP 接続テスト（副作用なし） | `POST /api/config/email/test` |
| HTMLメール本文抽出 | `backend/app/services/email_reader.py` |
| テキスト/HTMLメール → Gemini 即時解析 | `email_fetch.py` |
| 重複メール検出（email_id チェック） | `email_fetch.py` |
| **受注一覧**（期間・ステータス絞り込み、削除、PDF再発行） | `app/dashboard/orders/` |
| **品目別出荷票 PDF**（パック作業用） | `orders/_components/item-sheet-dialog.tsx` |
| **請求書**（一覧・作成・PDF・ステータス変更） | `app/dashboard/invoices/` |
| **売上ダッシュボード**（月別・品目別・納入先別） | `app/dashboard/analytics/` |
| マスターデータ CRUD（品目・顧客・商品・規格・価格） | `app/dashboard/master/` |
| 配送順の並び替え（全件を1..Nで保存） | `master-actions.reorderCustomers` |
| 設定画面（メール・チャット連携・AIプロンプト・会社情報） | `app/dashboard/settings/` |
| PDF は Route Handler で中継（トークンを露出させない） | `app/api/orders/**` |
| 日本語フォント（Noto Sans JP） | `app/layout.tsx`, `app/globals.css` |
| loading / error 境界 | `app/dashboard/{loading,error}.tsx` |

### ⚠️ 未実装・残課題

| 項目 | 状況 | 優先度 |
|---|---|---|
| LINE Works / Google Chat Webhook の送信元検証 | Discord は Ed25519 署名を検証しているが、他2つはユーザーIDの許可リストのみ。許可リストが空だと誰でも承認・印刷を実行できる | **高** |
| `email_config.password` の暗号化 | 平文カラムに保存。Supabase Vault か暗号化カラムへ移す | **高** |
| `@ts-nocheck` の解消（3ファイル） | `ocr-actions.ts` / `order-actions.ts` / `master/page.tsx`。受注作成・削除という最重要ロジックを含む | **中** |
| ダークモード | トークンごと削除済み。実装するならハードコード配色（`bg-green-100` 等）の全画面洗い出しが必要 | **低** |
| 売上ダッシュボードの月切り替え | 「今月」固定。過去月の品目別・納入先別を見る手段がない | **低** |
| Google Sheets 連携 | `delivery_sheet_writer.py` はあるが UI 未接続 | **低** |

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

Phase A（v3 対応のメール関連）と Phase B（品質向上）は完了した。内訳:

| # | タスク | 状況 |
|---|---|---|
| A1 | メール設定 保存 API | ✅ `PUT /api/config/email` |
| A2 | メール設定 UI 保存 | ✅ Server Action 経由（`config-actions.ts`） |
| A3 | 送信者フィルタ UI | ✅ settings ページ |
| A4 | テキストメール本文保存 | ✅ `confidence_flags.raw_text` |
| A5 | テキストメールプレビュー | ✅ `image-viewer.tsx` |
| A6 | メール件名・送信者表示 | ✅ `verification-list.tsx` |
| A7 | 取得後リスト自動更新 | ✅ `router.refresh()` |
| B1 | pending の再解析 | ✅ 左ペインの「再解析」（画像・テキスト両方） |
| B2 | 解析進捗インジケータ | ✅ |
| B3 | エラーハンドリング強化 | ✅ `email_reader.friendly_imap_error` |

### Phase D：セキュリティ（残り）

| # | タスク | 概要 |
|---|---|---|
| D1 | LINE Works / Google Chat Webhook の送信元検証 | LINE Works は `X-WORKS-Signature` の HMAC-SHA256、Google Chat は Google 署名付き JWT（`google-auth` は導入済み）。既存連携を壊さないため、シークレット設定時のみ検証する opt-in を推奨 |
| D2 | `email_config.password` の暗号化 | Supabase Vault または暗号化カラム。現状は平文 |
| D3 | `NEXT_PUBLIC_API_URL` の廃止 | ブラウザからの直叩きは排除済みなので、サーバー専用の `API_URL` へ寄せてバックエンドの所在を隠せる（`lib/api-client.ts` は既に `API_URL` 優先） |

### Phase E：保守性

| # | タスク | 概要 |
|---|---|---|
| E1 | `@ts-nocheck` の解消 | `lib/types/supabase.ts` を再生成し、`ocr-actions.ts` / `order-actions.ts` / `master/page.tsx` から外す。`OcrStatus` の誤りは v4.2 で修正済み |
| E2 | 「並び順」概念の統合 | マスタの `sort_order`（DB）／検証フォームの昇降（state）／PDFの店舗逆順（localStorage）が3系統に分裂している |
| E3 | localStorage キーの一元管理 | 現状は各コンポーネントが直接読み書きしている |

### Phase C：将来実装

| # | タスク | 概要 |
|---|---|---|
| C1 | Google Sheets 連携 | v3 の delivery_sheet_writer.py を使用（UI未接続） |
| C2 | 自動メールポーリング | FastAPI BackgroundTasks で定期取得 |
| C3 | ダークモード | 実装するならハードコード配色の全画面洗い出しが前提 |
| C4 | 売上ダッシュボードの月切り替え | 現状「今月」固定 |

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

| リスク | 対策 | 状況 |
|---|---|---|
| バックエンドが無認証で service-role キーを持つ | 全ルーターに Supabase JWT 検証。tenant_id はトークン由来に限定 | ✅ v4.2 |
| ブラウザからの直叩きで認可を素通り | Server Action / Route Handler 経由に統一し `api-client` を server-only に | ✅ v4.2 |
| 承認者のなりすまし | `reviewed_by` をトークンから決定（リクエスト値は無視） | ✅ v4.2 |
| 配送順の破損（帳票の並びが変わる） | 表示順の全件を 1..N で保存 | ✅ v4.2 |
| 一覧の無制限フェッチ | 期間絞り込みをサーバー側へ、取得上限＋打ち切り表示 | ✅ v4.2 |
| Gemini クォータ枯渇 | `status=pending` で保存し再解析ボタンを提供。再解析結果がフォームに反映されない不具合（無駄な再実行の原因）を修正 | ✅ v4.2 |
| 未処理キューが詰まる | 却下と復帰の経路を追加 | ✅ v4.2 |
| パスワード平文保存 | Supabase Vault または暗号化カラム使用 | ⚠️ 未対応（Phase D2） |
| LINE Works / Google Chat Webhook が無検証 | 署名・JWT 検証を追加 | ⚠️ 未対応（Phase D1） |
| IMAP SSL 証明書エラー | imaplib の `ssl_context` でホスト検証 | — |
| HTML メール多様性 | html.parser + テキスト前処理でロバスト対応 | — |
| 重複取得 | `email_id` を `confidence_flags` に保存して重複排除 | — |

---

## Appendix: ディレクトリ構成（現状）

```
kojima-farm-app-v4/
├── app/
│   ├── api/                          Route Handler（PDF中継。トークンを露出させない）
│   │   └── orders/
│   │       ├── [orderId]/pdf/
│   │       └── shipping-sheet/
│   ├── actions/
│   │   ├── ocr-actions.ts            検証の取得・解析・承認・却下
│   │   ├── order-actions.ts          受注の取得・削除
│   │   ├── invoice-actions.ts        請求書
│   │   ├── analytics-actions.ts      売上集計
│   │   └── config-actions.ts         設定（旧: ブラウザ直叩き）
│   ├── dashboard/
│   │   ├── layout.tsx                ヘッダー（ナビ・メール取得・ユーザー/ログアウト）
│   │   ├── loading.tsx / error.tsx   共通の読み込み・エラー境界
│   │   ├── verifications/            OCR検証（メイン画面）
│   │   ├── orders/                   受注一覧・品目別出荷票
│   │   ├── invoices/                 請求書
│   │   ├── analytics/                売上ダッシュボード
│   │   ├── master/                   マスターデータ
│   │   ├── settings/                 メール・チャット・プロンプト・会社情報
│   │   └── _components/              main-nav, email-fetch-button, user-menu
│   ├── login/
│   ├── layout.tsx                    フォント・Toaster（アプリ全体で1つ）
│   └── globals.css                   デザイントークン
├── lib/
│   ├── api-client.ts                 server-only。アクセストークンを付与
│   ├── download.ts                   ブラウザ側のダウンロード（1か所に集約）
│   ├── verification.ts               検証画面の純ロジック
│   ├── verification.test.ts          その vitest テスト
│   ├── schemas/ocr.ts                Zod スキーマ
│   ├── supabase/                     client / server
│   └── types/supabase.ts
├── proxy.ts                          Next.js 認証ミドルウェア
├── vitest.config.mts
├── docs/ROLLBACK.md                  改修の巻き戻し手順
└── backend/
    └── app/
        ├── main.py                   ルーター単位で認証を掛ける唯一の入口
        ├── auth.py                   JWT 検証・テナント境界・管理者判定
        ├── routers/
        │   ├── ocr.py / orders.py / email_fetch.py / config.py   要認証
        │   └── chat.py                                           外部Webhook
        ├── services/
        └── tests/                    test_auth.py ほか
```

## Appendix: 検証コマンド

```bash
# フロントエンド
npx tsc --noEmit      # 型チェック（エラーなしが基準）
npm run lint
npm test              # vitest（純ロジック）
npm run build

# バックエンド
cd backend && .venv/bin/python -m pytest tests/ -q
```

> `"use server"` のファイルは async 関数以外をエクスポートできない。これは
> `tsc` では検出されず `next build` で初めて出るため、Server Action を触ったら
> ビルドまで通すこと。
