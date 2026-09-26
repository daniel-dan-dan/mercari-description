'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ctx = { console, URL, __MERCARI_TEST__: true,
  localStorage: { getItem: () => null }, document: { querySelector: () => null } };
vm.createContext(ctx);
vm.runInContext(['catalog-data.js', 'app.js'].map(f => fs.readFileSync(f, 'utf8')).join('\n'), ctx);
const h = ctx.MercariAppTestHooks;
const base = { brand: '無印良品', brand_en: 'MUJI', item: 'コート', tag_size: 'M', color: 'ブラック 黒色', material: '---',
  condition: '袖口に擦れがあります。', appeal: '・シンプルな形で合わせやすいです。\n・長めの丈です。',
  mercari_category_key: 'men_trench_coat', mercari_condition: 'やや傷や汚れあり', title_keywords: ['ブラック', 'ロング丈'] };
function title(extra) {
  const data = h.sanitizeAiDataForSeason(h.validateAiResponseData_(h.parseAiJson(JSON.stringify({ ...base, ...extra }))));
  return h.buildMercariTitle(data);
}
for (const [condition, unwanted, keyword] of [
  ['タグ付きですが新品ではありません。着用済みです。', /タグ付き未使用/, 'タグ付き未使用'],
  ['タグ付き。未使用か不明です。', /タグ付き未使用/, 'タグ付き未使用'],
  ['美品ではありません。シミがあります。', /✨美品✨/, '美品'],
  ['美品とは言えない状態です。', /✨美品✨/, '美品'],
  ['ベルトは付属しません。', /ベルト付き/, 'ベルト付き'],
  ['ベルト欠品です。', /ベルト付き/, 'ベルト付き'],
  ['フードは付属しません。', /フード付き/, 'フード付き'],
  ['ライナーは付属しません。', /ライナー付き/, 'ライナー付き'],
]) {
  for (const extra of [{}, { title_keywords: [keyword, 'ロング丈'] }, { item: `${keyword} コート` }]) {
    const result = title({ condition, ...extra });
    assert.doesNotMatch(result, unwanted, `${condition} must override keyword/item claims`);
    assert.match(result, /無印良品/, 'a brand containing 良品 must remain intact');
    assert.match(result, /コート/);
  }
}
assert.match(title({ condition: '目立った傷や汚れのない美品です。', mercari_condition: '目立った傷や汚れなし' }), /✨美品✨/);
assert.match(title({ condition: 'タグ付きの未使用品です。', mercari_condition: '新品、未使用' }), /^✨タグ付き未使用✨/);
assert.match(title({ condition: 'フードは取り外し不可です。' }), /フード付き/, 'fixed hood is present, not missing');
const mixed = title({ condition: 'ベルト欠品です。フード付きです。', title_keywords: ['ベルト付き', 'フード付き'] });
assert.doesNotMatch(mixed, /ベルト付き/); assert.match(mixed, /フード付き/);
console.log('PASS title facts: negative/unknown condition, keywords and item claims; positive, fixed-hood and brand preservation');
