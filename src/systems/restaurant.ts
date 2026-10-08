// The restaurant, The Bramble Table (GDD §13.4, BALANCE.md §14.3, DATA_SCHEMAS.md §10.4–10.8). A building
// on its fixed north-road site with 2, 3 or 4 menu slots (a fifth with the Press House bundle). Each slot
// holds a stack of one dish or (v4-03) drink and serves one of it every SERVE_MIN_PER_TIER minutes × the dish's tier of simulated
// time. A serving pays base price × the level's premium (+ the day's special), capped at
// RESTAURANT_MAX_MULT × base, straight to the purse: guests are not the Market, so demand, specials,
// Silver Tongue and the winter dish bonus are never read or touched.
//
// Gentle: an empty slot does nothing, a dish on the menu waits forever, nothing spoils, and clearing a
// slot gives everything back. Deterministic: no RNG; the special is a calendar fact (`specialOn`).
//
// Offline correctness: servings are `floor((cycleMs + dt) / interval)` per slot, and nothing changes an
// interval or a price inside a step (levels and stock change only through actions, which are step
// boundaries, and the calendar is fixed for a step), so one large step gives exactly what many small
// ones do and the restaurant does not report to `msToNextSimEvent`.

import type { GameState, MenuSlot } from '../core/state';
import { SEASONS, seasonOfDay, weekdayOfDay, type Calendar } from '../core/time';
import type { GameData } from '../data';
import { MENU_SLOT_CAP, RESTAURANT_MAX_MULT, SERVE_MIN_PER_TIER, SPECIAL_BONUS } from '../data/balance';
import { isDishId, isDrinkId, isRecipeId, type ItemId, type RecipeId, type RecipeTier } from '../data/ids';
import type { RestaurantLevelDef } from '../data/types';
import { fail, OK, type ActionResult, type SimContext } from './context';
import { bundleBonuses } from './bundles';
import { canAfford, earn, spend } from './economy';
import { addItem, countItem, removeItem, spaceFor } from './inventory';
import { isUnlocked, unlockHint } from './unlocks';

// ---- derived values

export function restaurantBuilt(state: GameState): boolean {
  return state.restaurant.level > 0;
}

/** The current level's definition, or null before it is built. */
export function restaurantLevel(state: GameState, data: GameData): RestaurantLevelDef | null {
  const level = state.restaurant.level;
  return level > 0 ? (data.restaurant.levels[level - 1] ?? null) : null;
}

/** Menu slots the level gives, plus the Press House bundle's fifth table (v4-03). */
export function menuSlots(state: GameState, data: GameData): number {
  const level = restaurantLevel(state, data);
  return level ? level.slots + bundleBonuses(state, data).menuSlots : 0;
}

/** Whether `item` can go on the menu: a dish or (v4-03) a drink. */
export function isMenuable(data: GameData, item: ItemId): boolean {
  const category = data.items[item]?.category;
  return (isDishId(item) && category === 'dish') || (isDrinkId(item) && category === 'drink');
}

/** The tier that sets a menu item's serving time: its recipe's (a drink's too). */
export function menuTier(data: GameData, item: ItemId): RecipeTier {
  return isRecipeId(item) ? data.recipes[item].tier : 1;
}

/** Simulated ms between servings of `item`: SERVE_MIN_PER_TIER minutes × its tier. */
export function serveIntervalMs(data: GameData, item: ItemId): number {
  return SERVE_MIN_PER_TIER * 60_000 * menuTier(data, item);
}

/**
 * The Chef's special on day index `d`: the rota entry for that day's season and weekday (Sunday first),
 * so a seasonal dish is the special in its own season's week. A calendar fact, never a draw: next
 * Thursday's special can be read today.
 */
export function specialOn(data: GameData, cal: Pick<Calendar, 'dayZero' | 'epochWeek'>, d: number): RecipeId {
  const rota = data.restaurant.specialRota;
  const season = SEASONS.indexOf(seasonOfDay(cal, d));
  return rota[(season * 7 + weekdayOfDay(cal.dayZero + d)) % rota.length]!;
}

/** Today's special, if the player knows that recipe (otherwise there is simply none today). */
export function todaysSpecial(state: GameState, data: GameData, cal: Calendar): RecipeId | null {
  const id = specialOn(data, cal, cal.dayIndex);
  return state.kitchen.known.includes(id) ? id : null;
}

/** The gold one serving of `item` earns now: base × (premium + special), capped, rounded. */
export function servingPrice(
  state: GameState,
  data: GameData,
  item: ItemId,
  special: RecipeId | null,
): number {
  const level = restaurantLevel(state, data);
  const base = data.items[item]?.basePrice ?? 0;
  if (!level || base <= 0) return 0;
  const mult = Math.min(RESTAURANT_MAX_MULT, level.premium + (item === special ? SPECIAL_BONUS : 0));
  return Math.round(base * mult);
}

