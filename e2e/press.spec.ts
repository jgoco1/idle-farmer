// v4 phase 03: the Press House and the apiary. Build the Press House from its lot, buy a hive, step away for
// honey and collect it from the hive, press Peach Iced Tea from a peach and the honey, collect it from its
// press in the yard, put it on the restaurant's menu and see it served while away.
// Screenshots: the Press House and the hives, its panel, and a drink on the menu.

import { expect, test, type Page } from '@playwright/test';
import { clickTile, shot, tilePoint, type WithView } from './helpers';

type Win = WithView & {
  __view: { awayFor(ms: number): void };
  __game: {
    state: {
      gold: number;
      progression: { farmLevelFloor: number; milestones: { done: string[] } };
      calendar: { debugOffsetMs: number };
      inventory: { slots: ({ item: string; qty: number; hearty?: true } | null)[] };
      press: { level: number; slots: { recipe: string | null; remainingMs: number; done: number }[] };
      apiary: { hives: { spot: number; honey: number }[] };
      restaurant: { level: number; menu: { item: string | null; qty: number }[] };
      stats: { served: number; restaurantGold: number; drinksPressed: number; honeyCollected: number };
    };
    dispatch(action: unknown): { ok: boolean; reason?: string };
  };
};

const HOUR = 3_600_000;
const SITE = { col: 29, row: -4 }; // inside the Press House's lot (28, −6) 4 × 5
const YARD = { col: 28, row: -2 }; // the first press in its yard
const HIVE = { col: 32, row: -6 }; // the first hive spot

const splashGone = (page: Page): Promise<void> => expect(page.locator('#splash')).toHaveCount(0);

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

