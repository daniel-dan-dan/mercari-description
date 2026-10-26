'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const bytes = text => Buffer.from(text).toString('base64');
const jpeg = base64 => `data:image/jpeg;base64,${base64}`;
const plain = value => JSON.parse(JSON.stringify(value));
const ai = bytes('textless analysis image');
const hq = bytes('textless high quality image');
const original = bytes('retained original analysis image');
const originalHQ = bytes('retained original high quality image');
const thumb = bytes('textless thumbnail');
const listing = bytes('listing text analysis size');
const listingHQ = bytes('listing text high quality');
const listingThumb = bytes('listing text thumbnail');
const overlay = { text: 'メーカー\nMODEL-123', style: 'white-black', x: .06, y: .08,
  fontSize: .075, stroke: .006, italic: true };
const photo = {
  mediaType: 'image/jpeg', dataUrl: jpeg(ai), base64: ai, base64HQ: hq,
  thumbnailBase64: thumb, originalDataUrl: jpeg(original), originalBase64HQ: originalHQ,
  adjustSourceVersion: 1, adjust: { brightness: 8, contrast: 3, shadows: 4, highlights: 5, warmth: -6 },
};
const textPhoto = { ...photo, textOverlay: overlay, listingDataUrl: jpeg(listing),
  listingBase64: listing, listingBase64HQ: listingHQ, listingThumbnailBase64: listingThumb };

function createContext() {
  const errors = [], events = [], nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { value: id === 'category' ? 'tops' : '', checked: false,
      textContent: '', hidden: false, querySelectorAll: () => [], classList: { remove() {}, add() {} } });
    return nodes.get(id);
  };
  const context = {
    console: { ...console, error: (...args) => errors.push(args) }, URL, Intl, setTimeout, clearTimeout,
    __MERCARI_TEST__: true, __events: events,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch() { throw new Error('Text editing must not call an external API'); },
    document: { fonts: { ready: Promise.resolve() }, getElementById: node,
      querySelectorAll: () => [], querySelector: () => null },
  };
  context.window = context; context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(['catalog-data.js', 'photo-adjust.js', 'photo-text.js', 'app.js']
    .map(file => fs.readFileSync(file, 'utf8')).join('\n'), context);
  return { context, hooks: context.MercariAppTestHooks, events, errors };
}

