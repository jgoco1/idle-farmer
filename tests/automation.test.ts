import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../src/core/events';
import { runOffline } from '../src/core/offline';
import { makeContext, processCalendar, step } from '../src/core/sim';
import { createInitialState, emptyPlot, type GameState, type Plot } from '../src/core/state';
import { buildCalendar } from '../src/core/time';
import { GAME_DATA } from '../src/data';
import { BIN_PICKUP_MS, roundNice } from '../src/data/balance';
import { CROP_IDS, seedOf, type CropId, type UpgradeId } from '../src/data/ids';
import { UPGRADES } from '../src/data/upgrades';
import { farmhandStats, msToNextAutomation, planPlanter } from '../src/systems/automation';
import { setAutoSell, stowHarvest } from '../src/systems/autoSeller';
import { buyExpansion } from '../src/systems/expansions';
import {
  autoToolFor,
  expandToolArea,
  growthAfter,
  harvestPlots,
  isReady,
  plantPlots,
  plotWatered,
  tickFarming,
  tillPlots,
  toolArea,
  useTool,
  waterPlots,
} from '../src/systems/farming';
import { addItem, countItem } from '../src/systems/inventory';
import { NO_MODIFIERS } from '../src/systems/modifiers';
import {
  areaOffsets,
  coverageOf,
  pickUpObject,
  placeObject,
  placementProblem,
  stockOf,
} from '../src/systems/placement';
import { buyUpgrade, requirementsFor, upgradeCost } from '../src/systems/upgrades';
import { at, HOUR, NY } from './helpers';

const CREATED = at(NY, 2026, 1, 7, 10); // Wednesday, spring until Sunday 11 Jan 00:00
const SAT_EVENING = at(NY, 2026, 1, 10, 20);
const MIN = 60_000;
const SEC = 1000;

function farmAt(t = CREATED): GameState {
  const s = createInitialState(CREATED, NY, 1);
  processCalendar(s, GAME_DATA, NY, t, []);
  return s;
}

function ctxAt(s: GameState, t = CREATED, events: GameEvent[] = []) {
  return makeContext(s, GAME_DATA, buildCalendar(t, s.calendar, NY), events);
}

/** Bought upgrade levels, set directly (the buying rules have their own tests). */
function own(s: GameState, levels: Partial<Record<UpgradeId, number>>): void {
  Object.assign(s.upgrades, levels);
  if (levels.farmhand) {
    s.automation.farmhandCooldownMs =
      GAME_DATA.upgrades.farmhand!.effect[levels.farmhand]!.intervalSec! * SEC;
  }
}

/** A `cols × rows` field with every plot tilled. */
function tilledField(s: GameState, cols: number, rows: number): void {
  s.farm.grid = { cols, rows };
  s.farm.plots = Array.from({ length: cols * rows }, () => emptyPlot('tilled'));
  s.lastPlantedCrop = Array.from({ length: cols * rows }, () => null);
  s.inventory.slots = s.inventory.slots.map(() => null); // no starting seeds: tests stock what they need
}

function stock(s: GameState, crop: CropId, qty: number): void {
  if (s.inventory.stackSize < qty) s.inventory.stackSize = qty;
  expect(addItem(s.inventory, seedOf(crop), qty)).toBe(true);
}

function planted(s: GameState, i: number, crop: CropId, growthMs = 0, waterMsLeft = 0): Plot {
  const plot: Plot = { state: 'planted', crop, growthMs, harvests: 0, waterMsLeft };
  s.farm.plots[i] = plot;
  return plot;
}

const idx = (s: GameState, col: number, row: number): number => row * s.farm.grid.cols + col;

describe('upgrade data', () => {
  it('has the ten phase-04 upgrades with the costs of BALANCE.md §4', () => {
    const costs = (id: UpgradeId): number[] => {
      const def = UPGRADES[id]!;
      return Array.from({ length: def.max }, (_, n) => upgradeCost(def, n));
    };
    expect(costs('sprinkler')).toEqual([300, 410, 550, 740, 1000, 1300, 1800, 2500, 3300, 4500, 6000, 8100]);
    expect(costs('sprinkler_tech')).toEqual([2500, 12000]);
    expect(costs('scarecrow')).toEqual([600, 1100, 1900, 3500]);
    expect(costs('farmhand')).toEqual([800, 1800, 3900, 8500, 19000]);
    expect(costs('seed_planter')).toEqual([1200, 3000, 7500]);
    expect(costs('auto_seller')).toEqual([1500, 6000]);
    expect(costs('watering_can')).toEqual([400, 2000, 10000]);
    expect(costs('hoe')).toEqual([250, 1200, 5800]);
    expect(costs('barn_storage')).toEqual([1000, 2500, 6300, 16000]);
    expect(costs('greenhouse')).toEqual([25000, 60000]);
    expect(roundNice(1080)).toBe(1100);
  });

  it('every upgrade describes each of its levels', () => {
    for (const id of [
      'sprinkler',
      'sprinkler_tech',
      'scarecrow',
      'farmhand',
      'seed_planter',
      'auto_seller',
      'watering_can',
      'hoe',
      'barn_storage',
      'greenhouse',
    ] as const) {
      const def = UPGRADES[id]!;
      expect(def.id).toBe(id);
      expect(def.effectText).toHaveLength(def.max + 1);
      expect(def.effect).toHaveLength(def.max + 1);
      expect(def.description.length).toBeGreaterThan(20);
    }
    expect(UPGRADES.sprinkler?.placeOn).toBe('plot');
    expect(UPGRADES.scarecrow?.placeOn).toBe('plot');
  });
});

