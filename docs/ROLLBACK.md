# ロールバック手順

このブランチ（`claude/design-uiux-flow-review-ib6kxu`）の変更は、**1コミット＝1つの独立した修正**として
積んである。どの修正も単独で取り消せる。

## 基準点（変更前の状態）

| 名前 | コミット | 内容 |
|---|---|---|
| `origin/master` | `16a98ac` | 改修前の状態。**これが正式な基準点** |
| `pre-hardening-baseline` | `16a98ac` | 同じコミットを指すローカルタグ（打つと読みやすい） |

改修着手時点で `origin/master` が `16a98ac` であり、このブランチはそこから
分岐している。したがって基準点は常に `origin/master` で参照できる。

タグはこの環境の Git プロキシがタグの push を拒否する（403）ためローカルのみ。
無くても困らないが、あると履歴が読みやすいので必要なら打ち直す:

```bash
git tag -f pre-hardening-baseline origin/master
```

以降の手順で `pre-hardening-baseline` と書いてある箇所は、
すべて `origin/master`（または `16a98ac`）に置き換えても同じ結果になる。

## パターン1: 全部まとめて元に戻す

作業ツリーを改修前に戻すだけなら:

```bash
git checkout claude/design-uiux-flow-review-ib6kxu
git reset --hard pre-hardening-baseline
```

すでにリモートへ push 済みのものを戻す場合:

```bash
git push --force-with-lease origin claude/design-uiux-flow-review-ib6kxu
```

> `--force-with-lease` を使う（`--force` は使わない）。他の人が同じブランチに
> push していた場合に、その変更を巻き込んで消すのを防いでくれる。

履歴を書き換えずに「打ち消すコミット」を積みたい場合はこちら:

```bash
git revert --no-commit pre-hardening-baseline..HEAD
git commit -m "改修をすべて打ち消す"
```

## パターン2: 特定の修正だけ取り消す

各コミットは独立しているので、狙ったものだけ revert できる。

```bash
# 何が入っているか一覧する
git log --oneline pre-hardening-baseline..HEAD

# 例: UIの変更だけ戻したい
git revert <そのコミットのSHA>
```

コミットの粒度は次の方針で切っている:

1. **基盤・安全側の修正**（認証、データ整合性）
2. **動線の修正**（画面遷移・操作フロー）
3. **UIの修正**（見た目・レスポンシブ）

依存関係は「後のコミットが前のコミットに依存する」一方向のみ。
つまり **revert は新しいものから順に**行うのが安全。

### 依存関係で注意が必要な組み合わせ

認証まわりの2コミット（バックエンド／フロント）は**セットで扱う**。

| 取り消したいもの | 先に取り消す必要があるもの |
|---|---|
| バックエンドJWT認証 | フロントのJWT送信 |
| フロントのJWT送信 | なし（単独で戻せる） |

- **バックエンドだけ戻す**: 動作する。フロントが送った JWT が無視されるだけ。
  ただしフロント側が使う `POST /api/config/email/test`（副作用のない接続テスト）が
  無くなるため、設定画面の「接続テスト」ボタンだけ 404 になる。
- **フロントだけ戻す**: **不可**。バックエンドが JWT を要求するので全 API が 401 になる。
  この構成にせざるを得ない場合は、後述の `AUTH_ENFORCED=false` を併用する。

デプロイもこの2つは同時に出す。片方だけ本番へ出すと上記の状態になる。

## パターン3: 認証だけ一時的に無効化する（コード変更なし）

本番で認証が原因の障害が出た場合、**デプロイをやり直さずに**環境変数で切れる。

```bash
# バックエンド（Cloud Run）の環境変数に設定
AUTH_ENFORCED=false
```

`false` にすると JWT 検証をスキップし、改修前と同じ「無認証で通る」挙動に戻る。
起動ログとレスポンスヘッダに警告が出る。**恒久的な設定にはしないこと** —
これは障害時に息をつくための逃げ道であって、設定として正しい状態ではない。

デフォルトは `true`（未設定なら認証は有効）。

## 検証コマンド

ロールバック後、壊れていないことを次で確認する:

```bash
# バックエンド
cd backend && .venv/bin/python -m pytest tests/ -q

# フロントエンド
npx tsc --noEmit
npm run lint
```

数字の目安:

| 時点 | バックエンドテスト | 型チェック | lint |
|---|---|---|---|
| 改修前（`origin/master`） | 18 件パス | エラーなし | 33 errors / 10 warnings |
| 改修後 | 80 件以上パス | エラーなし | 33 errors / 8 warnings |

lint の 33 errors は改修前から存在するもので、今回の変更で増やしていない。
バックエンドのテスト件数がこれを下回ったら何かを取りこぼしている。

## 開発環境の再構築

`node_modules` と `backend/.venv` はコミットしていないので、
クローンし直した場合は次で復元する:

```bash
npm install
cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt pytest
```
