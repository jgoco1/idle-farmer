// The ranch (v2 phase 04, GDD §12.4, BALANCE.md §13.6–13.9): a coop of hens, a barn of cows and a silo.

import { describe, expect, it } from 'vitest';
import { applyAction, type Action } from '../src/core/actions';
import type { GameEvent } from '../src/core/events';
import { runOffline } from '../src/core/offline';
import { makeContext, processCalendar, step } from '../src/core/sim';
import { createInitialState, type BuildingState, type GameState } from '../src/core/state';
import { buildCalendar } from '../src/core/time';
import { GAME_DATA, type GameData } from '../src/data';
import { ANIMALS, BUILDINGS, FEEDS } from '../src/data/animals';
import {
  FEED_BUY_PRICE,
  FEED_PER_CORN,
  FEED_PER_WHEAT,
  FEED_STORE_CAPACITY,
  LARGE_EGG_CHANCE,
  SILO_RESERVE,
} from '../src/data/balance';
import { RECIPES } from '../src/data/recipes';
import { ITEMS } from '../src/data/items';
import { RECIPE_IDS, type AnimalId, type BuildingId } from '../src/data/ids';
import { TOWN_PROJECTS } from '../src/data/townProjects';
import { recipeTier } from '../src/systems/cooking';
import { NO_MORE, RanchLife, type RanchView } from '../src/render/ranchLife';
import { SPRITES } from '../src/render/sprites';
import { awayRows } from '../src/ui/awaySummary';
import { bundleBonuses } from '../src/systems/bundles';
import { donatable, donate, isBundleDone } from '../src/systems/bundles';
import { addItem, countItem } from '../src/systems/inventory';
import { specialCandidates } from '../src/systems/market';
import {
  animalCount,
  animalsIn,
  buildingAtTile,
  buildingOfKind,
  buildingPlacementProblem,
  buildBuilding,
  buyAnimal,
  collectBuilding,
  cycleMsOf,
  feedUnitsThatFit,
  msToNextProduct,
  levelDef,
  productXp,
  ranchPickup,
  storeCount,
  storeSize,
  tickRanch,
  troughSize,
  upgradeBuilding,
} from '../src/systems/ranch';
import { goalAchievable, goalText } from '../src/systems/progression';
import { buyUpgrade } from '../src/systems/upgrades';
import { setAutoSell } from '../src/systems/autoSeller';
import { msToNextSimEvent } from '../src/systems';
import { placeDecor } from '../src/systems/decor';
import { at, HOUR, NY } from './helpers';

// Wednesday 7 January 2026, 10:00.
const CREATED = at(NY, 2026, 1, 7, 10);
const NOON = at(NY, 2026, 1, 7, 12);
const MIN = 60_000;

function farm(): GameState {
  const s = createInitialState(CREATED, NY, 1);
  s.land.parcels.push('orchard', 'yard');
  s.gold = 5_000_000;
  processCalendar(s, GAME_DATA, NY, NOON, []);
  s.progression.goals = []; // goals are paid when progression reads the events, which differs by step size
  return s;
}

function ctxFor(s: GameState, t = NOON, events: GameEvent[] = [], data: GameData = GAME_DATA) {
  return makeContext(s, data, buildCalendar(t, s.calendar, NY), events);
}

/**
 * No goals and no perks: progression reads events at the end of each step and draws new goals with the
 * seeded generator, which depends on the step size by design, so the equivalence tests pin it off.
 */
const QUIET: GameData = { ...GAME_DATA, goalTemplates: {} as GameData['goalTemplates'], perks: [] };

function act(s: GameState, action: Action, events: GameEvent[] = [], t = NOON) {
  return applyAction(s, ctxFor(s, t, events), action);
}

const why = (r: { ok: boolean } & { reason?: string }): string => (r.ok ? '' : (r.reason ?? ''));

/** Builds a building at its default spot directly (the actions have their own tests). */
const SPOTS: Record<BuildingId, { col: number; row: number }> = {
  coop: { col: 22, row: 9 },
  barn: { col: 27, row: 9 },
  silo: { col: 33, row: 9 },
};

function build(s: GameState, kind: BuildingId, level = 1) {
  const b: BuildingState = {
    id: s.ranch.buildings.reduce((m, x) => Math.max(m, x.id), 0) + 1,
    kind,
    level,
    at: { ...SPOTS[kind] },
    trough: 0,
    store: [],
    cycleMs: 0,
  };
  s.ranch.buildings.push(b);
  return b;
}

function addAnimals(s: GameState, kind: AnimalId, n: number) {
  const home = s.ranch.buildings.find((b) => b.kind === ANIMALS[kind].building)!;
  for (let i = 0; i < n; i++)
    s.ranch.animals.push({
      id: s.ranch.animals.reduce((m, a) => Math.max(m, a.id), 0) + 1,
      kind,
      name: ANIMALS[kind].names[i % ANIMALS[kind].names.length]!,
      building: home.id,
    });
  return home;
}

/** A coop with `hens` hens and a full trough. */
function coopWith(s: GameState, hens: number, level = 1) {
  const coop = build(s, 'coop', level);
  addAnimals(s, 'chicken', hens);
  coop.trough = troughSize(s, GAME_DATA, coop);
  return coop;
}

describe('animal and building data (BALANCE.md §13.6)', () => {
  it('has hens and cows with the doc’s prices, feed, cycles and products', () => {
    expect(ANIMALS.chicken).toMatchObject({
      building: 'coop',
      price: 3_000,
      feed: 'corn_feed',
      intervalSec: 1_800,
      product: 'egg',
    });
    expect(ANIMALS.chicken.largeProduct).toEqual({ id: 'large_egg', chance: LARGE_EGG_CHANCE });
    expect(ANIMALS.cow).toMatchObject({
      building: 'barn',
      price: 12_000,
      feed: 'hay',
      intervalSec: 2_400,
      product: 'milk',
    });
    expect(LARGE_EGG_CHANCE).toBe(0.1);
    expect(ANIMALS.chicken.xp).toEqual({ egg: 7, large_egg: 12 });
    expect(ANIMALS.cow.xp).toEqual({ milk: 13 });
  });

  it('has the coop, barn and silo tables: footprint, price, capacity, trough, store and requirements', () => {
    const row = (id: BuildingId) => BUILDINGS[id].levels.map((l) => [l.price, l.capacity, l.trough, l.store]);
    expect(row('coop')).toEqual([
      [25_000, 4, 64, 64],
      [60_000, 8, 128, 128],
      [150_000, 12, 192, 192],
    ]);
    expect(row('barn')).toEqual([
      [60_000, 2, 24, 24],
      [150_000, 4, 48, 48],
      [350_000, 6, 72, 72],
    ]);
    expect(row('silo')).toEqual([
      [40_000, 0, 0, 0],
      [120_000, 0, 0, 0],
    ]);
    expect(BUILDINGS.coop.footprint).toEqual({ cols: 3, rows: 2 });
    expect(BUILDINGS.barn.footprint).toEqual({ cols: 4, rows: 3 });
    expect(BUILDINGS.silo.footprint).toEqual({ cols: 2, rows: 2 });
    expect(BUILDINGS.barn.levels[0]!.requires).toEqual([{ kind: 'building', id: 'coop', level: 1 }]);
    expect(BUILDINGS.silo.levels[0]!.requires).toEqual([{ kind: 'building', id: 'coop', level: 1 }]);
    expect(BUILDINGS.silo.levels[0]!.flags).toEqual(['autoFeed']);
    expect(BUILDINGS.silo.levels[1]!.flags).toEqual(['autoFeed', 'autoMill']);
  });

  it('a full trough lasts 8 hours at full capacity (hens eat 2 portions an hour, cows 1.5)', () => {
    for (const [animal, level] of [
      ['chicken', 3],
      ['cow', 3],
    ] as const) {
      const def = ANIMALS[animal];
      const b = BUILDINGS[def.building].levels[level - 1]!;
      const perHour = 3600 / def.intervalSec;
      expect(b.trough / (b.capacity * perHour)).toBe(8);
    }
  });

  it('has egg, large egg and milk as sellable items, and hay and corn feed as bag-only feed', () => {
    for (const id of ['egg', 'large_egg', 'milk'] as const)
      expect(ITEMS[id], id).toMatchObject({ category: 'animal', sellable: true, sprite: `item_${id}` });
    expect([ITEMS.egg!.basePrice, ITEMS.large_egg!.basePrice, ITEMS.milk!.basePrice]).toEqual([90, 200, 240]);
    for (const id of ['hay', 'corn_feed'] as const)
      expect(ITEMS[id], id).toMatchObject({ category: 'feed', sellable: false, basePrice: 13 });
    expect(FEEDS.hay).toMatchObject({ from: 'wheat', perUnit: FEED_PER_WHEAT, buyPrice: FEED_BUY_PRICE.hay });
    expect(FEEDS.corn_feed).toMatchObject({ from: 'corn', perUnit: FEED_PER_CORN });
    expect([FEED_PER_WHEAT, FEED_PER_CORN]).toEqual([2, 3]);
  });

  it('every building level and animal has its art, and each level looks different', () => {
    for (const id of ['coop', 'barn'] as const) {
      const looks = new Set<string>();
      for (let l = 1; l <= 3; l++) {
        const sprite = SPRITES[`obj_${id}_${l}`];
        expect(sprite, `${id} ${l}`).toBeDefined();
        expect(sprite!.lit, id).toBe(true); // a lit-window night frame
        expect(sprite!.frames[0]).not.toEqual(sprite!.frames[1]);
        looks.add(sprite!.frames[0]!.join(''));
      }
      expect(looks.size).toBe(3);
    }
    expect(SPRITES.obj_silo_1!.frames[0]).not.toEqual(SPRITES.obj_silo_2!.frames[0]);
    const size = (id: string) => [SPRITES[id]!.frames[0]![0]!.length, SPRITES[id]!.frames[0]!.length];
    expect(size('obj_coop_1')).toEqual([48, 48]);
    expect(size('obj_barn_1')).toEqual([64, 64]);
    expect(size('obj_silo_1')).toEqual([32, 64]);
    expect(size('animal_chicken_walk')).toEqual([16, 16]);
    expect(size('animal_cow_walk')).toEqual([32, 32]);
    expect(SPRITES.animal_chicken_walk!.frames).toHaveLength(2);
    expect(SPRITES.animal_chicken_walk!.frameMs).toBe(150);
    expect(SPRITES.animal_cow_walk!.frames).toHaveLength(4);
    expect(SPRITES.animal_cow_walk!.frameMs).toBe(180);
    for (const a of ['chicken', 'cow'])
      for (const pose of ['walk', 'idle', 'eat', 'sleep'])
        expect(SPRITES[`animal_${a}_${pose}`]).toBeDefined();
    for (const t of ['empty', 'some', 'full']) expect(SPRITES[`obj_trough_${t}`]).toBeDefined();
  });
});

