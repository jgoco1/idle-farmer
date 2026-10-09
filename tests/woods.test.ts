// The North Woods and the mountain lake (v4 phase 04; GDD §13.7–13.8, BALANCE.md §14.7, DATA_SCHEMAS.md §10).

import { describe, expect, it } from 'vitest';
import { applyAction, type Action } from '../src/core/actions';
import type { GameEvent } from '../src/core/events';
import { runOffline } from '../src/core/offline';
import { makeContext, processCalendar, step } from '../src/core/sim';
import { createInitialState, type GameState } from '../src/core/state';
import { buildCalendar } from '../src/core/time';
import { validateState } from '../src/core/save';
import { GAME_DATA } from '../src/data';
import { BITE_WAIT_MAX_MS, BITE_WAIT_MIN_MS, FORAGE_CAP_DAYS } from '../src/data/balance';
import { FORAGE_IDS, FISH_IDS, type ForageKind } from '../src/data/ids';
import { inTileRect, regionAt, WORLD_LAYOUT } from '../src/data/world';
import { SPRITES } from '../src/render/sprites';
import { buildLayout, buildZones, LAKE_ZONE, TRAP_TILES, zoneAt } from '../src/render/scene';
import { forageSpotAt } from '../src/render/renderer';
import { setAutoSell } from '../src/systems/autoSeller';
import { catchTable, startReel, stepFishing } from '../src/systems/fishing';
import {
  forageCap,
  forageInSeason,
  growForage,
  openWoods,
  pickAllForage,
  ripeForageSpots,
  spotYield,
  woodsOpen,
} from '../src/systems/forage';
import { addItem, countItem } from '../src/systems/inventory';
import { isLocationUnlocked, maxTraps, nextTrapSpot } from '../src/systems/locations';
import { NO_MODIFIERS } from '../src/systems/modifiers';
import { msToNextPickup } from '../src/systems/shippingBin';
import { tickTraps, TRAP_INTERVAL_MS } from '../src/systems/traps';
import { recordHistory } from '../src/systems/market';
import { awayRows } from '../src/ui/awaySummary';
import { at, HOUR, NY, setFarmLevel } from './helpers';

// Wednesday 7 January 2026, 10:00. Spring until Sunday 11 January 00:00 (day 4 is the first summer day),
// then summer to day 10, autumn days 11–17, winter days 18–24, spring again from day 25.
const CREATED = at(NY, 2026, 1, 7, 10);
const dayTime = (d: number, h = 7): number => at(NY, 2026, 1, 7 + d, h);
const MUSHROOM = 0; // spot kinds (FORAGE.spotKinds)
const HERB = 1;
const FLOWER = 4;
const NUT = 5;

/** A farm on day `day` (07:00) owning the North Fields, so the woods are open. */
function farm(day = 0, seed = 1): GameState {
  const s = createInitialState(CREATED, NY, seed);
  s.land.parcels.push('orchard', 'yard', 'north_fields');
  s.gold = 5_000_000;
  if (day > 0) processCalendar(s, GAME_DATA, NY, dayTime(day), []);
  return s;
}

function ctxFor(s: GameState, t: number, events: GameEvent[] = []) {
  return makeContext(s, GAME_DATA, buildCalendar(t, s.calendar, NY), events);
}

function act(s: GameState, t: number, action: Action, events: GameEvent[] = []) {
  return applyAction(s, ctxFor(s, t, events), action);
}

/** Runs the daily refresh for each day up to `day`, one at a time. */
function daily(s: GameState, upTo: number, events: GameEvent[] = []): GameEvent[] {
  for (let d = s.calendar.maxDayIndex + 1; d <= upTo; d++)
    processCalendar(s, GAME_DATA, NY, dayTime(d), events);
  return events;
}

/** Opens the woods on `day` (what buying the North Fields or loading a save does). */
function opened(day = 0): GameState {
  const s = farm(day);
  openWoods(s, ctxFor(s, dayTime(day)));
  return s;
}

const spot = (s: GameState, i: number) => s.forage.spots[i]!;

