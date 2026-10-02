import { describe, expect, it } from 'vitest';
import {
  decodeBase64,
  encodeBase64,
  exportSave,
  importSave,
  loadGame,
  migrate,
  migrations,
  parseSave,
  SAVE_KEY,
  SAVE_VERSION,
  SaveError,
  toSaveFile,
  validateState,
  writeSave,
  type Migration,
  type SaveStorage,
} from '../src/core/save';
import { createInitialState } from '../src/core/state';
import { computeSeasonEpoch } from '../src/core/time';
import { unlockedLocations } from '../src/systems/locations';
import fixtureV1 from './fixtures/save-v1.json';
import fixtureV2 from './fixtures/save-v2.json';
import fixtureV3 from './fixtures/save-v3.json';
import fixtureV4 from './fixtures/save-v4.json';
import fixtureV5 from './fixtures/save-v5.json';
import fixtureV6 from './fixtures/save-v6.json';
import fixtureV7 from './fixtures/save-v7.json';
import {
  buildZones,
  LOCATION_ZONE,
  PLOT_ORIGIN,
  plotIndexAt,
  tileOfPlot,
  trapTile,
  zoneAt,
} from '../src/render/scene';
import fixture from './fixtures/save-v13.json';
import fixtureV12 from './fixtures/save-v12.json';
import fixtureV11 from './fixtures/save-v11.json';
import fixtureV10 from './fixtures/save-v10.json';
import fixtureV9 from './fixtures/save-v9.json';
import fixtureV8 from './fixtures/save-v8.json';
import { farmLevel } from '../src/systems/unlocks';
import { countItem } from '../src/systems/inventory';
import { at, NY } from './helpers';

const FIXTURE_TEXT = JSON.stringify(fixture);

/** Removes what the v9 → v10, v10 → v11 and v11 → v12 migrations added, so older migrations can be compared with their fixtures. */
function withoutV10(rest: Record<string, unknown>): Record<string, unknown> {
  delete rest.orchard;
  delete rest.ranch;
  delete rest.cats;
  delete (rest.stats as Record<string, unknown>).fruitPicked;
  delete (rest.stats as Record<string, unknown>).productsCollected;
  const cal = rest.calendar as Record<string, unknown>;
  delete cal.dayZeroKey;
  delete cal.maxDayIndex;
  return rest;
}

