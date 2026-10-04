// Phase 09 QA sweep: tests that go looking for bugs where systems meet — offline walks across
// season, year and DST boundaries with everything running at once, clocks set back, 30-day
// absences, saving mid-minigame and mid-cook, old and broken saves, timer drift, double clicks,
// a full bag under automation, and market prices at the demand floor and ceiling.

import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../src/core/events';
import { Game } from '../src/core/game';
import { runOffline } from '../src/core/offline';
import {
  encodeBase64,
  importSave,
  loadGame,
  parseSave,
  SAVE_KEY,
  SAVE_VERSION,
  SaveError,
  toSaveFile,
  validateState,
  type SaveStorage,
} from '../src/core/save';
import { makeContext, processCalendar, step } from '../src/core/sim';
import { createInitialState, emptyPlot, type GameState } from '../src/core/state';
import { buildCalendar, type LocalClock } from '../src/core/time';
import { GAME_DATA } from '../src/data';
import { DEMAND_CEIL, DEMAND_FLOOR, MARKET_CHANNEL } from '../src/data/balance';
import { seedOf, type CropId, type UpgradeId } from '../src/data/ids';
import { addItem, countItem } from '../src/systems/inventory';
import { demandOf, quoteSale, unitPrice } from '../src/systems/market';
import { computeModifiers } from '../src/systems/modifiers';
import { placeObject } from '../src/systems/placement';
import { canPullUp, isReady } from '../src/systems/farming';
import { PurchaseGuard, DOUBLE_CLICK_MS } from '../src/ui/purchaseGuard';
import fixtureV1 from './fixtures/save-v1.json';
import fixtureV2 from './fixtures/save-v2.json';
import fixtureV3 from './fixtures/save-v3.json';
import fixtureV4 from './fixtures/save-v4.json';
import fixtureV5 from './fixtures/save-v5.json';
import fixtureV6 from './fixtures/save-v6.json';
import fixtureV7 from './fixtures/save-v7.json';
import fixtureV8 from './fixtures/save-v8.json';
import fixtureV9 from './fixtures/save-v9.json';
import fixtureV10 from './fixtures/save-v10.json';
import fixtureV11 from './fixtures/save-v11.json';
import fixtureV12 from './fixtures/save-v12.json';
import fixtureV13 from './fixtures/save-v13.json';
import fixtureV14 from './fixtures/save-v14.json';
import { at, DAY, HOUR, NY } from './helpers';

const MIN = 60_000;
const CREATED = at(NY, 2026, 1, 7, 10); // Wednesday; spring until Sunday 11 January 00:00
const SAT_EVENING = at(NY, 2026, 1, 10, 20); // the last evening of spring

function farmAt(t: number, created = CREATED, lc: LocalClock = NY): GameState {
  const s = createInitialState(created, lc, 1);
  processCalendar(s, GAME_DATA, lc, t, []);
  return s;
}

function ctxAt(s: GameState, t: number, events: GameEvent[] = []) {
  return makeContext(s, GAME_DATA, buildCalendar(t, s.calendar, NY), events);
}

function own(s: GameState, levels: Partial<Record<UpgradeId, number>>): void {
  Object.assign(s.upgrades, levels);
  if (levels.farmhand) {
    s.automation.farmhandCooldownMs =
      GAME_DATA.upgrades.farmhand!.effect[levels.farmhand]!.intervalSec! * 1000;
  }
}

function stock(s: GameState, crop: CropId, qty: number): void {
  s.inventory.stackSize = Math.max(s.inventory.stackSize, qty);
  expect(addItem(s.inventory, seedOf(crop), qty)).toBe(true);
}

/**
 * A farm with everything running at once: a 6 × 4 field under a farmhand, planter and Auto-Seller
 * with two sprinklers, two pond traps and a Trap Collector, two dishes on the stove, and two buffs.
 */
