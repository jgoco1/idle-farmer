// v2 phase 04: the Ranch. Build a coop in the Old Paddock, buy two hens, fill the trough, let time pass, collect the
// eggs by clicking the coop, cook an egg recipe, pet a hen, and look at the yard by day and by night and at the
// Ranch panel (screenshots in docs/screenshots).

import { expect, test, type Page } from '@playwright/test';
import { clickTile, type WithView } from './helpers';

type Game = {
  state: {
    gold: number;
    land: { parcels: string[] };
    inventory: { slots: ({ item: string; qty: number } | null)[] };
    ranch: {
      buildings: {
        id: number;
        kind: string;
        level: number;
        trough: number;
        store: { item: string; qty: number }[];
      }[];
      animals: { id: number; kind: string; name: string }[];
    };
    kitchen: { known: string[] };
    stats: { productsCollected: number };
    calendar: { debugOffsetMs: number };
    rngState: number;
  };
  dispatch(action: unknown): { ok: boolean; reason?: string };
  debugFakeOffline(ms: number): unknown;
};
type Win = WithView & {
  __game: Game;
  __view: WithView['__view'] & { animalAt(id: number): { x: number; y: number } | null };
};

const game = <T>(page: Page, fn: (g: Game) => T): Promise<T> =>
  page.evaluate(`(${fn.toString()})(window.__game)`) as Promise<T>;

const bag = (page: Page, item: string): Promise<number> =>
  page.evaluate(
    (it) =>
      (window as unknown as Win).__game.state.inventory.slots
        .filter((s) => s?.item === it)
        .reduce((n, s) => n + s!.qty, 0),
    item,
  );

async function setLocalTime(page: Page, hour: number): Promise<void> {
  await page.evaluate((hr) => {
    const g = (window as unknown as Win).__game;
    const d = new Date();
    d.setHours(hr, 0, 0, 0);
    g.state.calendar.debugOffsetMs = d.getTime() - Date.now();
  }, hour);
  await page.waitForTimeout(150);
}

test.beforeEach(async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#splash')).toHaveCount(0);
  await page.waitForFunction(() => !!(window as unknown as Partial<Win>).__game);
});

