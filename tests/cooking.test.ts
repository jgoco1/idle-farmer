import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../src/core/events';
import type { ActionResult } from '../src/systems/context';
import { runOffline } from '../src/core/offline';
import { validateState } from '../src/core/save';
import { makeContext, processCalendar, step } from '../src/core/sim';
import { createInitialState, type GameState } from '../src/core/state';
import { buildCalendar } from '../src/core/time';
import { GAME_DATA, type GameData } from '../src/data';
import { BASE_BUFF_SLOTS, HEARTY_DURATION_BONUS, MAX_BUFF_SLOTS, TIER_SELL_MULT } from '../src/data/balance';
import { BUFF_TYPES } from '../src/data/buffs';
import { CROPS } from '../src/data/crops';
import { FISH } from '../src/data/fish';
import { RECIPE_IDS, type BuffType, type RecipeId, type RecipeTier, type SeasonId } from '../src/data/ids';
import { RECIPES } from '../src/data/recipes';
import { farmhandStats } from '../src/systems/automation';
import {
  buffDurationMs,
  buffMagnitude,
  buffSlotCount,
  eatDish,
  leastTimeLeft,
  msToNextBuffExpiry,
  planEat,
  tickBuffs,
} from '../src/systems/buffs';
import {
  buyRecipe,
  cancelCooking,
  canCook,
  cookMs,
  experiment,
  experimentHint,
  ingredientValue,
  kitchenSlots,
  knownRecipes,
  msToNextCookFinish,
  recipeCards,
  recipeScore,
  recipeTier,
  startCooking,
} from '../src/systems/cooking';
import { addItem, countItem } from '../src/systems/inventory';
import { quoteSale, sellItems, unitPrice } from '../src/systems/market';
import { computeModifiers, NO_MODIFIERS } from '../src/systems/modifiers';
import { shipItems, unshipItems } from '../src/systems/shippingBin';
import { msToNextSimEvent } from '../src/systems';
import { buyUpgrade } from '../src/systems/upgrades';
import { tickTraps, TRAP_INTERVAL_MS } from '../src/systems/traps';
import { awayRows } from '../src/ui/awaySummary';
import { buffEffectText, buffTooltip, formatBuffAmount } from '../src/ui/buffBar';
import { ALL_SPRITES, SPRITES } from '../src/render/sprites';
import { runProgression } from '../src/systems/progression';
import { at, HOUR, NY, setFarmLevel } from './helpers';

const CREATED = at(NY, 2026, 1, 7, 10); // Wednesday; spring until Sunday 11 Jan, then summer, autumn, winter (25 Jan)
const NOON = at(NY, 2026, 1, 7, 12);
const AUTUMN = at(NY, 2026, 1, 20, 12);
const WINTER = at(NY, 2026, 1, 28, 12);
const MIN = 60_000;

/** The reason an action was refused ('' when it worked). */
const why = (r: ActionResult): string => (r.ok ? '' : r.reason);

function farm(seed = 1, t = NOON): GameState {
  const s = createInitialState(CREATED, NY, seed);
  processCalendar(s, GAME_DATA, NY, t, []);
  return s;
}

function ctxAt(s: GameState, t = NOON, events: GameEvent[] = [], data: GameData = GAME_DATA) {
  return makeContext(s, data, buildCalendar(t, s.calendar, NY), events);
}

/** Stocks the bag with a recipe's ingredients, `times` over. */
function stock(s: GameState, id: RecipeId, times = 1): void {
  for (const i of RECIPES[id].ingredients) addItem(s.inventory, i.item, i.qty * times);
}

/** Puts a buff straight into the state. */
function giveBuff(s: GameState, type: BuffType, tier: RecipeTier, remainingMs: number): void {
  s.buffs.active.push({
    type,
    magnitude: buffMagnitude(GAME_DATA, type, tier),
    tier,
    remainingMs,
    source: 'roasted_turnip',
  });
}

describe('recipe data (phase 06)', () => {
  it('has the 22 recipes of BALANCE.md: 6 T1, 7 T2, 5 T3 and 4 T4', () => {
    expect(RECIPE_IDS).toHaveLength(22);
    expect(Object.keys(RECIPES).sort()).toEqual([...RECIPE_IDS].sort());
    const count = (t: RecipeTier) => RECIPE_IDS.filter((r) => RECIPES[r].tier === t).length;
    expect([count(1), count(2), count(3), count(4)]).toEqual([6, 7, 5, 4]);
  });

  it('every declared tier matches the tier its inputs work out to (so data and formula cannot drift)', () => {
    for (const id of RECIPE_IDS) {
      expect(
        recipeTier(RECIPES[id], GAME_DATA.items),
        `${id} (score ${recipeScore(RECIPES[id], GAME_DATA.items).toFixed(2)})`,
      ).toBe(RECIPES[id].tier);
    }
  });

  it('scores match the BALANCE.md table for a few recipes', () => {
    const score = (id: RecipeId) => Math.round(recipeScore(RECIPES[id], GAME_DATA.items) * 100) / 100;
    expect(score('roasted_turnip')).toBe(3.88);
    expect(score('vegetable_soup')).toBe(9.34);
    expect(score('seafood_stew')).toBe(16.68);
    expect(score('moonfin_sushi')).toBe(45.34);
  });

  it('every dish is priced at its ingredients × the tier multiplier, so cooking always beats selling raw', () => {
    for (const id of RECIPE_IDS) {
      const r = RECIPES[id];
      const value = ingredientValue(r, GAME_DATA.items);
      expect(r.basePrice, id).toBe(Math.round(value * TIER_SELL_MULT[r.tier]));
      expect(r.basePrice, id).toBeGreaterThan(value);
      expect(GAME_DATA.items[id]!.basePrice).toBe(r.basePrice);
      expect(GAME_DATA.items[id]!.edible).toBe(true);
    }
    expect(TIER_SELL_MULT).toEqual({ 1: 1.25, 2: 1.4, 3: 1.6, 4: 2 });
  });

  it('uses only crops, fish and seaweed as ingredients, and never a dish', () => {
    for (const id of RECIPE_IDS) {
      for (const i of RECIPES[id].ingredients) {
        const cat = GAME_DATA.items[i.item]?.category;
        expect(['crop', 'fish', 'junk'], `${id}: ${i.item}`).toContain(cat);
        expect(i.qty).toBeGreaterThan(0);
      }
    }
  });

  it('every T3 and T4 can be cooked from one season of fresh ingredients, and each season has its own T4', () => {
    const fresh = (item: string, season: SeasonId): boolean => {
      if (item in CROPS) return CROPS[item as keyof typeof CROPS].seasons.includes(season);
      if (item in FISH) return FISH[item as keyof typeof FISH].seasons.includes(season);
      return item === 'seaweed'; // junk from the pond and the sea, all year
    };
    const seasons: SeasonId[] = ['spring', 'summer', 'autumn', 'winter'];
    const cookableIn = (id: RecipeId) =>
      seasons.filter((s) => RECIPES[id].ingredients.every((i) => fresh(i.item, s)));
    for (const id of RECIPE_IDS.filter((r) => RECIPES[r].tier >= 3)) {
      expect(cookableIn(id).length, id).toBeGreaterThan(0);
    }
    const t4 = RECIPE_IDS.filter((r) => RECIPES[r].tier === 4);
    expect(t4.map((r) => cookableIn(r)[0])).toEqual(['spring', 'summer', 'autumn', 'winter']);
    expect(t4).toEqual(['garden_banquet', 'royal_sturgeon', 'harvest_feast', 'moonfin_sushi']);
  });

  it('spreads the buffs as BALANCE.md says', () => {
    const per = (b: BuffType) => RECIPE_IDS.filter((r) => RECIPES[r].buff === b).length;
    expect(BUFF_TYPES.map(per)).toEqual([3, 3, 4, 2, 3, 3, 4]);
  });

  it('has three starter recipes, and a card or another way to find every other one', () => {
    const kinds = RECIPE_IDS.map((r) => RECIPES[r].discovery.kind);
    expect(kinds.filter((k) => k === 'starter')).toHaveLength(3);
    expect(kinds.filter((k) => k === 'experiment')).toHaveLength(4);
    expect(kinds.filter((k) => k === 'milestone')).toHaveLength(5);
    expect(kinds.filter((k) => k === 'card')).toHaveLength(10);
    expect(createInitialState(0, NY).kitchen.known).toEqual([
      'roasted_turnip',
      'baked_potato',
      'grilled_bluegill',
    ]);
  });
});

