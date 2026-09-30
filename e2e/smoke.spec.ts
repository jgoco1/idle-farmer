import { expect, test, type Locator, type Page } from '@playwright/test';

/** Centre of scene tile (col, row) in canvas CSS pixels (the scene is 20 × 12 tiles). */
async function tileCenter(canvas: Locator, col: number, row: number): Promise<{ x: number; y: number }> {
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no box');
  return { x: (box.width * (col + 0.5)) / 20, y: (box.height * (row + 0.5)) / 12 };
}

/** Plot i of the starting 4 × 2 grid sits at tile (6 + i % 4, 2 + floor(i / 4)). */
async function clickPlot(canvas: Locator, i: number, modifiers: 'Shift'[] = []): Promise<void> {
  await canvas.click({ position: await tileCenter(canvas, 6 + (i % 4), 2 + Math.floor(i / 4)), modifiers });
}

type PlotView = { state: string; crop: string | null; growthMs: number; waterMsLeft: number };
async function plots(page: Page): Promise<PlotView[]> {
  return page.evaluate(
    () =>
      (window as unknown as { __game: { state: { farm: { plots: PlotView[] } } } }).__game.state.farm.plots,
  );
}

test('the farm loads, renders and opens Settings', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto('./');
  const canvas = page.locator('#scene-canvas');
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId('date')).toContainText(/Spring · Year 1 · \w{3} \d{1,2}:\d{2} [AP]M/);
  await expect(page.getByTestId('gold')).toHaveText('60g');

  // The canvas has real pixels: many distinct colours, not a blank or single-colour box.
  const colours = await canvas.evaluate((el: HTMLCanvasElement) => {
    const ctx = el.getContext('2d');
    if (!ctx) return 0;
    const { data } = ctx.getImageData(0, 0, el.width, el.height);
    const seen = new Set<number>();
    for (let i = 0; i < data.length; i += 4 * 7) {
      seen.add(((data[i] ?? 0) << 16) | ((data[i + 1] ?? 0) << 8) | (data[i + 2] ?? 0));
    }
    return seen.size;
  });
  expect(colours).toBeGreaterThan(20);

  await page.screenshot({ path: 'test-results/farm.png' });

  // Settings opens from the HUD and closes with Escape.
  await page.getByRole('button', { name: 'Settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await expect(settings).toBeVisible();
  await expect(settings.getByRole('button', { name: 'Export save' })).toBeVisible();
  await page.screenshot({ path: 'test-results/settings.png' });
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();

  // Clicking the farmhouse (tile 2,2) opens the Kitchen.
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no box');
  await canvas.click({ position: { x: (box.width * 2.5) / 20, y: (box.height * 2.5) / 12 } });
  const kitchen = page.getByRole('dialog', { name: 'Kitchen' });
  await expect(kitchen).toBeVisible();
  await expect(kitchen).toContainText('Recipe book');

  expect(errors).toEqual([]);
});

test('the scene fits a 360 px phone without horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('./');
  const box = await page.locator('#scene-canvas').boundingBox();
  expect(box?.width).toBeLessThanOrEqual(360);
  expect(box?.width).toBeGreaterThanOrEqual(320);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await page.screenshot({ path: 'test-results/farm-mobile.png' });
});

