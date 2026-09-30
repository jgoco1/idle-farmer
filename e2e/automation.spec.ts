import { expect, test, type Locator, type Page } from '@playwright/test';

type Win = {
  __game: {
    state: {
      gold: number;
      placed: { id: number; kind: string; at: { col: number; row: number } }[];
      farm: { plots: { state: string; crop: string | null }[] };
    };
    dispatch(action: unknown): { ok: boolean; reason?: string };
    advance(ms: number): number;
    isPlotWatered(i: number): boolean;
  };
};

interface LooseState {
  gold: number;
  stats: { lifetimeGold: number; cropsHarvested: number };
  progression: { farmLevelFloor: number };
  upgrades: Record<string, number>;
  automation: { farmhandCooldownMs: number };
  shippingBin: { items: unknown[] };
}

async function tileCenter(canvas: Locator, col: number, row: number): Promise<{ x: number; y: number }> {
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no box');
  return { x: (box.width * (col + 0.5)) / 20, y: (box.height * (row + 0.5)) / 12 };
}

async function dispatch(page: Page, action: unknown): Promise<void> {
  const r = await page.evaluate((a) => (window as unknown as Win).__game.dispatch(a), action);
  expect(r.ok, r.reason).toBe(true);
}

test('a sprinkler keeps its plots watered for hours while the rest dry out', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  const canvas = page.locator('#scene-canvas');
  await expect(canvas).toBeVisible();

  // Buy a sprinkler from the Upgrades panel (test shortcut: top up the gold).
  await page.evaluate(() => ((window as unknown as Win).__game.state.gold = 1000));
  await page.getByRole('button', { name: /Upgrades/ }).click();
  const upgrades = page.getByRole('dialog', { name: 'Upgrades' });
  await upgrades.getByRole('button', { name: 'Buy Sprinkler for 300 gold' }).click();

  // Buying drops into placement mode; the banner names it. Put it on plot (1,1) = tile (7,3).
  const banner = page.getByTestId('placement-banner');
  await expect(banner).toContainText('Placing sprinklers');
  await canvas.hover({ position: await tileCenter(canvas, 7, 3) });
  await canvas.click({ position: await tileCenter(canvas, 7, 3) });
  await expect(banner).toContainText('No sprinklers left');
  const placed = await page.evaluate(() => (window as unknown as Win).__game.state.placed);
  expect(placed).toMatchObject([{ kind: 'sprinkler', at: { col: 1, row: 1 } }]);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: 'test-results/sprinkler-placed.png' });

  // Picking it up again works from the same mode, and it can be placed once more.
  await canvas.click({ position: await tileCenter(canvas, 7, 3) });
  expect(await page.evaluate(() => (window as unknown as Win).__game.state.placed.length)).toBe(0);
  await canvas.click({ position: await tileCenter(canvas, 7, 3) });
  expect(await page.evaluate(() => (window as unknown as Win).__game.state.placed.length)).toBe(1);
  await page.keyboard.press('Escape');
  await expect(banner).toBeHidden();

  // Till and water the whole field by hand, then let 2.5 hours of simulated time pass.
  await dispatch(page, { type: 'till', plots: [0, 1, 2, 3, 4, 5, 6, 7] });
  await dispatch(page, { type: 'water', plots: [0, 1, 2, 3, 4, 5, 6, 7] });
  await page.evaluate(() => (window as unknown as Win).__game.advance(2.5 * 3600_000));

  // Plots next to the sprinkler (plus shape around plot 5) are watered; the others have dried.
  const watered = await page.evaluate(() =>
    [0, 1, 2, 3, 4, 5, 6, 7].map((i) => (window as unknown as Win).__game.isPlotWatered(i)),
  );
  expect(watered).toEqual([false, true, false, false, true, false, true, false]);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: 'test-results/sprinkler-dry.png' });
  expect(errors).toEqual([]);
});

test('an automated farm: farmhand, sprinklers and a scarecrow at work', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./?debug');
  await expect(page.locator('#scene-canvas')).toBeVisible();

  // Set up a 6 × 5 farm with automation (test shortcut: grant gold and levels, then use the real actions).
  await page.evaluate(() => {
    const g = (window as unknown as { __game: { state: LooseState } }).__game;
    g.state.gold = 1_000_000;
    g.state.progression.farmLevelFloor = 10; // test shortcut: every unlock open
    Object.assign(g.state.upgrades, {
      farmhand: 2,
      seed_planter: 2,
      auto_seller: 1,
      sprinkler: 4,
      scarecrow: 1,
    });
    g.state.automation.farmhandCooldownMs = 22_000;
  });
  for (const id of ['farm_1', 'farm_2', 'farm_3']) await dispatch(page, { type: 'buyExpansion', id });
  for (const [col, row] of [
    [1, 1],
    [4, 1],
    [1, 3],
    [4, 3],
  ])
    await dispatch(page, { type: 'place', kind: 'sprinkler', col, row });
  await dispatch(page, { type: 'place', kind: 'scarecrow', col: 3, row: 2 });
  const all = Array.from({ length: 30 }, (_, i) => i);
  await dispatch(page, { type: 'till', plots: all });
  await dispatch(page, { type: 'buySeeds', crop: 'potato', qty: 40 });
  await dispatch(page, { type: 'buySeeds', crop: 'turnip', qty: 40 });
  await dispatch(page, { type: 'useTool', tool: 'seeds', plots: all, seed: 'turnip' });
  await dispatch(page, { type: 'water', plots: all });

  // Two minutes to ripen, then the farmhand's next visit harvests and the planter replants.
  await page.evaluate(() => (window as unknown as Win).__game.advance(133_000));
  const state = await page.evaluate(() => {
    const g = (window as unknown as { __game: { state: LooseState } }).__game;
    return { harvested: g.state.stats.cropsHarvested, bin: g.state.shippingBin.items };
  });
  expect(state.harvested).toBeGreaterThan(0);
  expect(state.bin.length).toBeGreaterThan(0); // the Auto-Seller sent the harvest to the bin
  await page.waitForTimeout(600); // let the farmhand walk out to the plots
  await page.mouse.move(0, 0);
  await page.screenshot({ path: 'test-results/farm-automated.png' });
  expect(errors).toEqual([]);
});
