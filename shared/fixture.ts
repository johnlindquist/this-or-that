import type { Owner, Queues, TaskId, Ticket } from './contract';
export const OWNERS: Owner[] = [
  { id: 'backlog', name: 'Unassigned', initials: '—' },
  { id: 'maya', name: 'Maya Chen', initials: 'MC' },
  { id: 'leo', name: 'Leo Ortiz', initials: 'LO' },
  { id: 'priya', name: 'Priya Shah', initials: 'PS' },
];
export const TICKETS: Ticket[] = [
  { id: 'SPR-101', title: 'Fix stale session after sign-out', kind: 'Bug', points: 3 },
  { id: 'SPR-102', title: 'Add request retry and backoff', kind: 'Reliability', points: 5 },
  { id: 'SPR-103', title: 'Keep sprint filters in the URL', kind: 'Feature', points: 2 },
  { id: 'SPR-104', title: 'Test the teammate invite flow', kind: 'Test', points: 3 },
  { id: 'SPR-105', title: 'Announce task moves to screen readers', kind: 'Accessibility', points: 2 },
  { id: 'SPR-106', title: 'Deduplicate webhook deliveries', kind: 'Bug', points: 5 },
  { id: 'SPR-107', title: 'Fix the search empty-state action', kind: 'Bug', points: 1 },
  { id: 'SPR-108', title: 'Write the release checklist', kind: 'Documentation', points: 1 },
];
export const S0: Queues = { backlog: ['SPR-103','SPR-105','SPR-108'], maya: ['SPR-101','SPR-104'], leo: ['SPR-102','SPR-107'], priya: ['SPR-106'] };
export const S1: Queues = { backlog: ['SPR-105','SPR-108'], maya: ['SPR-101','SPR-104'], leo: ['SPR-102','SPR-103','SPR-107'], priya: ['SPR-106'] };
export const S2: Queues = { backlog: ['SPR-105','SPR-108'], maya: ['SPR-104','SPR-101'], leo: ['SPR-102','SPR-103','SPR-107'], priya: ['SPR-106'] };
export const S3: Queues = { backlog: ['SPR-102','SPR-105','SPR-108'], maya: ['SPR-104','SPR-101'], leo: ['SPR-103'], priya: ['SPR-107','SPR-106'] };
export const TASKS: Record<TaskId, { title: string; instruction: string; prompt: string; seed: Queues; goal: Queues }> = {
  assign: { title: 'Assign a ticket', instruction: 'Assign SPR-103 to Leo as his second priority, before SPR-107. Try it in both panes.', prompt: 'Could you predict the destination and priority before dropping?', seed: S0, goal: S1 },
  prioritize: { title: 'Change the priority', instruction: 'Move SPR-104 to the top of Maya’s queue. Try it in both panes.', prompt: 'Could you confirm the new order without hunting?', seed: S1, goal: S2 },
  handoff: { title: 'Hand off the work', instruction: 'Move SPR-107 from Leo to Priya as her first priority. Then return SPR-102 to the top of Unassigned. Try it in both panes.', prompt: 'Could you tell what moved and what remained?', seed: S2, goal: S3 },
};
export function cloneQueues(queues: Queues): Queues { return structuredClone(queues); }
export function ticketById(id: string): Ticket { const ticket = TICKETS.find(t => t.id === id); if (!ticket) throw new Error(`Unknown ticket: ${id}`); return ticket; }
export function goalMatches(queues: Queues, taskId: TaskId): boolean { return OWNERS.every(o => JSON.stringify(queues[o.id]) === JSON.stringify(TASKS[taskId].goal[o.id])); }