function everything(t: number): GameState {
  const s = farmAt(t);
  s.farm.grid = { cols: 6, rows: 4 };
  s.farm.plots = Array.from({ length: 24 }, () => emptyPlot('tilled'));
  s.lastPlantedCrop = Array.from({ length: 24 }, (_, i) => (i % 2 ? 'turnip' : 'potato'));
  s.inventory.slots = Array.from({ length: 20 }, () => null);
  own(s, { farmhand: 3, seed_planter: 2, auto_seller: 1, sprinkler: 2, kitchen: 1, trap_collector: 1 });
  expect(placeObject(s, ctxAt(s, t), 'sprinkler', 1, 1).ok).toBe(true);
  expect(placeObject(s, ctxAt(s, t), 'sprinkler', 4, 2).ok).toBe(true);
  stock(s, 'turnip', 400);
  stock(s, 'potato', 400);
  s.farm.plots[0] = { ...emptyPlot('planted'), crop: 'garlic', growthMs: 60_000 }; // winter and spring
  s.fishing.traps = [
    { id: 1, location: 'pond', slot: 0, progressMs: 0, contents: [] },
    { id: 2, location: 'pond', slot: 1, progressMs: 90_000, contents: [] },
  ];
  s.kitchen.known.push('vegetable_soup');
  s.kitchen.queue = [
    { recipe: 'vegetable_soup', remainingMs: 40_000 },
    { recipe: 'roasted_turnip', remainingMs: 25 * MIN },
  ];
  s.buffs.active = [
    { type: 'growth', magnitude: 0.2, tier: 2, remainingMs: 20 * MIN, source: 'vegetable_soup' },
    { type: 'sellPrice', magnitude: 0.1, tier: 2, remainingMs: 3 * HOUR, source: 'blueberry_muffin' },
  ];
  // A full ranch (v2 phase 04): 12 hens and 6 cows fed by the silo, and the Collecting Basket.
  s.land.parcels.push('yard');
  s.ranch.buildings = [
    { id: 1, kind: 'coop', level: 3, at: { col: 22, row: 9 }, trough: 192, store: [], cycleMs: 0 },
    { id: 2, kind: 'barn', level: 3, at: { col: 27, row: 9 }, trough: 72, store: [], cycleMs: 0 },
    { id: 3, kind: 'silo', level: 2, at: { col: 33, row: 9 }, trough: 0, store: [], cycleMs: 0 },
  ];
  s.ranch.animals = [
    ...Array.from({ length: 12 }, (_, i) => ({
      id: i + 1,
      kind: 'chicken' as const,
      name: `Hen ${i}`,
      building: 1,
    })),
    ...Array.from({ length: 6 }, (_, i) => ({
      id: i + 13,
      kind: 'cow' as const,
      name: `Cow ${i}`,
      building: 2,
    })),
  ];
  s.upgrades.ranch_collector = 1;
  s.progression.goals = [];
  return s;
}

