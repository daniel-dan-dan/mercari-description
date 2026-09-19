'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const source = ['catalog-data.js', 'app.js'].map(file => fs.readFileSync(file, 'utf8')).join('\n');
const key = 'mercari_pending_description_operations_v1';
const photo = [{ mediaType: 'image/jpeg', base64: 'fixture-photo' }];
const response = body => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
function app(storage, fetch, approve = false) {
  const ctx = { console, URL, TextEncoder, crypto: webcrypto, Date, __MERCARI_TEST__: true,
    confirm: () => approve, fetchMock: fetch,
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
  };
  ctx.window = ctx; ctx.globalThis = ctx; vm.createContext(ctx);
  vm.runInContext(source + `
    getSelectedProductGender = () => 'men';
    getMercariServiceUrl = async () => 'https://fixture.trycloudflare.com';
    fetchListingStyleFromMac = async () => '';
    buildDescriptionSystemPrompt = () => 'fixture';
    fetchWithTimeout = fetchMock;
    waitForPoll_ = async () => {};
  `, ctx);
  return ctx;
}
(async () => {
  const storage = new Map();
  let originalId;
  const first = app(storage, async (url, options = {}) => {
    if (options.method === 'POST') {
      originalId = options.headers['X-Operation-Id'];
      assert.equal(JSON.parse(storage.get(key))[0].operationId, originalId, 'persist before sending');
      throw Error('Load failed');
    }
    return response({ operationId: originalId, status: 'unknown' });
  });
  await assert.rejects(first.MercariAppTestHooks.callDescriptionAi(photo), e => e.ambiguousDescriptionResult);
  const afterReload = app(storage, async (url, options = {}) => {
    assert.notEqual(options.method, 'POST', 'reload must only retrieve the original result');
    assert.equal(new URL(url).searchParams.get('operationId'), originalId);
    return response({ operationId: originalId, status: 'success', result: { clientRequestId: originalId, text: '{"fixture":"recovered"}' } });
  });
  assert.equal(await afterReload.MercariAppTestHooks.callDescriptionAi(photo), '{"fixture":"recovered"}');
  assert.deepEqual(JSON.parse(storage.get(key)), []);

  // Unknown results stay protected indefinitely, including after expiry/restart.
  await assert.rejects(first.MercariAppTestHooks.callDescriptionAi(photo), e => e.ambiguousDescriptionResult);
  const idBeforeApproval = originalId;
  let posts = 0;
  const approved = app(storage, async (url, options = {}) => {
    if (options.method === 'POST') {
      posts++;
      assert.notEqual(options.headers['X-Operation-Id'], idBeforeApproval);
      return response({ text: '{"fixture":"new"}' });
    }
    return response({ operationId: idBeforeApproval, status: 'unknown' });
  }, true);
  assert.equal(await approved.MercariAppTestHooks.callDescriptionAi(photo), '{"fixture":"new"}');
  assert.equal(posts, 1, 'new generation needs an explicit choice after an unknown result');

  for (const saved of ['broken-json', '[{}]']) {
    const ctx = app(new Map([[key, saved]]), () => { throw Error('must not send'); });
    await assert.rejects(ctx.MercariAppTestHooks.callDescriptionAi(photo), /受付記録/);
  }
  const blocked = app(new Map(), () => { throw Error('must not send'); });
  blocked.localStorage.setItem = () => { throw Error('QuotaExceededError'); };
  await assert.rejects(blocked.MercariAppTestHooks.callDescriptionAi(photo), /端末に保存できない/);
  const locked = app(new Map(), () => { throw Error('must not send'); });
  locked.navigator = { locks: { request: async (_, options, work) => { assert.equal(options.ifAvailable, true); return work(null); } } };
  await assert.rejects(locked.MercariAppTestHooks.callDescriptionAi(photo), /別の画面/);
  assert.doesNotMatch(source, /紺色の方がクリック率|迷ったら「黒っぽい」/);
  console.log('PASS persistent generation receipts: reload, unknown, explicit retry, corrupt/full storage and cross-tab lock');
})().catch(error => { console.error(error); process.exitCode = 1; });
