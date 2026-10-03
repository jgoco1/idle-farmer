// v3 phase 00: the platform shell in a browser. The back order through Escape, safe areas with fake
// notch insets on a phone, and the installable web app: it loads offline with the save intact.

import { expect, test, type Page } from '@playwright/test';

type Win = {
  __game: { state: { gold: number } };
  __view: { decorMode(): boolean };
};

async function ready(page: Page, url = './'): Promise<void> {
  await page.goto(url);
  await expect(page.locator('#splash')).toHaveCount(0);
  await page.waitForFunction(() => !!(window as unknown as Partial<Win>).__game);
}

const decorating = (page: Page): Promise<boolean> =>
  page.evaluate(() => (window as unknown as Win).__view.decorMode());

test('Escape goes back in order: the modal, then Decorate mode, then the panel', async ({ page }) => {
  await ready(page, './?debug');
  await page.keyboard.press('`'); // the debug overlay, for a modal later
  await page.getByTestId('decorate-toggle').click();
  expect(await decorating(page)).toBe(true);
  await page.getByRole('button', { name: 'Settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await expect(settings).toBeVisible();
  expect(await decorating(page)).toBe(true);
  // A modal on top of both: the debug overlay's fake absence shows the away summary.
  await page.getByRole('button', { name: 'Fake 8 h offline' }).click();
  const away = page.getByRole('dialog', { name: 'While you were away…' });
  await expect(away).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(away).toBeHidden();
  await expect(settings).toBeVisible();
  expect(await decorating(page)).toBe(true);

  await page.keyboard.press('Escape');
  expect(await decorating(page)).toBe(false);
  await expect(settings).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();

  // Nothing left to go back from: Escape changes nothing (the shells minimise or ask to quit here).
  await page.keyboard.press('Escape');
  await expect(page.locator('#scene-canvas')).toBeVisible();
});

/** The client rectangles of the HUD's contents, the toolbar's buttons and the open panel. */
async function layout(page: Page): Promise<{
  hudContent: { top: number; left: number; right: number };
  hudBottom: number;
  tools: { bottom: number; left: number; right: number };
  panel: { top: number; bottom: number; left: number; right: number };
}> {
  return page.evaluate(() => {
    const union = (els: Element[]) => {
      const rs = els.map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
      return {
        top: Math.min(...rs.map((r) => r.top)),
        bottom: Math.max(...rs.map((r) => r.bottom)),
        left: Math.min(...rs.map((r) => r.left)),
        right: Math.max(...rs.map((r) => r.right)),
      };
    };
    const hud = document.getElementById('hud')!;
    const panel = document.querySelector('.panel:not([hidden])')!.getBoundingClientRect();
    return {
      hudContent: union([...hud.children]),
      hudBottom: hud.getBoundingClientRect().bottom,
      tools: union([...document.querySelectorAll('#toolbar button')]),
      panel: { top: panel.top, bottom: panel.bottom, left: panel.left, right: panel.right },
    };
  });
}

test.describe('safe areas on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });

  test('fake notch insets keep the HUD, toolbar and an open panel inside the safe area', async ({ page }) => {
    await ready(page, './?debug&insets');
    await page.getByRole('button', { name: /^Shop/ }).first().click();
    await expect(page.getByRole('dialog', { name: 'Shop' })).toBeVisible();
    await page.waitForTimeout(400); // the bottom sheet slides up
    const l = await layout(page);
    expect(l.hudContent.top).toBeGreaterThanOrEqual(44);
    expect(l.tools.bottom).toBeLessThanOrEqual(844 - 34);
    expect(l.panel.top).toBeGreaterThanOrEqual(44);
    expect(l.panel.top).toBeGreaterThanOrEqual(l.hudBottom - 1);
    expect(l.panel.bottom).toBeLessThanOrEqual(844 - 34);
    await page.screenshot({ path: 'test-results/insets-phone.png' });

    // The same at a larger interface size: insets are real pixels, not scaled with the interface.
    await page.evaluate(() => document.documentElement.style.setProperty('--ui-scale', '1.5'));
    await page.waitForTimeout(200);
    const big = await layout(page);
    expect(big.hudContent.top).toBeGreaterThanOrEqual(44);
    expect(big.hudContent.top).toBeLessThan(44 + 12);
    expect(big.tools.bottom).toBeLessThanOrEqual(844 - 34);
    expect(big.panel.top).toBeGreaterThanOrEqual(44);
    expect(big.panel.bottom).toBeLessThanOrEqual(844 - 34);
  });

  test('without insets nothing moves', async ({ page }) => {
    await ready(page);
    await page.getByRole('button', { name: /^Shop/ }).first().click();
    await page.waitForTimeout(400);
    const l = await layout(page);
    expect(l.hudContent.top).toBeLessThan(20);
    expect(l.tools.bottom).toBeGreaterThan(844 - 20);
  });
});

test.describe('safe areas in landscape', () => {
  test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });

  test('side insets keep the bars and the panel clear of the notch', async ({ page }) => {
    await ready(page, './?debug&insets=0,47,21,47');
    await page.getByRole('button', { name: /^Shop/ }).first().click();
    await expect(page.getByRole('dialog', { name: 'Shop' })).toBeVisible();
    await page.waitForTimeout(400);
    const l = await layout(page);
    expect(l.hudContent.left).toBeGreaterThanOrEqual(47);
    expect(l.hudContent.right).toBeLessThanOrEqual(844 - 47);
    expect(l.tools.left).toBeGreaterThanOrEqual(47);
    expect(l.tools.bottom).toBeLessThanOrEqual(390 - 21);
    expect(l.panel.right).toBeLessThanOrEqual(844 - 47);
    expect(l.panel.left).toBeGreaterThanOrEqual(47);
  });
});

