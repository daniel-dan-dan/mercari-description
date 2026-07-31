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
const retryPayload = hooks.buildResearchMacPayload_({
  id: 'research-retry-1',
  createdAt: '2026-08-01T00:00:00+09:00',
  title: 'バーバリー コート',
  brand: 'バーバリー',
  keyword: 'バーバリー コート',
  status: '送信待ち',
  syncPending: true,
  localDisplayMessage: 'Macへ再送',
});

assert.equal(retryPayload.status, '待機中', '再送依頼をMac側の夜間キュー対象に戻す');
assert.equal(retryPayload.id, 'research-retry-1');
assert.equal(Object.hasOwn(retryPayload, 'syncPending'), false, 'PWA専用の再送フラグはMacへ送らない');
assert.equal(Object.hasOwn(retryPayload, 'localDisplayMessage'), false, '許可リスト外の表示情報はMacへ送らない');
assert.match(
  source,
  /const macPayload = buildResearchMacPayload_\(request\);[\s\S]{0,350}body: JSON\.stringify\(macPayload\)/,
  '実際の再送POSTで整形済みデータを使う',
);

const composeStart = source.indexOf('async function addComposedImageToApp');
const composeEnd = source.indexOf('async function applyCompose', composeStart);
assert.ok(composeStart >= 0 && composeEnd > composeStart, '画像合成追加処理が存在する');
const composeSource = source.slice(composeStart, composeEnd);
const lockStart = composeSource.indexOf('photoProcessingInProgress = true;');
const render = composeSource.indexOf('renderPreviews()');
const unlockState = composeSource.indexOf('photoProcessingInProgress = false;');
const unlockControls = composeSource.indexOf('setPhotoProcessingLock_(false);');

assert.ok(lockStart >= 0, '合成画像の変換中は写真操作をロックする');
assert.ok(unlockState > lockStart, '処理完了までロック状態を保つ');
assert.ok(unlockControls > unlockState, '処理状態を戻してから操作部品を解除する');
assert.ok(render > unlockControls, 'ロック解除後に削除ボタンを作り直す');
assert.doesNotMatch(
  composeSource.slice(lockStart, unlockState),
  /renderPreviews\(\)/,
  'ロック中にdisabledの削除ボタンを新規作成しない',
);

console.log(JSON.stringify({
  ok: true,
  researchRetryStatus: retryPayload.status,
  clientOnlyFieldsRemoved: true,
  photoButtonsRenderedAfterUnlock: true,
}));
