import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../src/core/events';
import { Game } from '../src/core/game';
import { runOffline } from '../src/core/offline';
import { makeContext, processCalendar, step } from '../src/core/sim';
import { createInitialState, type GameState } from '../src/core/state';
import { buildCalendar, TICK_MS } from '../src/core/time';
import { GAME_DATA } from '../src/data';
import {
  BIN_PICKUP_MS,
  DEMAND_CEIL,
  DEMAND_FLOOR,
  MARKET_CHANNEL,
  MARKET_HISTORY_DAYS,
} from '../src/data/balance';
import { addItem, countItem } from '../src/systems/inventory';
import {
  demandAfter,
  demandOf,
  demandStep,
  marketDepth,
  priceTrend,
  quoteSale,
  restTarget,
  rollSpecials,
  sellItems,
  specialCandidates,
  tickMarket,
  unitPrice,
} from '../src/systems/market';
import { NO_MODIFIERS } from '../src/systems/modifiers';
import { binCount, shipItems, unshipItems } from '../src/systems/shippingBin';
import { createRng } from '../src/core/rng';
import { at, DAY, HOUR, NY } from './helpers';

// Wednesday 7 Jan 2026, 10:00 in New York: spring.
const CREATED = at(NY, 2026, 1, 7, 10);
const MIN = 60_000;

function farm(seed = 1): GameState {
  return createInitialState(CREATED, NY, seed);
}

function ctxAt(s: GameState, t = CREATED, events: GameEvent[] = []) {
  return makeContext(s, GAME_DATA, buildCalendar(t, s.calendar, NY), events);
}

function withTurnips(s: GameState, n: number): GameState {
  s.market.specials = []; // keep prices predictable
  addItem(s.inventory, 'turnip', n);
  return s;
}

describe('prices and demand', () => {
  it('depth is deep for cheap crops and shallow for pricey ones, within the clamp', () => {
    expect(marketDepth(22)).toBeGreaterThan(marketDepth(241));
    expect(marketDepth(1)).toBe(150);
    expect(marketDepth(100_000)).toBe(20);
    expect(demandStep(22)).toBeCloseTo((1 - DEMAND_FLOOR) / marketDepth(22), 12);
  });

  it('unit price is basePrice × demand × special × channel, floored, at least 1', () => {
    const s = withTurnips(farm(), 0);
    expect(unitPrice(s, GAME_DATA, NO_MODIFIERS, 'turnip', 1)).toBe(22);
    expect(unitPrice(s, GAME_DATA, NO_MODIFIERS, 'turnip', MARKET_CHANNEL)).toBe(19); // floor(19.8)
    s.market.specials = [{ item: 'turnip', bonus: 0.5 }];
    expect(unitPrice(s, GAME_DATA, NO_MODIFIERS, 'turnip', 1)).toBe(33);
    s.market.items.turnip = { demand: 0.5, lastSoldSimMs: 0, history: [] };
    expect(unitPrice(s, GAME_DATA, NO_MODIFIERS, 'turnip', 1)).toBe(16); // floor(22 · 0.5 · 1.5)
  });

  it('sellPriceModifier scales every price (the phase 06 food-buff seam)', () => {
    const s = withTurnips(farm(), 0);
    const mods = { ...NO_MODIFIERS, sellPriceModifier: 1.2 };
    expect(unitPrice(s, GAME_DATA, mods, 'turnip', 1)).toBe(26);
  });

  it('selling lowers demand one unit at a time, and the preview is the exact total', () => {
    const s = withTurnips(farm(), 40);
    const events: GameEvent[] = [];
    const ctx = ctxAt(s, CREATED, events);
    const quote = quoteSale(s, GAME_DATA, ctx.mods, 'turnip', 40);
    let expected = 0;
    let d = 1;
    for (let i = 0; i < 40; i++) {
      expected += Math.floor(22 * d * MARKET_CHANNEL);
      d -= demandStep(22);
    }
    expect(quote.gold).toBe(expected);
    const before = s.gold;
    expect(sellItems(s, ctx, 'turnip', 40).ok).toBe(true);
    expect(s.gold - before).toBe(quote.gold);
    expect(demandOf(s, 'turnip')).toBeCloseTo(1 - 40 * demandStep(22), 10);
    expect(s.market.items.turnip!.lastSoldSimMs).toBe(s.clock.simMs);
    expect(countItem(s.inventory, 'turnip')).toBe(0);
    expect(events).toEqual([
      { type: 'sold', item: 'turnip', qty: 40, gold: quote.gold, via: 'market' },
      { type: 'goldEarned', amount: quote.gold, source: 'sale' },
    ]);
    expect(s.stats.lifetimeGold).toBe(quote.gold);
    expect(s.stats.goldToday).toBe(quote.gold);
  });

  it('demand never falls below the floor', () => {
    const s = withTurnips(farm(), 99 * 4);
    const ctx = ctxAt(s);
    expect(sellItems(s, ctx, 'turnip', 99 * 4).ok).toBe(true);
    expect(demandOf(s, 'turnip')).toBe(DEMAND_FLOOR);
    // Still sells: half price, never zero.
    expect(unitPrice(s, GAME_DATA, NO_MODIFIERS, 'turnip', MARKET_CHANNEL)).toBe(9);
  });

  it('refuses seeds, missing items and bad quantities', () => {
    const s = withTurnips(farm(), 2);
    const ctx = ctxAt(s);
    expect(sellItems(s, ctx, 'seed_turnip', 1)).toEqual({ ok: false, reason: "Turnip Seeds can't be sold." });
    expect(sellItems(s, ctx, 'turnip', 3)).toEqual({ ok: false, reason: "You don't have 3 Turnip." });
    expect(sellItems(s, ctx, 'turnip', 0).ok).toBe(false);
    expect(sellItems(s, ctx, 'turnip', 1.5).ok).toBe(false);
    expect(countItem(s.inventory, 'turnip')).toBe(2);
    expect(s.gold).toBe(60);
  });
});

