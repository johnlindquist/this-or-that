import { OWNERS } from '../../shared/fixture';
import { element } from '../dom';
import { bindDragSurface } from './drag';
import { createQueue, queueMetadata } from './queue';
import type { WidgetHandle, WidgetPort } from './types';

export function mountColumns(host: HTMLElement, port: WidgetPort): WidgetHandle {
  host.classList.add('columns-widget'); host.dataset.pane = port.paneId;
  const reveal = () => {};
  function update(): void {
    host.replaceChildren();
    const developers = element('div', 'developer-columns');
    for (const owner of OWNERS) {
      const section = element('section', owner.id === 'backlog' ? 'column backlog-column' : 'column');
      section.dataset.owner = owner.id; section.dataset.pane = port.paneId;
      const heading = element('div', 'owner-heading');
      const title = element('h3', '', owner.name); title.id = `owner-${port.paneId}-${owner.id}`;
      heading.append(title, element('span', 'queue-meta', queueMetadata(port, owner)));
      section.append(heading);
      if (owner.id === 'backlog') {
        const order = element('p', 'backlog-order muted'); order.id = `backlog-order-${port.paneId}`;
        order.append(element('span', 'backlog-order-horizontal', '#1 is highest · left-to-right, then the next row.'), element('span', 'backlog-order-vertical', '#1 is highest · top-to-bottom.'));
        section.append(order);
      }
      const queue = createQueue(port, owner.id, reveal, owner.id === 'backlog' ? 'backlog-list' : '');
      if (owner.id === 'backlog') queue.setAttribute('aria-describedby', `backlog-order-${port.paneId}`);
      section.append(queue);
      if (owner.id === 'backlog') host.append(section); else developers.append(section);
    }
    host.append(developers);
  }
  update(); const unbind = bindDragSurface(host, port, reveal);
  return { update, reveal, destroy: unbind };
}
