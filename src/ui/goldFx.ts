// "+N gold" popups where a sale happens (a Market button, the Shipping Bin in the scene). Cosmetic
// DOM only: they read nothing from the game and never touch state.

import { h } from './dom';

const POPUP_MS = 1100;

let layer: HTMLElement | null = null;

function host(): HTMLElement {
  if (!layer || !layer.isConnected) {
    layer = h('div', { class: 'gold-popups', 'aria-hidden': 'true' });
    document.body.append(layer);
  }
  return layer;
}

/** Shows "+N" rising from viewport point (x, y). */
export function goldPopupAt(amount: number, x: number, y: number): void {
  if (amount <= 0) return;
  const el = h('div', { class: 'gold-popup', text: `+${amount.toLocaleString('en-US')}g` });
  el.style.left = `${Math.round(x)}px`;
  el.style.top = `${Math.round(y)}px`;
  host().append(el);
  window.setTimeout(() => el.remove(), POPUP_MS);
}

/** Shows "+N" rising from the top centre of `el`. */
export function goldPopupOn(amount: number, el: Element): void {
  const r = el.getBoundingClientRect();
  goldPopupAt(amount, r.left + r.width / 2, r.top);
}
