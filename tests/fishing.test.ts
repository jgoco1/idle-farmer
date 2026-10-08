import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../src/core/events';
import { Game } from '../src/core/game';
import { runOffline } from '../src/core/offline';
import { createRng } from '../src/core/rng';
import { validateState } from '../src/core/save';
import { makeContext, processCalendar, step } from '../src/core/sim';
import { createInitialState, type GameState, type ReelState } from '../src/core/state';
import { buildCalendar } from '../src/core/time';
import { GAME_DATA } from '../src/data';
import {
  BITE_WAIT_MAX_MS,
  BITE_WAIT_MIN_MS,
  BITE_WINDOW_MS,
  CAST_CHARGE_MS,
  REEL,
  TRAP_CAPACITY,
  TRAP_INTERVAL_SEC,
} from '../src/data/balance';
import { FISH, JUNK } from '../src/data/fish';
import { FISH_IDS, JUNK_IDS, type FishLocationId, type SeasonId, type UpgradeId } from '../src/data/ids';
import { ITEMS } from '../src/data/items';
import { buyExpansion } from '../src/systems/expansions';
import {
  catchTable,
  chooseCatch,
  inHourWindow,
  markerInZone,
  pickWeighted,
  reelParams,
  rollSize,
  startReel,
  stepFishing,
} from '../src/systems/fishing';
import { addItem, countItem } from '../src/systems/inventory';
import { addTrap, expansionFor, maxTraps, nextTrapSpot, unlockedLocations } from '../src/systems/locations';
import { computeModifiers, NO_MODIFIERS } from '../src/systems/modifiers';
import { sellItems, specialCandidates, unitPrice } from '../src/systems/market';
import { collectTrap, tickTraps, TRAP_INTERVAL_MS, trapItemCount } from '../src/systems/traps';
import { setAutoSell } from '../src/systems/autoSeller';
import { msToNextPickup } from '../src/systems/shippingBin';
import { buyUpgrade, upgradeCost } from '../src/systems/upgrades';
import { at, HOUR, NY, setFarmLevel } from './helpers';

const CREATED = at(NY, 2026, 1, 7, 10); // Wednesday, spring until Sunday 11 Jan 00:00
const NOON = at(NY, 2026, 1, 7, 12);
const SEC = 1000;
const MIN = 60_000;

function farm(seed = 1, t = NOON): GameState {
  const s = createInitialState(CREATED, NY, seed);
  processCalendar(s, GAME_DATA, NY, t, []);
  return s;
}

function ctxAt(s: GameState, t = NOON, events: GameEvent[] = []) {
  return makeContext(s, GAME_DATA, buildCalendar(t, s.calendar, NY), events);
}

/** Bought upgrade levels and expansions, set directly (the buying rules have their own tests). */
function own(s: GameState, upgrades: Partial<Record<UpgradeId, number>>, expansions: string[] = []): void {
  Object.assign(s.upgrades, upgrades);
  for (const e of expansions) s.expansions.push(e as never);
}

describe('fish data (phase 05)', () => {
  it('has the 22 fish (v4-04: six from the lake) and 3 junk items of BALANCE.md', () => {
    expect(Object.keys(FISH)).toHaveLength(22);
    expect(FISH_IDS).toHaveLength(22);
    expect(Object.keys(JUNK)).toHaveLength(3);
    expect(FISH.moonfin.hours).toEqual({ start: 16, end: 10 });
    expect(FISH.koi.basePrice).toBe(300);
    expect(JUNK.seaweed.locations).toEqual(['pond', 'ocean']);
  });

  it('has exactly one legendary per season, each at its own place, and never trappable', () => {
    const legends = FISH_IDS.filter((f) => FISH[f].rarity === 'legendary');
    expect(legends.sort()).toEqual(['ember_salmon', 'moonfin', 'petal_koi', 'sun_marlin']);
    const bySeason = (s: SeasonId) => legends.filter((f) => FISH[f].seasons.includes(s));
    expect(bySeason('spring')).toEqual(['petal_koi']);
    expect(bySeason('summer')).toEqual(['sun_marlin']);
    expect(bySeason('autumn')).toEqual(['ember_salmon']);
    expect(bySeason('winter')).toEqual(['moonfin']);
    for (const f of legends) expect(FISH[f].trappable).toBe(false);
  });

  it('only common and uncommon fish are trappable, and all of them are', () => {
    for (const f of FISH_IDS) {
      expect(FISH[f].trappable, f).toBe(FISH[f].rarity === 'common' || FISH[f].rarity === 'uncommon');
    }
  });

  it('every location always has a common fish, in every season and at every hour', () => {
    for (const loc of ['pond', 'river', 'ocean', 'lake'] as FishLocationId[]) {
      for (const season of ['spring', 'summer', 'autumn', 'winter'] as SeasonId[]) {
        for (let hour = 0; hour < 24; hour += 0.5) {
          const fish = catchTable(GAME_DATA, { location: loc, season, hour, mode: 'active', luck: 0 }).filter(
            (o) => o.id in FISH,
          );
          expect(
            fish.some((o) => FISH[o.id as keyof typeof FISH].rarity === 'common'),
            `${loc} ${season} ${hour}`,
          ).toBe(true);
        }
      }
    }
  });

  it('every fish and junk item is a sellable item with a sprite', () => {
    for (const id of [...FISH_IDS, ...JUNK_IDS]) {
      const def = ITEMS[id];
      expect(def.sellable).toBe(true);
      expect(def.category).toBe(id in FISH ? 'fish' : 'junk');
      expect(def.basePrice).toBe(
        id in FISH ? FISH[id as keyof typeof FISH].basePrice : JUNK[id as keyof typeof JUNK].basePrice,
      );
      expect(GAME_DATA.items[id]).toBe(def);
    }
  });
});