describe('buff strength and duration', () => {
  it('magnitude is 10% × tier × the type scale', () => {
    const table: Record<BuffType, number[]> = {
      growth: [0.1, 0.2, 0.3, 0.4],
      sellPrice: [0.05, 0.1, 0.15, 0.2],
      fishingLuck: [0.1, 0.2, 0.3, 0.4],
      fishingSpeed: [0.1, 0.2, 0.3, 0.4],
      cookSpeed: [0.15, 0.3, 0.45, 0.6],
      automationSpeed: [0.1, 0.2, 0.3, 0.4],
      xp: [0.15, 0.3, 0.45, 0.6],
    };
    for (const type of BUFF_TYPES) {
      for (const tier of [1, 2, 3, 4] as const) {
        expect(buffMagnitude(GAME_DATA, type, tier), `${type} T${tier}`).toBeCloseTo(
          table[type][tier - 1]!,
          10,
        );
      }
    }
  });

  it('duration is 6 minutes × 2^(tier − 1), and a hearty dish lasts 50% longer', () => {
    expect([1, 2, 3, 4].map((t) => buffDurationMs(t as RecipeTier, false) / MIN)).toEqual([6, 12, 24, 48]);
    expect([1, 2, 3, 4].map((t) => buffDurationMs(t as RecipeTier, true) / MIN)).toEqual([9, 18, 36, 72]);
    expect(HEARTY_DURATION_BONUS).toBe(0.5);
  });

  it('formats amounts and tooltips', () => {
    expect(formatBuffAmount(GAME_DATA.buffs.growth, 0.2)).toBe('20%');
    expect(formatBuffAmount(GAME_DATA.buffs.fishingLuck, 0.3)).toBe('+0.30');
    expect(buffEffectText(GAME_DATA.buffs.growth, 0.1)).toBe('Crops grow 10% faster.');
    const s = farm();
    giveBuff(s, 'growth', 2, 4 * MIN + 30_000);
    expect(buffTooltip(GAME_DATA, s.buffs.active[0]!)).toBe(
      'Green Thumb (tier 2)\nCrops grow 20% faster.\n4:30 left · from Roasted Turnip',
    );
  });
});

