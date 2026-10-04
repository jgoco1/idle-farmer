import { expect, test, type Page } from '@playwright/test';
import { shot } from './helpers';

type Plot = { state: string; crop: string | null; growthMs: number; harvests: number; waterMsLeft: number };
type Win = {
  __game: {
    state: {
      gold: number;
      upgrades: Record<string, number>;
      lastPlantedCrop: (string | null)[];
      inventory: { slots: ({ item: string; qty: number } | null)[] };
      kitchen: { queue: { recipe: string }[] };
      farm: { plots: Plot[] };
      progression: { farmLevelFloor: number };
      seedOrder: { reservePct: number; off: string[] };
    };
    dispatch(action: unknown): { ok: boolean; reason?: string };
    advance(ms: number): number;
  };
};

const seedsOf = (page: Page, item: string): Promise<number> =>
  page.evaluate(
    (id) =>
      (window as unknown as Win).__game.state.inventory.slots
        .filter((s) => s?.item === id)
        .reduce((n, s) => n + s!.qty, 0),
    item,
  );
const gold = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as Win).__game.state.gold);

test('Seed Order: buy it, set the reserve, and an hour later the seeds are bought and the gold floor holds', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await expect(page.locator('#scene-canvas')).toBeVisible();
  // Test shortcut: a farm with a farmhand and a planter that last planted turnips, and some gold.
  await page.evaluate(() => {
    const s = (window as unknown as Win).__game.state;
    s.upgrades.farmhand = 1;
    s.upgrades.seed_planter = 1;
    s.lastPlantedCrop[0] = 'turnip';
    s.gold = 10_000;
  });
  await page.getByRole('button', { name: /Upgrades/ }).click();
  const upgrades = page.getByRole('dialog', { name: 'Upgrades' });
  await upgrades.getByRole('button', { name: 'Upgrade Seed Order for 4000 gold' }).click();
  const card = upgrades.locator('[data-upgrade="seed_order"]');
  await expect(card).toContainText('level 1/3');
  await expect(card.getByLabel(/Keep a reserve of/)).toHaveValue('25'); // the default
  await card.getByLabel(/Keep a reserve of/).selectOption('50');
  expect(await page.evaluate(() => (window as unknown as Win).__game.state.seedOrder.reservePct)).toBe(50);
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: shot('v2-06-seed-order.png') });

  // An opted-out crop is not ordered; the toggle is saved.
  await card.locator('[data-role="order-turnip"]').uncheck();
  expect(await page.evaluate(() => (window as unknown as Win).__game.state.seedOrder.off)).toEqual([
    'turnip',
  ]);
  const before = await seedsOf(page, 'seed_turnip');
  await page.evaluate(() => (window as unknown as Win).__game.advance(61 * 60_000));
  expect(await seedsOf(page, 'seed_turnip')).toBe(before);
  await card.locator('[data-role="order-turnip"]').check();

  // An hour later (one pickup), turnip seeds are topped up to 20 for 8g each plus the 10% fee.
  const goldBefore = await gold(page);
  await page.evaluate(() => (window as unknown as Win).__game.advance(61 * 60_000));
  expect(await seedsOf(page, 'seed_turnip')).toBe(20);
  const spent = goldBefore - (await gold(page));
  expect(spent).toBe(Math.ceil(8 * (20 - before) * 1.1));

  // The gold floor holds: with 100g and a 50% reserve, the 20 seeds would cost more than is allowed, so nothing is bought.
  await page.evaluate(() => {
    const s = (window as unknown as Win).__game.state;
    s.inventory.slots = s.inventory.slots.map((x) => (x?.item === 'seed_turnip' ? null : x));
    s.gold = 200; // reserve 100; the order costs 176
  });
  await page.evaluate(() => (window as unknown as Win).__game.advance(61 * 60_000));
  expect(await seedsOf(page, 'seed_turnip')).toBe(0);
  expect(await gold(page)).toBe(200);
  expect(errors).toEqual([]);
});