describe('time windows', () => {
  it('handles plain windows, all-day windows and windows that wrap past midnight', () => {
    expect(inHourWindow(12, { start: 0, end: 24 })).toBe(true);
    expect(inHourWindow(0, { start: 0, end: 24 })).toBe(true);
    expect(inHourWindow(23.99, { start: 0, end: 24 })).toBe(true);
    expect(inHourWindow(8, FISH.koi.hours)).toBe(true);
    expect(inHourWindow(17.99, FISH.koi.hours)).toBe(true);
    expect(inHourWindow(18, FISH.koi.hours)).toBe(false);
    expect(inHourWindow(7.99, FISH.koi.hours)).toBe(false);
  });

  it("Moonfin's 16:00–10:00 wraps past midnight", () => {
    const w = FISH.moonfin.hours;
    for (const h of [16, 17.5, 23, 0, 3, 9.99]) expect(inHourWindow(h, w), String(h)).toBe(true);
    for (const h of [10, 12, 15.99]) expect(inHourWindow(h, w), String(h)).toBe(false);
    expect(inHourWindow(19, FISH.catfish.hours)).toBe(true); // 18–8
    expect(inHourWindow(7, FISH.catfish.hours)).toBe(true);
    expect(inHourWindow(12, FISH.catfish.hours)).toBe(false);
  });
});

describe('catch table', () => {
  const ids = (t: { id: string }[]) => t.map((o) => o.id).sort();
  const weights = (t: { id: string; weight: number }[]) => Object.fromEntries(t.map((o) => [o.id, o.weight]));

  it('filters by location, season and local time: the worked example from BALANCE.md', () => {
    const t = catchTable(GAME_DATA, {
      location: 'pond',
      season: 'summer',
      hour: 12,
      mode: 'active',
      luck: 0,
    });
    expect(weights(t)).toEqual({ bluegill: 60, carp: 60, koi: 8, seaweed: 10, old_boot: 10 });
    const total = t.reduce((n, o) => n + o.weight, 0);
    expect(t.find((o) => o.id === 'bluegill')!.weight / total).toBeCloseTo(0.405, 3);
    expect(t.find((o) => o.id === 'koi')!.weight / total).toBeCloseTo(0.054, 3);
  });

  it('follows the hour: catfish bite in the evening and koi in the daytime', () => {
    const at = (hour: number) =>
      ids(catchTable(GAME_DATA, { location: 'pond', season: 'summer', hour, mode: 'active', luck: 0 }));
    expect(at(20)).toEqual(['bluegill', 'carp', 'catfish', 'old_boot', 'seaweed']);
    expect(at(3)).toEqual(['bluegill', 'carp', 'catfish', 'old_boot', 'seaweed']);
    expect(at(12)).toEqual(['bluegill', 'carp', 'koi', 'old_boot', 'seaweed']);
  });

  it('follows the season and the location', () => {
    const pond = (season: SeasonId) =>
      ids(catchTable(GAME_DATA, { location: 'pond', season, hour: 12, mode: 'active', luck: 0 }));
    expect(pond('spring')).toContain('petal_koi');
    expect(pond('summer')).not.toContain('petal_koi');
    expect(pond('winter')).toEqual(['bluegill', 'old_boot', 'seaweed']);
    const river = ids(
      catchTable(GAME_DATA, { location: 'river', season: 'autumn', hour: 12, mode: 'active', luck: 0 }),
    );
    expect(river).toEqual(['driftwood', 'ember_salmon', 'old_boot', 'perch', 'salmon', 'trout']);
    const ocean = ids(
      catchTable(GAME_DATA, { location: 'ocean', season: 'summer', hour: 12, mode: 'active', luck: 0 }),
    );
    expect(ocean).toEqual([
      'driftwood',
      'mackerel',
      'old_boot',
      'pufferfish',
      'sardine',
      'seaweed',
      'sun_marlin',
      'tuna',
    ]);
  });

  it('lets Moonfin bite across midnight, in winter, in the ocean only', () => {
    const q = (hour: number, season: SeasonId = 'winter') =>
      ids(catchTable(GAME_DATA, { location: 'ocean', season, hour, mode: 'active', luck: 0 }));
    for (const h of [16, 22, 2, 9.5]) expect(q(h), String(h)).toContain('moonfin');
    for (const h of [10, 12, 15.5]) expect(q(h), String(h)).not.toContain('moonfin');
    expect(q(22, 'summer')).not.toContain('moonfin');
  });

  it('traps ignore the time of day but respect the season, and only draw trappable fish and junk', () => {
    const spring = (hour: number) =>
      ids(catchTable(GAME_DATA, { location: 'pond', season: 'spring', hour, mode: 'trap', luck: 0 }));
    expect(spring(12)).toEqual(['bluegill', 'carp', 'catfish', 'old_boot', 'seaweed']); // catfish at noon, no koi or petal koi
    expect(spring(12)).toEqual(spring(3));
    const winterOcean = ids(
      catchTable(GAME_DATA, { location: 'ocean', season: 'winter', hour: 12, mode: 'trap', luck: 0 }),
    );
    expect(winterOcean).toEqual(['driftwood', 'old_boot', 'sardine', 'seaweed', 'tuna']); // never Moonfin
    const t = catchTable(GAME_DATA, { location: 'pond', season: 'spring', hour: 12, mode: 'trap', luck: 0 });
    expect(t.find((o) => o.id === 'seaweed')!.weight).toBe(25); // JUNK_WEIGHT.trap
  });

  it('luck moves weight from common to rarer fish (the luck seam)', () => {
    const q = (luck: number) =>
      weights(catchTable(GAME_DATA, { location: 'pond', season: 'summer', hour: 12, mode: 'active', luck }));
    expect(q(0).bluegill).toBe(60);
    expect(q(1).bluegill).toBeCloseTo(42, 10);
    expect(q(1).koi).toBeCloseTo(20, 10);
    const share = (luck: number) => {
      const t = q(luck);
      return t.koi! / Object.values(t).reduce((a, b) => a + b, 0);
    };
    expect(share(1)).toBeGreaterThan(share(0) * 2.5); // "roughly three times as likely"
    expect(q(-10).bluegill).toBeCloseTo(60 * 4, 10); // luck < 0 raises commons (1 + 10 × 0.3)
    expect(q(10).bluegill).toBeCloseTo(60 * 0.3, 10); // …and the floor keeps weights positive
  });

  it('a strong cast gives uncommon and better fish ×1.15 (active fishing only)', () => {
    const q = (castPower: number, mode: 'active' | 'trap' = 'active') =>
      weights(
        catchTable(GAME_DATA, { location: 'pond', season: 'summer', hour: 20, mode, luck: 0, castPower }),
      );
    expect(q(0.79).catfish).toBe(25);
    expect(q(0.8).catfish).toBeCloseTo(25 * 1.15, 10);
    expect(q(1).bluegill).toBe(60);
    expect(q(1).seaweed).toBe(10);
    expect(q(1, 'trap').catfish).toBe(25);
  });

  it('draws by weight from a fixed seed: deterministic, and close to the expected shares', () => {
    const table = catchTable(GAME_DATA, {
      location: 'pond',
      season: 'summer',
      hour: 12,
      mode: 'active',
      luck: 0,
    });
    const draw = (seed: number, n: number) => {
      const rng = createRng({ rngState: seed });
      return Array.from({ length: n }, () => pickWeighted(rng, table).id);
    };
    expect(draw(7, 50)).toEqual(draw(7, 50));
    expect(draw(7, 50)).not.toEqual(draw(8, 50));
    const n = 20000;
    const counts = new Map<string, number>();
    for (const id of draw(42, n)) counts.set(id, (counts.get(id) ?? 0) + 1);
    const total = 60 + 60 + 8 + 10 + 10;
    for (const [id, w] of [
      ['bluegill', 60],
      ['carp', 60],
      ['koi', 8],
      ['seaweed', 10],
      ['old_boot', 10],
    ] as const) {
      expect((counts.get(id) ?? 0) / n, id).toBeCloseTo(w / total, 1);
      expect(Math.abs((counts.get(id) ?? 0) / n - w / total), id).toBeLessThan(0.012);
    }
  });

  it('rolls sizes inside the fish range, with big ones rarer, and no size for junk', () => {
    const rng = createRng({ rngState: 5 });
    const sizes = Array.from({ length: 4000 }, () => rollSize(rng, GAME_DATA, 'koi'));
    for (const s of sizes) {
      expect(s).toBeGreaterThanOrEqual(30);
      expect(s).toBeLessThanOrEqual(60);
    }
    const mean = sizes.reduce((a, b) => a + b, 0) / sizes.length;
    expect(mean).toBeCloseTo(30 + 30 * 0.4, 0); // E[u^1.5] = 0.4
    expect(rollSize(rng, GAME_DATA, 'old_boot')).toBe(0);
  });
});

