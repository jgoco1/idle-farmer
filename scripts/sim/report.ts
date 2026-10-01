// Turns simulator runs into the phase-09 report: a markdown summary (medians over seeds) and CSV
// files with every snapshot and moment. Pure functions of the runs, so tests can check them.

import { BOTS, SIM_START_LABEL, STRATEGY_BOTS, type BotId } from './bots';
import type { GameState } from '../../src/core/state';
import { DAY, HOUR, MIN, type Metrics, type Moment } from './driver';
import { catalogueParts } from './catalogue';
import { GAME_DATA } from '../../src/data';

/** What the report needs from a finished run (plain data, so it can come back from a worker thread). */
export interface RunResult {
  metrics: Metrics;
  state: GameState;
}

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m]! : (a[m - 1]! + a[m]!) / 2;
}

/** The last snapshot at or before `realMs` (the state of the farm at that moment). */
export function snapshotAt(run: RunResult, realMs: number) {
  let best = run.metrics.snapshots[0]!;
  for (const s of run.metrics.snapshots) if (s.realMs <= realMs) best = s;
  return best;
}

export function lifetimeAtDay(run: RunResult, day: number): number {
  return snapshotAt(run, day * DAY).lifetimeGold;
}

/** Median of a moment over the runs, in `unit` ms, or null when fewer than half the runs reached it. */
export function momentMedian(
  runs: readonly RunResult[],
  key: string,
  field: keyof Moment,
  unit: number,
): number | null {
  const xs = runs.map((r) => r.metrics.moments[key]?.[field]).filter((x): x is number => x !== undefined);
  return xs.length * 2 > runs.length ? median(xs) / unit : null;
}

export interface BotSummary {
  bot: BotId;
  playHours: number;
  lifetime: Record<number, number>; // by day
  farmLevel: Record<number, number>;
  recipesKnown: number;
  firstSprinklerPlayMin: number | null;
  farmhandPlayMin: number | null;
  automatedSimHours: number | null;
  automatedPlayHours: number | null;
  greenhouseDays: number | null;
  farmLevel10SimHours: number | null;
  deadShare: number;
  longestEarlyWaitMin: number;
  buffUptime: number;
  buffUptimePlaying: number;
  offlineShare: number;
  /** Gold earned per simulated hour on each real day (the gold-per-hour curve). */
  goldPerSimHour: number[];
  /** Gold earned per hour of play on each real day. */
  goldPerPlayHour: number[];
}

export const REPORT_DAYS = [1, 3, 7, 14, 30] as const;

export function summarize(bot: BotId, runs: readonly RunResult[], days: number): BotSummary {
  const med = (f: (r: RunResult) => number): number => median(runs.map(f));
  const lifetime: Record<number, number> = {};
  const farmLevel: Record<number, number> = {};
  for (const d of REPORT_DAYS) {
    if (d > days) continue;
    lifetime[d] = med((r) => lifetimeAtDay(r, d));
    farmLevel[d] = med((r) => snapshotAt(r, d * DAY).farmLevel);
  }
  const perDay = (field: 'simMs' | 'playMs'): number[] =>
    Array.from({ length: days }, (_, i) =>
      med((r) => {
        const a = snapshotAt(r, i * DAY);
        const b = snapshotAt(r, (i + 1) * DAY);
        const hours = (b[field] - a[field]) / HOUR;
        return hours > 0 ? (b.lifetimeGold - a.lifetimeGold) / hours : 0;
      }),
    );
  return {
    bot,
    playHours: med((r) => r.metrics.playMs / HOUR),
    lifetime,
    farmLevel,
    recipesKnown: med((r) => r.state.kitchen.known.length),
    firstSprinklerPlayMin: momentMedian(runs, 'placed_sprinkler', 'playMs', MIN),
    farmhandPlayMin: momentMedian(runs, 'bought_farmhand', 'playMs', MIN),
    automatedSimHours: momentMedian(runs, 'automated', 'simMs', HOUR),
    automatedPlayHours: momentMedian(runs, 'automated', 'playMs', HOUR),
    greenhouseDays: momentMedian(runs, 'bought_greenhouse', 'realMs', DAY),
    farmLevel10SimHours: momentMedian(runs, 'farm_level_10', 'simMs', HOUR),
    deadShare: med((r) => r.metrics.deadMs / Math.max(1, r.metrics.playMs)),
    longestEarlyWaitMin: med((r) => r.metrics.longestEarlyWaitMs / MIN),
    buffUptime: med((r) => r.metrics.buffAnyMs / Math.max(1, r.metrics.simMs)),
    buffUptimePlaying: med((r) => r.metrics.buffPlayMs / Math.max(1, r.metrics.playMs)),
    offlineShare: med((r) => r.metrics.offlineGold / Math.max(1, r.state.stats.lifetimeGold)),
    goldPerSimHour: perDay('simMs'),
    goldPerPlayHour: perDay('playMs'),
  };
}

