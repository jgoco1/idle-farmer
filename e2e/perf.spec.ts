// Phase 09 performance check: the render loop on a fully expanded, fully automated farm (8 × 6
// field, 12 greenhouse plots, sprinklers and scarecrows, the farmhand at work, nine traps, a busy
// stove and buffs). It measures, over a few seconds of real frames in headless Chromium:
//   - main-thread script and task time per frame (CDP Performance metrics),
//   - bytes allocated per frame (the sampling heap profiler, counting objects already collected;
//     PERF_PROFILE=1 also writes the raw profile to test-results/heap.json),
// and writes them to test-results/perf.json for docs/PROGRESS.md. v2 phase 01 runs it twice: on the
// farm at the default view, and on the full world (every parcel owned) while the camera shows the
// whole world at 1× and then pans across it at the default zoom with the arrow keys. Headless Chromium draws the
// canvas in software, so the frame budget here is a pessimistic stand-in for a mid-range laptop.

import { expect, test } from '@playwright/test';

type Result = {
  frames: number;
  fps: number;
  p95FrameMs: number;
  worstFrameMs: number;
  scriptMsPerFrame: number;
  taskMsPerFrame: number;
  bytesPerFrame: number;
  heapUsedMB: number;
};
type Win = { __game: { state: Record<string, unknown>; dispatch(a: unknown): { ok: boolean } } };

