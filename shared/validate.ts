import {
  CANDIDATE_VERSIONS, DATASET_ID, DomainError, LIMITS, OWNER_IDS, TASK_IDS, TICKET_IDS,
  type Action, type ActionEnvelope, type CreateRequest, type Queues, type SessionDocument, type SessionRef,
} from './contract';
import { canonicalJson, DATASET_DIGEST, digest } from './canonical';
import { goalMatches } from './fixture';

export const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
export const ACTION_TYPES = [
  'pane.move', 'pane.reset', 'pane.undo', 'note.save', 'decision.record',
  'scenario.advance', 'scenario.load', 'comparison.finish', 'selection.commit',
] as const satisfies readonly Action['type'][];

export interface Schema {
  type?: 'object' | 'array' | 'string' | 'integer' | 'boolean' | 'null';
  const?: unknown; enum?: readonly unknown[]; oneOf?: readonly Schema[];
  properties?: Record<string, Schema>; required?: readonly string[]; additionalProperties?: false;
  items?: Schema; minItems?: number; maxItems?: number; uniqueItems?: boolean;
  minLength?: number; maxLength?: number; pattern?: string; format?: 'uuid' | 'date-time';
  minimum?: number; maximum?: number;
}
const object = (properties: Record<string, Schema>): Schema => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const enumeration = (values: readonly unknown[]): Schema => ({ enum: values });
const array = (items: Schema, maxItems: number): Schema => ({ type: 'array', items, maxItems });
const nullable = (schema: Schema): Schema => ({ oneOf: [schema, { type: 'null' }] });
const revision: Schema = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const uuid: Schema = { type: 'string', format: 'uuid', pattern: UUID_PATTERN };
const timestamp: Schema = { type: 'string', format: 'date-time', maxLength: 24 };
const hash: Schema = { type: 'string', pattern: '^[0-9a-f]{64}$' };
const note: Schema = { type: 'string', maxLength: LIMITS.noteCharacters };
const task = enumeration(TASK_IDS);
const variant = enumeration(['A', 'B']);
const pane = enumeration(['A', 'B', 'chosen']);
const owner = enumeration(OWNER_IDS);
const ticket = enumeration(TICKET_IDS);
export const SESSION_REF_SCHEMA = object({ mode: enumeration(['rehearsal', 'recording', 'test']), id: uuid });
const paneFields = { paneId: pane, expectedPaneRevision: revision };
const presentation = object({ mode: enumeration(['side-by-side', 'sequential']), width: { type: 'integer', minimum: 1, maximum: 10000 }, height: { type: 'integer', minimum: 1, maximum: 10000 } });
const observedRevisions = object({ A: revision, B: revision });
export const ACTION_SCHEMAS: Record<Action['type'], Schema> = {
  'pane.move': object({ type: { const: 'pane.move' }, ...paneFields, ticketId: ticket, fromOwnerId: owner, toOwnerId: owner, beforeTicketId: nullable(ticket) }),
  'pane.reset': object({ type: { const: 'pane.reset' }, ...paneFields }),
  'pane.undo': object({ type: { const: 'pane.undo' }, ...paneFields }),
  'note.save': object({ type: { const: 'note.save' }, taskId: task, text: note }),
  'decision.record': object({ type: { const: 'decision.record' }, taskId: task, choice: enumeration(['A', 'B', 'both-bad', 'skip']), note, observedPaneRevisions: observedRevisions, presentation }),
  'scenario.advance': object({ type: { const: 'scenario.advance' }, taskId: task }),
  'scenario.load': object({ type: { const: 'scenario.load' }, taskId: task }),
  'comparison.finish': object({ type: { const: 'comparison.finish' } }),
  'selection.commit': object({ type: { const: 'selection.commit' }, variantId: variant, reason: note }),
};
export const ACTION_SCHEMA: Schema = { oneOf: ACTION_TYPES.map(type => ACTION_SCHEMAS[type]) };
export const ACTION_ENVELOPE_SCHEMA = object({ requestId: uuid, expectedRevision: revision, action: ACTION_SCHEMA });
export const CREATE_REQUEST_SCHEMA = object({ requestId: uuid, mode: enumeration(['rehearsal', 'recording', 'test']) });
const queuesSchema = object(Object.fromEntries(OWNER_IDS.map(id => [id, { ...array(ticket, TICKET_IDS.length), uniqueItems: true }])));
const paneStateSchema = object({ revision, queues: queuesSchema, undo: array(queuesSchema, LIMITS.undoDepth) });
const snapshotsSchema = object({ A: queuesSchema, B: queuesSchema });
const draftsSchema = object({ assign: note, prioritize: note, handoff: note });
const decisionSchema = object({
  id: uuid, at: timestamp, taskId: task, choice: enumeration(['A', 'B', 'both-bad', 'skip']), note,
  provenance: enumeration(['human-ui', 'test-fixture']), observedPaneRevisions: observedRevisions,
  snapshots: snapshotsSchema, goalMatches: object({ A: { type: 'boolean' }, B: { type: 'boolean' } }), presentation,
});
const finishSnapshotSchema = object({ taskId: task, panes: snapshotsSchema, decisions: array(decisionSchema, TASK_IDS.length), drafts: draftsSchema });
export const SESSION_SCHEMA = object({
  schemaVersion: { const: 1 }, ref: SESSION_REF_SCHEMA, revision,
  datasetId: { type: 'string', minLength: 1, maxLength: 200 }, datasetDigest: hash,
  buildId: { type: 'string', minLength: 1, maxLength: 200 },
  candidateVersions: object({ A: { type: 'string', minLength: 1, maxLength: 200 }, B: { type: 'string', minLength: 1, maxLength: 200 } }),
  createdAt: timestamp, updatedAt: timestamp,
  comparison: object({
    phase: enumeration(['active', 'finished']), taskId: task, taskPhase: enumeration(['playing', 'decided']),
    panes: object({ A: paneStateSchema, B: paneStateSchema }), drafts: draftsSchema,
    decisions: array(decisionSchema, TASK_IDS.length),
    finish: nullable(object({ at: timestamp, digest: hash, snapshot: finishSnapshotSchema, unvotedTasks: { ...array(task, TASK_IDS.length), uniqueItems: true } })),
  }),
  selection: nullable(object({ at: timestamp, variantId: variant, reason: note, provenance: enumeration(['human-ui', 'test-fixture']), finishDigest: hash })),
  chosen: nullable(object({ variantId: variant, baseline: queuesSchema, pane: paneStateSchema })),
  receipts: array(object({ requestId: uuid, payloadDigest: hash, appliedRevision: revision, at: timestamp, actionType: enumeration(ACTION_TYPES) }), LIMITS.receipts),
});

