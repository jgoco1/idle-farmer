import { expect, test } from '@playwright/test';

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
  await expect(page.getByTestId('gold')).toHaveText('0g');

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

  // Clicking the farmhouse (tile 2,2) opens the Kitchen stub.
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no box');
  await canvas.click({ position: { x: (box.width * 2.5) / 20, y: (box.height * 2.5) / 12 } });
  const kitchen = page.getByRole('dialog', { name: 'Kitchen' });
  await expect(kitchen).toBeVisible();
  await expect(kitchen).toContainText('Coming soon');

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
