import type { PanelId } from '../data/ids';
import { h } from './dom';
import type { PanelManager } from './panel';

/** Panel buttons along the bottom. Farming tools join it in phase 02. */
export function buildToolbar(root: HTMLElement, panels: PanelManager): void {
  const buttons = new Map<PanelId, HTMLButtonElement>();
  for (const def of panels.defs()) {
    if (def.toolbar === false) continue;
    const btn = h(
      'button',
      { type: 'button', class: 'tool-btn', 'data-panel-button': def.id, 'aria-pressed': 'false' },
      h('span', { class: 'tool-icon', 'aria-hidden': 'true', text: def.icon }),
      h('span', { class: 'tool-label', text: def.title }),
    );
    btn.addEventListener('click', () => panels.toggle(def.id));
    buttons.set(def.id, btn);
    root.append(btn);
  }
  panels.onChange((open) => {
    buttons.forEach((b, id) => b.setAttribute('aria-pressed', String(id === open)));
  });
}
