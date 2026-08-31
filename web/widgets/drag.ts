import type { OwnerId, TicketId } from '../../shared/contract';
import { OWNERS, ticketById } from '../../shared/fixture';
import { element, focusId } from '../dom';
import type { Reveal, WidgetPort } from './types';

type Target = { owner: OwnerId; before: TicketId | null; node: HTMLElement; label: string; collapsed: boolean };
type Drag = { pointerId: number; ticket: TicketId; source: OwnerId; revision: number; startX: number; startY: number; x: number; y: number; active: boolean };
const THRESHOLD = 6;
const HOVER_DELAY = 350;
const SCROLL_EDGE = 48;
const SCROLL_SPEED = 10;

export function bindDragSurface(host: HTMLElement, port: WidgetPort, reveal: Reveal): () => void {
  let drag: Drag | null = null;
  let ghost: HTMLElement | null = null;
  let marker: HTMLElement | null = null;
  let target: Target | null = null;
  let hoverOwner: OwnerId | null = null;
  let hoverTimer: number | undefined;
  let frame = 0;
  let crossPane = false;

  function clearHover(): void { clearTimeout(hoverTimer); hoverOwner = null; }
  function clearMarker(): void { marker?.remove(); marker = null; host.querySelectorAll('.drop-active').forEach(node => node.classList.remove('drop-active')); }
  function cleanup(message?: string): void {
    const previous = drag; drag = null;
    cancelAnimationFrame(frame); clearHover(); clearMarker(); ghost?.remove(); ghost = null; target = null;
    host.classList.remove('is-dragging');
    host.querySelectorAll('.drag-source').forEach(node => node.classList.remove('drag-source'));
    if (previous && host.hasPointerCapture(previous.pointerId)) host.releasePointerCapture(previous.pointerId);
    if (message) port.announce(message);
    if (previous) port.interaction(false);
  }
  function resolve(x: number, y: number): Target | null {
    const hit = document.elementFromPoint(x, y) as HTMLElement | null;
    const pane = hit?.closest<HTMLElement>('[data-pane]');
    crossPane = Boolean(pane && pane.dataset.pane !== port.paneId);
    if (!hit || !host.contains(hit) || crossPane || !drag) return null;
    const zone = hit.closest<HTMLElement>('[data-drop-zone]');
    if (!zone || zone.dataset.pane !== port.paneId) return null;
    const owner = zone.dataset.owner as OwnerId;
    const name = OWNERS.find(item => item.id === owner)?.name;
    if (!name) return null;
    const collapsed = zone.dataset.collapsed === 'true';
    if (collapsed) return { owner, before: null, node: zone, label: `Append to ${name} · hold to expand`, collapsed: true };
    const cards = [...zone.querySelectorAll<HTMLElement>('.ticket[data-ticket]')].filter(card => card.dataset.ticket !== drag!.ticket);
    const horizontal = getComputedStyle(zone).getPropertyValue('--queue-direction').trim() === 'horizontal';
    let beforeCard: HTMLElement | undefined;
    if (horizontal) {
      const rows: { top: number; bottom: number; cards: { node: HTMLElement; middle: number }[] }[] = [];
      for (const card of cards) {
        const box = card.getBoundingClientRect();
        let row = rows.at(-1);
        if (!row || Math.abs(row.top - box.top) > 1) { row = { top: box.top, bottom: box.bottom, cards: [] }; rows.push(row); }
        row.bottom = Math.max(row.bottom, box.bottom);
        row.cards.push({ node: card, middle: box.left + box.width / 2 });
      }
      const rowIndex = rows.findIndex((row, index) => y <= (rows[index + 1] ? (row.bottom + rows[index + 1]!.top) / 2 : row.bottom));
      if (rowIndex >= 0) beforeCard = rows[rowIndex]!.cards.find(card => x < card.middle)?.node ?? rows[rowIndex + 1]?.cards[0]?.node;
    } else beforeCard = cards.find(card => { const box = card.getBoundingClientRect(); return y < box.top + box.height / 2; });
    const before = (beforeCard?.dataset.ticket as TicketId | undefined) ?? null;
    const ids = port.getState().queues[owner].filter(id => id !== drag!.ticket);
    const priority = before ? ids.indexOf(before) + 1 : ids.length + 1;
    return { owner, before, node: beforeCard ?? zone, label: `Insert at priority ${priority} · ${name}`, collapsed: false };
  }
  function feedback(next: Target | null): void {
    if (next?.owner === target?.owner && next?.before === target?.before && next?.collapsed === target?.collapsed && next?.node === target?.node) return;
    clearMarker(); target = next;
    if (!next) { clearHover(); port.announce(crossPane ? 'Different trial — tickets cannot move between A and B.' : 'No drop target here. Move into a ticket list to choose a priority, or release to cancel.'); return; }
    next.node.classList.add('drop-active');
    marker = element('div', 'drop-indicator', next.label);
    marker.dataset.testid = 'drop-indicator'; marker.setAttribute('aria-hidden', 'true');
    marker.dataset.pane = port.paneId; marker.dataset.owner = next.owner; marker.dataset.dropBefore = next.before ?? 'end';
    marker.id = `drop-${port.paneId}-${next.owner}-${next.before ?? 'end'}`;
    document.body.append(marker);
    if (next.collapsed && hoverOwner !== next.owner) {
      clearHover(); hoverOwner = next.owner;
      hoverTimer = window.setTimeout(() => {
        if (!drag || hoverOwner !== next.owner) return;
        reveal(next.owner);
        feedback(resolve(drag.x, drag.y));
      }, HOVER_DELAY);
    } else if (!next.collapsed) clearHover();
    port.announce(next.label);
  }
  function positionFeedback(): void {
    if (!drag) return;
    if (ghost) { ghost.style.left = `${Math.min(drag.x + 16, innerWidth - ghost.offsetWidth - 8)}px`; ghost.style.top = `${Math.min(drag.y + 16, innerHeight - ghost.offsetHeight - 8)}px`; }
    if (!marker || !target) return;
    const bounds = target.node.getBoundingClientRect();
    const board = host.closest<HTMLElement>('[data-scroll-zone]');
    const viewport = board?.getBoundingClientRect();
    const left = Math.max(8, viewport ? viewport.left + board!.clientLeft + 2 : 8);
    const right = Math.min(innerWidth - 8, viewport ? viewport.left + board!.clientLeft + board!.clientWidth - 2 : innerWidth - 8);
    const top = Math.max(8, viewport ? viewport.top + board!.clientTop + 2 : 8);
    const bottom = Math.min(innerHeight - 8, viewport ? viewport.top + board!.clientTop + board!.clientHeight - 2 : innerHeight - 8);
    marker.hidden = right <= left || bottom <= top;
    if (marker.hidden) return;
    marker.style.maxWidth = `${right - left}px`; marker.style.maxHeight = `${bottom - top}px`;
    marker.style.left = `${Math.max(left, Math.min(bounds.left, right - marker.offsetWidth))}px`;
    marker.style.top = `${Math.max(top, Math.min(bottom - marker.offsetHeight, target.before ? bounds.top - marker.offsetHeight / 2 : bounds.bottom - marker.offsetHeight))}px`;
  }
  function tick(): void {
    if (!drag?.active) return;
    if (!port.isEditable() || port.getState().revision !== drag.revision) { cleanup('Drag cancelled because this pane changed.'); return; }
    const hit = document.elementFromPoint(drag.x, drag.y) as HTMLElement | null;
    if (hit && host.contains(hit)) {
      let scroll: HTMLElement | null = hit.closest<HTMLElement>('[data-scroll-zone]');
      while (scroll && scroll !== host && scroll.scrollHeight <= scroll.clientHeight) scroll = scroll.parentElement?.closest<HTMLElement>('[data-scroll-zone]') ?? null;
      scroll ??= host.closest<HTMLElement>('[data-scroll-zone]');
      if (scroll) {
        const bounds = scroll.getBoundingClientRect();
        if (drag.y < bounds.top + SCROLL_EDGE) scroll.scrollTop -= SCROLL_SPEED;
        else if (drag.y > bounds.bottom - SCROLL_EDGE) scroll.scrollTop += SCROLL_SPEED;
      }
    }
    feedback(resolve(drag.x, drag.y)); positionFeedback(); frame = requestAnimationFrame(tick);
  }
  function down(event: PointerEvent): void {
    const handle = (event.target as HTMLElement).closest<HTMLElement>('[data-drag-handle]');
    if (!handle || !host.contains(handle) || event.button !== 0 || !event.isPrimary || !port.isEditable()) return;
    const card = handle.closest<HTMLElement>('[data-ticket]'); if (!card) return;
    drag = { pointerId: event.pointerId, ticket: card.dataset.ticket as TicketId, source: card.dataset.owner as OwnerId, revision: port.getState().revision, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, active: false };
    host.setPointerCapture(event.pointerId);
    port.interaction(true);
  }
  function move(event: PointerEvent): void {
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.x = event.clientX; drag.y = event.clientY;
    if (!drag.active && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) >= THRESHOLD) {
      drag.active = true;
      ghost = element('div', 'drag-ghost'); ghost.setAttribute('aria-hidden', 'true');
      ghost.append(element('span', 'ticket-id', drag.ticket), element('p', 'ticket-title', ticketById(drag.ticket).title));
      document.body.append(ghost); host.classList.add('is-dragging');
      document.getElementById(`ticket-${port.paneId}-${drag.ticket}`)?.classList.add('drag-source');
      tick();
    }
    if (drag.active) event.preventDefault();
  }
  function up(event: PointerEvent): void {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const current = drag;
    if (!current.active) { cleanup(); return; }
    const destination = resolve(event.clientX, event.clientY);
    if (!destination || !port.isEditable() || port.getState().revision !== current.revision) {
      cleanup(crossPane ? 'Different trial — tickets cannot move between A and B.' : 'Move cancelled. No ticket changed.'); return;
    }
    cleanup(); reveal(destination.owner);
    void port.move({ expectedPaneRevision: current.revision, ticketId: current.ticket, fromOwnerId: current.source, toOwnerId: destination.owner, beforeTicketId: destination.before }).then(saved => {
      if (saved) port.announce(`${current.ticket}: ${destination.label.replace(' · hold to expand', '')}. Saved.`);
      focusId(`move-${port.paneId}-${current.ticket}`);
    });
  }
  function cancel(): void { if (drag) cleanup('Move cancelled. No ticket changed.'); }
  function escape(event: KeyboardEvent): void { if (event.key === 'Escape' && drag) { event.preventDefault(); cancel(); } }
  host.addEventListener('pointerdown', down); host.addEventListener('pointermove', move); host.addEventListener('pointerup', up);
  host.addEventListener('pointercancel', cancel); host.addEventListener('lostpointercapture', cancel);
  window.addEventListener('blur', cancel); window.addEventListener('keydown', escape);
  return () => {
    cleanup(drag?.active ? 'Drag cancelled because the view changed. No ticket changed.' : undefined); host.removeEventListener('pointerdown', down); host.removeEventListener('pointermove', move); host.removeEventListener('pointerup', up);
    host.removeEventListener('pointercancel', cancel); host.removeEventListener('lostpointercapture', cancel);
    window.removeEventListener('blur', cancel); window.removeEventListener('keydown', escape);
  };
}