describe('building, upgrading and moving', () => {
  it('needs the Old Paddock, and the barn and silo need a level 1 coop', () => {
    const s = createInitialState(CREATED, NY, 1);
    s.gold = 1e7;
    expect(why(act(s, { type: 'buildBuilding', building: 'coop', ...SPOTS.coop }))).toMatch(/Old Paddock/);
    s.land.parcels.push('yard');
    expect(why(act(s, { type: 'buildBuilding', building: 'barn', ...SPOTS.barn }))).toMatch(/coop/i);
    expect(why(act(s, { type: 'buildBuilding', building: 'silo', ...SPOTS.silo }))).toMatch(/coop/i);
    expect(act(s, { type: 'buildBuilding', building: 'coop', ...SPOTS.coop })).toEqual({ ok: true });
    expect(act(s, { type: 'buildBuilding', building: 'barn', ...SPOTS.barn }).ok).toBe(true);
    expect(act(s, { type: 'buildBuilding', building: 'silo', ...SPOTS.silo }).ok).toBe(true);
    expect(s.gold).toBe(1e7 - 25_000 - 60_000 - 40_000);
    expect(s.ranch.buildings.map((b) => [b.kind, b.level, b.at])).toEqual([
      ['coop', 1, SPOTS.coop],
      ['barn', 1, SPOTS.barn],
      ['silo', 1, SPOTS.silo],
    ]);
  });

  it('takes the gold, builds one of each, and reports the events', () => {
    const s = farm();
    const events: GameEvent[] = [];
    s.gold = 24_999;
    expect(why(act(s, { type: 'buildBuilding', building: 'coop', ...SPOTS.coop }, events))).toBe(
      'You need 25,000g for that.',
    );
    s.gold = 30_000;
    expect(act(s, { type: 'buildBuilding', building: 'coop', ...SPOTS.coop }, events)).toEqual({ ok: true });
    expect(s.gold).toBe(5_000);
    expect(events).toContainEqual({ type: 'purchased', what: 'coop', gold: 25_000 });
    expect(events).toContainEqual({ type: 'buildingBuilt', building: 'coop', level: 1, id: 1 });
    expect(why(act(s, { type: 'buildBuilding', building: 'coop', col: 30, row: 9 }))).toMatch(/already/);
  });

  it('refuses spots outside the paddock, over another building, over a decoration, or without room for the trough and the animals', () => {
    const s = farm();
    coopWith(s, 0);
    const p = (kind: BuildingId, col: number, row: number) =>
      buildingPlacementProblem(s, GAME_DATA, kind, col, row);
    expect(p('barn', 27, 9)).toBeNull();
    expect(p('barn', 5, 9)).toMatch(/inside the Old Paddock/);
    expect(p('barn', 21, 6)).toMatch(/inside the Old Paddock/); // the lane above
    expect(p('barn', 22, 9)).toMatch(/Coop is already there/);
    expect(p('barn', 33, 9)).toMatch(/trough/); // the trough tile would be off the right edge
    expect(p('barn', 27, 12)).toMatch(/row of grass/); // no room in front for the animals
    expect(p('silo', 34, 13)).toBeNull(); // a silo has no trough and needs no front yard
    // the coop's trough tile is reserved too
    expect(buildingAtTile(s, GAME_DATA, 25, 10)?.kind).toBe('coop');
    expect(buildingAtTile(s, GAME_DATA, 25, 9)).toBeUndefined();
    expect(p('silo', 25, 10)).toMatch(/Coop is already there/);
    // a decoration in the way is named
    s.decor.owned.cobble_path = 1;
    expect(placeDecor(s, ctxFor(s), 'cobble_path', 28, 10, false)).toEqual({ ok: true });
    expect(p('barn', 27, 9)).toMatch(/Cobble Path is in the way/);
    // and a building keeps decorations off its tiles
    s.decor.owned.garden_lamp = 1;
    expect(why(placeDecor(s, ctxFor(s), 'garden_lamp', 23, 9, false))).toMatch(/coop stands there/);
  });

  it('upgrades for more room, one level at a time, for the listed price', () => {
    const s = farm();
    const coop = coopWith(s, 4);
    expect(why(act(s, { type: 'buyAnimal', animal: 'chicken', building: coop.id }))).toMatch(/full/);
    s.gold = 59_999;
    expect(why(act(s, { type: 'upgradeBuilding', id: coop.id }))).toBe('You need 60,000g for that.');
    s.gold = 300_000;
    expect(act(s, { type: 'upgradeBuilding', id: coop.id })).toEqual({ ok: true });
    expect([coop.level, s.gold]).toEqual([2, 240_000]);
    expect(troughSize(s, GAME_DATA, coop)).toBe(128);
    expect(storeSize(GAME_DATA, coop)).toBe(128);
    expect(act(s, { type: 'buyAnimal', animal: 'chicken', building: coop.id }).ok).toBe(true);
    expect(act(s, { type: 'upgradeBuilding', id: coop.id }).ok).toBe(true);
    expect(why(act(s, { type: 'upgradeBuilding', id: coop.id }))).toMatch(/fully upgraded/);
    expect([coop.level, levelDef(GAME_DATA, coop).capacity]).toEqual([3, 12]);
    expect(s.gold).toBe(240_000 - 3_000 - 150_000);
    // trough, store and animals stay put through an upgrade
    expect(animalCount(s, coop.id)).toBe(5);
  });

  it('moves a building for free; the animals, feed and products stay with it', () => {
    const s = farm();
    const coop = coopWith(s, 2);
    coop.store.push({ item: 'egg', qty: 3 });
    const gold = s.gold;
    expect(act(s, { type: 'moveBuilding', id: coop.id, col: 23, row: 10 })).toEqual({ ok: true }); // overlaps itself: fine
    expect(coop.at).toEqual({ col: 23, row: 10 });
    expect(s.gold).toBe(gold);
    expect([coop.trough, storeCount(coop), animalCount(s, coop.id)]).toEqual([64, 3, 2]);
    expect(why(act(s, { type: 'moveBuilding', id: coop.id, col: 5, row: 5 }))).toMatch(/inside/);
    expect(why(act(s, { type: 'moveBuilding', id: coop.id, col: 23, row: 10 }))).toMatch(/already stands/);
  });

  it('upgrading the barn and the silo, and the silo’s level 2 flag', () => {
    const s = farm();
    coopWith(s, 0);
    const barn = build(s, 'barn');
    const silo = build(s, 'silo');
    expect(upgradeBuilding(s, ctxFor(s), barn.id)).toEqual({ ok: true });
    expect(storeSize(GAME_DATA, barn)).toBe(48);
    expect(upgradeBuilding(s, ctxFor(s), silo.id)).toEqual({ ok: true });
    expect(upgradeBuilding(s, ctxFor(s), silo.id).ok).toBe(false);
    expect(s.gold).toBe(5_000_000 - 150_000 - 120_000);
  });
});

