// Phase 09 performance check: the render loop on a fully expanded, fully automated farm (8 × 6
// field, 12 greenhouse plots, sprinklers and scarecrows, the farmhand at work, nine traps, a busy
// stove and buffs). It measures, over a few seconds of real frames in headless Chromium:
//   - main-thread script and task time per frame (CDP Performance metrics),
//   - bytes allocated per frame (the sampling heap profiler, counting objects already collected;
//     PERF_PROFILE=1 also writes the raw profile to test-results/heap.json),
// and writes them to test-results/perf.json for docs/PROGRESS.md. Headless Chromium draws the
// canvas in software, so the frame budget here is a pessimistic stand-in for a mid-range laptop.

import { expect, test } from '@playwright/test';

type Win = { __game: { state: Record<string, unknown>; dispatch(a: unknown): { ok: boolean } } };

test('a fully automated farm renders well inside a 60 fps frame, without per-frame garbage', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto('./');
  await expect(page.locator('#scene-canvas')).toBeVisible();

  await page.evaluate(() => {
    const game = (window as unknown as Win).__game;
    const s = game.state as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const crops = ['turnip', 'potato', 'garlic', 'strawberry', 'cauliflower'];
    s.expansions = ['farm_1', 'farm_2', 'farm_3', 'farm_4', 'river', 'ocean'];
    s.farm.grid = { cols: 8, rows: 6 };
    s.farm.plots = Array.from({ length: 48 }, (_, i) => ({
      state: 'planted',
      crop: crops[i % crops.length],
      growthMs: (i * 37_000) % 240_000,
      harvests: 0,
      waterMsLeft: 0,
    }));
    s.farm.greenhouse = Array.from({ length: 12 }, (_, i) => ({
      state: 'planted',
      crop: 'melon',
      growthMs: i * 60_000,
      harvests: 0,
      waterMsLeft: 0,
    }));
    s.lastPlantedCrop = Array.from({ length: 60 }, (_, i) => crops[i % crops.length]);
    s.upgrades = {
      ...s.upgrades,
      sprinkler: 9,
      sprinkler_tech: 2,
      scarecrow: 2,
      farmhand: 5,
      seed_planter: 3,
      auto_seller: 2,
      greenhouse: 2,
      fish_trap: 6,
      trap_collector: 1,
      kitchen: 3,
      barn_storage: 4,
    };
    s.automation.farmhandCooldownMs = 1000;
    const spots = [
      [1, 1, 'sprinkler'],
      [4, 1, 'sprinkler'],
      [7, 1, 'sprinkler'],
      [1, 4, 'sprinkler'],
      [4, 4, 'sprinkler'],
      [7, 4, 'sprinkler'],
      [2, 2, 'scarecrow'],
      [5, 3, 'scarecrow'],
    ] as const;
    s.placed = spots.map(([col, row, kind], i) => ({ id: i + 1, kind, at: { col, row } }));
    s.inventory.stackSize = 999;
    s.inventory.slots = s.inventory.slots.map((_: unknown, i: number) =>
      i < crops.length ? { item: `seed_${crops[i]}`, qty: 999 } : null,
    );
    s.fishing.traps = (['pond', 'pond', 'river', 'river', 'ocean', 'ocean'] as const).map((location, i) => ({
      id: i + 1,
      location,
      slot: i % 2,
      progressMs: 0,
      contents: i % 2 ? [{ item: 'bluegill', qty: 2 }] : [],
    }));
    s.kitchen.queue = [
      { recipe: 'roasted_turnip', remainingMs: 600_000 },
      { recipe: 'baked_potato', remainingMs: 600_000 },
    ];
  });
  // Let the farmhand start walking and the scene settle.
  await page.waitForTimeout(1500);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('HeapProfiler.enable');
  const frames = async (): Promise<number> =>
    page.evaluate(() => new Promise<number>((r) => requestAnimationFrame(() => r(performance.now()))));
  const metrics = async (): Promise<Record<string, number>> => {
    const m = await cdp.send('Performance.getMetrics');
    return Object.fromEntries(m.metrics.map((x) => [x.name, x.value]));
  };
  // Count frames in the page itself.
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number[] };
    w.__frames = [];
    const tick = (t: number): void => {
      w.__frames.push(t);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await frames();
  const before = await metrics();
  await cdp.send('HeapProfiler.startSampling', {
    samplingInterval: 512,
    includeObjectsCollectedByMajorGC: true,
    includeObjectsCollectedByMinorGC: true,
  });
  await page.waitForTimeout(4000);
  const { profile } = await cdp.send('HeapProfiler.stopSampling');
  const after = await metrics();
  const times = await page.evaluate(() => (window as unknown as { __frames: number[] }).__frames);

  const n = times.length;
  const gaps = times.slice(1).map((t, i) => t - times[i]!);
  const sorted = [...gaps].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  const scriptMsPerFrame = ((after.ScriptDuration! - before.ScriptDuration!) * 1000) / n;
  const taskMsPerFrame = ((after.TaskDuration! - before.TaskDuration!) * 1000) / n;
  const allocated = profile.samples.reduce((sum, x) => sum + x.size, 0);
  const bytesPerFrame = allocated / n;
  const result = {
    frames: n,
    fps: (n - 1) / ((times[n - 1]! - times[0]!) / 1000),
    p95FrameMs: p95,
    worstFrameMs: sorted[sorted.length - 1] ?? 0,
    scriptMsPerFrame,
    taskMsPerFrame,
    bytesPerFrame,
    heapUsedMB: after.JSHeapUsedSize! / 1e6,
  };
  console.info(`render perf: ${JSON.stringify(result)}`);
  if (process.env.PERF_PROFILE)
    await import('node:fs').then((fs) => fs.writeFileSync('test-results/heap.json', JSON.stringify(profile)));
  await import('node:fs').then((fs) =>
    fs.writeFileSync('test-results/perf.json', JSON.stringify(result, null, 2)),
  );
  await page.screenshot({ path: 'test-results/perf-farm.png' });

  expect(result.fps).toBeGreaterThan(50);
  expect(scriptMsPerFrame).toBeLessThan(8); // half a 16.7 ms frame, in software rendering
  expect(bytesPerFrame).toBeLessThan(12_000); // was ~34 KB before phase 09's allocation pass
  expect(result.worstFrameMs).toBeLessThan(50); // no visible garbage-collection hitch
});

