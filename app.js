(() => {
  'use strict';

  const API_URL = String(
    window.DEUTSCHE_VOKABELTRAINER_CONFIG &&
    window.DEUTSCHE_VOKABELTRAINER_CONFIG.apiUrl || ''
  );

  async function apiCall(action, data) {
    if (!API_URL) throw new Error('The public API URL is not configured.');

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: action, data: data || {} }),
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'strict-origin-when-cross-origin'
    });

    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      throw new Error('The public API returned an invalid response.');
    }

    if (!response.ok || !payload || !payload.ok) {
      const apiError = new Error(
        payload && payload.message ? payload.message : 'The request could not be completed.'
      );
      apiError.code = payload && payload.error ? payload.error : 'REQUEST_FAILED';
      throw apiError;
    }

    return payload.result;
  }

  const REVIEW_BANK_KEY = 'df_review_bank_v2';
  const THEME_KEY = 'df_theme_v1';
  const ROUND_LENGTH_KEY = 'dv_round_length_v1';
  const LATEST_LEARN_SET_KEY = 'dv_latest_learn_set_v1';

  const FILTER_DEFINITIONS = Object.freeze({
    deck: { allValue: 'All', allLabel: 'All decks', singular: 'deck', plural: 'decks' },
    level: { allValue: 'All', allLabel: 'All levels', singular: 'level', plural: 'levels' },
    type: { allValue: 'all', allLabel: 'All words', singular: 'word type', plural: 'word types' }
  });

  const state = {
    clientId: getOrCreateClientId(),
    sessionId: '',
    source: 'backend',
    queue: [],
    seenWords: [],
    roundWords: [],
    localRoundSeed: [],
    completedRoundWords: [],
    hasMore: false,
    loadingBatch: false,
    waitingForBatch: false,
    total: 0,
    index: 0,
    current: null,
    revealed: false,
    answered: false,
    correct: 0,
    almost: 0,
    wrong: 0,
    streak: 0,
    introduced: 0,
    mode: 'learn',
    direction: 'de-en',
    writingAttempt: 1,
    reviewBank: loadReviewBank(),
    bankSnapshot: [],
    wordFormStartedAt: Date.now(),
    feedbackFormStartedAt: Date.now(),
    availableDecks: [],
    availableLevels: [],
    suggestionItemCounter: 0,
    hasStartedRound: false,
    lastMode: 'learn',
    typeSelectionBeforeArticle: ['all'],
    matchingCount: 0,
    maxRound: 500,
    pendingCloudPreferences: null,
    latestLearnedWords: loadLatestLearnedSet(),
    activeSetKind: ''
  };

  const el = {};

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    [
      'studyTabButton', 'searchTabButton', 'contributeTabButton', 'guideTabButton',
      'studyView', 'searchView', 'contributeView', 'guideView',
      'deckFilterButton', 'deckFilterMenu', 'deckFilterOptions', 'deckFilterSummary',
      'levelFilterButton', 'levelFilterMenu', 'levelFilterOptions', 'levelFilterSummary',
      'typeFilterButton', 'typeFilterMenu', 'typeFilterOptions', 'typeFilterSummary',
      'directionSelect',
      'modeSelect', 'writingSourceGroup', 'roundLengthInput', 'setupMessage', 'newRoundButton',
      'studySetupBody', 'connectionActions', 'retryButton', 'reloadButton',
      'correctCount', 'wrongCount', 'streakCount',
      'correctLabel', 'wrongLabel', 'streakLabel',
      'progressText', 'progressBar', 'restartRoundButton',
      'cardArea', 'cardButton', 'cardLanguage', 'cardWord', 'cardHint',
      'writingPanel', 'writingPatternWrap', 'writingSlotField', 'writingArticleWrap', 'writingArticleSelect',
      'writingInput', 'writingSubmitButton', 'writingFeedback', 'writingPattern',
      'writingAttemptText', 'quizOptions', 'learnActions', 'learnContinueButton', 'reviewActions',
      'practiceButton', 'almostButton', 'rememberedButton', 'nextActions', 'nextButton',
      'completePanel', 'completeScore', 'completeMessage',
      'reviewLearnedSetButton', 'writeLearnedSetButton', 'repeatReviewSetButton', 'learnMoreButton',
      'reviewWritingButton', 'reviewQuizButton', 'fullReviewWritingButton', 'backToSetupButton',
      'playAgainButton', 'publicSearchForm', 'publicSearchInput',
      'publicSearchButton', 'publicSearchMessage', 'publicSearchResults',
      'wordSuggestionForm', 'suggestionName', 'suggestionEmail',
      'suggestionItems', 'suggestionItemTemplate', 'addSuggestionItemButton',
      'suggestionNote', 'suggestionWebsite', 'suggestionConsent',
      'leaderboardOptIn', 'publicDisplayNameWrap', 'publicDisplayName',
      'submitSuggestionButton', 'suggestionMessage', 'suggestionBatchResults',
      'feedbackForm', 'feedbackName', 'feedbackEmail', 'feedbackText',
      'feedbackWebsite', 'feedbackConsent', 'submitFeedbackButton',
      'feedbackMessage'
    ].forEach(id => {
      el[id] = document.getElementById(id);
    });

    el.roundLengthInput.value = localStorage.getItem(ROUND_LENGTH_KEY) || '50';
    initializeTheme();
    document.addEventListener('dv-preferences-loaded', handleCloudPreferences);
    document.addEventListener('dv-account-changed', syncContributorIdentity);
    if (window.DVAccount && window.DVAccount.ready && typeof window.DVAccount.ready.then === 'function') {
      window.DVAccount.ready.then(() => {
        if (!window.DVAccount) return;
        if (typeof window.DVAccount.getPreferences === 'function') {
          const preferences = window.DVAccount.getPreferences();
          if (preferences) handleCloudPreferences({ detail: preferences });
        }
        if (typeof window.DVAccount.getIdentity === 'function') {
          syncContributorIdentity(window.DVAccount.getIdentity());
        }
      }).catch(() => {});
    }
    initializeMultiSelectControls();
    bindEvents();
    syncModeControls();
    updateStats();
    loadMeta();
  }

  function bindEvents() {
    el.studyTabButton.addEventListener('click', () => showView('study'));
    el.searchTabButton.addEventListener('click', () => showView('search'));
    el.contributeTabButton.addEventListener('click', () => showView('contribute'));
    el.guideTabButton.addEventListener('click', () => showView('guide'));
    el.newRoundButton.addEventListener('click', startBackendRound);
    document.querySelectorAll('[data-theme-toggle]').forEach(button => {
      button.addEventListener('click', toggleTheme);
    });
    el.playAgainButton.addEventListener('click', startBackendRound);
    el.retryButton.addEventListener('click', loadMeta);
    el.reloadButton.addEventListener('click', () => window.location.reload());
    el.cardButton.addEventListener('click', revealReviewCard);
    el.learnContinueButton.addEventListener('click', completeLearnStep);
    el.practiceButton.addEventListener('click', () => scoreReview('incorrect'));
    el.almostButton.addEventListener('click', () => scoreReview('almost'));
    el.rememberedButton.addEventListener('click', () => scoreReview('correct'));
    el.nextButton.addEventListener('click', advance);
    el.restartRoundButton.addEventListener('click', restartCurrentRound);
    el.modeSelect.addEventListener('change', () => {
      syncModeControls();
      handleRoundLengthChange();
      updateRoundAvailability();
    });
    el.roundLengthInput.addEventListener('change', handleRoundLengthChange);
    el.roundLengthInput.addEventListener('blur', handleRoundLengthChange);
    el.roundLengthInput.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      handleRoundLengthChange();
      el.newRoundButton.focus();
    });
    el.leaderboardOptIn.addEventListener('change', syncLeaderboardOptIn);
    el.writingSubmitButton.addEventListener('click', submitWritingAnswer);
    el.writingPattern.addEventListener('input', handleWritingSlotInput);
    el.writingPattern.addEventListener('keydown', handleWritingSlotKeydown);
    el.writingPattern.addEventListener('paste', handleWritingSlotPaste);
    el.writingPattern.addEventListener('focusin', handleWritingPatternFocusIn);
    el.writingPattern.addEventListener('focusout', handleWritingPatternFocusOut);
    el.writingSlotField.addEventListener('click', event => {
      if (event.target === el.writingSlotField || event.target === el.writingPattern) {
        focusFirstAvailableWritingSlot();
      }
    });


    document.querySelectorAll('input[name="writingSource"]').forEach(input => {
      input.addEventListener('change', () => updateRoundAvailability());
    });
    el.reviewLearnedSetButton.addEventListener('click', () => startLatestLearnedSetRound('review'));
    el.writeLearnedSetButton.addEventListener('click', () => startLatestLearnedSetRound('writing'));
    el.repeatReviewSetButton.addEventListener('click', repeatCompletedReviewRound);
    el.learnMoreButton.addEventListener('click', startBackendRound);
    el.reviewWritingButton.addEventListener('click', () => startReviewBankRound('writing'));
    el.reviewQuizButton.addEventListener('click', () => startReviewBankRound('quiz'));
    el.fullReviewWritingButton.addEventListener('click', startCompletedReviewWritingRound);
    el.backToSetupButton.addEventListener('click', focusStudySetup);
    el.publicSearchForm.addEventListener('submit', runPublicSearch);
    el.addSuggestionItemButton.addEventListener('click', () => addSuggestionItem());
    el.suggestionItems.addEventListener('click', handleSuggestionItemsClick);
    el.suggestionItems.addEventListener('change', handleSuggestionItemsChange);
    el.wordSuggestionForm.addEventListener('submit', submitWordSuggestionForm);
    el.feedbackForm.addEventListener('submit', submitFeedbackForm);
    enableTabKeyboard('.app-tab');
  }


  function initializeTheme() {
    const savedTheme = localStorage.getItem(THEME_KEY);
    const preferredTheme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
    applyTheme(savedTheme === 'dark' || savedTheme === 'light' ? savedTheme : preferredTheme, false);
  }

  function toggleTheme() {
    const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(nextTheme, true);
  }

  function applyTheme(theme, persist) {
    const normalized = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = normalized;
    document.documentElement.style.colorScheme = normalized;

    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.setAttribute('content', normalized === 'dark' ? '#111714' : '#f1f0ec');

    document.querySelectorAll('[data-theme-toggle]').forEach(button => {
      const darkActive = normalized === 'dark';
      const icon = button.querySelector('.theme-toggle-icon');
      const label = button.querySelector('.theme-toggle-label');
      if (icon) icon.textContent = darkActive ? '☀' : '☾';
      if (label) label.textContent = darkActive ? 'Light mode' : 'Dark mode';
      button.setAttribute('aria-label', darkActive ? 'Switch to light mode' : 'Switch to dark mode');
      button.setAttribute('aria-pressed', darkActive ? 'true' : 'false');
    });

    if (persist) {
      localStorage.setItem(THEME_KEY, normalized);
      saveStudyPreferences({ theme: normalized });
    }
  }

  function initializeMultiSelectControls() {
    renderMultiSelectOptions('type', [
      { value: 'all', label: 'All words' },
      { value: 'noun', label: 'Nouns' },
      { value: 'verb', label: 'Verbs' },
      { value: 'adjective', label: 'Adjectives' },
      { value: 'other', label: 'Other' }
    ]);

    ['deck', 'level', 'type'].forEach(kind => {
      const refs = getMultiSelectRefs(kind);
      refs.button.addEventListener('click', event => {
        event.stopPropagation();
        toggleMultiSelectMenu(kind);
      });
      refs.menu.addEventListener('click', event => event.stopPropagation());
      refs.options.addEventListener('change', event => {
        if (!event.target.matches('input[type="checkbox"]')) return;
        handleMultiSelectChange(kind, event.target);
      });
    });

    document.addEventListener('click', closeAllMultiSelectMenus);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeAllMultiSelectMenus();
    });
  }

  function getMultiSelectRefs(kind) {
    const prefix = kind === 'type' ? 'type' : kind;
    return {
      button: el[prefix + 'FilterButton'],
      menu: el[prefix + 'FilterMenu'],
      options: el[prefix + 'FilterOptions'],
      summary: el[prefix + 'FilterSummary']
    };
  }

  function renderMultiSelectOptions(kind, options) {
    const refs = getMultiSelectRefs(kind);
    if (!refs.options) return;
    const previous = new Set(getMultiSelectValues(kind));
    refs.options.replaceChildren();

    options.forEach((option, index) => {
      const label = document.createElement('label');
      label.className = 'multi-select-option';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = option.value;
      input.checked = previous.size
        ? previous.has(option.value)
        : option.value === FILTER_DEFINITIONS[kind].allValue;
      const text = document.createElement('span');
      text.textContent = option.label;
      label.append(input, text);
      refs.options.appendChild(label);
    });

    ensureMultiSelectHasValue(kind);
    updateMultiSelectSummary(kind);
  }

  function handleMultiSelectChange(kind, changedInput) {
    const refs = getMultiSelectRefs(kind);
    const allValue = FILTER_DEFINITIONS[kind].allValue;
    const inputs = Array.from(refs.options.querySelectorAll('input[type="checkbox"]'));

    if (changedInput.value === allValue && changedInput.checked) {
      inputs.forEach(input => {
        if (input !== changedInput) input.checked = false;
      });
    } else if (changedInput.value !== allValue && changedInput.checked) {
      const allInput = inputs.find(input => input.value === allValue);
      if (allInput) allInput.checked = false;
    }

    ensureMultiSelectHasValue(kind);
    updateMultiSelectSummary(kind);
    saveStudyPreferences();
    updateRoundAvailability();
  }

  function ensureMultiSelectHasValue(kind) {
    const refs = getMultiSelectRefs(kind);
    const inputs = Array.from(refs.options.querySelectorAll('input[type="checkbox"]'));
    if (inputs.some(input => input.checked)) return;
    const allInput = inputs.find(input => input.value === FILTER_DEFINITIONS[kind].allValue);
    if (allInput) allInput.checked = true;
  }

  function getMultiSelectValues(kind) {
    const refs = getMultiSelectRefs(kind);
    if (!refs.options) return [];
    return Array.from(refs.options.querySelectorAll('input[type="checkbox"]:checked'))
      .map(input => input.value);
  }

  function setMultiSelectValues(kind, values) {
    const refs = getMultiSelectRefs(kind);
    const selected = new Set(Array.isArray(values) ? values : [values]);
    refs.options.querySelectorAll('input[type="checkbox"]').forEach(input => {
      input.checked = selected.has(input.value);
    });
    ensureMultiSelectHasValue(kind);
    updateMultiSelectSummary(kind);
  }

  function setMultiSelectDisabled(kind, disabled) {
    const refs = getMultiSelectRefs(kind);
    refs.button.disabled = Boolean(disabled);
    refs.options.querySelectorAll('input[type="checkbox"]').forEach(input => {
      input.disabled = Boolean(disabled);
    });
    if (disabled) closeMultiSelectMenu(kind);
  }

  function updateMultiSelectSummary(kind) {
    const refs = getMultiSelectRefs(kind);
    const definition = FILTER_DEFINITIONS[kind];
    const selected = getMultiSelectValues(kind);
    const allSelected = selected.includes(definition.allValue);

    if (allSelected || !selected.length) {
      refs.summary.textContent = definition.allLabel;
      return;
    }

    const labels = selected.map(value => {
      const input = Array.from(refs.options.querySelectorAll('input[type="checkbox"]'))
        .find(item => item.value === value);
      return input && input.parentElement ? input.parentElement.textContent.trim() : value;
    });

    refs.summary.textContent = labels.length <= 2
      ? labels.join(' + ')
      : labels.length + ' ' + definition.plural + ' selected';
  }

  function toggleMultiSelectMenu(kind) {
    const refs = getMultiSelectRefs(kind);
    const willOpen = refs.menu.hidden;
    closeAllMultiSelectMenus();
    refs.menu.hidden = !willOpen;
    refs.button.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    if (willOpen) {
      const firstChecked = refs.options.querySelector('input:checked') || refs.options.querySelector('input');
      if (firstChecked) window.setTimeout(() => firstChecked.focus(), 0);
    }
  }

  function closeMultiSelectMenu(kind) {
    const refs = getMultiSelectRefs(kind);
    refs.menu.hidden = true;
    refs.button.setAttribute('aria-expanded', 'false');
  }

  function closeAllMultiSelectMenus() {
    ['deck', 'level', 'type'].forEach(closeMultiSelectMenu);
  }

  function enableTabKeyboard(selector) {
    const tabs = Array.from(document.querySelectorAll(selector));

    tabs.forEach((tab, index) => {
      tab.addEventListener('keydown', event => {
        let nextIndex = null;

        if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
        if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
        if (event.key === 'Home') nextIndex = 0;
        if (event.key === 'End') nextIndex = tabs.length - 1;
        if (nextIndex === null) return;

        event.preventDefault();
        tabs[nextIndex].click();
        tabs[nextIndex].focus();
      });
    });
  }

  function showView(view) {
    const study = view === 'study';
    const search = view === 'search';
    const contribute = view === 'contribute';
    const guide = view === 'guide';

    el.studyView.classList.toggle('hidden', !study);
    el.searchView.classList.toggle('hidden', !search);
    el.contributeView.classList.toggle('hidden', !contribute);
    el.guideView.classList.toggle('hidden', !guide);
    [
      [el.studyTabButton, study],
      [el.searchTabButton, search],
      [el.contributeTabButton, contribute],
      [el.guideTabButton, guide]
    ].forEach(([button, selected]) => {
      button.classList.toggle('active', selected);
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
      button.tabIndex = selected ? 0 : -1;
    });

    if (search) {
      window.setTimeout(() => el.publicSearchInput.focus(), 50);
    } else if (contribute) {
      state.wordFormStartedAt = Date.now();
      state.feedbackFormStartedAt = Date.now();
      syncContributorIdentity();
      const firstGerman = el.suggestionItems.querySelector('[data-field="german"]');
      if (firstGerman) window.setTimeout(() => firstGerman.focus(), 50);
    }
  }

  async function loadMeta() {
    setConnectionActions(false);
    setMessage('Loading study options…');
    el.newRoundButton.disabled = true;

    try {
      const result = await apiCall('getPublicMeta', { clientId: state.clientId });
      el.newRoundButton.disabled = false;

      if (!result || !result.ok) {
        throw new Error('The study options could not be loaded.');
      }

      renderMultiSelectOptions('deck', [
        { value: 'All', label: 'All decks' }
      ].concat((result.decks || []).map(value => ({ value: value, label: value }))));

      renderMultiSelectOptions('level', [
        { value: 'All', label: 'All levels' }
      ].concat((result.levels || []).map(value => ({ value: value, label: value }))));

      state.maxRound = Number(result.maxRound || state.maxRound || 500);
      state.availableDecks = (result.decks || []).slice();
      state.availableLevels = (result.levels || ['Unassigned'])
        .filter(value => value !== 'All');
      if (!state.availableLevels.length) state.availableLevels = ['Unassigned'];

      applyPendingCloudPreferences();
      refreshSuggestionItemOptions();
      if (!el.suggestionItems.children.length) addSuggestionItem();
      await Promise.allSettled([updateRoundAvailability(), loadTopContributors()]);
      el.newRoundButton.textContent = state.hasStartedRound ? 'New round' : 'Start round';
    } catch (error) {
      el.newRoundButton.disabled = false;
      handleServerFailure(error);
    }
  }

  async function updateRoundAvailability() {
    if (!getMultiSelectValues('deck').length) return;

    const previous = getRequestedRoundLength();
    try {
      const result = await apiCall('getRoundAvailability', {
        clientId: state.clientId,
        decks: getMultiSelectValues('deck'),
        levels: getMultiSelectValues('level'),
        types: getMultiSelectValues('type'),
        mode: el.modeSelect.value,
        wordSource: getWritingSource(),
        seenWordIds: getSeenWordIds(),
        difficultWordIds: getDifficultWordIds()
      });

      const count = Number(result && result.matchingCount || 0);
      const serverMax = Number(result && result.maxRound || state.maxRound || 500);
      state.matchingCount = Math.max(0, count);
      state.maxRound = Math.max(1, serverMax);

      if (!count) {
        el.roundLengthInput.value = '1';
        el.roundLengthInput.disabled = true;
        el.newRoundButton.disabled = true;
        const mode = el.modeSelect.value;
        const message = mode === 'learn'
          ? 'No unseen words match these filters. Choose different filters or review learned words.'
          : mode === 'review'
            ? 'No learned words match these filters. Start with Learn new words.'
            : mode === 'writing' && getWritingSource() === 'learned'
              ? 'No learned words match these filters. Choose All vocabulary or learn words first.'
              : 'No words match the current filters.';
        setMessage(message, true);
        return;
      }

      const maximum = Math.max(1, Math.min(count, state.maxRound));
      el.roundLengthInput.min = '1';
      el.roundLengthInput.max = String(maximum);
      el.roundLengthInput.value = String(Math.max(1, Math.min(previous || 50, maximum)));
      el.roundLengthInput.disabled = false;
      el.newRoundButton.disabled = false;
      localStorage.setItem(ROUND_LENGTH_KEY, el.roundLengthInput.value);
      const modeLabel = el.modeSelect.value === 'learn'
        ? ' unseen word' + (count === 1 ? '' : 's') + ' available'
        : el.modeSelect.value === 'review'
          ? ' learned word' + (count === 1 ? '' : 's') + ' available'
          : el.modeSelect.value === 'writing' && getWritingSource() === 'learned'
            ? ' learned word' + (count === 1 ? '' : 's') + ' available for Writing'
            : ' word' + (count === 1 ? '' : 's') + ' match';
      setMessage(count + modeLabel + '. Enter any round length from 1 to ' + maximum + '.');
    } catch (error) {
      handleServerFailure(error);
    }
  }

  function getRequestedRoundLength() {
    const raw = Number(el.roundLengthInput && el.roundLengthInput.value || localStorage.getItem(ROUND_LENGTH_KEY) || 50);
    if (!Number.isFinite(raw)) return 50;
    return Math.max(1, Math.floor(raw));
  }

  function getEffectiveRoundLength() {
    const requested = getRequestedRoundLength();
    const available = state.matchingCount > 0 ? state.matchingCount : requested;
    const serverMaximum = Math.max(1, Math.min(available, state.maxRound || available));
    const maximum = serverMaximum;
    const effective = Math.max(1, Math.min(requested, maximum));
    el.roundLengthInput.value = String(effective);
    localStorage.setItem(ROUND_LENGTH_KEY, String(effective));
    return { requested: requested, effective: effective, maximum: maximum };
  }

  function handleRoundLengthChange() {
    const details = getEffectiveRoundLength();
    if (details.requested !== details.effective) {
      setMessage('The round length was adjusted to ' + details.effective + ', the maximum available for these filters.');
    }
    saveStudyPreferences({ round_length: details.effective });
  }

  function handleCloudPreferences(event) {
    state.pendingCloudPreferences = event && event.detail ? event.detail : null;
    applyPendingCloudPreferences();
  }

  function applyPendingCloudPreferences() {
    const preferences = state.pendingCloudPreferences;
    if (!preferences || !state.availableDecks.length) return;

    if (preferences.theme === 'dark' || preferences.theme === 'light') {
      applyTheme(preferences.theme, false);
      localStorage.setItem(THEME_KEY, preferences.theme);
    }

    const decks = Array.isArray(preferences.selected_decks) && preferences.selected_decks.length
      ? preferences.selected_decks.filter(value => value === 'All' || state.availableDecks.includes(value))
      : ['All'];
    const levels = Array.isArray(preferences.selected_levels) && preferences.selected_levels.length
      ? preferences.selected_levels.filter(value => value === 'All' || state.availableLevels.includes(value))
      : ['All'];
    const types = Array.isArray(preferences.selected_types) && preferences.selected_types.length
      ? preferences.selected_types.filter(value => ['all', 'noun', 'verb', 'adjective', 'other'].includes(value))
      : ['all'];

    setMultiSelectValues('deck', decks.length ? decks : ['All']);
    setMultiSelectValues('level', levels.length ? levels : ['All']);
    setMultiSelectValues('type', types.length ? types : ['all']);

    if (Number.isFinite(Number(preferences.round_length))) {
      el.roundLengthInput.value = String(Math.max(1, Math.floor(Number(preferences.round_length))));
      localStorage.setItem(ROUND_LENGTH_KEY, el.roundLengthInput.value);
    }

    state.pendingCloudPreferences = null;
  }

  function saveStudyPreferences(patch) {
    if (!window.DVAccount || typeof window.DVAccount.savePreferences !== 'function') return;
    const payload = Object.assign({
      theme: document.documentElement.dataset.theme || 'light',
      round_length: getRequestedRoundLength(),
      selected_decks: getMultiSelectValues('deck'),
      selected_levels: getMultiSelectValues('level'),
      selected_types: getMultiSelectValues('type')
    }, patch || {});
    window.DVAccount.savePreferences(payload);
  }

  async function loadTopContributors() {
    try {
      const result = await apiCall('getTopContributors', { clientId: state.clientId });
      renderTopContributors(result && result.contributors || []);
    } catch (error) {
      renderTopContributors([]);
    }
  }

  function renderTopContributors(contributors) {
    document.querySelectorAll('[data-leaderboard-list]').forEach(list => {
      list.replaceChildren();
      if (!contributors.length) {
        const empty = document.createElement('li');
        empty.className = 'leaderboard-empty';
        empty.textContent = 'No approved public contributions yet.';
        list.appendChild(empty);
        return;
      }

      contributors.forEach(item => {
        const row = document.createElement('li');
        row.className = 'leaderboard-item';
        const rank = document.createElement('span');
        rank.className = 'leaderboard-rank';
        rank.textContent = String(item.rank || '');
        const name = document.createElement('span');
        name.className = 'leaderboard-name';
        name.textContent = item.name || 'Contributor';
        const count = document.createElement('span');
        count.className = 'leaderboard-count';
        count.textContent = String(item.approvedWords || 0);
        count.title = 'Approved words';
        row.append(rank, name, count);
        list.appendChild(row);
      });
    });
  }

  function syncContributorIdentity(eventOrIdentity) {
    let identity = eventOrIdentity && eventOrIdentity.detail
      ? eventOrIdentity.detail
      : eventOrIdentity;

    if ((!identity || typeof identity !== 'object') && window.DVAccount && typeof window.DVAccount.getIdentity === 'function') {
      identity = window.DVAccount.getIdentity();
    }

    const signedIn = Boolean(identity && identity.signedIn);
    const name = signedIn ? String(identity.name || 'Learner').trim() : '';
    const email = signedIn ? String(identity.email || '').trim() : '';

    applyContributorIdentity({
      signedIn,
      name,
      email,
      nameInput: el.suggestionName,
      emailInput: el.suggestionEmail
    });

    applyContributorIdentity({
      signedIn,
      name,
      email,
      nameInput: el.feedbackName,
      emailInput: el.feedbackEmail
    });

    if (signedIn && el.leaderboardOptIn && el.leaderboardOptIn.checked && el.publicDisplayName && !el.publicDisplayName.value.trim()) {
      el.publicDisplayName.value = name;
    }
  }

  function applyContributorIdentity(options) {
    if (!options.nameInput || !options.emailInput) return;

    if (options.signedIn) {
      options.nameInput.value = options.name;
      options.emailInput.value = options.email;
      options.nameInput.dataset.accountFilled = 'true';
      options.emailInput.dataset.accountFilled = 'true';
      options.nameInput.readOnly = true;
      options.emailInput.readOnly = true;
      return;
    }

    if (options.nameInput.dataset.accountFilled === 'true') options.nameInput.value = '';
    if (options.emailInput.dataset.accountFilled === 'true') options.emailInput.value = '';
    delete options.nameInput.dataset.accountFilled;
    delete options.emailInput.dataset.accountFilled;
    options.nameInput.readOnly = false;
    options.emailInput.readOnly = false;
  }

  function syncLeaderboardOptIn() {
    const enabled = Boolean(el.leaderboardOptIn.checked);
    el.publicDisplayNameWrap.classList.toggle('hidden', !enabled);
    el.publicDisplayName.required = enabled;
    if (enabled && !el.publicDisplayName.value.trim()) {
      el.publicDisplayName.value = el.suggestionName.value.trim();
    }
  }

  function fillSelect(select, values, labelFormatter) {
    const previous = select.value;
    select.replaceChildren();

    values.forEach(value => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = labelFormatter ? labelFormatter(value) : value;
      select.appendChild(option);
    });

    if (values.indexOf(previous) >= 0) select.value = previous;
  }

  function syncModeControls() {
    const mode = el.modeSelect.value;
    const articleMode = mode === 'article';
    const writingMode = mode === 'writing';
    const learnMode = mode === 'learn';

    el.directionSelect.disabled = articleMode || writingMode || learnMode;
    if (el.writingSourceGroup) el.writingSourceGroup.classList.toggle('hidden', !writingMode);

    if (articleMode && state.lastMode !== 'article') {
      state.typeSelectionBeforeArticle = getMultiSelectValues('type');
      setMultiSelectValues('type', ['noun']);
    } else if (!articleMode && state.lastMode === 'article') {
      setMultiSelectValues(
        'type',
        state.typeSelectionBeforeArticle && state.typeSelectionBeforeArticle.length
          ? state.typeSelectionBeforeArticle
          : ['all']
      );
    }

    setMultiSelectDisabled('type', articleMode);

    if (writingMode) {
      el.directionSelect.value = 'en-de';
    }

    state.lastMode = mode;
    updateStatLabels(mode);
    updateStats();
  }

  function getWritingSource() {
    const selected = document.querySelector('input[name="writingSource"]:checked');
    return selected && selected.value === 'all' ? 'all' : 'learned';
  }

  function getSeenWordIds() {
    if (!window.DVAccount || typeof window.DVAccount.getSeenWordIds !== 'function') return [];
    return window.DVAccount.getSeenWordIds().slice(0, 4000);
  }

  function getDifficultWordIds() {
    if (!window.DVAccount || typeof window.DVAccount.getDifficultWordIds !== 'function') return [];
    return window.DVAccount.getDifficultWordIds().slice(0, 4000);
  }

  async function startBackendRound() {
    showView('study');
    state.source = 'backend';
    state.sessionId = '';
    state.localRoundSeed = [];
    state.completedRoundWords = [];
    state.activeSetKind = '';
    prepareRoundState(el.modeSelect.value, el.directionSelect.value);
    state.bankSnapshot = cloneWords(state.reviewBank);

    resetCardUi();
    setMessage('Preparing your study round…');
    el.newRoundButton.textContent = 'Starting…';
    el.newRoundButton.disabled = true;

    try {
      const roundLength = getEffectiveRoundLength();
      if (roundLength.requested > roundLength.effective) {
        setMessage('Only ' + roundLength.effective + ' words can be used with the current filters.');
      }
      saveStudyPreferences({ round_length: roundLength.effective });
      const result = await apiCall('startStudy', {
        clientId: state.clientId,
        decks: getMultiSelectValues('deck'),
        levels: getMultiSelectValues('level'),
        types: getMultiSelectValues('type'),
        mode: state.mode,
        roundLength: roundLength.effective,
        wordSource: getWritingSource(),
        seenWordIds: getSeenWordIds(),
        difficultWordIds: getDifficultWordIds()
      });

      el.newRoundButton.disabled = false;
      state.loadingBatch = false;
      if (!result || !result.ok) {
        el.newRoundButton.textContent = state.hasStartedRound ? 'New round' : 'Start round';
        setMessage((result && result.message) || 'The round could not be started.', true);
        return;
      }

      state.hasStartedRound = true;
      el.newRoundButton.textContent = 'New round';
      state.sessionId = result.sessionId;
      const words = annotateWords(result.words || [], state.sessionId);
      state.queue = expandWordsForLearningFlow(words, state.mode);
      state.roundWords = cloneWords(words);
      state.hasMore = Boolean(result.hasMore);
      state.total = Number(result.stepTotal || result.total || state.queue.length);
      state.source = 'backend';

      setMessage('Round ready.');
      el.restartRoundButton.classList.remove('hidden');
      showNextCard();
      prefetchIfNeeded();
    } catch (error) {
      el.newRoundButton.textContent = state.hasStartedRound ? 'New round' : 'Start round';
      el.newRoundButton.disabled = false;
      state.loadingBatch = false;
      handleServerFailure(error);
    }
  }

  function prepareRoundState(mode, direction) {
    state.queue = [];
    state.seenWords = [];
    state.roundWords = [];
    state.hasMore = false;
    state.loadingBatch = true;
    state.waitingForBatch = false;
    state.total = 0;
    state.index = 0;
    state.current = null;
    state.revealed = false;
    state.answered = false;
    state.correct = 0;
    state.almost = 0;
    state.wrong = 0;
    state.streak = 0;
    state.introduced = 0;
    state.mode = mode || 'review';
    state.direction = direction || 'de-en';
    state.writingAttempt = 1;
    updateStatLabels(state.mode);
    updateStats();
  }

  function showNextCard() {
    if (!state.queue.length) {
      if (state.hasMore) {
        state.current = null;
        state.waitingForBatch = true;
        setCard('Loading', 'Next cards…', 'Please keep this tab open.');
        fetchNextBatch();
      } else {
        finishRound();
      }
      return;
    }

    state.current = state.queue.shift();
    state.seenWords.push(state.current);
    state.revealed = false;
    state.answered = false;
    state.writingAttempt = 1;

    hideAnswerPanels();
    el.completePanel.classList.add('hidden');
    el.cardButton.classList.remove('hidden', 'revealed');
    el.cardButton.disabled = !isReviewStep();

    if (isLearnStep()) {
      renderLearnQuestion();
    } else if (state.mode === 'article') {
      renderArticleQuestion();
    } else if (state.mode === 'quiz') {
      renderQuizQuestion();
    } else if (state.mode === 'writing') {
      renderWritingQuestion();
    } else {
      renderReviewFront();
    }

    updateStats();
    prefetchIfNeeded();
  }

  function hideAnswerPanels() {
    el.quizOptions.classList.add('hidden');
    el.quizOptions.classList.remove('articles');
    el.quizOptions.replaceChildren();
    el.learnActions.classList.add('hidden');
    el.reviewActions.classList.add('hidden');
    el.nextActions.classList.add('hidden');
    el.writingPanel.classList.add('hidden');
    el.cardArea.classList.remove('writing-mode', 'learning-phase');
    el.writingPatternWrap.classList.remove('is-focused', 'is-correct', 'is-wrong', 'is-locked');
    el.writingFeedback.textContent = '';
    el.writingFeedback.className = 'writing-feedback';
  }

  function isLearnStep() {
    return Boolean(
      state.current &&
      state.mode === 'learn'
    );
  }

  function isReviewStep() {
    return Boolean(
      state.current &&
      state.mode === 'review'
    );
  }

  function renderLearnQuestion() {
    el.cardArea.classList.add('learning-phase');
    setCard(
      'New word',
      germanDisplay(state.current),
      state.current.english + (state.current.hint ? ' · ' + state.current.hint : '')
    );
    el.learnActions.classList.remove('hidden');
  }

  function completeLearnStep() {
    if (!state.current || state.answered || !isLearnStep()) return;
    state.answered = true;
    state.introduced += 1;
    recordLearningExposure(state.current);
    updateStats();
    advance();
  }

  function renderReviewFront() {
    const frontIsGerman = state.direction === 'de-en';
    setCard(
      frontIsGerman ? 'Deutsch' : 'English',
      frontIsGerman ? germanDisplay(state.current) : state.current.english,
      'Tap the card to reveal'
    );
  }

  function revealReviewCard() {
    if (!isReviewStep() || !state.current || state.revealed) return;

    state.revealed = true;
    el.cardButton.classList.add('revealed');
    const backIsGerman = state.direction === 'en-de';

    setCard(
      backIsGerman ? 'Deutsch' : 'English',
      backIsGerman ? germanDisplay(state.current) : state.current.english,
      state.current.hint || 'How well did you remember it before revealing?'
    );

    el.reviewActions.classList.remove('hidden');
  }

  function scoreReview(outcome) {
    if (state.answered || !isReviewStep()) return;

    const normalized = ['correct', 'almost', 'incorrect'].includes(outcome)
      ? outcome
      : 'incorrect';
    state.answered = true;

    if (normalized === 'correct') {
      state.correct += 1;
      state.streak += 1;
    } else if (normalized === 'almost') {
      state.almost += 1;
      state.streak = 0;
    } else {
      state.wrong += 1;
      state.streak = 0;
    }

    updateStats();
    recordLearningProgress(state.current, normalized, 'review', 1);
    el.reviewActions.classList.add('hidden');
    el.nextActions.classList.remove('hidden');
  }

  function renderQuizQuestion() {
    const frontIsGerman = state.direction === 'de-en';

    setCard(
      frontIsGerman ? 'Deutsch' : 'English',
      frontIsGerman ? germanDisplay(state.current) : state.current.english,
      state.current.hint || 'Choose the correct answer'
    );

    const candidates = buildQuizCandidates(
      state.current,
      frontIsGerman ? 'english' : 'german'
    );

    renderOptions(candidates, candidate => {
      const correct = candidate.token === state.current.token;
      recordScoredAnswer(correct);
      recordLearningProgress(state.current, correct ? 'correct' : 'incorrect', 'quiz', 1);
      markOptions(candidate.token, state.current.token);
      state.answered = true;
      el.nextActions.classList.remove('hidden');
    });
  }

  function renderArticleQuestion() {
    setCard(
      'Welcher Artikel?',
      state.current.german,
      state.current.english ? '= ' + state.current.english : 'Choose der, die or das'
    );

    const options = ['der', 'die', 'das'].map(article => ({
      token: article,
      label: article
    }));

    el.quizOptions.classList.add('articles');

    renderOptions(options, candidate => {
      const correct = candidate.token === state.current.article;
      recordScoredAnswer(correct);
      recordLearningProgress(state.current, correct ? 'correct' : 'incorrect', 'article', 1);
      markOptions(candidate.token, state.current.article);
      state.answered = true;
      el.nextActions.classList.remove('hidden');
    });
  }

  function renderWritingQuestion() {
    setCard(
      'English → Deutsch',
      state.current.english,
      state.current.hint || 'Type the German word'
    );

    el.cardArea.classList.add('writing-mode');
    el.writingPanel.classList.remove('hidden');
    el.writingArticleWrap.classList.toggle(
      'hidden',
      !(state.current.type === 'noun' && isGermanArticle(state.current.article))
    );

    el.writingArticleSelect.value = '';
    el.writingInput.value = '';
    el.writingInput.disabled = false;
    el.writingArticleSelect.disabled = false;
    el.writingSubmitButton.disabled = false;
    el.writingPatternWrap.classList.remove('is-correct', 'is-wrong', 'is-locked');
    renderWritingPattern(state.current.german || '', '');
    el.writingAttemptText.textContent = 'Attempt 1 of 2';
    window.setTimeout(() => focusWritingSlot(0, true), 50);
  }

  async function submitWritingAnswer() {
    if (state.mode !== 'writing' || !state.current || state.answered) return;

    const parsed = parseTypedAnswer(
      getWritingAnswer(),
      el.writingArticleSelect.value
    );

    if (!getWritingLetterInputs().some(input => Boolean(input.value))) {
      setWritingFeedback('Enter the German word in the letter slots before checking.', 'wrong');
      focusFirstAvailableWritingSlot();
      return;
    }

    el.writingSubmitButton.disabled = true;
    const sessionId = state.current.originSessionId || state.sessionId;

    if (sessionId && isUuid(state.current.token)) {
      try {
        const result = await apiCall('validateWritingAnswer', {
          sessionId: sessionId,
          clientId: state.clientId,
          cardToken: state.current.token,
          german: parsed.german,
          article: parsed.article
        });
        el.writingSubmitButton.disabled = false;
        handleWritingValidationResult(parsed, result);
      } catch (error) {
        el.writingSubmitButton.disabled = false;
        handleWritingValidationResult(parsed, localWritingValidation(parsed, state.current));
      }
    } else {
      el.writingSubmitButton.disabled = false;
      handleWritingValidationResult(parsed, localWritingValidation(parsed, state.current));
    }
  }

  function handleWritingValidationResult(parsed, result) {
    if (result && result.ok && result.correct) {
      completeWritingAttempt(true, result.acceptedAlternative, result.matched);
      return;
    }

    const articleIssue = result && result.articleIssue ? result.articleIssue : '';
    const feedback = diagnoseWritingMistake(parsed, state.current, articleIssue);

    if (state.writingAttempt === 1) {
      state.wrong += 1;
      state.streak = 0;
      addDifficultWord(state.current);
      updateStats();
      setWritingFeedback(feedback, 'hint');
      state.writingAttempt = 2;
      el.writingAttemptText.textContent = 'Attempt 2 of 2';
      el.writingPatternWrap.classList.remove('is-wrong');
      focusWritingSlot(0, true);
      return;
    }

    state.answered = true;
    recordLearningProgress(state.current, 'incorrect', 'writing', 2);
    setWritingFeedback(
      feedback,
      'wrong',
      germanDisplay(state.current),
      'Correct answer'
    );
    lockWritingInputs();
    el.nextActions.classList.remove('hidden');
  }

  function completeWritingAttempt(correct, acceptedAlternative, matched) {
    if (state.writingAttempt === 1) {
      state.correct += 1;
      state.streak += 1;
      updateStats();
    }

    state.answered = true;
    const matchedText = matched
      ? ((matched.article ? matched.article + ' ' : '') + matched.german)
      : germanDisplay(state.current);

    recordLearningProgress(
      state.current,
      state.writingAttempt === 1 ? 'correct' : 'almost',
      'writing',
      state.writingAttempt
    );
    setWritingFeedback(
      acceptedAlternative
        ? 'Correct alternative accepted.'
        : (state.writingAttempt === 1 ? 'Correct.' : 'Correct on the second attempt.'),
      'correct',
      matchedText,
      acceptedAlternative ? 'Accepted answer' : 'Correct answer'
    );

    lockWritingInputs();
    el.nextActions.classList.remove('hidden');
  }

  function lockWritingInputs() {
    el.writingInput.disabled = true;
    getWritingLetterInputs().forEach(input => { input.disabled = true; });
    el.writingArticleSelect.disabled = true;
    el.writingSubmitButton.disabled = true;
    el.writingPatternWrap.classList.add('is-locked');
    el.writingPatternWrap.classList.remove('is-focused');
  }

  function localWritingValidation(parsed, word) {
    const wordCorrect = normalizeExact(parsed.german) === normalizeExact(word.german);
    let articleIssue = '';
    let correct = wordCorrect;

    if (wordCorrect && word.type === 'noun' && isGermanArticle(word.article)) {
      if (!parsed.article) {
        correct = false;
        articleIssue = 'MISSING_ARTICLE';
      } else if (parsed.article !== word.article) {
        correct = false;
        articleIssue = 'WRONG_ARTICLE';
      }
    }

    return {
      ok: true,
      correct: correct,
      acceptedAlternative: false,
      matched: correct ? { german: word.german, article: word.article } : null,
      articleIssue: articleIssue
    };
  }

  function diagnoseWritingMistake(parsed, expectedWord, articleIssue) {
    const typed = normalizeExact(parsed.german);
    const expected = normalizeExact(expectedWord.german);
    const typedLower = typed.toLocaleLowerCase('de-DE');
    const expectedLower = expected.toLocaleLowerCase('de-DE');

    if (articleIssue === 'MISSING_ARTICLE') {
      return 'The word is correct, but the article is missing.';
    }

    if (articleIssue === 'WRONG_ARTICLE') {
      return 'The word is correct, but the article is not correct.';
    }

    if (typedLower === expectedLower && typed !== expected) {
      if (expectedWord.type === 'noun') {
        return 'German nouns begin with a capital letter.';
      }
      return 'Check the capitalization.';
    }

    const umlautReplacement = findUmlautReplacement(expectedLower, typedLower);
    if (umlautReplacement) {
      return 'Use ' + umlautReplacement.umlaut + ' instead of ' + umlautReplacement.sequence + '.';
    }

    const missedUmlaut = findMissedUmlaut(expectedLower, typedLower);
    if (missedUmlaut) {
      return 'You missed the umlaut on ' + missedUmlaut + '.';
    }

    if (expectedLower.indexOf('ß') >= 0 && expectedLower.replace(/ß/g, 'ss') === typedLower) {
      return 'Use ß instead of ss in this word.';
    }

    const distance = levenshtein(typedLower, expectedLower);

    if (distance === 1) {
      if (typedLower.length < expectedLower.length) return 'One letter is missing.';
      if (typedLower.length > expectedLower.length) return 'There is one extra letter.';
      return 'One letter is incorrect.';
    }

    if (distance === 2) {
      return 'Very close. Check two letters or their order.';
    }

    return 'Not quite. Check the spelling and try once more.';
  }

  function findUmlautReplacement(expected, typed) {
    const replacements = [
      { umlaut: 'ä', sequence: 'ae' },
      { umlaut: 'ö', sequence: 'oe' },
      { umlaut: 'ü', sequence: 'ue' }
    ];

    for (const item of replacements) {
      if (expected.indexOf(item.umlaut) >= 0 && expected.replace(new RegExp(item.umlaut, 'g'), item.sequence) === typed) {
        return item;
      }
    }

    return null;
  }

  function findMissedUmlaut(expected, typed) {
    const replacements = [
      { umlaut: 'ä', plain: 'a' },
      { umlaut: 'ö', plain: 'o' },
      { umlaut: 'ü', plain: 'u' }
    ];

    for (const item of replacements) {
      if (expected.indexOf(item.umlaut) >= 0 && expected.replace(new RegExp(item.umlaut, 'g'), item.plain) === typed) {
        return item.umlaut;
      }
    }

    return '';
  }

  function parseTypedAnswer(input, selectedArticle) {
    let german = String(input || '').trim().replace(/\s+/g, ' ');
    let article = String(selectedArticle || '').toLocaleLowerCase('de-DE');
    const match = german.match(/^(der|die|das)\s+(.+)$/i);

    if (match) {
      article = match[1].toLocaleLowerCase('de-DE');
      german = match[2].trim();
    }

    if (!isGermanArticle(article)) article = '';
    return { german, article };
  }

  function renderWritingPattern(word, typedValue) {
    const expectedCharacters = Array.from(String(word || ''));
    const expectedLetters = expectedCharacters.filter(
      character => !/\s/u.test(character) && !/[-'’]/u.test(character)
    ).length;

    el.writingPattern.replaceChildren();
    el.writingPattern.dataset.expectedWord = String(word || '');
    el.writingPattern.style.setProperty('--writing-letter-count', String(Math.max(expectedLetters, 1)));
    el.writingPattern.classList.toggle('long-word', expectedLetters > 18);
    el.writingPattern.classList.toggle('very-long-word', expectedLetters > 28);

    let letterNumber = 0;

    expectedCharacters.forEach((expectedCharacter, characterIndex) => {
      if (/\s/u.test(expectedCharacter)) {
        const space = document.createElement('span');
        space.className = 'pattern-space';
        space.setAttribute('aria-hidden', 'true');
        el.writingPattern.appendChild(space);
        return;
      }

      if (/[-'’]/u.test(expectedCharacter)) {
        const mark = document.createElement('span');
        mark.className = 'pattern-mark';
        mark.textContent = expectedCharacter;
        mark.setAttribute('aria-hidden', 'true');
        el.writingPattern.appendChild(mark);
        return;
      }

      letterNumber += 1;
      const input = document.createElement('input');
      input.type = 'text';
      input.inputMode = 'text';
      input.maxLength = 1;
      input.autocomplete = 'off';
      input.autocapitalize = 'off';
      input.autocorrect = 'off';
      input.spellcheck = false;
      input.className = 'writing-letter-input';
      input.dataset.characterIndex = String(characterIndex);
      input.dataset.slotOrder = String(letterNumber - 1);
      input.setAttribute('aria-label', 'Letter ' + letterNumber + ' of ' + expectedLetters);
      el.writingPattern.appendChild(input);
    });

    fillWritingSlotsFromText(String(typedValue || ''), 0, true);
    syncWritingAggregate();
  }

  function getWritingLetterInputs() {
    return Array.from(el.writingPattern.querySelectorAll('.writing-letter-input'));
  }

  function getWritingExpectedInputs() {
    return getWritingLetterInputs().filter(input => input.dataset.overflow !== 'true');
  }

  function createWritingOverflowSlot(character) {
    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'text';
    input.maxLength = 1;
    input.autocomplete = 'off';
    input.autocapitalize = 'off';
    input.autocorrect = 'off';
    input.spellcheck = false;
    input.className = 'writing-letter-input pattern-extra';
    input.dataset.overflow = 'true';
    input.dataset.slotOrder = String(getWritingLetterInputs().length);
    input.setAttribute('aria-label', 'Extra letter');
    input.value = character || '';
    el.writingPattern.appendChild(input);
    return input;
  }

  function getWritingAnswer() {
    const expectedCharacters = Array.from(
      state.current && state.current.german ? state.current.german : el.writingPattern.dataset.expectedWord || ''
    );
    const inputByCharacterIndex = new Map();

    getWritingExpectedInputs().forEach(input => {
      inputByCharacterIndex.set(Number(input.dataset.characterIndex), input.value || '');
    });

    const expectedPart = expectedCharacters.map((character, index) => {
      if (/\s/u.test(character) || /[-'’]/u.test(character)) return character;
      return inputByCharacterIndex.get(index) || '';
    }).join('');

    const overflowPart = getWritingLetterInputs()
      .filter(input => input.dataset.overflow === 'true')
      .map(input => input.value || '')
      .join('');

    return (expectedPart + overflowPart).trim();
  }

  function syncWritingAggregate() {
    const answer = getWritingAnswer();
    el.writingInput.value = answer;

    getWritingLetterInputs().forEach(input => {
      input.classList.toggle('filled', Boolean(input.value));
    });

    const expectedLetters = getWritingExpectedInputs().length;
    const enteredLetters = getWritingLetterInputs().filter(input => Boolean(input.value)).length;
    el.writingPattern.setAttribute(
      'aria-label',
      expectedLetters + ' letter answer pattern. ' + enteredLetters + ' letters entered.'
    );
  }

  function fillWritingSlotsFromText(text, startIndex, clearFollowing) {
    const incomingCharacters = Array.from(String(text || ''))
      .filter(character => !/\s/u.test(character) && !/[-'’]/u.test(character));
    let inputs = getWritingLetterInputs();
    const safeStart = Math.max(0, Math.min(Number(startIndex) || 0, inputs.length));

    if (clearFollowing) {
      inputs.slice(safeStart).forEach(input => {
        input.value = '';
      });
      el.writingPattern.querySelectorAll('.writing-letter-input[data-overflow="true"]').forEach(input => input.remove());
      inputs = getWritingLetterInputs();
    }

    incomingCharacters.forEach((character, offset) => {
      const targetIndex = safeStart + offset;
      let target = inputs[targetIndex];
      if (!target) {
        target = createWritingOverflowSlot('');
        inputs = getWritingLetterInputs();
      }
      target.value = character;
    });

    syncWritingAggregate();
    return Math.min(safeStart + incomingCharacters.length, Math.max(getWritingLetterInputs().length - 1, 0));
  }

  function focusWritingSlot(index, selectContent) {
    const inputs = getWritingLetterInputs();
    if (!inputs.length) return;
    const safeIndex = Math.max(0, Math.min(Number(index) || 0, inputs.length - 1));
    const input = inputs[safeIndex];
    if (input.disabled) return;

    input.focus({ preventScroll: true });
    if (selectContent && typeof input.select === 'function') {
      input.select();
    }
  }

  function focusFirstAvailableWritingSlot() {
    const inputs = getWritingLetterInputs();
    if (!inputs.length) return;
    const emptyIndex = inputs.findIndex(input => !input.value);
    focusWritingSlot(emptyIndex >= 0 ? emptyIndex : inputs.length - 1, true);
  }

  function handleWritingPatternFocusIn(event) {
    const input = event.target.closest('.writing-letter-input');
    if (!input) return;
    el.writingPatternWrap.classList.add('is-focused');
    window.setTimeout(() => {
      if (document.activeElement === input && typeof input.select === 'function') input.select();
    }, 0);
  }

  function handleWritingPatternFocusOut() {
    window.setTimeout(() => {
      if (!el.writingPattern.contains(document.activeElement)) {
        el.writingPatternWrap.classList.remove('is-focused');
      }
    }, 0);
  }

  function handleWritingSlotInput(event) {
    const input = event.target.closest('.writing-letter-input');
    if (!input) return;

    const characters = Array.from(input.value || '').filter(character => !/\s/u.test(character));
    input.value = characters.length ? characters[characters.length - 1] : '';
    syncWritingAggregate();

    if (input.value) {
      const inputs = getWritingLetterInputs();
      const index = inputs.indexOf(input);
      if (index >= 0 && index < inputs.length - 1) {
        focusWritingSlot(index + 1, true);
      }
    }
  }

  function handleWritingSlotKeydown(event) {
    const input = event.target.closest('.writing-letter-input');
    if (!input) return;

    const inputs = getWritingLetterInputs();
    const index = inputs.indexOf(input);

    if (event.key === 'Enter') {
      event.preventDefault();
      submitWritingAnswer();
      return;
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      focusWritingSlot(index - 1, true);
      return;
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      focusWritingSlot(index + 1, true);
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      focusWritingSlot(0, true);
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      focusWritingSlot(inputs.length - 1, true);
      return;
    }

    if (event.key === 'Backspace' && !input.value && index > 0) {
      event.preventDefault();
      const previous = inputs[index - 1];
      previous.value = '';
      syncWritingAggregate();
      focusWritingSlot(index - 1, true);
      return;
    }

    if (event.key === 'Delete') {
      event.preventDefault();
      input.value = '';
      syncWritingAggregate();
      return;
    }

    if (event.key === ' ' || event.key === '-' || event.key === "'") {
      event.preventDefault();
      focusWritingSlot(index + 1, true);
      return;
    }

    if (
      event.key.length === 1 &&
      input.value &&
      input.selectionStart === input.selectionEnd &&
      index === inputs.length - 1
    ) {
      event.preventDefault();
      const overflowInput = createWritingOverflowSlot(event.key);
      syncWritingAggregate();
      overflowInput.focus({ preventScroll: true });
      overflowInput.select();
    }
  }

  function handleWritingSlotPaste(event) {
    const input = event.target.closest('.writing-letter-input');
    if (!input) return;

    event.preventDefault();
    const pastedText = event.clipboardData ? event.clipboardData.getData('text') : '';
    const inputs = getWritingLetterInputs();
    const startIndex = Math.max(0, inputs.indexOf(input));
    const finalIndex = fillWritingSlotsFromText(pastedText, startIndex, true);
    focusWritingSlot(finalIndex, true);
  }

  function setWritingFeedback(message, type, highlightedAnswer, answerLabel) {
    el.writingFeedback.replaceChildren();
    el.writingFeedback.className = 'writing-feedback' + (type ? ' ' + type : '');

    if (message) {
      const messageText = document.createElement('span');
      messageText.className = 'writing-feedback-message';
      messageText.textContent = message;
      el.writingFeedback.appendChild(messageText);
    }

    if (highlightedAnswer) {
      const answer = document.createElement('span');
      answer.className = 'writing-answer-reveal';

      const label = document.createElement('span');
      label.className = 'writing-answer-label';
      label.textContent = (answerLabel || 'Correct answer') + ':';

      const value = document.createElement('strong');
      value.className = 'writing-answer-value';
      value.textContent = highlightedAnswer;

      answer.append(label, value);
      el.writingFeedback.appendChild(answer);
    }

    el.writingPatternWrap.classList.toggle('is-correct', type === 'correct');
    el.writingPatternWrap.classList.toggle('is-wrong', type === 'wrong');
  }

  function buildQuizCandidates(correctWord, answerField) {
    const combined = uniqueWords(
      state.roundWords.concat(state.seenWords, state.queue)
    ).filter(word => word.token !== correctWord.token);

    shuffle(combined);
    const selected = [correctWord].concat(combined.slice(0, 3));
    shuffle(selected);

    return selected.map(word => ({
      token: word.token,
      label: answerField === 'german' ? germanDisplay(word) : word.english
    }));
  }

  function renderOptions(options, onChoose) {
    el.quizOptions.replaceChildren();
    el.quizOptions.classList.remove('hidden');

    options.forEach(option => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'answer-option';
      button.dataset.token = option.token;
      button.textContent = option.label;
      button.addEventListener('click', () => {
        if (state.answered) return;
        onChoose(option);
      });
      el.quizOptions.appendChild(button);
    });
  }

  function markOptions(chosenToken, correctToken) {
    Array.from(el.quizOptions.children).forEach(button => {
      button.disabled = true;
      if (button.dataset.token === correctToken) button.classList.add('correct');
      else if (button.dataset.token === chosenToken) button.classList.add('wrong');
    });
  }

  function recordScoredAnswer(correct) {
    if (correct) {
      state.correct += 1;
      state.streak += 1;
    } else {
      state.wrong += 1;
      state.streak = 0;
    }
    updateStats();
  }

  function recordLearningProgress(word, result, activity, attempt) {
    if (!word || !word.wordId || !window.DVAccount || typeof window.DVAccount.recordAnswer !== 'function') return;
    const persistence = window.DVAccount.recordAnswer(word, {
      outcome: result,
      activity: activity || state.mode || 'review',
      attempt: Number(attempt || 1)
    });
    syncDifficultWordBank(word, result);
    Promise.resolve(persistence).catch(() => {
      // Progress sync is best effort and must never interrupt a study round.
    });
  }

  function syncDifficultWordBank(word, outcome) {
    const progress = window.DVAccount && typeof window.DVAccount.getWordProgress === 'function'
      ? window.DVAccount.getWordProgress(word)
      : null;

    if (progress) {
      if (progress.status === 'difficult' || outcome === 'almost') addDifficultWord(word);
      else removeDifficultWord(word);
      return;
    }

    if (outcome === 'incorrect' || outcome === 'almost') addDifficultWord(word);
    else removeDifficultWord(word);
  }

  function recordLearningExposure(word) {
    if (!word || !word.wordId || !window.DVAccount || typeof window.DVAccount.recordExposure !== 'function') return;
    window.DVAccount.recordExposure(word).catch(() => {
      // Exposure sync is best effort and must never interrupt a study round.
    });
  }

  function advance() {
    el.nextActions.classList.add('hidden');
    state.index += 1;
    showNextCard();
  }

  function finishRound() {
    state.current = null;
    state.completedRoundWords = cloneWords(state.roundWords);
    el.cardButton.classList.add('hidden');
    hideAnswerPanels();
    el.restartRoundButton.classList.add('hidden');
    el.completePanel.classList.remove('hidden');
    resetCompletionActions();

    const reviewAnswered = state.correct + state.almost + state.wrong;
    const testAnswered = state.correct + state.wrong;

    if (state.mode === 'learn') {
      state.latestLearnedWords = cloneWords(state.completedRoundWords);
      saveLatestLearnedSet(state.latestLearnedWords);
      el.completeScore.textContent = state.introduced + ' new words';
      el.completeMessage.textContent = 'You have introduced this set. Review it now, practise its spelling, or learn another set.';
      showCompletionAction(el.reviewLearnedSetButton, true);
      showCompletionAction(el.writeLearnedSetButton, true);
      showCompletionAction(el.learnMoreButton, true);
      showCompletionAction(el.playAgainButton, false);
    } else if (state.mode === 'review') {
      el.completeScore.textContent = state.correct + ' remembered';
      el.completeMessage.textContent =
        state.almost + ' almost · ' +
        state.wrong + ' need' + (state.wrong === 1 ? 's' : '') + ' practice · ' +
        reviewAnswered + ' reviewed';
      showCompletionAction(el.repeatReviewSetButton, state.completedRoundWords.length > 0);
      showCompletionAction(el.fullReviewWritingButton, state.completedRoundWords.length > 0);
    } else {
      el.completeScore.textContent = state.correct + ' of ' + testAnswered;
      const percentage = testAnswered ? Math.round((state.correct / testAnswered) * 100) : 0;
      el.completeMessage.textContent = percentage >= 80
        ? 'Strong round. Keep reinforcing the words over time.'
        : 'The app has added weak words to your practice list.';
    }

    const hasDifficultWords = state.reviewBank.length > 0;
    showCompletionAction(el.reviewWritingButton, hasDifficultWords && state.mode !== 'learn');
    showCompletionAction(el.reviewQuizButton, hasDifficultWords && state.mode !== 'learn');
    showCompletionAction(el.backToSetupButton, true);

    state.index = state.total;
    updateStats();
  }

  function resetCompletionActions() {
    [
      el.reviewLearnedSetButton,
      el.writeLearnedSetButton,
      el.repeatReviewSetButton,
      el.learnMoreButton,
      el.reviewWritingButton,
      el.reviewQuizButton,
      el.fullReviewWritingButton,
      el.backToSetupButton,
      el.playAgainButton
    ].forEach(button => showCompletionAction(button, false));
    showCompletionAction(el.playAgainButton, true);
  }

  function showCompletionAction(button, visible) {
    if (!button) return;
    button.classList.toggle('hidden', !visible);
  }

  function startLatestLearnedSetRound(mode) {
    const words = state.latestLearnedWords.length
      ? state.latestLearnedWords
      : loadLatestLearnedSet();
    if (!words.length) {
      setMessage('No recent Learn set is available. Start a Learn new words round first.', true);
      focusStudySetup();
      return;
    }
    startLocalRound(words, mode, 'latest-learn');
  }

  function repeatCompletedReviewRound() {
    if (!state.completedRoundWords.length) return;
    startLocalRound(state.completedRoundWords, 'review', 'review-repeat');
  }

  function startReviewBankRound(mode) {
    if (!state.reviewBank.length) return;
    startLocalRound(state.reviewBank, mode, 'difficult');
  }

  function startCompletedReviewWritingRound() {
    if (!state.completedRoundWords.length) return;
    startLocalRound(state.completedRoundWords, 'writing', 'reviewed-set');
  }

  function focusStudySetup() {
    showView('study');
    el.completePanel.classList.add('hidden');
    el.cardButton.classList.remove('hidden');
    el.cardButton.disabled = true;
    setCard('Ready', 'Choose your round', 'Adjust the Study Setup and start when you are ready.');
    el.modeSelect.focus({ preventScroll: true });
    const setup = document.querySelector('.study-setup');
    if (setup && window.innerWidth <= 820) setup.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function startLocalRound(words, mode, setKind) {
    showView('study');
    const selected = cloneWords(uniqueWords(words));
    if (!selected.length) return;

    el.modeSelect.value = mode;
    syncModeControls();
    state.source = 'local';
    state.sessionId = '';
    state.localRoundSeed = cloneWords(selected);
    state.activeSetKind = String(setKind || 'local');
    prepareRoundState(mode, mode === 'writing' ? 'en-de' : el.directionSelect.value);
    state.source = 'local';
    state.activeSetKind = String(setKind || 'local');
    state.bankSnapshot = cloneWords(state.reviewBank);
    state.queue = expandWordsForLearningFlow(selected, mode);
    state.roundWords = cloneWords(selected);
    state.total = selected.length;
    state.hasMore = false;
    state.loadingBatch = false;
    el.restartRoundButton.classList.remove('hidden');
    resetCardUi();
    setMessage(mode === 'writing' ? 'Writing practice ready.' : 'Review practice ready.');
    showNextCard();
  }

  async function restartCurrentRound() {
    if (!state.total) return;

    const hasProgress = state.index > 0 || state.answered || state.revealed || state.writingAttempt > 1;
    if (hasProgress && !window.confirm('Restart this round and reset its progress?')) return;

    state.reviewBank = cloneWords(state.bankSnapshot);
    saveReviewBank();

    if (state.source === 'local') {
      const seed = cloneWords(state.localRoundSeed);
      prepareRoundState(state.mode, state.direction);
      state.source = 'local';
      state.localRoundSeed = cloneWords(seed);
      state.queue = cloneWords(seed);
      state.roundWords = cloneWords(seed);
      state.total = seed.length;
      state.hasMore = false;
      state.loadingBatch = false;
      resetCardUi();
      el.restartRoundButton.classList.remove('hidden');
      showNextCard();
      return;
    }

    if (!state.sessionId) return;
    resetCardUi();
    setMessage('Restarting the same round…');

    try {
      const result = await apiCall('restartStudySession', {
        sessionId: state.sessionId,
        clientId: state.clientId
      });
      if (!result || !result.ok) {
        setMessage('The round could not be restarted.', true);
        return;
      }

      const words = annotateWords(result.words || [], state.sessionId);
      prepareRoundState(state.mode, state.direction);
      state.source = 'backend';
      state.queue = expandWordsForLearningFlow(words, state.mode);
      state.roundWords = cloneWords(words);
      state.total = Number(result.stepTotal || result.total || state.queue.length);
      state.hasMore = Boolean(result.hasMore);
      state.loadingBatch = false;
      el.restartRoundButton.classList.remove('hidden');
      setMessage('Round restarted with the same words and order.');
      showNextCard();
    } catch (error) {
      handleServerFailure(error);
    }
  }

  function prefetchIfNeeded() {
    if (state.source === 'backend' && state.hasMore && state.queue.length <= 6 && !state.loadingBatch) {
      fetchNextBatch();
    }
  }

  async function fetchNextBatch() {
    if (!state.hasMore || state.loadingBatch || !state.sessionId) return;
    state.loadingBatch = true;

    try {
      const result = await apiCall('nextStudyBatch', {
        sessionId: state.sessionId,
        clientId: state.clientId
      });
      state.loadingBatch = false;

      if (!result || !result.ok) {
        state.hasMore = false;
        setMessage((result && result.message) || 'The next cards could not be loaded.', true);
        return;
      }

      const words = annotateWords(result.words || [], state.sessionId);
      state.queue = state.queue.concat(expandWordsForLearningFlow(words, state.mode));
      state.roundWords = uniqueWords(state.roundWords.concat(words));
      state.hasMore = Boolean(result.hasMore);

      if (state.waitingForBatch) {
        state.waitingForBatch = false;
        showNextCard();
      }
    } catch (error) {
      state.loadingBatch = false;
      state.hasMore = false;
      handleServerFailure(error);
    }
  }

  function resetCardUi() {
    el.cardButton.classList.remove('hidden', 'revealed');
    el.cardButton.disabled = true;
    el.completePanel.classList.add('hidden');
    hideAnswerPanels();
    setCard('Preparing', 'Loading…', '');
    updateStats();
  }

  function setCard(language, word, hint) {
    el.cardLanguage.textContent = language;
    renderCardWord(language, word);
    el.cardHint.textContent = hint || '';
  }

  function renderCardWord(language, word) {
    const text = String(word || '');
    el.cardWord.replaceChildren();

    if (language === 'Deutsch') {
      const match = text.match(/^(der|die|das)\s+(.+)$/i);
      if (match) {
        const article = match[1].toLowerCase();
        const tag = document.createElement('span');
        tag.className = 'article-tag art-' + article;
        tag.textContent = article;
        el.cardWord.append(tag, document.createTextNode(match[2]));
        return;
      }
    }

    el.cardWord.textContent = text;
  }

  function germanDisplay(word) {
    return word.type === 'noun' && isGermanArticle(word.article)
      ? word.article + ' ' + word.german
      : word.german;
  }

  function updateStatLabels(mode) {
    if (mode === 'learn') {
      el.correctLabel.textContent = 'Introduced';
      el.wrongLabel.textContent = 'Remaining';
      el.streakLabel.textContent = 'Total';
      return;
    }

    if (mode === 'review') {
      el.correctLabel.textContent = 'Remembered';
      el.wrongLabel.textContent = 'Almost';
      el.streakLabel.textContent = 'Practice';
      return;
    }

    el.correctLabel.textContent = 'Correct';
    el.wrongLabel.textContent = 'Wrong';
    el.streakLabel.textContent = 'Streak';
  }

  function updateStats() {
    if (state.mode === 'learn') {
      el.correctCount.textContent = state.introduced;
      el.wrongCount.textContent = Math.max(0, state.total - state.index - (state.current ? 1 : 0));
      el.streakCount.textContent = state.total;
    } else if (state.mode === 'review') {
      el.correctCount.textContent = state.correct;
      el.wrongCount.textContent = state.almost;
      el.streakCount.textContent = state.wrong;
    } else {
      el.correctCount.textContent = state.correct;
      el.wrongCount.textContent = state.wrong;
      el.streakCount.textContent = state.streak;
    }

    const displayed = state.current
      ? Math.min(state.index + 1, state.total)
      : Math.min(state.index, state.total);

    el.progressText.textContent = 'Card ' + displayed + ' of ' + state.total;

    const progress = state.total
      ? Math.min(100, (state.index / state.total) * 100)
      : 0;

    el.progressBar.style.width = progress + '%';
  }

  function expandWordsForLearningFlow(words, mode) {
    const baseWords = cloneWords(words);
    if (mode === 'learn') {
      return baseWords.map(word => Object.assign(word, { studyPhase: 'learn' }));
    }
    if (mode === 'review') {
      return baseWords.map(word => Object.assign(word, { studyPhase: 'review' }));
    }
    return baseWords;
  }

  function loadLatestLearnedSet() {
    try {
      const parsed = JSON.parse(localStorage.getItem(LATEST_LEARN_SET_KEY) || '[]');
      return Array.isArray(parsed) ? cloneWords(parsed).slice(0, 500) : [];
    } catch (error) {
      return [];
    }
  }

  function saveLatestLearnedSet(words) {
    try {
      localStorage.setItem(LATEST_LEARN_SET_KEY, JSON.stringify(cloneWords(words).slice(0, 500)));
    } catch (error) {
      // The current in-memory set still remains usable.
    }
  }

  function addDifficultWord(word) {
    const copy = cloneWord(word);
    const key = wordKey(copy);
    const existingIndex = state.reviewBank.findIndex(item => wordKey(item) === key);

    if (existingIndex >= 0) {
      state.reviewBank[existingIndex] = copy;
    } else {
      state.reviewBank.push(copy);
    }

    if (state.reviewBank.length > 300) {
      state.reviewBank = state.reviewBank.slice(-300);
    }

    saveReviewBank();
  }

  function removeDifficultWord(word) {
    const key = wordKey(word);
    const next = state.reviewBank.filter(item => wordKey(item) !== key);
    if (next.length === state.reviewBank.length) return;
    state.reviewBank = next;
    saveReviewBank();
  }

  function loadReviewBank() {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(REVIEW_BANK_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  function saveReviewBank() {
    try {
      sessionStorage.setItem(REVIEW_BANK_KEY, JSON.stringify(state.reviewBank));
    } catch (error) {
      // Session storage is optional; the in-memory bank still works.
    }
  }

  function configureContactEmail() {
    // Public contact email intentionally disabled. Use the in-app feedback form.
  }

  function addSuggestionItem(seed) {
    if (el.suggestionItems.children.length >= 20) {
      setContributionMessage(el.suggestionMessage, 'A single request can contain at most 20 words.', true);
      return;
    }

    state.suggestionItemCounter += 1;
    const fragment = el.suggestionItemTemplate.content.cloneNode(true);
    const item = fragment.querySelector('.suggestion-item');
    item.dataset.itemId = String(state.suggestionItemCounter);
    el.suggestionItems.appendChild(fragment);

    const inserted = el.suggestionItems.lastElementChild;
    assignSuggestionItemLabels(inserted);
    populateSuggestionItemOptions(inserted);
    applySuggestionItemSeed(inserted, seed || {});
    syncSuggestionItemFields(inserted);
    renumberSuggestionItems();
  }

  function assignSuggestionItemLabels(item) {
    const itemId = item.dataset.itemId || String(state.suggestionItemCounter);
    item.querySelectorAll('[data-field]').forEach(field => {
      const fieldName = field.dataset.field || 'field';
      field.id = 'suggestion-' + itemId + '-' + fieldName;
      const wrapper = field.closest('.form-field');
      const label = wrapper ? wrapper.querySelector('label') : null;
      if (label) label.htmlFor = field.id;
    });
  }

  function applySuggestionItemSeed(item, seed) {
    Object.keys(seed || {}).forEach(key => {
      const field = item.querySelector('[data-field="' + key + '"]');
      if (field && seed[key] != null) field.value = seed[key];
    });
  }

  function populateSuggestionItemOptions(item) {
    const deckSelect = item.querySelector('[data-field="deck"]');
    const levelSelect = item.querySelector('[data-field="level"]');
    if (deckSelect) {
      fillSelect(deckSelect, [''].concat(state.availableDecks), value => value || 'Choose a deck');
    }
    if (levelSelect) {
      fillSelect(levelSelect, state.availableLevels.length ? state.availableLevels : ['Unassigned']);
      if (Array.from(levelSelect.options).some(option => option.value === 'Unassigned')) {
        levelSelect.value = 'Unassigned';
      }
    }
  }

  function refreshSuggestionItemOptions() {
    Array.from(el.suggestionItems.children).forEach(item => {
      const deck = item.querySelector('[data-field="deck"]');
      const level = item.querySelector('[data-field="level"]');
      const previousDeck = deck ? deck.value : '';
      const previousLevel = level ? level.value : '';
      populateSuggestionItemOptions(item);
      if (deck && state.availableDecks.indexOf(previousDeck) >= 0) deck.value = previousDeck;
      if (level && state.availableLevels.indexOf(previousLevel) >= 0) level.value = previousLevel;
      syncSuggestionItemFields(item);
    });
  }

  function renumberSuggestionItems() {
    const items = Array.from(el.suggestionItems.children);
    items.forEach((item, index) => {
      const number = item.querySelector('[data-role="item-number"]');
      const remove = item.querySelector('.remove-suggestion-item');
      if (number) number.textContent = String(index + 1);
      if (remove) remove.classList.toggle('hidden', items.length === 1);
    });
  }

  function handleSuggestionItemsClick(event) {
    const item = event.target.closest('.suggestion-item');
    if (!item) return;

    if (event.target.closest('.remove-suggestion-item')) {
      if (el.suggestionItems.children.length > 1) {
        item.remove();
        renumberSuggestionItems();
      }
      return;
    }

    if (event.target.closest('.check-item-availability')) {
      checkSuggestionItemAvailability(item);
    }
  }

  function handleSuggestionItemsChange(event) {
    const item = event.target.closest('.suggestion-item');
    if (!item) return;
    if (event.target.matches('[data-field="type"], [data-field="deckSelection"]')) {
      syncSuggestionItemFields(item);
    }
  }

  function syncSuggestionItemFields(item) {
    const type = item.querySelector('[data-field="type"]');
    const articleField = item.querySelector('[data-role="article-field"]');
    const article = item.querySelector('[data-field="article"]');
    const deckSelection = item.querySelector('[data-field="deckSelection"]');
    const existingDeckField = item.querySelector('[data-role="existing-deck-field"]');
    const newDeckField = item.querySelector('[data-role="new-deck-field"]');
    const deck = item.querySelector('[data-field="deck"]');
    const requestedNewDeck = item.querySelector('[data-field="requestedNewDeck"]');

    const isNoun = type && type.value === 'noun';
    articleField.classList.toggle('hidden', !isNoun);
    article.required = isNoun;
    if (!isNoun) article.value = '';

    const requestingNewDeck = deckSelection && deckSelection.value === 'new';
    existingDeckField.classList.toggle('hidden', requestingNewDeck);
    newDeckField.classList.toggle('hidden', !requestingNewDeck);
    deck.required = !requestingNewDeck;
    requestedNewDeck.required = requestingNewDeck;
    if (requestingNewDeck) deck.value = '';
    else requestedNewDeck.value = '';
  }

  function suggestionItemData(item) {
    const read = field => {
      const node = item.querySelector('[data-field="' + field + '"]');
      return node ? node.value : '';
    };

    return {
      german: read('german'),
      article: read('article'),
      english: read('english'),
      type: read('type'),
      deckSelection: read('deckSelection'),
      deck: read('deck'),
      requestedNewDeck: read('requestedNewDeck'),
      level: read('level'),
      hint: read('hint')
    };
  }

  async function checkSuggestionItemAvailability(item) {
    const data = suggestionItemData(item);
    const query = data.german.trim();
    const message = item.querySelector('[data-role="item-message"]');
    const matches = item.querySelector('[data-role="item-matches"]');
    const button = item.querySelector('.check-item-availability');
    matches.replaceChildren();

    if (query.length < 2) {
      setContributionMessage(message, 'Enter at least two characters in the German word.', true);
      const input = item.querySelector('[data-field="german"]');
      if (input) input.focus();
      return;
    }

    button.disabled = true;
    setContributionMessage(message, 'Checking the vocabulary…', false);

    try {
      const result = await apiCall('publicVocabularySearch', {
        clientId: state.clientId,
        query: query
      });
      button.disabled = false;
      if (!result || !result.ok) {
        setContributionMessage(message, 'Availability check is temporarily unavailable.', true);
        return;
      }
      renderSuggestionItemMatches(item, result.results || [], query);
    } catch (error) {
      button.disabled = false;
      setContributionMessage(
        message,
        /too many requests/i.test(error && error.message ? error.message : '')
          ? 'Too many checks. Please wait and try again.'
          : 'Availability check is temporarily unavailable.',
        true
      );
    }
  }

  function renderSuggestionItemMatches(item, results, query) {
    const matches = item.querySelector('[data-role="item-matches"]');
    const message = item.querySelector('[data-role="item-message"]');
    matches.replaceChildren();
    const normalized = normalizeSearch(query);
    const exactGerman = results.find(word => normalizeSearch(word.german) === normalized);

    if (!results.length) {
      setContributionMessage(message, 'No matching German word was found.', false, true);
      return;
    }

    setContributionMessage(
      message,
      exactGerman
        ? 'A word with this German spelling already exists. Check the meaning before submitting.'
        : 'Similar vocabulary was found. Review it before submitting.',
      Boolean(exactGerman)
    );

    results.slice(0, 5).forEach(word => {
      const article = document.createElement('article');
      article.className = 'search-result-card';
      const title = document.createElement('div');
      title.className = 'search-result-title';
      title.textContent = (word.article ? word.article + ' ' : '') + word.german + ': ' + word.english;
      const meta = document.createElement('div');
      meta.className = 'search-result-meta';
      meta.textContent = [word.deck, formatType(word.type), word.level].filter(Boolean).join(' · ');
      article.append(title, meta);
      matches.appendChild(article);
    });
  }

  async function submitWordSuggestionForm(event) {
    event.preventDefault();
    if (!el.wordSuggestionForm.reportValidity()) return;

    const items = Array.from(el.suggestionItems.children);
    if (!items.length) {
      setContributionMessage(el.suggestionMessage, 'Add at least one word.', true);
      return;
    }

    const request = {
      clientId: state.clientId,
      formStartedAt: state.wordFormStartedAt,
      name: el.suggestionName.value,
      email: el.suggestionEmail.value,
      leaderboardOptIn: el.leaderboardOptIn.checked,
      publicDisplayName: el.publicDisplayName.value,
      note: el.suggestionNote.value,
      website: el.suggestionWebsite.value,
      consent: el.suggestionConsent.checked,
      words: items.map(suggestionItemData)
    };

    el.submitSuggestionButton.disabled = true;
    el.addSuggestionItemButton.disabled = true;
    setContributionMessage(el.suggestionMessage, 'Sending the suggestions for review…', false);

    try {
      const result = await apiCall('submitWordSuggestionsBatch', request);
      el.submitSuggestionButton.disabled = false;
      el.addSuggestionItemButton.disabled = false;

      if (!result || !result.items) {
        handleBatchSuggestionResponseError(result || {});
        return;
      }

      renderBatchSuggestionResults(result.items);
      if (result.acceptedCount > 0) {
        const previousName = el.suggestionName.value;
        const previousEmail = el.suggestionEmail.value;
        const previousDisplayName = el.publicDisplayName.value;
        const previousOptIn = el.leaderboardOptIn.checked;

        if (result.rejectedCount === 0) {
          el.wordSuggestionForm.reset();
          el.suggestionName.value = previousName;
          el.suggestionEmail.value = previousEmail;
          el.leaderboardOptIn.checked = previousOptIn;
          el.publicDisplayName.value = previousDisplayName;
          syncLeaderboardOptIn();
          el.suggestionItems.replaceChildren();
          addSuggestionItem();
        } else {
          const originalItems = Array.from(el.suggestionItems.children);
          (result.items || []).forEach((itemResult, index) => {
            if (itemResult.ok && originalItems[index]) originalItems[index].remove();
          });
          if (!el.suggestionItems.children.length) addSuggestionItem();
          renumberSuggestionItems();
          el.suggestionConsent.checked = false;
        }

        state.wordFormStartedAt = Date.now();
        setContributionMessage(
          el.suggestionMessage,
          result.acceptedCount + ' word' + (result.acceptedCount === 1 ? '' : 's') +
            ' sent for admin review.' +
            (result.rejectedCount ? ' Keep the remaining word cards and correct them before resubmitting.' :
              ' Approved contributors will receive a thank-you email.'),
          false,
          true
        );
      } else {
        setContributionMessage(el.suggestionMessage, 'No word was submitted. Review the results below.', true);
      }
    } catch (error) {
      el.submitSuggestionButton.disabled = false;
      el.addSuggestionItemButton.disabled = false;
      setContributionMessage(el.suggestionMessage, contributionFailureMessage(error), true);
    }
  }

  function renderBatchSuggestionResults(items) {
    el.suggestionBatchResults.replaceChildren();
    (items || []).forEach(item => {
      const row = document.createElement('div');
      row.className = 'batch-result-item ' + (item.ok ? 'success' : 'error');
      if (item.ok) {
        row.textContent = 'Word ' + item.itemNumber + ': ' + item.german + ': ' + item.english + ' was submitted.';
      } else if (item.error === 'DUPLICATE') {
        const existing = item.existing || {};
        row.textContent = 'Word ' + item.itemNumber + ': already present as ' +
          (existing.article ? existing.article + ' ' : '') + (existing.german || item.german) +
          ' — ' + (existing.english || item.english) + '.';
      } else if (item.error === 'PENDING_DUPLICATE') {
        row.textContent = 'Word ' + item.itemNumber + ': the same word is already pending review.';
      } else {
        row.textContent = 'Word ' + item.itemNumber + ': could not be submitted.';
      }
      el.suggestionBatchResults.appendChild(row);
    });
  }

  function handleBatchSuggestionResponseError(result) {
    if (result.error === 'FORM_TOO_FAST') {
      setContributionMessage(el.suggestionMessage, 'Please review the form for a moment, then submit again.', true);
      return;
    }
    if (result.error === 'FORM_EXPIRED') {
      state.wordFormStartedAt = Date.now();
      setContributionMessage(el.suggestionMessage, 'The form timed out. Please check the details and submit again.', true);
      return;
    }
    setContributionMessage(el.suggestionMessage, 'The suggestions could not be submitted.', true);
  }

  async function submitFeedbackForm(event) {
    event.preventDefault();
    if (!el.feedbackForm.reportValidity()) return;

    el.submitFeedbackButton.disabled = true;
    setContributionMessage(el.feedbackMessage, 'Sending your feedback privately…', false);

    const request = {
      clientId: state.clientId,
      formStartedAt: state.feedbackFormStartedAt,
      name: el.feedbackName.value,
      email: el.feedbackEmail.value,
      feedback: el.feedbackText.value,
      website: el.feedbackWebsite.value,
      consent: el.feedbackConsent.checked
    };

    try {
      const result = await apiCall('submitGeneralFeedback', request);
      el.submitFeedbackButton.disabled = false;

      if (!result || !result.ok) {
        if (result && result.error === 'RECENT_DUPLICATE') {
          setContributionMessage(el.feedbackMessage, 'This feedback was already submitted recently.', true);
        } else if (result && result.error === 'FORM_TOO_FAST') {
          setContributionMessage(el.feedbackMessage, 'Please review the message for a moment, then submit again.', true);
        } else if (result && result.error === 'FORM_EXPIRED') {
          state.feedbackFormStartedAt = Date.now();
          setContributionMessage(el.feedbackMessage, 'The form timed out. Please submit it again.', true);
        } else {
          setContributionMessage(el.feedbackMessage, 'The feedback could not be submitted.', true);
        }
        return;
      }

      const previousName = el.feedbackName.value;
      const previousEmail = el.feedbackEmail.value;
      el.feedbackForm.reset();
      el.feedbackName.value = previousName;
      el.feedbackEmail.value = previousEmail;
      state.feedbackFormStartedAt = Date.now();

      setContributionMessage(
        el.feedbackMessage,
        'Thank you. Your feedback was sent privately for admin review.',
        false,
        true
      );
    } catch (error) {
      el.submitFeedbackButton.disabled = false;
      setContributionMessage(el.feedbackMessage, contributionFailureMessage(error), true);
    }
  }

  function contributionFailureMessage(error) {
    const raw = error && error.message ? error.message : '';

    if (/valid email/i.test(raw)) return 'Please enter a valid email address.';
    if (/proposed new deck|choose a deck/i.test(raw)) return 'Choose an existing deck or enter the proposed new deck name.';
    if (/enter your name/i.test(raw)) return 'Please enter your name.';
    if (/article/i.test(raw)) return 'Please choose der, die, or das for the noun.';
    if (/consent|confirm/i.test(raw)) return 'Please confirm the privacy checkbox.';
    if (/configuration|contribution service/i.test(raw)) return 'The contribution service is temporarily unavailable.';
    if (/too many requests/i.test(raw)) return 'Too many submissions were made. Please wait and try again.';
    return raw || 'The contribution could not be submitted.';
  }

  function setContributionMessage(node, message, isError, isSuccess) {
    node.textContent = message || '';
    node.classList.toggle('error', Boolean(isError));
    node.classList.toggle('success', Boolean(isSuccess));
  }

  async function runPublicSearch(event) {
    event.preventDefault();
    const query = el.publicSearchInput.value.trim();
    el.publicSearchResults.replaceChildren();

    if (query.length < 2) {
      setPublicSearchMessage('', false);
      return;
    }

    el.publicSearchButton.disabled = true;
    setPublicSearchMessage('Searching…', false);

    try {
      const result = await apiCall('publicVocabularySearch', {
        clientId: state.clientId,
        query: query
      });
      el.publicSearchButton.disabled = false;

      if (!result || !result.ok) {
        setPublicSearchMessage('Search is temporarily unavailable.', true);
        return;
      }

      renderPublicSearchResults(result.results || [], query, result.limit || 12);
    } catch (error) {
      el.publicSearchButton.disabled = false;
      setPublicSearchMessage(
        /too many requests/i.test(error && error.message ? error.message : '')
          ? 'Too many searches. Please wait and try again.'
          : 'Search is temporarily unavailable.',
        true
      );
    }
  }

  function renderPublicSearchResults(results, query, limit) {
    el.publicSearchResults.replaceChildren();

    if (!results.length) {
      setPublicSearchMessage('No matching vocabulary found.', false);
      return;
    }

    const normalizedQuery = normalizeSearch(query);
    const exactMatch = results.some(word => {
      return normalizeSearch(word.german) === normalizedQuery || normalizeSearch(word.english) === normalizedQuery;
    });

    setPublicSearchMessage(
      exactMatch
        ? 'This word is already present in the vocabulary.'
        : results.length + ' matching result' + (results.length === 1 ? '' : 's') + ' shown' + (results.length >= limit ? ' (limited).' : '.'),
      false
    );

    results.forEach(word => {
      const article = document.createElement('article');
      article.className = 'search-result-card';

      const title = document.createElement('div');
      title.className = 'search-result-title';
      title.textContent = (word.article ? word.article + ' ' : '') + word.german + ': ' + word.english;

      const meta = document.createElement('div');
      meta.className = 'search-result-meta';
      meta.textContent = [word.deck, formatType(word.type), word.level].filter(Boolean).join(' · ');

      article.append(title, meta);
      el.publicSearchResults.appendChild(article);
    });
  }

  function setPublicSearchMessage(message, isError) {
    el.publicSearchMessage.textContent = message || '';
    el.publicSearchMessage.classList.toggle('error', Boolean(isError));
  }

  function formatType(type) {
    const labels = {
      noun: 'Noun',
      verb: 'Verb',
      adjective: 'Adjective',
      other: 'Other'
    };
    return labels[type] || type;
  }

  function setMessage(message, isError) {
    el.setupMessage.textContent = message || '';
    el.setupMessage.classList.toggle('error', Boolean(isError));
  }

  function handleServerFailure(error) {
    el.newRoundButton.disabled = false;
    setConnectionActions(true);

    const raw = error && error.message ? error.message : '';
    let message = 'The app could not connect. Check your connection and retry.';

    if (error && error.code === 'ORIGIN_NOT_ALLOWED') {
      message = 'This local beta address is not allowed by the Cloudflare Worker yet. Deploy the supplied V4.1 Worker update and retry.';
    } else if (/permission|access denied/i.test(raw)) {
      message = 'This web-app deployment is not publicly accessible. Open the production /exec link.';
    } else if (/configuration|spreadsheet|sheet.*not found/i.test(raw)) {
      message = 'The vocabulary service is temporarily unavailable because its server configuration needs attention.';
    } else if (/too many requests/i.test(raw)) {
      message = 'Too many requests were made. Wait a moment and retry.';
    } else if (/session/i.test(raw)) {
      message = 'Your study session expired. Start a new round.';
    }

    setMessage(message, true);
  }

  function setConnectionActions(visible) {
    el.connectionActions.classList.toggle('hidden', !visible);
  }

  function annotateWords(words, sessionId) {
    return words.map(word => {
      const copy = cloneWord(word);
      copy.originSessionId = sessionId;
      return copy;
    });
  }

  function cloneWord(word) {
    return {
      wordId: String(word.wordId || ''),
      token: String(word.token || makeLocalToken()),
      deck: String(word.deck || 'General'),
      german: String(word.german || ''),
      article: String(word.article || ''),
      english: String(word.english || ''),
      type: String(word.type || 'other'),
      hint: String(word.hint || ''),
      level: String(word.level || 'Unassigned'),
      isNew: Boolean(word.isNew),
      studyPhase: String(word.studyPhase || ''),
      originSessionId: String(word.originSessionId || '')
    };
  }

  function cloneWords(words) {
    return (words || []).map(cloneWord);
  }

  function uniqueWords(words) {
    const seen = new Set();
    const result = [];

    (words || []).forEach(word => {
      const key = wordKey(word);
      if (seen.has(key)) return;
      seen.add(key);
      result.push(cloneWord(word));
    });

    return result;
  }

  function wordKey(word) {
    if (word && word.wordId) return 'id:' + String(word.wordId);
    return [
      normalizeSearch(word.german),
      normalizeSearch(word.english),
      normalizeSearch(word.article)
    ].join('|');
  }

  function normalizeSearch(value) {
    return String(value || '')
      .trim()
      .toLocaleLowerCase('de-DE')
      .normalize('NFKC')
      .replace(/\s+/g, ' ');
  }

  function normalizeExact(value) {
    return String(value || '')
      .trim()
      .normalize('NFKC')
      .replace(/\s+/g, ' ')
      .replace(/[.!?;,]+$/g, '');
  }

  function isGermanArticle(value) {
    return ['der', 'die', 'das'].indexOf(String(value || '').toLowerCase()) >= 0;
  }

  function isUuid(value) {
    return /^[0-9a-fA-F-]{36}$/.test(String(value || ''));
  }

  function makeLocalToken() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return '00000000-0000-4000-8000-' + Math.random().toString(16).slice(2, 14).padEnd(12, '0');
  }

  function getOrCreateClientId() {
    const key = 'df_public_client_v2';
    let value = localStorage.getItem(key);

    if (!/^[A-Za-z0-9_-]{20,100}$/.test(value || '')) {
      const bytes = new Uint8Array(24);
      crypto.getRandomValues(bytes);
      value = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(key, value);
    }

    return value;
  }

  function levenshtein(left, right) {
    const rows = left.length + 1;
    const columns = right.length + 1;
    const matrix = Array.from({ length: rows }, () => new Array(columns).fill(0));

    for (let row = 0; row < rows; row++) matrix[row][0] = row;
    for (let column = 0; column < columns; column++) matrix[0][column] = column;

    for (let row = 1; row < rows; row++) {
      for (let column = 1; column < columns; column++) {
        const cost = left[row - 1] === right[column - 1] ? 0 : 1;
        matrix[row][column] = Math.min(
          matrix[row - 1][column] + 1,
          matrix[row][column - 1] + 1,
          matrix[row - 1][column - 1] + cost
        );
      }
    }

    return matrix[rows - 1][columns - 1];
  }

  function shuffle(array) {
    for (let index = array.length - 1; index > 0; index--) {
      const randomIndex = Math.floor(Math.random() * (index + 1));
      const temporary = array[index];
      array[index] = array[randomIndex];
      array[randomIndex] = temporary;
    }
    return array;
  }
})();