describe('offline across calendar boundaries, with everything running', () => {
  it('Saturday night to Monday morning: season change, two dawns, stove, buffs, traps and the bin', () => {
    const late = at(NY, 2026, 1, 10, 23, 45); // a quarter of an hour of spring left
    const s = everything(late);
    s.farm.plots[1] = { ...emptyPlot('planted'), crop: 'pumpkin', growthMs: 0 }; // 20 minutes to go: withers
    const simBefore = s.clock.simMs;
    const lifetime = s.stats.lifetimeGold;
    const back = at(NY, 2026, 1, 12, 9); // Monday 09:00, 33 hours later
    const report = runOffline(s, GAME_DATA, NY, late, back);
    expect(report.simulatedMs).toBe(8 * HOUR + 16 * HOUR * 0.25);
    expect(s.clock.simMs).toBe(simBefore + report.simulatedMs);
    expect(Number.isInteger(s.clock.simMs)).toBe(true);
    expect(report.seasonChanges).toEqual(['summer']);
    expect(report.dayStarts).toBe(2); // Sunday 06:00 (counted) and once more for Monday
    // Spring crops withered at Sunday midnight, and the planter never plants them out of season.
    const types = report.events.map((e) => e.type);
    expect(report.events.find((e) => e.type === 'seasonChanged')).toMatchObject({
      withered: expect.any(Number),
    });
    expect(
      (report.events.find((e) => e.type === 'seasonChanged') as { withered: number }).withered,
    ).toBeGreaterThan(0);
    expect(s.farm.plots.some((p) => p.crop === 'turnip' || p.crop === 'potato')).toBe(false);
    // Both dishes finished (neither in winter: not hearty) and both buffs ran out, in order.
    expect(s.kitchen.queue).toEqual([]);
    expect(countItem(s.inventory, 'vegetable_soup', false)).toBe(1);
    expect(countItem(s.inventory, 'roasted_turnip', false)).toBe(1);
    expect(s.buffs.active).toEqual([]);
    const expiries = report.events
      .filter((e) => e.type === 'buffExpired')
      .map((e) => (e as { buff: string }).buff);
    expect(expiries).toEqual(['growth', 'sellPrice']);
    // The farm worked while it could: harvests shipped, the bin paid, the collector emptied the traps.
    expect(types).toContain('binCollected');
    expect(types).toContain('trapCollected');
    expect(s.stats.lifetimeGold).toBeGreaterThan(lifetime);
    expect(s.stats.itemsShipped).toBeGreaterThan(50);
    expect(validateState(JSON.parse(JSON.stringify(s)))).toBeNull();
  });

  it('the same absence gives the same farm when the walk takes one-minute steps', () => {
    // The goal board is left out: goals are redrawn with the seeded RNG at the end of a step, so a
    // different split draws different goals (and their seed or card rewards). Everything else must agree.
    const data = { ...GAME_DATA, goalTemplates: {} as typeof GAME_DATA.goalTemplates };
    const a = everything(SAT_EVENING);
    const b = structuredClone(a);
    const back = at(NY, 2026, 1, 12, 9);
    runOffline(a, data, NY, SAT_EVENING, back);
    runOffline(b, data, NY, SAT_EVENING, back, (st, ctx, dt) => {
      for (let done = 0; done < dt; done += MIN) step(st, ctx, Math.min(MIN, dt - done));
    });
    expect(b.clock.simMs).toBe(a.clock.simMs);
    expect(b.calendar).toEqual(a.calendar);
    expect(b.kitchen).toEqual(a.kitchen);
    expect(b.buffs).toEqual(a.buffs);
    expect(b.progression.milestones).toEqual(a.progression.milestones);
    // Growth is rounded once per step part (buffs and perks make rates fractional), so a crop can slip to
    // the next farmhand visit: the same 3% slack as the phase-04 "with the skill perks on" test.
    expect(a.stats.cropsHarvested).toBeGreaterThan(500);
    expect(Math.abs(b.stats.cropsHarvested - a.stats.cropsHarvested)).toBeLessThanOrEqual(
      a.stats.cropsHarvested * 0.03,
    );
    expect(Math.abs(b.stats.lifetimeGold - a.stats.lifetimeGold)).toBeLessThanOrEqual(
      a.stats.lifetimeGold * 0.03,
    );
  });

  it('into a new year: winter to spring, hearty only for what finished before midnight', () => {
    const satNight = at(NY, 2026, 1, 31, 23, 45); // the last quarter hour of winter, year 1
    const s = everything(satNight);
    expect(buildCalendar(satNight, s.calendar, NY)).toMatchObject({ season: 'winter', year: 1 });
    s.farm.plots[1] = { ...emptyPlot('planted'), crop: 'leek', growthMs: 0 }; // winter only, 8 min: harvested
    s.farm.plots[2] = { ...emptyPlot('planted'), crop: 'pumpkin', growthMs: 0 }; // 20 min: still growing at midnight
    s.buffs.active = [];
    s.kitchen.queue = [
      { recipe: 'roasted_turnip', remainingMs: 10 * MIN }, // done ~23:54 (×1.15): winter, hearty
      { recipe: 'vegetable_soup', remainingMs: 30 * MIN }, // done ~00:11: spring
    ];
    const report = runOffline(s, GAME_DATA, NY, satNight, satNight + 14 * HOUR);
    expect(report.seasonChanges).toEqual(['spring']);
    expect(buildCalendar(satNight + 14 * HOUR, s.calendar, NY)).toMatchObject({ season: 'spring', year: 2 });
    const spring = report.events.find((e) => e.type === 'seasonChanged') as { withered: number };
    expect(spring.withered).toBeGreaterThanOrEqual(1); // the pumpkin
    expect(s.farm.plots[2]!.crop).not.toBe('pumpkin');
    expect(s.stats.cropsHarvested).toBeGreaterThan(0);
    expect(countItem(s.inventory, 'roasted_turnip', true)).toBe(1);
    expect(countItem(s.inventory, 'vegetable_soup', false)).toBe(1);
  });

  it('over the spring-forward night (23 h) and the fall-back night (25 h)', () => {
    const springSat = at(NY, 2026, 3, 7, 22);
    const springSun = at(NY, 2026, 3, 8, 22);
    expect(springSun - springSat).toBe(23 * HOUR);
    const a = farmAt(springSat, at(NY, 2026, 3, 1, 12));
    const ra = runOffline(a, GAME_DATA, NY, springSat, springSun);
    expect(ra.simulatedMs).toBe(8 * HOUR + 15 * HOUR * 0.25);
    expect(ra.dayStarts).toBe(1);
    expect(ra.seasonChanges).toHaveLength(1); // Sunday midnight still comes, before the jump at 02:00

    const fallSat = at(NY, 2026, 10, 31, 22);
    const fallSun = at(NY, 2026, 11, 1, 22);
    expect(fallSun - fallSat).toBe(25 * HOUR);
    const b = farmAt(fallSat, at(NY, 2026, 10, 20, 12));
    const rb = runOffline(b, GAME_DATA, NY, fallSat, fallSun);
    expect(rb.simulatedMs).toBe(12 * HOUR);
    expect(rb.dayStarts).toBe(1);
    expect(rb.seasonChanges).toHaveLength(1);
    expect(Number.isInteger(b.clock.simMs)).toBe(true);
  });

  it('a system clock set back during an absence changes nothing, and moving it forward again does not repeat a season', () => {
    const t0 = at(NY, 2026, 1, 20, 12); // autumn (week 2)
    const s = everything(t0);
    s.buffs.active = [];
    let now = t0;
    const game = new Game(s, { data: GAME_DATA, lc: NY, now: () => now });
    const seasons: string[] = [];
    game.bus.on('seasonChanged', (e) => seasons.push(e.season));
    const before = structuredClone(game.state);
    // Saved at t0; the player sets the clock back ten days (to spring) and opens the game.
    now = t0 - 10 * DAY;
    const back = game.catchUp(t0, now);
    expect(back).toMatchObject({ awayMs: 0, simulatedMs: 0, dayStarts: 0, seasonChanges: [] });
    expect(game.state).toEqual(before);
    // Playing for a while on the wrong clock: time runs, but the season holds at autumn.
    for (let i = 0; i < 600; i++) {
      now += 100;
      game.advance(100);
    }
    expect(game.calendar().season).toBe('autumn');
    expect(game.state.calendar.maxWeekIndex).toBe(before.calendar.maxWeekIndex);
    expect(game.state.clock.simMs).toBe(before.clock.simMs + 60_000);
    // The clock is put right (a day after t0): the absence counts from the wrong save time, capped.
    const from = now;
    now = t0 + DAY;
    const fwd = game.catchUp(from, now);
    expect(fwd.simulatedMs).toBe(12 * HOUR);
    expect(fwd.seasonChanges).toEqual([]);
    expect(seasons).toEqual([]);
    expect(game.calendar().season).toBe('autumn');
  });
});

