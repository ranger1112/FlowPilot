// background/phone-error-classifier.js
// 手机验证流程的错误分类与构造工具。
// 历史背景：
//   phone-verification-flow.js 4.5k 行单文件，里面塞了一大块「纯函数 + i18n 文案匹配 + 自定义 prefix code」的
//   错误识别/构造逻辑（buildPhoneCodeTimeoutError / isPhoneResend* / isPhoneRoute405* 等）。
//   这块跟 SMS provider、state 没关系，单纯就是「拿到一个 error/字符串 → 分类」，
//   抽出来独立维护可以让 phone-verification-flow.js 瘦身、便于复用、便于单测。
//
// 设计：
//   - 工厂模式 + 注入 prefix 常量，跟 contribution-registry / kiro-timeouts 保持同款 IFE 风格；
//   - 不做副作用（不读 chrome / state），所有依赖通过参数注入；
//   - phone-verification-flow.js 在工厂顶部 destructure 引用，所有原调用点零修改；
//   - 没拿到模块时（旧测试 fallback）走 inline 同名实现，向后兼容。

(function attachBackgroundPhoneErrorClassifier(root, factory) {
  root.MultiPageBackgroundPhoneErrorClassifier = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundPhoneErrorClassifierModule() {
  const DEFAULT_PHONE_ERROR_PREFIXES = Object.freeze({
    timeout: 'PHONE_CODE_TIMEOUT::',
    restartStep7: 'PHONE_RESTART_STEP7::',
    resendThrottled: 'PHONE_RESEND_THROTTLED::',
    resendBannedNumber: 'PHONE_RESEND_BANNED_NUMBER::',
    resendServer: 'PHONE_RESEND_SERVER_ERROR::',
    route405: 'PHONE_ROUTE_405_RECOVERY_FAILED::',
    maxUsage: 'PHONE_MAX_USAGE_EXCEEDED::',
    staleSignupEmailVerificationCode: 'PHONE_SIGNUP_STALE_EMAIL_VERIFICATION',
  });

  function readErrorMessage(error) {
    return String(error?.message || error || '').trim();
  }

  function createPhoneErrorClassifier(deps = {}) {
    const {
      prefixes = DEFAULT_PHONE_ERROR_PREFIXES,
      formatStep9Reason = (reason) => String(reason || 'unknown'),
      normalizePhoneSmsProvider = (value) => String(value || '').trim().toLowerCase(),
      phoneSmsProvider5simId = '5sim',
    } = deps;

    const PREFIX = { ...DEFAULT_PHONE_ERROR_PREFIXES, ...prefixes };

    // ---------- builders ----------

    function buildPhoneCodeTimeoutError(lastResponse = '') {
      const suffix = lastResponse ? ` HeroSMS 最后状态：${lastResponse}` : '';
      return new Error(`${PREFIX.timeout}等待手机验证码超时。${suffix}`);
    }

    function buildSignupPhoneStaleEmailVerificationError(pageState = {}) {
      const url = String(pageState?.url || pageState?.href || '').trim();
      const message = `步骤 4：OpenAI 在手机短信验证码提交前已切到邮箱验证${url ? `（URL: ${url}）` : ''}。这通常表示当前手机号已关联现有账号或登录路径，请更换手机号后重新开始注册。`;
      const error = new Error(message);
      error.code = PREFIX.staleSignupEmailVerificationCode;
      error.stalePhoneSignupEmailVerification = true;
      if (url) error.url = url;
      error.pageState = pageState;
      return error;
    }

    function buildPhoneResendServerError(error) {
      const message = readErrorMessage(error);
      if (message.startsWith(PREFIX.resendServer)) {
        return new Error(message);
      }
      return new Error(`${PREFIX.resendServer}${message || 'OpenAI contact-verification 页面在重发短信后返回 HTTP ERROR 500。'}`);
    }

    function buildHighRiskResendThrottledError(message = '') {
      return new Error(`${PREFIX.resendThrottled}${message || 'OpenAI 重发短信被限流，且当前配置会按高概率封禁手机号处理。'}`);
    }

    function buildPhoneMaxUsageExceededError(message = '') {
      return new Error(`${PREFIX.maxUsage}${message || 'OpenAI 返回 phone_max_usage_exceeded，当前手机号已达到使用上限。'}`);
    }

    function buildPhoneRestartStep7Error(phoneNumber = '') {
      const suffix = phoneNumber ? ` 当前号码：${phoneNumber}。` : '';
      return new Error(
        `${PREFIX.restartStep7}手机验证重发后仍未收到短信，请从步骤 7 重新获取新号码。${suffix}`
      );
    }

    function buildPhoneReplacementLimitError(maxNumberReplacementAttempts, reason = '') {
      const safeMax = Math.max(0, Math.floor(Number(maxNumberReplacementAttempts) || 0));
      const safeReason = String(reason || 'unknown').trim() || 'unknown';
      return new Error(
        `步骤 9：更换 ${safeMax} 次号码后手机号验证仍未成功。最后原因：${formatStep9Reason(safeReason)}。`
      );
    }

    // ---------- classifiers ----------

    function isPhoneNumberUsedError(value) {
      const text = String(value || '').trim();
      if (!text) return false;
      return /phone_max_usage_exceeded|phone_number_in_use|already\s+linked\s+to\s+the\s+maximum\s+number\s+of\s+accounts|phone\s+number\s+is\s+already\s+(?:in\s+use|linked|registered)|phone\s+number\s+has\s+already\s+been\s+used|already\s+associated\s+with\s+another\s+account|not\s+eligible\s+to\s+be\s+used|cannot\s+be\s+used\s+for\s+verification|号码.*(?:已|被).*(?:使用|占用|绑定|注册)|手机号.*(?:已|被).*(?:使用|占用|绑定|注册)|该手机号.*(?:已|被).*(?:使用|占用|绑定|注册)/i.test(text);
    }

    function isPhoneNumberUsedFailureReason(value) {
      const normalized = String(value || '').trim().toLowerCase();
      if (!normalized) return false;
      return normalized === 'phone_number_used'
        || normalized === 'phone_number_in_use'
        || normalized === 'phone_max_usage_exceeded'
        || isPhoneNumberUsedError(normalized);
    }

    function isPhoneNumberInvalidError(value) {
      const text = String(value || '').trim();
      if (!text) return false;
      return /phone\s+number\s+is\s+not\s+valid|invalid\s+phone\s+number|invalid\s+phone|not\s+a\s+valid\s+phone|号码.*无效|手机号.*无效|电话号码.*无效/i.test(text);
    }

    function isPhoneNumberDeliveryRefusedError(value) {
      const text = String(value || '').trim();
      if (!text) return false;
      return /无法向此电话号码发送验证码|无法向.*(?:电话号码|手机号|号码).*发送(?:验证码|短信)|(?:不能|无法).*发送.*(?:验证码|短信).*(?:电话号码|手机号|号码)|(?:cannot|can't|could\s*not|couldn't|unable\s+to)\s+(?:send|deliver).{0,80}(?:verification\s+code|code|sms|text(?:\s+message)?).{0,80}(?:phone|number)|(?:verification\s+code|sms|text(?:\s+message)?).{0,80}(?:cannot|can't|could\s*not|couldn't|unable\s+to).{0,80}(?:send|deliver)/i.test(text);
    }

    function isRecoverableAddPhoneSubmitError(value) {
      const text = String(value || '').trim();
      if (!text) return false;
      return (
        isPhoneNumberInvalidError(text)
        || /failed\s+to\s+select\b.*add-phone\s+page|missing\s+the\s+country\s+option|could\s+not\s+determine\s+the\s+dial\s+code|add-phone\s+page\s+is\s+missing\s+the\s+phone\s+number\s+input|add-phone\s+page\s+is\s+missing\s+the\s+submit\s+button/i.test(text)
      );
    }

    function isSignupEmailVerificationPageState(pageState = {}) {
      const url = String(pageState?.url || pageState?.href || '').trim();
      return Boolean(
        pageState?.emailVerificationPage
        || pageState?.emailVerificationRequired
        || /\/email-verification(?:[/?#]|$)/i.test(url)
      );
    }

    function isPhoneCodeTimeoutError(error) {
      return readErrorMessage(error).startsWith(PREFIX.timeout);
    }

    function isStaleSignupPhoneEmailVerificationError(error) {
      return Boolean(
        error?.stalePhoneSignupEmailVerification
        || error?.code === PREFIX.staleSignupEmailVerificationCode
      );
    }

    function isPhoneResendThrottledError(error) {
      const message = readErrorMessage(error);
      if (!message) return false;
      if (message.startsWith(PREFIX.resendThrottled)) return true;
      return /tried\s+to\s+resend\s+too\s+many\s+times|please\s+try\s+again\s+later|too\s+many\s+resend|resend\s+too\s+many|发送.*过于频繁|稍后再试/i.test(message);
    }

    function isPhoneResendBannedNumberError(error) {
      const message = readErrorMessage(error);
      if (!message) return false;
      if (message.startsWith(PREFIX.resendBannedNumber)) return true;
      return /无法向此(?:电话|手机)号码发送(?:短信|文本消息)|无法发送(?:短信|文本消息)到此(?:电话|手机)号码|can(?:not|'t)\s+send\s+(?:an?\s+)?(?:sms|text(?:\s+message)?)\s+to\s+(?:this|that)\s+(?:phone\s+)?number|unable\s+to\s+send\s+(?:an?\s+)?(?:sms|text(?:\s+message)?)\s+to\s+(?:this|that)\s+(?:phone\s+)?number/i.test(message);
    }

    function isPhoneResendServerError(error) {
      const message = readErrorMessage(error);
      if (!message) return false;
      if (message.startsWith(PREFIX.resendServer)) return true;
      return /this\s+page\s+isn['’]?t\s+working|currently\s+unable\s+to\s+handle\s+this\s+request|http\s+error\s+500|500\s+internal\s+server\s+error/i.test(message);
    }

    function isPhoneMaxUsageExceededFlowError(error) {
      const message = readErrorMessage(error);
      return message.startsWith(PREFIX.maxUsage) || isPhoneNumberUsedError(message);
    }

    function isPhoneRoute405RecoveryError(error) {
      const message = readErrorMessage(error);
      if (!message) return false;
      if (message.startsWith(PREFIX.route405)) return true;
      return /route\s+error.*405|405\s+method\s+not\s+allowed|post\s+request\s+to\s+["']?\/phone-verification|did\s+not\s+provide\s+an?\s+[`'"]?action/i.test(message);
    }

    function isPhoneActivationOrderMissingError(error, provider = '') {
      const message = readErrorMessage(error);
      if (!message) return false;
      const normalizedProvider = normalizePhoneSmsProvider(provider);
      if (normalizedProvider === phoneSmsProvider5simId) {
        return /5sim\s+check\s+activation\s+failed.*order\s+not\s+found|order\s+not\s+found|activation\s+not\s+found|no\s+such\s+order|订单不存在|订单.*失效/i.test(message);
      }
      return /activation\s+not\s+found|order\s+not\s+found|no\s+such\s+order|订单不存在|订单.*失效/i.test(message);
    }

    function isStopRequestedError(error) {
      const message = readErrorMessage(error);
      if (!message) return false;
      return message === '流程已被用户停止。'
        || /已被用户停止/.test(message)
        || /flow\s+was\s+stopped|stopped\s+by\s+user/i.test(message);
    }

    function isAuthContentScriptUnreachableError(error) {
      const message = readErrorMessage(error);
      return /Receiving end does not exist|Could not establish connection|Frame with ID \d+ is showing error page|等待认证页状态检查超时/i.test(message);
    }

    // ---------- sanitizers ----------

    function sanitizePhoneCodeTimeoutError(error) {
      const message = String(error?.message || '');
      if (!message.startsWith(PREFIX.timeout)) {
        return error;
      }
      return new Error(message.slice(PREFIX.timeout.length).trim() || '等待手机验证码超时。');
    }

    function sanitizePhoneRestartStep7Error(error) {
      const message = String(error?.message || '');
      if (!message.startsWith(PREFIX.restartStep7)) {
        return error;
      }
      return new Error(
        message.slice(PREFIX.restartStep7.length).trim()
        || '手机验证重发后仍未收到短信，请从步骤 7 重新获取新号码。'
      );
    }

    return {
      // builders
      buildPhoneCodeTimeoutError,
      buildSignupPhoneStaleEmailVerificationError,
      buildPhoneResendServerError,
      buildHighRiskResendThrottledError,
      buildPhoneMaxUsageExceededError,
      buildPhoneRestartStep7Error,
      buildPhoneReplacementLimitError,
      // classifiers
      isPhoneNumberUsedError,
      isPhoneNumberUsedFailureReason,
      isPhoneNumberInvalidError,
      isPhoneNumberDeliveryRefusedError,
      isRecoverableAddPhoneSubmitError,
      isSignupEmailVerificationPageState,
      isPhoneCodeTimeoutError,
      isStaleSignupPhoneEmailVerificationError,
      isPhoneResendThrottledError,
      isPhoneResendBannedNumberError,
      isPhoneResendServerError,
      isPhoneMaxUsageExceededFlowError,
      isPhoneRoute405RecoveryError,
      isPhoneActivationOrderMissingError,
      isStopRequestedError,
      isAuthContentScriptUnreachableError,
      // sanitizers
      sanitizePhoneCodeTimeoutError,
      sanitizePhoneRestartStep7Error,
      // exposed for diagnostic / fallback consumers
      prefixes: PREFIX,
    };
  }

  return {
    DEFAULT_PHONE_ERROR_PREFIXES,
    createPhoneErrorClassifier,
  };
});
