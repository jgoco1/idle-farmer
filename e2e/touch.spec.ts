// v2 phase 05: input polish. On a 390 × 844 touch phone: the default view starts on the field (and Home returns
// there), the first tap on a tree or a hen shows its label and the second picks or pets, and Paint mode makes a
// one-finger drag till along the stroke while two fingers still pan. On a desktop: hovering a hen shows its label,
// Alt-drag paints with Paint off, and the Ranch panel shows the feed store. Screenshots go to docs/screenshots with
// UPDATE_SCREENSHOTS=1.

import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { camera, plotTile, shot, tilePoint, type WithView } from './helpers';

type Game = {
  state: {
    gold: number;
    land: { parcels: string[] };
    farm: { plots: { state: string; crop: string | null }[] };
    orchard: { trees: { id: number; fruit: number }[] };
    ranch: {
      buildings: { id: number; trough: number }[];
      animals: { id: number; name: string }[];
      feedStore: Record<string, number>;
    };
    stats: { fruitPicked: number };
    inventory: { slots: ({ item: string; qty: number } | null)[] };
  };
  dispatch(action: unknown): { ok: boolean; reason?: string };
};
type View = WithView['__view'] & {
  animalAt(id: number): { x: number; y: number } | null;
  worldClient(x: number, y: number): { x: number; y: number };
  inspected(): { kind: number; id: number };
  painting(): boolean;
};
type Win = { __game: Game; __view: View };

const game = <T>(page: Page, fn: (g: Game) => T): Promise<T> =>
  page.evaluate(`(${fn.toString()})(window.__game)`) as Promise<T>;

/** Opens the game with motion reduced (the hens stand still, so a tap lands on them) and optional prefs. */
async function open(page: Page, prefs: Record<string, unknown> = {}): Promise<void> {
  await page.addInitScript((p) => {
    localStorage.setItem(
      'hearthfield-idle/prefs',
      JSON.stringify({ tutorial: 'skipped', motion: 'reduce', ...p }),
    );
  }, prefs);
  await page.goto('./');
  await expect(page.locator('#splash')).toHaveCount(0);
  await page.waitForFunction(() => !!(window as unknown as Partial<Win>).__game);
}

async function orchardWithPeach(page: Page): Promise<number> {
  return game(page, (g) => {
    g.state.gold = 5_000_000;
    g.state.land.parcels.push('orchard');
    g.dispatch({ type: 'buySapling', fruit: 'peach', qty: 1 });
    g.dispatch({ type: 'plantTree', fruit: 'peach', spot: 0 });
    const t = g.state.orchard.trees[0]!;
    t.fruit = 12;
    return t.id;
  });
}

async function yardWithHens(page: Page): Promise<void> {
  await game(page, (g) => {
    g.state.gold = 5_000_000;
    g.state.land.parcels.push('orchard', 'yard');
    g.dispatch({ type: 'buildBuilding', building: 'coop', col: 22, row: 9 });
    g.dispatch({ type: 'buyAnimal', animal: 'chicken', building: 1 });
    g.dispatch({ type: 'buyAnimal', animal: 'chicken', building: 1 });
    g.state.ranch.feedStore.corn_feed = 40;
    g.dispatch({ type: 'fillTrough', building: 1 });
  });
  // Building the coop opens the Ranch panel; close it so the yard is in view (on a phone it covers the scene).
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="ranch"]')).toBeHidden();
  await page.evaluate(() => (window as unknown as Win).__view.showTile(23, 11));
  await page.waitForTimeout(600);
}

/** Where hen `id` stands, in client px (just above its feet, on its body). */
async function henPoint(page: Page, id: number): Promise<{ x: number; y: number }> {
  return page.evaluate((i) => {
    const v = (window as unknown as Win).__view;
    const at = v.animalAt(i)!;
    return v.worldClient(at.x, at.y - 4);
  }, id);
}

/** A touch gesture through the DevTools protocol: each step lists where every finger is (empty: all lifted). */
async function touchPath(cdp: CDPSession, steps: { x: number; y: number }[][], begin = true): Promise<void> {
  for (let i = 0; i < steps.length; i++) {
    const pts = steps[i]!.map((p, id) => ({ x: p.x, y: p.y, id }));
    const type = i === 0 && begin ? 'touchStart' : pts.length === 0 ? 'touchEnd' : 'touchMove';
    await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  }
}

/** Points along a line, so a drag is a stream of moves rather than one jump. */
function line(a: { x: number; y: number }, b: { x: number; y: number }, n = 8): { x: number; y: number }[] {
  return Array.from({ length: n + 1 }, (_, i) => ({
    x: a.x + ((b.x - a.x) * i) / n,
    y: a.y + ((b.y - a.y) * i) / n,
  }));
}

