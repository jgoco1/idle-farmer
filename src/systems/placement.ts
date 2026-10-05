// Placed objects (GDD §6.3, §13.3; BALANCE.md §4): sprinklers and scarecrows stand on plots of a field.
// A sprinkler keeps the plots in its area permanently watered; a scarecrow speeds up growth in its
// area (overlaps do not stack). The object's own plot is used up: it cannot be tilled or planted.
// Positions are plot (col, row) inside their field (the home field, or a north field, v4-01), so a
// bigger grid needs no remapping, and an area never reaches into another field.

import type { GameState, PlacedKind, PlacedObject } from '../core/state';
import type { GameData } from '../data';
import { emptyPlot } from '../core/state';
import { fail, OK, type ActionResult, type SimContext } from './context';
import { FIELD_BASE, GOLDEN_SCARECROW, GREENHOUSE_BASE } from '../data/balance';
import { NORTH_FIELD_IDS, type NorthFieldId } from '../data/ids';
import { WORLD_LAYOUT } from '../data/world';
import { upgradeLevel } from './upgrades';

export const PLACED_KINDS: readonly PlacedKind[] = ['sprinkler', 'scarecrow', 'golden_scarecrow'];

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

/** The grid of a field: the home field's current size, or a north field's fixed one. */
export function gridOf(state: GameState, field?: NorthFieldId): { cols: number; rows: number } {
  return field ? WORLD_LAYOUT.northFields[field].grid : state.farm.grid;
}

/** The plot index of plot (col, row) of a field (home without `field`). */
export function fieldPlotIndex(state: GameState, col: number, row: number, field?: NorthFieldId): number {
  return field ? FIELD_BASE[field] + row * gridOf(state, field).cols + col : row * state.farm.grid.cols + col;
}

/** A plot of the home field (`field` null) or a north field, by (col, row) inside that field. */
export interface PlotCoords {
  field: NorthFieldId | null;
  col: number;
  row: number;
}

/**
 * The field and plot (col, row) of plot `index`, written into `out` (no allocation: the placement preview asks
 * every frame). False for the greenhouse, a north field not owned, or no plot at all.
 */
export function plotCoordsOf(state: GameState, index: number, out: PlotCoords): boolean {
  if (index < 0) return false;
  if (index < GREENHOUSE_BASE) {
    if (index >= state.farm.plots.length) return false;
    out.field = null;
    out.col = index % state.farm.grid.cols;
    out.row = Math.floor(index / state.farm.grid.cols);
    return true;
  }
  if (index < FIELD_BASE.north_fields) return false;
  const field: NorthFieldId = index < FIELD_BASE.terraces ? 'north_fields' : 'terraces';
  const plots = state.farm.north[field]?.plots;
  const local = index - FIELD_BASE[field];
  if (!plots || local >= plots.length) return false;
  const cols = WORLD_LAYOUT.northFields[field].grid.cols;
  out.field = field;
  out.col = local % cols;
  out.row = Math.floor(local / cols);
  return true;
}

/** The object standing on plot (col, row) of a field (home without `field`). */
export function objectAt(
  state: GameState,
  col: number,
  row: number,
  field?: NorthFieldId,
): PlacedObject | undefined {
  return state.placed.find((o) => o.at.col === col && o.at.row === row && o.field === field);
}

const occupiedCache = new WeakMap<
  readonly PlacedObject[],
  { cols: number; keys: number[]; set: Set<number> }
>();

/**
 * Plot indexes used up by placed objects. Asked by the planter at every farmhand visit, so the set is
 * kept per `placed` array while the home grid's width and every object's plot are unchanged. Shared:
 * never modify it.
 */
export function occupiedPlots(state: GameState): ReadonlySet<number> {
  const placed = state.placed;
  const cols = state.farm.grid.cols;
  const e = occupiedCache.get(placed);
  if (e && e.cols === cols && e.keys.length === placed.length) {
    let same = true;
    for (let i = 0; i < placed.length && same; i++) {
      const o = placed[i]!;
      same = e.keys[i] === fieldPlotIndex(state, o.at.col, o.at.row, o.field);
    }
    if (same) return e.set;
  }
  const keys = placed.map((o) => fieldPlotIndex(state, o.at.col, o.at.row, o.field));
  const set = new Set(keys);
  occupiedCache.set(placed, { cols, keys, set });
  return set;
}

/** Whether (col, row) is a plot of the field (a north field only once it is owned). */
export function inGrid(state: GameState, col: number, row: number, field?: NorthFieldId): boolean {
  if (field && !state.farm.north[field]) return false;
  const { cols, rows } = gridOf(state, field);
  return Number.isInteger(col) && Number.isInteger(row) && col >= 0 && row >= 0 && col < cols && row < rows;
}

/** The plots of a field (home without `field`). */
function plotsOf(state: GameState, field?: NorthFieldId): GameState['farm']['plots'] {
  return field ? (state.farm.north[field]?.plots ?? []) : state.farm.plots;
}

