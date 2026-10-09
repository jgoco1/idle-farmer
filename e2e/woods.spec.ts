// v4 phase 04: the North Woods and the mountain lake. Forage a spot by clicking it, buy the Mountain Lake and
// catch a fish there (relaxed, scripted reeling), then the screenshots: the woods in two seasons, the lake, and
// the whole north zoomed out. On a phone (390 × 844, interface at 1.5×): tap a spot for its label, tap again to pick.

import { expect, test, type Page } from '@playwright/test';
import { clickTile, shot, tapTile, tilePoint, type WithView } from './helpers';

type Spot = { spot: number; item: string | null; qty: number };
type Win = WithView & {
  __view: { inspected(): { kind: number; id: number } };
  __game: {
    state: {
      gold: number;
      progression: { farmLevelFloor: number; milestones: { done: string[] } };
      calendar: { debugOffsetMs: number };
      settings: { relaxedFishing: boolean };
      expansions: string[];
      inventory: { slots: ({ item: string; qty: number } | null)[] };
      forage: { spots: Spot[] };
      stats: { foraged: number; fishCaught: number };
      fishing: {
        session: {
          phase: string;
          waitMs: number;
          reel: { marker: number; zoneCenter: number; meter: number } | null;
        } | null;
        collection: Record<string, { count: number }>;
      };
    };
    calendar(): { season: string; dayIndex: number };
    dispatch(action: unknown): { ok: boolean; reason?: string };
  };
};

const WEEK = 7 * 24 * 3_600_000;
const FORAGE_TILES = [
  { col: 22, row: -12 },
  { col: 25, row: -12 },
  { col: 26, row: -9 },
  { col: 23, row: -10 },
  { col: 29, row: -9 },
  { col: 32, row: -9 },
  { col: 34, row: -12 },
  { col: 34, row: -10 },
];
const LAKE = { col: 30, row: -12 };
const LAKE_FISH = ['whitefish', 'lake_trout', 'crayfish', 'pike', 'golden_trout', 'alpine_char'];

const splashGone = (page: Page): Promise<void> => expect(page.locator('#splash')).toHaveCount(0);

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

const state = (page: Page) => page.evaluate(() => (window as unknown as Win).__game.state);

/** Test shortcut: the farm up to the North Fields (which open the woods) and the Old Dock (the lake's prerequisite). */
async function readyForTheWoods(page: Page): Promise<void> {
  await page.evaluate(() => {
    const game = (window as unknown as Win).__game;
    game.state.progression.farmLevelFloor = 8;
    game.state.gold = 9_000_000;
    for (const id of ['farm_1', 'farm_2', 'farm_3', 'farm_4', 'river', 'ocean'])
      game.dispatch({ type: 'buyExpansion', id });
    for (const parcel of ['orchard', 'yard', 'north_fields']) game.dispatch({ type: 'buyParcel', parcel });
    // Keep the gold checks to this test's purchases (the rewards are tested in the unit tests).
    game.state.progression.milestones.done.push('m24_north_field', 'm28_first_forage');
    game.state.gold = 1_000_000;
  });
}

/**
 * Moves the game's calendar to local `hour` on the day it shows, then forward by whole weeks until `season`
 * (seasons are weekly, and the calendar never goes back).
 */
async function setTime(page: Page, hour: number, season?: string): Promise<void> {
  await page.evaluate(
    ([hr, want, week]) => {
      const g = (window as unknown as Win).__game;
      const d = new Date(Date.now() + g.state.calendar.debugOffsetMs);
      d.setHours(hr as number, 0, 0, 0);
      let off = d.getTime() - Date.now();
      g.state.calendar.debugOffsetMs = off;
      for (let k = 0; want && k < 5 && g.calendar().season !== want; k++) {
        off += week as number;
        g.state.calendar.debugOffsetMs = off;
      }
    },
    [hour, season ?? '', WEEK] as const,
  );
  await page.waitForTimeout(300);
}

async function hideToasts(page: Page): Promise<void> {
  await page.mouse.move(0, 0);
  await page.addStyleTag({ content: '#toasts { visibility: hidden; }' });
  await page.waitForTimeout(400);
}

