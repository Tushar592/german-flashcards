(() => {
  'use strict';

  const RELEASE = '4.6.4';
  let deferredPrompt = null;
  let previouslyFocusedElement = null;

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
        intro: 'Apple does not allow a website button to start installation directly. Use the browser Share menu:',
        steps: [
          'Tap the Share button in the browser toolbar.',
          'Choose Add to Home Screen.',
          'Confirm by tapping Add.'
        ],
        note: 'If Add to Home Screen is not shown, open this page in Safari and repeat the steps.'
      };
    }

    if (p.isAndroid) {
      return {
        title: 'Install on Android',
        intro: 'Your browser has not exposed the automatic install prompt yet. You can still install from its menu:',
        steps: [
          'Open the browser menu (usually ⋮).',
          'Choose Install app or Add to Home screen.',
          'Confirm the installation.'
        ],
        note: 'The exact wording depends on the browser.'
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
        note: 'If Add to Dock is unavailable, open the app in Chrome or Edge and use that browser’s Install option.'
      };
    }

    if (p.isFirefox) {
      return {
        title: 'Install this web app',
        intro: 'This browser did not provide a direct installation prompt.',
        steps: [
          'Open the browser menu and look for Install or Add to Home Screen.',
          'If no installation option is available, open the same page in Chrome, Edge, or Safari.',
          'Use that browser’s Install app option.'
        ],
        note: 'You can continue using the vocabulary trainer normally in this browser.'
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
        note: 'If the option is missing, reload the page once and check that you are using the secure HTTPS website.'
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
        setMessage('Installation was cancelled. You can install it later from the Guide or Account section.');
      }
    } catch (error) {
      deferredPrompt = null;
      showInstallHelp();
    }

    updateButtons();
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

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-install-app]');
    if (!button) return;

    event.preventDefault();
    installApp().catch(showInstallHelp);
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeInstallHelp();
  });

  document.addEventListener('DOMContentLoaded', () => {
    updateButtons();

    if ('serviceWorker' in navigator &&
        (location.protocol === 'https:' ||
         location.hostname === 'localhost' ||
         location.hostname === '127.0.0.1')) {
      navigator.serviceWorker.register(`./service-worker.js?v=${RELEASE}`).catch(() => {
        setMessage('The app can still be used normally. Installation support could not be initialized in this browser.');
      });
    }
  });

  const standaloneQuery = window.matchMedia('(display-mode: standalone)');
  if (typeof standaloneQuery.addEventListener === 'function') {
    standaloneQuery.addEventListener('change', updateButtons);
  }
})();
