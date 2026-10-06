// Turns simulator runs into the phase-09 report: a markdown summary (medians over seeds) and CSV
// files with every snapshot and moment. Pure functions of the runs, so tests can check them.

import { BOTS, SIM_START_LABEL, STRATEGY_BOTS, type BotId } from './bots';
import type { GameState } from '../../src/core/state';
import { DAY, HOUR, MIN, type Metrics, type Moment } from './driver';
import { firstFruitTimes } from './trees';
import { treeOfFruit } from '../../src/data/ids';
import { catalogueParts, catalogueTotal } from './catalogue';
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
/** A share to one decimal (for the bands a rounded percentage would hide). */
const fmtShare = (x: number): string => `${(x * 100).toFixed(1)}%`;

/**
 * Orchard gold as a share of the gold earned between real days `from` and `to` (BALANCE.md §13.10), median over seeds,
 * and its size in gold per day.
 */
export function orchardShare(
  runs: readonly RunResult[],
  from: number,
  to: number,
): { share: number; perDay: number } {
  const per = runs.map((r) => {
    const a = snapshotAt(r, from * DAY);
    const b = snapshotAt(r, to * DAY);
    const gold = b.orchardGold - a.orchardGold;
    return { gold, total: Math.max(1, b.lifetimeGold - a.lifetimeGold) };
  });
  return {
    share: median(per.map((p) => p.gold / p.total)),
    perDay: median(per.map((p) => p.gold)) / Math.max(1, to - from),
  };
}

/** Gold from eggs and milk as a share of the gold earned between real days `from` and `to` (BALANCE.md §13.10), median over seeds. */
export function animalShare(
  runs: readonly RunResult[],
  from: number,
  to: number,
): { share: number; perDay: number } {
  const per = runs.map((r) => {
    const a = snapshotAt(r, from * DAY);
    const b = snapshotAt(r, to * DAY);
    return { gold: b.animalGold - a.animalGold, total: Math.max(1, b.lifetimeGold - a.lifetimeGold) };
  });
  return {
    share: median(per.map((p) => p.gold / p.total)),
    perDay: median(per.map((p) => p.gold)) / Math.max(1, to - from),
  };
}

/**
 * v4-01 (BALANCE §14.9): the north fields' share of crop gold between real days `from` and `to`, median over seeds:
 * the base-price value of the crops harvested on the north fields over that of every harvest, per field and together.
 */
export function northShare(
  runs: readonly RunResult[],
  from: number,
  to: number,
): { north_fields: number; terraces: number; total: number; perDay: number } {
  const per = runs.map((r) => {
    const a = snapshotAt(r, from * DAY);
    const b = snapshotAt(r, to * DAY);
    const all = Math.max(1, b.harvestValue - a.harvestValue);
    const nf = b.northValue.north_fields - a.northValue.north_fields;
    const t = b.northValue.terraces - a.northValue.terraces;
    const crop = b.cropGold - a.cropGold;
    return { nf: nf / all, t: t / all, total: (nf + t) / all, gold: (crop * (nf + t)) / all };
  });
  return {
    north_fields: median(per.map((p) => p.nf)),
    terraces: median(per.map((p) => p.t)),
    total: median(per.map((p) => p.total)),
    perDay: median(per.map((p) => p.gold)) / Math.max(1, to - from),
  };
}

/**
 * v4-01 (BALANCE §14.1): real days from buying a north field until the crops grown on it have earned its price, gross
 * (its share of the crop gold sold since). Median over the seeds that bought it; null when fewer than half did, and a
 * seed that has not paid back by the end counts as never (Infinity).
 */
export function northPayback(runs: readonly RunResult[], field: 'north_fields' | 'terraces'): number | null {
  const price = GAME_DATA.parcels[field].price;
  const days: number[] = [];
  for (const r of runs) {
    const bought = r.metrics.moments[`bought_${field}`];
    if (!bought) continue;
    const a = snapshotAt(r, bought.realMs);
    let paid = Infinity;
    for (const b of r.metrics.snapshots) {
      if (b.realMs <= bought.realMs) continue;
      const all = Math.max(1, b.harvestValue - a.harvestValue);
      const gold = ((b.cropGold - a.cropGold) * (b.northValue[field] - a.northValue[field])) / all;
      if (gold >= price) {
        paid = (b.realMs - bought.realMs) / DAY;
        break;
      }
    }
    days.push(paid);
  }
  return days.length * 2 > runs.length ? median(days) : null;
}