describe('very long absences', () => {
  it('30 days away with everything running: capped at 12 h, the calendar caught up, in well under 300 ms', () => {
    const s = everything(SAT_EVENING);
    const week = s.calendar.maxWeekIndex;
    const t = performance.now();
    const report = runOffline(s, GAME_DATA, NY, SAT_EVENING, SAT_EVENING + 30 * DAY);
    const ms = performance.now() - t;
    expect(report.simulatedMs).toBe(12 * HOUR);
    expect(report.awayMs).toBe(30 * DAY);
    expect(s.calendar.maxWeekIndex).toBe(week + 5); // five Sunday midnights in 30 days from a Saturday
    // One inside the counted first day, then at most four at the catch-up (withering is idempotent).
    expect(report.seasonChanges).toEqual(['summer', 'autumn', 'winter', 'spring', 'summer']);
    expect(report.dayStarts).toBeLessThanOrEqual(3);
    expect(ms).toBeLessThan(300);
    console.info(`30-day absence, everything running: ${ms.toFixed(1)} ms`);
  });
});

describe('saving in the middle of things', () => {
  function reload(g: Game, now: number): Game {
    const file = parseSave(JSON.stringify(toSaveFile(g.state, now)));
    return new Game(file.state, { data: GAME_DATA, lc: NY, now: () => now });
  }

  it('mid-minigame: the cast, the wait and the reel survive a save, and play on identically', () => {
    const t = at(NY, 2026, 1, 8, 12);
    const g = new Game(farmAt(t), { data: GAME_DATA, lc: NY, now: () => t });
    expect(g.dispatch({ type: 'fishStart', location: 'pond' }).ok).toBe(true);
    g.dispatch({ type: 'fishTick', holding: true, dtMs: 900 });
    g.dispatch({ type: 'fishTick', holding: false, dtMs: 16 }); // cast: now waiting
    expect(g.state.fishing.session?.phase).toBe('waiting');
    const w = reload(g, t);
    expect(w.state.fishing.session).toEqual(g.state.fishing.session);
    // Wait for the bite and start reeling on both, then save again mid-reel.
    for (const game of [g, w]) {
      for (let i = 0; i < 1000 && game.state.fishing.session?.phase === 'waiting'; i++)
        game.dispatch({ type: 'fishTick', holding: false, dtMs: 50 });
      game.dispatch({ type: 'fishTick', holding: true, dtMs: 16 });
    }
    expect(g.state.fishing.session?.phase).toBe('reeling');
    const r = reload(g, t);
    expect(r.state.fishing.session).toEqual(g.state.fishing.session);
    // Same inputs, same outcome: keep the marker under the zone's centre until it ends.
    const play = (game: Game): string => {
      for (let i = 0; i < 2000 && game.state.fishing.session; i++) {
        const reel = game.state.fishing.session.reel!;
        game.dispatch({ type: 'fishTick', holding: reel.marker < reel.zoneCenter, dtMs: 16 });
      }
      return JSON.stringify({
        fishing: game.state.fishing,
        inv: game.state.inventory,
        rng: game.state.rngState,
      });
    };
    expect(play(r)).toBe(play(g));
    expect(g.state.fishing.session).toBeNull();
  });

  it('mid-cook: the dish keeps its progress and its saved ingredient, and finishes after loading', () => {
    const t = at(NY, 2026, 1, 8, 12);
    const s = farmAt(t);
    s.kitchen.queue = [{ recipe: 'roasted_turnip', remainingMs: 12_345, saved: 'turnip' }];
    let now = t;
    const g = new Game(s, { data: GAME_DATA, lc: NY, now: () => now });
    g.advance(5_000);
    const file = parseSave(JSON.stringify(toSaveFile(g.state, now)));
    expect(file.state.kitchen.queue).toEqual([
      { recipe: 'roasted_turnip', remainingMs: 7_345, saved: 'turnip' },
    ]);
    // Cancelling after the load returns only what was spent (one turnip was saved by the perk).
    const c = structuredClone(file.state);
    const cg = new Game(c, { data: GAME_DATA, lc: NY, now: () => now });
    expect(cg.dispatch({ type: 'cancelCook', index: 0 }).ok).toBe(true);
    expect(countItem(c.inventory, 'turnip')).toBe(1);
    // Or load after 30 s away: the dish is done.
    const g2 = new Game(file.state, { data: GAME_DATA, lc: NY, now: () => now });
    now += 30_000;
    g2.catchUp(file.savedAt, now);
    expect(g2.state.kitchen.queue).toEqual([]);
    expect(countItem(g2.state.inventory, 'roasted_turnip')).toBe(1);
  });
});

