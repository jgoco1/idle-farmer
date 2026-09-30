import { describe, expect, it } from 'vitest';
import { Game } from '../src/core/game';
import type { GameEvent } from '../src/core/events';
import { runOffline } from '../src/core/offline';
import { createRng } from '../src/core/rng';
import { makeContext, processCalendar, step } from '../src/core/sim';
import { createInitialState, emptyPlot, type GameState, type Plot } from '../src/core/state';
import { buildCalendar, TICK_MS } from '../src/core/time';
import { GAME_DATA } from '../src/data';
import { WATER_DURATION_MS } from '../src/data/balance';
import { CROPS } from '../src/data/crops';
import { CROP_IDS, seedOf, type CropId } from '../src/data/ids';
import { ITEMS } from '../src/data/items';
import {
  autoToolFor,
  finishesBeforeSeasonEnds,
  growthAfter,
  harvestPlots,
  isReady,
  msUntilReady,
  plantPlots,
  plotStage,
  tickFarming,
  tillPlots,
  useTool,
  waterPlots,
} from '../src/systems/farming';
import { addItem, countItem } from '../src/systems/inventory';
import { NO_MODIFIERS } from '../src/systems/modifiers';
import { buySeeds } from '../src/systems/shop';
import { at, HOUR, NY } from './helpers';

// Wednesday 7 Jan 2026. Spring until Sunday 11 Jan 00:00, then summer, autumn (18th), winter (25th).
const CREATED = at(NY, 2026, 1, 7, 10);
const SUMMER = at(NY, 2026, 1, 13, 12);
const AUTUMN = at(NY, 2026, 1, 20, 12);
const MIN = 60_000;

function farmAt(t = CREATED): GameState {
  const s = createInitialState(CREATED, NY, 1);
  processCalendar(s, GAME_DATA, NY, t, []);
  return s;
}

function ctxAt(s: GameState, t = CREATED, events: GameEvent[] = []) {
  return makeContext(s, GAME_DATA, buildCalendar(t, s.calendar, NY), events);
}

/** Puts `crop` straight into plot `i` (bypassing seeds and seasons), optionally grown and watered. */
function put(s: GameState, i: number, crop: CropId, growthMs = 0, waterMsLeft = 0, harvests = 0): Plot {
  const plot: Plot = { state: 'planted', crop, growthMs, harvests, waterMsLeft };
  s.farm.plots[i] = plot;
  return plot;
}

describe('crop data', () => {
  it('has all 15 crops from BALANCE.md with consistent fields', () => {
    expect(Object.keys(CROPS).sort()).toEqual([...CROP_IDS].sort());
    for (const c of Object.values(CROPS)) {
      expect(c.seasons.length).toBeGreaterThan(0);
      expect(Number.isInteger(c.growSec) && c.growSec > 0).toBe(true);
      expect(c.yield.min).toBeLessThanOrEqual(c.yield.max);
      expect(c.stages).toBe(5);
      expect(c.regrowToStage).toBe(c.regrowSec === null ? null : 2);
      expect(c.seedPrice).toBeGreaterThan(0);
      expect(c.basePrice).toBeGreaterThan(0);
    }
    const regrowers = CROP_IDS.filter((c) => CROPS[c].regrowSec !== null);
    expect(regrowers.sort()).toEqual(['blueberry', 'corn', 'cranberry', 'strawberry', 'tomato']);
    const multi = CROP_IDS.filter((c) => CROPS[c].seasons.length > 1);
    expect(multi.sort()).toEqual(['corn', 'garlic', 'kale', 'tomato', 'wheat']);
    expect(CROPS.turnip).toMatchObject({ growSec: 120, seedPrice: 8, basePrice: 22 });
    expect(CROPS.pumpkin).toMatchObject({
      growSec: 1200,
      seedPrice: 220,
      basePrice: 639,
      seasons: ['autumn'],
    });
  });

  it('generates a crop item and an unsellable seed item per crop', () => {
    for (const id of CROP_IDS) {
      expect(ITEMS[id]).toMatchObject({ category: 'crop', sellable: true, basePrice: CROPS[id].basePrice });
      expect(ITEMS[seedOf(id)]).toMatchObject({
        category: 'seed',
        sellable: false,
        basePrice: CROPS[id].seedPrice,
      });
      expect(ITEMS[id].sprite).toBe(`item_${id}`);
    }
  });
});

