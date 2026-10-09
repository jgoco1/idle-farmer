// The Press House, its drinks and the apiary (v4 phase 03; GDD §13.5–13.6, BALANCE.md §14.4–14.6,
// DATA_SCHEMAS.md §10.4–10.9).

import { describe, expect, it } from 'vitest';
import { applyAction, type Action } from '../src/core/actions';
import type { GameEvent } from '../src/core/events';
import { runOffline } from '../src/core/offline';
import { validateState } from '../src/core/save';
import { makeContext, processCalendar, step } from '../src/core/sim';
import { createInitialState, type GameState } from '../src/core/state';
import { buildCalendar } from '../src/core/time';
import { GAME_DATA, type GameData } from '../src/data';
import {
  HIVE_CYCLE_SEC,
  HIVE_STORE,
  PRESS_SLOT_STORE,
  SERVE_MIN_PER_TIER,
  TIER_PRESS_DIV,
} from '../src/data/balance';
import { BUFF_TYPES } from '../src/data/buffs';
import { DRINK_IDS, type DrinkId, type ItemId } from '../src/data/ids';
import { HIVE, PRESS_HOUSE } from '../src/data/press';
import { RECIPES } from '../src/data/recipes';
import { WORLD_LAYOUT } from '../src/data/world';
import { msToNextSimEvent } from '../src/systems';
import {
  buyHive,
  hiveCycleMs,
  honeyWaiting,
  nextFreeHiveSpot,
  nextHivePrice,
  tickApiary,
} from '../src/systems/apiary';
import { autoSellOn } from '../src/systems/autoSeller';
import { buffSlotCount, dishBuff } from '../src/systems/buffs';
import { bundleBonuses } from '../src/systems/bundles';
import { recipeScore, recipeTier } from '../src/systems/cooking';
import { addItem, countItem } from '../src/systems/inventory';
import { specialCandidates } from '../src/systems/market';
import { computeModifiers } from '../src/systems/modifiers';
import {
  drinkCards,
  knownDrinks,
  maxPressBatch,
  msToNextPressFinish,
  pressBlock,
  pressMs,
  pressSlots,
  tickPress,
} from '../src/systems/press';
import { goalText } from '../src/systems/progression';
import { isUnlocked } from '../src/systems/unlocks';
import { menuSlots, serveIntervalMs } from '../src/systems/restaurant';
import { awayRows } from '../src/ui/awaySummary';
import {
  HIVE_FULL,
  HIVE_NONE,
  HIVE_PLAIN,
  MAX_HIVES,
  MAX_PRESSES,
  PRESS_BUSY,
  PRESS_DONE,
  PRESS_IDLE,
  PRESS_NO_MORE,
  PressLife,
  type PressView,
} from '../src/render/pressLife';
import { buildLayout, buildZones, DEFAULT_LOOK, zoneAt, type SceneLook } from '../src/render/scene';
import { at, HOUR, NY, setFarmLevel } from './helpers';

// Wednesday 7 January 2026, 10:00 (winter in the game's calendar does not matter here).
const CREATED = at(NY, 2026, 1, 7, 10);
const NOON = at(NY, 2026, 1, 7, 12);
const MIN = 60_000;

/** No goals and no perks, so steps of any size report the same (as tests/ranch.test.ts). */
const QUIET: GameData = { ...GAME_DATA, goalTemplates: {} as GameData['goalTemplates'], perks: [] };

function farm(): GameState {
  const s = createInitialState(CREATED, NY, 1);
  s.land.parcels.push('orchard', 'yard');
  s.upgrades.kitchen = 2;
  setFarmLevel(s, 7);
  s.gold = 5_000_000;
  s.inventory.slots.push(...Array.from({ length: 16 }, () => null));
  processCalendar(s, GAME_DATA, NY, NOON, []);
  s.progression.goals = [];
  return s;
}

function ctxFor(s: GameState, t = NOON, events: GameEvent[] = [], data: GameData = GAME_DATA) {
  return makeContext(s, data, buildCalendar(t, s.calendar, NY), events);
}

function act(s: GameState, action: Action, events: GameEvent[] = [], t = NOON) {
  return applyAction(s, ctxFor(s, t, events), action);
}

const why = (r: { ok: boolean; reason?: string }): string => (r.ok ? '' : (r.reason ?? ''));

/** A built Press House at `level`, its milestones done so their rewards do not muddle the numbers. */
function built(level = 1): GameState {
  const s = farm();
  expect(act(s, { type: 'buildPress' }).ok).toBe(true);
  for (let l = 1; l < level; l++) expect(act(s, { type: 'upgradePress' }).ok).toBe(true);
  s.progression.milestones.done.push('m26_first_drink', 'm27_first_honey');
  return s;
}

