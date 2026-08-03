# デプロイ手順（Cloud Run）

本番は Cloud Run の2サービス構成。プロジェクト `kojima-farm` / リージョン `asia-northeast1`。

| サービス | 役割 | URL |
|---|---|---|
| `kojima-farm-frontend` | Next.js | `https://kojima-farm-frontend-86362266171.asia-northeast1.run.app` |
| `kojima-farm-backend` | FastAPI | `https://kojima-farm-backend-86362266171.asia-northeast1.run.app` |

## ⚠️ 認証を有効化するデプロイの前に必ず読む

### 1. バックエンドに `NEXT_PUBLIC_SUPABASE_ANON_KEY` を設定する

改修前のバックエンドは Supabase の URL と service-role キーだけで動いていたため、
**ANON キーは設定されていない**。アクセストークンの検証に必要なので、
これが無いと起動時に停止する（意図的にそうしてある）。

```bash
gcloud run services update kojima-farm-backend \
  --region asia-northeast1 \
  --update-env-vars NEXT_PUBLIC_SUPABASE_ANON_KEY=<ANONキー>
```

ANON キーは Supabase の **Project Settings > API** から取得する。
**公開前提の値**で、service-role キーとは別物（service-role は絶対に露出させない）。

設定を忘れて出した場合の挙動:

- 起動時に `RuntimeError` で停止し、ログに未設定の変数名が出る
- Cloud Run は**新しいリビジョンを昇格させない**ので、直前のリビジョンが配信を続ける
- つまり**サービスは落ちない**。ログを見て設定し、再デプロイすればよい

### 2. フロントとバックエンドは同時に出す

この2つはセットで動く。片方だけ出すと次の状態になる。

| 出したもの | 症状 |
|---|---|
| バックエンドのみ | フロントがトークンを送らないので**全API が 401** |
| フロントのみ | 設定画面の「接続テスト」だけ 404（`POST /api/config/email/test` が無いため）。他は動く |

やむを得ずバックエンドだけ先に出す場合は `AUTH_ENFORCED=false` を併用する。

### 3. フロントの `NEXT_PUBLIC_*` はビルド時に埋め込まれる

`Dockerfile` の `npm run build` が `.env.production` を読んでインライン化する。
**Cloud Run の環境変数に後から入れても client bundle には反映されない。**
値を変えたら再ビルドが必要。

`.env.production` に入っているもの:

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
NEXT_PUBLIC_API_URL          # バックエンドのURL
```

`SUPABASE_SERVICE_ROLE_KEY` は `NEXT_PUBLIC_` 接頭辞が無いのでバンドルに入らない。
Cloud Run のフロントサービス側の環境変数に設定する（Server Action が使う）。

> バックエンドの所在を隠したい場合は、サーバー専用の `API_URL` に同じ値を入れると
> `lib/api-client.ts` がそちらを優先する。ブラウザからの直叩きは排除済みなので、
> 最終的には `NEXT_PUBLIC_API_URL` を消せる。

## 手順

```bash
# 1. バックエンドの環境変数を先に整える（上記1）
# 2. バックエンドをデプロイ
gcloud run deploy kojima-farm-backend --region asia-northeast1 --source backend

# 3. フロントをデプロイ
gcloud run deploy kojima-farm-frontend --region asia-northeast1 --source .
```

## デプロイ後の確認

```bash
BACKEND=https://kojima-farm-backend-86362266171.asia-northeast1.run.app

# 認証が有効になっているか（auth_enforced: true が返る）
curl -s $BACKEND/api/health

# 無認証で弾かれるか（401 が返れば正しい。200 なら認証が効いていない）
curl -s -o /dev/null -w "%{http_code}\n" $BACKEND/api/orders

# ドキュメントが非公開か（404 が返れば正しい）
curl -s -o /dev/null -w "%{http_code}\n" $BACKEND/api/docs
```

画面側は次を確認する。

1. ログイン → 検証画面が表示される
2. ヘッダー右のユーザー表示からログアウトできる
3. 受注一覧で PDF がダウンロードできる（Route Handler 経由になっている）
4. 設定画面が読める（管理者のみ）／「接続テスト」がメールを取り込まない
5. マスターの配送順を変更 → **リロードしても順番が保たれている**

## 切り戻し

`docs/ROLLBACK.md` を参照。認証だけ外すなら再デプロイ不要:

```bash
gcloud run services update kojima-farm-backend \
  --region asia-northeast1 --update-env-vars AUTH_ENFORCED=false
```