describe('the North Woods data (BALANCE.md §14.7)', () => {
  it('has eight spots, two of each kind, in the woods, clear of the pines, the lake and each other', () => {
    const spots = WORLD_LAYOUT.forageSpots;
    expect(spots).toHaveLength(8);
    const kinds = GAME_DATA.forage.spotKinds;
    expect(kinds).toHaveLength(8);
    for (const k of ['mushroom', 'herb', 'flower', 'nut'] as ForageKind[])
      expect(kinds.filter((x) => x === k)).toHaveLength(2);
    const seen = new Set<string>();
    for (const t of spots) {
      expect(regionAt(t.col, t.row), `${t.col},${t.row}`).toBe('woods');
      expect(inTileRect(WORLD_LAYOUT.lake, t.col, t.row)).toBe(false);
      // a pine stands on its base tile and its crown fills the tile above
      for (const p of WORLD_LAYOUT.pines)
        expect(p.col === t.col && (p.row === t.row || p.row - 1 === t.row), `${t.col},${t.row}`).toBe(false);
      expect(seen.has(`${t.col},${t.row}`)).toBe(false);
      seen.add(`${t.col},${t.row}`);
    }
  });

  it('grows the table: each kind its item by season, a winter rest for mushrooms and mint, nuts from autumn', () => {
    const k = GAME_DATA.forage.kinds;
    expect(k.mushroom).toEqual({
      spring: { item: 'morel', perDay: 2 },
      summer: { item: 'chanterelle', perDay: 2 },
      autumn: { item: 'chanterelle', perDay: 3 },
      winter: null,
    });
    expect(k.herb.winter).toBeNull();
    expect(k.herb.spring).toEqual({ item: 'wild_mint', perDay: 5 });
    expect(k.flower.spring).toEqual({ item: 'elderflower', perDay: 4 });
    expect(k.flower.winter).toEqual({ item: 'rose_hip', perDay: 4 });
    expect(k.nut.spring).toBeNull();
    expect(k.nut.autumn).toEqual({ item: 'hazelnut', perDay: 5 });
    expect(FORAGE_CAP_DAYS).toBe(3);
    expect(forageInSeason(GAME_DATA, 'chanterelle', 'winter')).toBe(false);
    expect(forageInSeason(GAME_DATA, 'hazelnut', 'winter')).toBe(true);
  });

  it('forage items are sellable items of their own category, priced as the table says', () => {
    const prices = FORAGE_IDS.map((id) => GAME_DATA.items[id]!.basePrice);
    expect(prices).toEqual([160, 140, 45, 60, 50, 55, 70]);
    for (const id of FORAGE_IDS) {
      const def = GAME_DATA.items[id]!;
      expect(def.category).toBe('forage');
      expect(def.sellable).toBe(true);
      expect(def.edible).toBe(false);
      expect(SPRITES[`item_${id}`], id).toBeDefined();
      expect(SPRITES[`forage_${id}`], id).toBeDefined();
    }
    expect(SPRITES.forage_rest).toBeDefined();
    expect(SPRITES.forage_rest_winter).toBeDefined();
  });

  it('forage spots are small and low: 16 × 16, never taller than their tile, no two alike', () => {
    const looks = new Set<string>();
    for (const id of [...FORAGE_IDS.map((f) => `forage_${f}`), 'forage_rest', 'forage_rest_winter']) {
      const def = SPRITES[id]!;
      expect(def.frames[0]).toHaveLength(16);
      expect(def.frames[0]![0]).toHaveLength(16);
      looks.add(def.frames[0]!.join(''));
    }
    expect(looks.size).toBe(9);
    const icons = new Set(FORAGE_IDS.map((f) => SPRITES[`item_${f}`]!.frames[0]!.join('')));
    expect(icons.size).toBe(7);
  });

  it("go into two drinks and two dishes, and the Forager's Basket costs 120,000 after the first forage", () => {
    const uses = (item: string) =>
      Object.values(GAME_DATA.recipes)
        .filter((r) => r.ingredients.some((i) => i.item === item))
        .map((r) => r.id)
        .sort();
    expect(uses('wild_mint')).toEqual(['herbal_tea']);
    expect(uses('elderflower')).toEqual(['elderflower_cordial']);
    expect(uses('chanterelle')).toEqual(['mushroom_risotto']);
    expect(uses('blackberry')).toEqual(['blackberry_tart']);
    expect(GAME_DATA.recipes.herbal_tea.discovery).toEqual({ kind: 'milestone', id: 'm28_first_forage' });
    const basket = GAME_DATA.upgrades.forager_basket!;
    expect(basket.max).toBe(1);
    expect(basket.cost.base).toBe(120_000);
    expect(basket.requires).toEqual([{ kind: 'milestone', id: 'm28_first_forage' }]);
  });
});