/** Steps `s` by `total` ms in the given uneven pieces (repeated). */
function stepIn(s: GameState, total: number, pieces: readonly number[], data: GameData = QUIET): void {
  const ctx = ctxFor(s, NOON, [], data);
  let left = total;
  for (let i = 0; left > 0; i++) {
    const d = Math.min(left, pieces[i % pieces.length]!);
    step(s, ctx, d);
    left -= d;
  }
}

describe('the drink data (BALANCE.md §14.4)', () => {
  it('has the twelve drinks of the table (v4-04: the two forage drinks), with their press times, tiers, prices, buffs and discovery', () => {
    const row = (id: DrinkId) => {
      const r = RECIPES[id];
      return [r.cookSec / 60, r.tier, r.basePrice, r.buff, r.discovery.kind];
    };
    expect(DRINK_IDS.map(row)).toEqual([
      [20, 1, 60, 'growth', 'press'],
      [20, 2, 546, 'automationSpeed', 'press'],
      [30, 2, 322, 'fishingSpeed', 'card'],
      [30, 2, 311, 'fishingLuck', 'card'],
      [60, 3, 1360, 'cookSpeed', 'milestone'],
      [90, 3, 944, 'growth', 'card'],
      [60, 3, 1040, 'fishingSpeed', 'card'],
      [60, 3, 978, 'fishingLuck', 'card'],
      [45, 3, 1104, 'xp', 'card'],
      [180, 4, 3372, 'automationSpeed', 'card'],
      [20, 1, 113, 'xp', 'milestone'],
      [60, 3, 528, 'cookSpeed', 'card'],
    ]);
  });

  it('scores drinks with one point per 10 minutes of pressing (the dish divisor would make every drink T4)', () => {
    expect(TIER_PRESS_DIV).toBe(600);
    const score = (id: DrinkId) => Math.round(recipeScore(RECIPES[id], GAME_DATA.items) * 100) / 100;
    expect(score('tomato_juice')).toBe(6.96);
    expect(score('honey_milk')).toBe(11.8);
    expect(score('lemonade')).toBe(25);
    expect(score('orchard_punch')).toBe(59.72);
    for (const id of DRINK_IDS) expect(recipeTier(RECIPES[id], GAME_DATA.items), id).toBe(RECIPES[id].tier);
    // Scored as a dish (30 s a point), even the quickest drink would be T4.
    const asDish = { ...RECIPES.tomato_juice, station: undefined };
    expect(recipeTier(asDish, GAME_DATA.items)).toBe(4);
  });

  it('gives buffs of the existing types only, never Silver Tongue, two of each other type', () => {
    const per = BUFF_TYPES.map((b) => DRINK_IDS.filter((d) => RECIPES[d].buff === b).length);
    expect(Object.fromEntries(BUFF_TYPES.map((b, i) => [b, per[i]]))).toEqual({
      growth: 2,
      sellPrice: 0,
      fishingLuck: 2,
      fishingSpeed: 2,
      cookSpeed: 2, // Lemonade and (v4-04) Elderflower Cordial
      automationSpeed: 2,
      xp: 2, // Hot Cocoa and (v4-04) Herbal Tea
    });
  });

  it('drinks are sellable, edible items of their own category; honey sells, cocoa does not', () => {
    for (const id of DRINK_IDS) {
      const def = GAME_DATA.items[id]!;
      expect(def).toMatchObject({ category: 'drink', sellable: true, edible: true, sprite: `item_${id}` });
    }
    expect(GAME_DATA.items.honey).toMatchObject({ category: 'animal', basePrice: 150, sellable: true });
    expect(GAME_DATA.items.cocoa).toMatchObject({ category: 'ingredient', basePrice: 60, sellable: false });
  });

  it('the Press House and the hives have the numbers of BALANCE.md §14.4–14.5', () => {
    expect(PRESS_HOUSE.levels.map((l) => [l.price, l.slots])).toEqual([
      [90_000, 2],
      [250_000, 3],
      [600_000, 4],
    ]);
    expect(PRESS_HOUSE.shelf.cocoa).toBe(60);
    expect(HIVE).toMatchObject({ basePrice: 10_000, ratio: 1.5, cycleSec: 3600, store: 10 });
    expect(WORLD_LAYOUT.hiveSpots).toHaveLength(6);
    const s = built();
    const prices: number[] = [];
    for (let i = 0; i < 6; i++) {
      prices.push(nextHivePrice(s, GAME_DATA)!);
      expect(act(s, { type: 'buyHive' }).ok).toBe(true);
    }
    expect(prices).toEqual([10_000, 15_000, 23_000, 34_000, 51_000, 76_000]);
    expect(nextHivePrice(s, GAME_DATA)).toBeNull();
  });
});