/** Why `kind` cannot be placed on plot (col, row) right now, or null if it can. */
export function placementProblem(
  state: GameState,
  kind: PlacedKind,
  col: number,
  row: number,
  field?: NorthFieldId,
): string | null {
  if (!inGrid(state, col, row, field)) return 'That is not a plot.';
  const there = objectAt(state, col, row, field);
  if (there) return `A ${there.kind} already stands there.`;
  const plot = plotsOf(state, field)[row * gridOf(state, field).cols + col]!;
  if (plot.state === 'planted') {
    return plot.harvests > 0
      ? 'A regrowing crop stands here: pull it up with the Hoe first.'
      : 'Harvest or clear the crop first.';
  }
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
  field?: NorthFieldId,
): ActionResult {
  if (!PLACED_KINDS.includes(kind)) return fail('That cannot be placed.');
  if (field !== undefined && !NORTH_FIELD_IDS.includes(field)) return fail('That is not a plot.');
  const problem = placementProblem(state, kind, col, row, field);
  if (problem) return fail(problem);
  const plot = plotsOf(state, field)[row * gridOf(state, field).cols + col]!;
  if (plot.state === 'dead') Object.assign(plot, emptyPlot('tilled'));
  const id = state.placed.reduce((m, o) => Math.max(m, o.id), 0) + 1;
  state.placed.push(field ? { id, kind, at: { col, row }, field } : { id, kind, at: { col, row } });
  ctx.events.push(field ? { type: 'placed', kind, col, row, field } : { type: 'placed', kind, col, row });
  return OK;
}

export function pickUpObject(state: GameState, ctx: SimContext, id: number): ActionResult {
  const i = state.placed.findIndex((o) => o.id === id);
  const obj = state.placed[i];
  if (!obj) return fail('There is nothing to pick up.');
  state.placed.splice(i, 1);
  ctx.events.push(
    obj.field
      ? { type: 'pickedUp', kind: obj.kind, col: obj.at.col, row: obj.at.row, field: obj.field }
      : { type: 'pickedUp', kind: obj.kind, col: obj.at.col, row: obj.at.row },
  );
  return OK;
}

// ---- coverage

/** Per plot of one field: sprinkled or not, and the best scarecrow bonus. */
export interface FieldCoverage {
  sprinkled: Uint8Array;
  bonus: Float64Array;
}

/** The home field's coverage (`sprinkled`, `bonus`) and each owned north field's (v4-01). */
export interface Coverage extends FieldCoverage {
  byField: Partial<Record<NorthFieldId, FieldCoverage>>;
}

// The coverage is asked for several times per simulation step (growth, water-outs, the farmhand's
// forecast, the UI per plot), but only changes when something is placed, picked up or widened, so
// the last one is kept per `placed` array and reused while the grid, the sprinkler area and every
// object's kind, field and position are unchanged (compared without allocating).
interface CoverageCacheEntry {
  data: GameData;
  cols: number;
  rows: number;
  tech: number;
  objects: { kind: PlacedKind; col: number; row: number; field: NorthFieldId | undefined }[];
  cov: Coverage;
}
const coverageCache = new WeakMap<readonly PlacedObject[], CoverageCacheEntry>();

function cacheHolds(e: CoverageCacheEntry, state: GameState, data: GameData): boolean {
  const placed = state.placed;
  if (e.data !== data || e.cols !== state.farm.grid.cols || e.rows !== state.farm.grid.rows) return false;
  if (e.tech !== upgradeLevel(state, 'sprinkler_tech') || e.objects.length !== placed.length) return false;
  for (let i = 0; i < placed.length; i++) {
    const a = placed[i]!;
    const b = e.objects[i]!;
    if (a.kind !== b.kind || a.at.col !== b.col || a.at.row !== b.row || a.field !== b.field) return false;
  }
  return true;
}

function emptyCoverage(cols: number, rows: number): FieldCoverage {
  return { sprinkled: new Uint8Array(cols * rows), bonus: new Float64Array(cols * rows) };
}

/**
 * Per plot of every field: sprinkled or not, and the best scarecrow bonus. Null when nothing is placed
 * (the common early case), so callers can skip the work. The result is shared: never modify it.
 */
export function coverageOf(state: GameState, data: GameData): Coverage | null {
  if (state.placed.length === 0) return null;
  const cached = coverageCache.get(state.placed);
  if (cached && cacheHolds(cached, state, data)) return cached.cov;
  const { cols, rows } = state.farm.grid;
  const cov: Coverage = { ...emptyCoverage(cols, rows), byField: {} };
  for (const o of state.placed) {
    let target: FieldCoverage = cov;
    let g = state.farm.grid;
    if (o.field) {
      g = gridOf(state, o.field);
      target = cov.byField[o.field] ??= emptyCoverage(g.cols, g.rows);
    }
    const bonus = scarecrowBonus(data, o.kind);
    for (const [dc, dr] of areaOffsets(areaOf(state, data, o.kind))) {
      const c = o.at.col + dc;
      const r = o.at.row + dr;
      if (c < 0 || r < 0 || c >= g.cols || r >= g.rows) continue;
      const i = r * g.cols + c;
      if (o.kind === 'sprinkler') target.sprinkled[i] = 1;
      else if (bonus > target.bonus[i]!) target.bonus[i] = bonus;
    }
  }
  coverageCache.set(state.placed, {
    data,
    cols,
    rows,
    tech: upgradeLevel(state, 'sprinkler_tech'),
    objects: state.placed.map((o) => ({ kind: o.kind, col: o.at.col, row: o.at.row, field: o.field })),
    cov,
  });
  return cov;
}
