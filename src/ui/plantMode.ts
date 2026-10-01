// Planting mode (GDD §12.3): after choosing a sapling in the Shop's Trees tab (or Move on a planted tree),
// the free tree spots of the orchard light up with a 2 × 2 footprint preview; click one to plant (or move)
// there. All rules are in src/systems/orchard.ts; this only sends actions. Escape or "Done" leaves it.

import type { Action } from '../core/actions';
import type { GameState } from '../core/state';
import type { GameData } from '../data';
import { treeOfFruit, type FruitId } from '../data/ids';
import { WORLD_LAYOUT } from '../data/world';
import type { DecorGhost } from '../render/renderer';
import type { ActionResult } from '../systems/context';
import { freeSpots, saplingsInBag, spotProblem, treeById } from '../systems/orchard';
import { h } from './dom';

export interface PlantHooks {
  data: GameData;
  state(): GameState;
  dispatch(action: Action): ActionResult;
  toast(text: string, tone?: 'info' | 'good' | 'warn'): void;
  /** The renderer's mode switch (clicks arrive in `click` while it is on). */
  setMode(on: boolean): void;
  setGhost(g: DecorGhost | null): void;
  /** Pans the camera to the orchard. */
  showOrchard(): void;
  /** Called before entering, so other modes can stop. */
  onStart(): void;
}

export class PlantMode {
  on = false;
  private fruit: FruitId | null = null;
  private moving: number | null = null;
  private readonly text: HTMLElement;
  private readonly banner: HTMLElement;

  constructor(private readonly hooks: PlantHooks) {
    this.text = h('span', { class: 'placement-text' });
    const done = h('button', { type: 'button', class: 'btn btn-small', text: 'Done' });
    done.addEventListener('click', () => this.stop());
    this.banner = h(
      'div',
      { class: 'placement-banner', role: 'status', hidden: true, 'data-testid': 'plant-banner' },
      this.text,
      done,
    );
    document.body.append(this.banner);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.on) {
        e.preventDefault();
        this.stop();
      }
    });
  }

  /** Plant a sapling of `fruit` on a free spot. */
  start(fruit: FruitId): void {
    this.begin(fruit, null);
  }

  /** Move tree `id` to another free spot (it keeps its age and fruit). */
  startMove(id: number): void {
    const t = treeById(this.hooks.state(), id);
    if (t) this.begin(null, id);
  }

  private begin(fruit: FruitId | null, moving: number | null): void {
    this.hooks.onStart();
    this.on = true;
    this.fruit = fruit;
    this.moving = moving;
    this.banner.hidden = false;
    this.hooks.setMode(true);
    this.describe();
    const data = this.hooks.data;
    const tree =
      moving !== null ? treeById(this.hooks.state(), moving)?.tree : fruit ? treeOfFruit(fruit) : null;
    const sprite = tree ? `tree_${data.trees[tree].fruit}_young` : null;
    this.hooks.setGhost({
      cols: 2,
      rows: 2,
      sprite,
      flipped: false,
      problemAt: (col, row) => this.problemAt(col, row),
      snap: (col, row) => this.spotAt(col, row),
      get markers() {
        return markerList;
      },
    });
    this.refreshMarkers();
    this.hooks.showOrchard();
  }

  stop(): void {
    if (!this.on) return;
    this.on = false;
    this.fruit = null;
    this.moving = null;
    this.banner.hidden = true;
    this.hooks.setMode(false);
    this.hooks.setGhost(null);
  }

  /** The 2 × 2 spot containing tile (col, row), as its top-left, or null. */
  private spotAt(col: number, row: number): { col: number; row: number } | null {
    for (const s of WORLD_LAYOUT.treeSpots) {
      if (col >= s.col && col < s.col + 2 && row >= s.row && row < s.row + 2)
        return { col: s.col, row: s.row };
    }
    return null;
  }

  private spotIndex(col: number, row: number): number {
    return WORLD_LAYOUT.treeSpots.findIndex((s) => s.col === col && s.row === row);
  }

  private problemAt(col: number, row: number): string | null {
    const i = this.spotIndex(col, row);
    if (i < 0) return 'Trees grow only on the orchard’s tree spots.';
    return spotProblem(this.hooks.state(), this.hooks.data, i, this.moving ?? undefined);
  }

  private describe(): void {
    const s = this.hooks.state();
    if (this.moving !== null) {
      this.text.textContent = 'Moving a tree · it keeps its age and fruit · click a free tree spot';
    } else if (this.fruit) {
      const name = this.hooks.data.trees[treeOfFruit(this.fruit)].name;
      this.text.textContent = `Planting a ${name} tree · ${saplingsInBag(s, this.fruit)} sapling${saplingsInBag(s, this.fruit) === 1 ? '' : 's'} left · click a free tree spot`;
    }
  }

  private refreshMarkers(): void {
    markerList = freeSpots(this.hooks.state(), this.hooks.data).map((i) => {
      const s = WORLD_LAYOUT.treeSpots[i]!;
      return { col: s.col, row: s.row, cols: 2, rows: 2 };
    });
  }

  /** A click on world tile (col, row) while the mode is on. */
  click(col: number, row: number): void {
    if (!this.on) return;
    const at = this.spotAt(col, row);
    if (!at) return this.hooks.toast('Trees grow only on the orchard’s tree spots.', 'warn');
    const spot = this.spotIndex(at.col, at.row);
    const r =
      this.moving !== null
        ? this.hooks.dispatch({ type: 'moveTree', id: this.moving, spot })
        : this.fruit
          ? this.hooks.dispatch({ type: 'plantTree', fruit: this.fruit, spot })
          : null;
    if (!r) return;
    if (!r.ok) return this.hooks.toast(r.reason, 'warn');
    if (this.moving !== null) {
      this.hooks.toast('The tree is settled in its new spot.', 'good');
      return this.stop();
    }
    const s = this.hooks.state();
    if (this.fruit && saplingsInBag(s, this.fruit) > 0 && freeSpots(s, this.hooks.data).length > 0) {
      this.describe();
      this.refreshMarkers();
    } else this.stop();
  }
}

let markerList: { col: number; row: number; cols: number; rows: number }[] = [];