test.describe('the installable web app', () => {
  test.use({ serviceWorkers: 'allow' });

  test('after one visit the farm loads offline with the save intact', async ({ page, context }) => {
    await ready(page);
    await page.waitForFunction(async () => {
      await navigator.serviceWorker.ready;
      return navigator.serviceWorker.controller !== null;
    });
    await page.evaluate(() => ((window as unknown as Win).__game.state.gold = 4242));

    await context.setOffline(true);
    await page.reload(); // saves on the way out
    await expect(page.locator('#splash')).toHaveCount(0);
    await page.waitForFunction(() => !!(window as unknown as Partial<Win>).__game);
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);
    await expect(page.getByTestId('gold')).toHaveText('4,242g');
    await expect(page.locator('#scene-canvas')).toBeVisible();

    // A page outside the game still comes from the cache.
    const privacy = await page.goto('privacy.html');
    expect(privacy?.ok()).toBe(true);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Privacy');
    await context.setOffline(false);
  });

  test('the manifest is installable: standalone, colours and a maskable 512 px icon', async ({ page }) => {
    await ready(page);
    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    const res = await page.request.get(new URL(href!, page.url()).toString());
    const m = (await res.json()) as {
      name: string;
      short_name: string;
      display: string;
      start_url: string;
      theme_color: string;
      background_color: string;
      icons: { src: string; sizes: string; purpose?: string }[];
    };
    expect(m.name).toBe('Hearthfield Idle');
    expect(m.display).toBe('standalone');
    expect(m.theme_color).toMatch(/^#/);
    expect(m.background_color).toMatch(/^#/);
    expect(m.icons.some((i) => i.sizes === '192x192')).toBe(true);
    expect(m.icons.some((i) => i.sizes === '512x512' && !i.purpose)).toBe(true);
    const maskable = m.icons.find((i) => i.purpose === 'maskable');
    expect(maskable?.sizes).toBe('512x512');
    for (const icon of m.icons) {
      const r = await page.request.get(new URL(icon.src, new URL(href!, page.url())).toString());
      expect(r.ok(), icon.src).toBe(true);
    }
    // Chromium's own installability check, through the DevTools protocol.
    const cdp = await page.context().newCDPSession(page);
    const { installabilityErrors } = (await cdp.send('Page.getInstallabilityErrors')) as {
      installabilityErrors: { errorId: string }[];
    };
    // Headless test contexts are incognito, which is the only objection allowed.
    expect(installabilityErrors.filter((e) => e.errorId !== 'in-incognito')).toEqual([]);
  });
});
