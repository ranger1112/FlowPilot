// flows/openai/content/openai-auth-step5-profile.js
// Step 5 profile 页面（姓名 + 生日/年龄 + 同意勾选框 + 提交等待）工具。
//
// 历史背景：
//   openai-auth.js monolith 里 step5 相关函数分散在两段：中段 2649-2794 包含 7 个
//   helper（normalizeInlineText / isStep5AllConsentText / findStep5AllConsentCheckbox /
//   isStep5CheckboxChecked / findBirthdayReactAriaSelect / setReactAriaBirthdaySelect /
//   getStep5ErrorText），末段 6145-6920 包含 18 个函数从 getStep5DirectCompletionPayload
//   到 step5_fillNameBirthday。共 25 个函数，约 900 行，都是纯 DOM + React Aria 操作，
//   跟主文件其它段（signup-entry / phone-country / verification / login）无代码耦合。
//
// 设计：
//   - IFE + 工厂模式 + 注入依赖，跟 phone-country-utils / openai-auth-route-recovery /
//     openai-auth-choose-account / openai-auth-signup-phone-country 同款；
//   - 不读 chrome / state，所有 openai-auth.js 中定义、被 step5 函数直接引用的 helper
//     通过参数注入；全局 helper（sleep / humanPause / fillInput / waitForElement /
//     waitForElementByText / log / simulateClick / reportComplete / reportNodeComplete /
//     throwIfStopped）运行在共享 content script 作用域里，无需注入；
//   - STEP5_SUBMIT_ERROR_PATTERN 搬到本模块定义，通过 module 命名空间暴露给主文件复用；
//   - 主文件 openai-auth.js 在现有 wiring 块之后 destructure 出本模块的 API，原所有
//     调用点零修改。
//
// 测试约束：
//   多个 step5 相关 test 文件通过 extractFunction 从 *源代码字符串* 抠出本模块的函数
//   源码 inline 进沙箱，所以 1) 函数体不能依赖闭包外的 module-scope helper；
//   2) 测试文件的 source 字符串需要 concat 来覆盖跨文件引用，本次改造保留所有函数体
//   一字不差，只把它们从主文件搬到这里。