function testRetentionAndPayload() {
  const { hooks } = createContext();
  const compact = hooks.compactTemporaryDraftPhoto_(textPhoto);
  assert.equal(compact.base64, ai); assert.equal(compact.base64HQ, hq);
  assert.equal(compact.originalBase64, original); assert.equal(compact.originalBase64HQ, originalHQ);
  assert.deepEqual(plain(compact.textOverlay), { version: 1, ...overlay });
  assert.equal(compact.listingBase64, listing); assert.equal(compact.listingBase64HQ, listingHQ);
  assert.equal(compact.listingThumbnailBase64, listingThumb);
  for (const duplicated of ['dataUrl', 'originalDataUrl', 'listingDataUrl']) {
    assert.equal(Object.hasOwn(compact, duplicated), false, `${duplicated} is not duplicated in storage`);
  }
  const restored = hooks.hydrateTemporaryDraftPhoto_(compact);
  assert.equal(restored.dataUrl, jpeg(ai)); assert.equal(restored.originalDataUrl, jpeg(original));
  assert.equal(restored.originalBase64HQ, originalHQ);
  assert.equal(restored.listingDataUrl, jpeg(listing));
  assert.deepEqual(plain(restored.textOverlay), { version: 1, ...overlay });
  assert.equal(restored.listingBase64HQ, listingHQ);
  const reopened = hooks.hydrateTemporaryDraftState_(hooks.compactTemporaryDraftState_({
    photos: [restored], category: 'tops',
  })).photos[0];
  assert.equal(reopened.base64, ai); assert.equal(reopened.listingBase64, listing);
  assert.deepEqual(plain(reopened.textOverlay), { version: 1, ...overlay });
  const summary = hooks.temporaryDraftSummaryFromRecord_({ id: 'text-draft', createdAt: 1, updatedAt: 2,
    snapshot: { photos: [compact], category: 'tops' } });
  assert.equal(summary.thumbnailBase64, listingThumb);
  assert.equal(summary.photoCount, 1);
  assert.equal(hooks.listingPhotoDataUrl_(restored), jpeg(listing));

  const legacy = hooks.hydrateTemporaryDraftPhoto_({ mediaType: 'image/jpeg', base64: ai, base64HQ: hq });
  assert.equal(legacy.dataUrl, jpeg(ai)); assert.equal(legacy.originalDataUrl, jpeg(ai));
  assert.equal(legacy.textOverlay, null); assert.equal(legacy.listingBase64, '');
  assert.equal(hooks.listingPhotoDataUrl_(legacy), jpeg(ai));
  const cleared = hooks.hydrateTemporaryDraftPhoto_({ ...textPhoto, textOverlay: { text: '   \n' } });
  assert.equal(cleared.textOverlay, null);
  for (const key of ['listingBase64', 'listingBase64HQ', 'listingDataUrl', 'listingThumbnailBase64']) assert.equal(cleared[key], '');

  const input = { title: '確認用商品', description: '確認用説明', price: '1000', category: 'トップス',
    mercariCategoryKey: 'men_shirt', mercariCategoryPath: [], photos: [restored, legacy] };
  for (const preferHighQuality of [true, false]) {
    const payload = hooks.buildDraftPayload_({ ...input, preferHighQuality });
    assert.equal(payload.photos[0].base64, preferHighQuality ? listingHQ : listing);
    assert.equal(payload.photos[1].base64, preferHighQuality ? hq : ai);
    assert.deepEqual(Object.keys(payload.photos[0]).sort(), ['base64', 'mediaType']);
    assert.equal(payload.photos[0].mediaType, 'image/jpeg');
    const serialized = JSON.stringify(payload);
    for (const forbidden of [original, originalHQ, 'textOverlay', 'originalDataUrl', 'listingBase64', 'fontSize']) {
      assert.equal(serialized.includes(forbidden), false, `${forbidden} must stay on the device`);
    }
    const otherQualityOnly = { ...restored,
      ...(preferHighQuality ? { listingBase64HQ: '' } : { listingBase64: '' }) };
    assert.equal(hooks.buildDraftPayload_({ ...input, photos: [otherQualityOnly], preferHighQuality }).photos[0].base64,
      preferHighQuality ? listing : listingHQ);
  }
  assert.throws(() => hooks.buildDraftPayload_({ ...input, photos: [{ ...restored, listingBase64: '', listingBase64HQ: '' }] }),
    /文字入り写真を復元できません/);
  assert.throws(() => hooks.buildDraftPayload_({ ...input, preferHighQuality: false,
    photos: [{ ...restored, listingBase64: '', listingBase64HQ: '' }] }), /文字入り写真を復元できません/);
}

function testAnalysisFingerprint() {
  const { context } = createContext();
  context.__plainPhoto = photo; context.__textPhoto = textPhoto;
  vm.runInContext('uploadedImages = [__plainPhoto];', context);
  const before = context.generationSourceFingerprint_();
  context.__fingerprint = before;
  vm.runInContext('lastAiData = { item: "existing result", generation_input_fingerprint: __fingerprint }; uploadedImages = [__textPhoto];', context);
  assert.equal(context.generationSourceFingerprint_(), before, 'listing-only text must not change AI input identity');
  assert.equal(context.isGeneratedResultCurrent_(), true, 'existing description remains current');
  assert.equal(vm.runInContext('lastAiData.item', context), 'existing result');
}

