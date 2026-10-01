// v2 phase 01: the world and its camera. Pan by mouse and by touch (a drag never runs a farm tool),
// pinch, wheel and keys, the Home button, buying a parcel from its sign and from Upgrades › Land,
// edge pips, the camera remembered in prefs, a phone run, and the phase screenshots.

import { expect, test, type Page } from '@playwright/test';
import { camera, clickTile, tilePoint, type WithView } from './helpers';

type Win = WithView & {
  __game: {
    state: {
      gold: number;
      expansions: string[];
      land: { parcels: string[] };
      progression: { farmLevelFloor: number };
      farm: { plots: { state: string; crop: string | null; growthMs: number; waterMsLeft: number }[] };
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

const plotStates = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as Win).__game.state.farm.plots.map((p) => `${p.state}:${p.crop}`));

/** Drags one finger from (x, y) by (dx, dy) through the DevTools protocol (Playwright has no touch drag). */
async function touchDrag(page: Page, x: number, y: number, dx: number, dy: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= 8; i++)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x + (dx * i) / 8, y: y + (dy * i) / 8 }],
    });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

/** Two fingers move apart (spread > 1) or together around (x, y). */
async function pinch(page: Page, x: number, y: number, from: number, to: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const pts = (d: number) => [
    { x: x - d / 2, y, id: 1 },
    { x: x + d / 2, y, id: 2 },
  ];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(from) });
  for (let i = 1; i <= 10; i++)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: pts(from + ((to - from) * i) / 10),
    });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

/** Test shortcut: a farm that can buy the Hilltop Orchard (gold, Farm Level 5 and the first three field steps). */
async function readyForLand(page: Page, gold: number): Promise<void> {
  await page.evaluate((g) => {
    const game = (window as unknown as Win).__game;
    game.state.progression.farmLevelFloor = 7;
    game.state.gold = 100_000;
    for (const id of ['farm_1', 'farm_2', 'farm_3']) game.dispatch({ type: 'buyExpansion', id });
    game.state.gold = g;
  }, gold);
}

test('pan by mouse never runs a tool; Home glides back; wheel, keys and the camera are remembered', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('./');
  await splashGone(page);
  const start = await camera(page);
  expect(start.default).toBe(true);

  // Drag starting on a tilled plot with the Auto tool selected: the view pans, the plot is untouched.
  const before = await plotStates(page);
  const from = await tilePoint(page, 6, 2);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x - 300, from.y + 10, { steps: 10 });
  await page.mouse.up();
  expect(await plotStates(page)).toEqual(before);
  const panned = await camera(page);
  expect(panned.x).toBeGreaterThan(start.x + 50);
  expect(panned.zoom).toBe(start.zoom);
  await expect.poll(async () => (await camera(page)).default).toBe(false);

  // The camera is remembered in prefs (not the save) across a reload.
  await page.waitForTimeout(300);
  const stored = await page.evaluate(
    () => JSON.parse(localStorage.getItem('hearthfield-idle/prefs') ?? '{}').camera as { x: number },
  );
  expect(stored.x).toBeCloseTo(panned.x, 0);
  expect(await page.evaluate(() => localStorage.getItem('hearthfield-idle/save') ?? '')).not.toContain(
    '"camera"',
  );
  await page.reload();
  await splashGone(page);
  expect((await camera(page)).x).toBeCloseTo(panned.x, 0);

  // Home glides back to the default view.
  await page.getByRole('button', { name: 'Back to the farm' }).click();
  await expect.poll(async () => Math.round((await camera(page)).x)).toBe(Math.round(start.x));
  await expect.poll(async () => (await camera(page)).default).toBe(true);

  // One wheel gesture is one zoom step around the cursor; the minus key steps back.
  const mid = await tilePoint(page, 10, 6);
  await page.mouse.move(mid.x, mid.y);
  await page.mouse.wheel(0, -120);
  await expect.poll(async () => (await camera(page)).zoom).toBe(start.zoom + 1);
  await page.keyboard.press('-');
  expect((await camera(page)).zoom).toBe(start.zoom);

  // Arrow keys pan by a tile per press.
  const k0 = await camera(page);
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => Math.round((await camera(page)).x)).toBe(Math.round(k0.x + 16));
  await page.keyboard.press('h');

  // Double-click on open ground zooms in.
  const z0 = (await camera(page)).zoom;
  const open = await tilePoint(page, 12, 8);
  await page.mouse.click(open.x, open.y);
  await page.mouse.click(open.x, open.y);
  await expect.poll(async () => (await camera(page)).zoom).toBe(z0 + 1);
  expect(errors).toEqual([]);
});