describe('animals: buying, naming and feeding', () => {
  it('buys a hen for the coop and a cow for the barn at a flat price, with a gentle default name', () => {
    const s = farm();
    const coop = coopWith(s, 0);
    const barn = build(s, 'barn');
    const events: GameEvent[] = [];
    expect(act(s, { type: 'buyAnimal', animal: 'chicken', building: coop.id }, events)).toEqual({ ok: true });
    expect(act(s, { type: 'buyAnimal', animal: 'chicken', building: coop.id }).ok).toBe(true);
    expect(act(s, { type: 'buyAnimal', animal: 'cow', building: barn.id }).ok).toBe(true);
    expect(s.gold).toBe(5_000_000 - 3_000 - 3_000 - 12_000); // the second hen costs what the first did
    expect(s.ranch.animals.map((a) => [a.kind, a.name, a.building])).toEqual([
      ['chicken', 'Clover', coop.id],
      ['chicken', 'Daisy', coop.id],
      ['cow', 'Bluebell', barn.id],
    ]);
    expect(events).toContainEqual({ type: 'animalBought', animal: 'chicken', id: 1 });
    expect(why(act(s, { type: 'buyAnimal', animal: 'cow', building: coop.id }))).toMatch(/barn/);
    expect(why(act(s, { type: 'buyAnimal', animal: 'cow', building: 99 }))).toMatch(/barn/);
  });

  it('refuses a full house and too little gold, and a barn that is not built', () => {
    const s = farm();
    expect(why(act(s, { type: 'buyAnimal', animal: 'chicken', building: 1 }))).toMatch(/coop/);
    const coop = coopWith(s, 3);
    s.gold = 2_999;
    expect(why(act(s, { type: 'buyAnimal', animal: 'chicken', building: coop.id }))).toBe(
      'You need 3,000g for that.',
    );
    s.gold = 10_000;
    expect(act(s, { type: 'buyAnimal', animal: 'chicken', building: coop.id }).ok).toBe(true);
    expect(why(act(s, { type: 'buyAnimal', animal: 'chicken', building: coop.id }))).toMatch(/full/);
    expect(s.gold).toBe(7_000);
  });

  it('names are a list in order, can be changed, and are tidied', () => {
    const s = farm();
    coopWith(s, 0);
    for (let i = 0; i < 4; i++) act(s, { type: 'buyAnimal', animal: 'chicken', building: 1 });
    expect(s.ranch.animals.map((a) => a.name)).toEqual(['Clover', 'Daisy', 'Pebble', 'Honey']);
    expect(
      act(s, { type: 'renameAnimal', id: 2, name: '  Mrs.   Featherstone-Whitaker the Third ' }),
    ).toEqual({
      ok: true,
    });
    expect(s.ranch.animals[1]!.name).toBe('Mrs. Featherston');
    expect(s.ranch.animals[1]!.name.length).toBeLessThanOrEqual(16);
    expect(why(act(s, { type: 'renameAnimal', id: 2, name: '   ' }))).toMatch(/name/);
    expect(why(act(s, { type: 'renameAnimal', id: 99, name: 'Ghost' }))).toMatch(/no such/);
    expect(s.ranch.animals[1]!.name).toBe('Mrs. Featherston');
    act(s, { type: 'renameAnimal', id: 1, name: 'Tab\tand\nnewline' });
    expect(s.ranch.animals[0]!.name).toBe('Tab and newline');
  });

  it('makes hay from wheat and corn feed from corn into the feed store, free and instant, and refuses without the crop', () => {
    const s = farm();
    s.inventory.stackSize = 99;
    expect(why(act(s, { type: 'makeFeed', feed: 'hay', qty: 1 }))).toMatch(/wheat/);
    addItem(s.inventory, 'wheat', 12);
    addItem(s.inventory, 'corn', 5);
    const slots = s.inventory.slots.filter(Boolean).length;
    expect(act(s, { type: 'makeFeed', feed: 'hay', qty: 10 })).toEqual({ ok: true });
    expect([countItem(s.inventory, 'wheat'), s.ranch.feedStore.hay]).toEqual([2, 20]);
    expect(act(s, { type: 'makeFeed', feed: 'corn_feed', qty: 5 })).toEqual({ ok: true });
    expect([countItem(s.inventory, 'corn'), s.ranch.feedStore.corn_feed]).toEqual([0, 15]);
    // feed takes no bag slot (v2-05): the corn's slot emptied and nothing new arrived
    expect(countItem(s.inventory, 'hay') + countItem(s.inventory, 'corn_feed')).toBe(0);
    expect(s.inventory.slots.filter(Boolean).length).toBe(slots - 1);
    expect(why(act(s, { type: 'makeFeed', feed: 'hay', qty: 3 }))).toMatch(/wheat/);
    expect(why(act(s, { type: 'makeFeed', feed: 'hay', qty: 0 }))).toMatch(/how much/);
  });

  it('a full bag does not matter: feed goes to the store', () => {
    const s = farm();
    s.inventory.slots = [{ item: 'wheat', qty: 99 }];
    s.inventory.stackSize = 99;
    expect(act(s, { type: 'makeFeed', feed: 'hay', qty: 99 })).toEqual({ ok: true });
    expect(s.ranch.feedStore.hay).toBe(198);
  });

  it('the store has a capacity: making or buying more says so politely, and nothing is used or lost', () => {
    const s = farm();
    s.inventory.stackSize = 999;
    addItem(s.inventory, 'wheat', 400);
    s.ranch.feedStore.hay = FEED_STORE_CAPACITY - 5;
    const gold = s.gold;
    // 3 wheat would make 6 hay: one more than fits
    expect(why(act(s, { type: 'makeFeed', feed: 'hay', qty: 3 }))).toBe(
      'The feed store only has room for 5 more hay.',
    );
    expect([countItem(s.inventory, 'wheat'), s.ranch.feedStore.hay]).toEqual([400, FEED_STORE_CAPACITY - 5]);
    expect(act(s, { type: 'makeFeed', feed: 'hay', qty: 2 }).ok).toBe(true);
    expect(why(act(s, { type: 'buyFeed', feed: 'hay', qty: 10 }))).toBe(
      'The feed store only has room for 1 more hay.',
    );
    expect(act(s, { type: 'buyFeed', feed: 'hay', qty: 1 }).ok).toBe(true);
    expect(s.ranch.feedStore.hay).toBe(FEED_STORE_CAPACITY);
    expect(why(act(s, { type: 'makeFeed', feed: 'hay', qty: 1 }))).toBe(
      'The feed store is full of hay. Fill a trough first.',
    );
    expect(why(act(s, { type: 'buyFeed', feed: 'hay', qty: 1 }))).toMatch(/full of hay/);
    expect(countItem(s.inventory, 'wheat')).toBe(398);
    expect(s.gold).toBe(gold - FEED_BUY_PRICE.hay);
    // the other feed has its own room
    s.inventory.slots.push({ item: 'corn', qty: 10 });
    expect(act(s, { type: 'makeFeed', feed: 'corn_feed', qty: 10 }).ok).toBe(true);
    expect(feedUnitsThatFit(s, 'hay', FEED_PER_WHEAT)).toBe(0);
    expect(feedUnitsThatFit(s, 'corn_feed', FEED_PER_CORN)).toBe(Math.floor((FEED_STORE_CAPACITY - 30) / 3));
  });

  it('buys feed at the Ranch for 40g a portion, into the store', () => {
    const s = farm();
    s.gold = 500;
    expect(act(s, { type: 'buyFeed', feed: 'hay', qty: 10 })).toEqual({ ok: true });
    expect([s.gold, s.ranch.feedStore.hay, countItem(s.inventory, 'hay')]).toEqual([100, 10, 0]);
    expect(why(act(s, { type: 'buyFeed', feed: 'corn_feed', qty: 3 }))).toBe('You need 120g for that.');
  });

  it('fills a trough from the store, as much as fits', () => {
    const s = farm();
    const barn = build(s, 'barn');
    expect(why(act(s, { type: 'fillTrough', building: barn.id }))).toMatch(/feed store has no hay/);
    s.ranch.feedStore.hay = 30;
    expect(act(s, { type: 'fillTrough', building: barn.id })).toEqual({ ok: true });
    expect([barn.trough, s.ranch.feedStore.hay]).toEqual([24, 6]);
    expect(why(act(s, { type: 'fillTrough', building: barn.id }))).toMatch(/already full/);
    barn.trough = 20;
    expect(act(s, { type: 'fillTrough', building: barn.id }).ok).toBe(true);
    expect([barn.trough, s.ranch.feedStore.hay]).toEqual([24, 2]);
    expect(why(act(s, { type: 'fillTrough', building: 99 }))).toMatch(/no such/);
    const silo = build(s, 'silo');
    expect(why(act(s, { type: 'fillTrough', building: silo.id }))).toMatch(/silo/i);
  });

  it('feed an old save left in the bag is used after the store’s, so nothing is stranded', () => {
    const s = farm();
    const barn = build(s, 'barn');
    s.inventory.stackSize = 99;
    s.ranch.feedStore.hay = 10;
    addItem(s.inventory, 'hay', 30);
    expect(act(s, { type: 'fillTrough', building: barn.id }).ok).toBe(true);
    expect([barn.trough, s.ranch.feedStore.hay, countItem(s.inventory, 'hay')]).toEqual([24, 0, 16]);
  });
});

