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
  photoButtonsRenderedAfterUnlock: true,
}));