describe('eating and stacking', () => {
  it('eating starts a buff, uses up the dish and counts it', () => {
    const s = farm();
    addItem(s.inventory, 'roasted_turnip', 2);
    const events: GameEvent[] = [];
    expect(eatDish(s, ctxAt(s, NOON, events), 'roasted_turnip', undefined, false)).toEqual({ ok: true });
    expect(countItem(s.inventory, 'roasted_turnip')).toBe(1);
    expect(s.buffs.active).toEqual([
      { type: 'growth', magnitude: 0.1, tier: 1, remainingMs: 6 * MIN, source: 'roasted_turnip' },
    ]);
    expect(s.stats.dishesEaten).toBe(1);
    expect(events.map((e) => e.type)).toEqual(['buffStarted', 'ate']);
  });

  it('refuses when there is no such dish, and never eats a crop', () => {
    const s = farm();
    expect(eatDish(s, ctxAt(s), 'roasted_turnip', undefined, false)).toEqual({
      ok: false,
      reason: "You don't have any Roasted Turnip.",
    });
    addItem(s.inventory, 'turnip', 1);
    expect(eatDish(s, ctxAt(s), 'turnip' as never, undefined, false).ok).toBe(false);
    expect(s.buffs.active).toEqual([]);
  });

  it('a hearty dish gives 50% more time, and hearty stacks are separate', () => {
    const s = farm();
    addItem(s.inventory, 'vegetable_soup', 1);
    addItem(s.inventory, 'vegetable_soup', 1, true);
    expect(s.inventory.slots.filter((x) => x?.item === 'vegetable_soup')).toHaveLength(2);
    expect(eatDish(s, ctxAt(s), 'vegetable_soup', true, false).ok).toBe(true);
    expect(s.buffs.active[0]!.remainingMs).toBe(18 * MIN);
    expect(countItem(s.inventory, 'vegetable_soup', true)).toBe(0);
    expect(countItem(s.inventory, 'vegetable_soup', false)).toBe(1);
  });

  it('without a choice it eats the plain dish first, then the hearty one', () => {
    const s = farm();
    addItem(s.inventory, 'roasted_turnip', 1, true);
    expect(eatDish(s, ctxAt(s), 'roasted_turnip', undefined, false).ok).toBe(true);
    expect(s.buffs.active[0]!.remainingMs).toBe(9 * MIN); // only a hearty one was there
    addItem(s.inventory, 'baked_potato', 1);
    addItem(s.inventory, 'baked_potato', 1, true);
    eatDish(s, ctxAt(s), 'baked_potato', undefined, false);
    expect(countItem(s.inventory, 'baked_potato', true)).toBe(1); // the hearty one is kept
  });

  it('eating the same type keeps the stronger magnitude and the longer time, never weakening or shortening', () => {
    const s = farm();
    giveBuff(s, 'growth', 3, 20 * MIN); // +30%, 20 min left
    addItem(s.inventory, 'roasted_turnip', 1); // T1: +10% for 6 min
    eatDish(s, ctxAt(s), 'roasted_turnip', undefined, false);
    expect(s.buffs.active).toHaveLength(1);
    expect(s.buffs.active[0]!.magnitude).toBeCloseTo(0.3, 10);
    expect(s.buffs.active[0]!.remainingMs).toBe(20 * MIN);
    expect(s.buffs.active[0]!.tier).toBe(3);

    // A stronger dish raises the magnitude and refreshes the time to the longer of the two.
    addItem(s.inventory, 'vegetable_soup', 1); // T2 growth: +20% … weaker than +30%, longer than nothing
    eatDish(s, ctxAt(s), 'vegetable_soup', undefined, false);
    expect(s.buffs.active[0]!.magnitude).toBeCloseTo(0.3, 10);
    expect(s.buffs.active[0]!.remainingMs).toBe(20 * MIN);

    const t = farm();
    giveBuff(t, 'growth', 1, 2 * MIN);
    addItem(t.inventory, 'vegetable_soup', 1);
    eatDish(t, ctxAt(t), 'vegetable_soup', undefined, false);
    expect(t.buffs.active[0]!.magnitude).toBeCloseTo(0.2, 10);
    expect(t.buffs.active[0]!.remainingMs).toBe(12 * MIN);
    expect(t.buffs.active[0]!.source).toBe('vegetable_soup');
  });

  it('starts with three slots, capped at five', () => {
    const s = farm();
    expect(BASE_BUFF_SLOTS).toBe(3);
    expect(buffSlotCount(s, GAME_DATA)).toBe(3);
    s.buffs.baseSlots = 9;
    expect(buffSlotCount(s, GAME_DATA)).toBe(MAX_BUFF_SLOTS);
    expect(MAX_BUFF_SLOTS).toBe(5);
  });

  it('a new type with every slot taken asks first and keeps the dish, then replaces the buff with the least time', () => {
    const s = farm();
    giveBuff(s, 'growth', 1, 10 * MIN);
    giveBuff(s, 'sellPrice', 1, 2 * MIN);
    giveBuff(s, 'xp', 1, 30 * MIN);
    addItem(s.inventory, 'baked_potato', 1); // cookSpeed: a fourth type
    expect(planEat(s, GAME_DATA, 'baked_potato').kind).toBe('replace');
    expect(leastTimeLeft(s)!.type).toBe('sellPrice');
    const refused = eatDish(s, ctxAt(s), 'baked_potato', undefined, false);
    expect(refused.ok).toBe(false);
    expect(countItem(s.inventory, 'baked_potato')).toBe(1);
    expect(s.buffs.active.map((b) => b.type)).toEqual(['growth', 'sellPrice', 'xp']);

    expect(eatDish(s, ctxAt(s), 'baked_potato', undefined, true).ok).toBe(true);
    expect(s.buffs.active.map((b) => b.type).sort()).toEqual(['cookSpeed', 'growth', 'xp']);
    expect(countItem(s.inventory, 'baked_potato')).toBe(0);
    expect(s.buffs.active).toHaveLength(3);
  });

  it('a buff of a type already running never needs a free slot', () => {
    const s = farm();
    giveBuff(s, 'growth', 1, 10 * MIN);
    giveBuff(s, 'sellPrice', 1, 2 * MIN);
    giveBuff(s, 'xp', 1, 30 * MIN);
    addItem(s.inventory, 'vegetable_soup', 1);
    expect(planEat(s, GAME_DATA, 'vegetable_soup').kind).toBe('refresh');
    expect(eatDish(s, ctxAt(s), 'vegetable_soup', undefined, false).ok).toBe(true);
    expect(s.buffs.active).toHaveLength(3);
  });

  it('more slots (phase 07) let a fourth type in without asking', () => {
    const s = farm();
    s.buffs.baseSlots = 4;
    giveBuff(s, 'growth', 1, 10 * MIN);
    giveBuff(s, 'sellPrice', 1, 2 * MIN);
    giveBuff(s, 'xp', 1, 30 * MIN);
    expect(planEat(s, GAME_DATA, 'baked_potato').kind).toBe('start');
  });

  it('counts down in simulated time and expires with an event', () => {
    const s = farm();
    giveBuff(s, 'growth', 1, 6 * MIN);
    giveBuff(s, 'xp', 1, 3 * MIN);
    const events: GameEvent[] = [];
    tickBuffs(s, ctxAt(s, NOON, events), 3 * MIN);
    expect(s.buffs.active.map((b) => [b.type, b.remainingMs])).toEqual([['growth', 3 * MIN]]);
    expect(events).toEqual([{ type: 'buffExpired', buff: 'xp' }]);
    expect(msToNextBuffExpiry(s)).toBe(3 * MIN);
    expect(msToNextBuffExpiry(farm())).toBe(Infinity);
  });
});

