// Decorations (GDD §12.2, BALANCE.md §13.2): cosmetic pieces bought with gold, kept in a stock, and placed
// on owned land. They give charm and nothing else. Stock = bought − placed; the farmhouse pieces (paint,
// roof, loft) are owned once and applied, never placed, and use no slot. A path's or fence's joined
// sprite is derived from its neighbours when drawn (`autotileMask`), never stored.

import type { GameState, PlacedDecor } from '../core/state';
import type { GameData } from '../data';
import type { DecorId } from '../data/ids';
import { DECOR_IDS, isDecorId } from '../data/ids';
import type { DecorDef } from '../data/types';
import { fixedBlockReason, regionAt, WORLD_BOTTOM, WORLD_COLS, WORLD_TOP } from '../data/world';
import { charmOf, noteCharm } from './charm';
import { fail, OK, type ActionResult, type SimContext } from './context';
import { canAfford, spend } from './economy';
import { decorSetOpen, decorSlotCap } from './townProjects';
import { isUnlocked, unlockHint } from './unlocks';
import { ownsParcel } from './parcels';

export function ownedDecor(state: GameState, id: DecorId): number {
  return state.decor.owned[id] ?? 0;
}

export function placedDecorCount(state: GameState, id: DecorId): number {
  let n = 0;
  for (const p of state.decor.placed) if (p.decor === id) n++;
  return n;
}

/** Pieces bought but not standing on the land (for farmhouse pieces: 1 once owned, since they are applied, not placed). */
export function decorStock(state: GameState, data: GameData, id: DecorId): number {
  const def = data.decor[id];
  if (def.kind !== 'place') return ownedDecor(state, id);
  return Math.max(0, ownedDecor(state, id) - placedDecorCount(state, id));
}

export function slotsUsed(state: GameState): number {
  return state.decor.placed.length;
}

export interface DecorStatus {
  /** The set is open and every condition on the piece holds. */
  unlocked: boolean;
  /** Why not, when it is not ("Reach charm 25", "Finish “Mend the Old Bridge” on the Community Board."). */
  hint: string | null;
}

export function decorStatus(state: GameState, data: GameData, id: DecorId): DecorStatus {
  const def = data.decor[id];
  const set = data.decorSets[def.set];
  if (!decorSetOpen(state, data, def.set)) {
    return { unlocked: false, hint: unlockHint(state, data, set.unlock) };
  }
  if (!isUnlocked(state, def.unlock, data))
    return { unlocked: false, hint: unlockHint(state, data, def.unlock) };
  return { unlocked: true, hint: null };
}

/** Whether there is something to put down or to buy right now (a piece in stock, or an open piece the purse can pay for). */
export function hasDecorToPlace(state: GameState, data: GameData): boolean {
  for (const id of DECOR_IDS) {
    const def = data.decor[id];
    if (def.kind !== 'place' || !decorStatus(state, data, id).unlocked) continue;
    if (decorStock(state, data, id) > 0 || state.gold >= def.price) return true;
  }
  return false;
}

// ---- buying

export function buyDecor(state: GameState, ctx: SimContext, id: DecorId, qty: number): ActionResult {
  if (!isDecorId(id)) return fail('There is no such decoration.');
  const def = ctx.data.decor[id];
  if (!Number.isInteger(qty) || qty <= 0) return fail('Choose how many to buy.');
  const status = decorStatus(state, ctx.data, id);
  if (!status.unlocked) return fail(status.hint ?? `${def.name} is not for sale yet.`);
  if (def.kind !== 'place') {
    if (ownedDecor(state, id) > 0) return fail(`You already own ${def.name}.`);
    if (qty !== 1) return fail('You only need one of those.');
  }
  const cost = def.price * qty;
  if (!canAfford(state, cost)) return fail(`You need ${cost.toLocaleString('en-US')}g for that.`);
  spend(state, cost);
  state.decor.owned[id] = ownedDecor(state, id) + qty;
  ctx.events.push({ type: 'purchased', what: id, gold: cost });
  return OK;
}

/** Gives pieces to the stock without paying (milestone and goal rewards). */
export function grantDecor(state: GameState, id: DecorId, qty: number): void {
  state.decor.owned[id] = ownedDecor(state, id) + qty;
}