test('Harvest all and Water all work the whole field from the toolbar', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await expect(page.locator('#scene-canvas')).toBeVisible();
  await page.evaluate(() => {
    const s = (window as unknown as Win).__game.state;
    for (const i of [0, 2, 5])
      s.farm.plots[i] = {
        state: 'planted',
        crop: 'turnip',
        growthMs: 10 * 60_000,
        harvests: 0,
        waterMsLeft: 0,
      };
    for (const i of [1, 6])
      s.farm.plots[i] = { state: 'planted', crop: 'potato', growthMs: 0, harvests: 0, waterMsLeft: 0 };
  });
  await page.getByTestId('harvest-all').click();
  const states = await page.evaluate(() =>
    (window as unknown as Win).__game.state.farm.plots.map((p) => `${p.state}:${p.crop}`),
  );
  expect(states[0]).toBe('tilled:null');
  expect(states[2]).toBe('tilled:null');
  expect(states[5]).toBe('tilled:null');
  expect(states[1]).toBe('planted:potato'); // still growing
  expect(await seedsOf(page, 'turnip')).toBeGreaterThanOrEqual(3);
  await page.getByTestId('water-all').click();
  const wet = await page.evaluate(() =>
    (window as unknown as Win).__game.state.farm.plots.map((p) => p.waterMsLeft > 0),
  );
  expect(wet[1]).toBe(true);
  expect(wet[6]).toBe(true);
  expect(errors).toEqual([]);
});

test('Kitchen: Cook ×N and a pinned favourite that keeps its place after a reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await expect(page.locator('#scene-canvas')).toBeVisible();
  await page.evaluate(() => {
    const s = (window as unknown as Win).__game.state;
    s.upgrades.kitchen = 1; // the Stove: two dishes at once
    s.inventory.slots[1] = { item: 'turnip', qty: 8 };
    s.inventory.slots[2] = { item: 'potato', qty: 4 };
    s.inventory.slots[3] = { item: 'bluegill', qty: 2 };
  });
  await page.getByRole('button', { name: /Kitchen/ }).click();
  const kitchen = page.getByRole('dialog', { name: 'Kitchen' });
  const rows = kitchen.locator('[data-recipe]');
  await expect(rows).toHaveCount(3);
  const last = await rows.last().getAttribute('data-recipe');
  await kitchen.locator(`[data-fav="${last}"]`).click();
  await expect(rows.first()).toHaveAttribute('data-recipe', last!); // pinned to the top in any sort order
  await expect(kitchen.locator(`[data-fav="${last}"]`)).toHaveAttribute('aria-pressed', 'true');
  await kitchen.locator('#kitchen-sort').selectOption('name');
  await expect(rows.first()).toHaveAttribute('data-recipe', last!);

  // Cook ×2 on the turnip: the stepper stops at the two free slots.
  const turnip = kitchen.locator('[data-recipe="roasted_turnip"]');
  const more = turnip.locator('[data-role="more"]');
  await more.click();
  await expect(turnip.getByTestId('cook-n')).toHaveText('2');
  await expect(more).toBeDisabled();
  await page.screenshot({ path: shot('v2-06-kitchen.png') });
  await turnip.getByRole('button', { name: 'Cook 2 Roasted Turnip' }).click();
  expect(await page.evaluate(() => (window as unknown as Win).__game.state.kitchen.queue.length)).toBe(2);
  await expect(kitchen.locator('[data-job="roasted_turnip"]')).toHaveCount(2);

  // Favourites are a per-device pref: they survive a reload.
  await page.reload();
  await expect(page.locator('#scene-canvas')).toBeVisible();
  await page.getByRole('button', { name: /Kitchen/ }).click();
  const again = page.getByRole('dialog', { name: 'Kitchen' }).locator('[data-recipe]');
  await expect(again.first()).toHaveAttribute('data-recipe', last!);
  expect(errors).toEqual([]);
});

test('the Farm Level chip shows the level and opens the Goals panel', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await expect(page.locator('#scene-canvas')).toBeVisible();
  const chip = page.getByTestId('farm-level');
  await expect(chip).toHaveText('Lv 1');
  await page.evaluate(() => ((window as unknown as Win).__game.state.progression.farmLevelFloor = 4));
  await expect(chip).toHaveText('Lv 4');
  await page.screenshot({ path: shot('v2-06-hud-chip.png'), clip: { x: 0, y: 0, width: 420, height: 70 } });
  await chip.click();
  await expect(page.getByRole('dialog', { name: 'Goals' })).toBeVisible();
  await chip.click(); // toggles it closed again
  await expect(page.getByRole('dialog', { name: 'Goals' })).toBeHidden();
  expect(errors).toEqual([]);
});
