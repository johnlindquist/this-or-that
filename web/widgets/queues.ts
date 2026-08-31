import type { OwnerId } from '../../shared/contract';
import { OWNERS, ticketById } from '../../shared/fixture';
import { button, element, focusId } from '../dom';
import { bindDragSurface } from './drag';
import { createQueue, queueMetadata } from './queue';
import type { WidgetHandle, WidgetPort } from './types';

export function mountQueues(host: HTMLElement, port: WidgetPort): WidgetHandle {
  host.classList.add('queues-widget'); host.dataset.pane = port.paneId;
  const expanded = port.expandedOwners ?? new Set<OwnerId>(['backlog']);
  function reveal(ownerId: OwnerId): void { if (!expanded.has(ownerId)) { expanded.add(ownerId); update(); } }
  function update(): void {
    host.replaceChildren();
    for (const owner of OWNERS) {
      const open = expanded.has(owner.id);
      const ids = port.getState().queues[owner.id];
      const section = element('section', `queue-row${open ? ' expanded' : ''}`);
      section.dataset.pane = port.paneId; section.dataset.owner = owner.id;
      const toggle = button('', () => {
        if (expanded.has(owner.id)) expanded.delete(owner.id); else expanded.add(owner.id);
        update(); focusId(`toggle-${port.paneId}-${owner.id}`);
      }, 'queue-toggle');
      toggle.id = `toggle-${port.paneId}-${owner.id}`;
      toggle.setAttribute('aria-expanded', String(open)); toggle.setAttribute('aria-controls', `queue-${port.paneId}-${owner.id}`);
      toggle.dataset.pane = port.paneId; toggle.dataset.owner = owner.id;
      if (!open) { toggle.dataset.dropZone = ''; toggle.dataset.collapsed = 'true'; toggle.dataset.dropBefore = 'end'; }
      const avatar = element('span', 'initials', owner.initials); avatar.setAttribute('aria-hidden', 'true');
      const info = element('span', 'queue-owner-info');
      const name = element('span', 'owner-name', owner.name); name.id = `owner-${port.paneId}-${owner.id}`;
      info.append(name, element('span', 'queue-summary', ids[0] ? `First: ${ids[0]} · ${ticketById(ids[0]).title}` : 'No tickets assigned'));
      const right = element('span', 'queue-row-meta');
      right.append(element('span', 'queue-meta', queueMetadata(port, owner)), element('span', 'disclosure-label', open ? 'Collapse' : 'Expand'));
      toggle.append(avatar, info, right); section.append(toggle);
      const list = createQueue(port, owner.id, reveal); list.hidden = !open; section.append(list);
      if (!open) {
        const append = element('div', 'collapsed-drop', `Drop to append to ${owner.name} · hold to expand`);
        append.dataset.pane = port.paneId; append.dataset.owner = owner.id; append.dataset.dropZone = ''; append.dataset.collapsed = 'true'; append.dataset.dropBefore = 'end';
        section.append(append);
      }
      host.append(section);
    }
  }
  update(); const unbind = bindDragSurface(host, port, reveal);
  return { update, reveal, destroy: unbind };
}
