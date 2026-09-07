'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const summaryKey = 'mercari_listing_style_summary';
const promptKey = 'mercari_listing_style_prompt';
const previousSummary = JSON.stringify({ hasStyle: true, itemCount: 390, updatedAt: '2026-09-01T00:00:00Z', titleWordHints: [] });
const oldPrompt = '前回確認できた出品文体';
function harness(job) {
  const storage = new Map([[summaryKey, previousSummary], [promptKey, oldPrompt]]);
  const nodes = new Map();
  const getNode = id => {
    if (!nodes.has(id)) nodes.set(id, { disabled: false, textContent: '', classList: { add() {}, remove() {} } });
    return nodes.get(id);
  };
  const ctx = { console: { ...console, error() {} }, URL, setTimeout, clearTimeout, __MERCARI_TEST__: true, fixtureJob: job,
    document: { getElementById: getNode },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
  };
  ctx.window = ctx; ctx.globalThis = ctx; vm.createContext(ctx);
  vm.runInContext(['catalog-data.js', 'app.js'].map(file => fs.readFileSync(file, 'utf8')).join('\n'), ctx);
  vm.runInContext(`
    getMercariServiceUrl = async () => 'https://fixture.trycloudflare.com';
    fetchWithTimeout = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ ok: true, job_id: 'style-fixture' }) });
    attachJobWaitCancel_ = () => ({ cleanup() {} });
    pollMacJob = async (_url, _id, options) => { options.onStatus(fixtureJob); return fixtureJob; };
  `, ctx);
  return { ctx, storage, getNode };
}

(async () => {
  for (const deferred of [true, false]) {
    const { ctx, storage, getNode } = harness({ status: 'done', deferred, message: '下書き保存を優先したため、全件取得を延期しました。前回の文体は維持しています。' });
    await vm.runInContext('refreshListingStyleFromMac()', ctx);
    assert.equal(storage.get(summaryKey), previousSummary);
    assert.equal(storage.get(promptKey), oldPrompt);
    assert.equal(getNode('listing-style-refresh-btn').disabled, false);
    const message = getNode('listing-style-status').textContent;
    assert.match(message, deferred ? /延期.*前回.*過去出品390件/ : /更新結果を確認できない.*前回の文体/);
    assert.doesNotMatch(message, /まだ過去出品の文体を取得していません/);
  }
  {
    const { ctx, storage, getNode } = harness({ status: 'done', style: { hasStyle: true, itemCount: 400, prompt: '更新確認済みの文体', updatedAt: '2026-09-07T00:00:00Z' } });
    await vm.runInContext('refreshListingStyleFromMac()', ctx);
    assert.equal(storage.get(promptKey), '更新確認済みの文体');
    assert.equal(JSON.parse(storage.get(summaryKey)).itemCount, 400);
    assert.match(getNode('listing-style-status').textContent, /過去出品400件/);
  }
  console.log('PASS listing style priority deferral: preserve last summary and prompt, explicit deferral, reject missing result, normal refresh unchanged');
})().catch(error => { console.error(error); process.exitCode = 1; });