const fmt = (x: number | null | undefined, digits = 0): string =>
  x === null || x === undefined || !Number.isFinite(x)
    ? '–'
    : x.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
const pct = (x: number): string => `${Math.round(x * 100)}%`;

/** The milestones and moments shown in the time table, with a label. */
export const MOMENTS: readonly [key: string, label: string][] = [
  ['first_harvest', 'First harvest'],
  ['bought_farm_1', 'First expansion (`farm_1`)'],
  ['placed_sprinkler', 'First automation (sprinkler placed)'],
  ['bought_farmhand', 'Farmhand L1'],
  ['bought_river', 'River Access'],
  ['dish_t2', 'First T2 dish'],
  ['dish_t3', 'First T3 dish'],
  ['dish_t4', 'First T4 dish'],
  ['bought_ocean', 'Old Dock'],
  ['m14_first_bundle', 'First bundle'],
  ['automated', 'Whole farm automated'],
  ['bought_greenhouse', 'Greenhouse'],
  ['farm_level_5', 'Farm Level 5'],
  ['farm_level_7', 'Farm Level 7'],
  ['farm_level_10', 'Farm Level 10'],
  ['bought_orchard', 'Hilltop Orchard bought'],
  ['bought_yard', 'Old Paddock bought'],
  ['bought_meadow', 'Seaside Meadow bought'],
];

/** Days of the "Gold still to spend" table (BALANCE.md §13.4). */
export const SPEND_DAYS = [1, 3, 7, 14, 21, 30] as const;

/** Median gold still to spend at the end of real day `day`, and as a share of the catalogue. */
export function toSpendAtDay(
  runs: readonly RunResult[],
  day: number,
  total: number,
): { gold: number; share: number } {
  const gold = median(runs.map((r) => snapshotAt(r, day * DAY).toSpend));
  return { gold, share: gold / total };
}

/** Median real day on which a bot had bought the whole catalogue, or null if most runs never did. */
export function spentOutDay(runs: readonly RunResult[]): number | null {
  const days = runs
    .map((r) => r.metrics.snapshots.find((s) => s.toSpend === 0)?.realMs)
    .filter((x): x is number => x !== undefined);
  return days.length * 2 > runs.length ? median(days) / DAY : null;
}

function momentCell(runs: readonly RunResult[], key: string): string {
  const play = momentMedian(runs, key, 'playMs', MIN);
  if (play === null) return '–';
  const sim = momentMedian(runs, key, 'simMs', HOUR)!;
  const real = momentMedian(runs, key, 'realMs', HOUR)!;
  const playText = play < 90 ? `${fmt(play)} min` : `${fmt(play / 60, 1)} h`;
  const realText = real < 48 ? `${fmt(real, 1)} h` : `${fmt(real / 24, 1)} d`;
  return `${playText} · ${fmt(sim, 1)} h · ${realText}`;
}

export interface SimResult {
  seeds: number[];
  days: number;
  runs: Partial<Record<BotId, RunResult[]>>;
  elapsedMs: number;
}

