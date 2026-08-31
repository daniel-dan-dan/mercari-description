#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createHash, webcrypto } = require('node:crypto');

const fingerprint = token => createHash('sha256').update(String(token)).digest('hex').slice(0, 12);

function createHarness(initial, fetchImpl, consoleImpl = console) {
  const storage = new Map(Object.entries(initial || {}));
  const context = {
    console: consoleImpl,
    URL,
    Headers,
    Response,
    AbortController,
    TextEncoder,
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
  const body = options.body ? JSON.parse(options.body) : {};
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
  const headers = new Headers(options.headers);
  const operationId = headers.get('X-Operation-Id');
  if (String(url).endsWith('/auth/register-device')) {
    assert.equal(headers.get('Authorization'), `Bearer ${pairing}`);
    return new Response(JSON.stringify({
      ok: true,
      registered: true,
      device_id: body.device_id,
      fingerprint: fingerprint(body.device_token),
      auditRecorded: true,
      operationId,
    }), { status: 200 });
  }
  assert.ok(String(url).endsWith('/auth/devices'));
  const savedId = successfulHarness.storage.get('mercari_pending_device_id_v1');
  const savedToken = successfulHarness.storage.get('mercari_pending_device_auth_v1');
  assert.equal(headers.get('Authorization'), `Bearer ${savedToken}`);
  return new Response(JSON.stringify({
    ok: true,
    devices: [{
      device_id: savedId,
      fingerprint: fingerprint(savedToken),
      previousCredentialActive: false,
    }],
    auditRecorded: true,
    operationId,
  }), { status: 200 });
});