const pixels = new Uint8ClampedArray([30, 40, 50, 255, 70, 80, 90, 255, 100, 110, 120, 255, 140, 150, 160, 255]);
function imageFixture() { return { naturalWidth: 2, naturalHeight: 2, pixels: new Uint8ClampedArray(pixels), textEvents: [] }; }
function fakeCanvas() {
  const canvas = { width: 2, height: 2, pixels: new Uint8ClampedArray(pixels), textEvents: [] };
  const stack = [];
  const context = {
    font: '10px Arial',
    fillRect() {},
    drawImage(image) { canvas.pixels = new Uint8ClampedArray(image.pixels); canvas.textEvents = [...(image.textEvents || [])]; },
    getImageData() { return { width: canvas.width, height: canvas.height, data: new Uint8ClampedArray(canvas.pixels) }; },
    putImageData(image) { canvas.pixels = new Uint8ClampedArray(image.data); },
    save() { stack.push(this.font); }, restore() { this.font = stack.pop(); },
    measureText(text) {
      const size = Number(/([.\d]+)px/.exec(this.font)[1]);
      return { width: Array.from(text).length * size * .7 };
    },
    strokeText(text) { canvas.textEvents.push(['stroke', text]); },
    fillText(text) { canvas.textEvents.push(['fill', text]); },
  };
  canvas.getContext = () => context;
  canvas.toDataURL = (mediaType, quality) => `data:${mediaType};base64,${bytes(JSON.stringify({
    width: canvas.width, height: canvas.height, pixels: [...canvas.pixels], textEvents: canvas.textEvents, quality,
  }))}`;
  return canvas;
}
function decodeFixture(source) {
  const encoded = String(source).split(',')[1];
  if ([ai, hq, original, originalHQ].includes(encoded)) return imageFixture();
  const parsed = JSON.parse(Buffer.from(encoded, 'base64').toString());
  return { naturalWidth: parsed.width, naturalHeight: parsed.height,
    pixels: new Uint8ClampedArray(parsed.pixels), textEvents: parsed.textEvents };
}
function installRendering(context, load) {
  context.document.createElement = tag => { assert.equal(tag, 'canvas'); return fakeCanvas(); };
  context.__loadPhoto = load || (async source => decodeFixture(source));
  vm.runInContext('loadImage = source => __loadPhoto(source);', context);
}

async function testRenderingAndCorrection() {
  const { context, hooks } = createContext();
  const loaded = [];
  installRendering(context, async source => { loaded.push(source); return decodeFixture(source); });
  const before = JSON.stringify(photo);
  const rendered = await hooks.renderPhotoTextOutput_(photo, overlay);
  assert.equal(JSON.stringify(photo), before, 'rendering cannot mutate the retained photo');
  for (const key of ['base64', 'base64HQ', 'dataUrl', 'thumbnailBase64', 'originalDataUrl', 'originalBase64HQ']) {
    assert.equal(rendered[key], photo[key], `${key} stays textless`);
  }
  assert.deepEqual(loaded, [jpeg(hq)], 'text is drawn onto the adjusted HQ source, not the original or previous listing');
  assert.notEqual(rendered.listingBase64, ai); assert.notEqual(rendered.listingBase64HQ, hq);
  assert.ok(rendered.listingThumbnailBase64);
  const repeated = await hooks.renderPhotoTextOutput_(rendered, overlay);
  assert.equal(repeated.listingBase64HQ, rendered.listingBase64HQ, 'reapplying text does not accumulate');
  const removed = await hooks.renderPhotoTextOutput_(rendered, { text: '' });
  assert.equal(removed.textOverlay, null);
  for (const key of ['listingBase64', 'listingBase64HQ', 'listingDataUrl', 'listingThumbnailBase64']) assert.equal(removed[key], '');
  assert.equal(removed.base64HQ, hq);
  const corrected = await context.applyPhotoAdjustment_(rendered, { warmth: -18 });
  assert.notEqual(corrected.base64, ai, 'tone editing still updates the textless AI source');
  assert.notEqual(corrected.base64HQ, hq);
  assert.ok(corrected.listingBase64HQ, 'text is reconstructed after tone correction');
  assert.deepEqual(plain(corrected.textOverlay), plain(rendered.textOverlay));
  const listingImage = decodeFixture(jpeg(corrected.listingBase64HQ));
  const analysisImage = decodeFixture(jpeg(corrected.base64HQ));
  assert.equal(analysisImage.textEvents.length, 0);
  assert.ok(listingImage.textEvents.some(event => event[0] === 'fill'));
  const correctionAgain = await context.applyPhotoAdjustment_(corrected, { warmth: -18 });
  assert.equal(correctionAgain.base64HQ, corrected.base64HQ);
  assert.equal(correctionAgain.listingBase64HQ, corrected.listingBase64HQ, 'correction and text remain non-cumulative');
}