describe('each buff drives its seam', () => {
  it('folds every buff type into its modifier as 1 + bonus (luck is additive)', () => {
    const base = farm();
    expect(computeModifiers(base, GAME_DATA)).toEqual(NO_MODIFIERS);
    const seam = (type: BuffType): keyof typeof NO_MODIFIERS =>
      GAME_DATA.buffs[type].seam as keyof typeof NO_MODIFIERS;
    for (const type of BUFF_TYPES) {
      const s = farm();
      giveBuff(s, type, 2, MIN);
      const mods = computeModifiers(s, GAME_DATA);
      const bonus = buffMagnitude(GAME_DATA, type, 2);
      const rest = { ...mods, [seam(type)]: NO_MODIFIERS[seam(type)] };
      expect(rest, type).toEqual(NO_MODIFIERS); // nothing else moved
      const expected = type === 'fishingLuck' ? bonus : 1 + bonus;
      expect(mods[seam(type)], type).toBeCloseTo(expected, 10);
    }
  });

  it('Green Thumb makes crops grow faster', () => {
    const s = farm();
    const plot = s.farm.plots[0]!;
    plot.state = 'planted';
    plot.crop = 'turnip';
    plot.waterMsLeft = 60 * MIN;
    const before = structuredClone(s);
    giveBuff(s, 'growth', 4, 60 * MIN); // +40%
    step(s, ctxAt(s), 30_000); // a turnip takes 2 minutes, so stay well short of ripe
    step(before, ctxAt(before), 30_000);
    expect(plot.growthMs).toBeGreaterThan(before.farm.plots[0]!.growthMs);
    expect(plot.growthMs / before.farm.plots[0]!.growthMs).toBeCloseTo(1.4, 2);
  });

  it('Silver Tongue raises what things sell for', () => {
    const s = farm();
    addItem(s.inventory, 'potato', 1);
    const plain = unitPrice(s, GAME_DATA, computeModifiers(s, GAME_DATA), 'potato');
    giveBuff(s, 'sellPrice', 4, MIN); // +20%
    const boosted = unitPrice(s, GAME_DATA, computeModifiers(s, GAME_DATA), 'potato');
    expect(boosted).toBe(Math.floor(GAME_DATA.items.potato!.basePrice * 1.2 * 0.9));
    expect(boosted).toBeGreaterThan(plain);
  });

  it("Angler's Luck adds luck on top of the rod's", () => {
    const s = farm();
    s.upgrades.fishing_rod = 1; // +0.05
    giveBuff(s, 'fishingLuck', 3, MIN); // +0.30
    expect(computeModifiers(s, GAME_DATA).fishingLuckModifier).toBeCloseTo(0.35, 10);
  });

  it('Quick Bite makes traps roll faster', () => {
    const roll = (buffed: boolean): number => {
      const s = farm(5);
      s.upgrades.fish_trap = 1;
      s.fishing.traps.push({ id: 1, location: 'pond', slot: 0, progressMs: 0, contents: [] });
      if (buffed) giveBuff(s, 'fishingSpeed', 4, 60 * MIN); // +40%
      tickTraps(s, ctxAt(s), TRAP_INTERVAL_MS * 0.5);
      return s.fishing.traps[0]!.progressMs;
    };
    expect(roll(true)).toBe(Math.round(TRAP_INTERVAL_MS * 0.5 * 1.4));
    expect(roll(false)).toBe(Math.round(TRAP_INTERVAL_MS * 0.5));
  });

  it('Quick Hands cooks dishes faster, on top of the kitchen upgrade', () => {
    const s = farm();
    giveBuff(s, 'cookSpeed', 4, 60 * MIN); // +60%
    s.upgrades.kitchen = 1; // +15%
    expect(computeModifiers(s, GAME_DATA).cookSpeedModifier).toBeCloseTo(1.75, 10);
    expect(cookMs(RECIPES.roasted_turnip, 1.75)).toBe(Math.ceil(30_000 / 1.75));
  });

  it('Busy Bees speeds up the farmhand', () => {
    const s = farm();
    s.upgrades.farmhand = 1;
    const slow = farmhandStats(s, ctxAt(s))!.intervalMs;
    giveBuff(s, 'automationSpeed', 4, MIN); // +40%
    const fast = farmhandStats(s, ctxAt(s))!.intervalMs;
    expect(slow).toBe(30_000);
    expect(fast).toBe(Math.round(30_000 / 1.4));
  });

  it("Scholar's Snack raises the xpModifier stub", () => {
    const s = farm();
    giveBuff(s, 'xp', 2, MIN); // +30%
    expect(computeModifiers(s, GAME_DATA).xpModifier).toBeCloseTo(1.3, 10);
  });
});

describe('buffs and offline time', () => {
  /** The slowest a turnip could grow, so an 8 hour absence cannot finish it and growth stays measurable. */
  const SLOW: GameData = {
    ...GAME_DATA,
    crops: { ...GAME_DATA.crops, turnip: { ...GAME_DATA.crops.turnip, growSec: 100_000 } },
  };

  function dryTurnip(): GameState {
    const s = farm();
    const plot = s.farm.plots[0]!;
    plot.state = 'planted';
    plot.crop = 'turnip';
    plot.waterMsLeft = 0; // dry: half speed
    return s;
  }

  it('reports the expiry so a step is split there', () => {
    const s = dryTurnip();
    giveBuff(s, 'growth', 4, 20 * MIN);
    expect(msToNextSimEvent(s, ctxAt(s, NOON, [], SLOW))).toBe(20 * MIN);
  });

  it('a growth buff that runs out 20 minutes into an 8 hour absence only boosts those 20 minutes', () => {
    const s = dryTurnip();
    giveBuff(s, 'growth', 4, 20 * MIN); // +40%
    const report = runOffline(s, SLOW, NY, NOON, NOON + 8 * HOUR);
    expect(report.simulatedMs).toBe(8 * HOUR);
    expect(s.buffs.active).toEqual([]);
    expect(report.events.filter((e) => e.type === 'buffExpired')).toHaveLength(1);
    // 20 min at 0.5 × 1.4, then 460 min at 0.5.
    const expected = 20 * MIN * 0.7 + 460 * MIN * 0.5;
    expect(s.farm.plots[0]!.growthMs).toBeGreaterThan(expected - 5);
    expect(s.farm.plots[0]!.growthMs).toBeLessThan(expected + 5);
    // Not the 336 minutes an unsplit step would have given the whole absence.
    expect(s.farm.plots[0]!.growthMs).toBeLessThan(8 * 60 * MIN * 0.7 - HOUR);
  });

  it('one large step gives the same growth as many small ones', () => {
    const big = dryTurnip();
    const small = dryTurnip();
    giveBuff(big, 'growth', 4, 6 * MIN);
    giveBuff(small, 'growth', 4, 6 * MIN);
    step(big, ctxAt(big, NOON, [], SLOW), 30 * MIN);
    const ctx = ctxAt(small, NOON, [], SLOW);
    for (let i = 0; i < 30 * 60; i++) step(small, ctx, 1000);
    expect(Math.abs(big.farm.plots[0]!.growthMs - small.farm.plots[0]!.growthMs)).toBeLessThan(30);
    expect(big.buffs.active).toEqual([]);
    expect(small.buffs.active).toEqual([]);
  });

  it('a buff that outlasts a short absence keeps its remaining time', () => {
    const s = dryTurnip();
    giveBuff(s, 'growth', 4, 48 * MIN);
    runOffline(s, GAME_DATA, NY, NOON, NOON + 10 * MIN);
    expect(s.buffs.active[0]!.remainingMs).toBe(38 * MIN);
  });
});

