// shared/content-script-errors.js
// 内容脚本传输层错误的结构化分类。
// 历史背景：
//   - tab-runtime 在重试超时后会抛出一段中文错误文案，
//     上层（background.js / signup-flow-helpers.js）再用正则反向匹配文案
//     来判断是否“可恢复”。这种「靠 i18n 文案传递语义」的方式很脆——
//     任何人改一个字 log，重试逻辑就静默退化。
// 设计：
//   - 在抛错时挂上 error.code（自定义 ContentScriptTransportError 类，
//     或者已有 Error 实例上挂 .code 属性），下游优先用 code 判断；
//   - 文案保留向后兼容（老测试和老调用仍然能用旧正则识别）。
//
// 这个模块只在 background 域内使用（service worker + 在 background 注入到 tab-runtime 的那条链）。
// content script 暂不需要引入。

(function attachContentScriptErrors(root, factory) {
  root.MultiPageContentScriptErrors = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createContentScriptErrorsModule() {
  // 错误分类码。所有 transport 层（tab-runtime / sendToContentScriptResilient
  // 等）抛出的可恢复错误都应使用这里定义的 code。
  const CONTENT_SCRIPT_ERROR_CODES = Object.freeze({
    // 内容脚本与 background 间在重试期内一直没能重新接回。
    // 由 tab-runtime.buildRetryableTransportTimeoutError 抛出。
    TRANSPORT_TIMEOUT_AFTER_RETRY: 'transport_timeout_after_retry',

    // 等待 source 重新就绪时整体超时（没有捕获到具体的 transport 错）。
    SOURCE_NOT_READY_TIMEOUT: 'source_not_ready_timeout',
  });

  // 自定义错误类型，便于 instanceof 判断与未来扩展。
  class ContentScriptTransportError extends Error {
    constructor(message, code, options = {}) {
      super(message);
      this.name = 'ContentScriptTransportError';
      this.code = code;
      if (options.cause !== undefined) {
        this.cause = options.cause;
      }
    }
  }

  function getErrorCode(error) {
    if (!error || typeof error !== 'object') return '';
    const code = error.code;
    return typeof code === 'string' ? code : '';
  }

  function hasTransportErrorCode(error, code) {
    return getErrorCode(error) === code;
  }

  // 是否为「重试超时后兜底」抛出的可恢复错误（含 fallback：老调用不带 code 时
  // 仍可识别中文文案，保证向后兼容）。
  // 注意：fallback 正则只用于已有现网调用，新代码请直接抛带 code 的 Error。
  const LEGACY_RECOVERABLE_TIMEOUT_PATTERN =
    /页面刚完成跳转或刷新|内容脚本还没有重新接回|扩展已自动重试，但仍未恢复|等待\s*(?:认证页|内容脚本|.+)\s*重新就绪超时/i;

  function isTransportTimeoutAfterRetry(error) {
    if (hasTransportErrorCode(error, CONTENT_SCRIPT_ERROR_CODES.TRANSPORT_TIMEOUT_AFTER_RETRY)) {
      return true;
    }
    const message = String(error?.message || error || '');
    return LEGACY_RECOVERABLE_TIMEOUT_PATTERN.test(message);
  }

  // 给已有的 Error 实例打上 transport code 标记，避免到处 new。
  function tagTransportError(error, code) {
    if (error && typeof error === 'object' && code) {
      try {
        error.code = code;
      } catch {
        // 某些只读 Error 实现可能拒绝赋值，忽略即可——
        // fallback 文案匹配仍然能兜底。
      }
    }
    return error;
  }

  return {
    CONTENT_SCRIPT_ERROR_CODES,
    ContentScriptTransportError,
    getErrorCode,
    hasTransportErrorCode,
    isTransportTimeoutAfterRetry,
    tagTransportError,
  };
});
