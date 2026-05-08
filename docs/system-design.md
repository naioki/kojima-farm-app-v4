# 小島農園 受注管理システム 設計書

## 概要

FAX・メールで届く注文書を OCR（Gemini）で自動解析し、出荷ラベル PDF と納品書を生成する農場向け受注管理システム。

---

## システム構成

```
ブラウザ (Next.js 16 App Router)
    ↕ Server Actions / fetch
Supabase (DB + Auth + Storage)
    ↕ REST
FastAPI バックエンド (Python / uvicorn)
    ↕ Gemini API
Google Gemini (OCR・テキスト解析)
```

| レイヤー | 技術 | 役割 |
|---|---|---|
| フロントエンド | Next.js 16 App Router, shadcn/ui, Tailwind | UI・Server Actions |
| データベース | Supabase (PostgreSQL) | 受注・顧客・商品マスター・認証 |
| バックエンド | FastAPI + uvicorn (port 8000) | Gemini API 呼び出し・PDF 生成 |
| PDF 生成 | ReportLab | 出荷ラベル・納品書 |
| OCR | Google Gemini | FAX 画像・メールテキスト解析 |

---

## データベース主要テーブル

### `tenants` — テナント（農場）
### `profiles` — ユーザー（role: admin / viewer）
### `customers` — 得意先（店舗）
### `products` — 品目（胡瓜、長ネギ、春菊など）
### `product_standards` — 規格（品目×規格×入数）

| 列 | 型 | 説明 |
|---|---|---|
| name | text | 規格名（例: 3本、50本、バラ） |
| unit_size | int | 1箱あたりの入数 |
| is_active | bool | 有効フラグ（無効規格は承認時に使用不可） |

### `ocr_verifications` — OCR検証レコード

| 列 | 型 | 説明 |
|---|---|---|
| image_url | text | FAX画像URL（`text://` プレフィックスでテキストメール） |
| status | enum | pending / needs_review / corrected |
| parsed_lines | jsonb | Gemini 解析結果（箱数・バラ・規格） |
| confidence_flags | jsonb | raw_text, subject, from, date, warnings |
| order_id | uuid | 承認後に紐付く受注ID（受注削除時 NULL に戻す） |

### `orders` / `order_lines` — 受注・明細

---

## 主要フロー

### 1. メール取得フロー
```
メール取得ボタン → POST /api/email/fetch
→ IMAP接続 → メール本文/添付FAX取得
→ ocr_verifications レコード作成（status=pending）
→ confidence_flags に raw_text / subject / from / date を保存
```

### 2. OCR 解析フロー
```
Gemini解析ボタン → POST /api/ocr/parse
→ image_url が text:// → confidence_flags.raw_text を Gemini へ
→ image_url が画像URL → Supabase Storage からダウンロード → Gemini へ
→ 解析結果を validate_and_fix_order_data でバリデーション
→ DB から規格を引いてスペック自動補完（1候補なら自動入力）
→ parsed_lines / confidence_flags を DB 更新（既存フラグを保持してマージ）
→ status = needs_review
```

**重要**: `confidence_flags` の更新は必ず既存値にマージする。上書きすると `raw_text`・`subject`・`from`・`date` が消える。

### 3. 承認フロー
```
承認ボタン → approveWithFastApi (Server Action)
→ POST /api/ocr/verify
→ _resolve_lines で store/item/spec を DB で事前検証・自動補完
→ approve_ocr_verification RPC 呼び出し
→ orders + order_lines 作成
→ PDF 自動ダウンロード（ファイル名: 出荷ラベル_YYYYMMDD.pdf）
```

**_resolve_lines の補完ルール:**
- store: 完全一致 → 部分一致（候補1件なら自動補完）
- item: 完全一致 → 部分一致（候補1件なら自動補完）
- spec 空: 規格が1件のみ → 自動補完
- spec 不一致: 部分一致（候補1件なら自動補完）

### 4. 受注削除フロー
```
削除ボタン → deleteOrder (Server Action)
→ RLS確認（テナント所有チェック）
→ service client で:
   1. ocr_verifications.order_id = NULL, status = needs_review（再承認可能に）
   2. order_lines 削除
   3. orders 削除
→ revalidatePath
```

---

## PDF 生成仕様

### ファイル名
`出荷ラベル_YYYYMMDD.pdf`（日付はゼロ埋めなし → `20260508`）

### ページ構成
1. **出荷一覧表 + 納品書**（A4×1枚）
2. **出荷ラベル**（A4 2列×4段 = 8枚/ページ、Cut and Stack形式）

### 出荷一覧表（ページ1上段）
| 店舗名 | 品目 | フル箱 | 端数 | 合計 |
- 端数は本数で表示（例: 50本）
- 合計は総本数（boxes × unit_size + remainder）

### 出荷・納品書（ページ1下段）
| 品目 | 規格 | 数量 | 単位 | 単価 | 金額 | 備考 |
- 品目×規格ごとに全店舗合計

### ラベル仕様（Cut and Stack）
- A4用紙を 2列×4段 に分割（105×74.25mm/枚）
- フルラベル: 店舗名・品目・規格・箱番号・枚数・出荷日
- 端数ラベル: 水色背景・端数本数を大きく表示

### 店舗逆順設定
- ヘッダーの「店舗逆順：ON/OFF」トグルで切替
- `localStorage` に保存（ページ更新後も維持）
- PDF API に `?reverse=1` パラメータで渡す

---

## バックエンド設定ファイル

`backend/config/`

| ファイル | 内容 |
|---|---|
| `stores.json` | 店舗名リスト（OCR正規化用） |
| `items.json` | 品目名正規化マップ（表記ゆれ対応） |
| `item_settings.json` | 品目ごとの入数・単位・受信方法 |
| `units.json` | 店舗×品目×規格ごとの入数マスター |

### item_settings.json の重要設定

```json
{
  "胡瓜": {
    "default_unit": 50,
    "unit_type": "本",
    "receive_as_boxes": true
  }
}
```

`receive_as_boxes: true` → FAXの数字を「箱数」として扱う（÷unit せずそのまま boxes に入れる）
`receive_as_boxes: false` → FAXの数字を「総数」として扱う（÷unit で箱数・バラを計算）

---

## エラーコード（RPC）

| コード | 意味 | 対処 |
|---|---|---|
| P0001 | 品目が見つからない | 品目マスターに登録 |
| P0002 | 店舗が見つからない | 得意先マスターに登録 |
| P0003 | 規格が見つからない | 品目マスターに規格を追加 |

---

## 既知の注意点

- Supabase 通常クライアント: RLS 適用（テナント分離）
- Supabase サービスクライアント: RLS バイパス（削除・管理操作のみ）
- PDF の `Content-Disposition` ヘッダーに日本語ファイル名を使う場合は RFC 5987 形式 (`filename*=UTF-8''...`) を使用する
- `confidence_flags` は上書きせずマージすること（raw_text が消える）
- 受注削除時は必ず `ocr_verifications` の `order_id=NULL` + `status=needs_review` に戻す