describe('cooking', () => {
  it('has one stove slot at first, and the kitchen upgrade adds slots and speed', () => {
    const s = farm();
    expect(kitchenSlots(s, GAME_DATA)).toBe(1);
    const def = GAME_DATA.upgrades.kitchen!;
    expect(def.category).toBe('kitchen');
    expect(def.effect.map((e) => [e.capacity, e.cookSpeed])).toEqual([
      [1, 0],
      [2, 0.15],
      [3, 0.3],
      [4, 0.5],
    ]);
    s.gold = 100_000;
    const ctx = ctxAt(s);
    expect(buyUpgrade(s, ctx, 'kitchen').ok).toBe(true);
    expect(s.gold).toBe(99_000);
    expect(kitchenSlots(s, GAME_DATA)).toBe(2);
    expect(buyUpgrade(s, ctx, 'kitchen').ok).toBe(true);
    expect(buyUpgrade(s, ctx, 'kitchen').ok).toBe(true);
    expect(s.gold).toBe(100_000 - 1000 - 3500 - 12_000);
    expect(kitchenSlots(s, GAME_DATA)).toBe(4);
    expect(buyUpgrade(s, ctx, 'kitchen').ok).toBe(false);
  });

  it('puts a known recipe on the stove and uses the ingredients', () => {
    const s = farm();
    addItem(s.inventory, 'turnip', 3);
    expect(startCooking(s, ctxAt(s), 'roasted_turnip')).toEqual({ ok: true });
    expect(countItem(s.inventory, 'turnip')).toBe(1);
    expect(s.kitchen.queue).toEqual([{ recipe: 'roasted_turnip', remainingMs: 30_000 }]);
  });

  it('refuses unknown recipes, missing ingredients and a full stove', () => {
    const s = farm();
    expect(startCooking(s, ctxAt(s), 'roasted_turnip').ok).toBe(false); // nothing in the bag
    stock(s, 'vegetable_soup');
    expect(startCooking(s, ctxAt(s), 'vegetable_soup')).toEqual({
      ok: false,
      reason: "You haven't learned Vegetable Soup yet.",
    });
    addItem(s.inventory, 'turnip', 4);
    expect(startCooking(s, ctxAt(s), 'roasted_turnip').ok).toBe(true);
    expect(why(startCooking(s, ctxAt(s), 'roasted_turnip'))).toMatch(/stove is full/);
    expect(countItem(s.inventory, 'turnip')).toBe(4); // 6 in the bag, 2 used by the dish; the refusals used none
  });

  it('cooks several dishes at once with more slots', () => {
    const s = farm();
    s.upgrades.kitchen = 2;
    stock(s, 'roasted_turnip', 2);
    stock(s, 'baked_potato', 1);
    for (const r of ['roasted_turnip', 'roasted_turnip', 'baked_potato'] as const) {
      expect(startCooking(s, ctxAt(s), r).ok).toBe(true);
    }
    expect(s.kitchen.queue).toHaveLength(3);
    step(s, ctxAt(s), 30_000);
    expect(s.kitchen.queue).toEqual([]);
    expect(countItem(s.inventory, 'roasted_turnip')).toBe(2);
    expect(countItem(s.inventory, 'baked_potato')).toBe(1);
  });

  it('finishes exactly on time, online or in one large step', () => {
    const one = farm();
    const many = farm();
    for (const s of [one, many]) {
      stock(s, 'vegetable_soup');
      s.kitchen.known.push('vegetable_soup');
      startCooking(s, ctxAt(s), 'vegetable_soup');
    }
    expect(msToNextCookFinish(one, ctxAt(one))).toBe(60_000);
    step(one, ctxAt(one), 59_999);
    expect(countItem(one.inventory, 'vegetable_soup')).toBe(0);
    step(one, ctxAt(one), 1);
    expect(countItem(one.inventory, 'vegetable_soup')).toBe(1);

    const ctx = ctxAt(many);
    for (let i = 0; i < 600; i++) step(many, ctx, 100);
    expect(countItem(many.inventory, 'vegetable_soup')).toBe(1);
    expect(many.stats.dishesCooked).toBe(1);
    expect(many.kitchen.queue).toEqual([]);
  });

  it('keeps cooking while you are away, and reports it', () => {
    const s = farm();
    s.kitchen.known.push('vegetable_soup');
    stock(s, 'vegetable_soup');
    startCooking(s, ctxAt(s), 'vegetable_soup');
    const report = runOffline(s, GAME_DATA, NY, NOON, NOON + 30 * MIN);
    expect(countItem(s.inventory, 'vegetable_soup')).toBe(1);
    expect(report.events.filter((e) => e.type === 'cooked')).toEqual([
      { type: 'cooked', recipe: 'vegetable_soup', tier: 2, hearty: false },
    ]);
    const rows = awayRows(report, { readyPlots: 0, dryPlots: 0 });
    expect(rows.some((r) => r.text.startsWith('1 dish finished cooking'))).toBe(true);
    expect(rows.find((r) => r.text.includes('cooking'))!.icon).toBe('item_vegetable_soup');
  });

  it('Quick Hands and the kitchen shorten the cook, and a buff that expires mid-dish only helps until then', () => {
    const s = farm();
    stock(s, 'vegetable_soup');
    s.kitchen.known.push('vegetable_soup');
    giveBuff(s, 'cookSpeed', 4, 30_000); // +60% for 30 s of a 60 s dish
    startCooking(s, ctxAt(s), 'vegetable_soup');
    // 30 s at ×1.6 = 48 s of work, the last 12 s at ×1.
    step(s, ctxAt(s), 30_000);
    expect(s.kitchen.queue[0]!.remainingMs).toBe(12_000);
    expect(s.buffs.active).toEqual([]);
    step(s, ctxAt(s), 11_999);
    expect(countItem(s.inventory, 'vegetable_soup')).toBe(0);
    step(s, ctxAt(s), 1);
    expect(countItem(s.inventory, 'vegetable_soup')).toBe(1);
  });

  it('cooking speed seen in one big step matches many small ones', () => {
    const run = (chunks: number): GameState => {
      const s = farm();
      s.upgrades.kitchen = 3; // ×1.5
      s.kitchen.known.push('vegetable_soup');
      stock(s, 'vegetable_soup');
      giveBuff(s, 'cookSpeed', 2, 20_000); // +30% for 20 s
      startCooking(s, ctxAt(s), 'vegetable_soup');
      const ctx = ctxAt(s);
      for (let i = 0; i < chunks; i++) step(s, ctx, 60_000 / chunks);
      return s;
    };
    for (const s of [run(1), run(60), run(600)]) {
      expect(s.kitchen.queue).toEqual([]);
      expect(countItem(s.inventory, 'vegetable_soup')).toBe(1);
    }
  });

  it('takes a dish off the stove and returns the ingredients', () => {
    const s = farm();
    addItem(s.inventory, 'turnip', 2);
    startCooking(s, ctxAt(s), 'roasted_turnip');
    expect(cancelCooking(s, ctxAt(s), 3).ok).toBe(false);
    expect(cancelCooking(s, ctxAt(s), 0)).toEqual({ ok: true });
    expect(s.kitchen.queue).toEqual([]);
    expect(countItem(s.inventory, 'turnip')).toBe(2);
  });

  it('a full bag never loses a finished dish: it waits on the stove until there is room', () => {
    const s = farm();
    addItem(s.inventory, 'turnip', 2);
    startCooking(s, ctxAt(s), 'roasted_turnip');
    // Fill the bag with things that are not turnips or dishes.
    s.inventory.slots.fill({ item: 'carp', qty: 99 });
    const events: GameEvent[] = [];
    step(s, ctxAt(s, NOON, events), 40_000);
    expect(s.kitchen.queue).toEqual([{ recipe: 'roasted_turnip', remainingMs: 0 }]);
    expect(events.some((e) => e.type === 'inventoryFull')).toBe(true);
    expect(cancelCooking(s, ctxAt(s), 0).ok).toBe(false);
    s.inventory.slots[0] = null;
    step(s, ctxAt(s), 100);
    expect(s.kitchen.queue).toEqual([]);
    expect(countItem(s.inventory, 'roasted_turnip')).toBe(1);
    expect(s.stats.dishesCooked).toBe(1);
  });

  it('counts the best tier cooked', () => {
    const s = farm();
    s.kitchen.known.push('vegetable_soup');
    stock(s, 'vegetable_soup');
    startCooking(s, ctxAt(s), 'vegetable_soup');
    step(s, ctxAt(s), 60_000);
    expect(s.stats.bestDishTier).toBe(2);
  });

  it('shows what is missing', () => {
    const s = farm();
    expect(canCook(s, RECIPES.roasted_turnip)).toBe(false);
    addItem(s.inventory, 'turnip', 2);
    expect(canCook(s, RECIPES.roasted_turnip)).toBe(true);
  });
});

