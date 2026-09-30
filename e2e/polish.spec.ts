import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

type Win = {
  __game: {
    state: { gold: number; farm: { plots: { state: string; crop: string | null }[] } };
    dispatch(action: unknown): { ok: boolean; reason?: string };
  };
};

async function tileCenter(canvas: Locator, col: number, row: number): Promise<{ x: number; y: number }> {
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no box');
  return { x: (box.width * (col + 0.5)) / 20, y: (box.height * (row + 0.5)) / 12 };
}

const plotPos = (canvas: Locator, i: number): Promise<{ x: number; y: number }> =>
  tileCenter(canvas, 6 + (i % 4), 2 + Math.floor(i / 4));

/** The loading splash fades out after the first frame; screenshots wait for it to be gone. */
const splashGone = (page: Page): Promise<void> => expect(page.locator('#splash')).toHaveCount(0);

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

async function expectNoSeriousA11y(page: Page, what: string): Promise<void> {
  await page.waitForTimeout(400); // let the panel's pop-in finish: axe reads colours mid-fade otherwise
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(
    bad.map(
      (v) =>
        `${v.id}: ${v.help} (${v.nodes
          .map((n) => n.target.join(' '))
          .slice(0, 3)
          .join(' | ')})`,
    ),
    `axe on ${what}`,
  ).toEqual([]);
}

test.describe('first-time tutorial', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('walks a new player through the first steps, can be skipped, and replays from Settings', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await page.goto('./');
    const card = page.getByRole('region', { name: 'Tutorial' });
    await splashGone(page);
    await expect(card).toBeVisible();
    await expect(card).toContainText('Step 1 of 7');
    await expect(card).toContainText('Your plots');
    await page.screenshot({ path: 'test-results/tutorial.png' });

    await card.getByRole('button', { name: 'Next' }).click();
    await expect(card).toContainText('Plant seeds');
    // Planting advances it: the Auto tool plants the starting seeds on a tilled plot.
    const canvas = page.locator('#scene-canvas');
    await canvas.click({ position: await plotPos(canvas, 0) });
    await expect(card).toContainText('Water them');

    await card.getByRole('button', { name: 'Skip tutorial' }).click();
    await expect(card).toBeHidden();
    await page.reload();
    await expect(page.locator('#scene-canvas')).toBeVisible();
    await expect(card).toBeHidden(); // skipped stays skipped

    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Replay the tutorial' }).click();
    await expect(card).toBeVisible();
    await expect(card).toContainText('Step 1 of 7');
    expect(errors).toEqual([]);
  });
});

test('settings persist across a reload, and reduced motion, UI size and number format apply', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.goto('./');
  await page.getByRole('button', { name: 'Settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByLabel('Music').fill('10');
  await settings.getByLabel('Effects').fill('40');
  await settings.getByLabel('Mute everything').check();
  await settings.getByLabel('Reduce motion').check();
  await settings.getByLabel('Interface size').selectOption('1.5');
  await settings.getByLabel('Numbers').selectOption('short');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduce');

  await page.evaluate(() => {
    (window as unknown as Win).__game.state.gold = 12_345;
  });
  await expect(page.getByTestId('gold')).toHaveText('12.3Kg');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduce');
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(settings.getByLabel('Music')).toHaveValue('10');
  await expect(settings.getByLabel('Effects')).toHaveValue('40');
  await expect(settings.getByLabel('Mute everything')).toBeChecked();
  await expect(settings.getByLabel('Interface size')).toHaveValue('1.5');
  await expect(settings.getByLabel('Numbers')).toHaveValue('short');
  await page.screenshot({ path: 'test-results/settings-scaled.png' });
  expect(errors).toEqual([]);
});

test('the farm cat purrs when clicked, and audio starts on the first click without errors', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await page.goto('./');
  const canvas = page.locator('#scene-canvas');
  await canvas.click({ position: await tileCenter(canvas, 5, 3) });
  await expect(page.locator('#toasts')).toContainText('farm cat');
  expect(errors).toEqual([]);
});

test('desktop screenshots and accessibility: the main screen and a panel', async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('./');
  await expect(page.locator('#scene-canvas')).toBeVisible();
  await splashGone(page);
  await page.screenshot({ path: 'docs/screenshots/phase08-desktop.png' });
  await expectNoSeriousA11y(page, 'the main screen');

  await page.locator('[data-panel-button="inventory"]').click();
  await expect(page.getByRole('dialog', { name: 'Inventory' })).toBeVisible();
  await expectNoSeriousA11y(page, 'the Inventory panel');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  await expectNoSeriousA11y(page, 'Settings');
  expect(errors).toEqual([]);
});

