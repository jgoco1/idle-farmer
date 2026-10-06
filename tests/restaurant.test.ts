// The restaurant (v4 phase 02, GDD §13.4, BALANCE.md §14.3, DATA_SCHEMAS.md §10.4–10.9).

import { describe, expect, it } from 'vitest';
import { applyAction, type Action } from '../src/core/actions';
import type { GameEvent } from '../src/core/events';
import { runOffline } from '../src/core/offline';
import { makeContext, processCalendar, step } from '../src/core/sim';
import { createInitialState, type GameState } from '../src/core/state';
import { buildCalendar, seasonOfDay, type Calendar } from '../src/core/time';
import { GAME_DATA, type GameData } from '../src/data';
import { MENU_SLOT_CAP, RESTAURANT_MAX_MULT, SERVE_MIN_PER_TIER, SPECIAL_BONUS } from '../src/data/balance';
import { RECIPE_IDS, type RecipeId } from '../src/data/ids';
import { RESTAURANT } from '../src/data/restaurant';
import { awayRows } from '../src/ui/awaySummary';
import { MAX_TABLES, NO_MORE, RestaurantLife, type RestaurantView } from '../src/render/restaurantLife';
import { addItem, countItem } from '../src/systems/inventory';
import { msToNextSimEvent, onDayStarted } from '../src/systems';
import { goalText } from '../src/systems/progression';
import {
  menuSlots,
  msToNextServing,
  restaurantBlock,
  serveIntervalMs,
  servingPrice,
  specialOn,
  tickRestaurant,
  todaysSpecial,
} from '../src/systems/restaurant';
import { at, HOUR, NY, setFarmLevel } from './helpers';

// Wednesday 7 January 2026, 10:00.
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
  s.inventory.slots.push(...Array.from({ length: 8 }, () => null));
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

/** A built restaurant at `level` (the actions have their own tests). */
function opened(level = 1): GameState {
  const s = farm();
  expect(act(s, { type: 'buildRestaurant' }).ok).toBe(true);
  for (let l = 1; l < level; l++) expect(act(s, { type: 'upgradeRestaurant' }).ok).toBe(true);
  s.progression.milestones.done.push('m25_first_serving'); // its 30,000 gold would muddle the takings
  return s;
}

/** A dish that is not today's special at NOON (so prices are the plain premium). */
function plainDish(s: GameState, tier: 1 | 2 | 3 | 4): RecipeId {
  const special = specialOn(
    GAME_DATA,
    buildCalendar(NOON, s.calendar, NY),
    buildCalendar(NOON, s.calendar, NY).dayIndex,
  );
  return RECIPE_IDS.find((id) => GAME_DATA.recipes[id].tier === tier && id !== special)!;
}

describe('the restaurant data (BALANCE.md §14.3)', () => {
  it('has three levels with 2, 3 and 4 slots and the confirmed premiums', () => {
    expect(RESTAURANT.name).toBe('The Bramble Table');
    expect(RESTAURANT.levels.map((l) => [l.price, l.slots, l.premium])).toEqual([
      [120_000, 2, 1.3],
      [350_000, 3, 1.45],
      [800_000, 4, 1.6],
    ]);
    expect(SERVE_MIN_PER_TIER).toBe(20);
    expect(RESTAURANT_MAX_MULT).toBe(1.75);
    expect(SPECIAL_BONUS).toBe(0.15);
    expect(MENU_SLOT_CAP).toBe(99);
  });

  it('the special rota has 28 entries, every T2–T4 dish at least once, seasonal ones in their season', () => {
    const rota = RESTAURANT.specialRota;
    expect(rota).toHaveLength(28);
    for (const id of RECIPE_IDS) if (GAME_DATA.recipes[id].tier >= 2) expect(rota, id).toContain(id);
    for (const id of rota) expect(GAME_DATA.recipes[id].tier).toBeGreaterThanOrEqual(2);
    // Spring's week has the spring feast, summer's the sturgeon, autumn's the harvest feast, winter's the moonfin.
    expect(rota.slice(0, 7)).toContain('garden_banquet');
    expect(rota.slice(7, 14)).toContain('royal_sturgeon');
    expect(rota.slice(14, 21)).toContain('harvest_feast');
    expect(rota.slice(21, 28)).toContain('moonfin_sushi');
  });

  it('needs Farm Level 7, Kitchen Level 2 and the Old Paddock', () => {
    const s = farm();
    expect(restaurantBlock(s, GAME_DATA)).toBeNull();
    s.upgrades.kitchen = 1;
    expect(restaurantBlock(s, GAME_DATA)).toMatch(/Kitchen/);
    s.upgrades.kitchen = 2;
    s.land.parcels = ['orchard'];
    expect(restaurantBlock(s, GAME_DATA)).toMatch(/Old Paddock/);
  });
});