function invalid(path: string, message: string): never {
  throw new DomainError('VALIDATION_ERROR', `${path}: ${message}`);
}
export function validateSchema(value: unknown, schema: Schema, path = 'payload', depth = 0): void {
  if (depth > 32) invalid(path, 'nesting is too deep.');
  if (schema.oneOf) {
    let matches = 0;
    for (const candidate of schema.oneOf) {
      try { validateSchema(value, candidate, path, depth + 1); matches++; }
      catch (error) { if (!(error instanceof DomainError)) throw error; }
    }
    if (matches !== 1) invalid(path, 'does not match a supported shape.');
    return;
  }
  if ('const' in schema && value !== schema.const) invalid(path, `expected ${JSON.stringify(schema.const)}.`);
  if (schema.enum && !schema.enum.includes(value)) invalid(path, `expected one of ${schema.enum.join(', ')}.`);
  if (schema.type === 'null' && value !== null) invalid(path, 'expected null.');
  if (schema.type === 'boolean' && typeof value !== 'boolean') invalid(path, 'expected a boolean.');
  if (schema.type === 'integer') {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) invalid(path, 'expected a safe integer.');
    if (schema.minimum !== undefined && value < schema.minimum) invalid(path, `minimum is ${schema.minimum}.`);
    if (schema.maximum !== undefined && value > schema.maximum) invalid(path, `maximum is ${schema.maximum}.`);
  }
  if (schema.type === 'string') {
    if (typeof value !== 'string') invalid(path, 'expected a string.');
    let length = 0;
    for (const _character of value) length++;
    if (schema.minLength !== undefined && length < schema.minLength) invalid(path, `minimum length is ${schema.minLength}.`);
    if (schema.maxLength !== undefined && length > schema.maxLength) invalid(path, `maximum length is ${schema.maxLength} Unicode characters.`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) invalid(path, 'invalid format.');
    if (schema.format === 'date-time') {
      const date = new Date(value);
      if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) invalid(path, 'expected a canonical ISO timestamp.');
    }
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) invalid(path, 'expected an array.');
    if (schema.minItems !== undefined && value.length < schema.minItems) invalid(path, 'too few items.');
    if (schema.maxItems !== undefined && value.length > schema.maxItems) invalid(path, 'too many items.');
    if (schema.items) for (let index = 0; index < value.length; index++) validateSchema(value[index], schema.items, `${path}[${index}]`, depth + 1);
    if (schema.uniqueItems && new Set(value).size !== value.length) invalid(path, 'duplicate items.');
  }
  if (schema.type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid(path, 'expected an object.');
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) invalid(path, 'expected a plain object.');
    const record = value as Record<string, unknown>;
    const properties = schema.properties ?? {};
    for (const key of schema.required ?? []) if (!Object.hasOwn(record, key)) invalid(path, `missing ${key}.`);
    for (const key of Object.keys(record)) {
      if (!Object.hasOwn(properties, key)) invalid(path, `unknown field ${key}.`);
      validateSchema(record[key], properties[key]!, `${path}.${key}`, depth + 1);
    }
  }
}