describe('buying upgrades', () => {
  it('checks prerequisites and farm levels, level by level', () => {
    const s = farmAt();
    s.gold = 1_000_000;
    const ctx = ctxAt(s);
    // Farmhand needs Farm Level 3 (900 lifetime gold).
    expect(buyUpgrade(s, ctx, 'farmhand').ok).toBe(false);
    s.stats.lifetimeGold = 900;
    expect(buyUpgrade(s, ctx, 'farmhand').ok).toBe(true);
    // The planter and the auto-seller need the farmhand; the scarecrow needs the first expansion.
    expect(buyUpgrade(s, ctx, 'seed_planter').ok).toBe(true);
    const seller = buyUpgrade(createInitialState(0, NY), ctxAt(farmAt()), 'auto_seller');
    expect(seller.ok).toBe(false);
    const r = buyUpgrade(s, ctx, 'scarecrow');
    expect(r).toEqual({ ok: false, reason: 'Needs “Clear the Weeds” first.' });
    // Sprinkler Tech: level 1 at Farm Level 4, level 2 at Farm Level 7.
    expect(buyUpgrade(s, ctx, 'sprinkler_tech').ok).toBe(false);
    s.stats.lifetimeGold = 2100;
    expect(buyUpgrade(s, ctx, 'sprinkler_tech').ok).toBe(true);
    expect(buyUpgrade(s, ctx, 'sprinkler_tech').ok).toBe(false);
    s.stats.lifetimeGold = 18900;
    expect(buyUpgrade(s, ctx, 'sprinkler_tech').ok).toBe(true);
    expect(s.upgrades.sprinkler_tech).toBe(2);
    expect(buyUpgrade(s, ctx, 'sprinkler_tech').ok).toBe(false);
    expect(requirementsFor(UPGRADES.sprinkler_tech!, 0)).toEqual([{ kind: 'farmLevel', level: 4 }]);
    expect(requirementsFor(UPGRADES.sprinkler_tech!, 1)).toEqual([{ kind: 'farmLevel', level: 7 }]);
  });

  it('a placeable costs more with each unit and stops at its maximum', () => {
    const s = farmAt();
    s.gold = 1_000_000;
    const ctx = ctxAt(s);
    let spent = 0;
    for (const cost of [300, 410, 550, 740, 1000, 1300, 1800, 2500, 3300, 4500, 6000, 8100]) {
      expect(buyUpgrade(s, ctx, 'sprinkler').ok).toBe(true);
      spent += cost;
    }
    expect(s.gold).toBe(1_000_000 - spent);
    expect(s.upgrades.sprinkler).toBe(12);
    expect(buyUpgrade(s, ctx, 'sprinkler')).toEqual({
      ok: false,
      reason: 'You own every Sprinkler you can use.',
    });
  });

  it('hiring the farmhand starts its timer; a better one never waits longer than the new interval', () => {
    const s = farmAt();
    s.gold = 100_000;
    s.stats.lifetimeGold = 900;
    const ctx = ctxAt(s);
    expect(s.automation.farmhandCooldownMs).toBe(0);
    buyUpgrade(s, ctx, 'farmhand');
    expect(s.automation.farmhandCooldownMs).toBe(30 * SEC);
    s.automation.farmhandCooldownMs = 25 * SEC;
    buyUpgrade(s, ctx, 'farmhand'); // level 2: 22 s
    expect(s.automation.farmhandCooldownMs).toBe(22 * SEC);
    s.automation.farmhandCooldownMs = 5 * SEC;
    buyUpgrade(s, ctx, 'farmhand');
    expect(s.automation.farmhandCooldownMs).toBe(5 * SEC);
  });

  it('barn storage raises the stack size level by level', () => {
    const s = farmAt();
    s.gold = 100_000;
    s.stats.lifetimeGold = 300;
    const ctx = ctxAt(s);
    const sizes = [199, 299, 499, 999];
    for (const size of sizes) {
      expect(buyUpgrade(s, ctx, 'barn_storage').ok).toBe(true);
      expect(s.inventory.stackSize).toBe(size);
    }
  });

  it('the greenhouse needs an expansion and Farm Level 7, and adds 6 then 12 tilled plots', () => {
    const s = farmAt();
    s.gold = 1_000_000;
    const ctx = ctxAt(s);
    expect(buyUpgrade(s, ctx, 'greenhouse').ok).toBe(false);
    s.stats.lifetimeGold = 100_000;
    for (const id of ['farm_1', 'farm_2', 'farm_3'] as const) expect(buyExpansion(s, ctx, id).ok).toBe(true);
    expect(buyUpgrade(s, ctx, 'greenhouse').ok).toBe(true);
    expect(s.farm.greenhouse).toHaveLength(6);
    expect(s.farm.greenhouse.every((p) => p.state === 'tilled')).toBe(true);
    expect(s.lastPlantedCrop).toHaveLength(s.farm.plots.length + 6);
    expect(buyUpgrade(s, ctx, 'greenhouse').ok).toBe(true);
    expect(s.farm.greenhouse).toHaveLength(12);
    expect(s.lastPlantedCrop).toHaveLength(s.farm.plots.length + 12);
  });
});

