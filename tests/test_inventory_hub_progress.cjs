'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = vm.createContext({ console, URL, __MERCARI_TEST__: true, setTimeout, clearTimeout });
vm.runInContext(fs.readFileSync('inventory-hub.js', 'utf8'), context);
const h = context.MercariInventoryHub;
const pending = { operationId: 'fixture-progress-operation', kind: 'reconcile' };
const hub = { ok: true, items: [], inventoryComplete: true, schemaReady: true };
function fixture({ finish = Infinity, hideAfter = Infinity, requestMs = 0, invalid = false, fail = false } = {}) {
  let clock = 0; let reads = 0; let writes = 0; let stored = JSON.stringify(pending);
  const notices = []; const waits = [];
  const controller = h.createController({
    storage: { getItem: () => stored, removeItem: () => { stored = null; } },
    operationId: () => 'unused-operation', now: () => clock, isVisible: () => reads < hideAfter,
    wait: async ms => { waits.push(ms); clock += ms; },
    onChange: state => { notices.push(state.message); },
    request: async (path, options = {}) => {
      if (options.method === 'POST') writes++;
      if (path === '/inventory/hub') return hub;
      reads++; clock += requestMs;
      if (fail) throw Error('offline');
      if (reads === finish) return { ok: true, operationId: pending.operationId, status: 'done', summary: { updated: 10 } };
      return { ok: true, operationId: pending.operationId, status: 'running', message: '照合中です',
        summary: { observed: invalid ? '51' : 51, updated: invalid ? -1 : 4 } };
    },
  });
  return { controller, notices, waits, reads: () => reads, writes: () => writes, clock: () => clock };
}
(async () => {
  const normal = fixture({ finish: 40 });
  await normal.controller.resume();
  assert.equal(normal.reads(), 40, 'a normal operation lasting over two minutes must keep polling');
  assert.equal(normal.clock(), 39 * 4000);
  assert.equal(normal.controller.state.pending, null);
  assert.equal(normal.writes(), 0);
  assert.ok(normal.notices.some(message => message.includes('出品51件') && message.includes('4件のチェック')));
  assert.match(normal.controller.state.message, /10件/);

  const hidden = fixture({ hideAfter: 2 }); await hidden.controller.resume();
  assert.equal(hidden.reads(), 2); assert.equal(hidden.writes(), 0);
  assert.equal(hidden.controller.state.pending.operationId, pending.operationId);

  const bound = fixture(); await bound.controller.resume();
  assert.equal(bound.reads(), 150); assert.equal(bound.waits.length, 149); assert.ok(bound.clock() < 600000);
  assert.match(bound.controller.state.message, /まだ確認できません/);
  const elapsed = fixture({ requestMs: 20000 }); await elapsed.controller.resume();
  assert.ok(elapsed.reads() < 150); assert.ok(elapsed.clock() <= 630000, 'ten-minute loop deadline plus at most one bounded in-flight request');
  assert.ok(elapsed.controller.state.pending);

  const invalid = fixture({ hideAfter: 1, invalid: true }); await invalid.controller.resume();
  assert.equal(invalid.controller.state.message, '照合中です');
  const failure = fixture({ fail: true }); await failure.controller.resume();
  assert.equal(failure.reads(), 1); assert.equal(failure.writes(), 0); assert.ok(failure.controller.state.pending);
  console.log('PASS inventory progress: running beyond two minutes, valid counts, terminal/hidden/error stops, 150-read and elapsed-time bounds, no POST replay');
})().catch(error => { console.error(error); process.exitCode = 1; });
