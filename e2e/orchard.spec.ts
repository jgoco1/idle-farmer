// v2 phase 03: the Trees tab, planting on a tree spot, trees growing over real days (the debug calendar
// offset), ripe fruit with its tooltip and edge pip, picking by click, removing with a confirmation, and
// the orchard in each season (screenshots in docs/screenshots).

import { expect, test, type Page } from '@playwright/test';
import { clickTile, hoverTile, type WithView } from './helpers';

type Tree = { id: number; tree: string; spot: number; plantedDay: number; fruit: number };
type Game = {
  state: {
    gold: number;
    land: { parcels: string[] };
    inventory: { slots: ({ item: string; qty: number } | null)[] };
    orchard: { trees: Tree[] };
    stats: { fruitPicked: number };
    calendar: { debugOffsetMs: number; maxDayIndex: number };
  };
  dispatch(action: unknown): { ok: boolean; reason?: string };
  debugFakeOffline(ms: number): unknown;
  calendar(): { season: string; dayIndex: number };
};
type Win = WithView & { __game: Game };

const game = <T>(page: Page, fn: (g: Game) => T): Promise<T> =>
  page.evaluate(`(${fn.toString()})(window.__game)`) as Promise<T>;

const SPOTS = [
  [22, 1],
  [25, 1],
  [28, 1],
  [31, 1],
  [22, 4],
  [25, 4],
  [28, 4],
  [31, 4],
] as const;

test.beforeEach(async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#splash')).toHaveCount(0);
  await page.waitForFunction(() => !!(window as unknown as Partial<Win>).__game);
});

async function ownOrchard(page: Page): Promise<void> {
  await game(page, (g) => {
    g.state.gold = 5_000_000;
    g.state.land.parcels.push('orchard');
  });
}

/** One tree of every kind on the first seven spots, bought and planted through the actions. */
async function plantEverything(page: Page): Promise<void> {
  await game(page, (g) => {
    const fruits = ['cherry', 'apricot', 'peach', 'apple', 'pear', 'persimmon', 'lemon'];
    fruits.forEach((fruit, spot) => {
      g.dispatch({ type: 'buySapling', fruit, qty: 1 });
      g.dispatch({ type: 'plantTree', fruit, spot });
    });
  });
}

test('the Trees tab opens with the orchard; buy a sapling and plant it on a tree spot', async ({ page }) => {
  await page.getByRole('button', { name: /^Shop/ }).first().click();
  await expect(page.getByRole('tab', { name: 'Trees' })).toBeHidden();
  await page
    .getByRole('button', { name: /^Close/ })
    .first()
    .click();
  await ownOrchard(page);
  await page.getByRole('button', { name: /^Shop/ }).first().click();
  await page.getByRole('tab', { name: 'Trees' }).click();
  await expect(page.locator('[data-tree="cherry_tree"]')).toContainText('Bears in Spring');
  await expect(page.locator('[data-tree="cherry_tree"]')).toContainText('mature in 3 days');
  await expect(page.locator('[data-tree="cherry_tree"]')).toContainText('first bear on');
  await page.locator('[data-sapling-buy="cherry"]').click();
  await expect(page.locator('[data-sapling-plant="cherry"]')).toContainText('Plant (1)');
  await page.locator('[data-sapling-plant="cherry"]').click();
  await expect(page.getByTestId('plant-banner')).toBeVisible();
  // a tile that is not a tree spot refuses; a free spot plants (any tile of its 2 × 2 works)
  await clickTile(page, 20, 3);
  expect(await game(page, (g) => g.state.orchard.trees.length)).toBe(0);
  await clickTile(page, SPOTS[0][0] + 1, SPOTS[0][1] + 1);
  const trees = await game(page, (g) => g.state.orchard.trees);
  expect(trees).toHaveLength(1);
  expect(trees[0]).toMatchObject({ tree: 'cherry_tree', spot: 0, fruit: 0 });
  await expect(page.getByTestId('plant-banner')).toBeHidden(); // the last sapling is planted
  await page.screenshot({ path: 'test-results/orchard-planted.png' });
});

