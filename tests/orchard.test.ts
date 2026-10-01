// The orchard (v2 phase 03, GDD §12.3, BALANCE.md §13.5): fruit trees that grow over real calendar days.

import { describe, expect, it } from 'vitest';
import { applyAction, type Action } from '../src/core/actions';
import type { GameEvent } from '../src/core/events';
import { runOffline } from '../src/core/offline';
import { makeContext, processCalendar, step } from '../src/core/sim';
import { createInitialState, emptyPlot, type GameState } from '../src/core/state';
import { buildCalendar } from '../src/core/time';
import { GAME_DATA } from '../src/data';
import { FRUIT_CAP_DAYS, roundNice } from '../src/data/balance';
import { FRUIT_IDS, saplingOf, treeOfFruit, type FruitId } from '../src/data/ids';
import { TREES } from '../src/data/trees';
import { WORLD_LAYOUT } from '../src/data/world';
import { ITEMS } from '../src/data/items';
import { SPRITES } from '../src/render/sprites';
import { fruitLevel, TREE_SPRITE_IDS } from '../src/render/sprites/trees';
import { awayRows } from '../src/ui/awaySummary';
import { shipsAutomatically, setAutoSell } from '../src/systems/autoSeller';
import { msToNextAutomation } from '../src/systems/automation';
import { bundleBonuses } from '../src/systems/bundles';
import { addItem, countItem } from '../src/systems/inventory';
import { specialCandidates, recordHistory } from '../src/systems/market';
import {
  bearsOn,
  daysToMature,
  firstBearingDay,
  freeSpots,
  growOrchard,
  openTreeSpots,
  ownsMatureTree,
  pickableQty,
  stageForAge,
  treeAtTile,
  treeStage,
} from '../src/systems/orchard';
import { goalAchievable, goalText } from '../src/systems/progression';
import { at, HOUR, NY } from './helpers';

// Wednesday 7 January 2026, 10:00. Spring until Sunday 11 January 00:00 (day 4 is the first summer day),
// then summer to day 10 (Jan 17), autumn days 11–17, winter days 18–24, spring again from day 25.
const CREATED = at(NY, 2026, 1, 7, 10);
const dayTime = (d: number): number => at(NY, 2026, 1, 7 + d, 7);

function farm(day = 0): GameState {
  const s = createInitialState(CREATED, NY, 1);
  s.land.parcels.push('orchard');
  s.gold = 1_000_000;
  if (day > 0) processCalendar(s, GAME_DATA, NY, dayTime(day), []);
  return s;
}

function ctxFor(s: GameState, t: number, events: GameEvent[] = []) {
  return makeContext(s, GAME_DATA, buildCalendar(t, s.calendar, NY), events);
}

/** Plants a tree directly (the actions have their own tests). */
function plant(s: GameState, fruit: FruitId, spot: number, plantedDay: number, fruitHanging = 0) {
  const tree = {
    id: s.orchard.trees.reduce((m, t) => Math.max(m, t.id), 0) + 1,
    tree: treeOfFruit(fruit),
    spot,
    plantedDay,
    fruit: fruitHanging,
    lastFruitDay: plantedDay,
  };
  s.orchard.trees.push(tree);
  return tree;
}

/** Runs the daily refresh for each day up to `day`, one at a time, collecting events. */
function daily(s: GameState, upTo: number, events: GameEvent[] = []): GameEvent[] {
  for (let d = s.calendar.maxDayIndex + 1; d <= upTo; d++)
    processCalendar(s, GAME_DATA, NY, dayTime(d), events);
  return events;
}

function act(s: GameState, t: number, action: Action, events: GameEvent[] = []) {
  return applyAction(s, ctxFor(s, t, events), action);
}