// ---- placement

export function footprintOf(def: DecorDef, col: number, row: number): { col: number; row: number }[] {
  const out: { col: number; row: number }[] = [];
  for (let r = 0; r < def.size.rows; r++)
    for (let c = 0; c < def.size.cols; c++) out.push({ col: col + c, row: row + r });
  return out;
}

/** The placed piece covering world tile (col, row), if any. */
export function decorAt(state: GameState, data: GameData, col: number, row: number): PlacedDecor | undefined {
  for (const p of state.decor.placed) {
    const def = data.decor[p.decor];
    if (
      col >= p.at.col &&
      col < p.at.col + def.size.cols &&
      row >= p.at.row &&
      row < p.at.row + def.size.rows
    )
      return p;
  }
  return undefined;
}

/** The name of the ranch building whose footprint or trough tile covers (col, row), lower-case, or null. */
function buildingNameAt(state: GameState, data: GameData, col: number, row: number): string | null {
  for (const b of state.ranch.buildings) {
    const def = data.buildings[b.kind];
    const inFootprint =
      col >= b.at.col &&
      col < b.at.col + def.footprint.cols &&
      row >= b.at.row &&
      row < b.at.row + def.footprint.rows;
    const trough =
      def.houses !== null &&
      col === b.at.col + def.footprint.cols &&
      row === b.at.row + def.footprint.rows - 1;
    if (inFootprint || trough) return def.name.toLowerCase();
  }
  return null;
}

/** Why tile (col, row) cannot hold a decoration (ignoring other decorations), or null. */
export function tileProblem(state: GameState, data: GameData, col: number, row: number): string | null {
  if (
    !Number.isInteger(col) ||
    !Number.isInteger(row) ||
    col < 0 ||
    row < WORLD_TOP ||
    col >= WORLD_COLS ||
    row >= WORLD_BOTTOM
  ) {
    return 'That is past the edge of the world.';
  }
  const fixed = fixedBlockReason(col, row);
  if (fixed) return fixed;
  const region = regionAt(col, row);
  switch (region) {
    case 'home':
      return null;
    case 'orchard':
    case 'yard':
    case 'meadow':
    case 'north_fields':
    case 'terraces':
      return ownsParcel(state, region) ? null : `You do not own the ${data.parcels[region].name} yet.`;
    case 'town':
      return 'The town square belongs to everyone.';
    case 'sea':
      return 'That is the sea.';
    case 'northroad':
      return 'The north road belongs to everyone.';
    case 'woods':
      return 'Leave the woods wild.';
    default:
      return 'Lanes stay clear.';
  }
}

/**
 * Why `id` cannot stand with its top-left at (col, row), or null when it can. `movingId` is a placed
 * piece being moved: it does not block itself and needs no stock or slot.
 */
export function decorPlacementProblem(
  state: GameState,
  data: GameData,
  id: DecorId,
  col: number,
  row: number,
  movingId?: number,
): string | null {
  const def = data.decor[id];
  if (!def) return 'There is no such decoration.';
  if (def.kind !== 'place') return 'That goes on the farmhouse, not on the land.';
  if (movingId === undefined) {
    if (decorStock(state, data, id) <= 0)
      return `You have no ${def.name} left to place. Buy one in the Shop.`;
    if (slotsUsed(state) >= decorSlotCap(state, data)) {
      return 'Every decoration slot is in use. Finish town projects for more.';
    }
  }
  for (const t of footprintOf(def, col, row)) {
    const p = tileProblem(state, data, t.col, t.row);
    if (p) return p;
    const other = decorAt(state, data, t.col, t.row);
    if (other && other.id !== movingId) return `${data.decor[other.decor].name} is already there.`;
    const building = buildingNameAt(state, data, t.col, t.row);
    if (building) return `The ${building} stands there.`;
  }
  return null;
}

function nextDecorId(state: GameState): number {
  return state.decor.placed.reduce((m, p) => Math.max(m, p.id), 0) + 1;
}