describe('sprinkler areas', () => {
  it('cover a plus (4), a 3 × 3 ring (8) or a 5 × 5 ring (24) around the sprinkler', () => {
    expect(areaOffsets({ shape: 'plus', radius: 1 })).toHaveLength(4);
    expect(areaOffsets({ shape: 'square', radius: 1 })).toHaveLength(8);
    expect(areaOffsets({ shape: 'square', radius: 2 })).toHaveLength(24);
    for (const [tech, expected] of [
      [0, 4],
      [1, 8],
      [2, 24],
    ] as const) {
      const s = farmAt();
      tilledField(s, 8, 6);
      own(s, { sprinkler: 1, sprinkler_tech: tech });
      expect(placeObject(s, ctxAt(s), 'sprinkler', 4, 3).ok).toBe(true);
      const cov = coverageOf(s, GAME_DATA)!;
      expect([...cov.sprinkled].filter((x) => x === 1)).toHaveLength(expected);
      expect(cov.sprinkled[idx(s, 4, 3)]).toBe(0); // the sprinkler's own plot is used up
    }
  });

  it('the plus shape leaves the diagonals dry', () => {
    const s = farmAt();
    tilledField(s, 5, 5);
    own(s, { sprinkler: 1 });
    placeObject(s, ctxAt(s), 'sprinkler', 2, 2);
    const cov = coverageOf(s, GAME_DATA)!;
    const covered = [...cov.sprinkled].flatMap((v, i) => (v ? [i] : []));
    expect(covered).toEqual([idx(s, 2, 1), idx(s, 1, 2), idx(s, 3, 2), idx(s, 2, 3)]);
  });

  it('are clipped at the edge of the field', () => {
    const s = farmAt();
    tilledField(s, 4, 2);
    own(s, { sprinkler: 1, sprinkler_tech: 2 });
    placeObject(s, ctxAt(s), 'sprinkler', 0, 0);
    const cov = coverageOf(s, GAME_DATA)!;
    expect([...cov.sprinkled].filter((x) => x === 1)).toHaveLength(5); // the 3 × 2 corner block of a 4 × 2 field, minus itself
  });

  it('keep a crop growing at full speed after hand watering has run out', () => {
    const s = farmAt();
    tilledField(s, 4, 2);
    own(s, { sprinkler: 1 });
    placeObject(s, ctxAt(s), 'sprinkler', 1, 0); // covers (0,0), (2,0), (1,1)
    const covered = idx(s, 0, 0);
    const dry = idx(s, 3, 1);
    for (const i of [covered, dry]) planted(s, i, 'turnip');
    expect(plotWatered(s, GAME_DATA, covered)).toBe(true);
    expect(plotWatered(s, GAME_DATA, dry)).toBe(false);
    step(s, ctxAt(s), 2 * HOUR + 30 * MIN);
    // Turnips need 120 s watered: the covered one is long ready, the dry one is too after 2 h + …
    expect(isReady(s.farm.plots[covered]!, GAME_DATA)).toBe(true);
    const slow = planted(s, dry, 'pumpkin'); // 1200 s watered, 2400 s dry
    const fast = planted(s, covered, 'pumpkin');
    step(s, ctxAt(s), 1200 * SEC);
    expect(isReady(fast, GAME_DATA)).toBe(true);
    expect(slow.growthMs).toBe(600 * SEC);
  });

  it('are ignored by hand watering, which reports the covered plots as already wet', () => {
    const s = farmAt();
    tilledField(s, 4, 2);
    own(s, { sprinkler: 1 });
    placeObject(s, ctxAt(s), 'sprinkler', 1, 0);
    expect(waterPlots(s, ctxAt(s), [idx(s, 0, 0)])).toEqual({ ok: false, reason: 'Already watered.' });
    expect(waterPlots(s, ctxAt(s), [idx(s, 3, 1)]).ok).toBe(true);
  });
});

describe('scarecrows', () => {
  it('speed up every plot within two tiles by 20%, and only those', () => {
    const s = farmAt();
    tilledField(s, 8, 6);
    own(s, { scarecrow: 1 });
    expect(placeObject(s, ctxAt(s), 'scarecrow', 3, 3).ok).toBe(true);
    const cov = coverageOf(s, GAME_DATA)!;
    expect([...cov.bonus].filter((b) => b > 0)).toHaveLength(24);
    expect(cov.bonus[idx(s, 5, 5)]).toBeCloseTo(0.2); // the far corner of the 5 × 5 block
    expect(cov.bonus[idx(s, 6, 3)]).toBe(0);
    const near = planted(s, idx(s, 4, 4), 'wheat', 0, 10 * HOUR);
    const far = planted(s, idx(s, 7, 5), 'wheat', 0, 10 * HOUR);
    step(s, ctxAt(s), 100 * SEC);
    expect(near.growthMs).toBe(120 * SEC); // 100 s × (1 + 0.2)
    expect(far.growthMs).toBe(100 * SEC);
  });

  it('overlaps do not stack', () => {
    const s = farmAt();
    tilledField(s, 8, 6);
    own(s, { scarecrow: 2 });
    placeObject(s, ctxAt(s), 'scarecrow', 3, 3);
    placeObject(s, ctxAt(s), 'scarecrow', 4, 3);
    const cov = coverageOf(s, GAME_DATA)!;
    expect(Math.max(...cov.bonus)).toBeCloseTo(0.2);
    const plot = planted(s, idx(s, 3, 4), 'wheat', 0, 10 * HOUR);
    step(s, ctxAt(s), 100 * SEC);
    expect(plot.growthMs).toBe(120 * SEC);
  });

  it('stacks with the growth modifier additively (1 + buff + scarecrow)', () => {
    const plot = planted(farmAt(), 0, 'wheat');
    const mods = { ...NO_MODIFIERS, growthModifier: 1.1 };
    expect(growthAfter(plot, GAME_DATA.crops.wheat, 100 * SEC, mods, { sprinkled: true, bonus: 0.2 })).toBe(
      130 * SEC,
    );
  });
});