describe('tree data (BALANCE.md §13.5)', () => {
  it('has seven trees that cover every season, two of them in winter', () => {
    expect(Object.keys(TREES)).toHaveLength(7);
    for (const season of ['spring', 'summer', 'autumn', 'winter'] as const) {
      const n = Object.values(TREES).filter((t) => t.seasons.includes(season)).length;
      expect(n, season).toBe({ spring: 3, summer: 3, autumn: 3, winter: 2 }[season]);
    }
    expect(
      Object.values(TREES)
        .filter((t) => t.seasons.includes('winter'))
        .map((t) => t.id),
    ).toEqual(['persimmon_tree', 'lemon_tree']);
  });

  it('declares the cap, the sapling price and the XP the formulas give', () => {
    for (const t of Object.values(TREES)) {
      expect(t.fruitCap, t.id).toBe(FRUIT_CAP_DAYS * t.fruitPerDay);
      const v = t.fruitPerDay * t.fruitPrice; // gold per bearing day at base price
      expect(t.saplingPrice, t.id).toBe(roundNice(4 * v * t.seasons.length));
      expect(t.xp, t.id).toBe(Math.max(1, Math.round(t.fruitPrice ** 0.6 / 2)));
      expect(t.id).toBe(treeOfFruit(t.fruit));
    }
  });

  it('makes a sellable fruit item and a bag-only sapling item for every tree', () => {
    for (const f of FRUIT_IDS) {
      expect(ITEMS[f]).toMatchObject({
        category: 'fruit',
        sellable: true,
        basePrice: TREES[treeOfFruit(f)].fruitPrice,
      });
      expect(ITEMS[saplingOf(f)]).toMatchObject({ category: 'sapling', sellable: false });
      expect(SPRITES[ITEMS[f]!.sprite], f).toBeDefined();
      expect(SPRITES[ITEMS[saplingOf(f)]!.sprite], f).toBeDefined();
    }
  });

  it('has ten tree spots, eight open with the parcel and two with the Orchard Basket', () => {
    expect(WORLD_LAYOUT.treeSpots).toHaveLength(10);
    const s = farm();
    expect(openTreeSpots(s, GAME_DATA)).toBe(8);
    s.progression.completedBundles.push('orchard_basket');
    expect(bundleBonuses(s, GAME_DATA).treeSpots).toBe(2);
    expect(openTreeSpots(s, GAME_DATA)).toBe(10);
    expect(openTreeSpots(createInitialState(CREATED, NY, 1), GAME_DATA)).toBe(0); // no parcel, no spots
  });
});

describe('growth stages are derived from age', () => {
  it('sapling below half the days to mature, young until mature, then mature', () => {
    // cherry 3 days: 0–1 sapling, 2 young, 3+ mature; lemon 7 days: 0–3, 4–6, 7+
    const stages = (days: number): string[] =>
      Array.from({ length: days + 2 }, (_, a) => stageForAge({ matureDays: days }, a));
    expect(stages(3)).toEqual(['sapling', 'sapling', 'young', 'mature', 'mature']);
    expect(stages(4)).toEqual(['sapling', 'sapling', 'young', 'young', 'mature', 'mature']);
    expect(stages(5)).toEqual(['sapling', 'sapling', 'sapling', 'young', 'young', 'mature', 'mature']);
    expect(stages(7).indexOf('young')).toBe(4);
    expect(stages(7).indexOf('mature')).toBe(7);
  });

  it('follows the day index, not simulated time or the clock hour', () => {
    const s = farm();
    const t = plant(s, 'pear', 0, 0); // 5 days
    expect(treeStage(GAME_DATA, t, 0)).toBe('sapling');
    expect(treeStage(GAME_DATA, t, 3)).toBe('young');
    expect(treeStage(GAME_DATA, t, 5)).toBe('mature');
    expect(daysToMature(GAME_DATA, t, 2)).toBe(3);
    s.clock.simMs += 1000 * HOUR; // simulated time changes nothing
    expect(treeStage(GAME_DATA, t, 3)).toBe('young');
  });

  it('knows the first day a sapling planted today would bear', () => {
    const cal = buildCalendar(CREATED, createInitialState(CREATED, NY, 1).calendar, NY);
    // cherry (spring only) planted on day 0: mature on day 3, a spring day
    expect(firstBearingDay(TREES.cherry_tree, 0, 0, cal)).toBe(3);
    // peach (summer): mature day 4 = the first summer day
    expect(firstBearingDay(TREES.peach_tree, 0, 0, cal)).toBe(4);
    // pear (autumn): mature on day 5 but bears from autumn, day 11
    expect(firstBearingDay(TREES.pear_tree, 0, 0, cal)).toBe(11);
    expect(bearsOn(TREES.pear_tree, 0, 5, cal)).toBe(false);
    expect(bearsOn(TREES.pear_tree, 0, 11, cal)).toBe(true);
  });
});