/** The markdown report. */
export function markdownReport(result: SimResult): string {
  const { runs, days } = result;
  const bots = Object.keys(runs) as BotId[];
  const sums = new Map(bots.map((b) => [b, summarize(b, runs[b]!, days)]));
  const lines: string[] = [];
  lines.push(
    `Seeds ${result.seeds.join(', ')} · ${days} real days from ${SIM_START_LABEL} · medians · ${fmt(result.elapsedMs / 1000, 1)} s`,
    '',
  );
  // Summary
  const dayCols = REPORT_DAYS.filter((d) => d <= days);
  lines.push(
    `| Bot | Play (h) | ${dayCols.map((d) => `Gold d${d}`).join(' | ')} | FL d3 · d${days} | Recipes | Dead time | Longest early wait | Buff uptime (play · all) | Gold from offline |`,
    `|---|---|${dayCols.map(() => '---|').join('')}---|---|---|---|---|---|`,
  );
  for (const b of bots) {
    const s = sums.get(b)!;
    lines.push(
      `| ${BOTS[b].name} | ${fmt(s.playHours, 1)} | ${dayCols.map((d) => fmt(s.lifetime[d])).join(' | ')} | ${s.farmLevel[3] ?? '–'} · ${s.farmLevel[dayCols.at(-1)!]} | ${fmt(s.recipesKnown)} | ${pct(s.deadShare)} | ${fmt(s.longestEarlyWaitMin, 1)} min | ${pct(s.buffUptimePlaying)} · ${pct(s.buffUptime)} | ${pct(s.offlineShare)} |`,
    );
  }
  lines.push('');
  // Moments
  lines.push(
    'Time to each moment: **play time · simulated time · real time** since the save was made (medians; – = not reached by most seeds).',
    '',
    `| Moment | ${bots.map((b) => BOTS[b].name).join(' | ')} |`,
    `|---|${bots.map(() => '---|').join('')}`,
  );
  for (const [key, label] of MOMENTS) {
    lines.push(`| ${label} | ${bots.map((b) => momentCell(runs[b]!, key)).join(' | ')} |`);
  }
  lines.push('');
  // Gold per hour
  const curveDays = [1, 2, 3, 5, 7, 10, 14, 21, 28, 30].filter((d) => d <= days);
  lines.push(
    'Gold per simulated hour on real day *n* (the gold-per-hour curve):',
    '',
    `| Bot | ${curveDays.map((d) => `d${d}`).join(' | ')} |`,
    `|---|${curveDays.map(() => '---|').join('')}`,
  );
  for (const b of bots) {
    const s = sums.get(b)!;
    lines.push(`| ${BOTS[b].name} | ${curveDays.map((d) => fmt(s.goldPerSimHour[d - 1])).join(' | ')} |`);
  }
  lines.push('');
  // Gold still to spend (BALANCE.md §13.4; v2 phase 01: v1 and the land parcels).
  const parts = catalogueParts(GAME_DATA);
  const total = parts.v1 + parts.parcels;
  const spendDays = SPEND_DAYS.filter((d) => d <= days);
  lines.push(
    `Gold still to spend (BALANCE.md §13.4): the catalogue so far is v1 ${fmt(parts.v1)} + land ${fmt(parts.parcels)} = **${fmt(total)}**; gold still to spend · share of the catalogue at the end of real day *n*, and the day it reaches 0:`,
    '',
    `| Bot | ${spendDays.map((d) => `d${d}`).join(' | ')} | Spent out |`,
    `|---|${spendDays.map(() => '---|').join('')}---|`,
  );
  for (const b of bots) {
    const cells = spendDays.map((d) => {
      const t = toSpendAtDay(runs[b]!, d, total);
      return `${fmt(t.gold)} · ${pct(t.share)}`;
    });
    const out = spentOutDay(runs[b]!);
    lines.push(`| ${BOTS[b].name} | ${cells.join(' | ')} | ${out === null ? '–' : `d${fmt(out, 1)}`} |`);
  }
  lines.push('');
  lines.push(...checks(result, sums));
  return lines.join('\n');
}

export interface Check {
  what: string;
  target: string;
  measured: string;
  ok: boolean;
}

/** The phase-09 tuning criteria, measured. */
export function tuningChecks(result: SimResult, sums: Map<BotId, BotSummary>): Check[] {
  const out: Check[] = [];
  const days = result.days;
  const has = (b: BotId): boolean => sums.has(b);
  const strat = STRATEGY_BOTS.filter(has);
  for (const d of [3, 7, 30].filter((x) => x <= days)) {
    if (strat.length < 2) break;
    const golds = strat.map((b) => sums.get(b)!.lifetime[d] ?? 0);
    const ratio = Math.max(...golds) / Math.max(1, Math.min(...golds));
    out.push({
      what: `No strategy dominates (day ${d})`,
      target: '≤ 1.5× lifetime gold',
      measured: `${fmt(ratio, 2)}× (${strat.map((b, i) => `${BOTS[b].name} ${fmt(golds[i])}`).join(', ')})`,
      ok: ratio <= 1.5,
    });
  }
  if (has('idler') && has('active') && days >= 3) {
    const r = sums.get('idler')!.lifetime[3]! / Math.max(1, sums.get('active')!.lifetime[3]!);
    out.push({
      what: 'Casual Idler vs Active Player (day 3)',
      target: '≥ 40% of the lifetime gold',
      measured: pct(r),
      ok: r >= 0.4,
    });
  }
  if (has('chef') && has('chef_sells')) {
    // Paired by seed (same seed, same start): the median of the per-seed ratios is steadier than a
    // ratio of medians. Day 7 closes the buying phase (everything but the greenhouse is bought).
    const paired = (d: number): number =>
      median(
        result.runs.chef!.map(
          (r, i) => lifetimeAtDay(r, d) / Math.max(1, lifetimeAtDay(result.runs.chef_sells![i]!, d)),
        ),
      ) - 1;
    const sign = (x: number): string => `${x >= 0 ? '+' : ''}${pct(x)}`;
    const d7 = Math.min(7, days);
    const r = paired(d7);
    out.push({
      what: `Buffs kept up: Chef vs the same Chef selling its dishes (day ${d7}, paired by seed)`,
      target: '+10% to +25% (worth it, not mandatory)',
      measured: `${sign(r)} (day 3 ${sign(paired(Math.min(3, days)))}${days >= 14 ? `, day 14 ${sign(paired(14))}` : ''})`,
      ok: r >= 0.1 && r <= 0.25,
    });
  }
  for (const b of [...strat, 'active' as const].filter(has)) {
    const s = sums.get(b)!;
    out.push({
      what: `${BOTS[b].name}: early dead time`,
      target: 'no wait over 2 min in the first 30 min of play',
      measured: `${fmt(s.longestEarlyWaitMin, 1)} min (dead-time share ${pct(s.deadShare)})`,
      ok: s.longestEarlyWaitMin <= 2.05,
    });
  }
  for (const b of strat) {
    const s = sums.get(b)!;
    const curve = s.goldPerSimHour;
    let worst = 0;
    for (let i = 3; i < curve.length; i++) worst = Math.max(worst, curve[i]! / Math.max(1, curve[i - 1]!));
    const late = curve.length >= 28 ? curve[27]! / Math.max(1, curve[13]!) : NaN;
    out.push({
      what: `${BOTS[b].name}: no runaway growth after day 3`,
      target: 'gold/hour at most ~3× the day before; week 4 not far above week 2',
      measured: `worst day-over-day ${fmt(worst, 2)}×${Number.isFinite(late) ? `, day 28 / day 14 ${fmt(late, 2)}×` : ''}`,
      ok: worst <= 3 && (!Number.isFinite(late) || late <= 3),
    });
  }
  return out;
}