(function attachOpenAIAuthStep5Profile(root, factory) {
  root.MultiPageOpenAIAuthStep5Profile = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createOpenAIAuthStep5ProfileModule() {
  const STEP5_SUBMIT_ERROR_PATTERN = /无法根据该信息创建帐户|请重试|アカウントを作成できません|アカウント作成に失敗|もう一度お試し|問題が発生しました|無効な(?:生年月日|誕生日|日付)|生年月日|誕生日|unable\s+to\s+create\s+(?:your\s+)?account|couldn'?t\s+create\s+(?:your\s+)?account|something\s+went\s+wrong|invalid\s+(?:birthday|birth|date)|生日|出生日期/i;

  function createOpenAIAuthStep5Profile(deps = {}) {
    const {
      isVisibleElement,
      getActionText,
      getOperationDelayRunner,
      isEmailVerificationPage,
      isVerificationPageStillVisible,
      isStep5Ready,
      isSignupProfilePageUrl,
      isStep5CompletionChatgptUrl,
      getSignupAuthRetryPathPatterns,
      getAuthTimeoutErrorPageState,
      getCurrentAuthRetryPageState,
      recoverCurrentAuthRetryPage,
      createSignupUserAlreadyExistsError,
      createAuthMaxCheckAttemptsError,
    } = deps;
    const required = {
      isVisibleElement,
      getActionText,
      getOperationDelayRunner,
      isEmailVerificationPage,
      isVerificationPageStillVisible,
      isStep5Ready,
      isSignupProfilePageUrl,
      isStep5CompletionChatgptUrl,
      getSignupAuthRetryPathPatterns,
      getAuthTimeoutErrorPageState,
      getCurrentAuthRetryPageState,
      recoverCurrentAuthRetryPage,
      createSignupUserAlreadyExistsError,
      createAuthMaxCheckAttemptsError,
    };
    for (const name of Object.keys(required)) {
      if (typeof required[name] !== 'function') {
        throw new Error(`createOpenAIAuthStep5Profile requires ${name} function`);
      }
    }

    function normalizeInlineText(text) {
      return (text || '').replace(/\s+/g, ' ').trim();
    }

    function isStep5AllConsentText(text) {
      const normalizedText = normalizeInlineText(text).toLowerCase();
      if (!normalizedText) return false;

      return /i\s+agree\s+to\s+all\s+of\s+the\s+following/i.test(normalizedText)
        || normalizedText.includes('以下のすべてに同意')
        || normalizedText.includes('すべてに同意')
        || normalizedText.includes('同意します')
        || normalizedText.includes('我同意以下所有各项')
        || normalizedText.includes('同意以下所有各项')
        || normalizedText.includes('我同意所有')
        || normalizedText.includes('全部同意');
    }

    function findStep5AllConsentCheckbox() {
      const namedCandidates = Array.from(document.querySelectorAll('input[name="allCheckboxes"][type="checkbox"]'))
        .filter((el) => {
          const checkboxLabel = el.closest?.('label') || null;
          return isVisibleElement(el) || (checkboxLabel && isVisibleElement(checkboxLabel));
        });

      const namedMatch = namedCandidates.find((el) => {
        const checkboxLabel = el.closest?.('label') || null;
        const checkboxText = normalizeInlineText([
          checkboxLabel?.textContent || '',
          el.getAttribute?.('aria-label') || '',
          el.getAttribute?.('title') || '',
          el.getAttribute?.('name') || '',
        ].filter(Boolean).join(' '));
        return isStep5AllConsentText(checkboxText);
      });
      if (namedMatch) {
        return namedMatch;
      }
      if (namedCandidates.length > 0) {
        return namedCandidates[0];
      }

      return Array.from(document.querySelectorAll('input[type="checkbox"]'))
        .find((el) => {
          const checkboxLabel = el.closest?.('label') || null;
          if (!isVisibleElement(el) && !(checkboxLabel && isVisibleElement(checkboxLabel))) {
            return false;
          }
          const checkboxText = normalizeInlineText([
            checkboxLabel?.textContent || '',
            el.getAttribute?.('aria-label') || '',
            el.getAttribute?.('title') || '',
            el.getAttribute?.('name') || '',
          ].filter(Boolean).join(' '));
          return isStep5AllConsentText(checkboxText);
        }) || null;
    }

    function isStep5CheckboxChecked(checkbox) {
      if (!checkbox) return false;
      if (checkbox.checked === true) return true;

      const ariaChecked = String(
        checkbox.getAttribute?.('aria-checked')
        || checkbox.closest?.('[role="checkbox"]')?.getAttribute?.('aria-checked')
        || ''
      ).toLowerCase();
      return ariaChecked === 'true';
    }

    function findBirthdayReactAriaSelect(labelText) {
      const normalizedLabels = (Array.isArray(labelText) ? labelText : [labelText])
        .map((text) => normalizeInlineText(text))
        .filter(Boolean);
      const roots = document.querySelectorAll('.react-aria-Select');

      for (const root of roots) {
        const labelEl = Array.from(root.querySelectorAll('span')).find((el) => normalizedLabels.includes(normalizeInlineText(el.textContent)));
        if (!labelEl) continue;

        const item = root.closest('[class*="selectItem"], ._selectItem_ppsls_113') || root.parentElement;
        const nativeSelect = item?.querySelector('[data-testid="hidden-select-container"] select') || null;
        const button = root.querySelector('button[aria-haspopup="listbox"]') || null;
        const valueEl = root.querySelector('.react-aria-SelectValue') || null;

        return { root, item, labelEl, nativeSelect, button, valueEl };
      }

      return null;
    }

    async function setReactAriaBirthdaySelect(control, value) {
      if (!control?.nativeSelect) {
        throw new Error('未找到可写入的生日下拉框。');
      }

      const desiredValue = String(value);
      const option = Array.from(control.nativeSelect.options).find((item) => item.value === desiredValue);
      if (!option) {
        throw new Error(`生日下拉框中不存在值 ${desiredValue}。`);
      }

      control.nativeSelect.value = desiredValue;
      option.selected = true;
      control.nativeSelect.dispatchEvent(new Event('input', { bubbles: true }));
      control.nativeSelect.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(120);
    }

    function getStep5ErrorText() {
      const messages = [];
      const selectors = [
        '.react-aria-FieldError',
        '[slot="errorMessage"]',
        '[id$="-error"]',
        '[id$="-errors"]',
        '[role="alert"]',
        '[aria-live="assertive"]',
        '[aria-live="polite"]',
        '[class*="error"]',
      ];

      for (const selector of selectors) {
        document.querySelectorAll(selector).forEach((el) => {
          if (!isVisibleElement(el)) return;
          const text = normalizeInlineText(el.textContent);
          if (text) {
            messages.push(text);
          }
        });
      }

      const invalidField = Array.from(document.querySelectorAll('[aria-invalid="true"], [data-invalid="true"]'))
        .find((el) => isVisibleElement(el));
      if (invalidField) {
        const wrapper = invalidField.closest('form, fieldset, [data-rac], div');
        if (wrapper) {
          const text = normalizeInlineText(wrapper.textContent);
          if (text) {
            messages.push(text);
          }
        }
      }

      return messages.find((text) => STEP5_SUBMIT_ERROR_PATTERN.test(text)) || '';
    }

    function getStep5DirectCompletionPayload({ isAgeMode = false, navigationStarted = false, navigationEventType = '', outcome = null } = {}) {
      const payload = {
        profileSubmitted: true,
        postSubmitChecked: !navigationStarted,
      };
      if (isAgeMode) {
        payload.ageMode = true;
      }
      if (navigationStarted) {
        payload.navigationStarted = true;
        payload.handoffToBackground = true;
        const resolvedNavigationEventType = String(navigationEventType || '').trim();
        if (resolvedNavigationEventType) {
          payload.navigationEventType = resolvedNavigationEventType;
        }
        if (typeof location !== 'undefined' && location?.href) {
          payload.url = location.href;
        }
      }
      if (outcome?.state) {
        payload.postSubmitChecked = true;
        payload.outcome = outcome.state;
      }
      if (outcome?.url) {
        payload.url = outcome.url;
      }
      return payload;
    }

    function isCombinedSignupVerificationProfilePage() {
      if (!isEmailVerificationPage() || !isVerificationPageStillVisible()) {
        return false;
      }

      if (!document.querySelector('form[action*="email-verification/register" i]')) {
        return false;
      }

      const nameInput = document.querySelector('input[name="name"], input[autocomplete="name"]');
      if (!nameInput || !isVisibleElement(nameInput)) {
        return false;
      }

      const ageInput = document.querySelector('input[name="age"]');
      if (ageInput && isVisibleElement(ageInput)) {
        return true;
      }

      const yearSpinner = document.querySelector('[role="spinbutton"][data-type="year"]');
      const monthSpinner = document.querySelector('[role="spinbutton"][data-type="month"]');
      const daySpinner = document.querySelector('[role="spinbutton"][data-type="day"]');
      return Boolean(
        yearSpinner
        && monthSpinner
        && daySpinner
        && isVisibleElement(yearSpinner)
        && isVisibleElement(monthSpinner)
        && isVisibleElement(daySpinner)
      );
    }

    async function waitForCombinedSignupVerificationProfilePage(timeout = 2500) {
      const start = Date.now();

      while (Date.now() - start < timeout) {
        if (isCombinedSignupVerificationProfilePage()) {
          return true;
        }
        await sleep(100);
      }

      return isCombinedSignupVerificationProfilePage();
    }

    function getStep5ProfilePathPatterns() {
      return [
        /\/create-account\/profile(?:[/?#]|$)/i,
        /\/u\/signup\/profile(?:[/?#]|$)/i,
        /\/signup\/profile(?:[/?#]|$)/i,
        /\/about-you(?:[/?#]|$)/i,
      ];
    }

    function getStep5AuthRetryPathPatterns() {
      const signupPatterns = typeof getSignupAuthRetryPathPatterns === 'function'
        ? getSignupAuthRetryPathPatterns()
        : [];
      return [
        ...signupPatterns,
        ...getStep5ProfilePathPatterns(),
      ];
    }

    function isStep5ProfilePageUrl(rawUrl = location.href) {
      return isSignupProfilePageUrl(rawUrl);
    }

    function getStep5AuthRetryPageState() {
      if (typeof getAuthTimeoutErrorPageState === 'function') {
        return getAuthTimeoutErrorPageState({
          pathPatterns: getStep5AuthRetryPathPatterns(),
        });
      }

      if (typeof getCurrentAuthRetryPageState === 'function') {
        return getCurrentAuthRetryPageState('signup');
      }

      return null;
    }

    function getStep5SubmitButton() {
      const direct = document.querySelector('button[type="submit"], input[type="submit"]');
      if (direct && isVisibleElement(direct)) {
        return direct;
      }

      const candidates = document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]');
      return Array.from(candidates).find((el) => {
        if (!isVisibleElement(el)) return false;
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
        return /完成|创建|create|continue|finish|done|agree|完了|作成|アカウント作成|アカウントを作成|続行|続ける|次へ|同意/i.test(text);
      }) || null;
    }

    async function waitForStep5SubmitButton(timeout = 5000) {
      const start = Date.now();

      while (Date.now() - start < timeout) {
        throwIfStopped();
        const button = getStep5SubmitButton();
        if (button) {
          return button;
        }
        await sleep(150);
      }

      return null;
    }

    function isStep5SubmitButtonClickable(button) {
      if (
        !button
        || !isVisibleElement(button)
        || button.disabled
        || button.getAttribute?.('aria-disabled') === 'true'
      ) {
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

      const pendingAncestor = button.closest?.([
        '[aria-busy="true"]',
        '[data-loading="true"]',
        '[data-pending="true"]',
        '[data-submitting="true"]',
        '[data-state="loading"]',
        '[data-state="pending"]',
        '[data-state="submitting"]',
      ].join(', '));
      if (pendingAncestor) {
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
    }

    function isStep5ProfileStillVisible() {
      if (isStep5ProfilePageUrl()) {
        return true;
      }

      return typeof isStep5Ready === 'function' ? isStep5Ready() : false;
    }

    function getStep5PostSubmitSuccessState() {
      if (getStep5AuthRetryPageState()) {
        return null;
      }

      if (isStep5CompletionChatgptUrl()) {
        return {
          state: 'logged_in_home',
          url: location.href,
        };
      }

      return null;
    }

    function getStep5SubmitState() {
      const retryState = getStep5AuthRetryPageState();
      const successState = getStep5PostSubmitSuccessState();
      const errorText = typeof getStep5ErrorText === 'function' ? getStep5ErrorText() : '';
      let signupAuthHost = false;
      try {
        const parsed = new URL(String(location.href || '').trim());
        signupAuthHost = ['auth.openai.com', 'auth0.openai.com', 'accounts.openai.com']
          .includes(String(parsed.hostname || '').toLowerCase());
      } catch {
        signupAuthHost = false;
      }

      return {
        url: location.href,
        retryPage: Boolean(retryState),
        retryEnabled: Boolean(retryState?.retryEnabled),
        maxCheckAttemptsBlocked: Boolean(retryState?.maxCheckAttemptsBlocked),
        userAlreadyExistsBlocked: Boolean(retryState?.userAlreadyExistsBlocked),
        successState: successState?.state || '',
        profileVisible: isStep5ProfileStillVisible(),
        errorText,
        unknownAuthPage: Boolean(
          signupAuthHost
          && !retryState
          && !successState
          && !isStep5ProfileStillVisible()
        ),
      };
    }

    function logStep5SubmitDebug(message, options = {}) {
      const resolvedState = options?.state && typeof options.state === 'object'
        ? options.state
        : getStep5SubmitState();
      const summary = [
        `url=${resolvedState?.url || location.href}`,
        `retryPage=${Boolean(resolvedState?.retryPage)}`,
        `retryEnabled=${Boolean(resolvedState?.retryEnabled)}`,
        `successState=${resolvedState?.successState || 'none'}`,
        `profileVisible=${Boolean(resolvedState?.profileVisible)}`,
        `unknownAuthPage=${Boolean(resolvedState?.unknownAuthPage)}`,
        `maxCheckAttemptsBlocked=${Boolean(resolvedState?.maxCheckAttemptsBlocked)}`,
        `userAlreadyExistsBlocked=${Boolean(resolvedState?.userAlreadyExistsBlocked)}`,
        resolvedState?.errorText ? `errorText=${resolvedState.errorText}` : null,
      ]
        .filter(Boolean)
        .join(' | ');
      log(`步骤 5 [调试] ${message} | ${summary}`, options?.level || 'info', {
        step: 5,
        stepKey: 'fill-profile',
      });
    }

    async function recoverStep5SubmitRetryPage(payload = {}) {
      return recoverCurrentAuthRetryPage({
        ...payload,
        flow: 'signup',
        logLabel: payload?.logLabel || '步骤 5：资料提交后检测到认证重试页，正在点击"重试"恢复',
        maxClickAttempts: payload?.maxClickAttempts ?? 2,
        pathPatterns: Array.isArray(payload?.pathPatterns) ? payload.pathPatterns : getStep5AuthRetryPathPatterns(),
        step: 5,
        timeoutMs: payload?.timeoutMs ?? 12000,
      });
    }

    function installStep5NavigationCompletionReporter(completeOnce) {
      if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
        return () => {};
      }
      let reportedNavigation = false;
      const debugLog = typeof logStep5SubmitDebug === 'function'
        ? logStep5SubmitDebug
        : (message, options = {}) => {
            if (typeof log === 'function') {
              log(`步骤 5 [调试] ${message}`, options?.level || 'info', {
                step: 5,
                stepKey: 'fill-profile',
              });
            }
          };

      const onNavigationStarted = (event) => {
        const eventType = String(event?.type || 'navigation').trim() || 'navigation';
        if (reportedNavigation) {
          return;
        }
        reportedNavigation = true;
        if (typeof completeOnce === 'function') {
          try {
            completeOnce({
              navigationStarted: true,
              navigationEventType: eventType,
            });
          } catch (error) {
            if (typeof log === 'function') {
              log(`步骤 5 [调试] 导航交棒信号发送失败：${error?.message || error}`, 'warn', {
                step: 5,
                stepKey: 'fill-profile',
              });
            }
          }
        }
        debugLog(`检测到页面开始导航（event=${eventType}）。`, {
          level: 'warn',
        });
      };

      window.addEventListener('pagehide', onNavigationStarted, { once: true });
      window.addEventListener('beforeunload', onNavigationStarted, { once: true });

      return () => {
        window.removeEventListener('pagehide', onNavigationStarted);
        window.removeEventListener('beforeunload', onNavigationStarted);
      };
    }

    async function waitForStep5SubmitOutcome(options = {}) {
      const debugLog = typeof logStep5SubmitDebug === 'function'
        ? logStep5SubmitDebug
        : (message, logOptions = {}) => {
            if (typeof log === 'function') {
              log(`步骤 5 [调试] ${message}`, logOptions?.level || 'info', {
                step: 5,
                stepKey: 'fill-profile',
              });
            }
          };
      const {
        timeoutMs = 120000,
        maxAuthRetryRecoveries = 2,
        maxSubmitClicks = 3,
        retryClickIntervalMs = 3500,
      } = options;
      const start = Date.now();
      let authRetryRecoveryCount = 0;
      let submitClickCount = 1;
      let lastSubmitClickAt = Date.now();
      let lastStep5Error = '';

      while (Date.now() - start < timeoutMs) {
        throwIfStopped();

        const retryState = getStep5AuthRetryPageState();
        if (retryState?.userAlreadyExistsBlocked) {
          throw createSignupUserAlreadyExistsError();
        }
        if (retryState?.maxCheckAttemptsBlocked) {
          throw createAuthMaxCheckAttemptsError();
        }
        if (retryState) {
          if (authRetryRecoveryCount >= maxAuthRetryRecoveries) {
            throw new Error(`步骤 5：资料提交后连续进入认证重试页 ${maxAuthRetryRecoveries} 次，页面仍未恢复。URL: ${location.href}`);
          }
          authRetryRecoveryCount += 1;
          debugLog(`检测到资料提交后的认证重试页，准备执行恢复（${authRetryRecoveryCount}/${maxAuthRetryRecoveries}）。`, {
            level: 'warn',
          });
          log(`步骤 5：资料提交后进入认证重试页，正在自动恢复（${authRetryRecoveryCount}/${maxAuthRetryRecoveries}）...`, 'warn');
          await recoverCurrentAuthRetryPage({
            flow: 'signup',
            logLabel: '步骤 5：资料提交后检测到认证重试页，正在点击"重试"恢复',
            maxClickAttempts: 2,
            pathPatterns: getStep5AuthRetryPathPatterns(),
            step: 5,
            timeoutMs: 12000,
          });
          debugLog('认证重试页恢复动作已完成，准备继续等待最终结果。', {
            level: 'info',
          });
          lastSubmitClickAt = Date.now();
          continue;
        }

        const successState = getStep5PostSubmitSuccessState();
        if (successState) {
          debugLog(`检测到资料提交成功状态：${successState.state || 'unknown'}`, {
            level: 'ok',
          });
          return successState;
        }

        const step5Error = typeof getStep5ErrorText === 'function' ? getStep5ErrorText() : '';
        if (step5Error) {
          lastStep5Error = step5Error;
        }

        if (
          isStep5ProfileStillVisible()
          && submitClickCount < maxSubmitClicks
          && Date.now() - lastSubmitClickAt >= retryClickIntervalMs
        ) {
          const submitButton = getStep5SubmitButton();
          if (isStep5SubmitButtonClickable(submitButton)) {
            submitClickCount += 1;
            log(`步骤 5：资料提交后仍停留在资料页，正在重新点击"完成帐户创建"（第 ${submitClickCount}/${maxSubmitClicks} 次）...`, 'warn');
            await humanPause(350, 900);
            simulateClick(submitButton);
            lastSubmitClickAt = Date.now();
            await sleep(1000);
            continue;
          }
        }

        await sleep(250);
      }

      const finalRetryState = getStep5AuthRetryPageState();
      if (finalRetryState?.userAlreadyExistsBlocked) {
        throw createSignupUserAlreadyExistsError();
      }
      if (finalRetryState?.maxCheckAttemptsBlocked) {
        throw createAuthMaxCheckAttemptsError();
      }
      if (finalRetryState) {
        throw new Error(`步骤 5：资料提交后仍停留在认证重试页，自动恢复未完成。URL: ${location.href}`);
      }

      const finalSuccessState = getStep5PostSubmitSuccessState();
      if (finalSuccessState) {
        return finalSuccessState;
      }

      const finalStep5Error = (typeof getStep5ErrorText === 'function' ? getStep5ErrorText() : '') || lastStep5Error;
      if (finalStep5Error) {
        throw new Error(`步骤 5：资料提交后页面返回错误：${finalStep5Error}。URL: ${location.href}`);
      }

      throw new Error(`步骤 5：资料提交后未检测到页面跳转或恢复成功（已点击提交 ${submitClickCount}/${maxSubmitClicks} 次）。URL: ${location.href}`);
    }

    async function step5_fillNameBirthday(payload) {
      const { firstName, lastName, age, year, month, day, prefillOnly = false } = payload;
      if (!firstName || !lastName) throw new Error('未提供姓名数据。');
      const performOperationWithDelay = typeof getOperationDelayRunner === 'function'
        ? getOperationDelayRunner()
        : async (metadata, operation) => {
            const rootScope = typeof window !== 'undefined' ? window : globalThis;
            const gate = rootScope?.CodexOperationDelay?.performOperationWithDelay;
            return typeof gate === 'function' ? gate(metadata, operation) : operation();
          };

      const resolvedAge = age ?? (year ? new Date().getFullYear() - Number(year) : null);
      const hasBirthdayData = [year, month, day].every(value => value != null && !Number.isNaN(Number(value)));
      if (!hasBirthdayData && (resolvedAge == null || Number.isNaN(Number(resolvedAge)))) {
        throw new Error('未提供生日或年龄数据。');
      }

      const fullName = `${firstName} ${lastName}`;
      log(`步骤 5：正在填写姓名：${fullName}`);

      // Actual DOM structure:
      // - Full name: <input name="name" placeholder="全名" type="text">
      // - Birthday: React Aria DateField or hidden input[name="birthday"]
      // - Age: <input name="age" type="text|number">

      // --- Full Name (single field, not first+last) ---
      let nameInput = null;
      try {
        nameInput = await waitForElement(
          'input[name="name"], input[placeholder*="全名"], input[placeholder*="氏名"], input[placeholder*="名前"], input[placeholder*="お名前"], input[autocomplete="name"]',
          10000
        );
      } catch {
        throw new Error('未找到姓名输入框。URL: ' + location.href);
      }
      await humanPause(500, 1300);
      await performOperationWithDelay({ stepKey: 'fill-profile', kind: 'fill', label: 'fill-name' }, async () => {
        fillInput(nameInput, fullName);
      });
      log(`步骤 5：姓名已填写：${fullName}`);

      let birthdayMode = false;
      let ageInput = null;
      let yearSpinner = null;
      let monthSpinner = null;
      let daySpinner = null;
      let hiddenBirthday = null;
      let yearReactSelect = null;
      let monthReactSelect = null;
      let dayReactSelect = null;
      let visibleAgeInput = false;
      let visibleBirthdaySpinners = false;
      let visibleBirthdaySelects = false;
      const findBirthdaySelect = (...labels) => labels
        .map((label) => findBirthdayReactAriaSelect(label))
        .find(Boolean) || null;

      for (let i = 0; i < 100; i++) {
        yearSpinner = document.querySelector('[role="spinbutton"][data-type="year"]');
        monthSpinner = document.querySelector('[role="spinbutton"][data-type="month"]');
        daySpinner = document.querySelector('[role="spinbutton"][data-type="day"]');
        hiddenBirthday = document.querySelector('input[name="birthday"]');
        ageInput = document.querySelector('input[name="age"]');
        yearReactSelect = findBirthdaySelect('年', 'Year');
        monthReactSelect = findBirthdaySelect('月', 'Month');
        dayReactSelect = findBirthdaySelect('天', '日', 'Day');

        visibleAgeInput = Boolean(ageInput && isVisibleElement(ageInput));
        visibleBirthdaySpinners = Boolean(
          yearSpinner
          && monthSpinner
          && daySpinner
          && isVisibleElement(yearSpinner)
          && isVisibleElement(monthSpinner)
          && isVisibleElement(daySpinner)
        );
        visibleBirthdaySelects = Boolean(
          yearReactSelect?.button
          && monthReactSelect?.button
          && dayReactSelect?.button
          && isVisibleElement(yearReactSelect.button)
          && isVisibleElement(monthReactSelect.button)
          && isVisibleElement(dayReactSelect.button)
        );

        if (visibleAgeInput) break;
        if (visibleBirthdaySpinners || visibleBirthdaySelects) {
          birthdayMode = true;
          break;
        }
        await sleep(100);
      }

      if (birthdayMode) {
        if (!hasBirthdayData) {
          throw new Error('检测到生日字段，但未提供生日数据。');
        }

        const yearSpinner = document.querySelector('[role="spinbutton"][data-type="year"]');
        const monthSpinner = document.querySelector('[role="spinbutton"][data-type="month"]');
        const daySpinner = document.querySelector('[role="spinbutton"][data-type="day"]');
        const yearReactSelect = findBirthdaySelect('年', 'Year');
        const monthReactSelect = findBirthdaySelect('月', 'Month');
        const dayReactSelect = findBirthdaySelect('天', '日', 'Day');

        if (yearReactSelect?.nativeSelect && monthReactSelect?.nativeSelect && dayReactSelect?.nativeSelect) {
          const desiredDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const hiddenBirthday = document.querySelector('input[name="birthday"]');

          log('步骤 5：检测到 React Aria 下拉生日字段，正在填写生日...');
          await humanPause(450, 1100);
          await performOperationWithDelay({ stepKey: 'fill-profile', kind: 'select', label: 'select-birthday-year' }, async () => {
            await setReactAriaBirthdaySelect(yearReactSelect, year);
          });
          await humanPause(250, 650);
          await performOperationWithDelay({ stepKey: 'fill-profile', kind: 'select', label: 'select-birthday-month' }, async () => {
            await setReactAriaBirthdaySelect(monthReactSelect, month);
          });
          await humanPause(250, 650);
          await performOperationWithDelay({ stepKey: 'fill-profile', kind: 'select', label: 'select-birthday-day' }, async () => {
            await setReactAriaBirthdaySelect(dayReactSelect, day);
          });

          if (hiddenBirthday) {
            const start = Date.now();
            while (Date.now() - start < 2000) {
              if ((hiddenBirthday.value || '') === desiredDate) break;
              await sleep(100);
            }

            if ((hiddenBirthday.value || '') !== desiredDate) {
              throw new Error(`生日值未成功写入页面。期望 ${desiredDate}，实际 ${(hiddenBirthday.value || '空')}。`);
            }
          }

          log(`步骤 5：React Aria 生日已填写：${desiredDate}`);
        }

        if (yearSpinner && monthSpinner && daySpinner) {
          log('步骤 5：检测到生日字段，正在填写生日...');

          async function setSpinButton(el, value) {
            el.focus();
            await sleep(100);
            document.execCommand('selectAll', false, null);
            await sleep(50);

            const valueStr = String(value);
            for (const char of valueStr) {
              el.dispatchEvent(new KeyboardEvent('keydown', { key: char, code: `Digit${char}`, bubbles: true }));
              el.dispatchEvent(new KeyboardEvent('keypress', { key: char, code: `Digit${char}`, bubbles: true }));
              el.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: char, bubbles: true }));
              el.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: char, bubbles: true }));
              await sleep(50);
            }

            el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Tab', code: 'Tab', bubbles: true }));
            el.blur();
            await sleep(100);
          }

          await humanPause(450, 1100);
          await performOperationWithDelay({ stepKey: 'fill-profile', kind: 'fill', label: 'fill-birthday-year' }, async () => {
            await setSpinButton(yearSpinner, year);
          });
          await humanPause(250, 650);
          await performOperationWithDelay({ stepKey: 'fill-profile', kind: 'fill', label: 'fill-birthday-month' }, async () => {
            await setSpinButton(monthSpinner, String(month).padStart(2, '0'));
          });
          await humanPause(250, 650);
          await performOperationWithDelay({ stepKey: 'fill-profile', kind: 'fill', label: 'fill-birthday-day' }, async () => {
            await setSpinButton(daySpinner, String(day).padStart(2, '0'));
          });
          log(`步骤 5：生日已填写：${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
        }

        const hiddenBirthday = document.querySelector('input[name="birthday"]');
        if (hiddenBirthday) {
          const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          await performOperationWithDelay({ stepKey: 'fill-profile', kind: 'hidden-sync', label: 'profile-dom-sync' }, async () => {
            hiddenBirthday.value = dateStr;
            hiddenBirthday.dispatchEvent(new Event('input', { bubbles: true }));
            hiddenBirthday.dispatchEvent(new Event('change', { bubbles: true }));
          });
          log(`步骤 5：已设置隐藏生日输入框：${dateStr}`);
        }
      } else if (ageInput) {
        if (resolvedAge == null || Number.isNaN(Number(resolvedAge))) {
          throw new Error('检测到年龄字段，但未提供年龄数据。');
        }
        await humanPause(500, 1300);
        await performOperationWithDelay({ stepKey: 'fill-profile', kind: 'fill', label: 'fill-birthday' }, async () => {
          fillInput(ageInput, String(resolvedAge));
        });
        log(`步骤 5：年龄已填写：${resolvedAge}`);
      } else {
        throw new Error('未找到生日或年龄输入项。URL: ' + location.href);
      }
      // 韩国IP判断勾选框""I agree"
      const allConsentCheckbox = findStep5AllConsentCheckbox();

      if (allConsentCheckbox) {
        if (!isStep5CheckboxChecked(allConsentCheckbox)) {
          const checkboxLabel = allConsentCheckbox.closest('label');
          await humanPause(500, 1500);
          await performOperationWithDelay({ stepKey: 'fill-profile', kind: 'click', label: 'accept-profile-consent' }, async () => {
            if (checkboxLabel && isVisibleElement(checkboxLabel)) {
              simulateClick(checkboxLabel);
            } else {
              simulateClick(allConsentCheckbox);
            }
          });
          await sleep(250);

          if (!isStep5CheckboxChecked(allConsentCheckbox)) {
            await performOperationWithDelay({ stepKey: 'fill-profile', kind: 'click', label: 'accept-profile-consent-fallback' }, async () => {
              allConsentCheckbox.click();
            });
            await sleep(250);
          }

          if (!isStep5CheckboxChecked(allConsentCheckbox)) {
            throw new Error('未能勾选 "I agree to all of the following" 复选框。');
          }

          log('步骤 5：已勾选 "I agree to all of the following"。');
        } else {
          log('步骤 5："I agree to all of the following" 已勾选，跳过。');
        }
      }


      if (prefillOnly) {
        log('步骤 4：混合注册页资料已预填，继续填写验证码。', 'info');
        return { prefilled: true };
      }

      // Click "完成帐户创建" button
      await sleep(500);
      const completeBtn = await waitForStep5SubmitButton(5000)
        || await waitForElementByText('button', /完成|完了|作成|アカウント作成|アカウントを作成|続行|続ける|次へ|同意|create|continue|finish|done|agree/i, 5000).catch(() => null);
      if (!completeBtn) {
        throw new Error('未找到"完成帐户创建"按钮。URL: ' + location.href);
      }

      const isAgeMode = !birthdayMode && Boolean(ageInput);
      if (isAgeMode) {
        log('步骤 5：当前为年龄输入模式，点击"完成帐户创建"后将等待页面结果。', 'info');
      }

      let reportedCompletionPayload = null;
      const debugLog = typeof logStep5SubmitDebug === 'function'
        ? logStep5SubmitDebug
        : (message, logOptions = {}) => {
            if (typeof log === 'function') {
              log(`步骤 5 [调试] ${message}`, logOptions?.level || 'info', {
                step: 5,
                stepKey: 'fill-profile',
              });
            }
          };
      function completeStep5Once(extra = {}) {
        const completionReason = extra?.outcome?.state
          || (extra?.navigationStarted ? `navigation_started:${extra?.navigationEventType || 'unknown'}` : 'direct_completion');
        if (reportedCompletionPayload) {
          debugLog(`忽略重复完成信号（reason=${completionReason}）。`, {
            level: 'warn',
          });
          return reportedCompletionPayload;
        }

        const completionPayload = getStep5DirectCompletionPayload({
          isAgeMode,
          navigationStarted: Boolean(extra.navigationStarted),
          navigationEventType: extra.navigationEventType || '',
          outcome: extra.outcome || null,
        });
        reportedCompletionPayload = completionPayload;
        if (extra?.navigationStarted && typeof reportNodeComplete === 'function') {
          reportNodeComplete('fill-profile', completionPayload);
        } else {
          reportComplete(5, completionPayload);
        }
        debugLog(`准备发送完成信号（reason=${completionReason}，isAgeMode=${isAgeMode}）。`, {
          level: extra?.navigationStarted ? 'warn' : 'info',
        });
        return completionPayload;
      }

      const cleanupNavigationReporter = installStep5NavigationCompletionReporter(completeStep5Once);

      await humanPause(500, 1300);
      await performOperationWithDelay({ stepKey: 'fill-profile', kind: 'submit', label: 'submit-profile' }, async () => {
        simulateClick(completeBtn);
      });
      log('步骤 5：已点击"完成帐户创建"，正在等待页面跳转、重试页或提交结果。');

      try {
        const outcome = await waitForStep5SubmitOutcome();
        cleanupNavigationReporter();

        const completionPayload = completeStep5Once({ outcome });
        log(`步骤 5：资料提交结果已确认（${outcome.state || 'success'}），准备继续后续步骤。`, 'ok');
        return completionPayload;
      } catch (error) {
        cleanupNavigationReporter();
        throw error;
      }
    }

    return {
      // constants (also exposed at module top-level for early-binding consumers)
      STEP5_SUBMIT_ERROR_PATTERN,
      // helpers
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
    };
  }

  return {
    STEP5_SUBMIT_ERROR_PATTERN,
    createOpenAIAuthStep5Profile,
  };
});
