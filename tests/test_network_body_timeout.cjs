'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const tick = () => new Promise(resolve => setImmediate(resolve));
const app = fs.readFileSync(process.env.MERCARI_NETWORK_APP_SOURCE || 'app.js', 'utf8');
const pair = fs.readFileSync(process.env.MERCARI_NETWORK_PAIR_SOURCE || 'pair.js', 'utf8');
const implementations = [
  ['app', app.slice(app.indexOf('function fetchWithTimeout('), app.indexOf('\nfunction getApiAuthToken('))],
  ['pair', pair.slice(pair.indexOf('  const fetchWithTimeout ='), pair.indexOf('  const readJson ='))],
];
function harness(source, makeResponse) {
  const timers = new Map(); let nextTimer = 0, signal;
  const context = vm.createContext({
    URL, Headers, AbortController, location: { href: 'https://fixture.invalid/' },
    getApiAuthToken: () => '', createOperationId_: () => 'fixture-op',
    setTimeout: callback => { timers.set(++nextTimer, callback); return nextTimer; },
    clearTimeout: id => timers.delete(id),
    fetch: async (_url, opts) => { signal = opts.signal; return makeResponse(signal); },
  });
  vm.runInContext(source + '\nglobalThis.subject = fetchWithTimeout;', context);
  return { call: context.subject, timers, signal: () => signal };
}
(async () => {
  for (const [name, source] of implementations) {
    {
      const h = harness(source, signal => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"ok":'));
          signal.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true });
        },
      }), { headers: { 'Content-Type': 'application/json' } }));
      let settled = false;
      const request = h.call('https://fixture.invalid/result', {}, 20);
      const rejected = assert.rejects(request, error => name === 'app' ? error.name === 'TimeoutError' : true);
      request.then(() => { settled = true; }, () => { settled = true; });
      await tick(); await tick();
      assert.equal(settled, false, `${name}: headers are not the complete response`);
      assert.equal(h.timers.size, 1, `${name}: timeout must cover the response body`);
      [...h.timers.values()][0]();
      await rejected;
      assert.equal(h.signal().aborted, true); assert.equal(h.timers.size, 0);
    }
    for (const status of [200, 401, 503]) {
      const h = harness(source, () => new Response('{"value":12}', { status, headers: { 'Content-Type': 'application/json', 'X-Fixture': 'preserved' } }));
      const response = await h.call('https://fixture.invalid/result', {}, 20);
      assert.equal(response.status, status); assert.equal(response.bodyUsed, false);
      assert.equal(response.headers.get('X-Fixture'), 'preserved');
      assert.deepEqual(await response.json(), { value: 12 });
      assert.equal(h.timers.size, 0);
    }
    if (name === 'app') {
      const external = new AbortController();
      const h = harness(source, () => new Response('{}'));
      await h.call('https://fixture.invalid/result', { signal: external.signal }, 20);
      external.abort();
      assert.equal(h.signal().aborted, false, 'completed requests remove the external abort listener');
    }
  }
  console.log('PASS network bodies: app/pair deadlines cover stalled bodies; native status/headers/body and cancellation cleanup preserved');
})().catch(error => { console.error(error); process.exitCode = 1; });
