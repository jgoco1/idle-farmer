// The Press House (GDD §13.5, BALANCE.md §14.4, DATA_SCHEMAS.md §10.4–10.8): a building on its fixed
// north-road site with 2, 3 or 4 press slots. A slot takes one drink recipe, uses its ingredients from
// the bag when started and finishes after a long timer of simulated time (20 minutes to 3 hours) that no
// modifier shortens (Quick Hands is for the stove). A finished drink waits in its slot until collected
// (a click, Collect all, or the Collecting Basket at a bin pickup); it never spoils. A slot set to
// "keep pressing" starts the same drink again when a run finishes, if the bag has the ingredients and
// the slot has room; otherwise it waits, and nothing is lost. Taking a run off gives its ingredients back.
//
// Deterministic: no RNG (the Cooking perks' ingredient saving is the stove's). Offline correctness: a
// run's remaining time counts down by `dt`; a restart reads the bag, which other systems change, so
// every finish is a step boundary (`msToNextPressFinish`) and one large step gives what many small ones do.

import type { GameState, PressSlot } from '../core/state';
import type { GameData } from '../data';
import { PRESS_SLOT_STORE } from '../data/balance';
import { DRINK_IDS, isDrinkId, type DrinkId, type RecipeId } from '../data/ids';
import type { PressLevelDef, RecipeDef } from '../data/types';
import { stowHarvest, shipsAutomatically } from './autoSeller';
import { fail, OK, type ActionResult, type SimContext } from './context';
import { isKnown, learn } from './cooking';
import { canAfford, spend } from './economy';
import { addItem, countItem, hasItems, removeItem, spaceFor } from './inventory';
import { isUnlocked, unlockHint } from './unlocks';

// ---- derived values

export function pressBuilt(state: GameState): boolean {
  return state.press.level > 0;
}

/** The current level's definition, or null before it is built. */
export function pressLevel(state: GameState, data: GameData): PressLevelDef | null {
  const level = state.press.level;
  return level > 0 ? (data.press.levels[level - 1] ?? null) : null;
}

/** Press slots the level gives. */
export function pressSlots(state: GameState, data: GameData): number {
  return pressLevel(state, data)?.slots ?? 0;
}

/** Whether `id` is a drink made in the Press House. */
export function isPressRecipe(data: GameData, id: RecipeId): id is DrinkId {
  return isDrinkId(id) && data.recipes[id].station === 'press';
}

/** Drinks the player knows, in table order (T1 first). */
export function knownDrinks(state: GameState): DrinkId[] {
  return DRINK_IDS.filter((id) => isKnown(state, id));
}

/** A run of `recipe` in simulated ms: its press time, never sped up. */
export function pressMs(recipe: RecipeDef): number {
  return Math.max(1, recipe.cookSec * 1000);
}

export function slotIsPressing(slot: PressSlot): boolean {
  return slot.remainingMs > 0;
}

/** Finished drinks waiting in every slot. */
export function drinksWaiting(state: GameState): number {
  let n = 0;
  for (const s of state.press.slots) n += s.done;
  return n;
}

/** Slots free for a new drink right now: not pressing and holding nothing finished. */
export function freePressSlots(state: GameState): number {
  let n = 0;
  for (const s of state.press.slots) if (s.remainingMs === 0 && s.done === 0) n++;
  return n;
}

/**
 * How many of `recipe` the free slots and the bag allow pressing together (Make ×N): a slot that already
 * holds finished drinks of the same recipe counts as free, since a new run joins them.
 */
export function maxPressBatch(state: GameState, recipe: RecipeDef): number {
  let n = 0;
  for (const s of state.press.slots) if (canTake(s, recipe.id)) n++;
  for (const i of recipe.ingredients) n = Math.min(n, Math.floor(countItem(state.inventory, i.item) / i.qty));
  return Math.max(0, n);
}

/** The slot a new run of `id` goes in: one already holding that drink (with room) first, else the first free one; -1 if none. */
export function pressSlotFor(state: GameState, id: RecipeId): number {
  const slots = state.press.slots;
  for (let i = 0; i < slots.length; i++) if (slots[i]!.done > 0 && canTake(slots[i]!, id)) return i;
  for (let i = 0; i < slots.length; i++) if (canTake(slots[i]!, id)) return i;
  return -1;
}