describe('the woods open with the North Fields', () => {
  it('are closed before: no spots, nothing to pick, a hint', () => {
    const s = createInitialState(CREATED, NY, 1);
    expect(woodsOpen(s)).toBe(false);
    growForage(s, ctxFor(s, dayTime(0)));
    expect(s.forage.spots).toEqual([]);
    expect(act(s, dayTime(0), { type: 'pickForage', spot: 0 })).toEqual({
      ok: false,
      reason: 'The North Woods open with the North Fields.',
    });
  });

  it("buying the North Fields opens them with one day's growth, so the first visit finds something", () => {
    const s = createInitialState(CREATED, NY, 1);
    s.land.parcels.push('orchard', 'yard');
    s.expansions.push('farm_1', 'farm_2', 'farm_3', 'farm_4');
    setFarmLevel(s, 8);
    s.gold = 5_000_000;
    const events = act(s, dayTime(0), { type: 'buyParcel', parcel: 'north_fields' }).ok ? [] : null;
    expect(events).not.toBeNull();
    expect(s.forage.spots).toHaveLength(8);
    // Spring: morels 2, mint 5, elderflower 4; the hazels rest.
    expect(s.forage.spots.map((x) => [x.item, x.qty])).toEqual([
      ['morel', 2],
      ['wild_mint', 5],
      ['morel', 2],
      ['wild_mint', 5],
      ['elderflower', 4],
      [null, 0],
      ['elderflower', 4],
      [null, 0],
    ]);
    expect(validateState(s)).toBeNull();
    // Opening twice changes nothing.
    expect(openWoods(s, ctxFor(s, dayTime(0)))).toBe(false);
  });

  it('a save that owned the fields first opens them at the next refresh too', () => {
    const s = farm(0);
    expect(s.forage.spots).toEqual([]);
    const events = daily(s, 1);
    expect(s.forage.spots).toHaveLength(8);
    expect(events.some((e) => e.type === 'woodsOpened')).toBe(true);
  });
});

