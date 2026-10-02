import type { PanelId } from '../data/ids';
import { h } from './dom';
import type { PanelManager } from './panel';

/** Panel buttons along the bottom. Farming tools join it in phase 02. `nudge` makes one pulse until it is opened. */
export function buildToolbar(
  root: HTMLElement,
  panels: PanelManager,
): { nudge(id: PanelId): void; setVisible(id: PanelId, visible: boolean): void } {
  const buttons = new Map<PanelId, HTMLButtonElement>();
  for (const def of panels.defs()) {
    if (def.toolbar === false) continue;
    const btn = h(
      'button',
      {
        type: 'button',
        class: 'tool-btn',
        'data-panel-button': def.id,
        'aria-pressed': 'false',
        'aria-label': def.title, // the text label is hidden on phones, leaving only the icon
        title: def.title,
      },
      h('span', { class: 'tool-icon', 'aria-hidden': 'true', text: def.icon }),
      h('span', { class: 'tool-label', text: def.title }),
    );
    btn.addEventListener('click', () => panels.toggle(def.id));
    buttons.set(def.id, btn);
    root.append(btn);
  }
  // When the buttons would not fit (a narrow window, or a large interface size), drop their text labels
  // instead of scrolling the bar; the icons keep their names (aria-label and title).
  const fit = (): void => {
    root.classList.remove('is-compact');
    if (root.scrollWidth > root.clientWidth + 1) root.classList.add('is-compact');
  };
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fit).observe(root);
  panels.onChange((open) => {
    buttons.forEach((b, id) => b.setAttribute('aria-pressed', String(id === open)));
    if (open) buttons.get(open)?.classList.remove('is-nudged');
  });
  return {
    nudge(id) {
      buttons.get(id)?.classList.add('is-nudged');
    },
    /** Shows or hides one button (the Ranch's appears once the Old Paddock is bought). */
    setVisible(id, visible) {
      const b = buttons.get(id);
      if (b && b.hidden === visible) {
        b.hidden = !visible;
        fit();
      }
    },
  };
}
