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

## 1コンテナ構成（任意・移行用）

`Dockerfile.allinone` を使うと Next.js と FastAPI を1つの Cloud Run サービスに
まとめられる。**既存の2サービス構成はそのまま使えるので、切り替えは任意。**

### 何が良くなるか

| | 2サービス（現行） | 1コンテナ |
|---|---|---|
| バックエンドの公開範囲 | インターネットから到達可能 | `127.0.0.1` バインドで**外部から到達不可** |
| CORS | `allow_origin_regex` の維持が必要 | 不要（同一オリジン） |
| デプロイ | 2つを同時に出す必要あり | 1回 |
| API 呼び出し | インターネット往復 | ループバック |
| min-instances のコスト | 2サービス分 | 1サービス分 |

### 代償

- **コールドスタートが遅い** — Node と Python の両方が起動する。`--min-instances=1` を推奨。
- **イメージが大きい** — node + python + 日本語フォント6MB。現行の約200MB → 600〜800MB程度。
- **スケールが連動する** — 単一農園の負荷なら実質問題にならない。

### 移行手順

**1. Webhook の URL を変更する（外部コンソール作業。これが必須）**

Discord / LINE Works / Google Chat の3つが現在 `kojima-farm-backend-...` を
向いている。1コンテナ構成ではホスト名が変わるため、各サービスの管理画面で
登録先を差し替える。

| サービス | 変更後の URL |
|---|---|
| Discord（Interactions Endpoint URL） | `https://<統合後のURL>/api/chat/discord` |
| LINE Works（Callback URL） | `https://<統合後のURL>/api/chat/lineworks` |
| Google Chat（App URL） | `https://<統合後のURL>/api/chat/googlechat` |

Next.js 側の `app/api/chat/[...path]/route.ts` がこれを内部の FastAPI へ
中継する。**ボディは生バイトのまま転送**しているので Discord の Ed25519 署名
検証は壊れない（パースして再シリアライズすると署名が一致しなくなる）。

> `print_agent.py` は Supabase を直接見ているので変更不要。

**2. デプロイする**

```bash
gcloud run deploy kojima-farm-app \
  --region asia-northeast1 \
  --source . \
  --min-instances 1 \
  --set-env-vars \
NEXT_PUBLIC_SUPABASE_ANON_KEY=<ANONキー>,SUPABASE_SERVICE_ROLE_KEY=<service-roleキー>,GEMINI_API_KEY=<Geminiキー>
```

`--source .` で Cloud Build を使う場合、既定では `Dockerfile` が選ばれる。
`Dockerfile.allinone` を使うには次のいずれか:

```bash
# a) Cloud Build の設定でファイルを指定する
gcloud builds submit --tag gcr.io/kojima-farm/kojima-farm-app \
  --file Dockerfile.allinone .
gcloud run deploy kojima-farm-app --image gcr.io/kojima-farm/kojima-farm-app --region asia-northeast1

# b) 切り替えを確定させるなら Dockerfile を置き換える
git mv Dockerfile Dockerfile.frontend-only
git mv Dockerfile.allinone Dockerfile
```

**3. 確認する**

```bash
URL=https://<統合後のURL>

curl -s $URL/api/health                                       # フロントは 404（Next.js のルートに無い）
curl -s -o /dev/null -w "%{http_code}\n" $URL/api/chat/discord  # 401 か 400（署名が無いため）＝中継できている
```

画面が動くこと、PDF が出ること、チャットからの承認が動くことを確認する。

**4. 旧サービスを止める**

動作確認が済んだら:

```bash
gcloud run services delete kojima-farm-backend --region asia-northeast1
```

### 環境変数（1コンテナ構成）

`Dockerfile.allinone` が既定値を持っているもの（変更不要）:

```
INTERNAL_API_PORT=8000
INTERNAL_API_ORIGIN=http://127.0.0.1:8000   # Webhook 中継の宛先
API_URL=http://127.0.0.1:8000               # Server Action からの宛先
```

`INTERNAL_API_ORIGIN` を**設定しなければ** Webhook の中継は 404 を返す。
つまり2サービス構成では中継ルートは無効のまま無害に存在する。

### 切り戻し

旧サービスを消す前なら、Webhook の URL を戻して従来のフロントを再デプロイする
だけで戻せる。**旧バックエンドを消すのは動作確認が終わってから。**

## 切り戻し（認証まわり）

`docs/ROLLBACK.md` を参照。認証だけ外すなら再デプロイ不要:

```bash
gcloud run services update kojima-farm-backend \
  --region asia-northeast1 --update-env-vars AUTH_ENFORCED=false
```