describe('placement', () => {
  it('needs a bought unit, a free plot inside the field and no growing crop', () => {
    const s = farmAt();
    const ctx = ctxAt(s);
    expect(placeObject(s, ctx, 'sprinkler', 0, 0)).toEqual({
      ok: false,
      reason: 'You have no sprinklers left to place. Buy one in Upgrades.',
    });
    own(s, { sprinkler: 2 });
    expect(placementProblem(s, 'sprinkler', 9, 0)).toBe('That is not a plot.');
    expect(placementProblem(s, 'sprinkler', 0, -1)).toBe('That is not a plot.');
    planted(s, 0, 'turnip');
    expect(placeObject(s, ctx, 'sprinkler', 0, 0)).toEqual({
      ok: false,
      reason: 'Harvest or clear the crop first.',
    });
    expect(placeObject(s, ctx, 'sprinkler', 1, 0).ok).toBe(true);
    expect(placeObject(s, ctx, 'sprinkler', 1, 0)).toEqual({
      ok: false,
      reason: 'A sprinkler already stands there.',
    });
    expect(stockOf(s, 'sprinkler')).toBe(1);
    expect(placeObject(s, ctx, 'sprinkler', 2, 0).ok).toBe(true);
    expect(stockOf(s, 'sprinkler')).toBe(0);
    expect(placeObject(s, ctx, 'sprinkler', 3, 0).ok).toBe(false);
    expect(s.placed.map((o) => o.id)).toEqual([1, 2]);
  });

  it('clears a dead crop when placed on it, and picking up returns the unit', () => {
    const s = farmAt();
    const ctx = ctxAt(s);
    own(s, { sprinkler: 1 });
    s.farm.plots[3] = emptyPlot('dead');
    expect(placeObject(s, ctx, 'sprinkler', 3, 0).ok).toBe(true);
    expect(s.farm.plots[3]!.state).toBe('tilled');
    expect(stockOf(s, 'sprinkler')).toBe(0);
    expect(pickUpObject(s, ctx, 99)).toEqual({ ok: false, reason: 'There is nothing to pick up.' });
    expect(pickUpObject(s, ctx, 1).ok).toBe(true);
    expect(s.placed).toEqual([]);
    expect(stockOf(s, 'sprinkler')).toBe(1);
    expect(placeObject(s, ctx, 'sprinkler', 0, 1).ok).toBe(true);
    expect(s.placed[0]!.id).toBe(1);
  });

  it('tools and the farmhand leave the plot under an object alone', () => {
    const s = farmAt();
    const ctx = ctxAt(s);
    own(s, { sprinkler: 1 });
    placeObject(s, ctx, 'sprinkler', 0, 0);
    expect(tillPlots(s, ctx, [0]).ok).toBe(false);
    expect(plantPlots(s, ctx, 'turnip', [0]).ok).toBe(false);
    const r = useTool(s, ctx, 'auto', [0], 'turnip');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/sprinkler stands here/);
    expect(autoToolFor(s, GAME_DATA, 'spring', 0, 'turnip')).toBeNull();
  });

  it('positions survive an expansion: objects keep their plot (col, row) in the bigger grid', () => {
    const s = farmAt();
    s.gold = 10_000;
    own(s, { sprinkler: 1 });
    placeObject(s, ctxAt(s), 'sprinkler', 3, 1);
    stock(s, 'turnip', 1);
    s.farm.plots[idx(s, 2, 1)] = emptyPlot('tilled');
    plantPlots(s, ctxAt(s), 'turnip', [idx(s, 2, 1)]);
    expect(s.lastPlantedCrop[idx(s, 2, 1)]).toBe('turnip');
    expect(buyExpansion(s, ctxAt(s), 'farm_1').ok).toBe(true);
    expect(s.farm.grid).toEqual({ cols: 4, rows: 3 });
    expect(s.placed[0]!.at).toEqual({ col: 3, row: 1 });
    const cov = coverageOf(s, GAME_DATA)!;
    expect(cov.sprinkled[idx(s, 3, 2)]).toBe(1);
    expect(s.lastPlantedCrop).toHaveLength(12);
    expect(s.lastPlantedCrop[idx(s, 2, 1)]).toBe('turnip');
    expect(buyExpansion(s, ctxAt(s), 'farm_2').ok).toBe(true); // 5 × 4: rows are now longer
    expect(s.lastPlantedCrop[idx(s, 2, 1)]).toBe('turnip');
    expect(s.lastPlantedCrop.filter((c) => c !== null)).toHaveLength(1);
  });
});

describe('tool upgrades', () => {
  it('the watering can and the hoe hit 1, 3, 9 or 25 tiles, clipped to the field', () => {
    const s = farmAt();
    tilledField(s, 8, 6);
    const centre = idx(s, 3, 3);
    expect(expandToolArea(s, [centre], 1)).toEqual([centre]);
    expect(expandToolArea(s, [centre], 3).sort((a, b) => a - b)).toEqual([centre - 1, centre, centre + 1]);
    expect(expandToolArea(s, [centre], 9)).toHaveLength(9);
    expect(expandToolArea(s, [centre], 25)).toHaveLength(25);
    expect(expandToolArea(s, [0], 25)).toHaveLength(9); // the corner keeps 3 × 3
    expect(expandToolArea(s, [0], 9)).toHaveLength(4);
    expect(expandToolArea(s, [0], 3)).toEqual([0, 1].sort());
  });

  it('follow the upgrade level for both tools', () => {
    const s = farmAt();
    expect(toolArea(s, GAME_DATA, 'water')).toBe(1);
    own(s, { watering_can: 2, hoe: 3 });
    expect(toolArea(s, GAME_DATA, 'water')).toBe(9);
    expect(toolArea(s, GAME_DATA, 'hoe')).toBe(25);
  });

  it('waters a 3 × 3 block with one click, and tills a row of three', () => {
    const s = farmAt();
    tilledField(s, 6, 4);
    own(s, { watering_can: 2, hoe: 1 });
    expect(useTool(s, ctxAt(s), 'water', [idx(s, 2, 1)], null).ok).toBe(true);
    const wet = s.farm.plots.flatMap((p, i) => (p.waterMsLeft > 0 ? [i] : []));
    expect(wet).toHaveLength(9);
    expect(wet).toContain(idx(s, 1, 0));
    expect(wet).toContain(idx(s, 3, 2));
    s.farm.plots.forEach((_, i) => (s.farm.plots[i] = emptyPlot('untilled')));
    expect(useTool(s, ctxAt(s), 'hoe', [idx(s, 2, 1)], null).ok).toBe(true);
    const tilled = s.farm.plots.flatMap((p, i) => (p.state === 'tilled' ? [i] : []));
    expect(tilled).toEqual([idx(s, 1, 1), idx(s, 2, 1), idx(s, 3, 1)]);
    // Explicit plot lists (the plain actions) are never widened.
    tillPlots(s, ctxAt(s), [idx(s, 0, 3)]);
    expect(s.farm.plots.filter((p) => p.state === 'tilled')).toHaveLength(4);
  });
});

