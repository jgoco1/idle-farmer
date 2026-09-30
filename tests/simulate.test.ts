// Phase 09: the headless simulator (scripts/simulate.ts, scripts/sim/) and the pacing it measures.
// It replaces the greedy-player pacing tests of phases 03–07: the bots play the real game through
// `Game.dispatch`, on a real-world schedule (sessions at local times, absences caught up by the real
// offline walk after a JSON save round trip), and the tuning criteria of the phase are asserted on
// short runs here; `npm run simulate` prints the full 30-day report (docs/BALANCE.md "Phase 09").

import { describe, expect, it } from 'vitest';
import { ALL_BOTS, runBot, SIM_START, SIM_ZONE, type BotId } from '../scripts/sim/bots';
import { HOUR, MIN } from '../scripts/sim/driver';
import {
  csvFiles,
  lifetimeAtDay,
  markdownReport,
  median,
  momentMedian,
  type RunResult,
} from '../scripts/sim/report';
import { localTimeToEpoch, daysFromCivil } from '../src/core/time';

const SEEDS = [1, 2, 3, 4];
const WEEK: Partial<Record<BotId, RunResult[]>> = {};
function week(bot: BotId): RunResult[] {
  return (WEEK[bot] ??= SEEDS.map((seed) => {
    const r = runBot(bot, { seed, days: 7 });
    return { metrics: r.metrics, state: r.state };
  }));
}

describe('the simulator', { timeout: 120_000 }, () => {
  it('is deterministic for a seed', () => {
    const a = runBot('active', { seed: 7, days: 2 });
    const b = runBot('active', { seed: 7, days: 2 });
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    expect(a.metrics).toEqual(b.metrics);
    expect(JSON.stringify(runBot('active', { seed: 8, days: 2 }).state)).not.toBe(JSON.stringify(a.state));
  });

  it('plays 30 real days (about four seasons, across a DST change) in seconds, as the real calendar does', () => {
    const t0 = performance.now();
    const run = runBot('active', { seed: 1, days: 30 });
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(20_000); // ~3.5 s on the authors' machine
    // The save is made on Wednesday 25 February 2026 at 19:00 in New York; spring ends at the first
    // Sunday midnight at least three days later (1 March), then a season a week. DST starts 8 March.
    expect(run.start).toBe(localTimeToEpoch(SIM_ZONE, daysFromCivil(2026, 2, 25), 19, 0));
    const seasons = Object.keys(run.metrics.moments).filter((k) => k.startsWith('season_'));
    expect(seasons).toEqual(['season_summer_1', 'season_autumn_2', 'season_winter_3', 'season_spring_4']);
    expect(run.metrics.moments.season_summer_1!.realMs).toBe(
      localTimeToEpoch(SIM_ZONE, daysFromCivil(2026, 3, 1), 0) - SIM_START + 19 * HOUR, // noticed at the next session
    );
    // An hour a day of play; every absence (23 h) is worth the capped 8 h + 15 h × 25% = 11.75 h.
    expect(run.metrics.playMs).toBe(30 * HOUR);
    expect(run.metrics.simMs).toBeGreaterThan(30 * HOUR + 29 * 11.5 * HOUR);
    expect(run.metrics.simMs).toBeLessThan(30 * HOUR + 30 * 12 * HOUR);
    expect(Number.isInteger(run.state.clock.simMs)).toBe(true);
  });

  it('writes a markdown report and CSV files with every bot', () => {
    const runs = Object.fromEntries(
      ALL_BOTS.map((b) => {
        const r = runBot(b, { seed: 1, days: 1 });
        return [b, [{ metrics: r.metrics, state: r.state }]];
      }),
    );
    const result = { seeds: [1], days: 1, runs, elapsedMs: 0 };
    const md = markdownReport(result);
    for (const name of ['Greedy Farmer', 'Angler', 'Chef', 'Casual Idler', 'Active Player'])
      expect(md).toContain(name);
    expect(md).toContain('| Check | Target | Measured | |');
    const csv = csvFiles(result);
    expect(Object.keys(csv)).toEqual(['sim-snapshots.csv', 'sim-moments.csv', 'sim-summary.csv']);
    expect(csv['sim-summary.csv']!.split('\n')[1]).toMatch(/^farmer,1,/);
  });
});