describe('regrowth by calendar day and season', () => {
  it('a spot gains its day yield at each 06:00 refresh, up to three days worth, and then waits', () => {
    const s = opened(0);
    expect(spot(s, HERB).qty).toBe(5);
    daily(s, 1);
    expect(spot(s, HERB).qty).toBe(10);
    daily(s, 2);
    expect(spot(s, HERB).qty).toBe(15); // the cap: 3 × 5
    daily(s, 3);
    expect(spot(s, HERB).qty).toBe(15);
    expect(forageCap(s, GAME_DATA, HERB, 'wild_mint')).toBe(15);
  });

  it('a resting kind grows nothing: hazels in spring and summer, mushrooms and mint in winter', () => {
    const s = opened(0);
    daily(s, 10); // through summer
    expect(spot(s, NUT)).toMatchObject({ item: null, qty: 0 });
    daily(s, 11); // autumn: hazelnuts
    expect(spot(s, NUT)).toMatchObject({ item: 'hazelnut', qty: 5 });
    expect(spotYield(GAME_DATA, MUSHROOM, 'winter')).toBeNull();
  });

  it('a new season with a different item keeps what is waiting (without growing) until it is picked', () => {
    const s = opened(0);
    daily(s, 3); // spring: morels capped at 6
    expect(spot(s, MUSHROOM)).toMatchObject({ item: 'morel', qty: 6 });
    daily(s, 5); // summer would grow chanterelles, but the morels wait
    expect(spot(s, MUSHROOM)).toMatchObject({ item: 'morel', qty: 6 });
    expect(act(s, dayTime(5, 12), { type: 'pickForage', spot: MUSHROOM }).ok).toBe(true);
    expect(countItem(s.inventory, 'morel')).toBe(6);
    expect(spot(s, MUSHROOM)).toMatchObject({ item: null, qty: 0 });
    daily(s, 6); // the next morning: the summer's chanterelles
    expect(spot(s, MUSHROOM)).toMatchObject({ item: 'chanterelle', qty: 2 });
  });

  it('a long absence gives exactly what daily visits would have (one big jump over the calendar)', () => {
    const a = opened(0);
    const b = opened(0);
    daily(a, 40); // one refresh a day
    processCalendar(b, GAME_DATA, NY, dayTime(40), []); // one jump of 40 days
    expect(b.forage.spots).toEqual(a.forage.spots);
    // and with a pick part way through, from the same point
    const c = opened(0);
    const d = opened(0);
    daily(c, 9);
    processCalendar(d, GAME_DATA, NY, dayTime(9), []);
    for (const g of [c, d]) act(g, dayTime(9, 12), { type: 'pickForage', spot: FLOWER });
    daily(c, 30);
    processCalendar(d, GAME_DATA, NY, dayTime(30), []);
    expect(d.forage.spots).toEqual(c.forage.spots);
  });

  it('the offline walk grows the woods the same way and reports it for the away summary', () => {
    const a = opened(0);
    const b = opened(0);
    daily(a, 3);
    const report = runOffline(b, GAME_DATA, NY, dayTime(0), dayTime(3));
    expect(b.forage.spots).toEqual(a.forage.spots);
    const rows = awayRows(report, { readyPlots: 0, dryPlots: 0 });
    expect(rows.some((r) => /grew in the North Woods/.test(r.text))).toBe(true);
  });

  it('never draws from the RNG', () => {
    const s = opened(0);
    const rng = s.rngState;
    growForage(s, ctxFor(s, dayTime(0)));
    s.forage.spots.forEach((x) => (x.lastDay -= 5));
    growForage(s, ctxFor(s, dayTime(0)));
    expect(s.rngState).toBe(rng);
  });
});

