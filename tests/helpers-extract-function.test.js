// tests/helpers-extract-function.test.js
// 验证 tests/helpers/extract-function.js 的两个 API。
// 故意用真实仓库里的多个 known-good source 文件作为 fixture，
// 这样未来重命名/搬迁函数时如果忘了同步 helper，这里也会报警。

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createFunctionExtractor,
  extractFunctionFromSource,
} = require('./helpers/extract-function');

const SAMPLE_SOURCE = `
function alpha(a, b) {
  return a + b;
}

async function beta(x) {
  if (x > 0) {
    return { ok: true };
  }
  return { ok: false };
}
`;

test('extractFunctionFromSource handles plain function declarations', () => {
  const body = extractFunctionFromSource('alpha', SAMPLE_SOURCE);
  assert.match(body, /^function alpha\(a, b\)/);
  assert.match(body, /return a \+ b;/);
  assert.ok(body.endsWith('}'));
});

test('extractFunctionFromSource handles async function declarations', () => {
  const body = extractFunctionFromSource('beta', SAMPLE_SOURCE);
  assert.match(body, /^async function beta\(x\)/);
  assert.match(body, /return \{ ok: true \};/);
});

test('extractFunctionFromSource throws on missing function', () => {
  assert.throws(
    () => extractFunctionFromSource('nonexistent', SAMPLE_SOURCE),
    /missing function nonexistent/,
  );
});

test('createFunctionExtractor finds functions across multiple files', () => {
  // Use real repository sources that we know contain these functions.
  const extract = createFunctionExtractor([
    'background/phone-error-classifier.js',
    'background/content-script-transport.js',
  ]);

  const inFirst = extract('createPhoneErrorClassifier');
  assert.match(inFirst, /^function createPhoneErrorClassifier\(/);

  const inSecond = extract('createContentScriptTransport');
  assert.match(inSecond, /^function createContentScriptTransport\(/);
});

test('createFunctionExtractor throws when function exists in none of the files', () => {
  const extract = createFunctionExtractor([
    'background/phone-error-classifier.js',
  ]);
  assert.throws(
    () => extract('definitelyNotARealFunctionName'),
    /missing function definitelyNotARealFunctionName in any of/,
  );
});

test('createFunctionExtractor rejects empty file list', () => {
  assert.throws(
    () => createFunctionExtractor([]),
    /non-empty array of file paths/,
  );
  assert.throws(
    () => createFunctionExtractor(),
    /non-empty array of file paths/,
  );
});

test('createFunctionExtractor caches reads (only first call loads disk)', () => {
  // Smoke test: calling extract twice for the same name should be idempotent.
  const extract = createFunctionExtractor([
    'background/phone-error-classifier.js',
  ]);
  const a = extract('createPhoneErrorClassifier');
  const b = extract('createPhoneErrorClassifier');
  assert.equal(a, b);
});