describe('fruit at the daily refresh', () => {
  it('appears only on mature days, in season, one day’s worth at a time', () => {
    const s = farm();
    const cherry = plant(s, 'cherry', 0, 0); // spring only, 10 a day, mature on day 3
    daily(s, 2);
    expect(cherry.fruit).toBe(0); // still growing
    daily(s, 3); // Saturday 10 Jan, spring
    expect(cherry.fruit).toBe(10);
    daily(s, 4); // Sunday 11 Jan: summer, the cherry rests
    expect(cherry.fruit).toBe(10);
    expect(cherry.lastFruitDay).toBe(4);
  });

  it('stops at the cap, loses nothing it was holding, and starts again after picking', () => {
    const s = farm();
    const peach = plant(s, 'peach', 0, 0); // summer, 8 a day, cap 32, mature day 4
    daily(s, 4);
    expect(peach.fruit).toBe(8);
    daily(s, 6);
    expect(peach.fruit).toBe(24);
    daily(s, 7);
    expect(peach.fruit).toBe(32);
    daily(s, 9);
    expect(peach.fruit).toBe(32); // full: it just stops adding
    s.orchard.trees[0]!.fruit = 0;
    daily(s, 10);
    expect(peach.fruit).toBe(8);
  });

  it('bears in both seasons of a two-season tree and rests between', () => {
    const s = farm();
    const lemon = plant(s, 'lemon', 0, 0); // winter and spring, 8 a day, cap 32, mature day 7
    daily(s, 17); // days 7–17 are summer and autumn
    expect(lemon.fruit).toBe(0);
    daily(s, 18); // winter
    expect(lemon.fruit).toBe(8);
    daily(s, 24);
    expect(lemon.fruit).toBe(32);
    lemon.fruit = 0;
    daily(s, 25); // spring
    expect(lemon.fruit).toBe(8);
  });

  it('a tree planted today with age 0 bears on the refresh of the day its age reaches the days to mature', () => {
    const s = farm(2);
    const apricot = plant(s, 'apricot', 0, 2); // spring and summer, mature after 4 days = day 6 (summer)
    daily(s, 5);
    expect(apricot.fruit).toBe(0);
    daily(s, 6);
    expect(apricot.fruit).toBe(8);
  });

  it('reports a tree turning mature once, and the fruit that grew', () => {
    const s = farm();
    plant(s, 'peach', 0, 0);
    const events: GameEvent[] = [];
    daily(s, 5, events);
    expect(events.filter((e) => e.type === 'treeMatured')).toEqual([
      { type: 'treeMatured', tree: 'peach_tree', id: 1 },
    ]);
    const grown = events.filter((e) => e.type === 'fruitGrown');
    expect(grown.map((e) => (e.type === 'fruitGrown' ? e.qty : 0))).toEqual([8, 8]);
  });

  it('is the same after one big jump as after every day, including through a season change', () => {
    for (const fruit of FRUIT_IDS) {
      const a = farm();
      const b = farm();
      plant(a, fruit, 0, 0);
      plant(b, fruit, 0, 0);
      daily(a, 30);
      processCalendar(b, GAME_DATA, NY, dayTime(30), []);
      expect(b.orchard, fruit).toEqual(a.orchard);
    }
  });

  it('is not affected by simulated time or the offline cap: 30 days away is 30 days older', () => {
    const s = farm();
    const apple = plant(s, 'apple', 0, 0); // summer and autumn, 10 a day, cap 40
    const from = at(NY, 2026, 1, 7, 12);
    const to = from + 30 * 24 * HOUR;
    const report = runOffline(s, GAME_DATA, NY, from, to);
    expect(report.simulatedMs).toBeLessThanOrEqual(12 * HOUR); // the cap limits timers, not trees
    expect(s.calendar.maxDayIndex).toBe(30);
    expect(apple.fruit).toBe(40); // the summer and autumn fruit filled the tree to its cap and nothing was lost
    expect(s.orchard.trees[0]!.lastFruitDay).toBe(30);
    expect(treeStage(GAME_DATA, apple, 30)).toBe('mature');
  });

  it('several days away give the fruit those days would have, and the away summary says so', () => {
    const s = farm();
    plant(s, 'peach', 0, 0);
    const report = runOffline(s, GAME_DATA, NY, at(NY, 2026, 1, 7, 12), at(NY, 2026, 1, 12, 12)); // days 1–5
    expect(s.orchard.trees[0]!.fruit).toBe(16); // refreshes on day 4 and day 5
    expect(report.events.some((e) => e.type === 'treeMatured')).toBe(true);
    const rows = awayRows(report, { readyPlots: 0, dryPlots: 0 }).map((r) => r.text);
    expect(rows).toContain('Your peach tree is ready to bear.');
    expect(rows.some((r) => /^\+16 fruit grew on the trees \(16 Peach\)/.test(r))).toBe(true);
  });

  it('never shrinks when the clock is set back', () => {
    const s = farm();
    const peach = plant(s, 'peach', 0, 0);
    daily(s, 5);
    expect(peach.fruit).toBe(16);
    processCalendar(s, GAME_DATA, NY, dayTime(1), []);
    expect(peach.fruit).toBe(16);
    expect(peach.lastFruitDay).toBe(5);
    const ctx = ctxFor(s, dayTime(2));
    growOrchard(s, ctx); // a refresh while the clock is back adds nothing
    expect(peach.fruit).toBe(16);
  });
});

