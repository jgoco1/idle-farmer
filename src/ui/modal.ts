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

  const close = (): void => {
    document.removeEventListener('keydown', onKey, true);
    backdrop.remove();
    previous?.focus();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (dismissible) close();
    } else if (e.key === 'Tab') {
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
  host.append(backdrop);
  (footer.querySelector<HTMLElement>('.btn-primary') ?? dialog).focus();
  return { close };
}
