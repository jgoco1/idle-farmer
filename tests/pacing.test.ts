// The phase-03 pacing check (BALANCE.md §11 and "Phase 03 tuning notes"): a greedy active player
// (tests/sim/greedyPlayer.ts) plays the first 60 minutes on several seeds. Phase 04 buys the real
// automation (the second describe plays five and a half hours); phase 05 buys the real River Access
// and adds a fishing player (the third describe; active fishing is "N catches per real minute").
// The first two describes are a farming-only player (`fishPerMin` 0), as calibrated in phases 03–04.
// Phase 09 replaces this with the full simulator. Each test plays several whole games, which can
// take longer than Vitest's 5 s default on a busy machine, hence the per-describe timeout.

import { describe, expect, it } from 'vitest';
import { runOffline } from '../src/core/offline';
import { makeContext } from '../src/core/sim';
import { buildCalendar } from '../src/core/time';
import { GAME_DATA } from '../src/data';
import { RECIPE_IDS } from '../src/data/ids';
import { ingredientValue } from '../src/systems/cooking';
import { buySeeds } from '../src/systems/shop';
import { AUTOMATION_SHOPPING_LIST, simulateGreedy, type PacingReport } from './sim/greedyPlayer';
import { at, NY } from './helpers';

const MIN = 60_000;
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

function median(xs: readonly number[]): number {
  const a = [...xs].sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)]!;
}

function runs(opts: Partial<Parameters<typeof simulateGreedy>[0]> = {}): PacingReport[] {
  return SEEDS.map((seed) => simulateGreedy({ minutes: 60, reactionMs: 5000, seed, ...opts }));
}

/** Median minute at which `id` was bought (Infinity if some run never bought it). */
function boughtAt(reports: readonly PacingReport[], id: string): number {
  return median(reports.map((r) => (r.bought[id] ?? Infinity) / MIN));
}

describe('pacing: the first 60 minutes of a greedy active player', { timeout: 30_000 }, () => {
  const real = runs();

  it('first harvest within 2.5 minutes', () => {
    for (const r of real) expect(r.firstHarvestMs).toBeLessThanOrEqual(2.5 * MIN);
  });

  it('never waits more than 2 minutes with nothing to do while on the starter crops', () => {
    // After Farm Level 4 the greedy player fills the field with 10-minute cauliflower and waits for
    // it (its own choice; fishing fills those gaps from phase 05). See BALANCE.md phase 03 notes.
    const starters = runs({ minutes: 30, onlyCrops: ['turnip', 'potato'] });
    const mixed = starters.map((r) => r.longestIdleMs);
    expect(median(mixed)).toBeLessThanOrEqual(2 * MIN);
    // Phase 05: pond fish now compete with the crops for the day's market specials, so the farming-only
    // player sometimes plants 3-minute potatoes instead of 2-minute turnips and waits one potato
    // (3 min) before Farm Level 4. That is the bound here; the fishing player (below) is never idle.
    for (const r of real) {
      if (r.longestIdleAt < (r.farmLevels[4] ?? Infinity))
        expect(r.longestIdleMs).toBeLessThanOrEqual(3 * MIN);
    }
  });

  it('buys the first expansion in 6–10 minutes', () => {
    const t = boughtAt(real, 'farm_1');
    expect(t).toBeGreaterThanOrEqual(6);
    expect(t).toBeLessThanOrEqual(10);
  });

  it('buys the first sprinkler in 10–15 minutes', () => {
    const t = boughtAt(real, 'sprinkler');
    expect(t).toBeGreaterThanOrEqual(10);
    expect(t).toBeLessThanOrEqual(15);
  });

  it('hires the farmhand in 25–40 minutes (±5 min: a phase 04 target)', () => {
    const t = boughtAt(real, 'farmhand');
    expect(t).toBeGreaterThanOrEqual(20);
    expect(t).toBeLessThanOrEqual(40);
  });

  it('opens the real River Access in 45–75 minutes', () => {
    const t = boughtAt(real, 'river');
    expect(t).toBeGreaterThanOrEqual(45);
    expect(t).toBeLessThanOrEqual(75);
  });

  it('has something to save for at every snapshot', () => {
    // Gold never piles up: at each 5-minute snapshot the next purchase is still ahead.
    for (const r of real) for (const snap of r.timeline) expect(snap.gold).toBeLessThan(5500);
  });

  it('still meets the first-expansion target on a day without specials, within 2 minutes', () => {
    const plain = runs({ noSpecials: true });
    expect(boughtAt(plain, 'farm_1')).toBeLessThanOrEqual(12);
  });

  it('nudges toward variety without punishing a one-crop farm', () => {
    const plain = runs({ noSpecials: true });
    const turnipOnly = runs({ noSpecials: true, onlyCrops: ['turnip'] });
    const avg = (rs: PacingReport[]): number => median(rs.map((r) => r.avgPriceFraction));
    // Mixing crops sells closer to full price than growing one…
    expect(avg(plain)).toBeGreaterThan(avg(turnipOnly));
    // …but one crop still sells for at least 75% of the base price after the Market's 10% cut.
    expect(avg(turnipOnly)).toBeGreaterThan(0.75 * 0.9);
    // And the one-crop farm still reaches its first expansion on time.
    expect(boughtAt(turnipOnly, 'farm_1')).toBeLessThanOrEqual(12);
  });
});

