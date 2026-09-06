#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = {
  console,
  URL,
  globalThis: null,
  localStorage: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  },
};
context.globalThis = context;
context.__MERCARI_TEST__ = true;
vm.createContext(context);

const source = [
  fs.readFileSync('catalog-data.js', 'utf8'),
  fs.readFileSync('app.js', 'utf8'),
].join('\n');
vm.runInContext(source, context, { filename: 'app.js' });

const hooks = context.MercariAppTestHooks;
const originalPhoto = {
  mediaType: 'image/jpeg',
  dataUrl: 'data:image/jpeg;base64,low-resolution-photo',
  base64: 'low-resolution-photo',
  base64HQ: 'high-resolution-photo',
  originalDataUrl: 'data:image/jpeg;base64,duplicate-low-resolution-photo',
  adjust: { brightness: 1, temp: 2, contrast: 3 },
};

const compactPhoto = hooks.compactTemporaryDraftPhoto_(originalPhoto);
assert.equal(compactPhoto.base64, 'low-resolution-photo');
assert.equal(compactPhoto.base64HQ, 'high-resolution-photo');
assert.equal(Object.hasOwn(compactPhoto, 'dataUrl'), false);
assert.equal(Object.hasOwn(compactPhoto, 'originalDataUrl'), false);

const hydratedPhoto = hooks.hydrateTemporaryDraftPhoto_(compactPhoto);
assert.equal(hydratedPhoto.dataUrl, 'data:image/jpeg;base64,low-resolution-photo');
assert.equal(hydratedPhoto.originalDataUrl, hydratedPhoto.dataUrl);
assert.equal(hydratedPhoto.base64HQ, 'high-resolution-photo');

const compactState = hooks.compactTemporaryDraftState_({
  photos: [originalPhoto],
  category: 'tops',
  productGender: 'women',
  measurements: {
    'm-shoulder': '39',
    'm-chest': '48',
    'm-sleeve': '',
    'm-length': '62',
  },
  title: '',
  result: '',
});
assert.equal(compactState.photos.length, 1);
assert.equal(Object.hasOwn(compactState.photos[0], 'dataUrl'), false);
assert.equal(hooks.temporaryDraftMeasurementCount_(compactState), 3);
assert.equal(hooks.inferTemporaryDraftStatus_(compactState), 'saved');
assert.equal(hooks.inferTemporaryDraftStatus_({ photos: [], category: 'tops' }), 'incomplete');
assert.equal(hooks.inferTemporaryDraftStatus_({
  photos: compactState.photos,
  category: 'tops',
  title: '商品名',
  result: '説明文',
}), 'generated');

const hydratedState = hooks.hydrateTemporaryDraftState_(compactState);
assert.equal(hydratedState.photos[0].dataUrl, 'data:image/jpeg;base64,low-resolution-photo');
const summary = hooks.temporaryDraftSummaryFromRecord_({
  id: 'input-draft-test',
  createdAt: 1,
  updatedAt: 2,
  status: 'saved',
  errorMessage: '',
  snapshot: compactState,
});
assert.equal(summary.photoCount, 1);
assert.equal(summary.measurementCount, 3);
assert.equal(summary.canGenerate, true);
assert.equal(Object.hasOwn(summary, 'snapshot'), false);
assert.equal(Object.hasOwn(summary, 'base64HQ'), false);
assert.equal(hooks.safeTemporaryThumbnailBase64_('safe+/base64=='), 'safe+/base64==');
assert.equal(hooks.safeTemporaryThumbnailBase64_('"><script>'), '');

const indexHtml = fs.readFileSync('index.html', 'utf8');
[
  'temporary-draft-stage',
  'temporary-draft-count',
  'temporary-draft-list',
  'temporary-draft-status',
  'temporary-save-btn',
  'temporary-save-note',
].forEach(id => {
  const matches = indexHtml.match(new RegExp(`id="${id}"`, 'g')) || [];
  assert.equal(matches.length, 1, `${id} should exist exactly once`);
});
assert.match(indexHtml, />一時保存して次の商品へ</);
assert.match(indexHtml, /この端末内に保存します/);
assert.match(indexHtml, /styles\.css\?v=20260906b/);
assert.match(indexHtml, /app\.js\?v=20260906b/);

assert.match(source, /const DB_VERSION = 2;/);
assert.match(source, /const DB_TEMPORARY_DRAFT_STORE = 'inputDrafts';/);
assert.match(source, /const DB_TEMPORARY_DRAFT_SUMMARY_STORE = 'inputDraftSummaries';/);
assert.match(source, /await putTemporaryDraft_\(record, existing\?\.updatedAt \?\? null\);[\s\S]*await clearCurrentProduct_/);
assert.match(source, /async function putTemporaryDraft_\(record, expectedUpdatedAt = null\)[\s\S]*current\?\.status === 'generating'/);
assert.match(source, /status: 'failed'/);
assert.match(source, /現在の写真と採寸は消していません/);
assert.match(source, /descriptionGenerationInProgress/);
assert.match(source, /record\.status === 'generating'/);
assert.match(source, /mercariSizeUserEdited/);
assert.match(source, /let photoProcessingInProgress = false;/);
assert.match(source, /const operationId = \+\+photoProcessingOperationId;/);
assert.match(source, /operationId !== photoProcessingOperationId \|\| startingDraftId !== activeTemporaryDraftId/);
assert.match(source, /async function claimTemporaryDraftGeneration_/);
assert.match(source, /current\.generationToken !== token/);
assert.match(source, /async function finalizeTemporaryDraftGeneration_/);
assert.match(source, /async function touchTemporaryDraftGeneration_/);
assert.match(source, /await recoverInterruptedTemporaryDraft_\([\s\S]*Date\.now\(\) - TEMPORARY_DRAFT_GENERATION_STALE_MS/);
assert.match(
  source,
  /descriptionGenerationInProgress = true;[\s\S]*await saveCurrentSessionNow_\(\);[\s\S]*const temporaryDraftId/,
);
assert.match(source, /async function saveCurrentSessionNow_\(\)[\s\S]*clearTimeout\(_saveTimer\)/);

const styles = fs.readFileSync('styles.css', 'utf8');
assert.match(styles, /\.temporary-draft-card/);
assert.match(styles, /\.btn\.temporary-save-btn/);

const serviceWorker = fs.readFileSync('sw.js', 'utf8');
assert.match(serviceWorker, /mercari-description-v20260906b/);

console.log(JSON.stringify({
  ok: true,
  dbVersion: 2,
  stores: ['inputDrafts', 'inputDraftSummaries'],
  compactPhotoFields: Object.keys(compactPhoto),
  measurementCount: hooks.temporaryDraftMeasurementCount_(compactState),
  statuses: ['incomplete', 'saved', 'failed', 'generated'],
  version: 'v20260906b',
}));
