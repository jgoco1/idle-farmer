// Polish after v3-00: discard from the bag (with a confirmation), the "Regrows" note on seeds in the Shop and the
// bag, and sorting the Kitchen's recipe book (kept in prefs across a reload).

import { expect, test, type Page } from '@playwright/test';

type Win = {
  __game: {
    state: {
      inventory: { slots: ({ item: string; qty: number } | null)[] };
      kitchen: { known: string[] };
    };
  };
};

const bag = (page: Page): Promise<({ item: string; qty: number } | null)[]> =>
  page.evaluate(() => (window as unknown as Win).__game.state.inventory.slots);

async function open(page: Page): Promise<void> {
  await page.goto('./');
  await expect(page.locator('#splash')).toHaveCount(0);
  await page.waitForFunction(() => !!(window as unknown as Partial<Win>).__game);
  await page
    .getByRole('button', { name: 'Skip tutorial' })
    .click({ timeout: 2000 })
    .catch(() => undefined);
}

test('discard out-of-season seeds from the bag after confirming; Keep changes nothing', async ({ page }) => {
  await open(page);
  // Pumpkin seeds are an autumn crop: out of season in a new spring farm.
  await page.evaluate(() => {
    (window as unknown as Win).__game.state.inventory.slots[3] = { item: 'seed_pumpkin', qty: 9 };
  });
  await page
    .getByRole('button', { name: /^Inventory/ })
    .first()
    .click();
  const panel = page.getByRole('dialog', { name: 'Inventory' });
  await panel.locator('[data-item="seed_pumpkin"]').click();
  await expect(panel.locator('.inv-season')).toContainText('Out of season');
  await panel.locator('[data-discard="seed_pumpkin"]').click();
  const confirm = page.getByRole('dialog', { name: 'Discard Pumpkin Seeds?' });
  await expect(confirm).toContainText('gone for good');
  await confirm.getByRole('button', { name: 'Keep' }).click();
  expect((await bag(page))[3]).toEqual({ item: 'seed_pumpkin', qty: 9 });

  await panel.locator('[data-discard="seed_pumpkin"]').click();
  await page
    .getByRole('dialog', { name: 'Discard Pumpkin Seeds?' })
    .getByRole('button', { name: 'Discard 1' })
    .click();
  expect((await bag(page))[3]).toEqual({ item: 'seed_pumpkin', qty: 8 });
  await panel.locator('[data-item="seed_pumpkin"]').click();
  await panel.locator('[data-discard="seed_pumpkin"]').click();
  await page
    .getByRole('dialog', { name: 'Discard Pumpkin Seeds?' })
    .getByRole('button', { name: 'Discard all 8' })
    .click();
  expect((await bag(page)).some((s) => s?.item === 'seed_pumpkin')).toBe(false);
  await expect(panel).toContainText('Discarded 8 Pumpkin Seeds.');
});

test('regrowing seeds are marked in the Shop and described in the bag', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: /^Shop/ }).first().click();
  const shop = page.getByRole('dialog', { name: 'Shop' });
  const strawberry = shop.locator('[data-seed="strawberry"]');
  await expect(strawberry.locator('.regrow-badge')).toHaveText('↻ Regrows');
  await expect(shop.locator('[data-seed="turnip"] .regrow-badge')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    (window as unknown as Win).__game.state.inventory.slots[3] = { item: 'seed_strawberry', qty: 2 };
  });
  await page
    .getByRole('button', { name: /^Inventory/ })
    .first()
    .click();
  const panel = page.getByRole('dialog', { name: 'Inventory' });
  await panel.locator('[data-item="seed_strawberry"]').click();
  await expect(panel.locator('.inv-detail')).toContainText('Keeps producing: harvest again every');
});

test('the Kitchen sorts its recipe book, and remembers the choice after a reload', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const g = (window as unknown as Win).__game;
    g.state.kitchen.known = [
      'roasted_turnip',
      'baked_potato',
      'grilled_bluegill',
      'berry_bowl',
      'vegetable_soup',
    ];
  });
  await page
    .getByRole('button', { name: /^Kitchen/ })
    .first()
    .click();
  const kitchen = page.getByRole('dialog', { name: 'Kitchen' });
  const names = (): Promise<string[]> =>
    kitchen
      .locator('[data-recipe]')
      .evaluateAll((rows) => rows.map((r) => (r as HTMLElement).dataset.recipe!));
  await kitchen.getByTestId('kitchen-sort').selectOption('name');
  const byName = await names();
  expect(byName.length).toBeGreaterThan(1);
  const labels = await kitchen
    .locator('[data-recipe] .crate-text > span:first-child')
    .evaluateAll((els) => els.map((e) => (e.textContent ?? '').replace(/\s*T\d\s*$/, '').trim()));
  expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
  await kitchen.getByTestId('kitchen-sort').selectOption('price');
  const prices = await kitchen
    .locator('[data-recipe]')
    .evaluateAll((rows) => rows.map((r) => Number(/sells (\d+)g/.exec(r.textContent ?? '')?.[1] ?? NaN)));
  expect(prices.every((p) => Number.isFinite(p))).toBe(true);
  expect(prices).toEqual([...prices].sort((a, b) => b - a));

  await page.reload();
  await expect(page.locator('#splash')).toHaveCount(0);
  await page
    .getByRole('button', { name: /^Kitchen/ })
    .first()
    .click();
  await expect(page.getByRole('dialog', { name: 'Kitchen' }).getByTestId('kitchen-sort')).toHaveValue(
    'price',
  );
});