export function parseSessionRef(value: unknown): SessionRef {
  validateSchema(value, SESSION_REF_SCHEMA, 'session');
  return value as SessionRef;
}
export function parseCreateRequest(value: unknown): CreateRequest {
  validateSchema(value, CREATE_REQUEST_SCHEMA);
  return value as CreateRequest;
}
export function parseAction(value: unknown): Action {
  if (value === null || typeof value !== 'object' || !('type' in value) || typeof value.type !== 'string' || !Object.hasOwn(ACTION_SCHEMAS, value.type)) {
    invalid('action.type', 'unknown action.');
  }
  validateSchema(value, ACTION_SCHEMAS[value.type as Action['type']], 'action');
  return value as Action;
}
export function parseActionEnvelope(value: unknown): ActionEnvelope {
  validateSchema(value, ACTION_ENVELOPE_SCHEMA, 'envelope');
  const envelope = value as ActionEnvelope;
  parseAction(envelope.action);
  return envelope;
}
export function assertQueues(value: unknown): asserts value is Queues {
  validateSchema(value, queuesSchema, 'queues');
  const queues = value as Queues;
  const tickets = OWNER_IDS.flatMap(id => queues[id]);
  if (tickets.length !== TICKET_IDS.length || new Set(tickets).size !== TICKET_IDS.length) {
    invalid('queues', 'every fixture ticket must occur exactly once across the four owners.');
  }
}

