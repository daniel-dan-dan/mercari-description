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

assert.equal(hooks.normalizeProductGender('men'), 'men');
assert.equal(hooks.normalizeProductGender('women'), 'women');
assert.equal(hooks.normalizeProductGender('other'), 'other');
assert.equal(hooks.normalizeProductGender('invalid'), 'men');
assert.equal(hooks.isNonApparelProductAudience('other'), true);
assert.equal(hooks.isNonApparelProductAudience('women'), false);

const nonApparelPrompt = hooks.buildProductAudiencePrompt_('other');
assert.match(nonApparelPrompt, /その他（アパレル以外）/);
assert.match(nonApparelPrompt, /工具・家電・生活用品/);
assert.match(nonApparelPrompt, /mercari_category_key は必ず "unknown"/);
assert.match(nonApparelPrompt, /衣類用のサイズ推定を行わない/);

const apparelPrompt = hooks.buildProductAudiencePrompt_('women');
assert.match(apparelPrompt, /対象は「レディース」/);
assert.match(apparelPrompt, /「レディース」側のカテゴリ/);

const nonApparelSystemPrompt = hooks.buildDescriptionSystemPrompt('', 'other');
assert.match(nonApparelSystemPrompt, /工具・家電・生活用品/);
assert.match(nonApparelSystemPrompt, /写真だけで動作確認済みとは書かない/);
assert.match(nonApparelSystemPrompt, /mercari_category_key — 必ず "unknown"/);
assert.doesNotMatch(nonApparelSystemPrompt, /黒っぽい.*ネイビー/);
assert.doesNotMatch(nonApparelSystemPrompt, /トレンチコート/);
assert.doesNotMatch(nonApparelSystemPrompt, /質感や着心地/);
assert.doesNotMatch(nonApparelSystemPrompt, /滑らかな肌触り|軽やかな着心地|幅広い装い/);

const apparelSystemPrompt = hooks.buildDescriptionSystemPrompt('', 'men');
assert.match(apparelSystemPrompt, /トレンチコート/);

assert.equal(
  hooks.coerceMercariCategoryForProductGender('men_shirt', 'tops', 'other'),
  'unknown',
);
assert.equal(
  hooks.coerceMercariCategoryForProductGender('men_shirt', 'tops', 'women'),
  'women_shirt_blouse',
);
assert.equal(hooks.isManualMercariCategoryAllowed_('unknown', 'other'), true);
assert.equal(hooks.isManualMercariCategoryAllowed_('unknown', 'men'), false);
assert.equal(hooks.getSizeProfileKey('unknown', 'tops', 'other'), '');
const nonApparelSize = hooks.deriveMercariSize({ tag_size: 'L' }, 'unknown', 'other');
assert.equal(nonApparelSize.value, '');
assert.equal(nonApparelSize.source, 'none');
assert.equal(nonApparelSize.note, 'アパレル以外のためサイズ選択は不要です');

const nonApparelDescription = hooks.buildDescription(
  {
    brand: 'マキタ',
    brand_en: 'Makita',
    item: '充電式ドライバードリル',
    tag_size: 'L',
    color: 'ブルー 青色',
    material: '型番 DF001 / 充電式',
    condition: '動作確認済みです。',
    appeal: 'DIY作業に使える電動工具です。',
  },
  '縦：20cm\n横：18cm\n高さ：7cm',
  'マキタ 充電式ドライバードリル',
  'other',
);
assert.match(nonApparelDescription, /【寸法】\n縦：20cm/);
assert.match(nonApparelDescription, /【素材・仕様】型番 DF001/);
assert.doesNotMatch(nonApparelDescription, /L（平置き採寸）/);
assert.match(nonApparelDescription, /状態・付属品・仕様は、写真と説明文をご確認ください/);
assert.doesNotMatch(nonApparelDescription, /自宅保管の中古品/);
assert.doesNotMatch(nonApparelDescription, /AACD/);

const apparelDescription = hooks.buildDescription(
  {
    brand: 'バーバリー',
    item: 'シャツ',
    tag_size: 'M',
    color: 'ブルー 青色',
    material: '綿100%',
    condition: '目立った傷や汚れなし',
    appeal: '上質なシャツです。',
  },
  '肩幅：45cm',
  'バーバリー シャツ',
  'men',
);
assert.match(apparelDescription, /【サイズ】M（平置き採寸）/);
assert.match(apparelDescription, /【素材】綿100%/);
assert.match(apparelDescription, /自宅保管の中古品/);
assert.match(apparelDescription, /AACD/);

const sanitizedNonApparel = hooks.sanitizeAiDataForSeason({
  appeal: '冬場の除雪作業に使える工具です。',
  condition: '冬場に動作確認済みです。',
  title_keywords: ['冬物', '18V', '電動工具'],
}, 'other');
assert.equal(sanitizedNonApparel.appeal, '冬場の除雪作業に使える工具です。');
assert.equal(sanitizedNonApparel.condition, '冬場に動作確認済みです。');
assert.deepEqual(Array.from(sanitizedNonApparel.title_keywords), ['18V', '電動工具']);

