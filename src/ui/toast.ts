import { h } from './dom';

export type ToastTone = 'info' | 'good' | 'warn';

const TOAST_MS = 3200;
const MAX_TOASTS = 4;

/** Short messages above the toolbar ("+3 Turnips", "The soil is ready"). */
export class Toasts {
  private readonly waiting: { text: string; tone: ToastTone }[] = [];

  constructor(private readonly host: HTMLElement) {}

  /** Shows a message now; when the stack is full the oldest one makes room. */
  show(text: string, tone: ToastTone = 'info'): void {
    this.add(text, tone);
    while (this.host.children.length > MAX_TOASTS) this.host.firstElementChild?.remove();
  }

  /**
   * Shows a message that must not be lost (a level-up, a finished goal): when the stack is full it
   * waits for a place instead of pushing an older toast out.
   */
  showKept(text: string, tone: ToastTone = 'good'): void {
    if (this.host.children.length >= MAX_TOASTS) this.waiting.push({ text, tone });
    else this.add(text, tone);
  }

  private add(text: string, tone: ToastTone): void {
    const el = h('div', { class: `toast toast-${tone}`, role: 'status', text });
    this.host.append(el);
    window.setTimeout(() => {
      el.classList.add('toast-out');
      window.setTimeout(() => {
        el.remove();
        const next = this.waiting.shift();
        if (next) this.showKept(next.text, next.tone);
      }, 300);
    }, TOAST_MS);
  }
}
