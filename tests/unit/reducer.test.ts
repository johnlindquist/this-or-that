import { describe, expect, test } from 'bun:test';
import { OWNER_IDS, TICKET_IDS, type PaneMove, type Queues } from '../../shared/contract';
import { S0, S1, S2, S3, TICKETS } from '../../shared/fixture';
import { applyAction, assertQueues, makeSession, moveQueues } from '../../shared/reducer';

const now = '2026-08-28T00:00:00.000Z';
const context = { now, provenance: 'test-fixture' as const };
const move = (ticketId: PaneMove['ticketId'], fromOwnerId: PaneMove['fromOwnerId'], toOwnerId: PaneMove['toOwnerId'], beforeTicketId: PaneMove['beforeTicketId']): PaneMove => ({ type: 'pane.move', paneId: 'A', expectedPaneRevision: 0, ticketId, fromOwnerId, toOwnerId, beforeTicketId });

describe('ordered sprint assignment', () => {
  test('the fixture has eight unique tickets and 22 informational points', () => {
    expect(TICKETS.map(t => t.id)).toEqual([...TICKET_IDS]);
    expect(TICKETS.reduce((sum, t) => sum + t.points, 0)).toBe(22);
    expect(() => assertQueues(S0)).not.toThrow();
  });

  test('every legal move preserves exactly one copy and the requested insertion', () => {
    for (const from of OWNER_IDS) for (const ticket of S0[from]) for (const to of OWNER_IDS) {
      const anchors = [...S0[to].filter(id => id !== ticket), null];
      for (const anchor of anchors) {
        const changed = moveQueues(S0, move(ticket, from, to, anchor));
        expect(OWNER_IDS.flatMap(owner => changed[owner]).sort()).toEqual([...TICKET_IDS].sort());
        if (anchor === null) expect(changed[to].at(-1)).toBe(ticket);
        else expect(changed[to].indexOf(ticket) + 1).toBe(changed[to].indexOf(anchor));
        expect(S0.maya).toEqual(['SPR-101', 'SPR-104']);
      }
    }
  });

  test('invalid anchors and source owners cannot silently remove a ticket', () => {
    expect(() => moveQueues(S0, move('SPR-101', 'maya', 'maya', 'SPR-101'))).toThrow();
    expect(() => moveQueues(S0, move('SPR-101', 'maya', 'leo', 'SPR-104'))).toThrow();
    expect(() => moveQueues(S0, move('SPR-101', 'priya', 'leo', null))).toThrow();
    expect(S0.maya).toEqual(['SPR-101', 'SPR-104']);
  });

  test('duplicate and unknown tickets fail invariants', () => {
    const bad = structuredClone(S0);
    bad.leo.push('SPR-101');
    expect(() => assertQueues(bad)).toThrow();
    const unknown = structuredClone(S0) as unknown as Record<string, string[]>;
    unknown.backlog[0] = 'UNKNOWN';
    expect(() => assertQueues(unknown as Queues)).toThrow();
  });

  test('the three published tasks reach their exact checkpoints', () => {
    expect(moveQueues(S0, move('SPR-103', 'backlog', 'leo', 'SPR-107'))).toEqual(S1);
    expect(moveQueues(S1, move('SPR-104', 'maya', 'maya', 'SPR-101'))).toEqual(S2);
    const handoff = moveQueues(S2, move('SPR-107', 'leo', 'priya', 'SPR-106'));
    expect(moveQueues(handoff, move('SPR-102', 'leo', 'backlog', 'SPR-105'))).toEqual(S3);
  });

  test('pane reset is independent and undoable', () => {
    const initial = makeSession({ mode: 'test', id: crypto.randomUUID() }, 'test-build', now);
    expect(initial.comparison.panes.A.queues).not.toBe(initial.comparison.panes.B.queues);
    const changed = applyAction(initial, move('SPR-103', 'backlog', 'leo', 'SPR-107'), context);
    expect(changed.comparison.panes.B).toEqual(initial.comparison.panes.B);
    const reset = applyAction(changed, { type: 'pane.reset', paneId: 'A', expectedPaneRevision: changed.comparison.panes.A.revision }, context);
    expect(reset.comparison.panes.A.queues).toEqual(S0);
    expect(reset.comparison.panes.B).toEqual(initial.comparison.panes.B);
    const undone = applyAction(reset, { type: 'pane.undo', paneId: 'A', expectedPaneRevision: reset.comparison.panes.A.revision }, context);
    expect(undone.comparison.panes.A.queues).toEqual(S1);
  });

  test('an unchanged move does not grow undo history', () => {
    const initial = makeSession({ mode: 'test', id: crypto.randomUUID() }, 'test-build', now);
    const changed = applyAction(initial, move('SPR-104', 'maya', 'maya', null), context);
    expect(changed.comparison.panes.A.undo).toHaveLength(0);
  });

  test('a stale pane revision cannot overwrite newer work', () => {
    const initial = makeSession({ mode: 'test', id: crypto.randomUUID() }, 'test-build', now);
    const changed = applyAction(initial, move('SPR-103', 'backlog', 'leo', 'SPR-107'), context);
    expect(() => applyAction(changed, move('SPR-104', 'maya', 'maya', 'SPR-101'), context)).toThrow();
  });
});