describe('the reel minigame: pure physics', () => {
  const reelAt = (over: Partial<ReelState> = {}): ReelState => ({
    marker: 0.5,
    zoneCenter: 0.5,
    zoneVel: 0,
    zoneWidth: 0.3,
    zoneSpeed: 0.3,
    retargetMs: 1_000_000,
    drainPerSec: REEL.drainPerSec,
    meter: 0.5,
    ...over,
  });
  /** A session reeling `reel` at the pond, ready for `stepFishing`. */
  function reeling(reel: ReelState, s = farm()): GameState {
    s.fishing.session = {
      location: 'pond',
      phase: 'reeling',
      power: 0.5,
      fish: 'bluegill',
      sizeCm: 20,
      waitMs: 0,
      reel,
    };
    return s;
  }

  it('computes the zone from difficulty, rod and Relaxed fishing (BALANCE.md §6)', () => {
    expect(reelParams(0, 1, false)).toEqual({ zoneWidth: 0.35, zoneSpeed: 0.15, drainPerSec: 0.15 });
    const p = reelParams(50, 1, false);
    expect(p.zoneWidth).toBeCloseTo(0.25, 10);
    expect(p.zoneSpeed).toBeCloseTo(0.4, 10);
    expect(reelParams(100, 1, false).zoneWidth).toBeCloseTo(0.15, 10);
    expect(reelParams(100, 1, false).zoneSpeed).toBeCloseTo(0.65, 10);
    expect(reelParams(50, 1.35, false).zoneWidth).toBeCloseTo(0.25 * 1.35, 10); // Iridium rod
  });

  it('Relaxed fishing widens the zone, slows it and halves the drain', () => {
    const normal = reelParams(60, 1, false);
    const relaxed = reelParams(60, 1, true);
    expect(relaxed.zoneWidth).toBeCloseTo(normal.zoneWidth * 1.5, 10);
    expect(relaxed.zoneSpeed).toBeCloseTo(normal.zoneSpeed * 0.6, 10);
    expect(relaxed.drainPerSec).toBe(0.075);
    expect(normal.drainPerSec).toBe(0.15);
  });

  it('starts a reel from the fish, the rod and the setting', () => {
    const s = farm();
    const ctx = ctxAt(s);
    const base = startReel(s, ctx, 'koi');
    expect(base.zoneWidth).toBeCloseTo(0.35 - 0.2 * 0.65, 10);
    expect(base.meter).toBe(0.3);
    expect(base.marker).toBe(0.5);
    s.settings.relaxedFishing = true;
    const relaxed = startReel(s, ctx, 'koi');
    expect(relaxed.zoneWidth).toBeCloseTo(base.zoneWidth * 1.5, 10);
    expect(relaxed.drainPerSec).toBe(0.075);
    s.settings.relaxedFishing = false;
    s.upgrades.fishing_rod = 3;
    expect(startReel(s, ctx, 'koi').zoneWidth).toBeCloseTo(base.zoneWidth * 1.35, 10);
  });

  it('fills the meter at 0.35 a second inside the zone and drains 0.15 a second outside', () => {
    const s = reeling(reelAt({ meter: 0.4 }));
    stepFishing(s, ctxAt(s), true, 0); // no time, no change
    expect(s.fishing.session!.reel!.meter).toBe(0.4);
    // The marker rises while held, so hold and release alternately to stay near the middle.
    const r = s.fishing.session!.reel!;
    expect(markerInZone(r)).toBe(true);
    stepFishing(s, ctxAt(s), true, 100); // the marker rises to 0.6, still inside 0.35–0.65
    expect(s.fishing.session!.reel!.meter).toBeCloseTo(0.4 + 0.35 * 0.1, 6);
    const out = reeling(reelAt({ meter: 0.5, marker: 0.05, zoneCenter: 0.8 }));
    stepFishing(out, ctxAt(out), false, 200);
    expect(out.fishing.session!.reel!.meter).toBeCloseTo(0.5 - 0.15 * 0.2, 6);
    const slow = reeling(reelAt({ meter: 0.5, marker: 0.05, zoneCenter: 0.8, drainPerSec: 0.075 }));
    stepFishing(slow, ctxAt(slow), false, 200);
    expect(slow.fishing.session!.reel!.meter).toBeCloseTo(0.5 - 0.075 * 0.2, 6);
  });

  it('moves the marker up while held and down when released, within the bar', () => {
    const s = reeling(reelAt({ marker: 0.5, meter: 0.5 }));
    stepFishing(s, ctxAt(s), true, 100);
    expect(s.fishing.session!.reel!.marker).toBeCloseTo(0.5 + REEL.markerUpPerSec * 0.1, 6);
    stepFishing(s, ctxAt(s), false, 100);
    expect(s.fishing.session!.reel!.marker).toBeCloseTo(0.5 + 0.1 - REEL.markerDownPerSec * 0.1, 6);
    stepFishing(s, ctxAt(s), true, 5000);
    expect(s.fishing.session === null || s.fishing.session.reel!.marker <= 1).toBe(true);
    const low = reeling(reelAt({ marker: 0.02, zoneCenter: 0.9, meter: 0.9 }));
    stepFishing(low, ctxAt(low), false, 500);
    expect(low.fishing.session!.reel!.marker).toBe(0);
  });

  it('keeps the zone inside the bar, bouncing off both ends', () => {
    const s = reeling(reelAt({ zoneCenter: 0.6, zoneVel: 0.6, retargetMs: 1_000_000, meter: 0.99 }));
    // Keep the meter from ending the reel and hold the marker on the zone.
    let up = false;
    let down = false;
    for (let i = 0; i < 200; i++) {
      const r = s.fishing.session!.reel!;
      r.meter = 0.5;
      stepFishing(s, ctxAt(s), r.marker < r.zoneCenter, 20);
      const now = s.fishing.session!.reel!;
      expect(now.zoneCenter - now.zoneWidth / 2).toBeGreaterThanOrEqual(-1e-9);
      expect(now.zoneCenter + now.zoneWidth / 2).toBeLessThanOrEqual(1 + 1e-9);
      if (now.zoneVel > 0) up = true;
      if (now.zoneVel < 0) down = true;
    }
    expect(up && down).toBe(true); // it went right, bounced off the end, and came back
  });

  it('a full meter lands the fish and an empty one lets it go, with nothing else lost', () => {
    const win = reeling(reelAt({ meter: 0.99 }));
    const events: GameEvent[] = [];
    stepFishing(win, ctxAt(win, NOON, events), true, 100);
    expect(win.fishing.session).toBeNull();
    expect(countItem(win.inventory, 'bluegill')).toBe(1);
    expect(events.map((e) => e.type)).toEqual(['caught']);
    expect(events[0]).toMatchObject({
      type: 'caught',
      catch: 'bluegill',
      sizeCm: 20,
      location: 'pond',
      viaTrap: false,
    });
    expect(win.stats.fishCaught).toBe(1);

    const lose = reeling(reelAt({ meter: 0.01, marker: 0, zoneCenter: 0.9 }));
    const lost: GameEvent[] = [];
    stepFishing(lose, ctxAt(lose, NOON, lost), false, 100);
    expect(lose.fishing.session).toBeNull();
    expect(countItem(lose.inventory, 'bluegill')).toBe(0);
    expect(lost).toEqual([{ type: 'escaped', location: 'pond' }]);
    expect(lose.stats.fishCaught).toBe(0);
  });

  it('a scripted input sequence gives a deterministic catch, and another a deterministic escape', () => {
    const play = (policy: (r: ReelState) => boolean) => {
      const s = farm(11);
      s.fishing.session = {
        location: 'pond',
        phase: 'bite',
        power: 1,
        fish: 'koi',
        sizeCm: 40,
        waitMs: BITE_WINDOW_MS,
        reel: null,
      };
      const events: GameEvent[] = [];
      const ctx = ctxAt(s, NOON, events);
      let ms = 0;
      // Press to start reeling, then follow the policy in 16 ms frames.
      stepFishing(s, ctx, true, 16);
      while (s.fishing.session && ms < 120_000) {
        stepFishing(s, ctx, policy(s.fishing.session.reel!), 16);
        ms += 16;
      }
      return { ms, events, state: s };
    };
    const perfect = (r: ReelState) => r.marker < r.zoneCenter;
    const never = () => false;
    const a = play(perfect);
    const b = play(perfect);
    expect(a.events.map((e) => e.type)).toEqual(['caught']);
    expect(a.ms).toBeGreaterThan(1000); // 0.3 → 1.0 at 0.35 a second is at least 2 s
    expect(a.ms).toBeLessThan(15_000);
    expect(b.ms).toBe(a.ms);
    expect(b.state.fishing).toEqual(a.state.fishing);
    expect(b.state.rngState).toBe(a.state.rngState);
    const lost = play(never);
    expect(lost.events).toEqual([{ type: 'escaped', location: 'pond' }]);
    expect(lost.ms).toBeLessThan(15_000);
  });

  it('a slow frame gives the same catch as many short ones, roughly (the physics slices long steps)', () => {
    const s = reeling(reelAt({ meter: 0.5 }));
    stepFishing(s, ctxAt(s), true, 400); // one call
    const t = reeling(reelAt({ meter: 0.5 }));
    for (let i = 0; i < 10; i++) stepFishing(t, ctxAt(t), true, 40);
    expect(s.fishing.session!.reel!.marker).toBeCloseTo(t.fishing.session!.reel!.marker, 6);
    expect(s.fishing.session!.reel!.meter).toBeCloseTo(t.fishing.session!.reel!.meter, 6);
  });
});