test('buy the Hilltop Orchard from its sign, the Old Paddock from Upgrades › Land; screenshots', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('./');
  await splashGone(page);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: 'docs/screenshots/v2-01-default-view.png' });

  // A locked sign says what it needs.
  await clickTile(page, 21, 3);
  await expect(page.locator('#toasts')).toContainText('For sale: Hilltop Orchard, 30,000g');
  await expect(page.locator('#toasts')).toContainText('Farm Level 5');

  await readyForLand(page, 200_000);
  await clickTile(page, 21, 3);
  const dialog = page.getByRole('dialog', { name: 'For sale: Hilltop Orchard' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Buy · 30,000g' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Win).__game.state.land.parcels))
    .toEqual(['orchard']);
  await expect(page.locator('#toasts')).toContainText('Hilltop Orchard is yours!');
  expect(await page.evaluate(() => (window as unknown as Win).__game.state.gold)).toBe(170_000);

  // Upgrades › Land: the paddock is next.
  await page.getByRole('button', { name: /Upgrades/ }).click();
  const upgrades = page.getByRole('dialog', { name: 'Upgrades' });
  const land = upgrades.locator('[data-section="land"]');
  await expect(land.locator('[data-upgrade="orchard"]')).toContainText('Yours');
  await expect(land.locator('[data-upgrade="meadow"]')).toContainText('Buy the Old Paddock first.');
  await land.getByRole('button', { name: 'Buy Old Paddock for 150000 gold' }).click();
  await expect(upgrades).toContainText('Old Paddock is yours!');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => (window as unknown as Win).__game.state.land.parcels)).toEqual([
    'orchard',
    'yard',
  ]);

  // Zoomed all the way out, the whole world fits.
  for (let i = 0; i < 6; i++) await page.getByRole('button', { name: 'Zoom out' }).click();
  expect((await camera(page)).zoom).toBe(1);
  expect(await page.evaluate(() => (window as unknown as Win).__view.chunksDrawn())).toBe(6);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(400);
  await page.evaluate(() => document.getElementById('toasts')!.replaceChildren());
  await page.screenshot({ path: 'docs/screenshots/v2-01-whole-world.png' });

  // Zoomed in on home, only the chunks in view are drawn.
  await page.getByRole('button', { name: 'Back to the farm' }).click();
  for (let i = 0; i < 2; i++) await page.getByRole('button', { name: 'Zoom in' }).click();
  expect((await camera(page)).zoom).toBe(5); // 256 × 144 world px in view
  await page.evaluate(() => (window as unknown as Win).__view.showTile(2, 2));
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).__view.chunksDrawn())).toBe(1);
  expect(errors).toEqual([]);
});

test('an edge pip points at ready crops off-screen and pans there', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('./');
  await splashGone(page);
  await page.evaluate(() => {
    const plot = (window as unknown as Win).__game.state.farm.plots[0]!;
    Object.assign(plot, { state: 'planted', crop: 'turnip', growthMs: 3_600_000 });
  });
  await expect(page.locator('[data-pip="crop"]')).toBeHidden();
  await page.evaluate(() => (window as unknown as Win).__view.showTile(33, 18));
  const pip = page.locator('[data-pip="crop"]');
  await expect(pip).toBeVisible();
  await expect(pip).toHaveAttribute('aria-label', /Ready crops off to the (left|top)/);
  await pip.click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Win).__view.tileClient(6, 2).visible))
    .toBe(true);
  await expect(pip).toBeHidden();
});

test.describe('phone 390x844', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('one finger pans (and plants nothing), two fingers pinch, a tap still farms', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('./');
    await splashGone(page);
    const scene = (await page.locator('#scene').boundingBox())!;
    const canvas = (await page.locator('#scene-canvas').boundingBox())!;
    expect(canvas.height).toBeCloseTo(scene.height, 0); // fills the space between the HUD and toolbar
    const start = await camera(page);
    expect(start.zoom).toBeGreaterThanOrEqual(2);
    await page.screenshot({ path: 'docs/screenshots/v2-01-phone.png' });

    const before = await plotStates(page);
    const p = await tilePoint(page, 7, 2);
    await touchDrag(page, p.x, p.y, -150, -40);
    expect(await plotStates(page)).toEqual(before);
    const moved = await camera(page);
    expect(moved.x).toBeGreaterThan(start.x + 20);

    await pinch(page, scene.x + scene.width / 2, scene.y + scene.height / 2, 60, 200);
    expect((await camera(page)).zoom).toBeGreaterThan(moved.zoom);

    // Home, then a tap on a tilled plot plants a turnip.
    await page.getByRole('button', { name: 'Back to the farm' }).tap();
    await expect.poll(async () => (await camera(page)).default).toBe(true);
    const plot = await tilePoint(page, 6, 2);
    await page.touchscreen.tap(plot.x, plot.y);
    await expect.poll(async () => (await plotStates(page))[0]).toBe('planted:turnip');
    expect(errors).toEqual([]);
  });
});