(async () => {
  assert.equal(await successfulHarness.hooks.ensureMercariDeviceCredential_(), true);
  assert.equal(successfulCalls, 3);
  assert.ok(successfulHarness.storage.get('mercari_device_auth_v1'));
  assert.ok(successfulHarness.storage.get('mercari_device_id_v1'));
  assert.equal(successfulHarness.storage.has('mercari_api_auth_token'), false);
  assert.equal(successfulHarness.storage.has('daniel_api_auth_token'), false);
  assert.equal(successfulHarness.storage.has('mercari_pending_device_auth_v1'), false);
  assert.equal(await successfulHarness.hooks.ensureMercariDeviceCredential_(), true);
  assert.equal(successfulCalls, 3, '端末鍵がある起動では再登録しません');

  const priorToken = 'dev_' + 'o'.repeat(60);
  const priorId = 'mercari_existing_device_01';
  let stage = 'fail-mac';
  const candidates = [];
  const retryHarness = createHarness({
    mercari_device_auth_v1: priorToken,
    mercari_device_id_v1: priorId,
    mercari_api_auth_token: pairing,
  }, async (url, options) => {
    const body = options.body ? JSON.parse(options.body) : {};
    const headers = new Headers(options.headers);
    const operationId = headers.get('X-Operation-Id');
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
    if (String(url).endsWith('/auth/register-device')) {
      if (stage === 'fail-mac') throw new TypeError('Failed to fetch');
      return new Response(JSON.stringify({
        ok: true,
        registered: true,
        device_id: body.device_id,
        fingerprint: fingerprint(body.device_token),
        auditRecorded: true,
        operationId,
      }), { status: 200 });
    }
    if (String(url).endsWith('/auth/devices')) {
      return new Response(JSON.stringify({
        ok: true,
        devices: [{
          device_id: pendingId,
          fingerprint: fingerprint(pendingToken),
          previousCredentialActive: false,
        }],
        auditRecorded: true,
        operationId,
      }), { status: 200 });
    }
    assert.ok(String(url).endsWith('/auth/revoke-device'));
    assert.equal(body.device_id, priorId);
    assert.equal(headers.get('Authorization'), `Bearer ${pendingToken}`);
    return new Response(JSON.stringify({
      ok: true,
      revoked: true,
      device_id: priorId,
      remaining: 1,
      auditRecorded: true,
      operationId,
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
  assert.notEqual(pendingId, priorId, '再接続時は新しい端末IDと鍵を作ります');

  stage = 'success';
  await retryHarness.hooks.pairMercariDevice_(pairing);
  const retryCandidates = candidates.filter(call => (
    call.url.includes('script.google.com') || call.url.endsWith('/auth/register-device')
  )).slice(-2);
  assert.equal(retryCandidates[0].id, pendingId);
  assert.equal(retryCandidates[0].token, pendingToken);
  assert.equal(retryCandidates[1].id, pendingId);
  assert.equal(retryCandidates[1].token, pendingToken);
  assert.equal(retryHarness.hooks.getApiAuthToken(), pendingToken);
  assert.equal(retryHarness.storage.has('mercari_pending_device_auth_v1'), false);
  assert.equal(retryHarness.storage.has('mercari_pending_revoke_device_ids_v1'), false);
  assert.ok(candidates.some(call => call.url.endsWith('/auth/revoke-device')));

  const staleId = 'mercari_stale_device_01';
  const currentId = 'mercari_current_device_01';
  const currentToken = 'dev_' + 'c'.repeat(60);
  let staleStillRegistered = true;
  const revokeRetryHarness = createHarness({
    mercari_device_auth_v1: currentToken,
    mercari_device_id_v1: currentId,
    mercari_pending_revoke_device_ids_v1: JSON.stringify([staleId]),
  }, async (url, options) => {
    const headers = new Headers(options.headers);
    const operationId = headers.get('X-Operation-Id');
    if (String(url).endsWith('/auth/devices')) {
      assert.equal(headers.get('Authorization'), `Bearer ${currentToken}`);
      return new Response(JSON.stringify({
        ok: true,
        devices: staleStillRegistered ? [{ device_id: staleId, fingerprint: 'unused' }] : [],
        auditRecorded: true,
        operationId,
      }), { status: 200 });
    }
    assert.ok(String(url).endsWith('/auth/revoke-device'));
    const body = JSON.parse(options.body);
    assert.equal(body.device_id, staleId);
    assert.equal(headers.get('Authorization'), `Bearer ${currentToken}`);
    throw new TypeError('Failed to fetch');
  }, { ...console, warn: () => {} });
  const failedRevoke = await revokeRetryHarness.hooks.retryPendingDeviceRevocations_(
    'https://safe-device.trycloudflare.com',
    currentToken,
    currentId,
  );
  assert.deepEqual([...failedRevoke.failed], [staleId]);
  assert.deepEqual(
    JSON.parse(revokeRetryHarness.storage.get('mercari_pending_revoke_device_ids_v1')),
    [staleId],
    '通信失敗時は旧端末IDを次回再試行用に残します',
  );
  staleStillRegistered = false;
  const recoveredRevoke = await revokeRetryHarness.hooks.retryPendingDeviceRevocations_(
    'https://safe-device.trycloudflare.com',
    currentToken,
    currentId,
  );
  assert.deepEqual([...recoveredRevoke.revoked], [staleId]);
  assert.equal(revokeRetryHarness.storage.has('mercari_pending_revoke_device_ids_v1'), false);

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
  const pairSource = source.slice(
    source.indexOf('async function pairMercariDevice_'),
    source.indexOf('async function ensureMercariDeviceCredential_'),
  );
  assert.ok(
    pairSource.indexOf('await verifyRegisteredMercariDevice_')
      < pairSource.indexOf('localStorage.setItem(MERCARI_DEVICE_ID_KEY'),
    '両サーバー成功前にcurrent credentialを切り替えてはいけません',
  );
  const pairHtml = fs.readFileSync('pair.html', 'utf8');
  const pairJs = fs.readFileSync('pair.js', 'utf8');
  assert.match(pairJs, /history\.replaceState[\s\S]*const attempt = async/);
  assert.match(pairHtml, /id="pair-retry"/);
  assert.match(pairJs, /new AbortController\(\)/);
  assert.match(pairJs, /timeoutMs = 15000/);
  assert.match(pairJs, /mercari_pending_revoke_device_ids_v1/);
  assert.match(pairJs, /retryPendingRevocations/);

  console.log(JSON.stringify({
    ok: true,
    initialMigrationCalls: successfulCalls,
    twoServerRetry: true,
    existingTokenPreserved: true,
    failedRevocationPersistedAndRetried: true,
    strictMacUrl: true,
    version: 'v20260831a',
  }));
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
