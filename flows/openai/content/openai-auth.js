// flows/openai/content/openai-auth.js — Content script for ChatGPT signup entry + OpenAI auth pages
// Injected on: auth0.openai.com, auth.openai.com, accounts.openai.com
// Dynamically injected on: chatgpt.com

console.log('[MultiPage:openai-auth] Content script loaded on', location.href);

const OPENAI_AUTH_LISTENER_SENTINEL = 'data-multipage-openai-auth-listener';

function getOperationDelayRunner() {
  const rootScope = typeof window !== 'undefined' ? window : globalThis;
  const gate = rootScope?.CodexOperationDelay?.performOperationWithDelay;
  return typeof gate === 'function'
    ? gate
    : async (_metadata, operation) => operation();
}

if (document.documentElement.getAttribute(OPENAI_AUTH_LISTENER_SENTINEL) !== '1') {
  document.documentElement.setAttribute(OPENAI_AUTH_LISTENER_SENTINEL, '1');

  // Listen for commands from Background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (
      message.type === 'EXECUTE_NODE'
      || message.type === 'FILL_CODE'
      || message.type === 'STEP8_FIND_AND_CLICK'
      || message.type === 'STEP8_GET_STATE'
      || message.type === 'STEP8_TRIGGER_CONTINUE'
      || message.type === 'GET_LOGIN_AUTH_STATE'
      || message.type === 'SUBMIT_ADD_EMAIL'
      || message.type === 'GET_STEP5_SUBMIT_STATE'
      || message.type === 'PREPARE_SIGNUP_VERIFICATION'
      || message.type === 'RECOVER_AUTH_RETRY_PAGE'
      || message.type === 'RECOVER_STEP5_SUBMIT_RETRY_PAGE'
      || message.type === 'RESEND_VERIFICATION_CODE'
      || message.type === 'SUBMIT_PHONE_NUMBER'
      || message.type === 'SUBMIT_PHONE_VERIFICATION_CODE'
      || message.type === 'RESEND_PHONE_VERIFICATION_CODE'
      || message.type === 'CHECK_PHONE_RESEND_ERROR'
      || message.type === 'RETURN_TO_ADD_PHONE'
      || message.type === 'ENSURE_SIGNUP_ENTRY_READY'
      || message.type === 'ENSURE_SIGNUP_PHONE_ENTRY_READY'
      || message.type === 'ENSURE_SIGNUP_PASSWORD_PAGE_READY'
    ) {
      resetStopState();
      handleCommand(message).then((result) => {
        sendResponse({ ok: true, ...(result || {}) });
      }).catch(err => {
        const reportedStep = Number(message.payload?.visibleStep) || message.step;
        const reportedNodeId = resolveCommandNodeId(message);
        if (isStopError(err)) {
          if (reportedStep) {
            log(`步骤 ${reportedStep || 8}：已被用户停止。`, 'warn');
          }
          sendResponse({ stopped: true, error: err.message });
          return;
        }

        if (message.type === 'STEP8_FIND_AND_CLICK') {
          log(err.message, 'error', { step: reportedStep || 9, stepKey: 'confirm-oauth' });
          sendResponse({ error: err.message });
          return;
        }

        if (reportedStep) {
          reportError(reportedNodeId || reportedStep, err.message);
        }
        sendResponse({ error: err.message });
      });
      return true;
    }
  });
} else {
  console.log('[MultiPage:openai-auth] 消息监听已存在，跳过重复注册');
}

const OPENAI_AUTH_NODE_HANDLERS = Object.freeze({
  'submit-signup-email': (payload) => step2_clickRegister(payload),
  'fill-password': (payload) => step3_fillEmailPassword(payload),
  'fill-profile': (payload) => step5_fillNameBirthday(payload),
  'oauth-login': (payload) => step6_login(payload),
  'relogin-bound-email': (payload) => step6_login(payload),
  'confirm-oauth': (_payload) => step8_findAndClick(),
});

function resolveCommandNodeId(message = {}) {
  const directNodeId = String(message.nodeId || message.payload?.nodeId || '').trim();
  if (directNodeId) {
    return directNodeId;
  }
  const visibleStep = Number(message.payload?.visibleStep || message.step) || 0;
  if (visibleStep === 4) return 'fetch-signup-code';
  if (message.type === 'FILL_CODE' && (visibleStep === 12 || visibleStep === 15)) {
    return 'fetch-bound-email-login-code';
  }
  if (
    (
      message.type === 'SUBMIT_PHONE_NUMBER'
      || message.type === 'SUBMIT_PHONE_VERIFICATION_CODE'
      || message.type === 'RESEND_PHONE_VERIFICATION_CODE'
      || message.type === 'CHECK_PHONE_RESEND_ERROR'
      || message.type === 'RETURN_TO_ADD_PHONE'
    )
    && (visibleStep === 13 || visibleStep === 16)
  ) {
    return 'post-bound-email-phone-verification';
  }
  if (visibleStep === 8 || visibleStep === 11) return 'fetch-login-code';
  if (visibleStep === 9 || visibleStep === 12) return 'post-login-phone-verification';
  if (visibleStep === 10 || visibleStep === 13) return 'confirm-oauth';
  if (visibleStep === 16) return 'confirm-oauth';
  if (visibleStep === 14 || visibleStep === 15 || visibleStep === 17) return 'platform-verify';
  if (visibleStep === 7) return 'oauth-login';
  if (visibleStep === 5) return 'fill-profile';
  if (visibleStep === 3) return 'fill-password';
  if (visibleStep === 2) return 'submit-signup-email';
  return '';
}

async function handleCommand(message) {
  switch (message.type) {
    case 'EXECUTE_NODE': {
      const nodeId = String(message.nodeId || message.payload?.nodeId || '').trim();
      const handler = OPENAI_AUTH_NODE_HANDLERS[nodeId];
      if (!handler) {
        throw new Error(`openai-auth.js 不处理节点 ${nodeId}`);
      }
      return await handler(message.payload || {});
    }
    case 'FILL_CODE':
      // Step 4 = signup code, Step 7 = login code (same handler)
      return await fillVerificationCode(message.step, message.payload);
    case 'GET_LOGIN_AUTH_STATE':
      return serializeLoginAuthState(inspectLoginAuthState());
    case 'SUBMIT_ADD_EMAIL':
      return await submitAddEmailAndContinue(message.payload);
    case 'GET_STEP5_SUBMIT_STATE':
      return getStep5SubmitState();
    case 'PREPARE_SIGNUP_VERIFICATION':
      return await prepareSignupVerificationFlow(message.payload);
    case 'RECOVER_AUTH_RETRY_PAGE':
      return await recoverCurrentAuthRetryPage(message.payload);
    case 'RECOVER_STEP5_SUBMIT_RETRY_PAGE':
      return await recoverStep5SubmitRetryPage(message.payload);
    case 'RESEND_VERIFICATION_CODE':
      return await resendVerificationCode(message.step);
    case 'SUBMIT_PHONE_NUMBER':
      return await phoneAuthHelpers.submitPhoneNumber(message.payload);
    case 'SUBMIT_PHONE_VERIFICATION_CODE':
      if (message.payload?.purpose === 'signup') {
        return await fillVerificationCode(message.step || 4, message.payload);
      }
      if (message.payload?.purpose === 'login') {
        return await fillVerificationCode(message.step || 8, message.payload);
      }
      return await submitPhoneVerificationCodeWithProfileFallback(message.payload);
    case 'RESEND_PHONE_VERIFICATION_CODE':
      return await phoneAuthHelpers.resendPhoneVerificationCode(undefined, message.payload || {});
    case 'CHECK_PHONE_RESEND_ERROR':
      return phoneAuthHelpers.checkPhoneResendError();
    case 'RETURN_TO_ADD_PHONE':
      return await phoneAuthHelpers.returnToAddPhone();
    case 'ENSURE_SIGNUP_ENTRY_READY':
      return await ensureSignupEntryReady();
    case 'ENSURE_SIGNUP_PHONE_ENTRY_READY':
      return await ensureSignupPhoneEntryReady();
    case 'ENSURE_SIGNUP_PASSWORD_PAGE_READY':
      return await ensureSignupPasswordPageReady();
    case 'STEP8_FIND_AND_CLICK':
      return await step8_findAndClick(message.payload);
    case 'STEP8_GET_STATE':
      return getStep8State();
    case 'STEP8_TRIGGER_CONTINUE':
      return await step8_triggerContinue(message.payload);
  }
}

function resolveVisibleStep(payload = {}, fallback = 0) {
  const step = Math.floor(Number(payload?.visibleStep) || 0);
  return step > 0 ? step : fallback;
}

function stepLog(step, message, level = 'info', stepKey = '') {
  return log(message, level, { step, stepKey });
}

const VERIFICATION_CODE_INPUT_SELECTOR = [
  'input[name="code"]',
  'input[name="otp"]',
  'input[autocomplete="one-time-code"]',
  'input[type="text"][maxlength="6"]',
  'input[type="tel"][maxlength="6"]',
  'input[aria-label*="code" i]',
  'input[aria-label*="コード"]',
  'input[aria-label*="認証"]',
  'input[aria-label*="確認"]',
  'input[placeholder*="code" i]',
  'input[placeholder*="コード"]',
  'input[placeholder*="認証"]',
  'input[placeholder*="確認"]',
  'input[inputmode="numeric"]',
].join(', ');

const ONE_TIME_CODE_LOGIN_PATTERN = /使用一次性验证码登录|改用(?:一次性)?验证码(?:登录)?|使用验证码登录|一次性验证码|验证码登录|ワンタイム(?:コード|パスコード)|一回限りの?(?:コード|パスコード)|(?:認証|確認)?コード(?:で|を使用して)?(?:ログイン|サインイン)|one[-\s]*time\s*(?:passcode|password|code)|use\s+(?:a\s+)?one[-\s]*time\s*(?:passcode|password|code)(?:\s+instead)?|use\s+(?:a\s+)?code(?:\s+instead)?|sign\s+in\s+with\s+(?:email|code)|email\s+(?:me\s+)?(?:a\s+)?code/i;
const LOGIN_ENTRY_ACTION_PATTERN = /(?:^|\b)(?:log\s*in|sign\s*in|continue\s+(?:with|using)\s+(?:email|chatgpt)|use\s+(?:an?\s+)?email|email\s+address)(?:\b|$)|登录|登陆|邮箱|电子邮件|ログイン|サインイン|メールアドレス|メール|電子メール/i;
const LOGIN_SWITCH_TO_PHONE_PATTERN = /继续使用(?:手机|手机号|电话)(?:号码)?登录|改用(?:手机|手机号|电话)(?:号码)?登录|手机号登录|(?:電話番号|電話|携帯電話|携帯)(?:で|を使用して)?(?:続行|続ける|ログイン|サインイン)|(?:続行|続ける|使用|ログイン|サインイン).*(?:電話番号|電話|携帯電話|携帯)|continue\s+(?:with|using)\s+(?:a\s+)?phone(?:\s+number)?|use\s+(?:a\s+)?phone(?:\s+number)?(?:\s+instead)?|sign\s*in\s+with\s+(?:a\s+)?phone/i;
const LOGIN_PHONE_ACTION_PATTERN = /手机|电话|phone|telephone|電話番号|電話|携帯電話|携帯/i;
const LOGIN_PHONE_ENTRY_PAGE_PATTERN = /(?:\+\s*\(?\d{1,4}\)?\s*)?(?:手机号码|手机号|电话号码|電話番号|携帯電話番号|携帯番号)|(?:phone|mobile)\s+number|telephone/i;
const LOGIN_MORE_OPTIONS_PATTERN = /更多(?:选项|登录方式|方式)|其他(?:登录方式|选项|方式)|显示更多|その他|他の(?:ログイン)?方法|別の(?:ログイン)?方法|もっと見る|オプション|more\s+(?:login\s+|sign[-\s]*in\s+)?options|other\s+(?:login\s+|sign[-\s]*in\s+)?(?:options|ways)|show\s+more/i;
const LOGIN_EXTERNAL_IDP_PATTERN = /google|microsoft|apple|sso|single\s+sign[-\s]*on|企业|工作区|workspace/i;
const LOGIN_CODE_ONLY_ACTION_PATTERN = /one[-\s]*time|passcode|use\s+(?:a\s+)?code|验证码|一次性|ワンタイム|パスコード|認証コード|確認コード/i;

