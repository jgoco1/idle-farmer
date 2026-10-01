// The orchard (GDD §12.3, BALANCE.md §13.5): fruit trees planted once on a tree spot of the Hilltop
// Orchard. Trees run on the **calendar**, not on simulated time: a tree's age is the number of real
// 06:00 → 06:00 days since it was planted (`ctx.calendar.dayIndex`, which never decreases), so the
// offline cap does not slow it down. At each daily refresh a mature tree in season adds its fruit per
// day, up to four days' worth; days missed while away are counted exactly (`growOrchard` walks every
// day since the tree's `lastFruitDay`), so an absence gives the same fruit as daily visits would have.
// A tree's stage, age and ripeness are derived, never stored. Trees never wither.

import type { GameState, TreeState } from '../core/state';
import { seasonOfDay, type Calendar } from '../core/time';
import type { GameData } from '../data';
import { BASE_TREE_SPOTS, FARMHAND_FRUIT_XP_SHARE } from '../data/balance';
import { isFruitId, saplingOf, treeOfFruit, type FruitId, type SeasonId } from '../data/ids';
import type { TreeDef } from '../data/types';
import { WORLD_LAYOUT } from '../data/world';
import { shipsAutomatically, stowHarvest } from './autoSeller';
import { bundleBonuses } from './bundles';
import { fail, OK, type ActionResult, type SimContext } from './context';
import { canAfford, spend } from './economy';
import { addItem, countItem, removeItem, spaceFor } from './inventory';
import { ownsParcel } from './parcels';

export type TreeStage = 'sapling' | 'young' | 'mature';

// ---- derived values

export function treeDef(data: GameData, t: Pick<TreeState, 'tree'>): TreeDef {
  return data.trees[t.tree];
}

/** Whole real days since planting. */
export function treeAge(t: TreeState, dayIndex: number): number {
  return Math.max(0, dayIndex - t.plantedDay);
}

/** sapling below half the days to mature, young until mature (BALANCE.md §13.5). */
export function stageForAge(def: Pick<TreeDef, 'matureDays'>, age: number): TreeStage {
  return age < Math.ceil(def.matureDays / 2) ? 'sapling' : age < def.matureDays ? 'young' : 'mature';
}

export function treeStage(data: GameData, t: TreeState, dayIndex: number): TreeStage {
  return stageForAge(treeDef(data, t), treeAge(t, dayIndex));
}

/** Real days until the tree is mature (0 once it is). */
export function daysToMature(data: GameData, t: TreeState, dayIndex: number): number {
  return Math.max(0, treeDef(data, t).matureDays - treeAge(t, dayIndex));
}

/** Whether day `d` is a bearing day for a tree planted on `plantedDay`: old enough and in a bearing season. */
export function bearsOn(
  def: Pick<TreeDef, 'matureDays' | 'seasons'>,
  plantedDay: number,
  d: number,
  cal: Pick<Calendar, 'dayZero' | 'epochWeek'>,
): boolean {
  return d - plantedDay >= def.matureDays && def.seasons.includes(seasonOfDay(cal, d));
}

/** The first day index at or after `from` on which a tree planted on `plantedDay` bears, or null (none within a year). */
export function firstBearingDay(
  def: Pick<TreeDef, 'matureDays' | 'seasons'>,
  plantedDay: number,
  from: number,
  cal: Pick<Calendar, 'dayZero' | 'epochWeek'>,
): number | null {
  for (let d = Math.max(from, plantedDay + def.matureDays); d < plantedDay + def.matureDays + 400; d++) {
    if (def.seasons.includes(seasonOfDay(cal, d))) return d;
  }
  return null;
}

export function inSeasonToday(def: Pick<TreeDef, 'seasons'>, season: SeasonId): boolean {
  return def.seasons.includes(season);
}

// ---- spots

/** How many of the orchard's tree spots are open: 8 with the parcel, 2 more with the Orchard Basket. */
export function openTreeSpots(state: GameState, data: GameData): number {
  if (!ownsParcel(state, 'orchard')) return 0;
  return Math.min(WORLD_LAYOUT.treeSpots.length, BASE_TREE_SPOTS + bundleBonuses(state, data).treeSpots);
}

export function treeAtSpot(state: GameState, spot: number): TreeState | undefined {
  return state.orchard.trees.find((t) => t.spot === spot);
}

export function treeById(state: GameState, id: number): TreeState | undefined {
  return state.orchard.trees.find((t) => t.id === id);
}

/** Open spots with no tree on them, lowest first. */
export function freeSpots(state: GameState, data: GameData): number[] {
  const out: number[] = [];
  const open = openTreeSpots(state, data);
  for (let i = 0; i < open; i++) if (!treeAtSpot(state, i)) out.push(i);
  return out;
}