describe('old and broken saves', () => {
  const FIXTURES = [
    fixtureV1,
    fixtureV2,
    fixtureV3,
    fixtureV4,
    fixtureV5,
    fixtureV6,
    fixtureV7,
    fixtureV8,
    fixtureV9,
    fixtureV10,
    fixtureV11,
    fixtureV12,
    fixtureV13,
    fixtureV14,
  ];

  it('there is a fixture for every save version, and each migrates, validates and plays on', () => {
    expect(FIXTURES.map((f) => f.version)).toEqual(Array.from({ length: SAVE_VERSION }, (_, i) => i + 1));
    for (const fixture of FIXTURES) {
      const file = parseSave(JSON.stringify(fixture));
      expect(file.version, `v${fixture.version}`).toBe(SAVE_VERSION);
      expect(validateState(file.state), `v${fixture.version}`).toBeNull();
      let now = file.savedAt + 9 * HOUR;
      const g = new Game(file.state, { data: GAME_DATA, lc: NY, now: () => now });
      const report = g.catchUp(file.savedAt, now);
      expect(report.simulatedMs).toBe(8 * HOUR + HOUR * 0.25);
      for (let i = 0; i < 100; i++) {
        now += 100;
        g.advance(100);
      }
      expect(Number.isInteger(g.state.clock.simMs)).toBe(true);
      expect(validateState(JSON.parse(JSON.stringify(g.state))), `v${fixture.version} after play`).toBeNull();
      // And it survives the next save.
      expect(parseSave(JSON.stringify(toSaveFile(g.state, now))).version).toBe(SAVE_VERSION);
    }
  });

  it('an exported old save imports into the current version', () => {
    for (const fixture of FIXTURES) {
      const file = importSave(encodeBase64(JSON.stringify(fixture)));
      expect(file.version).toBe(SAVE_VERSION);
    }
  });

  it('refuses broken saves with a SaveError that keeps the raw text', () => {
    const good = JSON.stringify(fixtureV8);
    const broken: Record<string, string> = {
      truncated: good.slice(0, good.length / 2),
      empty: '',
      'no state': '{"version":7,"savedAt":1}',
      'newer version': JSON.stringify({ ...fixtureV7, version: SAVE_VERSION + 1 }),
      'no version': JSON.stringify({ savedAt: 1, state: fixtureV7.state }),
      'negative gold': JSON.stringify({ ...fixtureV7, state: { ...fixtureV7.state, gold: -5 } }),
      'text gold': JSON.stringify({ ...fixtureV7, state: { ...fixtureV7.state, gold: '100' } }),
      'fractional clock': JSON.stringify({
        ...fixtureV7,
        state: { ...fixtureV7.state, clock: { simMs: 1.5, speed: 1 } },
      }),
      'missing plots': JSON.stringify({
        ...fixtureV7,
        state: { ...fixtureV7.state, farm: { grid: { cols: 4, rows: 2 } } },
      }),
      'null state': JSON.stringify({ version: 7, savedAt: 1, state: null }),
    };
    for (const [name, raw] of Object.entries(broken)) {
      let err: unknown;
      try {
        parseSave(raw);
      } catch (e) {
        err = e;
      }
      expect(err, name).toBeInstanceOf(SaveError);
      expect((err as SaveError).raw, name).toBe(raw);
    }
    expect(() => importSave('not base64 at all!!')).toThrow(SaveError);
    expect(() => importSave(encodeBase64('{"hello": "world"}'))).toThrow(SaveError);
  });

  it('a broken stored save is reported and left in place, never replaced by a new farm', () => {
    const data = new Map([[SAVE_KEY, '{"version":7,"state":{"gold":']]);
    const storage: SaveStorage = {
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => void data.set(k, v),
      removeItem: (k) => void data.delete(k),
    };
    const r = loadGame(storage, CREATED, NY);
    expect(r.kind).toBe('error');
    expect(data.get(SAVE_KEY)).toBe('{"version":7,"state":{"gold":');
  });
});

