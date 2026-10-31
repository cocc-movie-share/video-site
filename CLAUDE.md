# Claude Code 向けルール

- 回答と説明は日本語で、簡潔に。
- セキュリティを最優先。新機能の実装前に「想定される脆弱性・リスク・対策」を提示する。
- 設計の前提は `docs/設計書.md`。変更したら設計書も更新する。
- `main` へ直接コミットしない。`feature/xxx` ブランチ → PR。
- コミットメッセージ例：`feat: add upload feature` / `fix: resolve login issue`
- パスワード・トークン・鍵をコードやログに書かない。秘密情報は Worker Secret か `.dev.vars`。
- TypeScript を使い、`any` は最小限。関数にはコメントを付ける。
- わかりやすさ優先：深い階層や凝った抽象化は避け、CSS は共通クラスを使い回す。
- 画面に文字を表示するときは `textContent` を使い、`innerHTML` は使わない。
- 機能追加時は README・ディレクトリ構成・デプロイ手順・Cloudflare 設定・環境変数一覧を更新する。
