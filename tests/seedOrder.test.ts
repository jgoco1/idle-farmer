// Seed Order (v2 phase 06): the farmhand upgrade that buys the planter's seeds at each Shipping Bin pickup.

import { describe, expect, it } from 'vitest';
import { applyAction } from '../src/core/actions';
import type { GameEvent } from '../src/core/events';
import { runOffline, type StepFn } from '../src/core/offline';
import { makeContext, processCalendar, step } from '../src/core/sim';
import { createInitialState, emptyPlot, type GameState } from '../src/core/state';
import { buildCalendar } from '../src/core/time';
import { GAME_DATA, type GameData } from '../src/data';
import { BIN_PICKUP_MS, SEED_ORDER_FEE } from '../src/data/balance';
import { seedOf, type CropId, type UpgradeId } from '../src/data/ids';
import { UPGRADES } from '../src/data/upgrades';
import { addItem, countItem } from '../src/systems/inventory';
import { msToNextPickup } from '../src/systems/shippingBin';
import { orderCost, orderedCrops, reserveOf, runSeedOrder, seedTarget } from '../src/systems/seedOrder';
import { buyUpgrade, requirementsFor, upgradeCost } from '../src/systems/upgrades';
import { awayRows } from '../src/ui/awaySummary';
import { at, HOUR, NY, setFarmLevel } from './helpers';

const WED = at(NY, 2026, 1, 7, 10); // spring until Sunday 11 Jan 00:00
const SAT_EVENING = at(NY, 2026, 1, 10, 20);
const SAT_LATE = at(NY, 2026, 1, 10, 23, 59); // one minute before summer
const MIN = 60_000;

/** No goals and no perks: progression draws goals with the seeded generator at the end of a step, which depends on step size by design. */
const QUIET: GameData = { ...GAME_DATA, goalTemplates: {} as GameData['goalTemplates'], perks: [] };

function farmAt(t = WED): GameState {
  const s = createInitialState(WED, NY, 1);
  processCalendar(s, GAME_DATA, NY, t, []);
  setFarmLevel(s, 10);
  return s;
}

function ctxAt(s: GameState, t = WED, events: GameEvent[] = [], data: GameData = GAME_DATA) {
  return makeContext(s, data, buildCalendar(t, s.calendar, NY), events);
}

function own(s: GameState, levels: Partial<Record<UpgradeId, number>>): void {
  Object.assign(s.upgrades, levels);
  if (levels.farmhand) {
    s.automation.farmhandCooldownMs =
      GAME_DATA.upgrades.farmhand!.effect[levels.farmhand]!.intervalSec! * 1000;
  }
}

/** Marks crops as last planted by the planter (on the first plots), with an empty bag of seeds. */
function planterUses(s: GameState, ...crops: CropId[]): void {
  s.inventory.slots = s.inventory.slots.map(() => null);
  s.inventory.stackSize = 999;
  crops.forEach((c, i) => (s.lastPlantedCrop[i] = c));
}

function order(s: GameState, t = WED): GameEvent[] {
  const events: GameEvent[] = [];
  runSeedOrder(s, ctxAt(s, t, events));
  return events;
}

const ordered = (events: GameEvent[]) =>
  events.flatMap((e) => (e.type === 'seedsOrdered' ? [`${e.crop}:${e.qty}:${e.gold}`] : []));

describe('Seed Order: the upgrade', () => {
  it('is a three-level upgrade after the Seed Planter, with targets of 20, 50 and 100 seeds', () => {
    const def = UPGRADES.seed_order!;
    expect(def.max).toBe(3);
    expect([0, 1, 2].map((n) => upgradeCost(def, n))).toEqual([4000, 12000, 36000]);
    expect(def.effect.map((e) => e.seedTarget ?? 0)).toEqual([0, 20, 50, 100]);
    expect(def.effectText).toHaveLength(4);
    expect(requirementsFor(def, 0)).toEqual([{ kind: 'upgrade', id: 'seed_planter', level: 1 }]);
  });

  it('cannot be bought without a Seed Planter, and can with one', () => {
    const s = farmAt();
    s.gold = 50_000;
    expect(buyUpgrade(s, ctxAt(s), 'seed_order').ok).toBe(false);
    own(s, { farmhand: 1, seed_planter: 1 });
    expect(buyUpgrade(s, ctxAt(s), 'seed_order').ok).toBe(true);
    expect(s.upgrades.seed_order).toBe(1);
    expect(s.gold).toBe(46_000);
  });

  it('starts with a 25% reserve and nothing opted out; the bin reports its pickups once it is owned', () => {
    const s = farmAt();
    expect(s.seedOrder).toEqual({ reservePct: 25, off: [] });
    expect(msToNextPickup(s)).toBe(Infinity);
    own(s, { seed_order: 1 });
    expect(msToNextPickup(s)).toBe(BIN_PICKUP_MS);
  });
});