describe('production (BALANCE.md §13.6)', () => {
  it('an animal eats a portion and lays one product at the end of each cycle, into the store', () => {
    const s = farm();
    const coop = coopWith(s, 2);
    const events: GameEvent[] = [];
    const ctx = ctxFor(s, NOON, events);
    tickRanch(s, ctx, 29 * MIN + 59_000);
    expect([storeCount(coop), coop.trough]).toEqual([0, 64]);
    tickRanch(s, ctx, 1_000);
    expect([storeCount(coop), coop.trough, coop.cycleMs]).toEqual([2, 62, 0]);
    expect(
      events.filter((e) => e.type === 'produced').reduce((n, e) => n + (e as { qty: number }).qty, 0),
    ).toBe(2);
    tickRanch(s, ctx, 30 * MIN);
    expect([storeCount(coop), coop.trough]).toEqual([4, 60]);
  });

  it('the first egg comes within one cycle of the first hen and a fed trough (§13.10)', () => {
    const s = farm();
    build(s, 'coop');
    expect(act(s, { type: 'buyAnimal', animal: 'chicken', building: 1 }).ok).toBe(true);
    addItem(s.inventory, 'corn_feed', 10);
    expect(act(s, { type: 'fillTrough', building: 1 }).ok).toBe(true);
    step(s, ctxFor(s), 30 * MIN);
    expect(storeCount(s.ranch.buildings[0]!)).toBe(1);
  });

  it('an empty building keeps its cycle at zero: the first cycle starts with the first animal', () => {
    const s = farm();
    const coop = build(s, 'coop');
    tickRanch(s, ctxFor(s), 5 * 3600_000);
    expect(coop.cycleMs).toBe(0);
    addAnimals(s, 'chicken', 1);
    coop.trough = 10;
    tickRanch(s, ctxFor(s), 29 * MIN);
    expect(storeCount(coop)).toBe(0);
  });

  it('cows give milk every 40 minutes', () => {
    const s = farm();
    const barn = build(s, 'barn');
    addAnimals(s, 'cow', 2);
    barn.trough = 24;
    tickRanch(s, ctxFor(s), 80 * MIN);
    expect(barn.store).toEqual([{ item: 'milk', qty: 4 }]);
    expect(barn.trough).toBe(20);
  });

  it('hens lay a large egg about one time in ten, from the seeded generator', () => {
    const s = farm();
    const coop = build(s, 'coop', 3);
    addAnimals(s, 'chicken', 12);
    coop.trough = 100_000; // plenty
    const before = s.rngState;
    tickRanch(s, ctxFor(s), 30 * MIN * 100); // 100 cycles, capped by the store: 192 eggs
    expect(s.rngState).not.toBe(before);
    const large = coop.store.find((x) => x.item === 'large_egg')?.qty ?? 0;
    const eggs = coop.store.find((x) => x.item === 'egg')?.qty ?? 0;
    expect(large + eggs).toBe(192);
    expect(large).toBeGreaterThan(5);
    expect(large).toBeLessThan(45);
  });

  it('a full store waits: production stops, the trough keeps its feed, and nothing is lost', () => {
    const s = farm();
    const coop = coopWith(s, 4);
    tickRanch(s, ctxFor(s), 100 * 30 * MIN); // far more than the store holds
    expect(storeCount(coop)).toBe(64);
    expect(coop.trough).toBe(0); // 16 cycles × 4 hens: 64 portions, 64 products
    // refill, and a half-full store takes only what fits
    coop.trough = 64;
    coop.store = [{ item: 'egg', qty: 62 }];
    tickRanch(s, ctxFor(s), 30 * MIN);
    expect(storeCount(coop)).toBe(64);
    expect(coop.trough).toBe(62); // only two hens had room: the others kept their portion
    tickRanch(s, ctxFor(s), 30 * MIN);
    expect([storeCount(coop), coop.trough]).toEqual([64, 62]);
  });

  it('an unfed animal produces nothing and has no other effect: nothing is lost, reduced, sold or sickened', () => {
    const s = farm();
    const coop = coopWith(s, 3);
    coop.trough = 0;
    const barn = build(s, 'barn');
    addAnimals(s, 'cow', 2);
    const events: GameEvent[] = [];
    const before = structuredClone(s);
    tickRanch(s, ctxFor(s, NOON, events), 3 * 24 * HOUR);
    expect(events).toEqual([]); // not even a "hungry" event: there was no portion to run out of
    // the whole state is exactly as it was, apart from the hungry animals' cycle clocks
    for (const b of s.ranch.buildings) b.cycleMs = 0;
    for (const b of before.ranch.buildings) b.cycleMs = 0;
    expect(s).toEqual(before);
    expect(s.ranch.animals).toHaveLength(5);
    expect([coop.store, barn.store]).toEqual([[], []]);
    // and once fed they carry on as if nothing had happened
    coop.trough = 3;
    tickRanch(s, ctxFor(s), 30 * MIN);
    expect(storeCount(coop)).toBe(3);
    expect(s.ranch.animals).toEqual(before.ranch.animals);
  });

  it('reports a trough running dry once, and an away summary says it gently', () => {
    const s = farm();
    const coop = coopWith(s, 2);
    coop.trough = 3;
    const events: GameEvent[] = [];
    tickRanch(s, ctxFor(s, NOON, events), 10 * 30 * MIN);
    expect(events.filter((e) => e.type === 'troughEmpty')).toEqual([
      { type: 'troughEmpty', building: coop.id, animal: 'chicken' },
    ]);
    const report = { awayMs: 8 * HOUR, simulatedMs: 8 * HOUR, events, dayStarts: 0, seasonChanges: [] };
    const rows = awayRows(report as never, { readyPlots: 0, dryPlots: 0 }).map((r) => r.text);
    expect(rows).toContain('The hens would love some feed.');
    expect(rows.find((r) => /gave 3 eggs/.test(r) || /gave 3 egg/.test(r))).toBeDefined();
  });

  it('the Barnyard bundle raises every trough by half; the store stays as it was', () => {
    const s = farm();
    const coop = coopWith(s, 1);
    expect(troughSize(s, GAME_DATA, coop)).toBe(64);
    s.progression.completedBundles.push('barnyard');
    expect(bundleBonuses(s, GAME_DATA).troughBonus).toBe(0.5);
    expect(troughSize(s, GAME_DATA, coop)).toBe(96);
    expect(storeSize(GAME_DATA, coop)).toBe(64);
    coop.trough = 0;
    addItem(s.inventory, 'corn_feed', 99);
    expect(act(s, { type: 'fillTrough', building: coop.id }).ok).toBe(true);
    expect(coop.trough).toBe(96);
  });
});

