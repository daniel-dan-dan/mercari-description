#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const storage = new Map();
let uuidCounter = 0;
const context = {
  console,
  URL,
  setTimeout,
  clearTimeout,
  globalThis: null,
  localStorage: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key),
  },
};
context.globalThis = context;
context.window = context;
context.crypto = { randomUUID: () => `test-random-uuid-${++uuidCounter}` };
context.__MERCARI_TEST__ = true;
vm.createContext(context);

const source = [
  fs.readFileSync('catalog-data.js', 'utf8'),
  fs.readFileSync('app.js', 'utf8'),
].join('\n');
vm.runInContext(source, context, { filename: 'app.js' });

const hooks = context.MercariAppTestHooks;

(async () => {
  const calls = [];
  const statuses = [];
  context.__mockFetchWithTimeout = async (url, options, timeoutMs) => {
    calls.push({ url, options, timeoutMs });
    if (calls.length === 1) throw new Error('Fetch is aborted');
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true, job_id: 'job-recovered' }),
    };
  };
  vm.runInContext('fetchWithTimeout = globalThis.__mockFetchWithTimeout;', context);

  const result = await hooks.startDraftJob_(
    'https://old-tunnel.trycloudflare.com',
    { title: 'テスト商品' },
    {
      operationId: 'draft-operation-fixed',
      retryDelayMs: 0,
      onStatus: message => statuses.push(message),
      refreshUrl: async () => 'https://new-tunnel.trycloudflare.com',
    },
  );

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://old-tunnel.trycloudflare.com/draft');
  assert.equal(calls[1].url, 'https://new-tunnel.trycloudflare.com/draft');
  assert.equal(calls[0].timeoutMs, 120000);
  assert.equal(calls[1].timeoutMs, 120000);
  assert.equal(calls[0].options.headers['X-Operation-Id'], 'draft-operation-fixed');
  assert.equal(calls[1].options.headers['X-Operation-Id'], 'draft-operation-fixed');
  assert.equal(result.data.job_id, 'job-recovered');
  assert.equal(result.tunnelUrl, 'https://new-tunnel.trycloudflare.com');
  assert.ok(statuses.some(message => message.includes('自動で再接続')));

  let validationCalls = 0;
  context.__mockFetchWithTimeout = async () => {
    validationCalls += 1;
    return {
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ ok: false, error: '入力内容が不正です' }),
    };
  };
  vm.runInContext('fetchWithTimeout = globalThis.__mockFetchWithTimeout;', context);
  await assert.rejects(
    hooks.startDraftJob_(
      'https://valid.trycloudflare.com',
      { title: 'テスト商品' },
      { retryDelayMs: 0 },
    ),
    /入力内容が不正です/,
  );
  assert.equal(validationCalls, 1, '確定エラーは自動再送しない');

  let html503Calls = 0;
  context.__mockFetchWithTimeout = async () => {
    html503Calls += 1;
    if (html503Calls === 1) {
      return {
        ok: false,
        status: 503,
        text: async () => '<html>temporary unavailable</html>',
      };
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true, job_id: 'job-after-html-503' }),
    };
  };
  vm.runInContext('fetchWithTimeout = globalThis.__mockFetchWithTimeout;', context);
  const html503Recovered = await hooks.startDraftJob_(
    'https://valid.trycloudflare.com',
    { title: 'HTML 503テスト' },
    { retryDelayMs: 0, operationId: 'html-503-fixed' },
  );
  assert.equal(html503Calls, 2);
  assert.equal(html503Recovered.data.job_id, 'job-after-html-503');

  let pollCalls = 0;
  const pollUrls = [];
  const pollStatuses = [];
  context.__mockFetchWithTimeout = async url => {
    pollCalls += 1;
    pollUrls.push(url);
    if (pollCalls === 1) {
      return {
        ok: false,
        status: 503,
        text: async () => '<html>temporary unavailable</html>',
      };
    }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ status: 'done', message: '下書き保存完了' }),
    };
  };
  vm.runInContext('fetchWithTimeout = globalThis.__mockFetchWithTimeout;', context);
  const polled = await hooks.pollMacJob(
    'https://old-tunnel.trycloudflare.com',
    'job-recovered',
    {
      intervalMs: 0,
      timeoutMs: 1000,
      networkRetryDelayMs: 0,
      refreshUrl: async () => 'https://new-tunnel.trycloudflare.com',
      onStatus: status => pollStatuses.push(status),
    },
  );
  assert.equal(polled.status, 'done');
  assert.equal(pollCalls, 2);
  assert.equal(
    pollUrls[0],
    'https://old-tunnel.trycloudflare.com/status/job-recovered',
  );
  assert.equal(
    pollUrls[1],
    'https://new-tunnel.trycloudflare.com/status/job-recovered',
  );
  assert.ok(pollStatuses.some(status => status.status === 'waiting'));

  let unknownJobCalls = 0;
  context.__mockFetchWithTimeout = async () => {
    unknownJobCalls += 1;
    return {
      ok: false,
      status: 404,
      text: async () => JSON.stringify({ status: 'error', message: '不明なジョブIDです' }),
    };
  };
  vm.runInContext('fetchWithTimeout = globalThis.__mockFetchWithTimeout;', context);
  await assert.rejects(
    hooks.pollMacJob(
      'https://valid.trycloudflare.com',
      'unknown-job',
      { intervalMs: 0, timeoutMs: 1000, networkRetryDelayMs: 0 },
    ),
    /不明なジョブIDです/,
  );
  assert.equal(unknownJobCalls, 1, '404は再試行せず確定エラーにする');

  const firstOperation = hooks.getOrCreateDraftOperation_({ title: '同じ商品' }, 1000);
  const reusedOperation = hooks.getOrCreateDraftOperation_({ title: '同じ商品' }, 2000);
  assert.equal(reusedOperation.operationId, firstOperation.operationId);
  assert.equal(reusedOperation.reused, true);
  const changedOperation = hooks.getOrCreateDraftOperation_({ title: '変更した商品' }, 3000);
  assert.notEqual(changedOperation.operationId, firstOperation.operationId);
  assert.equal(changedOperation.reused, false);
  hooks.clearDraftOperation_(changedOperation.operationId);
  const recreatedOperation = hooks.getOrCreateDraftOperation_({ title: '変更した商品' }, 4000);
  assert.notEqual(recreatedOperation.operationId, changedOperation.operationId);

  assert.equal(hooks.isRetryableDraftStartError_(new Error('Fetch is aborted')), true);
  assert.equal(
    hooks.isRetryableDraftStartError_(
      Object.assign(new Error('一時エラー'), { httpStatus: 503 }),
    ),
    true,
  );
  assert.equal(
    hooks.isRetryableDraftStartError_(
      Object.assign(new Error('入力エラー'), { httpStatus: 400 }),
    ),
    false,
  );
  assert.equal(
    hooks.isRetryableJobStatusError_(
      Object.assign(new Error('HTML 503'), { httpStatus: 503 }),
    ),
    true,
  );
  assert.equal(
    hooks.isRetryableJobStatusError_(
      Object.assign(new Error('不明なジョブ'), { httpStatus: 404 }),
    ),
    false,
  );
  const exhausted503 = Object.assign(
    new Error('処理状況の応答をJSONとして読めませんでした (503): <html>'),
    { httpStatus: 503 },
  );
  assert.equal(hooks.shouldPreserveDraftOperation_(exhausted503), true);
  assert.doesNotMatch(hooks.formatDraftSaveError_(exhausted503), /<html>|JSON/);
  assert.match(hooks.formatDraftSaveError_(exhausted503), /前回の受付状況から確認/);
  assert.equal(
    hooks.shouldPreserveDraftOperation_(
      Object.assign(new Error('不明なジョブ'), { httpStatus: 404 }),
    ),
    false,
  );
  assert.doesNotMatch(hooks.formatDraftSaveError_(new Error('Fetch is aborted')), /Fetch is aborted/);
  assert.match(source, /const DRAFT_START_MAX_ATTEMPTS = 2;/);
  assert.match(source, /const DRAFT_START_TIMEOUT_MS = 120000;/);
  assert.match(source, /const JOB_STATUS_MAX_CONSECUTIVE_ERRORS = 3;/);
  assert.match(source, /const DRAFT_OPERATION_TTL_MS = 6 \* 60 \* 60 \* 1000;/);
  assert.match(source, /const MAX_DRAFT_PAYLOAD_BYTES = 28 \* 1024 \* 1024;/);

  console.log(JSON.stringify({
    ok: true,
    attempts: calls.length,
    fixedOperationId: true,
    refreshedTunnel: true,
    statusPollingRecovered: true,
    definitiveErrorNotRetried: true,
    html503Recovered: true,
    manualRetryReusesOperationId: true,
    timeoutMs: calls[0].timeoutMs,
  }));
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
