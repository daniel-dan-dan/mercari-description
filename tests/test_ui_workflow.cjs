'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const nodes = new Map();
function node(id, props = {}) {
  const classes = new Set();
  const result = { id, hidden: false, disabled: false, value: '', dataset: {}, attrs: {}, innerHTML: '', textContent: '',
    classList: { toggle: (k, v) => v ? classes.add(k) : classes.delete(k), contains: k => classes.has(k) },
    setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; },
    querySelector: () => null, matches: () => false,
    focus() { document.activeElement = this; this.focused = true; },
    scrollIntoView() { this.scrolled = true; }, ...props };
  nodes.set(id, result); return result;
}
const progress = [node('p1'), node('p2'), node('p3')];
const document = { getElementById: id => nodes.get(id) || null,
  querySelectorAll: selector => selector === '#listing-progress button' ? progress : [], querySelector: () => null };
const ctx = { console, URL, setTimeout, clearTimeout, document, __MERCARI_TEST__: true,
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } };
ctx.window = ctx; ctx.globalThis = ctx; ctx.matchMedia = () => ({ matches: false });
vm.createContext(ctx);
vm.runInContext(['catalog-data.js', 'app.js'].map(f => fs.readFileSync(f, 'utf8')).join('\n'), ctx);
const hooks = ctx.MercariAppTestHooks;
const missing = [{ ok: false, label: '価格を入力', shortLabel: '価格', target: 'price-input' },
  { ok: false, label: 'サイズを確認', shortLabel: 'サイズ', target: 'm-size' },
  { ok: true, label: '写真1枚' }, { ok: true, kind: 'neutral', label: '在庫選択は任意' }];
assert.equal(hooks.draftMissingSummary_(missing), 'あと2項目：価格・サイズ');
const markup = hooks.renderDraftChecklist_(missing);
assert.match(markup, /data-listing-target="price-input"/);
assert.match(markup, /data-listing-target="m-size"/);
assert.ok(markup.indexOf('価格を入力') < markup.indexOf('<details'));
assert.ok(markup.indexOf('写真1枚') > markup.indexOf('<details'));
assert.match(markup, /入力済み・任意項目（2件）/);
assert.doesNotMatch(markup, /<details[^>]*\bopen\b/);
assert.match(hooks.renderDraftChecklist_(missing, true), /<details[^>]*\bopen\b/);
assert.doesNotMatch(hooks.renderDraftChecklist_([{ ok: false, label: '<img src=x>', target: 'price-input' }]), /<img/);

for (const id of ['listing-action-bar', 'main-screen', 'description-panel', 'result-section', 'generate-btn', 'draft-btn', 'generate-note', 'listing-missing-link', 'listing-action-hint']) node(id);
vm.runInContext('lastAiData = null; updateListingWorkflow_()', ctx);
assert.equal(nodes.get('generate-btn').hidden, false); assert.equal(nodes.get('draft-btn').hidden, true);
assert.equal(progress[0].attrs['aria-current'], 'step');
ctx.testItems = missing;
vm.runInContext('lastAiData = {}; listingValidation = { ok: false, items: testItems }; updateListingWorkflow_()', ctx);
assert.equal(nodes.get('generate-btn').hidden, true); assert.equal(nodes.get('draft-btn').hidden, false);
assert.equal(nodes.get('listing-missing-link').dataset.listingTarget, 'price-input');
assert.equal(progress[1].attrs['aria-current'], 'step');
vm.runInContext('listingValidation = { ok: true, items: [] }; updateListingWorkflow_()', ctx);
assert.equal(progress[2].attrs['aria-current'], 'step');
assert.doesNotMatch(nodes.get('listing-action-hint').textContent, /保存済み|保存が完了/);
vm.runInContext('descriptionGenerationInProgress = true; updateListingWorkflow_()', ctx);
assert.equal(nodes.get('draft-btn').hidden, true); assert.equal(nodes.get('draft-btn').disabled, true);
assert.ok(progress.every(n => n.disabled));
vm.runInContext('descriptionGenerationInProgress = false; draftSaveInProgress = true; updateListingWorkflow_()', ctx);
assert.equal(nodes.get('draft-btn').disabled, true); assert.match(nodes.get('draft-btn').textContent, /保存中/);
vm.runInContext('draftSaveInProgress = false', ctx);
nodes.get('description-panel').hidden = true; hooks.updateListingWorkflow_();
assert.equal(nodes.get('listing-action-bar').hidden, true);
nodes.get('description-panel').hidden = false;

const outer = node('outer', { tagName: 'DETAILS', open: false });
const inner = node('inner', { tagName: 'DETAILS', open: false, parentElement: outer });
const field = node('price-input', { tagName: 'INPUT', parentElement: inner, matches: () => true });
assert.equal(hooks.focusListingTarget_('price-input'), true);
assert.equal(outer.open, true); assert.equal(inner.open, true); assert.equal(field.focused, true); assert.equal(field.scrolled, true);
assert.equal(hooks.focusListingTarget_('missing-field'), false);
ctx.matchMedia = () => ({ matches: true }); hooks.updateListingKeyboard_();
assert.equal(nodes.get('listing-action-bar').classList.contains('keyboard-open'), true);
document.activeElement = null; hooks.updateListingKeyboard_();
assert.equal(nodes.get('listing-action-bar').classList.contains('keyboard-open'), false);