/** Simulated ms until slot `slot` next serves, or Infinity when it is empty (for the panel and labels). */
export function msToNextServing(data: GameData, slot: MenuSlot): number {
  if (slot.item === null || slot.qty <= 0) return Infinity;
  return Math.max(0, serveIntervalMs(data, slot.item) - slot.cycleMs);
}

/** Servings an hour of simulated time the menu as it stands would give (empty slots count as a T2 dish). */
export function servingsPerHour(state: GameState, data: GameData): number {
  let n = 0;
  for (const s of state.restaurant.menu)
    n += 60 / (SERVE_MIN_PER_TIER * (s.item ? menuTier(data, s.item) : 2));
  return n;
}

export function menuItemsWaiting(state: GameState): number {
  let n = 0;
  for (const s of state.restaurant.menu) n += s.qty;
  return n;
}

/** A slot that has served everything it held (it remembers its dish for Restock). */
export function slotIsEmpty(slot: MenuSlot): boolean {
  return slot.qty <= 0;
}

function emptySlot(): MenuSlot {
  return { item: null, qty: 0, hearty: false, cycleMs: 0 };
}

// ---- building and upgrading

/** Why the restaurant cannot be built or upgraded right now (gold aside), or null. */
export function restaurantBlock(state: GameState, data: GameData): string | null {
  const def = data.restaurant;
  if (state.restaurant.level >= def.levels.length) return `${def.name} is fully upgraded.`;
  if (!isUnlocked(state, def.requires, data))
    return unlockHint(state, data, def.requires) ?? `${def.name} is not available yet.`;
  return null;
}

/** The price of the next level, or null when fully upgraded. */
export function nextRestaurantPrice(state: GameState, data: GameData): number | null {
  return data.restaurant.levels[state.restaurant.level]?.price ?? null;
}

function buyLevel(state: GameState, ctx: SimContext): ActionResult {
  const block = restaurantBlock(state, ctx.data);
  if (block) return fail(block);
  const next = ctx.data.restaurant.levels[state.restaurant.level]!;
  if (!canAfford(state, next.price)) return fail(`You need ${next.price.toLocaleString('en-US')}g for that.`);
  spend(state, next.price);
  state.restaurant.level += 1;
  const slots = menuSlots(state, ctx.data);
  while (state.restaurant.menu.length < slots) state.restaurant.menu.push(emptySlot());
  ctx.events.push({ type: 'purchased', what: 'restaurant', gold: next.price });
  return OK;
}

export function buildRestaurant(state: GameState, ctx: SimContext): ActionResult {
  if (restaurantBuilt(state)) return fail(`${ctx.data.restaurant.name} is already open.`);
  const r = buyLevel(state, ctx);
  if (r.ok) {
    state.restaurant.today = { day: ctx.calendar.dayIndex, gold: 0, served: 0 };
    ctx.events.push({ type: 'restaurantBuilt', level: 1 });
  }
  return r;
}

export function upgradeRestaurant(state: GameState, ctx: SimContext): ActionResult {
  if (!restaurantBuilt(state)) return fail(`Build ${ctx.data.restaurant.name} first.`);
  const r = buyLevel(state, ctx);
  if (r.ok) ctx.events.push({ type: 'restaurantUpgraded', level: state.restaurant.level });
  return r;
}

// ---- the menu

function slotAt(state: GameState, slot: number): MenuSlot | undefined {
  return Number.isInteger(slot) ? state.restaurant.menu[slot] : undefined;
}

/** How many more of `item` (that stack kind) slot `slot` can take from the bag right now. */
export function stockable(state: GameState, slot: MenuSlot, item: ItemId, hearty: boolean): number {
  if (slot.item !== null && slot.qty > 0 && (slot.item !== item || slot.hearty !== hearty)) return 0;
  return Math.min(
    MENU_SLOT_CAP - (slot.item === item && slot.hearty === hearty ? slot.qty : 0),
    countItem(state.inventory, item, hearty),
  );
}

/**
 * Puts `qty` of `item` (plain or hearty) from the bag on slot `slot`. All or nothing. A slot holds one
 * kind at a time: it takes more of what it serves, or anything once it has run out.
 */
