'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const fields = { 'title-text': { value: '' }, 'result-text': { value: '' } };
const ctx = { console, URL, __MERCARI_TEST__: true,
  document: { getElementById: id => fields[id] || null },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} } };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(['catalog-data.js', 'app.js'].map(f => fs.readFileSync(f, 'utf8')).join('\n'), ctx);
function missing(title, description) {
  fields['title-text'].value = title;
  fields['result-text'].value = description;
  const result = [...vm.runInContext('missingTitleWordsInDescription_()', ctx)];
  assert.equal(fields['title-text'].value, title, 'validation must not rewrite the title');
  assert.equal(fields['result-text'].value, description, 'validation must not rewrite the description');
  return result;
}
const title = 'ポロバイラルフローレン 23AWXL ロンハーマン別注 ダウン';
const name = 'ポロバイラルフローレン Polo by Ralph Lauren 23AWXL ロンハーマン別注 ダウン';
for (const description of [
  `【商品名】${name}\n\n【サイズ】XL`,
  `【商品名】\n${name}\n\n【サイズ】XL`,
  `　【商品名】 ${name.replace('Ralph Lauren', 'Ralph\nLauren')}\n\n【サイズ】XL`,
  `【 商品名 】\r\n${name.replace('ロンハーマン', '\r\nロンハーマン')}\r\n【サイズ】XL`,
  `【商品名】${name.replace('23AWXL', '２３ＡＷＸＬ')}`,
]) assert.deepEqual(missing(title, description), []);
for (const prefix of ['✨️美品✨️ ', '✨美品✨', '極美品 ']) {
  assert.deepEqual(missing(prefix + title, `【商品名】${name}`), []);
}
assert.deepEqual(missing('シャツ', '【商品名】\n\n【サイズ】シャツ'), ['シャツ']);
assert.deepEqual(missing('ダウン', '【商品名】コート\n【状態】ダウン'), ['ダウン']);
assert.deepEqual(missing('シャツ', '【商品名】---\n【サイズ】XL'), ['シャツ']);
assert.deepEqual(missing('ダウン', '【サイズ】ダウン'), ['ダウン']);
assert.deepEqual(missing('ダウン XL', '【商品名】ダウン M\n【サイズ】XL'), ['XL']);
assert.deepEqual(missing('タグ付き未使用 ダウン', '【商品名】ダウン'), ['タグ付き未使用']);
console.log('PASS description product name: same line, multiline, CRLF, full-width, emoji, condition prefix, real omissions, input preservation');
