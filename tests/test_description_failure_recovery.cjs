#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

let uuidCounter = 0;
const context = {
  console,
  URL,
  TextEncoder,
  Date,
  globalThis: null,
  window: null,
  crypto: { randomUUID: () => `description-test-${++uuidCounter}` },
  localStorage: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  },
};
context.globalThis = context;
context.window = context;
context.__MERCARI_TEST__ = true;
vm.createContext(context);

const appSource = fs.readFileSync('app.js', 'utf8');
vm.runInContext([
  fs.readFileSync('catalog-data.js', 'utf8'),
  appSource,
].join('\n'), context, { filename: 'app.js' });

const hooks = context.MercariAppTestHooks;

const NOW = Date.now();

function response(status, body, { raw = false } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => raw ? String(body) : JSON.stringify(body),
  };
}

function operationEnvelope(operationId, status, extra = {}) {
  return {
    ok: true,
    status,
    operationId,
    clientRequestId: operationId,
    ...extra,
  };
}

function successEnvelope(operationId, text = '{"ok":"recovered"}') {
  return operationEnvelope(operationId, 'success', {
    result: {
      text,
      attempts: 1,
      requestId: 'server-success-request',
      clientRequestId: operationId,
    },
  });
}

function failureEnvelope(operationId, overrides = {}) {
  return operationEnvelope(operationId, 'failed', {
    failure: {
      code: 'OPENAI_BILLING_REQUIRED',
      message: 'OpenAIの利用枠または請求設定で止まっています。',
      error: 'OpenAIの利用枠または請求設定で止まっています。',
      requestId: 'server-failure-request',
      status: 429,
      clientRequestId: operationId,
      atEpochMs: NOW,
      ...overrides,
    },
  });
}

function recoveryOptions(overrides = {}) {
  return {
    pollOptions: {
      intervalMs: 0,
      requestTimeoutMs: 1,
      maxConsecutiveNetworkErrors: 2,
      waitFn: async () => {},
      nowFn: () => NOW,
      ...overrides,
    },
  };
}

