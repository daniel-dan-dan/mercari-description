#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const storage = new Map();
const context = {
  console,
  URL,
  globalThis: null,
  localStorage: {
    getItem: key => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key),
  },
};
context.globalThis = context;
context.__MERCARI_TEST__ = true;
vm.createContext(context);

const source = [
  fs.readFileSync('catalog-data.js', 'utf8'),
  fs.readFileSync('app.js', 'utf8'),
].join('\n');
const testSource = `
  const testRows = [
    {
      itemId: 'm00000000001',
      title: '値下げしていない商品',
      currentPrice: 2000,
      minPrice: 1900,
      autoEnabled: false,
      recommendation: {
        type: 'largeMarkdown',
        suggestedPrice: 1700,
        reasons: ['7日間いいね増加なし・100円値下げ3回後も反応がありません'],
        warnings: [],
        displayOnly: true,
      },
      likeMetrics: {
        total: 4,
        delta24h: 0,
        delta72h: 0,
        delta7d: 0,
        observedDays: 8,
      },
    },
    {
      itemId: 'm00000000002',
      title: '100円値下げ中の商品',
      currentPrice: 2500,
      minPrice: 1000,
      autoEnabled: true,
      imageUrl: 'https://static.mercdn.net/item/detail/orig/photos/m00000000002_1.jpg',
      url: 'https://jp.mercari.com/item/m00000000002',
      recommendation: {
        type: 'markdown100',
        suggestedPrice: 2400,
        reasons: ['直近72時間でいいねが1件増えています'],
        displayOnly: true,
      },
      likeMetrics: {
        total: 8,
        delta24h: 0,
        delta72h: 1,
        delta7d: null,
        observedDays: 4,
      },
    },
    {
      itemId: 'm00000000003',
      title: '下限価格に到達した商品',
      currentPrice: 1000,
      minPrice: 1000,
      autoEnabled: true,
    },
  ];

  markdownFilterMode = 'all';
  globalThis.__allIds = filteredMarkdownRows(testRows).map(row => row.itemId);
  markdownFilterMode = 'enabled-only';
  globalThis.__enabledIds = filteredMarkdownRows(testRows).map(row => row.itemId);
  markdownFilterMode = 'disabled-only';
  globalThis.__disabledIds = filteredMarkdownRows(testRows).map(row => row.itemId);
  globalThis.__cardHtml = renderMarkdownCard(testRows[1]);
  globalThis.__warningCardHtml = renderMarkdownCard(testRows[0]);
  markdownRows = [{
    itemId: 'm00000000009',
    recommendation: { type: 'largeMarkdown', suggestedPrice: 1000 },
    likeMetrics: { total: 99 },
  }];
  globalThis.__clearedServerFields = mergeMarkdownRows(
    [{ itemId: 'm00000000009', currentPrice: 3000 }],
    []
  )[0];

  localStorage.removeItem(MARKDOWN_FILTER_KEY);
  localStorage.setItem(MARKDOWN_SORT_KEY, 'disabled-first');
  globalThis.__migratedMode = readMarkdownFilterMode();
  globalThis.__storedMode = localStorage.getItem(MARKDOWN_FILTER_KEY);
`;
vm.runInContext(source + testSource, context, { filename: 'app.js' });

assert.deepEqual([...context.__allIds], ['m00000000001', 'm00000000002', 'm00000000003']);
assert.deepEqual([...context.__enabledIds], ['m00000000002']);
assert.deepEqual([...context.__disabledIds], ['m00000000001', 'm00000000003']);
assert.match(context.__cardHtml, />現在</);
assert.match(context.__cardHtml, />下限/);
assert.match(context.__cardHtml, /価格改定おすすめ/);
assert.match(context.__cardHtml, /100円値下げ/);
assert.match(context.__cardHtml, /おすすめ[\s\S]*2,400円/);
assert.match(context.__cardHtml, /72時間[\s\S]*\+1/);
assert.match(context.__cardHtml, /表示のみ・このおすすめから価格は変更しません/);
assert.match(context.__warningCardHtml, /大幅値下げ候補/);
assert.match(context.__warningCardHtml, /設定下限1,900円を200円下回る案/);
assert.equal(context.__clearedServerFields.recommendation, null);
assert.equal(context.__clearedServerFields.likeMetrics, null);
assert.doesNotMatch(context.__cardHtml, />次回</);
assert.doesNotMatch(context.__cardHtml, />残り</);
assert.match(
  context.__cardHtml,
  /class="markdown-card-media"[\s\S]*<img[\s\S]*class="markdown-card-state active">100円値下げ中<\/span>[\s\S]*<\/a>/
);
assert.equal(context.__migratedMode, 'disabled-only');
assert.equal(context.__storedMode, 'disabled-only');

const indexHtml = fs.readFileSync('index.html', 'utf8');
assert.match(indexHtml, /id="markdown-tab-btn"[^>]*>価格改定<\/button>/);
assert.match(indexHtml, /価格改定のおすすめ/);
assert.match(indexHtml, /おすすめ表示だけでは価格を変更しません/);
assert.match(indexHtml, /id="markdown-recommendation-summary"/);
assert.match(indexHtml, /data-markdown-filter="all"[^>]*>すべて<\/button>/);
assert.match(indexHtml, /data-markdown-filter="enabled-only"[^>]*>値下げ中のみ<\/button>/);
assert.match(indexHtml, /data-markdown-filter="disabled-only"[^>]*>値下げなしのみ<\/button>/);
assert.match(indexHtml, /aria-label="最新保存データを表示"[\s\S]*<span>更新<\/span>/);
assert.match(indexHtml, /aria-label="設定を保存"[\s\S]*<span>保存<\/span>/);
assert.match(indexHtml, /aria-label="値下げ対象だけ確認（価格は変えない）"[\s\S]*<span>確認<\/span>/);
assert.match(indexHtml, /aria-label="今すぐ実行"[\s\S]*<span>実行<\/span>/);

console.log(JSON.stringify({
  ok: true,
  all: context.__allIds,
  enabledOnly: context.__enabledIds,
  disabledOnly: context.__disabledIds,
  removedDisplays: ['次回', '残り'],
  compactActions: ['更新', '保存', '確認', '実行'],
  recommendationTypes: ['largeMarkdown', 'markdown100'],
  belowFloorWarning: true,
  displayOnly: true,
  statePill: 'image-overlay',
  migratedMode: context.__migratedMode,
}));
