'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const uuid = 'inv_550e8400-e29b-41d4-a716-446655440000';
const item = { inventoryUuid: uuid, asin: 'なし', productName: '選んだ商品', listingState: 'unlisted', canList: true };
function fixture() {
  const nodes = new Map();
  const get = id => { if (!nodes.has(id)) nodes.set(id, { value: '' }); return nodes.get(id); };
  const context = { console, URL, __MERCARI_TEST__: true, crypto: webcrypto, structuredClone, localStorage: { getItem: () => null }, document: { getElementById: get } };
  context.window = context; vm.createContext(context);
  vm.runInContext(fs.readFileSync('catalog-data.js', 'utf8') + '\n' + fs.readFileSync('app.js', 'utf8'), context);
  context.input = { photos: [{ base64: 'original-photo', mediaType: 'image/jpeg' }], title: '現在の商品', temporaryDraftId: null };
  context.saved = 0; context.cleared = 0; context.selected = null; context.meaningful = true; context.fail = false; context.late = false;
  vm.runInContext(`
    hasMeaningfulCurrentInput_=()=>meaningful;
    collectState=()=>structuredClone(input);
    saveCurrentAsTemporaryDraft_=async()=>{ if(fail) return null; saved++; if(late) input.title='遅れて編集'; return {id:'saved'}; };
    clearCurrentProduct_=async()=>{cleared++;input={};};
    setInventoryReference_=(uuid,options)=>{selected={uuid,...options};};
    saveCurrentSessionNow_=async()=>{};
  `, context);
  return { context, get, start: context.MercariAppTestHooks.startListingFromInventory_ };
}
(async () => {
  const a = fixture();
  await assert.rejects(a.start(item), /一時保存/); assert.equal(a.context.cleared, 0); assert.equal(a.context.input.photos[0].base64, 'original-photo');
  await a.start(item, { saveCurrent: true }); assert.equal(a.context.saved, 1); assert.equal(a.context.cleared, 1); assert.equal(a.context.selected.uuid, uuid);
  const same = fixture(); same.get('inventory-uuid-input').value = uuid;
  await same.start(item); assert.equal(same.context.saved, 0); assert.equal(same.context.cleared, 0); assert.equal(same.context.input.title, '現在の商品');
  const failed = fixture(); failed.context.fail = true;
  await assert.rejects(failed.start(item, { saveCurrent: true }), /保存できなかった/); assert.equal(failed.context.cleared, 0);
  const late = fixture(); late.context.late = true;
  await assert.rejects(late.start(item, { saveCurrent: true }), /入力が変わった/); assert.equal(late.context.cleared, 0); assert.equal(late.context.input.title, '遅れて編集');
  const locked = fixture(); vm.runInContext('descriptionGenerationInProgress=true', locked.context);
  await assert.rejects(locked.start(item, { saveCurrent: true }), /処理が終わって/); assert.equal(locked.context.saved, 0);
  const unsafe = fixture();
  await assert.rejects(unsafe.start({ ...item, listingState: 'listed' }, { saveCurrent: true }), /始められません/);
  await assert.rejects(unsafe.start({ ...item, canList: false }, { saveCurrent: true }), /始められません/);
  assert.equal(unsafe.context.cleared, 0);
  const empty = fixture(); empty.context.meaningful = false;
  await empty.start(item); assert.equal(empty.context.saved, 0); assert.equal(empty.context.selected.uuid, uuid);
  const reviewItem = { ...item, listingState: 'review', listingChecked: false, listingItemId: '', listing: null, holdReason: '', candidates: [{ itemId: 'm12345', title: '別の候補' }] };
  const review = fixture();
  await assert.rejects(review.start(reviewItem, { saveCurrent: true }), /始められません/);
  assert.equal(review.context.saved, 0);
  await review.start(reviewItem, { saveCurrent: true, differentProductConfirmed: true });
  assert.equal(review.context.saved, 1); assert.equal(review.context.selected.uuid, uuid);
  for (const extra of [{ listingChecked: true }, { listingItemId: 'm99' }, { listing: { itemId: 'm99' } }, { holdReason: '未確認' }, { candidates: [] }]) {
    const blockedReview = fixture();
    await assert.rejects(blockedReview.start({ ...reviewItem, ...extra }, { saveCurrent: true, differentProductConfirmed: true }), /始められません/);
    assert.equal(blockedReview.context.saved, 0); assert.equal(blockedReview.context.cleared, 0);
  }
  console.log('PASS inventory selection: input retained, explicit save, same-product continuation, storage failure, late edits, running locks, ineligible guards');
})().catch(error => { console.error(error); process.exitCode = 1; });