export function placeDecor(
  state: GameState,
  ctx: SimContext,
  id: DecorId,
  col: number,
  row: number,
  flipped: boolean | undefined,
): ActionResult {
  if (!isDecorId(id)) return fail('There is no such decoration.');
  const def = ctx.data.decor[id];
  const problem = decorPlacementProblem(state, ctx.data, id, col, row);
  if (problem) return fail(problem);
  const charmBefore = charmOf(state, ctx.data);
  const placed: PlacedDecor = { id: nextDecorId(state), decor: id, at: { col, row } };
  if (flipped && def.flips) placed.flipped = true;
  state.decor.placed.push(placed);
  ctx.events.push({ type: 'decorPlaced', decor: id, id: placed.id });
  noteCharm(state, ctx, charmBefore);
  return OK;
}

export function moveDecor(
  state: GameState,
  ctx: SimContext,
  placedId: number,
  col: number,
  row: number,
  flipped: boolean | undefined,
): ActionResult {
  const p = state.decor.placed.find((x) => x.id === placedId);
  if (!p) return fail('There is nothing to move.');
  const def = ctx.data.decor[p.decor];
  const problem = decorPlacementProblem(state, ctx.data, p.decor, col, row, placedId);
  if (problem) return fail(problem);
  p.at = { col, row };
  if (flipped !== undefined) {
    if (flipped && def.flips) p.flipped = true;
    else delete p.flipped;
  }
  ctx.events.push({ type: 'decorMoved', decor: p.decor, id: p.id });
  return OK;
}

export function pickUpDecor(state: GameState, ctx: SimContext, placedId: number): ActionResult {
  const i = state.decor.placed.findIndex((x) => x.id === placedId);
  const p = state.decor.placed[i];
  if (!p) return fail('There is nothing to pick up.');
  const charmBefore = charmOf(state, ctx.data);
  state.decor.placed.splice(i, 1);
  ctx.events.push({ type: 'decorPickedUp', decor: p.decor, id: p.id });
  noteCharm(state, ctx, charmBefore);
  return OK;
}

// ---- the farmhouse

/** Applies owned farmhouse pieces (null puts the original back; undefined leaves that part as it is). Free and reversible. */
export function styleFarmhouse(
  state: GameState,
  ctx: SimContext,
  paint: DecorId | null | undefined,
  roof: DecorId | null | undefined,
  loft: boolean | undefined,
): ActionResult {
  const check = (id: DecorId | null | undefined, kind: DecorDef['kind']): ActionResult | null => {
    if (id === undefined || id === null) return null;
    const def = isDecorId(id) ? ctx.data.decor[id] : undefined;
    if (!def || def.kind !== kind) return fail(`That is not a farmhouse ${kind}.`);
    if (ownedDecor(state, id) <= 0) return fail(`You do not own ${def.name} yet.`);
    return null;
  };
  const bad = check(paint, 'paint') ?? check(roof, 'roof');
  if (bad) return bad;
  if (loft && ownedDecor(state, 'farmhouse_loft') <= 0) return fail('You do not own the Farmhouse Loft yet.');
  const charmBefore = charmOf(state, ctx.data);
  const f = state.decor.farmhouse;
  if (paint !== undefined) f.paint = paint;
  if (roof !== undefined) f.roof = roof;
  if (loft !== undefined) f.loft = loft;
  noteCharm(state, ctx, charmBefore);
  return OK;
}

// ---- auto-tiling

/**
 * The 4-neighbour mask of the path or fence at (col, row): N = 1, E = 2, S = 4, W = 8 for each
 * neighbouring piece of the same id (ART_STYLE.md §6.2). Derived from the placed list, never stored.
 */
export function autotileMask(placed: readonly PlacedDecor[], id: DecorId, col: number, row: number): number {
  let mask = 0;
  for (const p of placed) {
    if (p.decor !== id) continue;
    if (p.at.row === row - 1 && p.at.col === col) mask |= 1;
    else if (p.at.row === row && p.at.col === col + 1) mask |= 2;
    else if (p.at.row === row + 1 && p.at.col === col) mask |= 4;
    else if (p.at.row === row && p.at.col === col - 1) mask |= 8;
  }
  return mask;
}