describe('timers stay whole over long sessions', { timeout: 30_000 }, () => {
  it('ten minutes of 60 Hz frames (16.67 ms each) keep simulated time an exact multiple of the tick', () => {
    let now = CREATED;
    const g = new Game(farmAt(CREATED), { data: GAME_DATA, lc: NY, now: () => now });
    const frame = 1000 / 60;
    let real = 0;
    for (let i = 0; i < 36_000; i++) {
      real += frame;
      now = CREATED + Math.floor(real);
      g.advance(frame);
    }
    expect(Number.isInteger(g.state.clock.simMs)).toBe(true);
    expect(g.state.clock.simMs % 100).toBe(0);
    expect(Math.abs(g.state.clock.simMs - 600_000)).toBeLessThanOrEqual(100);
    // Time played is counted exactly (a frame rounded to 17 ms each would say 612 s).
    expect(Math.abs(g.state.meta.playTimeMs - 600_000)).toBeLessThanOrEqual(1);
    expect(Number.isInteger(g.state.meta.playTimeMs)).toBe(true);
  });

  it('uneven frames and the ×60 time warp keep every saved timer an integer', () => {
    let now = CREATED;
    const s = everything(CREATED);
    const g = new Game(s, { data: GAME_DATA, lc: NY, now: () => now });
    g.dispatch({ type: 'debugSetTimeWarp', on: true });
    const frames = [16.6667, 7.3, 33.34, 16.6, 0.4, 250.25];
    for (let i = 0; i < 600; i++) {
      const f = frames[i % frames.length]!;
      now += f;
      g.advance(f);
    }
    const st = g.state;
    const ints = [
      st.clock.simMs,
      st.meta.playTimeMs,
      st.calendar.debugOffsetMs,
      st.shippingBin.msToPickup,
      st.automation.farmhandCooldownMs,
      ...st.farm.plots.flatMap((p) => [p.growthMs, p.waterMsLeft]),
      ...st.fishing.traps.map((t) => t.progressMs),
      ...st.kitchen.queue.map((j) => j.remainingMs),
      ...st.buffs.active.map((b) => b.remainingMs),
    ];
    for (const x of ints) expect(Number.isInteger(x), String(x)).toBe(true);
    expect(validateState(JSON.parse(JSON.stringify(st)))).toBeNull();
  });
});

describe('rapid double clicks', () => {
  it('a double click on a buy button buys once; a deliberate second click buys again', () => {
    const s = farmAt(CREATED);
    s.gold = 100_000;
    s.progression.farmLevelFloor = 5;
    let clock = 0;
    const guard = new PurchaseGuard(() => clock);
    const g = new Game(s, { data: GAME_DATA, lc: NY, now: () => CREATED });
    const buy = () => guard.run('upgrade:farmhand', () => g.dispatch({ type: 'buyUpgrade', id: 'farmhand' }));
    expect(buy().ok).toBe(true);
    clock += 120; // the second click of a double click lands on the rebuilt "level 2" button
    expect(buy().ok).toBe(false);
    expect(s.upgrades.farmhand).toBe(1);
    clock += DOUBLE_CLICK_MS;
    expect(buy().ok).toBe(true);
    expect(s.upgrades.farmhand).toBe(2);
    // A different item is not held back, and a failed click does not arm the guard.
    expect(guard.run('upgrade:hoe', () => g.dispatch({ type: 'buyUpgrade', id: 'hoe' })).ok).toBe(true);
    s.gold = 0;
    clock += 1;
    expect(guard.run('seeds:turnip', () => g.dispatch({ type: 'buySeeds', crop: 'turnip', qty: 1 })).ok).toBe(
      false,
    );
    s.gold = 100;
    expect(guard.run('seeds:turnip', () => g.dispatch({ type: 'buySeeds', crop: 'turnip', qty: 1 })).ok).toBe(
      true,
    );
  });

  it('the game itself never buys a one-off twice (expansions, recipe cards)', () => {
    const s = farmAt(CREATED);
    s.gold = 100_000;
    const g = new Game(s, { data: GAME_DATA, lc: NY, now: () => CREATED });
    expect(g.dispatch({ type: 'buyExpansion', id: 'farm_1' }).ok).toBe(true);
    expect(g.dispatch({ type: 'buyExpansion', id: 'farm_1' }).ok).toBe(false);
    expect(g.dispatch({ type: 'buyRecipe', recipe: 'wheat_flatbread' }).ok).toBe(true);
    expect(g.dispatch({ type: 'buyRecipe', recipe: 'wheat_flatbread' }).ok).toBe(false);
    expect(s.gold).toBe(100_000 - 400 - 120); // farm_1 and the Wheat Flatbread card
  });
});

