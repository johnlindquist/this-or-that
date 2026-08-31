export const PROTOCOL = 'this-or-that/v1' as const;
export const DATASET_ID = 'sprint-demo-v1' as const;
export const CANDIDATE_VERSIONS = { A: 'developer-columns-v1', B: 'expandable-queues-v1' } as const;
export const OWNER_IDS = ['backlog', 'maya', 'leo', 'priya'] as const;
export const TICKET_IDS = ['SPR-101','SPR-102','SPR-103','SPR-104','SPR-105','SPR-106','SPR-107','SPR-108'] as const;
export const TASK_IDS = ['assign', 'prioritize', 'handoff'] as const;
export type OwnerId = typeof OWNER_IDS[number];
export type TicketId = typeof TICKET_IDS[number];
export type TaskId = typeof TASK_IDS[number];
export type VariantId = 'A' | 'B';
export type PaneId = VariantId | 'chosen';
export type SessionMode = 'rehearsal' | 'recording' | 'test';
export type ClientClass = 'ui' | 'agent';
export type Choice = 'A' | 'B' | 'both-bad' | 'skip';
export type Queues = Record<OwnerId, TicketId[]>;
export interface SessionRef { mode: SessionMode; id: string }
export interface Ticket { id: TicketId; title: string; kind: string; points: number }
export interface Owner { id: OwnerId; name: string; initials: string }
export interface PaneState { revision: number; queues: Queues; undo: Queues[] }
export interface Presentation { mode: 'side-by-side' | 'sequential'; width: number; height: number }
export interface DecisionRecord {
  id: string; at: string; taskId: TaskId; choice: Choice; note: string;
  provenance: 'human-ui' | 'test-fixture';
  observedPaneRevisions: Record<VariantId, number>;
  snapshots: Record<VariantId, Queues>;
  goalMatches: Record<VariantId, boolean>;
  presentation: Presentation;
}
export interface FinishRecord {
  at: string; digest: string;
  snapshot: { taskId: TaskId; panes: Record<VariantId, Queues>; decisions: DecisionRecord[]; drafts: Record<TaskId, string> };
  unvotedTasks: TaskId[];
}
export interface SelectionRecord { at: string; variantId: VariantId; reason: string; provenance: 'human-ui' | 'test-fixture'; finishDigest: string }
export interface CommandReceipt { requestId: string; payloadDigest: string; appliedRevision: number; at: string; actionType: Action['type'] }
export interface SessionDocument {
  schemaVersion: 1; ref: SessionRef; revision: number;
  datasetId: typeof DATASET_ID; datasetDigest: string; buildId: string;
  candidateVersions: typeof CANDIDATE_VERSIONS; createdAt: string; updatedAt: string;
  comparison: {
    phase: 'active' | 'finished'; taskId: TaskId; taskPhase: 'playing' | 'decided';
    panes: Record<VariantId, PaneState>; drafts: Record<TaskId, string>;
    decisions: DecisionRecord[]; finish: FinishRecord | null;
  };
  selection: SelectionRecord | null;
  chosen: null | { variantId: VariantId; baseline: Queues; pane: PaneState };
  receipts: CommandReceipt[];
}
export interface PaneMove {
  type: 'pane.move'; paneId: PaneId; expectedPaneRevision: number;
  ticketId: TicketId; fromOwnerId: OwnerId; toOwnerId: OwnerId; beforeTicketId: TicketId | null;
}
export type Action = PaneMove
  | { type: 'pane.reset'; paneId: PaneId; expectedPaneRevision: number }
  | { type: 'pane.undo'; paneId: PaneId; expectedPaneRevision: number }
  | { type: 'note.save'; taskId: TaskId; text: string }
  | { type: 'decision.record'; taskId: TaskId; choice: Choice; note: string; observedPaneRevisions: Record<VariantId, number>; presentation: Presentation }
  | { type: 'scenario.advance'; taskId: TaskId }
  | { type: 'scenario.load'; taskId: TaskId }
  | { type: 'comparison.finish' }
  | { type: 'selection.commit'; variantId: VariantId; reason: string };
export interface ActionEnvelope { requestId: string; expectedRevision: number; action: Action }
export interface CreateRequest { requestId: string; mode: SessionMode }
export interface Availability { enabled: boolean; reason: string | null }
export interface Inspection {
  ok: true; state: SessionDocument;
  availableActions: Record<Action['type'], Availability>;
  targets: { id: string; paneId: PaneId; ownerId?: OwnerId; ticketId?: TicketId; beforeTicketId?: TicketId | null }[];
}
export interface ActionResponse extends Inspection { requestId: string; appliedRevision: number; revision: number; replayed: boolean }
export interface ApiError { ok: false; error: { code: string; message: string; details?: unknown } }
export const LIMITS = { bodyBytes: 32768, noteCharacters: 2000, undoDepth: 30, receipts: 2000, documentBytes: 2 * 1024 * 1024, waitMs: 10000 } as const;
export class DomainError extends Error {
  constructor(public code: string, message: string, public status = 400, public details?: unknown) { super(message); this.name = 'DomainError'; }
}
