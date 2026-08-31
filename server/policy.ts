import {
  DomainError, LIMITS, OWNER_IDS, TASK_IDS,
  type Action, type Availability, type ClientClass, type Inspection, type PaneId, type SessionDocument, type SessionMode,
} from '../shared/contract';
import { ACTION_TYPES } from '../shared/validate';
import type { Provenance } from '../shared/reducer';

export function authorizeMode(mode: SessionMode, testMode: boolean): void {
  if (mode === 'test' && !testMode) throw new DomainError('MODE_UNAVAILABLE', 'Test sessions require explicit server test mode.', 403);
  if (mode === 'recording' && testMode) throw new DomainError('MODE_UNAVAILABLE', 'Recording sessions are disabled in test mode.', 403);
}
export function authorizeCreate(mode: SessionMode, client: ClientClass, testMode: boolean): void {
  authorizeMode(mode, testMode);
  if (client === 'agent' && mode !== 'rehearsal') throw new DomainError('FORBIDDEN_ACTOR', 'Agents may create rehearsal sessions only.', 403);
}
export function actionProvenance(state: SessionDocument, client: ClientClass): Provenance {
  if (client === 'agent') return 'agent';
  return state.ref.mode === 'test' ? 'test-fixture' : 'human-ui';
}

function editablePanes(state: SessionDocument): PaneId[] {
  if (state.chosen) return ['chosen'];
  if (state.comparison.phase === 'active' && state.comparison.taskPhase === 'playing') return ['A', 'B'];
  return [];
}

export function availableActions(state: SessionDocument, client: ClientClass = 'ui'): Record<Action['type'], Availability> {
  const result = Object.fromEntries(ACTION_TYPES.map(type => [type, { enabled: false, reason: 'Unavailable in the current phase.' }])) as Record<Action['type'], Availability>;
  const disableAll = client === 'agent' && state.ref.mode !== 'rehearsal'
    ? 'Agents may inspect this session but may mutate rehearsal sessions only.'
    : state.receipts.length >= LIMITS.receipts ? 'This session reached its command limit; export it and create a new session.' : null;
  if (disableAll) {
    for (const type of ACTION_TYPES) result[type].reason = disableAll;
    return result;
  }
  const panes = editablePanes(state);
  const active = state.comparison.phase === 'active';
  const playing = active && state.comparison.taskPhase === 'playing';
  const rehearsal = state.ref.mode === 'rehearsal';
  const human = client === 'ui' && !rehearsal;
  const rules: Record<Action['type'], [boolean, string]> = {
    'pane.move': [panes.length > 0, 'There is no editable pane in this phase.'],
    'pane.reset': [panes.length > 0, 'There is no editable pane in this phase.'],
    'pane.undo': [panes.some(id => (id === 'chosen' ? state.chosen!.pane : state.comparison.panes[id]).undo.length > 0), 'No editable pane has a queue change to undo.'],
    'note.save': [playing, 'Notes are sealed after a task decision or Finish.'],
    'decision.record': [human && playing, client === 'agent' ? 'Agents cannot record preference ballots.' : rehearsal ? 'Rehearsal has no preference ballots.' : 'This task is not awaiting a decision.'],
    'scenario.advance': [human && active && state.comparison.taskPhase === 'decided' && state.comparison.taskId !== TASK_IDS.at(-1), rehearsal ? 'Use scenario.load in rehearsal.' : 'Advance requires a saved decision and a remaining task.'],
    'scenario.load': [rehearsal && active, 'Prepared task loading is rehearsal-only.'],
    'comparison.finish': [human && active, rehearsal ? 'Rehearsal is not a comparison recording.' : 'This comparison is already finished.'],
    'selection.commit': [human && !active && state.selection === null, rehearsal ? 'Rehearsal has no selection.' : 'Selection requires a finished, as-yet unselected comparison.'],
  };
  for (const type of ACTION_TYPES) {
    const [enabled, reason] = rules[type];
    result[type] = { enabled, reason: enabled ? null : reason };
  }
  return result;
}

export function authorizeActor(state: SessionDocument, action: Action, client: ClientClass, testMode = false): void {
  authorizeMode(state.ref.mode, testMode);
  if (client === 'agent' && (state.ref.mode !== 'rehearsal' || action.type === 'decision.record' || action.type === 'selection.commit')) {
    throw new DomainError('FORBIDDEN_ACTOR', 'Agents cannot create preference evidence or mutate non-rehearsal sessions.', 403);
  }
}

export function authorizeAction(state: SessionDocument, action: Action, client: ClientClass, testMode = false): void {
  authorizeActor(state, action, client, testMode);
  const availability = availableActions(state, client)[action.type];
  if (!availability.enabled) throw new DomainError('ACTION_UNAVAILABLE', availability.reason ?? 'This action is unavailable.', 409);
}

export function inspectState(state: SessionDocument, client: ClientClass = 'ui'): Inspection {
  const actions = availableActions(state, client);
  const editable = new Set(actions['pane.move'].enabled ? editablePanes(state) : []);
  const targets: Inspection['targets'] = [];
  const paneIds: PaneId[] = state.chosen ? ['A', 'B', 'chosen'] : ['A', 'B'];
  for (const paneId of paneIds) {
    const current = paneId === 'chosen' ? state.chosen!.pane : state.comparison.panes[paneId];
    targets.push({ id: `pane:${paneId}`, paneId });
    for (const ownerId of OWNER_IDS) {
      targets.push({ id: `pane:${paneId}/owner:${ownerId}`, paneId, ownerId });
      for (const ticketId of current.queues[ownerId]) {
        targets.push({ id: `pane:${paneId}/ticket:${ticketId}`, paneId, ownerId, ticketId });
        if (editable.has(paneId)) targets.push({ id: `pane:${paneId}/owner:${ownerId}/before:${ticketId}`, paneId, ownerId, beforeTicketId: ticketId });
      }
      if (editable.has(paneId)) targets.push({ id: `pane:${paneId}/owner:${ownerId}/before:end`, paneId, ownerId, beforeTicketId: null });
    }
  }
  return { ok: true, state, availableActions: actions, targets };
}
