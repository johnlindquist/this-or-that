import { OWNER_IDS, type OwnerId, type TicketId } from '../../shared/contract';
import { OWNERS, ticketById } from '../../shared/fixture';
import { button, element, focusId } from '../dom';
import type { Reveal, WidgetPort } from './types';

export function openMoveDialog(port: WidgetPort, ticketId: TicketId, reveal: Reveal): void {
  if (!port.isEditable() || document.getElementById('move-dialog')) return;
  const pane = port.getState();
  const source = OWNER_IDS.find(owner => pane.queues[owner].includes(ticketId));
  if (!source) return;
  const dialog = element('dialog', 'move-dialog'); dialog.id = 'move-dialog';
  dialog.setAttribute('aria-labelledby', 'move-title');
  const form = element('form', 'move-form');
  form.append(element('h2', '', `Move ${ticketId}`)); form.firstElementChild!.id = 'move-title';
  form.append(element('p', 'muted', ticketById(ticketId).title));
  const ownerLabel = element('label', '', 'Destination'); ownerLabel.htmlFor = 'move-owner';
  const ownerSelect = element('select'); ownerSelect.id = 'move-owner';
  for (const owner of OWNERS) { const option = element('option', '', owner.name); option.value = owner.id; ownerSelect.append(option); }
  ownerSelect.value = source;
  const positionLabel = element('label', '', 'Priority'); positionLabel.htmlFor = 'move-position';
  const positionSelect = element('select'); positionSelect.id = 'move-position';
  function populate(): void {
    positionSelect.replaceChildren();
    for (const id of pane.queues[ownerSelect.value as OwnerId].filter(id => id !== ticketId)) {
      const option = element('option', '', `Before ${id} — ${ticketById(id).title}`); option.value = id; positionSelect.append(option);
    }
    const last = element('option', '', 'Last priority (append)'); last.value = ''; positionSelect.append(last);
    positionSelect.value = '';
  }
  populate(); ownerSelect.addEventListener('change', populate);
  const error = element('p', 'dialog-error'); error.setAttribute('role', 'alert');
  const actions = element('div', 'button-row');
  const cancel = button('Cancel', () => dialog.close());
  const submit = element('button', 'button primary', 'Move ticket'); submit.type = 'submit'; submit.id = 'move-confirm';
  actions.append(cancel, submit);
  form.append(ownerLabel, ownerSelect, positionLabel, positionSelect, error, actions); dialog.append(form);
  let destination: OwnerId | null = null;
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (destination) reveal(destination);
    focusId(`move-${port.paneId}-${ticketId}`);
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!port.isEditable() || port.getState().revision !== pane.revision) {
      error.textContent = 'This queue changed while the dialog was open. Cancel and reopen Move to inspect the current positions.';
      return;
    }
    submit.disabled = true; cancel.disabled = true;
    const owner = ownerSelect.value as OwnerId;
    const before = (positionSelect.value || null) as TicketId | null;
    destination = owner;
    // Close before dispatch: server state changes rerender the pane; its stable ID restores focus afterward.
    dialog.close();
    reveal(owner);
    const saved = await port.move({ expectedPaneRevision: pane.revision, ticketId, fromOwnerId: source, toOwnerId: owner, beforeTicketId: before });
    if (saved) {
      reveal(owner);
      port.announce(`${ticketId} moved to ${OWNERS.find(item => item.id === owner)!.name}, ${before ? `before ${before}` : 'last priority'}. Saved.`);
    }
    focusId(`move-${port.paneId}-${ticketId}`);
  });
  document.body.append(dialog); dialog.showModal(); ownerSelect.focus();
}
