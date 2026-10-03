// Placement mode (GDD §6.3): after buying a sprinkler or scarecrow, or from the Upgrades panel, the
// player clicks plots to put units down and clicks a placed one to pick it up again. A banner names
// the mode; Escape or "Done" leaves it. The range preview is drawn by the renderer.

import type { PlacedKind } from '../core/state';
import { h } from './dom';

export class PlacementMode {
  kind: PlacedKind | null = null;
  private readonly banner: HTMLElement;
  private readonly text: HTMLElement;

  constructor(private readonly onChange: () => void) {
    this.text = h('span', { class: 'placement-text' });
    const done = h('button', { type: 'button', class: 'btn btn-small', text: 'Done' });
    done.addEventListener('click', () => this.stop());
    this.banner = h(
      'div',
      { class: 'placement-banner', role: 'status', hidden: true, 'data-testid': 'placement-banner' },
      this.text,
      done,
    );
    document.body.append(this.banner);
  }

  start(kind: PlacedKind): void {
    this.kind = kind;
    this.banner.hidden = false;
    this.onChange();
  }

  stop(): void {
    this.kind = null;
    this.banner.hidden = true;
    this.onChange();
  }

  /** Updates the banner text, e.g. "Placing sprinklers · 2 left · click a placed one to pick it up". */
  describe(left: number): void {
    if (!this.kind) return;
    const name =
      this.kind === 'sprinkler'
        ? 'sprinkler'
        : this.kind === 'golden_scarecrow'
          ? 'golden scarecrow'
          : 'scarecrow';
    this.text.textContent =
      left > 0
        ? `Placing ${name}s · ${left} left · click a plot to place, a placed one to pick it up`
        : `No ${name}s left to place · click a placed one to pick it up`;
  }
}
