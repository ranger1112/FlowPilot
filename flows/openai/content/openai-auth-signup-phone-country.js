// flows/openai/content/openai-auth-signup-phone-country.js
// Signup-phase phone-country select / listbox 操作工具。
//
// 历史背景：
//   openai-auth.js monolith 里塞了一组围绕注册手机号区号的 helper：12 个
//   phone-country-utils 薄壳 thunk + 20 个 select / button / listbox / sync 探查与点击
//   逻辑（共 32 个函数，~560 行），跟主文件其它职责（auth-state / signup-entry / 路由
//   恢复）无耦合，纯粹是手机区号选择器的 page-level 工具。和 #4 已完成的 route-recovery /
//   choose-account 同款，独立成 module 之后主文件能再瘦一圈。
//
// 设计：
//   - IFE + 工厂模式 + 注入依赖，跟 phone-country-utils / openai-auth-route-recovery /
//     openai-auth-choose-account 同款；
//   - 不读 chrome / state，所有依赖（getSignupPhoneInput / isVisibleElement /
//     getActionText / getPageTextSnapshot / sleep / simulateClick / throwIfStopped /
//     getOperationDelayRunner）通过参数注入；
//   - 主文件 openai-auth.js 在 authPageRecovery / chooseAccount 之后 destructure
//     出本模块的 32 个 helper，原所有调用点零修改；
//   - 跟 phone-country-utils 的关系：本模块 11 个 thunk 仍然薄壳化代理给
//     self.MultiPagePhoneCountryUtils，保持 C1 的语义（phone-country-utils 必须先于
//     本模块在 manifest 中加载，然后本模块再被 openai-auth.js 加载之前注入完毕）。
//
// 测试约束：
//   tests/signup-step2-email-switch.test.js 与 tests/step7-phone-login-entry.test.js
//   通过 extractFunction 从 *源代码字符串* 抠出本模块所有 32 个 helper 的源码 inline 进沙箱，
//   所以 1) 函数体不能依赖闭包外的 module-scope helper；2) 测试文件的 source 字符串
//   需要 concat 两个文件来覆盖跨文件引用，本次改造保留所有函数体一字不差，
//   只把它们从主文件搬到这里。

