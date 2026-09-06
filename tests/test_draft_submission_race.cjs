'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
function harness() {
  const nodes = new Map();
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, { value: '', hidden: false, disabled: false, dataset: {}, textContent: '',
      classList: { toggle() {}, remove() {}, add() {} }, setAttribute() {}, removeAttribute() {}, scrollTo() {} });
    return nodes.get(id);
  };
  const stored = new Map([['gasUrl', 'fixture-official-url']]);
  const ctx = { console, URL, TextEncoder, crypto: webcrypto, __MERCARI_TEST__: true,
    setTimeout, clearTimeout, alert: message => { throw Error(message); }, confirm: () => true,
    localStorage: { getItem: k => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v), removeItem: k => stored.delete(k) },
    document: { getElementById: get, querySelector: () => null, querySelectorAll: selector => selector.includes('#description-panel button') ? [...nodes.values()] : [] } };
  ctx.window = ctx; ctx.globalThis = ctx; vm.createContext(ctx);
  vm.runInContext(['catalog-data.js', 'app.js'].map(f => fs.readFileSync(f, 'utf8')).join('\n'), ctx);
  vm.runInContext(`
    isGeneratedResultCurrent_ = () => true;
    syncDescriptionProductNameFromTitle_ = () => {};
    updateDraftChecklist = () => ({ ok: true, items: [] });
    getInventoryReferenceState_ = () => ({ uuid: el('inventory-uuid-input').value });
    updateTemporarySaveButton_ = () => {};
    updateGenerateButton = () => {};
    getTemporaryDraft_ = async () => { throw new Error('must not read another product while saving'); };
    lastAiData = { title: '商品A', description: '説明A', category: 'tops', product_id: 'product-a' };
    uploadedImages = [{ base64: 'AAAA', mediaType: 'image/png' }];
  `, ctx);
  const values = { 'title-text': '商品A', 'result-text': '説明A', 'price-input': '2400', 'category': 'tops', 'm-condition': '目立った傷や汚れなし', 'm-category': 'men_shirt', 'm-brand': 'ブランドA', 'm-size': 'M', 'inventory-uuid-input': 'inv_00000000-0000-4000-8000-000000000001' };
  Object.entries(values).forEach(([id, value]) => { get(id).value = value; });
  ['draft-btn', 'draft-status', 'listing-action-bar', 'listing-missing-link', 'listing-action-hint', 'generate-note', 'generate-btn', 'main-screen', 'description-panel', 'result-section', 'reset-btn', 'settings-btn'].forEach(get);
  get('pre-disabled-control').disabled = true;
  return { ctx, get, stored };
}
(async () => {
  const { ctx, get, stored } = harness();
  let releaseUrl, captured;
  ctx.deferredUrl = new Promise(resolve => { releaseUrl = resolve; });
  ctx.capture = payload => { captured = payload; return { completed: true, data: { status: 'done' } }; };
  vm.runInContext('getMercariServiceUrl = () => deferredUrl; startDraftJob_ = async (_url, payload) => capture(payload);', ctx);
  const task = ctx.MercariAppTestHooks.saveDraft();
  assert.equal(get('title-text').disabled, true); assert.equal(get('reset-btn').disabled, true); assert.equal(get('settings-btn').disabled, true);
  await vm.runInContext('generateDescription()', ctx);
  await vm.runInContext('resetAll()', ctx);
  assert.equal(await vm.runInContext('saveCurrentAsTemporaryDraft_()', ctx), null);
  await assert.rejects(vm.runInContext("openTemporaryDraft_('product-b')", ctx), /下書き保存中/);
  await assert.rejects(vm.runInContext('clearCurrentProduct_()', ctx), /下書き保存中/);
  // An asynchronous callback or programmatic update cannot change the frozen payload.
  get('title-text').value = '商品B'; get('result-text').value = '説明B'; get('price-input').value = '9900';
  get('m-brand').value = 'ブランドB'; get('m-size').value = 'L';
  get('inventory-uuid-input').value = 'inv_00000000-0000-4000-8000-000000000002';
  vm.runInContext("uploadedImages[0].base64 = 'BBBB'; lastAiData = { category: 'bottoms', product_id: 'product-b' };", ctx);
  releaseUrl('https://fixture.trycloudflare.com'); await task;
  assert.equal(captured.title, '商品A'); assert.equal(captured.description, '説明A'); assert.equal(captured.price, '2400');
  assert.equal(captured.mercari_brand, 'ブランドA'); assert.equal(captured.mercari_size, 'M');
  assert.equal(captured.photos[0].base64, 'AAAA'); assert.equal(captured.inventoryUuid, 'inv_00000000-0000-4000-8000-000000000001');
  assert.equal(captured.category, 'アウター/トップス');
  assert.equal(get('title-text').disabled, false); assert.equal(get('reset-btn').disabled, false); assert.equal(get('pre-disabled-control').disabled, true);
  assert.equal(get('draft-status').hidden, true, 'feedback for A must not label edited B as saved');

  // Editing after a successful save clears only feedback, never unrelated receipts.
  stored.set('mercari_pending_draft_operation', 'unrelated-receipt-marker');
  vm.runInContext('draftFeedbackSignature = draftFormSignature_();', ctx);
  get('draft-status').hidden = false; get('draft-status').textContent = '下書き保存が完了しました。';
  get('price-input').value = '9800'; ctx.MercariAppTestHooks.updateListingWorkflow_();
  assert.equal(get('draft-status').hidden, true);
  assert.equal(stored.get('mercari_pending_draft_operation'), 'unrelated-receipt-marker');
  console.log('PASS deferred draft URL race: frozen A payload, guarded switches/reset/generation, restored locks, stale feedback cleared without receipt loss');
})().catch(error => { console.error(error); process.exitCode = 1; });
