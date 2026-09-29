import { h } from './dom';

export type ToastTone = 'info' | 'good' | 'warn';

const TOAST_MS = 3200;
const MAX_TOASTS = 4;

/** Short messages above the toolbar ("+3 Turnips", "The soil is ready"). */
export class Toasts {
  constructor(private readonly host: HTMLElement) {}

  show(text: string, tone: ToastTone = 'info'): void {
    const el = h('div', { class: `toast toast-${tone}`, role: 'status', text });
    this.host.append(el);
    while (this.host.children.length > MAX_TOASTS) this.host.firstElementChild?.remove();
    window.setTimeout(() => {
      el.classList.add('toast-out');
      window.setTimeout(() => el.remove(), 300);
    }, TOAST_MS);
  }
}
