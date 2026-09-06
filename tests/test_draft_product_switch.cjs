'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const key = 'mercari_pending_draft_operation';
const stored = new Map();
let counter = 0;
const ctx = { console, URL, setTimeout, clearTimeout, __MERCARI_TEST__: true,
  crypto: { randomUUID: () => `switch-${++counter}` },
  localStorage: { getItem: k => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v), removeItem: k => stored.delete(k) } };
ctx.window = ctx; ctx.globalThis = ctx; vm.createContext(ctx);
vm.runInContext(['catalog-data.js', 'app.js'].map(p => fs.readFileSync(p, 'utf8')).join('\n'), ctx);
const h = ctx.MercariAppTestHooks;
const oldPayload = { title: 'Bip 3 Pro', price: 7800, images: ['old-photo'] };
const newPayload = { title: 'SYGN HOUSE', images: Array(8).fill('new-photo') };
const legacy = { operationId: 'legacy-pending', fingerprint: h.draftPayloadFingerprint_(oldPayload), createdAt: 1 };
stored.set(key, JSON.stringify(legacy));
const next = h.getOrCreateDraftOperation_(newPayload, 2);
assert.equal(next.reused, false);
assert.notEqual(next.operationId, legacy.operationId);
assert.equal(h.getOrCreateDraftOperation_(oldPayload, 9e10).operationId, legacy.operationId);
assert.equal(h.getOrCreateDraftOperation_(newPayload).operationId, next.operationId);
assert.doesNotMatch(stored.get(key), /Bip|SYGN|photo|7800/);
assert.equal(next.previous, undefined, 'history must not become part of the request');
h.clearDraftOperation_(legacy.operationId);
assert.equal(h.getOrCreateDraftOperation_(newPayload).operationId, next.operationId);
const renewedOld = h.getOrCreateDraftOperation_(oldPayload);
h.clearDraftOperation_(renewedOld.operationId);
assert.equal(h.getOrCreateDraftOperation_(newPayload).operationId, next.operationId);
// Completing the current product must preserve all older unresolved receipts.
const third = h.getOrCreateDraftOperation_({ title: 'third' });
h.clearDraftOperation_(third.operationId);
assert.equal(h.getOrCreateDraftOperation_(newPayload).operationId, next.operationId);
const before = stored.get(key);
h.clearDraftOperation_(); h.clearDraftOperation_('unknown');
assert.equal(stored.get(key), before);
const writer = ctx.localStorage.setItem;
ctx.localStorage.setItem = () => { throw new Error('quota'); };
assert.throws(() => h.getOrCreateDraftOperation_({ title: 'cannot persist' }), /保存できない/);
assert.equal(stored.get(key), before);
ctx.localStorage.setItem = writer;
stored.set(key, before);
ctx.localStorage.setItem = () => {};
assert.throws(() => h.getOrCreateDraftOperation_({ title: 'silent failure' }), /保存できない/);
assert.equal(stored.get(key), before);
ctx.localStorage.setItem = writer;
for (let i = 0; i < 150; i++) h.getOrCreateDraftOperation_({ title: `product-${i}` });
assert.equal(h.getOrCreateDraftOperation_(newPayload).operationId, next.operationId);
assert.equal(JSON.parse(stored.get(key)).previous.length, 150);
for (const corrupt of ['{', '{}', '{"operationId":"x","fingerprint":"f","previous":[{}]}']) {
  stored.set(key, corrupt);
  assert.throws(() => h.getOrCreateDraftOperation_(newPayload), /読めない/);
  assert.throws(() => h.clearDraftOperation_('x'), /読めない/);
  assert.equal(stored.get(key), corrupt);
}
stored.set(key, JSON.stringify(legacy));
h.clearDraftOperation_(legacy.operationId);
assert.equal(stored.has(key), false);
console.log('Draft product switching: legacy migration, independent receipts, duplicate reuse and storage safety passed');