describe('buying, planting, moving and removing', () => {
  it('buys a sapling for its price into the bag, only with the orchard', () => {
    const s = farm();
    const before = s.gold;
    expect(act(s, CREATED, { type: 'buySapling', fruit: 'cherry', qty: 2 }).ok).toBe(true);
    expect(s.gold).toBe(before - 12_000);
    expect(countItem(s.inventory, 'sapling_cherry')).toBe(2);
    const bare = createInitialState(CREATED, NY, 1);
    bare.gold = 99_999;
    const r = act(bare, CREATED, { type: 'buySapling', fruit: 'cherry', qty: 1 });
    expect(r).toEqual({ ok: false, reason: 'Buy the Hilltop Orchard first.' });
    expect(act(s, CREATED, { type: 'buySapling', fruit: 'lemon', qty: 0 }).ok).toBe(false);
    s.gold = 100;
    expect(act(s, CREATED, { type: 'buySapling', fruit: 'lemon', qty: 1 }).ok).toBe(false);
  });

  it('plants on a free open spot, using the sapling, with today’s day index', () => {
    const s = farm(3);
    addItem(s.inventory, 'sapling_apple', 1);
    const events: GameEvent[] = [];
    expect(act(s, dayTime(3), { type: 'plantTree', fruit: 'apple', spot: 2 }, events).ok).toBe(true);
    expect(countItem(s.inventory, 'sapling_apple')).toBe(0);
    expect(s.orchard.trees).toEqual([
      { id: 1, tree: 'apple_tree', spot: 2, plantedDay: 3, fruit: 0, lastFruitDay: 3 },
    ]);
    expect(events).toContainEqual({ type: 'treePlanted', tree: 'apple_tree', id: 1 });
    expect(freeSpots(s, GAME_DATA)).toEqual([0, 1, 3, 4, 5, 6, 7]);
  });

  it('refuses a missing sapling, an occupied spot, a locked spot, a bad spot and a farm without the orchard', () => {
    const s = farm();
    expect(act(s, CREATED, { type: 'plantTree', fruit: 'apple', spot: 0 }).ok).toBe(false);
    addItem(s.inventory, 'sapling_apple', 3);
    expect(act(s, CREATED, { type: 'plantTree', fruit: 'apple', spot: 0 }).ok).toBe(true);
    expect(act(s, CREATED, { type: 'plantTree', fruit: 'apple', spot: 0 })).toEqual({
      ok: false,
      reason: 'A tree already grows there.',
    });
    expect(act(s, CREATED, { type: 'plantTree', fruit: 'apple', spot: 8 })).toEqual({
      ok: false,
      reason: 'That spot opens with the Orchard Basket bundle.',
    });
    expect(act(s, CREATED, { type: 'plantTree', fruit: 'apple', spot: 99 }).ok).toBe(false);
    expect(act(s, CREATED, { type: 'plantTree', fruit: 'apple', spot: -1 }).ok).toBe(false);
    s.progression.completedBundles.push('orchard_basket');
    expect(act(s, CREATED, { type: 'plantTree', fruit: 'apple', spot: 8 }).ok).toBe(true);
    const bare = createInitialState(CREATED, NY, 1);
    addItem(bare.inventory, 'sapling_apple', 1);
    expect(act(bare, CREATED, { type: 'plantTree', fruit: 'apple', spot: 0 }).ok).toBe(false);
  });

  it('moving a tree is free and keeps its age and fruit', () => {
    const s = farm(5);
    const peach = plant(s, 'peach', 0, 0, 12);
    const events: GameEvent[] = [];
    expect(act(s, dayTime(5), { type: 'moveTree', id: peach.id, spot: 6 }, events).ok).toBe(true);
    expect(peach).toMatchObject({ spot: 6, plantedDay: 0, fruit: 12 });
    expect(events).toContainEqual({ type: 'treeMoved', tree: 'peach_tree', id: peach.id });
    plant(s, 'cherry', 1, 5);
    expect(act(s, dayTime(5), { type: 'moveTree', id: peach.id, spot: 1 }).ok).toBe(false);
    expect(act(s, dayTime(5), { type: 'moveTree', id: peach.id, spot: 6 }).ok).toBe(false); // already there
    expect(act(s, dayTime(5), { type: 'moveTree', id: 99, spot: 2 }).ok).toBe(false);
  });

  it('removing a tree loses its growth and does not refund the sapling', () => {
    const s = farm(5);
    const peach = plant(s, 'peach', 0, 0, 12);
    const gold = s.gold;
    const events: GameEvent[] = [];
    expect(act(s, dayTime(5), { type: 'removeTree', id: peach.id }, events).ok).toBe(true);
    expect(s.orchard.trees).toEqual([]);
    expect(s.gold).toBe(gold);
    expect(countItem(s.inventory, 'sapling_peach')).toBe(0);
    expect(events).toContainEqual({ type: 'treeRemoved', tree: 'peach_tree', id: peach.id });
    expect(act(s, dayTime(5), { type: 'removeTree', id: peach.id }).ok).toBe(false);
  });

  it('finds the tree under a tile, canopy tile included', () => {
    const s = farm();
    const t = plant(s, 'apple', 0, 0);
    const spot = WORLD_LAYOUT.treeSpots[0]!;
    expect(treeAtTile(s, spot.col, spot.row)).toBe(t);
    expect(treeAtTile(s, spot.col + 1, spot.row + 1)).toBe(t);
    expect(treeAtTile(s, spot.col, spot.row - 1)).toBe(t); // the canopy rises a tile above the spot
    expect(treeAtTile(s, spot.col + 2, spot.row)).toBeUndefined();
  });
});

