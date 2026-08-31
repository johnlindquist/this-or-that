import { LIMITS, TASK_IDS, type Choice, type OwnerId, type PaneId, type PaneState, type SessionMode, type VariantId } from '../shared/contract';
import { goalMatches, OWNERS, TASKS } from '../shared/fixture';
import { Controller, textProblem } from './controller';
import { button, download, element, link } from './dom';
import { mountColumns } from './widgets/columns';
import { mountQueues } from './widgets/queues';
import type { WidgetHandle, WidgetPort } from './widgets/types';

const names: Record<VariantId, string> = { A: 'Developer columns', B: 'Expandable queues' };
const modeNames: Record<SessionMode, string> = { rehearsal: 'Rehearsal — not a preference record', recording: 'Human comparison', test: 'Automated test — not human evidence' };
const choiceNames: Record<Choice, string> = { A: 'A · Developer columns', B: 'B · Expandable queues', 'both-bad': 'Both bad', skip: 'Skipped' };
function testButton(text: string, testid: string, action: () => void, className = 'button'): HTMLButtonElement {
  const node = button(text, action, className); node.dataset.testid = testid; node.id = testid; return node;
}

export function mountShell(root: HTMLElement, controller: Controller): () => void {
  let widgets: WidgetHandle[] = [];
  let visiblePane: VariantId = 'A';
  let priorSession = '';
  let priorPrepared = '';
  let priorPhase = '';
  const expanded: Record<PaneId, Set<OwnerId>> = { A: new Set(['backlog']), B: new Set(['backlog']), chosen: new Set(['backlog']) };
  const media = matchMedia('(min-width: 1360px)');
  const announcements: Partial<Record<PaneId, string>> = {};

  function announce(pane: PaneId, message: string): void {
    announcements[pane] = message;
    const node = document.getElementById(`live-${pane}`); if (node) node.textContent = message;
  }
  function pageLink(text: string, path: string, className = ''): HTMLAnchorElement {
    const node = link(text, path, className);
    node.addEventListener('click', event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); void controller.navigate(path);
    }); return node;
  }
  function renderHeader(): HTMLElement {
    const header = element('header', 'app-header');
    const title = pageLink('This or that', '/', 'brand');
    const sub = element('span', 'header-subtitle', 'Sprint distribution');
    const identity = element('div', 'header-identity'); identity.append(title, sub);
    const status = element('div', 'header-status');
    if (controller.ref) {
      const mode = element('span', 'mode-label', modeNames[controller.ref.mode]);
      const session = element('span', 'session-id', `Session ${controller.ref.id.slice(0, 8)}`); session.title = controller.ref.id;
      status.append(mode, session);
    }
    const save = element('span', 'save-status', controller.status); save.id = 'save-status'; save.setAttribute('role', 'status');
    const refresh = testButton('Refresh saved state', 'refresh-state', () => { void controller.refreshSavedState(); }, 'button small'); refresh.disabled = !controller.canRefresh;
    status.append(save, refresh); header.append(identity, status); return header;
  }
  function renderRecovery(): HTMLElement | null {
    const unresolved = controller.pending !== null && !controller.busy;
    const stranded = controller.strandedNotes;
    if (!controller.error && !controller.storageWarning && !unresolved && !controller.rejected && !stranded.length && !controller.notesNeedReview) return null;
    const box = element('section', 'recovery-banner'); box.setAttribute('aria-label', 'Save and recovery');
    if (controller.error) { const error = element('p', '', controller.error); error.setAttribute('role', 'alert'); box.append(error); }
    if (controller.storageWarning) box.append(element('p', '', controller.storageWarning));
    const pending = unresolved ? controller.pending : null;
    if (pending?.kind === 'action') {
      const action = pending.body.action;
      let proposal = `Pending ${action.type}. This is not an acknowledged result.`;
      if (action.type === 'pane.move') proposal = `Not saved: ${action.ticketId} in ${action.paneId} → ${OWNERS.find(owner => owner.id === action.toOwnerId)!.name}, ${action.beforeTicketId ? `before ${action.beforeTicketId}` : 'last priority'}. Boards below show the last acknowledged state.`;
      if (action.type === 'decision.record') proposal = `Not saved: ${choiceNames[action.choice]}. No ballot is counted until acknowledged.`;
      if (action.type === 'selection.commit') proposal = `Not saved: use ${action.variantId}. No widget is selected until acknowledged.`;
      box.append(element('p', 'pending-proposal', proposal));
    }
    if (controller.rejected) box.append(element('p', '', 'Server state reloaded. The previous proposal was not reapplied. Inspect the boards before making a fresh action; the proposal remains in recovery export.'));
    if (controller.notesNeedReview) box.append(element('p', '', 'Fresh server state is visible. Your note draft is unchanged and autosave is paused. Review it, then choose Save note now; no pending request has been rebased.'));
    for (const [task, text] of stranded) {
      const label = element('label', 'note-label', `Unsaved recovery · ${TASKS[task].title}`); label.htmlFor = `recovery-note-${task}`;
      const note = element('textarea'); note.id = label.htmlFor; note.value = text; note.readOnly = true; note.rows = 3;
      const discard = button('Discard this recovered draft', () => { if (confirm('Discard this unsaved draft? Download recovery first if you want to keep its full text. The saved task will not change.')) controller.discardStrandedNote(task); }); discard.disabled = controller.blocked;
      box.append(label, note, element('p', '', 'This task is no longer editable. Its full draft is retained here and in Download recovery; it has not changed the saved evidence.'), discard);
    }
    const actions = element('div', 'button-row');
    if (pending) {
      const retry = testButton('Retry same request', 'retry-save', () => { void controller.retry(); }); retry.disabled = !controller.canRefresh;
      const refresh = button('Reload server state; do not reapply', () => { void controller.refreshWithoutReapplying(); }); refresh.disabled = !controller.canRefresh;
      actions.append(retry, refresh);
    } else if (controller.error) { const retry = button('Retry connection', () => { void controller.refreshSavedState(); }); retry.disabled = !controller.canRefresh; actions.append(retry); }
    actions.append(button('Download recovery', () => download('unsaved-recovery-not-preference-evidence.json', controller.recovery())));
    box.append(actions); return box;
  }
  function renderHome(): HTMLElement {
    const main = element('main', 'home'); main.id = 'main';
    const intro = element('section', 'home-intro');
    intro.append(element('h1', '', 'Try the work. Then choose the widget.'), element('p', 'home-lead', 'Distribute the same eight sprint tickets in two working layouts. Assignment, priority, handoff — three small tasks make the differences tangible.'));
    const start = element('div', 'home-start');
    const rehearsal = testButton('Try the demo', 'start-rehearsal', () => { void controller.create('rehearsal'); }, 'button primary'); rehearsal.disabled = controller.blocked;
    const recording = testButton(controller.discovery?.testMode ? 'Start a test comparison' : 'Start a human comparison', controller.discovery?.testMode ? 'start-test' : 'start-recording', () => { void controller.create(controller.discovery?.testMode ? 'test' : 'recording'); }); recording.disabled = controller.blocked || !controller.discovery;
    start.append(rehearsal, recording); intro.append(start, element('p', 'muted', 'The demo is a rehearsal: play freely, without recording preferences. Start a separate comparison when you want to save your own choices.'));
    const overview = element('div', 'home-overview');
    for (const variant of ['A', 'B'] as const) {
      const row = element('section', 'preview-row');
      row.append(element('span', 'variant-letter', variant), element('h2', '', names[variant]), element('p', '', variant === 'A' ? 'Unassigned tickets above three developer columns. Every queue in view.' : 'Compact developer rows. Expand a queue, or drop on a closed row to append.'));
      overview.append(row);
    }
    main.append(intro, overview);
    const resume = element('section', 'resume-section'); resume.append(element('h2', '', 'Pick up where you left off'));
    if (!controller.sessions.length) resume.append(element('p', 'muted', 'Your saved sessions will appear here. Try the demo to start your first one.'));
    else {
      const list = element('ul', 'session-list');
      for (const session of [...controller.sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
        const item = element('li');
        const title = pageLink(`${modeNames[session.ref.mode]} · ${session.ref.id.slice(0, 8)}`, `/compare/${session.ref.mode}/${session.ref.id}`);
        const detail = element('span', 'muted', `${session.phase === 'finished' ? 'Finished' : TASKS[session.taskId].title} · ${new Date(session.updatedAt).toLocaleString()}`);
        item.append(title, detail); list.append(item);
      }
      resume.append(list);
    }
    main.append(resume); return main;
  }
  function getPane(paneId: PaneId): PaneState {
    const state = controller.inspection!.state;
    return paneId === 'chosen' ? state.chosen!.pane : state.comparison.panes[paneId];
  }
  function paneEditable(paneId: PaneId): boolean {
    if (!controller.available('pane.move')) return false;
    const state = controller.inspection!.state;
    return paneId === 'chosen' ? Boolean(state.chosen) : state.comparison.phase === 'active' && state.comparison.taskPhase === 'playing';
  }
  function renderPane(paneId: PaneId, variant: VariantId): HTMLElement {
    const state = controller.inspection!.state;
    const pane = element('section', `trial-pane${paneId === 'chosen' ? ' chosen-pane' : ''}`); pane.id = `pane-${paneId}`; pane.dataset.pane = paneId;
    if (paneId !== 'chosen') { pane.setAttribute('role', media.matches ? 'region' : 'tabpanel'); pane.setAttribute('aria-labelledby', media.matches ? `title-${paneId}` : `view-${paneId}`); }
    const head = element('header', 'pane-header');
    const title = element('h2'); title.id = `title-${paneId}`; title.append(element('span', 'variant-letter', variant), document.createTextNode(names[variant]));
    const tools = element('div', 'pane-actions');
    const undo = button('Undo', () => { const current = getPane(paneId); void controller.act({ type: 'pane.undo', paneId, expectedPaneRevision: current.revision }).then(saved => { if (saved) announce(paneId, 'Last queue change undone. Saved.'); }); });
    undo.id = `undo-${paneId}`; undo.dataset.action = 'undo'; undo.disabled = !paneEditable(paneId) || !getPane(paneId).undo.length || !controller.available('pane.undo');
    const reset = button(paneId === 'chosen' ? 'Reset snapshot' : 'Reset task', () => { const current = getPane(paneId); void controller.act({ type: 'pane.reset', paneId, expectedPaneRevision: current.revision }).then(saved => { if (saved) announce(paneId, 'Pane reset. You can undo this reset. Saved.'); }); });
    reset.id = `reset-${paneId}`; reset.dataset.action = 'reset'; reset.disabled = !paneEditable(paneId) || !controller.available('pane.reset');
    tools.append(undo, reset); head.append(title, tools);
    const description = element('p', 'pane-description', variant === 'A' ? '#1 is highest priority. Drop between tickets to set their order.' : '#1 is highest priority. Drop on a closed row to append; hold to expand.');
    description.id = `instructions-${paneId}`;
    const board = element('div', 'board-scroll'); board.dataset.scrollZone = ''; board.dataset.pane = paneId; board.id = `scroll-${paneId}`;
    const host = element('div', 'widget-host'); board.append(host);
    const live = element('p', 'pane-live', announcements[paneId] ?? 'Drag a handle, or use Move… on any ticket.'); live.id = `live-${paneId}`; live.setAttribute('aria-live', 'polite'); live.setAttribute('aria-atomic', 'true');
    const foot = element('div', 'pane-footer');
    if (paneId !== 'chosen') foot.append(element('span', 'goal-status', goalMatches(getPane(paneId).queues, state.comparison.taskId) ? 'Matches task target' : 'Still different from target'));
    foot.append(element('span', 'muted', '8 tickets · 22 demo points'));
    pane.append(head, description, board, foot, live);
    const port: WidgetPort = {
      paneId, getState: () => getPane(paneId), isEditable: () => paneEditable(paneId), expandedOwners: expanded[paneId],
      announce: message => announce(paneId, message), move: move => controller.act({ type: 'pane.move', paneId, ...move }),
      interaction: active => { controller.setInteractionActive(active); const refresh = document.getElementById('refresh-state') as HTMLButtonElement | null; if (refresh) refresh.disabled = !controller.canRefresh; },
    };
    widgets.push((variant === 'A' ? mountColumns : mountQueues)(host, port)); return pane;
  }
  function renderTask(): HTMLElement {
    const state = controller.inspection!.state; const comparison = state.comparison; const task = TASKS[comparison.taskId];
    const section = element('section', 'scenario');
    const progress = element('ol', 'task-progress'); progress.setAttribute('aria-label', 'Prepared tasks');
    TASK_IDS.forEach((id, index) => {
      const item = element('li', id === comparison.taskId ? 'current' : '');
      if (id === comparison.taskId) item.setAttribute('aria-current', 'step');
      item.append(element('span', 'task-number', String(index + 1)));
      if (state.ref.mode === 'rehearsal') {
        const load = button(TASKS[id].title, () => { void controller.act({ type: 'scenario.load', taskId: id }); }, 'text-button');
        load.id = `load-${id}`; load.disabled = !controller.available('scenario.load'); item.append(load);
      } else item.append(element('span', '', TASKS[id].title));
      progress.append(item);
    });
    const instruction = element('p', 'task-instruction', task.instruction); instruction.id = 'task-instruction'; instruction.tabIndex = -1;
    section.append(progress, instruction); return section;
  }
  function renderComparison(): HTMLElement {
    const state = controller.inspection!.state;
    const main = element('main', 'comparison'); main.id = 'main';
    main.append(renderTask());
    if (state.ref.mode === 'rehearsal') {
      const practice = element('div', 'practice-strip'); practice.append(element('span', '', 'Practice freely. Each task starts from a prepared checkpoint. No votes in rehearsal.'));
      const fresh = testButton(controller.discovery?.testMode ? 'Start fresh test comparison' : 'Start fresh human comparison', controller.discovery?.testMode ? 'start-test' : 'start-recording', () => { void controller.create(controller.discovery?.testMode ? 'test' : 'recording'); }, 'button small'); fresh.disabled = controller.blocked;
      practice.append(fresh); main.append(practice);
    }
    if (!media.matches) {
      const nav = element('div', 'sequential-nav'); nav.append(element('p', 'muted', 'Sequential comparison — A and B are not simultaneously visible.'));
      const tabs = element('div', 'pane-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'View a trial — not a preference vote');
      for (const variant of ['A', 'B'] as const) {
        const tab = button(`View ${variant} · ${names[variant]}`, () => { visiblePane = variant; render(); document.getElementById(`view-${variant}`)?.focus(); });
        tab.id = `view-${variant}`; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(visiblePane === variant)); tab.setAttribute('aria-controls', `pane-${variant}`); tab.tabIndex = visiblePane === variant ? 0 : -1;
        tab.addEventListener('keydown', event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Home' || event.key === 'End') { event.preventDefault(); visiblePane = event.key === 'Home' ? 'A' : event.key === 'End' ? 'B' : visiblePane === 'A' ? 'B' : 'A'; render(); document.getElementById(`view-${visiblePane}`)?.focus(); } });
        tabs.append(tab);
      }
      nav.append(tabs); main.append(nav);
    }
    const panes = element('div', 'panes');
    for (const variant of ['A', 'B'] as const) {
      const pane = renderPane(variant, variant); pane.hidden = !media.matches && visiblePane !== variant; panes.append(pane);
    }
    main.append(panes, state.comparison.phase === 'finished' ? renderFinished() : renderBallot()); return main;
  }
  function renderBallot(): HTMLElement {
    const state = controller.inspection!.state; const comparison = state.comparison; const taskId = comparison.taskId;
    const section = element('section', 'ballot'); section.setAttribute('aria-label', 'Notes and task preference');
    const noteBlock = element('div', 'note-block');
    const label = element('label', 'note-label', 'What did you notice?'); label.htmlFor = 'note';
    const prompt = element('span', 'muted', `${TASKS[taskId].prompt} Optional; ${LIMITS.noteCharacters.toLocaleString()} Unicode characters maximum.`); prompt.id = 'note-prompt';
    const note = element('textarea'); note.id = 'note'; note.dataset.testid = 'note'; note.rows = 2; note.value = controller.note(taskId); note.setAttribute('aria-describedby', 'note-prompt note-validation');
    const validation = element('p', 'field-validation'); validation.id = 'note-validation'; validation.setAttribute('aria-live', 'polite');
    const validate = () => { const problem = textProblem(note.value); note.setCustomValidity(problem); note.setAttribute('aria-invalid', String(Boolean(problem))); validation.textContent = problem; validation.hidden = !problem; };
    validate();
    const action = controller.pending?.kind === 'action' ? controller.pending.body.action : null;
    note.readOnly = controller.transitioning || controller.loading || comparison.taskPhase === 'decided' || action?.type === 'decision.record' || action?.type === 'comparison.finish';
    note.addEventListener('input', () => { controller.setNote(taskId, note.value); validate(); const status = document.getElementById('save-status'); if (status) status.textContent = controller.status; });
    noteBlock.append(label, prompt, note, validation);
    if (comparison.taskPhase === 'playing') { const save = button('Save note now', () => { void controller.saveNotes(); }); save.disabled = controller.blocked; noteBlock.append(save); }
    section.append(noteBlock);
    const choices = element('div', 'ballot-controls');
    if (state.ref.mode === 'rehearsal') {
      choices.append(element('p', 'muted', 'Scratch notes only. To record preferences, start a fresh comparison.'));
    } else if (comparison.taskPhase === 'decided') {
      const decision = comparison.decisions.find(item => item.taskId === taskId)!;
      choices.append(element('p', 'decision-saved', `Saved: ${choiceNames[decision.choice]}. The boards are unchanged and locked for this task.`));
      if (taskId !== TASK_IDS.at(-1)) {
        const next = testButton('Next task', 'next-task', () => { void controller.act({ type: 'scenario.advance', taskId }); }, 'button primary'); next.disabled = !controller.available('scenario.advance');
        choices.append(next, element('p', 'muted', 'Next loads the next prepared checkpoint into both panes.'));
      } else choices.append(element('p', 'muted', 'All tasks have a saved response. Finish when you are ready.'));
    } else {
      choices.append(element('p', 'ballot-question', 'Which interaction worked better for this task?'));
      const row = element('div', 'button-row vote-row');
      for (const choice of ['A', 'B', 'both-bad', 'skip'] as const) {
        const vote = testButton(choice === 'A' || choice === 'B' ? `Choose ${choice}` : choice === 'skip' ? 'Skip' : 'Both bad', `vote-${choice}`, () => {
          const current = controller.inspection!.state;
          void controller.act({ type: 'decision.record', taskId, choice, note: controller.note(taskId), observedPaneRevisions: { A: current.comparison.panes.A.revision, B: current.comparison.panes.B.revision }, presentation: { mode: media.matches ? 'side-by-side' : 'sequential', width: innerWidth, height: innerHeight } });
        });
        vote.disabled = !controller.available('decision.record'); row.append(vote);
      }
      choices.append(row, element('p', 'muted', 'A task response is not a final widget selection. Skip is saved, too.'));
    }
    if (state.ref.mode !== 'rehearsal') {
      const finish = testButton('Finish comparison', 'finish', () => { void controller.finish(); }, 'button quiet'); finish.disabled = !controller.available('comparison.finish');
      choices.append(finish, element('p', 'finish-hint', 'You can finish early. Uncast notes remain notes, not votes.'));
    }
    section.append(choices); return section;
  }
  function renderFinished(): HTMLElement {
    const state = controller.inspection!.state; const finish = state.comparison.finish!;
    const section = element('section', 'finished-section');
    const heading = element('h2', '', state.selection ? `Comparison finished. ${state.selection.variantId} explicitly selected.` : 'Comparison finished. No widget selected.'); heading.id = 'finished-heading'; heading.tabIndex = -1; section.append(heading);
    section.append(element('p', 'muted', 'These are this session’s saved responses, in task order. They do not name a winner.'));
    const counts = element('p', 'response-counts');
    counts.textContent = (['A', 'B', 'both-bad', 'skip'] as const).map(choice => `${choice === 'skip' ? 'Skip' : choice === 'both-bad' ? 'Both bad' : choice}: ${finish.snapshot.decisions.filter(item => item.choice === choice).length}`).join(' · ');
    section.append(counts);
    const results = element('ol', 'result-list');
    for (const taskId of TASK_IDS) {
      const decision = finish.snapshot.decisions.find(item => item.taskId === taskId);
      const item = element('li'); item.append(element('h3', '', TASKS[taskId].title), element('p', '', decision ? `Saved response: ${choiceNames[decision.choice]}` : 'No response cast'));
      const note = decision?.note ?? finish.snapshot.drafts[taskId];
      if (note) { const quote = element('blockquote', '', note); item.append(quote); }
      else item.append(element('p', 'muted', 'No note recorded.'));
      if (decision) item.append(element('small', 'muted', `${decision.presentation.mode === 'sequential' ? 'Sequential' : 'Side-by-side'} presentation · ${decision.provenance}`));
      results.append(item);
    }
    section.append(results);
    if (state.selection) {
      if (state.selection.reason) section.append(element('p', 'selection-reason', `Selection reason: ${state.selection.reason}`));
      if (!finish.snapshot.decisions.length) section.append(element('p', '', 'Explicit selection without scenario-vote evidence.'));
      section.append(button(`Open ${state.selection.variantId} workspace`, () => controller.showChosen(), 'button primary'));
    } else {
      const selection = element('div', 'selection-controls');
      selection.append(element('h3', '', 'Keep one for your next move?'), element('p', 'muted', 'Optional and separate from the task responses. Your finished comparison stays sealed.'));
      const label = element('label', 'note-label', 'Selection reason (optional)'); label.htmlFor = 'selection-reason';
      const reason = element('textarea'); reason.id = 'selection-reason'; reason.dataset.testid = 'selection-reason'; reason.rows = 2; reason.value = controller.selectionReason;
      const prompt = element('p', 'muted', `Up to ${LIMITS.noteCharacters.toLocaleString()} Unicode characters. Draft text is recovered in this browser; it does not select a widget.`); prompt.id = 'reason-prompt';
      const validation = element('p', 'field-validation'); validation.id = 'reason-validation'; validation.setAttribute('aria-live', 'polite');
      reason.setAttribute('aria-describedby', 'reason-prompt reason-validation');
      const validate = () => { const problem = textProblem(reason.value); reason.setCustomValidity(problem); reason.setAttribute('aria-invalid', String(Boolean(problem))); validation.textContent = problem; validation.hidden = !problem; };
      validate(); reason.readOnly = controller.blocked;
      reason.addEventListener('input', () => { controller.setSelectionReason(reason.value); validate(); const status = document.getElementById('save-status'); if (status) status.textContent = controller.status; });
      const options = element('div', 'button-row');
      for (const variant of ['A', 'B'] as const) {
        const select = testButton(`Use ${variant} — ${names[variant]}`, `select-${variant}`, () => { void controller.act({ type: 'selection.commit', variantId: variant, reason: controller.selectionReason }).then(saved => { if (saved) controller.showChosen(); }); });
        select.disabled = !controller.available('selection.commit'); options.append(select);
      }
      selection.append(label, prompt, reason, validation, options); section.append(selection);
    }
    const digest = element('details', 'evidence-details'); digest.append(element('summary', '', 'Sealed comparison details'), element('p', 'digest', `SHA-256: ${finish.digest}`), element('p', 'muted', 'Sealed by the application action model; not tamper-proof against someone editing local files.'));
    section.append(digest); return section;
  }
  function renderChosen(): HTMLElement {
    const state = controller.inspection!.state; const main = element('main', 'chosen-workspace'); main.id = 'main';
    if (!state.chosen || !state.selection) {
      main.append(element('h1', '', 'No widget selected'), element('p', '', 'Finish a comparison, then explicitly select a widget to open this workspace.'), pageLink('Return to comparison', `/compare/${state.ref.mode}/${state.ref.id}`, 'button')); return main;
    }
    const intro = element('section', 'chosen-intro');
    intro.append(element('h1', '', `${names[state.chosen.variantId]} · your selected workspace`), element('p', 'muted', 'Keep moving tickets. Undo stays in this workspace; Reset returns to your selection snapshot. Your finished comparison never changes.'), pageLink('View sealed comparison', `/compare/${state.ref.mode}/${state.ref.id}`));
    main.append(intro, renderPane('chosen', state.chosen.variantId)); return main;
  }
  function renderHelp(): HTMLElement {
    const footer = element('footer', 'app-footer');
    footer.append(element('p', '', 'Demo data: all developers and tickets are synthetic.'));
    const tools = element('div', 'footer-tools');
    const help = element('details', 'help');
    const summary = element('summary', '', 'How to play');
    const content = element('div', 'help-content');
    content.append(element('p', '', '#1 is highest priority. In A’s desktop Unassigned grid, order runs left-to-right, then continues on the next row; after it reflows to one column, order runs top-to-bottom. All other queues run top-to-bottom. Drag only the dotted handle; normal ticket text remains selectable. In A, drop between visible tickets. In B, a quick drop on a collapsed row appends; hold over the row to reveal precise positions.'), element('p', '', 'Prefer the keyboard or a touch screen? Open Move… on a ticket, select its destination and priority, then confirm. Escape cancels a drag or closes the dialog. Tickets cannot cross between A and B.'), element('p', '', 'Each pane has independent Undo and Reset. Saved means the local server acknowledged the change. Refresh saved state shows agent changes without reapplying unresolved requests. If a request fails, retry that exact request or explicitly reload server state. Download recovery before closing a tab with unsaved work.'));
    help.append(summary, content); tools.append(help);
    if (controller.ref) {
      const md = link('Export evidence · Markdown', controller.exportUrl('md')); md.download = '';
      const json = link('JSON', controller.exportUrl('json')); json.download = '';
      tools.append(md, json, pageLink('All sessions', '/'));
    }
    footer.append(tools); return footer;
  }
  function render(): void {
    const focused = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
    const focus = focused?.id;
    const selection = focused instanceof HTMLTextAreaElement ? [focused.selectionStart, focused.selectionEnd] as const : null;
    const scrollPositions = [...root.querySelectorAll<HTMLElement>('.board-scroll')].map(node => [node.id, node.scrollTop] as const);
    const state = controller.inspection?.state;
    const session = state ? `${state.ref.mode}:${state.ref.id}` : priorSession;
    let preparedReceipt = '';
    if (state) for (let index = state.receipts.length - 1; index >= 0; index--) {
      const receipt = state.receipts[index]!;
      if (receipt.actionType === 'scenario.load' || receipt.actionType === 'scenario.advance') { preparedReceipt = receipt.requestId; break; }
    }
    const prepared = state ? `${state.comparison.taskId}:${preparedReceipt}` : priorPrepared;
    const sessionChanged = session !== priorSession;
    const preparedChanged = Boolean(state && (sessionChanged || prepared !== priorPrepared));
    const justFinished = Boolean(state && !sessionChanged && priorPhase === 'active' && state.comparison.phase === 'finished');
    if (preparedChanged) {
      for (const pane of ['A', 'B', 'chosen'] as const) delete announcements[pane];
      for (const owners of Object.values(expanded)) { owners.clear(); owners.add('backlog'); }
      if (sessionChanged) visiblePane = 'A';
    }
    if (state) { priorSession = session; priorPrepared = prepared; priorPhase = state.comparison.phase; }
    for (const widget of widgets) widget.destroy(); widgets = [];
    root.replaceChildren(renderHeader());
    const recovery = renderRecovery(); if (recovery) root.append(recovery);
    if (controller.loading && !controller.inspection) {
      const loading = element('main', 'loading-page'); loading.id = 'main'; loading.setAttribute('aria-busy', 'true'); loading.append(element('h1', '', 'Opening the sprint workbench…'), element('p', 'muted', 'Reading the last acknowledged session state.')); root.append(loading);
    } else if (controller.inspection) root.append(controller.route === 'chosen' ? renderChosen() : renderComparison());
    else if (controller.route === 'home') root.append(renderHome());
    else { const error = element('main', 'loading-page'); error.id = 'main'; error.append(element('h1', '', 'This session could not be opened'), pageLink('Return to the workbench', '/', 'button')); root.append(error); }
    root.append(renderHelp());
    if (!preparedChanged) for (const [id, top] of scrollPositions) { const node = document.getElementById(id); if (node) node.scrollTop = top; }
    const heading = justFinished ? 'finished-heading' : preparedChanged && !sessionChanged ? 'task-instruction' : null;
    if (heading) document.getElementById(heading)?.focus();
    else if (focus && !document.querySelector('dialog[open]')) {
      const node = document.getElementById(focus); node?.focus({ preventScroll: true });
      if (selection && node instanceof HTMLTextAreaElement) node.setSelectionRange(...selection);
    }
  }
  const unsubscribe = controller.subscribe(render); media.addEventListener('change', render); render();
  return () => { unsubscribe(); media.removeEventListener('change', render); for (const widget of widgets) widget.destroy(); };
}