describe('picking', () => {
  it('a click picks the spot into the bag, counts it, pays Farming XP and finishes the first-forage milestone', () => {
    const s = opened(0);
    const events: GameEvent[] = [];
    expect(act(s, dayTime(0, 12), { type: 'pickForage', spot: HERB }, events)).toEqual({ ok: true });
    expect(countItem(s.inventory, 'wild_mint')).toBe(5);
    expect(s.stats.foraged).toBe(5);
    expect(events).toContainEqual({
      type: 'foragePicked',
      item: 'wild_mint',
      qty: 5,
      spot: HERB,
      auto: false,
      shipped: 0,
    });
    // progression runs at the next step
    step(s, ctxFor(s, dayTime(0, 12), events), 100);
    expect(s.progression.milestones.done).toContain('m28_first_forage');
    expect(s.kitchen.known).toContain('herbal_tea');
    expect(s.progression.skills.farming.xp).toBeGreaterThanOrEqual(25);
  });

  it('a picked-clean or resting spot says why; a full bag leaves everything on the spot', () => {
    const s = opened(0);
    act(s, dayTime(0, 12), { type: 'pickForage', spot: HERB });
    expect(act(s, dayTime(0, 12), { type: 'pickForage', spot: HERB })).toEqual({
      ok: false,
      reason: 'Picked clean. More grows by 6:00 tomorrow.',
    });
    expect(act(s, dayTime(0, 12), { type: 'pickForage', spot: NUT })).toEqual({
      ok: false,
      reason: 'Nothing grows here this season. Try again when it turns.',
    });
    s.inventory.slots = s.inventory.slots.map(() => ({ item: 'turnip', qty: s.inventory.stackSize }));
    expect(act(s, dayTime(0, 12), { type: 'pickForage', spot: FLOWER }).ok).toBe(false);
    expect(spot(s, FLOWER)).toMatchObject({ item: 'elderflower', qty: 4 });
  });

  it('the Auto-Seller ships forage it is told to (off by default)', () => {
    const s = opened(0);
    s.upgrades.auto_seller = 1;
    act(s, dayTime(0, 12), { type: 'pickForage', spot: MUSHROOM });
    expect(countItem(s.inventory, 'morel')).toBe(2);
    setAutoSell(s, GAME_DATA, 'wild_mint', true);
    act(s, dayTime(0, 12), { type: 'pickForage', spot: HERB });
    expect(countItem(s.inventory, 'wild_mint')).toBe(0);
    expect(s.shippingBin.items).toContainEqual({ item: 'wild_mint', qty: 5 });
  });

  it("the Forager's Basket picks every ripe spot at each bin pickup, for a quarter of the XP", () => {
    const s = opened(0);
    s.upgrades.forager_basket = 1;
    expect(msToNextPickup(s)).toBe(s.shippingBin.msToPickup);
    const events: GameEvent[] = [];
    const ctx = ctxFor(s, dayTime(0, 12), events);
    step(s, ctx, s.shippingBin.msToPickup);
    expect(ripeForageSpots(s)).toEqual([]);
    expect(countItem(s.inventory, 'wild_mint')).toBe(10);
    expect(
      events.filter((e) => e.type === 'foragePicked').every((e) => e.type === 'foragePicked' && e.auto),
    ).toBe(true);
    // nothing is lost when the bag is full: the spot keeps it
    const t = opened(0);
    t.inventory.slots = t.inventory.slots.map(() => ({ item: 'turnip', qty: t.inventory.stackSize }));
    expect(pickAllForage(t, ctxFor(t, dayTime(0, 12)))).toBe(0);
    expect(t.forage.spots.reduce((n, x) => n + x.qty, 0)).toBe(2 + 5 + 2 + 5 + 4 + 4);
  });

  it('the Forager bundle lets a spot hold four days worth', () => {
    const s = opened(0);
    s.progression.completedBundles.push('forager');
    daily(s, 3);
    expect(spot(s, HERB).qty).toBe(20);
    expect(forageCap(s, GAME_DATA, HERB, 'wild_mint')).toBe(20);
  });

  it('forage joins the Market sparkline once the woods are open', () => {
    const s = farm(0);
    recordHistory(s, GAME_DATA);
    expect(s.market.items.morel).toBeUndefined();
    openWoods(s, ctxFor(s, dayTime(0)));
    recordHistory(s, GAME_DATA);
    expect(s.market.items.morel?.history).toHaveLength(1);
  });

  it('the scene has a forage zone on each spot, and the renderer finds the spot under a tile', () => {
    const zones = buildZones(GAME_DATA.startGrid);
    for (const t of WORLD_LAYOUT.forageSpots) expect(zoneAt(zones, t.col, t.row)?.id).toBe('forage');
    const s = opened(0);
    const t = WORLD_LAYOUT.forageSpots[3]!;
    expect(forageSpotAt(s.forage.spots, t.col, t.row)).toBe(3);
    expect(forageSpotAt(s.forage.spots, 0, 0)).toBe(-1);
  });
});