describe('pacing on a real-world schedule (BALANCE.md §11, phase 09)', { timeout: 300_000 }, () => {
  const playMin = (runs: RunResult[], key: string): number =>
    momentMedian(runs, key, 'playMs', MIN) ?? Infinity;

  it('the first session: first harvest ≤ 2.5 min, then expansion, sprinkler, farmhand and river in the first hour', () => {
    const active = week('active');
    const farmer = week('farmer');
    for (const r of [...active, ...farmer])
      expect(r.metrics.moments.first_harvest!.playMs).toBeLessThanOrEqual(2.5 * MIN);
    expect(playMin(active, 'bought_farm_1')).toBeLessThanOrEqual(20);
    expect(playMin(active, 'placed_sprinkler')).toBeLessThanOrEqual(25);
    expect(playMin(active, 'bought_farmhand')).toBeGreaterThanOrEqual(20);
    expect(playMin(active, 'bought_farmhand')).toBeLessThanOrEqual(40);
    expect(playMin(active, 'bought_river')).toBeLessThanOrEqual(60);
    expect(playMin(farmer, 'bought_river')).toBeLessThanOrEqual(75);
  });

  it('never leaves an early player waiting more than ~2 minutes with nothing to do', () => {
    for (const bot of ['farmer', 'angler', 'chef', 'active'] as const) {
      const waits = week(bot).map((r) => r.metrics.longestEarlyWaitMs);
      expect(median(waits), bot).toBeLessThanOrEqual(2.25 * MIN);
      // A farmer who never fishes may wait out one 4-minute potato it chose to plant.
      for (const w of waits) expect(w, bot).toBeLessThanOrEqual(4.5 * MIN);
    }
  });

  it('an hour a day automates the whole farm over a few days, not in the first session (target 4–6 h of play)', () => {
    const h = momentMedian(week('active'), 'automated', 'playMs', HOUR);
    expect(h).not.toBeNull();
    expect(h!).toBeGreaterThanOrEqual(2);
    expect(h!).toBeLessThanOrEqual(6);
  });

  it('no strategy dominates: Farmer, Angler and Chef within 1.5× of each other after 3 and 7 days', () => {
    for (const d of [3, 7]) {
      const golds = (['farmer', 'angler', 'chef'] as const).map((b) =>
        median(week(b).map((r) => lifetimeAtDay(r, d))),
      );
      expect(Math.max(...golds) / Math.min(...golds), `day ${d}: ${golds.join(', ')}`).toBeLessThanOrEqual(
        1.5,
      );
    }
  });

  it('the Casual Idler (2 minutes every 4 hours) earns at least 40% of what the Active Player does in 3 days', () => {
    const idler = median(week('idler').map((r) => lifetimeAtDay(r, 3)));
    const active = median(week('active').map((r) => lifetimeAtDay(r, 3)));
    expect(idler / active).toBeGreaterThanOrEqual(0.4);
    for (const r of week('idler'))
      expect(r.metrics.offlineGold / r.state.stats.lifetimeGold).toBeGreaterThan(0.9);
  });

  it('food buffs kept up are worth it but not mandatory: +10% to +25% over the first week', () => {
    const chef = week('chef');
    const sells = week('chef_sells');
    const ratio = median(chef.map((r, i) => lifetimeAtDay(r, 7) / lifetimeAtDay(sells[i]!, 7)));
    expect(ratio).toBeGreaterThanOrEqual(1.1);
    expect(ratio).toBeLessThanOrEqual(1.25);
    for (const r of chef) expect(r.metrics.buffPlayMs / r.metrics.playMs).toBeGreaterThan(0.9);
  });

  it('income grows with the farm, then levels off: no runaway growth once the farm is built', () => {
    for (const bot of ['farmer', 'angler', 'chef'] as const) {
      for (const r of week(bot)) {
        // A day's income can jump when the last automation lands, and dips at a season change (the
        // field withers and is replanted), but it never runs far past the best day before it.
        // Income ramps up over the first days (the farm grows, melons and pumpkins open); once a day
        // brings in half a million it levels off, and no later day doubles the best one before it.
        // The full 30-day curve is in the simulator's report.
        const perDay = [1, 2, 3, 4, 5, 6, 7].map((d) => lifetimeAtDay(r, d) - lifetimeAtDay(r, d - 1));
        const built = perDay.findIndex((g) => g >= 500_000);
        expect(built, bot).toBeGreaterThanOrEqual(0);
        for (let i = built + 1; i < perDay.length; i++) {
          expect(perDay[i]! / Math.max(...perDay.slice(0, i)), bot).toBeLessThan(2);
        }
      }
    }
  });
});