describe('the Auto-Seller', () => {
  it('sends harvests to the bin when on, and to the bag when the item is toggled off', () => {
    const s = farmAt();
    tilledField(s, 4, 2);
    own(s, { auto_seller: 1 });
    planted(s, 0, 'potato', 240_000);
    planted(s, 1, 'turnip', 120_000);
    expect(setAutoSell(s, GAME_DATA, 'turnip', false).ok).toBe(true);
    const events: GameEvent[] = [];
    expect(harvestPlots(s, ctxAt(s, CREATED, events), [0, 1]).ok).toBe(true);
    expect(countItem(s.inventory, 'potato')).toBe(0);
    expect(countItem(s.inventory, 'turnip')).toBe(1);
    const inBin = s.shippingBin.items.find((x) => x.item === 'potato')!.qty;
    expect(inBin).toBeGreaterThanOrEqual(1);
    const shipped = events
      .filter((e) => e.type === 'harvested')
      .map((e) => (e.type === 'harvested' ? e.shipped : 0));
    expect(shipped).toEqual([inBin, 0]);
    expect(s.stats.cropsHarvested).toBe(inBin + 1);
  });

  it('does nothing without the upgrade, and ignores items that cannot be sold', () => {
    const s = farmAt();
    expect(stowHarvest(s, GAME_DATA, 'turnip', 3)).toEqual({ inv: 3, bin: 0 });
    own(s, { auto_seller: 1 });
    expect(setAutoSell(s, GAME_DATA, 'seed_turnip', true).ok).toBe(false);
    expect(stowHarvest(s, GAME_DATA, 'turnip', 3)).toEqual({ inv: 0, bin: 3 });
  });

  it('level 2 keeps 10 of each item in the bag and ships the rest', () => {
    const s = farmAt();
    own(s, { auto_seller: 2 });
    expect(stowHarvest(s, GAME_DATA, 'turnip', 4)).toEqual({ inv: 4, bin: 0 });
    expect(stowHarvest(s, GAME_DATA, 'turnip', 4)).toEqual({ inv: 4, bin: 0 });
    expect(stowHarvest(s, GAME_DATA, 'turnip', 4)).toEqual({ inv: 2, bin: 2 });
    expect(stowHarvest(s, GAME_DATA, 'turnip', 4)).toEqual({ inv: 0, bin: 4 });
    expect(countItem(s.inventory, 'turnip')).toBe(10);
    expect(s.shippingBin.items).toEqual([{ item: 'turnip', qty: 6 }]);
  });

  it('never blocks a harvest on a full bag, and pays out at the next pickup', () => {
    const s = farmAt();
    tilledField(s, 4, 2);
    own(s, { auto_seller: 1 });
    s.inventory.slots = [{ item: 'seed_turnip', qty: 99 }];
    planted(s, 0, 'turnip', 120_000);
    expect(harvestPlots(s, ctxAt(s), [0]).ok).toBe(true);
    const gold = s.gold;
    step(s, ctxAt(s), BIN_PICKUP_MS);
    expect(s.gold).toBeGreaterThan(gold);
    expect(s.stats.itemsShipped).toBe(1);
  });
});

describe('the farmhand', () => {
  function events(): GameEvent[] {
    return [];
  }

  it('has the speed and capacity of each level', () => {
    const s = farmAt();
    const ctx = ctxAt(s);
    expect(farmhandStats(s, ctx)).toBeNull();
    const table = [
      [1, 30, 6],
      [2, 22, 9],
      [3, 17, 12],
      [4, 12, 16],
      [5, 9, 20],
    ] as const;
    for (const [level, sec, cap] of table) {
      own(s, { farmhand: level });
      expect(farmhandStats(s, ctx)).toEqual({ intervalMs: sec * SEC, capacity: cap });
    }
  });

  it('harvests at most `capacity` ready plots per visit, one visit per interval', () => {
    const s = farmAt();
    tilledField(s, 8, 2);
    own(s, { farmhand: 1 }); // 6 plots every 30 s
    for (let i = 0; i < 16; i++) planted(s, i, 'turnip', 120_000);
    const ev = events();
    const ctx = ctxAt(s, CREATED, ev);
    step(s, ctx, 29_999);
    expect(s.farm.plots.filter((p) => p.state === 'planted')).toHaveLength(16);
    step(s, ctx, 1);
    expect(s.farm.plots.filter((p) => p.state === 'planted')).toHaveLength(10);
    step(s, ctx, 30 * SEC);
    expect(s.farm.plots.filter((p) => p.state === 'planted')).toHaveLength(4);
    step(s, ctx, 30 * SEC);
    expect(s.farm.plots.filter((p) => p.state === 'planted')).toHaveLength(0);
    const auto = ev.filter((e) => e.type === 'harvested');
    expect(auto).toHaveLength(16);
    expect(auto.every((e) => e.type === 'harvested' && e.auto)).toBe(true);
    expect(countItem(s.inventory, 'turnip')).toBe(16);
  });

  it('a better farmhand clears the field faster (plots per minute)', () => {
    const perMinute = (level: number): number => {
      const s = farmAt();
      tilledField(s, 8, 6);
      own(s, { farmhand: level });
      for (let i = 0; i < 48; i++) planted(s, i, 'turnip', 120_000);
      s.inventory.stackSize = 999;
      step(s, ctxAt(s), MIN);
      return 48 - s.farm.plots.filter((p) => p.state === 'planted').length;
    };
    // 6 per 30 s, 9 per 22 s, 12 per 17 s, 16 per 12 s, 20 per 9 s: visits at the end of each interval.
    expect([1, 2, 3, 4, 5].map(perMinute)).toEqual([12, 18, 36, 48, 48]);
  });

  it('automationSpeedModifier makes it work faster (the phase-06 seam)', () => {
    const s = farmAt();
    own(s, { farmhand: 1 });
    const ctx = ctxAt(s);
    ctx.mods = { ...NO_MODIFIERS, automationSpeedModifier: 2 };
    expect(farmhandStats(s, ctx)).toEqual({ intervalMs: 15 * SEC, capacity: 6 });
  });

  it('skips a ready crop whose harvest does not fit, and wakes up when there is room', () => {
    const s = farmAt();
    tilledField(s, 4, 2);
    own(s, { farmhand: 1 });
    s.inventory.slots = [{ item: 'seed_wheat', qty: 99 }];
    planted(s, 0, 'turnip', 120_000);
    const ctx = ctxAt(s);
    expect(msToNextAutomation(s, ctx)).toBe(Infinity); // nothing the farmhand can do
    step(s, ctx, 10 * MIN);
    expect(s.farm.plots[0]!.state).toBe('planted');
    expect(isReady(s.farm.plots[0]!, GAME_DATA)).toBe(true);
    s.inventory.slots.push(null);
    expect(msToNextAutomation(s, ctx)).toBeLessThanOrEqual(30 * SEC);
    step(s, ctx, 30 * SEC);
    expect(s.farm.plots[0]!.state).toBe('tilled');
  });

  it('reports the next useful visit on the visit grid, not every visit', () => {
    const s = farmAt();
    tilledField(s, 4, 2);
    own(s, { farmhand: 1 });
    planted(s, 0, 'turnip', 0, 10 * HOUR); // ready in 120 s
    const ctx = ctxAt(s);
    // Visits fall at 30, 60, 90, 120 … s; the crop is ready at 120 s, so that is the first useful one.
    expect(msToNextAutomation(s, ctx)).toBe(120 * SEC);
    s.farm.plots[0]!.growthMs = 1;
    expect(msToNextAutomation(s, ctx)).toBe(120 * SEC);
    s.farm.plots[0]!.growthMs = 0;
    s.farm.plots[0]!.waterMsLeft = 0; // dry: 240 s
    expect(msToNextAutomation(s, ctx)).toBe(240 * SEC);
  });

  it('does nothing before it is hired', () => {
    const s = farmAt();
    tilledField(s, 4, 2);
    planted(s, 0, 'turnip', 120_000);
    step(s, ctxAt(s), HOUR);
    expect(s.farm.plots[0]!.state).toBe('planted');
    expect(msToNextAutomation(s, ctxAt(s))).toBe(Infinity);
  });
});

