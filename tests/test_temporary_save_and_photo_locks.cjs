'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const source = ['catalog-data.js', 'app.js'].map(f => fs.readFileSync(f, 'utf8')).join('\n');
const tick = () => new Promise(setImmediate);
function harness() {
  const nodes = new Map();
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, { value: '', hidden: false, disabled: false, dataset: {},
      classList: { toggle() {}, add() {}, remove() {} } });
    return nodes.get(id);
  };
  const ctx = { console, URL, crypto: webcrypto, structuredClone, setTimeout, clearTimeout, __MERCARI_TEST__: true,
    localStorage: { getItem: () => null }, document: { getElementById: get, querySelector: () => null,
      querySelectorAll: () => [...nodes.values()] } };
  ctx.window = ctx; ctx.globalThis = ctx; vm.createContext(ctx); vm.runInContext(source, ctx);
  ctx.currentInput = { photos: [{ base64: 'QQ==', mediaType: 'image/jpeg' }], category: 'tops',
    measurements: { 'm-shoulder': '40' }, temporaryDraftId: null, productWorkflowId: 'fixture-workflow' };
  ctx.pending = []; ctx.saved = []; ctx.clears = 0;
  vm.runInContext(`
    hasMeaningfulCurrentInput_ = () => true; hasTemporarySaveMinimum_ = () => true;
    collectState = () => structuredClone(currentInput);
    requestPersistentStorage_ = async () => {};
    getTemporaryDraft_ = async () => null;
    putTemporaryDraft_ = record => new Promise((resolve, reject) => pending.push({record, resolve, reject}));
    refreshTemporaryDrafts_ = async () => {}; renderTemporaryDrafts_ = () => {};
    stopActiveMultiVoiceInput = () => {}; updateListingWorkflow_ = () => {};
    updateGenerateButton = () => {}; updateTemporarySaveButton_ = () => {};
    showStatus = () => {}; scheduleSave = () => {};
    clearCurrentProduct_ = async () => { currentInput = {}; activeTemporaryDraftId = null; clears++; };
  `, ctx);
  get('m-shoulder'); get('temporary-save-btn'); get('reset-btn'); get('was-disabled').disabled = true;
  return { ctx, get };
}
(async () => {
  const {ctx, get} = harness();
  const first = ctx.saveCurrentAsTemporaryDraft_();
  assert.equal(get('m-shoulder').disabled, true, 'lock before the first await');
  assert.equal(get('temporary-save-btn').disabled, true);
  assert.equal(await ctx.saveCurrentAsTemporaryDraft_(), null, 'double click cannot queue a second save');
  await assert.rejects(ctx.openTemporaryDraft_('different'), /一時保存中/);
  await tick(); assert.equal(ctx.pending.length, 1);
  const job = ctx.pending[0]; job.resolve({ saved: true, record: job.record }); await first;
  assert.equal(ctx.clears, 1); assert.equal(get('m-shoulder').disabled, false);
  assert.equal(get('was-disabled').disabled, true);

  const edited = harness();
  const save = edited.ctx.saveCurrentAsTemporaryDraft_(); await tick();
  edited.ctx.currentInput.measurements['m-shoulder'] = '44'; // A late callback bypassing disabled controls.
  edited.ctx.pending[0].resolve({ saved: true }); await save;
  assert.equal(edited.ctx.pending[0].record.snapshot.measurements['m-shoulder'], '40');
  assert.equal(edited.ctx.currentInput.measurements['m-shoulder'], '44');
  assert.equal(edited.ctx.clears, 0, 'late input changes must never be erased');

  const failed = harness(); const failedSave = failed.ctx.saveCurrentAsTemporaryDraft_(); await tick();
  failed.ctx.pending[0].reject(Error('quota')); await assert.rejects(failedSave, /quota/);
  assert.equal(failed.ctx.clears, 0); assert.equal(failed.get('m-shoulder').disabled, false);
  assert.equal(vm.runInContext('temporarySaveInProgress', failed.ctx), false);

  const drag = harness(); const handlers = {};
  const grid = { addEventListener: (type, fn) => handlers[type] = fn, classList: {add(){},remove(){}}, querySelectorAll: () => [] };
  vm.runInContext(`uploadedImages=[{base64:'A'},{base64:'B'}]; lastAiData={title:'keep'}; renderPreviews=()=>{};`, drag.ctx);
  drag.get('title-text').value='keep'; drag.get('result-text').value='keep description';
  drag.ctx.setupDragSort(grid);
  const item = index => ({dataset:{idx:String(index)},classList:{add(){},remove(){}}});
  handlers.dragstart({ target:{closest:()=>item(0)},dataTransfer:{}, preventDefault(){} });
  vm.runInContext('draftSaveInProgress=true;', drag.ctx);
  handlers.drop({ target:{closest:()=>item(1)},clientX:0,preventDefault(){} });
  assert.equal(vm.runInContext('uploadedImages.map(p=>p.base64).join("")', drag.ctx), 'AB');
  assert.equal(drag.get('title-text').value, 'keep');
  assert.equal(drag.get('result-text').value, 'keep description');
  let prevented=false;
  handlers.dragstart({target:{closest:()=>item(0)},preventDefault(){prevented=true;}});
  assert.equal(prevented,true);
  handlers.touchstart({ target:{closest(){throw Error('must stop before touching photos');}} });
  assert.equal(drag.ctx.removeUploadedImagesByIndices([0]),false);
  console.log('PASS save locks: one write, immutable snapshot, late edit retention, failure unlock, blocked draft drag/drop/touch/removal');
})().catch(error => {console.error(error);process.exitCode=1;});
