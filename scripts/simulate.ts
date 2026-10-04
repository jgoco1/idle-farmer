// `npm run simulate`: the phase-09 headless simulator. Plays the strategy bots (scripts/sim/bots.ts)
// through the real systems for N real days on several seeds, prints a markdown report and writes
// CSV files to scripts/out/ (gitignored). Each bot runs in its own worker thread.
//
//   npm run simulate                          # all bots, 30 days, seeds 1–5
//   npm run simulate -- --days 7 --seeds 1,2 --bots farmer,idler
//   npm run simulate -- --quick               # skip the buffs check's own 24 Chef seeds
//
// Deterministic: the same seeds and days always print the same report (apart from the timing line).

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { ALL_BOTS, runBot, type BotId } from './sim/bots';
import {
  BUFF_DAYS,
  BUFF_SEEDS,
  csvFiles,
  markdownReport,
  type RunResult,
  type SimResult,
} from './sim/report';

interface Job {
  bot: BotId;
  seeds: number[];
  days: number;
}

function play(job: Job): RunResult[] {
  return job.seeds.map((seed) => {
    const run = runBot(job.bot, { seed, days: job.days });
    return { metrics: run.metrics, state: run.state };
  });
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const days = Number(arg('days') ?? 30);
  const seeds = (arg('seeds') ?? '1,2,3,4,5').split(',').map(Number);
  const bots = (arg('bots')?.split(',') ?? ALL_BOTS) as BotId[];
  const outDir = arg('out') ?? join('scripts', 'out');
  for (const b of bots) {
    if (!ALL_BOTS.includes(b)) throw new Error(`Unknown bot "${b}" (have: ${ALL_BOTS.join(', ')})`);
  }
  const t0 = performance.now();
  const self = fileURLToPath(import.meta.url);
  const work = (job: Job): Promise<RunResult[]> =>
    new Promise<RunResult[]>((resolve, reject) => {
      const worker = new Worker(self, { workerData: job });
      worker.once('message', resolve);
      worker.once('error', reject);
    });
  // The buffs check runs the two Chefs on its own seeds (BUFF_SEEDS) unless the run already has as many;
  // `--quick` skips it (the check then uses the run's own seeds). Split in halves so it adds little wall time.
  const buffDays = Math.min(BUFF_DAYS, days);
  const buffPair =
    bots.includes('chef') &&
    bots.includes('chef_sells') &&
    seeds.length < BUFF_SEEDS.length &&
    !process.argv.includes('--quick');
  const halves = [BUFF_SEEDS.slice(0, BUFF_SEEDS.length / 2), BUFF_SEEDS.slice(BUFF_SEEDS.length / 2)];
  const buffJobs: Job[] = buffPair
    ? (['chef', 'chef_sells'] as const).flatMap((bot) =>
        halves.map((s) => ({ bot, seeds: s, days: buffDays })),
      )
    : [];
  const [results, buffResults] = await Promise.all([
    Promise.all(bots.map((bot) => work({ bot, seeds, days }))),
    Promise.all(buffJobs.map(work)),
  ]);
  const runs: SimResult['runs'] = {};
  bots.forEach((bot, i) => (runs[bot] = results[i]));
  const result: SimResult = { seeds, days, runs, elapsedMs: performance.now() - t0 };
  if (buffPair)
    result.buffRuns = {
      seeds: [...BUFF_SEEDS],
      days: buffDays,
      chef: [...buffResults[0]!, ...buffResults[1]!],
      chef_sells: [...buffResults[2]!, ...buffResults[3]!],
    };

  const report = markdownReport(result);
  console.log(report);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'sim-report.md'), report + '\n');
  for (const [name, text] of Object.entries(csvFiles(result))) writeFileSync(join(outDir, name), text);
  console.error(
    `\nWrote ${outDir}/sim-report.md and CSV files in ${((performance.now() - t0) / 1000).toFixed(1)} s.`,
  );
}

if (isMainThread) {
  main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
} else {
  parentPort!.postMessage(play(workerData as Job));
}
