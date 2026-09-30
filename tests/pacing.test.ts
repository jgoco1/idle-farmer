// The phase-03 pacing check (BALANCE.md §11 and "Phase 03 tuning notes"): a greedy active player
// (tests/sim/greedyPlayer.ts) plays the first 60 minutes on several seeds. Phase 04 buys the real
// automation (the second describe plays five and a half hours); River Access (phase 05) is virtual.
// Phase 09 replaces this with the full simulator. Each test plays several whole games, which can
// take longer than Vitest's 5 s default on a busy machine, hence the per-describe timeout.

import { describe, expect, it } from 'vitest';
import { runOffline } from '../src/core/offline';
import { makeContext } from '../src/core/sim';
import { buildCalendar } from '../src/core/time';
import { GAME_DATA } from '../src/data';
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
    for (const r of real) {
      if (r.longestIdleAt < (r.farmLevels[4] ?? Infinity))
        expect(r.longestIdleMs).toBeLessThanOrEqual(2 * MIN);
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

  it('could open the river in 45–75 minutes', () => {
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