test('build a coop, buy two hens, fill the trough, wait, collect the eggs and cook with them', async ({
  page,
}) => {
  // The Ranch button appears with the Old Paddock.
  await expect(page.locator('[data-panel-button="ranch"]')).toBeHidden();
  await game(page, (g) => {
    g.state.gold = 5_000_000;
    g.state.land.parcels.push('orchard', 'yard');
  });
  await expect(page.locator('[data-panel-button="ranch"]')).toBeVisible();
  await page.locator('[data-panel-button="ranch"]').click();
  await expect(page.locator('[data-building="coop"]')).toContainText('25,000g');

  // Build: the panel closes and building mode shows a banner; a spot outside the paddock is refused.
  await page.locator('[data-build="coop"]').click();
  await expect(page.getByTestId('build-banner')).toBeVisible();
  await clickTile(page, 5, 15);
  expect(await game(page, (g) => g.state.ranch.buildings.length)).toBe(0);
  await clickTile(page, 22, 9);
  const coop = await game(page, (g) => g.state.ranch.buildings[0]);
  expect(coop).toMatchObject({ kind: 'coop', level: 1 });
  await expect(page.getByTestId('build-banner')).toBeHidden();
  // The panel opens on its own to the new building.
  await expect(page.locator('[data-building="coop"][data-level="1"]')).toBeVisible();

  // Two hens, then feed: buy corn feed and fill the trough.
  await page.locator('[data-buy-animal="chicken"]').click();
  await page.locator('[data-buy-animal="chicken"]').click();
  expect(await game(page, (g) => g.state.ranch.animals.map((a) => a.name))).toEqual(['Clover', 'Daisy']);
  await expect(page.locator('.ranch-status').first()).toContainText('would love some feed');
  await page.locator('[data-buy-feed="corn_feed:10"]').click();
  await page.locator(`[data-fill-trough="${coop!.id}"]`).click();
  expect(await game(page, (g) => g.state.ranch.buildings[0]!.trough)).toBe(10);
  await page.screenshot({ path: 'docs/screenshots/v2-04-ranch-panel.png' });

  // Name a hen.
  await page.locator('[data-animal-name="1"]').fill('Mabel');
  await page.locator('[data-animal-name="1"]').press('Enter');
  expect(await game(page, (g) => g.state.ranch.animals[0]!.name)).toBe('Mabel');
  await page
    .getByRole('button', { name: /^Close/ })
    .first()
    .click();

  // An hour of simulated time: two hens lay twice each.
  await game(page, (g) => g.debugFakeOffline(61 * 60_000));
  const waiting = await game(page, (g) => g.state.ranch.buildings[0]!.store.reduce((n, s) => n + s.qty, 0));
  expect(waiting).toBe(4);

  // Click the coop: the eggs go into the bag and the first-egg milestone teaches Fried Egg.
  await clickTile(page, 23, 10);
  await expect.poll(() => bag(page, 'egg')).toBeGreaterThan(0);
  expect((await bag(page, 'egg')) + (await bag(page, 'large_egg'))).toBe(4);
  expect(await game(page, (g) => g.state.stats.productsCollected)).toBe(4);
  expect(await game(page, (g) => g.state.kitchen.known)).toContain('fried_egg');

  // Cook it (two eggs make a Fried Egg) and let the stove finish.
  const cooked = await game(page, (g) => g.dispatch({ type: 'cook', recipe: 'fried_egg' }));
  expect(cooked.ok).toBe(true);
  await game(page, (g) => g.debugFakeOffline(60_000));
  await expect.poll(() => bag(page, 'fried_egg')).toBe(1);
});

test('hens wander by day, sleep by the coop at night, and can be petted without changing anything', async ({
  page,
}) => {
  await game(page, (g) => {
    g.state.gold = 5_000_000;
    g.state.land.parcels.push('orchard', 'yard');
    g.dispatch({ type: 'buildBuilding', building: 'coop', col: 22, row: 9 });
    g.dispatch({ type: 'buildBuilding', building: 'barn', col: 27, row: 9 });
    g.dispatch({ type: 'buildBuilding', building: 'silo', col: 33, row: 9 });
    for (let i = 0; i < 4; i++) g.dispatch({ type: 'buyAnimal', animal: 'chicken', building: 1 });
    for (let i = 0; i < 2; i++) g.dispatch({ type: 'buyAnimal', animal: 'cow', building: 2 });
  });
  await page
    .getByRole('button', { name: /^Close/ })
    .first()
    .click()
    .catch(() => undefined);
  await setLocalTime(page, 12);
  await page.evaluate(() => (window as unknown as Win).__view.showTile(28, 11));
  await page.waitForTimeout(900);
  await page.screenshot({ path: 'docs/screenshots/v2-04-yard-day.png' });

  // Petting is cosmetic: the whole state is the same afterwards.
  await page.waitForTimeout(500);
  const pos = await page.evaluate(() => (window as unknown as Win).__view.animalAt(1));
  expect(pos).not.toBeNull();
  const before = await game(page, (g) => JSON.stringify(g.state.ranch.animals) + g.state.rngState);
  await clickTile(page, Math.floor(pos!.x / 16), Math.floor((pos!.y - 4) / 16));
  await page.waitForTimeout(300);
  expect(await game(page, (g) => JSON.stringify(g.state.ranch.animals) + g.state.rngState)).toBe(before);

  await setLocalTime(page, 23);
  await page.waitForTimeout(6000); // they walk to bed
  await page.screenshot({ path: 'docs/screenshots/v2-04-yard-night.png' });
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { __view: { lightsLit(): number } }).__view.lightsLit()),
    )
    .toBeGreaterThan(0); // the lit windows of the coop and barn
});
