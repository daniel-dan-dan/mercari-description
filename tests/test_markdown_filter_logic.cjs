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
      minPrice: 1000,
      autoEnabled: false,
    },
    {
      itemId: 'm00000000002',
      title: '100円値下げ中の商品',
      currentPrice: 2500,
      minPrice: 1000,
      autoEnabled: true,
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
assert.doesNotMatch(context.__cardHtml, />次回</);
assert.doesNotMatch(context.__cardHtml, />残り</);
assert.equal(context.__migratedMode, 'disabled-only');
assert.equal(context.__storedMode, 'disabled-only');

console.log(JSON.stringify({
  ok: true,
  all: context.__allIds,
  enabledOnly: context.__enabledIds,
  disabledOnly: context.__disabledIds,
  removedDisplays: ['次回', '残り'],
  migratedMode: context.__migratedMode,
}));