test('forage a spot in the North Woods and catch a fish at the mountain lake; screenshots', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('./');
  await splashGone(page);
  await setTime(page, 11, 'spring');
  await readyForTheWoods(page);

  // The woods opened with the North Fields: eight spots, spring's finds on the mushroom, mint and elder spots.
  const spots = (await state(page)).forage.spots;
  expect(spots).toHaveLength(8);
  const ripe = spots.find((s) => s.qty > 0)!;
  expect(ripe).toBeDefined();
  const tile = FORAGE_TILES[ripe.spot]!;
  await clickTile(page, tile.col, tile.row);
  await expect.poll(async () => (await state(page)).stats.foraged).toBe(ripe.qty);
  const bag = (await state(page)).inventory.slots.filter((s) => s?.item === ripe.item);
  expect(bag.reduce((n, s) => n + s!.qty, 0)).toBe(ripe.qty);
  expect((await state(page)).forage.spots[ripe.spot]).toMatchObject({ item: null, qty: 0 });
  // A picked-clean spot says so.
  await clickTile(page, tile.col, tile.row);
  await expect(page.locator('#toasts')).toContainText('Picked clean');

  // The woods in spring, then in winter (snow on the floor, rose hips and hazels, the mushrooms resting).
  await page.evaluate(() => (window as unknown as Win).__view.showTile(28, -11));
  await hideToasts(page);
  await page.screenshot({ path: shot('v4-04-woods-spring.png') });

  // The lake is locked: a click names its price. Buy it in Upgrades' way (the action) and fish there.
  await clickTile(page, LAKE.col, LAKE.row);
  await expect(page.locator('#toasts')).toContainText('Mountain Lake: 300,000g');
  expect(
    (
      await page.evaluate(() =>
        (window as unknown as Win).__game.dispatch({ type: 'buyExpansion', id: 'lake' }),
      )
    ).ok,
  ).toBe(true);
  await expect(page.locator('#toasts')).toContainText('The Mountain Lake is open for fishing!');
  await page.evaluate(() => ((window as unknown as Win).__game.state.settings.relaxedFishing = true));
  await clickTile(page, LAKE.col, LAKE.row);
  const panel = page.getByRole('dialog', { name: 'Fishing' });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Biting now at the mountain lake');
  await page.waitForTimeout(400);
  const caughtLakeFish = async (): Promise<boolean> =>
    Object.keys((await state(page)).fishing.collection).some((f) => LAKE_FISH.includes(f));
  let landed = false;
  for (let attempt = 0; attempt < 6 && !landed; attempt++) {
    await page.waitForTimeout(1400); // the result pause after a catch or an escape
    await page.keyboard.down('Space');
    await page.waitForTimeout(500);
    await page.keyboard.up('Space');
    await expect.poll(async () => (await state(page)).fishing.session?.phase).toBe('waiting');
    await page.evaluate(() => {
      const s = (window as unknown as Win).__game.state.fishing.session;
      if (s) s.waitMs = 300; // test shortcut: skip most of the wait for a bite
    });
    await expect.poll(async () => (await state(page)).fishing.session?.phase, { timeout: 5000 }).toBe('bite');
    let down = false;
    for (let i = 0; i < 900; i++) {
      const s = (await state(page)).fishing.session;
      if (!s || s.phase === 'charging' || s.phase === 'waiting') break;
      const want = s.reel ? s.reel.marker < s.reel.zoneCenter : true;
      if (want !== down) {
        if (want) await page.keyboard.down('Space');
        else await page.keyboard.up('Space');
        down = want;
      }
      await page.waitForTimeout(25);
    }
    if (down) await page.keyboard.up('Space');
    landed = await caughtLakeFish(); // junk (a boot, driftwood) can bite too: cast again
  }
  expect(landed).toBe(true);
  await expect(panel.locator('.fish-result')).toContainText(/You caught/);
  await page.keyboard.press('Escape');

  // The lake by day with its two traps (the pond, river and dock take the first six), then the woods in winter.
  await page.evaluate(() => {
    const g = (window as unknown as Win).__game;
    for (let i = 0; i < 8; i++) g.dispatch({ type: 'buyUpgrade', id: 'fish_trap' });
  });
  const lakeTraps = await page.evaluate(
    () =>
      (
        (window as unknown as Win).__game.state.fishing as unknown as { traps: { location: string }[] }
      ).traps.filter((t) => t.location === 'lake').length,
  );
  expect(lakeTraps).toBe(2);
  await page.evaluate(() => (window as unknown as Win).__view.showTile(30, -11));
  await hideToasts(page);
  await page.screenshot({ path: shot('v4-04-lake.png') });
  await setTime(page, 11, 'winter');
  await page.evaluate(() => (window as unknown as Win).__view.showTile(28, -11));
  await hideToasts(page);
  await page.screenshot({ path: shot('v4-04-woods-winter.png') });
  const winter = (await state(page)).forage.spots;
  expect(winter.filter((s) => s.item === 'rose_hip' || s.item === 'hazelnut').length).toBeGreaterThan(0);

  // The whole north in use, zoomed out: both fields growing, the restaurant, the Press House and its hives.
  await setTime(page, 11, 'summer');
  await page.evaluate(() => {
    const g = (window as unknown as Win).__game;
    const st = g.state as unknown as {
      gold: number;
      upgrades: Record<string, number>;
      farm: { north: Record<string, { plots: Record<string, unknown>[] } | undefined> };
    };
    st.gold = 9_000_000;
    st.upgrades.kitchen = 2;
    g.dispatch({ type: 'buyParcel', parcel: 'terraces' });
    g.dispatch({ type: 'buildRestaurant' });
    g.dispatch({ type: 'buildPress' });
    for (let i = 0; i < 4; i++) g.dispatch({ type: 'buyHive' });
    const crops = ['tomato', 'corn', 'melon', 'blueberry'];
    for (const f of ['north_fields', 'terraces'])
      st.farm.north[f]!.plots.forEach((p, i) =>
        Object.assign(p, {
          state: 'planted',
          crop: crops[Math.floor(i / 8) % 4],
          growthMs: 60_000 * (5 + (i % 7) * 3),
          waterMsLeft: 600_000,
        }),
      );
  });
  await page.evaluate(() => (window as unknown as Win).__view.showTile(18, -7));
  await page.getByRole('button', { name: 'Zoom out' }).click();
  await hideToasts(page);
  await page.screenshot({ path: shot('v4-04-north-zoomed-out.png') });
  expect(errors).toEqual([]);
});

