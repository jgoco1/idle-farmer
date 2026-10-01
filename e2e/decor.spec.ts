// v2 phase 02: the Decor shop, Decorate mode (place, move, pick up), a lamp that glows at night, charm, and
// a town project stage that changes the world. Screenshots go to docs/screenshots.

import { expect, test, type Page } from '@playwright/test';
import { clickTile, hoverTile, type WithView } from './helpers';

type Game = {
  state: {
    gold: number;
    land: { parcels: string[] };
    inventory: { slots: ({ item: string; qty: number } | null)[] };
    progression: { farmLevelFloor: number; milestones: { done: string[] } };
    decor: {
      owned: Record<string, number>;
      placed: { id: number; decor: string; at: { col: number; row: number } }[];
    };
    town: { projects: Record<string, { stagesDone: number }> };
    calendar: { debugOffsetMs: number };
  };
  dispatch(action: unknown): { ok: boolean; reason?: string };
};
type Win = WithView & {
  __game: Game;
  __view: WithView['__view'] & { lightsLit(): number; sceneSprites(): string[]; decorMode(): boolean };
};

const game = <T>(page: Page, fn: (g: Game) => T): Promise<T> =>
  page.evaluate(`(${fn.toString()})(window.__game)`) as Promise<T>;

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

test('buy a lamp and a path, place and move them in Decorate mode, and the lamp glows at night', async ({
  page,
}) => {
  await game(page, (g) => {
    g.state.gold = 5_000_000;
    g.state.town.projects.fountain = { stagesDone: 1 }; // 10 charm: the garden lamp opens
  });
  await page.getByRole('button', { name: /^Shop/ }).first().click();
  await page.getByRole('tab', { name: 'Decor' }).click();
  await page.locator('[data-decor-buy="cobble_path:5"]').click();
  await expect(page.locator('[data-decor="cobble_path"]')).toContainText('Owned 5');
  await page.locator('[data-decor-buy="garden_lamp:1"]').click();
  await expect(page.locator('[data-decor="garden_lamp"]')).toContainText('Owned 1');
  await expect(page.locator('[data-decor="plank_path"]')).toContainText('Locked');
  await page.locator('[data-decorate-start]').click();
  await expect(page.getByTestId('decor-tray')).toBeVisible();

  // The tray holds both pieces; place the path on three tiles and the lamp beside them.
  await page.locator('[data-decor-chip="cobble_path"]').click();
  await clickTile(page, 6, 9);
  await clickTile(page, 7, 9);
  await clickTile(page, 8, 9);
  await page.locator('[data-decor-chip="garden_lamp"]').click();
  await hoverTile(page, 9, 9);
  await clickTile(page, 9, 9);
  let placed = await game(page, (g) => g.state.decor.placed.map((p) => `${p.decor}@${p.at.col},${p.at.row}`));
  expect(placed).toEqual(['cobble_path@6,9', 'cobble_path@7,9', 'cobble_path@8,9', 'garden_lamp@9,9']);

  // A refused tile says why and places nothing: the field's fence ring.
  await page.locator('[data-decor-chip="cobble_path"]').click();
  await hoverTile(page, 8, 6);
  await clickTile(page, 8, 6);
  expect(await game(page, (g) => g.state.decor.placed.length)).toBe(4);

  // Move the lamp: click it (it is picked up in hand), then click a free tile.
  await page.keyboard.press('Escape'); // drop the chosen piece
  await clickTile(page, 9, 9);
  await clickTile(page, 11, 9);
  placed = await game(page, (g) => g.state.decor.placed.map((p) => `${p.decor}@${p.at.col},${p.at.row}`));
  expect(placed).toContain('garden_lamp@11,9');

  // By day nothing is lit; at night the lamp glows.
  await setLocalTime(page, 12);
  expect(await page.evaluate(() => (window as unknown as Win).__view.lightsLit())).toBe(0);
  await page.screenshot({ path: 'docs/screenshots/v2-02-decorated-day.png' });
  await setLocalTime(page, 23);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Win).__view.lightsLit()))
    .toBeGreaterThan(0);
  await page.screenshot({ path: 'docs/screenshots/v2-02-decorated-night.png' });

  // Pick it up: back to the stock.
  await clickTile(page, 11, 9);
  await page.locator('[data-decor-pickup]').click();
  expect(await game(page, (g) => g.state.decor.placed.length)).toBe(3);
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('decor-tray')).toBeHidden();
});

test('the Decor shop', async ({ page }) => {
  await game(page, (g) => {
    g.state.gold = 200_000;
    g.state.town.projects.old_bridge = { stagesDone: 3 };
  });
  await page.getByRole('button', { name: /^Shop/ }).first().click();
  await page.getByRole('tab', { name: 'Decor' }).click();
  await expect(page.locator('[data-decor-set="seaside"]')).toContainText('Plank Path');
  await page.screenshot({ path: 'docs/screenshots/v2-02-decor-shop.png' });
});

test('donating a town project stage changes the world and adds charm', async ({ page }) => {
  await game(page, (g) => {
    g.state.gold = 1_000_000;
    g.state.progression.farmLevelFloor = 7;
    g.state.inventory.slots[3] = { item: 'driftwood', qty: 10 };
  });
  const before = await page.evaluate(() => (window as unknown as Win).__view.sceneSprites());
  expect(before).toContain('obj_old_bridge_0');
  await page
    .getByRole('button', { name: /^Goals/ })
    .first()
    .click();
  await page.getByRole('tab', { name: 'Town' }).click();
  await page.locator('[data-donate="old_bridge:all"]').click();
  await page.locator('[data-give="old_bridge:driftwood"]').click();
  await expect.poll(() => game(page, (g) => g.state.town.projects.old_bridge?.stagesDone)).toBe(1);
  const after = await page.evaluate(() => (window as unknown as Win).__view.sceneSprites());
  expect(after).toContain('obj_old_bridge_1');
  expect(after).not.toContain('obj_old_bridge_0');
  await page.getByRole('tab', { name: 'Goals' }).click();
  await expect(page.getByTestId('charm')).toContainText('Charm 10');
  expect(await game(page, (g) => g.state.progression.milestones.done)).toContain('m19_first_project');

  // Finish the whole project and look at it.
  await game(page, (g) => {
    g.state.town.projects.old_bridge = { stagesDone: 3 };
    g.state.town.projects.fountain = { stagesDone: 3 };
    g.state.town.projects.bakery = { stagesDone: 3 };
  });
  await page.keyboard.press('Escape');
  await page.evaluate(() => (window as unknown as Win).__view.showTile(4, 17));
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'docs/screenshots/v2-02-town-project.png' });
});
