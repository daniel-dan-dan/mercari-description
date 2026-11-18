'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ctx = {console, URL, __MERCARI_TEST__: true};
vm.createContext(ctx);
vm.runInContext(['catalog-data.js','app.js'].map(file=>fs.readFileSync(file,'utf8')).join('\n'), ctx);
const app = ctx.MercariAppTestHooks;
const note = '通電確認済みかは写真からは判断できません。';
const url = 'https://example.org/manual';
const fields = {
  item:'コーヒーメーカー', condition:'側面に擦り傷があります。' + note,
  appeal:'抽出量を選べます。' + note, photo_notes:[note],
  research:{status:'verified', manufacturer:'サンプル', model:'M1', sources:[{url}],
    features:[{text:'トレイは水洗いできます。' + note, source_url:url},{text:note,source_url:url}]}
};
for (const audience of ['other','men']) {
  const text = app.buildDescription(fields,'','',audience);
  assert.ok(!text.includes(note));
  assert.ok(text.includes('側面に擦り傷があります。'));
  assert.ok(text.includes(audience === 'other' ? 'トレイは水洗いできます。' : '抽出量を選べます。'));
  assert.equal(fields.photo_notes[0], note);
}
for(const [condition, expected] of [
  ['通電確認の有無は不明です。','状態は写真をご確認ください。'],
  [note,'状態は写真をご確認ください。'],
  ['動作は画像では確認できませんが、右端にヒビがあります。','右端にヒビがあります。'],
  ['外装に傷がありますが、通電済みかは写真では不明です。','外装に傷があります。'],
  ['外装に擦れあり、通電は画像から判定できません。','外装に擦れあり。'],
  ['シャッターは動きますが、写真を保存できません。','シャッターは動きますが、写真を保存できません。'],
  ['写真で傷が確認できます。','写真で傷が確認できます。'],
  ['電源が入りません。取扱説明書が欠品しています。','電源が入りません。取扱説明書が欠品しています。'],
  ['右側に亀裂があります（動作は画像から判断できません）。','右側に亀裂があります。'],
]) {
  const result = app.buildDescription({...fields, condition},'','','other');
  assert.equal(result.split('【状態】\n')[1].split('\n\n')[0],expected);
}
const manual = app.buildDescription({...fields, other_review:{choices:[],operation:'通電確認済みです。抽出時に水漏れします。'}},'','','other');
assert.match(manual,/【動作確認】\n通電確認済みです。抽出時に水漏れします。/);
assert.match(app.buildDescription(fields,'','','other'),/【動作確認】\n動作未確認です。/);
console.log('PASS buyer copy keeps defects, manual operation, photo review and verified features; excludes analysis commentary');