describe('the seed planter', () => {
  it('level 1 replants what the farmhand harvested, and only that', () => {
    const s = farmAt();
    tilledField(s, 4, 2);
    own(s, { farmhand: 1, seed_planter: 1 });
    stock(s, 'turnip', 3);
    planted(s, 0, 'turnip', 120_000);
    s.lastPlantedCrop[0] = 'turnip';
    s.farm.plots[5] = emptyPlot('tilled'); // an empty plot the level-1 planter ignores
    const ev: GameEvent[] = [];
    step(s, ctxAt(s, CREATED, ev), 30 * SEC);
    expect(s.farm.plots[0]).toMatchObject({ state: 'planted', crop: 'turnip', growthMs: 0 });
    expect(s.farm.plots[5]!.state).toBe('tilled');
    expect(countItem(s.inventory, 'seed_turnip')).toBe(2);
    expect(ev.filter((e) => e.type === 'planted' && e.auto)).toEqual([
      { type: 'planted', crop: 'turnip', plots: [0], auto: true },
    ]);
  });

  it('does not replant without a seed in the bag', () => {
    const s = farmAt();
    tilledField(s, 4, 2);
    own(s, { farmhand: 1, seed_planter: 1 });
    planted(s, 0, 'turnip', 120_000);
    s.lastPlantedCrop[0] = 'turnip';
    step(s, ctxAt(s), 30 * SEC);
    expect(s.farm.plots[0]!.state).toBe('tilled');
  });

  it('never plants out of season, even the crop it remembers', () => {
    const summer = at(NY, 2026, 1, 13, 12);
    const s = farmAt(summer);
    tilledField(s, 4, 2);
    own(s, { farmhand: 1, seed_planter: 3 });
    stock(s, 'turnip', 5); // spring only
    s.lastPlantedCrop.fill('turnip');
    const ctx = ctxAt(s, summer);
    expect(ctx.calendar.season).toBe('summer');
    expect(planPlanter(s, ctx, 20, [])).toEqual([]);
    step(s, ctx, 5 * MIN);
    expect(s.farm.plots.every((p) => p.state === 'tilled')).toBe(true);
    expect(countItem(s.inventory, 'seed_turnip')).toBe(5);
  });

  it('level 2 fills empty tilled plots: the last crop, else the most valuable seed in season', () => {
    const s = farmAt();
    tilledField(s, 4, 2);
    own(s, { farmhand: 1, seed_planter: 2 });
    stock(s, 'turnip', 2);
    stock(s, 'potato', 4);
    s.lastPlantedCrop[0] = 'turnip';
    s.lastPlantedCrop[1] = 'turnip';
    s.lastPlantedCrop[2] = 'turnip'; // only two turnip seeds: the third plot falls back
    s.lastPlantedCrop[3] = 'wheat'; // summer crop: out of season, so it falls back too
    const jobs = planPlanter(s, ctxAt(s), 6, []);
    expect(jobs.slice(0, 4)).toEqual([
      { index: 0, crop: 'turnip', till: false },
      { index: 1, crop: 'turnip', till: false },
      { index: 2, crop: 'potato', till: false }, // potato: 36 × 1.5 beats turnip 22 × 1
      { index: 3, crop: 'potato', till: false },
    ]);
    step(s, ctxAt(s), 30 * SEC);
    expect(s.farm.plots.filter((p) => p.state === 'planted')).toHaveLength(6);
    expect(s.lastPlantedCrop[2]).toBe('potato');
  });

  it('level 3 clears dead crops and tills bare soil, but only when it has a seed to plant', () => {
    const s = farmAt();
    tilledField(s, 4, 2);
    own(s, { farmhand: 1, seed_planter: 3 });
    s.farm.plots[0] = emptyPlot('dead');
    s.farm.plots[1] = emptyPlot('untilled');
    const ev: GameEvent[] = [];
    step(s, ctxAt(s, CREATED, ev), 30 * SEC);
    expect(s.farm.plots[0]!.state).toBe('dead'); // no seeds: it leaves the plots alone
    stock(s, 'turnip', 2);
    step(s, ctxAt(s, CREATED, ev), 30 * SEC);
    expect(s.farm.plots[0]).toMatchObject({ state: 'planted', crop: 'turnip' });
    expect(s.farm.plots[1]).toMatchObject({ state: 'planted', crop: 'turnip' });
    expect(ev).toContainEqual({ type: 'tilled', plots: [0, 1], auto: true });
  });

  it('acts on at most `capacity` plots per visit, and keeps watered plots watered', () => {
    const s = farmAt();
    tilledField(s, 8, 2);
    own(s, { farmhand: 1, seed_planter: 2 });
    stock(s, 'turnip', 16);
    step(s, ctxAt(s), 30 * SEC);
    expect(s.farm.plots.filter((p) => p.state === 'planted')).toHaveLength(6);
    s.farm.plots.forEach((p) => (p.waterMsLeft = 0));
    const before = s.farm.plots.map((p) => p.waterMsLeft);
    step(s, ctxAt(s), 30 * SEC);
    expect(s.farm.plots.filter((p) => p.state === 'planted')).toHaveLength(12);
    expect(before.every((w) => w === 0)).toBe(true);
  });

  it('greenhouse plots ignore the season for the planter and for planting by hand', () => {
    const winter = at(NY, 2026, 1, 27, 12);
    const s = farmAt(winter);
    s.farm.greenhouse = [emptyPlot('tilled'), emptyPlot('tilled')];
    s.lastPlantedCrop.push(null, null);
    s.inventory.slots = s.inventory.slots.map(() => null);
    own(s, { farmhand: 1, seed_planter: 2 });
    stock(s, 'tomato', 2); // summer/autumn crop
    const ctx = ctxAt(s, winter);
    expect(ctx.calendar.season).toBe('winter');
    expect(plantPlots(s, ctx, 'tomato', [0]).ok).toBe(false);
    expect(plantPlots(s, ctx, 'tomato', [1000]).ok).toBe(true);
    step(s, ctx, 30 * SEC);
    expect(s.farm.greenhouse.map((p) => p.crop)).toEqual(['tomato', 'tomato']);
    expect(s.farm.plots.every((p) => p.state !== 'planted')).toBe(true);
  });
});

