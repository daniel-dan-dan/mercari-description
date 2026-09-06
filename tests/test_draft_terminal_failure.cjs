'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = { console, URL, setTimeout, clearTimeout, __MERCARI_TEST__: true,
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} } };
context.window = context;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync('catalog-data.js', 'utf8') + '\n' + fs.readFileSync('app.js', 'utf8'), context);
const hooks = context.MercariAppTestHooks;
(async () => {
  for (const review of [false, true]) {
    let calls = 0;
    const message = 'ブランド選択に失敗したため下書き保存を中止しました: Locator.wait_for: Timeout 5000ms exceeded.';
    context.mockFetch = async () => {
      calls++;
      return { ok: true, status: 200, text: async () => JSON.stringify({
        status: 'error', message, inventoryLink: { status: review ? 'needs_review' : 'draft_failed' },
      }) };
    };
    vm.runInContext('fetchWithTimeout = globalThis.mockFetch;', context);
    await assert.rejects(hooks.pollMacJob('https://fixture.trycloudflare.com', 'fixture', {
      intervalMs: 0, timeoutMs: 1000, networkRetryDelayMs: 0,
    }), error => {
      assert.equal(error.macJobFailed, true);
      assert.equal(hooks.isTransientServiceDiscoveryError_(error), false);
      assert.equal(hooks.isRetryableJobStatusError_(error), false);
      assert.equal(hooks.formatDraftSaveError_(error), message);
      assert.equal(hooks.shouldClearDraftOperationAfterError_(error, { accepted: true }), false);
      if (review) assert.equal(error.code, 'DRAFT_SAVE_NEEDS_REVIEW');
      return true;
    });
    assert.equal(calls, 1, 'completed browser errors must not trigger network retries');
  }
  assert.match(hooks.formatDraftSaveError_(new Error('Failed to fetch')), /Macとの通信/);
  console.log('PASS draft terminal failure classification and receipt preservation');
})().catch(error => { console.error(error); process.exitCode = 1; });