for (const scenario of ['farm', 'world'] as const)
  test(`a fully automated farm renders well inside a 60 fps frame, without per-frame garbage (${scenario})`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
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
      s.fishing.traps = (['pond', 'pond', 'river', 'river', 'ocean', 'ocean'] as const).map(
        (location, i) => ({
          id: i + 1,
          location,
          slot: i % 2,
          progressMs: 0,
          contents: i % 2 ? [{ item: 'bluegill', qty: 2 }] : [],
        }),
      );
      s.kitchen.queue = [
        { recipe: 'roasted_turnip', remainingMs: 600_000 },
        { recipe: 'baked_potato', remainingMs: 600_000 },
      ];
    });
    if (scenario === 'world') {
      await page.evaluate(() => {
        const s = (window as unknown as Win).__game.state as {
          land: { parcels: string[] };
          orchard: { trees: unknown[] };
          calendar: { maxDayIndex: number };
          ranch: { buildings: unknown[]; animals: unknown[] };
        };
        s.land.parcels = ['orchard', 'yard', 'meadow', 'north_fields', 'terraces'];
        // v4-01: both north fields planted and automated, with a sprinkler and a scarecrow each.
        const st = s as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
        const crops = ['turnip', 'potato', 'garlic', 'strawberry', 'cauliflower'];
        for (const [field, n] of [
          ['north_fields', 32],
          ['terraces', 24],
        ] as const) {
          st.farm.north[field] = {
            plots: Array.from({ length: n }, (_, i) => ({
              state: 'planted',
              crop: crops[i % crops.length],
              growthMs: (i * 41_000) % 240_000,
              harvests: 0,
              waterMsLeft: 0,
            })),
            lastPlantedCrop: Array.from({ length: n }, (_, i) => crops[i % crops.length]),
          };
        }
        st.upgrades.sprinkler = 11;
        st.upgrades.scarecrow = 4;
        st.placed.push(
          { id: 20, kind: 'sprinkler', at: { col: 2, row: 1 }, field: 'north_fields' },
          { id: 21, kind: 'scarecrow', at: { col: 5, row: 2 }, field: 'north_fields' },
          { id: 22, kind: 'sprinkler', at: { col: 2, row: 1 }, field: 'terraces' },
          { id: 23, kind: 'scarecrow', at: { col: 5, row: 1 }, field: 'terraces' },
        );
        // The orchard in full: eight trees of every stage and kind, some laden (v2 phase 03).
        const kinds = ['cherry', 'apricot', 'peach', 'apple', 'pear', 'persimmon', 'lemon', 'apple'];
        const ages = [1, 2, 3, 40, 40, 40, 40, 40];
        s.orchard.trees = kinds.map((k, i) => ({
          id: i + 1,
          tree: `${k}_tree`,
          spot: i,
          plantedDay: -ages[i]!,
          fruit: i < 3 ? 0 : 8 + i * 3,
          lastFruitDay: 0,
        }));
        // The ranch in full (v2 phase 04): a level 3 coop and barn, a level 2 silo, 12 hens and 6 cows wandering.
        s.ranch.buildings = [
          { id: 1, kind: 'coop', level: 3, at: { col: 22, row: 9 }, trough: 150, store: [], cycleMs: 0 },
          { id: 2, kind: 'barn', level: 3, at: { col: 27, row: 9 }, trough: 60, store: [], cycleMs: 0 },
          { id: 3, kind: 'silo', level: 2, at: { col: 33, row: 9 }, trough: 0, store: [], cycleMs: 0 },
        ];
        s.ranch.animals = [
          ...Array.from({ length: 12 }, (_, i) => ({
            id: i + 1,
            kind: 'chicken',
            name: `Hen ${i}`,
            building: 1,
          })),
          ...Array.from({ length: 6 }, (_, i) => ({
            id: i + 13,
            kind: 'cow',
            name: `Cow ${i}`,
            building: 2,
          })),
        ];
        // v4-04: the whole north in use: the restaurant serving at four tables, four presses at work, six hives,
        // the woods with something on every spot, and the mountain lake with its two traps.
        st.restaurant = {
          level: 3,
          menu: Array.from({ length: 4 }, (_, i) => ({
            item: 'vegetable_soup',
            qty: 50,
            hearty: false,
            cycleMs: i * 60_000,
          })),
          today: { day: st.calendar.maxDayIndex, gold: 0, served: 0 },
        };
        st.press = {
          level: 3,
          slots: Array.from({ length: 4 }, (_, i) => ({
            recipe: 'apple_cider',
            remainingMs: 600_000 * (i + 1),
            done: i,
            repeat: true,
          })),
        };
        st.apiary = {
          hives: Array.from({ length: 6 }, (_, i) => ({ id: i + 1, spot: i, honey: i * 2, cycleMs: 0 })),
        };
        st.expansions.push('lake');
        st.upgrades.fish_trap = 8;
        st.upgrades.forager_basket = 1;
        st.fishing.traps.push(
          { id: 7, location: 'lake', slot: 0, progressMs: 0, contents: [] },
          { id: 8, location: 'lake', slot: 1, progressMs: 0, contents: [{ item: 'whitefish', qty: 1 }] },
        );
        const finds = ['morel', 'wild_mint', 'morel', 'wild_mint', 'elderflower', null, 'elderflower', null];
        st.forage = {
          spots: finds.map((item, spot) => ({
            spot,
            item,
            qty: item ? 4 : 0,
            lastDay: st.calendar.maxDayIndex,
          })),
        };
      });
    }
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

    /** One measurement: a few seconds of real frames (and, in the world scenario, the camera sweep). */
    const measureOnce = async (keepProfile: boolean): Promise<Result> => {
      await page.evaluate(() => ((window as unknown as { __frames: number[] }).__frames.length = 0));
      await frames();
      const before = await metrics();
      await cdp.send('HeapProfiler.startSampling', {
        samplingInterval: 512,
        includeObjectsCollectedByMajorGC: true,
        includeObjectsCollectedByMinorGC: true,
      });
      if (scenario === 'world') {
        // The whole world at 1×, then a pan right, down and back left at the default zoom.
        for (let i = 0; i < 8; i++) await page.keyboard.press('-');
        await page.waitForTimeout(1000);
        await page.keyboard.press('h');
        await page.waitForTimeout(300);
        for (const key of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']) {
          await page.keyboard.down(key);
          await page.waitForTimeout(900);
          await page.keyboard.up(key);
        }
      } else await page.waitForTimeout(4000);
      const { profile } = await cdp.send('HeapProfiler.stopSampling');
      const after = await metrics();
      const times = await page.evaluate(() => (window as unknown as { __frames: number[] }).__frames);
      const n = times.length;
      const gaps = times.slice(1).map((t, i) => t - times[i]!);
      const sorted = [...gaps].sort((a, b) => a - b);
      const allocated = profile.samples.reduce((sum, x) => sum + x.size, 0);
      if (keepProfile && process.env.PERF_PROFILE)
        await import('node:fs').then((fs) =>
          fs.writeFileSync('test-results/heap.json', JSON.stringify(profile)),
        );
      return {
        frames: n,
        fps: (n - 1) / ((times[n - 1]! - times[0]!) / 1000),
        p95FrameMs: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
        worstFrameMs: sorted[sorted.length - 1] ?? 0,
        scriptMsPerFrame: ((after.ScriptDuration! - before.ScriptDuration!) * 1000) / n,
        taskMsPerFrame: ((after.TaskDuration! - before.TaskDuration!) * 1000) / n,
        bytesPerFrame: allocated / n,
        heapUsedMB: after.JSHeapUsedSize! / 1e6,
      };
    };

    // Warm up first (the JIT and the sprite caches settle), then take three measurements and judge the median of
    // each number, so one noisy second on a loaded machine does not decide the test. The budgets are not loosened.
    await measureOnce(false);
    const runs: Result[] = [];
    for (let i = 0; i < 3; i++) runs.push(await measureOnce(i === 2));
    const med = (pick: (r: Result) => number): number => [...runs.map(pick)].sort((a, b) => a - b)[1]!;
    const result: Result = {
      frames: med((r) => r.frames),
      fps: med((r) => r.fps),
      p95FrameMs: med((r) => r.p95FrameMs),
      worstFrameMs: med((r) => r.worstFrameMs),
      scriptMsPerFrame: med((r) => r.scriptMsPerFrame),
      taskMsPerFrame: med((r) => r.taskMsPerFrame),
      bytesPerFrame: med((r) => r.bytesPerFrame),
      heapUsedMB: med((r) => r.heapUsedMB),
    };
    const { scriptMsPerFrame, bytesPerFrame } = result;
    console.info(
      `render perf (${scenario}): median of 3 ${JSON.stringify(result)}; bytes per frame ${runs.map((r) => Math.round(r.bytesPerFrame)).join(' / ')}`,
    );
    await import('node:fs').then((fs) =>
      fs.writeFileSync(`test-results/perf-${scenario}.json`, JSON.stringify({ ...result, runs }, null, 2)),
    );
    await page.screenshot({ path: `test-results/perf-${scenario}.png` });

    expect(result.fps).toBeGreaterThan(50);
    expect(scriptMsPerFrame).toBeLessThan(8); // half a 16.7 ms frame, in software rendering
    expect(bytesPerFrame).toBeLessThan(11_000); // was ~34 KB before phase 09's allocation pass; 12 KB until v2-03, which found the rest
    expect(result.worstFrameMs).toBeLessThan(50); // no visible garbage-collection hitch
  });