describe('the mountain lake (BALANCE.md §14.7)', () => {
  const ALL = ['spring', 'summer', 'autumn', 'winter'] as const;
  const lakeFish = (season: (typeof ALL)[number], hour: number, mode: 'active' | 'trap' = 'active') =>
    catchTable(GAME_DATA, { location: 'lake', season, hour, mode, luck: 0 })
      .map((o) => o.id)
      .filter((id) => id in GAME_DATA.fish);

  it('has six fish of its own and no legendary; whitefish bites at every hour of every season', () => {
    const own = FISH_IDS.filter((f) => GAME_DATA.fish[f].location === 'lake');
    expect(own).toEqual(['whitefish', 'lake_trout', 'crayfish', 'pike', 'golden_trout', 'alpine_char']);
    expect(own.some((f) => GAME_DATA.fish[f].rarity === 'legendary')).toBe(false);
    for (const season of ALL) for (let h = 0; h < 24; h++) expect(lakeFish(season, h)).toContain('whitefish');
  });

  it('its fish table changes with the season and the hour', () => {
    expect(lakeFish('summer', 12).sort()).toEqual(['golden_trout', 'lake_trout', 'whitefish']);
    expect(lakeFish('summer', 22).sort()).toEqual(['crayfish', 'whitefish']);
    expect(lakeFish('winter', 12).sort()).toEqual(['alpine_char', 'pike', 'whitefish']);
    expect(lakeFish('spring', 12).sort()).toEqual(['lake_trout', 'pike', 'whitefish']);
    expect(lakeFish('autumn', 3).sort()).toEqual(['crayfish', 'pike', 'whitefish']);
    // traps take the common and uncommon fish in season at any hour, never the rare ones
    expect(lakeFish('summer', 12, 'trap').sort()).toEqual(['crayfish', 'lake_trout', 'whitefish']);
    expect(lakeFish('winter', 12, 'trap').sort()).toEqual(['pike', 'whitefish']);
  });

  it('opens as an expansion: 300,000, after the Old Dock, with the North Fields and Farm Level 7', () => {
    const lake = GAME_DATA.expansions.lake;
    expect(lake).toMatchObject({ kind: 'fishing', location: 'lake', price: 300_000 });
    const s = farm(0);
    expect(isLocationUnlocked(s, 'lake')).toBe(false);
    setFarmLevel(s, 7);
    expect(act(s, dayTime(0), { type: 'buyExpansion', id: 'lake' }).ok).toBe(false); // the Old Dock first
    s.expansions.push('river', 'ocean');
    const before = s.gold;
    expect(act(s, dayTime(0), { type: 'buyExpansion', id: 'lake' })).toEqual({ ok: true });
    expect(s.gold).toBe(before - 300_000);
    expect(isLocationUnlocked(s, 'lake')).toBe(true);
    expect(act(s, dayTime(0), { type: 'fishStart', location: 'lake' })).toEqual({ ok: true });
  });

  it('adds two trap spots (three with the Pond Fish bundle) and its traps catch lake fish', () => {
    const s = farm(0);
    s.expansions.push('river', 'ocean', 'lake');
    expect(maxTraps(s, GAME_DATA)).toBe(8);
    expect(GAME_DATA.upgrades.fish_trap!.max).toBe(12);
    s.progression.completedBundles.push('pond_fish');
    expect(maxTraps(s, GAME_DATA)).toBe(12);
    s.fishing.traps.push({ id: 1, location: 'lake', slot: 0, progressMs: 0, contents: [] });
    expect(TRAP_TILES.lake).toHaveLength(3);
    const ctx = ctxFor(s, dayTime(0, 12));
    tickTraps(s, ctx, TRAP_INTERVAL_MS * 4);
    const caught = s.fishing.traps[0]!.contents.map((c) => c.item);
    for (const id of caught)
      expect(id in GAME_DATA.fish ? GAME_DATA.fish[id as 'whitefish'].location : 'junk').not.toBe('pond');
    expect(nextTrapSpot(s, GAME_DATA)).toEqual({ location: 'pond', slot: 0 });
  });

  it('a lake trap in one big step equals many small ones', () => {
    const run = (steps: number) => {
      const s = farm(0, 7);
      s.expansions.push('river', 'ocean', 'lake');
      s.fishing.traps.push({ id: 1, location: 'lake', slot: 0, progressMs: 0, contents: [] });
      const ctx = ctxFor(s, dayTime(0, 12));
      for (let i = 0; i < steps; i++) tickTraps(s, ctx, (TRAP_INTERVAL_MS * 6) / steps);
      return s.fishing.traps;
    };
    expect(run(1)).toEqual(run(6));
  });

  it('its own reel tuning: a slower, slightly narrower zone and later bites; Relaxed multiplies on top', () => {
    expect(GAME_DATA.locationReel.lake).toEqual({
      zoneSpeedMult: 0.85,
      zoneWidthMult: 0.92,
      biteWaitMult: 1.15,
    });
    expect(GAME_DATA.locationReel.pond).toEqual({ zoneSpeedMult: 1, zoneWidthMult: 1, biteWaitMult: 1 });
    const reel = (location: 'pond' | 'lake', relaxed = false) => {
      const s = farm(0, 3);
      s.settings.relaxedFishing = relaxed;
      return startReel(s, ctxFor(s, dayTime(0, 12)), 'whitefish', location);
    };
    expect(reel('lake').zoneWidth).toBeCloseTo(reel('pond').zoneWidth * 0.92, 10);
    expect(reel('lake').zoneSpeed).toBeCloseTo(reel('pond').zoneSpeed * 0.85, 10);
    expect(reel('lake', true).zoneWidth).toBeCloseTo(reel('pond', true).zoneWidth * 0.92, 10);
    expect(reel('lake', true).zoneWidth).toBeGreaterThan(reel('lake').zoneWidth);
    const wait = (location: 'pond' | 'lake') => {
      const s = farm(0, 9);
      const ctx = ctxFor(s, dayTime(0, 12));
      ctx.mods = { ...NO_MODIFIERS };
      s.fishing.session = {
        location,
        phase: 'charging',
        power: 0,
        fish: null,
        sizeCm: 0,
        waitMs: 0,
        reel: null,
      };
      stepFishing(s, ctx, false, 0);
      return s.fishing.session!.waitMs;
    };
    expect(wait('lake')).toBeCloseTo(wait('pond') * 1.15, -1);
    expect(wait('lake')).toBeLessThanOrEqual(BITE_WAIT_MAX_MS * 1.15);
    expect(wait('lake')).toBeGreaterThanOrEqual(BITE_WAIT_MIN_MS * 1.15);
  });

  it('a lake catch finishes m29 (40,000 gold) and goes in the Fish Collection', () => {
    const s = farm(0);
    s.expansions.push('river', 'ocean', 'lake');
    const events: GameEvent[] = [];
    const ctx = ctxFor(s, dayTime(0, 12), events);
    s.fishing.session = {
      location: 'lake',
      phase: 'reeling',
      power: 1,
      fish: 'whitefish',
      sizeCm: 30,
      waitMs: 0,
      reel: startReel(s, ctx, 'whitefish', 'lake'),
    };
    s.fishing.session.reel!.meter = 0.999;
    s.fishing.session.reel!.marker = s.fishing.session.reel!.zoneCenter;
    stepFishing(s, ctx, false, 16);
    expect(s.fishing.collection.whitefish?.count).toBe(1);
    const gold = s.gold;
    step(s, ctx, 100);
    expect(s.progression.milestones.done).toContain('m29_lake_fish');
    expect(s.gold).toBeGreaterThanOrEqual(gold + 40_000);
  });

  it('the scene: the lake zone covers the water and the jetty, its traps float inside on lake water', () => {
    const zones = buildZones(GAME_DATA.startGrid);
    expect(zoneAt(zones, WORLD_LAYOUT.jetty.col, WORLD_LAYOUT.jetty.row)?.id).toBe('lake');
    const layout = buildLayout(GAME_DATA.startGrid, ['lake'], ['north_fields']);
    for (const t of TRAP_TILES.lake) {
      expect(inTileRect(LAKE_ZONE, t.col, t.row)).toBe(true);
      expect(inTileRect(WORLD_LAYOUT.lake, t.col, t.row)).toBe(true);
      expect(layout.objects.some((o) => o.x === t.col * 16 && o.y === t.row * 16)).toBe(false);
    }
    const sign = (exp: string[]) =>
      buildLayout(GAME_DATA.startGrid, exp as never, []).objects.some(
        (o) => o.sprite === 'obj_for_sale' && o.y < 0 && o.x >= 27 * 16,
      );
    expect(sign([])).toBe(true);
    expect(sign(['lake'])).toBe(false);
  });
});

describe('the whole north in one big step', () => {
  it('a day with the woods, the lake traps and the basket equals the same day in small steps', () => {
    const make = () => {
      const s = opened(0);
      s.expansions.push('river', 'ocean', 'lake');
      s.upgrades.forager_basket = 1;
      s.upgrades.trap_collector = 1;
      s.fishing.traps.push({ id: 1, location: 'lake', slot: 0, progressMs: 0, contents: [] });
      addItem(s.inventory, 'turnip', 1);
      return s;
    };
    const a = make();
    const b = make();
    runOffline(a, GAME_DATA, NY, dayTime(0, 8), dayTime(1, 8));
    for (let h = 0; h < 24; h += 3) runOffline(b, GAME_DATA, NY, dayTime(0, 8 + h), dayTime(0, 11 + h));
    expect(b.forage).toEqual(a.forage);
    expect(b.stats.foraged).toBe(a.stats.foraged);
    expect(a.stats.foraged).toBeGreaterThan(0);
    void HOUR;
  });
});