describe('building the Press House', () => {
  it('needs Farm Level 7 and the orchard parcel, and teaches the two starter drinks', () => {
    const s = farm();
    s.land.parcels = ['yard'];
    expect(pressBlock(s, GAME_DATA)).toMatch(/Orchard/);
    s.land.parcels.push('orchard');
    setFarmLevel(s, 6);
    expect(why(act(s, { type: 'buildPress' }))).toMatch(/Farm Level 7/);
    setFarmLevel(s, 7);
    const gold = s.gold;
    const events: GameEvent[] = [];
    expect(act(s, { type: 'buildPress' }, events).ok).toBe(true);
    expect(s.gold).toBe(gold - 90_000);
    expect(s.press.slots).toHaveLength(2);
    expect(knownDrinks(s)).toEqual(['tomato_juice', 'honey_milk']);
    expect(events.map((e) => e.type)).toEqual(['purchased', 'recipeLearned', 'recipeLearned', 'pressBuilt']);
    expect(why(act(s, { type: 'buildPress' }))).toMatch(/already built/);
    expect(act(s, { type: 'upgradePress' }).ok).toBe(true);
    expect(act(s, { type: 'upgradePress' }).ok).toBe(true);
    expect(pressSlots(s, GAME_DATA)).toBe(4);
    expect(s.press.slots).toHaveLength(4);
    expect(why(act(s, { type: 'upgradePress' }))).toMatch(/fully upgraded/);
    expect(validateState(s)).toBeNull();
  });

  it('sells drink cards in the Press House (Orchard Punch needs level 2) and cocoa on its shelf', () => {
    const s = built();
    const cards = drinkCards(s, GAME_DATA);
    expect(cards.map((c) => c.id)).toEqual([
      'strawberry_cordial',
      'blueberry_cordial',
      'apple_cider',
      'peach_iced_tea',
      'melon_cooler',
      'elderflower_cordial',
      'hot_cocoa',
      'orchard_punch',
    ]);
    expect(cards.reduce((n, c) => n + c.price, 0)).toBe(67_000); // v4-04: with Elderflower Cordial
    expect(cards.find((c) => c.id === 'orchard_punch')).toMatchObject({ unlocked: false });
    expect(why(act(s, { type: 'buyRecipe', recipe: 'orchard_punch' }))).toMatch(/level 2/);
    expect(act(s, { type: 'buyRecipe', recipe: 'hot_cocoa' }).ok).toBe(true);
    expect(knownDrinks(s)).toContain('hot_cocoa');
    const gold = s.gold;
    expect(act(s, { type: 'buyCocoa', qty: 10 }).ok).toBe(true);
    expect(s.gold).toBe(gold - 600);
    expect(countItem(s.inventory, 'cocoa')).toBe(10);
    expect(why(act(s, { type: 'sell', item: 'cocoa', qty: 1 } as Action))).not.toBe('');
  });
});

