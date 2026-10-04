// Cooking (GDD §6.5, BALANCE.md §7): the recipe book, the stove, recipe discovery and the tier
// formula. Dishes cook in simulated time, all the jobs on the stove at once (the kitchen upgrade
// adds stove slots and speed), so cooking continues offline. A dish that finishes in winter is
// hearty. A finished dish that does not fit in the bag waits on the stove; nothing is ever lost.

import type { GameState } from '../core/state';
import type { GameData } from '../data';
import {
  EXPERIMENT_MAX_ITEMS,
  EXPERIMENT_MIN_ITEMS,
  TIER_COOK_DIV,
  TIER_THRESHOLDS,
  TIER_VALUE_DIV,
} from '../data/balance';
import { RECIPE_IDS, type ItemId, type RecipeId, type RecipeTier } from '../data/ids';
import type { ItemDef, RecipeDef } from '../data/types';
import { fail, OK, type ActionResult, type SimContext } from './context';
import { canAfford, spend } from './economy';
import { addItem, countItem, hasItems, removeItem } from './inventory';
import { effectOf } from './upgrades';
import { isUnlocked, unlockHint } from './unlocks';

// ---- tier

/** Sum of the ingredients' market base prices. */
export function ingredientValue(
  recipe: RecipeDef,
  items: Readonly<Partial<Record<ItemId, ItemDef>>>,
): number {
  return recipe.ingredients.reduce((v, i) => v + i.qty * (items[i.item]?.basePrice ?? 0), 0);
}

/** `units + value / 50 + cookSec / 30` (BALANCE.md §7). */
export function recipeScore(recipe: RecipeDef, items: Readonly<Partial<Record<ItemId, ItemDef>>>): number {
  const units = recipe.ingredients.reduce((n, i) => n + i.qty, 0);
  return units + ingredientValue(recipe, items) / TIER_VALUE_DIV + recipe.cookSec / TIER_COOK_DIV;
}

/** The tier a recipe's inputs work out to: never declared by hand. */
export function recipeTier(recipe: RecipeDef, items: Readonly<Partial<Record<ItemId, ItemDef>>>): RecipeTier {
  const score = recipeScore(recipe, items);
  const [t2, t3, t4] = TIER_THRESHOLDS;
  return score >= t4 ? 4 : score >= t3 ? 3 : score >= t2 ? 2 : 1;
}

// ---- the recipe book

export function isKnown(state: GameState, id: RecipeId): boolean {
  return state.kitchen.known.includes(id);
}

/** Recipes the player knows, in table order (T1 first). */
export function knownRecipes(state: GameState): RecipeId[] {
  return RECIPE_IDS.filter((id) => isKnown(state, id));
}

/** How many dishes can be on the stove at once. */
export function kitchenSlots(state: GameState, data: GameData): number {
  return effectOf(state, data, 'kitchen')?.capacity ?? 1;
}

/** Have/need for each ingredient of `recipe` in the bag. */
export function ingredientStatus(
  state: GameState,
  recipe: RecipeDef,
): { item: ItemId; have: number; need: number }[] {
  return recipe.ingredients.map((i) => ({
    item: i.item,
    have: countItem(state.inventory, i.item, false),
    need: i.qty,
  }));
}

export function canCook(state: GameState, recipe: RecipeDef): boolean {
  return hasItems(state.inventory, recipe.ingredients);
}

/**
 * How many of `recipe` the stove and the bag allow cooking together (Cook ×N): the free stove slots, and as many
 * as the ingredients in the bag cover. Without the ingredient-save perk this is exact; with it a batch can need a
 * little less, never more.
 */
export function maxBatch(state: GameState, data: GameData, recipe: RecipeDef): number {
  const free = Math.max(0, kitchenSlots(state, data) - state.kitchen.queue.length);
  let n = free;
  for (const i of recipe.ingredients) n = Math.min(n, Math.floor(countItem(state.inventory, i.item) / i.qty));
  return Math.max(0, n);
}

/** How long `recipe` takes at the current cook speed, in simulated ms (whole ms, at least 1). */
export function cookMs(recipe: RecipeDef, cookSpeedModifier: number): number {
  return Math.max(1, Math.ceil((recipe.cookSec * 1000) / Math.max(0.01, cookSpeedModifier)));
}

