'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(process.env.PWA_WORKER_TEST_SOURCE || 'sw.js', 'utf8');
const cacheName = source.match(/const CACHE_NAME = '([^']+)'/)[1];
const prefix = source.match(/const CACHE_PREFIX = '([^']+)'/)[1];
const root = 'https://fixture.invalid/app/';
function fixture({ badMime = false, failPut = false } = {}) {
  const listeners = {}, old = prefix + 'fixture-old', unrelated = 'another-app-cache';
  const maps = new Map([[old, new Map()], [unrelated, new Map()]]);
  const calls = { fetch: 0, put: 0, claim: 0 };
  const key = input => new URL(typeof input === 'string' ? input : input.url, root).href;
  const caches = {
    async open(name) {
      if (!maps.has(name)) maps.set(name, new Map());
      const data = maps.get(name);
      return { async put(input, response) {
        if (failPut && ++calls.put === 3) throw Error('fixture quota');
        data.set(key(input), response.clone());
      }, async match(input) { return data.get(key(input))?.clone(); } };
    },
    async keys() { return [...maps.keys()]; }, async delete(name) { return maps.delete(name); },
  };
  let body = 'validated-release';
  const context = vm.createContext({
    URL, Request, Response, caches,
    self: { location: { href: root + 'sw.js', origin: new URL(root).origin },
      addEventListener(name, callback) { listeners[name] = callback; }, clients: { async claim() { calls.claim++; } } },
    fetch: async input => {
      calls.fetch++;
      const path = new URL(key(input)).pathname;
      const mime = path.endsWith('.js') ? badMime ? 'text/html' : 'text/javascript'
        : path.endsWith('.css') ? 'text/css' : path.endsWith('.png') ? 'image/png'
          : path.endsWith('.json') ? 'application/json' : path.endsWith('/LICENSE') ? 'text/plain' : 'text/html';
      return new Response(body, { headers: { 'Content-Type': mime } });
    },
  });
  vm.runInContext(source + '\nglobalThis.assetPaths = ASSETS;', context);
  async function event(name, request) {
    const pending = []; let result;
    listeners[name]({ request, waitUntil: promise => pending.push(promise), respondWith: promise => { result = promise; } });
    const resolved = await result; await Promise.all(pending); return resolved;
  }
  return { maps, old, unrelated, calls, event, paths: context.assetPaths, setBody(value) { body = value; } };
}
(async () => {
  for (const options of [{ badMime: true }, { failPut: true }]) {
    const h = fixture(options);
    await assert.rejects(h.event('install'));
    assert.equal(h.maps.has(h.old), true); assert.equal(h.maps.has(h.unrelated), true);
    assert.equal(h.maps.has(cacheName), false, 'partial new release is not retained');
    assert.equal(h.calls.claim, 0);
  }
  {
    const h = fixture();
    await assert.rejects(h.event('activate'));
    assert.equal(h.maps.has(h.old), true); assert.equal(h.calls.claim, 0);
  }
  {
    const h = fixture(); await h.event('install');
    assert.equal(h.maps.get(cacheName).size, h.paths.length);
    await h.event('activate');
    assert.equal(h.maps.has(h.old), false); assert.equal(h.maps.has(h.unrelated), true); assert.equal(h.calls.claim, 1);
    h.setBody('different-deployment'); const before = h.calls.fetch;
    for (const asset of h.paths.filter(path => /app\.js|index\.html/.test(path))) {
      const response = await h.event('fetch', new Request(new URL(asset, root)));
      assert.equal(await response.text(), 'validated-release', 'active release cannot mix with newly deployed files');
    }
    assert.equal(h.calls.fetch, before, 'active cached release is immutable');
    assert.equal(await h.event('fetch', new Request('https://other.invalid/api')), undefined);
    const count = h.maps.get(cacheName).size;
    await h.event('fetch', new Request(root + 'not-an-app-asset'));
    assert.equal(h.maps.get(cacheName).size, count, 'unknown resources do not pollute the app cache');
  }
  console.log('PASS worker release integrity: MIME, atomic install, activation readback, app-only cleanup and coherent active release');
})().catch(error => { console.error(error); process.exitCode = 1; });
