export function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function button(text: string, action: () => void, className = 'button'): HTMLButtonElement {
  const node = element('button', className, text);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}

export function link(text: string, href: string, className = ''): HTMLAnchorElement {
  const node = element('a', className, text);
  node.href = href;
  return node;
}

export function download(name: string, value: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const anchor = link('', url);
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function focusId(id: string): void {
  requestAnimationFrame(() => {
    const node = document.getElementById(id);
    if (!node) return;
    node.focus({ preventScroll: true });
    const board = node.closest<HTMLElement>('[data-scroll-zone]');
    if (!board) return;
    const bounds = board.getBoundingClientRect();
    const target = node.getBoundingClientRect();
    const top = bounds.top + board.clientTop + 8;
    const bottom = bounds.top + board.clientTop + board.clientHeight - 8;
    if (target.top < top) board.scrollTop -= top - target.top;
    else if (target.bottom > bottom) board.scrollTop += target.bottom - bottom;
  });
}
