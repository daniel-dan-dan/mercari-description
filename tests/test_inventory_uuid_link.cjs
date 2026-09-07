#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = {
  console,
  URL,
  globalThis: null,
  localStorage: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  },
};
context.globalThis = context;
context.__MERCARI_TEST__ = true;
vm.createContext(context);

const source = [
  fs.readFileSync('catalog-data.js', 'utf8'),
  fs.readFileSync('app.js', 'utf8'),
].join('\n');
vm.runInContext(source, context, { filename: 'app.js' });

const hooks = context.MercariAppTestHooks;
const inventoryA = 'inv_550e8400-e29b-41d4-a716-446655440000';
const inventoryB = 'inv_123e4567-e89b-12d3-a456-426614174000';

assert.deepEqual(
  JSON.parse(JSON.stringify(hooks.parseInventoryReference_(inventoryA.toUpperCase()))),
  {
    raw: inventoryA.toUpperCase(),
    uuid: inventoryA,
    valid: true,
    empty: false,
    fromUrl: false,
  },
);
assert.equal(
  hooks.normalizeInventoryUuid_(
    `https://inventory.example/item?inventoryUuid=${encodeURIComponent(inventoryA)}`
  ),
  inventoryA,
);
assert.equal(hooks.normalizeInventoryUuid_('商品名だけ'), '');
assert.equal(hooks.normalizeInventoryUuid_(''), '');

const baseInput = {
  title: 'テスト商品',
  description: '説明文',
  price: '5000',
  category: 'トップス',
  mercariCategoryKey: 'men_shirt',
  mercariCategoryLabel: 'シャツ',
  mercariCategoryPath: ['ファッション', 'メンズ', 'トップス', 'シャツ'],
  mercariBrand: '',
  mercariSize: 'M',
  photos: [],
  mercariCondition: '目立った傷や汚れなし',
};
const linkedPayload = hooks.buildDraftPayload_({
  ...baseInput,
  inventoryUuid: inventoryA,
});
const otherPayload = hooks.buildDraftPayload_({
  ...baseInput,
  inventoryUuid: inventoryB,
});
const unlinkedPayload = hooks.buildDraftPayload_(baseInput);

assert.equal(linkedPayload.inventoryUuid, inventoryA);
assert.equal(unlinkedPayload.inventoryUuid, '');
assert.notEqual(
  hooks.draftPayloadFingerprint_(linkedPayload),
  hooks.draftPayloadFingerprint_(otherPayload),
  '在庫が変われば受付IDのfingerprintも変わる',
);

const savedState = hooks.compactTemporaryDraftState_({
  photos: [],
  inventoryUuid: inventoryA,
  inventoryReference: '',
  inventoryLabel: 'テスト商品',
  inventoryMeta: 'SKU ABC-001',
});
const restoredState = hooks.hydrateTemporaryDraftState_(savedState);
assert.equal(restoredState.inventoryUuid, inventoryA);
assert.equal(restoredState.inventoryLabel, 'テスト商品');
assert.equal(restoredState.inventoryMeta, 'SKU ABC-001');

const candidateLabel = hooks.inventoryCandidateLabel_({
  productName: '候補商品',
  sku: 'ABC-001',
  asin: 'なし',
  purchaseDate: '2026-07-30',
  status: '在庫',
});
assert.equal(candidateLabel.name, '候補商品');
assert.match(candidateLabel.meta, /SKU ABC-001/);
assert.doesNotMatch(candidateLabel.meta, /ASIN/);
assert.doesNotMatch(candidateLabel.meta, /2026-07-30|在庫/);
assert.equal(hooks.isMercariInventoryCandidate_({ asin: ' なし ' }), true);
assert.equal(hooks.isMercariInventoryCandidate_({ asin: 'Ｂ００００００００１' }), false);
assert.equal(hooks.isMercariInventoryCandidate_({ asin: '' }), false);

const indexHtml = fs.readFileSync('index.html', 'utf8');
const styles = fs.readFileSync('styles.css', 'utf8');
const serviceWorker = fs.readFileSync('sw.js', 'utf8');

[
  'inventory-selected-summary',
  'inventory-candidates-btn',
  'inventory-clear-btn',
  'inventory-candidate-panel',
  'inventory-search-input',
  'inventory-reference-input',
  'inventory-uuid-input',
  'inventory-label-input',
  'inventory-meta-input',
].forEach(id => assert.match(indexHtml, new RegExp(`id="${id}"`)));
assert.doesNotMatch(indexHtml, /placeholder="inv_/);
assert.doesNotMatch(indexHtml, /inventoryUuid付きURL/);
assert.doesNotMatch(indexHtml, /UUID/);
assert.match(indexHtml, /在庫から選ぶ/);
assert.match(indexHtml, /ASINが「なし」の在庫から/);
assert.match(indexHtml, /placeholder="SKU・商品名で検索"/);
assert.doesNotMatch(indexHtml, /placeholder="SKU・ASIN・商品名で検索"/);
assert.match(indexHtml, /未選択でも下書き保存できます/);
assert.match(source, /\/inventory\/candidates/);
assert.match(source, /商品名からの自動選択は行っていません/);
assert.match(source, /inventoryReference:/);
assert.match(source, /inventoryLabel:/);
assert.match(source, /inventoryMeta:/);
assert.match(source, /clearInventorySelection_\(\{ persist: false \}\)/);
assert.match(styles, /\.inventory-selected-summary/);
assert.match(styles, /\.inventory-candidate-item/);
assert.match(serviceWorker, /mercari-description-v20260907b/);

console.log(JSON.stringify({
  ok: true,
  inventorySelection: 'manual-only',
  temporaryDraftPreserved: true,
  fingerprintIncludesInventory: true,
  version: 'v20260907b',
}));
