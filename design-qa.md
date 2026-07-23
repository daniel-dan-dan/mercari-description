# 100円値下げ一覧 コンパクト表示 Design QA

## 比較条件

- source visual truth path: `docs/design/markdown-compact-selected.png`
- normalized source path: `docs/design/markdown-compact-selected-390x844.png`
- implementation screenshot path: unavailable（この環境のブラウザ安全設定により、ローカルURLと公開URLの双方で画面取得が拒否された）
- viewport: CSS 390 × 844 px
- source pixels: 853 × 1844 px
- normalized source pixels: 390 × 844 px
- implementation pixels: unavailable
- density normalization: sourceを390 × 844 pxへ縮小済み
- state: 100円値下げタブ、全商品表示、値下げ中商品を含む一覧

## Full-view comparison evidence

ソース画像は開いて確認済み。実装側は公開HTML/CSS、構文テスト、自動テスト、GitHub Pagesの `v20260723c` 反映までは確認できたが、ブラウザ描画画像を取得できなかったため、同一入力での横並び比較は未実施。

## Focused region comparison evidence

未実施。商品画像、画像下端に重なる状態表示、現在価格、下限入力、自動ON/OFF、3区分フィルターのブラウザ描画画像が取得できていないため。

## Findings

- [P1] ブラウザ描画による最終視覚確認が未完了
  - Location: 100円値下げタブ全体
  - Evidence: ソース画像は確認できたが、実装スクリーンショットを取得できず、同一390 × 844 pxで比較できていない。
  - Impact: 文字折り返し、商品行の高さ、画像下端の状態表示、価格欄とトグルの位置ずれを最終判定できない。
  - Fix: 実装済み公開画面の390 × 844 pxスクリーンショットを取得し、正規化済みソースと同一比較画像に並べて再確認する。

## Implementation Checklist

- [x] 4操作を「更新・保存・確認・実行」に短縮
- [x] 「すべて・値下げ中のみ・値下げなしのみ」の3区分フィルターを実装
- [x] 商品画像、タイトル、現在価格、下限価格、自動ON/OFFを1行へ集約
- [x] 「100円値下げ中」などの状態表示を商品画像の下端へ移動
- [x] 「次回」「残り」を非表示
- [x] Service Worker、cache bust、画面版数を `v20260723c` へ更新
- [x] 構文テスト、自動テスト、公開HTML反映確認
- [ ] ブラウザ描画画像の取得と同一入力での最終比較

## Comparison History

- Initial implementation: ソース画像を基準にコードを実装し、390px以下で価格欄が2列へ戻る既存モバイル上書きを修正した。
- Post-fix evidence: 構文・自動テストと公開HTML `v20260723c` は確認済み。ブラウザ描画証跡は安全設定により未取得。

final result: blocked