export function stockMenu(
  state: GameState,
  ctx: SimContext,
  slot: number,
  item: ItemId,
  qty: number,
  hearty = false,
): ActionResult {
  if (!restaurantBuilt(state)) return fail(`Build ${ctx.data.restaurant.name} first.`);
  const s = slotAt(state, slot);
  if (!s) return fail('There is no such table.');
  const def = ctx.data.items[item];
  if (!def || !isMenuable(ctx.data, item)) return fail('Only dishes and drinks go on the menu.');
  if (!Number.isInteger(qty) || qty <= 0) return fail('Choose how many to put on the menu.');
  const kind = hearty === true;
  const name = kind ? `hearty ${def.name}` : def.name;
  if (s.qty > 0 && (s.item !== item || s.hearty !== kind)) {
    const held = ctx.data.items[s.item!]?.name ?? 'something else';
    return fail(`That table is serving ${s.hearty ? `hearty ${held}` : held}. Clear it first.`);
  }
  const room = MENU_SLOT_CAP - s.qty;
  if (qty > room)
    return fail(room === 0 ? 'That table is full.' : `That table only has room for ${room} more.`);
  if (countItem(state.inventory, item, kind) < qty) return fail(`You don't have ${qty} ${name}.`);
  removeItem(state.inventory, item, qty, kind);
  if (s.item !== item || s.hearty !== kind) s.cycleMs = 0;
  s.item = item;
  s.hearty = kind;
  s.qty += qty;
  return OK;
}

/** Tops every slot up from the bag with what it already serves. Fails (changing nothing) if nothing moved. */
export function restockMenu(state: GameState, ctx: SimContext): ActionResult {
  if (!restaurantBuilt(state)) return fail(`Build ${ctx.data.restaurant.name} first.`);
  let moved = 0;
  for (const s of state.restaurant.menu) {
    if (s.item === null) continue;
    const n = Math.min(MENU_SLOT_CAP - s.qty, countItem(state.inventory, s.item, s.hearty));
    if (n <= 0) continue;
    removeItem(state.inventory, s.item, n, s.hearty);
    s.qty += n;
    moved += n;
  }
  return moved > 0 ? OK : fail('Nothing to restock: the bag has none of what the menu serves.');
}

/** Puts a slot's stack back in the bag and frees the table. Refused (changing nothing) if it does not fit. */
export function clearMenuSlot(state: GameState, ctx: SimContext, slot: number): ActionResult {
  if (!restaurantBuilt(state)) return fail(`Build ${ctx.data.restaurant.name} first.`);
  const s = slotAt(state, slot);
  if (!s) return fail('There is no such table.');
  if (s.item === null) return fail('That table is already clear.');
  if (s.qty > 0) {
    if (spaceFor(state.inventory, s.item, s.hearty) < s.qty) {
      const name = ctx.data.items[s.item]?.name ?? s.item;
      return fail(`Your bag has no room for ${s.qty} ${name}. Make a little space first.`);
    }
    addItem(state.inventory, s.item, s.qty, s.hearty);
  }
  state.restaurant.menu[slot] = emptySlot();
  return OK;
}

// ---- serving

/**
 * Advances every menu slot by `dtMs` of simulated time (see the file header): whole servings, paid at the
 * level's premium plus the day's special, batched into one `served` event per slot.
 */
export function tickRestaurant(state: GameState, ctx: SimContext, dtMs: number): void {
  const r = state.restaurant;
  if (r.level <= 0 || dtMs <= 0) return;
  let special: RecipeId | null | undefined;
  for (let i = 0; i < r.menu.length; i++) {
    const s = r.menu[i]!;
    if (s.item === null || s.qty <= 0) continue;
    const interval = serveIntervalMs(ctx.data, s.item);
    const total = s.cycleMs + dtMs;
    const servings = Math.min(s.qty, Math.floor(total / interval));
    if (servings >= s.qty) {
      s.qty = 0;
      s.cycleMs = 0; // an emptied slot starts from zero when restocked
    } else {
      s.qty -= servings;
      s.cycleMs = total - servings * interval;
    }
    if (servings > 0) {
      if (special === undefined) special = todaysSpecial(state, ctx.data, ctx.calendar);
      const gold = servings * servingPrice(state, ctx.data, s.item, special);
      earn(state, ctx, gold, 'restaurant');
      state.stats.restaurantGold += gold;
      state.stats.served += servings;
      r.today.gold += gold;
      r.today.served += servings;
      ctx.events.push({
        type: 'served',
        item: s.item,
        qty: servings,
        gold,
        slot: i,
        special: s.item === special,
      });
    }
    if (s.qty === 0) ctx.events.push({ type: 'menuEmpty', slot: i, item: s.item });
  }
}

/** The 06:00 refresh: today's takings start again. */
export function openRestaurantDay(state: GameState, ctx: Pick<SimContext, 'calendar'>): void {
  state.restaurant.today = { day: ctx.calendar.dayIndex, gold: 0, served: 0 };
}