/** Teaches a recipe (no-op when known) and reports it. Milestone and goal rewards use it too. */
export function learn(
  state: GameState,
  ctx: SimContext,
  id: RecipeId,
  how: 'card' | 'milestone' | 'experiment',
): void {
  if (isKnown(state, id)) return;
  state.kitchen.known.push(id);
  ctx.events.push({ type: 'recipeLearned', recipe: id, how });
}

// ---- cooking

/** The `cook` action: puts a known recipe on the stove, using its ingredients from the bag. */
export function startCooking(state: GameState, ctx: SimContext, id: RecipeId): ActionResult {
  const recipe = ctx.data.recipes[id];
  if (!recipe) return fail('Unknown recipe.');
  if (!isKnown(state, id)) return fail(`You haven't learned ${recipe.name} yet.`);
  if (state.kitchen.queue.length >= kitchenSlots(state, ctx.data)) {
    return fail('The stove is full. Wait for a dish to finish, or upgrade the Kitchen.');
  }
  if (!canCook(state, recipe)) return fail(`You don't have everything for ${recipe.name}.`);
  // Cooking perks: a chance that one ingredient is not used up. `saved` remembers it, so taking the
  // dish off the stove gives back only what was really spent.
  let saved: ItemId | undefined;
  if (ctx.mods.ingredientSaveChance > 0 && ctx.rng.next() < ctx.mods.ingredientSaveChance) {
    saved = ctx.rng.pick(recipe.ingredients).item;
  }
  for (const i of recipe.ingredients) {
    removeItem(state.inventory, i.item, i.item === saved ? i.qty - 1 : i.qty, false);
  }
  state.kitchen.queue.push(
    saved
      ? { recipe: id, remainingMs: recipe.cookSec * 1000, saved }
      : { recipe: id, remainingMs: recipe.cookSec * 1000 },
  );
  return OK;
}

/** The `cancelCook` action: takes a dish off the stove and gives back the ingredients. */
export function cancelCooking(state: GameState, ctx: SimContext, index: number): ActionResult {
  const job = state.kitchen.queue[index];
  if (!job) return fail('There is nothing on the stove there.');
  if (job.remainingMs === 0) return fail('That dish is finished; it is only waiting for space in your bag.');
  const recipe = ctx.data.recipes[job.recipe];
  const back = recipe.ingredients.map((i) => ({
    item: i.item,
    qty: i.item === job.saved ? i.qty - 1 : i.qty,
  }));
  const scratch = structuredClone(state.inventory);
  for (const i of back)
    if (!addItem(scratch, i.item, i.qty)) return fail('Your bag has no room for the ingredients.');
  for (const i of back) addItem(state.inventory, i.item, i.qty);
  state.kitchen.queue.splice(index, 1);
  return OK;
}

/** Puts a finished dish in the bag, or leaves it on the stove when the bag is full. */
function deliver(state: GameState, ctx: SimContext, index: number): boolean {
  const job = state.kitchen.queue[index]!;
  const recipe = ctx.data.recipes[job.recipe];
  const hearty = job.hearty === true; // decided the moment it finished
  if (!addItem(state.inventory, job.recipe, 1, hearty)) {
    ctx.events.push({ type: 'inventoryFull', item: job.recipe });
    return false;
  }
  state.kitchen.queue.splice(index, 1);
  state.stats.dishesCooked += 1;
  state.stats.bestDishTier = Math.max(state.stats.bestDishTier, recipe.tier);
  ctx.events.push({ type: 'cooked', recipe: job.recipe, tier: recipe.tier, hearty });
  return true;
}

/** Advances the stove by `dtMs` at the current cook speed, in job order. */
export function tickCooking(state: GameState, ctx: SimContext, dtMs: number): void {
  const queue = state.kitchen.queue;
  if (queue.length === 0 || dtMs <= 0) return;
  const work = Math.round(dtMs * Math.max(0, ctx.mods.cookSpeedModifier));
  for (let i = 0; i < queue.length;) {
    const job = queue[i]!;
    if (job.remainingMs > 0) {
      job.remainingMs = Math.max(0, job.remainingMs - work);
      // A dish that finishes in winter is hearty, even if it then waits for room in the bag.
      if (job.remainingMs === 0 && ctx.data.seasons[ctx.calendar.season].effects.heartyDishes)
        job.hearty = true;
    }
    if (job.remainingMs === 0 && deliver(state, ctx, i)) continue; // spliced: the next job is now at i
    i++;
  }
}