describe('the presses', () => {
  it('start a known drink from the bag, run its long timer unchanged by Quick Hands, and wait to be collected', () => {
    const s = built();
    addItem(s.inventory, 'tomato', 8);
    expect(why(act(s, { type: 'startPress', slot: 0, recipe: 'lemonade' }))).toMatch(/learned/);
    expect(why(act(s, { type: 'startPress', slot: 0, recipe: 'roasted_turnip' }))).toMatch(/Only drinks/);
    expect(why(act(s, { type: 'cook', recipe: 'tomato_juice' }))).toMatch(/Press House, not on the stove/);
    expect(act(s, { type: 'startPress', slot: 0, recipe: 'tomato_juice' }).ok).toBe(true);
    expect(countItem(s.inventory, 'tomato')).toBe(4);
    expect(s.press.slots[0]).toEqual({
      recipe: 'tomato_juice',
      remainingMs: 20 * MIN,
      done: 0,
      repeat: false,
    });
    expect(why(act(s, { type: 'startPress', slot: 0, recipe: 'tomato_juice' }))).toMatch(/busy/);
    // Quick Hands (cookSpeed) at full strength does not touch the press.
    s.buffs.active.push({
      type: 'cookSpeed',
      magnitude: 1,
      tier: 4,
      remainingMs: 10 * HOUR,
      source: 'lemonade',
    });
    const events: GameEvent[] = [];
    step(s, ctxFor(s, NOON, events, QUIET), 19 * MIN);
    expect(s.press.slots[0]!.remainingMs).toBe(MIN);
    step(s, ctxFor(s, NOON, events, QUIET), MIN);
    expect(s.press.slots[0]).toEqual({ recipe: 'tomato_juice', remainingMs: 0, done: 1, repeat: false });
    expect(events.filter((e) => e.type === 'drinkPressed')).toEqual([
      { type: 'drinkPressed', recipe: 'tomato_juice', slot: 0, tier: 1, auto: false },
    ]);
    expect(s.stats.drinksPressed).toBe(1);
    // A finished drink waits forever; nothing spoils.
    step(s, ctxFor(s, NOON, [], QUIET), 48 * HOUR);
    expect(s.press.slots[0]!.done).toBe(1);
    // Another run of the same drink joins it; a different one must wait until it is collected.
    expect(why(act(s, { type: 'startPress', slot: 0, recipe: 'honey_milk' }))).toMatch(
      /Collect the Tomato Juice/,
    );
    const collect: GameEvent[] = [];
    expect(act(s, { type: 'collectPress', slot: 0 }, collect).ok).toBe(true);
    expect(countItem(s.inventory, 'tomato_juice')).toBe(1);
    expect(collect.find((e) => e.type === 'pressCollected')).toMatchObject({
      qty: 1,
      auto: false,
      shipped: 0,
    });
    expect(why(act(s, { type: 'collectPress' }))).toMatch(/Nothing has finished/);
  });

  it('taking a run off gives its ingredients back (refused if the bag cannot take them)', () => {
    const s = built();
    addItem(s.inventory, 'milk', 1);
    addItem(s.inventory, 'honey', 1);
    expect(act(s, { type: 'startPress', slot: 1, recipe: 'honey_milk', repeat: true }).ok).toBe(true);
    expect(countItem(s.inventory, 'milk') + countItem(s.inventory, 'honey')).toBe(0);
    step(s, ctxFor(s, NOON, [], QUIET), 5 * MIN);
    // Fill the bag so the milk has nowhere to go.
    const free = s.inventory.slots.map((x, i) => (x === null ? i : -1)).filter((i) => i >= 0);
    for (const i of free) s.inventory.slots[i] = { item: 'old_boot', qty: 1 };
    expect(why(act(s, { type: 'cancelPress', slot: 1 }))).toMatch(/no room/);
    expect(s.press.slots[1]!.remainingMs).toBe(15 * MIN);
    for (const i of free) s.inventory.slots[i] = null;
    expect(act(s, { type: 'cancelPress', slot: 1 }).ok).toBe(true);
    expect(countItem(s.inventory, 'milk')).toBe(1);
    expect(countItem(s.inventory, 'honey')).toBe(1);
    expect(s.press.slots[1]).toEqual({ recipe: null, remainingMs: 0, done: 0, repeat: false });
    expect(why(act(s, { type: 'cancelPress', slot: 1 }))).toMatch(/not pressing/);
  });

  it('"keep pressing" starts the same drink again from the bag, and rests when the bag runs out', () => {
    const s = built();
    addItem(s.inventory, 'tomato', 4 * 3);
    expect(act(s, { type: 'startPress', slot: 0, recipe: 'tomato_juice', repeat: true }).ok).toBe(true);
    const events: GameEvent[] = [];
    step(s, ctxFor(s, NOON, events, QUIET), 3 * HOUR);
    expect(s.press.slots[0]).toMatchObject({ remainingMs: 0, done: 3, repeat: true });
    expect(countItem(s.inventory, 'tomato')).toBe(0);
    expect(events.filter((e) => e.type === 'drinkPressed').map((e) => (e as { auto: boolean }).auto)).toEqual(
      [true, true, true],
    );
    expect(events.filter((e) => e.type === 'pressStopped')).toEqual([
      { type: 'pressStopped', recipe: 'tomato_juice', slot: 0, reason: 'ingredients' },
    ]);
    expect(act(s, { type: 'setPressRepeat', slot: 0, repeat: false }).ok).toBe(true);
    expect(s.press.slots[0]!.repeat).toBe(false);
  });

  it('a repeating slot holds at most PRESS_SLOT_STORE finished drinks, then waits; nothing is lost', () => {
    const s = built();
    addItem(s.inventory, 'tomato', 4 * (PRESS_SLOT_STORE + 5));
    act(s, { type: 'startPress', slot: 0, recipe: 'tomato_juice', repeat: true });
    step(s, ctxFor(s, NOON, [], QUIET), 30 * HOUR);
    expect(s.press.slots[0]).toMatchObject({ remainingMs: 0, done: PRESS_SLOT_STORE });
    expect(countItem(s.inventory, 'tomato')).toBe(4 * 5);
  });

  it('reports each finish to msToNextSimEvent, so a restart reads the bag at the right moment', () => {
    const s = built();
    addItem(s.inventory, 'tomato', 8);
    act(s, { type: 'startPress', slot: 0, recipe: 'tomato_juice', repeat: true });
    const ctx = ctxFor(s, NOON, [], QUIET);
    expect(msToNextPressFinish(s)).toBe(20 * MIN);
    expect(msToNextSimEvent(s, ctx)).toBeLessThanOrEqual(20 * MIN);
    tickPress(s, ctx, 7 * MIN);
    expect(msToNextPressFinish(s)).toBe(13 * MIN);
  });

  it('Make ×N counts the free slots and the runs the bag covers', () => {
    const s = built(3);
    addItem(s.inventory, 'tomato', 9);
    expect(maxPressBatch(s, RECIPES.tomato_juice)).toBe(2);
    addItem(s.inventory, 'tomato', 3);
    expect(maxPressBatch(s, RECIPES.tomato_juice)).toBe(3);
    act(s, { type: 'startPress', slot: 0, recipe: 'tomato_juice' });
    expect(maxPressBatch(s, RECIPES.tomato_juice)).toBe(2);
  });
});