describe('Seed Order: what it buys', () => {
  it('buys nothing without the upgrade', () => {
    const s = farmAt();
    planterUses(s, 'turnip');
    s.gold = 5000;
    expect(order(s)).toEqual([]);
    expect(seedTarget(s, GAME_DATA)).toBe(0);
  });

  it('only crops the planter last planted, in season and ripe before the season ends', () => {
    const s = farmAt();
    own(s, { seed_order: 1 });
    s.gold = 100_000;
    // turnip and strawberry are spring crops; wheat is not; potato is in season but was never planted.
    planterUses(s, 'turnip', 'wheat', 'strawberry');
    expect(orderedCrops(s, ctxAt(s))).toEqual(['turnip', 'strawberry']);
    const bought = order(s);
    expect(ordered(bought).map((x) => x.split(':')[0])).toEqual(['turnip', 'strawberry']);
    expect(countItem(s.inventory, seedOf('wheat'))).toBe(0);
    expect(countItem(s.inventory, seedOf('potato'))).toBe(0);
  });

  it('skips a crop that would not finish before the season changes, but not one that grows next season too', () => {
    const s = farmAt(SAT_LATE);
    own(s, { seed_order: 1 });
    s.gold = 100_000;
    // One minute to summer: a 2 minute turnip (spring only) cannot finish; garlic also grows in winter, not summer, so it cannot either.
    planterUses(s, 'turnip', 'garlic');
    expect(orderedCrops(s, ctxAt(s, SAT_LATE))).toEqual([]);
    expect(order(s, SAT_LATE)).toEqual([]);
    // Wheat grows in summer and autumn; the day before summer it is still out of season now.
    planterUses(s, 'wheat');
    expect(order(s, SAT_LATE)).toEqual([]);
  });

  it('tops the bag up to the level target, counting the seeds already there', () => {
    for (const [level, target] of [
      [1, 20],
      [2, 50],
      [3, 100],
    ] as const) {
      const s = farmAt();
      own(s, { seed_order: level });
      s.gold = 1_000_000;
      s.inventory.stackSize = 999;
      planterUses(s, 'turnip');
      addItem(s.inventory, seedOf('turnip'), 7);
      const events = order(s);
      expect(countItem(s.inventory, seedOf('turnip'))).toBe(target);
      expect(ordered(events)).toEqual([`turnip:${target - 7}:${orderCost(GAME_DATA, 'turnip', target - 7)}`]);
    }
  });

  it('buys nothing for a crop whose bag is already at the target', () => {
    const s = farmAt();
    own(s, { seed_order: 1 });
    s.gold = 5000;
    planterUses(s, 'turnip');
    addItem(s.inventory, seedOf('turnip'), 20);
    expect(order(s)).toEqual([]);
    expect(s.gold).toBe(5000);
  });

  it('charges the Shop price plus the delivery fee, rounded up', () => {
    expect(SEED_ORDER_FEE).toBe(0.1);
    expect(orderCost(GAME_DATA, 'turnip', 20)).toBe(8 * 20 + 16);
    expect(orderCost(GAME_DATA, 'strawberry', 20)).toBe(52 * 20 + 104);
    expect(orderCost(GAME_DATA, 'potato', 3)).toBe(19 * 3 + 6); // 5.7 rounds up
    const s = farmAt();
    own(s, { seed_order: 1 });
    s.gold = 5000;
    planterUses(s, 'turnip');
    order(s);
    expect(s.gold).toBe(5000 - 176);
  });
});