describe('starting farm', () => {
  it('matches BALANCE.md §3', () => {
    const s = createInitialState(CREATED, NY, 1);
    expect(s.gold).toBe(60);
    expect(s.farm.grid).toEqual({ cols: 4, rows: 2 });
    expect(s.farm.plots.filter((p) => p.state === 'tilled')).toHaveLength(4);
    expect(s.farm.plots[0]?.state).toBe('tilled');
    expect(s.farm.plots[2]?.state).toBe('untilled');
    expect(s.inventory.slots).toHaveLength(12);
    expect(s.inventory.stackSize).toBe(99);
    expect(countItem(s.inventory, 'seed_turnip')).toBe(6);
  });
});

describe('plot state transitions', () => {
  it('untilled → tilled → planted → ready → harvested → tilled', () => {
    const s = farmAt();
    const events: GameEvent[] = [];
    const ctx = ctxAt(s, CREATED, events);
    expect(plantPlots(s, ctx, 'turnip', [2])).toEqual({ ok: false, reason: 'Till the soil first.' });
    expect(tillPlots(s, ctx, [2]).ok).toBe(true);
    expect(s.farm.plots[2]?.state).toBe('tilled');
    expect(tillPlots(s, ctx, [2]).ok).toBe(false);

    expect(plantPlots(s, ctx, 'turnip', [2]).ok).toBe(true);
    expect(s.farm.plots[2]).toEqual({ ...emptyPlot('planted'), crop: 'turnip' });
    expect(countItem(s.inventory, 'seed_turnip')).toBe(5);
    expect(plotStage(s.farm.plots[2]!, GAME_DATA)).toBe(0);
    expect(plantPlots(s, ctx, 'turnip', [2]).ok).toBe(false);

    expect(waterPlots(s, ctx, [2]).ok).toBe(true);
    expect(s.farm.plots[2]?.waterMsLeft).toBe(WATER_DURATION_MS);
    expect(waterPlots(s, ctx, [2])).toEqual({ ok: false, reason: 'Already watered.' });

    const early = harvestPlots(s, ctx, [2]);
    expect(early.ok).toBe(false);
    expect(!early.ok && early.reason).toBe('The turnip needs 2m more.');
    step(s, ctx, 120_000);
    expect(isReady(s.farm.plots[2]!, GAME_DATA)).toBe(true);
    expect(plotStage(s.farm.plots[2]!, GAME_DATA)).toBe(4);

    expect(harvestPlots(s, ctx, [2]).ok).toBe(true);
    expect(countItem(s.inventory, 'turnip')).toBe(1);
    expect(s.farm.plots[2]?.state).toBe('tilled');
    expect(s.farm.plots[2]?.crop).toBeNull();
    // The soil stays wet after the harvest.
    expect(s.farm.plots[2]!.waterMsLeft).toBe(WATER_DURATION_MS - 120_000);

    expect(events.map((e) => e.type)).toEqual(['tilled', 'planted', 'watered', 'harvested']);
    expect(events[3]).toEqual({
      type: 'harvested',
      crop: 'turnip',
      qty: 1,
      plot: 2,
      auto: false,
      shipped: 0,
    });
  });

  it('shows stages 0–3 while growing and 4 only when ready', () => {
    const s = farmAt();
    const p = put(s, 0, 'turnip');
    const stages = [0, 29_999, 30_000, 60_000, 90_000, 119_999, 120_000].map((g) => {
      p.growthMs = g;
      return plotStage(p, GAME_DATA);
    });
    expect(stages).toEqual([0, 0, 1, 2, 3, 3, 4]);
    expect(plotStage(emptyPlot('tilled'), GAME_DATA)).toBe(-1);
  });

  it('refuses out-of-season seeds and missing seeds', () => {
    const s = farmAt();
    const ctx = ctxAt(s);
    addItem(s.inventory, 'seed_wheat', 2);
    const r = plantPlots(s, ctx, 'wheat', [0]);
    expect(r).toEqual({ ok: false, reason: "Wheat can't be planted in spring." });
    expect(plantPlots(s, ctx, 'potato', [0])).toEqual({ ok: false, reason: 'You have no potato seeds.' });
    expect(s.farm.plots[0]?.state).toBe('tilled');
  });

  it('plants as many plots as there are seeds', () => {
    const s = farmAt();
    const ctx = ctxAt(s);
    tillPlots(s, ctx, [2, 3, 6, 7]);
    expect(plantPlots(s, ctx, 'turnip', [0, 1, 2, 3, 4, 5, 6, 7]).ok).toBe(true);
    expect(s.farm.plots.filter((p) => p.state === 'planted')).toHaveLength(6);
    expect(countItem(s.inventory, 'seed_turnip')).toBe(0);
  });

  it('the hoe clears dead crops; dead and untilled soil cannot be watered', () => {
    const s = farmAt();
    const ctx = ctxAt(s);
    s.farm.plots[0] = emptyPlot('dead');
    expect(waterPlots(s, ctx, [0, 3])).toEqual({ ok: false, reason: 'Till the soil before watering it.' });
    expect(tillPlots(s, ctx, [0]).ok).toBe(true);
    expect(s.farm.plots[0]?.state).toBe('tilled');
  });

  it('ignores plot indexes outside the grid', () => {
    const s = farmAt();
    const ctx = ctxAt(s);
    expect(tillPlots(s, ctx, [-1, 8, 1.5]).ok).toBe(false);
    expect(useTool(s, ctx, 'hoe', [42], null)).toEqual({ ok: false, reason: 'That is not a plot.' });
  });
});

