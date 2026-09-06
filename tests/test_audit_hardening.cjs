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
    getItem: key => storage.get(key) ?? null,
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
vm.runInContext(source, context, { filename: 'app.js' });
const hooks = context.MercariAppTestHooks;

const completeAi = {
  brand: '---',
  brand_en: '---',
  item: 'シャツ',
  tag_size: '---',
  color: '---',
  material: '---',
  condition: '写真で状態をご確認ください。',
  appeal: '端正な形が特徴です。',
  mercari_category_key: 'unknown',
  mercari_condition: '目立った傷や汚れなし',
  title_keywords: ['シャツ'],
};
assert.equal(hooks.validateAiResponseData_(completeAi), completeAi);
assert.throws(() => hooks.validateAiResponseData_({}), /必須項目が不足/);
assert.throws(
  () => hooks.validateAiResponseData_({ ...completeAi, appeal: '' }),
  /appeal/,
);
assert.throws(
  () => hooks.validateAiResponseData_({ ...completeAi, title_keywords: [] }),
  /title_keywords/,
);

assert.equal(hooks.formatMarkdownLikeDelta(3), '+3');
assert.equal(hooks.formatMarkdownLikeDelta(0), '0');
assert.equal(hooks.formatMarkdownLikeDelta(-2), '-2');

const gasUrl = 'https://script.google.com/macros/s/AKfycbwYfwDG7Kqplk2oVeX7kF_gsAKTlK087ToE4LGp5R7PglTFMARP2lrA6ZV9m3MD0LEs/exec';
assert.equal(hooks.normalizeGasUrl(gasUrl), gasUrl);
assert.equal(hooks.normalizeGasUrl('https://script.google.com/macros/s/OTHER_DEPLOYMENT/exec'), '');
assert.equal(hooks.normalizeGasUrl('https://evil.example/collect'), '');
assert.equal(hooks.normalizeGasUrl(`${gasUrl}?next=https://evil.example`), '');
assert.equal(hooks.normalizeMacServiceUrl_('https://user:pass@example.trycloudflare.com'), '');
assert.equal(hooks.normalizeMacServiceUrl_('https://example.trycloudflare.com/path'), '');
assert.equal(
  hooks.safeResearchUrl_('https://jp.mercari.com/item/m12345678901'),
  'https://jp.mercari.com/item/m12345678901',
);
assert.equal(hooks.safeResearchUrl_('javascript:alert(1)'), '');
assert.equal(hooks.safeResearchUrl_('https://evil.example/item/m123'), '');

assert.match(
  hooks.formatCurrentSessionSaveError_({ name: 'QuotaExceededError' }),
  /保存容量が不足.*入力はこの画面に残っています/,
);

assert.match(source, /processedImages\.length\) invalidateGeneratedResultAfterInputChange_\('写真'\)/);
assert.match(source, /uploadedImages\.splice\(Number\(b\.dataset\.idx\), 1\);\s*invalidateGeneratedResultAfterInputChange_\('写真'\)/);
assert.match(source, /invalidateGeneratedResultAfterInputChange_\('写真の順番'\)/);
assert.match(source, /inp\.addEventListener\('input',[\s\S]{0,120}invalidateGeneratedResultAfterInputChange_\('採寸'\)/);
assert.match(source, /generation_input_fingerprint/);
assert.match(source, /if \(!isGeneratedResultCurrent_\(\)\)[\s\S]{0,400}confirm\(/);
assert.match(source, /generatedResultCurrent[\s\S]{0,300}現在の写真・採寸で生成済みです/);

assert.match(source, /saveDevBtn2\.disabled = true/);
assert.match(source, /applyBtn\.disabled = true/);
assert.match(source, /renderGridCanvas\([\s\S]{0,500}applyBtn\.disabled = false/);
assert.match(source, /async function addComposedImageToApp[\s\S]{0,500}photoProcessingInProgress = true/);

assert.match(source, /syncPending: true/);
assert.match(source, /data-research-action="retry-sync"/);
assert.match(source, /入力内容は残しています/);
assert.match(source, /if \(synced\) \{[\s\S]{0,180}clearResearchForm\(false\)/);
assert.match(
  source,
  /async function runResearchNow[\s\S]{0,900}const refreshMacServiceUrl = createMacServiceUrlRefresher_[\s\S]{0,900}refreshUrl: refreshMacServiceUrl/,
);

const refreshUrlCalls = source.match(/refreshUrl: refreshMacServiceUrl/g) || [];
assert.ok(refreshUrlCalls.length >= 6, '長時間処理と下書き処理で接続URLを更新する');

const indexHtml = fs.readFileSync('index.html', 'utf8');
const pairHtml = fs.readFileSync('pair.html', 'utf8');
const pairJs = fs.readFileSync('pair.js', 'utf8');
const serviceWorker = fs.readFileSync('sw.js', 'utf8');
const styles = fs.readFileSync('styles.css', 'utf8');
assert.match(indexHtml, /id="session-save-status"/);
assert.match(pairJs, /value\.length <= 512/);
assert.match(pairJs, /\^\[A-Za-z0-9\._~-\]\+\$/);
assert.doesNotMatch(pairHtml, /<script(?:\s[^>]*)?>\s*(?!<)/);
assert.match(pairHtml, /Content-Security-Policy/);
assert.match(serviceWorker, /mercari-description-v20260906c/);
assert.match(serviceWorker, /styles\.css\?v=20260906c/);
assert.match(serviceWorker, /catalog-data\.js\?v=20260906c/);
assert.match(serviceWorker, /app\.js\?v=20260906c/);
assert.match(serviceWorker, /ignoreSearch: true/);
assert.match(serviceWorker, /event\.request\.mode === 'navigate'/);
assert.match(styles, /\.preview-item \.remove \{[\s\S]{0,220}width: 44px;[\s\S]{0,80}height: 44px;/);
assert.match(styles, /\.research-mini-actions button \{[\s\S]{0,180}min-height: 44px;/);
assert.match(styles, /\[hidden\] \{ display: none !important; \}/);

console.log(JSON.stringify({
  ok: true,
  aiCompletenessGuard: true,
  generatedResultFreshnessGuard: true,
  offlineVersionedAssets: true,
  researchRetry: true,
  likesDecreaseVisible: true,
  urlSafety: true,
  version: 'v20260906c',
}));