(function attachOpenAIAuthSignupPhoneCountry(root, factory) {
  root.MultiPageOpenAIAuthSignupPhoneCountry = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createOpenAIAuthSignupPhoneCountryModule() {
  function createOpenAIAuthSignupPhoneCountry(deps = {}) {
    const {
      getSignupPhoneInput,
      isVisibleElement,
      getActionText,
      getPageTextSnapshot,
      sleep,
      simulateClick,
      throwIfStopped,
      getOperationDelayRunner,
    } = deps;
    const required = {
      getSignupPhoneInput,
      isVisibleElement,
      getActionText,
      getPageTextSnapshot,
      sleep,
      simulateClick,
      throwIfStopped,
      getOperationDelayRunner,
    };
    for (const name of Object.keys(required)) {
      if (typeof required[name] !== 'function') {
        throw new Error(`createOpenAIAuthSignupPhoneCountry requires ${name} function`);
      }
    }

    function normalizePhoneDigits(value) {
      const phoneCountryUtils = (typeof self !== 'undefined' ? self : globalThis)?.MultiPagePhoneCountryUtils
        || globalThis?.MultiPagePhoneCountryUtils;
      return phoneCountryUtils.normalizePhoneDigits(value);
    }

    function extractDialCodeFromText(value) {
      const phoneCountryUtils = (typeof self !== 'undefined' ? self : globalThis)?.MultiPagePhoneCountryUtils
        || globalThis?.MultiPagePhoneCountryUtils;
      return phoneCountryUtils.extractDialCodeFromText(value);
    }

    function dispatchSignupPhoneFieldEvents(element) {
      if (!element) return;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function normalizeSignupCountryLabel(value) {
      const phoneCountryUtils = (typeof self !== 'undefined' ? self : globalThis)?.MultiPagePhoneCountryUtils
        || globalThis?.MultiPagePhoneCountryUtils;
      return phoneCountryUtils.normalizeCountryLabel(value);
    }

    function getSignupCountryLabelAliases(value) {
      const phoneCountryUtils = (typeof self !== 'undefined' ? self : globalThis)?.MultiPagePhoneCountryUtils
        || globalThis?.MultiPagePhoneCountryUtils;
      return phoneCountryUtils.getCountryLabelAliases(value);
    }

    function getSignupPhoneOptionLabel(option) {
      const phoneCountryUtils = (typeof self !== 'undefined' ? self : globalThis)?.MultiPagePhoneCountryUtils
        || globalThis?.MultiPagePhoneCountryUtils;
      return phoneCountryUtils.getOptionLabel(option);
    }

    function normalizeSignupCountryOptionValue(value) {
      const phoneCountryUtils = (typeof self !== 'undefined' ? self : globalThis)?.MultiPagePhoneCountryUtils
        || globalThis?.MultiPagePhoneCountryUtils;
      return phoneCountryUtils.normalizeCountryOptionValue(value);
    }

    function getSignupRegionDisplayName(regionCode, locale) {
      const phoneCountryUtils = (typeof self !== 'undefined' ? self : globalThis)?.MultiPagePhoneCountryUtils
        || globalThis?.MultiPagePhoneCountryUtils;
      return phoneCountryUtils.getRegionDisplayName(regionCode, locale);
    }

    function getSignupPhoneCountryMatchLabels(option) {
      const phoneCountryUtils = (typeof self !== 'undefined' ? self : globalThis)?.MultiPagePhoneCountryUtils
        || globalThis?.MultiPagePhoneCountryUtils;
      const rootScope = typeof self !== 'undefined' ? self : globalThis;
      return phoneCountryUtils.getOptionMatchLabels(option, {
        document: typeof document !== 'undefined' ? document : null,
        navigator: rootScope?.navigator || globalThis?.navigator || null,
        getOptionLabel: getSignupPhoneOptionLabel,
      });
    }

    function isSameSignupCountryOption(left, right) {
      if (!left || !right) {
        return false;
      }

      const leftValue = normalizeSignupCountryOptionValue(left.value);
      const rightValue = normalizeSignupCountryOptionValue(right.value);
      if (leftValue && rightValue) {
        return leftValue === rightValue;
      }

      return normalizeSignupCountryLabel(getSignupPhoneOptionLabel(left)) === normalizeSignupCountryLabel(getSignupPhoneOptionLabel(right));
    }

    function getSignupPhoneForm(phoneInput = getSignupPhoneInput()) {
      return phoneInput?.closest?.('form') || null;
    }

    function getSignupPhoneControlRoots(phoneInput = getSignupPhoneInput()) {
      const roots = [];
      const addRoot = (root) => {
        if (root && !roots.includes(root)) {
          roots.push(root);
        }
      };

      addRoot(phoneInput?.closest?.('form'));
      addRoot(phoneInput?.closest?.('fieldset'));
      addRoot(phoneInput?.closest?.('[data-rac]'));
      addRoot(phoneInput?.closest?.('[role="group"]'));
      addRoot(phoneInput?.parentElement);
      addRoot(phoneInput?.parentElement?.parentElement);
      addRoot(document);

      return roots;
    }

    function querySignupPhoneCountryElements(root, selector) {
      if (!root || !selector) {
        return [];
      }
      if (typeof root.querySelectorAll === 'function') {
        const directMatches = Array.from(root.querySelectorAll(selector));
        if (directMatches.length > 0) {
          return directMatches;
        }
      }
      if (typeof root.querySelector === 'function') {
        const selectors = String(selector || '')
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean);
        const matches = [];
        for (const part of selectors) {
          const element = root.querySelector(part);
          if (element && !matches.includes(element)) {
            matches.push(element);
          }
        }
        return matches;
      }
      return [];
    }

    function isSignupPhoneCountrySelect(select) {
      if (!select) {
        return false;
      }
      return Array.from(select.options || []).some((option) => (
        extractDialCodeFromText(getSignupPhoneOptionLabel(option))
        || /^[A-Z]{2}$/.test(normalizeSignupCountryOptionValue(option?.value))
      ));
    }

    function getSignupPhoneCountrySelect(phoneInput = getSignupPhoneInput()) {
      const selects = [];
      for (const root of getSignupPhoneControlRoots(phoneInput)) {
        for (const select of querySignupPhoneCountryElements(root, 'select')) {
          if (!selects.includes(select)) {
            selects.push(select);
          }
        }
      }
      return selects.find(isSignupPhoneCountrySelect) || selects[0] || null;
    }

    function getSignupPhoneSelectedCountryOption(phoneInput = getSignupPhoneInput()) {
      const select = getSignupPhoneCountrySelect(phoneInput);
      if (!select || select.selectedIndex < 0) {
        return null;
      }
      return select.options?.[select.selectedIndex] || null;
    }

    function getSignupPhoneCountryButtonText(phoneInput = getSignupPhoneInput()) {
      const button = getSignupPhoneCountryButton(phoneInput);
      if (!button) return '';
      const valueNode = button.querySelector('.react-aria-SelectValue');
      return String(valueNode?.textContent || button.textContent || '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function getSignupPhoneCountryButton(phoneInput = getSignupPhoneInput()) {
      const candidates = [];
      for (const root of getSignupPhoneControlRoots(phoneInput)) {
        const buttons = querySignupPhoneCountryElements(
          root,
          'button[aria-haspopup="listbox"], [role="button"][aria-haspopup="listbox"], [role="combobox"][aria-haspopup="listbox"], button[aria-expanded]'
        );
        for (const button of buttons) {
          if (!candidates.includes(button)) {
            candidates.push(button);
          }
        }
      }
      return candidates.find((button) => isVisibleElement(button) && extractDialCodeFromText(getActionText(button)))
        || candidates.find(isVisibleElement)
        || null;
    }

    function getSignupPhoneDisplayedDialCode(phoneInput = getSignupPhoneInput()) {
      const buttonDialCode = extractDialCodeFromText(getSignupPhoneCountryButtonText(phoneInput));
      if (buttonDialCode) {
        return buttonDialCode;
      }
      const inputRoot = phoneInput?.closest?.('fieldset, form, [data-rac], div') || document;
      const visibleText = String(inputRoot?.textContent || '').replace(/\s+/g, ' ').trim();
      const rootDialCode = extractDialCodeFromText(visibleText);
      if (rootDialCode) {
        return rootDialCode;
      }
      const pageDialCode = extractDialCodeFromText(getPageTextSnapshot());
      if (pageDialCode) {
        return pageDialCode;
      }
      return '';
    }

    function getSignupPhoneHiddenNumberInput(phoneInput = getSignupPhoneInput()) {
      const form = getSignupPhoneForm(phoneInput);
      if (!form || typeof form.querySelector !== 'function') {
        return null;
      }
      return form.querySelector('input[name="phoneNumber"]');
    }

    function resolveSignupPhoneDialCodeFromNumber(phoneNumber = '', texts = []) {
      const phoneCountryUtils = (typeof self !== 'undefined' ? self : globalThis)?.MultiPagePhoneCountryUtils
        || globalThis?.MultiPagePhoneCountryUtils;
      return phoneCountryUtils.resolveDialCodeFromPhoneNumber(phoneNumber, texts);
    }

    function resolveSignupPhoneTargetDialCode(options = {}, targetOption = null) {
      const optionDialCode = extractDialCodeFromText(getSignupPhoneOptionLabel(targetOption));
      if (optionDialCode) {
        return optionDialCode;
      }

      const countryText = String(options.countryLabel || '').trim();
      if (/australia|澳大利亚/i.test(countryText)) return '61';
      if (/thailand|泰国/i.test(countryText)) return '66';
      if (/vietnam|越南/i.test(countryText)) return '84';
      if (/england|united\s*kingdom|great\s*britain|\bbritain\b|英国|英格兰|uk|gb/i.test(countryText)) return '44';

      return resolveSignupPhoneDialCodeFromNumber(options.phoneNumber);
    }

    function getSignupPhoneCountryTargetLabels(targetOption, options = {}) {
      const labels = new Set();
      const addLabel = (value) => {
        getSignupCountryLabelAliases(value).forEach((alias) => labels.add(alias));
      };

      addLabel(options.countryLabel);
      if (targetOption) {
        getSignupPhoneCountryMatchLabels(targetOption).forEach(addLabel);
      }

      return Array.from(labels);
    }

    function doesSignupPhoneCountryTextMatchTarget(text, targetOption, options = {}) {
      const normalizedText = normalizeSignupCountryLabel(text);
      if (!normalizedText) {
        return false;
      }

      const labels = getSignupPhoneCountryTargetLabels(targetOption, options);
      if (labels.some((label) => (
        label
        && (
          normalizedText === label
          || (label.length > 1 && normalizedText.includes(label))
          || (normalizedText.length > 2 && label.includes(normalizedText))
        )
      ))) {
        return true;
      }

      const targetDialCode = resolveSignupPhoneTargetDialCode(options, targetOption);
      return Boolean(targetDialCode && extractDialCodeFromText(text) === targetDialCode);
    }

    function isSignupPhoneCountrySelectionSynced(phoneInput, targetOption, options = {}) {
      const targetDialCode = resolveSignupPhoneTargetDialCode(options, targetOption);
      const displayedText = getSignupPhoneCountryButtonText(phoneInput);
      const displayedDialCode = extractDialCodeFromText(displayedText);

      if (targetDialCode && displayedDialCode) {
        return displayedDialCode === targetDialCode
          && (!displayedText || doesSignupPhoneCountryTextMatchTarget(displayedText, targetOption, options));
      }

      if (displayedText && doesSignupPhoneCountryTextMatchTarget(displayedText, targetOption, options)) {
        return true;
      }

      const selectedOption = getSignupPhoneSelectedCountryOption(phoneInput);
      if (selectedOption && targetOption && isSameSignupCountryOption(selectedOption, targetOption)) {
        return !displayedDialCode || !targetDialCode || displayedDialCode === targetDialCode;
      }

      return Boolean(selectedOption && !targetOption && targetDialCode && displayedDialCode === targetDialCode);
    }

    function findSignupPhoneCountryOptionByLabel(phoneInput, countryLabel) {
      const select = getSignupPhoneCountrySelect(phoneInput);
      if (!select) {
        return null;
      }
      const phoneCountryUtils = (typeof self !== 'undefined' ? self : globalThis)?.MultiPagePhoneCountryUtils
        || globalThis?.MultiPagePhoneCountryUtils;
      return phoneCountryUtils.findOptionByCountryLabel(select.options, countryLabel, {
        document: typeof document !== 'undefined' ? document : null,
        navigator: (typeof self !== 'undefined' ? self : globalThis)?.navigator || globalThis?.navigator || null,
        getOptionLabel: getSignupPhoneOptionLabel,
      });
    }

    function findSignupPhoneCountryOptionByPhoneNumber(phoneInput, phoneNumber) {
      const select = getSignupPhoneCountrySelect(phoneInput);
      if (!select) {
        return null;
      }
      const phoneCountryUtils = (typeof self !== 'undefined' ? self : globalThis)?.MultiPagePhoneCountryUtils
        || globalThis?.MultiPagePhoneCountryUtils;
      return phoneCountryUtils.findOptionByPhoneNumber(select.options, phoneNumber, {
        getOptionLabel: getSignupPhoneOptionLabel,
      });
    }

    async function trySelectSignupPhoneCountryOption(select, targetOption, phoneInput = getSignupPhoneInput(), options = {}) {
      const performOperationWithDelay = typeof getOperationDelayRunner === 'function'
        ? getOperationDelayRunner()
        : async (metadata, operation) => {
            const rootScope = typeof window !== 'undefined' ? window : globalThis;
            const gate = rootScope?.CodexOperationDelay?.performOperationWithDelay;
            return typeof gate === 'function' ? gate(metadata, operation) : operation();
          };
      if (!select || !targetOption) {
        return false;
      }
      const selectedOption = select.selectedIndex >= 0
        ? (select.options?.[select.selectedIndex] || null)
        : null;
      if (selectedOption && isSameSignupCountryOption(selectedOption, targetOption)) {
        await performOperationWithDelay({ stepKey: 'signup-phone-entry', kind: 'select', label: 'signup-phone-country-select' }, async () => {
          dispatchSignupPhoneFieldEvents(select);
        });
        await sleep(120);
        return isSignupPhoneCountrySelectionSynced(phoneInput, targetOption, options);
      }
      await performOperationWithDelay({ stepKey: 'signup-phone-entry', kind: 'select', label: 'signup-phone-country-select' }, async () => {
        select.value = String(targetOption.value || '');
        dispatchSignupPhoneFieldEvents(select);
      });
      await sleep(250);
      return isSignupPhoneCountrySelectionSynced(phoneInput, targetOption, options);
    }

    function getVisibleSignupPhoneCountryListboxOptions() {
      const seen = new Set();
      return Array.from(document.querySelectorAll('[role="listbox"] [role="option"], [role="option"]'))
        .filter((option) => {
          if (!option || seen.has(option)) {
            return false;
          }
          seen.add(option);
          return isVisibleElement(option);
        });
    }

    function findSignupPhoneCountryListboxOption(targetOption, options = {}) {
      const candidates = getVisibleSignupPhoneCountryListboxOptions();
      const byLabel = candidates.find((option) => doesSignupPhoneCountryTextMatchTarget(getActionText(option), targetOption, options));
      if (byLabel) {
        return byLabel;
      }

      const phoneCountryUtils = (typeof self !== 'undefined' ? self : globalThis)?.MultiPagePhoneCountryUtils
        || globalThis?.MultiPagePhoneCountryUtils
        || {};
      if (typeof phoneCountryUtils.findElementByDialCode === 'function') {
        const byPhoneNumber = phoneCountryUtils.findElementByDialCode(candidates, options.phoneNumber, {
          getText: getActionText,
        });
        if (byPhoneNumber) {
          return byPhoneNumber;
        }
      }

      const targetDialCode = resolveSignupPhoneTargetDialCode(options, targetOption);
      if (!targetDialCode) {
        const digits = normalizePhoneDigits(options.phoneNumber);
        let bestMatch = null;
        let bestDialCodeLength = 0;
        for (const option of candidates) {
          const dialCode = normalizePhoneDigits(extractDialCodeFromText(getActionText(option)));
          if (!dialCode || !digits.startsWith(dialCode) || dialCode.length <= bestDialCodeLength) {
            continue;
          }
          bestMatch = option;
          bestDialCodeLength = dialCode.length;
        }
        return bestMatch;
      }
      return candidates.find((option) => extractDialCodeFromText(getActionText(option)) === targetDialCode) || null;
    }

    async function trySelectSignupPhoneCountryListboxOption(phoneInput, targetOption, options = {}) {
      const performOperationWithDelay = typeof getOperationDelayRunner === 'function'
        ? getOperationDelayRunner()
        : async (metadata, operation) => {
            const rootScope = typeof window !== 'undefined' ? window : globalThis;
            const gate = rootScope?.CodexOperationDelay?.performOperationWithDelay;
            return typeof gate === 'function' ? gate(metadata, operation) : operation();
          };
      const button = getSignupPhoneCountryButton(phoneInput);
      if (!button) {
        return false;
      }

      const getScrollableTargets = () => {
        const seen = new Set();
        const targets = [];
        const pushTarget = (element) => {
          if (!element || seen.has(element)) {
            return;
          }
          seen.add(element);
          const scrollHeight = Number(element.scrollHeight) || 0;
          const clientHeight = Number(element.clientHeight) || 0;
          if (scrollHeight > clientHeight + 2) {
            targets.push(element);
          }
        };

        getVisibleSignupPhoneCountryListboxOptions().forEach((option) => {
          let current = option.parentElement || null;
          let depth = 0;
          while (current && depth < 6) {
            pushTarget(current);
            if (current === document.body || current === document.documentElement) {
              break;
            }
            current = current.parentElement || null;
            depth += 1;
          }
        });

        Array.from(document.querySelectorAll('[role="listbox"]'))
          .filter((listbox) => isVisibleElement(listbox))
          .forEach(pushTarget);

        return targets;
      };

      const dispatchListboxScroll = (element) => {
        if (!element || typeof element.dispatchEvent !== 'function') {
          return;
        }
        try {
          element.dispatchEvent(typeof Event === 'function'
            ? new Event('scroll', { bubbles: true })
            : { type: 'scroll' });
        } catch {
          try {
            element.dispatchEvent({ type: 'scroll' });
          } catch { }
        }
      };

      const resetListboxScroll = () => {
        getScrollableTargets().forEach((target) => {
          if ((Number(target.scrollTop) || 0) > 0) {
            target.scrollTop = 0;
            dispatchListboxScroll(target);
          }
        });
      };

      const scrollListboxDown = () => {
        let scrolled = false;
        getScrollableTargets().forEach((target) => {
          const before = Number(target.scrollTop) || 0;
          const maxScrollTop = Math.max(0, (Number(target.scrollHeight) || 0) - (Number(target.clientHeight) || 0));
          if (maxScrollTop <= before + 1) {
            return;
          }
          const step = Math.max(360, Math.floor((Number(target.clientHeight) || 0) * 0.85));
          target.scrollTop = Math.min(maxScrollTop, before + step);
          dispatchListboxScroll(target);
          scrolled = true;
        });
        return scrolled;
      };

      await performOperationWithDelay({ stepKey: 'signup-phone-entry', kind: 'click', label: 'open-signup-phone-country-listbox' }, async () => {
        simulateClick(button);
      });
      await sleep(200);
      resetListboxScroll();

      const start = Date.now();
      let reachedListEndAt = 0;
      while (Date.now() - start < 8000) {
        throwIfStopped();
        const option = findSignupPhoneCountryListboxOption(targetOption, options);
        if (option) {
          await performOperationWithDelay({ stepKey: 'signup-phone-entry', kind: 'select', label: 'signup-phone-country-listbox-option' }, async () => {
            simulateClick(option);
          });
          await sleep(450);
          if (isSignupPhoneCountrySelectionSynced(phoneInput, targetOption, options)) {
            return true;
          }
        }

        if (!scrollListboxDown()) {
          reachedListEndAt += 1;
          if (reachedListEndAt >= 6) {
            break;
          }
          await sleep(150);
          continue;
        }
        reachedListEndAt = 0;
        await sleep(220);
      }

      return false;
    }

    async function ensureSignupPhoneCountrySelected(phoneInput, options = {}) {
      const select = getSignupPhoneCountrySelect(phoneInput);
      const hasCountryControl = Boolean(select || getSignupPhoneCountryButton(phoneInput));
      if (!hasCountryControl) {
        return {
          hasSelect: false,
          hasCountryControl: false,
          matched: false,
          selectedOption: null,
        };
      }

      const byLabel = findSignupPhoneCountryOptionByLabel(phoneInput, options.countryLabel);
      const byPhoneNumber = findSignupPhoneCountryOptionByPhoneNumber(phoneInput, options.phoneNumber);
      const targets = [byLabel, byPhoneNumber, null].filter((target, index, list) => (
        index === list.findIndex((item) => (
          (!item && !target)
          || (item && target && isSameSignupCountryOption(item, target))
        ))
      ));

      for (const targetOption of targets) {
        if (await trySelectSignupPhoneCountryOption(select, targetOption, phoneInput, options)) {
          return {
            hasSelect: Boolean(select),
            hasCountryControl: true,
            matched: true,
            selectedOption: getSignupPhoneSelectedCountryOption(phoneInput),
          };
        }

        if (await trySelectSignupPhoneCountryListboxOption(phoneInput, targetOption, options)) {
          return {
            hasSelect: Boolean(select),
            hasCountryControl: true,
            matched: true,
            selectedOption: getSignupPhoneSelectedCountryOption(phoneInput),
          };
        }
      }

      return {
        hasSelect: Boolean(select),
        hasCountryControl: true,
        matched: false,
        selectedOption: getSignupPhoneSelectedCountryOption(phoneInput),
      };
    }

    return {
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
    };
  }

  return {
    createOpenAIAuthSignupPhoneCountry,
  };
});