describe('growth', () => {
  it('watered plots grow at full speed and dry plots at half speed', () => {
    const s = farmAt();
    const wet = put(s, 0, 'potato', 0, WATER_DURATION_MS);
    const dry = put(s, 1, 'potato');
    step(s, ctxAt(s), 100_000);
    expect(wet.growthMs).toBe(100_000);
    expect(dry.growthMs).toBe(50_000);
    expect(wet.waterMsLeft).toBe(WATER_DURATION_MS - 100_000);
  });

  it('dry crops never stop and never die', () => {
    const s = farmAt();
    const p = put(s, 0, 'turnip');
    step(s, ctxAt(s), 240_000);
    expect(isReady(p, GAME_DATA)).toBe(true);
    step(s, ctxAt(s), 8 * HOUR);
    expect(p.state).toBe('planted');
    expect(p.growthMs).toBe(120_000); // growth stops at "ready"
  });

  it('handles water running out partway through a step', () => {
    const s = farmAt();
    const p = put(s, 0, 'pumpkin', 0, 30_000);
    // Direct call: 30 s wet + 30 s dry in one tick.
    tickFarming(s, ctxAt(s), 60_000);
    expect(p.growthMs).toBe(30_000 + 15_000);
    expect(p.waterMsLeft).toBe(0);
    // Through the core, the step is split exactly where the water runs out.
    const s2 = farmAt();
    const p2 = put(s2, 0, 'pumpkin', 0, 30_000);
    step(s2, ctxAt(s2), 60_000);
    expect(p2.growthMs).toBe(45_000);
  });

  it('reports the next water-out so the core splits steps there', async () => {
    const { msToNextSimEvent } = await import('../src/systems');
    const s = farmAt();
    const ctx = ctxAt(s);
    expect(msToNextSimEvent(s, ctx)).toBe(Infinity);
    put(s, 0, 'pumpkin', 0, 90_000);
    put(s, 1, 'potato', 0, 30_000);
    s.farm.plots[2] = { ...emptyPlot('tilled'), waterMsLeft: 10_000 }; // no crop: no rate change
    put(s, 3, 'turnip', 120_000, 5_000); // ready: no rate change
    expect(msToNextSimEvent(s, ctx)).toBe(30_000);
  });

  it('applies the growth modifier seam', () => {
    const plot: Plot = { state: 'planted', crop: 'melon', growthMs: 0, harvests: 0, waterMsLeft: 1000 };
    const mods = { ...NO_MODIFIERS, growthModifier: 1.2 };
    expect(growthAfter(plot, CROPS.melon, 3000, mods)).toBe(1200 + 1200);
    expect(msUntilReady({ ...plot, waterMsLeft: WATER_DURATION_MS }, CROPS.melon, mods)).toBe(900_000);
  });

  it('estimates time to ready across the water running out', () => {
    const p: Plot = { state: 'planted', crop: 'turnip', growthMs: 0, harvests: 0, waterMsLeft: 60_000 };
    expect(msUntilReady(p, CROPS.turnip, NO_MODIFIERS)).toBe(60_000 + 120_000);
    expect(msUntilReady({ ...p, waterMsLeft: 0 }, CROPS.turnip, NO_MODIFIERS)).toBe(240_000);
  });

  /**
   * Same plot states and water; growth equal within `tol` ms. When one plot's water runs out
   * mid-tick the core splits the tick, and a dry plot then rounds two half-ms instead of one.
   */
  function expectSameFarm(a: GameState, b: GameState, tol: number, label: string): void {
    expect(a.clock.simMs).toBe(b.clock.simMs);
    a.farm.plots.forEach((p, i) => {
      const q = b.farm.plots[i]!;
      expect({ ...p, growthMs: 0 }, `plot ${i} ${label}`).toEqual({ ...q, growthMs: 0 });
      expect(Math.abs(p.growthMs - q.growthMs), `plot ${i} ${label}`).toBeLessThanOrEqual(tol);
      expect(isReady(p, GAME_DATA)).toBe(isReady(q, GAME_DATA));
    });
  }

  /** A mixed farm: wet, dry, water running out at different moments, regrowers. */
  function mixedFarm(t = AUTUMN): GameState {
    const s = farmAt(t);
    put(s, 0, 'pumpkin', 0, WATER_DURATION_MS);
    put(s, 1, 'pumpkin', 0, 7 * MIN + 300);
    put(s, 2, 'yam', 0, 0);
    put(s, 3, 'cranberry', 100_000, 3 * MIN + 17);
    put(s, 4, 'corn', 0, 90 * MIN);
    put(s, 5, 'tomato', 50_000, 11_111, 2);
    put(s, 6, 'wheat', 0, 45_001);
    return s;
  }

  it('one large step equals many small steps (within 1 ms per water-out split)', () => {
    // Four plots run dry during the run, so at most 4 ms of rounding drift.
    for (const total of [MIN, 7 * MIN, 25 * MIN, 2 * HOUR + 5 * MIN, 8 * HOUR]) {
      const big = mixedFarm();
      step(big, ctxAt(big, AUTUMN), total);
      const small = mixedFarm();
      const ctx = ctxAt(small, AUTUMN);
      for (let t = 0; t < total; t += TICK_MS) step(small, ctx, TICK_MS);
      expectSameFarm(big, small, 4, `after ${total} ms`);
    }
  });

  it('one large step matches small steps within rounding tolerance under a modifier', () => {
    const mods = { ...NO_MODIFIERS, growthModifier: 1.15 };
    const big = mixedFarm();
    const small = mixedFarm();
    const total = 20 * MIN;
    const ctxBig = { ...ctxAt(big, AUTUMN), mods };
    const ctxSmall = { ...ctxAt(small, AUTUMN), mods };
    tickFarming(big, ctxBig, total);
    for (let t = 0; t < total; t += TICK_MS) tickFarming(small, ctxSmall, TICK_MS);
    const ticks = total / TICK_MS;
    big.farm.plots.forEach((p, i) => {
      // Each tick rounds once, so small steps may drift by at most half a ms per tick.
      expect(Math.abs(p.growthMs - small.farm.plots[i]!.growthMs)).toBeLessThanOrEqual(ticks / 2 + 1);
      expect(p.waterMsLeft).toBe(small.farm.plots[i]!.waterMsLeft);
    });
  });

  it('8 hours offline grows the farm exactly like 8 hours of play', () => {
    const leave = at(NY, 2026, 1, 20, 9); // Tuesday of autumn, no season change for days
    const offline = mixedFarm(leave);
    const report = runOffline(offline, GAME_DATA, NY, leave, leave + 8 * HOUR);
    expect(report.simulatedMs).toBe(8 * HOUR);

    const online = mixedFarm(leave);
    const game = new Game(online, { data: GAME_DATA, lc: NY, now: () => leave });
    let now = leave;
    const frame = 1000; // one-second frames: 10 fixed ticks each
    for (let t = 0; t < 8 * HOUR; t += frame) {
      now += frame;
      game.advance(frame);
    }
    expect(now).toBe(leave + 8 * HOUR);
    expectSameFarm(offline, online, 4, 'after 8 h');
  });
});