describe('collecting', () => {
  function stocked() {
    const s = farm();
    const coop = coopWith(s, 3);
    coop.store = [
      { item: 'egg', qty: 7 },
      { item: 'large_egg', qty: 2 },
    ];
    return { s, coop };
  }

  it('a click empties the store into the bag, reports it, and counts for XP', () => {
    const { s, coop } = stocked();
    const events: GameEvent[] = [];
    const xp = s.progression.skills.farming.xp;
    expect(act(s, { type: 'collectBuilding', building: coop.id }, events)).toEqual({ ok: true });
    expect([countItem(s.inventory, 'egg'), countItem(s.inventory, 'large_egg'), storeCount(coop)]).toEqual([
      7, 2, 0,
    ]);
    expect(events.filter((e) => e.type === 'collected')).toEqual([
      { type: 'collected', product: 'egg', qty: 7, auto: false, building: coop.id, shipped: 0 },
      { type: 'collected', product: 'large_egg', qty: 2, auto: false, building: coop.id, shipped: 0 },
    ]);
    expect(s.stats.productsCollected).toBe(9);
    expect(s.progression.skills.farming.xp - xp).toBe(7 * 7 + 2 * 12);
    expect(productXp(GAME_DATA, 'milk', 4, true)).toBe(13);
    expect(productXp(GAME_DATA, 'milk', 4, false)).toBe(52);
  });

  it('says why there is nothing to collect, kindly', () => {
    const s = farm();
    const coop = build(s, 'coop');
    expect(why(act(s, { type: 'collectBuilding', building: coop.id }))).toMatch(/Nobody lives here/);
    addAnimals(s, 'chicken', 1);
    expect(why(act(s, { type: 'collectBuilding', building: coop.id }))).toMatch(/feed in the trough/);
    coop.trough = 5;
    expect(why(act(s, { type: 'collectBuilding', building: coop.id }))).toMatch(/on its way/);
    const silo = build(s, 'silo');
    expect(why(act(s, { type: 'collectBuilding', building: silo.id }))).toMatch(/silo/i);
    expect(why(act(s, { type: 'collectBuilding', building: 99 }))).toMatch(/no such/);
  });

  it('takes what fits when the bag is nearly full and leaves the rest in the store', () => {
    const { s, coop } = stocked();
    s.inventory.slots = [{ item: 'seed_turnip', qty: 1 }];
    s.inventory.stackSize = 5;
    const r = act(s, { type: 'collectBuilding', building: coop.id });
    expect(why(r)).toMatch(/too full/);
    expect(countItem(s.inventory, 'egg')).toBe(0);
    s.inventory.slots = [{ item: 'seed_turnip', qty: 1 }, null];
    s.inventory.stackSize = 5;
    expect(why(act(s, { type: 'collectBuilding', building: coop.id }))).toMatch(/too full/);
    expect(countItem(s.inventory, 'egg') + countItem(s.inventory, 'large_egg')).toBe(5);
    expect(storeCount(coop)).toBe(4);
  });

  it('ships products the Auto-Seller is told to ship, straight to the bin, and keeps the rest for the kitchen', () => {
    const { s, coop } = stocked();
    s.upgrades.auto_seller = 1;
    // eggs are off by default: the kitchen gets them
    act(s, { type: 'collectBuilding', building: coop.id });
    expect(countItem(s.inventory, 'egg')).toBe(7);
    expect(s.shippingBin.items).toEqual([]);
    coop.store = [{ item: 'egg', qty: 4 }];
    expect(setAutoSell(s, GAME_DATA, 'egg', true)).toEqual({ ok: true });
    const events: GameEvent[] = [];
    act(s, { type: 'collectBuilding', building: coop.id }, events);
    expect(s.shippingBin.items).toEqual([{ item: 'egg', qty: 4 }]);
    expect(countItem(s.inventory, 'egg')).toBe(7);
    expect(events).toContainEqual({
      type: 'collected',
      product: 'egg',
      qty: 4,
      auto: false,
      building: coop.id,
      shipped: 4,
    });
  });

  it('the Collecting Basket empties every store at each shipping-bin pickup, for a quarter of the XP', () => {
    const s = farm();
    const coop = coopWith(s, 2);
    const barn = build(s, 'barn');
    addAnimals(s, 'cow', 2);
    barn.trough = 24;
    s.gold = 1_000_000;
    expect(why(buyUpgrade(s, ctxFor(s), 'ranch_collector'))).toBe('');
    expect(s.gold).toBe(950_000);
    expect(buyUpgrade(s, ctxFor(s), 'ranch_collector').ok).toBe(false); // one only
    const events: GameEvent[] = [];
    const xp = s.progression.skills.farming.xp;
    step(s, ctxFor(s, NOON, events), 61 * MIN);
    // the pickup happened at 60 minutes: two cycles of hens (4 eggs) and one of cows (2 milk) were in the stores
    const picked = events.filter((e) => e.type === 'collected') as Extract<
      GameEvent,
      { type: 'collected' }
    >[];
    expect(picked.every((e) => e.auto)).toBe(true);
    expect(picked.reduce((n, e) => n + e.qty, 0)).toBe(4 + 2);
    expect(countItem(s.inventory, 'egg') + countItem(s.inventory, 'large_egg')).toBe(4);
    expect(countItem(s.inventory, 'milk')).toBe(2);
    expect(s.progression.skills.farming.xp - xp).toBeGreaterThan(0);
    expect(storeCount(coop) + storeCount(barn)).toBe(0); // the cycle after the pickup has not finished yet
  });

  it('with the Basket and the Auto-Seller ticked for milk, milk goes to the bin and is sold at the same pickup', () => {
    const s = farm();
    build(s, 'coop');
    const barn = build(s, 'barn');
    addAnimals(s, 'cow', 2);
    barn.trough = 24;
    s.upgrades.ranch_collector = 1;
    s.upgrades.auto_seller = 1;
    setAutoSell(s, GAME_DATA, 'milk', true);
    const events: GameEvent[] = [];
    step(s, ctxFor(s, NOON, events), 61 * MIN);
    expect(countItem(s.inventory, 'milk')).toBe(0);
    expect(events.some((e) => e.type === 'binCollected')).toBe(true);
    expect(events.filter((e) => e.type === 'sold' && e.item === 'milk').length).toBeGreaterThan(0);
  });
});

