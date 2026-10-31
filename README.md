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
│  └─ js/config.js       Worker の URL などの設定
├─ worker/               Cloudflare Worker（TypeScript）
│  ├─ src/index.ts
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

## 秘密情報の扱い

パスワードや鍵は Git に入れません。Worker の Secret として登録します（手順はデプロイ手順書に記載予定）。
