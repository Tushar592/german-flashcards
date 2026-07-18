(() => {
  'use strict';

  const CONFIG = window.DEUTSCHE_VOKABELTRAINER_CONFIG || {};
  const SUPABASE_URL = normalizeSupabaseUrl(CONFIG.supabaseUrl);
  const SUPABASE_KEY = String(CONFIG.supabasePublishableKey || '').trim();
  const GUEST_PROGRESS_KEY = 'dv_guest_progress_v1';
  const USER_CACHE_PREFIX = 'dv_user_progress_cache_v1_';
  const PENDING_PREFIX = 'dv_user_progress_pending_v1_';
  const DEFAULT_PREFERENCES = Object.freeze({
    theme: 'system',
    round_length: 50,
    selected_decks: [],
    selected_levels: [],
    selected_types: []
  });

  const state = {
    configured: isConfigured(),
    client: null,
    session: null,
    user: null,
    profile: null,
    preferences: Object.assign({}, DEFAULT_PREFERENCES),
    progress: new Map(),
    initialized: false,
    sessionHandledFor: '',
    preferenceTimer: 0,
    pendingPreferencePatch: {},
    recoveryMode: false
  };

  const el = {};
  let readyResolve;
  const ready = new Promise(resolve => { readyResolve = resolve; });

  window.DVAccount = Object.freeze({
    ready,
    isConfigured: () => state.configured,
    isSignedIn: () => Boolean(state.user),
    getUser: () => state.user,
    getIdentity,
    getPreferences: () => Object.assign({}, state.preferences),
    getProgressCount: () => state.progress.size,
    open: openAccountDialog,
    recordAnswer,
    savePreferences,
    refresh: refreshAccountData
  });

  document.addEventListener('DOMContentLoaded', initialize);

  async function initialize() {
    cacheElements();
    bindEvents();
    state.progress = loadGuestProgressMap();
    renderAccountState();

    if (!state.configured) {
      setAuthMessage('Supabase is not configured yet. Guest progress will stay on this device.', 'info');
      state.initialized = true;
      readyResolve();
      return;
    }

    try {
      state.client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storageKey: 'dv_supabase_auth_v1'
        }
      });

      state.client.auth.onAuthStateChange((event, session) => {
        window.setTimeout(() => handleAuthEvent(event, session), 0);
      });

      const result = await state.client.auth.getSession();
      if (result.error) throw result.error;
      await handleSession(result.data.session, 'INITIAL_SESSION');
    } catch (error) {
      console.error('Supabase initialization failed:', error);
      state.configured = false;
      setAuthMessage('Account sync could not start. Guest mode remains available.', 'error');
      renderAccountState();
    } finally {
      state.initialized = true;
      readyResolve();
    }
  }

  function normalizeSupabaseUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      const url = new URL(raw);
      if (!/^[a-z0-9-]+\.supabase\.co$/i.test(url.hostname)) return raw.replace(/\/$/, '');
      return url.origin;
    } catch (error) {
      return raw
        .replace(/\/(?:rest|auth|storage)\/v1\/?$/i, '')
        .replace(/\/$/, '');
    }
  }

  function isConfigured() {
    if (!SUPABASE_URL || !SUPABASE_KEY) return false;
    if (/PASTE_|YOUR_|example/i.test(SUPABASE_URL + SUPABASE_KEY)) return false;
    return /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(SUPABASE_URL) && SUPABASE_KEY.length > 30;
  }

  function cacheElements() {
    [
      'accountDialog', 'accountDialogClose', 'accountOpenButton', 'accountOpenMobileButton',
      'accountSidebarTitle', 'accountSidebarSubtitle', 'accountMobileLabel',
      'authGuestPanel', 'authSignedInPanel', 'authRecoveryPanel', 'authConfigNotice',
      'authModeSignIn', 'authModeCreate', 'authModeReset',
      'signInForm', 'signInEmail', 'signInPassword',
      'createAccountForm', 'createDisplayName', 'createEmail', 'createPassword',
      'resetPasswordForm', 'resetEmail',
      'recoveryPasswordForm', 'recoveryNewPassword', 'recoveryConfirmPassword',
      'authMessage', 'signedInEmail', 'signedInDisplayName', 'signedInProgressCount',
      'signOutButton', 'deleteAccountButton', 'clearGuestProgressButton'
    ].forEach(id => { el[id] = document.getElementById(id); });
  }

  function bindEvents() {
    if (el.accountOpenButton) el.accountOpenButton.addEventListener('click', openAccountDialog);
    if (el.accountOpenMobileButton) el.accountOpenMobileButton.addEventListener('click', openAccountDialog);
    if (el.accountDialogClose) el.accountDialogClose.addEventListener('click', closeAccountDialog);

    if (el.accountDialog) {
      el.accountDialog.addEventListener('click', event => {
        if (event.target === el.accountDialog) closeAccountDialog();
      });
      el.accountDialog.addEventListener('cancel', event => {
        event.preventDefault();
        closeAccountDialog();
      });
    }

    if (el.authModeSignIn) el.authModeSignIn.addEventListener('click', () => setAuthMode('signin'));
    if (el.authModeCreate) el.authModeCreate.addEventListener('click', () => setAuthMode('create'));
    if (el.authModeReset) el.authModeReset.addEventListener('click', () => setAuthMode('reset'));
    if (el.signInForm) el.signInForm.addEventListener('submit', signIn);
    if (el.createAccountForm) el.createAccountForm.addEventListener('submit', createAccount);
    if (el.resetPasswordForm) el.resetPasswordForm.addEventListener('submit', sendPasswordReset);
    if (el.recoveryPasswordForm) el.recoveryPasswordForm.addEventListener('submit', updateRecoveredPassword);
    if (el.signOutButton) el.signOutButton.addEventListener('click', signOut);
    if (el.deleteAccountButton) el.deleteAccountButton.addEventListener('click', deleteAccount);
    if (el.clearGuestProgressButton) el.clearGuestProgressButton.addEventListener('click', clearGuestProgress);
  }

  function openAccountDialog() {
    if (!el.accountDialog) return;
    renderAccountState();
    if (typeof el.accountDialog.showModal === 'function') {
      if (!el.accountDialog.open) el.accountDialog.showModal();
    } else {
      el.accountDialog.setAttribute('open', '');
    }
    window.setTimeout(() => {
      const focusTarget = state.user
        ? el.signOutButton
        : (state.recoveryMode ? el.recoveryNewPassword : el.signInEmail);
      if (focusTarget) focusTarget.focus();
    }, 30);
  }

  function closeAccountDialog() {
    if (!el.accountDialog) return;
    if (typeof el.accountDialog.close === 'function' && el.accountDialog.open) {
      el.accountDialog.close();
    } else {
      el.accountDialog.removeAttribute('open');
    }
  }

  function setAuthMode(mode) {
    const normalized = ['signin', 'create', 'reset'].includes(mode) ? mode : 'signin';
    el.signInForm.classList.toggle('hidden', normalized !== 'signin');
    el.createAccountForm.classList.toggle('hidden', normalized !== 'create');
    el.resetPasswordForm.classList.toggle('hidden', normalized !== 'reset');
    [
      [el.authModeSignIn, normalized === 'signin'],
      [el.authModeCreate, normalized === 'create'],
      [el.authModeReset, normalized === 'reset']
    ].forEach(([button, active]) => {
      if (!button) return;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    setAuthMessage('', 'info');
  }

  async function signIn(event) {
    event.preventDefault();
    if (!requireConfigured()) return;
    setFormBusy(el.signInForm, true);
    setAuthMessage('Signing in…', 'info');
    try {
      const result = await state.client.auth.signInWithPassword({
        email: String(el.signInEmail.value || '').trim(),
        password: String(el.signInPassword.value || '')
      });
      if (result.error) throw result.error;
      setAuthMessage('Signed in. Your progress is being synchronized.', 'success');
    } catch (error) {
      setAuthMessage(friendlyAuthError(error), 'error');
    } finally {
      setFormBusy(el.signInForm, false);
    }
  }

  async function createAccount(event) {
    event.preventDefault();
    if (!requireConfigured()) return;
    setFormBusy(el.createAccountForm, true);
    setAuthMessage('Creating your account…', 'info');
    try {
      const email = String(el.createEmail.value || '').trim();
      const password = String(el.createPassword.value || '');
      const displayName = String(el.createDisplayName.value || '').trim() || 'Learner';
      const result = await state.client.auth.signUp({
        email,
        password,
        options: { data: { display_name: displayName } }
      });
      if (result.error) throw result.error;
      if (result.data && result.data.session) {
        setAuthMessage('Account created and signed in.', 'success');
      } else {
        setAuthMessage('Account created. Check your email to confirm the account before signing in.', 'success');
        setAuthMode('signin');
        el.signInEmail.value = email;
      }
    } catch (error) {
      setAuthMessage(friendlyAuthError(error), 'error');
    } finally {
      setFormBusy(el.createAccountForm, false);
    }
  }

  async function sendPasswordReset(event) {
    event.preventDefault();
    if (!requireConfigured()) return;
    setFormBusy(el.resetPasswordForm, true);
    setAuthMessage('Sending the password-reset email…', 'info');
    try {
      const redirectTo = window.location.origin + window.location.pathname;
      const result = await state.client.auth.resetPasswordForEmail(
        String(el.resetEmail.value || '').trim(),
        { redirectTo }
      );
      if (result.error) throw result.error;
      setAuthMessage('Password-reset email sent. Open the link in that email on this browser.', 'success');
    } catch (error) {
      setAuthMessage(friendlyAuthError(error), 'error');
    } finally {
      setFormBusy(el.resetPasswordForm, false);
    }
  }

  async function updateRecoveredPassword(event) {
    event.preventDefault();
    if (!requireConfigured()) return;
    const password = String(el.recoveryNewPassword.value || '');
    const confirmation = String(el.recoveryConfirmPassword.value || '');
    if (password.length < 8) {
      setAuthMessage('Use a password with at least 8 characters.', 'error');
      return;
    }
    if (password !== confirmation) {
      setAuthMessage('The two passwords do not match.', 'error');
      return;
    }
    setFormBusy(el.recoveryPasswordForm, true);
    try {
      const result = await state.client.auth.updateUser({ password });
      if (result.error) throw result.error;
      state.recoveryMode = false;
      el.recoveryPasswordForm.reset();
      renderAccountState();
      setAuthMessage('Password updated successfully.', 'success');
    } catch (error) {
      setAuthMessage(friendlyAuthError(error), 'error');
    } finally {
      setFormBusy(el.recoveryPasswordForm, false);
    }
  }

  async function signOut() {
    if (!requireConfigured()) return;
    setAuthMessage('Signing out…', 'info');
    const result = await state.client.auth.signOut();
    if (result.error) {
      setAuthMessage(friendlyAuthError(result.error), 'error');
      return;
    }
    closeAccountDialog();
  }

  async function deleteAccount() {
    if (!state.user || !state.client) return;
    const confirmation = window.prompt('Type DELETE to permanently delete this learner account and all synchronized progress.');
    if (confirmation !== 'DELETE') return;

    setAuthMessage('Deleting your account…', 'info');
    try {
      const deletingUserId = state.user.id;
      const result = await state.client.rpc('delete_own_account');
      if (result.error) throw result.error;
      await state.client.auth.signOut({ scope: 'local' });
      clearUserCache(deletingUserId);
      state.user = null;
      state.session = null;
      state.profile = null;
      state.progress = loadGuestProgressMap();
      renderAccountState();
      closeAccountDialog();
    } catch (error) {
      setAuthMessage(
        /function.*does not exist|schema cache/i.test(String(error.message || ''))
          ? 'Account deletion is not enabled yet. Run the supplied Supabase migration SQL first.'
          : friendlyAuthError(error),
        'error'
      );
    }
  }

  function clearGuestProgress() {
    const count = loadGuestProgressMap().size;
    if (!count) {
      setAuthMessage('There is no guest progress stored on this device.', 'info');
      return;
    }
    if (!window.confirm('Clear all guest learning progress stored on this device?')) return;
    localStorage.removeItem(GUEST_PROGRESS_KEY);
    if (!state.user) state.progress = new Map();
    renderAccountState();
    setAuthMessage('Guest progress cleared.', 'success');
  }

  async function handleAuthEvent(event, session) {
    if (event === 'PASSWORD_RECOVERY') {
      state.recoveryMode = true;
      await handleSession(session, event);
      openAccountDialog();
      return;
    }
    await handleSession(session, event);
  }

  async function handleSession(session, event) {
    const userId = session && session.user ? session.user.id : '';
    if (userId && state.sessionHandledFor === userId && state.session && event !== 'USER_UPDATED') {
      state.session = session;
      state.user = session.user;
      renderAccountState();
      return;
    }

    state.session = session || null;
    state.user = session && session.user ? session.user : null;

    if (!state.user) {
      state.sessionHandledFor = '';
      state.profile = null;
      state.preferences = Object.assign({}, DEFAULT_PREFERENCES);
      state.progress = loadGuestProgressMap();
      renderAccountState();
      document.dispatchEvent(new CustomEvent('dv-account-changed', { detail: getIdentity() }));
      return;
    }

    state.sessionHandledFor = state.user.id;
    await refreshAccountData();
    await maybeMigrateGuestProgress();
    renderAccountState();
    document.dispatchEvent(new CustomEvent('dv-account-changed', {
      detail: getIdentity()
    }));
  }

  async function refreshAccountData() {
    if (!state.user || !state.client) return;
    await Promise.allSettled([
      loadProfile(),
      loadPreferences(),
      loadProgress()
    ]);
    await flushPendingProgress();
    renderAccountState();
  }

  async function loadProfile() {
    const result = await state.client
      .from('profiles')
      .select('display_name')
      .eq('user_id', state.user.id)
      .maybeSingle();
    if (result.error) throw result.error;
    state.profile = result.data || null;
  }

  async function loadPreferences() {
    const result = await state.client
      .from('user_preferences')
      .select('theme, round_length, selected_decks, selected_levels, selected_types')
      .eq('user_id', state.user.id)
      .maybeSingle();
    if (result.error) throw result.error;
    state.preferences = Object.assign({}, DEFAULT_PREFERENCES, result.data || {});
    document.dispatchEvent(new CustomEvent('dv-preferences-loaded', {
      detail: Object.assign({}, state.preferences)
    }));
  }

  async function loadProgress() {
    const cacheKey = USER_CACHE_PREFIX + state.user.id;
    const cached = loadMapFromStorage(cacheKey);
    if (cached.size) state.progress = cached;

    const result = await state.client
      .from('word_progress')
      .select('word_id,status,times_seen,correct_count,wrong_count,current_streak,mastery_score,last_result,last_studied_at,next_review_at,updated_at');
    if (result.error) {
      if (cached.size) {
        setAuthMessage('Showing the most recently cached progress. Cloud synchronization will retry later.', 'info');
        return;
      }
      throw result.error;
    }

    const cloudRows = Array.isArray(result.data) ? result.data : [];
    const merged = new Map(cloudRows.map(row => [row.word_id, sanitizeProgressRow(row)]));
    loadPendingRows().forEach(row => {
      const wordId = String(row.word_id || '');
      if (!wordId) return;
      merged.set(wordId, mergeProgressRows(merged.get(wordId), row));
    });
    state.progress = merged;
    saveMapToStorage(cacheKey, state.progress);
  }

  async function maybeMigrateGuestProgress() {
    const guest = loadGuestProgressMap();
    if (!guest.size || !state.user) return;
    const migrationKey = 'dv_guest_migration_prompted_v1_' + state.user.id;
    if (sessionStorage.getItem(migrationKey)) return;
    sessionStorage.setItem(migrationKey, '1');

    const accepted = window.confirm(
      'Guest progress was found on this device. Add it to this account so it can synchronize across devices?'
    );
    if (!accepted) return;

    const mergedRows = [];
    guest.forEach((guestRow, wordId) => {
      const cloudRow = state.progress.get(wordId);
      const merged = mergeProgressRows(cloudRow, guestRow);
      merged.user_id = state.user.id;
      mergedRows.push(merged);
      state.progress.set(wordId, merged);
    });

    if (mergedRows.length) {
      const result = await state.client
        .from('word_progress')
        .upsert(mergedRows, { onConflict: 'user_id,word_id' });
      if (result.error) {
        savePendingRows(mergedRows);
        setAuthMessage('Your guest progress is kept safely and will synchronize when the connection is available.', 'info');
        return;
      }
    }

    localStorage.removeItem(GUEST_PROGRESS_KEY);
    saveMapToStorage(USER_CACHE_PREFIX + state.user.id, state.progress);
    renderAccountState();
  }

  function mergeProgressRows(left, right) {
    if (!left) return sanitizeProgressRow(right);
    if (!right) return sanitizeProgressRow(left);
    const newest = Date.parse(left.last_studied_at || 0) >= Date.parse(right.last_studied_at || 0) ? left : right;
    return Object.assign({}, sanitizeProgressRow(newest), {
      word_id: String(left.word_id || right.word_id),
      times_seen: Math.max(Number(left.times_seen || 0), Number(right.times_seen || 0)),
      correct_count: Math.max(Number(left.correct_count || 0), Number(right.correct_count || 0)),
      wrong_count: Math.max(Number(left.wrong_count || 0), Number(right.wrong_count || 0)),
      mastery_score: Math.max(Number(left.mastery_score || 0), Number(right.mastery_score || 0))
    });
  }

  function recordAnswer(word, result) {
    const wordId = String(word && word.wordId || '').trim();
    if (!wordId) return Promise.resolve(false);
    const outcome = ['correct', 'almost', 'incorrect'].includes(result) ? result : 'incorrect';
    const current = sanitizeProgressRow(state.progress.get(wordId) || { word_id: wordId });
    const updated = calculateProgress(current, outcome);
    state.progress.set(wordId, updated);

    if (!state.user || !state.client) {
      saveMapToStorage(GUEST_PROGRESS_KEY, state.progress);
      renderAccountState();
      return Promise.resolve(true);
    }

    updated.user_id = state.user.id;
    saveMapToStorage(USER_CACHE_PREFIX + state.user.id, state.progress);
    renderAccountState();

    return state.client
      .from('word_progress')
      .upsert(updated, { onConflict: 'user_id,word_id' })
      .then(response => {
        if (response.error) {
          savePendingRows([updated]);
          return false;
        }
        removePendingRow(wordId);
        return true;
      })
      .catch(() => {
        savePendingRows([updated]);
        return false;
      });
  }

  function calculateProgress(row, outcome) {
    const now = new Date();
    const correct = outcome === 'correct';
    const almost = outcome === 'almost';
    const next = sanitizeProgressRow(row);

    next.times_seen += 1;
    next.last_result = outcome;
    next.last_studied_at = now.toISOString();

    if (correct || almost) {
      next.correct_count += 1;
      next.current_streak = correct ? next.current_streak + 1 : 0;
      next.mastery_score = Math.min(100, next.mastery_score + (correct ? 15 : 7));
    } else {
      next.wrong_count += 1;
      next.current_streak = 0;
      next.mastery_score = Math.max(0, next.mastery_score - 15);
    }

    if (!correct && !almost) {
      next.status = 'difficult';
    } else if (next.mastery_score >= 80 && next.correct_count >= 3) {
      next.status = 'mastered';
    } else if (next.mastery_score >= 45) {
      next.status = 'remembered';
    } else {
      next.status = 'learning';
    }

    const reviewDays = next.status === 'mastered'
      ? 14
      : next.status === 'remembered'
        ? 7
        : next.status === 'difficult'
          ? 1
          : 3;
    const nextReview = new Date(now.getTime() + reviewDays * 86400000);
    next.next_review_at = nextReview.toISOString();
    return next;
  }

  function sanitizeProgressRow(row) {
    return {
      word_id: String(row.word_id || ''),
      status: ['introduced', 'learning', 'remembered', 'difficult', 'mastered'].includes(row.status)
        ? row.status
        : 'introduced',
      times_seen: Math.max(0, Number(row.times_seen || 0)),
      correct_count: Math.max(0, Number(row.correct_count || 0)),
      wrong_count: Math.max(0, Number(row.wrong_count || 0)),
      current_streak: Math.max(0, Number(row.current_streak || 0)),
      mastery_score: Math.max(0, Math.min(100, Number(row.mastery_score || 0))),
      last_result: ['correct', 'almost', 'incorrect'].includes(row.last_result) ? row.last_result : null,
      last_studied_at: row.last_studied_at || null,
      next_review_at: row.next_review_at || null
    };
  }

  function savePreferences(patch) {
    if (!patch || typeof patch !== 'object') return;
    state.preferences = Object.assign({}, state.preferences, normalizePreferencePatch(patch));
    state.pendingPreferencePatch = Object.assign({}, state.pendingPreferencePatch, normalizePreferencePatch(patch));

    window.clearTimeout(state.preferenceTimer);
    state.preferenceTimer = window.setTimeout(flushPreferences, 450);
  }

  async function flushPreferences() {
    const patch = state.pendingPreferencePatch;
    state.pendingPreferencePatch = {};
    if (!state.user || !state.client || !Object.keys(patch).length) return;

    const row = Object.assign({ user_id: state.user.id }, state.preferences);
    const result = await state.client
      .from('user_preferences')
      .upsert(row, { onConflict: 'user_id' });
    if (result.error) {
      state.pendingPreferencePatch = Object.assign({}, patch, state.pendingPreferencePatch);
    }
  }

  function normalizePreferencePatch(patch) {
    const result = {};
    if (['system', 'light', 'dark'].includes(patch.theme)) result.theme = patch.theme;
    if (Number.isFinite(Number(patch.round_length))) {
      result.round_length = Math.max(1, Math.min(5000, Math.floor(Number(patch.round_length))));
    }
    ['selected_decks', 'selected_levels', 'selected_types'].forEach(key => {
      if (Array.isArray(patch[key])) {
        result[key] = patch[key].map(value => String(value).slice(0, 80)).slice(0, 80);
      }
    });
    return result;
  }

  async function flushPendingProgress() {
    if (!state.user || !state.client) return;
    const rows = loadPendingRows();
    if (!rows.length) return;
    const result = await state.client
      .from('word_progress')
      .upsert(rows, { onConflict: 'user_id,word_id' });
    if (!result.error) localStorage.removeItem(PENDING_PREFIX + state.user.id);
  }

  function savePendingRows(rows) {
    if (!state.user) return;
    const existing = new Map(loadPendingRows().map(row => [row.word_id, row]));
    rows.forEach(row => existing.set(row.word_id, row));
    localStorage.setItem(PENDING_PREFIX + state.user.id, JSON.stringify(Array.from(existing.values())));
  }

  function loadPendingRows() {
    if (!state.user) return [];
    try {
      const parsed = JSON.parse(localStorage.getItem(PENDING_PREFIX + state.user.id) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  function removePendingRow(wordId) {
    if (!state.user) return;
    const rows = loadPendingRows().filter(row => row.word_id !== wordId);
    if (rows.length) localStorage.setItem(PENDING_PREFIX + state.user.id, JSON.stringify(rows));
    else localStorage.removeItem(PENDING_PREFIX + state.user.id);
  }

  function loadGuestProgressMap() {
    return loadMapFromStorage(GUEST_PROGRESS_KEY);
  }

  function loadMapFromStorage(key) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return new Map();
      return new Map(Object.keys(parsed).map(wordId => [wordId, sanitizeProgressRow(parsed[wordId])]));
    } catch (error) {
      return new Map();
    }
  }

  function saveMapToStorage(key, map) {
    try {
      const object = {};
      map.forEach((row, wordId) => { object[wordId] = sanitizeProgressRow(row); });
      localStorage.setItem(key, JSON.stringify(object));
    } catch (error) {
      // Local cache is best effort only.
    }
  }

  function clearUserCache(userId) {
    if (!userId) return;
    localStorage.removeItem(USER_CACHE_PREFIX + userId);
    localStorage.removeItem(PENDING_PREFIX + userId);
  }

  function getIdentity() {
    const signedIn = Boolean(state.user);
    const displayName = state.profile && state.profile.display_name
      ? state.profile.display_name
      : (state.user && state.user.user_metadata && state.user.user_metadata.display_name) || '';
    return {
      signedIn,
      user: state.user,
      name: displayName || (signedIn ? 'Learner' : ''),
      email: state.user ? String(state.user.email || '') : ''
    };
  }

  function renderAccountState() {
    const signedIn = Boolean(state.user);
    const configured = state.configured;
    const guestCount = signedIn ? 0 : loadGuestProgressMap().size;
    const progressCount = signedIn ? state.progress.size : guestCount;

    if (el.authConfigNotice) {
      el.authConfigNotice.classList.toggle('hidden', configured);
    }
    if (el.authGuestPanel) el.authGuestPanel.classList.toggle('hidden', signedIn || state.recoveryMode);
    if (el.authSignedInPanel) el.authSignedInPanel.classList.toggle('hidden', !signedIn || state.recoveryMode);
    if (el.authRecoveryPanel) el.authRecoveryPanel.classList.toggle('hidden', !state.recoveryMode);

    const identity = getIdentity();
    const displayName = identity.name || 'Learner';

    if (el.accountSidebarTitle) el.accountSidebarTitle.textContent = signedIn ? displayName : 'Guest mode';
    if (el.accountSidebarSubtitle) {
      el.accountSidebarSubtitle.textContent = signedIn
        ? progressCount + ' studied word' + (progressCount === 1 ? '' : 's') + ' synced'
        : (configured ? 'Sign in to sync progress' : 'Progress stays on this device');
    }
    if (el.accountMobileLabel) el.accountMobileLabel.textContent = signedIn ? 'Account' : 'Sign in';
    if (el.signedInEmail) el.signedInEmail.textContent = state.user ? state.user.email || '' : '';
    if (el.signedInDisplayName) el.signedInDisplayName.textContent = displayName;
    if (el.signedInProgressCount) el.signedInProgressCount.textContent = String(progressCount);
  }

  function setAuthMessage(message, type) {
    if (!el.authMessage) return;
    el.authMessage.textContent = message || '';
    el.authMessage.className = 'auth-message' + (message ? ' ' + (type || 'info') : '');
  }

  function setFormBusy(form, busy) {
    if (!form) return;
    form.querySelectorAll('button, input').forEach(control => { control.disabled = Boolean(busy); });
  }

  function requireConfigured() {
    if (state.configured && state.client) return true;
    setAuthMessage('Add the Supabase Project URL and publishable key to config.js first.', 'error');
    return false;
  }

  function friendlyAuthError(error) {
    const message = String(error && error.message || 'The account request failed.');
    if (/invalid login credentials/i.test(message)) return 'The email or password is incorrect.';
    if (/already registered|already been registered|user already exists/i.test(message)) return 'An account already exists for this email.';
    if (/password/i.test(message) && /least|short|weak/i.test(message)) return 'Use a stronger password with at least 8 characters.';
    if (/rate limit|too many/i.test(message)) return 'Too many account requests were made. Wait a moment and try again.';
    if (/network|fetch/i.test(message)) return 'The account service could not be reached. Check the connection and retry.';
    return message.slice(0, 220);
  }
})();