/**
 * The idle stretches of a run after the Seed Order was bought (v2 phase 06): per seed, the gold earned while away in the
 * first absence that began after the purchase ("the night after buying it") and the median per absence over every
 * absence after it. The purchase day is the one in `ordered`'s run; the controls are read at the same absences, so the
 * pairs differ only in the Seed Order. Seeds that never bought it are left out.
 */
export function seedOrderNights(
  ordered: readonly RunResult[],
  control: readonly RunResult[],
): {
  seeds: number;
  firstOrdered: number;
  firstControl: number;
  allOrdered: number;
  allControl: number;
} | null {
  const pairs: { first: [number, number]; all: [number, number] }[] = [];
  ordered.forEach((run, i) => {
    const bought = run.metrics.moments.bought_seed_order;
    const other = control[i];
    if (!bought || !other) return;
    const after = (r: RunResult) =>
      r.metrics.aways.filter((a) => a.startMs >= bought.realMs && a.ms >= 2 * HOUR);
    const a = after(run);
    const b = after(other);
    const n = Math.min(a.length, b.length);
    if (n === 0) return;
    pairs.push({
      first: [a[0]!.gold, b[0]!.gold],
      all: [median(a.slice(0, n).map((x) => x.gold)), median(b.slice(0, n).map((x) => x.gold))],
    });
  });
  if (pairs.length === 0) return null;
  return {
    seeds: pairs.length,
    firstOrdered: median(pairs.map((p) => p.first[0])),
    firstControl: median(pairs.map((p) => p.first[1])),
    allOrdered: median(pairs.map((p) => p.all[0])),
    allControl: median(pairs.map((p) => p.all[1])),
  };
}

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
  ['bought_north_fields', 'North Fields bought'],
  ['bought_terraces', 'Upper Terraces bought'],
  ['first_sapling', 'First sapling bought'],
  ['first_mature_tree', 'First mature tree'],
  ['first_fruit', 'First fruit picked'],
  ['bought_coop', 'Coop built'],
  ['first_egg', 'First egg laid'],
  ['bought_barn', 'Barn built'],
  ['first_milk', 'First milk'],
  ['first_decor', 'First decoration placed'],
  ['first_stage', 'First town project stage'],
  ['first_project', 'First town project complete'],
  ['charm_25', 'Charm 25'],
  ['charm_100', 'Charm 100'],
  ['project_old_bridge', 'Old Bridge mended'],
  ['project_bakery', 'Bakery rebuilt'],
  ['project_community_hall', 'Community Hall raised'],
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
  /**
   * The Chef and its selling control on more seeds (`BUFF_SEEDS`, `BUFF_DAYS`), for the buffs check only:
   * per-seed ratios run from about −20% to +60%, so 5–8 seeds swing the median by ±7 points (v2-06).
   */
  buffRuns?: { seeds: number[]; days: number; chef: RunResult[]; chef_sells: RunResult[] };
}