function memoryStorage(initial: Record<string, string> = {}): SaveStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe('save file', () => {
  it('is at version 13 (the feed store) with one migration per older version', () => {
    expect(SAVE_VERSION).toBe(13);
    expect(Object.keys(migrations)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']);
    expect(SAVE_KEY).toBe('hearthfield-idle/save');
  });

  it('the v13 fixture loads unchanged', () => {
    const file = parseSave(FIXTURE_TEXT);
    expect(file).toEqual(fixture);
  });

  it('the fixture has exactly the shape of a new state (bump SAVE_VERSION if this fails)', () => {
    // Arrays and id-keyed records (market items, upgrades) are compared by the shape of their entries.
    const RECORDS = new Set([
      'market.items',
      'upgrades',
      'fishing.collection',
      'progression.bundles',
      'decor.owned',
      'town.projects',
    ]);
    const keys = (o: object, path = ''): string[] => {
      const out = new Set<string>();
      const children: [string, unknown][] =
        Array.isArray(o) || RECORDS.has(path)
          ? Object.values(o).map((v): [string, unknown] => ['*', v])
          : Object.entries(o);
      for (const [k, v] of children) {
        const p = path ? `${path}.${k}` : k;
        out.add(p);
        if (v && typeof v === 'object') for (const c of keys(v, p)) out.add(c);
      }
      return [...out].sort();
    };
    const fresh = createInitialState(0, NY);
    fresh.upgrades.backpack = 1; // a new save owns no upgrades yet, so give the record an entry
    fresh.shippingBin.items.push({ item: 'turnip', qty: 1 });
    fresh.expansions.push('farm_1');
    fresh.land.parcels.push('orchard', 'yard');
    fresh.placed.push({ id: 1, kind: 'sprinkler', at: { col: 0, row: 0 } });
    // Progression: one goal of each shape, a partly filled bundle, a milestone and a finished bundle.
    fresh.progression.goals = [
      {
        template: 'harvest_crop',
        objective: { kind: 'harvest', crop: 'potato', count: 15 },
        progress: 6,
        rewards: [{ kind: 'gold', amount: 150 }],
      },
      {
        template: 'cook_distinct',
        objective: { kind: 'cook', distinct: true, count: 3 },
        progress: 2,
        seen: ['roasted_turnip'],
        rewards: [{ kind: 'items', items: [{ item: 'seed_wheat', qty: 5 }] }],
      },
      {
        template: 'earn_gold_day',
        objective: { kind: 'earnGold', amount: 500, withinOneDay: true },
        progress: 210,
        rewards: [{ kind: 'gold', amount: 200 }],
      },
    ];
    fresh.progression.bundles.pond_fish = [{ item: 'bluegill', qty: 3 }];
    fresh.progression.completedBundles.push('spring_crops');
    fresh.progression.milestones.done.push('m01_first_seed');
    fresh.autoSell.turnip = false;
    // Decorations and the town: stock, a placed (and a flipped) piece, a farmhouse style, a project under way.
    fresh.decor.owned.cobble_path = 2;
    fresh.decor.placed.push(
      { id: 1, decor: 'cobble_path', at: { col: 6, row: 9 } },
      { id: 2, decor: 'wooden_bench', at: { col: 10, row: 9 }, flipped: true },
    );
    fresh.decor.farmhouse.paint = 'paint_sage';
    fresh.town.projects.old_bridge = { stagesDone: 1, gold: 100, items: [] };
    // The orchard: a tree with fruit hanging.
    fresh.orchard.trees.push({
      id: 1,
      tree: 'cherry_tree',
      spot: 0,
      plantedDay: 0,
      fruit: 10,
      lastFruitDay: 4,
    });
    // The ranch: a coop with a store, a hen and a cow.
    fresh.ranch.buildings.push({
      id: 1,
      kind: 'coop',
      level: 2,
      at: { col: 22, row: 9 },
      trough: 40,
      store: [{ item: 'egg', qty: 5 }],
      cycleMs: 600000,
    });
    fresh.ranch.animals.push({ id: 1, kind: 'chicken', name: 'Clover', building: 1 });
    fresh.fishing.traps.push({
      id: 1,
      location: 'pond',
      slot: 0,
      progressMs: 0,
      contents: [{ item: 'bluegill', qty: 1 }],
    });
    fresh.fishing.collection.bluegill = { firstCaughtAt: '2026-01-07', bestSizeCm: 20, count: 1 };
    fresh.kitchen.queue.push({ recipe: 'baked_potato', remainingMs: 0, hearty: true, saved: 'potato' });
    fresh.buffs.active.push({
      type: 'growth',
      magnitude: 0.2,
      tier: 2,
      remainingMs: 1,
      source: 'vegetable_soup',
    });
    fresh.inventory.slots[4] = { item: 'roasted_turnip', qty: 2, hearty: true };
    expect(keys(fixture.state)).toEqual(keys(fresh));
  });

  it('the fixture calendar is consistent with the time rules', () => {
    expect(computeSeasonEpoch(fixture.state.calendar.createdAt, NY)).toBe(fixture.state.calendar.seasonEpoch);
  });

  it('round-trips through JSON', () => {
    const file = parseSave(FIXTURE_TEXT);
    const again = parseSave(JSON.stringify(toSaveFile(file.state, file.savedAt)));
    expect(again).toEqual(file);
  });

  it('never saves the debug time warp', () => {
    const s = createInitialState(at(NY, 2026, 1, 7), NY, 1);
    s.clock.speed = 60;
    const file = toSaveFile(s, 123);
    expect(file.state.clock.speed).toBe(1);
    expect(s.clock.speed).toBe(60);
    expect(file.savedAt).toBe(123);
    expect(file.state.meta.lastSavedAt).toBe(123);
  });

  it('validates a new state', () => {
    expect(validateState(createInitialState(0, NY))).toBeNull();
    expect(validateState({ ...createInitialState(0, NY), gold: 'lots' })).toBe('bad gold');
  });

  it('rejects damaged farm and inventory data', () => {
    const s = createInitialState(0, NY);
    const bad = (mutate: (x: ReturnType<typeof createInitialState>) => void): string | null => {
      const c = structuredClone(s);
      mutate(c);
      return validateState(c);
    };
    expect(bad((c) => c.farm.plots.pop())).toBe('bad plots');
    expect(bad((c) => (c.farm.plots[0]!.state = 'ready' as never))).toBe('bad plot state');
    expect(bad((c) => (c.farm.plots[0]!.growthMs = 1.5))).toBe('bad plot timers');
    expect(bad((c) => (c.farm.plots[0]!.state = 'planted'))).toBe('bad plot crop');
    expect(bad((c) => (c.inventory.slots[0] = { item: 'turnip', qty: 0 }))).toBe('bad inventory slot');
    expect(bad((c) => delete (c as Partial<typeof c>).inventory)).toBe('bad inventory');
    expect(bad((c) => (c.gold = 1.5))).toBe('bad gold');
    expect(
      bad((c) => (c.market.items.turnip = { demand: 'high' as never, lastSoldSimMs: -1, history: [] })),
    ).toBe('bad market item');
    expect(bad((c) => (c.shippingBin.msToPickup = 0))).toBe('bad shipping bin');
    expect(bad((c) => (c.stats.lifetimeGold = NaN))).toBe('bad stats');
    expect(bad((c) => (c.upgrades.backpack = 'x' as never))).toBe('bad upgrades');
    expect(bad((c) => c.placed.push({ id: 1, kind: 'sprinkler', at: { col: 9, row: 0 } }))).toBe(
      'bad placed object',
    );
    expect(
      bad((c) => {
        c.placed.push({ id: 1, kind: 'sprinkler', at: { col: 0, row: 0 } });
        c.placed.push({ id: 2, kind: 'scarecrow', at: { col: 0, row: 0 } });
      }),
    ).toBe('bad placed object');
    expect(bad((c) => (c.autoSell.turnip = 'yes' as never))).toBe('bad auto-sell');
    expect(bad((c) => (c.automation.farmhandCooldownMs = -5))).toBe('bad automation');
    expect(bad((c) => c.lastPlantedCrop.pop())).toBe('bad planter memory');
  });
});

describe('export and import', () => {
  it('base64 is UTF-8 safe', () => {
    const text = 'Café · 🌱 · ≈≈';
    expect(decodeBase64(encodeBase64(text))).toBe(text);
  });

  it('an exported save imports back identically', () => {
    const file = parseSave(FIXTURE_TEXT);
    const b64 = exportSave(file);
    expect(b64).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(importSave(`  ${b64}\n`)).toEqual(file);
  });

  it('rejects text that is not a save', () => {
    expect(() => importSave('not base64 at all!')).toThrow(SaveError);
    expect(() => importSave(encodeBase64('{"hello":1}'))).toThrow(SaveError);
  });
});

describe('migrations', () => {
  // A fake old format: version 0 had no settings and called gold "coins".
  const v0 = {
    version: 0,
    savedAt: 42,
    state: { ...structuredClone(fixtureV1.state), settings: undefined, gold: undefined, coins: 70 },
  };
  const table: Record<number, Migration> = {
    ...migrations,
    0: (old) => {
      const { coins, ...rest } = old;
      return { ...rest, gold: coins, settings: { masterVolume: 0.8, relaxedFishing: false } };
    },
  };

  it('applies migrations in order up to the target version', () => {
    const file = migrate(v0, table);
    expect(file.version).toBe(SAVE_VERSION);
    expect(file.savedAt).toBe(42);
    expect(file.state.gold).toBe(70);
    expect(file.state.settings).toEqual({ masterVolume: 0.8, relaxedFishing: false });
    expect('coins' in file.state).toBe(false);
    expect(validateState(file.state)).toBeNull();
  });

  it('migrates a phase-01 (v1) save into a valid current save', () => {
    const file = parseSave(JSON.stringify(fixtureV1));
    expect(file.version).toBe(SAVE_VERSION);
    expect(file.savedAt).toBe(fixtureV1.savedAt);
    const s = file.state;
    // Everything from v1 is kept.
    expect(s.clock).toEqual(fixtureV1.state.clock);
    expect(s.calendar).toEqual({
      ...fixtureV1.state.calendar,
      dayZeroKey: fixtureV1.state.calendar.lastDayKey,
      maxDayIndex: 0,
    });
    expect(s.rngState).toBe(fixtureV1.state.rngState);
    expect(s.settings).toEqual({ ...fixtureV1.state.settings, relaxedFishing: false });
    expect(s.meta).toEqual(fixtureV1.state.meta);
    // The new fields match a brand-new farm: starting gold, 4 × 2 plots (left half tilled), 6 turnip seeds.
    const fresh = createInitialState(0, NY);
    expect(s.gold).toBe(60);
    expect(s.farm).toEqual(fresh.farm);
    expect(s.inventory).toEqual(fresh.inventory);
    expect(s.stats).toEqual(fresh.stats);
    expect(s.farm.plots.map((p) => p.state)).toEqual([
      'tilled',
      'tilled',
      'untilled',
      'untilled',
      'tilled',
      'tilled',
      'untilled',
      'untilled',
    ]);
  });

  it('migrates a phase-02 (v2) save into a valid current save with default market values', () => {
    const file = parseSave(JSON.stringify(fixtureV2));
    expect(file.version).toBe(SAVE_VERSION);
    const s = file.state;
    // Everything from v2 is kept.
    const { state: old } = fixtureV2;
    expect(s.clock).toEqual(old.clock);
    expect(s.calendar).toEqual({ ...old.calendar, dayZeroKey: old.calendar.lastDayKey, maxDayIndex: 0 });
    expect(s.rngState).toBe(old.rngState);
    expect(s.gold).toBe(old.gold);
    expect(s.farm).toEqual(old.farm);
    expect(s.inventory).toEqual(old.inventory);
    // Every item is at demand 1.0 (no entries), no specials until the next 06:00, an empty bin.
    expect(s.market).toEqual({ items: {}, specials: [] });
    expect(s.shippingBin).toEqual({ items: [], msToPickup: 3_600_000 });
    expect(s.expansions).toEqual([]);
    expect(s.stats).toEqual({
      fruitPicked: 0,
      productsCollected: 0,
      lifetimeGold: 0,
      goldToday: 0,
      cropsHarvested: 0,
      itemsShipped: 0,
      daysPassed: 0,
      fishCaught: 0,
      dishesCooked: 0,
      dishesEaten: 0,
      bestDishTier: 0,
    });
    expect(s.upgrades).toEqual({});
    expect(validateState(s)).toBeNull();
  });

  it('migrates a phase-04 (v4) save: everything is kept, fishing starts empty', () => {
    const file = parseSave(JSON.stringify(fixtureV4));
    expect(file.version).toBe(SAVE_VERSION);
    const s = file.state;
    const { state: old } = fixtureV4;
    expect(s.gold).toBe(old.gold);
    expect(s.farm).toEqual(old.farm);
    expect(s.upgrades).toEqual(old.upgrades);
    expect(s.expansions).toEqual(old.expansions);
    expect(s.placed).toEqual(old.placed);
    expect(s.lastPlantedCrop).toEqual(old.lastPlantedCrop);
    expect(s.stats).toEqual({
      ...old.stats,
      fruitPicked: 0,
      productsCollected: 0,
      fishCaught: 0,
      dishesCooked: 0,
      dishesEaten: 0,
      bestDishTier: 0,
    });
    expect(s.settings).toEqual({ ...old.settings, relaxedFishing: false });
    // No traps, an empty Fish Collection, no cast in progress; only the pond is open.
    expect(s.fishing).toEqual({ traps: [], collection: {}, session: null });
    expect(unlockedLocations(s)).toEqual(['pond']);
    expect(validateState(s)).toBeNull();
  });

  it('migrates a phase-05 (v5) save: everything is kept, the kitchen starts with the starter recipes', () => {
    const file = parseSave(JSON.stringify(fixtureV5));
    expect(file.version).toBe(SAVE_VERSION);
    const s = file.state;
    const { state: old } = fixtureV5;
    expect(s.gold).toBe(old.gold);
    expect(s.farm).toEqual(old.farm);
    expect(s.inventory).toEqual(old.inventory);
    expect(s.fishing).toEqual(old.fishing);
    expect(s.upgrades).toEqual(old.upgrades);
    expect(s.stats).toEqual({
      ...old.stats,
      fruitPicked: 0,
      productsCollected: 0,
      dishesCooked: 0,
      dishesEaten: 0,
      bestDishTier: 0,
    });
    // The starter recipes, then the ones the phase-07 backfill hands out for milestones the save already shows.
    expect(s.kitchen.queue).toEqual([]);
    expect(s.kitchen.known.slice(0, 3)).toEqual(createInitialState(0, NY).kitchen.known); // stays in step with the data
    expect(s.kitchen.known).toContain('seaweed_salad'); // the v5 fixture has caught fish
    expect(s.buffs).toEqual({ active: [], baseSlots: 3 });
    expect(validateState(s)).toBeNull();
  });

  it('migrates a phase-06 (v6) save: milestones, XP and the Farm Level are backfilled, nothing is lost', () => {
    const file = parseSave(JSON.stringify(fixtureV6));
    expect(file.version).toBe(SAVE_VERSION);
    const s = file.state;
    const { state: old } = fixtureV6;
    expect(s.gold).toBe(old.gold); // no milestone gold is paid a second time
    expect(s.farm).toEqual(old.farm);
    expect(s.stats).toEqual({ ...old.stats, fruitPicked: 0, productsCollected: 0 });
    expect(s.upgrades).toEqual(old.upgrades);
    // Deeds the save already shows: planted, harvested, sold, expanded, sprinkler, fish, dish, ate, farmhand, river.
    expect(s.progression.milestones.done).toEqual([
      'm01_first_seed',
      'm02_first_harvest',
      'm03_first_sale',
      'm04_first_expansion',
      'm05_first_sprinkler',
      'm06_first_catch',
      'm07_first_dish',
      'm08_first_buff',
      'm09_hire_farmhand',
      'm10_unlock_river',
    ]);
    // Their recipes are learned (the save knew vegetable_soup already).
    expect(s.kitchen.known).toEqual([...old.kitchen.known, 'seaweed_salad', 'garlic_trout']);
    // XP is what the harvests, catches and dishes so far are worth on average.
    expect(s.progression.skills).toEqual({
      farming: { xp: 57 * 4 },
      fishing: { xp: 3 * 10 },
      cooking: { xp: 3 * 20 },
    });
    // The old lifetime-gold level (2400 gold: level 4) is a floor; skills and milestones now give more.
    expect(s.progression.farmLevelFloor).toBe(4);
    expect(farmLevel(s)).toBe(5); // ten milestones and Farming 2: 11 points
    expect(s.progression).toMatchObject({ goals: [], goalsDone: 0, bundles: {}, completedBundles: [] });
    expect(validateState(s)).toBeNull();
  });

  it('never lowers the level an older save showed, however little it has done', () => {
    const raw = structuredClone(fixtureV6) as unknown as { state: { stats: Record<string, number> } };
    Object.assign(raw.state.stats, {
      cropsHarvested: 0,
      fishCaught: 0,
      dishesCooked: 0,
      dishesEaten: 0,
      bestDishTier: 0,
    });
    raw.state.stats.lifetimeGold = 38_100; // the old formula's Farm Level 8
    const s = parseSave(JSON.stringify(raw)).state;
    expect(s.progression.farmLevelFloor).toBe(8);
    expect(farmLevel(s)).toBe(8);
    expect(s.progression.milestones.done).toContain('m11_farm_level_5');
    expect(s.kitchen.known).toContain('scholars_stew');
  });

  it('validates progression', () => {
    const bad = (mut: (s: ReturnType<typeof createInitialState>) => void): string | null => {
      const c = structuredClone(createInitialState(0, NY));
      mut(c);
      return validateState(c);
    };
    expect(validateState(createInitialState(0, NY))).toBeNull();
    expect(bad((c) => delete (c as Partial<typeof c>).progression)).toBe('bad progression');
    expect(bad((c) => (c.progression.skills.farming.xp = -1))).toBe('bad skills');
    expect(bad((c) => (c.progression.milestones.done = [1 as never]))).toBe('bad milestones');
    expect(bad((c) => (c.progression.goals = [{ template: 'harvest_any' } as never]))).toBe('bad goal');
    expect(bad((c) => (c.progression.farmLevelFloor = 0))).toBe('bad progression');
    expect(bad((c) => (c.progression.bundles = { pond_fish: [{ item: 'carp', qty: 0 }] }))).toBe(
      'bad bundles',
    );
    expect(bad((c) => (c.progression.completedBundles = [3 as never]))).toBe('bad bundles');
  });

  it('validates the kitchen and the buffs', () => {
    const bad = (mut: (s: ReturnType<typeof createInitialState>) => void): string | null => {
      const c = structuredClone(createInitialState(0, NY));
      mut(c);
      return validateState(c);
    };
    expect(bad((c) => (c.kitchen.queue = [{ recipe: 'baked_potato', remainingMs: 1.5 }]))).toBe(
      'bad cook job',
    );
    expect(bad((c) => delete (c as Partial<typeof c>).kitchen)).toBe('bad kitchen');
    expect(bad((c) => (c.buffs.baseSlots = 0))).toBe('bad buffs');
    const buff = {
      type: 'growth',
      magnitude: 0.1,
      tier: 1,
      remainingMs: 5,
      source: 'roasted_turnip',
    } as const;
    expect(bad((c) => c.buffs.active.push({ ...buff }, { ...buff }))).toBe('bad buff'); // one per type
    expect(bad((c) => c.buffs.active.push({ ...buff, remainingMs: 0 }))).toBe('bad buff');
    expect(bad((c) => c.buffs.active.push({ ...buff }))).toBeNull();
  });

  it('validates the fishing state', () => {
    const bad = (mut: (s: ReturnType<typeof createInitialState>) => void): string | null => {
      const c = structuredClone(createInitialState(0, NY));
      mut(c);
      return validateState(c);
    };
    expect(
      bad(
        (c) =>
          (c.fishing.traps = [{ id: 1, location: 'lake' as never, slot: 0, progressMs: 0, contents: [] }]),
      ),
    ).toBe('bad trap');
    expect(
      bad((c) => (c.fishing.collection.koi = { firstCaughtAt: 1 as never, bestSizeCm: 3, count: 1 })),
    ).toBe('bad fish collection');
    expect(
      bad(
        (c) =>
          (c.fishing.session = {
            location: 'pond',
            phase: 'reeling',
            power: 0.5,
            fish: 'koi',
            sizeCm: 40,
            waitMs: 0,
            reel: null,
          }),
      ),
    ).toBe('bad fishing session');
    expect(bad((c) => (c.settings.relaxedFishing = 'yes' as never))).toBe('bad settings');
  });

  it('migrates a v7 save into the world (v8): no parcels, nothing moved, every v1 spot hit-tests as before', () => {
    const file = parseSave(JSON.stringify(fixtureV7));
    expect(file.version).toBe(SAVE_VERSION);
    expect(validateState(file.state)).toBeNull();
    const s = file.state;
    expect(s.land).toEqual({ parcels: [] });
    const rest: Record<string, unknown> = JSON.parse(JSON.stringify(s));
    delete rest.land;
    delete rest.decor; // v9 and v10 additions; their migrations have their own tests
    delete rest.town;
    expect(withoutV10(rest)).toEqual(fixtureV7.state);
    // The v1 scene is the world's top-left corner at the same tiles: every zone, plot and trap spot
    // of the old save is found exactly where v1 found it.
    const grid = s.farm.grid;
    const zones = buildZones(grid);
    const V1_ZONES: [number, number, string][] = [
      [2, 2, 'farmhouse'],
      [5, 3, 'pet'],
      [2, 9, 'pond'],
      [16, 7, 'market'],
      [18, 7, 'bin'],
      [17, 3, 'greenhouse'],
      [10, 11, 'river'],
      [17, 10, 'dock'],
    ];
    for (const [c, r, id] of V1_ZONES) expect(zoneAt(zones, c, r)?.id, `${c},${r}`).toBe(id);
    for (let i = 0; i < s.farm.plots.length; i++) {
      const t = tileOfPlot(grid, i);
      expect(plotIndexAt(grid, t.col, t.row), `plot ${i}`).toBe(i);
      expect(zoneAt(zones, t.col, t.row)?.id).toBe('plots');
    }
    for (const o of s.placed)
      expect(
        plotIndexAt(grid, PLOT_ORIGIN.col + o.at.col, PLOT_ORIGIN.row + o.at.row),
      ).toBeGreaterThanOrEqual(0);
    for (const t of s.fishing.traps) {
      const at = trapTile(t.location, t.slot);
      expect(zoneAt(zones, at.col, at.row)?.id, `${t.location} trap ${t.slot}`).toBe(
        LOCATION_ZONE[t.location],
      );
    }
  });

  it('migrates a v10 save (v11): no buildings, no animals, nothing is lost', () => {
    const file = parseSave(JSON.stringify(fixtureV10));
    expect(file.version).toBe(SAVE_VERSION);
    expect(validateState(file.state)).toBeNull();
    const s = file.state;
    expect(s.ranch).toEqual({ buildings: [], animals: [], feedStore: { hay: 0, corn_feed: 0 } });
    expect(s.stats.productsCollected).toBe(0);
    expect(s.orchard).toEqual(fixtureV10.state.orchard);
    expect(s.land).toEqual(fixtureV10.state.land);
    const rest: Record<string, unknown> = JSON.parse(JSON.stringify(s));
    delete rest.ranch;
    delete rest.cats;
    delete (rest.stats as Record<string, unknown>).productsCollected;
    expect(rest).toEqual(fixtureV10.state);
    // Eggs and milk are not shipped automatically until the player says so.
    expect(s.autoSell).toEqual(fixtureV10.state.autoSell);
  });

  it('migrates a v11 save (v12): the brown tabby naps by the door, nobody else adopted, nothing is lost', () => {
    const file = parseSave(JSON.stringify(fixtureV11));
    expect(file.version).toBe(SAVE_VERSION);
    expect(validateState(file.state)).toBeNull();
    expect(file.state.cats).toEqual({ adopted: ['cat_tabby'], active: 'cat_tabby' });
    const rest: Record<string, unknown> = JSON.parse(JSON.stringify(file.state));
    delete rest.cats;
    delete (rest.ranch as Record<string, unknown>).feedStore;
    expect(rest).toEqual(fixtureV11.state);
  });

  it('migrates a v12 save (v13): an empty feed store when the bag holds no feed, nothing else changes', () => {
    const file = parseSave(JSON.stringify(fixtureV12));
    expect(file.version).toBe(SAVE_VERSION);
    expect(validateState(file.state)).toBeNull();
    expect(file.state.ranch.feedStore).toEqual({ hay: 0, corn_feed: 0 });
    const rest = JSON.parse(JSON.stringify(file.state)) as typeof fixtureV12.state & {
      ranch: { feedStore?: unknown };
    };
    delete rest.ranch.feedStore;
    expect(rest).toEqual(fixtureV12.state);
  });

  it('migrates a v12 save (v13): hay and corn feed move from the bag into the store, up to its capacity, the rest stays', () => {
    const old = structuredClone(fixtureV12) as {
      version: number;
      state: { inventory: { slots: unknown[] } };
    };
    old.state.inventory.slots[1] = { item: 'hay', qty: 99 };
    old.state.inventory.slots[2] = { item: 'corn_feed', qty: 99 };
    for (let i = 5; i < 12; i++) old.state.inventory.slots[i] = { item: 'corn_feed', qty: 99 }; // 8 × 99 = 792
    const file = parseSave(JSON.stringify(old));
    expect(validateState(file.state)).toBeNull();
    const s = file.state;
    expect(s.ranch.feedStore).toEqual({ hay: 99, corn_feed: 600 });
    expect(countItem(s.inventory, 'hay')).toBe(0);
    expect(countItem(s.inventory, 'corn_feed')).toBe(792 - 600); // nothing lost: the remainder waits in the bag
    expect(s.inventory.slots).toHaveLength(old.state.inventory.slots.length);
    expect(countItem(s.inventory, 'seed_turnip')).toBe(3); // other stacks untouched
    expect(countItem(s.inventory, 'roasted_turnip', true)).toBe(2);
  });

  it('refuses a damaged feed store', () => {
    const bad = (mutate: (c: typeof fixture.state) => void): string | null => {
      const c = structuredClone(fixture.state);
      mutate(c);
      return validateState(c);
    };
    expect(bad(() => undefined)).toBeNull();
    expect(bad((c) => (c.ranch.feedStore.hay = -1))).toBe('bad feed store');
    expect(bad((c) => (c.ranch.feedStore.corn_feed = 1.5))).toBe('bad feed store');
    expect(bad((c) => ((c.ranch.feedStore as Record<string, number>).oats = 3))).toBe('bad feed store');
    expect(bad((c) => delete (c.ranch as Partial<typeof c.ranch>).feedStore)).toBe('bad feed store');
  });

  it('refuses damaged cats', () => {
    const bad = (mutate: (c: typeof fixture.state) => void): string | null => {
      const c = structuredClone(fixture.state);
      mutate(c);
      return validateState(c);
    };
    expect(bad(() => undefined)).toBeNull();
    expect(bad((c) => (c.cats.active = 'cat_calico'))).toBe('bad cats'); // not adopted
    expect(bad((c) => (c.cats.adopted = ['cat_siamese']))).toBe('bad cats'); // the tabby always stays
    expect(bad((c) => c.cats.adopted.push('cat_siamese'))).toBe('bad cats'); // twice
    expect(bad((c) => c.cats.adopted.push('cat_lion'))).toBe('bad cats');
    expect(bad((c) => delete (c as Partial<typeof c>).cats)).toBe('bad cats');
  });

  it('refuses damaged ranches', () => {
    const bad = (mutate: (c: typeof fixture.state) => void): string | null => {
      const c = structuredClone(fixture.state);
      mutate(c);
      return validateState(c);
    };
    expect(bad(() => undefined)).toBeNull();
    expect(bad((c) => (c.ranch.buildings[1]!.kind = 'coop' as never))).toBe('bad building'); // two coops
    expect(bad((c) => (c.ranch.buildings[0]!.kind = 'stable' as never))).toBe('bad building');
    expect(bad((c) => (c.ranch.buildings[0]!.level = 4))).toBe('bad building');
    expect(bad((c) => (c.ranch.buildings[0]!.trough = -1))).toBe('bad building');
    expect(bad((c) => (c.ranch.buildings[0]!.store = [{ item: 'egg', qty: -1 }]))).toBe('bad building');
    expect(bad((c) => (c.ranch.animals[0]!.building = 99))).toBe('bad animal'); // lives nowhere
    expect(bad((c) => (c.ranch.animals[0]!.kind = 'goat' as never))).toBe('bad animal');
    expect(bad((c) => (c.ranch.animals[1]!.id = 1))).toBe('bad animal'); // a repeated id
    expect(bad((c) => (c.ranch.animals[0]!.name = ''))).toBe('bad animal');
  });

  it('migrates a v9 save (v10): no trees, the day index starts counting, nothing is lost', () => {
    const file = parseSave(JSON.stringify(fixtureV9));
    expect(file.version).toBe(SAVE_VERSION);
    expect(validateState(file.state)).toBeNull();
    const s = file.state;
    expect(s.orchard).toEqual({ trees: [] });
    expect(s.stats.fruitPicked).toBe(0);
    expect(s.calendar.dayZeroKey).toBe(fixtureV9.state.calendar.lastDayKey);
    expect(s.calendar.maxDayIndex).toBe(0);
    const rest: Record<string, unknown> = JSON.parse(JSON.stringify(s));
    delete rest.orchard;
    delete rest.ranch;
    delete rest.cats;
    const stats = rest.stats as Record<string, unknown>;
    delete stats.fruitPicked;
    delete stats.productsCollected;
    const cal = rest.calendar as Record<string, unknown>;
    delete cal.dayZeroKey;
    delete cal.maxDayIndex;
    expect(rest).toEqual(fixtureV9.state);
  });

  it('refuses damaged orchards', () => {
    const bad = (mutate: (c: typeof fixture.state) => void): string | null => {
      const c = structuredClone(fixture.state);
      mutate(c);
      return validateState(c);
    };
    expect(bad((c) => (c.orchard.trees[1]!.spot = 0))).toBe('bad tree'); // two trees on one spot
    expect(bad((c) => (c.orchard.trees[0]!.spot = 99))).toBe('bad tree');
    expect(bad((c) => (c.orchard.trees[0]!.tree = 'kiwi_tree'))).toBe('bad tree');
    expect(bad((c) => (c.orchard.trees[0]!.lastFruitDay = -1))).toBe('bad tree');
    expect(bad((c) => (c.orchard.trees[0]!.fruit = -2))).toBe('bad tree');
  });

  it('migrates a v8 save (v9): nothing is lost, no decorations or projects yet', () => {
    const file = parseSave(JSON.stringify(fixtureV8));
    expect(file.version).toBe(SAVE_VERSION);
    expect(validateState(file.state)).toBeNull();
    const s = file.state;
    expect(s.decor).toEqual({ owned: {}, placed: [], farmhouse: { paint: null, roof: null, loft: false } });
    expect(s.town).toEqual({ projects: {} });
    const rest: Record<string, unknown> = JSON.parse(JSON.stringify(s));
    delete rest.decor;
    delete rest.town;
    expect(withoutV10(rest)).toEqual(fixtureV8.state);
  });

  it('migrates a phase-03 (v3) save: everything is kept, automation starts empty', () => {
    const file = parseSave(JSON.stringify(fixtureV3));
    expect(file.version).toBe(SAVE_VERSION);
    const s = file.state;
    const { state: old } = fixtureV3;
    expect(s.gold).toBe(old.gold);
    expect(s.farm).toEqual(old.farm);
    expect(s.inventory).toEqual(old.inventory);
    expect(s.market).toEqual(old.market);
    expect(s.shippingBin).toEqual(old.shippingBin);
    expect(s.expansions).toEqual(old.expansions);
    expect(s.stats).toEqual({
      ...old.stats,
      fruitPicked: 0,
      productsCollected: 0,
      fishCaught: 0,
      dishesCooked: 0,
      dishesEaten: 0,
      bestDishTier: 0,
    });
    expect(s.upgrades).toEqual(old.upgrades);
    // Nothing placed, every toggle at its default, no farmhand timer, one empty memory slot per plot.
    expect(s.placed).toEqual([]);
    expect(s.autoSell).toEqual({});
    expect(s.automation).toEqual({ farmhandCooldownMs: 0 });
    expect(s.lastPlantedCrop).toEqual(Array.from({ length: old.farm.plots.length }, () => null));
    expect(validateState(s)).toBeNull();
  });

  it('keeps gold a v1 save somehow already had', () => {
    const rich = { ...fixtureV1, state: { ...fixtureV1.state, gold: 500 } };
    expect(parseSave(JSON.stringify(rich)).state.gold).toBe(500);
  });

  it('fails clearly when a migration is missing', () => {
    expect(() => migrate(v0, {}, 1)).toThrow('No migration from save version 0');
  });

  it('refuses a save from a newer version', () => {
    expect(() => migrate({ version: SAVE_VERSION + 1, state: fixture.state })).toThrow(/newer version/);
  });
});

describe('loading from storage', () => {
  it('creates a new game when there is no save', () => {
    const r = loadGame(memoryStorage(), 1000, NY);
    expect(r.kind).toBe('new');
  });

  it('loads a stored save', () => {
    const storage = memoryStorage({ [SAVE_KEY]: FIXTURE_TEXT });
    const r = loadGame(storage, 1000, NY);
    expect(r.kind === 'loaded' && r.file.state.clock.simMs).toBe(5432100);
  });

  it('reports a broken save and leaves it untouched', () => {
    const storage = memoryStorage({ [SAVE_KEY]: '{"version":2,"state":{' });
    const r = loadGame(storage, 1000, NY);
    expect(r.kind).toBe('error');
    expect(r.kind === 'error' && r.raw).toBe('{"version":2,"state":{');
    expect(storage.data.get(SAVE_KEY)).toBe('{"version":2,"state":{');
  });

  it('writes what it loads', () => {
    const storage = memoryStorage();
    const file = parseSave(FIXTURE_TEXT);
    writeSave(storage, file);
    const r = loadGame(storage, 0, NY);
    expect(r.kind === 'loaded' && r.file).toEqual(file);
  });
});
