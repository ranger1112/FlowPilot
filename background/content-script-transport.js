// background/content-script-transport.js
// 内容脚本传输层的高阶编排工具。
// 当前提供 prepareWithRetry：
//   把「ensureReady → 可选 waitStable → send → 捕获可恢复错误 → 重试」
//   这套在 signup step3 finalize 出现的模式抽出来给后续 step 共用。
//
// 设计原则：
//   - 不替换 ensureContentScriptReadyOnTab / sendToContentScriptResilient，
//     只是把它们组合成「带重试上下文」的高阶调用；
//   - 错误分类一律走 ContentScriptTransportError code 优先 + 文案 fallback，
//     与 shared/content-script-errors.js 的契约保持一致；
//   - 不在工具内硬编码任何业务文案，所有 log copy 由调用方传入，
//     避免又退化回「靠 i18n 文案传递语义」。

(function attachContentScriptTransport(root, factory) {
  root.MultiPageBackgroundContentScriptTransport = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createContentScriptTransportModule() {
  function createContentScriptTransport(deps = {}) {
    const {
      addLog = null,
      ensureContentScriptReadyOnTab,
      isRetryableContentScriptTransportError = () => false,
      sendToContentScriptResilient,
      waitForTabStableComplete = null,
    } = deps;

    if (typeof ensureContentScriptReadyOnTab !== 'function') {
      throw new Error('createContentScriptTransport requires ensureContentScriptReadyOnTab');
    }
    if (typeof sendToContentScriptResilient !== 'function') {
      throw new Error('createContentScriptTransport requires sendToContentScriptResilient');
    }

    function defaultIsRecoverableError(error) {
      if (isRetryableContentScriptTransportError(error)) return true;
      const code = error && typeof error === 'object' ? String(error.code || '') : '';
      return code === 'transport_timeout_after_retry';
    }

    async function safeAddLog(message, level = 'warn', meta = null) {
      if (!message || typeof addLog !== 'function') return;
      try {
        if (meta) {
          await addLog(message, level, meta);
        } else {
          await addLog(message, level);
        }
      } catch {
        // 日志失败不影响主流程
      }
    }

    function resolveLogCopy(value, ctx) {
      if (typeof value === 'function') return value(ctx) || '';
      return value || '';
    }

    /**
     * 在一个 tab 上执行「确保内容脚本就绪 → 发送请求 → 失败时按可恢复性重试」流程。
     *
     * @param {Object} options
     * @param {string} options.source                 内容脚本 source key（如 'openai-auth'）
     * @param {number} options.tabId                  目标 tab id
     * @param {Object} options.request                要发给 content script 的消息
     * @param {string[]} [options.injectFiles]        ensureReady 注入文件列表
     * @param {string}   [options.injectSource]       注入时挂到 window 的 source 标记
     * @param {number}   [options.maxAttempts=3]
     * @param {number}   [options.ensureReadyTimeoutMs=45000]         首次 ensureReady 的超时
     * @param {number}   [options.ensureReadyRetryTimeoutMs=30000]    重试时 ensureReady 的超时
     * @param {number}   [options.ensureReadyRetryDelayMs=900]
     * @param {string|Function} [options.ensureReadyFirstLogMessage]
     * @param {string|Function} [options.ensureReadyRetryLogMessage]  接收 { attempt, maxAttempts }
     * @param {boolean}  [options.waitForStableOnRetry=true]
     * @param {Object}   [options.stableWaitOptions]                  传给 waitForTabStableComplete 的参数
     * @param {number}   [options.sendTimeoutMs=30000]
     * @param {number}   [options.sendRetryDelayMs=700]
     * @param {string|Function} [options.sendLogMessage]              首次 send 时记的等待提示
     * @param {Function} [options.isRecoverableError]                 自定义可恢复错误判定（默认基于 code 判断）
     * @param {string|Function} [options.retryAttemptLogMessage]      接收 { attempt, maxAttempts, error }
     * @param {string|Function} [options.finalErrorMessage]           接收 { maxAttempts, error }
     * @returns {Promise<any>}                                        sendToContentScriptResilient 的返回值
     */
    async function prepareWithRetry(options = {}) {
      const {
        source,
        tabId,
        request,
        injectFiles = null,
        injectSource = null,
        maxAttempts = 3,
        ensureReadyTimeoutMs = 45000,
        ensureReadyRetryTimeoutMs = 30000,
        ensureReadyRetryDelayMs = 900,
        ensureReadyFirstLogMessage = '',
        ensureReadyRetryLogMessage = '',
        waitForStableOnRetry = true,
        stableWaitOptions = {
          timeoutMs: 20000,
          retryDelayMs: 300,
          stableMs: 800,
          initialDelayMs: 300,
        },
        sendTimeoutMs = 30000,
        sendRetryDelayMs = 700,
        sendLogMessage = '',
        isRecoverableError = defaultIsRecoverableError,
        retryAttemptLogMessage = '',
        finalErrorMessage = '',
      } = options;

      if (!source) throw new Error('prepareWithRetry requires options.source');
      if (!Number.isInteger(tabId)) {
        throw new Error('prepareWithRetry requires integer options.tabId');
      }
      if (!request || typeof request !== 'object') {
        throw new Error('prepareWithRetry requires options.request');
      }
      const effectiveMaxAttempts = Math.max(1, Math.floor(Number(maxAttempts) || 1));

      let lastRecoverableError = null;

      for (let attempt = 1; attempt <= effectiveMaxAttempts; attempt += 1) {
        const isFirstAttempt = attempt === 1;
        const ensureLogCtx = { attempt, maxAttempts: effectiveMaxAttempts };
        const ensureReadyLogMessage = isFirstAttempt
          ? resolveLogCopy(ensureReadyFirstLogMessage, ensureLogCtx)
          : resolveLogCopy(ensureReadyRetryLogMessage, ensureLogCtx);

        await ensureContentScriptReadyOnTab(source, tabId, {
          inject: injectFiles,
          injectSource,
          timeoutMs: isFirstAttempt ? ensureReadyTimeoutMs : ensureReadyRetryTimeoutMs,
          retryDelayMs: ensureReadyRetryDelayMs,
          logMessage: ensureReadyLogMessage,
        });

        if (
          !isFirstAttempt
          && waitForStableOnRetry
          && typeof waitForTabStableComplete === 'function'
        ) {
          await waitForTabStableComplete(tabId, stableWaitOptions).catch(() => null);
        }

        try {
          const result = await sendToContentScriptResilient(source, request, {
            timeoutMs: sendTimeoutMs,
            retryDelayMs: sendRetryDelayMs,
            logMessage: resolveLogCopy(sendLogMessage, ensureLogCtx),
          });
          return result;
        } catch (error) {
          if (!isRecoverableError(error)) {
            throw error;
          }

          lastRecoverableError = error;

          if (attempt < effectiveMaxAttempts) {
            const retryLog = resolveLogCopy(retryAttemptLogMessage, {
              attempt,
              maxAttempts: effectiveMaxAttempts,
              error,
            });
            if (retryLog) {
              await safeAddLog(retryLog, 'warn');
            }
            continue;
          }

          const finalMessageRaw = resolveLogCopy(finalErrorMessage, {
            maxAttempts: effectiveMaxAttempts,
            error,
          });
          if (finalMessageRaw) {
            await safeAddLog(finalMessageRaw, 'warn');
            const finalError = new Error(finalMessageRaw);
            finalError.cause = error;
            // 透传 code，保证上层重试白名单仍能识别
            const code = error && typeof error === 'object' ? error.code : null;
            if (code) finalError.code = code;
            throw finalError;
          }

          throw error;
        }
      }

      // 理论上不会走到这里——循环要么 return 要么 throw。兜底防御。
      if (lastRecoverableError) throw lastRecoverableError;
      throw new Error('prepareWithRetry exhausted attempts without resolution');
    }

    return {
      prepareWithRetry,
    };
  }

  return {
    createContentScriptTransport,
  };
});
