'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadTransportModule() {
  const code = fs.readFileSync('background/content-script-transport.js', 'utf8');
  const sandbox = { self: {}, globalThis: {} };
  sandbox.self.globalThis = sandbox.globalThis;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox.self.MultiPageBackgroundContentScriptTransport;
}

const transportApi = loadTransportModule();

function deferredError(message, code) {
  const error = new Error(message);
  if (code) error.code = code;
  return error;
}

test('content-script-transport module exposes createContentScriptTransport', () => {
  assert.equal(typeof transportApi?.createContentScriptTransport, 'function');
});

test('createContentScriptTransport throws if mandatory deps missing', () => {
  assert.throws(
    () => transportApi.createContentScriptTransport({}),
    /ensureContentScriptReadyOnTab/
  );
  assert.throws(
    () => transportApi.createContentScriptTransport({
      ensureContentScriptReadyOnTab: () => {},
    }),
    /sendToContentScriptResilient/
  );
});

test('prepareWithRetry returns send result on first success without retry', async () => {
  let ensureCalls = 0;
  let sendCalls = 0;
  let stableCalls = 0;

  const { prepareWithRetry } = transportApi.createContentScriptTransport({
    ensureContentScriptReadyOnTab: async () => { ensureCalls += 1; },
    sendToContentScriptResilient: async () => {
      sendCalls += 1;
      return { ok: true };
    },
    waitForTabStableComplete: async () => { stableCalls += 1; },
  });

  const result = await prepareWithRetry({
    source: 'openai-auth',
    tabId: 7,
    request: { type: 'PING' },
    injectFiles: ['x.js'],
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(ensureCalls, 1);
  assert.equal(sendCalls, 1);
  assert.equal(stableCalls, 0, 'stable wait should not run on first attempt');
});

test('prepareWithRetry retries when send throws recoverable code error and succeeds afterward', async () => {
  let ensureCalls = 0;
  let sendCalls = 0;
  let stableCalls = 0;
  const retryLogs = [];

  const { prepareWithRetry } = transportApi.createContentScriptTransport({
    addLog: async (message, level) => { retryLogs.push({ message, level }); },
    ensureContentScriptReadyOnTab: async () => { ensureCalls += 1; },
    isRetryableContentScriptTransportError: () => false,
    sendToContentScriptResilient: async () => {
      sendCalls += 1;
      if (sendCalls === 1) {
        throw deferredError('boom', 'transport_timeout_after_retry');
      }
      return { ok: true, retried: 1 };
    },
    waitForTabStableComplete: async () => { stableCalls += 1; },
  });

  const result = await prepareWithRetry({
    source: 'openai-auth',
    tabId: 13,
    request: { type: 'PING' },
    injectFiles: ['x.js'],
    retryAttemptLogMessage: ({ attempt, maxAttempts }) =>
      `retry ${attempt}/${maxAttempts}`,
  });

  assert.deepEqual(result, { ok: true, retried: 1 });
  assert.equal(ensureCalls, 2);
  assert.equal(sendCalls, 2);
  assert.equal(stableCalls, 1, 'stable wait should run on attempt 2');
  assert.equal(retryLogs.length, 1);
  assert.match(retryLogs[0].message, /retry 1\/3/);
});

test('prepareWithRetry rethrows non-recoverable errors immediately without retry', async () => {
  let ensureCalls = 0;
  let sendCalls = 0;

  const { prepareWithRetry } = transportApi.createContentScriptTransport({
    ensureContentScriptReadyOnTab: async () => { ensureCalls += 1; },
    isRetryableContentScriptTransportError: () => false,
    sendToContentScriptResilient: async () => {
      sendCalls += 1;
      throw new Error('totally fatal');
    },
  });

  await assert.rejects(
    () => prepareWithRetry({
      source: 'openai-auth',
      tabId: 13,
      request: { type: 'PING' },
      injectFiles: ['x.js'],
    }),
    /totally fatal/
  );

  assert.equal(sendCalls, 1);
  assert.equal(ensureCalls, 1);
});

test('prepareWithRetry honors finalErrorMessage after exhausting attempts and preserves error.code', async () => {
  let sendCalls = 0;
  const logs = [];

  const { prepareWithRetry } = transportApi.createContentScriptTransport({
    addLog: async (message, level) => { logs.push({ message, level }); },
    ensureContentScriptReadyOnTab: async () => {},
    isRetryableContentScriptTransportError: () => true,
    sendToContentScriptResilient: async () => {
      sendCalls += 1;
      throw deferredError('still down', 'transport_timeout_after_retry');
    },
  });

  let caught = null;
  try {
    await prepareWithRetry({
      source: 'openai-auth',
      tabId: 13,
      request: { type: 'PING' },
      injectFiles: ['x.js'],
      maxAttempts: 3,
      retryAttemptLogMessage: ({ attempt }) => `attempt ${attempt}`,
      finalErrorMessage: ({ maxAttempts }) =>
        `gave up after ${maxAttempts} attempts`,
    });
  } catch (err) {
    caught = err;
  }

  assert.ok(caught, 'should throw final error');
  assert.match(caught.message, /gave up after 3 attempts/);
  assert.equal(caught.code, 'transport_timeout_after_retry', 'final error preserves transport code');
  assert.ok(caught.cause, 'final error should keep original cause');
  assert.equal(sendCalls, 3);
  assert.equal(
    logs.filter((entry) => /^attempt /.test(entry.message)).length,
    2,
    'should log retry warning twice (between attempts 1->2 and 2->3)',
  );
  assert.ok(
    logs.some((entry) => /gave up after 3 attempts/.test(entry.message)),
    'should log final failure message',
  );
});

test('prepareWithRetry custom isRecoverableError overrides default classifier', async () => {
  let sendCalls = 0;

  const { prepareWithRetry } = transportApi.createContentScriptTransport({
    ensureContentScriptReadyOnTab: async () => {},
    isRetryableContentScriptTransportError: () => false,
    sendToContentScriptResilient: async () => {
      sendCalls += 1;
      if (sendCalls < 2) throw new Error('custom signal');
      return { ok: true };
    },
  });

  const result = await prepareWithRetry({
    source: 'openai-auth',
    tabId: 13,
    request: { type: 'PING' },
    injectFiles: ['x.js'],
    isRecoverableError: (err) => /custom signal/.test(String(err?.message || '')),
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(sendCalls, 2);
});

test('prepareWithRetry validates required parameters', async () => {
  const { prepareWithRetry } = transportApi.createContentScriptTransport({
    ensureContentScriptReadyOnTab: async () => {},
    sendToContentScriptResilient: async () => ({ ok: true }),
  });

  await assert.rejects(
    () => prepareWithRetry({ tabId: 1, request: {} }),
    /options\.source/
  );
  await assert.rejects(
    () => prepareWithRetry({ source: 's', request: {} }),
    /options\.tabId/
  );
  await assert.rejects(
    () => prepareWithRetry({ source: 's', tabId: 1 }),
    /options\.request/
  );
});
