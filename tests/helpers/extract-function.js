// tests/helpers/extract-function.js
// 共享版 extractFunction：
//   过去 94 个 test 文件每个都内联同一份 ~50 行的解析逻辑，
//   完全靠在单个 source 字符串里 indexOf 来定位 `function name(` / `async function name(`，
//   再括号配对找 body。
//
// 新增能力：
//   - 支持「多文件源」：传入 file paths 数组，按顺序在每个文件里找；
//     第一份命中就返回。这是 #4 拆 openai-auth.js 的关键——
//     让 19 个测试无须知道 function 落到了哪个新模块。
//   - 仍然支持原始的「单 source 字符串」用法，全量向后兼容。
//
// 解析逻辑跟历史 inline 版一字不差，避免行为漂移。

const fs = require('node:fs');

function extractFromSource(source, name) {
  const markers = [`async function ${name}(`, `function ${name}(`];
  const start = markers
    .map((marker) => source.indexOf(marker))
    .find((index) => index >= 0);
  if (start === undefined || start < 0) {
    return null;
  }

  let parenDepth = 0;
  let signatureEnded = false;
  let braceStart = -1;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(') {
      parenDepth += 1;
    } else if (ch === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) {
        signatureEnded = true;
      }
    } else if (ch === '{' && signatureEnded) {
      braceStart = i;
      break;
    }
  }
  if (braceStart < 0) {
    return null;
  }

  let depth = 0;
  let end = braceStart;
  for (; end < source.length; end += 1) {
    const ch = source[end];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        end += 1;
        break;
      }
    }
  }

  return source.slice(start, end);
}

function extractFunctionFromSource(name, source) {
  const result = extractFromSource(String(source || ''), name);
  if (result === null) {
    throw new Error(`missing function ${name}`);
  }
  return result;
}

/**
 * Build an extractor closed over a fixed list of file paths.
 * Files are read on first call and cached for the process lifetime.
 *
 *   const extractFunction = createFunctionExtractor([
 *     'flows/openai/content/openai-auth.js',
 *     'flows/openai/content/openai-auth-step9.js',
 *   ]);
 *   const body = extractFunction('handlePhoneVerification');
 *
 * The extractor returns the source slice from the first file that contains
 * the named function. Throws if no file contains it.
 */
function createFunctionExtractor(filePaths) {
  if (!Array.isArray(filePaths) || filePaths.length === 0) {
    throw new Error('createFunctionExtractor requires a non-empty array of file paths');
  }
  const sources = filePaths.map((filePath) => ({
    filePath,
    source: null,
  }));

  function ensureLoaded() {
    sources.forEach((entry) => {
      if (entry.source === null) {
        entry.source = fs.readFileSync(entry.filePath, 'utf8');
      }
    });
  }

  return function extractFunction(name) {
    ensureLoaded();
    for (const entry of sources) {
      const result = extractFromSource(entry.source, name);
      if (result !== null) {
        return result;
      }
    }
    throw new Error(
      `missing function ${name} in any of: ${sources.map((s) => s.filePath).join(', ')}`
    );
  };
}

module.exports = {
  extractFunctionFromSource,
  createFunctionExtractor,
};
