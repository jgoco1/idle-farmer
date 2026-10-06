// Polish after v3-00: discard from the bag (with a confirmation), the "Regrows" note on seeds in the Shop and the
// bag, and sorting the Kitchen's recipe book (kept in prefs across a reload).

import { expect, test, type Page } from '@playwright/test';
import { shot } from './helpers';

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

/** Opens the Inventory with these stacks in the first slots and the rest empty. */
async function bagWith(page: Page, stacks: ({ item: string; qty: number } | null)[]): Promise<void> {
  await page.evaluate((st) => {
    const inv = (window as unknown as Win).__game.state.inventory;
    inv.slots = inv.slots.map((_, i) => st[i] ?? null);
  }, stacks);
  await page
    .getByRole('button', { name: /^Inventory/ })
    .first()
    .click();
}

test('drag a stack onto another to merge it, onto an empty slot to move it; Sort merges and orders the bag', async ({
  page,
}) => {
  await open(page);
  await bagWith(page, [
    { item: 'turnip', qty: 60 },
    { item: 'seed_potato', qty: 5 },
    { item: 'turnip', qty: 30 },
  ]);
  const panel = page.getByRole('dialog', { name: 'Inventory' });
  const slot = (i: number) => panel.locator(`[data-slot="${i}"]`);

  // Mouse: drag slot 2's turnips onto slot 0's: one stack of 90.
  await slot(2).dragTo(slot(0));
  await expect
    .poll(() => bag(page).then((b) => b.slice(0, 3)))
    .toEqual([{ item: 'turnip', qty: 90 }, { item: 'seed_potato', qty: 5 }, null]);
  // A drag's release is not a click: the merged stack is under the pointer, so it is described, not picked.
  await expect(panel.locator('.inv-detail')).toContainText('×90');
  await expect(panel.locator('.inv-hint')).toBeHidden();

  // Onto an empty slot it moves, with the slot lit while it is over it.
  const a = await slot(1).boundingBox();
  const b = await slot(7).boundingBox();
  await page.mouse.move(a!.x + a!.width / 2, a!.y + a!.height / 2);
  await page.mouse.down();
  await page.mouse.move(b!.x + b!.width / 2, b!.y + b!.height / 2, { steps: 6 });
  await expect(slot(7)).toHaveClass(/is-drop-target/);
  await expect(page.locator('.inv-ghost img')).toHaveCount(1);
  await panel.screenshot({ path: shot('polish-bag-drag.png') });
  await page.mouse.up();
  await expect(page.locator('.inv-ghost')).toHaveCount(0);
  expect((await bag(page))[7]).toEqual({ item: 'seed_potato', qty: 5 });
  expect((await bag(page))[1]).toBeNull();

  // Sort: seeds first, then crops, from the first slot.
  await page.evaluate(() => {
    (window as unknown as Win).__game.state.inventory.slots[4] = { item: 'turnip', qty: 20 };
  });
  await panel.getByTestId('inv-sort').click();
  expect((await bag(page)).slice(0, 3)).toEqual([
    { item: 'seed_potato', qty: 5 },
    { item: 'turnip', qty: 99 },
    { item: 'turnip', qty: 11 },
  ]);
  await expect(slot(0)).toHaveAttribute('data-item', 'seed_potato');
});

test('Move… moves a stack from the keyboard: pick it, then the slot', async ({ page }) => {
  await open(page);
  await bagWith(page, [{ item: 'turnip', qty: 4 }]);
  const panel = page.getByRole('dialog', { name: 'Inventory' });
  await panel.locator('[data-slot="0"]').focus();
  await page.keyboard.press('Enter');
  await panel.locator('[data-move="turnip"]').focus();
  await page.keyboard.press('Enter');
  await expect(panel.locator('.inv-hint')).toContainText('Choose a slot for the Turnip');
  await panel.locator('[data-slot="5"]').focus();
  await page.keyboard.press('Enter');
  expect((await bag(page))[5]).toEqual({ item: 'turnip', qty: 4 });
  await expect(panel.locator('.inv-hint')).toBeHidden();
});

test.describe('on a touch phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });

  test('a long press picks a stack up and a drag merges it; a quick swipe does not', async ({ page }) => {
    await open(page);
    await bagWith(page, [{ item: 'turnip', qty: 10 }, null, { item: 'turnip', qty: 15 }]);
    const panel = page.getByRole('dialog', { name: 'Inventory' });
    const centre = async (i: number): Promise<{ x: number; y: number }> => {
      const r = (await panel.locator(`[data-slot="${i}"]`).boundingBox())!;
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    };
    await page.waitForTimeout(500); // the bottom sheet slides up: measure once it has stopped
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', p?: { x: number; y: number }) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y, id: 0 }] : [] });
    const from = await centre(2);
    const to = await centre(0);
    const steps = (n: number) =>
      Array.from({ length: n + 1 }, (_, i) => ({
        x: from.x + ((to.x - from.x) * i) / n,
        y: from.y + ((to.y - from.y) * i) / n,
      }));

    // A quick swipe (no hold) moves nothing.
    await touch('touchStart', from);
    for (const p of steps(6)) await touch('touchMove', p);
    await touch('touchEnd');
    expect((await bag(page)).slice(0, 3)).toEqual([
      { item: 'turnip', qty: 10 },
      null,
      { item: 'turnip', qty: 15 },
    ]);

    // Hold, then drag: the stacks merge.
    await page.waitForTimeout(400);
    await touch('touchStart', from);
    await page.waitForTimeout(450);
    await expect(page.locator('.inv-ghost')).toHaveCount(1);
    for (const p of steps(6)) await touch('touchMove', p);
    await touch('touchEnd');
    await expect
      .poll(() => bag(page).then((b) => b.slice(0, 3)))
      .toEqual([{ item: 'turnip', qty: 25 }, null, null]);
    await expect(page.locator('.inv-ghost')).toHaveCount(0);
  });
});