test.describe('phone 390x844 at 1.5× interface size', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the first tap on a forage spot shows its label, the second picks; the lake panel fits', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await page.goto('./');
    await splashGone(page);
    await page.evaluate(() => document.documentElement.style.setProperty('--ui-scale', '1.5'));
    await setTime(page, 11, 'spring');
    await readyForTheWoods(page);
    const spots = (await state(page)).forage.spots;
    const ripe = spots.find((s) => s.qty > 0)!;
    const tile = FORAGE_TILES[ripe.spot]!;
    await tilePoint(page, tile.col, tile.row);
    await tapTile(page, tile.col, tile.row);
    const label = page.getByTestId('tree-tip');
    await expect(label).toBeVisible();
    await expect(label).toContainText('tap again to pick');
    expect((await state(page)).stats.foraged).toBe(0);
    await tapTile(page, tile.col, tile.row);
    await expect.poll(async () => (await state(page)).stats.foraged).toBe(ripe.qty);
    // The label stays inside the screen.
    const box = (await label.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);

    // The lake's Fishing panel fits the phone at 1.5×.
    await page.evaluate(() => {
      const g = (window as unknown as Win).__game;
      g.state.gold = 1_000_000;
      g.dispatch({ type: 'buyExpansion', id: 'lake' });
    });
    await tapTile(page, LAKE.col, LAKE.row);
    const panel = page.getByRole('dialog', { name: 'Fishing' });
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('mountain lake');
    const p = (await panel.boundingBox())!;
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.x + p.width).toBeLessThanOrEqual(390);
    await page.screenshot({ path: 'test-results/woods-phone.png' });
    expect(errors).toEqual([]);
  });
});