const compactedDraft = hooks.compactTemporaryDraftState_({
  productGender: 'other',
  category: 'other',
  mercariCategoryKey: 'unknown',
  mercariSize: '',
  photos: [],
});
assert.equal(compactedDraft.productGender, 'other');
assert.equal(compactedDraft.category, 'other');
assert.equal(compactedDraft.mercariCategoryKey, 'unknown');
assert.equal(hooks.resolveRestoredProductGender_(compactedDraft), 'other');
assert.equal(
  hooks.resolveRestoredProductGender_({ mercariCategoryKey: 'women_shirt_blouse' }),
  'women',
);

const draftPayload = hooks.buildDraftPayload_({
  title: 'マキタ 充電式ドライバードリル',
  description: nonApparelDescription,
  price: '5800',
  category: 'その他',
  mercariCategoryKey: 'unknown',
  mercariCategoryLabel: '未判定',
  mercariCategoryPath: [],
  mercariBrand: 'Makita',
  mercariSize: '',
  photos: [],
  mercariCondition: '目立った傷や汚れなし',
});
assert.equal(draftPayload.mercari_category_key, 'unknown');
assert.equal(draftPayload.mercari_category.length, 0);
assert.equal(draftPayload.mercari_size, '');

const classList = { add() {}, remove() {}, toggle() {} };
const radios = [
  { value: 'men', checked: true },
  { value: 'women', checked: false },
  { value: 'other', checked: false },
];
const uiElements = {
  'product-gender-note': { hidden: true },
  'm-size-field': { hidden: false },
  'category': { value: 'tops', disabled: false },
  'm-size': { value: 'XL', dataset: { userEdited: '1' } },
  'm-size-note': { textContent: '' },
  'title-text': { value: '古い衣類タイトル' },
  'result-text': { value: '古い衣類説明', classList },
  'result-section': { hidden: false },
  'mercari-settings': { hidden: false },
  'm-condition': { value: 'やや傷や汚れあり' },
  'm-brand': { value: 'Old Brand' },
  'final-size-badge': { hidden: false },
  'result-meta': { hidden: false },
  'draft-status': { hidden: false },
  status: { hidden: true, className: '', textContent: '' },
};
context.document = {
  getElementById: id => uiElements[id] || null,
  querySelectorAll: selector => selector === 'input[name="product-gender"]' ? radios : [],
};

hooks.setSelectedProductGender('other');
assert.equal(radios.find(radio => radio.value === 'other').checked, true);
assert.equal(uiElements['product-gender-note'].hidden, false);
assert.equal(uiElements['m-size-field'].hidden, true);
assert.equal(uiElements.category.disabled, true);
assert.equal(uiElements['m-size'].value, '');
assert.equal(uiElements['m-size'].dataset.userEdited, '');

assert.equal(hooks.invalidateGeneratedResultAfterInputChange_('対象'), true);
assert.equal(uiElements['title-text'].value, '');
assert.equal(uiElements['result-text'].value, '');
assert.equal(uiElements['result-section'].hidden, true);
assert.equal(uiElements['mercari-settings'].hidden, true);
assert.equal(uiElements['m-brand'].value, '');
assert.equal(uiElements['final-size-badge'].hidden, true);
assert.match(uiElements.status.textContent, /もう一度「説明文を生成」/);

const indexHtml = fs.readFileSync('index.html', 'utf8');
const audienceRadios = indexHtml.match(/name="product-gender"/g) || [];
assert.equal(audienceRadios.length, 3);
assert.match(indexHtml, /name="product-gender" value="other"/);
assert.match(indexHtml, /id="product-gender-note"/);
assert.match(indexHtml, /工具などアパレル以外として生成します/);
assert.match(indexHtml, /id="m-size-field"/);
assert.match(indexHtml, /v20260814b \/ ASINなし在庫だけ表示/);

assert.match(source, /syncBroadCategoryForProductGenderChange_\(input\.value\)/);
assert.match(source, /el\('category'\)\.value = isNonApparelProductAudience\(\) \? 'other' : ''/);
assert.match(source, /invalidateGeneratedResultAfterInputChange_\('対象'\)/);
assert.match(source, /invalidateGeneratedResultAfterInputChange_\('カテゴリ'\)/);
assert.doesNotMatch(
  source,
  /el\('category'\)\.value === 'other'[\s\S]{0,120}setSelectedProductGender\('other'\)/,
);

const styles = fs.readFileSync('styles.css', 'utf8');
assert.match(styles, /\.gender-segmented\s*\{[\s\S]*grid-template-columns:\s*repeat\(3/);

const serviceWorker = fs.readFileSync('sw.js', 'utf8');
assert.match(serviceWorker, /mercari-description-v20260814b/);

const pairHtml = fs.readFileSync('pair.html', 'utf8');
assert.match(pairHtml, /styles\.css\?v=20260814b/);

console.log(JSON.stringify({
  ok: true,
  audiences: ['men', 'women', 'other'],
  nonApparelCategory: 'manual-after-draft',
  nonApparelSize: 'not-required',
  version: 'v20260814b',
}));
