'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const expectedErrors = [];
const context = {
  console: { ...console, error: (...args) => expectedErrors.push(args) }, URL, setTimeout, clearTimeout,
  __MERCARI_TEST__: true,
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
};
context.window = context;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(['catalog-data.js', 'photo-adjust.js', 'app.js'].map(file => fs.readFileSync(file, 'utf8')).join('\n'), context);
const hooks = context.MercariAppTestHooks;
const jpeg = value => `data:image/jpeg;base64,${value}`;
const bytes = text => Buffer.from(text).toString('base64');
const currentSmall = bytes('adjusted AI image');
const currentHQ = bytes('adjusted Mercari image');
const originalSmall = bytes('unadjusted AI image');
const originalHQ = bytes('unadjusted Mercari image');
const adjustedPhoto = {
  mediaType: 'image/jpeg', dataUrl: jpeg(currentSmall),
  base64: currentSmall, base64HQ: currentHQ,
  thumbnailBase64: bytes('adjusted tray thumbnail'),
  originalDataUrl: jpeg(originalSmall), originalBase64HQ: originalHQ,
  adjustSourceVersion: 1,
  adjust: { brightness: 14, contrast: 5, shadows: 18, highlights: 22, temp: 0 },
};

// An edited photo must keep its source through temporary saves and later edits.
const compact = hooks.compactTemporaryDraftPhoto_(adjustedPhoto);
assert.equal(compact.base64, currentSmall);
assert.equal(compact.base64HQ, currentHQ);
assert.equal(compact.originalBase64, originalSmall);
assert.equal(compact.originalBase64HQ, originalHQ);
assert.equal(compact.adjustSourceVersion, 1);
assert.equal(Object.hasOwn(compact, 'dataUrl'), false, 'do not store duplicate data URLs');
assert.equal(Object.hasOwn(compact, 'originalDataUrl'), false, 'store original bytes once');
const fromTemporarySave = hooks.hydrateTemporaryDraftPhoto_(compact);
assert.equal(fromTemporarySave.dataUrl, jpeg(currentSmall));
assert.equal(fromTemporarySave.originalDataUrl, jpeg(originalSmall));
assert.equal(fromTemporarySave.originalBase64HQ, originalHQ);
assert.equal(fromTemporarySave.adjust.brightness, 14);
assert.equal(fromTemporarySave.adjust.contrast, 5);
assert.equal(fromTemporarySave.adjust.shadows, 18);
assert.equal(fromTemporarySave.adjust.highlights, 22);
assert.equal(fromTemporarySave.thumbnailBase64, adjustedPhoto.thumbnailBase64);

const state = hooks.compactTemporaryDraftState_({ photos: [fromTemporarySave], category: 'tops' });
const reopened = hooks.hydrateTemporaryDraftState_(state).photos[0];
assert.equal(reopened.originalDataUrl, jpeg(originalSmall));
assert.equal(reopened.originalBase64HQ, originalHQ);
assert.equal(reopened.base64, currentSmall);
assert.equal(reopened.base64HQ, currentHQ);
assert.equal(reopened.adjust.brightness, 14);
assert.equal(reopened.adjust.shadows, 18);
assert.equal(reopened.adjust.highlights, 22);

// The current-input save uses full photo objects, unlike a temporary save.
const fromCurrentInput = hooks.hydrateTemporaryDraftPhoto_(structuredClone(adjustedPhoto));
assert.equal(fromCurrentInput.originalDataUrl, jpeg(originalSmall));
assert.equal(fromCurrentInput.originalBase64HQ, originalHQ);
assert.equal(fromCurrentInput.base64HQ, currentHQ);

// Zero-adjustment photos need no duplicated original bytes in IndexedDB.
const unchanged = {
  ...adjustedPhoto,
  originalDataUrl: jpeg(currentSmall), originalBase64HQ: currentHQ,
  adjust: { brightness: 0, contrast: 0, temp: 0 },
};
const compactUnchanged = hooks.compactTemporaryDraftPhoto_(unchanged);
assert.equal(compactUnchanged.originalBase64 || '', '');
assert.equal(compactUnchanged.originalBase64HQ || '', '');
const reloadedUnchanged = hooks.hydrateTemporaryDraftPhoto_(compactUnchanged);
assert.equal(reloadedUnchanged.originalDataUrl, jpeg(currentSmall));
assert.equal(reloadedUnchanged.originalBase64HQ, currentHQ);
assert.equal(reloadedUnchanged.adjust.brightness, 0);