describe('seasons', () => {
  it('crops still in the ground wither at the season change, online', () => {
    const s = farmAt(at(NY, 2026, 1, 10, 23)); // Saturday night, spring
    put(s, 0, 'turnip', 30_000);
    put(s, 1, 'turnip', 120_000); // ready crops wither too
    put(s, 2, 'garlic', 0); // winter/spring: withers in summer
    const events: GameEvent[] = [];
    processCalendar(s, GAME_DATA, NY, at(NY, 2026, 1, 11, 0, 1), events);
    expect(events).toContainEqual({ type: 'seasonChanged', season: 'summer', withered: 3 });
    expect(s.farm.plots.slice(0, 3).map((p) => p.state)).toEqual(['dead', 'dead', 'dead']);
    expect(s.farm.plots[0]?.crop).toBeNull();
    expect(plotStage(s.farm.plots[0]!, GAME_DATA)).toBe(-1);
    // Withering is idempotent.
    const again: GameEvent[] = [];
    processCalendar(s, GAME_DATA, NY, at(NY, 2026, 1, 11, 0, 2), again);
    expect(again).toEqual([]);
  });

  it('multi-season crops survive the change and keep growing', () => {
    const s = farmAt(at(NY, 2026, 1, 17, 23)); // Saturday night, summer
    const tomato = put(s, 0, 'tomato', 60_000);
    const wheat = put(s, 1, 'wheat', 10_000);
    put(s, 2, 'blueberry', 0); // summer only
    put(s, 3, 'corn', 0, 0, 1);
    const events: GameEvent[] = [];
    processCalendar(s, GAME_DATA, NY, at(NY, 2026, 1, 18, 0, 1), events);
    expect(events).toContainEqual({ type: 'seasonChanged', season: 'autumn', withered: 1 });
    expect([tomato.state, wheat.state, s.farm.plots[2]!.state, s.farm.plots[3]!.state]).toEqual([
      'planted',
      'planted',
      'dead',
      'planted',
    ]);
    expect(tomato.growthMs).toBe(60_000);
  });

  it('winter garlic survives into spring', () => {
    const s = farmAt(at(NY, 2026, 1, 31, 22)); // Saturday of winter
    put(s, 0, 'garlic', 0);
    put(s, 1, 'leek', 0);
    const events: GameEvent[] = [];
    processCalendar(s, GAME_DATA, NY, at(NY, 2026, 2, 1, 1), events);
    expect(events).toContainEqual({ type: 'seasonChanged', season: 'spring', withered: 1 });
    expect(s.farm.plots[0]?.state).toBe('planted');
    expect(s.farm.plots[1]?.state).toBe('dead');
  });

  it('crops wither across an offline season change, after growing until the boundary', () => {
    const leave = at(NY, 2026, 1, 10, 23, 59); // one minute before summer
    const s = farmAt(leave);
    const turnip = put(s, 0, 'turnip', 0, WATER_DURATION_MS);
    const report = runOffline(s, GAME_DATA, NY, leave, leave + 2 * HOUR);
    expect(report.seasonChanges).toEqual(['summer']);
    expect(report.events).toContainEqual({ type: 'seasonChanged', season: 'summer', withered: 1 });
    expect(turnip.state).toBe('dead');
    // The dead plot keeps its water; nothing else changed.
    expect(s.farm.plots[0]!.waterMsLeft).toBe(WATER_DURATION_MS - 2 * HOUR);
  });

  it('several offline season changes wither each season in turn', () => {
    const leave = at(NY, 2026, 1, 13, 12); // summer
    const s = farmAt(leave);
    put(s, 0, 'tomato', 0); // survives autumn, withers in winter
    put(s, 1, 'wheat', 0); // same
    put(s, 2, 'blueberry', 0); // withers in autumn
    const report = runOffline(s, GAME_DATA, NY, leave, at(NY, 2026, 1, 27, 12));
    expect(report.seasonChanges).toEqual(['autumn', 'winter']);
    expect(report.events.filter((e) => e.type === 'seasonChanged')).toEqual([
      { type: 'seasonChanged', season: 'autumn', withered: 1 },
      { type: 'seasonChanged', season: 'winter', withered: 2 },
    ]);
    expect(s.farm.plots.slice(0, 3).every((p) => p.state === 'dead')).toBe(true);
  });

  it('warns when a crop will not finish before the season changes', () => {
    const s = farmAt();
    const late = buildCalendar(at(NY, 2026, 1, 10, 23, 50), s.calendar, NY); // 10 min of spring left
    expect(finishesBeforeSeasonEnds(CROPS.turnip, late, NO_MODIFIERS)).toBe(true);
    expect(finishesBeforeSeasonEnds(CROPS.cauliflower, late, NO_MODIFIERS)).toBe(true); // exactly 10 min
    expect(finishesBeforeSeasonEnds(CROPS.strawberry, late, NO_MODIFIERS)).toBe(true); // 8 min
    const later = buildCalendar(at(NY, 2026, 1, 10, 23, 57), s.calendar, NY);
    expect(finishesBeforeSeasonEnds(CROPS.potato, later, NO_MODIFIERS)).toBe(false);
    expect(finishesBeforeSeasonEnds(CROPS.turnip, later, NO_MODIFIERS)).toBe(true);
    const winter = buildCalendar(at(NY, 2026, 1, 31, 23, 59), s.calendar, NY);
    expect(winter.season).toBe('winter');
    expect(finishesBeforeSeasonEnds(CROPS.garlic, winter, NO_MODIFIERS)).toBe(true); // grows in spring too
    expect(finishesBeforeSeasonEnds(CROPS.leek, winter, NO_MODIFIERS)).toBe(false);
  });
});