describe('picking fruit', () => {
  it('a click picks all the fruit into the bag, pays Farming XP and counts it', () => {
    const s = farm(5);
    const peach = plant(s, 'peach', 0, 0, 24);
    const events: GameEvent[] = [];
    const xp = s.progression.skills.farming.xp;
    expect(act(s, dayTime(5), { type: 'pickTree', id: peach.id }, events).ok).toBe(true);
    expect(peach.fruit).toBe(0);
    expect(countItem(s.inventory, 'peach')).toBe(24);
    expect(s.stats.fruitPicked).toBe(24);
    expect(events).toContainEqual({
      type: 'fruitPicked',
      fruit: 'peach',
      qty: 24,
      tree: peach.id,
      auto: false,
      shipped: 0,
    });
    expect(s.progression.skills.farming.xp).toBeGreaterThan(xp);
    expect(s.progression.skills.farming.xp - xp).toBe(24 * TREES.peach_tree.xp);
  });

  it('says why when there is nothing to pick', () => {
    const s = farm(1);
    const young = plant(s, 'pear', 0, 0);
    expect(act(s, dayTime(1), { type: 'pickTree', id: young.id })).toEqual({
      ok: false,
      reason: 'This pear tree is still growing: 4 more days.',
    });
    const s2 = farm(6);
    const resting = plant(s2, 'cherry', 0, 0); // spring only: day 6 is summer
    expect(act(s2, dayTime(6), { type: 'pickTree', id: resting.id }).ok).toBe(false);
    const r = act(s2, dayTime(6), { type: 'pickTree', id: resting.id });
    expect(r.ok === false && r.reason).toMatch(/resting/);
    expect(act(s2, dayTime(6), { type: 'pickTree', id: 77 }).ok).toBe(false);
  });

  it('a full bag leaves the rest on the tree', () => {
    const s = farm(5);
    const peach = plant(s, 'peach', 0, 0, 24);
    // fill every slot but one with something else, then leave room for 5 peaches
    s.inventory.slots = s.inventory.slots.map(() => ({ item: 'turnip', qty: s.inventory.stackSize }));
    s.inventory.slots[0] = { item: 'peach', qty: s.inventory.stackSize - 5 };
    const events: GameEvent[] = [];
    expect(act(s, dayTime(5), { type: 'pickTree', id: peach.id }, events).ok).toBe(true);
    expect(peach.fruit).toBe(19);
    expect(events.some((e) => e.type === 'inventoryFull')).toBe(true);
    expect(act(s, dayTime(5), { type: 'pickTree', id: peach.id }).ok).toBe(false); // no room at all
    expect(peach.fruit).toBe(19);
  });

  it('the Auto-Seller ships fruit by default, and a toggle brings it back to the bag', () => {
    const s = farm(5);
    s.upgrades.auto_seller = 1;
    const peach = plant(s, 'peach', 0, 0, 16);
    expect(shipsAutomatically(s, GAME_DATA, 'peach')).toBe(true);
    const events: GameEvent[] = [];
    act(s, dayTime(5), { type: 'pickTree', id: peach.id }, events);
    expect(countItem(s.inventory, 'peach')).toBe(0);
    expect(s.shippingBin.items).toContainEqual({ item: 'peach', qty: 16 });
    expect(events).toContainEqual(expect.objectContaining({ type: 'fruitPicked', shipped: 16 }));
    expect(setAutoSell(s, GAME_DATA, 'peach', false).ok).toBe(true);
    peach.fruit = 8;
    act(s, dayTime(5), { type: 'pickTree', id: peach.id });
    expect(countItem(s.inventory, 'peach')).toBe(8);
    // level 2 keeps a reserve of 10 in the bag for cooking
    setAutoSell(s, GAME_DATA, 'peach', true);
    s.upgrades.auto_seller = 2;
    peach.fruit = 16;
    act(s, dayTime(5), { type: 'pickTree', id: peach.id });
    expect(countItem(s.inventory, 'peach')).toBe(10);
    expect(s.shippingBin.items.find((i) => i.item === 'peach')!.qty).toBe(16 + 14);
  });

  it('without the Auto-Seller fruit goes to the bag (it is not shipped by default)', () => {
    const s = farm(5);
    expect(shipsAutomatically(s, GAME_DATA, 'peach')).toBe(false);
    const peach = plant(s, 'peach', 0, 0, 8);
    expect(pickableQty(s, GAME_DATA, peach)).toBe(8);
  });

  it('the first fruit is the "Harvest your first fruit" milestone and teaches Baked Apple', () => {
    const s = farm(5);
    const peach = plant(s, 'peach', 0, 0, 8);
    expect(s.kitchen.known).not.toContain('baked_apple');
    act(s, dayTime(5), { type: 'pickTree', id: peach.id });
    expect(s.progression.milestones.done).toContain('m20_first_fruit');
    expect(s.kitchen.known).toContain('baked_apple');
  });
});