/** Why `spot` cannot take a tree (ignoring which tree), or null. `except` is a tree being moved. */
export function spotProblem(state: GameState, data: GameData, spot: number, except?: number): string | null {
  if (!ownsParcel(state, 'orchard')) return 'Buy the Hilltop Orchard first.';
  if (!Number.isInteger(spot) || spot < 0 || spot >= WORLD_LAYOUT.treeSpots.length)
    return 'That is not a tree spot.';
  if (spot >= openTreeSpots(state, data)) return 'That spot opens with the Orchard Basket bundle.';
  const there = treeAtSpot(state, spot);
  if (there && there.id !== except) return 'A tree already grows there.';
  return null;
}

/** The tree whose sprite covers world tile (col, row): its 2 × 2 spot and the tile of canopy above it. */
export function treeAtTile(state: GameState, col: number, row: number): TreeState | undefined {
  for (const t of state.orchard.trees) {
    const s = WORLD_LAYOUT.treeSpots[t.spot]!;
    if (col >= s.col && col < s.col + 2 && row >= s.row - 1 && row < s.row + 2) return t;
  }
  return undefined;
}

export function treeCount(state: GameState): number {
  return state.orchard.trees.length;
}

// ---- buying and planting

export function saplingsInBag(state: GameState, fruit: FruitId): number {
  return countItem(state.inventory, saplingOf(fruit));
}

export function buySapling(state: GameState, ctx: SimContext, fruit: FruitId, qty: number): ActionResult {
  if (!isFruitId(fruit)) return fail('There is no such tree.');
  const def = ctx.data.trees[treeOfFruit(fruit)];
  if (!ownsParcel(state, 'orchard')) return fail('Buy the Hilltop Orchard first.');
  if (!Number.isInteger(qty) || qty <= 0) return fail('Choose how many saplings to buy.');
  const cost = def.saplingPrice * qty;
  if (!canAfford(state, cost)) return fail(`You need ${cost.toLocaleString('en-US')}g for that.`);
  if (spaceFor(state.inventory, saplingOf(fruit)) < qty) return fail('Your bag is full.');
  spend(state, cost);
  addItem(state.inventory, saplingOf(fruit), qty);
  ctx.events.push({ type: 'purchased', what: saplingOf(fruit), gold: cost });
  return OK;
}

function nextTreeId(state: GameState): number {
  return state.orchard.trees.reduce((m, t) => Math.max(m, t.id), 0) + 1;
}

export function plantTree(state: GameState, ctx: SimContext, fruit: FruitId, spot: number): ActionResult {
  if (!isFruitId(fruit)) return fail('There is no such tree.');
  const problem = spotProblem(state, ctx.data, spot);
  if (problem) return fail(problem);
  const sapling = saplingOf(fruit);
  const def = ctx.data.trees[treeOfFruit(fruit)];
  if (countItem(state.inventory, sapling) <= 0)
    return fail(`You have no ${def.name} sapling. Buy one in the Shop's Trees tab.`);
  removeItem(state.inventory, sapling, 1);
  const day = ctx.calendar.dayIndex;
  const id = nextTreeId(state);
  state.orchard.trees.push({ id, tree: def.id, spot, plantedDay: day, fruit: 0, lastFruitDay: day });
  ctx.events.push({ type: 'treePlanted', tree: def.id, id });
  return OK;
}

/** Moving is free and keeps the tree's age and fruit. */
export function moveTree(state: GameState, ctx: SimContext, id: number, spot: number): ActionResult {
  const t = treeById(state, id);
  if (!t) return fail('There is no such tree.');
  if (t.spot === spot) return fail('It already grows there.');
  const problem = spotProblem(state, ctx.data, spot, id);
  if (problem) return fail(problem);
  t.spot = spot;
  ctx.events.push({ type: 'treeMoved', tree: t.tree, id });
  return OK;
}

/** The sapling is not refunded and the growth is gone (the UI confirms first). */
export function removeTree(state: GameState, ctx: SimContext, id: number): ActionResult {
  const i = state.orchard.trees.findIndex((t) => t.id === id);
  const t = state.orchard.trees[i];
  if (!t) return fail('There is no such tree.');
  state.orchard.trees.splice(i, 1);
  ctx.events.push({ type: 'treeRemoved', tree: t.tree, id });
  return OK;
}

// ---- the daily refresh

/**
 * The 06:00 refresh for the orchard: every tree takes the fruit of each day since its last one,
 * checking each day's maturity and season (a full tree stops adding; nothing is lost), and reports
 * trees that turned mature and the fruit that grew. Pure in the calendar: one big jump over several
 * days gives the same as a refresh each day.
 */