describe('harvest', () => {
  it('rolls the yield with the seeded RNG', () => {
    const rolls = (seed: number): number[] => {
      const s = createInitialState(CREATED, NY, seed);
      s.rngState = seed; // a new save has already rolled its first specials
      for (let i = 0; i < 8; i++) put(s, i, 'potato', 240_000);
      harvestPlots(s, ctxAt(s), [0, 1, 2, 3, 4, 5, 6, 7]);
      return s.inventory.slots.filter((x) => x?.item === 'potato').map((x) => x!.qty);
    };
    const expected = (seed: number): number => {
      const rng = createRng({ rngState: seed });
      let n = 0;
      for (let i = 0; i < 8; i++) n += rng.int(1, 2);
      return n;
    };
    expect(rolls(1)).toEqual([expected(1)]);
    expect(rolls(1)).toEqual(rolls(1));
    expect(rolls(12345)).toEqual([expected(12345)]);
    // Potatoes yield 1–2 each, so 8 plots give 8–16, and seed 1 is not all-min or all-max.
    expect(expected(1)).toBeGreaterThan(8);
    expect(expected(1)).toBeLessThan(16);
  });

  it('regrowers go back to stage 2 and regrow in their regrow time', () => {
    const s = farmAt();
    const events: GameEvent[] = [];
    const ctx = ctxAt(s, CREATED, events);
    const p = put(s, 0, 'strawberry', 480_000, WATER_DURATION_MS);
    expect(harvestPlots(s, ctx, [0]).ok).toBe(true);
    expect(p).toMatchObject({ state: 'planted', crop: 'strawberry', growthMs: 0, harvests: 1 });
    expect(plotStage(p, GAME_DATA)).toBe(2);
    step(s, ctx, 120_000);
    expect(plotStage(p, GAME_DATA)).toBe(3);
    step(s, ctx, 119_999);
    expect(isReady(p, GAME_DATA)).toBe(false);
    step(s, ctx, 1);
    expect(isReady(p, GAME_DATA)).toBe(true);
    expect(harvestPlots(s, ctx, [0]).ok).toBe(true);
    expect(p.harvests).toBe(2);
    expect(countItem(s.inventory, 'strawberry')).toBeGreaterThanOrEqual(2);
    expect(events.filter((e) => e.type === 'harvested')).toHaveLength(2);
  });

  it('a full inventory leaves the crop waiting and changes nothing', () => {
    const s = farmAt();
    const events: GameEvent[] = [];
    const ctx = ctxAt(s, CREATED, events);
    s.inventory.slots = [{ item: 'seed_turnip', qty: 99 }];
    const p = put(s, 0, 'turnip', 120_000);
    const before = structuredClone(s);
    const r = harvestPlots(s, ctx, [0]);
    expect(r).toEqual({ ok: false, reason: 'Your bag is full. The crop will wait in the ground.' });
    expect(s).toEqual(before);
    expect(p.state).toBe('planted');
    expect(events).toEqual([{ type: 'inventoryFull', item: 'turnip' }]);
  });

  it('harvests what fits and reports the rest', () => {
    const s = farmAt();
    const events: GameEvent[] = [];
    const ctx = ctxAt(s, CREATED, events);
    s.inventory = { slots: [{ item: 'turnip', qty: 98 }], stackSize: 99 };
    put(s, 0, 'turnip', 120_000);
    put(s, 1, 'turnip', 120_000);
    expect(harvestPlots(s, ctx, [0, 1]).ok).toBe(true);
    expect(countItem(s.inventory, 'turnip')).toBe(99);
    expect(s.farm.plots[0]?.state).toBe('tilled');
    expect(s.farm.plots[1]?.state).toBe('planted');
    expect(events.map((e) => e.type)).toEqual(['harvested', 'inventoryFull']);
  });
});

