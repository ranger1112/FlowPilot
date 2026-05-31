// flows/openai/content/openai-auth-choose-account.js
// "Choose an account" 页面探查 + 决策工具。
//
// 历史背景：
//   openai-auth.js monolith 里塞了一组围绕 "Welcome back / 选择一个帐户" 页面的
//   DOM 探查 + 候选过滤 + click target 解析逻辑（10 个 helper + 5 个常量），
//   跟主文件其它职责无耦合，纯粹是 page-level 工具。和 #4 第一刀（route-recovery）同款，
//   独立成 module 之后主文件能再瘦一圈。
//
// 设计：
//   - IFE + 工厂模式 + 注入依赖，跟 phone-country-utils / openai-auth-route-recovery 同款；
//   - 不读 chrome / state，所有依赖（isVisibleElement / isActionEnabled /
//     getPageTextSnapshot / getLoginVerificationDisplayedEmail / inspectLoginAuthState /
//     normalizeStep6Snapshot / throwIfStopped / sleep）通过参数注入；
//   - 主文件 openai-auth.js 在常量块之后 destructure 出本模块的 API，原所有调用点零修改；
//   - 5 个常量也通过 module 命名空间暴露给主文件原地复用。
//
// 测试约束：
//   tests/step6-oauth-consent-skip.test.js 通过 extractFunction / extractConst
//   从 *源代码字符串* 抠出本模块所有 5 个常量 + 10 个 helper 的源码 inline 进沙箱，
//   所以 1) 函数体不能依赖闭包外的 module-scope helper；2) 测试文件的 source 字符串
//   需要 concat 两个文件来覆盖跨文件引用，本次改造保留所有函数体一字不差，
//   只把它们从主文件搬到这里。

