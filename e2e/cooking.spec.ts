import { expect, test, type Page } from '@playwright/test';
import { clickTile } from './helpers';

type Win = {
  __game: {
    state: {
      gold: number;
      inventory: { slots: ({ item: string; qty: number; hearty?: true } | null)[] };
      kitchen: { known: string[]; queue: { recipe: string; remainingMs: number }[] };
      buffs: { active: { type: string; remainingMs: number }[] };
    };
    dispatch(action: unknown): { ok: boolean; reason?: string };
    advance(ms: number): number;
  };
};

/** Puts `stacks` into the first bag slots (the e2e test's shortcut for "go and grow these"). */
async function stockBag(page: Page, stacks: { item: string; qty: number }[]): Promise<void> {
  await page.evaluate((list) => {
    const inv = (window as unknown as Win).__game.state.inventory.slots;
    list.forEach((s, i) => (inv[i + 1] = s));
  }, stacks);
}

const advance = (page: Page, ms: number): Promise<number> =>
  page.evaluate((n) => (window as unknown as Win).__game.advance(n), ms);

test('cook a T1 dish in the Kitchen, eat it and see the buff in the HUD', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  const canvas = page.locator('#scene-canvas');
  await expect(canvas).toBeVisible();
  await stockBag(page, [
    { item: 'turnip', qty: 6 },
    { item: 'potato', qty: 4 },
    { item: 'garlic', qty: 2 },
    { item: 'bluegill', qty: 2 },
  ]);

  // The farmhouse opens the Kitchen: three starter recipes with have/need and tier.
  await clickTile(page, 2, 2);
  const kitchen = page.getByRole('dialog', { name: 'Kitchen' });
  await expect(kitchen).toBeVisible();
  const turnip = kitchen.locator('[data-recipe="roasted_turnip"]');
  await expect(turnip).toContainText('T1');
  await expect(turnip).toContainText('Green Thumb');
  await expect(turnip).toContainText('6/2');
  await expect(kitchen.locator('[data-recipe]')).toHaveCount(3);
  await page.screenshot({ path: 'docs/screenshots/phase06-kitchen.png' });

  // Cook it: the stove shows the job, the chimney puffs, and 30 s later a dish is in the bag.
  await turnip.getByRole('button', { name: 'Cook Roasted Turnip' }).click();
  await expect(kitchen.locator('[data-job="roasted_turnip"]')).toBeVisible();
  await expect(turnip.getByRole('button', { name: 'Cook Roasted Turnip' })).toBeDisabled(); // one slot
  await advance(page, 31_000);
  await expect(kitchen.locator('[data-job]')).toHaveCount(0);
  const dishes = () =>
    page.evaluate(() =>
      (window as unknown as Win).__game.state.inventory.slots
        .filter((s) => s?.item === 'roasted_turnip')
        .reduce((n, s) => n + (s?.qty ?? 0), 0),
    );
  expect(await dishes()).toBe(1);

  // A second dish for a second buff.
  await kitchen
    .locator('[data-recipe="baked_potato"]')
    .getByRole('button', { name: 'Cook Baked Potato' })
    .click();
  await advance(page, 31_000);
  await page.keyboard.press('Escape');

  // Eat both from the Inventory; the HUD grows a buff icon for each, with the exact effect on hover.
  await page.getByRole('button', { name: /Inventory/ }).click();
  const inventory = page.getByRole('dialog', { name: 'Inventory' });
  await inventory.locator('[data-item="roasted_turnip"]').click();
  await inventory.getByRole('button', { name: 'Eat Roasted Turnip' }).click();
  const growth = page.locator('#hud [data-buff="growth"]');
  await expect(growth).toBeVisible();
  await expect(growth).toHaveAttribute(
    'title',
    /Green Thumb \(tier 1\)\nCrops grow 10% faster\.\n1[45]:\d\d left/,
  );
  expect(await dishes()).toBe(0);

  await inventory.locator('[data-item="baked_potato"]').click();
  await inventory.getByRole('button', { name: 'Eat Baked Potato' }).click();
  await expect(page.locator('#hud [data-buff]')).toHaveCount(2);
  await expect(page.locator('#hud [data-buff="cookSpeed"]')).toHaveAttribute(
    'title',
    /Quick Hands.*15% faster/s,
  );
  await page.waitForTimeout(200);
  await page.mouse.move(0, 400);
  await page.screenshot({
    path: 'docs/screenshots/phase06-hud-buffs.png',
    clip: { x: 0, y: 0, width: 1280, height: 64 },
  });

  // The buff really counts down (15 minutes for a T1 dish since phase 09), and expires on its own.
  await advance(page, 16 * 60_000);
  await expect(page.locator('#hud [data-buff="growth"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('experiment finds a recipe, and the Shop sells recipe cards', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await expect(page.locator('#scene-canvas')).toBeVisible();
  await stockBag(page, [
    { item: 'yam', qty: 2 },
    { item: 'cranberry', qty: 2 },
    { item: 'corn', qty: 1 },
  ]);
  await page.evaluate(() => ((window as unknown as Win).__game.state.gold = 500));

  await page.getByRole('button', { name: /Kitchen/ }).click();
  const kitchen = page.getByRole('dialog', { name: 'Kitchen' });
  await kitchen.getByRole('tab', { name: 'Experiment' }).click();

  // A miss costs nothing and hints.
  await kitchen.locator('[data-ex="yam"]').click();
  await kitchen.locator('[data-ex="corn"]').click();
  await kitchen.getByTestId('experiment-go').click();
  await expect(kitchen.getByTestId('experiment-msg')).toContainText('nothing came of it');
  await expect(kitchen.locator('[data-ex="yam"]')).toContainText('×2');

  // A hit teaches the recipe.
  await kitchen.locator('[data-ex="corn"]').click(); // un-pick
  await kitchen.locator('[data-ex="cranberry"]').click();
  await kitchen.getByTestId('experiment-go').click();
  await expect(kitchen.getByTestId('experiment-msg')).toContainText('learned something new');
  await kitchen.getByRole('tab', { name: 'Cook' }).click();
  await expect(kitchen.locator('[data-recipe="glazed_yams"]')).toContainText('Silver Tongue');
  await expect(page.locator('#toasts')).toContainText('New recipe: Glazed Yams');

  // Recipe cards in the Shop: the flatbread card is on sale, the berry bowl one is locked.
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Shop/ }).click();
  const shop = page.getByRole('dialog', { name: 'Shop' });
  await expect(shop.locator('[data-recipe-card="berry_bowl"]')).toContainText('Locked');
  await shop.getByRole('button', { name: 'Buy the Wheat Flatbread recipe for 120 gold' }).click();
  await expect(page.getByTestId('gold')).toHaveText('380g');
  await expect(shop.locator('[data-recipe-card="wheat_flatbread"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});