// Older saves have no reliable adjustment source. Preserve their visible bytes
// and start from zero, even if the obsolete metadata happens to be non-zero.
for (const legacy of [
  { mediaType: 'image/jpeg', base64: currentSmall, base64HQ: currentHQ,
    adjust: { brightness: 16, contrast: 9, temp: 2 } },
  { mediaType: 'image/jpeg', dataUrl: jpeg(currentSmall), base64: currentSmall,
    base64HQ: currentHQ, originalDataUrl: jpeg(originalSmall),
    adjust: { brightness: 16, contrast: 9, temp: 2 } },
  { mediaType: 'image/jpeg', base64: currentSmall },
]) {
  const migrated = hooks.hydrateTemporaryDraftPhoto_(legacy);
  assert.equal(migrated.base64, currentSmall);
  assert.equal(migrated.dataUrl, jpeg(currentSmall));
  assert.equal(migrated.base64HQ, legacy.base64HQ || currentSmall);
  assert.equal(migrated.originalDataUrl, jpeg(currentSmall));
  assert.equal(migrated.originalBase64HQ, legacy.base64HQ || currentSmall);
  assert.equal(migrated.adjust.brightness, 0);
  assert.equal(migrated.adjust.contrast, 0);
  assert.equal(migrated.adjustSourceVersion, 1);
  const migratedAgain = hooks.hydrateTemporaryDraftPhoto_(hooks.compactTemporaryDraftPhoto_(migrated));
  assert.equal(migratedAgain.originalDataUrl, jpeg(currentSmall));
  assert.equal(migratedAgain.originalBase64HQ, legacy.base64HQ || currentSmall);
}

// Neither transport quality may leak a backup original or render settings.
for (const preferHighQuality of [true, false]) {
  const payload = hooks.buildDraftPayload_({
    title: '確認用商品', description: '確認用説明', price: '1000', category: 'トップス',
    mercariCategoryKey: 'men_shirt', mercariCategoryPath: [], photos: [reopened],
    preferHighQuality,
  });
  assert.deepEqual(Object.keys(payload.photos[0]).sort(), ['base64', 'mediaType']);
  assert.equal(payload.photos[0].base64, preferHighQuality ? currentHQ : currentSmall);
  assert.equal(payload.photos[0].mediaType, 'image/jpeg');
  assert.equal(JSON.stringify(payload).includes(originalSmall), false);
  assert.equal(JSON.stringify(payload).includes(originalHQ), false);
}

// Tiny deterministic canvases exercise the actual adjustment entry point while
// the browser tests cover real decoding and rendering. Only originals can load:
// reading a previous adjusted result would fail this fixture.
const originalPixels = new Uint8ClampedArray([
  30, 40, 50, 255, 70, 80, 90, 255,
  100, 110, 120, 255, 140, 150, 160, 255,
]);
const loadedSources = [];
context.__loadPhoto = async src => {
  assert.ok([jpeg(originalSmall), jpeg(originalHQ)].includes(src), 'always render from a source original');
  loadedSources.push(src);
  return { naturalWidth: 2, naturalHeight: 2, pixels: new Uint8ClampedArray(originalPixels) };
};
function fakeCanvas() {
  const canvas = { width: 2, height: 2, pixels: new Uint8ClampedArray(originalPixels) };
  canvas.getContext = () => ({
    fillRect() {},
    drawImage(image) { canvas.pixels = new Uint8ClampedArray(image.pixels); },
    getImageData() { return { width: canvas.width, height: canvas.height, data: new Uint8ClampedArray(canvas.pixels) }; },
    putImageData(imageData) { canvas.pixels = new Uint8ClampedArray(imageData.data); },
  });
  canvas.toDataURL = (mediaType, quality) => `data:${mediaType};base64,${bytes(JSON.stringify({ pixels: [...canvas.pixels], quality }))}`;
  return canvas;
}
context.document = { createElement(tag) { assert.equal(tag, 'canvas'); return fakeCanvas(); } };
vm.runInContext('loadImage = src => __loadPhoto(src);', context);

