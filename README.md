# video-site

茅ヶ崎アウトリガーカヌークラブの動画共有サイトです。
クラブメンバーはスマホや PC から練習動画・イベント動画を閲覧・保存できます。動画のアップロードは管理者だけが行えます。

## 構成

| 役割 | 使うもの | フォルダ |
|---|---|---|
| 画面 | GitHub Pages | `site/` |
| 認証・API | Cloudflare Worker | `worker/` |
| 動画の保存 | Cloudflare R2（バケット：`cocc-video-site`） | ー |

詳しくは [docs/設計書.md](docs/設計書.md) を参照してください。

## ディレクトリ構成

```
video-site/
├─ site/                 画面（GitHub Pages で公開）
│  ├─ index.html         閲覧者用ページ
│  ├─ administrator/     管理者用ページ
│  ├─ css/style.css
│  └─ js/
│     ├─ config.js       Worker の URL などの設定
│     ├─ api.js          API 呼び出し・ログイン状態の保存
│     ├─ login.js        ログイン画面の共通処理
│     ├─ viewer.js       閲覧者ページ
│     └─ admin.js        管理者ページ
├─ worker/               Cloudflare Worker（TypeScript）
│  ├─ src/index.ts       API の入口
│  ├─ src/auth.ts        パスワード確認・トークン
│  ├─ src/videos.ts      動画一覧・署名付き URL・配信
│  ├─ wrangler.toml      Worker の設定（秘密情報は書かない）
│  └─ .dev.vars.example  ローカル用の秘密情報の見本
├─ docs/                 設計書・手順書
└─ .github/workflows/    GitHub Pages への自動公開
```

## 開発の流れ

1. `main` から作業用ブランチを作る（例：`feature/auth`）
2. 変更してコミット（例：`feat: add login`）
3. Pull Request を作って `main` へマージ
4. マージすると `site/` が GitHub Pages に自動公開される

`main` への直接コミットはできない設定になっています。

## API 一覧

| メソッド | パス | 権限 | 内容 |
|---|---|---|---|
| GET | `/api/health` | なし | 動作確認 |
| POST | `/api/login` | なし | ログイン（閲覧者 / 管理者）。1 分 5 回まで |
| GET | `/api/me` | 閲覧者以上 | ログイン状態の確認 |
| GET | `/api/teams` | 閲覧者以上 | チーム一覧 |
| GET | `/api/videos?team=` | 閲覧者以上 | 動画一覧（チーム指定時はそのチーム＋チーム分けなしの動画） |
| GET | `/api/play?key=` | 閲覧者以上 | 再生・保存用の署名付き URL（10 分有効）を発行 |
| GET | `/media?...&sig=` | 署名付き URL | 動画・サムネイルの配信（Range 対応） |

## 環境変数一覧（Worker）

| 名前 | 種類 | 内容 |
|---|---|---|
| `ALLOWED_ORIGIN` | 通常（wrangler.toml） | API の呼び出しを許可する画面のドメイン |
| `MAX_UPLOAD_MB` | 通常（wrangler.toml） | アップロード上限（MB） |
| `VIEWER_PASSWORD` | Secret | 閲覧用パスワード |
| `ADMIN_PASSWORD` | Secret | 管理者用パスワード |
| `TOKEN_SECRET` | Secret | ログイン用トークンの署名鍵 |

## 秘密情報の扱い

パスワードや鍵は Git に入れません。Worker の Secret として登録します。手順は [docs/デプロイ手順.md](docs/デプロイ手順.md) を参照してください。
