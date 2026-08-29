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
const screenshotTitle = '✨美品✨ アルコディオ リネンプルオーバーシャツ 麻100% 春夏 カジュアル';
const indexHtml = fs.readFileSync('index.html', 'utf8');

assert.equal(
  hooks.normalizeMercariTitleEditingValue_('✨美品✨ 途中  入力中 ', { finalize: false }),
  '✨美品✨ 途中  入力中 ',
  '編集中の文字列は空白やカーソル位置に影響する加工をしない',
);
assert.equal(
  hooks.normalizeMercariTitleEditingValue_('✨美品✨ 途中  入力中 ', { finalize: true }),
  '✨美品✨ 途中 入力中',
  '入力完了時だけ空白整理と40文字制限を適用する',
);
assert.doesNotMatch(
  indexHtml,
  /id="title-text"[^>]*maxlength=/,
  'iPhone Safariが40文字の商品名を途中編集できるよう、HTML側では入力を遮断しない',
);
assert.match(source, /titleInput\.addEventListener\('compositionstart'/);
assert.match(source, /titleInput\.addEventListener\('compositionend'/);
assert.match(source, /if \(event\.isComposing \|\| mercariTitleCompositionActive_\) return;/);
assert.match(source, /titleInput\.addEventListener\('blur',[\s\S]{0,160}finalizeMercariTitleEditing_\(\)/);
assert.doesNotMatch(source, /titleInput\.value\s*=\s*capMercariTitleInput/);

assert.equal(
  hooks.normalizeMercariTitle(screenshotTitle),
  '✨美品✨ アルコディオ リネンプルオーバーシャツ 麻100%',
);
assert.equal(
  hooks.normalizeMercariTitle('バーバリー 春物 カジュアルシャツ ビジネス フォーマル 3シーズン'),
  'バーバリー シャツ',
);
assert.equal(
  hooks.normalizeMercariTitle('BURBERRY S/S CASUAL シャツ'),
  'BURBERRY シャツ',
);

[
  '春夏',
  '秋冬',
  '春',
  '冬',
  '春物',
  '3シーズン',
  'カジュアル',
  'ビジネス',
  'フォーマル',
  'セレモニー',
].forEach(word => assert.equal(hooks.isExcludedMercariTitleMarketingText(word), true, word));
assert.equal(hooks.isExcludedMercariTitleMarketingText('麻100%'), false);
assert.equal(hooks.isExcludedMercariTitleMarketingText('ノバチェック'), false);

const generatedTitle = hooks.buildMercariTitle({
  brand: 'アルコディオ',
  item: 'リネンプルオーバーシャツ',
  material: '麻100%',
  condition: '目立った傷や汚れのない美品です。',
  appeal: '春夏に合うカジュアルなシャツです。リネンの風合いが特徴です。',
  title_keywords: ['春夏', 'カジュアル', '麻100%', '上質'],
});
assert.doesNotMatch(
  generatedTitle,
  /春夏|秋冬|春物|夏物|秋物|冬物|3シーズン|カジュアル|ビジネス|フォーマル|セレモニー/i,
);
assert.match(generatedTitle, /アルコディオ/);
assert.match(generatedTitle, /リネンプルオーバーシャツ/);
assert.ok(Array.from(generatedTitle).length <= 40);

const draftPayload = hooks.buildDraftPayload_({
  title: screenshotTitle,
  description: '説明文',
  price: '5000',
  category: 'トップス',
  mercariCategoryKey: 'men_shirt',
  mercariCategoryLabel: 'シャツ',
  mercariCategoryPath: ['ファッション', 'メンズ', 'トップス', 'シャツ'],
  mercariBrand: 'ARCODIO',
  mercariSize: 'M',
  photos: [],
  mercariCondition: '目立った傷や汚れなし',
});
assert.equal(
  draftPayload.title,
  '✨美品✨ アルコディオ リネンプルオーバーシャツ 麻100%',
);

assert.match(source, /title_keywords には、販売時期に合うかどうかに関係なく季節ワードを一切入れない/);
assert.match(source, /カジュアル、ビジネス、フォーマル、セレモニーなどの着用場面・雰囲気語も一切入れない/);

console.log(JSON.stringify({
  ok: true,
  before: screenshotTitle,
  after: hooks.normalizeMercariTitle(screenshotTitle),
  generatedTitle,
}));
