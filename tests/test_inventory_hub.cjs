'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const source = fs.readFileSync('inventory-hub.js', 'utf8');
const context = vm.createContext({ console, URL, __MERCARI_TEST__: true, setTimeout, clearTimeout });
vm.runInContext(source, context);
const h = context.MercariInventoryHub;
const uuid = 'inv_550e8400-e29b-41d4-a716-446655440000';
const item = { inventoryUuid: uuid, asin: 'なし', productName: 'ネイビー ダウン M', sku: 'A-001', listingState: 'unlisted', canList: true };
const hub = () => ({ ok: true, items: [item], inventoryComplete: true, schemaReady: true });
const clone = x => JSON.parse(JSON.stringify(x));
function fixture(handler, initial = null) {
  const values = new Map(initial ? [[h.OPERATION_KEY, JSON.stringify(initial)]] : []);
  const calls = [];
  const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const controller = h.createController({ storage, operationId: () => 'inventory-hub-fixture-001', wait: async () => {},
    request: async (path, options = {}) => { calls.push({ path, options }); return handler(path, options); } });
  return { controller, calls, storage, values };
}
(async () => {
  const normalized = h.normalizeHub({ ...hub(), items: [item, item, { ...item, inventoryUuid: 'bad' },
    { ...item, inventoryUuid: 'inv_550e8400-e29b-41d4-a716-446655440001', asin: 'B00000' },
    { inventoryUuid: '', itemKey: 'held:fixture:1', asin: 'なし', productName: '要確認', holdReason: '管理情報未確認', listingState: 'unlisted', canList: true,
      candidates: [{ itemId: 'm123' }] }] });
  assert.equal(normalized.items.length, 2);
  assert.deepEqual(clone(normalized.counts), { unlisted: 1, listed: 0, review: 1 });
  assert.equal(normalized.items[1].canList, false); assert.equal(normalized.items[1].candidates.length, 0);
  assert.equal(h.normalizeHub({ ...hub(), inventoryComplete: false }).items[0].canList, false);
  assert.equal(h.filterItems(normalized.items, 'unlisted', 'ａ-001').length, 1);
  assert.equal(h.safeListingUrl({ itemId: 'm1234', url: 'javascript:alert(1)' }), 'https://jp.mercari.com/item/m1234');
  assert.equal(h.safeListingUrl({ itemId: '../bad', url: 'https://evil.invalid' }), '');
  assert.throws(() => h.normalizeHub({ ok: false }), /取得/);

  // An accepted write whose response is lost is recovered only with GET.
  let op;
  const lost = fixture(async (path, options) => {
    if (options.method === 'POST') { op = options.body.operationId; throw Error('lost'); }
    if (path.includes('/result')) return { ok: true, operationId: op, status: 'done', summary: { updated: 1 } };
    return hub();
  });
  await lost.controller.start('reconcile');
  assert.equal(lost.calls.filter(c => c.options.method === 'POST').length, 1);
  assert.equal(lost.calls.filter(c => c.path.includes('/result')).length, 1);
  assert.equal(lost.controller.state.pending, null);
  assert.equal(lost.values.has(h.OPERATION_KEY), false);
  assert.match(lost.controller.state.message, /1件/);

  // Unknown identity is retained across reload; a second write cannot begin.
  const pending = { operationId: 'inventory-hub-fixture-old', kind: 'reconcile' };
  const resumed = fixture(async path => path.includes('/result') ? { ok: true, operationId: pending.operationId, status: 'needs_review' } : hub(), pending);
  await resumed.controller.resume();
  assert.equal(await resumed.controller.start('reconcile'), false);
  assert.equal(resumed.calls.some(call => call.options.method === 'POST'), false);
  assert.equal(resumed.controller.state.pending.operationId, pending.operationId);

  // Confirmation is not successful without exact item identity and readback.
  const confirmOp = { operationId: 'inventory-hub-confirm-old', kind: 'confirm', inventoryUuid: uuid, itemId: 'm1234' };
  let verified = false;
  const confirm = fixture(async path => path.includes('/result') ? { ok: true, operationId: confirmOp.operationId, status: 'done',
    receipt: { inventoryUuid: uuid, itemId: verified ? 'm1234' : 'm9999', listingChecked: true, readbackVerified: true } } : hub(), confirmOp);
  await confirm.controller.resume();
  assert.ok(confirm.controller.state.pending); assert.equal(confirm.calls.filter(c => c.path.includes('/result')).length, 150);
  verified = true; await confirm.controller.resume(); assert.equal(confirm.controller.state.pending, null);
  assert.match(confirm.controller.state.message, /チェックを確認/);

  // Storage failure stops before POST. Malformed saved identities fail closed.
  let requests = 0;
  const full = h.createController({ storage: { getItem: () => null, setItem: () => { throw Error('quota'); } }, operationId: () => 'inventory-hub-quota',
    request: async () => { requests++; }, wait: async () => {} });
  assert.equal(await full.start('reconcile'), false); assert.equal(requests, 0);
  const broken = h.createController({ storage: { getItem: () => '{bad' }, operationId: () => '', request: async () => { requests++; } });
  assert.equal(broken.state.storageError, true); assert.equal(await broken.start('reconcile'), false); assert.equal(requests, 0);
  const silent = h.createController({ storage: { getItem: () => null, setItem: () => {} }, operationId: () => 'inventory-hub-silent', request: async () => { requests++; } });
  assert.equal(await silent.start('reconcile'), false); assert.equal(requests, 0, 'no POST without storage readback');

  for (const rejected of [{ httpStatus: 401, code: 'UNAUTHORIZED' }, { httpStatus: 429, code: 'RATE_LIMITED' },
    { httpStatus: 400, code: 'INVALID_INVENTORY_REQUEST', requestAccepted: false }]) {
    const known = fixture(async () => ({ ok: false, ...rejected, error: '受付前の拒否' }));
    assert.equal(await known.controller.start('reconcile'), false); assert.equal(known.controller.state.pending, null);
    assert.equal(known.calls.length, 1); assert.match(known.controller.state.message, /受付前の拒否/);
  }
  const notAccepted = fixture(async path => path.includes('/result') ? { ok: false, code: 'OPERATION_NOT_FOUND', requestAccepted: false } : hub(), pending);
  await notAccepted.controller.resume(); assert.equal(notAccepted.controller.state.pending, null); assert.match(notAccepted.controller.state.message, /受け付けられていません/);
  const held = fixture(async path => path.includes('/result') ? { ok: true, operationId: pending.operationId, status: 'needs_review', serverStoredHold: true } : hub(), pending);
  await held.controller.resume(); assert.equal(held.controller.state.pending, null); assert.match(held.controller.state.message, /確認待ち/);

  // While POST is outstanding, double click cannot enqueue a second write.
  let release;
  const double = fixture(async (path, options) => options.method === 'POST' ? new Promise(resolve => { release = resolve; }) : hub());
  const first = double.controller.start('reconcile');
  assert.equal(await double.controller.start('reconcile'), false);
  release({ ok: true, operationId: 'inventory-hub-fixture-001', status: 'done' }); await first;
  assert.equal(double.calls.filter(c => c.options.method === 'POST').length, 1);

  // Failed reads retain the displayed inventory but disable actions as stale.
  let fail = false;
  const stale = fixture(async () => { if (fail) throw Error('offline'); return hub(); });
  await stale.controller.refresh(); fail = true;
  await assert.rejects(stale.controller.refresh(), /offline/);
  assert.equal(stale.controller.state.data.items.length, 1); assert.equal(stale.controller.state.stale, true);

  const html = fs.readFileSync('index.html', 'utf8');
  assert.match(html, /id="reset-btn"[\s\S]*?id="inventory-hub-open"[\s\S]*?id="settings-btn"/);
  for (const [id, icon] of [['reset-btn', 'trash-2'], ['inventory-hub-open', 'package'], ['settings-btn', 'settings']]) {
    const button = html.match(new RegExp('<button[^>]*id="' + id + '"[^>]*>[\\s\\S]*?</button>'))?.[0] || '';
    assert.ok(button.includes('data-lucide="' + icon + '"'), id + ' uses the shared outline icon set');
    assert.ok(button.includes('aria-label='), id + ' keeps its accessible name');
  }
  assert.doesNotMatch(source, /\.innerHTML\s*=/);
  assert.match(fs.readFileSync('sw.js', 'utf8'), /inventory-hub\.js\?v=20261027b/);
  console.log('PASS inventory hub: held rows, filters, safe links, GET-only recovery, reload, exact receipt, no double writes, storage failures and stale reads');
})().catch(error => { console.error(error); process.exitCode = 1; });
