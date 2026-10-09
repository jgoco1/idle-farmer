// The North Woods' forage spots (GDD §13.7, BALANCE.md §14.7, DATA_SCHEMAS.md §10.5). Eight spots on the
// woods floor regrow wild things on **calendar days**, like the orchard's trees: at each 06:00 refresh a
// spot whose kind has an item this season gains that item's day's yield, up to FORAGE_CAP_DAYS days'
// worth (one more with the Forager bundle). Days missed while away are counted exactly (`growForage`
// walks every day since a spot's `lastDay`), so one big jump gives the same as a refresh each day.
//
// Nothing is lost: a spot left alone stops at its cap, and when the season turns to a different item an
// unpicked spot keeps what it has (without growing) until it is picked; the new season's item starts the
// next day. A spot whose kind has nothing this season rests. The woods open with the North Fields
// (the road there runs past them); spots are created then, with one day's growth so the first visit
// finds something. Picking is by hand, or by the Forager's Basket at each Shipping Bin pickup.

import type { ForageSpotState, GameState } from '../core/state';
import { seasonOfDay } from '../core/time';
import type { GameData } from '../data';
import { AUTO_COLLECT_XP_SHARE, FORAGE_CAP_DAYS } from '../data/balance';
import type { ForageId, ForageKind, SeasonId } from '../data/ids';
import type { ForageSeasonYield } from '../data/types';
import { WORLD_LAYOUT } from '../data/world';
import { shipsAutomatically, stowHarvest } from './autoSeller';
import { bundleBonuses } from './bundles';
import { fail, OK, type ActionResult, type SimContext } from './context';
import { spaceFor } from './inventory';
import { ownsParcel } from './parcels';
import { hasFlag } from './upgrades';

/** Whether the North Woods are open: they open with the North Fields (GDD §13.7). */
export function woodsOpen(state: GameState): boolean {
  return ownsParcel(state, 'north_fields');
}

export function forageSpotCount(): number {
  return WORLD_LAYOUT.forageSpots.length;
}

export function spotKind(data: GameData, spot: number): ForageKind {
  return data.forage.spotKinds[spot]!;
}

/** What spot `spot` grows in `season`, or null (it rests). */
export function spotYield(data: GameData, spot: number, season: SeasonId): ForageSeasonYield {
  return data.forage.kinds[spotKind(data, spot)][season];
}

/** Days' worth a spot holds: FORAGE_CAP_DAYS, plus the Forager bundle's day. */
export function forageCapDays(state: GameState, data: GameData): number {
  return FORAGE_CAP_DAYS + bundleBonuses(state, data).forageCapDays;
}

/** The most of `item` spot `spot` can hold (its days' worth of the item's daily yield in its kind). */
export function forageCap(state: GameState, data: GameData, spot: number, item: ForageId): number {
  const kind = data.forage.kinds[spotKind(data, spot)];
  let perDay = 0;
  for (const s of ['spring', 'summer', 'autumn', 'winter'] as const) {
    const y = kind[s];
    if (y && y.item === item) perDay = Math.max(perDay, y.perDay);
  }
  return forageCapDays(state, data) * perDay;
}

/**
 * Grows one spot through every calendar day in (lastDay, today]. A day adds its yield when the spot
 * holds nothing or already holds that item; the cap uses that day's yield. Returns what grew.
 */
function growSpot(ctx: SimContext, s: ForageSpotState, today: number, capDays: number): number {
  let grew = 0;
  for (let d = s.lastDay + 1; d <= today; d++) {
    const y = spotYield(ctx.data, s.spot, seasonOfDay(ctx.calendar, d));
    if (!y) continue;
    if (s.qty > 0 && s.item !== y.item) continue; // last season's find waits to be picked; nothing is lost
    const cap = capDays * y.perDay;
    const next = Math.max(s.qty, Math.min(cap, s.qty + y.perDay));
    if (s.item !== y.item) s.item = y.item;
    grew += next - s.qty;
    s.qty = next;
  }
  s.lastDay = Math.max(s.lastDay, today);
  return grew;
}

/**
 * Opens the woods if the North Fields are owned and the spots do not exist yet: one spot per layout
 * entry, grown for today. Idempotent; called when the North Fields are bought, at each refresh and
 * when a save is loaded (a save that owned the fields before v4-04).
 */
export function openWoods(state: GameState, ctx: SimContext): boolean {
  if (!woodsOpen(state) || state.forage.spots.length > 0) return false;
  const today = ctx.calendar.dayIndex;
  for (let spot = 0; spot < forageSpotCount(); spot++)
    state.forage.spots.push({ spot, item: null, qty: 0, lastDay: today - 1 });
  ctx.events.push({ type: 'woodsOpened' });
  growForage(state, ctx);
  return true;
}

