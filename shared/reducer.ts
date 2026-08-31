import {
  CANDIDATE_VERSIONS, DATASET_ID, DomainError, LIMITS, OWNER_IDS, TASK_IDS,
  type Action, type PaneMove, type PaneState, type Queues, type SessionDocument, type SessionRef,
} from './contract';
import { cloneQueues, goalMatches, TASKS } from './fixture';
import { DATASET_DIGEST, digest } from './canonical';
import { assertQueues, parseAction, parseSessionDocument, parseSessionRef } from './validate';
export { assertQueues } from './validate';

export type Provenance = 'human-ui' | 'test-fixture' | 'agent';
export interface ActionContext { now: string | Date; provenance: Provenance }

function timestamp(now: string | Date): string {
  const date = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(date.getTime())) throw new DomainError('VALIDATION_ERROR', 'Invalid action timestamp.');
  return date.toISOString();
}
function pane(queues: Queues): PaneState { return { revision: 0, queues: cloneQueues(queues), undo: [] }; }
function unavailable(message: string): never { throw new DomainError('ACTION_UNAVAILABLE', message, 409); }

export function makeSession(ref: SessionRef, buildId: string, now: string | Date = new Date()): SessionDocument {
  parseSessionRef(ref);
  if (typeof buildId !== 'string' || !buildId.length || buildId.length > 200) throw new DomainError('VALIDATION_ERROR', 'A bounded build identifier is required.');
  const at = timestamp(now);
  return {
    schemaVersion: 1, ref: { ...ref }, revision: 0, datasetId: DATASET_ID, datasetDigest: DATASET_DIGEST,
    buildId, candidateVersions: { ...CANDIDATE_VERSIONS }, createdAt: at, updatedAt: at,
    comparison: {
      phase: 'active', taskId: 'assign', taskPhase: 'playing',
      panes: { A: pane(TASKS.assign.seed), B: pane(TASKS.assign.seed) },
      drafts: { assign: '', prioritize: '', handoff: '' }, decisions: [], finish: null,
    },
    selection: null, chosen: null, receipts: [],
  };
}

/** Remove first, then locate the semantic insertion anchor in the remaining queue. */
export function moveQueues(queues: Queues, move: PaneMove): Queues {
  assertQueues(queues);
  const parsed = parseAction(move);
  if (parsed.type !== 'pane.move') throw new DomainError('VALIDATION_ERROR', 'Expected pane.move.');
  if (move.beforeTicketId === move.ticketId) throw new DomainError('INVALID_TARGET', 'A ticket cannot be inserted before itself.', 409);
  const sourceIndex = queues[move.fromOwnerId].indexOf(move.ticketId);
  if (sourceIndex < 0) throw new DomainError('STALE_TARGET', 'The ticket is no longer in the stated source queue.', 409);
  const next = cloneQueues(queues);
  next[move.fromOwnerId].splice(sourceIndex, 1);
  const destination = next[move.toOwnerId];
  const insertion = move.beforeTicketId === null ? destination.length : destination.indexOf(move.beforeTicketId);
  if (insertion < 0) throw new DomainError('INVALID_TARGET', 'The insertion anchor is not in the destination queue.', 409);
  destination.splice(insertion, 0, move.ticketId);
  assertQueues(next);
  return next;
}

function updatePane(current: PaneState, queues: Queues): PaneState {
  if (OWNER_IDS.every(id => current.queues[id].length === queues[id].length && current.queues[id].every((ticket, index) => ticket === queues[id][index]))) return current;
  return {
    revision: current.revision + 1,
    queues,
    undo: [...current.undo.slice(-(LIMITS.undoDepth - 1)), cloneQueues(current.queues)],
  };
}