describe('casting, biting and the session', () => {
  it('charges while held, and releasing casts and starts the wait', () => {
    const s = farm(3);
    const ctx = ctxAt(s);
    expect(ctx.data).toBe(GAME_DATA);
    const g = new Game(s, { data: GAME_DATA, lc: NY, now: () => NOON });
    expect(g.dispatch({ type: 'fishStart', location: 'pond' })).toEqual({ ok: true });
    expect(s.fishing.session).toMatchObject({ phase: 'charging', power: 0, location: 'pond' });
    g.dispatch({ type: 'fishTick', holding: true, dtMs: CAST_CHARGE_MS / 2 });
    expect(s.fishing.session!.power).toBeCloseTo(0.5, 10);
    g.dispatch({ type: 'fishTick', holding: true, dtMs: CAST_CHARGE_MS * 3 });
    expect(s.fishing.session!.power).toBe(1); // clamps
    g.dispatch({ type: 'fishTick', holding: false, dtMs: 16 });
    expect(s.fishing.session!.phase).toBe('waiting');
    expect(s.fishing.session!.waitMs).toBeGreaterThanOrEqual(BITE_WAIT_MIN_MS);
    expect(s.fishing.session!.waitMs).toBeLessThanOrEqual(BITE_WAIT_MAX_MS);
  });

  it('waits 3 to 10 seconds, then bites with a "!" event and a window to react', () => {
    const s = farm(4);
    const events: GameEvent[] = [];
    const ctx = ctxAt(s, NOON, events);
    s.fishing.session = {
      location: 'pond',
      phase: 'charging',
      power: 0.9,
      fish: null,
      sizeCm: 0,
      waitMs: 0,
      reel: null,
    };
    stepFishing(s, ctx, false, 0);
    const wait = s.fishing.session!.waitMs;
    stepFishing(s, ctx, false, wait - 1);
    expect(s.fishing.session!.phase).toBe('waiting');
    expect(events).toEqual([]);
    stepFishing(s, ctx, false, 1);
    expect(s.fishing.session!.phase).toBe('bite');
    expect(events).toEqual([{ type: 'bite', location: 'pond' }]);
    expect(s.fishing.session!.fish).not.toBeNull();
    expect(s.fishing.session!.waitMs).toBe(BITE_WINDOW_MS);
  });

  it('the bite wait passes through fishingSpeedModifier (the speed seam)', () => {
    const wait = (speed: number) => {
      const s = farm(9);
      const ctx = ctxAt(s);
      ctx.mods = { ...NO_MODIFIERS, fishingSpeedModifier: speed };
      s.fishing.session = {
        location: 'pond',
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
    const base = wait(1);
    expect(wait(2)).toBeCloseTo(base / 2, -1);
    expect(wait(1.5)).toBeCloseTo(base / 1.5, -1);
    expect(wait(2)).toBeLessThan(base);
  });

  it('a bite left alone gets away after the window; a press starts the reel', () => {
    const idle = farm(5);
    idle.fishing.session = {
      location: 'pond',
      phase: 'bite',
      power: 0,
      fish: 'bluegill',
      sizeCm: 12,
      waitMs: BITE_WINDOW_MS,
      reel: null,
    };
    const events: GameEvent[] = [];
    stepFishing(idle, ctxAt(idle, NOON, events), false, BITE_WINDOW_MS - 1);
    expect(idle.fishing.session!.phase).toBe('bite');
    stepFishing(idle, ctxAt(idle, NOON, events), false, 1);
    expect(idle.fishing.session).toBeNull();
    expect(events).toEqual([{ type: 'escaped', location: 'pond' }]);

    const press = farm(5);
    press.fishing.session = {
      location: 'pond',
      phase: 'bite',
      power: 0,
      fish: 'bluegill',
      sizeCm: 12,
      waitMs: 1000,
      reel: null,
    };
    stepFishing(press, ctxAt(press), true, 16);
    expect(press.fishing.session!.phase).toBe('reeling');
    expect(press.fishing.session!.reel!.meter).toBeGreaterThan(0.29);
  });

  it('catches what the table allows at that place, season and time', () => {
    const s = farm(21);
    const ctx = ctxAt(s, at(NY, 2026, 1, 7, 12));
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) seen.add(chooseCatch(s, ctx, 'pond', 'active', 0.2).id);
    expect([...seen].sort()).toEqual(['bluegill', 'carp', 'koi', 'old_boot', 'petal_koi', 'seaweed']);
    expect(seen.has('catfish')).toBe(false); // bites 18:00–08:00
  });

  it('one line at a time, and only at open water', () => {
    const s = farm();
    const g = new Game(s, { data: GAME_DATA, lc: NY, now: () => NOON });
    expect(g.dispatch({ type: 'fishStart', location: 'river' }).ok).toBe(false);
    expect(g.dispatch({ type: 'fishStart', location: 'pond' }).ok).toBe(true);
    expect(g.dispatch({ type: 'fishStart', location: 'pond' }).ok).toBe(false);
    expect(g.dispatch({ type: 'fishCancel' }).ok).toBe(true);
    expect(s.fishing.session).toBeNull();
    expect(g.dispatch({ type: 'fishTick', holding: true, dtMs: 16 }).ok).toBe(true); // no session: nothing happens
    expect(g.dispatch({ type: 'fishTick', holding: true, dtMs: -1 }).ok).toBe(false);
  });

  it('is saved mid-minigame and continues after a reload', () => {
    const s = farm(6);
    s.fishing.session = {
      location: 'pond',
      phase: 'bite',
      power: 0.7,
      fish: 'carp',
      sizeCm: 41.5,
      waitMs: 2500,
      reel: null,
    };
    const ctx = ctxAt(s);
    stepFishing(s, ctx, true, 400);
    expect(s.fishing.session!.phase).toBe('reeling');
    const copy = JSON.parse(JSON.stringify(s)) as GameState;
    expect(validateState(copy)).toBeNull();
    stepFishing(copy, ctxAt(copy), true, 200);
    stepFishing(s, ctxAt(s), true, 200);
    expect(copy.fishing).toEqual(s.fishing);
  });

  it('a bag that is full sends the catch to the Shipping Bin instead of losing it', () => {
    const s = farm(2);
    for (let i = 0; i < s.inventory.slots.length; i++) s.inventory.slots[i] = { item: 'turnip', qty: 99 };
    s.fishing.session = {
      location: 'pond',
      phase: 'reeling',
      power: 0,
      fish: 'bluegill',
      sizeCm: 15,
      waitMs: 0,
      reel: {
        marker: 0.5,
        zoneCenter: 0.5,
        zoneVel: 0,
        zoneWidth: 0.3,
        zoneSpeed: 0.3,
        retargetMs: 1e6,
        drainPerSec: 0.15,
        meter: 0.99,
      },
    };
    const events: GameEvent[] = [];
    stepFishing(s, ctxAt(s, NOON, events), true, 100);
    expect(s.shippingBin.items).toEqual([{ item: 'bluegill', qty: 1 }]);
    expect(events.map((e) => e.type)).toEqual(['caught', 'inventoryFull']);
  });
});

describe('the Fish Collection', () => {
  function land(s: GameState, fish: 'koi' | 'old_boot' | 'bluegill', size: number, t = NOON): void {
    s.fishing.session = {
      location: 'pond',
      phase: 'reeling',
      power: 0,
      fish,
      sizeCm: size,
      waitMs: 0,
      reel: {
        marker: 0.5,
        zoneCenter: 0.5,
        zoneVel: 0,
        zoneWidth: 0.3,
        zoneSpeed: 0.3,
        retargetMs: 1e6,
        drainPerSec: 0.15,
        meter: 0.99,
      },
    };
    stepFishing(s, ctxAt(s, t), true, 100);
  }

  it('records the first-catch day, the biggest size and the count', () => {
    const s = farm(1);
    land(s, 'koi', 41.5);
    expect(s.fishing.collection.koi).toEqual({ firstCaughtAt: '2026-01-07', bestSizeCm: 41.5, count: 1 });
    land(s, 'koi', 38, at(NY, 2026, 1, 9, 12));
    land(s, 'koi', 55.2, at(NY, 2026, 1, 9, 12));
    expect(s.fishing.collection.koi).toEqual({ firstCaughtAt: '2026-01-07', bestSizeCm: 55.2, count: 3 });
    expect(s.stats.fishCaught).toBe(3);
  });

  it('does not log junk as a fish', () => {
    const s = farm(1);
    land(s, 'old_boot', 0);
    expect(s.fishing.collection).toEqual({});
    expect(s.stats.fishCaught).toBe(0);
    expect(countItem(s.inventory, 'old_boot')).toBe(1);
  });
});

describe('locations and the rod', () => {
  function rich(fl: number): GameState {
    const s = farm();
    setFarmLevel(s, fl);
    s.gold = 100_000;
    return s;
  }

  it('opens the pond from the start, and the river and the ocean with expansions', () => {
    const s = rich(3);
    expect(unlockedLocations(s)).toEqual(['pond']);
    const ctx = ctxAt(s);
    const events: GameEvent[] = [];
    ctx.events = events;
    expect(buyExpansion(s, ctx, 'ocean').ok).toBe(false); // needs the river first
    expect(buyExpansion(s, ctx, 'river')).toEqual({ ok: true });
    expect(s.gold).toBe(100_000 - 2000);
    expect(events).toEqual([{ type: 'purchased', what: 'river', gold: 2000 }]);
    expect(unlockedLocations(s)).toEqual(['pond', 'river']);
    expect(buyExpansion(s, ctx, 'river').ok).toBe(false); // already open
    expect(buyExpansion(s, ctx, 'ocean').ok).toBe(false); // needs Farm Level 6
    setFarmLevel(s, 6);
    expect(buyExpansion(s, ctx, 'ocean')).toEqual({ ok: true });
    expect(s.gold).toBe(100_000 - 2000 - 8000);
    expect(unlockedLocations(s)).toEqual(['pond', 'river', 'ocean']);
    expect(expansionFor(GAME_DATA, 'river')!.id).toBe('river');
    expect(expansionFor(GAME_DATA, 'pond')).toBeNull();
  });

  it('the river needs Farm Level 3 and the gold', () => {
    const low = rich(2);
    expect(buyExpansion(low, ctxAt(low), 'river').ok).toBe(false);
    const poor = rich(3);
    poor.gold = 1999;
    expect(buyExpansion(poor, ctxAt(poor), 'river')).toEqual({
      ok: false,
      reason: 'You need 2,000g for that.',
    });
    expect(poor.gold).toBe(1999);
  });

  it('you can fish a location once it is open', () => {
    const s = rich(3);
    const g = new Game(s, { data: GAME_DATA, lc: NY, now: () => NOON });
    expect(g.dispatch({ type: 'fishStart', location: 'river' }).ok).toBe(false);
    g.dispatch({ type: 'buyExpansion', id: 'river' });
    expect(g.dispatch({ type: 'fishStart', location: 'river' }).ok).toBe(true);
  });

  it('starts with the Old rod and buys Bamboo, Fiberglass and Iridium for 300, 2,400 and 19,000', () => {
    expect([0, 1, 2].map((l) => upgradeCost(GAME_DATA.upgrades.fishing_rod!, l))).toEqual([300, 2400, 19000]);
    const s = rich(6);
    const ctx = ctxAt(s);
    expect(computeModifiers(s, GAME_DATA).fishingLuckModifier).toBe(0);
    expect(buyUpgrade(s, ctx, 'fishing_rod').ok).toBe(true);
    expect(buyUpgrade(s, ctx, 'fishing_rod').ok).toBe(true);
    expect(computeModifiers(s, GAME_DATA).fishingLuckModifier).toBeCloseTo(0.15, 10);
    expect(buyUpgrade(s, ctx, 'fishing_rod').ok).toBe(false); // Iridium needs the ocean
    own(s, {}, ['river', 'ocean']);
    expect(buyUpgrade(s, ctx, 'fishing_rod').ok).toBe(true);
    expect(computeModifiers(s, GAME_DATA).fishingLuckModifier).toBeCloseTo(0.3, 10);
    expect([0, 1, 2, 3].map((l) => GAME_DATA.upgrades.fishing_rod!.effect[l]!.reelZoneMult)).toEqual([
      1, 1.1, 1.2, 1.35,
    ]);
  });

  it('a better rod widens the zone and improves the odds a little', () => {
    const s = rich(6);
    const ctx = ctxAt(s);
    const w0 = startReel(s, ctx, 'trout').zoneWidth;
    s.upgrades.fishing_rod = 2;
    expect(startReel(s, ctx, 'trout').zoneWidth).toBeCloseTo(w0 * 1.2, 10);
    const luck = computeModifiers(s, GAME_DATA).fishingLuckModifier;
    const t = (l: number) =>
      catchTable(GAME_DATA, { location: 'pond', season: 'summer', hour: 12, mode: 'active', luck: l });
    const share = (l: number) =>
      t(l).find((o) => o.id === 'koi')!.weight / t(l).reduce((n, o) => n + o.weight, 0);
    expect(share(luck)).toBeGreaterThan(share(0));
  });
});

describe('fish traps', () => {
  function trapFarm(seed = 1): GameState {
    const s = farm(seed);
    own(s, { fish_trap: 1 });
    addTrap(s, GAME_DATA);
    return s;
  }

  it('costs 500, 750, 1,100, 1,700, 2,500 and 3,800 and sets out two traps per open water', () => {
    expect([0, 1, 2, 3, 4, 5].map((n) => upgradeCost(GAME_DATA.upgrades.fish_trap!, n))).toEqual([
      500, 750, 1100, 1700, 2500, 3800,
    ]);
    const s = farm();
    s.gold = 100_000;
    const ctx = ctxAt(s);
    expect(maxTraps(s, GAME_DATA)).toBe(2);
    expect(buyUpgrade(s, ctx, 'fish_trap').ok).toBe(true);
    expect(buyUpgrade(s, ctx, 'fish_trap').ok).toBe(true);
    expect(s.fishing.traps.map((t) => [t.location, t.slot])).toEqual([
      ['pond', 0],
      ['pond', 1],
    ]);
    const third = buyUpgrade(s, ctx, 'fish_trap');
    expect(third.ok).toBe(false);
    expect(s.upgrades.fish_trap).toBe(2);
    expect(s.gold).toBe(100_000 - 500 - 750);
    own(s, {}, ['river']);
    expect(maxTraps(s, GAME_DATA)).toBe(4);
    expect(buyUpgrade(s, ctx, 'fish_trap').ok).toBe(true);
    expect(buyUpgrade(s, ctx, 'fish_trap').ok).toBe(true);
    expect(s.fishing.traps.map((t) => [t.location, t.slot]).slice(2)).toEqual([
      ['river', 0],
      ['river', 1],
    ]);
    own(s, {}, ['ocean']);
    expect(buyUpgrade(s, ctx, 'fish_trap').ok).toBe(true);
    expect(buyUpgrade(s, ctx, 'fish_trap').ok).toBe(true);
    expect(buyUpgrade(s, ctx, 'fish_trap').ok).toBe(false); // the maximum of 6
    expect(nextTrapSpot(s, GAME_DATA)).toBeNull();
    expect(new Set(s.fishing.traps.map((t) => t.id)).size).toBe(6);
  });

  it('the Trap Collector needs two traps', () => {
    const s = farm();
    s.gold = 100_000;
    const ctx = ctxAt(s);
    expect(buyUpgrade(s, ctx, 'trap_collector').ok).toBe(false);
    buyUpgrade(s, ctx, 'fish_trap');
    expect(buyUpgrade(s, ctx, 'trap_collector').ok).toBe(false);
    buyUpgrade(s, ctx, 'fish_trap');
    expect(buyUpgrade(s, ctx, 'trap_collector')).toEqual({ ok: true });
    expect(s.gold).toBe(100_000 - 500 - 750 - 4000);
  });

  it('rolls one catch every 3 minutes of simulated time', () => {
    const s = trapFarm();
    const events: GameEvent[] = [];
    const ctx = ctxAt(s, NOON, events);
    tickTraps(s, ctx, TRAP_INTERVAL_MS - 1);
    expect(trapItemCount(s.fishing.traps[0]!)).toBe(0);
    expect(events).toEqual([]);
    tickTraps(s, ctx, 1);
    expect(trapItemCount(s.fishing.traps[0]!)).toBe(1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'caught', viaTrap: true, location: 'pond' });
    expect(s.fishing.traps[0]!.progressMs).toBe(0);
    expect(TRAP_INTERVAL_SEC).toBe(180);
  });

  it('holds 5 items, then waits at the threshold and rolls again as soon as it is emptied', () => {
    const s = trapFarm(3);
    const ctx = ctxAt(s);
    tickTraps(s, ctx, 60 * MIN);
    const trap = s.fishing.traps[0]!;
    expect(trapItemCount(trap)).toBe(TRAP_CAPACITY);
    expect(trap.progressMs).toBe(TRAP_INTERVAL_MS);
    tickTraps(s, ctx, 5 * MIN);
    expect(trapItemCount(trap)).toBe(5);
    expect(collectTrap(s, ctx, trap.id)).toEqual({ ok: true });
    expect(trapItemCount(trap)).toBe(0);
    tickTraps(s, ctx, 1);
    expect(trapItemCount(trap)).toBe(1); // rolls again at once
  });

  it('gives the same result for one large step and many small ones (up to capacity)', () => {
    const run = (chunk: number) => {
      const s = farm(8);
      own(s, { fish_trap: 2 });
      addTrap(s, GAME_DATA);
      addTrap(s, GAME_DATA);
      const ctx = ctxAt(s);
      const total = 14 * MIN; // 4 rolls per trap and 2 minutes of progress
      for (let t = 0; t < total; t += chunk) tickTraps(s, ctx, Math.min(chunk, total - t));
      return s;
    };
    const big = run(14 * MIN);
    const small = run(100);
    for (const s of [big, small]) {
      expect(s.fishing.traps.map(trapItemCount)).toEqual([4, 4]);
      expect(s.fishing.traps.map((t) => t.progressMs)).toEqual([2 * MIN, 2 * MIN]);
    }
    expect(big.fishing.traps.map((t) => t.contents.reduce((n, c) => n + c.qty, 0))).toEqual(
      small.fishing.traps.map((t) => t.contents.reduce((n, c) => n + c.qty, 0)),
    );
  });

  it('works through the real step and offline walk, and an 8-hour absence fills it to capacity', () => {
    const s = trapFarm(4);
    const t0 = at(NY, 2026, 1, 7, 12);
    s.calendar.lastDayKey = '2026-01-07';
    const events: GameEvent[] = [];
    step(s, ctxAt(s, t0, events), 30 * MIN);
    expect(trapItemCount(s.fishing.traps[0]!)).toBe(5);
    const s2 = trapFarm(4);
    const report = runOffline(s2, GAME_DATA, NY, t0, t0 + 8 * HOUR);
    expect(trapItemCount(s2.fishing.traps[0]!)).toBe(5);
    expect(report.events.filter((e) => e.type === 'caught')).toHaveLength(5);
  });

  it('ignores the hour: a catfish (18:00–08:00) can be trapped at noon, a koi never', () => {
    const s = trapFarm(13);
    const ctx = ctxAt(s, NOON);
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) {
      s.fishing.traps[0]!.contents = [];
      tickTraps(s, ctx, TRAP_INTERVAL_MS);
      for (const c of s.fishing.traps[0]!.contents) seen.add(c.item);
    }
    expect(seen.has('catfish')).toBe(true);
    expect(seen.has('koi')).toBe(false);
    expect(seen.has('petal_koi')).toBe(false);
    expect([...seen].every((i) => ['bluegill', 'carp', 'catfish', 'seaweed', 'old_boot'].includes(i))).toBe(
      true,
    );
  });

  it('respects the season, and records fish it catches in the collection', () => {
    const s = trapFarm(2);
    const winter = ctxAt(s, at(NY, 2026, 1, 25, 12)); // four weeks later: winter
    expect(winter.calendar.season).toBe('winter');
    for (let i = 0; i < 100; i++) {
      s.fishing.traps[0]!.contents = [];
      tickTraps(s, winter, TRAP_INTERVAL_MS);
    }
    expect(Object.keys(s.fishing.collection)).toEqual(['bluegill']); // winter pond: bluegill only
    expect(s.fishing.collection.bluegill!.count).toBe(s.stats.fishCaught);
  });

  it('the fishing speed modifier speeds the traps up (the speed seam)', () => {
    const s = trapFarm();
    const ctx = ctxAt(s);
    ctx.mods = { ...NO_MODIFIERS, fishingSpeedModifier: 2 };
    tickTraps(s, ctx, 90 * SEC);
    expect(trapItemCount(s.fishing.traps[0]!)).toBe(1);
  });

  it('a click collects into the bag; a full bag leaves the rest in the trap', () => {
    const s = trapFarm();
    const ctx = ctxAt(s);
    const trap = s.fishing.traps[0]!;
    expect(collectTrap(s, ctx, trap.id).ok).toBe(false); // nothing yet: says it is still filling
    expect(collectTrap(s, ctx, 99).ok).toBe(false);
    trap.contents = [
      { item: 'bluegill', qty: 2 },
      { item: 'old_boot', qty: 1 },
    ];
    expect(collectTrap(s, ctx, trap.id)).toEqual({ ok: true });
    expect(countItem(s.inventory, 'bluegill')).toBe(2);
    expect(countItem(s.inventory, 'old_boot')).toBe(1);
    trap.contents = [{ item: 'carp', qty: 2 }];
    for (let i = 0; i < s.inventory.slots.length; i++) s.inventory.slots[i] ??= { item: 'turnip', qty: 99 };
    const events: GameEvent[] = [];
    ctx.events = events;
    expect(collectTrap(s, ctx, trap.id).ok).toBe(false);
    expect(trap.contents).toEqual([{ item: 'carp', qty: 2 }]);
    expect(events).toEqual([{ type: 'inventoryFull', item: 'carp' }]);
  });

  it('the Trap Collector empties every trap at each shipping-bin pickup, exactly like small steps', () => {
    const setup = () => {
      const s = farm(5);
      own(s, { fish_trap: 2, trap_collector: 1 });
      addTrap(s, GAME_DATA);
      addTrap(s, GAME_DATA);
      return s;
    };
    expect(msToNextPickup(setup())).toBeLessThan(Infinity); // the bin can now fill from the traps
    expect(msToNextPickup(farm())).toBe(Infinity);
    const total = 3 * HOUR;
    const big = setup();
    step(big, ctxAt(big), total);
    const small = setup();
    for (let t = 0; t < total; t += 10 * SEC) step(small, ctxAt(small), 10 * SEC);
    // Two traps each hand 5 things over every hour, and refill: three pickups.
    const count = (s: GameState) =>
      s.inventory.slots.reduce((n, sl) => n + (sl && !sl.item.startsWith('seed_') ? sl.qty : 0), 0);
    expect(count(big)).toBe(30);
    expect(count(small)).toBe(30);
    // Which fish land in which trap depends on the order of the random draws, the totals do not.
    expect(big.fishing.traps.map(trapItemCount)).toEqual(small.fishing.traps.map(trapItemCount));
    expect(big.fishing.traps.map((t) => t.progressMs)).toEqual(small.fishing.traps.map((t) => t.progressMs));
  });

  it('sends collected fish to the Shipping Bin when the Auto-Seller is on for them', () => {
    const s = farm(6);
    own(s, { fish_trap: 1, trap_collector: 1, auto_seller: 1 });
    addTrap(s, GAME_DATA);
    expect(setAutoSell(s, GAME_DATA, 'bluegill', true)).toEqual({ ok: true });
    s.fishing.traps[0]!.contents = [{ item: 'bluegill', qty: 3 }];
    const ctx = ctxAt(s);
    expect(collectTrap(s, ctx, s.fishing.traps[0]!.id)).toEqual({ ok: true });
    expect(s.shippingBin.items).toEqual([{ item: 'bluegill', qty: 3 }]);
    expect(countItem(s.inventory, 'bluegill')).toBe(0);
  });
});