ctx.rows = [
  { itemId: 'm1', currentPrice: 24800, minPrice: 23000, autoEnabled: false, recommendation: { type: 'largeMarkdown', suggestedPrice: 21300, warnings: [] } },
  { itemId: 'm2', currentPrice: 5000, minPrice: 3500, autoEnabled: true, recommendation: { type: 'markdown100', suggestedPrice: 4900 } },
  { itemId: 'm3', recommendation: { type: 'keep' } }, { itemId: 'm4', recommendation: { type: 'reviewListing' } },
  { itemId: 'm5' },
];
for (const [filter, ids] of [['largeMarkdown', ['m1']], ['markdown100', ['m2']], ['wait', ['m3', 'm5']], ['reviewListing', ['m4']]]) {
  const found = vm.runInContext(`markdownRecommendationFilter = '${filter}'; filteredMarkdownRows(rows).map(r => r.itemId)`, ctx);
  assert.deepEqual([...found], ids);
}
assert.deepEqual([...vm.runInContext("markdownRecommendationFilter = 'markdown100'; markdownFilterMode = 'disabled-only'; filteredMarkdownRows(rows)", ctx)], []);
const card = hooks.renderMarkdownCard(ctx.rows[0]);
assert.match(card, /要確認：下限を1,700円下回る案/);
assert.ok(card.indexOf('要確認') < card.indexOf('<details'));
assert.match(card, /<details class="markdown-history-details">/);
const changedFloor = { ...ctx.rows[0], minPrice: 21000 };
assert.doesNotMatch(hooks.renderMarkdownCard(changedFloor), /markdown-floor-alert/);
const equalFloor = { ...ctx.rows[0], minPrice: 21300 };
assert.doesNotMatch(hooks.renderMarkdownCard(equalFloor), /markdown-floor-alert/);
assert.equal(ctx.rows[0].recommendation.suggestedPrice, 21300);
assert.equal(ctx.rows[0].autoEnabled, false);
// The visible fixed status always wins over a generic ready-to-save hint.
node('draft-status', { hidden: false, textContent: '下書き保存が完了しました。' });
vm.runInContext('listingValidation = { ok: true, items: [] }; updateListingWorkflow_()', ctx);
assert.equal(nodes.get('listing-action-hint').hidden, true);

// Validate actual field boundaries and photo counts, with ancillary inventory/freshness
// lookups isolated (their safety contracts have separate regression suites).
for (const [id, value] of [['title-text', 'サンプル'], ['result-text', 'サンプルの説明'], ['m-condition', '目立った傷や汚れなし'], ['m-category', 'men_shirt'], ['m-brand', ''], ['m-size', '']]) node(id, { value });
node('draft-checklist'); node('mercari-settings');
vm.runInContext(`
  updateInventoryLinkNote_ = () => ({ empty: true, valid: true });
  isGeneratedResultCurrent_ = () => true;
  missingTitleWordsInDescription_ = () => [];
  uploadedImages = [{}];
`, ctx);
nodes.get('price-input').value = '';
let validation = vm.runInContext('updateDraftChecklist()', ctx);
assert.deepEqual([...validation.items.filter(i => !i.ok).map(i => i.shortLabel)], ['価格', 'サイズ']);
nodes.get('m-size').value = 'M';
for (const price of ['299', '300.5', '10000000']) {
  nodes.get('price-input').value = price;
  assert.equal(vm.runInContext('updateDraftChecklist().ok', ctx), false);
}
for (const price of ['300', '9999999']) {
  nodes.get('price-input').value = price;
  assert.equal(vm.runInContext('updateDraftChecklist().ok', ctx), true);
}
vm.runInContext('uploadedImages = Array.from({ length: 21 }, () => ({}))', ctx);
validation = vm.runInContext('updateDraftChecklist()', ctx);
assert.equal(validation.ok, false);
assert.equal(validation.items.find(i => !i.ok).target, 'photo-preview');

const html = fs.readFileSync('index.html', 'utf8');
assert.equal((html.match(/id="draft-btn"/g) || []).length, 1);
assert.equal((html.match(/id="generate-btn"/g) || []).length, 1);
assert.match(html, /id="listing-action-bar"[\s\S]*id="draft-status"[\s\S]*id="draft-btn"/);
assert.match(html, /<details class="listing-style-box">/);
assert.doesNotMatch(html, /__fixture|fixture-init/);
assert.match(fs.readFileSync('.gitignore', 'utf8'), /^tests\/ui\/$/m);
console.log('PASS UI workflow: missing fields, details, focused navigation, generation/draft locks, keyboard, recommendation filters and floor warnings');
