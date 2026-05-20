# メルカリAI出品 PWA 作業ルール（参照用）

このファイルは旧Claude Code向けの参照用です。現在の正本は `AGENTS.md` です。

## 概要

古着写真からメルカリ出品用の説明文と、Mac自動入力用データを生成するPWA。

- 場所: `~/メルカリ説明文生成/`
- 主なファイル: `index.html`, `app.js`, `styles.css`, `manifest.json`
- 連携先: `~/mercari-auto/` のMac自動入力サービス
- 配信: GitHub Pages

## 重要ルール

- AIモデルIDは推測で変更しない。公式情報、既存の正常動作、または実API応答で確認してから変更する。
- 2026-05-20以降、PWAはAI APIを直接呼ばず、`~/mercari-auto/server.py` の `/describe` 経由でOpenAI APIを呼ぶ。
- OpenAI APIキーはスマホ側localStorageに保存しない。Mac側 `~/mercari-auto/.env` の `OPENAI_API_KEY` で管理する。
- AI応答をJSONとして使う処理は壊れる前提で扱う。コードフェンス、前置き/後置き、末尾カンマ、スマートクォートを救済するパーサーを維持する。
- 生成結果のJSONパースに失敗した場合は、ユーザーに生テキストだけを見せて終わらせず、コンソールログなどで原因追跡できる状態にする。
- PWA更新時は `index.html` のcache bustと画面上のバージョン表示を更新し、スマホ/ブラウザで最新版が読まれることを確認する。
- 商品名、説明文、状態、価格、写真順、Mac自動入力 payload は出品作業に直結するため、UI変更後も一連の導線を確認する。

## 2026-05-11の再発防止メモ

- 存在しないモデルIDを指定して404になったため、モデルIDを推測で入れるのは禁止。
- AI応答にコードフェンスや前置きが混ざりJSONパースに失敗したため、AI JSONは常に壊れる前提で実装する。
- 下書き保存は `mercari-auto` とCloudflare tunnelに依存するため、PWA側だけでなくMac側サービスの疎通確認まで行う。