describe('a full bag under automation', () => {
  /** A bag with every slot full of something else. */
  function fullBag(s: GameState): void {
    s.inventory.slots = s.inventory.slots.map(() => ({ item: 'old_boot', qty: s.inventory.stackSize }));
  }

  it('without the Auto-Seller: ready crops wait in the ground, nothing is lost, the RNG is untouched', () => {
    const s = farmAt(CREATED);
    s.farm.plots = s.farm.plots.map(() => ({
      ...emptyPlot('planted'),
      crop: 'potato' as CropId,
      growthMs: 240_000,
    }));
    own(s, { farmhand: 3, seed_planter: 2 });
    fullBag(s);
    const rng = s.rngState;
    const t = performance.now();
    const report = runOffline(s, GAME_DATA, NY, CREATED, CREATED + 8 * HOUR);
    expect(performance.now() - t).toBeLessThan(100); // the farmhand does not stop at every visit
    expect(s.farm.plots.every((p) => p.crop === 'potato' && isReady(p, GAME_DATA))).toBe(true);
    expect(s.stats.cropsHarvested).toBe(0);
    expect(s.rngState).toBe(rng);
    expect(report.events.filter((e) => e.type === 'harvested')).toEqual([]);
    // Room again: the next visit brings them in.
    s.inventory.slots[0] = null;
    s.inventory.slots[1] = null;
    runOffline(s, GAME_DATA, NY, CREATED + 8 * HOUR, CREATED + 8 * HOUR + MIN);
    expect(countItem(s.inventory, 'potato')).toBeGreaterThanOrEqual(8);
  });

  it('with the Auto-Seller: harvests go to the bin whatever the bag holds', () => {
    const s = farmAt(CREATED);
    s.farm.plots = s.farm.plots.map(() => ({
      ...emptyPlot('planted'),
      crop: 'turnip' as CropId,
      growthMs: 120_000,
    }));
    own(s, { farmhand: 1, auto_seller: 1 });
    fullBag(s);
    runOffline(s, GAME_DATA, NY, CREATED, CREATED + 31 * MIN);
    expect(s.stats.cropsHarvested).toBe(8);
    expect(s.shippingBin.items).toEqual([{ item: 'turnip', qty: 8 }]);
  });

  it('a Trap Collector with a full bag leaves the catch in the trap and says so', () => {
    const s = farmAt(CREATED);
    own(s, { trap_collector: 1 });
    s.fishing.traps = [
      { id: 1, location: 'pond', slot: 0, progressMs: 0, contents: [{ item: 'bluegill', qty: 3 }] },
    ];
    s.autoSell = { bluegill: false };
    fullBag(s);
    const report = runOffline(s, GAME_DATA, NY, CREATED, CREATED + 61 * MIN);
    const trapped = s.fishing.traps[0]!.contents.reduce((n, c) => n + c.qty, 0);
    expect(trapped).toBeGreaterThanOrEqual(3);
    expect(report.events.some((e) => e.type === 'inventoryFull')).toBe(true);
  });
});

