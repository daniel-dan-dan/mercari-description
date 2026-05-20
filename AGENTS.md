# メルカリAI出品 PWA 作業ルール

## Codex移行メモ

- この `AGENTS.md` をCodex用の作業ルール正本とする。
- `CLAUDE.md` は参照用として残す。重要な差分を見つけたら、削除ではなくこのファイルへ統合する。
- AIモデルID、APIエンドポイント、認証情報は推測で変更しない。公式情報、既存設定、または1件だけの実API応答で確認してから変更する。
- 生成AIランタイムは、PWAから直接AI APIを呼ばず、`~/mercari-auto/server.py` の `/describe` 経由でOpenAI APIを呼ぶ。
- OpenAI APIキーはスマホ側localStorageに保存しない。Mac側 `~/mercari-auto/.env` の `OPENAI_API_KEY` で管理する。

## 概要

古着写真からメルカリ出品用の説明文と、Mac自動入力用データを生成するPWA。

- 場所: `~/メルカリ説明文生成/`
- 主なファイル: `index.html`, `app.js`, `styles.css`, `manifest.json`
- 連携先: `~/mercari-auto/` のMac自動入力サービス
- 配信: GitHub Pages

## 重要ルール

- 現状は `app.js` の `callDescriptionAi()` がGAS経由でMac側サービスURLを取得し、`/describe` へ画像を送る構成。
- 初期設定画面はGAS URLだけをlocalStorageへ保存する前提。AIキーをPWA側に戻さない。
- AI応答をJSONとして使う処理は壊れる前提で扱う。コードフェンス、前置き/後置き、末尾カンマ、スマートクォートを救済するパーサーを維持する。
- 生成結果のJSONパースに失敗した場合は、ユーザーに生テキストだけを見せて終わらせず、コンソールログなどで原因追跡できる状態にする。
- PWA更新時は `index.html` のcache bust、Service Workerの `CACHE_NAME`、画面上のバージョン表示を更新し、スマホ/ブラウザで最新版が読まれることを確認する。
- 商品名、説明文、状態、価格、写真順、Mac自動入力 payload は出品作業に直結するため、UI変更後も一連の導線を確認する。
- 出品確定はユーザー判断に残す。Codexは説明文・価格・カテゴリ・状態の下書き、Mac自動入力、下書き保存までを補助範囲にする。

## AIランタイム運用方針

- 2026-05-20に、Claude API直呼びから `mercari-auto` 経由のOpenAI API呼び出しへ移行した。
- Codex自体は作業エージェントであり、PWAから直接呼ぶ生成AIランタイムではない。
- OpenAIモデルID、画像入力形式、JSON出力形式は公式情報または1件テストで確認してから変更する。
- 静的PWAからAPIキーを直接扱う構成はリスクがあるため、AI APIキーはMac側サービスに閉じる。
- 既存の `parseAiJson()`、説明文生成テンプレート、Mac自動入力payloadは維持し、AIプロバイダ差し替えだけでUI導線を壊さない。
- 移行完了条件は、1件の写真セットでブランド・カテゴリ・状態・説明文・販売価格・Mac下書き保存payloadまで確認できること。

## 再発防止メモ

- 存在しないモデルID指定で404になったことがあるため、モデルIDを推測で入れるのは禁止。
- AI応答にコードフェンスや前置きが混ざりJSONパースに失敗したことがあるため、AI JSONは常に壊れる前提で実装する。
- 下書き保存は `mercari-auto` とCloudflare tunnelに依存するため、PWA側だけでなくMac側サービスの疎通確認まで行う。