test('loading after 8 hours away with that farm catches up in well under 100 ms', async ({
  page,
  context,
}) => {
  test.setTimeout(60_000);
  await page.goto('./');
  await expect(page.locator('#scene-canvas')).toBeVisible();
  // Build the farm and save it as if the player left eight hours ago.
  const raw = await page.evaluate(() => {
    const game = (window as unknown as Win).__game;
    const s = structuredClone(game.state) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    s.expansions = ['farm_1', 'farm_2', 'farm_3', 'farm_4', 'river', 'ocean'];
    s.farm.grid = { cols: 8, rows: 6 };
    s.farm.plots = Array.from({ length: 48 }, () => ({
      state: 'tilled',
      crop: null,
      growthMs: 0,
      harvests: 0,
      waterMsLeft: 0,
    }));
    s.lastPlantedCrop = Array.from({ length: 48 }, () => 'turnip');
    Object.assign(s.upgrades, {
      farmhand: 5,
      seed_planter: 3,
      auto_seller: 2,
      sprinkler: 8,
      sprinkler_tech: 2,
    });
    s.automation.farmhandCooldownMs = 9000;
    s.inventory.stackSize = 4000;
    s.inventory.slots = s.inventory.slots.map((_: unknown, i: number) =>
      i === 0 ? { item: 'seed_turnip', qty: 4000 } : i === 1 ? { item: 'seed_potato', qty: 4000 } : null,
    );
    const spots = [
      [1, 1],
      [4, 1],
      [7, 1],
      [1, 4],
      [4, 4],
      [7, 4],
      [3, 2],
      [5, 3],
    ];
    s.placed = spots.map(([col, row], i) => ({ id: i + 1, kind: 'sprinkler', at: { col, row } }));
    const savedAt = Date.now() - 8 * 3_600_000;
    s.meta.lastSavedAt = savedAt;
    return JSON.stringify({ version: 7, savedAt, state: s });
  });
  await page.close();
  // A fresh page finds the save in place before the game starts (so the load is cold, as for a player).
  const fresh = await context.newPage();
  await fresh.addInitScript((save) => localStorage.setItem('hearthfield-idle/save', save), raw);
  await fresh.goto('./');
  await expect(fresh.locator('#scene-canvas')).toBeVisible();
  const ms = await fresh.evaluate(
    () => performance.getEntriesByName('hearthfield:catch-up')[0]?.duration ?? -1,
  );
  const harvested = await fresh.evaluate(
    () =>
      ((window as unknown as Win).__game.state as { stats: { cropsHarvested: number } }).stats.cropsHarvested,
  );
  console.info(`8 h catch-up on load: ${ms.toFixed(1)} ms, ${harvested} crops`);
  await import('node:fs').then((fs) =>
    fs.writeFileSync('test-results/perf-offline.json', JSON.stringify({ catchUpMs: ms, harvested }, null, 2)),
  );
  expect(harvested).toBeGreaterThan(1000);
  expect(ms).toBeGreaterThan(0);
  expect(ms).toBeLessThan(100);
});
