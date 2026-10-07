'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const nodes = new Map();
const events = [];
const errors = [];
const context = {
  console: { ...console, error: (...args) => errors.push(args) }, URL, setTimeout, clearTimeout,
  __MERCARI_TEST__: true,
  localStorage: { getItem: () => null },
  document: { getElementById(id) {
    if (!nodes.has(id)) nodes.set(id, { textContent: '', querySelectorAll: () => [] });
    return nodes.get(id);
  } },
  __event: type => events.push(type),
};
context.window = context; context.globalThis = context;
vm.createContext(context);
vm.runInContext(['catalog-data.js', 'photo-adjust.js', 'app.js'].map(f => fs.readFileSync(f, 'utf8')).join('\n'), context);
vm.runInContext(`
  setPhotoProcessingLock_ = locked => __event(locked ? 'lock' : 'unlock');
  setPhotoEditorControls_ = () => {};
  closePhotoEditor_ = () => { __event('close'); photoEditorState = null; };
  invalidateGeneratedResultAfterInputChange_ = () => __event('invalidate');
  renderPreviews = () => __event('render'); updateGenerateButton = () => {};
  scheduleSave = () => __event('save'); updateDraftChecklist = () => {};
  applyPhotoAdjustment_ = (photo, adjust) => __render(photo, adjust);
`, context);
const settings = { brightness: 12, contrast: -5, shadows: 15, highlights: 24, warmth: -18 };
const blank = { brightness: 0, contrast: 0, shadows: 0, highlights: 0, warmth: 0 };
const photo = (id, adjust) => ({ id, base64: id, base64HQ: id + '-hq', originalDataUrl: 'data:image/jpeg;base64,' + id,
  originalBase64HQ: id + '-original-hq', mediaType: 'image/jpeg', adjustSourceVersion: 1, adjust: { ...adjust } });
function start(scope, sourceAlreadyMatches = true, selected = [0, 2]) {
  events.length = 0; errors.length = 0;
  context.fixturePhotos = [photo('a', sourceAlreadyMatches ? settings : blank), photo('b', blank), photo('c', blank)];
  context.fixtureScope = scope; context.fixtureSelection = selected; context.fixtureSettings = settings;
  context.calls = []; context.pending = [];
  context.__render = (photo, adjust) => {
    context.calls.push({ photo, adjust: { ...adjust } });
    return new Promise((resolve, reject) => context.pending.push({ photo, resolve, reject }));
  };
  vm.runInContext(`
    uploadedImages = fixturePhotos.slice(); activeTemporaryDraftId = 'product-a'; photoProcessingInProgress = false;
    photoEditorState = { photo: uploadedImages[0], photos: uploadedImages.slice(), scope: fixtureScope,
      selectedPhotos: new Set(fixtureSelection.map(i => uploadedImages[i])), image: {}, busy: false,
      draftId: 'product-a', adjust: fixtureSettings };
  `, context);
}
const currentPhotos = () => vm.runInContext('uploadedImages.slice()', context);
async function tick() { await Promise.resolve(); await Promise.resolve(); }
async function resolveNext() {
  const pending = context.pending.shift(); assert.ok(pending);
  pending.resolve({ ...pending.photo, base64: pending.photo.id + '-corrected', adjust: { ...settings } });
  await tick();
}
(async () => {
  start('all');
  const all = context.applyPhotoEditor_();
  assert.equal(context.calls[0].photo.id, 'b', 'unchanged reference still permits applying to other photos');
  assert.equal(await context.applyPhotoEditor_(), undefined, 'double apply cannot start another batch');
  await resolveNext();
  assert.equal(currentPhotos()[1], context.fixturePhotos[1], 'first completed render is not committed early');
  assert.equal(events.includes('save'), false);
  await resolveNext(); await all;
  assert.deepEqual(context.calls.map(c => c.photo.id), ['b', 'c']);
  assert.equal(currentPhotos()[0], context.fixturePhotos[0]);
  assert.equal(currentPhotos()[1].base64, 'b-corrected');
  assert.equal(currentPhotos()[2].base64, 'c-corrected');
  assert.equal(events.filter(e => e === 'save').length, 1);
  assert.equal(events.filter(e => e === 'invalidate').length, 1);
  for (const call of context.calls) for (const key of Object.keys(settings)) assert.equal(call.adjust[key], settings[key]);

  start('selected', false, [2]); // The editing photo is always included.
  const selected = context.applyPhotoEditor_();
  await resolveNext(); await resolveNext(); await selected;
  assert.deepEqual(context.calls.map(c => c.photo.id), ['a', 'c']);
  assert.equal(currentPhotos()[1], context.fixturePhotos[1], 'unchecked photo remains byte-identical');

  start('current', false);
  const one = context.applyPhotoEditor_(); await resolveNext(); await one;
  assert.deepEqual(context.calls.map(c => c.photo.id), ['a']);
  assert.equal(currentPhotos()[1], context.fixturePhotos[1]);

  start('all', false);
  const fail = context.applyPhotoEditor_(); await resolveNext();
  context.pending.shift().reject(new Error('second image decode failure')); await fail;
  assert.ok(currentPhotos().every((p, i) => p === context.fixturePhotos[i]), 'failure leaves every target unchanged');
  assert.equal(events.includes('save'), false); assert.equal(errors.length, 1);
  assert.equal(vm.runInContext('photoProcessingInProgress', context), false);
  assert.equal(vm.runInContext('photoEditorState.busy', context), false);

  for (const mutation of [
    "activeTemporaryDraftId = 'other-product';", 'photoProcessingOperationId++;',
    'uploadedImages.reverse();', 'uploadedImages.push(uploadedImages[0]);',
    "uploadedImages[2] = {...uploadedImages[2], base64: 'external-change'};", 'photoEditorState = null;',
  ]) {
    start('all', false);
    const running = context.applyPhotoEditor_(); await resolveNext();
    vm.runInContext(mutation, context);
    const afterExternalChange = currentPhotos();
    await resolveNext(); await running;
    assert.ok(currentPhotos().every((p, i) => p === afterExternalChange[i]), 'stale operation cannot commit any result');
    assert.equal(events.includes('save'), false); assert.equal(context.calls.length, 2, 'stop before rendering remaining photos');
  }
  start('all');
  vm.runInContext('uploadedImages.reverse();', context);
  await context.applyPhotoEditor_();
  assert.equal(context.calls.length, 0, 'changed selection snapshot is rejected before processing');

  start('current');
  await context.applyPhotoEditor_();
  assert.equal(context.calls.length, 0, 'no-change current photo avoids re-encoding');
  assert.equal(events.includes('save'), false);
  console.log('PASS batch photo adjustment: explicit targets, unchanged source, same five values, single/selected/all, atomic failure, stale-owner guards and one save');
})().catch(error => { console.error(error); process.exitCode = 1; });