test('till, plant, water, grow and harvest a turnip', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./?debug');
  const canvas = page.locator('#scene-canvas');
  await expect(canvas).toBeVisible();
  const tools = page.getByRole('group', { name: 'Farming tools' });
  await expect(tools.locator('[data-tool="auto"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('seed-count')).toHaveText('6');

  // Auto on the untilled plot 2: till, then plant (turnip is the chosen seed), then water.
  await clickPlot(canvas, 2);
  expect((await plots(page))[2]?.state).toBe('tilled');
  await clickPlot(canvas, 2);
  expect((await plots(page))[2]).toMatchObject({ state: 'planted', crop: 'turnip' });
  await expect(page.getByTestId('seed-count')).toHaveText('10'); // 6 − 1 planted, + 5 from the first-seed milestone
  await clickPlot(canvas, 2);
  expect((await plots(page))[2]?.waterMsLeft).toBeGreaterThan(0);

  // Shift-click plants the whole field: the four plots that start tilled.
  await clickPlot(canvas, 0, ['Shift']);
  expect((await plots(page)).filter((p) => p.state === 'planted')).toHaveLength(5);
  await expect(page.getByTestId('seed-count')).toHaveText('6'); // 10 − 4 planted

  // The Shop sells a potato seed; locked seeds show how to unlock them; summer seeds are not stocked.
  await page.getByRole('button', { name: /Shop/ }).click();
  const shop = page.getByRole('dialog', { name: 'Shop' });
  await shop.getByRole('button', { name: 'Buy 1 Potato seeds for 19 gold' }).click();
  await expect(page.getByTestId('gold')).toHaveText('41g');
  await expect(shop.locator('[data-seed="garlic"]')).toContainText('Reach Farm Level 2');
  await expect(shop.locator('[data-seed="garlic"] button')).toHaveCount(0);
  await expect(shop.locator('[data-seed="wheat"]')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Drag the hoe down plots 3 → 7, then plant the potato with the seed picker.
  await tools.locator('[data-tool="hoe"]').click();
  const a = await tileCenter(canvas, 9, 2);
  const b = await tileCenter(canvas, 9, 3);
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + a.x, box.y + a.y);
  await page.mouse.down();
  await page.mouse.move(box.x + b.x, box.y + b.y, { steps: 4 });
  await page.mouse.up();
  expect((await plots(page)).map((p) => p.state)[3]).toBe('tilled');
  expect((await plots(page)).map((p) => p.state)[7]).toBe('tilled');
  await tools.locator('[data-tool="seeds"]').click();
  await page.locator('.seed-picker [data-seed="potato"]').click();
  await clickPlot(canvas, 3);
  expect((await plots(page))[3]).toMatchObject({ state: 'planted', crop: 'potato' });
  await tools.locator('[data-tool="water"]').click();
  await clickPlot(canvas, 3);
  await clickPlot(canvas, 0);

  // Time warp ×60 from the debug overlay until the watered turnip is ready.
  await page.keyboard.press('`');
  await page.getByRole('button', { name: /Time warp/ }).click();
  await expect
    .poll(async () => (await plots(page))[2]?.growthMs, { timeout: 10_000 })
    .toBeGreaterThanOrEqual(120_000);
  await page.getByRole('button', { name: /Time warp/ }).click();
  await page.keyboard.press('`');
  await page.mouse.move(0, 0);
  await page.screenshot({ path: 'test-results/farm-planted.png' });

  // Harvest with the hand and find the turnip in the inventory.
  await tools.locator('[data-tool="hand"]').click();
  await clickPlot(canvas, 2);
  await expect(page.locator('.toast').filter({ hasText: '+1 Turnip' })).toBeVisible();
  expect((await plots(page))[2]?.state).toBe('tilled');
  await page.getByRole('button', { name: /Inventory/ }).click();
  const inventory = page.getByRole('dialog', { name: 'Inventory' });
  await expect(inventory.locator('[data-item="turnip"] .inv-qty')).toHaveText('1');
  await expect(inventory.locator('[data-item="seed_turnip"] .inv-qty')).toHaveText('6'); // the seeds left, with the 5 from the first-seed milestone
  await inventory.locator('[data-item="turnip"]').hover();
  await expect(inventory).toContainText(/Sells for \d+g each at the Market right now/);
  await page.screenshot({ path: 'test-results/inventory.png' });
  await page.keyboard.press('Escape');

  // Sell it at the Market: the button shows the exact gold, and the gold counter counts up to it.
  await page.getByRole('button', { name: /Market/ }).click();
  const market = page.getByRole('dialog', { name: 'Market' });
  await expect(market).toContainText(/Today's specials|No specials today/);
  const row = market.locator('[data-item="turnip"]');
  await expect(row).toContainText('Turnip ×1');
  const label = (await row.locator('[data-sell="all"]').textContent()) ?? '';
  const price = Number(/(\d+)g/.exec(label)?.[1]);
  expect(price).toBeGreaterThan(0);
  const goldBefore = await page.evaluate(
    () => (window as unknown as { __game: { state: { gold: number } } }).__game.state.gold,
  );
  await row.locator('[data-sell="all"]').click();
  await expect(page.getByTestId('gold')).toHaveText(`${goldBefore + price + 50}g`); // + the first-sale milestone's 50g
  await expect(page.locator('.gold-popup')).toHaveText(`+${price}g`);
  await expect(market).toContainText('Nothing to sell yet');
  await expect(market).toContainText(/The bin is empty\. Next pickup in \d+m/);
  await page.screenshot({ path: 'test-results/market.png' });
  await page.keyboard.press('Escape');

  // The Shipping Bin in the scene (tile 18,7) opens the Market too.
  const binAt = await tileCenter(canvas, 18, 7);
  await canvas.click({ position: binAt });
  await expect(market).toBeVisible();
  await page.keyboard.press('Escape');

  // Buy the first expansion from Upgrades. (Test shortcut: top up the gold instead of farming for it.)
  await page.evaluate(() => {
    (window as unknown as { __game: { state: { gold: number } } }).__game.state.gold += 400;
  });
  await page.getByRole('button', { name: /Upgrades/ }).click();
  const upgrades = page.getByRole('dialog', { name: 'Upgrades' });
  await upgrades.getByRole('button', { name: 'Buy Clear the Weeds for 400 gold' }).click();
  await expect(upgrades).toContainText('your field is now 4 × 3 plots');
  expect(await plots(page)).toHaveLength(12);
  expect((await plots(page))[8]?.state).toBe('untilled');
  await page.keyboard.press('Escape');
  // The new row is at tile row 4 and can be tilled.
  await tools.locator('[data-tool="hoe"]').click();
  await clickPlot(canvas, 8);
  expect((await plots(page))[8]?.state).toBe('tilled');
  await page.mouse.move(0, 0);
  await page.screenshot({ path: 'test-results/farm-expanded.png' });

  expect(errors).toEqual([]);
});
