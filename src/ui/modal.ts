// A modal dialog in the same parchment-and-wood style as panels, used for the "While you were
// away…" summary and for save errors.

import { FOCUSABLE, h } from './dom';

export interface ModalButton {
  label: string;
  primary?: boolean;
  onClick?(): void; // the modal closes afterwards unless this returns false
}

export interface ModalOptions {
  title: string;
  body: Node | string;
  buttons?: ModalButton[];
  /** ESC and the backdrop close it (default true). */
  dismissible?: boolean;
}

/** Open modals, newest last: `closeTopModal` (the back order, src/ui/back.ts) works on the top one. */
const stack: { dismissible: boolean; close(): void }[] = [];

/**
 * Back on the top modal: closes it if it is dismissible. True whenever a modal is open, because a
 * modal that must be answered (a save error) still owns the back button.
 */
export function closeTopModal(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  if (top.dismissible) top.close();
  return true;
}

/** True while any modal is open. */
export function modalOpen(): boolean {
  return stack.length > 0;
}

export function showModal(opts: ModalOptions): { close(): void } {
  const host = document.getElementById('modal-host') ?? document.body;
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const dismissible = opts.dismissible ?? true;
  const buttons = opts.buttons ?? [{ label: 'OK', primary: true }];
  const footer = h('footer', { class: 'modal-actions' });
  const dialog = h(
    'section',
    {
      class: 'panel modal',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'modal-title',
      tabindex: -1,
    },
    h('header', { class: 'panel-header' }, h('h2', { id: 'modal-title', text: opts.title })),
    h('div', { class: 'panel-body' }, opts.body),
    footer,
  );
  const backdrop = h('div', { class: 'modal-backdrop' }, dialog);

  const entry = { dismissible, close: (): void => close() };
  const close = (): void => {
    const i = stack.indexOf(entry);
    if (i < 0) return;
    stack.splice(i, 1);
    document.removeEventListener('keydown', onKey, true);
    backdrop.remove();
    previous?.focus();
  };
  // Escape goes through the back order (main.ts), which closes the top modal first.
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Tab') {
      // Keep focus inside the dialog.
      const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  for (const b of buttons) {
    const el = h('button', { type: 'button', class: b.primary ? 'btn btn-primary' : 'btn', text: b.label });
    el.addEventListener('click', () => {
      const keep = (b.onClick?.() as unknown) === false;
      if (!keep) close();
    });
    footer.append(el);
  }
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop && dismissible) close();
  });
  document.addEventListener('keydown', onKey, true);
  stack.push(entry);
  host.append(backdrop);
  (footer.querySelector<HTMLElement>('.btn-primary') ?? dialog).focus();
  return { close };
}