function checks(result: SimResult, sums: Map<BotId, BotSummary>): string[] {
  const rows = tuningChecks(result, sums);
  return [
    '| Check | Target | Measured | |',
    '|---|---|---|---|',
    ...rows.map((c) => `| ${c.what} | ${c.target} | ${c.measured} | ${c.ok ? '✅' : '❌'} |`),
  ];
}

// ---- CSV

function csv(rows: (string | number)[][]): string {
  return rows.map((r) => r.join(',')).join('\n') + '\n';
}

export function csvFiles(result: SimResult): Record<string, string> {
  const snaps: (string | number)[][] = [
    [
      'bot',
      'seed',
      'real_hours',
      'play_minutes',
      'sim_hours',
      'gold',
      'lifetime_gold',
      'farm_level',
      'recipes_known',
      'plots',
      'milestones',
      'to_spend',
    ],
  ];
  const moments: (string | number)[][] = [
    ['bot', 'seed', 'moment', 'real_hours', 'play_minutes', 'sim_hours'],
  ];
  const summary: (string | number)[][] = [
    [
      'bot',
      'seed',
      'play_hours',
      'lifetime_gold',
      'farm_level',
      'recipes_known',
      'dead_share',
      'longest_early_wait_min',
      'buff_uptime',
      'buff_uptime_playing',
      'offline_gold_share',
      'fished',
      'cooked',
      'eaten',
    ],
  ];
  const r2 = (x: number): number => Math.round(x * 100) / 100;
  for (const [bot, runs] of Object.entries(result.runs)) {
    runs!.forEach((run, i) => {
      const seed = result.seeds[i]!;
      for (const s of run.metrics.snapshots) {
        snaps.push([
          bot,
          seed,
          r2(s.realMs / HOUR),
          r2(s.playMs / MIN),
          r2(s.simMs / HOUR),
          s.gold,
          s.lifetimeGold,
          s.farmLevel,
          s.recipesKnown,
          s.plots,
          s.milestones,
          s.toSpend,
        ]);
      }
      for (const [k, m] of Object.entries(run.metrics.moments)) {
        moments.push([bot, seed, k, r2(m.realMs / HOUR), r2(m.playMs / MIN), r2(m.simMs / HOUR)]);
      }
      const m = run.metrics;
      const last = m.snapshots.at(-1)!;
      summary.push([
        bot,
        seed,
        r2(m.playMs / HOUR),
        last.lifetimeGold,
        last.farmLevel,
        last.recipesKnown,
        r2(m.deadMs / Math.max(1, m.playMs)),
        r2(m.longestEarlyWaitMs / MIN),
        r2(m.buffAnyMs / Math.max(1, m.simMs)),
        r2(m.buffPlayMs / Math.max(1, m.playMs)),
        r2(m.offlineGold / Math.max(1, last.lifetimeGold)),
        m.fished,
        m.cooked,
        m.eaten,
      ]);
    });
  }
  return {
    'sim-snapshots.csv': csv(snaps),
    'sim-moments.csv': csv(moments),
    'sim-summary.csv': csv(summary),
  };
}