test('loading after 8 hours away with that farm (and the whole north in use) catches up within the 125 ms budget', async ({
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
    // v4-01: every field automated: both north fields tilled, with the planter's memory and two sprinklers each.
    s.land.parcels = ['orchard', 'yard', 'north_fields', 'terraces'];
    for (const [field, n] of [
      ['north_fields', 32],
      ['terraces', 24],
    ] as const)
      s.farm.north[field] = {
        plots: Array.from({ length: n }, () => ({
          state: 'tilled',
          crop: null,
          growthMs: 0,
          harvests: 0,
          waterMsLeft: 0,
        })),
        lastPlantedCrop: Array.from({ length: n }, (_, i) => (i % 2 ? 'potato' : 'turnip')),
      };
    Object.assign(s.upgrades, {
      farmhand: 5,
      seed_planter: 3,
      auto_seller: 2,
      sprinkler: 12,
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
    s.placed.push(
      { id: 9, kind: 'sprinkler', at: { col: 2, row: 1 }, field: 'north_fields' },
      { id: 10, kind: 'sprinkler', at: { col: 5, row: 2 }, field: 'north_fields' },
      { id: 11, kind: 'sprinkler', at: { col: 2, row: 1 }, field: 'terraces' },
      { id: 12, kind: 'sprinkler', at: { col: 5, row: 1 }, field: 'terraces' },
    );
    const savedAt = Date.now() - 8 * 3_600_000;
    // v4-04: the whole north in use while away: the restaurant serving, the presses keeping on, the hives, the woods
    // (opened on load) with the Forager's Basket, and the mountain lake's two traps with the Trap Collector.
    s.expansions.push('lake');
    Object.assign(s.upgrades, { kitchen: 2, fish_trap: 2, trap_collector: 1, forager_basket: 1 });
    s.fishing.traps = (['lake', 'lake'] as const).map((location, i) => ({
      id: i + 1,
      location,
      slot: i,
      progressMs: 0,
      contents: [],
    }));
    s.restaurant = {
      level: 3,
      menu: Array.from({ length: 4 }, () => ({ item: 'vegetable_soup', qty: 99, hearty: false, cycleMs: 0 })),
      today: { day: s.calendar.maxDayIndex, gold: 0, served: 0 },
    };
    s.press = {
      level: 3,
      slots: Array.from({ length: 4 }, () => ({
        recipe: 'tomato_juice',
        remainingMs: 600_000,
        done: 0,
        repeat: true,
      })),
    };
    s.apiary = { hives: Array.from({ length: 6 }, (_, i) => ({ id: i + 1, spot: i, honey: 0, cycleMs: 0 })) };
    s.inventory.slots[2] = { item: 'tomato', qty: 400 };
    s.meta.lastSavedAt = savedAt;
    return JSON.stringify({ version: 18, savedAt, state: s });
  });
  await page.close();
  // A fresh page finds the save in place before the game starts (so the load is cold, as for a player). The
  // catch-up is measured three times and the median judged, so a busy machine does not decide the test.
  const times: number[] = [];
  let harvested = 0;
  for (let i = 0; i < 3; i++) {
    const fresh = await context.newPage();
    await fresh.addInitScript((save) => localStorage.setItem('hearthfield-idle/save', save), raw);
    await fresh.goto('./');
    await expect(fresh.locator('#scene-canvas')).toBeVisible();
    times.push(
      await fresh.evaluate(() => performance.getEntriesByName('hearthfield:catch-up')[0]?.duration ?? -1),
    );
    harvested = await fresh.evaluate(
      () =>
        ((window as unknown as Win).__game.state as { stats: { cropsHarvested: number } }).stats
          .cropsHarvested,
    );
    await fresh.close();
  }
  const ms = [...times].sort((a, b) => a - b)[1]!;
  console.info(
    `8 h catch-up on load: median ${ms.toFixed(1)} ms of ${times.map((t) => t.toFixed(1)).join(' / ')}, ${harvested} crops`,
  );
  await import('node:fs').then((fs) =>
    fs.writeFileSync(
      'test-results/perf-offline.json',
      JSON.stringify({ catchUpMs: ms, runs: times, harvested }, null, 2),
    ),
  );
  expect(harvested).toBeGreaterThan(1000);
  expect(ms).toBeGreaterThan(0);
  // 125 ms since v4-02 (100 ms before): the budget was set for v1's 48-plot farm, and this one automates 116 plots
  // with the orchard and the ranch. It read 80–100 ms in a cloud container after v4-02. Do not raise it again.
  expect(ms).toBeLessThan(125);
});
