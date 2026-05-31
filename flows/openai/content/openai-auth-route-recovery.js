// flows/openai/content/openai-auth-route-recovery.js
// OpenAI 认证页 405 路由错误恢复工具。
//
// 历史背景：
//   openai-auth.js 7946 行 monolith 里塞了一组围绕 OpenAI auth 域名 405 错误页面的恢复逻辑：
//   `is405MethodNotAllowedPage / handle405ResendError / getStep405Recovery* / setStep405RecoveryCount`
//   等纯 DOM + sessionStorage 操作，没碰 React/state；从 openai-auth.js 整体职责
//   看跟 page recovery 同款，独立成 module 之后主文件能瘦一圈。
//
// 设计：
//   - IFE + 工厂模式 + 注入依赖，跟 phone-country-utils / auth-page-recovery / phone-auth 同款；
//   - 不读 chrome / state，不耦合 i18n 文案，所有依赖（log, recoverCurrentAuthRetryPage）通过参数注入；
//   - 主文件 openai-auth.js 在常量块之后 destructure 出本模块的 API，原所有调用点零修改；
//   - 三个常量也通过 module 命名空间暴露给主文件原地复用，
//     避免重复声明造成两份事实来源。
//
// 外部约束：
//   background.js 与 tests/auto-run-add-phone-stop.test.js 仅通过字符串字面量 `STEP4_405_RECOVERY_LIMIT::`
//   匹配 error message —— 它们 *不* 引用 JS identifier，本次重命名/搬迁不会影响它们。

(function attachOpenAIAuthRouteRecovery(root, factory) {
  root.MultiPageOpenAIAuthRouteRecovery = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createOpenAIAuthRouteRecoveryModule() {
  const AUTH_ROUTE_ERROR_PATTERN = /405\s+method\s+not\s+allowed|route\s+error.*405|did\s+not\s+provide\s+an?\s+[`'"]?action|post\s+request\s+to\s+["']?\/email-verification/i;
  const STEP4_405_RECOVERY_ERROR_PREFIX = 'STEP4_405_RECOVERY_LIMIT::';
  const STEP4_405_RECOVERY_LIMIT = 3;

  function createOpenAIAuthRouteRecovery(deps = {}) {
    const {
      log = () => {},
      recoverCurrentAuthRetryPage,
    } = deps;
    if (typeof recoverCurrentAuthRetryPage !== 'function') {
      throw new Error('createOpenAIAuthRouteRecovery requires recoverCurrentAuthRetryPage function');
    }

    function is405MethodNotAllowedPage() {
      const pageText = (typeof document !== 'undefined' ? document.body?.textContent : '') || '';
      return AUTH_ROUTE_ERROR_PATTERN.test(pageText);
    }

    function getStep405RecoveryStateKey(step) {
      return `__MULTIPAGE_STEP_${Number(step) || '?'}_405_RECOVERY_COUNT__`;
    }

    function getStep405StorageScope() {
      if (typeof window !== 'undefined' && window) {
        return window;
      }
      if (typeof globalThis !== 'undefined' && globalThis) {
        return globalThis;
      }
      return {};
    }

    function getStep405RecoveryLimit(step) {
      if (Number(step) !== 4) {
        return 0;
      }
      return STEP4_405_RECOVERY_LIMIT;
    }

    function getStep405RecoveryErrorPrefix(step) {
      if (Number(step) !== 4) {
        return '';
      }
      return STEP4_405_RECOVERY_ERROR_PREFIX;
    }

    function getStep405RecoveryCount(step) {
      const key = getStep405RecoveryStateKey(step);
      let value = '';
      try {
        if (typeof sessionStorage !== 'undefined' && sessionStorage?.getItem) {
          value = sessionStorage.getItem(key) || '';
        }
      } catch {}
      if (!value) {
        value = getStep405StorageScope()[key];
      }
      return Math.max(0, Math.floor(Number(value) || 0));
    }

    function setStep405RecoveryCount(step, count) {
      const key = getStep405RecoveryStateKey(step);
      const value = String(Math.max(0, Math.floor(Number(count) || 0)));
      try {
        if (typeof sessionStorage !== 'undefined' && sessionStorage?.setItem) {
          sessionStorage.setItem(key, value);
        }
      } catch {}
      getStep405StorageScope()[key] = value;
    }

    function clearStep405RecoveryCount(step) {
      const key = getStep405RecoveryStateKey(step);
      try {
        if (typeof sessionStorage !== 'undefined' && sessionStorage?.removeItem) {
          sessionStorage.removeItem(key);
        }
      } catch {}
      try {
        delete getStep405StorageScope()[key];
      } catch {}
    }

    function createStep405RecoveryLimitError(step, count) {
      const normalizedStep = Number(step) || step || '?';
      const limit = getStep405RecoveryLimit(normalizedStep) || count;
      const hrefSuffix = (typeof location !== 'undefined' && location?.href) ? location.href : '';
      const message = `步骤 ${normalizedStep}：检测到 405 错误页面，已连续点击“重试”恢复 ${count}/${limit} 次仍未恢复，当前轮将结束并进入下一轮。URL: ${hrefSuffix}`;
      return new Error(`${getStep405RecoveryErrorPrefix(normalizedStep)}${message}`);
    }

    async function handle405ResendError(step, remainingTimeout = 30000) {
      const currentCount = getStep405RecoveryCount(step);
      if (Number(step) === 4 && currentCount >= getStep405RecoveryLimit(step)) {
        throw createStep405RecoveryLimitError(step, currentCount);
      }

      const nextCount = currentCount + 1;
      setStep405RecoveryCount(step, nextCount);
      const maxClickAttempts = Number(step) === 4 ? 1 : 5;
      await recoverCurrentAuthRetryPage({
        logLabel: Number(step) === 4
          ? `步骤 ${step}：检测到 405 错误页面，正在点击“重试”恢复（总计 ${nextCount}/${getStep405RecoveryLimit(step)}）`
          : `步骤 ${step}：检测到 405 错误页面，正在点击“重试”恢复`,
        maxClickAttempts,
        pathPatterns: [],
        step,
        timeoutMs: Math.max(1000, remainingTimeout),
      });
      if (is405MethodNotAllowedPage()) {
        throw createStep405RecoveryLimitError(step, nextCount);
      }
      clearStep405RecoveryCount(step);
      log(`步骤 ${step}：405 错误已恢复，页面已返回验证码页面。`);
    }

    return {
      // constants (also exposed at module top-level for early-binding consumers)
      AUTH_ROUTE_ERROR_PATTERN,
      STEP4_405_RECOVERY_ERROR_PREFIX,
      STEP4_405_RECOVERY_LIMIT,
      // helpers
      is405MethodNotAllowedPage,
      getStep405RecoveryStateKey,
      getStep405StorageScope,
      getStep405RecoveryLimit,
      getStep405RecoveryErrorPrefix,
      getStep405RecoveryCount,
      setStep405RecoveryCount,
      clearStep405RecoveryCount,
      createStep405RecoveryLimitError,
      handle405ResendError,
    };
  }

  return {
    AUTH_ROUTE_ERROR_PATTERN,
    STEP4_405_RECOVERY_ERROR_PREFIX,
    STEP4_405_RECOVERY_LIMIT,
    createOpenAIAuthRouteRecovery,
  };
});
