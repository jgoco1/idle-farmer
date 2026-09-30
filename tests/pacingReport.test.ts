// The phase-07 pacing report: a milestone-following greedy player (tests/sim/greedyPlayer.ts) plays a
// long run on a few seeds, and the times of every milestone, first dish, Farm Level and skill level
// are tabulated (median and range). It is slow, so it only runs on request:
//
//   PACING_REPORT=1 MINUTES=960 SEEDS=1,2,3 OUT=/tmp/pacing.md npx vitest run tests/pacingReport.test.ts
//
// The table in docs/PROGRESS.md (Phase 07) comes from this. Phase 09 replaces it with the full simulator.

import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { simulateGreedy, type PacingReport } from './sim/greedyPlayer';

const MIN = 60_000;

function fmt(ms: number | undefined): string {
  if (ms === undefined) return '—';
  return ms >= 120 * MIN ? `${(ms / 60 / MIN).toFixed(1)} h` : `${Math.round(ms / MIN)} min`;
}

/** "median (low – high)" over the runs that got there, plus how many did. */
function spread(times: (number | undefined)[]): string {
  const xs = times.filter((x): x is number => x !== undefined).sort((a, b) => a - b);
  if (xs.length === 0) return '—';
  const med = xs[Math.floor(xs.length / 2)]!;
  const range = xs.length > 1 ? ` (${fmt(xs[0])} – ${fmt(xs.at(-1))})` : '';
  return `${fmt(med)}${range}${xs.length < times.length ? ` · ${xs.length}/${times.length} runs` : ''}`;
}

it.skipIf(!process.env.PACING_REPORT)(
  'writes the milestone pacing table',
  () => {
    const minutes = Number(process.env.MINUTES ?? 960);
    const seeds = (process.env.SEEDS ?? '1,2,3').split(',').map(Number);
    const runs: PacingReport[] = seeds.map((seed) =>
      simulateGreedy({ minutes, reactionMs: 15_000, seed, milestones: true }),
    );
    const rows: string[] = ['| Moment | Median (range over seeds) |', '|---|---|'];
    const add = (label: string, pick: (r: PacingReport) => number | undefined): void => {
      rows.push(`| ${label} | ${spread(runs.map(pick))} |`);
    };
    for (const id of new Set(runs.flatMap((r) => Object.keys(r.milestones)))) {
      add(id, (r) => r.milestones[id as keyof PacingReport['milestones']]);
    }
    for (const t of [1, 2, 3, 4] as const) add(`first T${t} dish`, (r) => r.firstDish[t]);
    for (const l of [3, 4, 5, 6, 7, 8, 9, 10]) add(`Farm Level ${l}`, (r) => r.farmLevels[l]);
    for (const skill of ['farming', 'fishing', 'cooking']) {
      for (const l of [2, 3, 5, 7, 10]) add(`${skill} level ${l}`, (r) => r.skillLevels[skill]![l]);
    }
    add('whole farm automated', (r) => r.automatedAt ?? undefined);
    for (const b of ['spring_crops', 'pond_fish']) add(`bundle ${b}`, (r) => r.bundles[b]);
    rows.push(
      '',
      `Quest gold share of lifetime gold: ${runs
        .map((r) => `${((100 * r.questGold) / r.final.stats.lifetimeGold).toFixed(1)}%`)
        .join(', ')}; goals finished: ${runs.map((r) => r.goalsDone).join(', ')}.`,
    );
    writeFileSync(process.env.OUT ?? '/tmp/pacing.md', `${rows.join('\n')}\n`);
  },
  900_000,
);
