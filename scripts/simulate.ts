// `npm run simulate`: the phase-09 headless simulator. Plays the strategy bots (scripts/sim/bots.ts)
// through the real systems for N real days on several seeds, prints a markdown report and writes
// CSV files to scripts/out/ (gitignored). Each bot runs in its own worker thread.
//
//   npm run simulate                          # all bots, 30 days, seeds 1–5
//   npm run simulate -- --days 7 --seeds 1,2 --bots farmer,idler
//
// Deterministic: the same seeds and days always print the same report (apart from the timing line).

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { ALL_BOTS, runBot, type BotId } from './sim/bots';
import { csvFiles, markdownReport, type RunResult, type SimResult } from './sim/report';

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
  const results = await Promise.all(
    bots.map(
      (bot) =>
        new Promise<RunResult[]>((resolve, reject) => {
          const worker = new Worker(self, { workerData: { bot, seeds, days } satisfies Job });
          worker.once('message', resolve);
          worker.once('error', reject);
        }),
    ),
  );
  const runs: SimResult['runs'] = {};
  bots.forEach((bot, i) => (runs[bot] = results[i]));
  const result: SimResult = { seeds, days, runs, elapsedMs: performance.now() - t0 };

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