test('trees grow over real days: fast-forward, see fruit ripen, read the tooltip, pick it', async ({
  page,
}) => {
  await ownOrchard(page);
  await plantEverything(page);
  const day0 = await game(page, (g) => g.calendar().dayIndex);
  // Whatever the real date is, some tree bears within a week of every tree being mature (every season has trees).
  let ripe: Tree | undefined;
  for (let i = 0; i < 40 && !ripe; i++) {
    await game(page, (g) => g.debugFakeOffline(24 * 3_600_000));
    ripe = await game(page, (g) => g.state.orchard.trees.find((t) => t.fruit > 0));
  }
  expect(ripe).toBeDefined();
  const day = await game(page, (g) => g.calendar().dayIndex);
  expect(day).toBeGreaterThan(day0 + 2); // days passed on the calendar, not in simulated time
  const spot = SPOTS[ripe!.spot]!;
  // off screen first: the home view shows an edge pip for ripe fruit
  for (let i = 0; i < 3; i++) await page.keyboard.press('+');
  await page.evaluate(() => (window as unknown as Win).__view.showTile(3, 16));
  await expect(page.locator('[data-pip="tree"]')).toBeVisible();
  await hoverTile(page, spot[0] + 1, spot[1]);
  await expect(page.getByTestId('tree-tip')).toContainText(/Mature/);
  await expect(page.getByTestId('tree-tip')).toContainText(/Fruit \d+ \/ \d+/);
  await page.evaluate(() => document.getElementById('toasts')?.replaceChildren());
  await page.screenshot({ path: 'docs/screenshots/v2-03-tree-tooltip.png' });
  await clickTile(page, spot[0] + 1, spot[1]);
  await expect.poll(() => game(page, (g) => g.state.stats.fruitPicked)).toBeGreaterThan(0);
  const picked = ripe!.id;
  const after = await page.evaluate(
    (id) => (window as unknown as Win).__game.state.orchard.trees.find((t) => t.id === id)!.fruit,
    picked,
  );
  expect(after).toBe(0);
});

test('removing a tree asks first and says the growth and sapling are lost', async ({ page }) => {
  await ownOrchard(page);
  await game(page, (g) => {
    g.dispatch({ type: 'buySapling', fruit: 'peach', qty: 1 });
    g.dispatch({ type: 'plantTree', fruit: 'peach', spot: 1 });
  });
  await page.getByRole('button', { name: /^Shop/ }).first().click();
  await page.getByRole('tab', { name: 'Trees' }).click();
  await expect(page.locator('[data-your-tree]')).toContainText('Peach tree');
  await page.locator('[data-tree-remove]').click();
  await expect(page.locator('.modal')).toContainText('not refunded');
  await page.getByRole('button', { name: 'Keep it' }).click();
  expect(await game(page, (g) => g.state.orchard.trees.length)).toBe(1);
  await page.locator('[data-tree-remove]').click();
  await page.getByRole('button', { name: 'Remove the tree' }).click();
  expect(await game(page, (g) => g.state.orchard.trees.length)).toBe(0);
});

test('moving a tree keeps its age', async ({ page }) => {
  await ownOrchard(page);
  await game(page, (g) => {
    g.dispatch({ type: 'buySapling', fruit: 'peach', qty: 1 });
    g.dispatch({ type: 'plantTree', fruit: 'peach', spot: 1 });
    g.state.orchard.trees[0]!.plantedDay -= 2;
  });
  await page.getByRole('button', { name: /^Shop/ }).first().click();
  await page.getByRole('tab', { name: 'Trees' }).click();
  await page.locator('[data-tree-move]').click();
  await expect(page.getByTestId('plant-banner')).toContainText('keeps its age');
  await clickTile(page, SPOTS[6][0], SPOTS[6][1]);
  const t = await game(page, (g) => g.state.orchard.trees[0]!);
  expect(t.spot).toBe(6);
  const age = await game(page, (g) => g.calendar().dayIndex - g.state.orchard.trees[0]!.plantedDay);
  expect(age).toBe(2);
});

test('the orchard in each season', async ({ page }) => {
  test.setTimeout(90_000);
  await ownOrchard(page);
  await plantEverything(page);
  await game(page, (g) => {
    // grown and laden (the age is what the calendar says, so back-date the planting)
    for (const t of g.state.orchard.trees) {
      t.plantedDay -= 20;
      t.fruit = 24;
    }
  });
  await page.evaluate(() => (window as unknown as Win).__view.showTile(28, 3));
  const seen: string[] = [];
  for (let i = 0; i < 10 && seen.length < 4; i++) {
    const season = await game(page, (g) => g.calendar().season);
    if (!seen.includes(season)) {
      seen.push(season);
      await page.evaluate(() => document.getElementById('toasts')?.replaceChildren()); // keep the picture clear of toasts
      await page.waitForTimeout(500);
      await page.screenshot({ path: `docs/screenshots/v2-03-orchard-${season}.png` });
    }
    // the next season is at most a week of real days away
    await game(page, (g) => g.debugFakeOffline(3 * 24 * 3_600_000));
    await page.evaluate(() => (window as unknown as Win).__view.showTile(28, 3));
  }
  expect(seen.sort()).toEqual(['autumn', 'spring', 'summer', 'winter']);
});
