(() => {
  'use strict';
  const protocol = 'this-or-that/chrome-mockups/v2';
  const reviewProtocol = 'this-or-that/chrome-review/v1';
  const byId = id => document.getElementById(id);
  const frame = byId('design-preview');
  const waiters = new Set();
  const esc = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let manifest = null;
  let ready = false;
  let loading = false;
  let revision = 0;
  let selectedId = null;
  let lastError = null;
  let frameStatus = 'unavailable';
  let frameTimer = null;
  const limits = {
    previewOnly: true, recordsRankings: false, persistsPreference: false,
    sampleState: 'Each independent design has page-local sample notes, responses and demo state. Switching designs resets that state.',
    revisionScope: 'Manifest availability and selected design. Preview loading status is inspected separately.',
    keyboard: 'Unmodified Left/Right browse all 18 designs and wrap at the ends. Editable fields and specialized keyboard widgets retain their arrows. Escape returns to review navigation. No arrow key records a vote.',
    selectionScope: 'This browser page and its URL hash. No HTTP mutation endpoint.'
  };
  const current = () => manifest?.options.find(option => option.id === selectedId) || null;
  const snapshot = () => ({ready, revision, selectedId, index: manifest ? manifest.options.findIndex(o => o.id === selectedId) : -1, total: manifest?.options.length || 0, selection: current() ? {...current()} : null, options: manifest ? manifest.options.map(o => ({...o})) : [], previewStatus: frameStatus, lastError: lastError ? {...lastError} : null});
  const result = extra => ({ok: true, protocol, state: snapshot(), ...extra});
  const failure = (code, message) => ({ok: false, protocol, error: {code, message}, state: snapshot()});
  const announce = text => { byId('review-announcement').textContent = text; };
  function notify() {
    for (const waiter of waiters) if (revision > waiter.afterRevision) {
      clearTimeout(waiter.timer); waiters.delete(waiter); waiter.resolve(result({changed: true, timedOut: false}));
    }
    window.dispatchEvent(new CustomEvent('chrome-mockups:change', {detail: snapshot()}));
  }
  function controls() {
    return [
      {id: 'previous-design', role: 'button', name: 'Previous design', shortcut: 'ArrowLeft', available: ready, action: {action: 'previous', expectedRevision: revision}},
      {id: 'next-design', role: 'button', name: 'Next design', shortcut: 'ArrowRight', available: ready, action: {action: 'next', expectedRevision: revision}},
      ...(manifest?.options || []).map(o => ({id: o.id, role: 'button', name: `${o.number} ${o.family} — ${o.name}`, selected: o.id === selectedId, available: ready, selector: `[data-select="${o.id}"]`, action: {action: 'select', id: o.id, expectedRevision: revision}}))
    ];
  }
  function previewInfo() {
    let sample = null;
    if (frameStatus === 'ready') {
      try { sample = frame.contentWindow.chromeDesign?.inspect() || null; } catch { /* Unavailable documents are reported without inventing state. */ }
    }
    return {selector: '#design-preview', status: frameStatus, src: current()?.src || null, sample, runtime: 'window.chromeDesign inside the selected iframe', preservedOnSelection: false};
  }
  function discover() {
    return {protocol, manifest: '/mockups.json', global: 'window.chromeMockups', defaultId: manifest?.defaultId || 'capture-lightbox', operations: ['discover','query','inspect','act','wait','diagnose'], actions: ['select','next','previous','focus-review'], schemas: {act: {expectedRevision: 'required current integer revision', action: 'select|next|previous|focus-review', id: 'required manifest ID for select'}, wait: {afterRevision: 'observed integer revision', timeoutMs: '0–30000; default 10000'}}, controls: controls(), groups: manifest?.groups.map(g => ({...g})) || [], limits, hash: '#<design id>', event: 'chrome-mockups:change', previewProtocol: 'this-or-that/chrome-design/v1'};
  }
  function setHash(id, replace) {
    const url = new URL(location.href); url.hash = id;
    if (url.href !== location.href) history[replace ? 'replaceState' : 'pushState'](null, '', url);
  }
  function closePanels() {
    byId('design-index').hidden = true;
    byId('design-menu').setAttribute('aria-expanded', 'false');
    byId('design-details').hidden = true;
    byId('about-design').setAttribute('aria-expanded', 'false');
  }
  function focusReview() { byId('next-design').focus({preventScroll: true}); return document.activeElement === byId('next-design'); }
  function frameMatches() {
    try {
      const url = new URL(frame.contentWindow.location.href);
      return url.pathname === current()?.src && Number(url.searchParams.get('reviewRevision')) === revision && frame.contentDocument?.body?.dataset.design === selectedId;
    } catch { return false; }
  }
  function markFrameReady() {
    if (!frameMatches()) return;
    try { if (!frame.contentWindow.chromeDesign?.inspect().state.ready) return; } catch { return; }
    clearTimeout(frameTimer);
    frameStatus = 'ready';
    byId('preview-message').hidden = true;
    frame.hidden = false;
    announce(`${current().number} of ${manifest.options.length}: ${current().family}, ${current().name}. Use Left and Right to explore.`);
  }
  function frameError(message) {
    clearTimeout(frameTimer);
    frameStatus = 'failed';
    lastError = {code: 'PREVIEW_ERROR', message};
    byId('preview-message-text').textContent = message;
    byId('retry-preview').hidden = false;
    byId('preview-message').hidden = false;
    announce(message);
  }
  function loadFrame() {
    clearTimeout(frameTimer);
    frameStatus = 'loading';
    frame.hidden = true;
    byId('preview-message').hidden = false;
    byId('retry-preview').hidden = true;
    byId('preview-message-text').textContent = `Opening ${current().family} — ${current().name}…`;
    const url = new URL(current().src, location.origin);
    url.searchParams.set('reviewRevision', String(revision));
    frame.title = `${current().family} — ${current().name}: interactive comparison chrome`;
    frame.src = url.href;
    const requestedRevision = revision;
    frameTimer = setTimeout(() => { if (revision === requestedRevision && frameStatus !== 'ready') frameError('This design did not finish loading. Try again or move to another design.'); }, 20000);
  }
  function select(id, replace = false) {
    const option = manifest.options.find(o => o.id === id);
    setHash(option.id, replace);
    if (selectedId === option.id) return result();
    selectedId = option.id;
    lastError = null;
    revision++;
    byId('design-position').textContent = `${option.number} / ${manifest.options.length}`;
    byId('design-name').textContent = option.name;
    byId('design-family').textContent = option.family;
    byId('design-description').textContent = option.description;
    byId('design-typeface').textContent = option.typeface;
    byId('reference-link').href = option.reference;
    byId('share-url').value = location.href;
    byId('copy-fallback').hidden = true;
    for (const button of document.querySelectorAll('[data-select]')) button.setAttribute('aria-current', String(button.dataset.select === id));
    closePanels();
    document.title = `${option.number} ${option.name} · ${option.family} · This or that`;
    loadFrame();
    notify();
    return result();
  }
  function act(request) {
    if (!request || typeof request !== 'object' || Array.isArray(request) || !Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0) return failure('INVALID_REQUEST', 'Supply an action and current non-negative expectedRevision.');
    if (!['select','next','previous','focus-review'].includes(request.action)) return failure('INVALID_ACTION', 'Use select, next, previous or focus-review.');
    if (!ready) return failure('NOT_READY', 'The design catalog is not ready.');
    if (request.expectedRevision !== revision) return failure('STALE_REVISION', 'Inspect the current revision before acting again.');
    if (request.action === 'focus-review') return result({focused: focusReview()});
    if (request.action === 'select') {
      if (typeof request.id !== 'string' || !manifest.options.some(o => o.id === request.id)) return failure('INVALID_ID', 'Choose an ID from the current design catalog.');
      return select(request.id);
    }
    const index = manifest.options.findIndex(o => o.id === selectedId);
    const delta = request.action === 'next' ? 1 : -1;
    return select(manifest.options[(index + delta + manifest.options.length) % manifest.options.length].id);
  }
  function wait(request) {
    const timeoutMs = request?.timeoutMs ?? 10000;
    if (!Number.isSafeInteger(request?.afterRevision) || request.afterRevision < 0 || request.afterRevision > revision || !Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > 30000) return Promise.resolve(failure('INVALID_REQUEST', 'Use an observed afterRevision and timeoutMs between 0 and 30000.'));
    if (revision > request.afterRevision) return Promise.resolve(result({changed: true, timedOut: false}));
    return new Promise(resolve => {
      const waiter = {afterRevision: request.afterRevision, resolve, timer: null};
      waiter.timer = setTimeout(() => { waiters.delete(waiter); resolve(result({changed: false, timedOut: true})); }, timeoutMs);
      waiters.add(waiter);
    });
  }
  function diagnose() {
    const problems = [];
    if (!ready) problems.push({code: 'NOT_READY', message: loading ? 'Loading design catalog.' : 'Design catalog unavailable.'});
    if (ready && frameStatus !== 'ready') problems.push({code: 'PREVIEW_UNAVAILABLE', message: `Preview is ${frameStatus}.`});
    if (frameStatus === 'ready' && !frameMatches()) problems.push({code: 'IDENTITY_MISMATCH', message: 'The loaded document does not match the selected design and revision.'});
    return result({healthy: problems.length === 0, problems, preview: previewInfo(), limits});
  }
  window.chromeMockups = Object.freeze({discover, query: () => result(), inspect: () => result({controls: controls(), preview: previewInfo(), focusedControl: document.activeElement?.id || null, limits}), act, wait, diagnose});
  function renderIndex() {
    byId('design-index').innerHTML = manifest.groups.map(group => `<section class="design-group"><h2>${esc(group.name)}</h2>${manifest.options.filter(o => o.familyId === group.id).map(o => `<button type="button" data-select="${esc(o.id)}" aria-current="false"><span>${esc(o.number)}</span>${esc(o.name)}</button>`).join('')}</section>`).join('');
  }
  function hashId() { try { return decodeURIComponent(location.hash.slice(1)); } catch { return location.hash.slice(1); } }
  async function loadManifest() {
    if (loading) return;
    loading = true;
    byId('preview-message').hidden = false;
    byId('retry-preview').hidden = true;
    byId('preview-message-text').textContent = 'Loading the design collection…';
    try {
      const response = await fetch('/mockups.json');
      if (!response.ok) throw new Error(`Catalog request returned HTTP ${response.status}.`);
      const data = await response.json();
      if (data.protocol !== protocol || !Array.isArray(data.options) || data.options.length !== 18 || !Array.isArray(data.groups) || data.groups.length !== 6 || new Set(data.options.map(o => o.id)).size !== 18 || !data.options.some(o => o.id === data.defaultId)) throw new Error('Expected the eighteen-design v2 catalog.');
      for (const option of data.options) {
        if (['id','name','number','family','familyId','typeface','description','src','reference'].some(key => typeof option[key] !== 'string') || !/^[a-z0-9-]+$/.test(option.id) || option.src !== `/chrome-designs/${option.id}.html` || !option.reference.startsWith('https://')) throw new Error('The catalog contains an invalid design.');
      }
      if (data.groups.some(group => typeof group.id !== 'string' || typeof group.name !== 'string' || data.options.filter(o => o.familyId === group.id).length !== 3)) throw new Error('Each reference family must contain three designs.');
      manifest = data; ready = true; loading = false;
      renderIndex();
      for (const id of ['previous-design','next-design','design-menu','copy-link']) byId(id).disabled = false;
      const requested = hashId();
      const valid = data.options.some(o => o.id === requested);
      select(valid ? requested : data.defaultId, true);
      if (requested && !valid) { lastError = {code: 'INVALID_ID', message: 'That link is not in this collection. Showing the first design.'}; announce(lastError.message); }
    } catch (error) {
      ready = false; loading = false; revision++;
      lastError = {code: 'MANIFEST_ERROR', message: error instanceof Error ? error.message : 'The design collection could not be loaded.'};
      frameStatus = 'unavailable';
      byId('preview-message-text').textContent = `${lastError.message} Try loading again.`;
      byId('retry-preview').hidden = false;
      notify();
    }
  }
  const navigate = action => act({action, expectedRevision: revision});
  byId('previous-design').addEventListener('click', () => navigate('previous'));
  byId('next-design').addEventListener('click', () => navigate('next'));
  byId('design-menu').addEventListener('click', () => {
    const wasOpen = !byId('design-index').hidden;
    closePanels();
    byId('design-index').hidden = wasOpen;
    byId('design-menu').setAttribute('aria-expanded', String(!wasOpen));
    if (!wasOpen) byId('design-index').querySelector('[aria-current="true"]')?.focus();
  });
  byId('design-index').addEventListener('click', event => {
    const button = event.target.closest('[data-select]');
    if (button) { const outcome = act({action: 'select', id: button.dataset.select, expectedRevision: revision}); if (outcome.ok) focusReview(); }
  });
  byId('about-design').addEventListener('click', () => {
    const wasOpen = !byId('design-details').hidden;
    closePanels();
    byId('design-details').hidden = wasOpen;
    byId('about-design').setAttribute('aria-expanded', String(!wasOpen));
  });
  byId('retry-preview').addEventListener('click', () => { if (ready) { lastError = null; loadFrame(); } else void loadManifest(); });
  frame.addEventListener('load', () => {
    if (!ready || !frameMatches()) return;
    if (!frame.contentWindow.chromeDesign) frameError('The design runtime is unavailable. Try again or choose another design.');
    else markFrameReady();
  });
  frame.addEventListener('error', () => frameError('The design could not be loaded. Try again or choose another design.'));
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== frame.contentWindow || event.data?.protocol !== reviewProtocol || event.data.designId !== selectedId || event.data.expectedRevision !== revision) return;
    if (event.data.action === 'ready') markFrameReady();
    else if (event.data.action === 'focus-review') focusReview();
    else if (event.data.action === 'navigate' && ['next','previous'].includes(event.data.direction)) { navigate(event.data.direction); focusReview(); }
  });
  document.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat || event.isComposing) return;
    if (event.key === 'Escape') { closePanels(); if (ready) focusReview(); return; }
    const editing = event.composedPath().some(n => n?.nodeType === 1 && (n.isContentEditable || n.matches('input,textarea,select,[role="textbox"],[role="combobox"],[role="slider"],[role="spinbutton"]')));
    if (editing || !ready || !['ArrowLeft','ArrowRight'].includes(event.key)) return;
    event.preventDefault(); navigate(event.key === 'ArrowRight' ? 'next' : 'previous'); focusReview();
  });
  window.addEventListener('hashchange', () => {
    if (!ready) return;
    const id = hashId() || manifest.defaultId;
    if (!manifest.options.some(o => o.id === id)) { lastError = {code: 'INVALID_ID', message: 'That link is not in this collection. Keeping the current design.'}; setHash(selectedId, true); announce(lastError.message); return; }
    select(id, true);
  });
  byId('copy-link').addEventListener('click', async () => {
    const selectedRevision = revision;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable.');
      await navigator.clipboard.writeText(location.href);
      if (selectedRevision === revision) announce('Design link copied. No preference was saved.');
    } catch {
      if (selectedRevision !== revision) return;
      closePanels(); byId('design-details').hidden = false; byId('about-design').setAttribute('aria-expanded', 'true');
      byId('copy-fallback').hidden = false; byId('share-url').value = location.href; byId('share-url').focus(); byId('share-url').select();
      announce('Copy the selected design link manually.');
    }
  });
  void loadManifest();
})();