describe('the silo (auto-feeder)', () => {
  it('level 1 tops up every trough from the feed store at each bin pickup', () => {
    const s = farm();
    const coop = coopWith(s, 2);
    coop.trough = 10;
    const barn = build(s, 'barn');
    addAnimals(s, 'cow', 1);
    build(s, 'silo');
    s.ranch.feedStore.corn_feed = 40;
    s.ranch.feedStore.hay = 100;
    ranchPickup(s, ctxFor(s));
    expect([coop.trough, s.ranch.feedStore.corn_feed]).toEqual([50, 0]); // all it had
    expect([barn.trough, s.ranch.feedStore.hay]).toEqual([24, 76]);
    // no silo, no feeding
    s.ranch.buildings = s.ranch.buildings.filter((b) => b.kind !== 'silo');
    s.ranch.feedStore.corn_feed = 10;
    ranchPickup(s, ctxFor(s));
    expect(coop.trough).toBe(50);
  });

  it('level 1 never turns crops into feed; level 2 does, keeping 10 wheat and 10 corn back for cooking', () => {
    const s = farm();
    const coop = coopWith(s, 4);
    coop.trough = 0;
    const barn = build(s, 'barn');
    addAnimals(s, 'cow', 2);
    barn.trough = 0;
    const silo = build(s, 'silo');
    s.inventory.stackSize = 99;
    addItem(s.inventory, 'corn', 30);
    addItem(s.inventory, 'wheat', 18);
    ranchPickup(s, ctxFor(s));
    expect([coop.trough, barn.trough]).toEqual([0, 0]);
    silo.level = 2;
    ranchPickup(s, ctxFor(s));
    // corn: 30 − 10 reserved = 20 spare → 60 portions, but the trough only needs 64: all 20 are used
    expect(coop.trough).toBe(60);
    expect(countItem(s.inventory, 'corn')).toBe(10);
    // wheat: 18 − 10 = 8 spare → 16 hay, the barn needs 24
    expect(barn.trough).toBe(16);
    expect(countItem(s.inventory, 'wheat')).toBe(SILO_RESERVE);
    expect(s.ranch.feedStore.hay).toBe(0);
  });

  it('level 2 uses existing feed first and makes only what is needed', () => {
    const s = farm();
    const barn = build(s, 'barn');
    build(s, 'coop');
    addAnimals(s, 'cow', 1);
    build(s, 'silo', 2);
    s.inventory.stackSize = 99;
    s.ranch.feedStore.hay = 20;
    addItem(s.inventory, 'wheat', 40);
    ranchPickup(s, ctxFor(s));
    expect(barn.trough).toBe(24);
    // needed 24: 20 hay in the store, so 4 more portions = 2 wheat; the 30 spare wheat are not all turned into hay
    expect(countItem(s.inventory, 'wheat')).toBe(38);
    expect(s.ranch.feedStore.hay).toBe(0);
  });

  it('acts at the pickups inside a long step (the core stops at each one)', () => {
    const s = farm();
    const coop = coopWith(s, 4);
    build(s, 'silo');
    s.ranch.feedStore.corn_feed = 99;
    coop.trough = 0;
    // the first pickup refills the trough, the hens then lay for the rest of the 3 hours
    step(s, ctxFor(s), 3 * HOUR);
    expect(storeCount(coop)).toBeGreaterThan(8);
    expect(msToNextSimEvent(s, ctxFor(s))).toBeLessThanOrEqual(HOUR);
  });
});

/** The state with float noise in market demand rounded off and milestones in a fixed order (neither is the ranch's). */
function settled(s: GameState): GameState {
  const c = structuredClone(s);
  for (const e of Object.values(c.market.items)) if (e) e.demand = Math.round(e.demand * 1e9) / 1e9;
  c.progression.milestones.done.sort();
  return c;
}

describe('offline correctness (the same in one big step as in many small ones)', () => {
  function busyRanch(): GameState {
    const s = farm();
    const coop = coopWith(s, 8, 2);
    const barn = build(s, 'barn', 2);
    addAnimals(s, 'cow', 4);
    barn.trough = 20; // runs dry part-way
    coop.trough = 90;
    build(s, 'silo', 2);
    s.upgrades.ranch_collector = 1;
    s.upgrades.auto_seller = 1;
    setAutoSell(s, GAME_DATA, 'milk', true);
    s.inventory.stackSize = 99;
    s.ranch.feedStore.corn_feed = 50;
    addItem(s.inventory, 'wheat', 30);
    addItem(s.inventory, 'corn', 25);
    return s;
  }

  it('8 hours as one step equals 8 hours in 5-minute steps, rng included', () => {
    const big = busyRanch();
    const small = structuredClone(big);
    step(big, ctxFor(big, NOON, [], QUIET), 8 * HOUR);
    const ctx = ctxFor(small, NOON, [], QUIET);
    for (let i = 0; i < 96; i++) step(small, ctx, 5 * MIN);
    expect(settled(big)).toEqual(settled(small));
    expect(big.stats.productsCollected).toBeGreaterThan(0);
  });

  it('and equals uneven steps that straddle cycle ends and pickups', () => {
    const steps = [1, 29 * MIN, 1_799_999, 77, 1_800_001, 40 * MIN, 3_599_999, 5 * MIN, 55 * MIN];
    const total = steps.reduce((a, b) => a + b, 0);
    const big = busyRanch();
    const small = structuredClone(big);
    step(big, ctxFor(big, NOON, [], QUIET), total);
    const ctx = ctxFor(small, NOON, [], QUIET);
    for (const ms of steps) step(small, ctx, ms);
    expect(settled(big)).toEqual(settled(small));
  });

  it('tickRanch alone: any split of a span gives the same stores, troughs, cycle clocks and generator', () => {
    const a = farm();
    coopWith(a, 5);
    a.ranch.buildings[0]!.trough = 30;
    const b = structuredClone(a);
    tickRanch(a, ctxFor(a, NOON, [], QUIET), 5 * HOUR);
    let left = 5 * HOUR;
    let n = 0;
    while (left > 0) {
      const d = Math.min(left, 7 * MIN + n++ * 1_001);
      tickRanch(b, ctxFor(b, NOON, [], QUIET), d);
      left -= d;
    }
    expect(b).toEqual(a);
  });

  it('runOffline over a day away: the ranch gives what 8 hours of cycles gives, and the away summary lists it', () => {
    const s = farm();
    coopWith(s, 4);
    const t0 = at(NY, 2026, 1, 7, 12);
    const report = runOffline(s, GAME_DATA, NY, t0, t0 + 24 * HOUR);
    const eggs = storeCount(s.ranch.buildings[0]!);
    expect(eggs).toBe(Math.min(64, 4 * 16)); // 8 h counted fully, then a quarter pace: 12 h of cycles; trough feeds 64
    const rows = awayRows(report, { readyPlots: 0, dryPlots: 0 }).map((r) => r.text);
    expect(rows.some((r) => /gave .*egg/.test(r))).toBe(true);
    expect(rows).toContain('The hens would love some feed.');
  });

  it('is within the budgets: 8 hours on a full ranch in well under 100 ms, 30 days under 300 ms', () => {
    const s = farm();
    const coop = coopWith(s, 12, 3);
    const barn = build(s, 'barn', 3);
    addAnimals(s, 'cow', 6);
    build(s, 'silo', 2);
    s.upgrades.ranch_collector = 1;
    s.inventory.stackSize = 99;
    s.inventory.slots = Array.from({ length: 30 }, () => null);
    addItem(s.inventory, 'corn', 60);
    addItem(s.inventory, 'wheat', 60);
    coop.trough = 192;
    barn.trough = 72;
    const t0 = performance.now();
    step(s, ctxFor(s), 8 * HOUR);
    const eight = performance.now() - t0;
    expect(eight).toBeLessThan(100);
    const t1 = performance.now();
    for (let d = 0; d < 30; d++) step(s, ctxFor(s), 12 * HOUR);
    expect(performance.now() - t1).toBeLessThan(300);
    expect(s.stats.productsCollected).toBeGreaterThan(100);
  });
});