async function testAtomicCommitAndStaleGuards() {
  const { context, hooks, events } = createContext();
  const pending = [];
  installRendering(context, source => new Promise((resolve, reject) => pending.push({ source, resolve, reject })));
  context.__photoA = { ...photo }; context.__photoB = { ...photo, base64: bytes('second analysis photo') };
  context.__overlay = overlay;
  vm.runInContext(`
    setPhotoProcessingLock_ = locked => __events.push(['lock', locked]);
    renderPreviews = () => __events.push(['render', photoProcessingInProgress]);
    updateGenerateButton = () => {};
    scheduleSave = () => __events.push(['save']);
    updateDraftChecklist = () => {};
  `, context);
  const start = () => {
    events.length = 0;
    vm.runInContext(`
      uploadedImages = [__photoA, __photoB]; currentProductWorkflowId = 'workflow-a'; activeTemporaryDraftId = 'draft-a';
      lastAiData = { item: 'retained description', generation_input_fingerprint: generationSourceFingerprint_() };
    `, context);
    return hooks.applyPhotoTextEditor_(context.__photoA, overlay, () => context.__current !== false);
  };
  const waitForDecode = async () => {
    for (let i = 0; i < 10 && !pending.length; i++) await Promise.resolve();
    assert.equal(pending.length, 1);
    return pending.shift();
  };
  const success = start();
  assert.equal(vm.runInContext('photoProcessingInProgress', context), true);
  await assert.rejects(hooks.applyPhotoTextEditor_(context.__photoA, overlay, () => true), /処理が終わって/);
  (await waitForDecode()).resolve(imageFixture());
  assert.equal(await success, true);
  const changed = vm.runInContext('uploadedImages[0]', context);
  assert.notEqual(changed, context.__photoA);
  assert.equal(changed.base64, ai); assert.ok(changed.listingBase64HQ);
  assert.equal(vm.runInContext('uploadedImages[1]', context), context.__photoB, 'only the chosen photo changes');
  assert.equal(vm.runInContext('lastAiData.item', context), 'retained description');
  assert.equal(context.isGeneratedResultCurrent_(), true);
  assert.equal(vm.runInContext('photoProcessingInProgress', context), false);
  assert.deepEqual([...events.find(event => event[0] === 'render')], ['render', false]);
  assert.equal(events.filter(event => event[0] === 'save').length, 1);

  for (const mutation of [
    "currentProductWorkflowId = 'workflow-b'", "activeTemporaryDraftId = 'draft-b'",
    'photoProcessingOperationId += 1', 'uploadedImages.reverse()', 'uploadedImages.pop()',
    '__current = false',
  ]) {
    context.__current = true;
    const running = start();
    const decode = await waitForDecode();
    vm.runInContext(mutation, context);
    const photosBeforeReply = vm.runInContext('uploadedImages.slice()', context);
    decode.resolve(imageFixture());
    await assert.rejects(running, /商品または写真が変わった/);
    const photosAfterReply = vm.runInContext('uploadedImages.slice()', context);
    assert.equal(photosAfterReply.length, photosBeforeReply.length);
    photosBeforeReply.forEach((item, i) => assert.equal(photosAfterReply[i], item));
    assert.equal(vm.runInContext('photoProcessingInProgress', context), false);
    assert.equal(events.some(event => event[0] === 'save' || event[0] === 'render'), false);
    assert.deepEqual(plain(events), [['lock', true], ['lock', false]]);
  }
  context.__current = true;
  const failed = start();
  (await waitForDecode()).reject(new Error('fixture decode failure'));
  await assert.rejects(failed, /fixture decode failure/);
  assert.equal(vm.runInContext('uploadedImages[0]', context), context.__photoA);
  assert.equal(vm.runInContext('uploadedImages[1]', context), context.__photoB);
  assert.equal(vm.runInContext('photoProcessingInProgress', context), false);
  assert.deepEqual(plain(events), [['lock', true], ['lock', false]]);
  await assert.rejects(hooks.applyPhotoTextEditor_(context.__photoA, overlay, () => false), /商品または写真が変わりました/);
  await assert.rejects(hooks.applyPhotoTextEditor_(context.__photoA, overlay, null), /商品または写真が変わりました/);
}

(async () => {
  testRetentionAndPayload();
  testAnalysisFingerprint();
  await testRenderingAndCorrection();
  await testAtomicCommitAndStaleGuards();
  console.log('PASS photo text flow: retained originals/settings, listing-only payloads, unchanged AI fingerprint, redraw and atomic stale/failure guards');
})().catch(error => { console.error(error); process.exitCode = 1; });