describe('tools', () => {
  it('Auto picks the obvious action', () => {
    const s = farmAt();
    const auto = (i: number, seed: CropId | null = 'turnip') => autoToolFor(s, GAME_DATA, 'spring', i, seed);
    expect(auto(2)).toBe('hoe'); // untilled
    s.farm.plots[3] = emptyPlot('dead');
    expect(auto(3)).toBe('hoe');
    expect(auto(0)).toBe('seeds'); // tilled, have seeds
    expect(auto(0, null)).toBe('water'); // tilled, no seed chosen
    expect(autoToolFor(s, GAME_DATA, 'summer', 0, 'turnip')).toBe('water'); // out of season
    put(s, 1, 'turnip', 0);
    expect(auto(1)).toBe('water'); // dry crop
    s.farm.plots[1]!.waterMsLeft = 1000;
    expect(auto(1)).toBeNull(); // watered and growing
    s.farm.plots[1]!.growthMs = 120_000;
    expect(auto(1)).toBe('hand'); // ready
  });

  it('useTool applies one resolved tool to every plot', () => {
    const s = farmAt();
    const ctx = ctxAt(s);
    expect(useTool(s, ctx, 'auto', [2, 3, 0], 'turnip').ok).toBe(true); // hoe, from plot 2
    expect(s.farm.plots.slice(0, 4).map((p) => p.state)).toEqual(['tilled', 'tilled', 'tilled', 'tilled']);
    expect(useTool(s, ctx, 'auto', [0, 1, 2], 'turnip').ok).toBe(true); // plant
    expect(s.farm.plots.slice(0, 3).every((p) => p.state === 'planted')).toBe(true);
    expect(useTool(s, ctx, 'water', [0, 1, 2], null).ok).toBe(true);
    const r = useTool(s, ctx, 'auto', [0], 'turnip');
    expect(r).toEqual({ ok: false, reason: 'The turnip is growing (2m left).' });
    expect(useTool(s, ctx, 'seeds', [3], null)).toEqual({ ok: false, reason: 'Choose a seed first.' });
  });
});

