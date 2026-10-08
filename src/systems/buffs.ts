// Food buffs (GDD §7, BALANCE.md §7). Eating a dish starts a buff whose strength and duration come
// from the recipe's tier. One buff per type: eating the same type again keeps the stronger
// magnitude and the longer remaining time. There are a few slots (3 to start); when they are all
// taken, eating a new type replaces the buff with the least time left, after the UI asks.
//
// Buffs count down in simulated time. `msToNextBuffExpiry` tells the core to split a step where a
// buff runs out, so its bonus applies to exactly the time it was active (offline too). Systems
// never read buffs: `computeModifiers` folds them into `ctx.mods`.

import type { ActiveBuff, GameState } from '../core/state';
import type { GameData } from '../data';
import {
  BUFF_BASE_DURATION_MS,
  BUFF_DURATION_GROWTH,
  BUFF_MAGNITUDE_PER_TIER,
  HEARTY_DURATION_BONUS,
  MAX_BUFF_SLOTS,
} from '../data/balance';
import type { BuffType, RecipeId, RecipeTier } from '../data/ids';
import { fail, OK, type ActionResult, type SimContext } from './context';
import { bundleBonuses } from './bundles';
import { countItem, removeItem } from './inventory';
import { perkTotals } from './skills';

/** `10% × tier × the type's scale`, rounded so magnitudes compare cleanly. */
export function buffMagnitude(data: GameData, type: BuffType, tier: RecipeTier): number {
  return Math.round(BUFF_MAGNITUDE_PER_TIER * tier * data.buffs[type].magnitudeScale * 10_000) / 10_000;
}

/**
 * `10 min × 3^(tier − 1) × (1 + perk + hearty)`, whole simulated ms (BALANCE.md §7). `perkBonus` is
 * `ctx.mods.buffDurationBonus` (the Cooking perks); hearty (winter) adds 50%.
 */
export function buffDurationMs(tier: RecipeTier, hearty: boolean, perkBonus = 0): number {
  return Math.round(
    BUFF_BASE_DURATION_MS *
      BUFF_DURATION_GROWTH ** (tier - 1) *
      (1 + perkBonus + (hearty ? HEARTY_DURATION_BONUS : 0)),
  );
}

/** How many different buffs can run at once: the base slots, Cooking level 7 and the Cozy Dinner bundle, up to MAX_BUFF_SLOTS. */
export function buffSlotCount(state: GameState, data: GameData): number {
  const extra = perkTotals(state, data).buffSlots + bundleBonuses(state, data).buffSlots;
  return Math.min(MAX_BUFF_SLOTS, state.buffs.baseSlots + extra);
}

export function activeBuff(state: GameState, type: BuffType): ActiveBuff | undefined {
  return state.buffs.active.find((b) => b.type === type);
}

/** The buff that would be replaced when the slots are full: the one with the least time left. */
export function leastTimeLeft(state: GameState): ActiveBuff | undefined {
  let least: ActiveBuff | undefined;
  for (const b of state.buffs.active) if (!least || b.remainingMs < least.remainingMs) least = b;
  return least;
}

export type EatPlan =
  | { kind: 'start' } // takes a free slot
  | { kind: 'refresh'; existing: ActiveBuff } // same type already active: the stronger and longer wins
  | { kind: 'replace'; existing: ActiveBuff }; // slots full: needs the player's OK to replace `existing`

/** What eating `dish` (or, v4-03, drinking a drink) would do right now (no changes). The UI asks before a `replace`. */
export function planEat(state: GameState, data: GameData, dish: RecipeId): EatPlan {
  const recipe = data.recipes[dish];
  const same = activeBuff(state, recipe.buff);
  if (same) return { kind: 'refresh', existing: same };
  if (state.buffs.active.length < buffSlotCount(state, data)) return { kind: 'start' };
  return { kind: 'replace', existing: leastTimeLeft(state)! };
}

/** The buff a dish gives: its type, magnitude and duration (hearty lengthens it). */
export function dishBuff(
  data: GameData,
  dish: RecipeId,
  hearty: boolean,
  perkBonus = 0,
): { type: BuffType; tier: RecipeTier; magnitude: number; durationMs: number } {
  const r = data.recipes[dish];
  return {
    type: r.buff,
    tier: r.tier,
    magnitude: buffMagnitude(data, r.buff, r.tier),
    durationMs: buffDurationMs(r.tier, hearty, perkBonus),
  };
}

/**
 * The `eat` action. `hearty` picks which stack to eat from (default: the plain one if there is one).
 * With every slot taken and a new type, the dish is kept and the reason asks for `replace: true`.
 */
export function eatDish(
  state: GameState,
  ctx: SimContext,
  dish: RecipeId,
  hearty: boolean | undefined,
  replace: boolean,
): ActionResult {
  const recipe = ctx.data.recipes[dish];
  const def = ctx.data.items[dish];
  if (!recipe || !def?.edible) return fail("That can't be eaten.");
  const inv = state.inventory;
  const useHearty = hearty ?? (countItem(inv, dish, false) === 0 && countItem(inv, dish, true) > 0);
  if (countItem(inv, dish, useHearty) < 1) return fail(`You don't have any ${def.name}.`);

  const plan = planEat(state, ctx.data, dish);
  if (plan.kind === 'replace' && !replace) {
    const b = plan.existing;
    return fail(`Your buff slots are full. Eating this would replace ${ctx.data.buffs[b.type].name}.`);
  }
  const buff = dishBuff(ctx.data, dish, useHearty, ctx.mods.buffDurationBonus);
  removeItem(inv, dish, 1, useHearty);

  if (plan.kind === 'refresh') {
    const b = plan.existing;
    if (buff.magnitude > b.magnitude) {
      b.magnitude = buff.magnitude;
      b.tier = buff.tier;
      b.source = dish;
    }
    b.remainingMs = Math.max(b.remainingMs, buff.durationMs);
  } else {
    if (plan.kind === 'replace') {
      state.buffs.active.splice(state.buffs.active.indexOf(plan.existing), 1);
    }
    state.buffs.active.push({
      type: buff.type,
      magnitude: buff.magnitude,
      tier: buff.tier,
      remainingMs: buff.durationMs,
      source: dish,
    });
    ctx.events.push({ type: 'buffStarted', buff: buff.type });
  }
  state.stats.dishesEaten += 1;
  ctx.events.push({ type: 'ate', recipe: dish, buff: buff.type, hearty: useHearty });
  return OK;
}

/** Counts every buff down by `dtMs`; the ones that run out are removed (the step ends exactly there). */
export function tickBuffs(state: GameState, ctx: SimContext, dtMs: number): void {
  if (state.buffs.active.length === 0 || dtMs <= 0) return;
  const kept: ActiveBuff[] = [];
  for (const b of state.buffs.active) {
    b.remainingMs -= dtMs;
    if (b.remainingMs > 0) kept.push(b);
    else ctx.events.push({ type: 'buffExpired', buff: b.type });
  }
  state.buffs.active = kept;
}

/** Simulated ms until the next buff runs out, or Infinity. */
export function msToNextBuffExpiry(state: GameState): number {
  let ms = Infinity;
  for (const b of state.buffs.active) ms = Math.min(ms, b.remainingMs);
  return ms;
}