async function testPhotoRendering() {
  const snapshot = JSON.stringify(adjustedPhoto);
  const changed = await context.applyPhotoAdjustment_(adjustedPhoto, { brightness: 8, contrast: 3 });
  assert.notEqual(changed, adjustedPhoto, 'create a new record only after rendering succeeds');
  assert.equal(JSON.stringify(adjustedPhoto), snapshot, 'retain the original record');
  assert.notEqual(changed.base64, originalSmall);
  assert.notEqual(changed.base64HQ, originalHQ);
  assert.equal(changed.dataUrl, jpeg(changed.base64));
  assert.notEqual(changed.thumbnailBase64, adjustedPhoto.thumbnailBase64);
  assert.equal(changed.originalDataUrl, jpeg(originalSmall));
  assert.equal(changed.originalBase64HQ, originalHQ);
  assert.ok(loadedSources.includes(jpeg(originalSmall)));
  assert.ok(loadedSources.includes(jpeg(originalHQ)));

  const shadowOnly = await context.applyPhotoAdjustment_(changed, { shadows: 25 });
  const highlightOnly = await context.applyPhotoAdjustment_(changed, { highlights: 30 });
  assert.notEqual(shadowOnly.base64, originalSmall, 'shadow-only changes update the AI image');
  assert.notEqual(shadowOnly.base64HQ, originalHQ, 'shadow-only changes update the HQ image');
  assert.notEqual(highlightOnly.base64, originalSmall, 'highlight-only changes update the AI image');
  assert.notEqual(highlightOnly.base64HQ, originalHQ, 'highlight-only changes update the HQ image');
  const allTones = await context.applyPhotoAdjustment_(changed, { shadows: 25, highlights: 30 });
  const repeatedTones = await context.applyPhotoAdjustment_(allTones, { shadows: 25, highlights: 30 });
  assert.equal(repeatedTones.base64, allTones.base64);
  assert.equal(repeatedTones.base64HQ, allTones.base64HQ);
  const extendedAdjust = { brightness: -60, contrast: -40, shadows: 75, highlights: 100 };
  const strong = await context.applyPhotoAdjustment_(changed, extendedAdjust);
  const strongAgain = await context.applyPhotoAdjustment_(strong, extendedAdjust);
  assert.equal(strong.base64, strongAgain.base64, 'extended correction remains non-cumulative');
  assert.equal(strong.base64HQ, strongAgain.base64HQ);
  assert.notEqual(strong.base64, changed.base64, 'extended setting updates AI bytes');
  assert.notEqual(strong.base64HQ, changed.base64HQ, 'extended setting updates HQ bytes');
  const savedStrong = hooks.hydrateTemporaryDraftPhoto_(hooks.compactTemporaryDraftPhoto_(strong));
  for (const [key, value] of Object.entries(extendedAdjust)) assert.equal(savedStrong.adjust[key], value);
  assert.equal(savedStrong.originalBase64HQ, originalHQ);
  const resetStrong = await context.applyPhotoAdjustment_(savedStrong, {});
  assert.equal(resetStrong.base64, originalSmall); assert.equal(resetStrong.base64HQ, originalHQ);

  const tonesReset = await context.applyPhotoAdjustment_(allTones, {});
  assert.equal(tonesReset.base64, originalSmall);
  assert.equal(tonesReset.base64HQ, originalHQ);
  assert.equal(tonesReset.adjust.shadows, 0);
  assert.equal(tonesReset.adjust.highlights, 0);

  const repeated = await context.applyPhotoAdjustment_(changed, { brightness: 8, contrast: 3 });
  assert.equal(repeated.base64, changed.base64, 'adjustment does not accumulate across edits');
  assert.equal(repeated.base64HQ, changed.base64HQ);
  assert.equal(repeated.thumbnailBase64, changed.thumbnailBase64);

  const restored = await context.applyPhotoAdjustment_(changed, { brightness: 0, contrast: 0 });
  assert.equal(restored.dataUrl, jpeg(originalSmall), 'reset preserves the original bytes');
  assert.equal(restored.base64, originalSmall);
  assert.equal(restored.base64HQ, originalHQ);
  assert.equal(restored.adjust.brightness, 0);
  assert.equal(restored.adjust.contrast, 0);
}