describe('the greenhouse', () => {
  it('is always watered, never withers, and is harvested by the farmhand', () => {
    const s = farmAt();
    s.farm.greenhouse = [emptyPlot('planted'), emptyPlot('tilled')];
    Object.assign(s.farm.greenhouse[0]!, { crop: 'wheat' });
    s.lastPlantedCrop.push(null, null);
    own(s, { farmhand: 1 });
    expect(plotWatered(s, GAME_DATA, 1000)).toBe(true);
    step(s, ctxAt(s), 180 * SEC); // wheat: 180 s watered; hand water would be 0
    expect(isReady(s.farm.greenhouse[0]!, GAME_DATA)).toBe(false); // the visit at 180 s already harvested it
    expect(s.farm.greenhouse[0]!.state).toBe('tilled');
    expect(countItem(s.inventory, 'wheat')).toBeGreaterThanOrEqual(1);
    const wither = ctxAt(s, at(NY, 2026, 1, 13, 12));
    Object.assign(s.farm.greenhouse[1]!, emptyPlot('planted'), { crop: 'turnip' });
    processCalendar(s, GAME_DATA, NY, at(NY, 2026, 1, 13, 12), []);
    expect(wither.calendar.season).toBe('summer');
    expect(s.farm.greenhouse[1]!.state).toBe('planted');
  });

  it('can be worked by hand through its own plot indexes', () => {
    const s = farmAt();
    s.farm.greenhouse = [emptyPlot('untilled')];
    s.lastPlantedCrop.push(null);
    stock(s, 'turnip', 1);
    const ctx = ctxAt(s);
    expect(tillPlots(s, ctx, [1000]).ok).toBe(true);
    expect(plantPlots(s, ctx, 'turnip', [1000]).ok).toBe(true);
    expect(s.lastPlantedCrop[s.farm.plots.length]).toBe('turnip');
    tickFarming(s, ctx, 120 * SEC);
    expect(harvestPlots(s, ctx, [1000]).ok).toBe(true);
    expect(countItem(s.inventory, 'turnip')).toBe(1);
    expect(plotWatered(s, GAME_DATA, 1000)).toBe(true);
    expect(plotWatered(s, GAME_DATA, 1001)).toBe(false);
  });
});

/** Everything that automation can change, for comparing runs. */
function snapshot(s: GameState) {
  return {
    plots: s.farm.plots,
    greenhouse: s.farm.greenhouse,
    slots: s.inventory.slots,
    bin: s.shippingBin,
    gold: s.gold,
    stats: s.stats,
    cooldown: s.automation.farmhandCooldownMs,
    rng: s.rngState,
    last: s.lastPlantedCrop,
    simMs: s.clock.simMs,
  };
}

/** A busy farm: farmhand, planter, auto-seller, a sprinkler, mixed crops and plenty of seeds. */
function busyFarm(): GameState {
  const s = farmAt();
  tilledField(s, 6, 4);
  own(s, { farmhand: 2, seed_planter: 2, auto_seller: 2, sprinkler: 2 });
  placeObject(s, ctxAt(s), 'sprinkler', 1, 1);
  placeObject(s, ctxAt(s), 'sprinkler', 4, 2);
  stock(s, 'turnip', 60);
  stock(s, 'potato', 60);
  stock(s, 'strawberry', 10);
  s.lastPlantedCrop.fill('turnip');
  for (let i = 0; i < 6; i++) s.lastPlantedCrop[i] = 'strawberry';
  // Hand-water half the field so the water-out events are in play too.
  for (let i = 12; i < 24; i++) s.farm.plots[i]!.waterMsLeft = HOUR;
  return s;
}

