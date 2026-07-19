(() => {
  'use strict';

  const RELEASE = '4.6.7';
  const AUTH_STORAGE_KEY = 'dv_supabase_auth_v1';
  let deferredPrompt = null;
  let previouslyFocusedElement = null;
  let feedbackPreviouslyFocusedElement = null;
  let feedbackReturnToAccount = false;
  let changePasswordPreviouslyFocusedElement = null;
  let changePasswordReturnToAccount = false;

  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.navigator.standalone === true;

  const userAgent = () => navigator.userAgent || '';

  const platform = () => {
    const ua = userAgent();
    const isiOS = /iphone|ipad|ipod/i.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isAndroid = /android/i.test(ua);
    const isMac = /macintosh|mac os x/i.test(ua) && !isiOS;
    const isWindows = /windows/i.test(ua);
    const isFirefox = /firefox|fxios/i.test(ua);
    const isSafari = /safari/i.test(ua) &&
      !/chrome|crios|chromium|edg|edgios|opr|opera|fxios|android/i.test(ua);
    const isChromium = /chrome|crios|chromium|edg|edgios|opr|opera/i.test(ua);

    return { isiOS, isAndroid, isMac, isWindows, isFirefox, isSafari, isChromium };
  };

  const setMessage = message => {
    document.querySelectorAll('[data-install-app-message]').forEach(element => {
      element.textContent = message || '';
    });
  };

  const updateButtons = () => {
    const installed = isStandalone();

    document.querySelectorAll('[data-install-app]').forEach(button => {
      button.classList.toggle('hidden', installed);
      button.disabled = installed;
      button.setAttribute('aria-hidden', installed ? 'true' : 'false');
    });

    if (installed) {
      setMessage('Deutsche Vokabeltrainer is installed and running as an app.');
      closeInstallHelp();
    }
  };

  const getGuidance = () => {
    const p = platform();

    if (p.isiOS) {
      return {
        title: 'Install on iPhone or iPad',
        intro: 'Apple requires installation through the browser Share menu:',
        steps: [
          'Open this page in Safari.',
          'Tap the Share button in the browser toolbar.',
          'Choose Add to Home Screen, then tap Add.'
        ],
        note: 'Other iPhone browsers may show an Open in Safari option first.'
      };
    }

    if (p.isAndroid) {
      return {
        title: 'Install on Android',
        intro: 'Your browser has not exposed the automatic installation prompt yet. You can still install from its menu:',
        steps: [
          'Open the browser menu, usually shown as ⋮.',
          'Choose Install app or Add to Home screen.',
          'Confirm the installation.'
        ],
        note: 'The exact wording depends on the Android browser.'
      };
    }

    if (p.isMac && p.isSafari) {
      return {
        title: 'Install on Mac',
        intro: 'Use Safari’s app installation option:',
        steps: [
          'Open the File menu in Safari.',
          'Choose Add to Dock.',
          'Confirm the app name and add it.'
        ],
        note: 'Chrome and Edge also provide an Install option in the address bar or browser menu.'
      };
    }

    if (p.isFirefox) {
      return {
        title: 'Install this web app',
        intro: 'This browser did not provide a direct installation prompt.',
        steps: [
          'Open the browser menu and look for Install or Add to Home Screen.',
          'When no installation option is available, open the same page in Chrome, Edge, or Safari.',
          'Use that browser’s Install app option.'
        ],
        note: 'The vocabulary trainer can still be used normally in this browser.'
      };
    }

    if (p.isWindows || p.isMac || p.isChromium) {
      return {
        title: 'Install on this computer',
        intro: 'The automatic prompt is not currently available. Install from the browser interface:',
        steps: [
          'Look for the Install icon in the address bar, or open the browser menu.',
          'Choose Install Deutsche Vokabeltrainer or Install app.',
          'Confirm the installation.'
        ],
        note: 'Reload the secure HTTPS page once if the installation option has not appeared yet.'
      };
    }

    return {
      title: 'Install Deutsche Vokabeltrainer',
      intro: 'Your browser did not provide an automatic installation prompt.',
      steps: [
        'Open the browser menu.',
        'Look for Install app or Add to Home Screen.',
        'Confirm the installation.'
      ],
      note: 'Installation support and menu wording vary by browser and operating system.'
    };
  };

  const ensureInstallHelp = () => {
    let overlay = document.getElementById('pwaInstallHelp');
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.id = 'pwaInstallHelp';
    overlay.className = 'pwa-install-overlay hidden';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'pwaInstallHelpTitle');
    overlay.setAttribute('aria-describedby', 'pwaInstallHelpIntro');

    const card = document.createElement('section');
    card.className = 'pwa-install-card';

    const header = document.createElement('div');
    header.className = 'pwa-install-header';

    const headingWrap = document.createElement('div');
    const eyebrow = document.createElement('p');
    eyebrow.className = 'eyebrow';
    eyebrow.textContent = 'App installation';

    const title = document.createElement('h2');
    title.id = 'pwaInstallHelpTitle';

    headingWrap.append(eyebrow, title);

    const closeIcon = document.createElement('button');
    closeIcon.type = 'button';
    closeIcon.className = 'pwa-install-icon-close';
    closeIcon.setAttribute('aria-label', 'Close installation instructions');
    closeIcon.textContent = '×';

    header.append(headingWrap, closeIcon);

    const intro = document.createElement('p');
    intro.id = 'pwaInstallHelpIntro';
    intro.className = 'pwa-install-intro';

    const steps = document.createElement('ol');
    steps.className = 'pwa-install-steps';

    const note = document.createElement('p');
    note.className = 'pwa-install-note';

    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'btn primary pwa-install-done';
    done.textContent = 'Got it';

    card.append(header, intro, steps, note, done);
    overlay.append(card);
    document.body.append(overlay);

    const close = () => closeInstallHelp();
    closeIcon.addEventListener('click', close);
    done.addEventListener('click', close);
    overlay.addEventListener('click', event => {
      if (event.target === overlay) close();
    });

    return overlay;
  };

  function showInstallHelp() {
    const guidance = getGuidance();
    const overlay = ensureInstallHelp();

    overlay.querySelector('#pwaInstallHelpTitle').textContent = guidance.title;
    overlay.querySelector('#pwaInstallHelpIntro').textContent = guidance.intro;
    overlay.querySelector('.pwa-install-note').textContent = guidance.note;

    const list = overlay.querySelector('.pwa-install-steps');
    list.replaceChildren();
    guidance.steps.forEach(step => {
      const item = document.createElement('li');
      item.textContent = step;
      list.append(item);
    });

    previouslyFocusedElement = document.activeElement;
    overlay.classList.remove('hidden');
    document.documentElement.classList.add('pwa-install-open');
    overlay.querySelector('.pwa-install-icon-close').focus();

    setMessage(guidance.note);
  }

  function closeInstallHelp() {
    const overlay = document.getElementById('pwaInstallHelp');
    if (!overlay || overlay.classList.contains('hidden')) return;

    overlay.classList.add('hidden');
    document.documentElement.classList.remove('pwa-install-open');

    if (previouslyFocusedElement && typeof previouslyFocusedElement.focus === 'function') {
      previouslyFocusedElement.focus();
    }
    previouslyFocusedElement = null;
  }

  async function installApp() {
    if (isStandalone()) {
      setMessage('Deutsche Vokabeltrainer is already installed.');
      updateButtons();
      return;
    }

    if (!deferredPrompt) {
      showInstallHelp();
      return;
    }

    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      deferredPrompt = null;

      if (choice && choice.outcome === 'accepted') {
        setMessage('Installation started. Open Deutsche Vokabeltrainer from your home screen or app list.');
      } else {
        setMessage('Installation was cancelled. You can install it later from the Guide or Account menu.');
      }
    } catch (error) {
      deferredPrompt = null;
      showInstallHelp();
    }

    updateButtons();
  }

  function readSafeAreaInset(side) {
    const test = document.createElement('div');
    test.style.cssText = [
      'position:fixed',
      'visibility:hidden',
      'pointer-events:none',
      side === 'top'
        ? 'padding-top:env(safe-area-inset-top,0px)'
        : 'padding-bottom:env(safe-area-inset-bottom,0px)'
    ].join(';');
    document.body.append(test);
    const value = parseFloat(
      side === 'top'
        ? getComputedStyle(test).paddingTop
        : getComputedStyle(test).paddingBottom
    ) || 0;
    test.remove();
    return value;
  }

  function estimatedIOSInsets() {
    const width = Math.round(Math.min(screen.width || innerWidth, screen.height || innerHeight));
    const dynamicIslandWidths = new Set([393, 402, 430, 440]);
    const notchedWidths = new Set([375, 390, 414, 428]);

    if (dynamicIslandWidths.has(width)) return { top: 59, bottom: 34 };
    if (notchedWidths.has(width) || width >= 375) return { top: 47, bottom: 34 };
    return { top: 20, bottom: 0 };
  }

  function updateSafeAreaFallback() {
    const root = document.documentElement;
    const p = platform();
    const bottomInset = readSafeAreaInset('bottom');
    let bottomFallback = 0;

    /* Do not estimate a top inset. Installed iOS and Android web apps may
       already receive a viewport below the status bar. Adding a guessed top
       inset in that case creates a second status-bar-sized blank area. The
       actual CSS env(safe-area-inset-top) value remains the source of truth. */
    if (isStandalone() && bottomInset < 1) {
      if (p.isiOS) {
        bottomFallback = estimatedIOSInsets().bottom;
      } else if (p.isAndroid) {
        bottomFallback = 24;
      }
    }

    root.style.setProperty('--dv-safe-top-fallback', '0px');
    root.style.setProperty('--dv-safe-bottom-fallback', `${bottomFallback}px`);
    root.classList.toggle('dv-standalone', isStandalone());
    root.classList.toggle('dv-ios', p.isiOS);
    root.classList.toggle('dv-android', p.isAndroid);
  }

  const PASSWORD_RULES = Object.freeze({
    length: value => value.length >= 8,
    uppercase: value => /[A-Z]/.test(value),
    lowercase: value => /[a-z]/.test(value),
    number: value => /[0-9]/.test(value),
    symbol: value => /[^A-Za-z0-9\s]/.test(value)
  });

  function passwordIsStrong(value) {
    return Object.values(PASSWORD_RULES).every(rule => rule(value));
  }

  function bindPasswordToggles() {
    document.querySelectorAll('[data-password-toggle]').forEach(button => {
      button.addEventListener('click', () => {
        const input = document.getElementById(button.dataset.passwordToggle || '');
        if (!input) return;
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        button.textContent = show ? 'Hide' : 'Show';
        button.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
        button.setAttribute('aria-pressed', show ? 'true' : 'false');
        input.focus({ preventScroll: true });
      });
    });
  }

  function updatePasswordChecklist(list) {
    const input = document.getElementById(list.dataset.passwordRequirementsFor || '');
    if (!input) return;
    const value = String(input.value || '');

    Object.entries(PASSWORD_RULES).forEach(([name, rule]) => {
      const item = list.querySelector(`[data-rule="${name}"]`);
      if (!item) return;
      const valid = rule(value);
      item.classList.toggle('is-valid', valid);
      item.classList.toggle('is-invalid', Boolean(value) && !valid);
    });

    const matchItem = list.querySelector('[data-rule="match"]');
    if (matchItem) {
      const confirmation = document.getElementById(matchItem.dataset.confirmPassword || '');
      const matches = Boolean(value) && Boolean(confirmation && confirmation.value) && confirmation.value === value;
      matchItem.classList.toggle('is-valid', matches);
      matchItem.classList.toggle('is-invalid', Boolean(confirmation && confirmation.value) && !matches);
      if (confirmation) {
        confirmation.setCustomValidity(
          confirmation.value && !matches ? 'The two passwords do not match.' : ''
        );
      }
    }

    input.setCustomValidity(
      value && !passwordIsStrong(value)
        ? 'Use at least 8 characters with an uppercase letter, lowercase letter, number and symbol.'
        : ''
    );
  }

  function bindPasswordValidation() {
    document.querySelectorAll('[data-password-requirements-for]').forEach(list => {
      const input = document.getElementById(list.dataset.passwordRequirementsFor || '');
      if (!input) return;
      const matchItem = list.querySelector('[data-rule="match"]');
      const confirmation = matchItem
        ? document.getElementById(matchItem.dataset.confirmPassword || '')
        : null;

      input.addEventListener('input', () => updatePasswordChecklist(list));
      if (confirmation) confirmation.addEventListener('input', () => updatePasswordChecklist(list));
      updatePasswordChecklist(list);
    });
  }

  function bindAuthNavigation() {
    const forgot = document.getElementById('forgotPasswordButton');
    const resetMode = document.getElementById('authModeReset');
    const back = document.getElementById('resetBackToSignIn');
    const signInMode = document.getElementById('authModeSignIn');

    if (forgot && resetMode) {
      forgot.addEventListener('click', () => {
        resetMode.click();
        window.setTimeout(() => document.getElementById('resetEmail')?.focus(), 30);
      });
    }

    if (back && signInMode) {
      back.addEventListener('click', () => {
        signInMode.click();
        window.setTimeout(() => document.getElementById('signInEmail')?.focus(), 30);
      });
    }
  }

  function showDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function closeDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    else dialog.removeAttribute('open');
  }

  function openFeedbackDialog() {
    const feedback = document.getElementById('feedbackDialog');
    if (!feedback) return;
    const account = document.getElementById('accountDialog');
    feedbackPreviouslyFocusedElement = document.activeElement;
    feedbackReturnToAccount = Boolean(account && account.open);
    closeDialog(account);
    showDialog(feedback);
    window.setTimeout(() => document.getElementById('feedbackType')?.focus(), 30);
  }

  function closeFeedbackDialog() {
    const feedback = document.getElementById('feedbackDialog');
    closeDialog(feedback);
    const account = document.getElementById('accountDialog');
    if (feedbackReturnToAccount && account) {
      showDialog(account);
    }
    const focusTarget = feedbackPreviouslyFocusedElement;
    if (focusTarget && typeof focusTarget.focus === 'function') {
      window.setTimeout(() => focusTarget.focus({ preventScroll: true }), 30);
    }
    feedbackPreviouslyFocusedElement = null;
    feedbackReturnToAccount = false;
  }

  function bindFeedbackDialog() {
    document.querySelectorAll('[data-open-feedback]').forEach(button => {
      button.addEventListener('click', openFeedbackDialog);
    });

    const feedback = document.getElementById('feedbackDialog');
    const close = document.getElementById('feedbackDialogClose');
    if (close) close.addEventListener('click', closeFeedbackDialog);
    if (feedback) {
      feedback.addEventListener('click', event => {
        if (event.target === feedback) closeFeedbackDialog();
      });
      feedback.addEventListener('cancel', event => {
        event.preventDefault();
        closeFeedbackDialog();
      });
    }

    const form = document.getElementById('feedbackForm');
    const type = document.getElementById('feedbackType');
    const text = document.getElementById('feedbackText');
    if (form && type && text) {
      form.addEventListener('submit', () => {
        const selectedLabel = type.options[type.selectedIndex]?.textContent?.trim() || 'Other';
        const raw = String(text.value || '').replace(/^\[Feedback type: [^\]]+\]\s*/i, '');
        text.value = `[Feedback type: ${selectedLabel}]
${raw}`;
      }, true);
    }
  }

  function normalizeSupabaseUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      const url = new URL(raw);
      if (/^[a-z0-9-]+\.supabase\.co$/i.test(url.hostname)) return url.origin;
    } catch (error) {
      // Fall through to path cleanup.
    }
    return raw
      .replace(/\/(?:rest|auth|storage)\/v1\/?$/i, '')
      .replace(/\/$/, '');
  }

  function getSupabaseConfig() {
    const config = window.DEUTSCHE_VOKABELTRAINER_CONFIG || {};
    return {
      url: normalizeSupabaseUrl(
        config.supabaseUrl || config.SUPABASE_URL || config.supabaseProjectUrl || ''
      ),
      key: String(
        config.supabasePublishableKey ||
        config.SUPABASE_PUBLISHABLE_KEY ||
        config.supabaseAnonKey || ''
      ).trim()
    };
  }

  function setChangePasswordMessage(message, type = 'info') {
    const target = document.getElementById('changePasswordMessage');
    if (!target) return;
    target.textContent = message || '';
    target.className = `auth-message${message ? ` ${type}` : ''}`;
  }

  function setFormBusy(form, busy) {
    if (!form) return;
    form.querySelectorAll('button, input').forEach(control => {
      control.disabled = Boolean(busy);
    });
  }

  function friendlyPasswordError(error) {
    const message = String(error && error.message || 'The password could not be changed.');
    if (/current password|invalid login credentials|incorrect/i.test(message)) {
      return 'The current password is incorrect.';
    }
    if (/weak_password|password/i.test(message) && /weak|least|short|characters/i.test(message)) {
      return 'The new password does not meet the required strength rules.';
    }
    if (/same password|different from/i.test(message)) {
      return 'Choose a new password that is different from the current password.';
    }
    if (/rate limit|too many/i.test(message)) {
      return 'Too many password requests were made. Wait a moment and try again.';
    }
    if (/network|fetch/i.test(message)) {
      return 'The account service could not be reached. Check the connection and retry.';
    }
    return message.slice(0, 220);
  }

  async function changePassword(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;

    const currentPassword = String(document.getElementById('currentPassword')?.value || '');
    const newPassword = String(document.getElementById('changeNewPassword')?.value || '');
    const confirmation = String(document.getElementById('changeConfirmPassword')?.value || '');

    if (!passwordIsStrong(newPassword)) {
      setChangePasswordMessage('Use at least 8 characters with an uppercase letter, lowercase letter, number and symbol.', 'error');
      return;
    }
    if (newPassword !== confirmation) {
      setChangePasswordMessage('The two new passwords do not match.', 'error');
      return;
    }
    if (newPassword === currentPassword) {
      setChangePasswordMessage('Choose a new password that is different from the current password.', 'error');
      return;
    }

    const { url, key } = getSupabaseConfig();
    if (!window.supabase || !url || !key) {
      setChangePasswordMessage('Account sync is not configured in this app build.', 'error');
      return;
    }

    setFormBusy(form, true);
    setChangePasswordMessage('Updating your password…', 'info');

    try {
      const client = window.supabase.createClient(url, key, {
        auth: {
          persistSession: true,
          autoRefreshToken: false,
          detectSessionInUrl: false,
          storageKey: AUTH_STORAGE_KEY
        }
      });
      const sessionResult = await client.auth.getSession();
      if (sessionResult.error) throw sessionResult.error;
      if (!sessionResult.data || !sessionResult.data.session) {
        throw new Error('Your session has expired. Sign in again before changing the password.');
      }

      const result = await client.auth.updateUser({
        current_password: currentPassword,
        password: newPassword
      });
      if (result.error) throw result.error;

      form.reset();
      document.querySelectorAll('[data-password-requirements-for="changeNewPassword"]').forEach(updatePasswordChecklist);
      setChangePasswordMessage('Password updated successfully.', 'success');
    } catch (error) {
      setChangePasswordMessage(friendlyPasswordError(error), 'error');
    } finally {
      setFormBusy(form, false);
    }
  }

  function openChangePasswordDialog() {
    const dialog = document.getElementById('changePasswordDialog');
    if (!dialog) return;

    const account = document.getElementById('accountDialog');
    changePasswordPreviouslyFocusedElement = document.activeElement;
    changePasswordReturnToAccount = Boolean(account && account.open);
    closeDialog(account);
    setChangePasswordMessage('');
    showDialog(dialog);
    dialog.scrollTop = 0;
    window.setTimeout(() => document.getElementById('currentPassword')?.focus(), 40);
  }

  function closeChangePasswordDialog() {
    const dialog = document.getElementById('changePasswordDialog');
    const form = document.getElementById('changePasswordForm');
    closeDialog(dialog);
    form?.reset();
    document.querySelectorAll('[data-password-requirements-for="changeNewPassword"]').forEach(updatePasswordChecklist);
    setChangePasswordMessage('');

    const account = document.getElementById('accountDialog');
    if (changePasswordReturnToAccount && account) {
      showDialog(account);
    }

    if (changePasswordPreviouslyFocusedElement && typeof changePasswordPreviouslyFocusedElement.focus === 'function') {
      window.setTimeout(() => changePasswordPreviouslyFocusedElement?.focus({ preventScroll: true }), 30);
    }
    changePasswordPreviouslyFocusedElement = null;
    changePasswordReturnToAccount = false;
  }

  function bindChangePassword() {
    const open = document.getElementById('changePasswordOpenButton');
    const close = document.getElementById('changePasswordCloseButton');
    const dialog = document.getElementById('changePasswordDialog');
    const form = document.getElementById('changePasswordForm');

    if (open) open.addEventListener('click', openChangePasswordDialog);
    if (close) close.addEventListener('click', closeChangePasswordDialog);

    if (dialog) {
      dialog.addEventListener('click', event => {
        if (event.target === dialog) closeChangePasswordDialog();
      });
      dialog.addEventListener('cancel', event => {
        event.preventDefault();
        closeChangePasswordDialog();
      });
    }

    if (form) form.addEventListener('submit', changePassword);
  }

  function syncAccountAuthMessageVisibility() {
    const signedInPanel = document.getElementById('authSignedInPanel');
    const authMessage = document.getElementById('authMessage');
    if (!signedInPanel || !authMessage) return;
    authMessage.hidden = !signedInPanel.classList.contains('hidden');
  }

  function bindAccountMessageVisibility() {
    const signedInPanel = document.getElementById('authSignedInPanel');
    if (!signedInPanel) return;
    syncAccountAuthMessageVisibility();
    const observer = new MutationObserver(syncAccountAuthMessageVisibility);
    observer.observe(signedInPanel, { attributes: true, attributeFilter: ['class'] });
  }

  function initializeInterfaceEnhancements() {
    updateButtons();
    updateSafeAreaFallback();
    bindPasswordToggles();
    bindPasswordValidation();
    bindAuthNavigation();
    bindFeedbackDialog();
    bindChangePassword();
    bindAccountMessageVisibility();

    if ('serviceWorker' in navigator &&
        (location.protocol === 'https:' ||
         location.hostname === 'localhost' ||
         location.hostname === '127.0.0.1')) {
      navigator.serviceWorker.register(`./service-worker.js?v=${RELEASE}`).catch(() => {
        setMessage('The app can still be used normally. Installation support could not be initialized in this browser.');
      });
    }
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredPrompt = event;
    setMessage('This browser is ready to install Deutsche Vokabeltrainer.');
    updateButtons();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    setMessage('Deutsche Vokabeltrainer was installed successfully.');
    updateButtons();
  });

  window.addEventListener('resize', updateSafeAreaFallback, { passive: true });
  window.addEventListener('orientationchange', () => window.setTimeout(updateSafeAreaFallback, 120));
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', updateSafeAreaFallback, { passive: true });
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-install-app]');
    if (!button) return;

    event.preventDefault();
    installApp().catch(showInstallHelp);
  });

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    closeInstallHelp();
  });

  document.addEventListener('DOMContentLoaded', initializeInterfaceEnhancements);

  const standaloneQuery = window.matchMedia('(display-mode: standalone)');
  if (typeof standaloneQuery.addEventListener === 'function') {
    standaloneQuery.addEventListener('change', () => {
      updateButtons();
      updateSafeAreaFallback();
    });
  }
})();
