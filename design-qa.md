# 相場リサーチ3段階入力 Design QA

## 比較条件

- source visual truth path: `docs/design/research-guided-selected.png`
- normalized source path: `docs/design/research-guided-selected-390x844.png`
- implementation screenshot path: unavailable（この環境のブラウザ安全設定により、ローカルURLと公開URLの画面取得が拒否されている）
- viewport: CSS 390 × 844 px
- source pixels: 853 × 1844 px
- normalized source pixels: 390 × 844 px
- implementation pixels: unavailable
- density normalization: sourceを390 × 844 pxへ縮小済み
- state: 相場リサーチタブ、検索対象 1/3、初期入力状態

## Browser-rendered evidence

ブラウザ描画画像は取得できていない。公開HTMLは `v20260723d`、公開Service Workerは `mercari-description-v20260723d` まで確認済み。

Primary interactions intended and covered by automated checks:

- 検索対象 → 絞り込み → 確認・保存の3段階切替
- 戻る操作
- 保存済み依頼への移動
- 最低価格が最高価格を超える入力の停止
- 既存の17入力・保存・コピー操作の維持

Console errors checked: unavailable（ブラウザ画面取得と同じ安全設定の制約）

## Full-view comparison evidence

ソース画像は開いて確認済み。実装はコード、構文テスト、自動テスト、公開HTMLで確認したが、実装スクリーンショットを取得できないため、同一入力での横並び比較は未実施。

## Focused region comparison evidence

未実施。3段階進捗、3つの検索対象入力、現在の条件、次へボタンのブラウザ描画画像が取得できていないため。

## Required fidelity surfaces

- Fonts and typography: Apple system / Hiragino Sans系と指定サイズを実装。ブラウザ描画未確認。
- Spacing and layout rhythm: 390px向けの3段階進捗、74px入力行、全幅主操作を実装。ブラウザ描画未確認。
- Colors and visual tokens: `#f23d4a`、白、淡いピンク、`#0f8f79` を使用。ブラウザ描画未確認。
- Image quality and asset fidelity: ソースに写真・装飾画像なし。UIアイコンは既存Lucideライブラリを使用。
- Copy and content: 「条件を作る」「検索対象」「絞り込み」「確認・保存」「夜間3:20に自動実行」などを実装。

## Findings

- [P1] ブラウザ描画による最終視覚確認が未完了
  - Location: 相場リサーチタブ全体
  - Evidence: ソース画像は確認できたが、実装スクリーンショットを取得できず、同じ390 × 844 pxで比較できていない。
  - Impact: 文字折り返し、画面内に収まる情報量、入力欄と進捗の間隔を最終判定できない。
  - Fix: 公開画面の相場リサーチタブを390 × 844 pxで撮影し、正規化済みソースと横並びで比較する。

## Implementation checklist

- [x] 検索対象・絞り込み・確認保存の3段階へ再構成
- [x] 既存の全検索条件を維持
- [x] 現在条件のライブ表示を簡潔化
- [x] 保存前の全条件確認を追加
- [x] 価格範囲の矛盾を止めるガードを追加
- [x] PWA版数、cache bust、Service Workerを `v20260723d` へ更新
- [x] 構文テスト、自動テスト、公開HTML・公開Service Worker反映確認
- [ ] ブラウザ描画画像の取得と同一入力での最終比較

## Comparison history

- Initial implementation: 選択画像を基準に3段階UI、検索対象の大きな入力行、進捗表示、現在条件、主ボタンを実装。
- Code-level refinement: 共有タブを下線式へ変更し、販売状況に応じて現在条件の説明文が変わるよう修正。
- Post-fix visual evidence: unavailable。ブラウザ安全設定が画面取得を拒否している。

final result: blocked