describe('building and upgrading', () => {
  it('builds level 1 with two empty tables, then upgrades to three and four', () => {
    const s = farm();
    const events: GameEvent[] = [];
    expect(why(act(s, { type: 'upgradeRestaurant' }))).toMatch(/Build/);
    expect(act(s, { type: 'buildRestaurant' }, events).ok).toBe(true);
    expect(s.gold).toBe(5_000_000 - 120_000);
    expect(s.restaurant.level).toBe(1);
    expect(s.restaurant.menu).toEqual([
      { item: null, qty: 0, hearty: false, cycleMs: 0 },
      { item: null, qty: 0, hearty: false, cycleMs: 0 },
    ]);
    expect(events).toContainEqual({ type: 'restaurantBuilt', level: 1 });
    expect(events).toContainEqual({ type: 'purchased', what: 'restaurant', gold: 120_000 });
    expect(why(act(s, { type: 'buildRestaurant' }))).toMatch(/already open/);
    expect(act(s, { type: 'upgradeRestaurant' }, events).ok).toBe(true);
    expect(menuSlots(s, GAME_DATA)).toBe(3);
    expect(act(s, { type: 'upgradeRestaurant' }, events).ok).toBe(true);
    expect(s.restaurant.menu).toHaveLength(4);
    expect(events).toContainEqual({ type: 'restaurantUpgraded', level: 3 });
    expect(s.gold).toBe(5_000_000 - 1_270_000);
    expect(why(act(s, { type: 'upgradeRestaurant' }))).toMatch(/fully upgraded/);
  });

  it('refuses without the gold or the requirements, changing nothing', () => {
    const s = farm();
    s.gold = 100_000;
    act(s, { type: 'setMasterVolume', value: 0.8 }); // let progression settle (milestones, goals) first
    const before = structuredClone(s);
    expect(why(act(s, { type: 'buildRestaurant' }))).toMatch(/120,000g/);
    s.gold = 1_000_000;
    s.upgrades.kitchen = 1;
    expect(act(s, { type: 'buildRestaurant' }).ok).toBe(false);
    s.gold = before.gold;
    s.upgrades.kitchen = 2;
    expect(s).toEqual(before);
  });
});