(function attachOpenAIAuthChooseAccount(root, factory) {
  root.MultiPageOpenAIAuthChooseAccount = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createOpenAIAuthChooseAccountModule() {
  const CHOOSE_ACCOUNT_PAGE_PATTERN = new RegExp([
    String.raw`choose\s+(?:an?\s+)?account`,
    String.raw`select\s+(?:an?\s+)?account`,
    String.raw`welcome\s+back`,
    String.raw`选择(?:一个)?(?:帐户|账户|账号)`,
    String.raw`欢迎回来`,
    String.raw`アカウント.*(?:選択|選んで)`,
  ].join('|'), 'i');
  const CHOOSE_ACCOUNT_REMOVE_ACTION_PATTERN = /remove|delete|forget|close|dismiss|trash|移除|删除|刪除|削除|閉じる|削除/i;
  const CHOOSE_ACCOUNT_OTHER_ACCOUNT_PATTERN = new RegExp([
    String.raw`another\s+account`,
    String.raw`different\s+account`,
    String.raw`other\s+account`,
    String.raw`use\s+(?:a\s+)?different`,
    String.raw`sign\s*in\s+(?:with\s+)?(?:another|different)`,
    String.raw`log\s*in\s+(?:with\s+)?(?:another|different)`,
    String.raw`其他(?:帐户|账户|账号)`,
    String.raw`另一个(?:帐户|账户|账号)`,
    String.raw`別のアカウント`,
  ].join('|'), 'i');
  const CHOOSE_ACCOUNT_ACTION_SELECTOR = 'button, a, [role="button"], [role="link"], [tabindex]:not([tabindex="-1"])';
  const CHOOSE_ACCOUNT_CARD_SELECTOR = [
    '[data-testid*="account" i]',
    '[data-test-id*="account" i]',
    '[class*="account" i]',
    '[class*="user" i]',
    '[class*="card" i]',
    '[class*="option" i]',
    '[class*="select" i]',
    '[class*="list" i] > *',
    'li',
  ].join(', ');

  function createOpenAIAuthChooseAccount(deps = {}) {
    const {
      isVisibleElement,
      isActionEnabled,
      getPageTextSnapshot,
      getLoginVerificationDisplayedEmail,
      inspectLoginAuthState,
      normalizeStep6Snapshot,
      throwIfStopped,
      sleep,
    } = deps;
    const required = {
      isVisibleElement,
      isActionEnabled,
      getPageTextSnapshot,
      getLoginVerificationDisplayedEmail,
      inspectLoginAuthState,
      normalizeStep6Snapshot,
      throwIfStopped,
      sleep,
    };
    for (const name of Object.keys(required)) {
      if (typeof required[name] !== 'function') {
        throw new Error(`createOpenAIAuthChooseAccount requires ${name} function`);
      }
    }

    function normalizeAuthAccountIdentifier(value) {
      return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    function getChooseAccountCandidateText(element) {
      const parts = [
        element?.textContent,
        element?.value,
        element?.getAttribute?.('aria-label'),
        element?.getAttribute?.('title'),
        element?.getAttribute?.('data-testid'),
        element?.getAttribute?.('data-test-id'),
      ];
      return parts
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function isChooseAccountPage() {
      const path = `${location.pathname || ''} ${location.href || ''}`;
      if (/\/choose-an-account(?:[/?#]|$)/i.test(path)) {
        return true;
      }
      const pageText = getPageTextSnapshot();
      if (!CHOOSE_ACCOUNT_PAGE_PATTERN.test(pageText)) {
        return false;
      }
      return Boolean(findChooseAccountButtonForEmail(getLoginVerificationDisplayedEmail()));
    }

    function isChooseAccountRemovalAction(element) {
      if (!element) return false;
      const text = getChooseAccountCandidateText(element);
      const role = String(element.getAttribute?.('role') || '').trim().toLowerCase();
      return CHOOSE_ACCOUNT_REMOVE_ACTION_PATTERN.test(text)
        || role === 'menuitem'
        || role === 'switch';
    }

    function resolveChooseAccountClickTarget(element) {
      if (!element || isChooseAccountRemovalAction(element)) {
        return null;
      }

      const tag = String(element.tagName || '').trim().toLowerCase();
      const role = String(element.getAttribute?.('role') || '').trim().toLowerCase();
      const tabIndex = Number(element.getAttribute?.('tabindex') ?? element.tabIndex ?? NaN);
      const actionable = tag === 'button'
        || tag === 'a'
        || role === 'button'
        || role === 'link'
        || (Number.isFinite(tabIndex) && tabIndex >= 0);

      if (actionable && isActionEnabled(element) && isVisibleElement(element)) {
        return element;
      }

      const closestAction = element.closest?.(CHOOSE_ACCOUNT_ACTION_SELECTOR) || null;
      if (
        closestAction
        && closestAction !== element
        && isActionEnabled(closestAction)
        && isVisibleElement(closestAction)
        && !isChooseAccountRemovalAction(closestAction)
      ) {
        return closestAction;
      }

      return null;
    }

    function resolveChooseAccountCardTarget(element, normalizedEmail = '') {
      let current = element;
      let bestTarget = null;

      while (current && current !== document.body) {
        if (isChooseAccountRemovalAction(current) || !isVisibleElement(current)) {
          current = current.parentElement;
          continue;
        }

        const actionTarget = resolveChooseAccountClickTarget(current);
        if (actionTarget) {
          return actionTarget;
        }

        const text = normalizeAuthAccountIdentifier(getChooseAccountCandidateText(current));
        if (text.includes(normalizedEmail) && !CHOOSE_ACCOUNT_OTHER_ACCOUNT_PATTERN.test(text)) {
          bestTarget = current;
        }

        const closestCard = current.closest?.(CHOOSE_ACCOUNT_CARD_SELECTOR) || null;
        if (
          closestCard
          && closestCard !== current
          && closestCard !== document.body
          && isVisibleElement(closestCard)
          && !isChooseAccountRemovalAction(closestCard)
        ) {
          const cardText = normalizeAuthAccountIdentifier(getChooseAccountCandidateText(closestCard));
          if (cardText.includes(normalizedEmail) && !CHOOSE_ACCOUNT_OTHER_ACCOUNT_PATTERN.test(cardText)) {
            const cardActionTarget = resolveChooseAccountClickTarget(closestCard);
            return cardActionTarget || closestCard;
          }
        }

        current = current.parentElement;
      }

      return bestTarget;
    }

    function findChooseAccountButtonForEmail(email) {
      const normalizedEmail = normalizeAuthAccountIdentifier(email);
      if (!normalizedEmail || !normalizedEmail.includes('@')) {
        return null;
      }

      const candidates = Array.from(document.querySelectorAll(CHOOSE_ACCOUNT_ACTION_SELECTOR))
        .filter((element) => isVisibleElement(element) && isActionEnabled(element));

      for (const candidate of candidates) {
        if (isChooseAccountRemovalAction(candidate)) continue;
        const text = normalizeAuthAccountIdentifier(getChooseAccountCandidateText(candidate));
        if (!text || !text.includes(normalizedEmail)) continue;
        if (CHOOSE_ACCOUNT_OTHER_ACCOUNT_PATTERN.test(text)) continue;
        const target = resolveChooseAccountClickTarget(candidate);
        if (target) {
          return target;
        }
      }

      const emailNodes = Array.from(document.querySelectorAll('body *'))
        .filter((element) => {
          if (!isVisibleElement(element)) return false;
          const text = normalizeAuthAccountIdentifier(getChooseAccountCandidateText(element));
          return text.includes(normalizedEmail);
        });

      for (const node of emailNodes) {
        const target = resolveChooseAccountCardTarget(node, normalizedEmail);
        if (target) {
          return target;
        }
      }

      return null;
    }

    function findChooseAccountOtherAccountButton() {
      const candidates = Array.from(document.querySelectorAll(CHOOSE_ACCOUNT_ACTION_SELECTOR))
        .filter((element) => isVisibleElement(element) && isActionEnabled(element));

      return candidates.find((candidate) => {
        if (isChooseAccountRemovalAction(candidate)) {
          return false;
        }
        const text = getChooseAccountCandidateText(candidate);
        return CHOOSE_ACCOUNT_OTHER_ACCOUNT_PATTERN.test(text);
      }) || null;
    }

    function getChooseAccountListedEmails() {
      const emailPattern = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/ig;
      const emails = new Set();
      const nodes = [
        ...Array.from(document.querySelectorAll(CHOOSE_ACCOUNT_ACTION_SELECTOR)),
        ...Array.from(document.querySelectorAll('body *')).filter((element) => isVisibleElement(element)),
      ];

      for (const node of nodes) {
        if (isChooseAccountRemovalAction(node)) {
          continue;
        }
        const text = getChooseAccountCandidateText(node);
        for (const match of text.matchAll(emailPattern)) {
          emails.add(normalizeAuthAccountIdentifier(match[0]));
        }
      }

      return Array.from(emails).filter(Boolean);
    }

    async function resolveChooseAccountAction(email, maxRounds = 8, options = {}) {
      const allowFirstAccountFallback = Boolean(options?.allowFirstAccountFallback);
      const createAccountPattern = /create\s+(?:an?\s+)?account|sign\s*up|register|创建(?:帐户|账户|账号)|注册|アカウント.*作成|登録/i;
      let otherAccountButton = null;
      let latestSnapshot = normalizeStep6Snapshot(inspectLoginAuthState());

      for (let round = 0; round < maxRounds; round += 1) {
        throwIfStopped();
        latestSnapshot = normalizeStep6Snapshot(inspectLoginAuthState());
        if (latestSnapshot.state !== 'unknown' && latestSnapshot.state !== 'choose_account_page') {
          return {
            snapshot: latestSnapshot,
          };
        }

        const target = findChooseAccountButtonForEmail(email);
        if (target) {
          return {
            target,
            snapshot: latestSnapshot,
          };
        }

        if (allowFirstAccountFallback) {
          const fallbackCandidates = Array.from(new Set([
            ...Array.from(document.querySelectorAll(CHOOSE_ACCOUNT_ACTION_SELECTOR)),
            ...Array.from(document.querySelectorAll(CHOOSE_ACCOUNT_CARD_SELECTOR)),
          ]));
          for (const candidate of fallbackCandidates) {
            if (!candidate || !isVisibleElement(candidate) || isChooseAccountRemovalAction(candidate)) {
              continue;
            }
            const candidateText = normalizeAuthAccountIdentifier(getChooseAccountCandidateText(candidate));
            if (
              !candidateText
              || CHOOSE_ACCOUNT_OTHER_ACCOUNT_PATTERN.test(candidateText)
              || createAccountPattern.test(candidateText)
            ) {
              continue;
            }
            const clickTarget = resolveChooseAccountClickTarget(candidate) || candidate;
            if (
              clickTarget
              && isVisibleElement(clickTarget)
              && isActionEnabled(clickTarget)
              && !isChooseAccountRemovalAction(clickTarget)
            ) {
              return {
                target: clickTarget,
                snapshot: latestSnapshot,
                fallback: true,
              };
            }
          }
        }

        otherAccountButton = findChooseAccountOtherAccountButton() || otherAccountButton;
        const listedEmails = getChooseAccountListedEmails();
        if (otherAccountButton && round >= 2 && (listedEmails.length > 0 || round >= 4)) {
          return {
            otherAccountButton,
            snapshot: latestSnapshot,
          };
        }

        if (round < maxRounds - 1) {
          await sleep(round === 0 ? 300 : 500);
        }
      }

      return {
        otherAccountButton,
        snapshot: latestSnapshot,
      };
    }

    return {
      // constants (also exposed at module top-level for early-binding consumers)
      CHOOSE_ACCOUNT_PAGE_PATTERN,
      CHOOSE_ACCOUNT_REMOVE_ACTION_PATTERN,
      CHOOSE_ACCOUNT_OTHER_ACCOUNT_PATTERN,
      CHOOSE_ACCOUNT_ACTION_SELECTOR,
      CHOOSE_ACCOUNT_CARD_SELECTOR,
      // helpers
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
    };
  }

  return {
    CHOOSE_ACCOUNT_PAGE_PATTERN,
    CHOOSE_ACCOUNT_REMOVE_ACTION_PATTERN,
    CHOOSE_ACCOUNT_OTHER_ACCOUNT_PATTERN,
    CHOOSE_ACCOUNT_ACTION_SELECTOR,
    CHOOSE_ACCOUNT_CARD_SELECTOR,
    createOpenAIAuthChooseAccount,
  };
});