/** Simulated ms until the next dish on the stove finishes, or Infinity. */
export function msToNextCookFinish(state: GameState, ctx: Pick<SimContext, 'mods'>): number {
  const speed = ctx.mods.cookSpeedModifier;
  if (!(speed > 0)) return Infinity;
  let ms = Infinity;
  for (const job of state.kitchen.queue)
    if (job.remainingMs > 0) ms = Math.min(ms, Math.ceil(job.remainingMs / speed));
  return ms;
}

// ---- discovery

/** Recipes on sale in the Shop that the player does not know yet, cheapest first. */
export function recipeCards(
  state: GameState,
  data: GameData,
): { id: RecipeId; price: number; unlocked: boolean; hint: string | null }[] {
  const out: { id: RecipeId; price: number; unlocked: boolean; hint: string | null }[] = [];
  for (const id of RECIPE_IDS) {
    const d = data.recipes[id].discovery;
    if (d.kind !== 'card' || isKnown(state, id)) continue;
    const unlocked = isUnlocked(state, d.unlock);
    out.push({ id, price: d.price, unlocked, hint: unlocked ? null : unlockHint(state, data, d.unlock) });
  }
  return out.sort((a, b) => a.price - b.price);
}

/** The `buyRecipe` action: a recipe card from the Shop. */
export function buyRecipe(state: GameState, ctx: SimContext, id: RecipeId): ActionResult {
  const recipe = ctx.data.recipes[id];
  if (!recipe || recipe.discovery.kind !== 'card') return fail('That recipe is not for sale.');
  if (isKnown(state, id)) return fail(`You already know ${recipe.name}.`);
  const { price, unlock } = recipe.discovery;
  if (!isUnlocked(state, unlock)) return fail(unlockHint(state, ctx.data, unlock) ?? 'Not available yet.');
  if (!canAfford(state, price)) return fail(`You need ${price.toLocaleString('en-US')}g for that.`);
  spend(state, price);
  learn(state, ctx, id, 'card');
  ctx.events.push({ type: 'purchased', what: id, gold: price });
  return OK;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

/** A hint after a miss: one ingredient of a still-unknown experiment recipe that shares an item with the try. */
export function experimentHint(state: GameState, data: GameData, tried: readonly ItemId[]): string {
  for (const id of RECIPE_IDS) {
    const r = data.recipes[id];
    if (r.discovery.kind !== 'experiment' || isKnown(state, id)) continue;
    const ids = r.ingredients.map((i) => i.item);
    if (!ids.some((i) => tried.includes(i))) continue;
    const missing = ids.find((i) => !tried.includes(i));
    if (missing)
      return `It smells promising, though. Maybe something with ${data.items[missing]?.name ?? missing}?`;
  }
  return "Those don't seem to go together, but nothing was wasted.";
}

/**
 * The `experiment` action: 2–4 distinct ingredients from the bag. If they are exactly the
 * ingredients of an unknown experiment or card recipe, it is learned. Nothing is ever consumed;
 * a miss returns a friendly hint as its `reason`.
 */
export function experiment(state: GameState, ctx: SimContext, items: readonly ItemId[]): ActionResult {
  const set = [...new Set(items)];
  if (set.length !== items.length) return fail('Pick each ingredient only once.');
  if (set.length < EXPERIMENT_MIN_ITEMS || set.length > EXPERIMENT_MAX_ITEMS) {
    return fail(`Pick ${EXPERIMENT_MIN_ITEMS} to ${EXPERIMENT_MAX_ITEMS} ingredients to try together.`);
  }
  for (const item of set) {
    const def = ctx.data.items[item];
    if (
      !def ||
      def.category === 'seed' ||
      def.category === 'sapling' ||
      def.category === 'dish' ||
      def.category === 'feed'
    )
      return fail("That isn't an ingredient.");
    if (countItem(state.inventory, item, false) < 1) return fail(`You don't have any ${def.name}.`);
  }
  for (const id of RECIPE_IDS) {
    const r = ctx.data.recipes[id];
    if (r.discovery.kind !== 'experiment' && r.discovery.kind !== 'card') continue;
    if (
      !sameSet(
        set,
        r.ingredients.map((i) => i.item),
      )
    )
      continue;
    if (isKnown(state, id)) return fail(`That's ${r.name}, and you already know it.`);
    learn(state, ctx, id, 'experiment');
    return OK;
  }
  return fail(`Hmm, nothing came of it this time. ${experimentHint(state, ctx.data, set)}`);
}