describe('the farmhand and the orchard', () => {
  function withFarmhand(): GameState {
    const s = farm(5);
    s.upgrades.farmhand = 1; // capacity 6 per visit
    s.automation.farmhandCooldownMs = 30_000;
    s.inventory.slots = s.inventory.slots.map(() => null);
    return s;
  }

  it('picks ripe trees on its visit, each tree using one of its capacity, at a quarter of the XP', () => {
    const s = withFarmhand();
    for (let i = 0; i < 4; i++) plant(s, 'peach', i, 0, 16);
    const events: GameEvent[] = [];
    const t = dayTime(5);
    step(s, ctxFor(s, t, events), 30_000);
    expect(s.orchard.trees.map((x) => x.fruit)).toEqual([0, 0, 0, 0]);
    expect(countItem(s.inventory, 'peach')).toBe(64);
    const picks = events.filter((e) => e.type === 'fruitPicked');
    expect(picks).toHaveLength(4);
    expect(picks.every((e) => e.type === 'fruitPicked' && e.auto)).toBe(true);
    // a quarter of the hand-picked XP: 64 × 14 × 0.25
    expect(s.progression.skills.farming.xp).toBe(Math.round(64 * 14 * 0.25));
  });

  it('shares its capacity with the plots: trees first, then crops with what is left', () => {
    const s = withFarmhand();
    s.farm.grid = { cols: 4, rows: 2 };
    s.farm.plots = Array.from({ length: 8 }, () => ({
      ...emptyPlot('planted'),
      crop: 'turnip' as const,
      growthMs: 1e9,
    }));
    s.lastPlantedCrop = Array.from({ length: 8 }, () => null);
    for (let i = 0; i < 3; i++) plant(s, 'peach', i, 0, 16);
    step(s, ctxFor(s, dayTime(5)), 30_000);
    expect(s.orchard.trees.every((x) => x.fruit === 0)).toBe(true);
    expect(s.farm.plots.filter((p) => p.state === 'planted')).toHaveLength(5); // 6 − 3 trees = 3 plots harvested
  });

  it('counts a ripe tree as work for the next visit, and a tree it cannot stow as none', () => {
    const s = withFarmhand();
    const ctx = ctxFor(s, dayTime(5));
    expect(msToNextAutomation(s, ctx)).toBe(Infinity);
    plant(s, 'peach', 0, 0, 16);
    expect(msToNextAutomation(s, ctx)).toBe(30_000);
    s.inventory.slots = s.inventory.slots.map(() => ({ item: 'turnip', qty: s.inventory.stackSize }));
    expect(msToNextAutomation(s, ctx)).toBe(Infinity); // no room for the fruit: nothing to do
  });

  it('one big step equals many small ones', () => {
    const big = withFarmhand();
    const small = withFarmhand();
    for (const s of [big, small]) plant(s, 'peach', 0, 0, 16);
    step(big, ctxFor(big, dayTime(5)), 120_000);
    const ctx = ctxFor(small, dayTime(5));
    for (let i = 0; i < 1200; i++) step(small, ctx, 100);
    expect(big.orchard).toEqual(small.orchard);
    expect(big.inventory).toEqual(small.inventory);
    expect(big.clock.simMs).toBe(small.clock.simMs);
  });
});