describe('winter is cooking season', () => {
  it('a dish that finishes in winter is hearty; one that finishes in autumn is not', () => {
    const cook = (t: number): GameState => {
      const s = farm(1, t);
      addItem(s.inventory, 'turnip', 2);
      startCooking(s, ctxAt(s, t), 'roasted_turnip');
      const events: GameEvent[] = [];
      step(s, ctxAt(s, t, events), 30_000);
      expect(events.find((e) => e.type === 'cooked')).toMatchObject({ hearty: t === WINTER });
      return s;
    };
    const winter = cook(WINTER);
    expect(winter.inventory.slots.find((x) => x?.item === 'roasted_turnip')).toEqual({
      item: 'roasted_turnip',
      qty: 1,
      hearty: true,
    });
    expect(cook(AUTUMN).inventory.slots.find((x) => x?.item === 'roasted_turnip')).toEqual({
      item: 'roasted_turnip',
      qty: 1,
    });
  });

  it('hearty and plain copies of a dish stack apart', () => {
    const s = farm(1, WINTER);
    addItem(s.inventory, 'roasted_turnip', 3);
    for (let i = 0; i < 2; i++) {
      addItem(s.inventory, 'turnip', 2);
      startCooking(s, ctxAt(s, WINTER), 'roasted_turnip');
      step(s, ctxAt(s, WINTER), 30_000);
    }
    expect(s.inventory.slots.filter((x) => x?.item === 'roasted_turnip')).toEqual([
      { item: 'roasted_turnip', qty: 3 },
      { item: 'roasted_turnip', qty: 2, hearty: true },
    ]);
  });

  it('a dish that finished in autumn but waited for room is not hearty when it lands in winter', () => {
    const s = farm(1, AUTUMN);
    addItem(s.inventory, 'turnip', 2);
    startCooking(s, ctxAt(s, AUTUMN), 'roasted_turnip');
    s.inventory.slots.fill({ item: 'carp', qty: 99 });
    step(s, ctxAt(s, AUTUMN), 30_000);
    expect(s.kitchen.queue).toHaveLength(1);
    s.inventory.slots[0] = null;
    processCalendar(s, GAME_DATA, NY, WINTER, []);
    step(s, ctxAt(s, WINTER), 100);
    expect(s.inventory.slots[0]).toEqual({ item: 'roasted_turnip', qty: 1 });
  });

  it('dishes sell for 25% more in winter, and only dishes', () => {
    const s = farm(1, WINTER);
    const winterMods = computeModifiers(s, GAME_DATA, 'winter');
    const autumnMods = computeModifiers(s, GAME_DATA, 'autumn');
    expect(winterMods.dishSellBonus).toBe(0.25);
    expect(winterMods.cookingXpBonus).toBe(0.5);
    expect(autumnMods.dishSellBonus).toBe(0);
    expect(computeModifiers(s, GAME_DATA).dishSellBonus).toBe(0);
    const dish = GAME_DATA.items.vegetable_soup!.basePrice;
    expect(unitPrice(s, GAME_DATA, winterMods, 'vegetable_soup')).toBe(Math.floor(dish * 1.25 * 0.9));
    expect(unitPrice(s, GAME_DATA, autumnMods, 'vegetable_soup')).toBe(Math.floor(dish * 0.9));
    expect(unitPrice(s, GAME_DATA, winterMods, 'potato')).toBe(unitPrice(s, GAME_DATA, autumnMods, 'potato'));
  });

  it('the simulation reads the season from the step calendar', () => {
    expect(ctxAt(farm(1, WINTER), WINTER).mods.dishSellBonus).toBe(0.25);
    expect(ctxAt(farm(1, AUTUMN), AUTUMN).mods.dishSellBonus).toBe(0);
  });

  it('selling and shipping take plain dishes first and keep the hearty ones', () => {
    const s = farm(1, WINTER);
    addItem(s.inventory, 'vegetable_soup', 2);
    addItem(s.inventory, 'vegetable_soup', 2, true);
    expect(sellItems(s, ctxAt(s, WINTER), 'vegetable_soup', 3).ok).toBe(true);
    expect(countItem(s.inventory, 'vegetable_soup', false)).toBe(0);
    expect(countItem(s.inventory, 'vegetable_soup', true)).toBe(1);
  });

  it('a hearty dish shipped and taken back out is still hearty', () => {
    const s = farm(1, WINTER);
    addItem(s.inventory, 'vegetable_soup', 1);
    addItem(s.inventory, 'vegetable_soup', 2, true);
    expect(shipItems(s, ctxAt(s, WINTER), 'vegetable_soup', 3).ok).toBe(true);
    expect(s.shippingBin.items).toEqual([
      { item: 'vegetable_soup', qty: 1 },
      { item: 'vegetable_soup', qty: 2, hearty: true },
    ]);
    expect(unshipItems(s, ctxAt(s, WINTER), 'vegetable_soup')).toEqual({ ok: true });
    expect(s.shippingBin.items).toEqual([]);
    expect(countItem(s.inventory, 'vegetable_soup', true)).toBe(2);
    expect(countItem(s.inventory, 'vegetable_soup', false)).toBe(1);
  });

  it('the bin pays the winter price for the dishes in it', () => {
    const s = farm(1, WINTER);
    addItem(s.inventory, 'vegetable_soup', 1);
    shipItems(s, ctxAt(s, WINTER), 'vegetable_soup', 1);
    const ctx = ctxAt(s, WINTER);
    const q = quoteSale(s, GAME_DATA, ctx.mods, 'vegetable_soup', 1, 1);
    expect(q.gold).toBe(Math.floor(GAME_DATA.items.vegetable_soup!.basePrice * 1.25));
  });
});