describe('demand recovery', () => {
  it('recovers toward 1.0 over about half an hour', () => {
    const d = demandAfter(0.6, 0, 30 * MIN);
    expect(d).toBeGreaterThan(0.97);
    expect(d).toBeLessThan(1);
    expect(demandAfter(0.6, 0, 10 * MIN)).toBeCloseTo(1 - 0.4 * Math.exp(-1), 10);
  });

  it('rests toward 1.3 after 3 hours unsold, and never passes the ceiling', () => {
    expect(restTarget(-1)).toBe(1);
    expect(restTarget(30 * MIN)).toBe(1);
    expect(restTarget(2 * HOUR)).toBeCloseTo(1.2, 10);
    expect(restTarget(3 * HOUR)).toBeCloseTo(1.3, 10);
    expect(restTarget(10 * HOUR)).toBe(DEMAND_CEIL);
    const d = demandAfter(0.8, 0, 5 * HOUR);
    expect(d).toBeGreaterThan(1.29);
    expect(d).toBeLessThanOrEqual(DEMAND_CEIL);
    expect(demandAfter(1.3, 0, 12 * HOUR)).toBe(DEMAND_CEIL);
    // An item never sold stays at 1.0.
    expect(demandAfter(1, -1, 12 * HOUR)).toBe(1);
  });

  it('one large step equals many small ones (across the 1 h and 3 h rest changes)', () => {
    for (const [d0, since] of [
      [0.55, 0],
      [0.9, 50 * MIN],
      [1.25, 170 * MIN],
      [0.7, -1],
    ] as const) {
      const big = demandAfter(d0, since, 4 * HOUR);
      let small: number = d0;
      for (let t = 0; t < 4 * HOUR; t += 8 * MIN) {
        small = demandAfter(small, since < 0 ? -1 : since + t, 8 * MIN);
      }
      expect(small).toBeCloseTo(big, 9);
    }
  });

  it('tickMarket relaxes every known item and leaves untouched items alone', () => {
    const s = withTurnips(farm(), 50);
    sellItems(s, ctxAt(s), 'turnip', 50);
    const low = demandOf(s, 'turnip');
    step(s, ctxAt(s), 30 * MIN);
    expect(demandOf(s, 'turnip')).toBeGreaterThan(low);
    expect(demandOf(s, 'potato')).toBe(1);
    const again = farm();
    tickMarket(again, ctxAt(again), 10 * MIN);
    expect(demandOf(again, 'potato')).toBe(1);
  });

  it('100 ms ticks and one large step give the same demand', () => {
    const a = withTurnips(farm(), 60);
    sellItems(a, ctxAt(a), 'turnip', 60);
    const b = structuredClone(a);
    step(a, ctxAt(a), 20 * MIN);
    const ctx = ctxAt(b);
    for (let t = 0; t < 20 * MIN; t += TICK_MS) step(b, ctx, TICK_MS);
    expect(demandOf(b, 'turnip')).toBeCloseTo(demandOf(a, 'turnip'), 9);
  });
});

