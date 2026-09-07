'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = ['catalog-data.js', 'app.js'].map(file => fs.readFileSync(file, 'utf8')).join('\n');
const baseUrl = 'https://draft-fixture.trycloudflare.com';
const receipt = 'draft-result-fixture';
const response = data => ({ ok: true, status: 200, text: async () => JSON.stringify(data) });
const snapshot = (status, extra = {}) => response({ ok: true, operationId: receipt, status, ...extra });
function harness(handler) {
  const calls = [];
  const context = { console, URL, AbortController, setTimeout, clearTimeout, __MERCARI_TEST__: true,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    mockFetch: async (url, options, timeoutMs) => {
      calls.push({ url, options, timeoutMs });
      return handler(url, options, calls.length);
    },
  };
  context.window = context; context.globalThis = context; vm.createContext(context);
  vm.runInContext(source, context);
  vm.runInContext('fetchWithTimeout = mockFetch;', context);
  return { context, calls, hooks: context.MercariAppTestHooks };
}
const startOptions = { operationId: receipt, reused: true, useOperationResult: true, retryDelayMs: 0 };
const getOnly = calls => {
  for (const call of calls) {
    assert.equal(call.url, `${baseUrl}/draft/result?operationId=${receipt}`);
    assert.equal(call.options.method, undefined);
    assert.equal(call.options.body, undefined, 'receipt polling must not upload photos');
    assert.equal(call.options.cache, 'no-store');
  }
};