/** Whether slot `s` can start a run of `id`: idle, and empty or already holding that drink with room. */
function canTake(s: PressSlot, id: RecipeId): boolean {
  return s.remainingMs === 0 && (s.done === 0 || (s.recipe === id && s.done < PRESS_SLOT_STORE));
}

function emptySlot(): PressSlot {
  return { recipe: null, remainingMs: 0, done: 0, repeat: false };
}

// ---- building and upgrading

/** Why the Press House cannot be built or upgraded right now (gold aside), or null. */
export function pressBlock(state: GameState, data: GameData): string | null {
  const def = data.press;
  if (state.press.level >= def.levels.length) return `The ${def.name} is fully upgraded.`;
  if (!isUnlocked(state, def.requires, data))
    return unlockHint(state, data, def.requires) ?? `The ${def.name} is not available yet.`;
  return null;
}

/** The price of the next level, or null when fully upgraded. */
export function nextPressPrice(state: GameState, data: GameData): number | null {
  return data.press.levels[state.press.level]?.price ?? null;
}

function buyLevel(state: GameState, ctx: SimContext): ActionResult {
  const block = pressBlock(state, ctx.data);
  if (block) return fail(block);
  const next = ctx.data.press.levels[state.press.level]!;
  if (!canAfford(state, next.price)) return fail(`You need ${next.price.toLocaleString('en-US')}g for that.`);
  spend(state, next.price);
  state.press.level += 1;
  while (state.press.slots.length < next.slots) state.press.slots.push(emptySlot());
  ctx.events.push({ type: 'purchased', what: 'press', gold: next.price });
  return OK;
}

/** Builds level 1: the two starter drinks are learned with it (`discovery: press`). */
export function buildPress(state: GameState, ctx: SimContext): ActionResult {
  if (pressBuilt(state)) return fail(`The ${ctx.data.press.name} is already built.`);
  const r = buyLevel(state, ctx);
  if (r.ok) {
    for (const id of DRINK_IDS)
      if (ctx.data.recipes[id].discovery.kind === 'press') learn(state, ctx, id, 'press');
    ctx.events.push({ type: 'pressBuilt', level: 1 });
  }
  return r;
}

export function upgradePress(state: GameState, ctx: SimContext): ActionResult {
  if (!pressBuilt(state)) return fail(`Build the ${ctx.data.press.name} first.`);
  const r = buyLevel(state, ctx);
  if (r.ok) ctx.events.push({ type: 'pressUpgraded', level: state.press.level });
  return r;
}

// ---- pressing

function slotAt(state: GameState, slot: number): PressSlot | undefined {
  return Number.isInteger(slot) ? state.press.slots[slot] : undefined;
}

/** The `startPress` action: a known drink in slot `slot`, using its ingredients from the bag. */
export function startPress(
  state: GameState,
  ctx: SimContext,
  slot: number,
  id: RecipeId,
  repeat?: boolean,
): ActionResult {
  if (!pressBuilt(state)) return fail(`Build the ${ctx.data.press.name} first.`);
  const s = slotAt(state, slot);
  if (!s) return fail('There is no such press.');
  const recipe = ctx.data.recipes[id];
  if (!recipe || !isPressRecipe(ctx.data, id)) return fail('Only drinks go in the press.');
  if (!isKnown(state, id)) return fail(`You haven't learned ${recipe.name} yet.`);
  if (s.remainingMs > 0) return fail('That press is busy. Wait for it to finish, or take the run off.');
  if (s.done > 0 && s.recipe !== id) {
    const held = ctx.data.recipes[s.recipe!]?.name ?? 'a drink';
    return fail(`Collect the ${held} from that press first.`);
  }
  if (s.done >= PRESS_SLOT_STORE) return fail('That press is full of finished drinks. Collect them first.');
  if (!hasItems(state.inventory, recipe.ingredients))
    return fail(`You don't have everything for ${recipe.name}.`);
  take(state, recipe);
  s.recipe = id;
  s.remainingMs = pressMs(recipe);
  if (repeat !== undefined) s.repeat = repeat === true;
  return OK;
}