/** The 06:00 refresh for the woods (from `onDayStarted`, like `growOrchard`). */
export function growForage(state: GameState, ctx: SimContext): void {
  if (state.forage.spots.length === 0) {
    if (woodsOpen(state)) openWoods(state, ctx);
    return;
  }
  const today = ctx.calendar.dayIndex;
  const capDays = forageCapDays(state, ctx.data);
  let grownItem: ForageId | null = null;
  let grownQty = 0;
  for (const s of state.forage.spots) {
    if (today <= s.lastDay) continue;
    const grew = growSpot(ctx, s, today, capDays);
    if (grew <= 0 || !s.item) continue;
    if (grownItem !== null && grownItem !== s.item) {
      ctx.events.push({ type: 'forageGrown', item: grownItem, qty: grownQty });
      grownQty = 0;
    }
    grownItem = s.item;
    grownQty += grew;
  }
  if (grownItem !== null && grownQty > 0)
    ctx.events.push({ type: 'forageGrown', item: grownItem, qty: grownQty });
}

export function forageSpot(state: GameState, spot: number): ForageSpotState | undefined {
  return state.forage.spots.find((s) => s.spot === spot);
}

/** Spots with something to pick (the edge pips, the toolbar, the brain). */
export function ripeForageSpots(state: GameState): ForageSpotState[] {
  return state.forage.spots.filter((s) => s.qty > 0);
}

/** Forage items waiting in the woods. */
export function forageWaiting(state: GameState): number {
  let n = 0;
  for (const s of state.forage.spots) n += s.qty;
  return n;
}

/** Farming XP for `qty` of `item`: a quarter when the Forager's Basket picked it. */
export function forageXp(data: GameData, item: ForageId, qty: number, auto: boolean): number {
  return qty * data.forage.items[item].xp * (auto ? AUTO_COLLECT_XP_SHARE : 1);
}

/** Moves what fits from spot `s` to the bag (or the bin, if the Auto-Seller ships it). Returns the quantity moved. */
function pickSpot(state: GameState, ctx: SimContext, s: ForageSpotState, auto: boolean): number {
  const item = s.item;
  if (!item || s.qty <= 0) return 0;
  const qty = shipsAutomatically(state, ctx.data, item)
    ? s.qty
    : Math.min(s.qty, spaceFor(state.inventory, item));
  const stowed = qty > 0 ? stowHarvest(state, ctx.data, item, qty) : null;
  if (!stowed) {
    ctx.events.push({ type: 'inventoryFull', item });
    return 0;
  }
  s.qty -= qty;
  if (s.qty > 0) ctx.events.push({ type: 'inventoryFull', item });
  else s.item = null;
  state.stats.foraged += qty;
  ctx.events.push({ type: 'foragePicked', item, qty, spot: s.spot, auto, shipped: stowed.bin });
  return qty;
}

/** The `pickForage` action: click a spot to pick what is waiting. */
export function pickForage(state: GameState, ctx: SimContext, spot: number): ActionResult {
  if (!woodsOpen(state)) return fail('The North Woods open with the North Fields.');
  const s = forageSpot(state, spot);
  if (!s) return fail('There is nothing to pick there.');
  if (s.qty <= 0 || !s.item) return fail(restingReason(ctx, spot));
  const moved = pickSpot(state, ctx, s, false);
  if (moved <= 0) return fail('Your bag is full. It will wait here.');
  return s.qty > 0 ? fail('Your bag is too full to take it all.') : OK;
}

function restingReason(ctx: SimContext, spot: number): string {
  if (!spotYield(ctx.data, spot, ctx.calendar.season))
    return 'Nothing grows here this season. Try again when it turns.';
  return 'Picked clean. More grows by 6:00 tomorrow.';
}

/** The Forager's Basket at a bin pickup: every spot, what fits. Returns the items moved. */
export function pickAllForage(state: GameState, ctx: SimContext): number {
  let moved = 0;
  for (const s of state.forage.spots) if (s.qty > 0) moved += pickSpot(state, ctx, s, true);
  return moved;
}

/** Whether the Forager's Basket has been bought. */
export function hasForagerBasket(state: GameState, data: GameData): boolean {
  return hasFlag(state, data, 'forager_basket', 'autoForage');
}

/** Whether any spot grows `item` in `season` (recipes and goals ask whether an ingredient can be had). */
export function forageInSeason(data: GameData, item: ForageId, season: SeasonId): boolean {
  for (const kind of data.forage.spotKinds) if (data.forage.kinds[kind][season]?.item === item) return true;
  return false;
}