describe('the menu: stocking and clearing, all or nothing', () => {
  it('moves a stack from the bag onto a table and back', () => {
    const s = opened();
    addItem(s.inventory, 'roasted_turnip', 30);
    expect(act(s, { type: 'stockMenu', slot: 0, item: 'roasted_turnip', qty: 20 }).ok).toBe(true);
    expect(countItem(s.inventory, 'roasted_turnip')).toBe(10);
    expect(s.restaurant.menu[0]).toEqual({ item: 'roasted_turnip', qty: 20, hearty: false, cycleMs: 0 });
    expect(act(s, { type: 'stockMenu', slot: 0, item: 'roasted_turnip', qty: 5 }).ok).toBe(true);
    expect(s.restaurant.menu[0]!.qty).toBe(25);
    expect(act(s, { type: 'clearMenuSlot', slot: 0 }).ok).toBe(true);
    expect(countItem(s.inventory, 'roasted_turnip')).toBe(30);
    expect(s.restaurant.menu[0]).toEqual({ item: null, qty: 0, hearty: false, cycleMs: 0 });
  });

  it('keeps hearty and plain stacks apart', () => {
    const s = opened();
    addItem(s.inventory, 'roasted_turnip', 4, true);
    addItem(s.inventory, 'roasted_turnip', 4);
    expect(act(s, { type: 'stockMenu', slot: 0, item: 'roasted_turnip', qty: 4, hearty: true }).ok).toBe(
      true,
    );
    expect(countItem(s.inventory, 'roasted_turnip', true)).toBe(0);
    expect(countItem(s.inventory, 'roasted_turnip', false)).toBe(4);
    expect(why(act(s, { type: 'stockMenu', slot: 0, item: 'roasted_turnip', qty: 1 }))).toMatch(
      /hearty Roasted Turnip/,
    );
    expect(act(s, { type: 'clearMenuSlot', slot: 0 }).ok).toBe(true);
    expect(countItem(s.inventory, 'roasted_turnip', true)).toBe(4);
  });

  it('refuses politely and changes nothing: no table, not a dish, too few, another dish, over the cap', () => {
    const s = opened();
    addItem(s.inventory, 'roasted_turnip', 99);
    addItem(s.inventory, 'roasted_turnip', 10);
    addItem(s.inventory, 'baked_potato', 5);
    addItem(s.inventory, 'turnip', 5);
    expect(act(s, { type: 'stockMenu', slot: 0, item: 'roasted_turnip', qty: 95 }).ok).toBe(true);
    const before = structuredClone(s);
    expect(why(act(s, { type: 'stockMenu', slot: 7, item: 'roasted_turnip', qty: 1 }))).toMatch(
      /no such table/,
    );
    expect(why(act(s, { type: 'stockMenu', slot: 1, item: 'turnip', qty: 1 }))).toMatch(/Only dishes/);
    expect(why(act(s, { type: 'stockMenu', slot: 1, item: 'baked_potato', qty: 6 }))).toMatch(/don't have 6/);
    expect(why(act(s, { type: 'stockMenu', slot: 1, item: 'baked_potato', qty: 0 }))).toMatch(/how many/);
    expect(why(act(s, { type: 'stockMenu', slot: 0, item: 'baked_potato', qty: 1 }))).toMatch(
      /serving Roasted Turnip/,
    );
    expect(why(act(s, { type: 'stockMenu', slot: 0, item: 'roasted_turnip', qty: 5 }))).toMatch(
      /room for 4 more/,
    );
    expect(s).toEqual(before);
  });

  it('a full table changes nothing, and clearing into a full bag is refused, changing nothing', () => {
    const s = opened();
    addItem(s.inventory, 'roasted_turnip', 120);
    expect(act(s, { type: 'stockMenu', slot: 0, item: 'roasted_turnip', qty: 99 }).ok).toBe(true);
    let before = structuredClone(s);
    expect(why(act(s, { type: 'stockMenu', slot: 0, item: 'roasted_turnip', qty: 1 }))).toMatch(/full/);
    expect(s).toEqual(before);
    // Fill every bag slot with something else: the 99 turnips have nowhere to go.
    s.inventory.slots.fill({ item: 'turnip', qty: 99 });
    before = structuredClone(s);
    expect(why(act(s, { type: 'clearMenuSlot', slot: 0 }))).toMatch(/no room for 99 Roasted Turnip/);
    expect(s).toEqual(before);
  });

  it('Restock tops up every table with what it serves, even one that ran out', () => {
    const s = opened();
    addItem(s.inventory, 'roasted_turnip', 10);
    addItem(s.inventory, 'baked_potato', 10);
    act(s, { type: 'stockMenu', slot: 0, item: 'roasted_turnip', qty: 2 });
    act(s, { type: 'stockMenu', slot: 1, item: 'baked_potato', qty: 3 });
    step(s, ctxFor(s, NOON, [], QUIET), 2 * HOUR); // both run out: the turnip after 40 min, the potato after 60
    expect(s.restaurant.menu.map((m) => [m.item, m.qty])).toEqual([
      ['roasted_turnip', 0],
      ['baked_potato', 0],
    ]);
    expect(act(s, { type: 'restockMenu' }).ok).toBe(true);
    expect(s.restaurant.menu.map((m) => m.qty)).toEqual([8, 7]);
    expect(countItem(s.inventory, 'roasted_turnip') + countItem(s.inventory, 'baked_potato')).toBe(0);
    expect(why(act(s, { type: 'restockMenu' }))).toMatch(/Nothing to restock/);
  });
});

describe('serving', () => {
  it('serves one item per 20 minutes × tier, in whole cycles, keeping the remainder', () => {
    const s = opened();
    const t1 = plainDish(s, 1);
    const t3 = plainDish(s, 3);
    addItem(s.inventory, t1, 20);
    addItem(s.inventory, t3, 20);
    act(s, { type: 'stockMenu', slot: 0, item: t1, qty: 20 });
    act(s, { type: 'stockMenu', slot: 1, item: t3, qty: 20 });
    expect(serveIntervalMs(GAME_DATA, t1)).toBe(20 * MIN);
    expect(serveIntervalMs(GAME_DATA, t3)).toBe(60 * MIN);
    const events: GameEvent[] = [];
    step(s, ctxFor(s, NOON, events, QUIET), 2 * HOUR + 10 * MIN);
    expect(s.restaurant.menu[0]).toMatchObject({ qty: 14, cycleMs: 10 * MIN });
    expect(s.restaurant.menu[1]).toMatchObject({ qty: 18, cycleMs: 10 * MIN });
    expect(msToNextServing(GAME_DATA, s.restaurant.menu[1]!)).toBe(50 * MIN);
    const served = events.filter((e) => e.type === 'served');
    expect(served.map((e) => (e.type === 'served' ? [e.slot, e.qty] : null))).toEqual([
      [0, 6],
      [1, 2],
    ]);
  });

  it('pays base × the level premium, straight to the purse, with a goldEarned of source restaurant', () => {
    const s = opened(2);
    const dish = plainDish(s, 2);
    const base = GAME_DATA.items[dish]!.basePrice;
    addItem(s.inventory, dish, 3);
    act(s, { type: 'stockMenu', slot: 0, item: dish, qty: 3 });
    const gold = s.gold;
    const events: GameEvent[] = [];
    step(s, ctxFor(s, NOON, events, QUIET), 40 * MIN);
    const each = Math.round(base * 1.45);
    expect(s.gold - gold).toBe(each);
    expect(s.stats.restaurantGold).toBe(each);
    expect(s.stats.served).toBe(1);
    expect(s.restaurant.today).toMatchObject({ gold: each, served: 1 });
    expect(events).toContainEqual({ type: 'goldEarned', amount: each, source: 'restaurant' });
    expect(events).toContainEqual({
      type: 'served',
      item: dish,
      qty: 1,
      gold: each,
      slot: 0,
      special: false,
    });
  });

  it("the day's special earns +0.15, and never more than 1.75 × base", () => {
    const s = opened(3);
    const cal = buildCalendar(NOON, s.calendar, NY);
    const special = specialOn(GAME_DATA, cal, cal.dayIndex);
    if (!s.kitchen.known.includes(special)) s.kitchen.known.push(special);
    expect(todaysSpecial(s, GAME_DATA, cal)).toBe(special);
    const base = GAME_DATA.items[special]!.basePrice;
    expect(servingPrice(s, GAME_DATA, special, special)).toBe(Math.round(base * 1.75));
    expect(servingPrice(s, GAME_DATA, special, null)).toBe(Math.round(base * 1.6));
    // A steeper premium would pass the cap: it is held at 1.75.
    const steep: GameData = {
      ...GAME_DATA,
      restaurant: {
        ...RESTAURANT,
        levels: [RESTAURANT.levels[0], RESTAURANT.levels[1], { price: 1, slots: 4, premium: 1.7 }],
      },
    };
    expect(servingPrice(s, steep, special, special)).toBe(Math.round(base * 1.75));
    addItem(s.inventory, special, 2);
    act(s, { type: 'stockMenu', slot: 0, item: special, qty: 2 });
    const events: GameEvent[] = [];
    step(s, ctxFor(s, NOON, events, QUIET), 2 * HOUR);
    const served = events.find((e) => e.type === 'served');
    expect(served).toMatchObject({ special: true, gold: 2 * Math.round(base * 1.75) });
  });

  it('there is no special for a recipe the player does not know', () => {
    const s = opened();
    const cal = buildCalendar(NOON, s.calendar, NY);
    s.kitchen.known = s.kitchen.known.filter((id) => id !== specialOn(GAME_DATA, cal, cal.dayIndex));
    expect(todaysSpecial(s, GAME_DATA, cal)).toBeNull();
  });

  it('the special is a calendar fact: the season and weekday of the day pick it, the same however asked', () => {
    const s = farm();
    const cal: Calendar = buildCalendar(NOON, s.calendar, NY);
    for (let d = 0; d < 60; d++) {
      const id = specialOn(GAME_DATA, cal, d);
      const season = ['spring', 'summer', 'autumn', 'winter'].indexOf(seasonOfDay(cal, d));
      const weekday = new Date((cal.dayZero + d) * 86_400_000).getUTCDay();
      expect(id).toBe(RESTAURANT.specialRota[season * 7 + weekday]);
    }
    // Wednesday 7 January 2026 is day 0 and the first week is spring: the rota's spring Wednesday.
    expect(specialOn(GAME_DATA, cal, 0)).toBe(RESTAURANT.specialRota[3]);
  });

  it('never touches the Market: demand, specials, the sparkline and Silver Tongue', () => {
    const s = opened();
    const dish = plainDish(s, 1);
    addItem(s.inventory, dish, 30);
    act(s, { type: 'stockMenu', slot: 0, item: dish, qty: 30 });
    s.buffs.active.push({
      type: 'sellPrice',
      magnitude: 0.5,
      tier: 4,
      remainingMs: 10 * HOUR,
      source: 'harvest_feast',
    });
    const market = structuredClone(s.market);
    const gold = s.gold;
    step(s, ctxFor(s, NOON, [], QUIET), 2 * HOUR);
    expect(s.market).toEqual(market);
    expect(s.gold - gold).toBe(6 * Math.round(GAME_DATA.items[dish]!.basePrice * 1.3));
  });

  it('an empty menu changes nothing, however long', () => {
    const s = opened();
    s.restaurant.menu[0] = { item: 'baked_potato', qty: 0, hearty: false, cycleMs: 0 }; // ran out earlier
    const before = structuredClone(s);
    const events: GameEvent[] = [];
    tickRestaurant(s, ctxFor(s, NOON, events, QUIET), 30 * 24 * HOUR);
    expect(s).toEqual(before);
    expect(events).toEqual([]);
    expect(msToNextServing(GAME_DATA, s.restaurant.menu[0]!)).toBe(Infinity);
  });

  it('reports menuEmpty once when a table runs out, and keeps its dish for Restock', () => {
    const s = opened();
    addItem(s.inventory, 'roasted_turnip', 2);
    act(s, { type: 'stockMenu', slot: 1, item: 'roasted_turnip', qty: 2 });
    const events: GameEvent[] = [];
    const ctx = ctxFor(s, NOON, events, QUIET);
    for (let i = 0; i < 12; i++) step(s, ctx, 10 * MIN);
    expect(events.filter((e) => e.type === 'menuEmpty')).toEqual([
      { type: 'menuEmpty', slot: 1, item: 'roasted_turnip' },
    ]);
    expect(s.restaurant.menu[1]).toEqual({ item: 'roasted_turnip', qty: 0, hearty: false, cycleMs: 0 });
  });

  it('does not split steps: msToNextSimEvent ignores the menu', () => {
    const s = opened();
    addItem(s.inventory, 'roasted_turnip', 5);
    act(s, { type: 'stockMenu', slot: 0, item: 'roasted_turnip', qty: 5 });
    const ctx = ctxFor(s, NOON, [], QUIET);
    const withMenu = msToNextSimEvent(s, ctx);
    s.restaurant.menu[0] = { item: null, qty: 0, hearty: false, cycleMs: 0 };
    expect(msToNextSimEvent(s, ctx)).toBe(withMenu);
  });

  it("the 06:00 refresh starts today's takings again", () => {
    const s = opened();
    s.restaurant.today = { day: 0, gold: 1234, served: 9 };
    const tomorrow = at(NY, 2026, 1, 8, 7);
    onDayStarted(s, ctxFor(s, tomorrow));
    expect(s.restaurant.today).toEqual({ day: 1, gold: 0, served: 0 });
  });
});

describe('offline correctness (one big step equals many small ones)', () => {
  function busy(): GameState {
    const s = opened(1);
    addItem(s.inventory, plainDish(s, 1), 40);
    addItem(s.inventory, plainDish(s, 4), 5);
    addItem(s.inventory, plainDish(s, 2), 30);
    act(s, { type: 'stockMenu', slot: 0, item: plainDish(s, 1), qty: 40 });
    act(s, { type: 'stockMenu', slot: 1, item: plainDish(s, 4), qty: 5 }); // runs out part-way
    return s;
  }

  it('8 hours as one step equals 8 hours in uneven steps', () => {
    const big = busy();
    const small = structuredClone(big);
    step(big, ctxFor(big, NOON, [], QUIET), 8 * HOUR);
    const ctx = ctxFor(small, NOON, [], QUIET);
    const steps = [1, 19 * MIN, 1_199_999, 77, 20 * MIN + 1, 41 * MIN, 3_599_999];
    let left = 8 * HOUR;
    for (let i = 0; left > 0; i++) {
      const d = Math.min(left, steps[i % steps.length]!);
      step(small, ctx, d);
      left -= d;
    }
    expect(big).toEqual(small);
    expect(big.stats.served).toBe(24 + 5);
  });

  it('and across a level upgrade and a restock at the same moment', () => {
    const big = busy();
    const small = structuredClone(big);
    const dish = plainDish(big, 2);
    const run = (s: GameState, pieces: number[]): void => {
      const ctx = ctxFor(s, NOON, [], QUIET);
      for (const d of pieces) step(s, ctx, d);
    };
    run(big, [3 * HOUR + 7]);
    run(small, [...Array.from({ length: 36 }, () => 5 * MIN), 7]);
    for (const s of [big, small]) {
      expect(applyAction(s, ctxFor(s, NOON, [], QUIET), { type: 'upgradeRestaurant' }).ok).toBe(true);
      expect(
        applyAction(s, ctxFor(s, NOON, [], QUIET), { type: 'stockMenu', slot: 2, item: dish, qty: 30 }).ok,
      ).toBe(true);
    }
    run(big, [5 * HOUR]);
    run(
      small,
      Array.from({ length: 300 }, () => MIN),
    );
    expect(big).toEqual(small);
    expect(big.restaurant.menu[2]!.qty).toBe(30 - Math.floor((5 * HOUR) / (40 * MIN)));
  });

  it('runOffline over a night away serves the menu and the away summary says so', () => {
    const s = busy();
    const t0 = NOON;
    const report = runOffline(s, GAME_DATA, NY, t0, t0 + 8 * HOUR);
    const rows = awayRows(report, { readyPlots: 0, dryPlots: 0 }).map((r) => r.text);
    const gold = s.stats.restaurantGold;
    expect(gold).toBeGreaterThan(0);
    expect(rows).toContain(
      `The restaurant served ${s.stats.served} dishes for ${gold.toLocaleString('en-US')}g.`,
    );
    expect(rows).toContain('A table at the restaurant is waiting for more dishes.');
  });
});

describe('progression', () => {
  it('the first serving finishes m25 (30,000 gold)', () => {
    const s = opened();
    s.progression.milestones.done = s.progression.milestones.done.filter((m) => m !== 'm25_first_serving');
    addItem(s.inventory, 'roasted_turnip', 1);
    act(s, { type: 'stockMenu', slot: 0, item: 'roasted_turnip', qty: 1 });
    const gold = s.gold;
    const events: GameEvent[] = [];
    step(s, ctxFor(s, NOON, events), 20 * MIN);
    expect(s.progression.milestones.done).toContain('m25_first_serving');
    expect(s.gold - gold).toBeGreaterThanOrEqual(30_000);
  });

  it('the serve_dishes goal asks for about an hour of the menu, at least 3, once the restaurant is built', () => {
    const s = farm();
    const tpl = GAME_DATA.goalTemplates.serve_dishes;
    expect(tpl.objective.kind).toBe('serve');
    act(s, { type: 'buildRestaurant' });
    addItem(s.inventory, 'roasted_turnip', 10);
    act(s, { type: 'stockMenu', slot: 0, item: 'roasted_turnip', qty: 10 });
    s.progression.goals = [];
    // One T1 table (3 an hour) and an empty one (counted as T2, 1.5): 4.5 → 5.
    const goal = {
      template: 'serve_dishes' as const,
      objective: { kind: 'serve' as const, count: 5 },
      progress: 0,
      rewards: [],
    };
    expect(goalText(GAME_DATA, goal)).toBe('Serve 5 dishes at the restaurant');
    s.progression.goals = [goal];
    step(s, ctxFor(s, NOON), 60 * MIN);
    expect(s.progression.goalsDone + (s.progression.goals[0]?.progress ?? 0)).toBeGreaterThan(0);
  });
});

describe('diners are render only (src/render/restaurantLife.ts)', () => {
  const view = (s: GameState): RestaurantView => {
    const serving = new Uint8Array(MAX_TABLES);
    s.restaurant.menu.forEach((m, i) => (serving[i] = m.qty > 0 ? 1 : 0));
    return { level: s.restaurant.level, tables: s.restaurant.menu.length, serving };
  };

  it('come to the tables that serve, sit, leave when served, and never touch the state or rngState', () => {
    const s = opened(2);
    addItem(s.inventory, 'roasted_turnip', 10);
    act(s, { type: 'stockMenu', slot: 0, item: 'roasted_turnip', qty: 5 });
    act(s, { type: 'stockMenu', slot: 2, item: 'roasted_turnip', qty: 5 });
    const before = JSON.stringify(s);
    const rng = s.rngState;
    const life = new RestaurantLife();
    const v = view(s);
    for (let t = 0; t < 30_000; t += 50) {
      life.sync(v);
      life.update(50, false);
    }
    expect(life.seatedCount).toBe(2);
    expect(life.prepare()).toBe(1 + 3 + 2); // the inn, three tables, two diners
    life.served(0);
    for (let t = 0; t < 30_000; t += 50) life.update(50, false);
    expect(life.seatedCount).toBe(2); // one left and the next one sat down
    // At night everyone dines inside: the terrace empties.
    for (let t = 0; t < 30_000; t += 50) life.update(50, true);
    expect(life.dinerCount).toBe(0);
    expect(JSON.stringify(s)).toBe(before);
    expect(s.rngState).toBe(rng);
  });

  it('under reduced motion a diner simply sits at every serving table by day', () => {
    const s = opened(1);
    addItem(s.inventory, 'roasted_turnip', 2);
    act(s, { type: 'stockMenu', slot: 1, item: 'roasted_turnip', qty: 2 });
    const life = new RestaurantLife(() => true);
    life.sync(view(s));
    life.update(16, false);
    expect(life.seatedCount).toBe(1);
    expect(life.dinerCount).toBe(1);
  });

  it('nothing is drawn before the restaurant is built', () => {
    const life = new RestaurantLife();
    life.sync({ level: 0, tables: 0, serving: new Uint8Array(MAX_TABLES) });
    life.update(1000, false);
    expect(life.prepare()).toBe(0);
    expect(life.bottomAt(0)).toBe(NO_MORE);
    expect(life.steamAt({ x: 0, y: 0 })).toBe(false);
  });

  it('steam rises from the kitchen chimney only while a table serves, and the windows glow per level', () => {
    const s = opened(3);
    const life = new RestaurantLife();
    const pt = { x: 0, y: 0 };
    life.sync(view(s));
    expect(life.steamAt(pt)).toBe(false);
    let windows = 0;
    while (life.windowOf(windows, pt)) windows++;
    expect(windows).toBe(6);
    addItem(s.inventory, 'roasted_turnip', 1);
    act(s, { type: 'stockMenu', slot: 3, item: 'roasted_turnip', qty: 1 });
    life.sync(view(s));
    expect(life.steamAt(pt)).toBe(true);
    expect(pt.y).toBeLessThan(RestaurantLife.innRect.y + 8);
  });
});
