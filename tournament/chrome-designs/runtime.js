(() => {
  'use strict';
  const protocol = 'this-or-that/chrome-design/v1';
  const reviewProtocol = 'this-or-that/chrome-review/v1';
  const designId = document.body.dataset.design;
  const reviewRevision = Number(new URLSearchParams(location.search).get('reviewRevision'));
  const notes = [...document.querySelectorAll('[data-note]')];
  const votes = [...document.querySelectorAll('[data-vote]')];
  const frames = [...document.querySelectorAll('iframe[data-candidate]')];
  const waiters = new Set();
  let revision = 0;
  let response = null;
  let ready = false;
  const limits = {
    previewOnly: true, recordsRankings: false, persistsPreference: false,
    sampleState: 'Page memory only; resets when navigating to another design.',
    candidates: 'Original interactive candidate documents; no styling changes.',
    keyboard: 'Left/Right browse designs on non-editable surfaces. Inputs, selects, editable text and specialized keyboard widgets retain their arrows. Escape focuses the review controls.'
  };
  const state = () => ({designId, ready, revision, response, notes: Object.fromEntries(notes.map(n => [n.dataset.note, n.value])), panels: [...document.querySelectorAll('[data-panel-toggle]')].map(b => ({id: b.dataset.panelToggle, expanded: b.getAttribute('aria-expanded') === 'true'}))});
  const result = extra => ({ok: true, protocol, state: state(), ...extra});
  const failure = (code, message) => ({ok: false, protocol, error: {code, message}, state: state()});
  const announce = text => document.querySelectorAll('[data-status]').forEach(n => { n.textContent = text; });
  const post = (action, extra = {}) => {
    if (parent !== window) parent.postMessage({protocol: reviewProtocol, designId, expectedRevision: reviewRevision, action, ...extra}, location.origin);
  };
  function changed() {
    revision++;
    for (const w of waiters) if (revision > w.afterRevision) {
      clearTimeout(w.timer); waiters.delete(w); w.resolve(result({changed: true, timedOut: false}));
    }
    window.dispatchEvent(new CustomEvent('chrome-design:change', {detail: state()}));
  }
  const labels = {left: 'Blueprint workbench chosen', right: 'Team routes chosen', skip: 'Comparison skipped', like: 'Both designs liked', hate: 'Both designs disliked'};
  function vote(value) {
    response = value;
    votes.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.vote === value)));
    announce(`Sample only: ${labels[value]}. No ranking was recorded.`);
    changed();
  }
  function reset() {
    response = null;
    notes.forEach(note => { note.value = ''; });
    votes.forEach(button => button.setAttribute('aria-pressed', 'false'));
    announce('Sample notes and response cleared. No rankings were changed.');
    changed();
  }
  for (const button of votes) button.addEventListener('click', () => vote(button.dataset.vote));
  for (const note of notes) note.addEventListener('input', changed);
  for (const button of document.querySelectorAll('[data-action="reset"]')) button.addEventListener('click', reset);
  for (const button of document.querySelectorAll('[data-panel-toggle]')) {
    const panel = document.getElementById(button.dataset.panelToggle);
    button.setAttribute('aria-controls', button.dataset.panelToggle);
    button.setAttribute('aria-expanded', String(!!panel && !panel.hidden));
    button.addEventListener('click', () => {
      if (!panel) return;
      panel.hidden = !panel.hidden;
      button.setAttribute('aria-expanded', String(!panel.hidden));
      changed();
    });
  }
  function controls() {
    return [
      ...votes.map(b => ({id: `vote-${b.dataset.vote}`, role: 'button', name: b.textContent.trim(), selected: b.getAttribute('aria-pressed') === 'true', available: !b.disabled, selector: `[data-vote="${b.dataset.vote}"]`})),
      ...notes.map(n => ({id: `note-${n.dataset.note}`, role: 'textbox', value: n.value, available: !n.disabled && !n.readOnly, selector: `[data-note="${n.dataset.note}"]`})),
      ...document.querySelectorAll('[data-panel-toggle]')
    ].map(c => c instanceof Element ? {id: `panel-${c.dataset.panelToggle}`, role: 'button', name: c.textContent.trim(), expanded: c.getAttribute('aria-expanded') === 'true', available: !c.disabled, selector: `[data-panel-toggle="${c.dataset.panelToggle}"]`} : c);
  }
  function act(request) {
    if (!request || typeof request !== 'object' || !Number.isSafeInteger(request.expectedRevision)) return failure('INVALID_REQUEST', 'Supply expectedRevision and an action.');
    if (request.expectedRevision !== revision) return failure('STALE_REVISION', 'Inspect the current preview revision before acting.');
    if (!ready) return failure('NOT_READY', 'The preview is loading.');
    if (request.action === 'vote') {
      const button = votes.find(b => b.dataset.vote === request.value);
      if (!button || button.disabled) return failure('UNAVAILABLE', 'Unknown or unavailable sample response.');
      button.click();
    } else if (request.action === 'note') {
      const note = notes.find(n => n.dataset.note === request.side);
      if (!note || note.disabled || note.readOnly || typeof request.text !== 'string') return failure('INVALID_REQUEST', 'Supply an available note side and string text.');
      note.value = request.text;
      note.dispatchEvent(new Event('input', {bubbles: true}));
    } else if (request.action === 'reset') reset();
    else if (request.action === 'toggle-panel') {
      const button = [...document.querySelectorAll('[data-panel-toggle]')].find(b => b.dataset.panelToggle === request.id);
      if (!button || button.disabled) return failure('UNAVAILABLE', 'Unknown or unavailable panel.');
      button.click();
    } else return failure('INVALID_ACTION', 'Use vote, note, reset or toggle-panel.');
    return result();
  }
  function wait(request) {
    const ms = request?.timeoutMs ?? 10000;
    if (!Number.isSafeInteger(request?.afterRevision) || request.afterRevision < 0 || request.afterRevision > revision || !Number.isFinite(ms) || ms < 0 || ms > 30000) return Promise.resolve(failure('INVALID_REQUEST', 'Use an observed afterRevision and timeoutMs between 0 and 30000.'));
    if (revision > request.afterRevision) return Promise.resolve(result({changed: true, timedOut: false}));
    return new Promise(resolve => {
      const w = {afterRevision: request.afterRevision, resolve, timer: null};
      w.timer = setTimeout(() => { waiters.delete(w); resolve(result({changed: false, timedOut: true})); }, ms);
      waiters.add(w);
    });
  }
  function diagnose() {
    const problems = [];
    if (!ready) problems.push('Preview is loading.');
    if (frames.length !== 2) problems.push('Expected two candidate frames.');
    for (const side of ['left', 'right']) {
      if (!frames.some(f => f.dataset.candidate === side)) problems.push(`Missing ${side} frame.`);
      if (!notes.some(n => n.dataset.note === side)) problems.push(`Missing ${side} notes.`);
    }
    for (const value of Object.keys(labels)) if (!votes.some(b => b.dataset.vote === value)) problems.push(`Missing ${value} sample control.`);
    return result({healthy: problems.length === 0, problems});
  }
  window.chromeDesign = Object.freeze({
    discover: () => ({protocol, designId, operations: ['discover', 'inspect', 'query', 'act', 'wait', 'diagnose'], schemas: {act: {expectedRevision: 'integer', action: 'vote|note|reset|toggle-panel', vote: {value: 'left|right|skip|like|hate'}, note: {side: 'left|right|pair', text: 'string'}, 'toggle-panel': {id: 'exact panel ID'}}}, controls: controls(), limits}),
    query: () => result(), inspect: () => result({controls: controls(), frames: frames.map(f => ({side: f.dataset.candidate, src: f.getAttribute('src'), title: f.title})), limits}), act, wait, diagnose
  });
  function editing(event) {
    return event.composedPath().some(n => n?.nodeType === 1 && (n.isContentEditable || n.matches('input,textarea,select,[role="textbox"],[role="combobox"],[role="slider"],[role="spinbutton"],[role="tablist"],[role="menu"],[role="tree"],[role="grid"]')));
  }
  function keydown(event) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat || event.isComposing) return;
    if (event.key === 'Escape') { post('focus-review'); return; }
    if (parent === window || editing(event) || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    post('navigate', {direction: event.key === 'ArrowRight' ? 'next' : 'previous'});
  }
  document.addEventListener('keydown', keydown, true);
  for (const frame of frames) {
    const attach = () => {
      try { frame.contentDocument?.addEventListener('keydown', keydown, true); } catch { /* Candidate can only bridge when same-origin. */ }
    };
    frame.addEventListener('load', attach);
    attach();
  }
  window.addEventListener('message', event => {
    if (event.origin === location.origin && frames.some(f => f.contentWindow === event.source) && event.data?.type === 'tot:exit-interaction') post('focus-review');
  });
  document.fonts.ready.then(() => {
    ready = true; changed(); post('ready');
  });
})();