describe('fruit in the market, goals and the Community Board', () => {
  it('fruit joins the specials and the sparkline once the player has a mature tree / a tree', () => {
    const s = farm();
    expect(specialCandidates(s, GAME_DATA, 'summer')).not.toContain('peach');
    plant(s, 'peach', 0, 0);
    s.calendar.maxDayIndex = 2;
    expect(specialCandidates(s, GAME_DATA, 'summer')).not.toContain('peach'); // not mature yet
    s.calendar.maxDayIndex = 4;
    expect(ownsMatureTree(s, GAME_DATA, 'peach', 4)).toBe(true);
    expect(specialCandidates(s, GAME_DATA, 'summer')).toContain('peach');
    expect(s.market.items.peach?.history ?? []).toHaveLength(0);
    recordHistory(s, GAME_DATA);
    expect(s.market.items.peach?.history).toHaveLength(1);
    expect(s.market.items.cherry).toBeUndefined(); // no cherry tree, no cherry line
  });

  it('the "pick fruit" goal needs a mature tree in season and reads naturally', () => {
    const s = farm(5);
    s.progression.milestones.done.push('m20_first_fruit');
    plant(s, 'peach', 0, 0);
    const goal = {
      template: 'pick_fruit' as const,
      objective: { kind: 'pickFruit' as const, fruit: 'peach' as const, count: 8 },
      progress: 0,
      rewards: [],
    };
    expect(goalText(GAME_DATA, goal)).toBe('Pick 8 Peaches');
    expect(goalAchievable(s, GAME_DATA, 'summer', goal)).toBe(true);
    expect(goalAchievable(s, GAME_DATA, 'winter', goal)).toBe(false); // out of season
    s.orchard.trees = [];
    expect(goalAchievable(s, GAME_DATA, 'summer', goal)).toBe(false); // no tree
  });

  it('picking counts toward a pick-fruit goal', () => {
    const s = farm(5);
    s.progression.milestones.done.push('m20_first_fruit');
    const peach = plant(s, 'peach', 0, 0, 16);
    s.progression.goals = [
      {
        template: 'pick_fruit',
        objective: { kind: 'pickFruit', fruit: 'peach', count: 20 },
        progress: 0,
        rewards: [{ kind: 'gold', amount: 500 }],
      },
    ];
    act(s, dayTime(5), { type: 'pickTree', id: peach.id });
    expect(s.progression.goals.find((g) => g.template === 'pick_fruit')?.progress).toBe(16);
  });

  it('the Orchard Basket takes fruit and opens the last two tree spots', () => {
    const s = farm();
    for (const [item, qty] of [
      ['cherry', 10],
      ['peach', 10],
      ['apple', 10],
      ['pear', 10],
      ['lemon', 5],
    ] as const) {
      s.inventory.stackSize = 99;
      addItem(s.inventory, item, qty);
      expect(act(s, CREATED, { type: 'donate', bundle: 'orchard_basket', item, qty }).ok).toBe(true);
    }
    expect(s.progression.completedBundles).toContain('orchard_basket');
    expect(openTreeSpots(s, GAME_DATA)).toBe(10);
  });
});

