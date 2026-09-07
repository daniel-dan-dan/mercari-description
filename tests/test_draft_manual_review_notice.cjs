'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const warning = '【要確認】ブランドは自動選択できなかったため、出品前にメルカリの下書きで手動確認・修正してください。';
const receiptKey = 'mercari_pending_draft_operation';
const source = ['catalog-data.js', 'app.js'].map(file => fs.readFileSync(file, 'utf8')).join('\n');

function harness({ route, linked, manualReviewFields = ['brand'], manualCategory = false, needsReview = false }) {
  const nodes = new Map();
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, { value: '', hidden: false, disabled: false, dataset: {}, textContent: '',
      classList: { toggle() {}, remove() {}, add() {} }, setAttribute() {}, removeAttribute() {}, scrollTo() {} });
    return nodes.get(id);
  };
  const storage = new Map([['gasUrl', 'fixture-official-url']]);
  const calls = [];
  let operationId = '';
  const ctx = { console: { ...console, error() {} }, URL, TextEncoder, crypto: webcrypto, __MERCARI_TEST__: true,
    setTimeout, clearTimeout, alert: message => { throw Error(message); }, confirm: () => true,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    document: { getElementById: get, querySelector: () => null, querySelectorAll: () => [] },
    mockFetch: async (url, options = {}) => {
      const method = options.method || 'GET';
      calls.push(method);
      if (method === 'POST') operationId = options.headers['X-Operation-Id'];
      else operationId = new URL(url).searchParams.get('operationId');
      assert.ok(operationId, 'the receipt must be present on every request');
      const data = method === 'POST' && route === 'normal'
        ? { ok: true, operationId, status: 'pending', job_id: 'manual-review-fixture' }
        : { ok: true, operationId, status: needsReview ? 'needs_review' : 'done', manualReviewFields,
          message: '下書き保存完了。' + warning, inventoryLink: { status: linked ? 'pending_listing' : 'unlinked' } };
      return { ok: true, status: 200, text: async () => JSON.stringify(data) };
    },
  };
  ctx.window = ctx; ctx.globalThis = ctx; vm.createContext(ctx);
  vm.runInContext(source, ctx);
  vm.runInContext(`
    isGeneratedResultCurrent_ = () => true;
    syncDescriptionProductNameFromTitle_ = () => {};
    updateDraftChecklist = () => ({ ok: true, items: [] });
    getInventoryReferenceState_ = () => ({ uuid: el('inventory-uuid-input').value });
    updateTemporarySaveButton_ = () => {};
    updateGenerateButton = () => {};
    attachJobWaitCancel_ = () => ({ cleanup() {} });
    getMercariServiceUrl = async () => 'https://fixture.trycloudflare.com';
    fetchWithTimeout = mockFetch;
    lastAiData = { title: 'fixture product', description: 'fixture description', category: 'tops', product_id: 'fixture-product' };
    uploadedImages = [{ base64: 'AAAA', mediaType: 'image/png' }];
  `, ctx);
  Object.entries({ 'title-text': 'fixture product', 'result-text': 'fixture description', 'price-input': '2400',
    'category': 'tops', 'm-category': 'men_shirt', 'm-brand': 'requested brand', 'm-condition': '目立った傷や汚れなし', 'm-size': 'M',
    'inventory-uuid-input': linked ? 'inv_00000000-0000-4000-8000-000000000001' : '',
  }).forEach(([id, value]) => { get(id).value = value; });
  if (manualCategory) vm.runInContext("getMercariCategoryOption = () => ({ label: 'manual', path: [] });", ctx);
  if (route === 'resume') {
    vm.runInContext(`
      const createFixtureOperation = getOrCreateDraftOperation_;
      getOrCreateDraftOperation_ = payload => {
        createFixtureOperation(payload);
        return createFixtureOperation(payload);
      };
    `, ctx);
  }
  return { ctx, get, storage, calls };
}

(async () => {
  for (const route of ['normal', 'post_done', 'resume']) {
    for (const linked of [false, true]) {
      const { ctx, get, storage, calls } = harness({ route, linked });
      await ctx.MercariAppTestHooks.saveDraft();
      const finalText = get('draft-status').textContent;
      assert.match(finalText, /下書き保存が完了しました/);
      assert.ok(finalText.includes(warning), `${route} must retain the brand warning after completion`);
      assert.equal(finalText.split(warning).length, 2, 'show the warning once');
      assert.doesNotMatch(finalText, /ブランドは未選択|ブランドは空欄/);
      assert.match(finalText, linked ? /出品確定後.*在庫連携を確認/ : /在庫未選択のため自動連携対象外/);
      assert.equal(get('draft-status').hidden, false);
      assert.equal(get('m-brand').value, 'requested brand', 'never alter the user input');
      assert.equal(storage.has(receiptKey), false, 'verified done still clears only the completed receipt');
      assert.deepEqual(calls, route === 'normal' ? ['POST', 'GET'] : route === 'resume' ? ['GET'] : ['POST']);
      ctx.MercariAppTestHooks.updateListingWorkflow_();
      assert.ok(get('draft-status').textContent.includes(warning));
    }
  }
  for (const manualReviewFields of [undefined, null, [], ['size'], 'brand', ['Brand']]) {
    const fields = manualReviewFields === undefined ? [] : manualReviewFields;
    const { ctx, get } = harness({ route: 'post_done', linked: false, manualReviewFields: fields });
    await ctx.MercariAppTestHooks.saveDraft();
    assert.ok(!get('draft-status').textContent.includes(warning), 'only the exact structured brand flag adds a brand warning');
  }
  {
    const { ctx, get } = harness({ route: 'normal', linked: false, manualCategory: true });
    await ctx.MercariAppTestHooks.saveDraft();
    assert.match(get('draft-status').textContent, /カテゴリ・ブランド・必要なサイズは/);
    assert.ok(get('draft-status').textContent.includes(warning));
  }
  {
    const { ctx, get, storage, calls } = harness({ route: 'resume', linked: false, needsReview: true });
    await ctx.MercariAppTestHooks.saveDraft();
    assert.match(get('draft-status').textContent, /^❌/);
    assert.doesNotMatch(get('draft-status').textContent, /下書き保存が完了しました/);
    assert.equal(storage.has(receiptKey), true, 'an unknown save outcome must keep the receipt');
    assert.deepEqual(calls, ['GET'], 'a brand warning must not bypass duplicate protection');
  }
  console.log('PASS manual brand review notice: normal/replay/resume done, linked/unlinked instructions, exact flag, no input mutation and duplicate protection');
})().catch(error => { console.error(error); process.exitCode = 1; });