describe('seed shop', () => {
  it('sells in-season, unlocked seeds for gold', () => {
    const s = farmAt();
    const events: GameEvent[] = [];
    const ctx = ctxAt(s, CREATED, events);
    expect(buySeeds(s, ctx, 'potato', 3).ok).toBe(true);
    expect(s.gold).toBe(3);
    expect(countItem(s.inventory, 'seed_potato')).toBe(3);
    expect(events).toEqual([{ type: 'purchased', what: 'seed_potato', gold: 57 }]);
    expect(buySeeds(s, ctx, 'potato', 1)).toEqual({ ok: false, reason: 'You need 19g for that.' });
    expect(buySeeds(s, ctx, 'wheat', 1)).toEqual({ ok: false, reason: 'Wheat seeds are out of season.' });
    expect(buySeeds(s, ctx, 'strawberry', 1)).toEqual({
      ok: false,
      reason: 'Strawberry seeds are locked. Reach Farm Level 3 (earn 900g more).',
    });
    expect(buySeeds(s, ctx, 'turnip', 0).ok).toBe(false);
  });

  it('respects the inventory capacity', () => {
    const s = farmAt();
    const ctx = ctxAt(s);
    s.inventory = { slots: [{ item: 'turnip', qty: 99 }], stackSize: 99 };
    expect(buySeeds(s, ctx, 'turnip', 1)).toEqual({ ok: false, reason: 'Your bag is full.' });
    expect(s.gold).toBe(60);
  });

  it('summer seeds are on sale in summer', () => {
    const s = farmAt(SUMMER);
    expect(buySeeds(s, ctxAt(s, SUMMER), 'wheat', 1).ok).toBe(true);
  });
});
