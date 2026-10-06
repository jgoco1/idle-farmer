// v4 phase 02: the restaurant. Click its lot on the north road, build The Bramble Table, put dishes from the bag
// on the menu, step away for an hour and see the takings and the away summary; diners come and go (render only).
// Screenshots: the restaurant by day and by night, and its panel.

import { expect, test, type Page } from '@playwright/test';
import { clickTile, shot, tilePoint, type WithView } from './helpers';

type Slot = { item: string | null; qty: number };
type Win = WithView & {
  __view: {
    diners(): { count: number; seated: number };
    lightsLit(): number;
    awayFor(ms: number): void;
  };
  __game: {
    state: {
      gold: number;
      progression: { farmLevelFloor: number; milestones: { done: string[] } };
      calendar: { debugOffsetMs: number };
      upgrades: Record<string, number>;
      inventory: { slots: ({ item: string; qty: number; hearty?: true } | null)[] };
      restaurant: { level: number; menu: Slot[]; today: { gold: number; served: number } };
      stats: { restaurantGold: number; served: number };
    };
    dispatch(action: unknown): { ok: boolean; reason?: string };
  };
};

const HOUR = 3_600_000;
const SITE = { col: 24, row: -4 }; // the middle of the restaurant's lot (22, −6) 5 × 5

const splashGone = (page: Page): Promise<void> => expect(page.locator('#splash')).toHaveCount(0);

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

/** Test shortcut: a farm that can open the restaurant (Farm Level 7, Kitchen Level 2, the Old Paddock), with dishes in the bag. */
async function readyForTheRestaurant(page: Page): Promise<void> {
  await page.evaluate(() => {
    const game = (window as unknown as Win).__game;
    game.state.progression.farmLevelFloor = 7;
    game.state.gold = 2_000_000;
    for (const id of ['farm_1', 'farm_2', 'farm_3']) game.dispatch({ type: 'buyExpansion', id });
    for (const parcel of ['orchard', 'yard']) game.dispatch({ type: 'buyParcel', parcel });
    game.state.upgrades.kitchen = 2;
    game.state.progression.milestones.done.push('m25_first_serving'); // keep the takings check to the guests' gold
    const slots = game.state.inventory.slots;
    slots[1] = { item: 'roasted_turnip', qty: 40 };
    slots[2] = { item: 'tomato_pasta', qty: 12 };
    slots[3] = { item: 'pumpkin_soup', qty: 6 };
    game.state.gold = 600_000;
  });
}

async function setLocalTime(page: Page, hour: number): Promise<void> {
  await page.evaluate((hr) => {
    const g = (window as unknown as Win).__game;
    const d = new Date();
    d.setHours(hr, 0, 0, 0);
    g.state.calendar.debugOffsetMs = d.getTime() - Date.now();
  }, hour);
  await page.waitForTimeout(150);
}

test('build the restaurant from its lot, stock the menu, step away an hour: gold and the away summary; screenshots', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('./');
  await splashGone(page);
  await readyForTheRestaurant(page);
  await setLocalTime(page, 11);

  // The lot opens the panel with the build card; the toolbar has no Restaurant button yet.
  await expect(page.locator('[data-panel-button="restaurant"]')).toBeHidden();
  await clickTile(page, SITE.col, SITE.row);
  const panel = page.getByRole('dialog', { name: 'Restaurant' });
  await expect(panel).toBeVisible();
  await panel.locator('[data-build-restaurant]').click();
  await expect(panel.locator('[data-table]')).toHaveCount(2);
  await expect(page.locator('[data-panel-button="restaurant"]')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as Win).__game.state.gold)).toBe(480_000);

  // Fill from the bag: all the vegetable soup on a table, ten roasted turnips on the other.
  await panel.locator('[data-fill="tomato_pasta:all"]').click();
  await panel.locator('[data-fill="roasted_turnip:10"]').click();
  const menu = await page.evaluate(() => (window as unknown as Win).__game.state.restaurant.menu);
  expect(menu.map((m) => [m.item, m.qty]).sort()).toEqual([
    ['roasted_turnip', 10],
    ['tomato_pasta', 12],
  ]);
  await expect(panel.locator('[data-table-status="0"]')).toContainText('Next serving in');
  await expect(panel.getByTestId('restaurant-specials').locator('li')).toHaveCount(7);
  await page.addStyleTag({ content: '#toasts { visibility: hidden; }' }); // the milestone toasts would cover the panel
  await page.waitForTimeout(300);
  await panel.screenshot({ path: shot('v4-02-restaurant-panel.png') });
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await page.addStyleTag({ content: '#toasts { visibility: visible; }' });

  // By day, diners walk up the north road and sit at the stocked tables (render only).
  await tilePoint(page, SITE.col, SITE.row);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Win).__view.diners().seated), { timeout: 20_000 })
    .toBe(2);
  await page.screenshot({ path: shot('v4-02-restaurant-day.png') });

  // An hour away: four turnips (15 min each) and two pastas (T2, 30 min) at 1.30× base, and the summary says so.
  const gold = await page.evaluate(() => (window as unknown as Win).__game.state.gold);
  await page.evaluate((ms) => (window as unknown as Win).__view.awayFor(ms), HOUR);
  const away = page.getByRole('dialog', { name: 'While you were away…' });
  await expect(away).toBeVisible();
  const after = await page.evaluate(() => {
    const s = (window as unknown as Win).__game.state;
    return { gold: s.gold, served: s.stats.served, takings: s.stats.restaurantGold };
  });
  expect(after.served).toBe(6);
  expect(after.takings).toBe(4 * Math.round(55 * 1.3) + 2 * Math.round(176 * 1.3));
  expect(after.gold - gold).toBeGreaterThanOrEqual(after.takings);
  await expect(away).toContainText(
    `The restaurant served 6 dishes for ${after.takings.toLocaleString('en-US')}g.`,
  );
  await page.keyboard.press('Escape');
  await expect(away).toBeHidden();

  // By night the windows glow and everyone dines inside.
  await setLocalTime(page, 22);
  await tilePoint(page, SITE.col, SITE.row);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Win).__view.diners().count), { timeout: 20_000 })
    .toBe(0);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Win).__view.lightsLit()))
    .toBeGreaterThan(0);
  await page.waitForTimeout(400);
  await page.screenshot({ path: shot('v4-02-restaurant-night.png') });
  expect(errors).toEqual([]);
});
