// The apiary (GDD §13.6, BALANCE.md §14.5, DATA_SCHEMAS.md §10.5–10.8): up to six beehives on the
// apiary's spots at the end of the north road, bought one at a time onto the next free spot (the player
// does not choose, like fish traps). Each hive makes one jar of honey per cycle of simulated time into
// its own store of HIVE_STORE; a full hive waits, and nothing is ever lost. Hives need nothing: no feed,
// no flowers, and they never read decorations (cosmetic). Busy Bees shortens the cycle through the
// existing `animalSpeedModifier`, as it does the animals'.
//
// Offline correctness: jars are `floor((cycleMs + dt) / interval)` per hive, capped by the store (a full
// hive keeps its cycle at zero), and the interval only changes when a buff starts or ends, which is a
// step boundary. No RNG. So one large step gives exactly what many small ones do and the apiary does not
// report to `msToNextSimEvent`.

import type { GameState, HiveState } from '../core/state';
import type { GameData } from '../data';
import { AUTO_COLLECT_XP_SHARE, HONEY_XP, roundNice } from '../data/balance';
import { WORLD_LAYOUT } from '../data/world';
import { stowHarvest, shipsAutomatically } from './autoSeller';
import { fail, OK, type ActionResult, type SimContext } from './context';
import { canAfford, spend } from './economy';
import { spaceFor } from './inventory';
import { isUnlocked, unlockHint } from './unlocks';

/** The apiary's spots (`WORLD_LAYOUT.hiveSpots`). */
export function hiveSpotCount(): number {
  return WORLD_LAYOUT.hiveSpots.length;
}

export function hiveCount(state: GameState): number {
  return state.apiary.hives.length;
}

/** The price of the next hive (the (n+1)th costs roundNice(base × ratio^n)), or null when every spot has one. */
export function nextHivePrice(state: GameState, data: GameData): number | null {
  const n = hiveCount(state);
  if (n >= hiveSpotCount()) return null;
  return roundNice(data.hive.basePrice * data.hive.ratio ** n);
}

/** The first spot without a hive, or -1. */
export function nextFreeHiveSpot(state: GameState): number {
  for (let spot = 0; spot < hiveSpotCount(); spot++)
    if (!state.apiary.hives.some((h) => h.spot === spot)) return spot;
  return -1;
}

export function hiveOnSpot(state: GameState, spot: number): HiveState | undefined {
  return state.apiary.hives.find((h) => h.spot === spot);
}

export function hiveById(state: GameState, id: number): HiveState | undefined {
  return state.apiary.hives.find((h) => h.id === id);
}

/** Jars waiting in every hive. */
export function honeyWaiting(state: GameState): number {
  let n = 0;
  for (const h of state.apiary.hives) n += h.honey;
  return n;
}

export function hiveIsFull(data: GameData, h: HiveState): boolean {
  return h.honey >= data.hive.store;
}

/** One cycle in whole simulated ms: shortened by Busy Bees (`animalSpeedModifier`) like the animals'. */
export function hiveCycleMs(data: GameData, speed: number): number {
  const base = data.hive.cycleSec * 1000;
  return speed > 1 ? Math.max(1, Math.round(base / speed)) : base;
}

/** Simulated ms until hive `h` makes its next jar at today's speed, or Infinity while it is full. */
export function msToNextJar(data: GameData, h: HiveState, speed: number): number {
  if (hiveIsFull(data, h)) return Infinity;
  return Math.max(0, hiveCycleMs(data, speed) - h.cycleMs);
}

/** Farming XP for `qty` jars: a quarter when the Collecting Basket took them. */
export function honeyXp(qty: number, auto: boolean): number {
  return qty * HONEY_XP * (auto ? AUTO_COLLECT_XP_SHARE : 1);
}