describe('recipe discovery', () => {
  it('learns milestone recipes when the milestone completes', () => {
    const s = farm();
    expect(knownRecipes(s)).toEqual(['roasted_turnip', 'baked_potato', 'grilled_bluegill']);
    const events: GameEvent[] = [];
    const ctx = ctxAt(s, NOON, events);
    events.push({ type: 'caught', catch: 'bluegill', sizeCm: 10, location: 'pond', viaTrap: false }); // m06
    events.push({ type: 'cooked', recipe: 'roasted_turnip', tier: 3, hearty: false }); // m07 and m12
    events.push({ type: 'purchased', what: 'river', gold: 2000 }); // m10
    setFarmLevel(s, 5); // m11
    runProgression(s, ctx);
    expect(knownRecipes(s)).toEqual([
      'roasted_turnip',
      'baked_potato',
      'grilled_bluegill',
      'seaweed_salad',
      'vegetable_soup',
      'garlic_trout',
      'scholars_stew',
      'garden_banquet',
    ]);
    expect(events.filter((e) => e.type === 'recipeLearned')).toHaveLength(5);
    runProgression(s, ctx);
    expect(events.filter((e) => e.type === 'recipeLearned')).toHaveLength(5); // once only
  });

  it('learns them during the simulation, without any action', () => {
    const s = farm();
    const ctx = ctxAt(s);
    ctx.events.push({ type: 'caught', catch: 'bluegill', sizeCm: 10, location: 'pond', viaTrap: false });
    step(s, ctx, 100);
    expect(s.kitchen.known).toContain('seaweed_salad');
  });

  it('sells recipe cards, showing what locks each one', () => {
    const s = farm();
    const cards = recipeCards(s, GAME_DATA);
    expect(cards).toHaveLength(10);
    expect(cards.map((c) => c.price)).toEqual([...cards.map((c) => c.price)].sort((a, b) => a - b));
    expect(cards[0]).toMatchObject({ id: 'wheat_flatbread', price: 120, unlocked: true });
    expect(cards.find((c) => c.id === 'berry_bowl')).toMatchObject({ unlocked: false });
    expect(cards.find((c) => c.id === 'berry_bowl')!.hint).toMatch(/Farm Level 2/);
    expect(cards.find((c) => c.id === 'moonfin_sushi')!.hint).toBe('Catch a Moonfin first.');
    expect(cards.find((c) => c.id === 'fish_tacos')!.hint).toMatch(/Old Dock/);
  });

  it('buys a recipe card once, for its price, and only when unlocked', () => {
    const s = farm();
    const events: GameEvent[] = [];
    expect(buyRecipe(s, ctxAt(s, NOON, events), 'wheat_flatbread')).toEqual({
      ok: false,
      reason: 'You need 120g for that.',
    });
    s.gold = 1000;
    expect(buyRecipe(s, ctxAt(s, NOON, events), 'berry_bowl').ok).toBe(false); // Farm Level 2
    expect(s.gold).toBe(1000);
    expect(buyRecipe(s, ctxAt(s, NOON, events), 'wheat_flatbread')).toEqual({ ok: true });
    expect(s.gold).toBe(880);
    expect(s.kitchen.known).toContain('wheat_flatbread');
    expect(events.map((e) => e.type)).toEqual(['recipeLearned', 'purchased']);
    expect(why(buyRecipe(s, ctxAt(s), 'wheat_flatbread'))).toMatch(/already know/);
    expect(recipeCards(s, GAME_DATA).find((c) => c.id === 'wheat_flatbread')).toBeUndefined();
    expect(buyRecipe(s, ctxAt(s), 'vegetable_soup').ok).toBe(false); // not for sale
    expect(validateState(s)).toBeNull();
  });

  it('a moonfin card needs the moonfin caught', () => {
    const s = farm();
    s.gold = 20_000;
    expect(buyRecipe(s, ctxAt(s), 'moonfin_sushi').ok).toBe(false);
    s.fishing.collection.moonfin = { firstCaughtAt: '2026-01-28', bestSizeCm: 40, count: 1 };
    expect(buyRecipe(s, ctxAt(s), 'moonfin_sushi').ok).toBe(true);
    expect(s.gold).toBe(8000);
  });

  it('an experiment with the right ingredients teaches the recipe and uses nothing up', () => {
    const s = farm();
    stock(s, 'glazed_yams');
    const before = structuredClone(s.inventory);
    const events: GameEvent[] = [];
    expect(experiment(s, ctxAt(s, NOON, events), ['cranberry', 'yam'])).toEqual({ ok: true });
    expect(s.kitchen.known).toContain('glazed_yams');
    expect(s.inventory).toEqual(before);
    expect(events).toEqual([{ type: 'recipeLearned', recipe: 'glazed_yams', how: 'experiment' }]);
  });

  it('ignores quantities and order, and can also find a card recipe', () => {
    const s = farm();
    addItem(s.inventory, 'wheat', 1);
    addItem(s.inventory, 'cranberry', 1);
    addItem(s.inventory, 'yam', 1);
    expect(experiment(s, ctxAt(s), ['yam', 'wheat', 'cranberry']).ok).toBe(true);
    expect(s.kitchen.known).toContain('cranberry_pie');
  });

  it('a failed experiment loses no ingredients and gives a friendly hint', () => {
    const s = farm();
    addItem(s.inventory, 'corn', 3);
    addItem(s.inventory, 'wheat', 3);
    const before = structuredClone(s.inventory);
    const known = [...s.kitchen.known];
    const r = experiment(s, ctxAt(s), ['corn', 'wheat']);
    expect(r.ok).toBe(false);
    expect(why(r)).toMatch(/nothing came of it/);
    expect(why(r)).toMatch(/Maybe something with/);
    expect(s.inventory).toEqual(before);
    expect(s.kitchen.known).toEqual(known);
  });

  it('the hint names one missing ingredient of an unknown experiment recipe that shares an item', () => {
    const s = farm();
    expect(experimentHint(s, GAME_DATA, ['yam', 'melon'])).toContain('Cranberry'); // glazed yams: yam + cranberry
    s.kitchen.known.push('glazed_yams');
    expect(experimentHint(s, GAME_DATA, ['yam', 'melon'])).toContain('Wheat'); // cranberry pie has yam
    expect(experimentHint(s, GAME_DATA, ['melon', 'koi'])).toContain('Sturgeon'); // royal sturgeon has both
    expect(experimentHint(s, GAME_DATA, ['old_boot', 'driftwood'])).toMatch(/nothing was wasted/);
  });

  it('checks the picks: 2 to 4 distinct ingredients that you have', () => {
    const s = farm();
    addItem(s.inventory, 'corn', 1);
    addItem(s.inventory, 'wheat', 1);
    expect(experiment(s, ctxAt(s), ['corn']).ok).toBe(false);
    expect(experiment(s, ctxAt(s), ['corn', 'corn']).ok).toBe(false);
    expect(why(experiment(s, ctxAt(s), ['corn', 'wheat', 'yam']))).toMatch(/don't have any Yam/);
    expect(experiment(s, ctxAt(s), ['corn', 'wheat', 'yam', 'melon', 'leek']).ok).toBe(false);
    expect(why(experiment(s, ctxAt(s), ['corn', 'seed_turnip'] as never))).toMatch(/isn't an ingredient/);
  });

  it('says so when the picks are a recipe you already know', () => {
    const s = farm();
    s.kitchen.known.push('glazed_yams');
    addItem(s.inventory, 'yam', 1);
    addItem(s.inventory, 'cranberry', 1);
    expect(why(experiment(s, ctxAt(s), ['yam', 'cranberry']))).toMatch(/already know it/);
  });

  it('does not reveal milestone recipes by experiment', () => {
    const s = farm();
    addItem(s.inventory, 'seaweed', 1);
    addItem(s.inventory, 'turnip', 1);
    expect(experiment(s, ctxAt(s), ['seaweed', 'turnip']).ok).toBe(false);
    expect(s.kitchen.known).not.toContain('seaweed_salad');
  });
});

describe('the state stays valid', () => {
  it('a state with dishes cooking, waiting and buffs running validates', () => {
    const s = farm();
    giveBuff(s, 'growth', 2, MIN);
    s.kitchen.queue.push({ recipe: 'baked_potato', remainingMs: 0, hearty: true });
    expect(validateState(s)).toBeNull();
  });

  it('every dish is a sellable item with a sprite name', () => {
    for (const id of RECIPE_IDS) {
      expect(GAME_DATA.items[id]).toMatchObject({ category: 'dish', sellable: true, sprite: `item_${id}` });
    }
  });
});

describe('cooking art', () => {
  it('gives every dish and every buff type its own icon, plus the hearty badge and the chimney steam', () => {
    const dishes = RECIPE_IDS.map((id) => SPRITES[`item_${id}`]);
    for (const d of dishes) expect(d).toBeDefined();
    expect(new Set(dishes.map((d) => d!.frames[0]!.join(''))).size).toBe(22);
    const buffs = BUFF_TYPES.map((t) => SPRITES[GAME_DATA.buffs[t].icon]);
    for (const b of buffs) expect(b).toBeDefined();
    expect(new Set(buffs.map((b) => b!.frames[0]!.join(''))).size).toBe(7);
    expect(SPRITES.ui_hearty).toBeDefined();
    expect(SPRITES.fx_steam!.frames).toHaveLength(3); // ART_STYLE.md: 3 frames, 250 ms
    expect(SPRITES.fx_steam!.frameMs).toBe(250);
    expect(SPRITES.fx_steam!.frameMs).toBeGreaterThan(0);
    expect(ALL_SPRITES.filter((s) => s.id.startsWith('item_') && s.frames.length > 1)).toEqual([]);
  });
});

describe('the market history', () => {
  it('starts a sparkline for a dish once its recipe is known, not before', () => {
    const s = farm();
    processCalendar(s, GAME_DATA, NY, at(NY, 2026, 1, 8, 7), []);
    expect(s.market.items.roasted_turnip?.history.length).toBeGreaterThan(0);
    expect(s.market.items.vegetable_soup).toBeUndefined();
  });
});