(async () => {
  // Page reload/manual retry: the same retained receipt resolves without upload.
  for (const status of ['done', 'pending', 'running']) {
    const { hooks, calls } = harness(() => snapshot(status, { job_id: 'live-job' }));
    const result = await hooks.startDraftJob_(baseUrl, { photos: ['must-not-be-uploaded'] }, startOptions);
    assert.equal(result.completed, status === 'done');
    assert.equal(result.data.status, status);
    assert.equal(calls.length, 1); getOnly(calls);
  }

  for (const status of ['not_found', 'error']) {
    const { hooks, calls } = harness((_url, _options, count) => count === 1 ? snapshot(status)
      : response({ ok: true, job_id: 'restarted', operationId: receipt }));
    const result = await hooks.startDraftJob_(baseUrl, { title: 'unchanged' }, startOptions);
    assert.equal(result.data.job_id, 'restarted');
    assert.equal(calls.length, 2);
    assert.equal(calls[1].options.method, 'POST');
    assert.equal(calls[1].options.headers['X-Operation-Id'], receipt);
  }

  for (const data of [
    { ok: true, operationId: receipt, status: 'needs_review', message: '保存結果が要確認です' },
    { ok: true, operationId: 'wrong-receipt', status: 'done' },
  ]) {
    const { hooks, calls } = harness(() => response(data));
    await assert.rejects(hooks.startDraftJob_(baseUrl, {}, startOptions), error => {
      assert.equal(hooks.shouldPreserveDraftOperation_(error), true); return true;
    });
    assert.equal(calls.length, 1); getOnly(calls);
  }

  // A lost POST response gets a read-only result check even on the final try.
  for (const resultStatus of ['done', 'running', 'error', 'needs_review']) {
    const { hooks, calls } = harness((_url, _options, count) => {
      if (count === 1) throw new Error('Failed to fetch');
      return snapshot(resultStatus, { message: 'Macの実際の結果', job_id: 'accepted' });
    });
    const task = hooks.startDraftJob_(baseUrl, { photos: ['fixture'] }, { ...startOptions, reused: false });
    if (['error', 'needs_review'].includes(resultStatus)) {
      await assert.rejects(task, /Macの実際の結果/);
    } else {
      const result = await task;
      assert.equal(result.data.status, resultStatus);
    }
    assert.equal(calls.length, 2);
    assert.equal(calls.filter(call => call.options.method === 'POST').length, 1);
  }

  {
    const { hooks, calls } = harness((_url, options, count) => {
      if (options.method === 'POST') throw new Error('Load failed');
      return snapshot(count === 2 ? 'not_found' : 'done');
    });
    const result = await hooks.startDraftJob_(baseUrl, {}, { ...startOptions, reused: false });
    assert.equal(result.completed, true);
    assert.deepEqual(calls.map(call => call.options.method || 'GET'), ['POST', 'GET', 'POST', 'GET']);
    assert.equal(calls[0].options.headers['X-Operation-Id'], calls[2].options.headers['X-Operation-Id']);
  }

  // More than three transient outages no longer end the user's wait.
  {
    let clock = 0;
    const { hooks, calls } = harness((_url, _options, count) => {
      if (count <= 4) throw new Error('Failed to fetch');
      return snapshot('done');
    });
    const result = await hooks.pollDraftOperationResult_(baseUrl, receipt, {
      nowFn: () => clock, waitFn: async ms => { clock += ms; }, networkRetryDelayMs: 1000,
    });
    assert.equal(result.data.status, 'done');
    assert.equal(calls.length, 5); getOnly(calls);
  }

  // A phone can resume after the timeout; verify the Mac's final status first.
  for (const terminal of ['done', 'running']) {
    let clock = 0;
    const { hooks, calls } = harness((_url, _options, count) => snapshot(count === 1 ? 'running' : terminal));
    const task = hooks.pollDraftOperationResult_(baseUrl, receipt, {
      timeoutMs: 1000, nowFn: () => clock, waitFn: async () => { clock = 600000; },
    });
    if (terminal === 'done') assert.equal((await task).data.status, 'done');
    else await assert.rejects(task, error => {
      assert.equal(hooks.shouldPreserveDraftOperation_(error), true);
      assert.match(error.message, /確認待ち時間/); return true;
    });
    assert.equal(calls.length, 2); getOnly(calls);
  }

  {
    let clock = 0;
    const { hooks, calls } = harness(() => { throw new Error('Failed to fetch'); });
    await assert.rejects(hooks.pollDraftOperationResult_(baseUrl, receipt, {
      networkRecoveryMs: 2000, networkRetryDelayMs: 1000, nowFn: () => clock,
      waitFn: async ms => { clock += ms; },
    }), error => {
      assert.match(error.message, /通信の回復を待ちました/);
      assert.equal(hooks.shouldPreserveDraftOperation_(error), true); return true;
    });
    assert.equal(calls.length, 3); getOnly(calls);
  }

  // A completed browser timeout is not retried as a network error.
  {
    const { hooks, calls } = harness(() => snapshot('error', { message: 'Locator Timeout 5000ms exceeded' }));
    await assert.rejects(hooks.pollDraftOperationResult_(baseUrl, receipt), error => {
      assert.equal(error.macJobFailed, true);
      assert.equal(hooks.formatDraftSaveError_(error), 'Locator Timeout 5000ms exceeded'); return true;
    });
    assert.equal(calls.length, 1);
  }

  {
    const controller = new AbortController();
    const { hooks, calls } = harness((_url, options) => {
      assert.equal(options.signal, controller.signal);
      controller.abort(); throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    });
    await assert.rejects(hooks.startDraftJob_(baseUrl, {}, {
      ...startOptions, reused: false, signal: controller.signal,
    }), error => {
      assert.match(error.message, /待機を中止/);
      assert.equal(hooks.shouldPreserveDraftOperation_(error), true); return true;
    });
    assert.equal(calls.length, 1, 'user cancellation must never resend');
  }

  // Going online or bringing the page forward wakes the polling delay once.
  {
    const { hooks, context } = harness(() => snapshot('done'));
    const listeners = new Map();
    const add = (event, callback) => listeners.set(event, callback);
    const remove = event => listeners.delete(event);
    context.addEventListener = add; context.removeEventListener = remove;
    context.document = { hidden: true, addEventListener: add, removeEventListener: remove };
    const pending = hooks.waitForDraftPoll_(10000);
    context.document.hidden = false; listeners.get('visibilitychange')();
    await pending; assert.equal(listeners.size, 0);
    const online = hooks.waitForDraftPoll_(10000);
    listeners.get('online')(); await online; assert.equal(listeners.size, 0);
    const controller = new AbortController();
    const cancelled = hooks.waitForDraftPoll_(10000, controller.signal);
    controller.abort(); await assert.rejects(cancelled, /待機を中止/);
    assert.equal(listeners.size, 0);
  }
  console.log('PASS draft receipt recovery: GET-only resume, no duplicate upload, prolonged disconnect, sleep resume, bounded wait, cancellation and terminal error safety');
})().catch(error => { console.error(error); process.exitCode = 1; });