/** The buffs check's own seeds and length (see `SimResult.buffRuns`). */
export const BUFF_SEEDS: readonly number[] = Array.from({ length: 24 }, (_, i) => i + 1);
export const BUFF_DAYS = 14;

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
  // Gold still to spend (BALANCE.md §13.4; v2 phase 02: v1, land, decorations and town projects).
  const parts = catalogueParts(GAME_DATA);
  const total = parts.v1 + parts.parcels + parts.saplings + parts.ranch + parts.decor + parts.projects;
  const spendDays = SPEND_DAYS.filter((d) => d <= days);
  lines.push(
    `Gold still to spend (BALANCE.md §13.4): the catalogue so far is v1 ${fmt(parts.v1)} + land ${fmt(parts.parcels)} + saplings ${fmt(parts.saplings)} + ranch ${fmt(parts.ranch)} + decorations ${fmt(parts.decor)} + town projects ${fmt(parts.projects)} = **${fmt(total)}**; gold still to spend · share of the catalogue at the end of real day *n*, and the day it reaches 0:`,
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
  // The orchard (v2 phase 03)
  lines.push(
    'First fruit by tree, planted on the first evening of the schedule (the real calendar; the days are real days after planting):',
    '',
    '| Tree | Days to mature | First fruit after | In season |',
    '|---|---|---|---|',
    ...firstFruitTimes().map(
      (r) =>
        `| ${GAME_DATA.trees[treeOfFruit(r.fruit)].name} | ${r.matureDays} | ${r.firstFruitDays ?? '–'} days | ${r.season ?? '–'} |`,
    ),
    '',
  );
  if (days >= 14) {
    lines.push(
      'Orchard income (gold from selling fruit; BALANCE.md §13.10), as gold per day and a share of the gold earned in the window (medians):',
      '',
      '| Bot | days 7–14 | days 14–21 (a full orchard) | days 14–' + String(days) + ' |',
      '|---|---|---|---|',
    );
    for (const b of bots) {
      const w1 = orchardShare(runs[b]!, 7, 14);
      const w3 = orchardShare(runs[b]!, 14, Math.min(21, days));
      const w2 = orchardShare(runs[b]!, 14, days);
      const cell = (w: { perDay: number; share: number }): string => `${fmt(w.perDay)} · ${pct(w.share)}`;
      lines.push(
        `| ${BOTS[b].name} | ${cell(w1)} | ${days > 14 ? cell(w3) : '–'} | ${days > 14 ? cell(w2) : '–'} |`,
      );
    }
    lines.push('');
  }
  // The ranch (v2 phase 04)
  if (days >= 14) {
    lines.push(
      'Animal income (gold from selling eggs and milk; BALANCE.md §13.10), as gold per day and a share of the gold earned in the window, and hours an animal waited with an empty trough (medians):',
      '',
      '| Bot | days 7–14 | days 14–' + String(days) + ' | hungry hours |',
      '|---|---|---|---|',
    );
    for (const b of bots) {
      const w1 = animalShare(runs[b]!, 7, 14);
      const w2 = animalShare(runs[b]!, 14, days);
      const hungry = median(runs[b]!.map((r) => r.metrics.hungryMs / HOUR));
      lines.push(
        `| ${BOTS[b].name} | ${fmt(w1.perDay)} · ${pct(w1.share)} | ${days > 14 ? `${fmt(w2.perDay)} · ${pct(w2.share)}` : '–'} | ${fmt(hungry, 1)} |`,
      );
    }
    lines.push('');
  }
  // The north fields (v4-01)
  if (days >= 14) {
    lines.push(
      "The north fields (BALANCE §14.9): their share of crop gold (the base-price value of what they grew over that of every harvest), North Fields · Upper Terraces · together, the north's crop gold a day, and the real days each field took to pay back its price (gross; medians):",
      '',
      '| Bot | days 14–' +
        String(days) +
        ' | gold a day | North Fields paid back | Upper Terraces paid back |',
      '|---|---|---|---|---|',
    );
    for (const b of bots) {
      const w = northShare(runs[b]!, 14, days);
      const pb = (f: 'north_fields' | 'terraces'): string => {
        const d = northPayback(runs[b]!, f);
        return d === null ? '–' : Number.isFinite(d) ? `${fmt(d, 1)} days` : 'not yet';
      };
      lines.push(
        `| ${BOTS[b].name} | ${pct(w.north_fields)} · ${pct(w.terraces)} · ${pct(w.total)} | ${fmt(w.perDay)} | ${pb('north_fields')} | ${pb('terraces')} |`,
      );
    }
    lines.push('');
  }
  // Seed Order (v2 phase 06)
  if (runs.farmer && (runs.farmer_plain || runs.farmer_forgetful)) {
    lines.push(
      'Seed Order (BALANCE.md §13.15): gold earned while away (an absence of 2 hours or more) after the Greedy Farmer bought it, against the same seed without it (medians over the seeds that bought it):',
      '',
      '| Control | Seeds | Night after buying it: with · without · ratio | Every later absence (median): with · without · ratio |',
      '|---|---|---|---|',
    );
    for (const control of ['farmer_plain', 'farmer_forgetful'] as const) {
      const n = runs[control] ? seedOrderNights(runs.farmer, runs[control]!) : null;
      if (!n) continue;
      const ratio = (a: number, b: number): string => (b > 0 ? `${fmt(a / b, 2)}×` : '–');
      lines.push(
        `| ${BOTS[control].name} | ${n.seeds} | ${fmt(n.firstOrdered)} · ${fmt(n.firstControl)} · ${ratio(n.firstOrdered, n.firstControl)} | ${fmt(n.allOrdered)} · ${fmt(n.allControl)} · ${ratio(n.allOrdered, n.allControl)} |`,
      );
    }
    lines.push('');
  }
  // Charm by day
  lines.push(
    'Charm at the end of real day *n* (median):',
    '',
    `| Bot | ${spendDays.map((d) => `d${d}`).join(' | ')} |`,
    `|---|${spendDays.map(() => '---|').join('')}`,
  );
  for (const b of bots)
    lines.push(
      `| ${BOTS[b].name} | ${spendDays.map((d) => fmt(median(runs[b]!.map((r) => snapshotAt(r, d * DAY).charm)))).join(' | ')} |`,
    );
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
  if ((has('chef') && has('chef_sells')) || result.buffRuns) {
    // Paired by seed (same seed, same start): the median of the per-seed ratios is steadier than a
    // ratio of medians. Judged on day 10 since v2-06: with the Seed Order the control never stalls, so in
    // the first week a dish eaten is worth about what it sells for (day 7 ≈ +4% on 24 seeds) and buffs pay
    // from the second week. Day 14 is shown as the ceiling to watch (BALANCE.md §13.15).
    const pair = result.buffRuns ?? {
      seeds: result.seeds,
      days,
      chef: result.runs.chef!,
      chef_sells: result.runs.chef_sells!,
    };
    const paired = (d: number): number =>
      median(
        pair.chef.map((r, i) => lifetimeAtDay(r, d) / Math.max(1, lifetimeAtDay(pair.chef_sells[i]!, d))),
      ) - 1;
    const pdays = pair.days;
    const sign = (x: number): string => `${x >= 0 ? '+' : ''}${pct(x)}`;
    const d10 = Math.min(10, pdays);
    const r = paired(d10);
    out.push({
      what: `Buffs kept up: Chef vs the same Chef selling its dishes (day ${d10}, paired by seed, ${pair.seeds.length} seeds)`,
      target: '+10% to +25% (worth it, not mandatory)',
      measured: `${sign(r)} (day 3 ${sign(paired(Math.min(3, pdays)))}, day 7 ${sign(paired(Math.min(7, pdays)))}${pdays >= 14 ? `, day 14 ${sign(paired(14))}` : ''})`,
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
  if (days >= 21 && result.runs.farmer) {
    // v2-05: a full orchard of 8 trees is worth 5–8% of a player's daily gold from day 14 (the Farmer's trees are all
    // mature by day 12). Days 14–21 cover autumn and the first winter day, so three or more kinds bear.
    const w = orchardShare(result.runs.farmer, 14, 21);
    out.push({
      what: `${BOTS.farmer.name}: orchard income (days 14–21, a full orchard)`,
      target: '3%–8% of gold (a side income worth planting)',
      measured: `${fmtShare(w.share)} (${fmt(w.perDay)} gold a day)`,
      ok: w.share >= 0.03 && w.share <= 0.08,
    });
  }
  if (days >= 14 && result.runs.active) {
    const w = orchardShare(result.runs.active, 7, 14);
    out.push({
      what: `${BOTS.active.name}: orchard income (days 7–14)`,
      target: '≤ 15% of gold (side income)',
      measured: `${pct(w.share)} (${fmt(w.perDay)} gold a day)`,
      ok: w.share <= 0.15,
    });
  }
  if (days >= 14) {
    for (const b of ['farmer', 'active'] as const) {
      if (!result.runs[b]) continue;
      const w = animalShare(result.runs[b]!, 14, days);
      out.push({
        what: `${BOTS[b].name}: animal income (days 14–${days})`,
        target: '≤ 15% of gold (side income)',
        measured: `${pct(w.share)} (${fmt(w.perDay)} gold a day)`,
        ok: w.share <= 0.15,
      });
    }
  }
  // v4-01 (BALANCE §14.9): the north fields' share of crop gold from day 14, and the North Fields' payback.
  if (days >= 21) {
    const bands: [BotId, number, number][] = [
      ['farmer', 0.25, 0.45],
      ['chef', 0.2, 0.45],
      ['active', 0.15, 0.4],
    ];
    for (const [b, lo, hi] of bands) {
      if (!result.runs[b]) continue;
      const w = northShare(result.runs[b]!, 14, days);
      out.push({
        what: `${BOTS[b].name}: north fields' share of crop gold (days 14–${days})`,
        target: `${pct(lo)}–${pct(hi)}`,
        measured: `${pct(w.total)} (${pct(w.north_fields)} · ${pct(w.terraces)})`,
        ok: w.total >= lo && w.total <= hi,
      });
    }
    if (result.runs.farmer) {
      const d = northPayback(result.runs.farmer, 'north_fields');
      out.push({
        what: `${BOTS.farmer.name}: the North Fields pay back`,
        target: '≤ 10 days after buying (gross)',
        measured: d === null ? 'not bought' : Number.isFinite(d) ? `${fmt(d, 1)} days` : 'not yet',
        ok: d !== null && d <= 10,
      });
    }
  }
  out.push(...spendChecks(result));
  return out;
}

/**
 * The target share of the catalogue still to spend, by day: [low, high]. v4-01 moves days 7–30 to BALANCE.md §14.8's
 * v4 curve (the north's land is most of v4's catalogue); days 1 and 3 keep §13.4's.
 */
export const SPEND_TARGETS: Readonly<
  Partial<Record<BotId, Readonly<Record<number, readonly [number, number]>>>>
> = {
  active: { 1: [0.99, 1], 3: [0.97, 1], 7: [0.9, 0.97], 14: [0.75, 0.9], 21: [0.6, 0.8], 30: [0.4, 0.6] },
  farmer: { 1: [0.99, 1], 3: [0.9, 0.97], 7: [0.85, 0.95], 14: [0.55, 0.75], 21: [0.3, 0.5], 30: [0.1, 0.3] },
};
/**
 * What the bots never buy, as a share of the catalogue: below this nothing is "still to buy". The v1 content the wish
 * lists skip (140–180k) and, since v2-05's fruit prices, the two saplings that only fit once the Orchard Basket adds
 * its spots (a cherry and a lemon, 206,000): the bots end day 30 with 3.1–3.5% of the catalogue left (it was 2%).
 */
export const SPEND_FLOOR = 0.04;
/** ±10 points around the target bands is fine. */
export const SPEND_TOLERANCE = 0.1;

/** BALANCE.md §13.4's three checks: gold stays meaningful, the curve, and no hoard. */
export function spendChecks(result: SimResult): Check[] {
  const out: Check[] = [];
  const total = catalogueTotal(GAME_DATA);
  const days = result.days;
  const bots = (Object.keys(result.runs) as BotId[]).filter(
    (b) => STRATEGY_BOTS.includes(b) || b === 'active',
  );
  for (const b of bots) {
    const runs = result.runs[b]!;
    if (days >= 21) {
      const d21 = toSpendAtDay(runs, 21, total).gold;
      out.push({
        what: `${BOTS[b].name}: gold stays meaningful (day 21)`,
        target: 'gold still to spend > 0',
        measured: fmt(d21),
        ok: d21 > 0,
      });
    }
    if (b === 'active' && days >= 30) {
      const left = toSpendAtDay(runs, 30, total).gold;
      const inHand = median(runs.map((r) => snapshotAt(r, 30 * DAY).gold));
      out.push({
        what: 'Active Player: gold still to spend on day 30',
        target: '> 0 and more than the gold in hand',
        measured: `${fmt(left)} to spend vs ${fmt(inHand)} in hand`,
        ok: left > 0 && left > inHand,
      });
    }
    const targets = SPEND_TARGETS[b];
    if (targets) {
      for (const d of SPEND_DAYS.filter((x) => x <= days)) {
        const band = targets[d];
        if (!band) continue;
        const share = toSpendAtDay(runs, d, total).share;
        out.push({
          what: `${BOTS[b].name}: share still to spend, day ${d}`,
          target: `${pct(band[0])}–${pct(band[1])} (±10 points)`,
          measured: pct(share),
          ok: share >= band[0] - SPEND_TOLERANCE && share <= band[1] + SPEND_TOLERANCE,
        });
      }
    }
    if (days >= 8) {
      // After day 7, while something is left to buy, no day ends holding more than three days' income. A few
      // v1 upgrades the bots' wish lists skip (about 1% of the catalogue) never get bought, so "something" is
      // more than SPEND_FLOOR of the catalogue.
      const worst = runs.map((r) => {
        let w = 0;
        for (const snap of r.metrics.snapshots) {
          if (snap.realMs < 7 * DAY || snap.toSpend <= SPEND_FLOOR * total) continue;
          const before = snapshotAt(r, snap.realMs - DAY).lifetimeGold;
          const income = Math.max(1, snap.lifetimeGold - before);
          // v4-01: gold put by for a parcel the farm can buy (a north field costs days of income) is not a hoard.
          w = Math.max(w, Math.max(0, snap.gold - snap.parcelSaving) / income);
        }
        return w;
      });
      const m = median(worst);
      out.push({
        what: `${BOTS[b].name}: no hoard after day 7`,
        target:
          'gold in hand (less savings for a parcel on sale) ≤ 3 days’ income while there is still something to buy',
        measured: `${fmt(m, 2)} days’ income at worst (median over seeds)`,
        ok: m <= 3,
      });
    }
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
