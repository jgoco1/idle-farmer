// Placed objects (GDD §6.3, BALANCE.md §4): sprinklers and scarecrows stand on plots of the field.
// A sprinkler keeps the plots in its area permanently watered; a scarecrow speeds up growth in its
// area (overlaps do not stack). The object's own plot is used up: it cannot be tilled or planted.
// Positions are plot (col, row), so a bigger grid needs no remapping.

import type { GameState, PlacedKind, PlacedObject } from '../core/state';
import type { GameData } from '../data';
import { emptyPlot } from '../core/state';
import { fail, OK, type ActionResult, type SimContext } from './context';
import { GOLDEN_SCARECROW } from '../data/balance';
import { upgradeLevel } from './upgrades';

export const PLACED_KINDS: readonly PlacedKind[] = ['sprinkler', 'scarecrow', 'golden_scarecrow'];

/** The kinds that speed up growth around them (overlaps do not stack). */
export function isScarecrow(kind: PlacedKind): boolean {
  return kind === 'scarecrow' || kind === 'golden_scarecrow';
}

export interface AreaSpec {
  shape: 'plus' | 'square';
  radius: number;
}

export type Offset = readonly [dc: number, dr: number];

const offsetCache = new Map<string, readonly Offset[]>();

/** Offsets covered by an area around its centre, the centre itself excluded. */
export function areaOffsets(spec: AreaSpec): readonly Offset[] {
  const key = `${spec.shape}${spec.radius}`;
  let out = offsetCache.get(key);
  if (!out) {
    const list: Offset[] = [];
    for (let dr = -spec.radius; dr <= spec.radius; dr++) {
      for (let dc = -spec.radius; dc <= spec.radius; dc++) {
        if (dc === 0 && dr === 0) continue;
        if (spec.shape === 'plus' && dc !== 0 && dr !== 0) continue;
        list.push([dc, dr]);
      }
    }
    out = list;
    offsetCache.set(key, out);
  }
  return out;
}

/** The area one placed object of `kind` covers at the player's current upgrades. */
export function areaOf(state: GameState, data: GameData, kind: PlacedKind): AreaSpec {
  if (kind === 'sprinkler') {
    const tech = data.upgrades.sprinkler_tech;
    const e = tech?.effect[upgradeLevel(state, 'sprinkler_tech')] ?? tech?.effect[0];
    return { shape: e?.shape ?? 'plus', radius: e?.radius ?? 1 };
  }
  if (kind === 'golden_scarecrow') return { shape: 'square', radius: GOLDEN_SCARECROW.radius };
  const e = data.upgrades.scarecrow?.effect[1];
  return { shape: e?.shape ?? 'square', radius: e?.radius ?? 2 };
}

/** Growth bonus a scarecrow of `kind` gives the plots in its area. */
export function scarecrowBonus(data: GameData, kind: PlacedKind = 'scarecrow'): number {
  if (kind === 'golden_scarecrow') return GOLDEN_SCARECROW.growthBonus;
  return data.upgrades.scarecrow?.effect[1]?.growthBonus ?? 0;
}

export function placedCount(state: GameState, kind: PlacedKind): number {
  return state.placed.reduce((n, o) => n + (o.kind === kind ? 1 : 0), 0);
}

/** Units owned: bought upgrades, or the one golden scarecrow the Spring Crops bundle gives. */
export function ownedCount(state: GameState, kind: PlacedKind): number {
  if (kind === 'golden_scarecrow')
    return state.progression.completedBundles.includes(GOLDEN_SCARECROW.bundle) ? 1 : 0;
  return upgradeLevel(state, kind);
}

/** Units owned but not standing on the field. */
export function stockOf(state: GameState, kind: PlacedKind): number {
  return Math.max(0, ownedCount(state, kind) - placedCount(state, kind));
}

export function objectAt(state: GameState, col: number, row: number): PlacedObject | undefined {
  return state.placed.find((o) => o.at.col === col && o.at.row === row);
}

/** Plot indexes used up by placed objects. */
export function occupiedPlots(state: GameState): Set<number> {
  const cols = state.farm.grid.cols;
  return new Set(state.placed.map((o) => o.at.row * cols + o.at.col));
}

export function inGrid(state: GameState, col: number, row: number): boolean {
  const { cols, rows } = state.farm.grid;
  return Number.isInteger(col) && Number.isInteger(row) && col >= 0 && row >= 0 && col < cols && row < rows;
}

/** Why `kind` cannot be placed on plot (col, row) right now, or null if it can. */
export function placementProblem(
  state: GameState,
  kind: PlacedKind,
  col: number,
  row: number,
): string | null {
  if (!inGrid(state, col, row)) return 'That is not a plot.';
  const there = objectAt(state, col, row);
  if (there) return `A ${there.kind} already stands there.`;
  const plot = state.farm.plots[row * state.farm.grid.cols + col]!;
  if (plot.state === 'planted') return 'Harvest or clear the crop first.';
  if (stockOf(state, kind) <= 0) {
    return kind === 'golden_scarecrow'
      ? 'Your golden scarecrow is already standing on the field.'
      : `You have no ${kind}s left to place. Buy one in Upgrades.`;
  }
  return null;
}

export function placeObject(
  state: GameState,
  ctx: SimContext,
  kind: PlacedKind,
  col: number,
  row: number,
): ActionResult {
  if (!PLACED_KINDS.includes(kind)) return fail('That cannot be placed.');
  const problem = placementProblem(state, kind, col, row);
  if (problem) return fail(problem);
  const plot = state.farm.plots[row * state.farm.grid.cols + col]!;
  if (plot.state === 'dead') Object.assign(plot, emptyPlot('tilled'));
  const id = state.placed.reduce((m, o) => Math.max(m, o.id), 0) + 1;
  state.placed.push({ id, kind, at: { col, row } });
  ctx.events.push({ type: 'placed', kind, col, row });
  return OK;
}

export function pickUpObject(state: GameState, ctx: SimContext, id: number): ActionResult {
  const i = state.placed.findIndex((o) => o.id === id);
  const obj = state.placed[i];
  if (!obj) return fail('There is nothing to pick up.');
  state.placed.splice(i, 1);
  ctx.events.push({ type: 'pickedUp', kind: obj.kind, col: obj.at.col, row: obj.at.row });
  return OK;
}

// ---- coverage

/** Per field plot: kept watered by a sprinkler, and the best scarecrow growth bonus. */
export interface Coverage {
  sprinkled: Uint8Array;
  bonus: Float64Array;
}

/** Null when nothing is placed (the common early case), so callers can skip the work. */
export function coverageOf(state: GameState, data: GameData): Coverage | null {
  if (state.placed.length === 0) return null;
  const { cols, rows } = state.farm.grid;
  const cov: Coverage = { sprinkled: new Uint8Array(cols * rows), bonus: new Float64Array(cols * rows) };
  for (const o of state.placed) {
    const bonus = scarecrowBonus(data, o.kind);
    for (const [dc, dr] of areaOffsets(areaOf(state, data, o.kind))) {
      const c = o.at.col + dc;
      const r = o.at.row + dr;
      if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
      const i = r * cols + c;
      if (o.kind === 'sprinkler') cov.sprinkled[i] = 1;
      else if (bonus > cov.bonus[i]!) cov.bonus[i] = bonus;
    }
  }
  return cov;
}