describe('tree art', () => {
  it('has a sapling, a young tree, four seasonal mature trees and three fruit overlays for every tree', () => {
    for (const f of FRUIT_IDS) {
      const ids = TREE_SPRITE_IDS[f];
      for (const id of [ids.sapling, ids.young, ...ids.mature, ...ids.fruit]) {
        const def = SPRITES[id];
        expect(def, id).toBeDefined();
        expect([def!.frames[0]![0]!.length, def!.frames[0]!.length], id).toEqual([32, 48]);
      }
      for (const id of [ids.sapling, ids.young, ...ids.mature])
        expect(SPRITES[id]!.anchor).toBe('bottom-center');
      // every look is its own picture: stages and seasons differ
      const looks = new Set(
        [ids.sapling, ids.young, ...ids.mature].map((id) => SPRITES[id]!.frames[0]!.join('')),
      );
      expect(looks.size, f).toBe(6);
    }
  });

  it('shows more fruit on fuller trees', () => {
    expect([
      fruitLevel(1, 40),
      fruitLevel(13, 40),
      fruitLevel(14, 40),
      fruitLevel(26, 40),
      fruitLevel(27, 40),
      fruitLevel(40, 40),
    ]).toEqual([0, 0, 1, 1, 2, 2]);
    const count = (id: string): number => SPRITES[id]!.frames[0]!.join('').replace(/\./g, '').length;
    for (const f of FRUIT_IDS) {
      const [a, b, c] = TREE_SPRITE_IDS[f].fruit.map(count) as [number, number, number];
      expect(a).toBeLessThan(b);
      expect(b).toBeLessThan(c);
    }
  });

  it('keeps fruit inside the canopy: no fruit pixel on a sprite edge', () => {
    for (const f of FRUIT_IDS)
      for (const id of TREE_SPRITE_IDS[f].fruit) {
        const rows = SPRITES[id]!.frames[0]!;
        for (const row of rows) expect(row[0] === '.' && row[31] === '.').toBe(true);
        expect(rows[0]!.replace(/\./g, '')).toBe('');
      }
  });
});

describe('first fruit by tree (the simulator’s calendar)', () => {
  it('every tree bears for the first time on the day its age reaches the days to mature, or when its season begins', async () => {
    const { firstFruitTimes } = await import('../scripts/sim/trees');
    const rows = firstFruitTimes();
    expect(rows).toHaveLength(7);
    for (const r of rows) {
      expect(r.firstFruitDays, r.fruit).not.toBeNull();
      expect(r.firstFruitDays!, r.fruit).toBeGreaterThanOrEqual(r.matureDays);
      expect(TREES[treeOfFruit(r.fruit)].seasons, r.fruit).toContain(r.season);
    }
    // planted on Wednesday 25 February 2026: spring, then summer from Sunday 1 March (day 4)
    const by = Object.fromEntries(rows.map((r) => [r.fruit, r.firstFruitDays]));
    expect(by.cherry).toBe(3); // mature on day 3 (Saturday 28 Feb), still spring
    expect(by.apricot).toBe(4); // day 4 is the first summer day
    expect(by.peach).toBe(4);
  });
});