/** Why a hive cannot be bought right now (gold aside), or null. */
export function hiveBlock(state: GameState, data: GameData): string | null {
  if (!isUnlocked(state, data.hive.requires, data))
    return unlockHint(state, data, data.hive.requires) ?? 'Hives are not available yet.';
  if (hiveCount(state) >= hiveSpotCount()) return 'Every hive spot has a hive.';
  return null;
}

/** The `buyHive` action: a hive on the next free spot. */
export function buyHive(state: GameState, ctx: SimContext): ActionResult {
  const block = hiveBlock(state, ctx.data);
  if (block) return fail(block);
  const price = nextHivePrice(state, ctx.data)!;
  if (!canAfford(state, price)) return fail(`You need ${price.toLocaleString('en-US')}g for that.`);
  const spot = nextFreeHiveSpot(state);
  spend(state, price);
  const id = state.apiary.hives.reduce((m, h) => Math.max(m, h.id), 0) + 1;
  state.apiary.hives.push({ id, spot, honey: 0, cycleMs: 0 });
  ctx.events.push({ type: 'purchased', what: 'hive', gold: price });
  ctx.events.push({ type: 'hiveBought', id, spot });
  return OK;
}

/** Advances every hive by `dtMs` of simulated time in whole cycles (see the file header). */
export function tickApiary(state: GameState, ctx: SimContext, dtMs: number): void {
  const hives = state.apiary.hives;
  if (hives.length === 0 || dtMs <= 0) return;
  const interval = hiveCycleMs(ctx.data, ctx.mods.animalSpeedModifier);
  const cap = ctx.data.hive.store;
  let made = 0;
  for (let i = 0; i < hives.length; i++) {
    const h = hives[i]!;
    if (h.honey >= cap) {
      h.cycleMs = 0;
      continue;
    }
    const total = h.cycleMs + dtMs;
    const jars = Math.min(cap - h.honey, Math.floor(total / interval));
    h.honey += jars;
    made += jars;
    h.cycleMs = h.honey >= cap ? 0 : total - jars * interval;
  }
  if (made > 0) ctx.events.push({ type: 'honeyMade', qty: made });
}

/** Moves what fits from hive `h` to the bag (or the bin, if the Auto-Seller ships honey). Returns the jars moved. */
export function emptyHive(state: GameState, ctx: SimContext, h: HiveState, auto: boolean): number {
  if (h.honey <= 0) return 0;
  const qty = shipsAutomatically(state, ctx.data, 'honey')
    ? h.honey
    : Math.min(h.honey, spaceFor(state.inventory, 'honey'));
  const stowed = qty > 0 ? stowHarvest(state, ctx.data, 'honey', qty) : null;
  if (!stowed) {
    ctx.events.push({ type: 'inventoryFull', item: 'honey' });
    return 0;
  }
  h.honey -= qty;
  if (h.honey > 0) ctx.events.push({ type: 'inventoryFull', item: 'honey' });
  state.stats.honeyCollected += qty;
  ctx.events.push({ type: 'honeyCollected', qty, auto, shipped: stowed.bin });
  return qty;
}

/** The `collectHive` action: one hive, or every hive when `hive` (an id) is omitted. */
export function collectHive(state: GameState, ctx: SimContext, hive?: number): ActionResult {
  const hives = hive === undefined ? state.apiary.hives : [hiveById(state, hive)];
  if (hives.length === 0 || hives.some((h) => h === undefined)) return fail('There is no such hive.');
  let waiting = 0;
  for (const h of hives) waiting += h!.honey;
  if (waiting === 0) return fail('No honey yet. The bees are working on it.');
  for (const h of hives) emptyHive(state, ctx, h!, false);
  let left = 0;
  for (const h of hives) left += h!.honey;
  return left === 0 ? OK : fail('Your bag is too full to take it all.');
}

/** The Collecting Basket at a bin pickup: every jar that fits. */
export function collectAllHives(state: GameState, ctx: SimContext): number {
  let moved = 0;
  for (const h of state.apiary.hives) if (h.honey > 0) moved += emptyHive(state, ctx, h, true);
  return moved;
}