(async () => {
  assert.match(
    appSource,
    /const DESCRIPTION_RESULT_POLL_TIMEOUT_MS = 180000;/,
    'OpenAI側の最悪再試行時間を回収できるよう結果確認は最大180秒待つ',
  );
  assert.match(appSource, /const DESCRIPTION_RESULT_POLL_INTERVAL_MS = 5000;/);
  assert.match(appSource, /const DESCRIPTION_RESULT_MAX_AGE_MS = 10 \* 60 \* 1000;/);

  const directBilling = hooks.makeDescriptionApiError_({
    code: 'OPENAI_BILLING_REQUIRED',
    error: 'provider detail',
    requestId: 'server-request-1234',
  }, 402);
  assert.equal(directBilling.code, 'OPENAI_BILLING_REQUIRED');
  assert.match(directBilling.message, /OpenAI APIの利用枠または請求設定/);
  assert.match(directBilling.message, /写真を減らしても解消しません/);
  assert.match(directBilling.message, /写真と採寸はこの端末に残っています/);
  assert.doesNotMatch(directBilling.message, /12枚まで/);

  const directQuota429 = hooks.makeDescriptionApiError_({
    error: 'insufficient_quota: You exceeded your current quota',
  }, 429);
  assert.equal(directQuota429.code, 'OPENAI_BILLING_REQUIRED');
  const directRate429 = hooks.makeDescriptionApiError_({
    error: 'Rate limit reached for requests',
  }, 429);
  assert.equal(directRate429.code, 'OPENAI_RATE_LIMITED');
  assert.match(directRate429.message, /混み合っています/);
  const explicitRate429 = hooks.makeDescriptionApiError_({
    code: 'OPENAI_RATE_LIMITED',
    error: 'Rate quota for requests per minute was exceeded',
  }, 429);
  assert.equal(explicitRate429.code, 'OPENAI_RATE_LIMITED', '明示された混雑コードを請求不足と誤判定しない');
  const explicitUnknownQuota429 = hooks.makeDescriptionApiError_({
    code: 'OPENAI_REQUEST_FAILED',
    error: 'Unknown provider error mentioning quota and billing',
  }, 429);
  assert.equal(
    explicitUnknownQuota429.code,
    'OPENAI_REQUEST_FAILED',
    '未知でも明示されたエラーコードを本文やHTTP 429で上書きしない',
  );
  assert.doesNotMatch(explicitUnknownQuota429.message, /写真を減らしても解消しません/);

  const operationId = 'describe-current-operation';
  const matchingFailure = {
    atEpochMs: Date.now(),
    clientRequestId: operationId,
    code: 'OPENAI_BILLING_REQUIRED',
    message: 'OpenAIの利用枠または請求設定で止まっています。',
    status: 429,
  };
  assert.equal(
    hooks.matchingRecentDescriptionFailure_({ lastFailure: matchingFailure }, operationId),
    matchingFailure,
  );
  assert.equal(
    hooks.matchingRecentDescriptionFailure_({ lastFailure: matchingFailure }, 'different-operation'),
    null,
    '別のAI生成エラーは拾わない',
  );
  assert.equal(
    hooks.matchingRecentDescriptionFailure_({
      lastFailure: { ...matchingFailure, atEpochMs: NOW - 10 * 60 * 1000 - 1 },
    }, operationId, NOW),
    null,
    '古いエラーは拾わない',
  );
  assert.equal(
    hooks.matchingRecentDescriptionFailure_({
      lastFailure: { ...matchingFailure, atEpochMs: NOW + 30001 },
    }, operationId, NOW),
    null,
    '未来時刻のエラーは拾わない',
  );

  assert.equal(
    hooks.normalizeDescriptionOperationResult_(
      operationEnvelope('different-operation', 'unknown'),
      operationId,
      NOW,
    ).status,
    'unknown',
    '別の受付IDの結果は採用しない',
  );
  assert.equal(
    hooks.normalizeDescriptionOperationResult_(
      failureEnvelope(operationId, { atEpochMs: NOW - 10 * 60 * 1000 - 1 }),
      operationId,
      NOW,
    ).status,
    'unknown',
    '古い保存エラーは採用しない',
  );
  assert.equal(
    hooks.normalizeDescriptionOperationResult_(
      failureEnvelope(operationId, { atEpochMs: NOW + 30001 }),
      operationId,
      NOW,
    ).status,
    'unknown',
    '未来時刻の保存エラーは採用しない',
  );

  let fetchCalls = [];
  context.__mockFetchWithTimeout = async (url, options = {}) => {
    fetchCalls.push({ url: String(url), options });
    return response(200, successEnvelope(operationId));
  };
  vm.runInContext(`
    fetchWithTimeout = (...args) => globalThis.__mockFetchWithTimeout(...args);
  `, context);
  const recoveredSuccess = await hooks.recoverDescriptionNetworkFailure_(
    'https://current.trycloudflare.com',
    operationId,
    new Error('Load failed'),
    recoveryOptions(),
  );
  assert.equal(recoveredSuccess.text, '{"ok":"recovered"}');
  assert.equal(fetchCalls.length, 1);
  assert.match(fetchCalls[0].url, /\/describe\/result\?operationId=describe-current-operation$/);

  fetchCalls = [];
  let processingStep = 0;
  context.__mockFetchWithTimeout = async (url, options = {}) => {
    fetchCalls.push({ url: String(url), options });
    processingStep += 1;
    return processingStep === 1
      ? response(200, operationEnvelope(operationId, 'processing'))
      : response(200, failureEnvelope(operationId));
  };
  await assert.rejects(
    hooks.recoverDescriptionNetworkFailure_(
      'https://current.trycloudflare.com',
      operationId,
      new Error('Timeout'),
      recoveryOptions(),
    ),
    error => {
      assert.equal(error.code, 'OPENAI_BILLING_REQUIRED');
      return true;
    },
  );
  assert.equal(fetchCalls.length, 2, 'processingの後は同じ受付IDをGETで確認する');
  assert.ok(fetchCalls.every(call => call.url.includes(`operationId=${operationId}`)));

  fetchCalls = [];
  context.__mockFetchWithTimeout = async (url, options = {}) => {
    fetchCalls.push({ url: String(url), options });
    if (String(url).includes('/describe/result')) {
      return response(200, operationEnvelope(operationId, 'unknown'));
    }
    return response(200, { ok: true, lastFailure: null });
  };
  await assert.rejects(
    hooks.recoverDescriptionNetworkFailure_(
      'https://current.trycloudflare.com',
      operationId,
      new Error('Load failed'),
      recoveryOptions(),
    ),
    error => {
      assert.equal(error.code, 'DESCRIPTION_RESULT_UNKNOWN');
      assert.equal(error.ambiguousDescriptionResult, true);
      assert.match(error.message, /すぐに「説明文を生成」を押し直さないでください/);
      assert.match(error.message, /写真と採寸はこの端末に残っています/);
      return true;
    },
  );
  assert.equal(fetchCalls.length, 2, 'unknown時はhealthを1回だけ安全確認する');

  fetchCalls = [];
  let advancingNow = NOW;
  context.__mockFetchWithTimeout = async (url, options = {}) => {
    fetchCalls.push({ url: String(url), options });
    return response(200, operationEnvelope(operationId, 'processing'));
  };
  await assert.rejects(
    hooks.recoverDescriptionNetworkFailure_(
      'https://current.trycloudflare.com',
      operationId,
      new Error('Timeout'),
      recoveryOptions({
        timeoutMs: 50,
        nowFn: () => {
          advancingNow += 100;
          return advancingNow;
        },
      }),
    ),
    error => {
      assert.equal(error.code, 'DESCRIPTION_RESULT_UNKNOWN');
      assert.equal(error.reason, 'timeout');
      return true;
    },
  );
  assert.equal(
    fetchCalls.filter(call => call.url.includes('/describe/result')).length,
    1,
    '待機上限を超えたらGETポーリングを終了する',
  );

  fetchCalls = [];
  context.__mockFetchWithTimeout = async (url, options = {}) => {
    fetchCalls.push({ url: String(url), options });
    return response(401, { error: 'unauthorized' });
  };
  await assert.rejects(
    hooks.recoverDescriptionNetworkFailure_(
      'https://current.trycloudflare.com',
      operationId,
      new Error('Load failed'),
      recoveryOptions(),
    ),
    error => {
      assert.equal(error.code, 'DESCRIPTION_RESULT_UNKNOWN');
      assert.equal(error.ambiguousDescriptionResult, true);
      return true;
    },
  );
  assert.equal(fetchCalls.length, 2, '結果確認401の後も二重POSTせずhealth確認だけに留める');

  fetchCalls = [];
  context.__mockFetchWithTimeout = async (url, options = {}) => {
    fetchCalls.push({ url: String(url), options });
    return response(200, '<html>broken</html>', { raw: true });
  };
  const originalConsoleWarn = context.console.warn;
  context.console.warn = () => {};
  try {
    await assert.rejects(
      hooks.recoverDescriptionNetworkFailure_(
        'https://current.trycloudflare.com',
        operationId,
        new Error('Load failed'),
        recoveryOptions(),
      ),
      error => {
        assert.equal(error.code, 'DESCRIPTION_RESULT_UNKNOWN');
        return true;
      },
    );
  } finally {
    context.console.warn = originalConsoleWarn;
  }
  assert.equal(
    fetchCalls.filter(call => call.url.includes('/describe/result')).length,
    2,
    '壊れた結果JSONはGETだけを複数回再試行する',
  );
  assert.equal(
    fetchCalls.filter(call => call.url.includes('/describe/health')).length,
    1,
    '結果JSONを読めなくてもhealthは1回だけ確認する',
  );

  const calls = [];
  context.__mockGetMercariServiceUrl = async () => 'https://current.trycloudflare.com';
  context.__mockFetchListingStyle = async () => '';
  context.__mockBuildDescriptionSystemPrompt = () => 'test prompt';
  context.__mockFetchWithTimeout = async (url, options = {}) => {
    calls.push({ url, options });
    if (String(url).endsWith('/describe')) {
      throw new Error('Load failed');
    }
    const clientRequestId = calls[0].options.headers['X-Operation-Id'];
    return response(200, successEnvelope(clientRequestId, '{"result":"from-saved-operation"}'));
  };
  vm.runInContext(`
    getMercariServiceUrl = globalThis.__mockGetMercariServiceUrl;
    fetchListingStyleFromMac = globalThis.__mockFetchListingStyle;
    buildDescriptionSystemPrompt = globalThis.__mockBuildDescriptionSystemPrompt;
    fetchWithTimeout = (...args) => globalThis.__mockFetchWithTimeout(...args);
  `, context);

  const recoveredText = await hooks.callDescriptionAi([
    { mediaType: 'image/jpeg', base64: 'YWJj' },
  ]);
  assert.equal(recoveredText, '{"result":"from-saved-operation"}');
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/describe$/);
  assert.match(calls[1].url, /\/describe\/result\?operationId=/);
  assert.match(calls[0].options.headers['X-Operation-Id'], /^describe-/);
  assert.equal(
    calls.filter(call => call.options?.method === 'POST').length,
    1,
    '応答喪失後もPOSTは絶対に再送しない',
  );

  const malformedCalls = [];
  context.__mockFetchWithTimeout = async (url, options = {}) => {
    malformedCalls.push({ url: String(url), options });
    if (String(url).endsWith('/describe')) {
      return response(502, '<html>gateway response lost</html>', { raw: true });
    }
    const clientRequestId = malformedCalls[0].options.headers['X-Operation-Id'];
    return response(200, successEnvelope(clientRequestId, '{"result":"after-broken-502"}'));
  };
  const malformedRecovered = await hooks.callDescriptionAi([
    { mediaType: 'image/jpeg', base64: 'YWJj' },
  ]);
  assert.equal(malformedRecovered, '{"result":"after-broken-502"}');
  assert.equal(malformedCalls.filter(call => call.options?.method === 'POST').length, 1);
  assert.equal(malformedCalls.filter(call => call.url.includes('/describe/result')).length, 1);

  const rateCalls = [];
  context.__mockFetchWithTimeout = async (url, options = {}) => {
    rateCalls.push({ url: String(url), options });
    return response(429, {
      ok: false,
      code: 'OPENAI_RATE_LIMITED',
      error: 'Rate limit reached',
      requestId: 'direct-rate-request',
    });
  };
  await assert.rejects(
    hooks.callDescriptionAi([{ mediaType: 'image/jpeg', base64: 'YWJj' }]),
    error => {
      assert.equal(error.code, 'OPENAI_RATE_LIMITED');
      assert.match(error.message, /混み合っています/);
      return true;
    },
  );
  assert.equal(rateCalls.length, 1, '正しい429 JSONはその場で判定し、結果GETを増やさない');

  console.log(JSON.stringify({
    ok: true,
    directBillingMessage: true,
    directRateLimitMessage: true,
    lostResponseSuccessRecovery: true,
    malformedNon2xxRecovery: true,
    processingFailureRecovery: true,
    ambiguousResultGuard: true,
    operationIdMatch: true,
    version: 'v20260906b',
  }));
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
