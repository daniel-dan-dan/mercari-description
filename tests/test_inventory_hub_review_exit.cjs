'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const uuid = 'inv_550e8400-e29b-41d4-a716-446655440000';
const source = fs.readFileSync('inventory-hub.js', 'utf8');
const item = { inventoryUuid: uuid, asin: 'なし', productName: '赤いリネンシャツ M', sku: 'TEST-1', listingState: 'review', listingChecked: false,
  listingItemId: '', listing: null, holdReason: '', canList: true, candidates: [{ itemId: 'm12345', title: '赤いニット M' }] };
class Element {
  constructor(tag = 'div') { this.tagName = tag.toUpperCase(); this.children = []; this.listeners = {}; this.attrs = {}; this.dataset = {}; this.value = ''; this.hidden = false; this.disabled = false; this._text = ''; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  append(...children) { children.forEach(child => { child.parent = this; this.children.push(child); }); }
  replaceChildren(...children) { this.children = []; this._text = ''; this.append(...children); }
  setAttribute(key, value) { this.attrs[key] = value; }
  addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); }
  async click() { if (this.disabled) return; for (const handler of this.listeners.click || []) await handler({ target: this }); }
  showModal() { this.open = true; }
  close() { this.open = false; for (const handler of this.listeners.close || []) handler(); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  focus() {}
}
function find(root, label) { if (root.tagName === 'BUTTON' && root.textContent === label) return root; for (const child of root.children) { const found = find(child, label); if (found) return found; } }
function fixture(extra = {}) {
  const nodes = new Map(); const body = new Element('body');
  const get = id => { if (!nodes.has(id)) { const element = new Element(); element.id = id; nodes.set(id, element); body.append(element); } return nodes.get(id); };
  const filters = ['unlisted', 'listed', 'review'].map(state => { const node = new Element('button'); node.dataset.inventoryHubFilter = state; return node; });
  const doc = { body, visibilityState: 'visible', createElement: tag => new Element(tag), getElementById: get,
    querySelector: selector => filters.find(node => selector.includes(`"${node.dataset.inventoryHubFilter}"`)), querySelectorAll: () => filters };
  const context = vm.createContext({ console, URL, __MERCARI_TEST__: true, setTimeout, clearTimeout }); vm.runInContext(source, context);
  const h = context.MercariInventoryHub; const calls = []; const starts = []; const row = structuredClone({ ...item, ...extra });
  const currentInput = { title: '入力中の商品', photo: 'original-photo' }; const initialInput = JSON.stringify(currentInput);
  let screen = 'main-screen';
  const controller = h.mount({ document: doc, window: { scrollY: 120, scrollTo() {} }, storage: { getItem: () => null },
    operationId: () => 'unused-operation', ready: () => true, locked: () => false, hasInput: () => true, selectedUuid: () => '',
    showScreen: id => { screen = id; get('inventory-hub-screen').hidden = id !== 'inventory-hub-screen'; },
    request: async (path, options = {}) => { calls.push({ path, options }); assert.notEqual(options.method, 'POST'); return { ok: true, items: [structuredClone(row)], inventoryComplete: true, schemaReady: true }; },
    startListing: async (fresh, options) => { starts.push({ fresh, options }); },
  });
  return { h, doc, get, body, filters, controller, calls, starts, row, currentInput, initialInput, screen: () => screen,
    dialog: () => body.children.find(node => node.tagName === 'DIALOG') };
}
(async () => {
  const a = fixture(); await a.get('inventory-hub-open').click(); await a.filters[2].click();
  const start = find(a.get('inventory-hub-list'), '候補にない商品を出品する'); assert.ok(start);
  await start.click(); assert.ok(a.dialog()); assert.match(a.dialog().textContent, /表示された候補とは別の商品として、出品の準備を始めます。/);
  assert.match(a.dialog().textContent, /入力中.*一時保存/); assert.equal(a.starts.length, 0); assert.equal(a.calls.length, 1);
  await find(a.dialog(), 'キャンセル').click(); assert.equal(a.dialog(), undefined); assert.equal(a.starts.length, 0);
  assert.equal(JSON.stringify(a.currentInput), a.initialInput); assert.equal(a.row.listingChecked, false);
  await start.click(); await find(a.dialog(), '保存して出品準備へ').click();
  assert.equal(a.starts.length, 1); assert.equal(a.starts[0].fresh.inventoryUuid, uuid);
  assert.equal(a.starts[0].options.saveCurrent, true); assert.equal(a.starts[0].options.differentProductConfirmed, true);
  assert.equal(a.screen(), 'main-screen'); assert.equal(a.calls.length, 2); assert.ok(a.calls.every(call => !call.options.method));
  assert.equal(a.row.listingChecked, false); assert.equal(a.row.candidates.length, 1, 'starting preparation does not reject/mutate suggestions');

  const changed = fixture(); await changed.get('inventory-hub-open').click(); await changed.filters[2].click();
  await find(changed.get('inventory-hub-list'), '候補にない商品を出品する').click(); changed.row.candidates[0].title = '新しい候補';
  await find(changed.dialog(), '保存して出品準備へ').click(); assert.equal(changed.starts.length, 0); assert.match(changed.dialog().textContent, /候補が変わりました/);

  for (const extra of [{ listingChecked: true }, { listingItemId: 'm999' }, { listing: { itemId: 'm999' } }, { holdReason: '書込み未確認' }, { canList: false }, { candidates: [] }]) {
    const blocked = fixture(extra); await blocked.get('inventory-hub-open').click(); await blocked.filters[2].click();
    assert.equal(find(blocked.get('inventory-hub-list'), '候補にない商品を出品する'), undefined);
    assert.equal(blocked.starts.length, 0);
  }
  console.log('PASS review exit UI: explicit confirmation, cancel preserves input, save intent, GET-only prefill, unchanged candidates/checks, stale candidate guard and mapped/held exclusions');
})().catch(error => { console.error(error); process.exitCode = 1; });