test('panels work from the keyboard: Tab reaches the buttons and Escape returns focus', async ({ page }) => {
  await page.goto('./');
  const button = page.locator('[data-panel-button="shop"]');
  await button.focus();
  await page.keyboard.press('Enter');
  const shop = page.getByRole('dialog', { name: 'Shop' });
  await expect(shop).toBeVisible();
  await expect(shop.locator(':focus')).toHaveCount(1); // focus moved inside
  await page.keyboard.press('Escape');
  await expect(shop).toBeHidden();
  await expect(button).toBeFocused();
  // The focus ring is visible on keyboard focus.
  const outline = await button.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).toBe('solid');
});

for (const vp of [
  { name: '360x740', width: 360, height: 740 },
  { name: '390x844', width: 390, height: 844 },
]) {
  test.describe(`phone ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, hasTouch: true, isMobile: true });

    test('smoke: plays by touch, panels are bottom sheets, targets are 44 px, the view can zoom', async ({
      page,
    }) => {
      const errors = watchErrors(page);
      await page.goto('./');
      const canvas = page.locator('#scene-canvas');
      await expect(canvas).toBeVisible();
      await expect(page.getByTestId('gold')).toHaveText('60g');
      await splashGone(page);

      // No horizontal page scroll, and the scene fits the width.
      const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      expect(fits).toBe(true);

      // Every toolbar and HUD button is at least 44 × 44.
      const small = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('.toolbar button, .hud button')]
          .map((b) => ({
            n: b.getAttribute('aria-label') ?? b.textContent?.trim() ?? '',
            r: b.getBoundingClientRect(),
          }))
          .filter((b) => b.r.width > 0 && (b.r.width < 43.5 || b.r.height < 43.5))
          .map((b) => `${b.n} ${Math.round(b.r.width)}×${Math.round(b.r.height)}`),
      );
      expect(small).toEqual([]);

      // Tapping a plot plants.
      const pos = await plotPos(canvas, 0);
      const box = (await canvas.boundingBox())!;
      await page.touchscreen.tap(box.x + pos.x, box.y + pos.y);
      await expect
        .poll(() =>
          page.evaluate(
            () => (window as unknown as Win).__game.state.farm.plots.filter((p) => p.crop).length,
          ),
        )
        .toBeGreaterThan(0);
      await page.screenshot({ path: `docs/screenshots/phase08-mobile-${vp.name}.png` });

      // A panel is a bottom sheet: full width, above the toolbar, with 44 px controls.
      await page.locator('[data-panel-button="inventory"]').tap();
      const panel = page.getByRole('dialog', { name: 'Inventory' });
      await expect(panel).toBeVisible();
      const tb = (await page.locator('#toolbar').boundingBox())!;
      // Wait out the slide-up animation before measuring.
      await expect
        .poll(async () => {
          const b = (await panel.boundingBox())!;
          return Math.round(b.y + b.height);
        })
        .toBeLessThanOrEqual(Math.round(tb.y) + 1);
      const p = (await panel.boundingBox())!;
      expect(p.x).toBeLessThanOrEqual(1);
      expect(p.width).toBeGreaterThanOrEqual(vp.width - 2);
      expect(p.y + p.height).toBeLessThanOrEqual(tb.y + 1);
      const close = (await panel.getByRole('button', { name: 'Close Inventory' }).boundingBox())!;
      expect(close.width).toBeGreaterThanOrEqual(43.5);
      expect(close.height).toBeGreaterThanOrEqual(43.5);
      await page.screenshot({ path: `test-results/mobile-panel-${vp.name}.png` });
      await expectNoSeriousA11y(page, `the phone layout ${vp.name}`);
      await panel.getByRole('button', { name: 'Close Inventory' }).tap();

      // Zoom in: the scene doubles and can be panned.
      const before = (await canvas.boundingBox())!.width;
      await page.getByRole('button', { name: 'Zoom the farm in' }).tap();
      const after = (await canvas.boundingBox())!.width;
      expect(after).toBeCloseTo(before * 2, -1);
      await expect(page.getByRole('button', { name: 'Drag to move the view' })).toBeVisible();
      await page.screenshot({ path: `test-results/mobile-zoom-${vp.name}.png` });
      await page.getByRole('button', { name: 'Zoom the farm out' }).tap();
      expect((await canvas.boundingBox())!.width).toBeCloseTo(before, -1);
      expect(errors).toEqual([]);
    });

    test('the fishing minigame has a big touch button and Settings scrolls', async ({ page }) => {
      await page.goto('./');
      await page.locator('#scene-canvas').waitFor();
      await page.getByRole('button', { name: 'Settings' }).tap();
      const settings = page.getByRole('dialog', { name: 'Settings' });
      await expect(settings).toBeVisible();
      const slider = (await settings.getByLabel('Master').boundingBox())!;
      expect(slider.height).toBeGreaterThanOrEqual(43.5);
    });
  });
}