describe('recipes (BALANCE.md §13.8)', () => {
  const R = RECIPES;
  it('has the six egg and milk recipes with the doc’s tiers, prices, buffs and discovery', () => {
    const row = (id: keyof typeof R) => [
      R[id].tier,
      R[id].basePrice,
      R[id].buff,
      R[id].cookSec,
      R[id].discovery.kind,
    ];
    expect(row('fried_egg')).toEqual([1, 225, 'cookSpeed', 30, 'milestone']);
    expect(row('soft_cheese')).toEqual([2, 672, 'automationSpeed', 60, 'milestone']);
    expect(row('garden_omelette')).toEqual([2, 374, 'fishingSpeed', 45, 'experiment']);
    // v2-05: the fruit in the custard, the pie and the pudding is worth more, so the dishes are too (same tiers)
    expect(row('apricot_custard')).toEqual([3, 1536, 'xp', 90, 'experiment']);
    expect(row('lemon_meringue_pie')).toEqual([3, 1552, 'cookSpeed', 90, 'card']);
    expect(row('persimmon_pudding')).toEqual([3, 1672, 'sellPrice', 90, 'card']);
    for (const id of [
      'fried_egg',
      'soft_cheese',
      'garden_omelette',
      'apricot_custard',
      'lemon_meringue_pie',
      'persimmon_pudding',
    ] as const) {
      expect(recipeTier(R[id], GAME_DATA.items), id).toBe(R[id].tier); // the existing formula, not a new one
    }
    expect(RECIPE_IDS).toHaveLength(36); // v4-04: the two forage dishes
  });

  it('Persimmon Pudding is the winter gold-buff dish: Silver Tongue, cookable from winter-fresh persimmon', () => {
    expect(R.persimmon_pudding.buff).toBe('sellPrice');
    expect(R.persimmon_pudding.ingredients).toEqual([
      { item: 'persimmon', qty: 1 },
      { item: 'milk', qty: 1 },
      { item: 'egg', qty: 1 },
    ]);
    expect(GAME_DATA.trees.persimmon_tree.seasons).toContain('winter');
  });

  it('the egg and milk milestones teach their recipes, and the cards open with the buildings', () => {
    const s = farm();
    const coop = coopWith(s, 1);
    coop.store = [{ item: 'egg', qty: 1 }];
    act(s, { type: 'collectBuilding', building: coop.id });
    expect(s.progression.milestones.done).toContain('m21_first_egg');
    expect(s.kitchen.known).toContain('fried_egg');
    const barn = build(s, 'barn');
    addAnimals(s, 'cow', 1);
    barn.store = [{ item: 'milk', qty: 1 }];
    act(s, { type: 'collectBuilding', building: barn.id });
    expect(s.progression.milestones.done).toContain('m22_first_milk');
    expect(s.kitchen.known).toContain('soft_cheese');
    // the milestones give no farm points
    const m = GAME_DATA.milestones.filter((x) => x.id === 'm21_first_egg' || x.id === 'm22_first_milk');
    expect(m).toHaveLength(2);
    // the cards: Lemon Meringue Pie with a coop, Persimmon Pudding with a barn
    expect(R.lemon_meringue_pie.discovery).toMatchObject({
      kind: 'card',
      price: 12_000,
      unlock: [{ kind: 'building', id: 'coop', level: 1 }],
    });
    expect(R.persimmon_pudding.discovery).toMatchObject({
      kind: 'card',
      price: 15_000,
      unlock: [{ kind: 'building', id: 'barn', level: 1 }],
    });
    const bare = farm();
    expect(why(act(bare, { type: 'buyRecipe', recipe: 'lemon_meringue_pie' }))).toMatch(/coop/i);
    expect(act(s, { type: 'buyRecipe', recipe: 'persimmon_pudding' })).toEqual({ ok: true });
  });

  it('eggs and milk are sold at the market, join the specials only once the animals live here', () => {
    const s = farm();
    expect(specialCandidates(s, GAME_DATA, 'winter')).not.toContain('egg');
    coopWith(s, 1);
    expect(specialCandidates(s, GAME_DATA, 'winter')).toContain('egg');
    expect(specialCandidates(s, GAME_DATA, 'winter')).not.toContain('milk');
  });
});

describe('bundle, goals, town projects and unlocks', () => {
  it('the Barnyard bundle takes eggs, a large egg, milk and hay and raises the troughs', () => {
    expect(GAME_DATA.bundles.barnyard.slots).toEqual([
      { item: 'egg', qty: 20 },
      { item: 'large_egg', qty: 3 },
      { item: 'milk', qty: 10 },
      { item: 'hay', qty: 20 },
    ]);
    expect(GAME_DATA.bundles.barnyard.reward).toEqual({ kind: 'troughBonus', bonus: 0.5 });
    const s = farm();
    s.inventory.stackSize = 99;
    addItem(s.inventory, 'egg', 20);
    addItem(s.inventory, 'large_egg', 3);
    addItem(s.inventory, 'milk', 10);
    s.ranch.feedStore.hay = 25; // hay is given from the feed store (v2-05)
    expect(donatable(s, GAME_DATA, 'barnyard').find((d) => d.item === 'hay')).toEqual({
      item: 'hay',
      qty: 20,
    });
    for (const [item, qty] of [
      ['egg', 20],
      ['large_egg', 3],
      ['milk', 10],
      ['hay', 20],
    ] as const)
      expect(donate(s, ctxFor(s), 'barnyard', item, qty)).toEqual({ ok: true });
    expect(isBundleDone(s, 'barnyard')).toBe(true);
    expect(s.ranch.feedStore.hay).toBe(5);
    expect(bundleBonuses(s, GAME_DATA).troughBonus).toBe(0.5);
  });

  it('the collect-produce goal asks for about an hour of the animals’ production, per kind', () => {
    const s = farm();
    s.progression.milestones.done.push('m21_first_egg');
    coopWith(s, 6);
    s.progression.goals = [];
    const goal = {
      template: 'collect_produce' as const,
      objective: { kind: 'collectProduct' as const, product: 'egg' as const, count: 12 },
      progress: 0,
      rewards: [],
    };
    expect(goalAchievable(s, GAME_DATA, 'winter', goal)).toBe(true);
    expect(goalText(GAME_DATA, goal)).toBe('Collect 12 eggs');
    const milkGoal = {
      ...goal,
      objective: { kind: 'collectProduct' as const, product: 'milk' as const, count: 6 },
    };
    expect(goalAchievable(s, GAME_DATA, 'winter', milkGoal)).toBe(false); // no cows yet
    build(s, 'barn');
    addAnimals(s, 'cow', 2);
    expect(goalAchievable(s, GAME_DATA, 'winter', milkGoal)).toBe(true);
    expect(goalText(GAME_DATA, milkGoal)).toBe('Collect 6 milk');
  });

  it('a collect goal counts eggs and large eggs as eggs', () => {
    const s = farm();
    const coop = coopWith(s, 1);
    s.progression.goals = [
      {
        template: 'collect_produce',
        objective: { kind: 'collectProduct', product: 'egg', count: 3 },
        progress: 0,
        rewards: [{ kind: 'gold', amount: 100 }],
      },
    ];
    coop.store = [
      { item: 'egg', qty: 2 },
      { item: 'large_egg', qty: 1 },
    ];
    act(s, { type: 'collectBuilding', building: coop.id });
    expect(s.progression.goalsDone).toBe(1);
  });

  it('eggs, milk and large eggs are in the bakery’s and the hall’s stages', () => {
    const asked = (p: keyof typeof TOWN_PROJECTS, stage: number) =>
      TOWN_PROJECTS[p].stages[stage - 1]!.items.map((i) => `${i.item}×${i.qty}`);
    expect(asked('bakery', 2)).toEqual(['egg×30']);
    expect(asked('community_hall', 1)).toEqual(['milk×30']);
    expect(asked('community_hall', 3)).toEqual(['large_egg×10']);
  });

  it('a building unlock condition is met by a built building of at least that level', () => {
    const s = farm();
    const barn = GAME_DATA.buildings.barn.levels[0]!.requires;
    expect(act(s, { type: 'buildBuilding', building: 'barn', ...SPOTS.barn }).ok).toBe(false);
    build(s, 'coop');
    expect(buildBuildingOk(s)).toBe(true);
    expect(barn).toHaveLength(1);
  });
});

function buildBuildingOk(s: GameState): boolean {
  return buildBuilding(s, ctxFor(s), 'barn', SPOTS.barn.col, SPOTS.barn.row).ok;
}

