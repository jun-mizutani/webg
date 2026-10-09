# cache_clear_webg

[English](README.en.md) | 日本語

## 概要

開発時にwebgコアの古いES module URLを使わないよう、`webg`配下の全JavaScript moduleを一意な`?v=...`付きURLでimportするユーティリティです。

## 実行方法

実行ファイルは[`cache_clear_webg.html`](./cache_clear_webg.html)です。Webサーバー経由で開き、`全coreを再import`を押します。完了後に通常のsampleを開き直してください。

対象はwebgコアのES moduleです。ブラウザのほかのHTTPキャッシュは保持されます。`webg`コアのimport URLだけを実行ごとに変えて、各moduleの最新版を取得します。`webg`コア自身のimport文にはキャッシュクエリを追加しません。

`webg`へmoduleを追加した場合は、`main.js`のcore module一覧も更新してください。
