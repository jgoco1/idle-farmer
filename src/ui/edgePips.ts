// The edge pips (GDD §12.1) as DOM buttons over the scene: an arrow pointing at something off-screen
// that wants the player, with that thing's icon. Clicking one pans the camera there. They are never
// tinted, and they only pulse when motion is allowed (the global reduced-motion CSS rule stops it).

import { edgePips, type PipKind, type PipTarget } from '../render/pips';
import type { Renderer } from '../render/renderer';
import { spriteDataUrl } from '../render/spriteCache';
import { h } from './dom';

const ICON: Record<PipKind, string> = {
  crop: 'item_turnip',
  trap: 'obj_fish_trap_full',
  dish: 'item_vegetable_soup',
  tree: 'item_apple',
  store: 'item_egg',
  trough: 'obj_trough_empty',
};
const LABEL: Record<PipKind, string> = {
  crop: 'Ready crops',
  trap: 'A full fish trap',
  dish: 'A dish waiting on the stove',
  tree: 'Ripe fruit in the orchard',
  store: 'A full egg or milk store',
  trough: 'The animals would love some feed',
};
const ROTATE = { right: 0, bottom: 90, left: 180, top: 270 } as const;

export class EdgePips {
  private readonly host: HTMLElement;
  private readonly buttons = new Map<PipKind, HTMLButtonElement>();
  private key = '';

  constructor(
    parent: HTMLElement,
    private readonly renderer: Renderer,
    icons: Partial<Record<PipKind, string>> = {},
  ) {
    this.host = h('div', { class: 'edge-pips', 'data-testid': 'edge-pips' });
    parent.append(this.host);
    for (const kind of Object.keys(LABEL) as PipKind[]) {
      const b = h(
        'button',
        { type: 'button', class: 'edge-pip', hidden: true, 'data-pip': kind },
        h('img', {
          class: 'pixel edge-pip-arrow',
          alt: '',
          width: 32,
          height: 32,
          src: spriteDataUrl('ui_pip_arrow'),
        }),
        h('img', {
          class: 'pixel edge-pip-icon',
          alt: '',
          width: 24,
          height: 24,
          src: spriteDataUrl(icons[kind] ?? ICON[kind]),
        }),
      );
      b.addEventListener('click', () => {
        const at = b.dataset.at?.split(',').map(Number);
        if (at && at.length === 2) this.renderer.panToTile(at[0]!, at[1]!);
      });
      this.buttons.set(kind, b);
      this.host.append(b);
    }
  }

  /** Places the pips for `targets` (call a few times a second, not every frame). */
  update(targets: readonly PipTarget[]): void {
    const pips = edgePips(targets, this.renderer.viewRect);
    const box = this.host.getBoundingClientRect();
    const key = pips
      .map((p) => `${p.kind}${p.col},${p.row}${p.side}${Math.round(p.x)},${Math.round(p.y)}`)
      .join('|');
    if (key === this.key) return;
    this.key = key;
    for (const b of this.buttons.values()) b.hidden = true;
    for (const p of pips) {
      const b = this.buttons.get(p.kind)!;
      const at = this.renderer.worldToClient(p.x, p.y);
      b.hidden = false;
      b.dataset.at = `${p.col},${p.row}`;
      b.dataset.side = p.side;
      b.setAttribute('aria-label', `${LABEL[p.kind]} off to the ${p.side}: show`);
      b.title = LABEL[p.kind];
      b.style.left = `${at.x - box.left}px`;
      b.style.top = `${at.y - box.top}px`;
      (b.firstElementChild as HTMLElement).style.transform = `rotate(${ROTATE[p.side]}deg)`;
    }
  }
}
