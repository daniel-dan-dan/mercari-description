#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

function createHarness(initial, fetchImpl) {
  const storage = new Map(Object.entries(initial || {}));
  const context = {
    console,
    URL,
    Headers,
    Response,
    AbortController,
    Uint8Array,
    crypto: webcrypto,
    location: { href: 'https://daniel-dan-dan.github.io/mercari-description/' },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key),
    },
    fetch: fetchImpl,
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    setTimeout,
    clearTimeout,
    globalThis: null,
    window: null,
  };
  context.globalThis = context;
  context.window = context;
  context.__MERCARI_TEST__ = true;
  vm.createContext(context);
  vm.runInContext([
    fs.readFileSync('catalog-data.js', 'utf8'),
    fs.readFileSync('app.js', 'utf8'),
  ].join('\n'), context, { filename: 'app.js' });
  return { hooks: context.MercariAppTestHooks, storage };
}

const pairing = 'pair_' + 'p'.repeat(40);
let successfulCalls = 0;
const successfulHarness = createHarness({
  daniel_api_auth_token: pairing,
  daniel_route_device_auth_v1: 'route_dev_' + 'r'.repeat(40),
}, async (url, options) => {
  successfulCalls += 1;
  const body = JSON.parse(options.body);
  if (String(url).includes('script.google.com')) {
    assert.equal(body.action, 'registerMercariDevice');
    assert.equal(body.auth_token, pairing);
    return new Response(JSON.stringify({
      success: true,
      data: {
        registered: true,
        device_id: body.device_id,
        url: 'https://safe-device.trycloudflare.com',
      },
    }), { status: 200 });
  }
  assert.equal(new Headers(options.headers).get('Authorization'), `Bearer ${pairing}`);
  return new Response(JSON.stringify({
    ok: true,
    registered: true,
    device_id: body.device_id,
  }), { status: 200 });
});

(async () => {
  assert.equal(await successfulHarness.hooks.ensureMercariDeviceCredential_(), true);
  assert.equal(successfulCalls, 2);
  assert.ok(successfulHarness.storage.get('mercari_device_auth_v1'));
  assert.ok(successfulHarness.storage.get('mercari_device_id_v1'));
  assert.equal(successfulHarness.storage.has('mercari_api_auth_token'), false);
  assert.equal(successfulHarness.storage.has('daniel_api_auth_token'), false);
  assert.equal(successfulHarness.storage.has('mercari_pending_device_auth_v1'), false);
  assert.equal(await successfulHarness.hooks.ensureMercariDeviceCredential_(), true);
  assert.equal(successfulCalls, 2, '端末鍵がある起動では再登録しません');

  const priorToken = 'dev_' + 'o'.repeat(60);
  const priorId = 'mercari_existing_device_01';
  let stage = 'fail-mac';
  const candidates = [];
  const retryHarness = createHarness({
    mercari_device_auth_v1: priorToken,
    mercari_device_id_v1: priorId,
    mercari_api_auth_token: pairing,
  }, async (url, options) => {
    const body = JSON.parse(options.body);
    candidates.push({ url: String(url), id: body.device_id, token: body.device_token });
    if (String(url).includes('script.google.com')) {
      return new Response(JSON.stringify({
        success: true,
        data: {
          registered: true,
          device_id: body.device_id,
          url: 'https://safe-device.trycloudflare.com',
        },
      }), { status: 200 });
    }
    if (stage === 'fail-mac') throw new TypeError('Failed to fetch');
    return new Response(JSON.stringify({
      ok: true,
      registered: true,
      device_id: body.device_id,
    }), { status: 200 });
  });

  await assert.rejects(
    retryHarness.hooks.pairMercariDevice_(pairing),
    /Failed to fetch/,
  );
  assert.equal(retryHarness.hooks.getApiAuthToken(), priorToken);
  assert.equal(retryHarness.storage.get('mercari_device_id_v1'), priorId);
  const pendingToken = retryHarness.storage.get('mercari_pending_device_auth_v1');
  const pendingId = retryHarness.storage.get('mercari_pending_device_id_v1');
  assert.ok(pendingToken);
  assert.equal(pendingId, priorId);

  stage = 'success';
  await retryHarness.hooks.pairMercariDevice_(pairing);
  const retryCandidates = candidates.slice(-2);
  assert.equal(retryCandidates[0].id, pendingId);
  assert.equal(retryCandidates[0].token, pendingToken);
  assert.equal(retryCandidates[1].id, pendingId);
  assert.equal(retryCandidates[1].token, pendingToken);
  assert.equal(retryHarness.hooks.getApiAuthToken(), pendingToken);

  [
    'https://evil.example.com',
    'https://trycloudflare.com.evil.example',
    'https://trycloudflare.com',
    'https://safe.trycloudflare.com/path',
    'https://safe.trycloudflare.com?token=x',
  ].forEach(url => assert.equal(retryHarness.hooks.normalizeMacServiceUrl_(url), ''));
  assert.equal(
    retryHarness.hooks.normalizeMacServiceUrl_('https://safe.trycloudflare.com/'),
    'https://safe.trycloudflare.com',
  );

  const source = fs.readFileSync('app.js', 'utf8');
  assert.match(source, /await registerMercariDeviceWithGas_[\s\S]*await registerMercariDeviceWithMac_/);
  assert.ok(
    source.indexOf('await registerMercariDeviceWithMac_')
      < source.indexOf('localStorage.setItem(MERCARI_DEVICE_ID_KEY'),
    '両サーバー成功前にcurrent credentialを切り替えてはいけません',
  );
  const pairHtml = fs.readFileSync('pair.html', 'utf8');
  assert.match(pairHtml, /history\.replaceState[\s\S]*const attempt = async/);
  assert.match(pairHtml, /id="pair-retry"/);
  assert.match(pairHtml, /new AbortController\(\)/);
  assert.match(pairHtml, /timeoutMs = 15000/);

  console.log(JSON.stringify({
    ok: true,
    initialMigrationCalls: successfulCalls,
    twoServerRetry: true,
    existingTokenPreserved: true,
    strictMacUrl: true,
    version: 'v20260814a',
  }));
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