export function growOrchard(state: GameState, ctx: SimContext): void {
  const today = ctx.calendar.dayIndex;
  for (const t of state.orchard.trees) {
    if (today <= t.lastFruitDay) continue;
    const def = ctx.data.trees[t.tree];
    const matureDay = t.plantedDay + def.matureDays;
    if (matureDay > t.lastFruitDay && matureDay <= today)
      ctx.events.push({ type: 'treeMatured', tree: t.tree, id: t.id });
    const before = t.fruit;
    for (let d = Math.max(t.lastFruitDay + 1, matureDay); d <= today; d++) {
      if (def.seasons.includes(seasonOfDay(ctx.calendar, d)))
        t.fruit = Math.min(def.fruitCap, t.fruit + def.fruitPerDay);
    }
    t.lastFruitDay = today;
    if (t.fruit > before)
      ctx.events.push({ type: 'fruitGrown', fruit: def.fruit, qty: t.fruit - before, tree: t.id });
  }
}

// ---- picking

/** How many of a tree's fruit would fit right now: all of it if it ships automatically, else what the bag holds. */
export function pickableQty(state: GameState, data: GameData, t: TreeState): number {
  const fruit = data.trees[t.tree].fruit;
  if (t.fruit <= 0) return 0;
  if (shipsAutomatically(state, data, fruit)) return t.fruit;
  return Math.min(t.fruit, spaceFor(state.inventory, fruit));
}

/** Picks what fits from one tree into the bag (or the bin). Returns the quantity picked (0 = nothing moved). */
export function pickOne(state: GameState, ctx: SimContext, t: TreeState, auto: boolean): number {
  const def = ctx.data.trees[t.tree];
  const qty = pickableQty(state, ctx.data, t);
  if (qty <= 0) return 0;
  const stowed = stowHarvest(state, ctx.data, def.fruit, qty);
  if (!stowed) return 0;
  t.fruit -= qty;
  state.stats.fruitPicked += qty;
  ctx.events.push({ type: 'fruitPicked', fruit: def.fruit, qty, tree: t.id, auto, shipped: stowed.bin });
  return qty;
}

/** Click a tree: pick all its fruit. A full bag leaves the rest on the tree. */
export function pickTree(state: GameState, ctx: SimContext, id: number): ActionResult {
  const t = treeById(state, id);
  if (!t) return fail('There is no such tree.');
  const def = ctx.data.trees[t.tree];
  if (t.fruit <= 0) return fail(noFruitReason(ctx, t));
  const qty = pickOne(state, ctx, t, false);
  if (qty <= 0) {
    ctx.events.push({ type: 'inventoryFull', item: def.fruit });
    return fail('Your bag is full. The fruit will wait on the tree.');
  }
  if (t.fruit > 0) ctx.events.push({ type: 'inventoryFull', item: def.fruit });
  return OK;
}

function noFruitReason(ctx: SimContext, t: TreeState): string {
  const def = ctx.data.trees[t.tree];
  const age = treeAge(t, ctx.calendar.dayIndex);
  if (age < def.matureDays) {
    const left = def.matureDays - age;
    return `This ${def.name.toLowerCase()} tree is still growing: ${left} more day${left === 1 ? '' : 's'}.`;
  }
  if (!inSeasonToday(def, ctx.calendar.season)) {
    return `This ${def.name.toLowerCase()} tree is resting. It bears in ${def.seasons.join(' and ')}.`;
  }
  return 'No fruit is hanging right now. New fruit grows at 6:00 every morning.';
}

/** The farmhand's pick: up to `budget` trees with fruit, each using one unit of its capacity. Returns trees picked. */
export function pickTreesFor(state: GameState, ctx: SimContext, budget: number): number {
  let n = 0;
  for (const t of state.orchard.trees) {
    if (n >= budget) break;
    if (t.fruit > 0 && pickOne(state, ctx, t, true) > 0) n++;
  }
  return n;
}

/** Whether a farmhand visit right now would pick something. */
export function hasTreeWork(state: GameState, data: GameData): boolean {
  for (const t of state.orchard.trees) if (pickableQty(state, data, t) > 0) return true;
  return false;
}

/** Trees with fruit hanging (for the edge pips and the toolbar). */
export function ripeTrees(state: GameState): TreeState[] {
  return state.orchard.trees.filter((t) => t.fruit > 0);
}

/** Farming XP for `qty` fruit of `tree`: a quarter when the farmhand picked it. */
export function fruitXp(data: GameData, fruit: FruitId, qty: number, auto: boolean): number {
  return qty * data.trees[treeOfFruit(fruit)].xp * (auto ? FARMHAND_FRUIT_XP_SHARE : 1);
}

/** Whether the player owns a mature tree of `fruit` on `dayIndex` (market specials start then). */
export function ownsMatureTree(state: GameState, data: GameData, fruit: FruitId, dayIndex: number): boolean {
  const tree = treeOfFruit(fruit);
  for (const t of state.orchard.trees) {
    if (t.tree === tree && treeAge(t, dayIndex) >= data.trees[tree].matureDays) return true;
  }
  return false;
}

/** Whether any tree of `fruit` has been planted (its price joins the market sparkline then). */
export function hasTreeOf(state: GameState, fruit: FruitId): boolean {
  const tree = treeOfFruit(fruit);
  for (const t of state.orchard.trees) if (t.tree === tree) return true;
  return false;
}