/** Plain ingredients first (a hearty dish is never an ingredient, but keep the bag's choice predictable). */
function take(state: GameState, recipe: RecipeDef): void {
  for (const i of recipe.ingredients) removeItem(state.inventory, i.item, i.qty);
}

/** The `setPressRepeat` action: "keep pressing" on or off for a slot. */
export function setPressRepeat(
  state: GameState,
  ctx: SimContext,
  slot: number,
  repeat: boolean,
): ActionResult {
  if (!pressBuilt(state)) return fail(`Build the ${ctx.data.press.name} first.`);
  const s = slotAt(state, slot);
  if (!s) return fail('There is no such press.');
  s.repeat = repeat === true;
  return OK;
}

/** The `cancelPress` action: takes a run off the press and gives its ingredients back. */
export function cancelPress(state: GameState, ctx: SimContext, slot: number): ActionResult {
  const s = slotAt(state, slot);
  if (!s) return fail('There is no such press.');
  if (s.remainingMs <= 0 || s.recipe === null) return fail('That press is not pressing anything.');
  const recipe = ctx.data.recipes[s.recipe];
  const scratch = structuredClone(state.inventory);
  for (const i of recipe.ingredients)
    if (!addItem(scratch, i.item, i.qty)) return fail('Your bag has no room for the ingredients.');
  for (const i of recipe.ingredients) addItem(state.inventory, i.item, i.qty);
  s.remainingMs = 0;
  s.repeat = false; // taking it off means "stop"
  if (s.done === 0) s.recipe = null;
  return OK;
}

/** How many of `qty` finished drinks of `id` can leave a slot now: all if they ship automatically, else what fits. */
function movable(state: GameState, data: GameData, id: RecipeId, qty: number): number {
  if (shipsAutomatically(state, data, id)) return qty;
  return Math.min(qty, spaceFor(state.inventory, id));
}

/** Moves what fits from slot `s` to the bag (or the bin). Returns the number moved. */
export function emptyPressSlot(state: GameState, ctx: SimContext, s: PressSlot, auto: boolean): number {
  if (s.done <= 0 || s.recipe === null) return 0;
  const id = s.recipe;
  const qty = movable(state, ctx.data, id, s.done);
  const stowed = qty > 0 ? stowHarvest(state, ctx.data, id, qty) : null;
  if (!stowed) {
    ctx.events.push({ type: 'inventoryFull', item: id });
    return 0;
  }
  s.done -= qty;
  if (s.done > 0) ctx.events.push({ type: 'inventoryFull', item: id });
  ctx.events.push({ type: 'pressCollected', recipe: id, qty, auto, shipped: stowed.bin });
  return qty;
}

/** The `collectPress` action: one slot, or every slot when `slot` is omitted. */
export function collectPress(state: GameState, ctx: SimContext, slot?: number): ActionResult {
  if (!pressBuilt(state)) return fail(`Build the ${ctx.data.press.name} first.`);
  const slots = slot === undefined ? state.press.slots : [slotAt(state, slot)];
  if (slots.some((s) => s === undefined)) return fail('There is no such press.');
  let waiting = 0;
  for (const s of slots) waiting += s!.done;
  if (waiting === 0) return fail('Nothing has finished pressing yet.');
  for (const s of slots) emptyPressSlot(state, ctx, s!, false);
  let left = 0;
  for (const s of slots) left += s!.done;
  return left === 0 ? OK : fail('Your bag is too full to take it all.');
}

/** The Collecting Basket at a bin pickup: every finished drink that fits. */
export function collectAllPresses(state: GameState, ctx: SimContext): number {
  let moved = 0;
  for (const s of state.press.slots) if (s.done > 0) moved += emptyPressSlot(state, ctx, s, true);
  return moved;
}

/**
 * Advances every press by `dtMs` of simulated time. A run that finishes adds its drink to the slot; a
 * "keep pressing" slot then starts again from the bag (exact even if `dtMs` runs past the finish, though
 * the core splits steps there because the bag may change in between).
 */
