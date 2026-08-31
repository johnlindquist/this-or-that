import type { Owner, OwnerId } from '../../shared/contract';
import { ticketById } from '../../shared/fixture';
import { element } from '../dom';
import { createTicket } from './ticket';
import type { Reveal, WidgetPort } from './types';

export function queueMetadata(port: WidgetPort, owner: Owner): string {
  const ids = port.getState().queues[owner.id];
  const points = ids.reduce((total, id) => total + ticketById(id).points, 0);
  return `${ids.length} ${ids.length === 1 ? 'ticket' : 'tickets'} · ${points} pt`;
}
export function createQueue(port: WidgetPort, ownerId: OwnerId, reveal: Reveal, className = ''): HTMLOListElement {
  const list = element('ol', `ticket-list ${className}`);
  list.id = `queue-${port.paneId}-${ownerId}`; list.dataset.pane = port.paneId; list.dataset.owner = ownerId;
  list.dataset.dropZone = ''; list.dataset.dropBefore = 'end'; list.dataset.scrollZone = '';
  list.setAttribute('aria-labelledby', `owner-${port.paneId}-${ownerId}`);
  const ids = port.getState().queues[ownerId];
  ids.forEach((id, index) => list.append(createTicket(port, ownerId, id, index, reveal)));
  if (!ids.length) { const empty = element('li', 'empty-queue', 'Drop a ticket here, or use its Move control.'); empty.dataset.dropBefore = 'end'; list.append(empty); }
  return list;
}
