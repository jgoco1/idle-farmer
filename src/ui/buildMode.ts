// Building mode (GDD §12.4): after choosing "Build" or "Move" in the Ranch panel, the Old Paddock shows a ghost of
// the coop, barn or silo that snaps to the pointer (green where it can stand, red with the reason as a tooltip
// where it cannot); click to build (or move) there. All rules are in src/systems/ranch.ts; this only sends
// actions. Escape or "Done" leaves it. It reuses Decorate mode's click routing and `DecorGhost`, like planting.

import type { Action } from '../core/actions';
import type { GameState } from '../core/state';
import type { GameData } from '../data';
import type { BuildingId } from '../data/ids';
import type { DecorGhost } from '../render/renderer';
import type { ActionResult } from '../systems/context';
import { buildingById, buildingPlacementProblem } from '../systems/ranch';
import { h } from './dom';

export interface BuildHooks {
  data: GameData;
  state(): GameState;
  dispatch(action: Action): ActionResult;
  toast(text: string, tone?: 'info' | 'good' | 'warn'): void;
  /** The renderer's mode switch (clicks arrive in `click` while it is on). */
  setMode(on: boolean): void;
  setGhost(g: DecorGhost | null): void;
  /** Pans the camera to the Old Paddock. */
  showYard(): void;
  /** Called before entering, so other modes can stop. */
  onStart(): void;
}

export class BuildMode {
  on = false;
  private kind: BuildingId | null = null;
  private moving: number | null = null;
  private readonly text: HTMLElement;
  private readonly banner: HTMLElement;
  private problem: ((col: number, row: number) => string | null) | null = null;

  constructor(private readonly hooks: BuildHooks) {
    this.text = h('span', { class: 'placement-text' });
    const done = h('button', { type: 'button', class: 'btn btn-small', text: 'Done' });
    done.addEventListener('click', () => this.stop());
    this.banner = h(
      'div',
      { class: 'placement-banner', role: 'status', hidden: true, 'data-testid': 'build-banner' },
      this.text,
      done,
    );
    document.body.append(this.banner);
  }

  /** Buy and place a new building. */
  start(kind: BuildingId): void {
    this.begin(kind, null);
  }

  /** Move a building (free): the animals, feed and products stay with it. */
  startMove(id: number): void {
    const b = buildingById(this.hooks.state(), id);
    if (b) this.begin(b.kind, id);
  }

  /** Why the building in hand cannot stand with its top-left at (col, row) (the tooltip over a red footprint). */
  problemAt(col: number, row: number): string | null {
    return this.problem ? this.problem(col, row) : null;
  }

  private begin(kind: BuildingId, moving: number | null): void {
    this.hooks.onStart();
    this.on = true;
    this.kind = kind;
    this.moving = moving;
    const def = this.hooks.data.buildings[kind];
    const level = moving !== null ? (buildingById(this.hooks.state(), moving)?.level ?? 1) : 1;
    this.banner.hidden = false;
    this.hooks.setMode(true);
    this.describe();
    this.problem = (col, row) =>
      buildingPlacementProblem(this.hooks.state(), this.hooks.data, kind, col, row, this.moving ?? undefined);
    this.hooks.setGhost({
      cols: def.footprint.cols,
      rows: def.footprint.rows,
      sprite: `${def.sprite}_${level}`,
      flipped: false,
      problemAt: (col, row) => this.problemAt(col, row),
    });
    this.hooks.showYard();
  }

  stop(): void {
    if (!this.on) return;
    this.on = false;
    this.kind = null;
    this.moving = null;
    this.problem = null;
    this.banner.hidden = true;
    this.hooks.setMode(false);
    this.hooks.setGhost(null);
  }

  private describe(): void {
    if (!this.kind) return;
    const def = this.hooks.data.buildings[this.kind];
    const room = def.houses ? ' · leave a tile on its right for the trough and a row of grass in front' : '';
    this.text.textContent =
      this.moving !== null
        ? `Moving the ${def.name.toLowerCase()} · free · click a spot in the Old Paddock${room}`
        : `Building the ${def.name.toLowerCase()} · ${def.levels[0]!.price.toLocaleString('en-US')}g · click a spot in the Old Paddock${room}`;
  }

  /** A click on world tile (col, row) while the mode is on: the tile is the building's top-left corner. */
  click(col: number, row: number): void {
    if (!this.on || !this.kind) return;
    const r =
      this.moving !== null
        ? this.hooks.dispatch({ type: 'moveBuilding', id: this.moving, col, row })
        : this.hooks.dispatch({ type: 'buildBuilding', building: this.kind, col, row });
    if (!r.ok) return this.hooks.toast(r.reason, 'warn');
    if (this.moving !== null) this.hooks.toast('The building is settled in its new spot.', 'good');
    this.stop();
  }
}