describe('Seed Order: the gold reserve', () => {
  it('is a percentage of the gold held, floored', () => {
    const s = farmAt();
    s.gold = 999;
    s.seedOrder.reservePct = 25;
    expect(reserveOf(s, s.gold)).toBe(249);
    s.seedOrder.reservePct = 0;
    expect(reserveOf(s, s.gold)).toBe(0);
  });

  it('is never crossed: an order that would dip below it waits, and nothing is spent', () => {
    const s = farmAt();
    own(s, { seed_order: 1 });
    s.seedOrder.reservePct = 50;
    s.gold = 300; // reserve 150; 20 turnip seeds cost 176 → 124 left
    planterUses(s, 'turnip');
    expect(order(s)).toEqual([]);
    expect(s.gold).toBe(300);
    expect(countItem(s.inventory, seedOf('turnip'))).toBe(0);
    s.gold = 352; // reserve 176, exactly what is left after the order
    expect(ordered(order(s))).toEqual(['turnip:20:176']);
    expect(s.gold).toBe(176);
  });

  it('holds across crops: later crops see the gold the earlier ones left, against the reserve fixed at the start', () => {
    const s = farmAt();
    own(s, { seed_order: 1 });
    s.seedOrder.reservePct = 25;
    s.gold = 2000; // reserve 500
    planterUses(s, 'turnip', 'potato', 'strawberry'); // 176, 418, 1144 → turnip and potato fit (1406 left), strawberry would leave 262
    const events = order(s);
    expect(ordered(events)).toEqual(['turnip:20:176', 'potato:20:418']);
    expect(s.gold).toBeGreaterThanOrEqual(500);
  });

  it('a reserve of none spends down to zero', () => {
    const s = farmAt();
    own(s, { seed_order: 1 });
    s.seedOrder.reservePct = 0;
    s.gold = 176;
    planterUses(s, 'turnip');
    expect(ordered(order(s))).toEqual(['turnip:20:176']);
    expect(s.gold).toBe(0);
  });

  it('the setting only accepts the offered percentages', () => {
    const s = farmAt();
    for (const pct of [0, 10, 25, 50]) {
      expect(applyAction(s, ctxAt(s), { type: 'setSeedOrderReserve', pct }).ok).toBe(true);
      expect(s.seedOrder.reservePct).toBe(pct);
    }
    expect(applyAction(s, ctxAt(s), { type: 'setSeedOrderReserve', pct: 30 }).ok).toBe(false);
    expect(s.seedOrder.reservePct).toBe(50);
  });
});

describe('Seed Order: bag space and opt-outs', () => {
  it('is all or nothing per crop: a bag that cannot hold the whole order gets none of it', () => {
    const s = farmAt();
    own(s, { seed_order: 1 });
    s.gold = 5000;
    planterUses(s, 'turnip', 'potato');
    s.inventory.stackSize = 99;
    // Fill every slot but one with logs of junk; the last slot takes 99 of a seed, so the whole order fits...
    const filler = 'moss' as never;
    s.inventory.slots = s.inventory.slots.map((_, i) => (i === 0 ? null : { item: filler, qty: 1 }));
    expect(ordered(order(s)).length).toBe(1); // the only free slot goes to the first crop
    expect(countItem(s.inventory, seedOf('turnip'))).toBe(20);
    expect(countItem(s.inventory, seedOf('potato'))).toBe(0); // nothing half-bought
  });

  it('a crop whose seeds do not fit leaves the gold alone', () => {
    const s = farmAt();
    own(s, { seed_order: 1 });
    s.gold = 5000;
    planterUses(s, 'turnip');
    s.inventory.stackSize = 99;
    s.inventory.slots = s.inventory.slots.map(() => ({ item: 'moss' as never, qty: 1 }));
    expect(order(s)).toEqual([]);
    expect(s.gold).toBe(5000);
  });

  it('skips opted-out crops, and the opt-out can be turned back on', () => {
    const s = farmAt();
    own(s, { seed_order: 1 });
    s.gold = 100_000;
    planterUses(s, 'turnip', 'potato');
    expect(applyAction(s, ctxAt(s), { type: 'setSeedOrderCrop', crop: 'turnip', on: false }).ok).toBe(true);
    expect(s.seedOrder.off).toEqual(['turnip']);
    expect(ordered(order(s)).map((x) => x.split(':')[0])).toEqual(['potato']);
    applyAction(s, ctxAt(s), { type: 'setSeedOrderCrop', crop: 'turnip', on: true });
    applyAction(s, ctxAt(s), { type: 'setSeedOrderCrop', crop: 'turnip', on: true }); // idempotent
    expect(s.seedOrder.off).toEqual([]);
    expect(ordered(order(s)).map((x) => x.split(':')[0])).toEqual(['turnip']);
  });
});