const plotStates = (page: Page): Promise<string[]> =>
  game(page, (g) => g.state.farm.plots.map((p) => p.state));

test.describe('on a 390 × 844 touch phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });

  test('the default view starts on the field, and Home goes back there', async ({ page }) => {
    await open(page);
    const start = await camera(page);
    expect(start.default).toBe(true);
    expect(start.x).toBe(8 * 16); // the 4 × 2 field's middle (columns 6–9)
    for (let i = 0; i < 8; i++) {
      const [c, r] = plotTile(i);
      const seen = await page.evaluate(
        ([cc, rr]) => (window as unknown as Win).__view.tileClient(cc!, rr!),
        [c, r],
      );
      expect(seen.visible, `plot ${i}`).toBe(true);
    }
    await page.evaluate(() => (window as unknown as Win).__view.showTile(30, 18));
    await page.waitForTimeout(400);
    expect((await camera(page)).x).not.toBe(start.x);
    await page.getByRole('button', { name: 'Back to the farm' }).tap();
    await expect.poll(async () => (await camera(page)).x).toBe(start.x);
  });

  test('the first tap on a tree shows its label, the second picks it', async ({ page }) => {
    await open(page);
    const id = await orchardWithPeach(page);
    const at = await tilePoint(page, 22, 2);
    const label = page.getByTestId('tree-tip');
    await page.touchscreen.tap(at.x, at.y);
    await expect(label).toBeVisible();
    await expect(label).toContainText('Peach tree');
    await expect(label).toContainText('Fruit 12 / 128 · tap again to pick');
    expect(await game(page, (g) => g.state.orchard.trees[0]!.fruit)).toBe(12); // not picked yet
    await page.screenshot({ path: shot('v2-05-tree-label-phone.png') });
    await page.touchscreen.tap(at.x, at.y);
    await expect.poll(() => game(page, (g) => g.state.stats.fruitPicked)).toBe(12);
    await expect(label).toContainText('Fruit 0 / 128');
    expect(await page.evaluate(() => (window as unknown as Win).__view.inspected())).toEqual({ kind: 1, id });
    // A tap on open grass puts the label away.
    const grass = await tilePoint(page, 26, 6);
    await page.touchscreen.tap(grass.x, grass.y);
    await expect(label).toBeHidden();
  });

  test('the first tap on a hen shows her label, the second pets her', async ({ page }) => {
    await open(page);
    await yardWithHens(page);
    const name = await game(page, (g) => g.state.ranch.animals[0]!.name);
    const at = await henPoint(page, 1);
    const label = page.getByTestId('tree-tip');
    await page.touchscreen.tap(at.x, at.y);
    await expect(label).toBeVisible();
    await expect(label).toContainText(`${name} · hen`);
    await expect(label).toContainText('Lives in the coop');
    await expect(label).toContainText('Trough');
    await expect(label).toContainText('tap again to pet');
    await expect(page.locator('.toast')).toHaveCount(0);
    await page.touchscreen.tap(at.x, at.y);
    await expect(page.locator('.toast').filter({ hasText: 'clucks happily' })).toBeVisible();
    await expect(label).toBeVisible();
    // A pan hides it.
    const cdp = await page.context().newCDPSession(page);
    await touchPath(cdp, [...line({ x: 200, y: 400 }, { x: 120, y: 380 }).map((p) => [p]), []]);
    await expect(label).toBeHidden();
  });

  test('Paint on: a one-finger drag tills along the stroke; off it pans; two fingers pan with Paint on', async ({
    page,
  }) => {
    await open(page);
    const cdp = await page.context().newCDPSession(page);
    expect(await plotStates(page)).toEqual([
      'tilled',
      'tilled',
      'untilled',
      'untilled',
      'tilled',
      'tilled',
      'untilled',
      'untilled',
    ]);
    const p2 = await tilePoint(page, ...plotTile(2));
    const p3 = await tilePoint(page, ...plotTile(3));
    const p7 = await tilePoint(page, ...plotTile(7));

    // Off (the default): the drag pans and no plot changes.
    const before = await camera(page);
    await touchPath(cdp, [...line(p2, { x: p3.x + 60, y: p3.y }).map((p) => [p]), []]);
    await expect.poll(async () => (await camera(page)).x).not.toBe(before.x);
    expect(await plotStates(page)).toEqual([
      'tilled',
      'tilled',
      'untilled',
      'untilled',
      'tilled',
      'tilled',
      'untilled',
      'untilled',
    ]);
    await page.getByRole('button', { name: 'Back to the farm' }).tap();
    await expect.poll(async () => (await camera(page)).x).toBe(before.x);

    // On: the same drag (down into the next row) tills plot 2, 3 and 7, and the camera stays.
    await page.getByTestId('paint-toggle').tap();
    await expect(page.getByTestId('paint-toggle')).toHaveAttribute('aria-pressed', 'true');
    const still = await camera(page);
    await touchPath(cdp, [...line(p2, p3, 6).map((p) => [p]), ...line(p3, p7, 6).map((p) => [p])]);
    expect(await page.evaluate(() => (window as unknown as Win).__view.painting())).toBe(true);
    await page.screenshot({ path: shot('v2-05-paint-mode.png') });
    await touchPath(cdp, [[p7], []], false);
    expect(await plotStates(page)).toEqual([
      'tilled',
      'tilled',
      'tilled',
      'tilled',
      'tilled',
      'tilled',
      'untilled',
      'tilled',
    ]);
    expect(await camera(page)).toEqual(still);

    // Two fingers still pan with Paint on, and paint nothing.
    const a = line({ x: 120, y: 420 }, { x: 60, y: 420 });
    const b = line({ x: 260, y: 420 }, { x: 200, y: 420 });
    await touchPath(cdp, [...a.map((p, i) => [p, b[i]!]), []]);
    await expect.poll(async () => (await camera(page)).x).not.toBe(still.x);
    expect(await plotStates(page)).toEqual([
      'tilled',
      'tilled',
      'tilled',
      'tilled',
      'tilled',
      'tilled',
      'untilled',
      'tilled',
    ]);

    // The toggle is kept in the per-device prefs, not the save.
    const stored = await page.evaluate(
      () => JSON.parse(localStorage.getItem('hearthfield-idle/prefs')!).paint,
    );
    expect(stored).toBe(true);
  });
});

