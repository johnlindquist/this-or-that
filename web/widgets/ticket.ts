import type { OwnerId, TicketId } from '../../shared/contract';
import { ticketById } from '../../shared/fixture';
import { button, element } from '../dom';
import { openMoveDialog } from './move-dialog';
import type { Reveal, WidgetPort } from './types';

export function createTicket(port: WidgetPort, ownerId: OwnerId, ticketId: TicketId, index: number, reveal: Reveal): HTMLLIElement {
  const ticket = ticketById(ticketId);
  const card = element('li', 'ticket');
  card.id = `ticket-${port.paneId}-${ticketId}`;
  card.dataset.pane = port.paneId; card.dataset.owner = ownerId; card.dataset.ticket = ticketId;
  card.dataset.dropBefore = ticketId;
  const heading = element('div', 'ticket-meta');
  const handle = button('', () => {}, 'drag-handle');
  handle.id = `drag-${port.paneId}-${ticketId}`;
  handle.dataset.dragHandle = ticketId;
  handle.setAttribute('aria-label', `Drag ${ticketId}: ${ticket.title}. Use Move for keyboard controls.`);
  handle.setAttribute('aria-describedby', `instructions-${port.paneId}`);
  handle.disabled = !port.isEditable();
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 16 20'); icon.setAttribute('aria-hidden', 'true');
  for (const x of [5, 11]) for (const y of [4, 10, 16]) {
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('cx', String(x)); dot.setAttribute('cy', String(y)); dot.setAttribute('r', '1.3'); icon.append(dot);
  }
  handle.append(icon);
  heading.append(element('span', 'ticket-id', ticket.id), element('span', 'priority', `#${index + 1}`), handle);
  const title = element('p', 'ticket-title', ticket.title);
  const footer = element('div', 'ticket-footer');
  footer.append(element('span', 'ticket-kind', `${ticket.kind} · ${ticket.points} pt`));
  const move = button('Move…', () => openMoveDialog(port, ticketId, reveal), 'move-button');
  move.id = `move-${port.paneId}-${ticketId}`;
  move.setAttribute('aria-label', `Move ${ticketId}: ${ticket.title}`);
  move.disabled = !port.isEditable();
  footer.append(move); card.append(heading, title, footer);
  return card;
}
