// v4 phase 01: the North and its fields. Scroll north, buy the North Fields from its sign, till, plant
// and harvest a north plot, watch the farmhand walk up the north road to it, and the phase screenshots
// (the north by day with a field farmed, the north at night, a phone scrolled north).

import { expect, test, type Page } from '@playwright/test';
import { camera, clickTile, fieldPlotTile, shot, tilePoint, type WithView } from './helpers';

type Plot = { state: string; crop: string | null; growthMs: number; waterMsLeft: number };
type Win = WithView & {
  __view: { farmhand(): { x: number; y: number; area: string } };
  __game: {
    state: {
      gold: number;
      land: { parcels: string[] };
      progression: { farmLevelFloor: number };
      calendar: { debugOffsetMs: number };
      upgrades: Record<string, number>;
      automation: { farmhandCooldownMs: number };
      farm: { north: Record<string, { plots: Plot[]; lastPlantedCrop: (string | null)[] } | undefined> };
      inventory: { slots: ({ item: string; qty: number } | null)[] };
    };
    dispatch(action: unknown): { ok: boolean; reason?: string };
  };
};

const splashGone = (page: Page): Promise<void> => expect(page.locator('#splash')).toHaveCount(0);

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

const northPlots = (page: Page): Promise<Plot[]> =>
  page.evaluate(() => (window as unknown as Win).__game.state.farm.north.north_fields?.plots ?? []);

/** Test shortcut: a farm that can buy the North Fields (the Old Paddock, the Back Forty, Farm Level 8, gold). */
async function readyForTheNorth(page: Page): Promise<void> {
  await page.evaluate(() => {
    const game = (window as unknown as Win).__game;
    game.state.progression.farmLevelFloor = 8;
    game.state.gold = 10_000_000;
    for (const id of ['farm_1', 'farm_2', 'farm_3', 'farm_4']) game.dispatch({ type: 'buyExpansion', id });
    for (const parcel of ['orchard', 'yard']) game.dispatch({ type: 'buyParcel', parcel });
    game.state.gold = 4_000_000;
  });
}

async function setLocalTime(page: Page, hour: number): Promise<void> {
  await page.evaluate((hr) => {
    const g = (window as unknown as Win).__game;
    const d = new Date();
    d.setHours(hr, 0, 0, 0);
    g.state.calendar.debugOffsetMs = d.getTime() - Date.now();
  }, hour);
  await page.waitForTimeout(150);
}