describe('drinks give buffs like dishes, in the existing slots', () => {
  it('drinking takes a slot with the tier formula of dishes; there is no separate drink slot', () => {
    const s = built();
    expect(buffSlotCount(s, GAME_DATA)).toBe(3);
    addItem(s.inventory, 'honey_milk', 1);
    addItem(s.inventory, 'tomato_juice', 1);
    addItem(s.inventory, 'roasted_turnip', 1);
    addItem(s.inventory, 'grilled_bluegill', 1);
    expect(act(s, { type: 'eat', dish: 'honey_milk' }).ok).toBe(true);
    const b = dishBuff(GAME_DATA, 'honey_milk', false);
    expect(b).toEqual({ type: 'automationSpeed', tier: 2, magnitude: 0.26, durationMs: 75 * MIN });
    expect(s.buffs.active[0]).toMatchObject({
      type: 'automationSpeed',
      magnitude: 0.26,
      remainingMs: 75 * MIN,
    });
    expect(computeModifiers(s, GAME_DATA, 'spring').automationSpeedModifier).toBeCloseTo(1.26);
    expect(act(s, { type: 'eat', dish: 'roasted_turnip' }).ok).toBe(true); // growth
    expect(act(s, { type: 'eat', dish: 'grilled_bluegill' }).ok).toBe(true); // fishingSpeed: the third slot
    // Tomato juice is growth too: it refreshes the existing buff, and takes no new slot.
    expect(act(s, { type: 'eat', dish: 'tomato_juice' }).ok).toBe(true);
    expect(s.buffs.active).toHaveLength(3);
  });
});