test.describe('on a desktop', () => {
  test('hovering a hen shows her label: name, home, trough, store and the next egg', async ({ page }) => {
    await open(page);
    await yardWithHens(page);
    const name = await game(page, (g) => g.state.ranch.animals[1]!.name);
    const at = await henPoint(page, 2);
    await page.mouse.move(at.x, at.y);
    const label = page.getByTestId('tree-tip');
    await expect(label).toBeVisible();
    await expect(label).toContainText(`${name} · hen`);
    await expect(label).toContainText(/Trough \d+ \/ 64 · store 0 \/ 64/);
    await expect(label).toContainText(/Next eggs in \d+m · click to pet/);
    await page.screenshot({ path: shot('v2-05-animal-label.png') });
    await page.mouse.move(5, 300);
    await expect(label).toBeHidden();
  });

  test('Alt-drag paints with Paint off; a plain drag still pans', async ({ page }) => {
    await open(page);
    const p2 = await tilePoint(page, ...plotTile(2));
    const p3 = await tilePoint(page, ...plotTile(3));
    const before = await camera(page);
    await page.keyboard.down('Alt');
    await page.mouse.move(p2.x, p2.y);
    await page.mouse.down();
    for (const p of line(p2, p3)) await page.mouse.move(p.x, p.y);
    await page.mouse.up();
    await page.keyboard.up('Alt');
    expect((await plotStates(page)).slice(0, 4)).toEqual(['tilled', 'tilled', 'tilled', 'tilled']);
    expect(await camera(page)).toEqual(before);
    // without Alt the same kind of drag pans
    const p6 = await tilePoint(page, ...plotTile(6));
    await page.mouse.move(p6.x, p6.y);
    await page.mouse.down();
    for (const p of line(p6, { x: p6.x + 120, y: p6.y })) await page.mouse.move(p.x, p.y);
    await page.mouse.up();
    expect(await game(page, (g) => g.state.farm.plots[6]!.state)).toBe('untilled');
  });

  test('the Ranch panel shows the feed store: hay and corn feed out of the bag, with a capacity', async ({
    page,
  }) => {
    await open(page);
    await yardWithHens(page);
    await game(page, (g) => {
      g.state.ranch.feedStore.hay = 120;
      g.state.inventory.slots[3] = { item: 'corn', qty: 30 };
    });
    await page.locator('[data-panel-button="ranch"]').click();
    const store = page.getByTestId('feed-store');
    await expect(store).toContainText('Feed store');
    await expect(store.locator('[data-feed-stored="hay"]')).toContainText('Hay · 120 / 600 in the store');
    await store.locator('[data-make-feed="corn_feed:10"]').click();
    await expect(store.locator('[data-feed-stored="corn_feed"]')).toContainText('/ 600 in the store');
    expect(
      await game(page, (g) => g.state.inventory.slots.filter((s) => s?.item === 'corn_feed').length),
    ).toBe(0);
    await page.waitForTimeout(200);
    // the live panel re-renders each second, so scroll from the page rather than through a held element
    await page.evaluate(() =>
      document.querySelector('[data-testid="feed-store"]')?.scrollIntoView({ block: 'center' }),
    );
    await page.screenshot({ path: shot('v2-05-feed-store.png') });
  });
});