/** A small automated farm: field of 4 × 2 tilled plots, a farmhand, the planter, an Auto-Seller and the order. */
function automatedFarm(t: number, seeds = 8): GameState {
  const s = farmAt(t);
  s.farm.grid = { cols: 4, rows: 2 };
  s.farm.plots = Array.from({ length: 8 }, () => emptyPlot('tilled'));
  s.lastPlantedCrop = Array.from({ length: 8 }, () => 'turnip' as CropId);
  planterUses(s);
  s.lastPlantedCrop = Array.from({ length: 8 }, () => 'turnip' as CropId);
  own(s, { farmhand: 2, seed_planter: 3, auto_seller: 1, seed_order: 1 });
  s.progression.goals = []; // goals are paid when progression reads the events, which differs by step size
  s.gold = 3000;
  addItem(s.inventory, seedOf('turnip'), seeds);
  for (const p of s.farm.plots) p.waterMsLeft = 24 * HOUR;
  return s;
}

/** One state to compare: everything the systems own. */
function settled(s: GameState): GameState {
  const c = structuredClone(s);
  for (const e of Object.values(c.market.items)) if (e) e.demand = Math.round(e.demand * 1e9) / 1e9;
  c.progression.milestones.done.sort();
  return c;
}

describe('Seed Order: offline correctness', () => {
  it('one big step equals many small ones over a day with a pickup every hour', () => {
    const big = automatedFarm(WED);
    const small = structuredClone(big);
    step(big, ctxAt(big, WED, [], QUIET), 24 * HOUR);
    const ctx = ctxAt(small, WED, [], QUIET);
    for (let i = 0; i < 24 * 12; i++) step(small, ctx, 5 * MIN);
    expect(settled(big)).toEqual(settled(small));
    expect(big.stats.itemsShipped).toBeGreaterThan(0);
  });

  it('and equals uneven steps that straddle the pickups', () => {
    const steps = [1, 29 * MIN, 3_599_999, 77, 3_600_001, 40 * MIN, 5 * HOUR - 1, 55 * MIN, 9 * HOUR];
    const total = steps.reduce((a, b) => a + b, 0);
    const big = automatedFarm(WED);
    const small = structuredClone(big);
    step(big, ctxAt(big, WED, [], QUIET), total);
    const ctx = ctxAt(small, WED, [], QUIET);
    for (const ms of steps) step(small, ctx, ms);
    expect(settled(big)).toEqual(settled(small));
  });

  it('runOffline across the change of season: the same whether each segment is one step or many', () => {
    // Saturday 20:00 → Sunday 04:00 crosses the turn from spring to summer.
    const make = (): GameState => {
      const s = automatedFarm(SAT_EVENING);
      return s;
    };
    const a = make();
    const b = make();
    const chopped: StepFn = (state, ctx, dt) => {
      let left = dt;
      while (left > 0) {
        const d = Math.min(left, 7 * MIN + 1013);
        step(state, ctx, d);
        left -= d;
      }
    };
    const ra = runOffline(a, QUIET, NY, SAT_EVENING, SAT_EVENING + 8 * HOUR);
    const rb = runOffline(b, QUIET, NY, SAT_EVENING, SAT_EVENING + 8 * HOUR, chopped);
    expect(settled(a)).toEqual(settled(b));
    expect(ra.seasonChanges).toEqual(['summer']);
    const seen = (r: typeof ra) =>
      r.events.flatMap((e) => (e.type === 'seedsOrdered' ? [`${e.crop}:${e.qty}`] : []));
    expect(seen(ra)).toEqual(seen(rb));
    // Orders happen before the turn of the season (turnips are spring crops) and stop after it: nothing out of season is bought.
    const change = ra.events.findIndex((e) => e.type === 'seasonChanged');
    const lastOrder = ra.events.map((e) => e.type).lastIndexOf('seedsOrdered');
    expect(change).toBeGreaterThan(-1);
    expect(lastOrder).toBeGreaterThan(-1);
    expect(lastOrder).toBeLessThan(change);
  });

  it('spends nothing when the reserve would be crossed, however the time is split', () => {
    const make = (): GameState => {
      const s = farmAt(WED);
      own(s, { seed_order: 1 });
      planterUses(s, 'turnip');
      s.progression.goals = [];
      s.seedOrder.reservePct = 50;
      s.gold = 300; // reserve 150: 20 turnip seeds (176) never fit
      return s;
    };
    const a = make();
    const b = make();
    const ra = runOffline(a, QUIET, NY, WED, WED + 3 * HOUR);
    runOffline(b, QUIET, NY, WED, WED + 3 * HOUR, (state, ctx, dt) => {
      for (let left = dt; left > 0; left -= 10 * MIN) step(state, ctx, Math.min(left, 10 * MIN));
    });
    expect(ra.events.some((e) => e.type === 'seedsOrdered')).toBe(false);
    expect(a.gold).toBe(300);
    expect(settled(a)).toEqual(settled(b));
  });

  it('the away summary has a line for it', () => {
    const s = automatedFarm(WED, 0);
    s.gold = 20_000;
    s.seedOrder.reservePct = 0;
    const report = runOffline(s, GAME_DATA, NY, WED, WED + 3 * HOUR);
    const rows = awayRows(report, { readyPlots: 0, dryPlots: 0 }).map((r) => r.text);
    expect(rows.some((r) => /^Seed Order bought \d+ turnip seeds for [\d,]+g\.$/.test(r))).toBe(true);
  });

  it('the away summary names several kinds', () => {
    const report = {
      awayMs: HOUR,
      simulatedMs: HOUR,
      dayStarts: 0,
      seasonChanges: [],
      showSummary: true,
      events: [
        { type: 'seedsOrdered', crop: 'strawberry', qty: 40, gold: 2288 },
        { type: 'seedsOrdered', crop: 'turnip', qty: 20, gold: 176 },
      ] as GameEvent[],
    };
    const rows = awayRows(report, { readyPlots: 0, dryPlots: 0 }).map((r) => r.text);
    expect(rows).toContain('Seed Order bought 60 seeds (40 strawberry and 1 other kind) for 2,464g.');
    const one = awayRows({ ...report, events: [report.events[0]!] }, { readyPlots: 0, dryPlots: 0 });
    expect(one.map((r) => r.text)).toContain('Seed Order bought 40 strawberry seeds for 2,288g.');
  });
});

describe('Seed Order: performance', () => {
  it('8 hours away on a full farm with the order at its top level stays within the 100 ms budget', () => {
    const times: number[] = [];
    for (let run = 0; run < 3; run++) {
      const s = farmAt(WED);
      s.farm.grid = { cols: 8, rows: 6 };
      s.farm.plots = Array.from({ length: 48 }, () => emptyPlot('tilled'));
      s.lastPlantedCrop = Array.from(
        { length: 48 },
        (_, i) => (['turnip', 'potato', 'strawberry'] as const)[i % 3]!,
      );
      planterUses(s);
      s.lastPlantedCrop = Array.from(
        { length: 48 },
        (_, i) => (['turnip', 'potato', 'strawberry'] as const)[i % 3]!,
      );
      own(s, { farmhand: 5, seed_planter: 3, auto_seller: 2, seed_order: 3 });
      s.gold = 5_000_000;
      for (const p of s.farm.plots) p.waterMsLeft = 24 * HOUR;
      const t0 = performance.now();
      runOffline(s, GAME_DATA, NY, WED, WED + 8 * HOUR);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    expect(times[1]!).toBeLessThan(100);
  });
});
