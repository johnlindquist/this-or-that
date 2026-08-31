(() => {
  'use strict';

  const protocol = 'this-or-that/appearance/v1';
  const storageKey = 'tot-appearance';
  const modes = ['system', 'light', 'dark'];
  const waiters = new Set();
  let media = null;
  let observingMedia = false;
  let state = { mode: 'system', resolved: 'light', revision: 0, persistence: 'default', error: null };

  function storageError() {
    return { code: 'STORAGE_UNAVAILABLE', message: 'Appearance is available for this page only. Browser storage is unavailable; your preference was not saved.' };
  }

  function storedPreference(value) {
    if (value === null) return { mode: 'system', persistence: 'default', error: null };
    if (modes.includes(value)) return { mode: value, persistence: 'saved', error: null };
    return { mode: 'system', persistence: 'default', error: { code: 'INVALID_SAVED_MODE', message: 'The saved appearance preference is invalid. Using System; choose an appearance to replace it.' } };
  }

  function snapshot() {
    return { ...state, error: state.error ? { ...state.error } : null };
  }

  function inspect() {
    const control = document.getElementById('appearance-mode');
    return {
      ok: true,
      protocol,
      state: snapshot(),
      controls: [{ id: 'appearance-mode', role: 'combobox', label: 'Appearance', value: state.mode, options: [...modes], available: !!control, availabilityReason: control ? null : 'Appearance control has not mounted', disabled: !!control?.disabled, focused: !!control && document.activeElement === control, actions: ['select'] }],
    };
  }

  function syncControls() {
    const control = document.getElementById('appearance-mode');
    if (control && control.value !== state.mode) control.value = state.mode;
    const status = document.getElementById('appearance-status');
    if (status) status.textContent = state.error?.message || '';
  }

  function resolve(mode) {
    if (mode !== 'system') return mode;
    if (!media && typeof window.matchMedia === 'function') media = window.matchMedia('(prefers-color-scheme: dark)');
    return media?.matches ? 'dark' : 'light';
  }

  function onMediaChange() {
    if (state.mode === 'system') apply(state.mode, state.persistence, state.error);
  }

  function observeMedia(mode) {
    const shouldObserve = mode === 'system' && !!media;
    if (shouldObserve === observingMedia) return;
    if (typeof media.addEventListener === 'function') {
      if (shouldObserve) media.addEventListener('change', onMediaChange);
      else media.removeEventListener('change', onMediaChange);
    } else {
      if (shouldObserve) media.addListener(onMediaChange);
      else media.removeListener(onMediaChange);
    }
    observingMedia = shouldObserve;
  }

  function apply(mode, persistence, error) {
    const resolved = resolve(mode);
    const changed = mode !== state.mode || resolved !== state.resolved || persistence !== state.persistence || error?.code !== state.error?.code || error?.message !== state.error?.message;
    if (changed) state = { mode, resolved, persistence, error, revision: state.revision + 1 };
    document.documentElement.setAttribute('data-theme', resolved);
    observeMedia(mode);
    syncControls();
    if (changed) {
      document.dispatchEvent(new CustomEvent('tournament:appearance', { detail: snapshot() }));
      for (const wake of [...waiters]) wake();
    }
    return inspect();
  }

  function failure(code, message) {
    return { ok: false, protocol, error: { code, message }, state: snapshot() };
  }

  function act(request) {
    if (!request || typeof request !== 'object' || Array.isArray(request) || Object.keys(request).some(key => key !== 'expectedRevision' && key !== 'mode') || !Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0 || !modes.includes(request.mode)) {
      return failure('INVALID_REQUEST', 'Provide expectedRevision and mode: system, light, or dark.');
    }
    if (request.expectedRevision !== state.revision) return failure('STALE_REVISION', 'Appearance changed. Inspect the current revision before trying again.');
    let persistence = 'saved', error = null;
    try {
      window.localStorage.setItem(storageKey, request.mode);
    } catch {
      persistence = 'unavailable';
      error = storageError();
    }
    return apply(request.mode, persistence, error);
  }

  function wait(request) {
    if (!request || typeof request !== 'object' || Array.isArray(request) || Object.keys(request).some(key => key !== 'afterRevision' && key !== 'timeoutMs') || !Number.isSafeInteger(request.afterRevision) || request.afterRevision < 0 || (request.timeoutMs !== undefined && (!Number.isSafeInteger(request.timeoutMs) || request.timeoutMs < 0 || request.timeoutMs > 60000))) {
      return Promise.resolve(failure('INVALID_REQUEST', 'Provide afterRevision and an optional timeoutMs integer from 0 to 60000.'));
    }
    if (request.afterRevision > state.revision) return Promise.resolve(failure('INVALID_REVISION', 'afterRevision cannot be newer than the current appearance revision.'));
    if (state.revision > request.afterRevision) return Promise.resolve({ ...inspect(), changed: true });
    return new Promise(resolveWait => {
      let timer;
      const finish = changed => {
        clearTimeout(timer);
        waiters.delete(wake);
        resolveWait({ ...inspect(), changed });
      };
      const wake = () => {
        if (state.revision > request.afterRevision) finish(true);
      };
      waiters.add(wake);
      timer = setTimeout(() => finish(false), request.timeoutMs ?? 10000);
    });
  }

  function discover() {
    return {
      ok: true,
      protocol,
      scope: 'Browser appearance only; candidate documents, tournament data, and rankings are unchanged.',
      methods: ['discover', 'inspect', 'query', 'act', 'wait', 'diagnose'],
      modes: [...modes],
      defaultMode: 'system',
      storage: { key: storageKey, format: 'Plain mode string', scope: 'This browser origin; synchronized across tabs' },
      act: { required: ['expectedRevision', 'mode'], expectedRevision: 'Current appearance revision from inspect()', mode: [...modes] },
      wait: { required: ['afterRevision'], timeoutMs: { default: 10000, minimum: 0, maximum: 60000 } },
      events: ['tournament:appearance'],
      control: { id: 'appearance-mode', role: 'combobox', label: 'Appearance' },
    };
  }

  function diagnose() {
    const control = document.getElementById('appearance-mode');
    return {
      ...inspect(),
      checks: {
        themeMatches: document.documentElement.getAttribute('data-theme') === state.resolved,
        controlAvailable: !!control,
        controlMatches: !!control && control.value === state.mode,
        systemPreferenceSupported: typeof window.matchMedia === 'function',
        observingSystem: observingMedia,
        persistenceAvailable: state.persistence !== 'unavailable',
      },
    };
  }

  let initial;
  try {
    initial = storedPreference(window.localStorage.getItem(storageKey));
  } catch {
    initial = { mode: 'system', persistence: 'unavailable', error: storageError() };
  }
  state = { ...initial, resolved: resolve(initial.mode), revision: 0 };
  document.documentElement.setAttribute('data-theme', state.resolved);
  observeMedia(state.mode);
  window.tournament = { appearance: { discover, inspect, query: inspect, act, wait, diagnose } };

  document.addEventListener('DOMContentLoaded', syncControls);
  document.addEventListener('tournament:render', syncControls);
  document.addEventListener('change', event => {
    if (event.target instanceof HTMLSelectElement && event.target.id === 'appearance-mode') {
      act({ expectedRevision: state.revision, mode: event.target.value });
      syncControls();
    }
  });
  window.addEventListener('storage', event => {
    if (event.key !== storageKey && event.key !== null) return;
    try {
      if (event.storageArea !== window.localStorage) return;
      const preference = storedPreference(window.localStorage.getItem(storageKey));
      apply(preference.mode, preference.persistence, preference.error);
    } catch {
      apply(state.mode, 'unavailable', storageError());
    }
  });
})();