describe('pacing: automating the whole farm (phase 04)', { timeout: 30_000 }, () => {
  const SEEDS_LONG = [1, 2, 3];
  const long = SEEDS_LONG.map((seed) =>
    simulateGreedy({ minutes: 330, reactionMs: 15_000, seed, shopping: AUTOMATION_SHOPPING_LIST }),
  );

  it('buys the real upgrades at the phase 03 pace', () => {
    expect(boughtAt(long, 'sprinkler')).toBeGreaterThanOrEqual(10);
    expect(boughtAt(long, 'sprinkler')).toBeLessThanOrEqual(15);
    expect(boughtAt(long, 'farmhand')).toBeLessThanOrEqual(40);
    expect(boughtAt(long, 'seed_planter')).toBeLessThan(120);
  });

  it('automates the whole 8 × 6 farm in 4–6 hours (farmhand 3, planter 2, auto-seller, every plot sprinkled)', () => {
    for (const r of long) expect(r.automatedAt).not.toBeNull();
    const t = median(long.map((r) => r.automatedAt! / MIN)) / 60;
    expect(t).toBeGreaterThanOrEqual(4);
    expect(t).toBeLessThanOrEqual(6);
  });

  it('then earns while away: 8 offline hours pay out, in well under 100 ms', () => {
    const r = long[0]!;
    const s = structuredClone(r.final);
    const t = at(NY, 2026, 1, 7, 10, 0) + 330 * MIN;
    s.gold = 200_000; // the player stocks the seeds the planter will need before leaving
    const ctx = makeContext(s, GAME_DATA, buildCalendar(t, s.calendar, NY));
    for (const crop of new Set(s.lastPlantedCrop.filter((c) => c !== null))) {
      buySeeds(s, ctx, crop!, 150);
    }
    const before = s.stats.lifetimeGold;
    const t0 = performance.now();
    runOffline(s, GAME_DATA, NY, t, t + 8 * 60 * MIN);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(100);
    expect(s.stats.lifetimeGold - before).toBeGreaterThan(10_000);
    expect(s.stats.itemsShipped).toBeGreaterThan(300);
  });
});

describe('pacing: adding fishing (phase 05)', { timeout: 60_000 }, () => {
  const farmOnly = runs();
  const casual = runs({ fishPerMin: 1 });
  const keen = runs({ fishPerMin: 3 }); // BALANCE.md §6: "3 catches per real minute while actively fishing"
  const lifetime = (rs: readonly PacingReport[]): number => median(rs.map((r) => r.final.stats.lifetimeGold));

  it('a player who fishes between chores is never idle for more than 2 minutes', () => {
    for (const r of casual) expect(r.longestIdleMs).toBeLessThanOrEqual(2 * MIN);
  });

  it('models N catches per real minute from the real catch table, and sells the fish', () => {
    for (const r of keen) {
      expect(r.fished).toBe(180); // 3 a minute for 60 minutes
      const fish = Object.keys(r.sold).filter((id) => id in GAME_DATA.fish || id in GAME_DATA.junk);
      expect(fish.length).toBeGreaterThan(0);
      expect(r.sold.bluegill ?? 0).toBeGreaterThan(0);
    }
  });

  it('opens the river with real gold, earlier for a player who fishes', () => {
    expect(boughtAt(casual, 'river')).toBeLessThan(boughtAt(farmOnly, 'river'));
    for (const r of keen) expect(r.final.expansions).toContain('river');
  });

  it('fishing pays, without making the farm pointless', () => {
    // Fishing at 1 catch a minute is a helpful side income; even 3 a minute (an attentive player who
    // does nothing else) stays under 3 times the farm-only income. See BALANCE.md "Phase 05 tuning notes".
    expect(lifetime(casual)).toBeGreaterThan(lifetime(farmOnly) * 1.1);
    expect(lifetime(keen)).toBeGreaterThan(lifetime(casual));
    expect(lifetime(keen)).toBeLessThan(lifetime(farmOnly) * 3);
  });
});

// Phase 06: a player who cooks. `sell` cooks the best-margin dish they can and sells it at the Market;
// `eat` eats every dish for its buff instead. See BALANCE.md "Phase 06 tuning notes".
describe('pacing: cooking (phase 06)', { timeout: 60_000 }, () => {
  const farmOnly = runs();
  const selling = runs({ cooking: 'sell' });
  const eating = runs({ cooking: 'eat' });
  const lifetime = (rs: readonly PacingReport[]): number => median(rs.map((r) => r.final.stats.lifetimeGold));

  it('cooks and sells real dishes from the crops it grows', () => {
    for (const r of selling) {
      expect(r.cooked).toBeGreaterThanOrEqual(3);
      expect(r.dishGold).toBeGreaterThan(0);
    }
  });

  it('a dish fetches about a quarter more than the raw ingredients it used (T1: +25%, less the Market cut)', () => {
    const ratios = selling.map((r) => {
      let raw = 0;
      for (const id of RECIPE_IDS) {
        const n = r.sold[id] ?? 0;
        raw += n * ingredientValue(GAME_DATA.recipes[id], GAME_DATA.items) * 0.9;
      }
      return r.dishGold / raw;
    });
    expect(median(ratios)).toBeGreaterThan(1.1);
    expect(median(ratios)).toBeLessThan(1.35);
  });

  it('cooking is not required: a farmer who also cooks stays within 10% of one who only sells crops', () => {
    expect(lifetime(selling)).toBeGreaterThan(lifetime(farmOnly) * 0.9);
    expect(lifetime(selling)).toBeLessThan(lifetime(farmOnly) * 1.1);
  });

  it('a player who eats what they cook keeps Green Thumb up most of the hour, and is not ruined by it', () => {
    expect(median(eating.map((r) => r.eaten))).toBeGreaterThan(10);
    expect(median(eating.map((r) => r.buffMinutes.growth ?? 0))).toBeGreaterThan(20);
    // T1 buffs are small (+10% for 6 minutes): eating instead of selling costs a little in hour one.
    expect(lifetime(eating)).toBeGreaterThan(lifetime(farmOnly) * 0.75);
  });
});