test('scroll north, buy the North Fields from its sign, farm a north plot and watch the farmhand reach it; screenshots', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('./');
  await splashGone(page);
  await readyForTheNorth(page);
  await setLocalTime(page, 11);

  // Scroll north with the mouse: the view travels up past row 0 and stops at the tree line.
  const start = await camera(page);
  const mid = await tilePoint(page, 10, 4);
  for (let i = 0; i < 3; i++) {
    await page.mouse.move(mid.x, mid.y - 200);
    await page.mouse.down();
    await page.mouse.move(mid.x, mid.y + 250, { steps: 8 });
    await page.mouse.up();
  }
  const north = await camera(page);
  expect(north.y).toBeLessThan(start.y - 100);
  expect(north.y).toBeLessThan(0); // the view is centred above row 0
  expect(await page.evaluate(() => (window as unknown as Win).__view.tileClient(18, -6).visible)).toBe(true);

  // The North Fields' sign: a dialog with the price, then the field is ours with its 32 untilled plots.
  await clickTile(page, 18, -6);
  const dialog = page.getByRole('dialog', { name: 'For sale: North Fields' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Buy · 3,000,000g' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Win).__game.state.land.parcels))
    .toContain('north_fields');
  await expect(page.locator('#toasts')).toContainText('North Fields is yours!');
  expect(await northPlots(page)).toHaveLength(32);

  // Auto on a north plot: till, then plant the chosen turnip, then water; ready, then harvest.
  const [c0, r0] = fieldPlotTile('north_fields', 0);
  await clickTile(page, c0, r0);
  expect((await northPlots(page))[0]!.state).toBe('tilled');
  await clickTile(page, c0, r0);
  expect((await northPlots(page))[0]).toMatchObject({ state: 'planted', crop: 'turnip' });
  await clickTile(page, c0, r0);
  expect((await northPlots(page))[0]!.waterMsLeft).toBeGreaterThan(0);
  await page.evaluate(() => {
    (window as unknown as Win).__game.state.farm.north.north_fields!.plots[0]!.growthMs = 120_000;
  });
  await clickTile(page, c0, r0);
  expect((await northPlots(page))[0]!.state).toBe('tilled');
  await expect(page.locator('#toasts')).toContainText('Turnip');

  // Shift-click with the Hoe tills the whole North Fields (and nothing at home); Shift-click Auto plants it.
  const tools = page.getByRole('group', { name: 'Farming tools' });
  await tools.locator('[data-tool="hoe"]').click();
  await clickTile(page, ...fieldPlotTile('north_fields', 9), { modifiers: ['Shift'] });
  await expect.poll(async () => (await northPlots(page)).every((p) => p.state === 'tilled')).toBe(true);
  await tools.locator('[data-tool="auto"]').click();
  await page.evaluate(() => {
    const g = (window as unknown as Win).__game;
    g.dispatch({ type: 'buySeeds', crop: 'turnip', qty: 40 });
  });
  await clickTile(page, ...fieldPlotTile('north_fields', 1), { modifiers: ['Shift'] });
  await expect
    .poll(async () => (await northPlots(page)).filter((p) => p.state === 'planted').length)
    .toBeGreaterThan(20);

  // The farmhand is hired at home; a ready north crop sends it up the north road and in through the gate.
  await page.evaluate(() => {
    const g = (window as unknown as Win).__game;
    g.state.upgrades.farmhand = 5;
    g.state.automation.farmhandCooldownMs = 500;
    for (let i = 24; i < 32; i++) {
      const p = g.state.farm.north.north_fields!.plots[i]!;
      Object.assign(p, { state: 'planted', crop: 'turnip', growthMs: 120_000 });
    }
  });
  await expect
    .poll(async () => (await northPlots(page)).slice(24).filter((p) => p.state === 'planted').length, {
      timeout: 5000,
    })
    .toBe(0);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Win).__view.farmhand().area), { timeout: 5000 })
    .toBe('north_fields');
  // It walks in: its feet end up inside the field's fence or by its gate (rows −7 … −2 are y −112 … −16).
  await expect
    .poll(
      async () => {
        const f = await page.evaluate(() => (window as unknown as Win).__view.farmhand());
        return f.y < -16 && f.y > -112 && f.x > 5 * 16 && f.x < 16 * 16;
      },
      { timeout: 15_000 },
    )
    .toBe(true);

  // Screenshots: the north by day with a field farmed, then at night.
  await page.evaluate(() => (window as unknown as Win).__view.showTile(14, -6));
  await page.mouse.move(0, 0);
  await page.evaluate(() => document.getElementById('toasts')!.replaceChildren());
  await page.waitForTimeout(500);
  await page.screenshot({ path: shot('v4-01-north-day.png') });
  await setLocalTime(page, 23);
  await page.waitForTimeout(400);
  await page.screenshot({ path: shot('v4-01-north-night.png') });

  // Home still frames the farm exactly as before.
  await page.getByRole('button', { name: 'Back to the farm' }).click();
  await expect.poll(async () => (await camera(page)).default).toBe(true);
  // The north band stays out of the default view: its top edge is row 0, as before v4.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Win).__view.tileClient(6, -1).visible))
    .toBe(false);
  expect(await page.evaluate(() => (window as unknown as Win).__view.tileClient(6, 0).visible)).toBe(true);
  expect(errors).toEqual([]);
});

test.describe('phone 390x844', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('one finger scrolls all the way north to the lake; screenshot', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('./');
    await splashGone(page);
    await setLocalTime(page, 11);
    const start = await camera(page);
    const scene = (await page.locator('#scene').boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    for (let k = 0; k < 6; k++) {
      const x = scene.x + scene.width / 2;
      const y = scene.y + 80;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      for (let i = 1; i <= 8; i++)
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: x - 20 * i, y: y + (scene.height - 160) * (i / 8) }],
        });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }
    await cdp.detach();
    await page.waitForTimeout(400);
    const top = await camera(page);
    expect(top.y).toBeLessThan(start.y - 200);
    // At the tree line: the lake is in view and nothing above the world's edge is.
    expect(await page.evaluate(() => (window as unknown as Win).__view.tileClient(30, -12).visible)).toBe(
      true,
    );
    await page.screenshot({ path: shot('v4-01-phone-north.png') });
    expect(errors).toEqual([]);
  });
});
