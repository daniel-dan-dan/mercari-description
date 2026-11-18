'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ctx = {console, __MERCARI_TEST__: true, groups: [], partial: false};
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('catalog-data.js','utf8') + '\n' + fs.readFileSync('app.js','utf8'), ctx);
vm.runInContext(`
  callDescriptionAiWithReceipt_ = async (batch, cb, mode, evidence) => {
    groups.push({mode, ids: batch.map(photo=>photo.base64), evidence});
    const checks = Object.fromEntries(batch.map((photo,i) => ['photo_' + (i+1), '型番 ' + photo.base64]));
    if (partial && mode === 'observe') delete checks.photo_1;
    return JSON.stringify(mode === 'observe' ? checks : {photo_checks:checks});
  };
  writeDescriptionOperations_ = () => {}; readDescriptionOperations_ = () => [];
`,ctx);
(async () => {
  const photos = Array.from({length:30}, (_,i)=>({base64:'image-'+(i+1)}));
  const data = JSON.parse(await ctx.describeAllPhotos_(photos));
  assert.deepEqual(data.photo_notes,photos.map(p=>'型番 '+p.base64));
  assert.equal(new Set(ctx.groups.flatMap(g=>g.ids)).size,30);
  assert.deepEqual(Array.from(ctx.groups,g=>g.ids.length),[12,6,12]);
  assert.match(ctx.groups.at(-1).evidence,/型番 image-30/);
  ctx.partial=true;
  await assert.rejects(ctx.describeAllPhotos_(photos),/13枚目/);
  await assert.rejects(ctx.describeAllPhotos_([{base64:''}]),/1枚目/);
  const title=ctx.buildMercariTitle({brand:'テスト',item:'コート',material:'ポリエステル100％',appeal:'シルクのような光沢',title_keywords:['シルク']});
  assert.doesNotMatch(title,/シルク/);
  console.log('PASS all 30 photos, batch coverage, missing evidence, material labels');
})().catch(e=>{console.error(e);process.exitCode=1;});
