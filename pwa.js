(() => {
  'use strict';

  let deferredPrompt = null;

  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.navigator.standalone === true;

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
    });
    if (installed) setMessage('Deutsche Vokabeltrainer is installed and running as an app.');
  };

  const showPlatformInstructions = () => {
    const ua = navigator.userAgent || '';
    const isiOS = /iphone|ipad|ipod/i.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    if (isiOS) {
      setMessage('On iPhone or iPad, open this page in Safari, tap Share, then choose Add to Home Screen.');
      return;
    }

    setMessage('Open your browser menu and choose Install app or Add to Home Screen.');
  };

  async function installApp() {
    if (isStandalone()) {
      setMessage('Deutsche Vokabeltrainer is already installed.');
      return;
    }

    if (!deferredPrompt) {
      showPlatformInstructions();
      return;
    }

    deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    deferredPrompt = null;

    if (choice && choice.outcome === 'accepted') {
      setMessage('Installation started. Open Deutsche Vokabeltrainer from your home screen or app list.');
    } else {
      setMessage('Installation was cancelled. You can install it later from the Guide or Account section.');
    }

    updateButtons();
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredPrompt = event;
    setMessage('Install the app for a full-screen experience without normal browser controls.');
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
    installApp().catch(() => showPlatformInstructions());
  });

  document.addEventListener('DOMContentLoaded', () => {
    updateButtons();

    if ('serviceWorker' in navigator &&
        (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      navigator.serviceWorker.register('./service-worker.js?v=4.6.0-beta.1').catch(() => {
        setMessage('The app can still be used normally. Installation support could not be initialized in this browser.');
      });
    }
  });

  window.matchMedia('(display-mode: standalone)').addEventListener?.('change', updateButtons);
})();