describe('the apiary', () => {
  it('buys hives onto the next free spot, needs the Press House, and stops at six', () => {
    const s = farm();
    expect(why(act(s, { type: 'buyHive' }))).toMatch(/Build the Press House/);
    act(s, { type: 'buildPress' });
    const events: GameEvent[] = [];
    expect(buyHive(s, ctxFor(s, NOON, events)).ok).toBe(true);
    expect(s.apiary.hives).toEqual([{ id: 1, spot: 0, honey: 0, cycleMs: 0 }]);
    expect(events.map((e) => e.type)).toEqual(['purchased', 'hiveBought']);
    for (let i = 1; i < 6; i++) act(s, { type: 'buyHive' });
    expect(s.apiary.hives.map((h) => h.spot)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(nextFreeHiveSpot(s)).toBe(-1);
    expect(why(act(s, { type: 'buyHive' }))).toMatch(/Every hive spot/);
  });

  it('makes a jar an hour into a store of ten; a full hive waits and nothing is lost', () => {
    const s = built();
    act(s, { type: 'buyHive' });
    const events: GameEvent[] = [];
    step(s, ctxFor(s, NOON, events, QUIET), 2 * HOUR + 30 * MIN);
    expect(s.apiary.hives[0]).toMatchObject({ honey: 2, cycleMs: 30 * MIN });
    expect(
      events.filter((e) => e.type === 'honeyMade').reduce((n, e) => n + (e as { qty: number }).qty, 0),
    ).toBe(2);
    step(s, ctxFor(s, NOON, [], QUIET), 100 * HOUR);
    expect(s.apiary.hives[0]).toMatchObject({ honey: HIVE_STORE, cycleMs: 0 });
    const before = structuredClone(s.apiary);
    tickApiary(s, ctxFor(s, NOON, [], QUIET), 50 * HOUR);
    expect(s.apiary).toEqual(before); // a full hive changes nothing
    expect(act(s, { type: 'collectHive', hive: 1 }).ok).toBe(true);
    expect(countItem(s.inventory, 'honey')).toBe(HIVE_STORE);
    expect(s.stats.honeyCollected).toBe(HIVE_STORE);
    expect(why(act(s, { type: 'collectHive' }))).toMatch(/No honey yet/);
    // It starts again from a fresh cycle.
    step(s, ctxFor(s, NOON, [], QUIET), HOUR);
    expect(s.apiary.hives[0]!.honey).toBe(1);
  });

  it('Busy Bees shortens the cycle in whole ms through animalSpeedModifier', () => {
    expect(hiveCycleMs(GAME_DATA, 1)).toBe(HIVE_CYCLE_SEC * 1000);
    expect(hiveCycleMs(GAME_DATA, 1.26)).toBe(Math.round(3_600_000 / 1.26));
    const s = built();
    act(s, { type: 'buyHive' });
    s.buffs.active.push({
      type: 'automationSpeed',
      magnitude: 0.52,
      tier: 4,
      remainingMs: 10 * HOUR,
      source: 'orchard_punch',
    });
    step(s, ctxFor(s, NOON, [], QUIET), 4 * HOUR);
    const speed = computeModifiers(s, GAME_DATA, 'spring').animalSpeedModifier;
    expect(speed).toBeGreaterThan(1);
    expect(s.apiary.hives[0]!.honey).toBe(Math.floor((4 * HOUR) / Math.round(3_600_000 / speed)));
  });

  it('honey collected pays Farming XP and finishes m27 (Honey Cake)', () => {
    const s = farm();
    act(s, { type: 'buildPress' });
    act(s, { type: 'buyHive' });
    step(s, ctxFor(s, NOON, [], QUIET), HOUR);
    const xp = s.progression.skills.farming.xp;
    const events: GameEvent[] = [];
    expect(act(s, { type: 'collectHive' }, events).ok).toBe(true);
    expect(s.progression.skills.farming.xp).toBeGreaterThan(xp);
    expect(s.progression.milestones.done).toContain('m27_first_honey');
    expect(s.kitchen.known).toContain('honey_cake');
  });

  it('never reads decorations: hives make the same honey on a decorated farm', () => {
    const plain = built();
    act(plain, { type: 'buyHive' });
    const decorated = structuredClone(plain);
    decorated.decor.owned.flower_bed = 5;
    decorated.decor.placed.push({ id: 1, decor: 'flower_bed', at: { col: 33, row: -5 } });
    step(plain, ctxFor(plain, NOON, [], QUIET), 7 * HOUR);
    step(decorated, ctxFor(decorated, NOON, [], QUIET), 7 * HOUR);
    expect(decorated.apiary).toEqual(plain.apiary);
  });
});

describe('the Collecting Basket empties hives and finished presses at each bin pickup', () => {
  it('takes honey and drinks into the bag at a pickup, at a quarter of the XP, and restarts a resting press', () => {
    const s = built();
    s.upgrades.ranch_collector = 1;
    act(s, { type: 'buyHive' });
    addItem(s.inventory, 'tomato', 4);
    act(s, { type: 'startPress', slot: 0, recipe: 'tomato_juice', repeat: true });
    const events: GameEvent[] = [];
    step(s, ctxFor(s, NOON, events, QUIET), 3 * HOUR);
    expect(honeyWaiting(s)).toBeLessThan(3);
    expect(countItem(s.inventory, 'honey')).toBeGreaterThan(0);
    expect(countItem(s.inventory, 'tomato_juice')).toBe(1);
    expect(events.some((e) => e.type === 'honeyCollected' && e.auto)).toBe(true);
    expect(events.some((e) => e.type === 'pressCollected' && e.auto)).toBe(true);
    // More tomatoes arrive: the next pickup starts the resting "keep pressing" slot again.
    addItem(s.inventory, 'tomato', 4);
    step(s, ctxFor(s, NOON, [], QUIET), HOUR); // the next pickup
    expect(countItem(s.inventory, 'tomato')).toBe(0);
    expect(s.stats.drinksPressed).toBe(2);
  });

  it('honey and drinks are off for the Auto-Seller by default', () => {
    const s = built();
    s.upgrades.auto_seller = 1;
    expect(autoSellOn(s, GAME_DATA, 'honey')).toBe(false);
    for (const d of DRINK_IDS) expect(autoSellOn(s, GAME_DATA, d), d).toBe(false);
    expect(autoSellOn(s, GAME_DATA, 'cocoa')).toBe(false); // not sellable at all
    expect(act(s, { type: 'setAutoSell', item: 'honey', on: true }).ok).toBe(true);
    expect(why(act(s, { type: 'setAutoSell', item: 'cocoa', on: true }))).toMatch(/cannot be shipped/);
  });
});

describe('offline correctness (one big step equals many small ones)', () => {
  function busy(): GameState {
    const s = built(3);
    for (let i = 0; i < 4; i++) act(s, { type: 'buyHive' });
    s.upgrades.ranch_collector = 1;
    addItem(s.inventory, 'tomato', 4 * 7);
    addItem(s.inventory, 'milk', 3);
    addItem(s.inventory, 'honey', 3);
    act(s, { type: 'startPress', slot: 0, recipe: 'tomato_juice', repeat: true });
    act(s, { type: 'startPress', slot: 1, recipe: 'honey_milk', repeat: true });
    s.apiary.hives[2]!.honey = 9; // fills part-way through
    return s;
  }

  const UNEVEN = [1, 19 * MIN, 1_199_999, 77, 20 * MIN + 1, 41 * MIN, 3_599_999];

  it('12 hours as one step equals 12 hours in uneven steps (presses, restarts, hives and the Basket)', () => {
    const big = busy();
    const small = structuredClone(big);
    step(big, ctxFor(big, NOON, [], QUIET), 12 * HOUR);
    stepIn(small, 12 * HOUR, UNEVEN);
    expect(big).toEqual(small);
    expect(big.stats.drinksPressed).toBe(7 + 3);
    expect(big.stats.honeyCollected).toBeGreaterThan(0);
  });

  it('and without the Basket, with Busy Bees running out part-way', () => {
    const mk = (): GameState => {
      const s = busy();
      s.upgrades.ranch_collector = 0;
      delete s.upgrades.ranch_collector;
      s.buffs.active.push({
        type: 'automationSpeed',
        magnitude: 0.39,
        tier: 3,
        remainingMs: 2 * HOUR + 7,
        source: 'honey_milk',
      });
      return s;
    };
    const big = mk();
    const small = mk();
    step(big, ctxFor(big, NOON, [], QUIET), 9 * HOUR);
    stepIn(small, 9 * HOUR, UNEVEN);
    expect(big).toEqual(small);
    expect(big.apiary.hives.every((h) => h.honey > 0)).toBe(true);
  });

  it('runOffline over a night away presses, fills the hives and the away summary says so', () => {
    const s = busy();
    s.upgrades.ranch_collector = 0;
    delete s.upgrades.ranch_collector;
    const report = runOffline(s, GAME_DATA, NY, NOON, NOON + 8 * HOUR);
    const rows = awayRows(report, { readyPlots: 0, dryPlots: 0 }).map((r) => r.text);
    expect(
      rows.some((r) =>
        /^The presses made \d+ drinks \(\d+ (Tomato Juice|Honey Milk) and 1 other kind\)\.$/.test(r),
      ),
    ).toBe(true);
    expect(rows.some((r) => /^The bees made \d+ jars of honey\.$/.test(r))).toBe(true);
    expect(rows).toContain('2 presses are resting until you bring them more fruit (or make room in them).');
    expect(validateState(s)).toBeNull();
  });
});

describe('drinks at the restaurant and the Market', () => {
  it('a drink goes on the menu and is served every 15 minutes × its tier at the premium', () => {
    const s = built();
    act(s, { type: 'buildRestaurant' });
    s.progression.milestones.done.push('m25_first_serving');
    addItem(s.inventory, 'lemonade', 10);
    expect(act(s, { type: 'stockMenu', slot: 0, item: 'lemonade', qty: 10 }).ok).toBe(true);
    expect(why(act(s, { type: 'stockMenu', slot: 1, item: 'honey', qty: 1 }))).toMatch(/dishes and drinks/);
    expect(serveIntervalMs(GAME_DATA, 'lemonade')).toBe(SERVE_MIN_PER_TIER * MIN * 3);
    const events: GameEvent[] = [];
    step(s, ctxFor(s, NOON, events, QUIET), 3 * HOUR);
    const served = events.filter((e) => e.type === 'served');
    expect(served.reduce((n, e) => n + (e as { qty: number }).qty, 0)).toBe(4);
    const special = served.some((e) => (e as { special: boolean }).special);
    expect(s.stats.restaurantGold).toBe(4 * Math.round(1360 * (special ? 1.45 : 1.3)));
  });

  it('the Press House bundle gives the restaurant its fifth table, now or when it is built', () => {
    const s = built();
    const give: [ItemId, number][] = [
      ['tomato_juice', 5],
      ['honey_milk', 5],
      ['apple_cider', 3],
      ['lemonade', 3],
      ['honey', 10],
    ];
    for (const [item, qty] of give) addItem(s.inventory, item, qty);
    act(s, { type: 'buildRestaurant' });
    act(s, { type: 'upgradeRestaurant' });
    act(s, { type: 'upgradeRestaurant' });
    expect(menuSlots(s, GAME_DATA)).toBe(4);
    for (const [item, qty] of give)
      expect(act(s, { type: 'donate', bundle: 'press_house', item, qty }).ok).toBe(true);
    expect(s.progression.completedBundles).toContain('press_house');
    expect(bundleBonuses(s, GAME_DATA).menuSlots).toBe(1);
    expect(menuSlots(s, GAME_DATA)).toBe(5);
    expect(s.restaurant.menu).toHaveLength(5);
    expect(validateState(s)).toBeNull();
    // Completed before the restaurant: its first level lays three tables.
    const t = built();
    t.progression.completedBundles.push('press_house');
    act(t, { type: 'buildRestaurant' });
    expect(t.restaurant.menu).toHaveLength(3);
  });

  it('known drinks and honey (once a hive stands) join the Market specials pool; a new farm draws as before', () => {
    const s = built();
    expect(specialCandidates(s, GAME_DATA, 'summer')).toContain('honey_milk');
    expect(specialCandidates(s, GAME_DATA, 'summer')).not.toContain('honey');
    act(s, { type: 'buyHive' });
    expect(specialCandidates(s, GAME_DATA, 'summer')).toContain('honey');
    const fresh = createInitialState(CREATED, NY, 1);
    expect(
      specialCandidates(fresh, GAME_DATA, 'spring').some(
        (i) => i === 'honey' || DRINK_IDS.includes(i as DrinkId),
      ),
    ).toBe(false);
  });
});

describe('progression', () => {
  it('the first drink finishes m26 (Lemonade) and pays Cooking XP', () => {
    const s = farm();
    act(s, { type: 'buildPress' });
    addItem(s.inventory, 'tomato', 4);
    act(s, { type: 'startPress', slot: 0, recipe: 'tomato_juice' });
    const xp = s.progression.skills.cooking.xp;
    step(s, ctxFor(s, NOON, [], GAME_DATA), 20 * MIN);
    expect(s.progression.milestones.done).toContain('m26_first_drink');
    expect(s.kitchen.known).toContain('lemonade');
    expect(s.progression.skills.cooking.xp).toBeGreaterThan(xp);
  });

  it('the press_drinks goal asks for one drink per press slot', () => {
    const s = built(2);
    const goal = {
      template: 'press_drinks' as const,
      objective: { kind: 'press' as const, count: pressSlots(s, GAME_DATA) },
      progress: 0,
      rewards: [],
    };
    expect(goalText(GAME_DATA, goal)).toBe('Press 3 drinks');
  });

  it('a drink learned with the Press House does not count toward cooking-goal unlocks', () => {
    const s = farm();
    act(s, { type: 'buildPress' });
    expect(knownDrinks(s)).toHaveLength(2);
    const dishes = s.kitchen.known.filter((id) => !DRINK_IDS.includes(id as DrinkId)).length;
    const cond = [{ kind: 'knownRecipes' as const, count: dishes + 1, minTier: 1 as const }];
    expect(isUnlocked(s, cond, GAME_DATA)).toBe(false);
    expect(pressMs(RECIPES.orchard_punch)).toBe(3 * HOUR);
  });
});

describe('the yard and the hives on the map (render only)', () => {
  const view = (s: GameState): PressView => {
    const slot = new Uint8Array(MAX_PRESSES);
    s.press.slots.forEach(
      (p, i) => (slot[i] = p.remainingMs > 0 ? PRESS_BUSY : p.done > 0 ? PRESS_DONE : PRESS_IDLE),
    );
    const hive = new Uint8Array(MAX_HIVES).fill(HIVE_NONE);
    for (const hv of s.apiary.hives) hive[hv.spot] = hv.honey >= HIVE_STORE ? HIVE_FULL : HIVE_PLAIN;
    return { level: s.press.level, presses: s.press.slots.length, slot, hive };
  };

  it('draws the house, a press per slot and each hive, with bees by day only, never touching the state', () => {
    const s = built(2);
    act(s, { type: 'buyHive' });
    act(s, { type: 'buyHive' });
    const before = JSON.stringify(s);
    const life = new PressLife();
    life.sync(view(s));
    life.update(false);
    expect(life.prepare()).toBe(1 + 3 + 2);
    expect(life.beesShown(false)).toBe(6);
    expect(life.beesShown(true)).toBe(0); // winter: snow caps, no bees
    life.update(true);
    expect(life.beesShown(false)).toBe(0); // night
    expect(new PressLife(() => true).beesShown(false)).toBe(0);
    const pt = { x: 0, y: 0 };
    expect(life.windowOf(0, pt)).toBe(true);
    expect(pt.y).toBeGreaterThan(PressLife.houseRect.y);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('nothing but hives is drawn before the Press House is built', () => {
    const life = new PressLife();
    const hive = new Uint8Array(MAX_HIVES);
    life.sync({ level: 0, presses: 0, slot: new Uint8Array(MAX_PRESSES), hive });
    expect(life.prepare()).toBe(0);
    expect(life.bottomAt(0)).toBe(PRESS_NO_MORE);
  });

  it('the lot sign gives way to the yard once built, and the site and hive spots are zones', () => {
    const grid = GAME_DATA.startGrid;
    const site = WORLD_LAYOUT.pressSite;
    const signAt = (look: SceneLook): boolean =>
      buildLayout(grid, [], [], look).objects.some(
        (o) => o.sprite === 'obj_lot_sign' && o.x >= site.col * 16 && o.x < (site.col + site.cols) * 16,
      );
    expect(signAt({ ...DEFAULT_LOOK })).toBe(true);
    expect(signAt({ ...DEFAULT_LOOK, press: 1 })).toBe(false);
    const zones = buildZones(grid);
    expect(zoneAt(zones, site.col + 1, site.row + 1)?.id).toBe('press');
    for (const t of WORLD_LAYOUT.hiveSpots) expect(zoneAt(zones, t.col, t.row)?.id).toBe('apiary');
  });
});
