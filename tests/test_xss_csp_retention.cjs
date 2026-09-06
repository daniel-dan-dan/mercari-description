#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const appSource = fs.readFileSync('app.js', 'utf8');
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
vm.runInContext([
  fs.readFileSync('catalog-data.js', 'utf8'),
  appSource,
].join('\n'), context, { filename: 'app.js' });
const hooks = context.MercariAppTestHooks;

[
  '<img src=x onerror=alert(1)>46',
  '46</div><script>alert(1)</script>',
  'M" autofocus onfocus="alert(1)',
  'サイズはMです',
  '46<script>',
].forEach(value => assert.equal(hooks.sanitizeAiTagSize_(value), '---'));
[
  ['M', 'M'],
  ['Ｍ', 'M'],
  ['SIZE 46', 'SIZE 46'],
  ['W32', 'W32'],
  ['フリーサイズ', 'フリーサイズ'],
].forEach(([input, expected]) => assert.equal(hooks.sanitizeAiTagSize_(input), expected));

const completeAi = {
  brand: '---',
  brand_en: '---',
  item: 'ジャケット',
  tag_size: '<svg onload=alert(1)>46',
  color: '黒',
  material: 'ウール',
  condition: '写真で状態をご確認ください。',
  appeal: '端正な形が特徴です。',
  mercari_category_key: 'unknown',
  mercari_condition: '目立った傷や汚れなし',
  title_keywords: ['ジャケット'],
};
assert.equal(hooks.validateAiResponseData_(completeAi).tag_size, '---');

const renderFinalSizeSource = appSource.slice(
  appSource.indexOf('function renderFinalSize'),
  appSource.indexOf('function sizeReferenceTable'),
);
assert.match(renderFinalSizeSource, /badge\.replaceChildren\(\)/);
assert.match(renderFinalSizeSource, /detail\.textContent = String\(note \|\| ''\)/);
assert.doesNotMatch(renderFinalSizeSource, /innerHTML/);
assert.doesNotMatch(appSource, /\sstyle="/);

for (const htmlFile of ['index.html', 'pair.html']) {
  const html = fs.readFileSync(htmlFile, 'utf8');
  const csp = html.match(/Content-Security-Policy" content="([^"]+)"/)?.[1] || '';
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /style-src 'self'/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'none'/);
  assert.match(html, /name="robots" content="noindex, nofollow, noarchive"/);

  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length > 0);
  scripts.forEach(([, attributes, body]) => {
    assert.match(attributes, /\bsrc="[^"]+"/);
    assert.equal(body.trim(), '', `${htmlFile}にインラインscriptを置かない`);
  });
}

const version = '20260906c';
const indexHtml = fs.readFileSync('index.html', 'utf8');
const pairHtml = fs.readFileSync('pair.html', 'utf8');
const serviceWorker = fs.readFileSync('sw.js', 'utf8');
const publicConfig = fs.readFileSync('public-config.js', 'utf8');
const bootstrap = fs.readFileSync('bootstrap.js', 'utf8');
assert.match(indexHtml, new RegExp(`v${version}`));
assert.match(indexHtml, new RegExp(`app\\.js\\?v=${version}`));
assert.match(pairHtml, new RegExp(`pair\\.js\\?v=${version}`));
assert.match(serviceWorker, new RegExp(`mercari-description-v${version}`));
assert.match(publicConfig, new RegExp(`version: 'v${version}'`));
assert.match(bootstrap, new RegExp(`'v${version}'`));

const now = Date.UTC(2026, 7, 31);
const day = 24 * 60 * 60 * 1000;
assert.equal(hooks.isStoredPhotoRecordExpired_(now - 29 * day, now), false);
assert.equal(hooks.isStoredPhotoRecordExpired_(now - 31 * day, now), true);
assert.equal(hooks.isStoredPhotoRecordExpired_(0, now), false);
assert.match(appSource, /await pruneExpiredTemporaryDrafts_\(\)/);

console.log(JSON.stringify({
  ok: true,
  xssTagSizeBlocked: true,
  strictCsp: true,
  inlineScriptsRemoved: true,
  localPhotoRetentionDays: 30,
  version: `v${version}`,
}));