describe("today's specials", () => {
  it('rolls 1–3 distinct obtainable items at +20% to +50% in 5% steps', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const s = farm(seed);
      s.stats.lifetimeGold = 2100; // Farm Level 4: turnip, potato, garlic, strawberry, cauliflower
      rollSpecials(s, GAME_DATA, createRng(s), 'spring');
      const sp = s.market.specials;
      expect(sp.length).toBeGreaterThanOrEqual(1);
      expect(sp.length).toBeLessThanOrEqual(3);
      expect(new Set(sp.map((x) => x.item)).size).toBe(sp.length);
      for (const x of sp) {
        expect(specialCandidates(s, GAME_DATA, 'spring')).toContain(x.item);
        expect(x.bonus).toBeGreaterThanOrEqual(0.2);
        expect(x.bonus).toBeLessThanOrEqual(0.5);
        expect(Math.round(x.bonus * 100) % 5).toBe(0);
      }
    }
  });

  it('only offers what the player can grow now', () => {
    const s = farm();
    // Crops in season, the in-season fish of the open locations (the pond, until the river opens),
    // then the dishes of the recipes the player knows (the three starters).
    const starters = ['roasted_turnip', 'baked_potato', 'grilled_bluegill'];
    expect(specialCandidates(s, GAME_DATA, 'spring')).toEqual([
      'turnip',
      'potato',
      'bluegill',
      'carp',
      'catfish',
      'koi',
      'petal_koi',
      ...starters,
    ]);
    expect(specialCandidates(s, GAME_DATA, 'winter')).toEqual(['bluegill', ...starters]); // winter crops start at Farm Level 2
    s.stats.lifetimeGold = 300;
    expect(specialCandidates(s, GAME_DATA, 'winter')).toEqual([
      'garlic',
      'kale',
      'leek',
      'bluegill',
      ...starters,
    ]);
    s.expansions.push('river');
    expect(specialCandidates(s, GAME_DATA, 'winter')).toEqual([
      'garlic',
      'kale',
      'leek',
      'bluegill',
      'perch',
      'sturgeon',
      ...starters,
    ]);
  });

  it('a new farm opens with specials and one sparkline point', () => {
    const s = farm();
    expect(s.market.specials.length).toBeGreaterThan(0);
    expect(s.market.items.turnip!.history).toHaveLength(1);
  });

  it('re-roll at 06:00 local and are deterministic for a given seed', () => {
    const roll = (seed: number) => {
      const s = farm(seed);
      const events: GameEvent[] = [];
      processCalendar(s, GAME_DATA, NY, at(NY, 2026, 1, 8, 5, 59), events);
      expect(events).toEqual([]); // not yet
      const before = structuredClone(s.market.specials);
      processCalendar(s, GAME_DATA, NY, at(NY, 2026, 1, 8, 6, 0), events);
      expect(events).toEqual([{ type: 'dayStarted', dayKey: '2026-01-08' }]);
      return { before, after: s.market.specials, s };
    };
    const a = roll(7);
    const b = roll(7);
    expect(a.after).toEqual(b.after);
    expect(a.s.rngState).toBe(b.s.rngState);
    // Different seeds give different sequences somewhere.
    const differ = [1, 2, 3, 4, 5, 6].some(
      (seed) => JSON.stringify(roll(seed).after) !== JSON.stringify(a.after),
    );
    expect(differ).toBe(true);
    // The morning refresh also resets today's gold and counts the day.
    expect(a.s.stats.daysPassed).toBe(1);
    expect(a.s.market.items.turnip!.history).toHaveLength(2);
  });

  it('after several days away the refresh happens once, not once per day', () => {
    const s = farm(3);
    s.stats.goldToday = 500;
    const leave = at(NY, 2026, 1, 7, 18);
    const back = leave + 5 * DAY; // Monday 12 Jan: five 06:00s have passed
    const report = runOffline(s, GAME_DATA, NY, leave, back);
    // Walking the absence fires at each 06:00 inside the counted first 24 h (one here, Thursday,
    // which splits the counted time) and then once for the latest day: 2 refreshes, not 5
    // (BALANCE.md §1).
    expect(report.dayStarts).toBe(2);
    expect(s.stats.daysPassed).toBe(2);
    expect(s.market.items.turnip!.history).toHaveLength(3);
    expect(s.stats.goldToday).toBe(0);
    expect(s.calendar.lastDayKey).toBe('2026-01-12');
  });

  it('the sparkline keeps the last 7 daily points', () => {
    const s = farm();
    for (let d = 8; d <= 20; d++) processCalendar(s, GAME_DATA, NY, at(NY, 2026, 1, d, 7), []);
    expect(s.market.items.potato!.history).toHaveLength(MARKET_HISTORY_DAYS);
  });

  it('the trend arrow compares now with the morning point', () => {
    const s = withTurnips(farm(), 60);
    s.market.items.turnip!.history = [1];
    expect(priceTrend(s, 'turnip')).toBe('flat');
    sellItems(s, ctxAt(s), 'turnip', 60);
    expect(priceTrend(s, 'turnip')).toBe('down');
    s.market.items.turnip!.demand = 1.2;
    expect(priceTrend(s, 'turnip')).toBe('up');
  });
});

