'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const stored = new Map();
let uuidCounter = 0;
const ctx = { console, URL, setTimeout, clearTimeout, TextEncoder, __MERCARI_TEST__: true,
  localStorage: { getItem: k => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v), removeItem: k => stored.delete(k) },
  crypto: { randomUUID: () => `contract-operation-${++uuidCounter}` } };
ctx.window = ctx; ctx.globalThis = ctx; vm.createContext(ctx);
vm.runInContext(['catalog-data.js', 'app.js', 'review.js'].map(p => fs.readFileSync(p, 'utf8')).join('\n'), ctx);
const hooks = ctx.MercariAppTestHooks;
(async () => {
  const response = body => ({ ok: !body.error, status: body.error ? 409 : 200, text: async () => JSON.stringify(body) });
  ctx.fixtureResponse = response({ ok: false, error: '要確認', code: 'DRAFT_SAVE_NEEDS_REVIEW', status: 'needs_review' });
  vm.runInContext('fetchWithTimeout = async () => fixtureResponse', ctx);
  await assert.rejects(hooks.startDraftJob_('https://test.trycloudflare.com', {}, { operationId: 'contract', retryDelayMs: 0 }), error => {
    assert.equal(error.code, 'DRAFT_SAVE_NEEDS_REVIEW');
    assert.equal(hooks.shouldPreserveDraftOperation_(error), true); return true;
  });
  ctx.fixtureResponse = response({ ok: true, status: 'done', deduplicated: true, operationId: 'contract' });
  const done = await hooks.startDraftJob_('https://test.trycloudflare.com', {}, { operationId: 'contract' });
  assert.equal(done.completed, true); assert.equal(done.data.job_id, undefined);
  ctx.fixtureResponse = response({ ok: true, status: 'done', operationId: 'different-id' });
  await assert.rejects(hooks.startDraftJob_('https://test.trycloudflare.com', {}, { operationId: 'contract', retryDelayMs: 0 }), /受付IDが一致しません/);
  for (const httpStatus of [400, 401, 403, 404]) {
    const error = Object.assign(new Error('fixture rejection'), { httpStatus });
    assert.equal(hooks.shouldClearDraftOperationAfterError_(error, { reused: true }), false);
    assert.equal(hooks.shouldClearDraftOperationAfterError_(error, { accepted: true }), false);
  }
  let call = 0;
  ctx.nextResponse = async () => {
    if (++call === 1) throw new Error('Failed to fetch');
    return { ok: false, status: 401, text: async () => JSON.stringify({ ok: false, error: 'unauthorized' }) };
  };
  vm.runInContext('fetchWithTimeout = nextResponse', ctx);
  await assert.rejects(hooks.startDraftJob_('https://test.trycloudflare.com', {}, { operationId: 'contract', retryDelayMs: 0 }), error => {
    assert.equal(hooks.shouldPreserveDraftOperation_(error), true); return true;
  });
  const operation = hooks.getOrCreateDraftOperation_({ title: 'fixture' }, 1);
  assert.equal(hooks.getOrCreateDraftOperation_({ title: 'fixture' }, 8e10).operationId, operation.operationId);
  assert.notEqual(hooks.getOrCreateDraftOperation_({ title: 'edited' }).operationId, operation.operationId);
  hooks.clearDraftOperation_(operation.operationId);
  const writer = ctx.localStorage.setItem;
  ctx.localStorage.setItem = () => { throw new Error('quota'); };
  assert.throws(() => hooks.getOrCreateDraftOperation_({ title: 'fixture' }), /保存できない/);
  ctx.localStorage.setItem = writer;
  assert.equal(hooks.buildMarkdownRunStatus({ summary: { ambiguous: 1 } }).kind, 'warn');
  assert.match(hooks.buildMarkdownRunStatus({ summary: { ambiguous: 1 } }).message, /結果不明1件/);
  assert.equal(hooks.buildMarkdownRunStatus({ summary: { skipped: 2 } }).kind, 'success');
  assert.match(hooks.listingStyleAgeText_('2026-06-22T21:07:00+09:00', Date.parse('2026-09-05T21:07:00+09:00')), /75日前/);
  assert.match(hooks.listingStyleAgeText_('broken'), /取得日時を確認できません/);
  const text = ctx.MercariReviewTestHooks.workflowText({ itemCount: 155, status: 'archived', workflow: { accepted: 1, verified: 1, applied: 0, unresolvedTotal: null } });
  assert.match(text, /取得 155件/); assert.match(text, /今回在庫反映 0件/); assert.match(text, /未解決総数 未確認/);
  assert.doesNotMatch(fs.readFileSync('review.js', 'utf8'), /innerHTML/);
  console.log('M01/02/05/06/08/13: 16 contract assertions passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