describe('market prices at the demand floor and ceiling', () => {
  it('selling a mountain stops at the floor: half price, never less than 1g, quoted exactly', () => {
    const s = farmAt(CREATED);
    s.market.specials = [];
    const mods = computeModifiers(s, GAME_DATA);
    addItem(s.inventory, 'turnip', 99);
    const quote = quoteSale(s, GAME_DATA, mods, 'turnip', 99);
    const g = new Game(s, { data: GAME_DATA, lc: NY, now: () => CREATED });
    const gold = s.gold;
    expect(g.dispatch({ type: 'sell', item: 'turnip', qty: 99 }).ok).toBe(true);
    for (let i = 0; i < 20; i++) {
      addItem(s.inventory, 'turnip', 99);
      g.dispatch({ type: 'sell', item: 'turnip', qty: 99 });
    }
    expect(demandOf(s, 'turnip')).toBe(DEMAND_FLOOR);
    expect(unitPrice(s, GAME_DATA, mods, 'turnip')).toBe(Math.floor(22 * DEMAND_FLOOR * MARKET_CHANNEL));
    expect(s.gold - gold).toBeGreaterThanOrEqual(quote.gold);
    // The cheapest thing in the game still fetches at least 1g at the floor.
    s.market.items.old_boot = { demand: DEMAND_FLOOR, lastSoldSimMs: 0, history: [] };
    expect(unitPrice(s, GAME_DATA, mods, 'old_boot')).toBeGreaterThanOrEqual(1);
    const junk = { ...GAME_DATA.items.old_boot!, basePrice: 1 };
    expect(
      unitPrice(s, { ...GAME_DATA, items: { ...GAME_DATA.items, old_boot: junk } }, mods, 'old_boot'),
    ).toBe(1);
  });

  it('a rested market climbs to the ceiling and never past it, however long it rests', () => {
    const s = farmAt(CREATED);
    s.market.items.pumpkin = { demand: DEMAND_FLOOR, lastSoldSimMs: 0, history: [] };
    s.clock.simMs = 1;
    step(s, ctxAt(s, CREATED), 12 * HOUR);
    expect(demandOf(s, 'pumpkin')).toBeCloseTo(DEMAND_CEIL, 6);
    step(s, ctxAt(s, CREATED), 12 * HOUR);
    expect(demandOf(s, 'pumpkin')).toBeLessThanOrEqual(DEMAND_CEIL);
    // At the ceiling, a special and a Silver Tongue buff multiply on top of it (the demand itself is capped).
    s.market.specials = [{ item: 'pumpkin', bonus: 0.5 }];
    s.buffs.active = [
      { type: 'sellPrice', magnitude: 0.2, tier: 4, remainingMs: HOUR, source: 'harvest_feast' },
    ];
    const mods = computeModifiers(s, GAME_DATA);
    expect(unitPrice(s, GAME_DATA, mods, 'pumpkin')).toBe(
      Math.floor(639 * demandOf(s, 'pumpkin') * 1.5 * 1.2 * MARKET_CHANNEL),
    );
  });
});

describe('the Hoe and old regrowers (phase 09)', () => {
  it('pulls up a regrower that has given a harvest, never a young or a ready one, and never by area', () => {
    const s = farmAt(CREATED);
    const g = new Game(s, { data: GAME_DATA, lc: NY, now: () => CREATED });
    s.farm.plots[0] = { ...emptyPlot('planted'), crop: 'strawberry', harvests: 1, growthMs: 1000 };
    s.farm.plots[1] = { ...emptyPlot('planted'), crop: 'strawberry', harvests: 0, growthMs: 1000 };
    s.farm.plots[2] = { ...emptyPlot('planted'), crop: 'strawberry', harvests: 2, growthMs: 240_000 }; // ready
    s.farm.plots[3] = { ...emptyPlot('planted'), crop: 'turnip', growthMs: 1000 };
    s.lastPlantedCrop[0] = 'strawberry';
    expect(canPullUp(s.farm.plots[0]!, GAME_DATA)).toBe(true);
    expect([1, 2, 3].map((i) => canPullUp(s.farm.plots[i]!, GAME_DATA))).toEqual([false, false, false]);
    expect(g.dispatch({ type: 'till', plots: [1] })).toEqual({
      ok: false,
      reason: 'Let the strawberry give a harvest (and pick it) before pulling it up.',
    });
    // An upgraded hoe clicked on plot 3 reaches plot 0 in its area, but only pulls up what was aimed at.
    s.upgrades.hoe = 2;
    g.dispatch({ type: 'useTool', tool: 'hoe', plots: [4], seed: null });
    expect(s.farm.plots[0]!.state).toBe('planted');
    expect(g.dispatch({ type: 'useTool', tool: 'hoe', plots: [0], seed: null }).ok).toBe(true);
    expect(s.farm.plots[0]).toMatchObject({ state: 'tilled', crop: null });
    expect(s.lastPlantedCrop[0]).toBeNull(); // the planter will not bring it back
    expect([1, 2, 3].map((i) => s.farm.plots[i]!.state)).toEqual(['planted', 'planted', 'planted']);
    // Auto never picks the hoe for a crop (it waters the young one instead).
    g.dispatch({ type: 'useTool', tool: 'auto', plots: [1], seed: null });
    expect(s.farm.plots[1]!.state).toBe('planted');
  });

  it('farmhand harvests give a quarter of the Farming XP of hand harvests', () => {
    const hand = farmAt(CREATED);
    const auto = farmAt(CREATED);
    for (const s of [hand, auto]) {
      s.progression.goals = [];
      s.farm.plots[0] = { ...emptyPlot('planted'), crop: 'pumpkin', growthMs: 1_200_000 };
      s.inventory.stackSize = 999;
    }
    new Game(hand, { data: GAME_DATA, lc: NY, now: () => CREATED }).dispatch({ type: 'harvest', plots: [0] });
    own(auto, { farmhand: 1 });
    auto.automation.farmhandCooldownMs = 1;
    step(auto, ctxAt(auto, CREATED), 10);
    const xpOf = (s: GameState) => s.progression.skills.farming.xp;
    expect(xpOf(hand)).toBe(24);
    expect(xpOf(auto)).toBe(6);
  });
});