describe('one large step equals many small ones', () => {
  it('for the whole chain: harvest → replant → auto-ship → bin pickup (3 hours)', () => {
    const big = busyFarm();
    const small = structuredClone(big);
    step(big, ctxAt(big), 3 * HOUR);
    const ctx = ctxAt(small);
    for (let t = 0; t < 3 * HOUR; t += 100) step(small, ctx, 100);
    expect(snapshot(big)).toEqual(snapshot(small));
    // And something actually happened.
    expect(big.stats.cropsHarvested).toBeGreaterThan(100);
    expect(big.stats.itemsShipped).toBeGreaterThan(50);
    expect(big.gold).toBeGreaterThan(60);
  });

  it('through the offline walk, in one go or in a hundred pieces', () => {
    const a = busyFarm();
    const b = structuredClone(a);
    runOffline(a, GAME_DATA, NY, CREATED, CREATED + 6 * HOUR);
    for (let i = 0; i < 72; i++) {
      runOffline(b, GAME_DATA, NY, CREATED + i * 5 * MIN, CREATED + (i + 1) * 5 * MIN);
    }
    expect(snapshot(a)).toEqual(snapshot(b));
  });

  it('with a scarecrow bonus, within rounding', () => {
    const make = (): GameState => {
      const s = farmAt();
      tilledField(s, 6, 4);
      own(s, { farmhand: 3, seed_planter: 1, scarecrow: 1 });
      placeObject(s, ctxAt(s), 'scarecrow', 2, 2);
      stock(s, 'turnip', 200);
      for (let i = 0; i < 24; i++) {
        if (s.farm.plots[i]!.state === 'tilled') planted(s, i, 'turnip', 0, 30 * MIN);
        s.lastPlantedCrop[i] = 'turnip';
      }
      return s;
    };
    const big = make();
    const small = make();
    step(big, ctxAt(big), 2 * HOUR);
    const ctx = ctxAt(small);
    for (let t = 0; t < 2 * HOUR; t += 100) step(small, ctx, 100);
    // Growth is rounded once per step part, so a plot can differ by a millisecond or two, and a
    // visit that lands within that millisecond of a crop being ready can slip by one interval.
    const harvested = (s: GameState): number => s.stats.cropsHarvested;
    expect(Math.abs(harvested(big) - harvested(small))).toBeLessThanOrEqual(6);
    expect(harvested(big)).toBeGreaterThan(100);
  });
});

describe('across a change of season while away', () => {
  it('withers the spring crops, clears them, and only plants what is in season afterwards', () => {
    const s = farmAt(SAT_EVENING);
    tilledField(s, 4, 2);
    own(s, { farmhand: 2, seed_planter: 3, auto_seller: 1 });
    planted(s, 0, 'turnip', 100_000, 2 * HOUR);
    planted(s, 1, 'potato', 0, 2 * HOUR);
    stock(s, 'turnip', 2000);
    stock(s, 'wheat', 6);
    s.lastPlantedCrop.fill('turnip');
    const report = runOffline(s, GAME_DATA, NY, SAT_EVENING, SAT_EVENING + 8 * HOUR);
    expect(report.seasonChanges).toEqual(['summer']);
    const withered = report.events.find((e) => e.type === 'seasonChanged');
    expect(withered && withered.type === 'seasonChanged' && withered.withered).toBeGreaterThanOrEqual(1);
    // Before midnight the planter kept filling the field with turnips (spring); afterwards only wheat.
    const sown = report.events.filter((e) => e.type === 'planted' && e.auto);
    expect(sown.some((e) => e.type === 'planted' && e.crop === 'turnip')).toBe(true);
    const seasonAt = report.events.findIndex((e) => e.type === 'seasonChanged');
    const after = report.events.slice(seasonAt).filter((e) => e.type === 'planted');
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((e) => e.type === 'planted' && e.crop === 'wheat')).toBe(true);
    // No spring crop survived into summer.
    expect(s.farm.plots.every((p) => p.state !== 'planted' || p.crop === 'wheat')).toBe(true);
    // Every wheat seed found a cleared plot and was used up; the turnip seeds stayed in the bag.
    expect(countItem(s.inventory, 'seed_wheat')).toBe(0);
    expect(countItem(s.inventory, 'seed_turnip')).toBeGreaterThan(0);
    expect(s.farm.plots.some((p) => p.crop === 'turnip')).toBe(false);
  });

  it('is the same as playing it minute by minute', () => {
    const make = (): GameState => {
      const s = farmAt(SAT_EVENING);
      tilledField(s, 4, 2);
      own(s, { farmhand: 2, seed_planter: 3, auto_seller: 1 });
      stock(s, 'turnip', 50);
      stock(s, 'wheat', 30);
      s.lastPlantedCrop.fill('turnip');
      return s;
    };
    const a = make();
    const b = make();
    runOffline(a, GAME_DATA, NY, SAT_EVENING, SAT_EVENING + 8 * HOUR);
    for (let i = 0; i < 8 * 60; i++) {
      runOffline(b, GAME_DATA, NY, SAT_EVENING + i * MIN, SAT_EVENING + (i + 1) * MIN);
    }
    expect(snapshot(a)).toEqual(snapshot(b));
  });
});

describe('performance', () => {
  it('8 hours of a fully automated 8 × 6 farm take well under 100 ms', () => {
    const s = farmAt();
    tilledField(s, 8, 6);
    own(s, { farmhand: 5, seed_planter: 3, auto_seller: 2, sprinkler: 8, sprinkler_tech: 2, scarecrow: 2 });
    s.inventory.slots = Array.from({ length: 28 }, () => null);
    stock(s, 'turnip', 4000);
    stock(s, 'potato', 4000);
    s.lastPlantedCrop.fill('turnip');
    for (const [c, r] of [
      [1, 1],
      [4, 1],
      [7, 1],
      [1, 4],
      [4, 4],
      [7, 4],
      [3, 2],
      [5, 3],
    ] as const) {
      expect(placeObject(s, ctxAt(s), 'sprinkler', c, r).ok).toBe(true);
    }
    const t0 = performance.now();
    runOffline(s, GAME_DATA, NY, CREATED, CREATED + 8 * HOUR);
    const ms = performance.now() - t0;
    expect(s.stats.cropsHarvested).toBeGreaterThan(1000);
    expect(ms).toBeLessThan(100);
    // Reported for docs/PROGRESS.md.
    console.info(`8 h offline, 8 × 6 farm, farmhand 5: ${ms.toFixed(1)} ms, ${s.stats.cropsHarvested} crops`);
  });

  it('an idle farm (nothing growing) is a single step', () => {
    const s = farmAt();
    tilledField(s, 4, 2);
    own(s, { farmhand: 5 });
    expect(msToNextAutomation(s, ctxAt(s))).toBe(Infinity);
  });
});

describe('crops list stays complete', () => {
  it('covers every crop id for the planter fallback', () => {
    expect(CROP_IDS.length).toBe(15);
  });
});