/** All UI and API mutations use this reducer; repository owns the outer revision/receipt. */
export function applyAction(state: SessionDocument, input: Action, context: ActionContext): SessionDocument {
  parseSessionDocument(state);
  if (state.datasetId !== DATASET_ID || state.datasetDigest !== DATASET_DIGEST || state.candidateVersions.A !== CANDIDATE_VERSIONS.A || state.candidateVersions.B !== CANDIDATE_VERSIONS.B) {
    throw new DomainError('VERSION_MISMATCH', 'The reducer cannot mutate a session from another dataset or candidate version.', 409);
  }
  const action = parseAction(input);
  const at = timestamp(context.now);
  if (!['human-ui', 'test-fixture', 'agent'].includes(context.provenance)) throw new DomainError('FORBIDDEN_ACTOR', 'Unknown action provenance.', 403);
  if (context.provenance === 'agent' && state.ref.mode !== 'rehearsal') throw new DomainError('FORBIDDEN_ACTOR', 'Agents may mutate rehearsal sessions only.', 403);
  if (state.ref.mode === 'test' && context.provenance !== 'test-fixture') throw new DomainError('FORBIDDEN_ACTOR', 'Test actions require test-fixture provenance.', 403);
  if (state.ref.mode === 'recording' && context.provenance !== 'human-ui') throw new DomainError('FORBIDDEN_ACTOR', 'Recording actions require human-ui provenance.', 403);
  const comparison = state.comparison;
  if ('paneId' in action) {
    const current = action.paneId === 'chosen' ? state.chosen?.pane : comparison.panes[action.paneId];
    if (!current) unavailable('No chosen workspace exists; selection is an explicit separate action.');
    if (action.paneId !== 'chosen' && (comparison.phase !== 'active' || comparison.taskPhase !== 'playing')) unavailable('Comparison panes are read-only after a decision or Finish.');
    if (action.expectedPaneRevision !== current.revision) throw new DomainError('STALE_REVISION', 'The pane changed; inspect before reapplying.', 409, { paneId: action.paneId, expected: action.expectedPaneRevision, actual: current.revision });
    let nextPane: PaneState;
    if (action.type === 'pane.undo') {
      const previous = current.undo.at(-1);
      if (!previous) unavailable('This pane has no queue changes to undo.');
      nextPane = { revision: current.revision + 1, queues: cloneQueues(previous), undo: current.undo.slice(0, -1) };
    } else if (action.type === 'pane.reset') {
      const baseline = action.paneId === 'chosen' ? state.chosen!.baseline : TASKS[comparison.taskId].seed;
      nextPane = updatePane(current, cloneQueues(baseline));
    } else {
      nextPane = updatePane(current, moveQueues(current.queues, action));
    }
    if (nextPane === current) return state;
    const next = structuredClone(state);
    if (action.paneId === 'chosen') next.chosen!.pane = nextPane;
    else next.comparison.panes[action.paneId] = nextPane;
    return next;
  }
  if (action.type === 'selection.commit') {
    if (state.ref.mode === 'rehearsal') unavailable('Rehearsal is not preference evidence and has no selection.');
    if (!comparison.finish || comparison.phase !== 'finished') unavailable('Finish the comparison before selecting a widget.');
    if (state.selection) unavailable('This comparison already has an explicit selection.');
    if (context.provenance === 'agent') throw new DomainError('FORBIDDEN_ACTOR', 'Agents cannot select a widget.', 403);
    const next = structuredClone(state);
    const baseline = cloneQueues(comparison.finish.snapshot.panes[action.variantId]);
    next.selection = { at, variantId: action.variantId, reason: action.reason, provenance: context.provenance, finishDigest: comparison.finish.digest };
    next.chosen = { variantId: action.variantId, baseline, pane: pane(baseline) };
    return next;
  }
  if (comparison.phase !== 'active') unavailable('The finished comparison is sealed.');
  if (action.type === 'scenario.load') {
    if (state.ref.mode !== 'rehearsal') unavailable('Prepared task loading is rehearsal-only.');
    const next = structuredClone(state);
    next.comparison.taskId = action.taskId;
    for (const id of ['A', 'B'] as const) next.comparison.panes[id] = { revision: comparison.panes[id].revision + 1, queues: cloneQueues(TASKS[action.taskId].seed), undo: [] };
    return next;
  }
  if (action.type === 'comparison.finish') {
    if (state.ref.mode === 'rehearsal') unavailable('Rehearsal is not a comparison recording and cannot be finished.');
    const next = structuredClone(state);
    const snapshot = structuredClone({ taskId: comparison.taskId, panes: { A: comparison.panes.A.queues, B: comparison.panes.B.queues }, decisions: comparison.decisions, drafts: comparison.drafts });
    next.comparison.phase = 'finished';
    next.comparison.finish = { at, digest: digest(snapshot), snapshot, unvotedTasks: TASK_IDS.filter(id => !comparison.decisions.some(decision => decision.taskId === id)) };
    return next;
  }
  if (action.taskId !== comparison.taskId) throw new DomainError('STALE_TARGET', 'The action refers to a different task than the current one.', 409, { actualTaskId: comparison.taskId });
  if (action.type === 'scenario.advance') {
    if (state.ref.mode === 'rehearsal') unavailable('Use scenario.load in rehearsal.');
    if (comparison.taskPhase !== 'decided') unavailable('Record a choice, Both bad, or Skip before advancing.');
    const taskId = TASK_IDS[TASK_IDS.indexOf(comparison.taskId) + 1];
    if (!taskId) unavailable('This is the last task; Finish is a separate action.');
    const next = structuredClone(state);
    next.comparison.taskId = taskId;
    next.comparison.taskPhase = 'playing';
    for (const id of ['A', 'B'] as const) next.comparison.panes[id] = { revision: comparison.panes[id].revision + 1, queues: cloneQueues(TASKS[taskId].seed), undo: [] };
    return next;
  }
  if (comparison.taskPhase !== 'playing') unavailable('This task already has a saved decision; advance or finish.');
  if (action.type === 'note.save') {
    if (comparison.drafts[action.taskId] === action.text) return state;
    const next = structuredClone(state);
    next.comparison.drafts[action.taskId] = action.text;
    return next;
  }
  if (state.ref.mode === 'rehearsal') unavailable('Rehearsal cannot record preference ballots.');
  if (context.provenance === 'agent') throw new DomainError('FORBIDDEN_ACTOR', 'Agents cannot record preferences.', 403);
  for (const id of ['A', 'B'] as const) {
    if (action.observedPaneRevisions[id] !== comparison.panes[id].revision) throw new DomainError('STALE_REVISION', 'A pane changed since this decision was prepared.', 409, { paneId: id, expected: action.observedPaneRevisions[id], actual: comparison.panes[id].revision });
  }
  const next = structuredClone(state);
  next.comparison.drafts[action.taskId] = action.note;
  next.comparison.decisions.push({
    id: crypto.randomUUID(), at, taskId: action.taskId, choice: action.choice, note: action.note, provenance: context.provenance,
    observedPaneRevisions: { ...action.observedPaneRevisions }, snapshots: { A: cloneQueues(comparison.panes.A.queues), B: cloneQueues(comparison.panes.B.queues) },
    goalMatches: { A: goalMatches(comparison.panes.A.queues, action.taskId), B: goalMatches(comparison.panes.B.queues, action.taskId) },
    presentation: { ...action.presentation },
  });
  next.comparison.taskPhase = 'decided';
  return next;
}