/** Test shortcut: Farm Level 7 and the Old Orchard Plot (the Press House's requirements), an open restaurant, peaches. */
async function readyForThePress(page: Page): Promise<void> {
  await page.evaluate(() => {
    const game = (window as unknown as Win).__game;
    game.state.progression.farmLevelFloor = 7;
    game.state.gold = 3_000_000;
    for (const id of ['farm_1', 'farm_2', 'farm_3']) game.dispatch({ type: 'buyExpansion', id });
    for (const parcel of ['orchard', 'yard']) game.dispatch({ type: 'buyParcel', parcel });
    (game.state as unknown as { upgrades: Record<string, number> }).upgrades.kitchen = 2;
    game.dispatch({ type: 'buildRestaurant' });
    // Keep the gold checks to the guests' and the purchases' (their rewards are tested in the unit tests).
    game.state.progression.milestones.done.push('m25_first_serving', 'm26_first_drink', 'm27_first_honey');
    game.state.inventory.slots[1] = { item: 'peach', qty: 2 };
    game.state.gold = 1_000_000;
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

const state = (page: Page) => page.evaluate(() => (window as unknown as Win).__game.state);

async function stepAway(page: Page, ms: number): Promise<string> {
  await page.evaluate((t) => (window as unknown as Win).__view.awayFor(t), ms);
  const away = page.getByRole('dialog', { name: 'While you were away…' });
  await expect(away).toBeVisible();
  const text = (await away.textContent()) ?? '';
  await page.keyboard.press('Escape');
  await expect(away).toBeHidden();
  return text;
}

test('build the Press House and a hive, press a drink from honey and fruit, serve it at the restaurant; screenshots', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('./');
  await splashGone(page);
  await readyForThePress(page);
  await setLocalTime(page, 11);

  // The lot opens the panel with the build card; no toolbar button yet.
  await expect(page.locator('[data-panel-button="press"]')).toBeHidden();
  await clickTile(page, SITE.col, SITE.row);
  const panel = page.getByRole('dialog', { name: 'Press House' });
  await expect(panel).toBeVisible();
  await panel.locator('[data-build-press]').click();
  await expect(panel.locator('[data-press-slot]')).toHaveCount(2);
  await expect(page.locator('[data-panel-button="press"]')).toBeVisible();
  await expect(panel.locator('[data-drink="tomato_juice"]')).toBeVisible();
  await expect(panel.locator('[data-drink="honey_milk"]')).toBeVisible();

  // A hive on the first spot, from the Apiary card.
  await panel.locator('[data-buy-hive]').click();
  expect((await state(page)).apiary.hives).toMatchObject([{ id: 1, spot: 0, honey: 0 }]);
  await page.keyboard.press('Escape');

  // An hour away: a jar of honey; click the hive to collect it.
  const away1 = await stepAway(page, HOUR);
  expect(away1).toContain('The bees made 1 jar of honey.');
  await clickTile(page, HIVE.col, HIVE.row);
  await expect.poll(async () => (await state(page)).stats.honeyCollected).toBe(1);

  // Buy the Peach Iced Tea card and press one from a peach and the honey.
  await page.locator('[data-panel-button="press"]').click();
  await expect(panel).toBeVisible();
  await panel.locator('[data-buy-card="peach_iced_tea"]').click();
  await panel.locator('[data-press="peach_iced_tea"]').click();
  const pressing = (await state(page)).press.slots[0]!;
  expect(pressing).toMatchObject({ recipe: 'peach_iced_tea', done: 0 });
  expect(pressing.remainingMs).toBeGreaterThan(HOUR - 10_000); // the game runs on while the test reads it
  await expect(panel.locator('[data-press-status="0"]')).toContainText('left');
  await page.addStyleTag({ content: '#toasts { visibility: hidden; }' });
  await panel.evaluate((el) => el.querySelectorAll('*').forEach((e) => (e.scrollTop = 0)));
  await page.waitForTimeout(300);
  await panel.screenshot({ path: shot('v4-03-press-panel.png') });
  await page.keyboard.press('Escape');
  await page.addStyleTag({ content: '#toasts { visibility: visible; }' });

  // An hour later the tea waits in its press; a click on the press in the yard collects it.
  const away2 = await stepAway(page, HOUR);
  expect(away2).toContain('The presses made 1 drink (1 Peach Iced Tea).');
  await clickTile(page, YARD.col, YARD.row);
  await expect.poll(async () => (await state(page)).press.slots[0]!.done).toBe(0);
  const bag = (await state(page)).inventory.slots.filter((s) => s?.item === 'peach_iced_tea');
  expect(bag.reduce((n, s) => n + s!.qty, 0)).toBe(1);

  // Onto the menu from the Restaurant panel.
  await page.locator('[data-panel-button="restaurant"]').click();
  const inn = page.getByRole('dialog', { name: 'Restaurant' });
  await expect(inn).toBeVisible();
  await inn.locator('[data-fill="peach_iced_tea:all"]').click();
  expect((await state(page)).restaurant.menu.map((m) => [m.item, m.qty])).toContainEqual([
    'peach_iced_tea',
    1,
  ]);
  await page.addStyleTag({ content: '#toasts { visibility: hidden; }' });
  await page.waitForTimeout(300);
  await inn.screenshot({ path: shot('v4-03-drink-on-menu.png') });
  await page.keyboard.press('Escape');
  await page.addStyleTag({ content: '#toasts { visibility: visible; }' });

  // The Press House and the hive by day, the presses in the yard (a second hive, and a press at work).
  await page.evaluate(() => {
    const game = (window as unknown as Win).__game;
    game.dispatch({ type: 'buyHive' });
    game.state.inventory.slots[2] = { item: 'tomato', qty: 4 };
    game.dispatch({ type: 'startPress', slot: 1, recipe: 'tomato_juice' });
  });
  await page.addStyleTag({ content: '#toasts { visibility: hidden; }' });
  await tilePoint(page, SITE.col + 1, SITE.row);
  await page.waitForTimeout(400);
  await page.screenshot({ path: shot('v4-03-press-house.png') });
  await page.addStyleTag({ content: '#toasts { visibility: visible; }' });

  // A T3 drink is served after 45 minutes: away an hour, the guests paid for it.
  const away3 = await stepAway(page, HOUR);
  const after = await state(page);
  expect(after.stats.served).toBe(1);
  expect(after.stats.restaurantGold).toBeGreaterThanOrEqual(Math.round(1040 * 1.3));
  expect(away3).toContain(
    `The restaurant served 1 drink for ${after.stats.restaurantGold.toLocaleString('en-US')}g.`,
  );
  expect(errors).toEqual([]);
});