describe('shipping bin', () => {
  it('holds shipped items and gives them back', () => {
    const s = withTurnips(farm(), 10);
    const ctx = ctxAt(s);
    expect(shipItems(s, ctx, 'turnip', 4).ok).toBe(true);
    expect(shipItems(s, ctx, 'turnip', 4).ok).toBe(true);
    expect(s.shippingBin.items).toEqual([{ item: 'turnip', qty: 8 }]);
    expect(countItem(s.inventory, 'turnip')).toBe(2);
    expect(shipItems(s, ctx, 'turnip', 3).ok).toBe(false);
    expect(shipItems(s, ctx, 'seed_turnip', 1).ok).toBe(false);
    expect(unshipItems(s, ctx, 'turnip').ok).toBe(true);
    expect(binCount(s)).toBe(0);
    expect(countItem(s.inventory, 'turnip')).toBe(10);
  });

  it('is collected every 60 minutes at 100% of the prices of that moment', () => {
    const s = withTurnips(farm(), 60);
    const events: GameEvent[] = [];
    const ctx = ctxAt(s, CREATED, events);
    // Sell 40 now (demand drops), ship 20; by the pickup demand has partly recovered.
    sellItems(s, ctx, 'turnip', 40);
    shipItems(s, ctx, 'turnip', 20);
    const soldAt = s.clock.simMs;
    const pickupIn = s.shippingBin.msToPickup;
    expect(pickupIn).toBe(BIN_PICKUP_MS);
    step(s, ctx, pickupIn - 1);
    expect(binCount(s)).toBe(20);
    // The price at the moment of pickup: demand after recovering for exactly one hour.
    const probe = structuredClone(s);
    probe.market.items.turnip!.demand = demandAfter(1 - 40 * demandStep(22), 0, pickupIn);
    const expected = quoteSale(probe, GAME_DATA, NO_MODIFIERS, 'turnip', 20, 1).gold;
    const gold = s.gold;
    events.length = 0;
    step(s, ctx, 1);
    expect(binCount(s)).toBe(0);
    expect(s.gold - gold).toBe(expected);
    expect(events).toContainEqual({ type: 'binCollected', gold: expected, items: 20 });
    expect(events).toContainEqual({ type: 'sold', item: 'turnip', qty: 20, gold: expected, via: 'bin' });
    expect(s.stats.itemsShipped).toBe(20);
    expect(s.market.items.turnip!.lastSoldSimMs).toBe(soldAt + pickupIn);
    expect(s.shippingBin.msToPickup).toBe(BIN_PICKUP_MS);
  });

  it('keeps its hourly schedule while empty', () => {
    const s = farm();
    step(s, ctxAt(s), 2.5 * HOUR);
    expect(s.shippingBin.msToPickup).toBe(0.5 * HOUR);
  });

  it('many pickups in a long offline period: each at its own moment, like playing online', () => {
    // A bin refilled before each pickup, simulated two ways: stepping through the absence in 100 ms
    // ticks and in one large step per hour must pay the same.
    const run = (ticks: boolean): GameState => {
      const s = withTurnips(farm(), 99 * 3);
      const ctx = ctxAt(s);
      sellItems(s, ctx, 'turnip', 30);
      for (let h = 0; h < 6; h++) {
        shipItems(s, ctx, 'turnip', 40);
        if (ticks) for (let t = 0; t < HOUR; t += TICK_MS) step(s, ctx, TICK_MS);
        else step(s, ctx, HOUR);
      }
      return s;
    };
    const a = run(false);
    const b = run(true);
    expect(a.gold).toBe(b.gold);
    expect(a.stats.itemsShipped).toBe(240);
    expect(demandOf(a, 'turnip')).toBeCloseTo(demandOf(b, 'turnip'), 9);
    expect(a.shippingBin.msToPickup).toBe(b.shippingBin.msToPickup);
  });

  it('an 8-hour absence collects a full bin once, at the first pickup, then keeps the timer', () => {
    const s = withTurnips(farm(), 30);
    const ctx = ctxAt(s);
    shipItems(s, ctx, 'turnip', 30);
    step(s, ctx, 20 * MIN); // the next pickup is 40 minutes away
    const leave = CREATED + HOUR;
    const report = runOffline(s, GAME_DATA, NY, leave, leave + 8 * HOUR);
    const collected = report.events.filter((e) => e.type === 'binCollected');
    expect(collected).toHaveLength(1);
    expect(collected[0]).toMatchObject({ items: 30 });
    expect(binCount(s)).toBe(0);
    // Pickups at 40 min, 1 h 40, … 7 h 40 into the absence: 8 whole hours later the next one is
    // again 40 minutes away.
    expect(s.shippingBin.msToPickup).toBe(40 * MIN);
    // Turnips never sold before start at demand 1.0: the bin pays the full-price quote.
    expect(collected[0]!.gold).toBe(
      quoteSale(withTurnips(farm(), 0), GAME_DATA, NO_MODIFIERS, 'turnip', 30, 1).gold,
    );
  });

  it('the live game pays out through Game.advance too', () => {
    let t = CREATED;
    const s = withTurnips(farm(), 5);
    const game = new Game(s, { data: GAME_DATA, lc: NY, now: () => t });
    expect(game.dispatch({ type: 'ship', item: 'turnip', qty: 5 }).ok).toBe(true);
    const seen: number[] = [];
    game.bus.on('binCollected', (e) => seen.push(e.gold));
    t += HOUR;
    game.advance(HOUR);
    expect(seen).toEqual([22 + 4 * 21]); // demand drops a little after the first unit
    expect(game.state.gold).toBe(60 + 106);
  });
});