const RESEND_VERIFICATION_CODE_PATTERN = /重新发送(?:验证码)?|再次发送(?:验证码)?|重发(?:验证码)?|未收到(?:验证码|邮件)|(?:コード|メール|確認コード|認証コード)(?:を)?再送信|再送信|新しい(?:コード|確認コード|認証コード)|届かない|受信していません|resend(?:\s+code)?|send\s+(?:a\s+)?new\s+code|send\s+(?:it\s+)?again|request\s+(?:a\s+)?new\s+code|didn'?t\s+receive/i;
// CHOOSE_ACCOUNT_* \u5e38\u91cf\u5b9e\u9645\u5b9a\u4e49\u5728 flows/openai/content/openai-auth-choose-account.js\uff0c
// \u8fd9\u91cc destructure \u51fa\u6765\u8ba9\u672c\u6587\u4ef6\u5176\u5b83\u5e38\u91cf/\u5de5\u5382\u8c03\u7528\u70b9\u65e0\u987b\u6539\u52a8\uff1b
// \u540c\u6a21\u5757\u7684 10 \u4e2a helper \u51fd\u6570\u5728\u5e38\u91cf\u5757\u4e4b\u540e\u901a\u8fc7 createOpenAIAuthChooseAccount \u6ce8\u5165\u5e76 destructure\u3002
const {
  CHOOSE_ACCOUNT_PAGE_PATTERN,
  CHOOSE_ACCOUNT_REMOVE_ACTION_PATTERN,
  CHOOSE_ACCOUNT_OTHER_ACCOUNT_PATTERN,
  CHOOSE_ACCOUNT_ACTION_SELECTOR,
  CHOOSE_ACCOUNT_CARD_SELECTOR,
} = self.MultiPageOpenAIAuthChooseAccount || {};
const PHONE_RESEND_SERVER_ERROR_PREFIX = 'PHONE_RESEND_SERVER_ERROR::';
const CONTACT_VERIFICATION_SERVER_ERROR_PATTERN = /this\s+page\s+isn['’]?t\s+working|currently\s+unable\s+to\s+handle\s+this\s+request|http\s+error\s+500|500\s+internal\s+server\s+error/i;

function isVisibleElement(el) {
  if (!el) return false;
  const style = window.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  return style.display !== 'none'
    && style.visibility !== 'hidden'
    && rect.width > 0
    && rect.height > 0;
}

function getVisibleSplitVerificationInputs() {
  return Array.from(document.querySelectorAll('input[maxlength="1"]'))
    .filter(isVisibleElement);
}

function getVerificationCodeTarget() {
  const splitInputs = getVisibleSplitVerificationInputs();
  const codeInput = document.querySelector(VERIFICATION_CODE_INPUT_SELECTOR);
  if (codeInput && isVisibleElement(codeInput)) {
    const maxLength = Number(codeInput.getAttribute?.('maxlength') || codeInput.maxLength || 0);
    if (maxLength === 1 && splitInputs.length >= 6) {
      return { type: 'split', elements: splitInputs };
    }
    return { type: 'single', element: codeInput };
  }

  if (splitInputs.length >= 6) {
    return { type: 'split', elements: splitInputs };
  }

  return null;
}

function getActionText(el) {
  return [
    el?.textContent,
    el?.value,
    el?.getAttribute?.('aria-label'),
    el?.getAttribute?.('title'),
  ]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isActionEnabled(el) {
  return Boolean(el)
    && !el.disabled
    && el.getAttribute('aria-disabled') !== 'true';
}

function findOneTimeCodeLoginTrigger() {
  const candidates = document.querySelectorAll(
    'button, a, [role="button"], [role="link"], input[type="button"], input[type="submit"]'
  );

  for (const el of candidates) {
    if (!isVisibleElement(el)) continue;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;

    const text = [
      el.textContent,
      el.value,
      el.getAttribute('aria-label'),
      el.getAttribute('title'),
    ]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (text && ONE_TIME_CODE_LOGIN_PATTERN.test(text)) {
      return el;
    }
  }

  return null;
}

function findResendVerificationCodeTrigger({ allowDisabled = false } = {}) {
  const candidates = document.querySelectorAll(
    'button, a, [role="button"], [role="link"], input[type="button"], input[type="submit"]'
  );

  for (const el of candidates) {
    if (!isVisibleElement(el)) continue;
    if (!allowDisabled && !isActionEnabled(el)) continue;

    const text = getActionText(el);
    if (text && RESEND_VERIFICATION_CODE_PATTERN.test(text)) {
      return el;
    }
  }

  return null;
}

function isEmailVerificationPage() {
  return /\/email-verification(?:[/?#]|$)/i.test(location.pathname || '');
}

function getContactVerificationServerErrorText() {
  const path = String(location?.pathname || '');
  if (!/\/contact-verification(?:[/?#]|$)/i.test(path)) {
    return '';
  }
  const text = String(getPageTextSnapshot?.() || document?.body?.textContent || '').replace(/\s+/g, ' ').trim();
  const title = String(document?.title || '').replace(/\s+/g, ' ').trim();
  const combined = `${title} ${text}`.trim();
  if (!CONTACT_VERIFICATION_SERVER_ERROR_PATTERN.test(combined)) {
    return '';
  }
  return combined || 'OpenAI contact-verification page returned HTTP ERROR 500 after resend.';
}

function buildContactVerificationServerError(errorText = '') {
  const serverErrorPrefix = typeof PHONE_RESEND_SERVER_ERROR_PREFIX === 'string'
    ? PHONE_RESEND_SERVER_ERROR_PREFIX
    : 'PHONE_RESEND_SERVER_ERROR::';
  const resolvedText = String(errorText || '').trim()
    || 'OpenAI contact-verification 页面返回 HTTP ERROR 500。';
  return new Error(
    resolvedText.startsWith(serverErrorPrefix)
      ? resolvedText
      : `${serverErrorPrefix}${resolvedText}`
  );
}

function throwIfContactVerificationServerError() {
  const serverErrorText = getContactVerificationServerErrorText();
  if (serverErrorText) {
    throw buildContactVerificationServerError(serverErrorText);
  }
}

async function resendVerificationCode(step, timeout = 45000) {
  const performOperationWithDelay = typeof getOperationDelayRunner === 'function'
    ? getOperationDelayRunner()
    : async (metadata, operation) => {
        const rootScope = typeof window !== 'undefined' ? window : globalThis;
        const gate = rootScope?.CodexOperationDelay?.performOperationWithDelay;
        return typeof gate === 'function' ? gate(metadata, operation) : operation();
      };
  if (step === 8) {
    await waitForLoginVerificationPageReady(10000, step);
  }

  const start = Date.now();
  let action = null;
  let loggedWaiting = false;

  while (Date.now() - start < timeout) {
    throwIfStopped();
    throwIfContactVerificationServerError();

    // Check for 405 error page and recover by clicking "Try again"
    if (is405MethodNotAllowedPage()) {
      await handle405ResendError(step, timeout - (Date.now() - start));
      // After recovery, loop back to find the resend button again
      loggedWaiting = false;
      continue;
    }

    action = findResendVerificationCodeTrigger({ allowDisabled: true });

    if (action && isActionEnabled(action)) {
      log(`步骤 ${step}：重新发送验证码按钮已可用。`);
      await humanPause(350, 900);
      await performOperationWithDelay({ stepKey: step === 8 ? 'oauth-login' : 'fetch-signup-code', kind: 'click', label: 'resend-verification-code' }, async () => {
        simulateClick(action);
      });
      await sleep(1200);

      // After clicking resend, check if 405 error appeared
      if (is405MethodNotAllowedPage()) {
        log(`步骤 ${step}：点击重新发送后出现 405 错误，正在恢复...`, 'warn');
        await handle405ResendError(step, timeout - (Date.now() - start));
        loggedWaiting = false;
        continue;
      }
      throwIfContactVerificationServerError();

      return {
        resent: true,
        buttonText: getActionText(action),
      };
    }

    if (action && !loggedWaiting) {
      loggedWaiting = true;
      log(`步骤 ${step}：正在等待重新发送验证码按钮变为可点击...`);
    }

    await sleep(250);
  }

  throwIfContactVerificationServerError();
  throw new Error('无法点击重新发送验证码按钮。URL: ' + location.href);
}

// 405 路由错误恢复逻辑（is405MethodNotAllowedPage / handle405ResendError 等 10 个 helper
// + AUTH_ROUTE_ERROR_PATTERN / STEP4_405_RECOVERY_* 三个常量）已搬到
// flows/openai/content/openai-auth-route-recovery.js，并在本文件常量块附近通过
// MultiPageOpenAIAuthRouteRecovery.createOpenAIAuthRouteRecovery({...}) 装配后
// destructure 暴露给本作用域，所以这里的所有 callsite 无需修改。

// ============================================================
// Signup Entry Helpers
// ============================================================

const SIGNUP_ENTRY_TRIGGER_PATTERN = /免费注册|立即注册|注册|無料でサインアップ|サインアップ|新規登録|登録する|登録|アカウントを作成|アカウント作成|sign\s*up|register|create\s*account|create\s+account/i;
const SIGNUP_EMAIL_INPUT_SELECTOR = [
  'input[type="email"]',
  'input[autocomplete="email"]',
  'input[autocomplete="username"]',
  'input[name="email"]',
  'input[name="username"]',
  'input[id*="email"]',
  'input[placeholder*="email" i]',
  'input[placeholder*="电子邮件"]',
  'input[placeholder*="邮箱"]',
  'input[placeholder*="メール"]',
  'input[aria-label*="email" i]',
  'input[aria-label*="电子邮件"]',
  'input[aria-label*="邮箱"]',
  'input[aria-label*="メール"]',
].join(', ');
const SIGNUP_PHONE_INPUT_SELECTOR = [
  'input[type="tel"]:not([maxlength="6"])',
  'input[name*="phone" i]',
  'input[id*="phone" i]',
  'input[autocomplete="tel"]',
  'input[placeholder*="手机"]',
  'input[placeholder*="電話"]',
  'input[placeholder*="携帯"]',
  'input[aria-label*="手机"]',
  'input[aria-label*="電話"]',
  'input[aria-label*="携帯"]',
].join(', ');
const SIGNUP_SWITCH_TO_EMAIL_PATTERN = new RegExp([
  String.raw`\u7ee7\u7eed\u4f7f\u7528(?:\u7535\u5b50\u90ae\u4ef6\u5730\u5740|\u90ae\u7bb1)\u767b\u5f55`,
  String.raw`\u6539\u7528(?:\u7535\u5b50\u90ae\u4ef6\u5730\u5740|\u90ae\u7bb1)\u767b\u5f55`,
  String.raw`(?:メールアドレス|メール|電子メール)(?:で|を使用して)?(?:続行|続ける|ログイン|サインイン|サインアップ)`,
  String.raw`(?:続行|続ける|使用|ログイン|サインイン|サインアップ).*(?:メールアドレス|メール|電子メール)`,
  String.raw`continue\s+using\s+(?:an?\s+)?email(?:\s+address)?(?:\s+(?:to\s+)?(?:log\s*in|sign\s*in|sign\s*up))?`,
  String.raw`continue\s+with\s+email(?:\s+address)?`,
  String.raw`use\s+(?:an?\s+)?email(?:\s+address)?(?:\s+instead)?`,
  String.raw`sign\s*(?:in|up)\s+with\s+email`,
].join('|'), 'i');
const SIGNUP_SWITCH_ACTION_PATTERN = /\u7ee7\u7eed\u4f7f\u7528|\u6539\u7528|continue|use|sign\s*(?:in|up)|続行|続ける|使用|ログイン|サイン(?:イン|アップ)/i;
const SIGNUP_EMAIL_ACTION_PATTERN = /\u7535\u5b50\u90ae\u4ef6|\u90ae\u7bb1|email|メールアドレス|メール|電子メール/i;
const SIGNUP_PHONE_ACTION_PATTERN = /手机|手机号|电话号码|phone|telephone|mobile|電話番号|電話|携帯電話|携帯/i;
const SIGNUP_SWITCH_TO_PHONE_PATTERN = new RegExp([
  String.raw`\u7ee7\u7eed\u4f7f\u7528(?:\u624b\u673a|\u624b\u673a\u53f7|\u7535\u8bdd\u53f7\u7801)(?:\u53f7\u7801)?\u767b\u5f55`,
  String.raw`\u6539\u7528(?:\u624b\u673a|\u624b\u673a\u53f7|\u7535\u8bdd\u53f7\u7801)(?:\u53f7\u7801)?\u767b\u5f55`,
  String.raw`\u7ee7\u7eed\u4f7f\u7528(?:\u624b\u673a|\u624b\u673a\u53f7|\u624b\u673a\u53f7\u7801|\u7535\u8bdd\u53f7\u7801)(?:\u53f7\u7801)?`,
  String.raw`\u6539\u7528(?:\u624b\u673a|\u624b\u673a\u53f7|\u624b\u673a\u53f7\u7801|\u7535\u8bdd\u53f7\u7801)(?:\u53f7\u7801)?`,
  String.raw`\u4f7f\u7528(?:\u624b\u673a|\u624b\u673a\u53f7|\u624b\u673a\u53f7\u7801|\u7535\u8bdd\u53f7\u7801)(?:\u53f7\u7801)?`,
  String.raw`(?:電話番号|電話|携帯電話|携帯)(?:で|を使用して)?(?:続行|続ける|ログイン|サインイン|サインアップ)`,
  String.raw`(?:続行|続ける|使用|ログイン|サインイン|サインアップ).*(?:電話番号|電話|携帯電話|携帯)`,
  String.raw`continue\s+(?:with|using)\s+(?:a\s+)?phone(?:\s+number)?`,
  String.raw`use\s+(?:a\s+)?phone(?:\s+number)?(?:\s+instead)?`,
  String.raw`sign\s*(?:in|up)\s+with\s+(?:a\s+)?phone`,
].join('|'), 'i');
const SIGNUP_MORE_OPTIONS_PATTERN = /更多选项|其它方式|其他方式|その他|他の方法|別の方法|もっと見る|オプション|more\s+options|show\s+more|other\s+(?:options|ways)/i;
const SIGNUP_WORK_EMAIL_PATTERN = /\u5de5\u4f5c|business|work\s+email/i;

function getSignupEmailInput() {
  const looksLikePhoneInput = (el) => {
    if (!el) return false;
    const type = String(el.getAttribute?.('type') || '').trim().toLowerCase();
    const name = String(el.getAttribute?.('name') || '').trim().toLowerCase();
    const id = String(el.getAttribute?.('id') || '').trim().toLowerCase();
    const placeholder = String(el.getAttribute?.('placeholder') || '').trim();
    const ariaLabel = String(el.getAttribute?.('aria-label') || '').trim();
    const autocomplete = String(el.getAttribute?.('autocomplete') || '').trim().toLowerCase();
    const combinedText = `${placeholder} ${ariaLabel}`;
    return type === 'tel'
      || autocomplete === 'tel'
      || /phone|tel/i.test(`${name} ${id}`)
      || /手机|电话|手机号|電話|電話番号|携帯|携帯電話/.test(combinedText);
  };

  const input = document.querySelector(SIGNUP_EMAIL_INPUT_SELECTOR);
  if (input && isVisibleElement(input) && !looksLikePhoneInput(input)) {
    return input;
  }

  const fallback = Array.from(document.querySelectorAll('input')).find((el) => {
    if (!isVisibleElement(el)) return false;
    const type = String(el.getAttribute?.('type') || '').trim().toLowerCase();
    const name = String(el.getAttribute?.('name') || '').trim().toLowerCase();
    const id = String(el.getAttribute?.('id') || '').trim().toLowerCase();
    const placeholder = String(el.getAttribute?.('placeholder') || '').trim();
    const ariaLabel = String(el.getAttribute?.('aria-label') || '').trim();
    const autocomplete = String(el.getAttribute?.('autocomplete') || '').trim().toLowerCase();
    const combinedText = `${placeholder} ${ariaLabel}`;
    if (looksLikePhoneInput(el)) return false;
    return type === 'email'
      || autocomplete === 'email'
      || autocomplete === 'username'
      || /email|username|mail/i.test(`${name} ${id}`)
      || /email|电子邮件|邮箱|メール|電子メール/i.test(combinedText);
  });

  return fallback || null;
}

function getSignupPhoneInput() {
  const input = document.querySelector(SIGNUP_PHONE_INPUT_SELECTOR);
  if (input && isVisibleElement(input)) {
    return input;
  }

  const fallback = Array.from(document.querySelectorAll('input')).find((el) => {
    if (!isVisibleElement(el)) return false;
    const type = String(el.getAttribute?.('type') || '').trim().toLowerCase();
    const name = String(el.getAttribute?.('name') || '').trim().toLowerCase();
    const id = String(el.getAttribute?.('id') || '').trim().toLowerCase();
    const placeholder = String(el.getAttribute?.('placeholder') || '').trim();
    const ariaLabel = String(el.getAttribute?.('aria-label') || '').trim();
    const autocomplete = String(el.getAttribute?.('autocomplete') || '').trim().toLowerCase();
    const combinedText = `${placeholder} ${ariaLabel}`;
    return type === 'tel'
      || autocomplete === 'tel'
      || /phone|tel/i.test(`${name} ${id}`)
      || /手机|电话|手机号|電話|電話番号|携帯|携帯電話/.test(combinedText);
  });

  return fallback || null;
}

function findSignupUseEmailTrigger() {
  const candidates = document.querySelectorAll('button, a, [role="button"], [role="link"]');
  return Array.from(candidates).find((el) => {
    if (!isVisibleElement(el) || !isActionEnabled(el)) return false;
    const text = getActionText(el);
    if (!text) return false;
    if (SIGNUP_WORK_EMAIL_PATTERN.test(text)) return false;
    return SIGNUP_SWITCH_TO_EMAIL_PATTERN.test(text)
      || (SIGNUP_SWITCH_ACTION_PATTERN.test(text) && SIGNUP_EMAIL_ACTION_PATTERN.test(text));
  }) || null;
}

function findSignupUsePhoneTrigger() {
  const candidates = document.querySelectorAll('button, a, [role="button"], [role="link"]');
  return Array.from(candidates).find((el) => {
    if (!isVisibleElement(el) || !isActionEnabled(el)) return false;
    const text = getActionText(el);
    if (!text) return false;
    return SIGNUP_SWITCH_TO_PHONE_PATTERN.test(text)
      || (SIGNUP_SWITCH_ACTION_PATTERN.test(text) && SIGNUP_PHONE_ACTION_PATTERN.test(text));
  }) || null;
}

function findSignupMoreOptionsTrigger() {
  const candidates = document.querySelectorAll('button, a, [role="button"], [role="link"]');
  return Array.from(candidates).find((el) => {
    if (!isVisibleElement(el) || !isActionEnabled(el)) return false;
    const text = getActionText(el);
    if (!text || !SIGNUP_MORE_OPTIONS_PATTERN.test(text)) return false;
    const expanded = String(el.getAttribute?.('aria-expanded') || '').trim().toLowerCase();
    const state = String(el.getAttribute?.('data-state') || '').trim().toLowerCase();
    return expanded !== 'true' && state !== 'open';
  }) || null;
}

function getSignupEmailContinueButton({ allowDisabled = false } = {}) {
  const direct = document.querySelector('button[type="submit"], input[type="submit"]');
  if (direct && isVisibleElement(direct) && (allowDisabled || isActionEnabled(direct))) {
    return direct;
  }

  const candidates = document.querySelectorAll(
    'button, a, [role="button"], [role="link"], input[type="button"], input[type="submit"]'
  );
  return Array.from(candidates).find((el) => {
    if (!isVisibleElement(el) || (!allowDisabled && !isActionEnabled(el))) return false;
    return /continue|next|submit|继续|下一步|続行|続ける|次へ|送信/i.test(getActionText(el));
  }) || null;
}

function findSignupEntryTrigger(options = {}) {
  const { allowHiddenFallback = true } = options || {};
  const candidates = document.querySelectorAll('a, button, [role="button"], [role="link"]');
  let hiddenSignupTrigger = null;

  for (const el of Array.from(candidates)) {
    if (!isActionEnabled(el)) continue;
    if (!SIGNUP_ENTRY_TRIGGER_PATTERN.test(getActionText(el))) continue;
    if (isVisibleElement(el)) {
      return el;
    }
    if (!hiddenSignupTrigger) {
      hiddenSignupTrigger = el;
    }
  }

  if (!allowHiddenFallback || !hiddenSignupTrigger) {
    return null;
  }

  const view = typeof window !== 'undefined' ? window : globalThis;
  const collapsedViewport = Boolean(
    Math.round(Number(view?.innerWidth) || 0) < 240
    || Math.round(Number(view?.innerHeight) || 0) < 160
    || Math.round(Number(view?.outerWidth) || 0) < 320
    || Math.round(Number(view?.outerHeight) || 0) < 180
  );
  const pageText = typeof getPageTextSnapshot === 'function'
    ? getPageTextSnapshot()
    : '';
  const looksLikeLoggedOutHome = /登录|登入|ログイン|サインイン|log\s*in|sign\s*in/i.test(pageText);
  return collapsedViewport || looksLikeLoggedOutHome ? hiddenSignupTrigger : null;
}

function getSignupPasswordDisplayedEmail() {
  const text = (document.body?.innerText || document.body?.textContent || '')
    .replace(/\s+/g, ' ')
    .trim();
  const matches = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig);
  return matches?.[0] ? String(matches[0]).trim().toLowerCase() : '';
}

function inspectSignupEntryState() {
  if (typeof isPhoneVerificationPageReady === 'function' && isPhoneVerificationPageReady()) {
    return {
      state: 'phone_verification_page',
      verificationTarget: typeof getVerificationCodeTarget === 'function' ? getVerificationCodeTarget() : null,
      displayedPhone: typeof getPhoneVerificationDisplayedPhone === 'function' ? getPhoneVerificationDisplayedPhone() : '',
      url: location.href,
    };
  }

  const postVerificationState = typeof getStep4PostVerificationState === 'function'
    ? getStep4PostVerificationState()
    : null;
  if (postVerificationState?.state === 'step5') {
    return {
      state: 'profile_page',
      url: postVerificationState.url || location.href,
    };
  }

  if (postVerificationState?.state === 'logged_in_home') {
    return {
      state: 'logged_in_home',
      skipProfileStep: true,
      url: postVerificationState.url || location.href,
    };
  }

  if (typeof isVerificationPageStillVisible === 'function' && isVerificationPageStillVisible()) {
    return {
      state: 'verification_page',
      verificationTarget: typeof getVerificationCodeTarget === 'function' ? getVerificationCodeTarget() : null,
      url: location.href,
    };
  }

  const passwordInput = getSignupPasswordInput();
  if (isSignupPasswordPage() && passwordInput) {
    return {
      state: 'password_page',
      passwordInput,
      submitButton: getSignupPasswordSubmitButton({ allowDisabled: true }),
      displayedEmail: getSignupPasswordDisplayedEmail(),
      passwordErrorText: getSignupPasswordFieldErrorText(),
      url: location.href,
    };
  }

  const emailInput = getSignupEmailInput();
  if (emailInput) {
    return {
      state: 'email_entry',
      emailInput,
      continueButton: getSignupEmailContinueButton({ allowDisabled: true }),
      switchToPhoneTrigger: findSignupUsePhoneTrigger(),
      url: location.href,
    };
  }

  const phoneInput = getSignupPhoneInput();
  if (phoneInput) {
    return {
      state: 'phone_entry',
      phoneInput,
      switchToEmailTrigger: findSignupUseEmailTrigger(),
      url: location.href,
    };
  }

  const authEntryUrl = /\/(?:auth\/login|auth\/signup|create-account|log-in)(?:[/?#]|$)/i.test(String(location.href || ''));
  const pageText = typeof getPageTextSnapshot === 'function' ? getPageTextSnapshot() : '';
  const unifiedAuthEntryText = /登录或注册|登入或註冊|ログインまたは登録|log\s*in\s*or\s*sign\s*up|sign\s*in\s*or\s*sign\s*up/i.test(pageText);
  if (authEntryUrl || unifiedAuthEntryText) {
    const switchToPhoneTrigger = findSignupUsePhoneTrigger();
    if (switchToPhoneTrigger) {
      return {
        state: 'email_entry',
        emailInput: null,
        continueButton: getSignupEmailContinueButton({ allowDisabled: true }),
        switchToPhoneTrigger,
        url: location.href,
      };
    }
  }

  const signupTrigger = findSignupEntryTrigger();
  if (signupTrigger) {
    return {
      state: 'entry_home',
      signupTrigger,
      url: location.href,
    };
  }

  return {
    state: 'unknown',
    url: location.href,
  };
}

function getSignupEntryStateSummary(snapshot = inspectSignupEntryState()) {
  const summary = {
    state: snapshot?.state || 'unknown',
    url: snapshot?.url || location.href,
    hasEmailInput: Boolean(snapshot?.emailInput || getSignupEmailInput()),
    hasPhoneInput: Boolean(snapshot?.phoneInput || getSignupPhoneInput()),
    hasPasswordInput: Boolean(snapshot?.passwordInput || getSignupPasswordInput()),
  };

  if (snapshot?.displayedEmail) {
    summary.displayedEmail = snapshot.displayedEmail;
  }

  if (snapshot?.signupTrigger) {
    summary.signupTrigger = {
      tag: (snapshot.signupTrigger.tagName || '').toLowerCase(),
      text: getActionText(snapshot.signupTrigger).slice(0, 80),
      visible: isVisibleElement(snapshot.signupTrigger),
    };
  }

  if (snapshot?.continueButton) {
    summary.continueButton = {
      tag: (snapshot.continueButton.tagName || '').toLowerCase(),
      text: getActionText(snapshot.continueButton).slice(0, 80),
      enabled: isActionEnabled(snapshot.continueButton),
    };
  }

  if (snapshot?.switchToEmailTrigger) {
    summary.switchToEmailTrigger = {
      tag: (snapshot.switchToEmailTrigger.tagName || '').toLowerCase(),
      text: getActionText(snapshot.switchToEmailTrigger).slice(0, 80),
      enabled: isActionEnabled(snapshot.switchToEmailTrigger),
    };
  }

  if (snapshot?.switchToPhoneTrigger) {
    summary.switchToPhoneTrigger = {
      tag: (snapshot.switchToPhoneTrigger.tagName || '').toLowerCase(),
      text: getActionText(snapshot.switchToPhoneTrigger).slice(0, 80),
      enabled: isActionEnabled(snapshot.switchToPhoneTrigger),
    };
  }

  return summary;
}

function getSignupEntryDiagnostics() {
  const view = typeof window !== 'undefined' ? window : globalThis;
  const safeGetComputedStyle = (el) => {
    if (!el || typeof view?.getComputedStyle !== 'function') {
      return null;
    }
    try {
      return view.getComputedStyle(el);
    } catch {
      return null;
    }
  };
  const buildRectSummary = (el) => {
    const rect = typeof el?.getBoundingClientRect === 'function'
      ? el.getBoundingClientRect()
      : null;
    return rect
      ? {
          width: Math.round(rect.width || 0),
          height: Math.round(rect.height || 0),
        }
      : null;
  };
  const buildVisibilityMeta = (el) => {
    const style = safeGetComputedStyle(el);
    return {
      className: String(el?.className || '').slice(0, 200),
      hidden: Boolean(el?.hidden),
      ariaHidden: el?.getAttribute?.('aria-hidden') || '',
      inert: typeof el?.hasAttribute === 'function' ? el.hasAttribute('inert') : false,
      display: style?.display || '',
      visibility: style?.visibility || '',
      opacity: style?.opacity || '',
      pointerEvents: style?.pointerEvents || '',
    };
  };
  const findBlockingAncestor = (el) => {
    let current = el?.parentElement || null;
    while (current) {
      const style = safeGetComputedStyle(current);
      const rect = buildRectSummary(current);
      const hidden = Boolean(current.hidden);
      const ariaHidden = current.getAttribute?.('aria-hidden') || '';
      const inert = typeof current.hasAttribute === 'function' ? current.hasAttribute('inert') : false;
      const blockedByStyle = Boolean(
        style
        && (
          style.display === 'none'
          || style.visibility === 'hidden'
          || style.opacity === '0'
          || style.pointerEvents === 'none'
        )
      );
      const blockedByRect = Boolean(rect && (rect.width === 0 || rect.height === 0));
      if (hidden || ariaHidden === 'true' || inert || blockedByStyle || blockedByRect) {
        return {
          tag: (current.tagName || '').toLowerCase(),
          id: current.id || '',
          className: String(current.className || '').slice(0, 200),
          hidden,
          ariaHidden,
          inert,
          display: style?.display || '',
          visibility: style?.visibility || '',
          opacity: style?.opacity || '',
          pointerEvents: style?.pointerEvents || '',
          rect,
        };
      }
      current = current.parentElement;
    }
    return null;
  };
  const actionCandidates = document.querySelectorAll(
    'a, button, [role="button"], [role="link"], input[type="button"], input[type="submit"]'
  );
  const allActions = Array.from(actionCandidates).map((el) => {
    const text = getActionText(el);
    return {
      tag: (el.tagName || '').toLowerCase(),
      type: el.getAttribute?.('type') || '',
      text: text.slice(0, 80),
      visible: isVisibleElement(el),
      enabled: isActionEnabled(el),
      rect: buildRectSummary(el),
    };
  });
  const visibleActions = Array.from(actionCandidates)
    .filter(isVisibleElement)
    .slice(0, 12)
    .map((el) => ({
      tag: (el.tagName || '').toLowerCase(),
      type: el.getAttribute?.('type') || '',
      text: getActionText(el).slice(0, 80),
      enabled: isActionEnabled(el),
    }))
    .filter((item) => item.text);
  const signupLikeActions = Array.from(actionCandidates)
    .map((el) => {
      const text = getActionText(el);
      return {
        tag: (el.tagName || '').toLowerCase(),
        type: el.getAttribute?.('type') || '',
        text: text.slice(0, 80),
        visible: isVisibleElement(el),
        enabled: isActionEnabled(el),
        rect: buildRectSummary(el),
        ...buildVisibilityMeta(el),
        blockingAncestor: findBlockingAncestor(el),
      };
    })
    .filter((item) => item.text && SIGNUP_ENTRY_TRIGGER_PATTERN.test(item.text))
    .slice(0, 12);

  return {
    url: location.href,
    title: document.title || '',
    readyState: document.readyState || '',
    viewport: {
      innerWidth: Math.round(Number(view?.innerWidth) || 0),
      innerHeight: Math.round(Number(view?.innerHeight) || 0),
      outerWidth: Math.round(Number(view?.outerWidth) || 0),
      outerHeight: Math.round(Number(view?.outerHeight) || 0),
      devicePixelRatio: Number(view?.devicePixelRatio) || 0,
    },
    hasEmailInput: Boolean(getSignupEmailInput()),
    hasPhoneInput: Boolean(getSignupPhoneInput()),
    hasPasswordInput: Boolean(getSignupPasswordInput()),
    hasSwitchToEmailAction: Boolean(findSignupUseEmailTrigger()),
    hasSwitchToPhoneAction: Boolean(findSignupUsePhoneTrigger()),
    bodyContainsSignupText: SIGNUP_ENTRY_TRIGGER_PATTERN.test(getPageTextSnapshot()),
    signupLikeActionCounts: {
      total: signupLikeActions.length,
      visible: signupLikeActions.filter((item) => item.visible).length,
      hidden: signupLikeActions.filter((item) => !item.visible).length,
    },
    signupLikeActions,
    visibleActions,
    bodyTextPreview: getPageTextSnapshot().slice(0, 240),
  };
}

function getSignupPasswordDiagnostics() {
  const view = typeof window !== 'undefined' ? window : globalThis;
  const safeGetComputedStyle = (el) => {
    if (!el || typeof view?.getComputedStyle !== 'function') {
      return null;
    }
    try {
      return view.getComputedStyle(el);
    } catch {
      return null;
    }
  };
  const buildRectSummary = (el) => {
    const rect = typeof el?.getBoundingClientRect === 'function'
      ? el.getBoundingClientRect()
      : null;
    return rect
      ? {
          width: Math.round(rect.width || 0),
          height: Math.round(rect.height || 0),
        }
      : null;
  };
  const buildInputSummary = (el) => {
    const style = safeGetComputedStyle(el);
    return {
      tag: (el?.tagName || '').toLowerCase(),
      type: el?.getAttribute?.('type') || el?.type || '',
      name: el?.getAttribute?.('name') || el?.name || '',
      id: el?.id || '',
      autocomplete: el?.getAttribute?.('autocomplete') || '',
      placeholder: String(el?.getAttribute?.('placeholder') || '').slice(0, 80),
      visible: isVisibleElement(el),
      enabled: isActionEnabled(el),
      valueLength: String(el?.value || '').length,
      rect: buildRectSummary(el),
      className: String(el?.className || '').slice(0, 200),
      display: style?.display || '',
      visibility: style?.visibility || '',
      opacity: style?.opacity || '',
      pointerEvents: style?.pointerEvents || '',
      formAction: el?.form?.action || '',
    };
  };
  const buildActionSummary = (el) => {
    const style = safeGetComputedStyle(el);
    return {
      tag: (el?.tagName || '').toLowerCase(),
      type: el?.getAttribute?.('type') || el?.type || '',
      role: el?.getAttribute?.('role') || '',
      text: getActionText(el).slice(0, 120),
      visible: isVisibleElement(el),
      enabled: isActionEnabled(el),
      rect: buildRectSummary(el),
      className: String(el?.className || '').slice(0, 200),
      display: style?.display || '',
      visibility: style?.visibility || '',
      opacity: style?.opacity || '',
      pointerEvents: style?.pointerEvents || '',
      dataDdActionName: el?.getAttribute?.('data-dd-action-name') || '',
      formAction: el?.form?.action || '',
    };
  };
  const passwordInputs = Array.from(document.querySelectorAll(
    'input[type="password"], input[name*="password" i], input[autocomplete="new-password"], input[autocomplete="current-password"]'
  ))
    .map(buildInputSummary)
    .slice(0, 8);
  const actionCandidates = Array.from(document.querySelectorAll(
    'button, a, [role="button"], [role="link"], input[type="button"], input[type="submit"]'
  ))
    .map(buildActionSummary)
    .filter((item) => item.text)
    .slice(0, 16);
  const visibleActions = actionCandidates.filter((item) => item.visible).slice(0, 12);
  const submitButton = getSignupPasswordSubmitButton({ allowDisabled: true });
  const oneTimeCodeTrigger = findOneTimeCodeLoginTrigger();
  const retryState = getSignupPasswordTimeoutErrorPageState();

  return {
    url: location.href,
    title: document.title || '',
    readyState: document.readyState || '',
    displayedEmail: getSignupPasswordDisplayedEmail(),
    passwordErrorText: getSignupPasswordFieldErrorText(),
    hasVisiblePasswordInput: Boolean(getSignupPasswordInput()),
    passwordInputCount: passwordInputs.length,
    visiblePasswordInputCount: passwordInputs.filter((item) => item.visible).length,
    passwordInputs,
    submitButton: submitButton ? buildActionSummary(submitButton) : null,
    oneTimeCodeTrigger: oneTimeCodeTrigger ? buildActionSummary(oneTimeCodeTrigger) : null,
    retryPage: Boolean(retryState),
    retryEnabled: Boolean(retryState?.retryEnabled),
    userAlreadyExistsBlocked: Boolean(retryState?.userAlreadyExistsBlocked),
    visibleActions,
    bodyTextPreview: getPageTextSnapshot().slice(0, 240),
  };
}

function logSignupPasswordDiagnostics(context, level = 'warn') {
  try {
    log(`${context}：密码页诊断快照：${JSON.stringify(getSignupPasswordDiagnostics())}`, level);
  } catch (error) {
    console.warn('[MultiPage:openai-auth] failed to build signup password diagnostics:', error?.message || error);
  }
}

async function waitForSignupEntryState(options = {}) {
  const performOperationWithDelay = typeof getOperationDelayRunner === 'function'
    ? getOperationDelayRunner()
    : async (metadata, operation) => {
        const rootScope = typeof window !== 'undefined' ? window : globalThis;
        const gate = rootScope?.CodexOperationDelay?.performOperationWithDelay;
        return typeof gate === 'function' ? gate(metadata, operation) : operation();
      };
  const {
    timeout = 15000,
    autoOpenEntry = false,
    step = 2,
    logDiagnostics = false,
  } = options;
  const start = Date.now();
  const maxSignupEntryClickRetries = 5;
  const maxSignupEntryClickAttempts = maxSignupEntryClickRetries + 1;
  let lastTriggerClickAt = 0;
  let clickAttempts = 0;
  let lastState = '';
  let slowSnapshotLogged = false;
  let lastSwitchToEmailAt = 0;
  let loggedMissingSwitchToEmail = false;

  while (Date.now() - start < timeout) {
    throwIfStopped();
    const snapshot = inspectSignupEntryState();

    if (logDiagnostics && snapshot.state !== lastState) {
      lastState = snapshot.state;
      log(`步骤 ${step}：注册入口状态切换为 ${snapshot.state}，状态快照：${JSON.stringify(getSignupEntryStateSummary(snapshot))}`);
    }

    if (snapshot.state === 'password_page' || snapshot.state === 'email_entry') {
      return snapshot;
    }

    if (snapshot.state === 'phone_entry') {
      if (!autoOpenEntry) {
        return snapshot;
      }

      if (snapshot.switchToEmailTrigger && Date.now() - lastSwitchToEmailAt >= 1500) {
        lastSwitchToEmailAt = Date.now();
        loggedMissingSwitchToEmail = false;
        if (logDiagnostics) {
          log(`步骤 ${step}：检测到手机号输入模式，准备点击切换邮箱入口："${getActionText(snapshot.switchToEmailTrigger).slice(0, 80)}"`);
        }
        log('步骤 2：检测到手机号输入模式，正在切换到邮箱输入模式...');
        await humanPause(350, 900);
        await performOperationWithDelay({ stepKey: 'signup-entry', kind: 'click', label: 'switch-to-signup-email' }, async () => {
          simulateClick(snapshot.switchToEmailTrigger);
        });
      } else if (!snapshot.switchToEmailTrigger && !loggedMissingSwitchToEmail) {
        loggedMissingSwitchToEmail = true;
        log('步骤 2：检测到手机号输入模式，但暂未识别到“改用邮箱/继续使用电子邮件地址登录”按钮，继续等待界面稳定...', 'warn');
      }

      if (logDiagnostics && !slowSnapshotLogged && Date.now() - start >= 5000) {
        slowSnapshotLogged = true;
        log(`步骤 ${step}：等待手机号入口切换超过 5 秒，页面诊断快照：${JSON.stringify(getSignupEntryDiagnostics())}`, 'warn');
      }

      await sleep(250);
      continue;
    }

    if (snapshot.state === 'entry_home') {
      if (!autoOpenEntry) {
        return snapshot;
      }

      if (Date.now() - lastTriggerClickAt >= 1500) {
        if (clickAttempts >= maxSignupEntryClickAttempts) {
          log(`步骤 ${step}：官网注册入口已完成 ${maxSignupEntryClickRetries} 次重试，页面仍未进入邮箱输入页，停止重试。`, 'warn');
          return snapshot;
        }
        lastTriggerClickAt = Date.now();
        clickAttempts += 1;
        const retryAttempt = clickAttempts - 1;
        if (logDiagnostics) {
          log(`步骤 ${step}：正在点击官网注册入口（第 ${clickAttempts}/${maxSignupEntryClickAttempts} 次）："${getActionText(snapshot.signupTrigger).slice(0, 80)}"`);
        }
        log(retryAttempt > 0
          ? `步骤 ${step}：上次点击后仍未进入邮箱输入页，等待 3 秒后重试点击官网注册入口（重试 ${retryAttempt}/${maxSignupEntryClickRetries}）...`
          : `步骤 ${step}：已找到官网注册入口，等待 3 秒后点击...`);
        await sleep(3000);
        throwIfStopped();
        const clickTarget = findSignupEntryTrigger({ allowHiddenFallback: false }) || snapshot.signupTrigger;
        if (!isVisibleElement(clickTarget)) {
          log(`步骤 ${step}：注册入口仍处于不可见状态，继续按入口重试节奏尝试恢复点击...`, 'warn');
        }
        await humanPause(350, 900);
        await performOperationWithDelay({ stepKey: 'signup-entry', kind: 'click', label: 'open-signup-entry' }, async () => {
          simulateClick(clickTarget);
        });
      }
    }

    if (logDiagnostics && !slowSnapshotLogged && Date.now() - start >= 5000) {
      slowSnapshotLogged = true;
      log(`步骤 ${step}：等待注册入口超过 5 秒，页面诊断快照：${JSON.stringify(getSignupEntryDiagnostics())}`, 'warn');
    }

    await sleep(250);
  }

  const finalSnapshot = inspectSignupEntryState();
  if (logDiagnostics) {
    log(`步骤 ${step}：等待注册入口状态超时，最终状态快照：${JSON.stringify(getSignupEntryStateSummary(finalSnapshot))}`, 'warn');
  }
  return finalSnapshot;
}

async function ensureSignupEntryReady(timeout = 15000) {
  const snapshot = await waitForSignupEntryState({ timeout, autoOpenEntry: false });
  if (snapshot.state === 'entry_home' || snapshot.state === 'phone_entry' || snapshot.state === 'email_entry' || snapshot.state === 'password_page') {
    return {
      ready: true,
      state: snapshot.state,
      url: snapshot.url || location.href,
    };
  }

  log(`注册入口识别失败，诊断快照：${JSON.stringify(getSignupEntryDiagnostics())}`, 'warn');
  throw new Error('当前页面没有可用的注册入口，也不在邮箱/密码页。URL: ' + location.href);
}

async function ensureSignupPhoneEntryReady(timeout = 25000) {
  const snapshot = await waitForSignupPhoneEntryState({ timeout, step: 2 });
  if (
    (snapshot.state === 'phone_entry' && snapshot.phoneInput)
    || snapshot.state === 'password_page'
  ) {
    return {
      ready: true,
      state: snapshot.state,
      url: snapshot.url || location.href,
    };
  }

  log(`手机号注册入口识别失败，诊断快照：${JSON.stringify(getSignupEntryDiagnostics())}`, 'warn');
  throw new Error('当前页面没有可用的手机号注册入口，也不在密码页。URL: ' + location.href);
}

async function ensureSignupPasswordPageReady(timeout = 20000) {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    throwIfStopped();
    const passwordInput = getSignupPasswordInput();
    if (isSignupPasswordPage() && passwordInput) {
      return {
        ready: true,
        state: 'password_page',
        url: location.href,
      };
    }
    await sleep(200);
  }

  throw new Error('等待进入密码页超时。URL: ' + location.href);
}

async function fillSignupEmailAndContinue(email, step) {
  const performOperationWithDelay = typeof getOperationDelayRunner === 'function'
    ? getOperationDelayRunner()
    : async (metadata, operation) => {
        const rootScope = typeof window !== 'undefined' ? window : globalThis;
        const gate = rootScope?.CodexOperationDelay?.performOperationWithDelay;
        return typeof gate === 'function' ? gate(metadata, operation) : operation();
      };
  if (!email) throw new Error(`未提供邮箱地址，步骤 ${step} 无法继续。`);
  const normalizedEmail = String(email || '').trim().toLowerCase();

  const snapshot = await waitForSignupEntryState({
    timeout: 20000,
    autoOpenEntry: true,
    step,
    logDiagnostics: step === 2,
  });

  if (snapshot.state === 'password_page') {
    if (snapshot.displayedEmail && snapshot.displayedEmail !== normalizedEmail) {
      throw new Error(`步骤 ${step}：当前密码页邮箱为 ${snapshot.displayedEmail}，与目标邮箱 ${email} 不一致，请先回到步骤 1 重新开始。`);
    }
    log(`步骤 ${step}：当前已在密码页，无需重复提交邮箱。`);
    return {
      alreadyOnPasswordPage: true,
      url: snapshot.url || location.href,
    };
  }

  if (snapshot.state !== 'email_entry' || !snapshot.emailInput) {
    if (step === 2) {
      log(`步骤 ${step}：未进入邮箱输入页，最终页面诊断快照：${JSON.stringify(getSignupEntryDiagnostics())}`, 'warn');
    }
    throw new Error(`步骤 ${step}：未找到可用的邮箱输入入口。URL: ${location.href}`);
  }

  log(`步骤 ${step}：正在填写邮箱：${email}`);
  await humanPause(500, 1400);
  await performOperationWithDelay({ stepKey: step === 2 ? 'signup-entry' : 'fill-password', kind: 'fill', label: 'signup-email' }, async () => {
    fillInput(snapshot.emailInput, email);
  });
  log(`步骤 ${step}：邮箱已填写`);

  const continueButton = snapshot.continueButton || getSignupEmailContinueButton({ allowDisabled: true });
  if (!continueButton || !isActionEnabled(continueButton)) {
    throw new Error(`步骤 ${step}：未找到可点击的“继续”按钮。URL: ${location.href}`);
  }

  log(`步骤 ${step}：邮箱已准备提交，正在前往密码页...`);
  window.setTimeout(async () => {
    try {
      throwIfStopped();
      await performOperationWithDelay({ stepKey: step === 2 ? 'signup-entry' : 'fill-password', kind: 'submit', label: 'submit-signup-email' }, async () => {
        simulateClick(continueButton);
      });
    } catch (error) {
      if (!isStopError(error)) {
        console.error('[MultiPage:openai-auth] deferred signup email submit failed:', error?.message || error);
      }
    }
  }, 120);

  return {
    submitted: true,
    email,
    url: location.href,
  };
}

// signup-phone-country 探查 + 选择 helper：跟原 monolith 同款 32 个 helper（11 个
// phone-country-utils 薄壳 thunk + 21 个 select / button / listbox / sync / ensure
// 探查与点击逻辑），全部通过工厂注入。getSignupPhoneInput / getPageTextSnapshot 是
// function declaration，被 hoist 到本文件顶层，所以即便它们的源代码行在更下面，
// 这里直接 pass 也能正常解析。
const _openaiAuthSignupPhoneCountry = self.MultiPageOpenAIAuthSignupPhoneCountry?.createOpenAIAuthSignupPhoneCountry?.({
  getSignupPhoneInput: (...args) => getSignupPhoneInput(...args),
  isVisibleElement,
  getActionText,
  getPageTextSnapshot: (...args) => getPageTextSnapshot(...args),
  sleep,
  simulateClick,
  throwIfStopped,
  getOperationDelayRunner: (...args) => getOperationDelayRunner(...args),
}) || null;
const {
  normalizePhoneDigits,
  extractDialCodeFromText,
  dispatchSignupPhoneFieldEvents,
  normalizeSignupCountryLabel,
  getSignupCountryLabelAliases,
  getSignupPhoneOptionLabel,
  normalizeSignupCountryOptionValue,
  getSignupRegionDisplayName,
  getSignupPhoneCountryMatchLabels,
  isSameSignupCountryOption,
  getSignupPhoneForm,
  getSignupPhoneControlRoots,
  querySignupPhoneCountryElements,
  isSignupPhoneCountrySelect,
  getSignupPhoneCountrySelect,
  getSignupPhoneSelectedCountryOption,
  getSignupPhoneCountryButtonText,
  getSignupPhoneCountryButton,
  getSignupPhoneDisplayedDialCode,
  getSignupPhoneHiddenNumberInput,
  resolveSignupPhoneDialCodeFromNumber,
  resolveSignupPhoneTargetDialCode,
  getSignupPhoneCountryTargetLabels,
  doesSignupPhoneCountryTextMatchTarget,
  isSignupPhoneCountrySelectionSynced,
  findSignupPhoneCountryOptionByLabel,
  findSignupPhoneCountryOptionByPhoneNumber,
  trySelectSignupPhoneCountryOption,
  getVisibleSignupPhoneCountryListboxOptions,
  findSignupPhoneCountryListboxOption,
  trySelectSignupPhoneCountryListboxOption,
  ensureSignupPhoneCountrySelected,
} = _openaiAuthSignupPhoneCountry || {};

// step5 profile 25 个 helper（中段 7 + 末段 18，含 getStep5DirectCompletionPayload
// / step5_fillNameBirthday 等）已搬到 flows/openai/content/openai-auth-step5-profile.js，
// 全部通过工厂注入。isSignupProfilePageUrl / isEmailVerificationPage / recoverCurrentAuthRetryPage
// 等 14 个 dep 是 function declaration，被 hoist 到本文件顶层。
const _openaiAuthStep5Profile = self.MultiPageOpenAIAuthStep5Profile?.createOpenAIAuthStep5Profile?.({
  isVisibleElement,
  getActionText: (...args) => getActionText(...args),
  getOperationDelayRunner: (...args) => getOperationDelayRunner(...args),
  isEmailVerificationPage: (...args) => isEmailVerificationPage(...args),
  isVerificationPageStillVisible: (...args) => isVerificationPageStillVisible(...args),
  isStep5Ready: (...args) => isStep5Ready(...args),
  isSignupProfilePageUrl: (...args) => isSignupProfilePageUrl(...args),
  isStep5CompletionChatgptUrl: (...args) => isStep5CompletionChatgptUrl(...args),
  getSignupAuthRetryPathPatterns: (...args) => getSignupAuthRetryPathPatterns(...args),
  getAuthTimeoutErrorPageState: (...args) => getAuthTimeoutErrorPageState(...args),
  getCurrentAuthRetryPageState: (...args) => getCurrentAuthRetryPageState(...args),
  recoverCurrentAuthRetryPage: (...args) => recoverCurrentAuthRetryPage(...args),
  createSignupUserAlreadyExistsError: (...args) => createSignupUserAlreadyExistsError(...args),
  createAuthMaxCheckAttemptsError: (...args) => createAuthMaxCheckAttemptsError(...args),
}) || null;
const {
  normalizeInlineText,
  isStep5AllConsentText,
  findStep5AllConsentCheckbox,
  isStep5CheckboxChecked,
  findBirthdayReactAriaSelect,
  setReactAriaBirthdaySelect,
  getStep5ErrorText,
  getStep5DirectCompletionPayload,
  isCombinedSignupVerificationProfilePage,
  waitForCombinedSignupVerificationProfilePage,
  getStep5ProfilePathPatterns,
  getStep5AuthRetryPathPatterns,
  isStep5ProfilePageUrl,
  getStep5AuthRetryPageState,
  getStep5SubmitButton,
  waitForStep5SubmitButton,
  isStep5SubmitButtonClickable,
  isStep5ProfileStillVisible,
  getStep5PostSubmitSuccessState,
  getStep5SubmitState,
  logStep5SubmitDebug,
  recoverStep5SubmitRetryPage,
  installStep5NavigationCompletionReporter,
  waitForStep5SubmitOutcome,
  step5_fillNameBirthday,
} = _openaiAuthStep5Profile || {};

function toNationalPhoneNumber(value, dialCode) {
  const digits = normalizePhoneDigits(value);
  const normalizedDialCode = normalizePhoneDigits(dialCode);
  const isExplicitInternational = /^\s*(?:\+|00)\s*\d/.test(String(value || '').trim());
  if (!digits) {
    return '';
  }
  if (normalizedDialCode && digits.startsWith(normalizedDialCode) && digits.length > normalizedDialCode.length) {
    return digits.slice(normalizedDialCode.length);
  }
  if (isExplicitInternational) {
    return digits;
  }
  return digits;
}

function toE164PhoneNumber(value, dialCode) {
  const digits = normalizePhoneDigits(value);
  const normalizedDialCode = normalizePhoneDigits(dialCode);
  const isExplicitInternational = /^\s*(?:\+|00)\s*\d/.test(String(value || '').trim());
  if (!digits) {
    return '';
  }
  if (isExplicitInternational) {
    return `+${digits}`;
  }
  if (!normalizedDialCode) {
    return `+${digits}`;
  }
  if (digits.startsWith(normalizedDialCode)) {
    return `+${digits}`;
  }
  if (digits.startsWith('0')) {
    return `+${normalizedDialCode}${digits.slice(1)}`;
  }
  return `+${normalizedDialCode}${digits}`;
}

function getPhoneInputRenderedValue(phoneInput) {
  return String(phoneInput?.value ?? phoneInput?.getAttribute?.('value') ?? '').trim();
}

function isPhoneInputValueVerified(actualValue, expectedValue, options = {}) {
  const actualDigits = normalizePhoneDigits(actualValue);
  const expectedDigits = normalizePhoneDigits(expectedValue);
  if (!actualDigits || !expectedDigits) {
    return false;
  }
  if (actualDigits === expectedDigits) {
    return true;
  }

  const dialDigits = normalizePhoneDigits(options.dialCode);
  const fullDigits = normalizePhoneDigits(options.phoneNumber);
  if (fullDigits && actualDigits === fullDigits) {
    return true;
  }
  if (!dialDigits) {
    return false;
  }
  if (actualDigits === `${dialDigits}${expectedDigits}`) {
    return true;
  }

  const localDigits = fullDigits && fullDigits.startsWith(dialDigits)
    ? fullDigits.slice(dialDigits.length)
    : expectedDigits;
  return dialDigits === '44' && actualDigits === `${dialDigits}0${localDigits}`;
}

async function waitForPhoneInputValue(phoneInput, expectedValue, options = {}) {
  const {
    timeout = 1800,
    pollInterval = 100,
    resolvePhoneInput = null,
    phoneNumber = '',
    dialCode = '',
  } = options;
  const startedAt = Date.now();
  let currentInput = phoneInput;

  while (Date.now() - startedAt < timeout) {
    throwIfStopped();
    currentInput = (typeof resolvePhoneInput === 'function' && resolvePhoneInput()) || currentInput;
    if (isPhoneInputValueVerified(getPhoneInputRenderedValue(currentInput), expectedValue, { phoneNumber, dialCode })) {
      return {
        ok: true,
        input: currentInput,
        value: getPhoneInputRenderedValue(currentInput),
      };
    }
    await sleep(pollInterval);
  }

  currentInput = (typeof resolvePhoneInput === 'function' && resolvePhoneInput()) || currentInput;
  return {
    ok: false,
    input: currentInput,
    value: getPhoneInputRenderedValue(currentInput),
  };
}

function formatPhoneHiddenFormValue({ phoneNumber = '', dialCode = '', inputValue = '' } = {}) {
  const fullDigits = normalizePhoneDigits(phoneNumber);
  if (fullDigits) {
    return `+${fullDigits}`;
  }

  const localDigits = normalizePhoneDigits(inputValue);
  if (!localDigits) {
    return '';
  }
  const dialDigits = normalizePhoneDigits(dialCode);
  return dialDigits ? `+${dialDigits}${localDigits}` : localDigits;
}

function getPhoneHiddenValueInput(phoneInput) {
  if (typeof getLoginPhoneHiddenValueInput === 'function') {
    const loginHiddenInput = getLoginPhoneHiddenValueInput(phoneInput);
    if (loginHiddenInput) {
      return loginHiddenInput;
    }
  }
  const form = phoneInput?.form || phoneInput?.closest?.('form') || null;
  const root = form || phoneInput?.closest?.('fieldset, form, [data-rac], div') || document;
  const candidates = Array.from(root?.querySelectorAll?.('input[name="phone"], input[name="phoneNumber"], input[type="hidden"][id*="phone" i]') || []);
  return candidates.find((input) => {
    if (!input || input === phoneInput) return false;
    const type = String(input.getAttribute?.('type') || input.type || '').trim().toLowerCase();
    return type === 'hidden' || !isVisibleElement(input);
  }) || null;
}

function setPhoneHiddenValue(input, value) {
  const normalizedValue = String(value || '');
  try {
    const nativeInputValueSetter = typeof window !== 'undefined'
      ? Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
      : null;
    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(input, normalizedValue);
    } else {
      input.value = normalizedValue;
    }
  } catch {
    input.value = normalizedValue;
  }
  input.dispatchEvent?.(new Event('input', { bubbles: true }));
  input.dispatchEvent?.(new Event('change', { bubbles: true }));
}

function syncPhoneHiddenFormValue(phoneInput, options = {}) {
  const hiddenInput = getPhoneHiddenValueInput(phoneInput);
  const hiddenValue = formatPhoneHiddenFormValue(options);
  if (!hiddenInput || !hiddenValue) {
    return null;
  }

  setPhoneHiddenValue(hiddenInput, hiddenValue);
  return {
    input: hiddenInput,
    value: hiddenInput.value || '',
  };
}

function isPhoneInputValueComplete(phoneInput, phoneNumber, dialCode, expectedLocalNumber = '') {
  return isPhoneInputValueVerified(getPhoneInputRenderedValue(phoneInput), expectedLocalNumber || toNationalPhoneNumber(phoneNumber, dialCode), {
    phoneNumber,
    dialCode,
  });
}

function getLoginPhoneFillCandidates(phoneNumber, dialCode, phoneInput = null) {
  const inputValue = toNationalPhoneNumber(phoneNumber, dialCode);
  const e164Value = toE164PhoneNumber(phoneNumber, dialCode);
  const dialDigits = normalizePhoneDigits(dialCode);
  const currentRenderedValue = getPhoneInputRenderedValue(phoneInput);
  const currentDigits = normalizePhoneDigits(currentRenderedValue);
  const shouldKeepDialPrefix = Boolean(
    e164Value
    && (
      String(currentRenderedValue || '').trim().startsWith('+')
      || (dialDigits && currentDigits === dialDigits)
    )
  );
  const candidates = [];
  const addCandidate = (value) => {
    const normalizedValue = String(value || '').trim();
    if (normalizedValue && !candidates.includes(normalizedValue)) {
      candidates.push(normalizedValue);
    }
  };

  if (shouldKeepDialPrefix) {
    addCandidate(e164Value);
  }
  addCandidate(inputValue);
  addCandidate(e164Value);
  return candidates;
}

function getLoginPhoneSubmitButtonDiagnostics(button) {
  if (!button) {
    return {
      present: false,
    };
  }

  return {
    present: true,
    tag: (button.tagName || '').toLowerCase(),
    type: String(button.getAttribute?.('type') || button.type || '').trim().toLowerCase(),
    text: getActionText(button).slice(0, 80),
    visible: isVisibleElement(button),
    enabled: isActionEnabled(button),
    disabled: Boolean(button.disabled),
    ariaDisabled: String(button.getAttribute?.('aria-disabled') || '').trim(),
  };
}

function getLoginPhoneInputCandidateDiagnostics(limit = 12) {
  return collectPhoneInputCandidates('input', { allowGenericText: true }).slice(0, limit);
}

async function fillLoginPhoneInputAndConfirm(phoneInput, options = {}) {
  const performOperationWithDelay = typeof getOperationDelayRunner === 'function'
    ? getOperationDelayRunner()
    : async (metadata, operation) => {
        const rootScope = typeof window !== 'undefined' ? window : globalThis;
        const gate = rootScope?.CodexOperationDelay?.performOperationWithDelay;
        return typeof gate === 'function' ? gate(metadata, operation) : operation();
      };
  const {
    phoneNumber = '',
    dialCode = '',
    visibleStep = 7,
    resolvePhoneInput = null,
    maxAttempts = 3,
  } = options;
  const inputValue = toNationalPhoneNumber(phoneNumber, dialCode);
  if (!inputValue) {
    throw new Error(`\u6b65\u9aa4 ${visibleStep}\uff1a\u624b\u673a\u53f7\u4e3a\u7a7a\uff0c\u65e0\u6cd5\u586b\u5199\u3002`);
  }

  let currentInput = phoneInput;
  let lastVerification = { ok: false, input: currentInput, value: getPhoneInputRenderedValue(currentInput) };
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    throwIfStopped();
    currentInput = (typeof resolvePhoneInput === 'function' && resolvePhoneInput()) || currentInput;
    if (!currentInput) {
      break;
    }

    const fillCandidates = getLoginPhoneFillCandidates(phoneNumber, dialCode, currentInput);
    for (const attemptedValue of fillCandidates) {
      currentInput.focus?.();
      await performOperationWithDelay({ stepKey: 'oauth-login', kind: 'fill', label: 'login-phone-number' }, async () => {
        fillInput(currentInput, attemptedValue);
      });
      lastVerification = await waitForPhoneInputValue(currentInput, inputValue, {
        resolvePhoneInput,
        phoneNumber,
        dialCode,
        timeout: 1600,
        pollInterval: 100,
      });
      if (lastVerification.ok) {
        const verifiedInput = lastVerification.input || currentInput;
        const hiddenSync = await performOperationWithDelay({ stepKey: 'oauth-login', kind: 'hidden-sync', label: 'login-phone-hidden-sync' }, async () => (
          syncPhoneHiddenFormValue(verifiedInput, { phoneNumber, dialCode, inputValue })
        ));
        const expectedHiddenDigits = normalizePhoneDigits(phoneNumber) || `${normalizePhoneDigits(dialCode)}${normalizePhoneDigits(inputValue)}`;
        if (hiddenSync && expectedHiddenDigits && normalizePhoneDigits(hiddenSync.value) !== expectedHiddenDigits) {
          throw new Error(`\u6b65\u9aa4 ${visibleStep}\uff1a\u624b\u673a\u53f7\u9690\u85cf\u63d0\u4ea4\u5b57\u6bb5\u540c\u6b65\u5931\u8d25\uff0c\u671f\u671b ${expectedHiddenDigits}\uff0c\u5b9e\u9645 ${normalizePhoneDigits(hiddenSync.value) || '\u7a7a'}\u3002`);
        }
        log(
          `\u6b65\u9aa4 ${visibleStep}\uff1a\u624b\u673a\u53f7\u8f93\u5165\u6821\u9a8c\u901a\u8fc7 ${JSON.stringify({
            attemptedValue,
            renderedValue: lastVerification.value,
            input: getLoginPhoneInputDiagnostics(verifiedInput),
            hidden: getLoginPhoneHiddenValueDiagnostics(hiddenSync?.input || getPhoneHiddenValueInput(verifiedInput)),
          })}`,
          'info',
          { step: visibleStep, stepKey: 'oauth-login' }
        );
        return {
          input: verifiedInput,
          inputValue,
          attemptedValue,
          renderedValue: lastVerification.value,
          hiddenInput: hiddenSync?.input || null,
          hiddenValue: hiddenSync?.value || '',
        };
      }
    }

    const currentDigits = normalizePhoneDigits(lastVerification.value);
    log(
      `\u6b65\u9aa4 ${visibleStep}\uff1a\u624b\u673a\u53f7\u8f93\u5165\u6846\u672a\u7a33\u5b9a\u5199\u5165\uff08\u7b2c ${attempt}/${maxAttempts} \u6b21\uff09\uff0c\u671f\u671b\u672c\u5730\u53f7 ${inputValue}\uff0c\u5f53\u524d\u503c ${currentDigits || '\u7a7a'}\uff0c\u51c6\u5907\u91cd\u8bd5\u3002`,
      'warn',
      { step: visibleStep, stepKey: 'oauth-login' }
    );
    await sleep(200);
  }

  const actualDigits = normalizePhoneDigits(lastVerification.value);
  throw new Error(`\u6b65\u9aa4 ${visibleStep}\uff1a\u624b\u673a\u53f7\u586b\u5199\u540e\u6821\u9a8c\u5931\u8d25\uff0c\u5b8c\u6574\u53f7\u7801 ${phoneNumber}\uff0c\u533a\u53f7 +${dialCode || '\u672a\u8bc6\u522b'}\uff0c\u671f\u671b\u8f93\u5165\u672c\u5730\u53f7 ${inputValue}\uff0c\u5b9e\u9645\u8f93\u5165\u6846\u4e3a ${actualDigits || '\u7a7a'}\uff0c\u5df2\u505c\u6b62\u63d0\u4ea4\u3002`);
}

function resolveSignupPhoneDialCode(phoneInput, options = {}) {
  const { phoneNumber = '', countryLabel = '' } = options;
  const displayedDialCode = getSignupPhoneDisplayedDialCode(phoneInput);
  if (displayedDialCode) {
    return displayedDialCode;
  }
  const countryText = String(countryLabel || '').trim();
  if (/australia|澳大利亚/i.test(countryText)) return '61';
  if (/thailand|泰国/i.test(countryText)) return '66';
  if (/vietnam|越南/i.test(countryText)) return '84';
  if (/england|united kingdom|英国|uk/i.test(countryText)) return '44';
  const digits = normalizePhoneDigits(phoneNumber);
  const knownDialCodes = ['66', '84', '61', '44', '1', '81', '82', '86', '852', '855', '856', '60', '62', '63', '65'];
  return knownDialCodes.find((code) => digits.startsWith(code) && digits.length > code.length) || '';
}

async function waitForSignupPhoneEntryState(options = {}) {
  const performOperationWithDelay = typeof getOperationDelayRunner === 'function'
    ? getOperationDelayRunner()
    : async (metadata, operation) => {
        const rootScope = typeof window !== 'undefined' ? window : globalThis;
        const gate = rootScope?.CodexOperationDelay?.performOperationWithDelay;
        return typeof gate === 'function' ? gate(metadata, operation) : operation();
      };
  const {
    timeout = 20000,
    step = 2,
  } = options;
  const start = Date.now();
  const maxSignupEntryClickRetries = 5;
  const maxSignupEntryClickAttempts = maxSignupEntryClickRetries + 1;
  let lastTriggerClickAt = 0;
  let clickAttempts = 0;
  let lastSwitchToPhoneAt = 0;
  let lastMoreOptionsClickAt = 0;
  let slowSnapshotLogged = false;

  while (Date.now() - start < timeout) {
    throwIfStopped();
    const snapshot = inspectSignupEntryState();

    if (snapshot.state === 'password_page') {
      return snapshot;
    }

    if (snapshot.state === 'phone_entry' && snapshot.phoneInput) {
      return snapshot;
    }

    if (snapshot.state === 'email_entry') {
      const switchToPhone = snapshot.switchToPhoneTrigger || findSignupUsePhoneTrigger();
      if (switchToPhone && Date.now() - lastSwitchToPhoneAt >= 1500) {
        lastSwitchToPhoneAt = Date.now();
        log(`步骤 ${step}：检测到邮箱输入模式，正在切换到手机号注册入口...`);
        await humanPause(350, 900);
        await performOperationWithDelay({ stepKey: 'signup-phone-entry', kind: 'click', label: 'switch-to-signup-phone' }, async () => {
          simulateClick(switchToPhone);
        });
      } else {
        const moreOptionsTrigger = findSignupMoreOptionsTrigger();
        if (moreOptionsTrigger && Date.now() - lastMoreOptionsClickAt >= 1500) {
          lastMoreOptionsClickAt = Date.now();
          log(`步骤 ${step}：手机号入口可能隐藏在更多选项中，正在展开更多选项...`);
          await humanPause(350, 900);
          await performOperationWithDelay({ stepKey: 'signup-phone-entry', kind: 'click', label: 'signup-phone-more-options' }, async () => {
            simulateClick(moreOptionsTrigger);
          });
        } else if (!switchToPhone && !slowSnapshotLogged && Date.now() - start >= 5000) {
          slowSnapshotLogged = true;
          log(`步骤 ${step}：尚未找到手机号入口，页面诊断快照：${JSON.stringify(getSignupEntryDiagnostics())}`, 'warn');
        }
      }
      await sleep(250);
      continue;
    }

    if (snapshot.state === 'entry_home' && snapshot.signupTrigger) {
      if (Date.now() - lastTriggerClickAt >= 1500) {
        if (clickAttempts >= maxSignupEntryClickAttempts) {
          log(`步骤 ${step}：官网注册入口已完成 ${maxSignupEntryClickRetries} 次重试，页面仍未进入手机号输入页，停止重试。`, 'warn');
          return snapshot;
        }
        lastTriggerClickAt = Date.now();
        clickAttempts += 1;
        const retryAttempt = clickAttempts - 1;
        log(retryAttempt > 0
          ? `步骤 ${step}：上次点击后仍未进入手机号输入页，等待 3 秒后重试点击官网注册入口（重试 ${retryAttempt}/${maxSignupEntryClickRetries}）...`
          : `步骤 ${step}：已找到官网注册入口，等待 3 秒后点击...`);
        await sleep(3000);
        throwIfStopped();
        const clickTarget = findSignupEntryTrigger({ allowHiddenFallback: false }) || snapshot.signupTrigger;
        if (!isVisibleElement(clickTarget)) {
          log(`步骤 ${step}：注册入口仍处于不可见状态，继续按入口重试节奏尝试恢复点击...`, 'warn');
        }
        await humanPause(350, 900);
        await performOperationWithDelay({ stepKey: 'signup-phone-entry', kind: 'click', label: 'open-signup-entry' }, async () => {
          simulateClick(clickTarget);
        });
      }
      await sleep(250);
      continue;
    }

    if (!slowSnapshotLogged && Date.now() - start >= 5000) {
      slowSnapshotLogged = true;
      log(`步骤 ${step}：等待手机号注册入口超过 5 秒，页面诊断快照：${JSON.stringify(getSignupEntryDiagnostics())}`, 'warn');
    }

    await sleep(250);
  }

  const finalSnapshot = inspectSignupEntryState();
  log(`步骤 ${step}：等待手机号注册入口超时，最终状态快照：${JSON.stringify(getSignupEntryStateSummary(finalSnapshot))}`, 'warn');
  return finalSnapshot;
}

async function submitSignupPhoneNumberAndContinue(payload = {}) {
  const performOperationWithDelay = typeof getOperationDelayRunner === 'function'
    ? getOperationDelayRunner()
    : async (metadata, operation) => {
        const rootScope = typeof window !== 'undefined' ? window : globalThis;
        const gate = rootScope?.CodexOperationDelay?.performOperationWithDelay;
        return typeof gate === 'function' ? gate(metadata, operation) : operation();
      };
  const phoneNumber = String(payload.phoneNumber || '').trim();
  const countryLabel = String(payload.countryLabel || '').trim();
  if (!phoneNumber) {
    throw new Error('未提供手机号，步骤 2 无法继续。');
  }

  const snapshot = await waitForSignupPhoneEntryState({ timeout: 25000, step: 2 });
  if (snapshot.state === 'password_page') {
    log('步骤 2：当前已在密码页，无需重复提交手机号。');
    return {
      alreadyOnPasswordPage: true,
      url: snapshot.url || location.href,
    };
  }

  if (snapshot.state !== 'phone_entry' || !snapshot.phoneInput) {
    throw new Error(`步骤 2：未找到可用的手机号输入入口。URL: ${location.href}`);
  }

  const countrySelection = await ensureSignupPhoneCountrySelected(snapshot.phoneInput, {
    countryLabel,
    phoneNumber,
  });
  if (countrySelection.hasCountryControl && !countrySelection.matched) {
    const currentCountryText = getSignupPhoneCountryButtonText(snapshot.phoneInput) || '未知';
    const targetDialCode = resolveSignupPhoneTargetDialCode({ countryLabel, phoneNumber }, countrySelection.selectedOption);
    const targetLabel = targetDialCode
      ? `目标区号 +${targetDialCode}（号码 ${phoneNumber}${countryLabel ? `，国家 ${countryLabel}` : ''}）`
      : (countryLabel || phoneNumber);
    throw new Error(`步骤 2：手机号国家下拉框未能自动切换到 ${targetLabel}，当前显示为 ${currentCountryText}，已停止提交以避免区号不匹配。`);
  }

  const dialCode = resolveSignupPhoneDialCode(snapshot.phoneInput, {
    phoneNumber,
    countryId: payload.countryId,
    countryLabel,
  });
  const inputValue = toNationalPhoneNumber(phoneNumber, dialCode);
  if (!inputValue) {
    throw new Error('步骤 2：手机号为空，无法填写。');
  }

  log(`步骤 2：正在填写手机号：${phoneNumber}`);
  await humanPause(500, 1400);
  await performOperationWithDelay({ stepKey: 'signup-phone-entry', kind: 'fill', label: 'signup-phone-number' }, async () => {
    fillInput(snapshot.phoneInput, inputValue);
  });
  const hiddenPhoneNumberInput = getSignupPhoneHiddenNumberInput(snapshot.phoneInput);
  const e164PhoneNumber = toE164PhoneNumber(phoneNumber, dialCode);
  if (hiddenPhoneNumberInput && e164PhoneNumber) {
    await performOperationWithDelay({ stepKey: 'signup-phone-entry', kind: 'hidden-sync', label: 'signup-phone-hidden-sync' }, async () => {
      fillInput(hiddenPhoneNumberInput, e164PhoneNumber);
    });
  }
  log(`步骤 2：手机号已填写：${phoneNumber}${dialCode ? `（区号 +${dialCode}，本地号 ${inputValue}）` : ''}`);

  const continueButton = getSignupEmailContinueButton({ allowDisabled: true });
  if (!continueButton || !isActionEnabled(continueButton)) {
    throw new Error(`步骤 2：未找到可点击的“继续”按钮。URL: ${location.href}`);
  }

  log('步骤 2：手机号已准备提交，正在前往下一页...');
  window.setTimeout(async () => {
    try {
      throwIfStopped();
      await performOperationWithDelay({ stepKey: 'signup-phone-entry', kind: 'submit', label: 'submit-signup-phone' }, async () => {
        simulateClick(continueButton);
      });
    } catch (error) {
      if (!isStopError(error)) {
        console.error('[MultiPage:openai-auth] deferred signup phone submit failed:', error?.message || error);
      }
    }
  }, 120);

  return {
    submitted: true,
    deferredSubmit: true,
    phoneNumber,
    phoneInputValue: snapshot.phoneInput?.value || inputValue,
    url: location.href,
  };
}

// ============================================================
// Step 2: Click Register, fill email, then continue to password page
// ============================================================

async function step2_clickRegister(payload = {}) {
  if (payload?.signupMethod === 'phone' || payload?.phoneNumber) {
    return submitSignupPhoneNumberAndContinue(payload);
  }
  const { email } = payload;
  return fillSignupEmailAndContinue(email, 2);
}

// ============================================================
// Step 3: Fill Password
// ============================================================

async function step3_fillEmailPassword(payload) {
  const resolvePasswordPageInfo = (rawUrl = '') => {
    const url = String(rawUrl || '').trim() || String(location.href || '');
    let path = String(location.pathname || '').trim();
    try {
      path = new URL(url, 'https://auth.openai.com').pathname || path;
    } catch {
      // Keep the current pathname fallback; this only tags the completion payload.
    }
    const mode = /\/log-in\/password(?:[/?#]|$)/i.test(path)
      ? 'login'
      : (/\/(?:create-account|u\/signup|signup)\/password(?:[/?#]|$)/i.test(path) ? 'signup' : '');
    return { url, path, mode };
  };
  const performOperationWithDelay = typeof getOperationDelayRunner === 'function'
    ? getOperationDelayRunner()
    : async (metadata, operation) => {
        const rootScope = typeof window !== 'undefined' ? window : globalThis;
        const gate = rootScope?.CodexOperationDelay?.performOperationWithDelay;
        return typeof gate === 'function' ? gate(metadata, operation) : operation();
      };
  const { email, password } = payload;
  if (!password) throw new Error('未提供密码，步骤 3 需要可用密码。');
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const accountIdentifierType = String(payload?.accountIdentifierType || '').trim().toLowerCase() === 'phone'
    ? 'phone'
    : 'email';
  const accountIdentifier = String(payload?.accountIdentifier || email || payload?.phoneNumber || '').trim();

  let snapshot = inspectSignupEntryState();
  if (snapshot.state === 'entry_home') {
    throw new Error('当前仍停留在 ChatGPT 官网首页，请先完成步骤 2。');
  }

  if (
    snapshot.state === 'phone_verification_page'
    || snapshot.state === 'verification_page'
    || snapshot.state === 'profile_page'
    || snapshot.state === 'logged_in_home'
  ) {
    const completionPayload = {
      email: email || '',
      phoneNumber: String(payload?.phoneNumber || '').trim(),
      accountIdentifierType,
      accountIdentifier,
      signupVerificationRequestedAt: (
        snapshot.state === 'phone_verification_page'
        || snapshot.state === 'verification_page'
      ) ? Date.now() : null,
      skippedPasswordPage: true,
      deferredSubmit: false,
      ...(snapshot.skipProfileStep ? { skipProfileStep: true } : {}),
    };
    log('步骤 3：当前页面已进入验证码或后续阶段，密码页按已跳过处理。', 'warn');
    reportComplete(3, completionPayload);
    return completionPayload;
  }

  if (snapshot.state === 'email_entry') {
    const transition = await fillSignupEmailAndContinue(email, 3);
    if (!transition.alreadyOnPasswordPage) {
      await sleep(1200);
      await ensureSignupPasswordPageReady();
    }
    snapshot = inspectSignupEntryState();
  }

  if (snapshot.state !== 'password_page' || !snapshot.passwordInput) {
    await ensureSignupPasswordPageReady();
    snapshot = inspectSignupEntryState();
  }

  if (snapshot.state !== 'password_page' || !snapshot.passwordInput) {
    logSignupPasswordDiagnostics('步骤 3：未能识别可填写的密码输入框');
  }

  if (snapshot.state !== 'password_page' || !snapshot.passwordInput) {
    throw new Error('在密码页未找到密码输入框。URL: ' + location.href);
  }
  if (normalizedEmail && snapshot.displayedEmail && snapshot.displayedEmail !== normalizedEmail) {
    throw new Error(`当前密码页邮箱为 ${snapshot.displayedEmail}，与目标邮箱 ${email} 不一致，请先回到步骤 1 重新开始。`);
  }

  const passwordPageInfo = resolvePasswordPageInfo(snapshot.url || location.href);
  await humanPause(600, 1500);
  await performOperationWithDelay({ stepKey: 'fill-password', kind: 'fill', label: 'signup-password' }, async () => {
    fillInput(snapshot.passwordInput, password);
  });
  log('步骤 3：密码已填写');

  const submitBtn = snapshot.submitButton
    || getSignupPasswordSubmitButton({ allowDisabled: true })
    || await waitForElementByText('button', /continue|sign\s*up|submit|注册|创建|続行|続ける|次へ|サインアップ|登録|作成|create/i, 5000).catch(() => null);

  if (!submitBtn) {
    logSignupPasswordDiagnostics('步骤 3：未找到可提交的密码页按钮');
  } else if (typeof findOneTimeCodeLoginTrigger === 'function' && findOneTimeCodeLoginTrigger()) {
    logSignupPasswordDiagnostics('步骤 3：当前密码页同时存在一次性验证码入口', 'info');
  }

  const isLoginPasswordPage = passwordPageInfo.mode === 'login';
  const signupVerificationRequestedAt = submitBtn && !isLoginPasswordPage ? Date.now() : null;
  const completionPayload = {
    email,
    phoneNumber: String(payload?.phoneNumber || '').trim(),
    accountIdentifierType,
    accountIdentifier,
    signupVerificationRequestedAt,
    deferredSubmit: Boolean(submitBtn),
    passwordPageUrl: passwordPageInfo.url,
    passwordPagePath: passwordPageInfo.path,
    passwordPageMode: passwordPageInfo.mode,
    ...(isLoginPasswordPage ? { passwordLoginFlow: true } : {}),
  };

  reportComplete(3, completionPayload);

  if (submitBtn) {
    window.setTimeout(async () => {
      try {
        throwIfStopped();
        await sleep(500);
        await humanPause(500, 1300);
        await performOperationWithDelay({ stepKey: 'fill-password', kind: 'submit', label: 'submit-signup-password' }, async () => {
          simulateClick(submitBtn);
        });
        log('步骤 3：表单已提交');
      } catch (error) {
        if (!isStopError(error)) {
          console.error('[MultiPage:openai-auth] deferred step 3 submit failed:', error?.message || error);
        }
      }
    }, 120);
  }

  return completionPayload;
}

// ============================================================
// Fill Verification Code (used by step 4 and step 7)
// ============================================================

const INVALID_VERIFICATION_CODE_PATTERN = /代码不正确|验证码不正确|验证码错误|コードが正しくありません|コードが間違っています|無効なコード|認証コードが正しくありません|確認コードが正しくありません|code\s+(?:is\s+)?incorrect|invalid\s+code|incorrect\s+code|try\s+again/i;
const VERIFICATION_PAGE_PATTERN = /检查您的收件箱|输入我们刚刚向|重新发送电子邮件|重新发送验证码|代码不正确|受信(?:トレイ|箱)を確認|(?:認証|確認)?コードを入力|送信した(?:認証|確認)?コード|メールで送信|再送信|email\s+verification|check\s+your\s+inbox|enter\s+the\s+code|we\s+just\s+sent|we\s+emailed|resend/i;
const OAUTH_CONSENT_PAGE_PATTERN = /使用\s*ChatGPT\s*登录到\s*Codex|ChatGPT\s*(?:を使用して|で)\s*Codex\s*(?:に)?(?:ログイン|サインイン)|Codex\s*(?:に)?(?:ログイン|サインイン)|認可|承認|sign\s+in\s+to\s+codex(?:\s+with\s+chatgpt)?|login\s+to\s+codex|log\s+in\s+to\s+codex|authorize|授权/i;
const OAUTH_CONSENT_FORM_SELECTOR = 'form[action*="/sign-in-with-chatgpt/" i][action*="/consent" i]';
const CONTINUE_ACTION_PATTERN = /继续|続行|続ける|次へ|continue/i;
const ADD_PHONE_PAGE_PATTERN = /add[\s-]*(?:a\s+)?phone|添加(?:手机|手机号|电话号码)|绑定(?:手机|手机号|电话号码)|验证(?:你的|您)?(?:手机|手机号|电话号码)|需要(?:手机|手机号|电话号码)|提供(?:手机|手机号|电话号码)|電話番号(?:を)?(?:追加|登録|確認|認証)|電話番号が必要|携帯(?:電話)?番号(?:を)?(?:追加|登録|確認|認証)|provide\s+(?:a\s+)?phone\s+number|phone\s+number\s+(?:required|verification)|verify\s+(?:your\s+)?phone|confirm\s+(?:your\s+)?phone/i;
const ADD_EMAIL_PAGE_PATTERN = /add[\s-]*email|添加(?:电子邮件|邮箱)|要求提供(?:电子邮件|邮箱)地址|提供(?:电子邮件|邮箱)地址|(?:メールアドレス|メール|電子メール)(?:を)?(?:追加|登録|提供)|メールアドレスが必要|provide\s+(?:an?\s+)?email\s+address|email\s+address\s+required/i;
const AUTH_TIMEOUT_ERROR_TITLE_PATTERN = /糟糕，出错了|問題が発生しました|エラーが発生しました|something\s+went\s+wrong|oops/i;
const AUTH_TIMEOUT_ERROR_DETAIL_PATTERN = /operation\s+timed\s+out|timed\s+out|请求超时|操作超时|タイムアウト|failed\s+to\s+fetch|network\s+error|fetch\s+failed|ネットワークエラー|取得に失敗/i;
// AUTH_ROUTE_ERROR_PATTERN / STEP4_405_RECOVERY_* 实际定义在
// flows/openai/content/openai-auth-route-recovery.js，这里 destructure 出来
// 让本文件其它常量/工厂调用点无须改动；同模块的 10 个 helper 函数在
// authPageRecovery 之后通过 createOpenAIAuthRouteRecovery 注入并 destructure。
const {
  AUTH_ROUTE_ERROR_PATTERN,
  STEP4_405_RECOVERY_ERROR_PREFIX,
  STEP4_405_RECOVERY_LIMIT,
} = self.MultiPageOpenAIAuthRouteRecovery || {};
const SIGNUP_USER_ALREADY_EXISTS_ERROR_PREFIX = 'SIGNUP_USER_ALREADY_EXISTS::';
const SIGNUP_PHONE_PASSWORD_MISMATCH_ERROR_PREFIX = 'SIGNUP_PHONE_PASSWORD_MISMATCH::';
const SIGNUP_CREATE_ACCOUNT_FAILED_ERROR_PREFIX = 'SIGNUP_CREATE_ACCOUNT_FAILED::';
const AUTH_MAX_CHECK_ATTEMPTS_ERROR_PREFIX = 'AUTH_MAX_CHECK_ATTEMPTS::';
const STEP8_EMAIL_IN_USE_ERROR_PREFIX = 'STEP8_EMAIL_IN_USE::';
const SIGNUP_EMAIL_EXISTS_PATTERN = /与此电子邮件地址相关联的帐户已存在|この(?:メールアドレス|メール|電子メール)(?:に関連付けられた)?アカウントは(?:既に|すでに)存在|メールアドレス.*(?:既に|すでに)存在|account\s+associated\s+with\s+this\s+email\s+address\s+already\s+exists|email\s+address.*already\s+exists/i;
const SIGNUP_PHONE_PASSWORD_MISMATCH_PATTERN = /incorrect\s+phone\s+number\s+or\s+password|phone\s+number\s+or\s+password|電話番号またはパスワード|電話番号.*アカウントは(?:既に|すでに)存在|与此(?:电话|手机)号码相关联的帐户已存在|account\s+associated\s+with\s+this\s+phone\s+number\s+already\s+exists/i;
const SIGNUP_CREATE_ACCOUNT_FAILED_PATTERN = /创建(?:帐户|账户|账号)失败，请重试|(?:帐户|账户|账号)创建失败，请重试|アカウント(?:の)?作成に失敗.*(?:再試行|もう一度)|failed\s+to\s+create\s+(?:your\s+)?account.*try\s+again|account\s+creation\s+failed.*try\s+again|couldn'?t\s+create\s+(?:your\s+)?account.*try\s+again/i;

const authPageRecovery = self.MultiPageAuthPageRecovery?.createAuthPageRecovery?.({
  detailPattern: AUTH_TIMEOUT_ERROR_DETAIL_PATTERN,
  getActionText,
  getPageTextSnapshot,
  humanPause,
  isActionEnabled,
  isVisibleElement,
  log,
  routeErrorPattern: AUTH_ROUTE_ERROR_PATTERN,
  simulateClick,
  sleep,
  throwIfStopped,
  titlePattern: AUTH_TIMEOUT_ERROR_TITLE_PATTERN,
}) || null;

// 405 路由错误恢复 helper：跟原 monolith 同款 10 个 helper，全部通过工厂注入。
// recoverCurrentAuthRetryPage 是 function declaration，被 hoist 到本文件顶层，
// 所以即便它的源代码行在更下面，这里直接 pass 也能正常解析。
const _openaiAuthRouteRecovery = self.MultiPageOpenAIAuthRouteRecovery?.createOpenAIAuthRouteRecovery?.({
  log,
  recoverCurrentAuthRetryPage: (...args) => recoverCurrentAuthRetryPage(...args),
}) || null;
const {
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
} = _openaiAuthRouteRecovery || {};

// choose-account 探查 + 决策 helper：跟原 monolith 同款 10 个 helper，全部通过工厂注入。
// inspectLoginAuthState / normalizeStep6Snapshot / getPageTextSnapshot /
// getLoginVerificationDisplayedEmail / throwIfStopped / sleep 都是 function declaration，
// 被 hoist 到本文件顶层，所以即便它们的源代码行在更下面，这里直接 pass 也能正常解析。
const _openaiAuthChooseAccount = self.MultiPageOpenAIAuthChooseAccount?.createOpenAIAuthChooseAccount?.({
  isVisibleElement,
  isActionEnabled,
  getPageTextSnapshot: (...args) => getPageTextSnapshot(...args),
  getLoginVerificationDisplayedEmail: (...args) => getLoginVerificationDisplayedEmail(...args),
  inspectLoginAuthState: (...args) => inspectLoginAuthState(...args),
  normalizeStep6Snapshot: (...args) => normalizeStep6Snapshot(...args),
  throwIfStopped,
  sleep,
}) || null;
const {
  normalizeAuthAccountIdentifier,
  getChooseAccountCandidateText,
  isChooseAccountPage,
  isChooseAccountRemovalAction,
  resolveChooseAccountClickTarget,
  resolveChooseAccountCardTarget,
  findChooseAccountButtonForEmail,
  findChooseAccountOtherAccountButton,
  getChooseAccountListedEmails,
  resolveChooseAccountAction,
} = _openaiAuthChooseAccount || {};

function getVerificationErrorText() {
  const messages = [];
  const selectors = [
    '.react-aria-FieldError',
    '[slot="errorMessage"]',
    '[id$="-error"]',
    '[data-invalid="true"] + *',
    '[aria-invalid="true"] + *',
    '[class*="error"]',
  ];

  for (const selector of selectors) {
    document.querySelectorAll(selector).forEach((el) => {
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (text) {
        messages.push(text);
      }
    });
  }

  const invalidInput = document.querySelector(`${VERIFICATION_CODE_INPUT_SELECTOR}[aria-invalid="true"], ${VERIFICATION_CODE_INPUT_SELECTOR}[data-invalid="true"]`);
  if (invalidInput) {
    const wrapper = invalidInput.closest('form, [data-rac], ._root_18qcl_51, div');
    if (wrapper) {
      const text = (wrapper.textContent || '').replace(/\s+/g, ' ').trim();
      if (text) {
        messages.push(text);
      }
    }
  }

  return messages.find((text) => INVALID_VERIFICATION_CODE_PATTERN.test(text)) || '';
}

function createSignupUserAlreadyExistsError() {
  return new Error(
    `${SIGNUP_USER_ALREADY_EXISTS_ERROR_PREFIX}步骤 4：检测到 user_already_exists，说明当前用户已存在，当前轮将直接停止。`
  );
}

function createSignupPhonePasswordMismatchError(detailText = '') {
  const detail = String(detailText || '').replace(/\s+/g, ' ').trim();
  const suffix = detail ? `页面提示：${detail}` : '页面提示注册手机号不可继续使用，需重新开始当前轮。';
  return new Error(
    `${SIGNUP_PHONE_PASSWORD_MISMATCH_ERROR_PREFIX}步骤 3：检测到注册手机号异常，需要重新开始当前轮。${suffix}`
  );
}

function createSignupCreateAccountFailedError(detailText = '') {
  const detail = String(detailText || '').replace(/\s+/g, ' ').trim();
  const suffix = detail ? `页面提示：${detail}` : '页面提示创建帐户失败，请重试。';
  return new Error(
    `${SIGNUP_CREATE_ACCOUNT_FAILED_ERROR_PREFIX}步骤 3：检测到创建帐户失败，需要重新开始当前轮。${suffix}`
  );
}

function createAuthMaxCheckAttemptsError() {
  return new Error(`${AUTH_MAX_CHECK_ATTEMPTS_ERROR_PREFIX}max_check_attempts on auth retry page; restart the current auth step without clicking Retry.`);
}

function createStep8EmailInUseError() {
  return new Error(`${STEP8_EMAIL_IN_USE_ERROR_PREFIX}email_in_use on add-email verification page; choose a different email.`);
}

function getVisibleFieldErrorText() {
  const selectors = [
    '.react-aria-FieldError',
    '[slot="errorMessage"]',
    '[id$="-error"]',
    '[data-invalid="true"] + *',
    '[aria-invalid="true"] + *',
    '[class*="error"]',
    '[role="alert"]',
  ];

  for (const selector of selectors) {
    const match = Array.from(document.querySelectorAll(selector)).find((el) => {
      if (!isVisibleElement(el)) return false;
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      return Boolean(text);
    });
    if (match) {
      return (match.textContent || '').replace(/\s+/g, ' ').trim();
    }
  }

  return '';
}

function getSignupPasswordFieldErrorText() {
  const text = getVisibleFieldErrorText();
  if (text && (SIGNUP_PHONE_PASSWORD_MISMATCH_PATTERN.test(text) || SIGNUP_CREATE_ACCOUNT_FAILED_PATTERN.test(text))) {
    return text;
  }

  const passwordInput = getSignupPasswordInput();
  if (passwordInput) {
    const wrapper = passwordInput.closest('form, [data-rac], [role="group"], section, div');
    const wrapperText = (wrapper?.textContent || '').replace(/\s+/g, ' ').trim();
    if (wrapperText && (SIGNUP_PHONE_PASSWORD_MISMATCH_PATTERN.test(wrapperText) || SIGNUP_CREATE_ACCOUNT_FAILED_PATTERN.test(wrapperText))) {
      return wrapperText;
    }
  }

  return '';
}

function isStep5Ready() {
  return Boolean(
    document.querySelector('input[name="name"], input[autocomplete="name"], input[name="birthday"], input[name="age"], [role="spinbutton"][data-type="year"]')
  );
}

function isSignupProfilePageUrl(rawUrl = location.href) {
  const url = String(rawUrl || '').trim();
  if (!url) {
    return false;
  }

  try {
    const parsed = new URL(url);
    const host = String(parsed.hostname || '').toLowerCase();
    if (!['auth.openai.com', 'auth0.openai.com', 'accounts.openai.com'].includes(host)) {
      return false;
    }
    return /\/(?:create-account\/profile|u\/signup\/profile|signup\/profile|about-you)(?:[/?#]|$)/i.test(String(parsed.pathname || ''));
  } catch {
    return false;
  }
}

function isLikelyLoggedInChatgptHomeUrl(rawUrl = location.href) {
  const url = String(rawUrl || '').trim();
  if (!url) {
    return false;
  }

  try {
    const parsed = new URL(url);
    const host = String(parsed.hostname || '').toLowerCase();
    if (!['chatgpt.com', 'www.chatgpt.com', 'chat.openai.com'].includes(host)) {
      return false;
    }

    const path = String(parsed.pathname || '');
    if (/^\/(?:auth\/|create-account\/|email-verification|log-in|add-phone)(?:[/?#]|$)/i.test(path)) {
      return false;
    }

    const signupTrigger = typeof findSignupEntryTrigger === 'function'
      ? findSignupEntryTrigger()
      : null;
    if (signupTrigger) {
      return false;
    }

    if (typeof document !== 'undefined' && document && typeof document.querySelectorAll === 'function') {
      const loginActionPattern = /登录|ログイン|サインイン|log\s*in|sign\s*in/i;
      const candidates = document.querySelectorAll(
        'a, button, [role="button"], [role="link"], input[type="button"], input[type="submit"]'
      );

      for (const el of candidates) {
        const text = typeof getActionText === 'function'
          ? getActionText(el)
          : [
            el?.textContent,
            el?.value,
            el?.getAttribute?.('aria-label'),
            el?.getAttribute?.('title'),
          ]
            .filter(Boolean)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
        if (!text || !loginActionPattern.test(text)) {
          continue;
        }

        const visible = typeof isVisibleElement === 'function'
          ? isVisibleElement(el)
          : true;
        if (!visible) {
          continue;
        }

        const enabled = typeof isActionEnabled === 'function'
          ? isActionEnabled(el)
          : (Boolean(el) && !el.disabled && el?.getAttribute?.('aria-disabled') !== 'true');
        if (enabled) {
          return false;
        }
      }
    }

    return true;
  } catch {
    return false;
  }
}

function isStep5CompletionChatgptUrl(rawUrl = location.href) {
  const url = String(rawUrl || '').trim();
  if (!url) {
    return false;
  }

  try {
    const parsed = new URL(url);
    const protocol = String(parsed.protocol || '').toLowerCase();
    const host = String(parsed.hostname || '').toLowerCase();
    if (protocol !== 'https:' || !['chatgpt.com', 'www.chatgpt.com'].includes(host)) {
      return false;
    }

    const path = String(parsed.pathname || '');
    return !/^\/(?:auth\/|create-account\/|email-verification|log-in|add-phone)(?:[/?#]|$)/i.test(path);
  } catch {
    return false;
  }
}

function getStep4PostVerificationState(options = {}) {
  const { ignoreVerificationVisibility = false } = options;
  // Newer auth flows can briefly render profile fields before the email-verification
  // form fully exits. Do not advance to Step 5 while verification UI is still present.
  if (!ignoreVerificationVisibility && isVerificationPageStillVisible()) {
    return null;
  }

  if (isStep5Ready() || isSignupProfilePageUrl()) {
    return {
      state: 'step5',
      url: location.href,
    };
  }

  if (isLikelyLoggedInChatgptHomeUrl()) {
    return {
      state: 'logged_in_home',
      skipProfileStep: true,
      url: location.href,
    };
  }

  return null;
}

function getPageTextSnapshot() {
  return (document.body?.innerText || document.body?.textContent || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getLoginVerificationDisplayedEmail() {
  const pageText = getPageTextSnapshot();
  const matches = pageText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig) || [];
  return matches[0] ? String(matches[0]).trim().toLowerCase() : '';
}

function getPhoneVerificationDisplayedPhone() {
  const pageText = getPageTextSnapshot();
  const matches = pageText.match(/\+\d[\d\s-]{6,}\d/g) || [];
  return matches[0] ? String(matches[0]).replace(/\s+/g, ' ').trim() : '';
}

// choose-account \u63a2\u67e5 + \u51b3\u7b56 helper\uff08normalizeAuthAccountIdentifier /
// getChooseAccountCandidateText / isChooseAccountPage / isChooseAccountRemovalAction /
// resolveChooseAccountClickTarget / resolveChooseAccountCardTarget /
// findChooseAccountButtonForEmail / findChooseAccountOtherAccountButton /
// getChooseAccountListedEmails / resolveChooseAccountAction\uff09
// \u5df2\u642c\u5230 flows/openai/content/openai-auth-choose-account.js\uff0c
// \u5728\u5e38\u91cf\u5757\u9644\u8fd1\u901a\u8fc7 MultiPageOpenAIAuthChooseAccount.createOpenAIAuthChooseAccount({...})
// \u88c5\u914d\u540e destructure \u66b4\u9732\u7ed9\u672c\u4f5c\u7528\u57df\uff0c\u6240\u4ee5\u8fd9\u91cc\u7684\u6240\u6709 callsite \u65e0\u9700\u4fee\u6539\u3002

function getOAuthConsentForm() {
  return document.querySelector(OAUTH_CONSENT_FORM_SELECTOR);
}

function getPrimaryContinueButton() {
  const consentForm = getOAuthConsentForm();
  if (consentForm) {
    const formButtons = Array.from(
      consentForm.querySelectorAll('button[type="submit"], input[type="submit"], [role="button"]')
    );

    const formContinueButton = formButtons.find((el) => {
      if (!isVisibleElement(el)) return false;

      const ddActionName = el.getAttribute?.('data-dd-action-name') || '';
      return ddActionName === 'Continue' || CONTINUE_ACTION_PATTERN.test(getActionText(el));
    });
    if (formContinueButton) {
      return formContinueButton;
    }

    const firstVisibleSubmit = formButtons.find(isVisibleElement);
    if (firstVisibleSubmit) {
      return firstVisibleSubmit;
    }
  }

  const continueBtn = document.querySelector(
    `${OAUTH_CONSENT_FORM_SELECTOR} button[type="submit"], button[type="submit"][data-dd-action-name="Continue"], button[type="submit"]._primary_3rdp0_107`
  );
  if (continueBtn && isVisibleElement(continueBtn)) {
    return continueBtn;
  }

  const buttons = document.querySelectorAll('button, [role="button"]');
  return Array.from(buttons).find((el) => {
    if (!isVisibleElement(el)) return false;

    const ddActionName = el.getAttribute?.('data-dd-action-name') || '';
    return ddActionName === 'Continue' || CONTINUE_ACTION_PATTERN.test(getActionText(el));
  }) || null;
}

function isOAuthConsentPage() {
  const pageText = getPageTextSnapshot();
  if (OAUTH_CONSENT_PAGE_PATTERN.test(pageText)) {
    return true;
  }

  if (getOAuthConsentForm()) {
    return true;
  }

  return /\bcodex\b/i.test(pageText) && /\bchatgpt\b/i.test(pageText) && Boolean(getPrimaryContinueButton());
}

function isVerificationPageStillVisible() {
  if (getCurrentAuthRetryPageState('signup_password') || getCurrentAuthRetryPageState('login')) {
    return false;
  }
  if (isPhoneVerificationPageReady()) {
    return false;
  }
  if (getVerificationCodeTarget()) return true;
  if (findResendVerificationCodeTrigger({ allowDisabled: true })) return true;
  if (document.querySelector('form[action*="email-verification" i]')) return true;

  if (!isEmailVerificationPage()) {
    return false;
  }

  return VERIFICATION_PAGE_PATTERN.test(getPageTextSnapshot());
}

function isAddPhonePageReady() {
  const path = `${location.pathname || ''} ${location.href || ''}`;
  if (/\/add-phone(?:[/?#]|$)/i.test(path)) return true;

  const addPhoneForm = document.querySelector('form[action*="/add-phone" i]');
  if (addPhoneForm && isVisibleElement(addPhoneForm)) {
    return true;
  }

  return ADD_PHONE_PAGE_PATTERN.test(getPageTextSnapshot());
}

function isAddEmailPageReady() {
  const path = `${location.pathname || ''} ${location.href || ''}`;
  if (/\/add-email(?:[/?#]|$)/i.test(path)) {
    return true;
  }

  const emailInput = getLoginEmailInput();
  if (!emailInput) {
    return false;
  }

  const form = emailInput.form || emailInput.closest?.('form') || null;
  const formAction = String(form?.getAttribute?.('action') || form?.action || '');
  if (/\/add-email(?:[/?#]|$)/i.test(formAction)) {
    return true;
  }

  const pageText = getPageTextSnapshot();
  return ADD_EMAIL_PAGE_PATTERN.test(pageText)
    && !/继续使用(?:电子邮件地址|邮箱)登录|(?:メールアドレス|メール|電子メール)(?:で|を使用して)?(?:続行|続ける|ログイン|サインイン)|continue\s+using\s+(?:an?\s+)?email(?:\s+address)?\s+(?:to\s+)?(?:log\s*in|sign\s*in)|continue\s+with\s+email/i.test(pageText);
}

function isPhoneVerificationPageReady() {
  const path = `${location.pathname || ''} ${location.href || ''}`;
  const isPhoneVerificationRoute = /\/phone-verification(?:[/?#]|$)/i.test(path);
  const isContactVerificationRoute = /\/contact-verification(?:[/?#]|$)/i.test(path);
  if (isContactVerificationRoute && getContactVerificationServerErrorText()) {
    return false;
  }
  if (isPhoneVerificationRoute || isContactVerificationRoute) {
    return true;
  }

  const form = document.querySelector('form[action*="/phone-verification" i]');
  if (form && isVisibleElement(form)) {
    return true;
  }

  if (document.querySelector('button[name="intent"][value="resend"]') && getPhoneVerificationDisplayedPhone()) {
    return true;
  }

  const pageText = getPageTextSnapshot();
  const displayedPhone = getPhoneVerificationDisplayedPhone();
  return Boolean(getVerificationCodeTarget())
    && Boolean(displayedPhone)
    && /check\s+your\s+phone|phone\s+verification|verify\s+your\s+phone|sms|text\s+message|code\s+to\s+\+/.test(pageText);
}

function getDocumentReadyStateSnapshot() {
  const readyState = typeof document !== 'undefined' && document
    ? String(document.readyState || '').trim().toLowerCase()
    : '';
  return readyState || 'complete';
}

function isDocumentLoadComplete() {
  return getDocumentReadyStateSnapshot() === 'complete';
}

async function waitForDocumentLoadComplete(timeout = 15000, label = '页面') {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    throwIfStopped();
    if (isDocumentLoadComplete()) {
      return true;
    }
    await sleep(150);
  }

  throw new Error(`${label}长时间未完成加载，当前 readyState=${getDocumentReadyStateSnapshot()}。URL: ${location.href}`);
}

function isSignupVerificationPageInteractiveReady(snapshot = null) {
  if (!isDocumentLoadComplete()) {
    return false;
  }

  const resolvedSnapshot = snapshot || inspectSignupVerificationState();
  if (resolvedSnapshot?.state !== 'verification') {
    return false;
  }

  return Boolean(getVerificationCodeTarget());
}

function isStep8Ready() {
  const continueBtn = getPrimaryContinueButton();
  if (!continueBtn) return false;
  if (isVerificationPageStillVisible()) return false;
  if (isPhoneVerificationPageReady()) return false;
  if (isAddPhonePageReady()) return false;
  if (isAddEmailPageReady()) return false;

  return isOAuthConsentPage();
}

const phoneAuthHelpers = self.MultiPagePhoneAuth?.createPhoneAuthHelpers?.({
  fillInput,
  getActionText,
  getPageTextSnapshot,
  getVerificationErrorText,
  humanPause,
  isActionEnabled,
  isAddPhonePageReady,
  isConsentReady: isStep8Ready,
  isPhoneVerificationPageReady,
  isVisibleElement,
  simulateClick,
  sleep,
  throwIfStopped,
  waitForElement,
}) || {
  submitPhoneNumber: async () => {
    throw new Error('Phone auth helpers are unavailable.');
  },
  submitPhoneVerificationCode: async () => {
    throw new Error('Phone auth helpers are unavailable.');
  },
  resendPhoneVerificationCode: async () => {
    throw new Error('Phone auth helpers are unavailable.');
  },
  checkPhoneResendError: () => ({ hasError: false, reason: '', message: '', url: location.href }),
  returnToAddPhone: async () => {
    throw new Error('Phone auth helpers are unavailable.');
  },
};

async function waitForPhoneVerificationProfileCompletion(timeout = 30000) {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    throwIfStopped();

    if (isStep8Ready()) {
      return {
        success: true,
        consentReady: true,
        url: location.href,
      };
    }

    if (isAddPhonePageReady()) {
      return {
        returnedToAddPhone: true,
        url: location.href,
      };
    }

    await sleep(150);
  }

  if (isStep8Ready()) {
    return {
      success: true,
      consentReady: true,
      url: location.href,
    };
  }

  return {
    success: true,
    assumed: true,
    url: location.href,
  };
}

async function submitPhoneVerificationCodeWithProfileFallback(payload = {}) {
  const result = await phoneAuthHelpers.submitPhoneVerificationCode(payload);
  if (!(isStep5Ready() || isSignupProfilePageUrl(result?.url || location.href))) {
    return result;
  }

  const signupProfile = payload?.signupProfile || {};
  if (!signupProfile.firstName || !signupProfile.lastName) {
    throw new Error('手机号验证后进入资料页，但未提供步骤 5 所需的姓名数据。');
  }

  await step5_fillNameBirthday(signupProfile);
  const nextState = await waitForPhoneVerificationProfileCompletion();
  const mergedResult = {
    ...result,
    ...nextState,
    profileCompleted: true,
  };
  if (nextState.consentReady || nextState.returnedToAddPhone) {
    delete mergedResult.assumed;
  }
  return mergedResult;
}

function isSignupPasswordPage() {
  return /\/(?:create-account|log-in)\/password(?:[/?#]|$)/i.test(location.pathname || '');
}

function getSignupPasswordInput() {
  const input = document.querySelector('input[type="password"]');
  return input && isVisibleElement(input) ? input : null;
}

function getSignupPasswordSubmitButton({ allowDisabled = false } = {}) {
  const direct = document.querySelector('button[type="submit"]');
  if (direct && isVisibleElement(direct) && (allowDisabled || isActionEnabled(direct))) {
    return direct;
  }

  const candidates = document.querySelectorAll('button, [role="button"]');
  return Array.from(candidates).find((el) => {
    if (!isVisibleElement(el) || (!allowDisabled && !isActionEnabled(el))) return false;
    const text = getActionText(el);
    return /继续|continue|submit|创建|続行|続ける|次へ|サインアップ|登録|作成|create/i.test(text);
  }) || null;
}

function getAuthRetryButton({ allowDisabled = false } = {}) {
  if (authPageRecovery?.getAuthRetryButton) {
    return authPageRecovery.getAuthRetryButton({ allowDisabled });
  }

  const direct = document.querySelector('button[data-dd-action-name="Try again"]');
  if (direct && isVisibleElement(direct) && (allowDisabled || isActionEnabled(direct))) {
    return direct;
  }

  const candidates = document.querySelectorAll('button, [role="button"]');
  return Array.from(candidates).find((el) => {
    if (!isVisibleElement(el) || (!allowDisabled && !isActionEnabled(el))) return false;
    const text = getActionText(el);
    return /重试|try\s+again/i.test(text);
  }) || null;
}

function getAuthTimeoutErrorPageState(options = {}) {
  if (authPageRecovery?.getAuthTimeoutErrorPageState) {
    return authPageRecovery.getAuthTimeoutErrorPageState(options);
  }

  const { pathPatterns = [] } = options;
  const path = location.pathname || '';
  if (pathPatterns.length && !pathPatterns.some((pattern) => pattern.test(path))) {
    return null;
  }

  const retryButton = getAuthRetryButton({ allowDisabled: true });
  if (!retryButton) {
    return null;
  }

  const text = getPageTextSnapshot();
  const titleMatched = AUTH_TIMEOUT_ERROR_TITLE_PATTERN.test(text)
    || AUTH_TIMEOUT_ERROR_TITLE_PATTERN.test(document.title || '');
  const detailMatched = AUTH_TIMEOUT_ERROR_DETAIL_PATTERN.test(text);
  const routeErrorMatched = AUTH_ROUTE_ERROR_PATTERN.test(text);
  const fetchFailedMatched = /failed\s+to\s+fetch|network\s+error|fetch\s+failed/i.test(text);
  const maxCheckAttemptsBlocked = /max_check_attempts/i.test(text);
  const emailInUseBlocked = /email_in_use/i.test(text);
  const userAlreadyExistsBlocked = /user_already_exists/i.test(text);

  if (!titleMatched && !detailMatched && !routeErrorMatched && !fetchFailedMatched && !maxCheckAttemptsBlocked && !emailInUseBlocked && !userAlreadyExistsBlocked) {
    return null;
  }

  return {
    path,
    url: location.href,
    retryButton,
    retryEnabled: isActionEnabled(retryButton),
    titleMatched,
    detailMatched,
    routeErrorMatched,
    fetchFailedMatched,
    maxCheckAttemptsBlocked,
    emailInUseBlocked,
    userAlreadyExistsBlocked,
  };
}

function getSignupAuthRetryPathPatterns() {
  return [
    /\/create-account\/password(?:[/?#]|$)/i,
    /\/email-verification(?:[/?#]|$)/i,
  ];
}

function getLoginAuthRetryPathPatterns() {
  return [
    /\/log-in(?:[/?#]|$)/i,
    /\/email-verification(?:[/?#]|$)/i,
  ];
}

function getAuthRetryPathPatternsForFlow(flow = 'auth') {
  switch (flow) {
    case 'signup':
    case 'signup_password':
      return getSignupAuthRetryPathPatterns();
    case 'login':
      return getLoginAuthRetryPathPatterns();
    default:
      return [];
  }
}

function getCurrentAuthRetryPageState(flow = 'auth') {
  return getAuthTimeoutErrorPageState({
    pathPatterns: getAuthRetryPathPatternsForFlow(flow),
  });
}

async function recoverCurrentAuthRetryPage(payload = {}) {
  const performOperationWithDelay = typeof getOperationDelayRunner === 'function'
    ? getOperationDelayRunner()
    : async (metadata, operation) => {
        const rootScope = typeof window !== 'undefined' ? window : globalThis;
        const gate = rootScope?.CodexOperationDelay?.performOperationWithDelay;
        return typeof gate === 'function' ? gate(metadata, operation) : operation();
      };
  const {
    flow = 'auth',
    logLabel = '',
    maxClickAttempts = 5,
    pathPatterns = null,
    step = null,
    timeoutMs = 12000,
    waitAfterClickMs = 3000,
  } = payload;
  const resolvedPathPatterns = Array.isArray(pathPatterns)
    ? pathPatterns
    : getAuthRetryPathPatternsForFlow(flow);
  if (authPageRecovery?.recoverAuthRetryPage) {
    return authPageRecovery.recoverAuthRetryPage({
      logLabel,
      maxClickAttempts,
      pathPatterns: resolvedPathPatterns,
      step,
      stepKey: step === 8 || flow === 'login' ? 'oauth-login' : 'fetch-signup-code',
      timeoutMs,
      waitAfterClickMs,
    });
  }

  const maxIdlePolls = timeoutMs > 0
    ? Math.max(1, Math.ceil(timeoutMs / Math.max(1, 250)))
    : Number.POSITIVE_INFINITY;
  let clickCount = 0;
  let idlePollCount = 0;
  while (clickCount < maxClickAttempts) {
    throwIfStopped();
    const retryState = getAuthTimeoutErrorPageState({ pathPatterns: resolvedPathPatterns });
    if (!retryState) {
      return {
        recovered: clickCount > 0,
        clickCount,
        url: location.href,
      };
    }

    if (retryState.maxCheckAttemptsBlocked) {
      throw new Error('CF_SECURITY_BLOCKED::您已触发Cloudflare 安全防护系统，已完全停止流程，请不要短时间内多次进行重新发送验证码，连续刷新、反复点击重试会加重风控；请先关闭页面等待 15-30 分钟，让系统的临时限制自动解除。或者更换浏览器');
    }
    if (retryState.userAlreadyExistsBlocked) {
      throw createSignupUserAlreadyExistsError();
    }
    if (retryState.retryButton && retryState.retryEnabled) {
      idlePollCount = 0;
      clickCount += 1;
      log(`${logLabel || `步骤 ${step || '?'}：检测到重试页，正在点击“重试”恢复`}（第 ${clickCount} 次）...`, 'warn');
      await humanPause(300, 800);
      await performOperationWithDelay({ stepKey: step === 8 || flow === 'login' ? 'oauth-login' : 'fetch-signup-code', kind: 'click', label: 'auth-retry-click' }, async () => {
        simulateClick(retryState.retryButton);
      });
      const settleStart = Date.now();
      while (Date.now() - settleStart < waitAfterClickMs) {
        throwIfStopped();
        if (!getAuthTimeoutErrorPageState({ pathPatterns: resolvedPathPatterns })) {
          return {
            recovered: true,
            clickCount,
            url: location.href,
          };
        }
        await sleep(250);
      }
      continue;
    }

    idlePollCount += 1;
    if (idlePollCount >= maxIdlePolls) {
      throw new Error(`${logLabel || `步骤 ${step || '?'}：重试页恢复`}超时：重试按钮长时间不可点击。URL: ${location.href}`);
    }

    await sleep(250);
  }

  const finalRetryState = getAuthTimeoutErrorPageState({ pathPatterns: resolvedPathPatterns });
  if (!finalRetryState) {
    return {
      recovered: clickCount > 0,
      clickCount,
      url: location.href,
    };
  }
  if (finalRetryState.maxCheckAttemptsBlocked) {
    throw new Error('CF_SECURITY_BLOCKED::您已触发Cloudflare 安全防护系统，已完全停止流程，请不要短时间内多次进行重新发送验证码，连续刷新、反复点击重试会加重风控；请先关闭页面等待 15-30 分钟，让系统的临时限制自动解除。或者更换浏览器');
  }
  if (finalRetryState.userAlreadyExistsBlocked) {
    throw createSignupUserAlreadyExistsError();
  }

  throw new Error(`${logLabel || `步骤 ${step || '?'}：重试页恢复`}失败：已连续点击“重试” ${maxClickAttempts} 次，页面仍未恢复。URL: ${location.href}`);
}

function getSignupPasswordTimeoutErrorPageState() {
  return getAuthTimeoutErrorPageState({
    pathPatterns: getSignupAuthRetryPathPatterns(),
  });
}

function getLoginTimeoutErrorPageState() {
  return getAuthTimeoutErrorPageState({
    pathPatterns: getLoginAuthRetryPathPatterns(),
  });
}

function isLoginPhoneUsernameKind(rawUrl = location.href) {
  const url = String(rawUrl || '').trim();
  if (!url) {
    return false;
  }

  try {
    const parsed = new URL(url);
    return /\/log-in(?:[/?#]|$)/i.test(parsed.pathname || '')
      && String(parsed.searchParams.get('usernameKind') || '').toLowerCase() === 'phone_number';
  } catch {
    return /\/log-in(?:[/?#]|$)/i.test(url) && /[?&]usernameKind=phone_number(?:[&#]|$)/i.test(url);
  }
}

function isLoginPhoneEntryPageText(pageText = getPageTextSnapshot()) {
  const normalizedText = String(pageText || '').replace(/\s+/g, ' ').trim();
  if (!normalizedText) {
    return false;
  }

  if (isAddPhonePageReady() || isPhoneVerificationPageReady()) {
    return false;
  }

  return LOGIN_PHONE_ENTRY_PAGE_PATTERN.test(normalizedText);
}

function isInsideHiddenPhoneControl(element) {
  if (!element) {
    return true;
  }
  return Boolean(element.closest?.('[aria-hidden="true"], [hidden], [data-testid="hidden-select-container"], [data-react-aria-prevent-focus="true"]'));
}

function summarizePhoneInputCandidate(element, options = {}) {
  const summary = {
    tag: (element?.tagName || '').toLowerCase(),
    type: '',
    name: '',
    id: '',
    autocomplete: '',
    placeholder: '',
    ariaLabel: '',
    visible: false,
    hiddenControl: true,
    readOnly: false,
    maxLength: 0,
    usable: false,
    skipReason: '',
  };

  if (!element) {
    summary.skipReason = 'missing_element';
    return summary;
  }

  summary.visible = isVisibleElement(element);
  summary.hiddenControl = isInsideHiddenPhoneControl(element);
  summary.type = String(element.getAttribute?.('type') || element.type || '').trim().toLowerCase();
  summary.name = String(element.getAttribute?.('name') || element.name || '').trim();
  summary.id = String(element.getAttribute?.('id') || element.id || '').trim();
  summary.autocomplete = String(element.getAttribute?.('autocomplete') || '').trim().toLowerCase();
  summary.placeholder = String(element.getAttribute?.('placeholder') || '').trim().slice(0, 80);
  summary.ariaLabel = String(element.getAttribute?.('aria-label') || '').trim().slice(0, 80);

  const hasReadonlyAttribute = typeof element.hasAttribute === 'function'
    ? element.hasAttribute('readonly')
    : element.readOnly === true;
  summary.readOnly = element.readOnly === true
    || hasReadonlyAttribute
    || String(element.getAttribute?.('aria-readonly') || '').trim().toLowerCase() === 'true';
  summary.maxLength = Number(element.getAttribute?.('maxlength') || element.maxLength || 0);

  if (summary.hiddenControl) {
    summary.skipReason = 'inside_hidden_control';
    return summary;
  }
  if (!summary.visible) {
    summary.skipReason = 'not_visible';
    return summary;
  }
  if (summary.type === 'hidden') {
    summary.skipReason = 'hidden_type';
    return summary;
  }
  if (summary.readOnly) {
    summary.skipReason = 'readonly';
    return summary;
  }
  if (summary.maxLength === 6) {
    summary.skipReason = 'verification_code_input';
    return summary;
  }

  const normalizedName = summary.name.toLowerCase();
  const normalizedId = summary.id.toLowerCase();
  const combinedText = `${normalizedName} ${normalizedId} ${summary.placeholder} ${summary.ariaLabel}`;
  if (isLoginEmailLikeInput(element)) {
    summary.skipReason = 'email_like';
    return summary;
  }
  if (
    summary.type === 'tel'
    || summary.autocomplete === 'tel'
    || /phone|tel/i.test(`${normalizedName} ${normalizedId}`)
    || /手机|电话|手机号|电话号码|国家号码|phone|mobile|telephone/i.test(combinedText)
  ) {
    summary.usable = true;
    return summary;
  }

  if (options.allowGenericText && (!summary.type || summary.type === 'text')) {
    summary.usable = true;
    return summary;
  }

  summary.skipReason = 'not_phone_like';
  return summary;
}

function isUsablePhoneInputElement(element, options = {}) {
  return summarizePhoneInputCandidate(element, options).usable;
}

function collectPhoneInputCandidates(selector, options = {}) {
  return Array.from(document.querySelectorAll(selector))
    .map((element) => summarizePhoneInputCandidate(element, options));
}

function findUsablePhoneInput(selector, options = {}) {
  return Array.from(document.querySelectorAll(selector))
    .find((element) => isUsablePhoneInputElement(element, options)) || null;
}

function getLoginInputAttributeText(input) {
  return {
    type: String(input?.getAttribute?.('type') || input?.type || '').trim().toLowerCase(),
    autocomplete: String(input?.getAttribute?.('autocomplete') || '').trim().toLowerCase(),
    name: String(input?.getAttribute?.('name') || input?.name || '').trim(),
    id: String(input?.getAttribute?.('id') || input?.id || '').trim(),
    placeholder: String(input?.getAttribute?.('placeholder') || '').trim(),
    ariaLabel: String(input?.getAttribute?.('aria-label') || '').trim(),
  };
}

function isLoginEmailLikeInput(input) {
  const summary = getLoginInputAttributeText(input);
  const nameId = `${summary.name} ${summary.id}`;
  const labelText = `${summary.placeholder} ${summary.ariaLabel}`;
  return summary.type === 'email'
    || summary.autocomplete === 'email'
    || /email|mail/i.test(nameId)
    || /email|电子邮件|邮箱|メールアドレス|メール|電子メール/i.test(labelText);
}

function getLoginEmailInput() {
  const input = Array.from(document.querySelectorAll([
    'input[type="email"]',
    'input[autocomplete="email"]',
    'input[name="email"]',
    'input[name="username"]',
    'input[autocomplete="username"]',
    'input[id*="email" i]',
    'input[placeholder*="email" i]',
    'input[placeholder*="Email"]',
    'input[placeholder*="电子邮件"]',
    'input[placeholder*="邮箱"]',
    'input[placeholder*="メール"]',
    'input[aria-label*="email" i]',
    'input[aria-label*="电子邮件"]',
    'input[aria-label*="邮箱"]',
    'input[aria-label*="メール"]',
  ].join(', '))).find((candidate) => isVisibleElement(candidate)) || null;
  if (!input) {
    return null;
  }
  if ((isLoginPhoneUsernameKind() || isLoginPhoneEntryPageText()) && !isLoginEmailLikeInput(input)) {
    return null;
  }
  return input;
}

function getLoginPhoneInput() {
  const phonePage = isLoginPhoneUsernameKind() || isLoginPhoneEntryPageText();
  const selector = [
    'input[type="tel"]:not([maxlength="6"])',
    'input[name*="phone" i]:not([type="hidden"])',
    'input[id*="phone" i]:not([type="hidden"])',
    'input[autocomplete="tel"]',
    'input[inputmode="tel"]',
    'input[placeholder*="phone" i]',
    'input[aria-label*="phone" i]',
    'input[placeholder*="telephone" i]',
    'input[aria-label*="telephone" i]',
    'input[placeholder*="手机"]',
    'input[aria-label*="手机"]',
    'input[placeholder*="电话"]',
    'input[aria-label*="电话"]',
    'input[placeholder*="電話"]',
    'input[aria-label*="電話"]',
    'input[placeholder*="携帯"]',
    'input[aria-label*="携帯"]',
    phonePage ? 'input[name="username"]:not([maxlength="6"])' : '',
    phonePage ? 'input[id*="username" i]:not([maxlength="6"])' : '',
    phonePage ? 'input[autocomplete="username"]:not([maxlength="6"])' : '',
    phonePage ? 'input[type="text"]:not([maxlength="6"])' : '',
  ].filter(Boolean).join(', ');
  return findUsablePhoneInput(selector, { allowGenericText: phonePage });
}

function getLoginPhoneInputDiagnostics(phoneInput) {
  return {
    tag: (phoneInput?.tagName || '').toLowerCase(),
    type: String(phoneInput?.getAttribute?.('type') || phoneInput?.type || '').trim().toLowerCase(),
    name: String(phoneInput?.getAttribute?.('name') || phoneInput?.name || '').trim(),
    id: String(phoneInput?.getAttribute?.('id') || phoneInput?.id || '').trim(),
    autocomplete: String(phoneInput?.getAttribute?.('autocomplete') || '').trim().toLowerCase(),
    placeholder: String(phoneInput?.getAttribute?.('placeholder') || '').trim().slice(0, 80),
    ariaLabel: String(phoneInput?.getAttribute?.('aria-label') || '').trim().slice(0, 80),
    value: getPhoneInputRenderedValue(phoneInput),
  };
}

function getLoginPhoneHiddenValueInput(phoneInput) {
  const form = phoneInput?.form || phoneInput?.closest?.('form') || null;
  const root = form || phoneInput?.closest?.('fieldset, form, [data-rac], div') || document;
  const candidates = Array.from(root?.querySelectorAll?.([
    'input[name="phone"]',
    'input[name*="phone" i]',
    'input[name="phoneNumber"]',
    'input[name*="telephone" i]',
    'input[type="hidden"][id*="phone" i]',
    'input[type="hidden"][id*="telephone" i]',
    'input[type="hidden"][name*="phone" i]',
    'input[type="hidden"][name*="telephone" i]',
  ].join(', ')) || []);
  return candidates.find((input) => {
    if (!input || input === phoneInput) return false;
    const type = String(input.getAttribute?.('type') || input.type || '').trim().toLowerCase();
    return type === 'hidden' || !isVisibleElement(input);
  }) || null;
}

function getLoginPhoneHiddenValueDiagnostics(hiddenInput) {
  return {
    tag: (hiddenInput?.tagName || '').toLowerCase(),
    type: String(hiddenInput?.getAttribute?.('type') || hiddenInput?.type || '').trim().toLowerCase(),
    name: String(hiddenInput?.getAttribute?.('name') || hiddenInput?.name || '').trim(),
    id: String(hiddenInput?.getAttribute?.('id') || hiddenInput?.id || '').trim(),
    value: String(hiddenInput?.value || hiddenInput?.getAttribute?.('value') || '').trim(),
  };
}

function getLoginPasswordInput() {
  const input = document.querySelector('input[type="password"]');
  return input && isVisibleElement(input) ? input : null;
}

function getLoginSubmitButton({ allowDisabled = false } = {}) {
  const direct = document.querySelector('button[type="submit"], input[type="submit"]');
  if (direct && isVisibleElement(direct) && (allowDisabled || isActionEnabled(direct))) {
    return direct;
  }

  const candidates = document.querySelectorAll(
    'button, a, [role="button"], [role="link"], input[type="button"], input[type="submit"]'
  );
  return Array.from(candidates).find((el) => {
    if (!isVisibleElement(el) || (!allowDisabled && !isActionEnabled(el))) return false;
    const text = getActionText(el);
    if (!text || ONE_TIME_CODE_LOGIN_PATTERN.test(text)) return false;
    return /continue|next|submit|sign\s*in|log\s*in|继续|下一步|登录|続行|続ける|次へ|ログイン|サインイン|送信/i.test(text);
  }) || null;
}

function normalizeCountryLabel(value) {
  const phoneCountryUtils = (typeof self !== 'undefined' ? self : globalThis)?.MultiPagePhoneCountryUtils
    || globalThis?.MultiPagePhoneCountryUtils
    || {};
  if (typeof phoneCountryUtils.normalizeCountryLabel === 'function') {
    return phoneCountryUtils.normalizeCountryLabel(value);
  }
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function getLoginPhoneCountrySelect(phoneInput) {
  const scope = phoneInput?.closest?.('fieldset, form, [data-rac], div') || document;
  const select = scope.querySelector?.('select');
  return select && isVisibleElement(select) ? select : null;
}

function getLoginPhoneCountryOptionLabel(option) {
  const phoneCountryUtils = (typeof self !== 'undefined' ? self : globalThis)?.MultiPagePhoneCountryUtils
    || globalThis?.MultiPagePhoneCountryUtils
    || {};
  if (typeof phoneCountryUtils.getOptionLabel === 'function') {
    return phoneCountryUtils.getOptionLabel(option);
  }
  return String(option?.textContent || option?.label || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getLoginPhoneCountryOptionMatchLabels(option) {
  const phoneCountryUtils = (typeof self !== 'undefined' ? self : globalThis)?.MultiPagePhoneCountryUtils
    || globalThis?.MultiPagePhoneCountryUtils
    || {};
  if (typeof phoneCountryUtils.getOptionMatchLabels === 'function') {
    const rootScope = typeof self !== 'undefined' ? self : globalThis;
    return phoneCountryUtils.getOptionMatchLabels(option, {
      document: typeof document !== 'undefined' ? document : null,
      navigator: rootScope?.navigator || globalThis?.navigator || null,
      getOptionLabel: getLoginPhoneCountryOptionLabel,
    });
  }

  const labels = new Set();
  const pushLabel = (value) => {
    const label = String(value || '').replace(/\s+/g, ' ').trim();
    if (label) {
      labels.add(label);
    }
  };

  pushLabel(getLoginPhoneCountryOptionLabel(option));
  pushLabel(option?.value);
  return Array.from(labels);
}

function findLoginPhoneCountryOptionByLabel(select, countryLabel) {
  const phoneCountryUtils = (typeof self !== 'undefined' ? self : globalThis)?.MultiPagePhoneCountryUtils
    || globalThis?.MultiPagePhoneCountryUtils
    || {};
  if (select && typeof phoneCountryUtils.findOptionByCountryLabel === 'function') {
    return phoneCountryUtils.findOptionByCountryLabel(select.options, countryLabel, {
      document: typeof document !== 'undefined' ? document : null,
      navigator: (typeof self !== 'undefined' ? self : globalThis)?.navigator || globalThis?.navigator || null,
      getOptionLabel: getLoginPhoneCountryOptionLabel,
    });
  }

  const normalizedTarget = normalizeCountryLabel(countryLabel);
  if (!select || !normalizedTarget) {
    return null;
  }

  const options = Array.from(select.options || []);
  return options.find((option) => (
    getLoginPhoneCountryOptionMatchLabels(option)
      .some((label) => normalizeCountryLabel(label) === normalizedTarget)
  )) || options.find((option) => {
    const normalizedLabels = getLoginPhoneCountryOptionMatchLabels(option)
      .map((label) => normalizeCountryLabel(label))
      .filter(Boolean);
    return normalizedLabels.some((optionLabel) => (
      optionLabel.length > 2
      && normalizedTarget.length > 2
      && (optionLabel.includes(normalizedTarget) || normalizedTarget.includes(optionLabel))
    ));
  }) || null;
}

function findLoginPhoneCountryOptionByNumber(select, phoneNumber) {
  if (!select) {
    return null;
  }
  const phoneCountryUtils = (typeof self !== 'undefined' ? self : globalThis)?.MultiPagePhoneCountryUtils
    || globalThis?.MultiPagePhoneCountryUtils
    || {};
  if (typeof phoneCountryUtils.findOptionByPhoneNumber === 'function') {
    return phoneCountryUtils.findOptionByPhoneNumber(select.options, phoneNumber, {
      getOptionLabel: getLoginPhoneCountryOptionLabel,
    });
  }
  const digits = normalizePhoneDigits(phoneNumber);
  if (!digits) {
    return null;
  }

  let bestMatch = null;
  let bestDialCodeLength = 0;
  for (const option of Array.from(select.options || [])) {
    const dialCode = normalizePhoneDigits(extractDialCodeFromText(getLoginPhoneCountryOptionLabel(option)));
    if (!dialCode || !digits.startsWith(dialCode)) {
      continue;
    }
    if (dialCode.length > bestDialCodeLength) {
      bestMatch = option;
      bestDialCodeLength = dialCode.length;
    }
  }
  return bestMatch;
}

async function selectCountryForPhoneInput(phoneInput, phoneNumber = '', countryLabel = '', options = {}) {
  const visibleStep = Math.floor(Number(options?.visibleStep) || 0) || 7;
  const selection = await ensureSignupPhoneCountrySelected(phoneInput, {
    countryLabel,
    phoneNumber,
  });
  const selectedOption = selection.selectedOption || getSignupPhoneSelectedCountryOption(phoneInput);
  const targetDialCode = resolveSignupPhoneTargetDialCode({ countryLabel, phoneNumber }, selectedOption);
  const displayedDialCode = getSignupPhoneDisplayedDialCode(phoneInput);

  if (selection.hasCountryControl && targetDialCode) {
    if (!selection.matched || (displayedDialCode && displayedDialCode !== targetDialCode)) {
      const currentCountryText = getSignupPhoneCountryButtonText(phoneInput) || displayedDialCode || '未知';
      const targetLabel = `目标区号 +${targetDialCode}（号码 ${phoneNumber}${countryLabel ? `，国家 ${countryLabel}` : ''}）`;
      throw new Error(`步骤 ${visibleStep}：手机号登录国家下拉框未能自动切换到 ${targetLabel}，当前显示为 ${currentCountryText}，已停止提交以避免区号不匹配。`);
    }
    return targetDialCode;
  }

  const select = getLoginPhoneCountrySelect(phoneInput);
  const fallbackSelectedOption = select?.options?.[select.selectedIndex] || null;
  return extractDialCodeFromText(getLoginPhoneCountryOptionLabel(fallbackSelectedOption))
    || displayedDialCode
    || resolveSignupPhoneDialCodeFromNumber(phoneNumber);
}

function resolveLoginPhoneDialCode(phoneInput, options = {}) {
  return resolveSignupPhoneDialCode(phoneInput, options);
}

function findLoginEntryTrigger() {
  const candidates = Array.from(document.querySelectorAll(
    'button, a, [role="button"], [role="link"], input[type="button"], input[type="submit"]'
  )).filter((el) => isVisibleElement(el) && isActionEnabled(el));

  const preferred = candidates.find((el) => {
    const text = getActionText(el);
    if (!text || LOGIN_CODE_ONLY_ACTION_PATTERN.test(text) || LOGIN_EXTERNAL_IDP_PATTERN.test(text)) return false;
    return /continue\s+(?:with|using)\s+email|use\s+(?:an?\s+)?email|email\s+address|邮箱|电子邮件|メールアドレス|メール|電子メール/i.test(text);
  });
  if (preferred) return preferred;

  return candidates.find((el) => {
    const text = getActionText(el);
    if (!text || LOGIN_CODE_ONLY_ACTION_PATTERN.test(text) || LOGIN_EXTERNAL_IDP_PATTERN.test(text)) return false;
    return LOGIN_ENTRY_ACTION_PATTERN.test(text);
  }) || null;
}

function findLoginPhoneEntryTrigger() {
  const candidates = Array.from(document.querySelectorAll(
    'button, a, [role="button"], [role="link"], input[type="button"], input[type="submit"]'
  )).filter((el) => isVisibleElement(el) && isActionEnabled(el));

  return candidates.find((el) => {
    const text = getActionText(el);
    if (!text || LOGIN_CODE_ONLY_ACTION_PATTERN.test(text) || LOGIN_EXTERNAL_IDP_PATTERN.test(text)) return false;
    return LOGIN_SWITCH_TO_PHONE_PATTERN.test(text)
      || (
        LOGIN_PHONE_ACTION_PATTERN.test(text)
        && !/email|邮箱|电子邮件|メールアドレス|メール|電子メール/i.test(text)
      );
  }) || null;
}

function findLoginMoreOptionsTrigger() {
  const candidates = Array.from(document.querySelectorAll(
    'button, a, [role="button"], [role="link"], input[type="button"], input[type="submit"]'
  )).filter((el) => isVisibleElement(el) && isActionEnabled(el));

  return candidates.find((el) => {
    const text = getActionText(el);
    if (!text || LOGIN_EXTERNAL_IDP_PATTERN.test(text)) return false;
    return LOGIN_MORE_OPTIONS_PATTERN.test(text);
  }) || null;
}

function inspectLoginAuthState() {
  const retryState = getLoginTimeoutErrorPageState();
  const verificationTarget = getVerificationCodeTarget();
  const passwordInput = getLoginPasswordInput();
  const emailInput = getLoginEmailInput();
  const phoneInput = getLoginPhoneInput();
  const switchTrigger = findOneTimeCodeLoginTrigger();
  const loginEntryTrigger = findLoginEntryTrigger();
  const phoneEntryTrigger = findLoginPhoneEntryTrigger();
  const moreOptionsTrigger = findLoginMoreOptionsTrigger();
  const submitButton = getLoginSubmitButton({ allowDisabled: true });
  const verificationVisible = isVerificationPageStillVisible();
  const addPhonePage = isAddPhonePageReady();
  const addEmailPage = isAddEmailPageReady();
  const phoneVerificationPage = isPhoneVerificationPageReady();
  const consentReady = isStep8Ready();
  const oauthConsentPage = isOAuthConsentPage();
  const chooseAccountPage = isChooseAccountPage();
  const baseState = {
    state: 'unknown',
    url: location.href,
    path: location.pathname || '',
    displayedEmail: getLoginVerificationDisplayedEmail(),
    retryButton: retryState?.retryButton || null,
    retryEnabled: Boolean(retryState?.retryEnabled),
    titleMatched: Boolean(retryState?.titleMatched),
    detailMatched: Boolean(retryState?.detailMatched),
    maxCheckAttemptsBlocked: Boolean(retryState?.maxCheckAttemptsBlocked),
    emailInUseBlocked: Boolean(retryState?.emailInUseBlocked),
    verificationTarget,
    passwordInput,
    emailInput,
    phoneInput,
    submitButton,
    switchTrigger,
    loginEntryTrigger,
    phoneEntryTrigger,
    moreOptionsTrigger,
    verificationVisible,
    addPhonePage,
    addEmailPage,
    phoneVerificationPage,
    oauthConsentPage,
    consentReady,
    chooseAccountPage,
  };

  if (retryState) {
    return {
      ...baseState,
      state: 'login_timeout_error_page',
    };
  }

  if (phoneVerificationPage) {
    return {
      ...baseState,
      state: 'phone_verification_page',
      displayedPhone: getPhoneVerificationDisplayedPhone(),
    };
  }

  if (verificationTarget) {
    return {
      ...baseState,
      state: 'verification_page',
    };
  }

  if (addPhonePage) {
    return {
      ...baseState,
      state: 'add_phone_page',
    };
  }

  if (addEmailPage) {
    return {
      ...baseState,
      state: 'add_email_page',
    };
  }

  if (passwordInput || switchTrigger) {
    return {
      ...baseState,
      state: 'password_page',
    };
  }

  if (phoneInput) {
    return {
      ...baseState,
      state: 'phone_entry_page',
    };
  }

  if (emailInput) {
    return {
      ...baseState,
      state: 'email_page',
    };
  }

  if (chooseAccountPage) {
    return {
      ...baseState,
      state: 'choose_account_page',
    };
  }

  if (verificationVisible) {
    return {
      ...baseState,
      state: 'verification_page',
    };
  }

  if (consentReady) {
    return {
      ...baseState,
      state: 'oauth_consent_page',
    };
  }

  if (loginEntryTrigger) {
    return {
      ...baseState,
      state: 'entry_page',
    };
  }

  return baseState;
}

function serializeLoginAuthState(snapshot) {
  return {
    state: snapshot?.state || 'unknown',
    url: snapshot?.url || location.href,
    path: snapshot?.path || location.pathname || '',
    displayedEmail: snapshot?.displayedEmail || '',
    verificationErrorText: getVerificationErrorText(),
    retryEnabled: Boolean(snapshot?.retryEnabled),
    titleMatched: Boolean(snapshot?.titleMatched),
    detailMatched: Boolean(snapshot?.detailMatched),
    maxCheckAttemptsBlocked: Boolean(snapshot?.maxCheckAttemptsBlocked),
    emailInUseBlocked: Boolean(snapshot?.emailInUseBlocked),
    hasVerificationTarget: Boolean(snapshot?.verificationTarget),
    hasPasswordInput: Boolean(snapshot?.passwordInput),
    hasEmailInput: Boolean(snapshot?.emailInput),
    hasPhoneInput: Boolean(snapshot?.phoneInput),
    hasSubmitButton: Boolean(snapshot?.submitButton),
    hasSwitchTrigger: Boolean(snapshot?.switchTrigger),
    hasLoginEntryTrigger: Boolean(snapshot?.loginEntryTrigger),
    hasPhoneEntryTrigger: Boolean(snapshot?.phoneEntryTrigger),
    hasMoreOptionsTrigger: Boolean(snapshot?.moreOptionsTrigger),
    verificationVisible: Boolean(snapshot?.verificationVisible),
    addPhonePage: Boolean(snapshot?.addPhonePage),
    addEmailPage: Boolean(snapshot?.addEmailPage),
    phoneVerificationPage: Boolean(snapshot?.phoneVerificationPage),
    oauthConsentPage: Boolean(snapshot?.oauthConsentPage),
    consentReady: Boolean(snapshot?.consentReady),
    chooseAccountPage: Boolean(snapshot?.chooseAccountPage),
  };
}

function getLoginAuthStateLabel(snapshot) {
  const state = snapshot?.state;
  switch (state) {
    case 'verification_page':
      return '登录验证码页';
    case 'password_page':
      return '密码页';
    case 'email_page':
      return '邮箱输入页';
    case 'phone_entry_page':
      return '手机号输入页';
    case 'phone_verification_page':
      return '手机验证码页';
    case 'login_timeout_error_page':
      return '登录超时报错页';
    case 'oauth_consent_page':
      return 'OAuth 授权页';
    case 'choose_account_page':
      return 'OpenAI choose account page';
    case 'entry_page':
      return '登录入口页';
    case 'add_phone_page':
      return '手机号页';
    case 'add_email_page':
      return '添加邮箱页';
    default:
      return '未知页面';
  }
}

async function waitForKnownLoginAuthState(timeout = 15000) {
  const start = Date.now();
  let snapshot = normalizeStep6Snapshot(inspectLoginAuthState());

  while (Date.now() - start < timeout) {
    throwIfStopped();
    snapshot = normalizeStep6Snapshot(inspectLoginAuthState());
    if (snapshot.state !== 'unknown') {
      return snapshot;
    }
    await sleep(200);
  }

  return snapshot;
}

function getAuthLoginStepForLoginCodeStep(step = 8) {
  return Number(step) >= 11 ? 10 : 7;
}

async function waitForLoginVerificationPageReady(timeout = 10000, visibleStep = 8, options = {}) {
  const start = Date.now();
  let snapshot = inspectLoginAuthState();
  const allowPhoneVerificationPage = Boolean(options?.allowPhoneVerificationPage);

  while (Date.now() - start < timeout) {
    throwIfStopped();
    snapshot = inspectLoginAuthState();
    if (snapshot.state === 'verification_page' || (allowPhoneVerificationPage && snapshot.state === 'phone_verification_page')) {
      return snapshot;
    }
    if (snapshot.state !== 'unknown') {
      break;
    }
    await sleep(200);
  }

  throw new Error(
    `当前未进入登录验证码页面，请先重新完成步骤 ${Number(visibleStep) >= 11 ? 10 : 7}。当前状态：${getLoginAuthStateLabel(snapshot)}。URL: ${snapshot?.url || location.href}`
  );
}

function createStep6SuccessResult(snapshot, options = {}) {
  const result = {
    step6Outcome: 'success',
    state: snapshot?.state || 'verification_page',
    url: snapshot?.url || location.href,
    via: options.via || '',
    loginVerificationRequestedAt: options.loginVerificationRequestedAt || null,
  };

  if (options.skipLoginVerificationStep) {
    result.skipLoginVerificationStep = true;
  }
  if (options.directOAuthConsentPage) {
    result.directOAuthConsentPage = true;
  }

  return result;
}

function createStep6OAuthConsentSuccessResult(snapshot, options = {}) {
  return createStep6SuccessResult(snapshot, {
    ...options,
    via: options.via || 'oauth_consent_page',
    loginVerificationRequestedAt: null,
    skipLoginVerificationStep: true,
    directOAuthConsentPage: true,
  });
}

function createStep6AddEmailSuccessResult(snapshot, options = {}) {
  return {
    ...createStep6SuccessResult(snapshot, {
      ...options,
      via: options.via || 'add_email_page',
      loginVerificationRequestedAt: null,
    }),
    addEmailPage: true,
  };
}

function createStep6AddPhoneSuccessResult(snapshot, options = {}) {
  return {
    ...createStep6SuccessResult(snapshot, {
      ...options,
      via: options.via || 'add_phone_page',
      loginVerificationRequestedAt: null,
      skipLoginVerificationStep: true,
    }),
    addPhonePage: true,
  };
}

function createStep6RecoverableResult(reason, snapshot, options = {}) {
  return {
    step6Outcome: 'recoverable',
    reason,
    state: snapshot?.state || 'unknown',
    url: snapshot?.url || location.href,
    message: options.message || '',
    loginVerificationRequestedAt: options.loginVerificationRequestedAt || null,
  };
}

async function createStep6LoginTimeoutRecoveryTransition(reason, snapshot, message, options = {}) {
  const {
    loginVerificationRequestedAt = null,
    visibleStep = 7,
    via = 'login_timeout_recovered',
    allowPhoneVerificationPage = false,
  } = options;
  let resolvedSnapshot = normalizeStep6Snapshot(snapshot || inspectLoginAuthState());
  let recovered = false;
  if (resolvedSnapshot?.state === 'login_timeout_error_page') {
    try {
      const recoveryResult = await recoverCurrentAuthRetryPage({
        flow: 'login',
        logLabel: `步骤 ${visibleStep}：检测到登录超时报错，正在点击“重试”恢复当前页面`,
        step: visibleStep,
        timeoutMs: 12000,
      });
      recovered = Boolean(recoveryResult?.recovered);
      if (recovered) {
        log('登录超时报错页已点击“重试”，正在按恢复后的页面状态继续当前流程。', 'warn', { step: visibleStep, stepKey: 'oauth-login' });
      }
    } catch (error) {
      if (/CF_SECURITY_BLOCKED::/i.test(String(error?.message || error || ''))) {
        throw error;
      }
      log(`登录超时报错页自动点击“重试”失败：${error.message}`, 'warn', { step: visibleStep, stepKey: 'oauth-login' });
    }
  }

  resolvedSnapshot = recovered
    ? normalizeStep6Snapshot(await waitForKnownLoginAuthState(4000))
    : normalizeStep6Snapshot(inspectLoginAuthState());

  if (resolvedSnapshot.state === 'verification_page' || (allowPhoneVerificationPage && resolvedSnapshot.state === 'phone_verification_page')) {
    return {
      action: 'done',
      result: createStep6SuccessResult(resolvedSnapshot, {
        via,
        loginVerificationRequestedAt,
      }),
    };
  }

  if (resolvedSnapshot.state === 'oauth_consent_page') {
    return {
      action: 'done',
      result: createStep6OAuthConsentSuccessResult(resolvedSnapshot, {
        via,
      }),
    };
  }

  if (resolvedSnapshot.state === 'add_email_page') {
    return {
      action: 'done',
      result: createStep6AddEmailSuccessResult(resolvedSnapshot, {
        via: `${via}_add_email`,
      }),
    };
  }

  if (resolvedSnapshot.state === 'password_page') {
    log('登录超时报错页恢复后已进入密码页，继续当前登录流程。', 'warn', { step: visibleStep, stepKey: 'oauth-login' });
    return { action: 'password', snapshot: resolvedSnapshot };
  }

  if (resolvedSnapshot.state === 'phone_entry_page') {
    log('登录超时报错页恢复后已进入手机号输入页，继续当前登录流程。', 'warn', { step: visibleStep, stepKey: 'oauth-login' });
    return { action: 'phone', snapshot: resolvedSnapshot };
  }

  if (resolvedSnapshot.state === 'email_page') {
    log('登录超时报错页恢复后已回到邮箱输入页，继续当前登录流程。', 'warn', { step: visibleStep, stepKey: 'oauth-login' });
    return { action: 'email', snapshot: resolvedSnapshot };
  }

  return {
    action: 'recoverable',
    result: createStep6RecoverableResult(reason, resolvedSnapshot, {
      message,
      loginVerificationRequestedAt,
    }),
  };
}

async function createStep6LoginTimeoutRecoverableResult(reason, snapshot, message, options = {}) {
  const transition = await createStep6LoginTimeoutRecoveryTransition(reason, snapshot, message, options);
  if (transition?.action === 'done' || transition?.action === 'recoverable') {
    return transition.result;
  }

  return createStep6RecoverableResult(reason, transition?.snapshot || normalizeStep6Snapshot(inspectLoginAuthState()), {
    message,
  });
}

async function finalizeStep6VerificationReady(options = {}) {
  const {
    visibleStep = 7,
    logLabel = `步骤 ${visibleStep} 收尾`,
    loginVerificationRequestedAt = null,
    timeout = 12000,
    via = 'verification_page_ready',
    allowPhoneVerificationPage = false,
  } = options;
  const start = Date.now();
  const maxRounds = 3;
  const settleDelayMs = 3000;
  let round = 0;

  while (Date.now() - start < timeout && round < maxRounds) {
    throwIfStopped();
    round += 1;
    log(`确认页面是否稳定停留在登录验证码阶段（第 ${round}/${maxRounds} 轮，先等待 3 秒）...`, 'info', { step: visibleStep, stepKey: 'oauth-login' });
    await sleep(settleDelayMs);

    const rawSnapshot = inspectLoginAuthState();
    const snapshot = normalizeStep6Snapshot(rawSnapshot);

    if (snapshot.state === 'verification_page' || (allowPhoneVerificationPage && snapshot.state === 'phone_verification_page')) {
      log(
        snapshot.state === 'phone_verification_page' ? '登录手机验证码页面已稳定就绪。' : '登录验证码页面已稳定就绪。',
        'ok',
        { step: visibleStep, stepKey: 'oauth-login' }
      );
      return createStep6SuccessResult(snapshot, {
        via,
        loginVerificationRequestedAt,
      });
    }

    if (snapshot.state === 'oauth_consent_page') {
      log('认证页已直接进入 OAuth 授权页，跳过登录验证码步骤。', 'ok', { step: visibleStep, stepKey: 'oauth-login' });
      return createStep6OAuthConsentSuccessResult(snapshot, {
        via: `${via}_oauth_consent`,
      });
    }

    if (snapshot.state === 'add_email_page') {
      log('认证页已进入添加邮箱页，登录阶段完成。', 'ok', { step: visibleStep, stepKey: 'oauth-login' });
      return createStep6AddEmailSuccessResult(snapshot, {
        via: `${via}_add_email`,
      });
    }

    if (snapshot.state === 'login_timeout_error_page') {
      log(`页面进入登录超时报错页，准备自动恢复后重试步骤 ${visibleStep}。`, 'warn', { step: visibleStep, stepKey: 'oauth-login' });
      return createStep6LoginTimeoutRecoverableResult(
        'login_timeout_error_page',
        snapshot,
        '登录验证码页面准备就绪前进入登录超时报错页。',
        { visibleStep }
      );
    }

    if (snapshot.state === 'password_page' || snapshot.state === 'email_page') {
      return createStep6RecoverableResult('verification_page_unstable', snapshot, {
        message: `页面曾进入登录验证码阶段，但又回到了${getLoginAuthStateLabel(snapshot)}，准备重新执行步骤 ${visibleStep}。`,
        loginVerificationRequestedAt,
      });
    }

    if (snapshot.state === 'add_phone_page') {
      throw new Error(`登录验证码页面准备过程中页面进入手机号页面。URL: ${snapshot.url}`);
    }
  }

  const rawSnapshot = inspectLoginAuthState();
  const snapshot = normalizeStep6Snapshot(rawSnapshot);
  if (snapshot.state === 'verification_page' || (allowPhoneVerificationPage && snapshot.state === 'phone_verification_page')) {
    log(
      snapshot.state === 'phone_verification_page' ? '登录手机验证码页面已稳定就绪。' : '登录验证码页面已稳定就绪。',
      'ok',
      { step: visibleStep, stepKey: 'oauth-login' }
    );
    return createStep6SuccessResult(snapshot, {
      via,
      loginVerificationRequestedAt,
    });
  }
  if (snapshot.state === 'oauth_consent_page') {
    log('认证页已直接进入 OAuth 授权页，跳过登录验证码步骤。', 'ok', { step: visibleStep, stepKey: 'oauth-login' });
    return createStep6OAuthConsentSuccessResult(snapshot, {
      via: `${via}_oauth_consent`,
    });
  }
  if (snapshot.state === 'add_email_page') {
    log('认证页已进入添加邮箱页，登录阶段完成。', 'ok', { step: visibleStep, stepKey: 'oauth-login' });
    return createStep6AddEmailSuccessResult(snapshot, {
      via: `${via}_add_email`,
    });
  }
  if (snapshot.state === 'login_timeout_error_page') {
    log(`页面进入登录超时报错页，准备自动恢复后重试步骤 ${visibleStep}。`, 'warn', { step: visibleStep, stepKey: 'oauth-login' });
    return createStep6LoginTimeoutRecoverableResult(
      'login_timeout_error_page',
      snapshot,
      '登录验证码页面准备就绪前进入登录超时报错页。',
      { visibleStep }
    );
  }
  if (snapshot.state === 'password_page' || snapshot.state === 'email_page') {
    return createStep6RecoverableResult('verification_page_unstable', snapshot, {
      message: `页面曾进入登录验证码阶段，但又回到了${getLoginAuthStateLabel(snapshot)}，准备重新执行步骤 ${visibleStep}。`,
      loginVerificationRequestedAt,
    });
  }

  return createStep6RecoverableResult('verification_page_finalize_unknown', snapshot, {
    message: `登录验证码页面状态在收尾确认阶段未稳定，准备重新执行步骤 ${visibleStep}。`,
    loginVerificationRequestedAt,
  });
}

function normalizeStep6Snapshot(snapshot) {
  return snapshot;
}

function throwForStep6FatalState(snapshot, visibleStep = 7) {
  snapshot = normalizeStep6Snapshot(snapshot);
  switch (snapshot?.state) {
    case 'oauth_consent_page':
      return;
    case 'add_phone_page':
      throw new Error(`当前页面已进入手机号页面，未经过登录验证码页，无法完成步骤 ${visibleStep}。URL: ${snapshot.url}`);
    case 'unknown':
      throw new Error(`无法识别当前登录页面状态。URL: ${snapshot?.url || location.href}`);
    default:
      return;
  }
}

async function triggerLoginSubmitAction(button, fallbackField) {
  const form = button?.form || fallbackField?.form || button?.closest?.('form') || fallbackField?.closest?.('form') || null;
  const performOperationWithDelay = typeof getOperationDelayRunner === 'function'
    ? getOperationDelayRunner()
    : async (metadata, operation) => {
        const rootScope = typeof window !== 'undefined' ? window : globalThis;
        const gate = rootScope?.CodexOperationDelay?.performOperationWithDelay;
        return typeof gate === 'function' ? gate(metadata, operation) : operation();
      };

  await humanPause(400, 1100);
  await performOperationWithDelay({ stepKey: 'oauth-login', kind: 'submit', label: 'login-submit' }, async () => {
    if (button && isActionEnabled(button)) {
      simulateClick(button);
      return;
    }

    if (form && typeof form.requestSubmit === 'function') {
      if (button && button.form === form) {
        form.requestSubmit(button);
      } else {
        form.requestSubmit();
      }
      return;
    }

    if (button && typeof button.click === 'function') {
      button.click();
      return;
    }

    throw new Error('未找到可用的登录提交按钮。URL: ' + location.href);
  });
}

function isSignupPasswordErrorPage() {
  return Boolean(getSignupPasswordTimeoutErrorPageState());
}

function isSignupEmailAlreadyExistsPage() {
  return isSignupPasswordPage() && SIGNUP_EMAIL_EXISTS_PATTERN.test(getPageTextSnapshot());
}

function inspectSignupVerificationState() {
  const postVerificationState = getStep4PostVerificationState();
  if (postVerificationState?.state === 'step5') {
    return { state: 'step5' };
  }

  if (postVerificationState?.state === 'logged_in_home') {
    return {
      state: 'logged_in_home',
      skipProfileStep: true,
      url: postVerificationState.url || location.href,
    };
  }

  if (typeof isOAuthConsentPage === 'function' && isOAuthConsentPage()) {
    return {
      state: 'oauth_consent_page',
      url: location.href,
    };
  }

  if (isSignupPasswordErrorPage()) {
    const timeoutPage = getSignupPasswordTimeoutErrorPageState();
    return {
      state: 'error',
      retryButton: timeoutPage?.retryButton || null,
      userAlreadyExistsBlocked: Boolean(timeoutPage?.userAlreadyExistsBlocked),
    };
  }

  const contactVerificationServerErrorText = typeof getContactVerificationServerErrorText === 'function'
    ? getContactVerificationServerErrorText()
    : '';
  if (contactVerificationServerErrorText) {
    return {
      state: 'contact_verification_server_error',
      serverErrorText: contactVerificationServerErrorText,
    };
  }

  if (typeof isPhoneVerificationPageReady === 'function' && isPhoneVerificationPageReady()) {
    return {
      state: 'verification',
      phoneVerificationPage: true,
    };
  }

  if (isVerificationPageStillVisible()) {
    return { state: 'verification' };
  }

  if (isSignupEmailAlreadyExistsPage()) {
    return { state: 'email_exists' };
  }

  const passwordInput = getSignupPasswordInput();
  if (passwordInput) {
    return {
      state: 'password',
      passwordInput,
      submitButton: getSignupPasswordSubmitButton({ allowDisabled: true }),
      passwordErrorText: getSignupPasswordFieldErrorText(),
    };
  }

  return { state: 'unknown' };
}

async function waitForSignupVerificationTransition(timeout = 5000) {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    throwIfStopped();

    const snapshot = inspectSignupVerificationState();
    if (snapshot.state === 'verification' && !isSignupVerificationPageInteractiveReady(snapshot)) {
      await sleep(200);
      continue;
    }
    if (
      snapshot.state === 'step5'
      || snapshot.state === 'logged_in_home'
      || snapshot.state === 'oauth_consent_page'
      || snapshot.state === 'verification'
      || snapshot.state === 'contact_verification_server_error'
      || snapshot.state === 'error'
      || snapshot.state === 'email_exists'
    ) {
      return snapshot;
    }

    await sleep(200);
  }

  return inspectSignupVerificationState();
}

async function prepareSignupVerificationFlow(payload = {}, timeout = 30000) {
  const performOperationWithDelay = typeof getOperationDelayRunner === 'function'
    ? getOperationDelayRunner()
    : async (metadata, operation) => {
        const rootScope = typeof window !== 'undefined' ? window : globalThis;
        const gate = rootScope?.CodexOperationDelay?.performOperationWithDelay;
        return typeof gate === 'function' ? gate(metadata, operation) : operation();
      };
  const { password } = payload;
  const prepareSource = String(payload?.prepareSource || '').trim() || 'step4_execute';
  const prepareLogLabel = String(payload?.prepareLogLabel || '').trim()
    || (prepareSource === 'step3_finalize' ? '步骤 3 收尾' : '步骤 4 执行');
  const start = Date.now();
  let recoveryRound = 0;
  const maxRecoveryRounds = 3;
  let passwordPageDiagnosticsLogged = false;
  const isPasswordSubmitButtonReadyForRetry = (button) => {
    if (!button || !isActionEnabled(button)) {
      return false;
    }

    const ariaBusy = String(button.getAttribute?.('aria-busy') || '').trim().toLowerCase();
    if (ariaBusy === 'true') {
      return false;
    }

    const pendingAttr = [
      button.getAttribute?.('data-loading'),
      button.getAttribute?.('data-pending'),
      button.getAttribute?.('data-submitting'),
      button.getAttribute?.('data-state'),
    ]
      .map((value) => String(value || '').trim().toLowerCase())
      .filter(Boolean)
      .join(' ');
    if (/\b(?:true|loading|pending|submitting|busy)\b/.test(pendingAttr)) {
      return false;
    }

    let style = null;
    try {
      style = typeof window !== 'undefined' && window.getComputedStyle
        ? window.getComputedStyle(button)
        : null;
    } catch {
      style = null;
    }

    if (style?.pointerEvents === 'none') {
      return false;
    }

    const opacity = Number.parseFloat(style?.opacity || '');
    if (Number.isFinite(opacity) && opacity < 0.8) {
      return false;
    }

    return true;
  };

  while (Date.now() - start < timeout && recoveryRound < maxRecoveryRounds) {
    throwIfStopped();

    const roundNo = recoveryRound + 1;
    log(`${prepareLogLabel}：等待页面进入验证码阶段（第 ${roundNo}/${maxRecoveryRounds} 轮，先等待 5 秒）...`, 'info');
    const snapshot = await waitForSignupVerificationTransition(5000);

    if (snapshot.state === 'step5') {
      log(`${prepareLogLabel}：页面已进入验证码后的下一阶段，本步骤按已完成处理。`, 'ok');
      return { ready: true, alreadyVerified: true, retried: recoveryRound, prepareSource };
    }

    if (snapshot.state === 'logged_in_home') {
      log(`${prepareLogLabel}：页面已直接进入 ChatGPT 已登录态，本步骤按已完成处理，并将跳过步骤 5。`, 'ok');
      return {
        ready: true,
        alreadyVerified: true,
        skipProfileStep: true,
        retried: recoveryRound,
        prepareSource,
      };
    }

    if (snapshot.state === 'oauth_consent_page') {
      log(`${prepareLogLabel}：页面已直接进入 OAuth 授权页，本步骤按已完成处理。`, 'ok');
      return {
        ready: true,
        alreadyVerified: true,
        state: 'oauth_consent_page',
        skipLoginVerificationStep: true,
        directOAuthConsentPage: true,
        skipProfileStep: true,
        retried: recoveryRound,
        prepareSource,
      };
    }

    if (snapshot.state === 'verification') {
      await waitForDocumentLoadComplete(15000, `${prepareLogLabel}：注册验证码页面`);
      await waitForVerificationCodeTarget(15000);
      log(`${prepareLogLabel}：验证码页面已完成加载并就绪${recoveryRound ? `（期间自动恢复 ${recoveryRound} 次）` : ''}。`, 'ok');
      return { ready: true, retried: recoveryRound, prepareSource };
    }

    if (snapshot.state === 'email_exists') {
      throw new Error('当前邮箱已存在，需要重新开始新一轮。');
    }

    if (snapshot.state === 'contact_verification_server_error') {
      const serverErrorText = String(snapshot.serverErrorText || '').trim()
        || 'OpenAI contact-verification 页面返回 HTTP ERROR 500。';
      log(`${prepareLogLabel}：检测到 contact-verification 500 错误页，当前轮直接报错。`, 'warn');
      throw buildContactVerificationServerError(serverErrorText);
    }

    if (snapshot.state === 'error') {
      if (snapshot.userAlreadyExistsBlocked) {
        throw createSignupUserAlreadyExistsError();
      }
      recoveryRound += 1;
      await recoverCurrentAuthRetryPage({
        flow: 'signup',
        logLabel: `${prepareLogLabel}：检测到注册认证重试页，正在点击“重试”恢复（第 ${recoveryRound}/${maxRecoveryRounds} 次）`,
        step: 4,
        timeoutMs: 12000,
      });
      continue;
    }

    if (snapshot.state === 'password') {
      if (snapshot.passwordErrorText) {
        log(`${prepareLogLabel}：检测到密码页报错“${snapshot.passwordErrorText}”，当前轮将回到步骤 1 重新开始。`, 'warn');
        if (
          typeof SIGNUP_CREATE_ACCOUNT_FAILED_PATTERN !== 'undefined'
          && SIGNUP_CREATE_ACCOUNT_FAILED_PATTERN.test(snapshot.passwordErrorText)
        ) {
          throw createSignupCreateAccountFailedError(snapshot.passwordErrorText);
        }
        throw createSignupPhonePasswordMismatchError(snapshot.passwordErrorText);
      }
      if (!passwordPageDiagnosticsLogged) {
        passwordPageDiagnosticsLogged = true;
        logSignupPasswordDiagnostics(`${prepareLogLabel}：页面仍停留在密码页`);
      }
      if (!password) {
        throw new Error('当前回到了密码页，但没有可用密码，无法自动重新提交。');
      }

      if ((snapshot.passwordInput.value || '') !== password) {
        log(`${prepareLogLabel}：页面仍停留在密码页，正在重新填写密码...`, 'warn');
        await humanPause(450, 1100);
        await performOperationWithDelay({ stepKey: 'fill-password', kind: 'fill', label: 'retry-signup-password' }, async () => {
          fillInput(snapshot.passwordInput, password);
        });
      }

      if (snapshot.submitButton && isPasswordSubmitButtonReadyForRetry(snapshot.submitButton)) {
        recoveryRound += 1;
        log(`${prepareLogLabel}：页面仍停留在密码页，正在重新点击“继续”（第 ${recoveryRound}/${maxRecoveryRounds} 次）...`, 'warn');
        await humanPause(350, 900);
        await performOperationWithDelay({ stepKey: 'fill-password', kind: 'submit', label: 'retry-submit-signup-password' }, async () => {
          simulateClick(snapshot.submitButton);
        });
        await sleep(1200);
        continue;
      }

      log(`${prepareLogLabel}：页面仍停留在密码页，但“继续”按钮暂不可用，准备继续等待（${recoveryRound}/${maxRecoveryRounds}）...`, 'warn');
      continue;
    }

    log(`${prepareLogLabel}：页面仍在切换中，准备继续等待（${recoveryRound}/${maxRecoveryRounds}）...`, 'warn');
  }

  throw new Error(`等待注册验证码页面就绪超时或自动恢复失败（已尝试 ${recoveryRound}/${maxRecoveryRounds} 轮）。URL: ${location.href}`);
}


async function waitForVerificationSubmitOutcome(step, timeout, options = {}) {
  const resolvedTimeout = timeout ?? (step === 8 ? 30000 : 12000);
  const purpose = options?.purpose || '';
  const start = Date.now();
  let recoveryCount = 0;
  const maxRecoveryCount = 2;

  while (Date.now() - start < resolvedTimeout) {
    throwIfStopped();

    const retryFlow = step === 4 ? 'signup' : 'login';
    const retryState = getCurrentAuthRetryPageState(retryFlow);
    if (retryState?.userAlreadyExistsBlocked) {
      throw createSignupUserAlreadyExistsError();
    }
    if (step === 8 && retryState?.emailInUseBlocked) {
      throw createStep8EmailInUseError();
    }
    if (step === 8 && retryState?.maxCheckAttemptsBlocked) {
      throw createAuthMaxCheckAttemptsError();
    }
    if (retryState) {
      if (recoveryCount >= maxRecoveryCount) {
        throw new Error(`步骤 ${step}：验证码提交后连续进入认证重试页 ${maxRecoveryCount} 次，页面仍未恢复。URL: ${location.href}`);
      }
      recoveryCount += 1;
      log(`步骤 ${step}：验证码提交后进入认证重试页，正在自动恢复（${recoveryCount}/${maxRecoveryCount}）...`, 'warn');
      await recoverCurrentAuthRetryPage({
        flow: retryFlow,
        logLabel: `步骤 ${step}：验证码提交后检测到认证重试页，正在点击“重试”恢复`,
        step,
        timeoutMs: 12000,
      });
      continue;
    }

    if (step === 4) {
      const postVerificationState = getStep4PostVerificationState({ ignoreVerificationVisibility: true });
      if (postVerificationState?.state === 'logged_in_home') {
        return {
          success: true,
          skipProfileStep: true,
          url: postVerificationState.url || location.href,
        };
      }
      if (postVerificationState?.state === 'step5') {
        return { success: true };
      }
      if (purpose === 'signup' && isEmailVerificationPage()) {
        return {
          success: true,
          emailVerificationRequired: true,
          emailVerificationPage: true,
          url: location.href,
        };
      }
    }

    const errorText = getVerificationErrorText();
    if (errorText) {
      return { invalidCode: true, errorText };
    }

    if (step === 8 && isStep8Ready()) {
      return { success: true };
    }

    if (step === 8 && isAddPhonePageReady()) {
      return { success: true, addPhonePage: true, url: location.href };
    }

    await sleep(150);
  }

  if (step === 4) {
    const signupRetryState = getCurrentAuthRetryPageState('signup');
    if (signupRetryState?.userAlreadyExistsBlocked) {
      throw createSignupUserAlreadyExistsError();
    }

    const postVerificationState = getStep4PostVerificationState({ ignoreVerificationVisibility: true });
    if (postVerificationState?.state === 'logged_in_home') {
      return {
        success: true,
        skipProfileStep: true,
        url: postVerificationState.url || location.href,
      };
    }
    if (postVerificationState?.state === 'step5') {
      return { success: true };
    }
    if (purpose === 'signup' && isEmailVerificationPage()) {
      return {
        success: true,
        emailVerificationRequired: true,
        emailVerificationPage: true,
        url: location.href,
      };
    }
  }

  if (isVerificationPageStillVisible()) {
    return {
      invalidCode: true,
      errorText: getVerificationErrorText() || '提交后仍停留在验证码页面，准备重新发送验证码。',
    };
  }

  return { success: true, assumed: true };
}

function getVerificationSubmitButtonForTarget(codeInput, options = {}) {
  const { allowDisabled = false } = options;
  const form = codeInput?.form || codeInput?.closest?.('form') || null;
  const isUsableAction = (element) => {
    if (!element || !isVisibleElement(element)) return false;
    return allowDisabled || isActionEnabled(element);
  };

  const findSubmitInRoot = (root) => {
    if (!root?.querySelectorAll) return null;

    const directCandidates = root.querySelectorAll('button[type="submit"], input[type="submit"]');
    for (const element of directCandidates) {
      if (isUsableAction(element)) {
        return element;
      }
    }

    const textCandidates = root.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]');
    return Array.from(textCandidates).find((element) => {
      if (!isUsableAction(element)) return false;
      const text = getActionText(element);
    return /verify|confirm|submit|continue|确认|验证|继续|確認|認証|検証|続行|続ける|次へ|送信/i.test(text);
    }) || null;
  };

  return findSubmitInRoot(form) || findSubmitInRoot(document);
}

async function waitForVerificationSubmitButton(codeInput, timeout = 5000) {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    throwIfStopped();
    if (is405MethodNotAllowedPage()) {
      throw new Error('当前页面处于 405 错误恢复流程中，暂时无法定位验证码提交按钮。');
    }

    const button = getVerificationSubmitButtonForTarget(codeInput, { allowDisabled: false });
    if (button) {
      return button;
    }

    await sleep(150);
  }

  return null;
}

async function waitForVerificationCodeTarget(timeout = 10000) {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    throwIfStopped();
    if (is405MethodNotAllowedPage()) {
      throw new Error('当前页面处于 405 错误恢复流程中，暂时无法定位验证码输入框。');
    }

    const target = getVerificationCodeTarget();
    if (target) {
      return target;
    }

    await sleep(150);
  }

  throw new Error('未找到验证码输入框。URL: ' + location.href);
}

async function waitForSplitVerificationInputsFilled(inputs, code, timeout = 2500) {
  const expected = String(code || '').slice(0, 6);
  const start = Date.now();

  while (Date.now() - start < timeout) {
    throwIfStopped();
    const current = Array.from(inputs || [])
      .slice(0, expected.length)
      .map((input) => String(input?.value || '').trim())
      .join('');

    if (current === expected) {
      return true;
    }

    await sleep(100);
  }

  return false;
}

async function fillVerificationCode(step, payload) {
  const { code, signupProfile } = payload;
  if (!code) throw new Error('未提供验证码。');
  const performOperationWithDelay = typeof getOperationDelayRunner === 'function'
    ? getOperationDelayRunner()
    : async (metadata, operation) => {
        const rootScope = typeof window !== 'undefined' ? window : globalThis;
        const gate = rootScope?.CodexOperationDelay?.performOperationWithDelay;
        return typeof gate === 'function' ? gate(metadata, operation) : operation();
      };

  if (step === 4) {
    const postVerificationState = getStep4PostVerificationState();
    if (postVerificationState?.state === 'logged_in_home') {
      if (typeof clearStep405RecoveryCount === 'function') clearStep405RecoveryCount(step);
      log(`步骤 ${step}：检测到页面已进入 ChatGPT 已登录态，本次验证码提交按成功处理。`, 'ok');
      return {
        success: true,
        assumed: true,
        alreadyAdvanced: true,
        skipProfileStep: true,
        url: postVerificationState.url || location.href,
      };
    }
    if (postVerificationState?.state === 'step5') {
      if (typeof clearStep405RecoveryCount === 'function') clearStep405RecoveryCount(step);
      log(`步骤 ${step}：检测到页面已进入下一阶段，本次验证码提交按成功处理。`, 'ok');
      return { success: true, assumed: true, alreadyAdvanced: true };
    }
  }
  if (step === 8) {
    if (isStep8Ready()) {
      log(`步骤 ${step}：检测到页面已进入 OAuth 同意页，本次验证码提交按成功处理。`, 'ok');
      return { success: true, assumed: true, alreadyAdvanced: true };
    }
    if (isAddPhonePageReady()) {
      return { success: true, addPhonePage: true, url: location.href };
    }
  }

  log(`步骤 ${step}：正在填写验证码：${code}`);

  if (step === 8) {
    await waitForLoginVerificationPageReady(10000, step, {
      allowPhoneVerificationPage: payload?.purpose === 'login' || payload?.loginIdentifierType === 'phone',
    });
  }
  if (step === 4) {
    await waitForDocumentLoadComplete(15000, `步骤 ${step}：注册验证码页面`);
  }

  const combinedSignupProfilePage = step === 4
    && await waitForCombinedSignupVerificationProfilePage();
  if (combinedSignupProfilePage) {
    if (!signupProfile || !signupProfile.firstName || !signupProfile.lastName) {
      throw new Error('当前注册验证码页面要求同时填写资料，但未提供姓名或生日数据。');
    }
    await step5_fillNameBirthday({
      ...signupProfile,
      prefillOnly: true,
    });
  }

  // Find code input — could be a single input or multiple separate inputs
  // Retry with 405 error recovery if needed
  const maxRetries = 3;
  let codeInput = null;
  let splitInputs = null;

  for (let retry = 0; retry <= maxRetries; retry++) {
    throwIfStopped();

    // Before looking for input, check if page is in 405 error state
    if (is405MethodNotAllowedPage()) {
      log(`步骤 ${step}：检测到 405 错误页面，正在恢复...`, 'warn');
      await handle405ResendError(step, 30000);
      continue;
    }

    try {
      const verificationTarget = await waitForVerificationCodeTarget(10000);
      if (verificationTarget.type === 'split') {
        splitInputs = verificationTarget.elements;
      } else {
        codeInput = verificationTarget.element;
      }
      break; // Found it
    } catch {
      // No input found — check if it's a 405 error and can be recovered
      if (is405MethodNotAllowedPage() && retry < maxRetries) {
        log(`步骤 ${step}：未找到验证码输入框且页面出现 405 错误，正在恢复...`, 'warn');
        await handle405ResendError(step, 30000);
        continue;
      }

      throw new Error('未找到验证码输入框。URL: ' + location.href);
    }
  }

  if (splitInputs?.length >= 6) {
    log(`步骤 ${step}：发现分开的单字符验证码输入框，正在逐个填写...`);
    await performOperationWithDelay({ stepKey: 'fetch-signup-code', kind: 'grouped-code', label: 'split-code' }, async () => {
      for (let i = 0; i < 6 && i < splitInputs.length; i++) {
        const targetInput = splitInputs[i];
        try {
          targetInput.focus?.();
        } catch {}
        fillInput(splitInputs[i], code[i]);
        try {
          targetInput.dispatchEvent(new KeyboardEvent('keyup', { key: code[i], bubbles: true }));
        } catch {}
      }
    });
    const filled = await waitForSplitVerificationInputsFilled(splitInputs, code, 2500);
    if (!filled) {
      const current = Array.from(splitInputs)
        .slice(0, 6)
        .map((input) => String(input?.value || '').trim() || '_')
        .join('');
      log(`步骤 ${step}：分格验证码输入框未稳定呈现目标值，当前页面值为 ${current}，准备继续观察提交流程。`, 'warn');
    } else {
      log(`步骤 ${step}：分格验证码输入框已稳定显示 ${code}。`, 'info');
    }

    await sleep(800);
    const splitSubmitBtn = await waitForVerificationSubmitButton(splitInputs[0], 2000).catch(() => null);
    if (splitSubmitBtn) {
      await humanPause(450, 1200);
      await performOperationWithDelay({ stepKey: 'fetch-signup-code', kind: 'submit', label: 'submit-code' }, async () => {
        simulateClick(splitSubmitBtn);
      });
      log(`步骤 ${step}：分格验证码已提交`);
    } else {
      log(`步骤 ${step}：分格验证码页面未找到可点击提交按钮，继续等待页面自动推进。`, 'info');
    }

    const outcome = await waitForVerificationSubmitOutcome(step, undefined, payload);
    if (outcome.invalidCode) {
      log(`步骤 ${step}：验证码被拒绝：${outcome.errorText}`, 'warn');
    } else if (outcome.emailVerificationRequired) {
      log(`步骤 ${step}：手机验证码已通过，页面进入邮箱验证码验证。`, 'ok');
    } else if (outcome.addPhonePage) {
      log(`步骤 ${step}：验证码提交后页面进入手机号页面，当前流程将停止自动授权。`, 'warn');
    } else {
      if (typeof clearStep405RecoveryCount === 'function') clearStep405RecoveryCount(step);
      log(`步骤 ${step}：验证码已通过${outcome.assumed ? '（按成功推定）' : ''}。`, 'ok');
    }
    if (combinedSignupProfilePage && !outcome.invalidCode) {
      outcome.skipProfileStep = true;
      outcome.skipProfileStepReason = 'combined_verification_profile';
    }
    return outcome;
  }

  if (!codeInput) {
    throw new Error('未找到验证码输入框。URL: ' + location.href);
  }

  await performOperationWithDelay({ stepKey: step === 8 ? 'oauth-login' : 'fetch-signup-code', kind: 'fill', label: 'verification-code' }, async () => {
    fillInput(codeInput, code);
  });
  log(`步骤 ${step}：验证码已填写`);

  // Submit
  await sleep(800);
  const submitBtn = await waitForVerificationSubmitButton(codeInput, 5000).catch(() => null);

  if (submitBtn) {
    await humanPause(450, 1200);
    await performOperationWithDelay({ stepKey: step === 8 ? 'oauth-login' : 'fetch-signup-code', kind: 'submit', label: 'submit-code' }, async () => {
      simulateClick(submitBtn);
    });
    log(`步骤 ${step}：验证码已提交`);
  } else {
    log(`步骤 ${step}：未找到可提交的验证码按钮，先等待页面自动推进或反馈结果。`, 'warn');
  }

  const outcome = await waitForVerificationSubmitOutcome(step, undefined, payload);
  if (outcome.invalidCode) {
    log(`步骤 ${step}：验证码被拒绝：${outcome.errorText}`, 'warn');
  } else if (outcome.emailVerificationRequired) {
    log(`步骤 ${step}：手机验证码已通过，页面进入邮箱验证码验证。`, 'ok');
  } else if (outcome.addPhonePage) {
    log(`步骤 ${step}：验证码提交后页面进入手机号页面，当前流程将停止自动授权。`, 'warn');
  } else {
    if (typeof clearStep405RecoveryCount === 'function') clearStep405RecoveryCount(step);
    log(`步骤 ${step}：验证码已通过${outcome.assumed ? '（按成功推定）' : ''}。`, 'ok');
  }

  if (combinedSignupProfilePage && !outcome.invalidCode) {
    outcome.skipProfileStep = true;
    outcome.skipProfileStepReason = 'combined_verification_profile';
  }

  return outcome;
}

// ============================================================
// Step 7: Login with registered account (on OAuth auth page)
// ============================================================

function getStep6OptionMessage(value, snapshot) {
  return typeof value === 'function' ? value(snapshot) : String(value || '');
}

async function resolveStep6PostSubmitSnapshot(snapshot, options = {}) {
  const normalizedSnapshot = normalizeStep6Snapshot(snapshot || inspectLoginAuthState());
  const {
    via = 'post_submit',
    loginVerificationRequestedAt = null,
    oauthConsentVia = `${via}_oauth_consent`,
    timeoutRecoveryReason = 'login_timeout_error_page',
    timeoutRecoveryMessage = '登录提交后进入登录超时报错页。',
    timeoutRecoveryVia = `${via}_timeout_recovered`,
    allowPhoneVerificationPage = false,
    allowPhoneAction = false,
    allowPasswordAction = false,
    allowEmailAction = false,
    allowFinalPhoneAction = false,
    allowFinalPasswordAction = false,
    allowFinalEmailAction = false,
    allowFinalSwitchAction = false,
    visibleStep = 7,
    final = false,
    addPhoneMessage,
  } = options;

  if (normalizedSnapshot.state === 'verification_page' || (allowPhoneVerificationPage && normalizedSnapshot.state === 'phone_verification_page')) {
    return {
      action: 'done',
      result: createStep6SuccessResult(normalizedSnapshot, {
        via,
        loginVerificationRequestedAt,
      }),
    };
  }

  if (normalizedSnapshot.state === 'oauth_consent_page') {
    return {
      action: 'done',
      result: createStep6OAuthConsentSuccessResult(normalizedSnapshot, {
        via: oauthConsentVia,
      }),
    };
  }

  if (normalizedSnapshot.state === 'add_email_page') {
    return {
      action: 'done',
      result: createStep6AddEmailSuccessResult(normalizedSnapshot, {
        via: `${via}_add_email`,
      }),
    };
  }

  if (normalizedSnapshot.state === 'login_timeout_error_page') {
    const transition = await createStep6LoginTimeoutRecoveryTransition(
      timeoutRecoveryReason,
      normalizedSnapshot,
      timeoutRecoveryMessage,
      {
        visibleStep,
        loginVerificationRequestedAt,
        via: timeoutRecoveryVia,
        allowPhoneVerificationPage,
      }
    );
    if (transition.action === 'done') {
      return {
        action: 'done',
        result: transition.result,
      };
    }
    if (transition.action === 'phone') {
      return { action: 'phone', snapshot: transition.snapshot };
    }
    if (transition.action === 'password') {
      return { action: 'password', snapshot: transition.snapshot };
    }
    if (transition.action === 'email') {
      return { action: 'email', snapshot: transition.snapshot };
    }
    return {
      action: 'recoverable',
      result: transition.result,
    };
  }

  if (normalizedSnapshot.state === 'phone_entry_page' && (allowPhoneAction || (final && allowFinalPhoneAction))) {
    return { action: 'phone', snapshot: normalizedSnapshot };
  }

  if (normalizedSnapshot.state === 'password_page') {
    if (allowPasswordAction || (final && allowFinalPasswordAction)) {
      return { action: 'password', snapshot: normalizedSnapshot };
    }
    if (final && allowFinalSwitchAction && normalizedSnapshot.switchTrigger) {
      return { action: 'switch', snapshot: normalizedSnapshot };
    }
  }

  if (normalizedSnapshot.state === 'email_page' && (allowEmailAction || (final && allowFinalEmailAction))) {
    return { action: 'email', snapshot: normalizedSnapshot };
  }

  if (normalizedSnapshot.state === 'add_phone_page') {
    const message = getStep6OptionMessage(addPhoneMessage, normalizedSnapshot)
      || `登录提交后页面进入手机号页面。URL: ${normalizedSnapshot.url || location.href}`;
    throw new Error(message);
  }

  return null;
}

async function waitForStep6PostSubmitTransition(options = {}) {
  const {
    timeout = 10000,
    stalledReason = 'post_submit_stalled',
    stalledMessage = '登录提交后未进入可识别的下一页。',
  } = options;
  const start = Date.now();
  let snapshot = normalizeStep6Snapshot(inspectLoginAuthState());

  while (Date.now() - start < timeout) {
    throwIfStopped();
    snapshot = normalizeStep6Snapshot(inspectLoginAuthState());
    const transition = await resolveStep6PostSubmitSnapshot(snapshot, {
      ...options,
      final: false,
    });
    if (transition) {
      return transition;
    }
    await sleep(250);
  }

  snapshot = normalizeStep6Snapshot(inspectLoginAuthState());
  const transition = await resolveStep6PostSubmitSnapshot(snapshot, {
    ...options,
    final: true,
  });
  if (transition) {
    return transition;
  }

  return {
    action: 'recoverable',
    result: createStep6RecoverableResult(stalledReason, snapshot, {
      message: stalledMessage,
      loginVerificationRequestedAt: options.loginVerificationRequestedAt || null,
    }),
  };
}

async function waitForStep6EmailSubmitTransition(emailSubmittedAt, timeout = 12000, options = {}) {
  return waitForStep6PostSubmitTransition({
    timeout,
    visibleStep: Math.floor(Number(options?.visibleStep) || 0) || 7,
    via: 'email_submit',
    oauthConsentVia: 'email_submit_oauth_consent',
    loginVerificationRequestedAt: emailSubmittedAt,
    timeoutRecoveryMessage: '提交邮箱后进入登录超时报错页。',
    timeoutRecoveryVia: 'email_submit_timeout_recovered',
    allowPasswordAction: true,
    stalledReason: 'email_submit_stalled',
    stalledMessage: '提交邮箱后长时间未进入密码页或登录验证码页。',
    addPhoneMessage: (snapshot) => `提交邮箱后页面直接进入手机号页面，未经过登录验证码页。URL: ${snapshot.url}`,
  });
}

async function waitForStep6PhoneSubmitTransition(phoneSubmittedAt, timeout = 12000, options = {}) {
  return waitForStep6PostSubmitTransition({
    timeout,
    visibleStep: Math.floor(Number(options?.visibleStep) || 0) || 7,
    via: 'phone_submit',
    oauthConsentVia: 'phone_submit_oauth_consent',
    loginVerificationRequestedAt: phoneSubmittedAt,
    timeoutRecoveryMessage: '提交手机号后进入登录超时报错页。',
    timeoutRecoveryVia: 'phone_submit_timeout_recovered',
    allowPhoneVerificationPage: true,
    allowPasswordAction: true,
    allowFinalPhoneAction: true,
    stalledReason: 'phone_submit_stalled',
    stalledMessage: '提交手机号后长时间未进入密码页或手机验证码页。',
    addPhoneMessage: (snapshot) => `提交手机号后页面直接进入手机号补全页面，未经过登录验证码页。URL: ${snapshot.url}`,
  });
}

async function waitForStep6PasswordSubmitTransition(passwordSubmittedAt, timeout = 10000, options = {}) {
  return waitForStep6PostSubmitTransition({
    timeout,
    visibleStep: Math.floor(Number(options?.visibleStep) || 0) || 7,
    via: 'password_submit',
    oauthConsentVia: 'password_submit_oauth_consent',
    loginVerificationRequestedAt: passwordSubmittedAt,
    timeoutRecoveryMessage: '提交密码后进入登录超时报错页。',
    timeoutRecoveryVia: 'password_submit_timeout_recovered',
    allowFinalSwitchAction: true,
    stalledReason: 'password_submit_stalled',
    stalledMessage: '提交密码后仍未进入登录验证码页。',
    addPhoneMessage: (snapshot) => `提交密码后页面直接进入手机号页面，未经过登录验证码页。URL: ${snapshot.url}`,
  });
}

async function waitForStep6SwitchTransition(loginVerificationRequestedAt, timeout = 10000, options = {}) {
  const transition = await waitForStep6PostSubmitTransition({
    timeout,
    visibleStep: Math.floor(Number(options?.visibleStep) || 0) || 7,
    via: 'switch_to_one_time_code_login',
    oauthConsentVia: 'switch_to_one_time_code_oauth_consent',
    loginVerificationRequestedAt,
    timeoutRecoveryMessage: '切换到一次性验证码登录后进入登录超时报错页。',
    timeoutRecoveryVia: 'switch_to_one_time_code_timeout_recovered',
    stalledReason: 'one_time_code_switch_stalled',
    stalledMessage: '点击一次性验证码登录后仍未进入登录验证码页。',
    addPhoneMessage: (snapshot) => `切换到一次性验证码登录后页面直接进入手机号页面，未经过登录验证码页。URL: ${snapshot.url}`,
  });

  if (transition.action === 'done' || transition.action === 'recoverable') {
    return transition.result;
  }
  return transition;
}

async function waitForLoginEntryOpenTransition(timeout = 10000) {
  const start = Date.now();
  let snapshot = normalizeStep6Snapshot(inspectLoginAuthState());

  while (Date.now() - start < timeout) {
    throwIfStopped();
    snapshot = normalizeStep6Snapshot(inspectLoginAuthState());
    if (snapshot.state !== 'unknown' && snapshot.state !== 'entry_page') {
      return snapshot;
    }
    await sleep(250);
  }

  return snapshot;
}

function isOpenAiOAuthAuthorizationRoute(rawUrl = '') {
  const value = String(rawUrl || '').trim();
  if (!value) {
    return false;
  }

  try {
    const parsed = new URL(value, location.href);
    const hostname = String(parsed.hostname || '').toLowerCase();
    if (!['auth.openai.com', 'auth0.openai.com', 'accounts.openai.com'].includes(hostname)) {
      return false;
    }

    const pathname = parsed.pathname || '/';
    return /^\/(?:authorize|oauth(?:2)?\/|api\/oauth\/oauth2\/auth|sign-in-with-chatgpt\/)/i.test(pathname);
  } catch {
    return false;
  }
}

function isPostChooseAccountOAuthRoute(snapshot = {}) {
  const url = String(snapshot?.url || location.href || '').trim();
  if (!isOpenAiOAuthAuthorizationRoute(url)) {
    return false;
  }

  try {
    const parsed = new URL(url, location.href);
    return !/\/choose-an-account(?:[/?#]|$)/i.test(parsed.pathname || '');
  } catch {
    return !/\/choose-an-account(?:[/?#]|$)/i.test(url);
  }
}

async function waitForChooseAccountTransition(timeout = 15000) {
  const start = Date.now();
  let snapshot = normalizeStep6Snapshot(inspectLoginAuthState());

  while (Date.now() - start < timeout) {
    throwIfStopped();
    snapshot = normalizeStep6Snapshot(inspectLoginAuthState());
    if (isPostChooseAccountOAuthRoute(snapshot)) {
      return {
        ...snapshot,
        oauthAuthorizationRoute: true,
      };
    }
    if (snapshot.state !== 'unknown' && snapshot.state !== 'choose_account_page') {
      return snapshot;
    }
    await sleep(250);
  }

  return snapshot;
}

async function resolveChooseAccountTransitionResult(snapshot, payload, visibleStep, options = {}) {
  const resolvedSnapshot = normalizeStep6Snapshot(snapshot || inspectLoginAuthState());
  if (!resolvedSnapshot) {
    return null;
  }

  const {
    oauthConsentVia = 'choose_account_oauth_consent_page',
    oauthAuthorizationVia = 'choose_account_oauth_authorization_route',
    addEmailVia = 'choose_account_add_email_page',
    addPhoneVia = 'choose_account_add_phone_page',
    verificationVia = 'choose_account_verification_page',
    phoneVerificationVia = 'choose_account_phone_verification_page',
    timeoutReason = 'login_timeout_after_choose_account',
    timeoutMessage = 'Clicking the existing OpenAI account entered the login timeout page.',
  } = options;

  if (resolvedSnapshot.state === 'oauth_consent_page') {
    return createStep6OAuthConsentSuccessResult(resolvedSnapshot, {
      via: oauthConsentVia,
    });
  }
  if (resolvedSnapshot.oauthAuthorizationRoute || isPostChooseAccountOAuthRoute(resolvedSnapshot)) {
    return createStep6OAuthConsentSuccessResult(resolvedSnapshot, {
      via: oauthAuthorizationVia,
    });
  }
  if (resolvedSnapshot.state === 'unknown' || resolvedSnapshot.state === 'choose_account_page') {
    return null;
  }
  if (resolvedSnapshot.state === 'add_email_page') {
    return createStep6AddEmailSuccessResult(resolvedSnapshot, {
      via: addEmailVia,
    });
  }
  if (resolvedSnapshot.state === 'add_phone_page') {
    return createStep6AddPhoneSuccessResult(resolvedSnapshot, {
      via: addPhoneVia,
    });
  }
  if (resolvedSnapshot.state === 'verification_page') {
    return finalizeStep6VerificationReady({
      visibleStep,
      loginVerificationRequestedAt: null,
      via: verificationVia,
    });
  }
  if (resolvedSnapshot.state === 'phone_verification_page') {
    return finalizeStep6VerificationReady({
      visibleStep,
      loginVerificationRequestedAt: null,
      via: phoneVerificationVia,
      allowPhoneVerificationPage: true,
    });
  }
  if (resolvedSnapshot.state === 'entry_page') {
    return step6OpenLoginEntry(payload, resolvedSnapshot);
  }
  if (resolvedSnapshot.state === 'email_page') {
    return step6LoginFromEmailPage(payload, resolvedSnapshot);
  }
  if (resolvedSnapshot.state === 'password_page') {
    return step6LoginFromPasswordPage(payload, resolvedSnapshot);
  }
  if (resolvedSnapshot.state === 'phone_entry_page') {
    return step6LoginFromPhonePage(payload, resolvedSnapshot);
  }
  if (resolvedSnapshot.state === 'login_timeout_error_page') {
    const transition = await createStep6LoginTimeoutRecoveryTransition(
      timeoutReason,
      resolvedSnapshot,
      timeoutMessage,
      { visibleStep, allowPhoneVerificationPage: true }
    );
    if (transition.action === 'done') return transition.result;
    if (transition.action === 'phone') return step6LoginFromPhonePage(payload, transition.snapshot);
    if (transition.action === 'email') return step6LoginFromEmailPage(payload, transition.snapshot);
    if (transition.action === 'password') return step6LoginFromPasswordPage(payload, transition.snapshot);
    return transition.result;
  }

  return null;
}

async function step6ChooseExistingAccount(payload, snapshot) {
  const performOperationWithDelay = typeof getOperationDelayRunner === 'function'
    ? getOperationDelayRunner()
    : async (metadata, operation) => {
        const rootScope = typeof window !== 'undefined' ? window : globalThis;
        const gate = rootScope?.CodexOperationDelay?.performOperationWithDelay;
        return typeof gate === 'function' ? gate(metadata, operation) : operation();
      };
  const visibleStep = Math.floor(Number(payload?.visibleStep) || 0) || 7;
  const currentSnapshot = normalizeStep6Snapshot(snapshot || inspectLoginAuthState());
  const loginIdentifierType = String(payload?.loginIdentifierType || '').trim();
  const isPhoneLoginIdentifier = loginIdentifierType === 'phone';
  const email = normalizeAuthAccountIdentifier(payload?.email || payload?.accountIdentifier || '');
  const phoneIdentifier = normalizeAuthAccountIdentifier(payload?.phoneNumber || payload?.accountIdentifier || '');
  const accountLabel = email && email.includes('@') ? email : (phoneIdentifier || '当前手机号账号');
  if ((!email || !email.includes('@')) && !isPhoneLoginIdentifier) {
    return createStep6RecoverableResult('missing_choose_account_email', currentSnapshot, {
      message: 'OpenAI choose-account page is visible, but the target email is missing.',
    });
  }

  const chooseAccountAction = await resolveChooseAccountAction(email, 8, {
    allowFirstAccountFallback: isPhoneLoginIdentifier,
  });
  if (
    chooseAccountAction.snapshot
    && chooseAccountAction.snapshot.state !== 'unknown'
    && chooseAccountAction.snapshot.state !== 'choose_account_page'
  ) {
    const routedResult = await resolveChooseAccountTransitionResult(
      chooseAccountAction.snapshot,
      payload,
      visibleStep
    );
    if (routedResult) return routedResult;
  }

  const target = chooseAccountAction.target;
  if (!target) {
    const otherAccountButton = chooseAccountAction.otherAccountButton;
    if (otherAccountButton) {
      const listedEmails = getChooseAccountListedEmails();
      const listedLabel = listedEmails.length ? `页面已有账号：${listedEmails.join(', ')}。` : '页面未读取到已有账号邮箱。';
      log(`OpenAI 选择账号页未确认目标账号 ${accountLabel}，${listedLabel} 将点击“登录至另一个帐户”继续登录。`, 'warn', { step: visibleStep, stepKey: 'oauth-login' });
      await humanPause(350, 900);
      await performOperationWithDelay({ stepKey: 'oauth-login', kind: 'click', label: 'choose-other-account' }, async () => {
        simulateClick(otherAccountButton);
      });
      const otherAccountSnapshot = normalizeStep6Snapshot(await waitForChooseAccountTransition(15000));
      const otherAccountRoutedResult = await resolveChooseAccountTransitionResult(
        otherAccountSnapshot,
        payload,
        visibleStep,
        {
          oauthConsentVia: 'choose_other_account_oauth_consent_page',
          oauthAuthorizationVia: 'choose_other_account_oauth_authorization_route',
          addEmailVia: 'choose_other_account_add_email_page',
          addPhoneVia: 'choose_other_account_add_phone_page',
          verificationVia: 'choose_other_account_verification_page',
          phoneVerificationVia: 'choose_other_account_phone_verification_page',
          timeoutReason: 'login_timeout_after_choose_other_account',
          timeoutMessage: 'Clicking another-account login from OpenAI choose-account entered the login timeout page.',
        }
      );
      if (otherAccountRoutedResult) return otherAccountRoutedResult;
      return createStep6RecoverableResult('choose_account_other_account_transition_stalled', otherAccountSnapshot, {
        message: `Clicked another-account login because ${accountLabel} was not confirmed, but the page did not enter a supported login state.`,
      });
    }
    return createStep6RecoverableResult('choose_account_target_not_found', currentSnapshot, {
      message: `OpenAI choose-account page does not contain target account ${accountLabel}.`,
    });
  }

  log(`Detected OpenAI choose-account page, selecting ${accountLabel}...`, 'info', { step: visibleStep, stepKey: 'oauth-login' });
  await humanPause(350, 900);
  await performOperationWithDelay({ stepKey: 'oauth-login', kind: 'click', label: 'choose-existing-account' }, async () => {
    simulateClick(target);
  });

  const nextSnapshot = normalizeStep6Snapshot(await waitForChooseAccountTransition(15000));
  const routedResult = await resolveChooseAccountTransitionResult(nextSnapshot, payload, visibleStep);
  if (routedResult) return routedResult;

  return createStep6RecoverableResult('choose_account_transition_stalled', nextSnapshot, {
    message: `Clicked ${accountLabel} on OpenAI choose-account page, but the page did not enter a supported next state.`,
  });
}

async function waitForPhoneLoginEntrySwitchTransition(timeout = 10000) {
  const start = Date.now();
  let snapshot = normalizeStep6Snapshot(inspectLoginAuthState());

  while (Date.now() - start < timeout) {
    throwIfStopped();
    snapshot = normalizeStep6Snapshot(inspectLoginAuthState());
    if (snapshot.state !== 'unknown' && snapshot.state !== 'email_page' && snapshot.state !== 'entry_page') {
      return snapshot;
    }
    await sleep(250);
  }

  return snapshot;
}

async function step6OpenLoginEntry(payload, snapshot) {
  const performOperationWithDelay = typeof getOperationDelayRunner === 'function'
    ? getOperationDelayRunner()
    : async (metadata, operation) => {
        const rootScope = typeof window !== 'undefined' ? window : globalThis;
        const gate = rootScope?.CodexOperationDelay?.performOperationWithDelay;
        return typeof gate === 'function' ? gate(metadata, operation) : operation();
      };
  const visibleStep = Math.floor(Number(payload?.visibleStep) || 0) || 7;
  const currentSnapshot = normalizeStep6Snapshot(snapshot || inspectLoginAuthState());
  const preferPhoneLogin = String(payload?.loginIdentifierType || '').trim() === 'phone' || (!payload?.email && payload?.phoneNumber);
  const genericEntryTrigger = currentSnapshot.loginEntryTrigger || findLoginEntryTrigger();
  const phoneEntryTrigger = currentSnapshot.phoneEntryTrigger || findLoginPhoneEntryTrigger();
  const trigger = genericEntryTrigger || (preferPhoneLogin ? phoneEntryTrigger : null);
  if (!trigger || !isActionEnabled(trigger)) {
    return createStep6RecoverableResult('missing_login_entry_trigger', currentSnapshot, {
      message: preferPhoneLogin
        ? '当前登录入口页没有可点击的手机号登录入口。'
        : '当前登录入口页没有可点击的邮箱登录入口。',
    });
  }

  log(`检测到登录入口页，正在点击 "${getActionText(trigger).slice(0, 80)}"...`, 'info', { step: visibleStep, stepKey: 'oauth-login' });
  await humanPause(350, 900);
  await performOperationWithDelay({ stepKey: 'oauth-login', kind: 'click', label: 'open-login-entry' }, async () => {
    simulateClick(trigger);
  });
  const nextSnapshot = await waitForLoginEntryOpenTransition();

  if (nextSnapshot.state === 'email_page') {
    if (preferPhoneLogin) {
      return switchFromEmailPageToPhoneLogin(payload, nextSnapshot);
    }
    return step6LoginFromEmailPage(payload, nextSnapshot);
  }
  if (nextSnapshot.state === 'password_page') {
    return step6LoginFromPasswordPage(payload, nextSnapshot);
  }
  if (nextSnapshot.state === 'phone_entry_page') {
    return step6LoginFromPhonePage(payload, nextSnapshot);
  }
  if (nextSnapshot.state === 'verification_page') {
    return finalizeStep6VerificationReady({
      visibleStep,
      loginVerificationRequestedAt: null,
      via: 'entry_open_verification_page',
    });
  }
  if (nextSnapshot.state === 'oauth_consent_page') {
    return createStep6OAuthConsentSuccessResult(nextSnapshot, {
      via: 'entry_open_oauth_consent_page',
    });
  }
  if (nextSnapshot.state === 'add_email_page') {
    return createStep6AddEmailSuccessResult(nextSnapshot, {
      via: 'entry_open_add_email_page',
    });
  }
  if (nextSnapshot.state === 'login_timeout_error_page') {
    const transition = await createStep6LoginTimeoutRecoveryTransition(
      'login_timeout_after_entry_open',
      nextSnapshot,
      '点击登录入口后进入登录超时报错页。',
      { visibleStep }
    );
    if (transition.action === 'done') return transition.result;
    if (transition.action === 'phone') return step6LoginFromPhonePage(payload, transition.snapshot);
    if (transition.action === 'email') return step6LoginFromEmailPage(payload, transition.snapshot);
    if (transition.action === 'password') return step6LoginFromPasswordPage(payload, transition.snapshot);
    return transition.result;
  }

  return createStep6RecoverableResult('login_entry_open_stalled', nextSnapshot, {
    message: '点击登录入口后仍未进入手机号/邮箱/密码/验证码页。',
  });
}

async function step6SwitchToOneTimeCodeLogin(payload, snapshot) {
  const performOperationWithDelay = typeof getOperationDelayRunner === 'function'
    ? getOperationDelayRunner()
    : async (metadata, operation) => {
        const rootScope = typeof window !== 'undefined' ? window : globalThis;
        const gate = rootScope?.CodexOperationDelay?.performOperationWithDelay;
        return typeof gate === 'function' ? gate(metadata, operation) : operation();
      };
  const visibleStep = Math.floor(Number(payload?.visibleStep) || 0) || 7;
  const switchTrigger = snapshot?.switchTrigger || findOneTimeCodeLoginTrigger();
  if (!switchTrigger || !isActionEnabled(switchTrigger)) {
    return createStep6RecoverableResult('missing_one_time_code_trigger', normalizeStep6Snapshot(inspectLoginAuthState()), {
      message: '当前登录页没有可用的一次性验证码登录入口。',
    });
  }

  log('已检测到一次性验证码登录入口，准备切换...', 'info', { step: visibleStep, stepKey: 'oauth-login' });
  const loginVerificationRequestedAt = Date.now();
  await humanPause(350, 900);
  await performOperationWithDelay({ stepKey: 'oauth-login', kind: 'click', label: 'switch-one-time-code-login' }, async () => {
    simulateClick(switchTrigger);
  });
  log('已点击一次性验证码登录', 'info', { step: visibleStep, stepKey: 'oauth-login' });
  await sleep(1200);
  const result = await waitForStep6SwitchTransition(loginVerificationRequestedAt, 10000, { visibleStep });
  if (result?.step6Outcome === 'success') {
    if (result.skipLoginVerificationStep || result.addEmailPage) {
      return result;
    }
    return finalizeStep6VerificationReady({
      visibleStep,
      loginVerificationRequestedAt: result.loginVerificationRequestedAt || loginVerificationRequestedAt,
      via: result.via || 'switch_to_one_time_code_login',
    });
  }
  if (result?.action === 'password') {
    return step6LoginFromPasswordPage(payload, result.snapshot);
  }
  if (result?.action === 'phone') {
    return step6LoginFromPhonePage(payload, result.snapshot);
  }
  if (result?.action === 'email') {
    return step6LoginFromEmailPage(payload, result.snapshot);
  }
  return result;
}

async function step6LoginFromPhonePage(payload, snapshot) {
  const performOperationWithDelay = typeof getOperationDelayRunner === 'function'
    ? getOperationDelayRunner()
    : async (metadata, operation) => {
        const rootScope = typeof window !== 'undefined' ? window : globalThis;
        const gate = rootScope?.CodexOperationDelay?.performOperationWithDelay;
        return typeof gate === 'function' ? gate(metadata, operation) : operation();
      };
  const visibleStep = Math.floor(Number(payload?.visibleStep) || 0) || 7;
  const currentSnapshot = normalizeStep6Snapshot(snapshot || inspectLoginAuthState());
  const phoneInput = currentSnapshot.phoneInput || getLoginPhoneInput();
  const phoneNumber = String(payload?.phoneNumber || payload?.accountIdentifier || '').trim();
  const countryLabel = String(payload?.countryLabel || '').trim();
  const countryId = payload?.countryId;

  if (!phoneNumber) {
    return createStep6RecoverableResult('missing_phone_number', currentSnapshot, {
      message: '手机号登录时缺少手机号，请重新执行步骤 2 获取号码。',
    });
  }
  if (!phoneInput) {
    return createStep6RecoverableResult('missing_phone_input', currentSnapshot, {
      message: '当前登录页没有可用的手机号输入框。',
    });
  }

  const dialCodeFromSelection = await selectCountryForPhoneInput(phoneInput, phoneNumber, countryLabel, { visibleStep });
  const dialCode = dialCodeFromSelection || resolveLoginPhoneDialCode(phoneInput, {
    phoneNumber,
    countryId,
    countryLabel,
  });
  const inputValue = toNationalPhoneNumber(phoneNumber, dialCode);
  if (!inputValue) {
    throw new Error(`步骤 ${visibleStep}：手机号为空，无法填写。`);
  }

  log(
    `步骤 ${visibleStep}：手机号登录填写前诊断 ${JSON.stringify({
      phoneNumber,
      countryLabel,
      countryId,
      dialCode,
      input: getLoginPhoneInputDiagnostics(phoneInput),
      candidates: getLoginPhoneInputCandidateDiagnostics(),
    })}`,
    'info',
    { step: visibleStep, stepKey: 'oauth-login' }
  );
  log(`步骤 ${visibleStep}：正在填写手机号 ${phoneNumber}...`, 'info', { step: visibleStep, stepKey: 'oauth-login' });
  await humanPause(500, 1400);
  const fillResult = await fillLoginPhoneInputAndConfirm(phoneInput, {
    phoneNumber,
    dialCode,
    visibleStep,
    resolvePhoneInput: () => getLoginPhoneInput() || phoneInput,
  });
  log(`步骤 ${visibleStep}：手机号已填写${dialCode ? `（区号 +${dialCode}，本地号 ${fillResult.inputValue}，可见提交值 ${fillResult.attemptedValue}）` : ''}。`, 'info', { step: visibleStep, stepKey: 'oauth-login' });

  await sleep(500);
  const verifiedPhoneInput = fillResult.input || phoneInput;
  const hiddenSync = await performOperationWithDelay({ stepKey: 'oauth-login', kind: 'hidden-sync', label: 'login-phone-pre-submit-hidden-sync' }, async () => (
    syncPhoneHiddenFormValue(verifiedPhoneInput, { phoneNumber, dialCode, inputValue })
  ));
  const submitButton = getLoginSubmitButton({ allowDisabled: true }) || currentSnapshot.submitButton;
  const preSubmitRenderedValue = getPhoneInputRenderedValue(verifiedPhoneInput);
  const preSubmitHiddenInput = hiddenSync?.input || getPhoneHiddenValueInput(verifiedPhoneInput);
  const preSubmitDiagnostics = {
    renderedValue: preSubmitRenderedValue,
    inputVerified: isPhoneInputValueComplete(verifiedPhoneInput, phoneNumber, dialCode, inputValue),
    input: getLoginPhoneInputDiagnostics(verifiedPhoneInput),
    hidden: getLoginPhoneHiddenValueDiagnostics(preSubmitHiddenInput),
    submitButton: getLoginPhoneSubmitButtonDiagnostics(submitButton),
  };
  log(
    `步骤 ${visibleStep}：手机号提交前复查 ${JSON.stringify(preSubmitDiagnostics)}`,
    'info',
    { step: visibleStep, stepKey: 'oauth-login' }
  );
  if (!preSubmitDiagnostics.inputVerified) {
    throw new Error(`步骤 ${visibleStep}：提交前手机号输入框复查失败，完整号码 ${phoneNumber}，区号 +${dialCode || '未识别'}，期望本地号 ${inputValue}，当前输入框为 ${normalizePhoneDigits(preSubmitRenderedValue) || '空'}，已停止提交。`);
  }
  const phoneSubmittedAt = Date.now();
  await triggerLoginSubmitAction(submitButton, verifiedPhoneInput);
  log(`步骤 ${visibleStep}：手机号已提交。`, 'info', { step: visibleStep, stepKey: 'oauth-login' });

  const transition = await waitForStep6PhoneSubmitTransition(phoneSubmittedAt, 12000, { visibleStep });
  if (transition.action === 'done') {
    if (transition.result?.skipLoginVerificationStep || transition.result?.addEmailPage) {
      return transition.result;
    }
    return finalizeStep6VerificationReady({
      visibleStep,
      loginVerificationRequestedAt: transition.result.loginVerificationRequestedAt || phoneSubmittedAt,
      via: transition.result.via || 'phone_submit',
      allowPhoneVerificationPage: true,
    });
  }
  if (transition.action === 'recoverable') {
    log(transition.result.message || `提交手机号后仍未进入目标页面，准备重新执行步骤 ${visibleStep}。`, 'warn', {
      step: visibleStep,
      stepKey: 'oauth-login',
    });
    return transition.result;
  }
  if (transition.action === 'phone') {
    return step6LoginFromPhonePage(payload, transition.snapshot);
  }
  if (transition.action === 'password') {
    return step6LoginFromPasswordPage(payload, transition.snapshot);
  }
  if (transition.action === 'email') {
    return step6LoginFromEmailPage(payload, transition.snapshot);
  }

  return createStep6RecoverableResult('phone_submit_unknown', normalizeStep6Snapshot(inspectLoginAuthState()), {
    message: '提交手机号后未得到可用的下一步状态。',
  });
}

async function switchFromEmailPageToPhoneLogin(payload, snapshot) {
  const performOperationWithDelay = typeof getOperationDelayRunner === 'function'
    ? getOperationDelayRunner()
    : async (metadata, operation) => {
        const rootScope = typeof window !== 'undefined' ? window : globalThis;
        const gate = rootScope?.CodexOperationDelay?.performOperationWithDelay;
        return typeof gate === 'function' ? gate(metadata, operation) : operation();
      };
  const visibleStep = Math.floor(Number(payload?.visibleStep) || 0) || 7;
  let currentSnapshot = normalizeStep6Snapshot(snapshot || inspectLoginAuthState());
  let phoneEntryTrigger = currentSnapshot.phoneEntryTrigger || findLoginPhoneEntryTrigger();
  if (!phoneEntryTrigger || !isActionEnabled(phoneEntryTrigger)) {
    const moreOptionsTrigger = currentSnapshot.moreOptionsTrigger || findLoginMoreOptionsTrigger();
    if (moreOptionsTrigger && isActionEnabled(moreOptionsTrigger)) {
      log(`步骤 ${visibleStep}：手机号入口可能隐藏在更多选项中，正在展开更多选项...`, 'info', {
        step: visibleStep,
        stepKey: 'oauth-login',
      });
      await humanPause(350, 900);
      await performOperationWithDelay({ stepKey: 'oauth-login', kind: 'click', label: 'login-more-options' }, async () => {
        simulateClick(moreOptionsTrigger);
      });
      await sleep(800);
      currentSnapshot = normalizeStep6Snapshot(inspectLoginAuthState());
      phoneEntryTrigger = currentSnapshot.phoneEntryTrigger || findLoginPhoneEntryTrigger();
    }
  }

  if (!phoneEntryTrigger || !isActionEnabled(phoneEntryTrigger)) {
    return createStep6RecoverableResult('missing_phone_login_entry_trigger', currentSnapshot, {
      message: '本轮要求使用手机号登录，但当前邮箱登录页没有可用的手机号登录入口。',
    });
  }

  log(`步骤 ${visibleStep}：当前在邮箱入口，正在切换到手机号登录...`, 'info', { step: visibleStep, stepKey: 'oauth-login' });
  await humanPause(350, 900);
  await performOperationWithDelay({ stepKey: 'oauth-login', kind: 'click', label: 'switch-phone-login' }, async () => {
    simulateClick(phoneEntryTrigger);
  });
  const nextSnapshot = normalizeStep6Snapshot(await waitForPhoneLoginEntrySwitchTransition(20000));
  if (nextSnapshot.state === 'phone_entry_page') {
    return step6LoginFromPhonePage(payload, nextSnapshot);
  }
  if (nextSnapshot.state === 'password_page') {
    return step6LoginFromPasswordPage(payload, nextSnapshot);
  }
  if (nextSnapshot.state === 'verification_page' || nextSnapshot.state === 'phone_verification_page') {
    return finalizeStep6VerificationReady({
      visibleStep,
      loginVerificationRequestedAt: null,
      via: 'phone_entry_switch_verification_page',
      allowPhoneVerificationPage: true,
    });
  }
  if (nextSnapshot.state === 'oauth_consent_page') {
    return createStep6OAuthConsentSuccessResult(nextSnapshot, {
      via: 'phone_entry_switch_oauth_consent_page',
    });
  }
  if (nextSnapshot.state === 'add_email_page') {
    return createStep6AddEmailSuccessResult(nextSnapshot, {
      via: 'phone_entry_switch_add_email_page',
    });
  }
  if (nextSnapshot.state === 'login_timeout_error_page') {
    const transition = await createStep6LoginTimeoutRecoveryTransition(
      'login_timeout_after_phone_entry_switch',
      nextSnapshot,
      '点击手机号登录入口后进入登录超时报错页。',
      {
        visibleStep,
        allowPhoneVerificationPage: true,
      }
    );
    if (transition.action === 'done') return transition.result;
    if (transition.action === 'phone') return step6LoginFromPhonePage(payload, transition.snapshot);
    if (transition.action === 'password') return step6LoginFromPasswordPage(payload, transition.snapshot);
    if (transition.action === 'email') return step6LoginFromEmailPage(payload, transition.snapshot);
    return transition.result;
  }

  return createStep6RecoverableResult('phone_login_entry_switch_stalled', nextSnapshot, {
    message: `点击手机号登录入口后仍未进入手机号或密码页，当前停留在${getLoginAuthStateLabel(nextSnapshot)}。`,
  });
}

async function step6LoginFromPasswordPage(payload, snapshot) {
  const performOperationWithDelay = typeof getOperationDelayRunner === 'function'
    ? getOperationDelayRunner()
    : async (metadata, operation) => {
        const rootScope = typeof window !== 'undefined' ? window : globalThis;
        const gate = rootScope?.CodexOperationDelay?.performOperationWithDelay;
        return typeof gate === 'function' ? gate(metadata, operation) : operation();
      };
  const visibleStep = Math.floor(Number(payload?.visibleStep) || 0) || 7;
  const currentSnapshot = normalizeStep6Snapshot(snapshot || inspectLoginAuthState());
  const hasPassword = Boolean(String(payload?.password || '').trim());

  if (currentSnapshot.passwordInput) {
    if (!hasPassword) {
      if (currentSnapshot.switchTrigger) {
        log('当前未提供密码，改走一次性验证码登录。', 'warn', { step: visibleStep, stepKey: 'oauth-login' });
        return step6SwitchToOneTimeCodeLogin(payload, currentSnapshot);
      }

      return createStep6RecoverableResult('missing_password_and_one_time_code_trigger', currentSnapshot, {
        message: '登录时未提供密码，且当前页面没有可用的一次性验证码登录入口。',
      });
    }

    log('已进入密码页，准备填写密码...', 'info', { step: visibleStep, stepKey: 'oauth-login' });
    await humanPause(550, 1450);
    await performOperationWithDelay({ stepKey: 'oauth-login', kind: 'fill', label: 'login-password' }, async () => {
      fillInput(currentSnapshot.passwordInput, payload.password);
    });
    log('已填写密码', 'info', { step: visibleStep, stepKey: 'oauth-login' });

    await sleep(500);
    const passwordSubmittedAt = Date.now();
    await triggerLoginSubmitAction(currentSnapshot.submitButton, currentSnapshot.passwordInput);
    log('已提交密码', 'info', { step: visibleStep, stepKey: 'oauth-login' });

    const transition = await waitForStep6PasswordSubmitTransition(passwordSubmittedAt, 10000, { visibleStep });
    if (transition.action === 'done') {
      if (transition.result?.skipLoginVerificationStep || transition.result?.addEmailPage) {
        return transition.result;
      }
      return finalizeStep6VerificationReady({
        visibleStep,
        loginVerificationRequestedAt: transition.result.loginVerificationRequestedAt || passwordSubmittedAt,
        via: transition.result.via || 'password_submit',
      });
    }
    if (transition.action === 'recoverable') {
      log(transition.result.message || `提交密码后仍未进入登录验证码页面，准备重新执行步骤 ${visibleStep}。`, 'warn', { step: visibleStep, stepKey: 'oauth-login' });
      return transition.result;
    }
    if (transition.action === 'password') {
      return step6LoginFromPasswordPage(payload, transition.snapshot);
    }
    if (transition.action === 'phone') {
      return step6LoginFromPhonePage(payload, transition.snapshot);
    }
    if (transition.action === 'email') {
      return step6LoginFromEmailPage(payload, transition.snapshot);
    }
    if (transition.action === 'switch') {
      return step6SwitchToOneTimeCodeLogin(payload, transition.snapshot);
    }

    return createStep6RecoverableResult('password_submit_unknown', normalizeStep6Snapshot(inspectLoginAuthState()), {
      message: '提交密码后未得到可用的下一步状态。',
    });
  }

  if (currentSnapshot.switchTrigger) {
    return step6SwitchToOneTimeCodeLogin(payload, currentSnapshot);
  }

  return createStep6RecoverableResult('password_page_unactionable', currentSnapshot, {
    message: '当前停留在登录页，但没有可提交密码的输入框，也没有一次性验证码登录入口。',
  });
}

async function step6LoginFromEmailPage(payload, snapshot) {
  const performOperationWithDelay = typeof getOperationDelayRunner === 'function'
    ? getOperationDelayRunner()
    : async (metadata, operation) => {
        const rootScope = typeof window !== 'undefined' ? window : globalThis;
        const gate = rootScope?.CodexOperationDelay?.performOperationWithDelay;
        return typeof gate === 'function' ? gate(metadata, operation) : operation();
      };
  const visibleStep = Math.floor(Number(payload?.visibleStep) || 0) || 7;
  const currentSnapshot = normalizeStep6Snapshot(snapshot || inspectLoginAuthState());
  if (String(payload?.loginIdentifierType || '').trim() === 'phone' && payload?.phoneNumber) {
    return switchFromEmailPageToPhoneLogin(payload, currentSnapshot);
  }
  const emailInput = currentSnapshot.emailInput || getLoginEmailInput();
  if (!emailInput) {
    throw new Error('在登录页未找到邮箱输入框。URL: ' + location.href);
  }

  if ((emailInput.value || '').trim() !== payload.email) {
    await humanPause(500, 1400);
    await performOperationWithDelay({ stepKey: 'oauth-login', kind: 'fill', label: 'login-email' }, async () => {
      fillInput(emailInput, payload.email);
    });
    log('已填写邮箱', 'info', { step: visibleStep, stepKey: 'oauth-login' });
  } else {
    log('邮箱已在输入框中，准备提交...', 'info', { step: visibleStep, stepKey: 'oauth-login' });
  }

  await sleep(500);
  const emailSubmittedAt = Date.now();
  await triggerLoginSubmitAction(currentSnapshot.submitButton, emailInput);
  log('已提交邮箱', 'info', { step: visibleStep, stepKey: 'oauth-login' });

  const transition = await waitForStep6EmailSubmitTransition(emailSubmittedAt, 12000, { visibleStep });
  if (transition.action === 'done') {
    if (transition.result?.skipLoginVerificationStep || transition.result?.addEmailPage) {
      return transition.result;
    }
    return finalizeStep6VerificationReady({
      visibleStep,
      loginVerificationRequestedAt: transition.result.loginVerificationRequestedAt || emailSubmittedAt,
      via: transition.result.via || 'email_submit',
    });
  }
  if (transition.action === 'recoverable') {
    log(transition.result.message || `提交邮箱后仍未进入目标页面，准备重新执行步骤 ${visibleStep}。`, 'warn', { step: visibleStep, stepKey: 'oauth-login' });
    return transition.result;
  }
  if (transition.action === 'email') {
    return step6LoginFromEmailPage(payload, transition.snapshot);
  }
  if (transition.action === 'password') {
    return step6LoginFromPasswordPage(payload, transition.snapshot);
  }
  if (transition.action === 'phone') {
    return step6LoginFromPhonePage(payload, transition.snapshot);
  }

  return createStep6RecoverableResult('email_submit_unknown', normalizeStep6Snapshot(inspectLoginAuthState()), {
    message: '提交邮箱后未得到可用的下一步状态。',
  });
}

async function step6_login(payload) {
  const visibleStep = Math.floor(Number(payload?.visibleStep) || 0) || 7;
  const { email, phoneNumber } = payload;
  const loginIdentifierType = String(payload?.loginIdentifierType || '').trim();
  if (!email && !phoneNumber) throw new Error('登录时缺少邮箱地址或手机号。');

  const snapshot = normalizeStep6Snapshot(await waitForKnownLoginAuthState(15000));

  if (snapshot.state === 'verification_page' || snapshot.state === 'phone_verification_page') {
    log('认证页已在登录验证码页，开始确认页面是否稳定。', 'info', { step: visibleStep, stepKey: 'oauth-login' });
    return finalizeStep6VerificationReady({
      visibleStep,
      loginVerificationRequestedAt: null,
      via: snapshot.state === 'phone_verification_page'
        ? 'already_on_phone_verification_page'
        : 'already_on_verification_page',
      allowPhoneVerificationPage: snapshot.state === 'phone_verification_page',
    });
  }

  if (snapshot.state === 'oauth_consent_page') {
    log('认证页已直接进入 OAuth 授权页，跳过登录验证码步骤。', 'ok', { step: visibleStep, stepKey: 'oauth-login' });
    return createStep6OAuthConsentSuccessResult(snapshot, {
      via: 'already_on_oauth_consent_page',
    });
  }

  if (snapshot.state === 'add_email_page') {
    log('认证页已在添加邮箱页，登录阶段完成。', 'ok', { step: visibleStep, stepKey: 'oauth-login' });
    return createStep6AddEmailSuccessResult(snapshot, {
      via: 'already_on_add_email_page',
    });
  }

  if (snapshot.state === 'login_timeout_error_page') {
    log('检测到登录超时报错页，先尝试恢复当前页面。', 'warn', { step: visibleStep, stepKey: 'oauth-login' });
    const transition = await createStep6LoginTimeoutRecoveryTransition(
      'login_timeout_error_page',
      snapshot,
      '当前页面处于登录超时报错页。',
      {
        visibleStep,
        loginVerificationRequestedAt: null,
        via: 'login_timeout_initial_recovered',
        allowPhoneVerificationPage: loginIdentifierType === 'phone' || Boolean(phoneNumber),
      }
    );
    if (transition.action === 'done') {
      if (transition.result?.skipLoginVerificationStep || transition.result?.addEmailPage) {
        return transition.result;
      }
      return finalizeStep6VerificationReady({
        visibleStep,
        loginVerificationRequestedAt: transition.result.loginVerificationRequestedAt || null,
        via: transition.result.via || 'login_timeout_initial_recovered',
      });
    }
    if (transition.action === 'phone') {
      return step6LoginFromPhonePage(payload, transition.snapshot);
    }
    if (transition.action === 'email') {
      return step6LoginFromEmailPage(payload, transition.snapshot);
    }
    if (transition.action === 'password') {
      return step6LoginFromPasswordPage(payload, transition.snapshot);
    }
    return transition.result;
  }

  if (snapshot.state === 'email_page') {
    if (loginIdentifierType === 'phone' && phoneNumber) {
      return switchFromEmailPageToPhoneLogin(payload, snapshot);
    }
    log(`正在使用 ${email} 登录...`, 'info', { step: visibleStep, stepKey: 'oauth-login' });
    return step6LoginFromEmailPage(payload, snapshot);
  }

  if (snapshot.state === 'phone_entry_page') {
    log('正在使用手机号登录...', 'info', { step: visibleStep, stepKey: 'oauth-login' });
    return step6LoginFromPhonePage(payload, snapshot);
  }

  if (snapshot.state === 'password_page') {
    log('认证页已在密码页，继续当前登录流程。', 'info', { step: visibleStep, stepKey: 'oauth-login' });
    return step6LoginFromPasswordPage(payload, snapshot);
  }

  if (snapshot.state === 'choose_account_page') {
    return step6ChooseExistingAccount(payload, snapshot);
  }

  if (snapshot.state === 'entry_page') {
    return step6OpenLoginEntry(payload, snapshot);
  }

  throwForStep6FatalState(snapshot, visibleStep);
  throw new Error(`无法识别当前登录页面状态。URL: ${snapshot?.url || location.href}`);
}

async function waitForAddEmailPageReady(timeout = 15000) {
  const start = Date.now();
  let sawAddEmailPage = false;
  while (Date.now() - start < timeout) {
    throwIfStopped();
    if (isAddEmailPageReady()) {
      sawAddEmailPage = true;
      const snapshot = inspectLoginAuthState();
      if (snapshot.emailInput || getLoginEmailInput()) {
        return snapshot;
      }
    }
    await sleep(200);
  }
  if (sawAddEmailPage) {
    throw new Error('等待添加邮箱页面输入框就绪超时。URL: ' + location.href);
  }
  throw new Error('等待添加邮箱页面就绪超时。URL: ' + location.href);
}

async function waitForAddEmailSubmitOutcome(timeout = 45000) {
  const start = Date.now();
  let lastState = inspectLoginAuthState();

  while (Date.now() - start < timeout) {
    throwIfStopped();
    lastState = inspectLoginAuthState();

    if (lastState.state === 'verification_page') {
      return {
        success: true,
        verificationPage: true,
        displayedEmail: getLoginVerificationDisplayedEmail(),
        url: location.href,
      };
    }
    if (lastState.state === 'oauth_consent_page') {
      return {
        success: true,
        directOAuthConsentPage: true,
        url: location.href,
      };
    }
    if (lastState.state === 'login_timeout_error_page') {
      return {
        retryPage: true,
        maxCheckAttempts: Boolean(lastState.maxCheckAttemptsBlocked),
        emailInUse: Boolean(lastState.emailInUseBlocked),
        url: location.href,
      };
    }

    const errorText = getVerificationErrorText();
    if (errorText) {
      return {
        errorText,
        url: location.href,
      };
    }

    const addEmailErrorText = isAddEmailPageReady() ? getVisibleFieldErrorText() : '';
    if (addEmailErrorText) {
      return {
        errorText: addEmailErrorText,
        url: location.href,
      };
    }

    await sleep(200);
  }

  throw new Error(`提交邮箱后未进入验证码页。当前状态：${getLoginAuthStateLabel(lastState)}。URL: ${lastState?.url || location.href}`);
}

async function submitAddEmailAndContinue(payload = {}) {
  const performOperationWithDelay = typeof getOperationDelayRunner === 'function'
    ? getOperationDelayRunner()
    : async (metadata, operation) => {
        const rootScope = typeof window !== 'undefined' ? window : globalThis;
        const gate = rootScope?.CodexOperationDelay?.performOperationWithDelay;
        return typeof gate === 'function' ? gate(metadata, operation) : operation();
      };
  const email = String(payload.email || '').trim().toLowerCase();
  if (!email) {
    throw new Error('未提供邮箱地址，无法添加邮箱。');
  }

  const snapshot = await waitForAddEmailPageReady();
  const emailInput = snapshot.emailInput || getLoginEmailInput();
  if (!emailInput) {
    throw new Error('添加邮箱页未找到邮箱输入框。URL: ' + location.href);
  }

  await humanPause(500, 1400);
  await performOperationWithDelay({ stepKey: 'oauth-login', kind: 'fill', label: 'add-email' }, async () => {
    fillInput(emailInput, email);
  });
  log(`步骤 8：已填写邮箱：${email}`);

  await sleep(500);
  const submitButton = snapshot.submitButton || getLoginSubmitButton({ allowDisabled: true });
  if (!submitButton || !isActionEnabled(submitButton)) {
    throw new Error('添加邮箱页未找到可点击的继续按钮。URL: ' + location.href);
  }

  await triggerLoginSubmitAction(submitButton, emailInput);
  log('步骤 8：已提交邮箱，正在等待邮箱验证码页...');

  const outcome = await waitForAddEmailSubmitOutcome();
  if (outcome.errorText && (SIGNUP_EMAIL_EXISTS_PATTERN.test(outcome.errorText) || /email_in_use/i.test(outcome.errorText))) {
    throw createStep8EmailInUseError();
  }
  if (outcome.errorText) {
    throw new Error(`添加邮箱失败：${outcome.errorText}`);
  }
  if (outcome.emailInUse) {
    throw createStep8EmailInUseError();
  }
  if (outcome.maxCheckAttempts) {
    throw createAuthMaxCheckAttemptsError();
  }
  if (outcome.retryPage) {
    throw new Error(`添加邮箱后进入认证重试页，请重新执行步骤 8。URL: ${outcome.url}`);
  }

  return {
    submitted: true,
    email,
    ...outcome,
  };
}

// ============================================================
// Step 9: Find "继续" on OAuth consent page for debugger click
// ============================================================
// After login + verification, page shows:
// "使用 ChatGPT 登录到 Codex" with a "继续" submit button.
// Background performs the actual click through the debugger Input API.

async function step8_findAndClick(payload = {}) {
  const visibleStep = Math.floor(Number(payload?.visibleStep) || 0) || 9;
  log('正在查找 OAuth 同意页的“继续”按钮...', 'info', { step: visibleStep, stepKey: 'confirm-oauth' });

  const continueBtn = await prepareStep8ContinueButton();

  const rect = getSerializableRect(continueBtn);
  log('已找到“继续”按钮并准备好调试器点击坐标。', 'info', { step: visibleStep, stepKey: 'confirm-oauth' });
  return {
    rect,
    buttonText: (continueBtn.textContent || '').trim(),
    url: location.href,
  };
}

function getStep8State() {
  const continueBtn = getPrimaryContinueButton();
  const retryState = getCurrentAuthRetryPageState('auth');
  const state = {
    url: location.href,
    consentPage: isOAuthConsentPage(),
    consentReady: isStep8Ready(),
    verificationPage: isVerificationPageStillVisible(),
    addPhonePage: isAddPhonePageReady(),
    addEmailPage: isAddEmailPageReady(),
    phoneVerificationPage: isPhoneVerificationPageReady(),
    retryPage: Boolean(retryState),
    retryEnabled: Boolean(retryState?.retryEnabled),
    retryTitleMatched: Boolean(retryState?.titleMatched),
    retryDetailMatched: Boolean(retryState?.detailMatched),
    maxCheckAttemptsBlocked: Boolean(retryState?.maxCheckAttemptsBlocked),
    buttonFound: Boolean(continueBtn),
    buttonEnabled: isButtonEnabled(continueBtn),
    buttonText: continueBtn ? getActionText(continueBtn) : '',
  };

  if (continueBtn) {
    try {
      state.rect = getSerializableRect(continueBtn);
    } catch {
      state.rect = null;
    }
  }

  return state;
}

async function step8_triggerContinue(payload = {}) {
  const visibleStep = Math.floor(Number(payload?.visibleStep) || 0) || 9;
  const strategy = payload?.strategy || 'requestSubmit';
  const continueBtn = await prepareStep8ContinueButton({
    findTimeoutMs: payload?.findTimeoutMs,
    enabledTimeoutMs: payload?.enabledTimeoutMs,
  });
  const form = continueBtn.form || continueBtn.closest('form');

  switch (strategy) {
    case 'requestSubmit':
      if (!form || typeof form.requestSubmit !== 'function') {
        throw new Error('“继续”按钮当前不在可提交的 form 中，无法使用 requestSubmit。URL: ' + location.href);
      }
      form.requestSubmit(continueBtn);
      break;
    case 'nativeClick':
      continueBtn.click();
      break;
    case 'dispatchClick':
      simulateClick(continueBtn);
      break;
    default:
      throw new Error(`未知的 Step ${visibleStep} 触发策略：${strategy}`);
  }

  log(`continue button triggered via ${strategy}.`, 'info', { step: visibleStep, stepKey: 'confirm-oauth' });
  return {
    strategy,
    ...getStep8State(),
  };
}

async function prepareStep8ContinueButton(options = {}) {
  const {
    findTimeoutMs = 10000,
    enabledTimeoutMs = 8000,
  } = options;

  const continueBtn = await findContinueButton(findTimeoutMs);
  await waitForButtonEnabled(continueBtn, enabledTimeoutMs);

  await humanPause(250, 700);
  continueBtn.scrollIntoView({ behavior: 'auto', block: 'center' });
  continueBtn.focus();
  await waitForStableButtonRect(continueBtn);
  return continueBtn;
}

async function findContinueButton(timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    throwIfStopped();
    if (isAddPhonePageReady()) {
      throw new Error('当前页面已进入手机号页面，不是 OAuth 授权同意页。URL: ' + location.href);
    }
    if (isAddEmailPageReady()) {
      throw new Error('当前页面已进入添加邮箱页面，不是 OAuth 授权同意页。URL: ' + location.href);
    }
    const button = getPrimaryContinueButton();
    if (button && isStep8Ready()) {
      return button;
    }
    await sleep(150);
  }

  throw new Error('在 OAuth 同意页未找到“继续”按钮，或页面尚未进入授权同意状态。URL: ' + location.href);
}

async function waitForButtonEnabled(button, timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    throwIfStopped();
    if (isButtonEnabled(button)) return;
    await sleep(150);
  }
  throw new Error('“继续”按钮长时间不可点击。URL: ' + location.href);
}

function isButtonEnabled(button) {
  return Boolean(button)
    && !button.disabled
    && button.getAttribute('aria-disabled') !== 'true';
}

async function waitForStableButtonRect(button, timeout = 1500) {
  let previous = null;
  let stableSamples = 0;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    throwIfStopped();
    const rect = button?.getBoundingClientRect?.();
    if (rect && rect.width > 0 && rect.height > 0) {
      const snapshot = {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      };

      if (
        previous
        && Math.abs(snapshot.left - previous.left) < 1
        && Math.abs(snapshot.top - previous.top) < 1
        && Math.abs(snapshot.width - previous.width) < 1
        && Math.abs(snapshot.height - previous.height) < 1
      ) {
        stableSamples += 1;
        if (stableSamples >= 2) {
          return;
        }
      } else {
        stableSamples = 0;
      }

      previous = snapshot;
    }

    await sleep(80);
  }
}

function getSerializableRect(el) {
  const rect = el.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    throw new Error('滚动后“继续”按钮没有可点击尺寸。URL: ' + location.href);
  }

  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    centerX: rect.left + (rect.width / 2),
    centerY: rect.top + (rect.height / 2),
  };
}