describe('fish on the market', () => {
  it('sells like every other item: base price times demand, with the Market cut', () => {
    const s = farm();
    addItem(s.inventory, 'koi', 3);
    expect(unitPrice(s, GAME_DATA, NO_MODIFIERS, 'koi')).toBe(270); // 300 × 90% at the Market
    const ctx = ctxAt(s);
    expect(sellItems(s, ctx, 'koi', 1)).toEqual({ ok: true });
    expect(s.gold).toBe(60 + 270);
    expect(s.market.items.koi!.demand).toBeLessThan(1); // and the next one is worth a little less
    expect(sellItems(s, ctx, 'old_boot', 1).ok).toBe(false); // none in the bag
  });

  it('puts in-season fish of the open waters among the daily special candidates', () => {
    const s = farm();
    expect(specialCandidates(s, GAME_DATA, 'summer')).toEqual(expect.arrayContaining(['bluegill', 'koi']));
    expect(specialCandidates(s, GAME_DATA, 'summer')).not.toContain('sun_marlin');
    s.expansions.push('ocean' as never);
    expect(specialCandidates(s, GAME_DATA, 'summer')).toContain('sun_marlin');
    expect(specialCandidates(s, GAME_DATA, 'summer')).not.toContain('moonfin');
  });

  it('leaves fish out of auto-shipping unless the player turns it on', () => {
    const s = farm();
    own(s, { auto_seller: 1 });
    expect(s.autoSell.bluegill).toBeUndefined();
    const ctx = ctxAt(s);
    addItem(s.inventory, 'bluegill', 1);
    expect(countItem(s.inventory, 'bluegill')).toBe(1);
    expect(ctx.data.items.bluegill!.category).toBe('fish');
  });
});
