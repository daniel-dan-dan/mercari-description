'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = vm.createContext({ console, URL, __MERCARI_TEST__: true, setTimeout, clearTimeout });
vm.runInContext(fs.readFileSync('inventory-hub.js', 'utf8'), context);
const h = context.MercariInventoryHub;
const hub = { ok: true, items: [], inventoryComplete: true, schemaReady: true };
(async () => {
  const calls = [];
  let latency = 45000;
  const request = h.createRequest({
    getServiceUrl: async () => 'https://fixture.invalid',
    fetchWithTimeout: async (url, options, timeout) => {
      calls.push({ url, options, timeout });
      if (latency > timeout) throw Error('fixture deadline exceeded');
      return { status: 200, data: hub };
    },
    readJsonResponse: async response => response.data,
  });
  assert.equal((await request('/inventory/hub')).inventoryComplete, true,
    'a 45-second inventory response must survive the previous 30-second deadline');
  assert.equal(calls[0].timeout, 75000);
  await assert.rejects(request('/inventory/hub/result?operationId=fixture-operation'), /deadline/);
  assert.equal(calls[1].timeout, 30000, 'read-only operation recovery keeps its bounded 30-second request');
  await assert.rejects(request('/inventory/hub/confirm', { method: 'POST', body: { operationId: 'fixture-operation' } }), /deadline/);
  assert.equal(calls[2].timeout, 30000);
  assert.equal(calls[2].options.headers['X-Operation-Id'], 'fixture-operation');
  assert.equal(JSON.parse(calls[2].options.body).operationId, 'fixture-operation');
  assert.equal(calls.filter(call => call.options.method === 'POST').length, 1, 'longer reads must not add a write retry');
  latency = 80000;
  await assert.rejects(request('/inventory/hub'), /deadline/, 'full reads still have a finite upper bound');

  let mode = 'failed'; let release;
  const controller = h.createController({
    storage: { getItem: () => null }, operationId: () => 'fixture-operation',
    request: async () => {
      if (mode === 'failed') throw Error('前回の30秒タイムアウト');
      return new Promise(resolve => { release = resolve; });
    },
  });
  controller.notice('反映未確認の商品は確認待ちに残っています。', 'warn');
  await assert.rejects(controller.refresh(), /タイムアウト/);
  assert.match(controller.state.loadError, /30秒タイムアウト/);
  assert.match(controller.state.message, /確認待ち/, 'a read failure must not replace a hold notice');
  mode = 'pending';
  const loading = controller.refresh();
  assert.equal(controller.state.loading, true);
  assert.equal(controller.state.loadError, '', 'previous read error is cleared before the next response arrives');
  assert.match(controller.state.message, /確認待ち/);
  release(hub); await loading;
  assert.equal(controller.state.stale, false);
  assert.match(controller.state.message, /確認待ち/, 'successful refresh must preserve unresolved operation guidance');

  const pending = { operationId: 'fixture-pending-operation', kind: 'reconcile' };
  const busy = h.createController({ storage: { getItem: () => JSON.stringify(pending) }, operationId: () => '', request: async () => { throw Error('offline'); } });
  busy.notice('照合の反映結果を確認しています。', 'warn');
  await assert.rejects(busy.refresh(), /offline/);
  assert.equal(busy.state.pending.operationId, pending.operationId);
  assert.match(busy.state.message, /反映結果/);
  console.log('PASS inventory hub deadlines: 45-second reads, 75-second bound, 30-second writes/results, no replay, stale-error reset and operation-notice retention');
})().catch(error => { console.error(error); process.exitCode = 1; });