export function tickPress(state: GameState, ctx: SimContext, dtMs: number): void {
  const slots = state.press.slots;
  if (slots.length === 0 || dtMs <= 0) return;
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i]!;
    let left = dtMs;
    while (s.remainingMs > 0 && left > 0 && s.recipe !== null) {
      const used = Math.min(left, s.remainingMs);
      s.remainingMs -= used;
      left -= used;
      if (s.remainingMs > 0) break;
      const recipe = ctx.data.recipes[s.recipe];
      s.done += 1;
      state.stats.drinksPressed += 1;
      ctx.events.push({ type: 'drinkPressed', recipe: s.recipe, slot: i, tier: recipe.tier, auto: s.repeat });
      if (!s.repeat) break;
      if (s.done >= PRESS_SLOT_STORE) {
        ctx.events.push({ type: 'pressStopped', recipe: s.recipe, slot: i, reason: 'full' });
        break;
      }
      if (!hasItems(state.inventory, recipe.ingredients)) {
        ctx.events.push({ type: 'pressStopped', recipe: s.recipe, slot: i, reason: 'ingredients' });
        break;
      }
      take(state, recipe);
      s.remainingMs = pressMs(recipe);
    }
  }
}

/** Simulated ms until the next press run finishes, or Infinity (a restart reads the bag: a step boundary). */
export function msToNextPressFinish(state: GameState): number {
  let ms = Infinity;
  for (const s of state.press.slots) if (s.remainingMs > 0 && s.remainingMs < ms) ms = s.remainingMs;
  return ms;
}

/**
 * Restarts "keep pressing" slots that stopped for want of ingredients or room. Run by the Collecting
 * Basket at each bin pickup (a step boundary while the basket exists), after it has emptied the slots.
 */
export function resumeRepeating(state: GameState, ctx: SimContext): void {
  for (const s of state.press.slots) {
    if (!s.repeat || s.remainingMs > 0 || s.recipe === null || s.done >= PRESS_SLOT_STORE) continue;
    const recipe = ctx.data.recipes[s.recipe];
    if (!hasItems(state.inventory, recipe.ingredients)) continue;
    take(state, recipe);
    s.remainingMs = pressMs(recipe);
  }
}

/** Ingredients the bag has for `recipe`, as whole runs. */
export function runsInBag(state: GameState, recipe: RecipeDef): number {
  let n = Infinity;
  for (const i of recipe.ingredients) n = Math.min(n, Math.floor(countItem(state.inventory, i.item) / i.qty));
  return Number.isFinite(n) ? n : 0;
}

// ---- the shelf

/** The `buyCocoa` action: cocoa beans from the Press House shelf (not sellable; for Hot Cocoa in any season). */
export function buyCocoa(state: GameState, ctx: SimContext, qty: number): ActionResult {
  if (!pressBuilt(state)) return fail(`Build the ${ctx.data.press.name} first.`);
  if (!Number.isInteger(qty) || qty <= 0) return fail('Choose how many to buy.');
  const price = qty * ctx.data.press.shelf.cocoa;
  if (!canAfford(state, price)) return fail(`You need ${price.toLocaleString('en-US')}g for that.`);
  if (spaceFor(state.inventory, 'cocoa') < qty) return fail('Your bag has no room for that much cocoa.');
  spend(state, price);
  addItem(state.inventory, 'cocoa', qty);
  ctx.events.push({ type: 'purchased', what: 'cocoa', gold: price });
  return OK;
}

/** Drink recipe cards the player does not know yet, cheapest first (sold in the Press House panel). */
export function drinkCards(
  state: GameState,
  data: GameData,
): { id: DrinkId; price: number; unlocked: boolean; hint: string | null }[] {
  const out: { id: DrinkId; price: number; unlocked: boolean; hint: string | null }[] = [];
  for (const id of DRINK_IDS) {
    const d = data.recipes[id].discovery;
    if (d.kind !== 'card' || isKnown(state, id)) continue;
    const unlocked = isUnlocked(state, d.unlock, data);
    out.push({ id, price: d.price, unlocked, hint: unlocked ? null : unlockHint(state, data, d.unlock) });
  }
  return out.sort((a, b) => a.price - b.price);
}