/** Validate stored documents before trusting them. No migration or repair is implicit. */
export function parseSessionDocument(value: unknown): SessionDocument {
  if (value && typeof value === 'object' && 'schemaVersion' in value && value.schemaVersion !== 1) {
    throw new DomainError('VERSION_MISMATCH', 'Unsupported session schema version.', 409);
  }
  try {
    validateSchema(value, SESSION_SCHEMA, 'session');
    const state = value as SessionDocument;
    const { comparison, selection, chosen } = state;
    const invariant = (condition: boolean, message: string): void => { if (!condition) invalid('session', message); };
    invariant(state.createdAt <= state.updatedAt, 'updatedAt precedes createdAt.');
    for (const item of [comparison.panes.A, comparison.panes.B, ...(chosen ? [chosen.pane] : [])]) {
      assertQueues(item.queues);
      item.undo.forEach(assertQueues);
      invariant(item.undo.length <= item.revision, 'undo history exceeds pane revision.');
    }
    const seenDecisions = new Set<string>();
    for (const [index, decision] of comparison.decisions.entries()) {
      invariant(decision.taskId === TASK_IDS[index], 'decisions must be a unique ordered task prefix.');
      invariant(!seenDecisions.has(decision.id), 'duplicate decision ID.');
      seenDecisions.add(decision.id);
      invariant(decision.provenance === (state.ref.mode === 'test' ? 'test-fixture' : 'human-ui'), 'decision provenance does not match session mode.');
      for (const id of ['A', 'B'] as const) {
        assertQueues(decision.snapshots[id]);
        if (state.datasetDigest === DATASET_DIGEST) invariant(decision.goalMatches[id] === goalMatches(decision.snapshots[id], decision.taskId), 'goal-match evidence is inconsistent.');
      }
    }
    if (state.ref.mode === 'rehearsal') {
      invariant(comparison.decisions.length === 0 && comparison.phase === 'active' && comparison.taskPhase === 'playing' && !selection && !chosen, 'rehearsal cannot contain preference evidence or a finished comparison.');
    } else {
      const expectedTaskIndex = comparison.decisions.length - (comparison.taskPhase === 'decided' ? 1 : 0);
      invariant(TASK_IDS[expectedTaskIndex] === comparison.taskId, 'task phase does not match recorded decisions.');
    }
    invariant((comparison.phase === 'finished') === (comparison.finish !== null), 'finish record and phase disagree.');
    if (comparison.finish) {
      const snapshot = { taskId: comparison.taskId, panes: { A: comparison.panes.A.queues, B: comparison.panes.B.queues }, decisions: comparison.decisions, drafts: comparison.drafts };
      invariant(canonicalJson(snapshot) === canonicalJson(comparison.finish.snapshot), 'finished comparison was changed.');
      invariant(digest(snapshot) === comparison.finish.digest, 'finish digest does not match the sealed snapshot.');
      invariant(canonicalJson(comparison.finish.unvotedTasks) === canonicalJson(TASK_IDS.filter(id => !comparison.decisions.some(decision => decision.taskId === id))), 'unvoted tasks are inconsistent.');
    }
    invariant(Boolean(selection) === Boolean(chosen), 'selection and chosen workspace must exist together.');
    if (selection && chosen) {
      invariant(comparison.finish !== null, 'selection requires a finished comparison.');
      invariant(selection.variantId === chosen.variantId, 'chosen candidate differs from selection.');
      invariant(selection.finishDigest === comparison.finish?.digest, 'selection references another finish.');
      invariant(selection.provenance === (state.ref.mode === 'test' ? 'test-fixture' : 'human-ui'), 'selection provenance does not match session mode.');
      assertQueues(chosen.baseline);
      invariant(canonicalJson(chosen.baseline) === canonicalJson(comparison.finish?.snapshot.panes[chosen.variantId]), 'chosen baseline differs from the selected snapshot.');
    }
    invariant(state.receipts.length === state.revision, 'receipt sequence differs from the session revision.');
    const seenReceipts = new Set<string>();
    for (const [index, receipt] of state.receipts.entries()) {
      invariant(receipt.appliedRevision === index + 1 && !seenReceipts.has(receipt.requestId), 'invalid or duplicate receipt sequence.');
      seenReceipts.add(receipt.requestId);
    }
    return state;
  } catch (error) {
    if (error instanceof DomainError) throw new DomainError('CORRUPT_SESSION', 'Stored session failed integrity validation; it has not been modified.', 409, { cause: error.message });
    throw error;
  }
}

export function compatibilityIssues(state: SessionDocument, buildId: string): string[] {
  const issues: string[] = [];
  if (state.datasetId !== DATASET_ID || state.datasetDigest !== DATASET_DIGEST) issues.push('Dataset differs from this build.');
  if (state.candidateVersions.A !== CANDIDATE_VERSIONS.A || state.candidateVersions.B !== CANDIDATE_VERSIONS.B) issues.push('Candidate versions differ from this build.');
  if (state.buildId !== buildId) issues.push('Implementation build differs from this session.');
  return issues;
}