async function testPhotoEditorRaces() {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { textContent: '', querySelectorAll: () => [] });
    return nodes.get(id);
  };
  context.document.getElementById = node;
  context.pendingAdjustments = [];
  context.editorEvents = [];
  context.editorPhoto = structuredClone(adjustedPhoto);
  context.editorReplacement = { ...adjustedPhoto, base64: bytes('new edited image') };
  vm.runInContext(`
    setPhotoProcessingLock_ = locked => editorEvents.push(['lock', locked]);
    setPhotoEditorControls_ = () => {};
    closePhotoEditor_ = () => { editorEvents.push(['close']); photoEditorState = null; };
    invalidateGeneratedResultAfterInputChange_ = () => editorEvents.push(['invalidate']);
    renderPreviews = () => editorEvents.push(['render', photoProcessingInProgress]);
    updateGenerateButton = () => {}; scheduleSave = () => editorEvents.push(['save']);
    updateDraftChecklist = () => {};
    applyPhotoAdjustment_ = () => new Promise((resolve, reject) => pendingAdjustments.push({ resolve, reject }));
  `, context);
  const start = () => {
    context.editorEvents.length = 0;
    vm.runInContext(`
      uploadedImages = [editorPhoto]; activeTemporaryDraftId = 'photo-test';
      photoEditorState = { photo: editorPhoto, image: {}, busy: false, draftId: 'photo-test', adjust: { brightness: 14, contrast: 5, shadows: 25, highlights: 22 } };
    `, context);
    return context.applyPhotoEditor_();
  };
  const first = start();
  assert.equal(vm.runInContext('photoProcessingInProgress', context), true);
  assert.equal(await context.applyPhotoEditor_(), undefined, 'double apply is ignored');
  assert.equal(context.pendingAdjustments.length, 1);
  context.pendingAdjustments.shift().resolve(context.editorReplacement);
  await first;
  assert.equal(vm.runInContext('uploadedImages[0]', context), context.editorReplacement);
  assert.equal(vm.runInContext('photoProcessingInProgress', context), false);
  assert.deepEqual([...context.editorEvents.find(event => event[0] === 'render')], ['render', false]);
  assert.equal(context.editorEvents.filter(event => event[0] === 'save').length, 1);

  for (const mutation of [
    "activeTemporaryDraftId = 'other-product';",
    'photoProcessingOperationId += 1;',
    'uploadedImages[0] = editorReplacement;',
    'photoEditorState = null;',
  ]) {
    const running = start();
    vm.runInContext(mutation, context);
    const photoBeforeReply = vm.runInContext('uploadedImages[0]', context);
    context.pendingAdjustments.shift().resolve({ ...context.editorReplacement, base64: bytes('late reply') });
    await running;
    assert.equal(vm.runInContext('uploadedImages[0]', context), photoBeforeReply, 'a stale reply cannot replace a photo');
    assert.equal(vm.runInContext('photoProcessingInProgress', context), false);
    assert.equal(context.editorEvents.some(event => event[0] === 'save'), false);
  }
  const failed = start();
  context.pendingAdjustments.shift().reject(new Error('fixture image decode failure'));
  await failed;
  assert.equal(vm.runInContext('uploadedImages[0]', context), context.editorPhoto);
  assert.equal(vm.runInContext('photoProcessingInProgress', context), false);
  assert.equal(context.editorEvents.some(event => event[0] === 'save'), false);
  assert.equal(expectedErrors.length, 5, 'each stale result or rendering failure remains diagnosable');
}

(async () => {
  await testPhotoRendering();
  await testPhotoEditorRaces();
  console.log('PASS photo adjustment flow: source persistence, legacy migration, payloads, non-cumulative rendering, exact reset and editor race/failure locks');
})().catch(error => { console.error(error); process.exitCode = 1; });
