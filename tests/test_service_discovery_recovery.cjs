#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const storage = new Map();
const context = {
  console,
  URL,
  globalThis: null,
  localStorage: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key),
  },
};
context.globalThis = context;
context.__MERCARI_TEST__ = true;
vm.createContext(context);

const source = [
  fs.readFileSync('catalog-data.js', 'utf8'),
  fs.readFileSync('app.js', 'utf8'),
].join('\n');
vm.runInContext(source, context, { filename: 'app.js' });

const hooks = context.MercariAppTestHooks;

assert.equal(
  hooks.normalizeMacServiceUrl_('https://example.trycloudflare.com/'),
  'https://example.trycloudflare.com',
);
assert.equal(hooks.normalizeMacServiceUrl_('http://example.com'), '');
assert.equal(hooks.normalizeMacServiceUrl_('http://127.0.0.1:5001/'), 'http://127.0.0.1:5001');
assert.equal(hooks.normalizeMacServiceUrl_('not-a-url'), '');

assert.equal(
  hooks.cacheMacServiceUrl_('https://cached.trycloudflare.com/'),
  'https://cached.trycloudflare.com',
);
assert.equal(hooks.getCachedMacServiceUrl_(), 'https://cached.trycloudflare.com');
hooks.clearCachedMacServiceUrl_();
assert.equal(hooks.getCachedMacServiceUrl_(), '');

assert.equal(hooks.isTransientServiceDiscoveryError_(new Error('Load failed')), true);
assert.equal(hooks.isTransientServiceDiscoveryError_(new Error('Failed to fetch')), true);
assert.equal(hooks.isTransientServiceDiscoveryError_({ name: 'AbortError', message: '' }), true);
assert.equal(hooks.isTransientServiceDiscoveryError_(new Error('Fetch is aborted')), true);
assert.equal(hooks.isTransientServiceDiscoveryError_({ name: 'TimeoutError', message: '' }), true);
assert.equal(hooks.isTransientServiceDiscoveryError_(new Error('GAS URLエラー (503)')), true);
assert.equal(hooks.isTransientServiceDiscoveryError_(new Error('UNAUTHORIZED')), false);

assert.match(source, /const GAS_DISCOVERY_MAX_ATTEMPTS = 3;/);
assert.match(source, /for \(let attempt = 1; attempt <= GAS_DISCOVERY_MAX_ATTEMPTS; attempt \+= 1\)/);
assert.match(
  source,
  /const cachedUrl = getCachedMacServiceUrl_\(\);[\s\S]*await pingMacService\(cachedUrl\)[\s\S]*const errors = \[\];/,
);
assert.match(source, /if \(macServiceDiscoveryPromise\)[\s\S]*Macサービス接続の確認待ち/);
assert.match(source, /const generationUiState = captureGenerationUiState_\(\);/);
assert.match(
  source,
  /catch \(err\) \{[\s\S]*restoreGenerationUiState_\(generationUiState\);[\s\S]*生成失敗/,
);

const indexHtml = fs.readFileSync('index.html', 'utf8');
assert.match(indexHtml, /v20260905a \/ セキュリティ強化/);
assert.match(indexHtml, /catalog-data\.js\?v=20260905a/);
assert.match(indexHtml, /app\.js\?v=20260905a/);

const serviceWorker = fs.readFileSync('sw.js', 'utf8');
assert.match(serviceWorker, /mercari-description-v20260905a/);

console.log(JSON.stringify({
  ok: true,
  retryAttempts: 3,
  cachedUrlFallback: true,
  singleFlight: true,
  generationUiRestore: true,
  version: 'v20260905a',
}));