describe('Busy Bees speeds the animals (v2-05, the animalSpeedModifier seam)', () => {
  function bees(s: GameState, tier: 1 | 2 | 3 | 4, remainingMs: number): void {
    s.buffs.active.push({
      type: 'automationSpeed',
      magnitude: 0.1 * tier,
      tier,
      remainingMs,
      source: 'soft_cheese',
    });
  }

  it('the buff drives both the farmhand and the animal seam; nothing else does', async () => {
    const { computeModifiers } = await import('../src/systems/modifiers');
    const s = farm();
    expect(computeModifiers(s, GAME_DATA).animalSpeedModifier).toBe(1);
    bees(s, 2, HOUR);
    const m = computeModifiers(s, GAME_DATA);
    expect(m.automationSpeedModifier).toBeCloseTo(1.2);
    expect(m.animalSpeedModifier).toBeCloseTo(1.2);
  });

  it('cycles are whole ms, shortened by the modifier', () => {
    expect(cycleMsOf(ANIMALS.chicken, 1)).toBe(1_800_000);
    expect(cycleMsOf(ANIMALS.chicken, 1.2)).toBe(1_500_000);
    expect(cycleMsOf(ANIMALS.cow, 1.3)).toBe(Math.round(2_400_000 / 1.3));
    expect(Number.isInteger(cycleMsOf(ANIMALS.cow, 1.3))).toBe(true);
  });

  it('a T2 Busy Bees buff lays a fifth more eggs in the same time', () => {
    const plain = farm();
    coopWith(plain, 4, 2);
    const fast = structuredClone(plain);
    bees(fast, 2, 10 * HOUR);
    step(plain, ctxFor(plain, NOON, [], QUIET), 3 * HOUR);
    step(fast, ctxFor(fast, NOON, [], QUIET), 3 * HOUR);
    expect(storeCount(plain.ranch.buildings[0]!)).toBe(4 * 6);
    expect(storeCount(fast.ranch.buildings[0]!)).toBe(4 * 7); // 3 h / 25 min = 7.2 cycles
  });

  it('offline equivalence holds while the buff runs out part-way: one big step equals many small ones', () => {
    const big = farm();
    coopWith(big, 6, 2);
    build(big, 'barn', 2);
    addAnimals(big, 'cow', 3);
    big.ranch.buildings[1]!.trough = 40;
    bees(big, 3, 95 * MIN + 7_777); // expires mid-cycle
    const small = structuredClone(big);
    step(big, ctxFor(big, NOON, [], QUIET), 7 * HOUR);
    const ctx = ctxFor(small, NOON, [], QUIET);
    const steps = [1, 13 * MIN, 1_499_999, 77, 31 * MIN + 3];
    let left = 7 * HOUR;
    for (let i = 0; left > 0; i++) {
      const d = Math.min(left, steps[i % steps.length]!);
      step(small, ctx, d);
      left -= d;
    }
    expect(settled(big)).toEqual(settled(small));
    expect(big.buffs.active).toHaveLength(0);
  });

  it('the panel and labels count down to the next product at the buffed speed', () => {
    const s = farm();
    const coop = coopWith(s, 1);
    coop.cycleMs = 10 * MIN;
    expect(msToNextProduct(GAME_DATA, coop, 1)).toBe(20 * MIN);
    expect(msToNextProduct(GAME_DATA, coop, 1.2)).toBe(15 * MIN);
  });
});

describe('the ranch does not touch anything else', () => {
  it('feeds no modifier: computeModifiers is the same with a full ranch', async () => {
    const { computeModifiers } = await import('../src/systems/modifiers');
    const a = farm();
    const before = computeModifiers(a, GAME_DATA, 'summer');
    coopWith(a, 12, 3);
    build(a, 'barn', 3);
    addAnimals(a, 'cow', 6);
    build(a, 'silo', 2);
    a.upgrades.ranch_collector = 1;
    expect(computeModifiers(a, GAME_DATA, 'summer')).toEqual(before);
  });

  it('animals’ names and positions are state, not randomness: buying consumes no random numbers', () => {
    const s = farm();
    const coop = coopWith(s, 0);
    const rng = s.rngState;
    for (let i = 0; i < 3; i++) buyAnimal(s, ctxFor(s), 'chicken', coop.id);
    expect(s.rngState).toBe(rng);
    expect(animalsIn(s, coop.id)).toHaveLength(3);
    expect(buildingOfKind(s, 'coop')).toBe(coop);
    expect(levelDef(GAME_DATA, coop).capacity).toBe(4);
    expect(collectBuilding(s, ctxFor(s), coop.id).ok).toBe(false);
    expect(upgradeBuilding(s, ctxFor(s), 99).ok).toBe(false);
  });
});

describe('render-only life in the paddock', () => {
  function view(s: GameState): RanchView {
    return {
      buildings: s.ranch.buildings,
      animals: s.ranch.animals,
      troughLevel: s.ranch.buildings.map(() => 1),
    };
  }

  it('wandering, eating and sleeping never touch the game state or the generator', () => {
    const s = farm();
    coopWith(s, 4, 2);
    const barn = build(s, 'barn');
    addAnimals(s, 'cow', 2);
    barn.trough = 10;
    const snapshot = structuredClone(s);
    const life = new RanchLife(() => false);
    life.sync(view(s));
    expect(life.animalCount).toBe(6);
    for (let i = 0; i < 4000; i++) {
      life.update(16, i > 2000 && i < 3000); // a night in the middle
      if (i % 500 === 0) life.eatAt(1);
    }
    expect(s).toEqual(snapshot);
    expect(s.rngState).toBe(snapshot.rngState);
  });

  it('animals stay inside the Old Paddock and walk to their own building’s trough', () => {
    const s = farm();
    const coop = coopWith(s, 4);
    const life = new RanchLife(() => false);
    life.sync(view(s));
    for (let i = 0; i < 3000; i++) life.update(16, false);
    for (const a of s.ranch.animals) {
      const p = life.positionOf(a.id)!;
      expect(p.x).toBeGreaterThanOrEqual(21 * 16 - 8);
      expect(p.x).toBeLessThanOrEqual(36 * 16);
      expect(p.y).toBeGreaterThan((coop.at.row + 2) * 16 - 1);
      expect(p.y).toBeLessThanOrEqual(15 * 16);
    }
    life.eatAt(coop.id);
    const nearest = s.ranch.animals.map(() => 1e9);
    for (let i = 0; i < 700; i++) {
      life.update(16, false);
      s.ranch.animals.forEach((a, k) => {
        const p = life.positionOf(a.id)!;
        nearest[k] = Math.min(nearest[k]!, Math.abs(p.x - 25 * 16 - 8));
      });
    }
    for (const d of nearest) expect(d).toBeLessThan(10); // each reached the trough tile, right of the coop
  });

  it('is deterministic for a given sequence (a private generator), whatever the game does', () => {
    const s = farm();
    coopWith(s, 3);
    const a = new RanchLife(() => false);
    const b = new RanchLife(() => false);
    a.sync(view(s));
    b.sync(view(s));
    for (let i = 0; i < 500; i++) {
      a.update(16, false);
      b.update(16, false);
    }
    expect(a.positionOf(1)).toEqual(b.positionOf(1));
  });

  it('keeps animals still under reduced motion, and sorts everything by its bottom edge', () => {
    const s = farm();
    coopWith(s, 2);
    build(s, 'silo');
    const life = new RanchLife(() => true);
    life.sync(view(s));
    const start = life.positionOf(1)!;
    for (let i = 0; i < 200; i++) life.update(16, false);
    expect(life.positionOf(1)).toEqual(start);
    const n = life.prepare();
    expect(n).toBe(2 /* buildings */ + 1 /* trough */ + 2 /* hens */);
    for (let k = 1; k < n; k++) expect(life.bottomAt(k)).toBeGreaterThanOrEqual(life.bottomAt(k - 1));
    expect(life.bottomAt(n)).toBe(NO_MORE);
  });

  it('finds the animal or building under a point', () => {
    const s = farm();
    const coop = coopWith(s, 1);
    const life = new RanchLife(() => true);
    life.sync(view(s));
    const p = life.positionOf(1)!;
    expect(life.animalAt(p.x, p.y - 4)).toBe(1);
    expect(life.animalAt(p.x + 100, p.y)).toBe(-1);
    expect(life.buildingAt(23, 10)).toBe(coop.id);
    expect(life.buildingAt(23, 8)).toBe(coop.id); // the roof rises a tile above the footprint
    expect(life.buildingAt(25, 10)).toBe(coop.id); // the trough
    expect(life.buildingAt(30, 10)).toBe(-1);
    expect(life.buildingAt(25, 9)).toBe(-1);
  });
});
