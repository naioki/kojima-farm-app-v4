# デプロイ手順（Cloud Run）

## 今回のエラーの原因（Windows特有）

`gcloud run deploy --source .` をWindows端末から実行すると、`node_modules` 内の
シンボリックリンク（npmの依存関係解決で生成される。例: `@alloc/quick-lru`）を
Windowsが読めず `WinError 1920` でクラッシュすることがある。特に `Desktop` フォルダが
OneDrive等でクラウド同期されている環境で起きやすい。

さらに、`.git` の無いフォルダ（zip展開等）から実行すると `Dockerfile` が認識されず
`gcloud` が Buildpacks にフォールバックし、意図した本番イメージと異なるビルドになる。

対策は3段階（下から順に恒久度が高い）。

---

## 対策1: 今すぐ動かす（Cloud Shell・Windowsを経由しない）

ブラウザだけで完結し、上記のWindows特有の問題を一切踏まない。

1. https://console.cloud.google.com を開き、右上の Cloud Shell アイコン（`>_`）をクリック
2. Cloud Shell内で（Linux環境なのでシンボリックリンク問題が起きない）:

```bash
gcloud config set project kojima-farm   # プロジェクトIDに置き換え

git clone https://github.com/naioki/kojima-farm-app-v4.git
cd kojima-farm-app-v4

# フロントエンド
gcloud run deploy kojima-farm-app-v4-frontend --source . --region asia-northeast1

# バックエンド
cd backend
gcloud run deploy kojima-farm-app-v4-backend --source . --region asia-northeast1
```

`npm install` は一切ローカルで実行しないこと（Cloud Run側のDockerビルドが内部で行う）。

---

## 対策2: 恒久対応（Cloud Build トリガー・推奨）

一度設定すれば、以降は `git push` / PRマージだけで自動デプロイされ、
ローカル端末（Windowsでも）から一切アップロードしなくて済む。
CLAUDE.mdに記載の「デプロイトリガー未設定」を解消する対応でもある。

### 一度だけ行う設定（Cloud Shellまたはコンソールで）

```bash
# 1. 必要なAPIを有効化
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  secretmanager.googleapis.com artifactregistry.googleapis.com

# 2. シークレットを作成（値は各自のものを設定。1回だけ）
echo -n "実際のservice_roleキー" | gcloud secrets create supabase-service-role-v4 --data-file=-
echo -n "実際のSupabase URL"    | gcloud secrets create supabase-url-v4 --data-file=-
echo -n "実際のGemini APIキー"  | gcloud secrets create gemini-api-key-v4 --data-file=-

# 3. Cloud BuildサービスアカウントにCloud Run/Secret Manager権限を付与
PROJECT_NUMBER=$(gcloud projects describe kojima-farm --format='value(projectNumber)')
gcloud projects add-iam-policy-binding kojima-farm \
  --member="serviceAccount:${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com" \
  --role="roles/run.admin"
gcloud projects add-iam-policy-binding kojima-farm \
  --member="serviceAccount:${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
gcloud projects add-iam-policy-binding kojima-farm \
  --member="serviceAccount:${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"
```

### GitHub連携トリガーの作成（コンソール操作）

1. Cloud Console → 「Cloud Build」→「トリガー」→「リポジトリを接続」→ GitHub → `naioki/kojima-farm-app-v4` を選択
2. トリガーを2つ作成:
   - **フロントエンド**: イベント=mainへのpush、構成=`cloudbuild.yaml`（リポジトリ直下）
   - **バックエンド**: イベント=mainへのpush、構成=`backend/cloudbuild.yaml`
3. 手動発火は「トリガーを実行」ボタン、または:
   ```bash
   gcloud builds triggers run <トリガー名> --branch=master
   ```

以降は **PRをマージするだけで自動デプロイ** される。手動 `gcloud builds submit` も
Cloud Shellから使えるが（Windowsローカルは避ける）:
```bash
gcloud builds submit --config=cloudbuild.yaml --substitutions=_SERVICE=kojima-farm-app-v4-frontend
```

---

## 対策3: どうしてもWindowsローカルから行う場合

1. **OneDrive等の同期対象外のパスに新規clone**（`Desktop`配下を避ける）:
   ```powershell
   cd C:\
   mkdir dev
   cd dev
   git clone https://github.com/naioki/kojima-farm-app-v4.git
   cd kojima-farm-app-v4
   ```
2. **`npm install` をローカルで実行しない**（node_modulesさえ存在しなければ症状は起きない）
3. `gcloud run deploy kojima-farm-app-v4-frontend --source . --region asia-northeast1`
