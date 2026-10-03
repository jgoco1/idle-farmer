// Store screenshots (`npm run shots:store`): the demo farm at every size in sizes.ts, at midday on a
// fixed date (the browser clock is faked, so the calendar matches the save),
// written to store-shots/<store>/<size>-<shot>.png. See docs/STORE.md for the shot list.

import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { localDay, localTimeToEpoch, zoneClock } from '../../src/core/time';
import { STORE_SIZES } from './sizes';

const demo = readFileSync('tests/fixtures/store-demo.json', 'utf8');
const ZONE = 'America/New_York'; // the simulator's zone (scripts/sim/bots.ts)
/** Midday on the day after the demo save was made, so the calendar is where the save left it. */
const middayAfter = (savedAt: number): number => {
  const lc = zoneClock(ZONE);
  return localTimeToEpoch(lc, localDay(lc, savedAt) + 1, 12, 30);
};
const SHOT_TIME = middayAfter((JSON.parse(demo) as { savedAt: number }).savedAt);

type Win = { __game: unknown };

for (const size of STORE_SIZES) {
  test.describe(`${size.store} ${size.name}`, () => {
    test.use({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: size.scale,
      hasTouch: size.touch,
      isMobile: size.touch && size.width < 600,
      timezoneId: ZONE,
    });

    test(`${size.width * size.scale} × ${size.height * size.scale}`, async ({ page }) => {
      await page.clock.install({ time: SHOT_TIME });
      // The demo save as if it was saved a moment ago, so no "while you were away" summary covers the farm.
      await page.addInitScript((raw) => {
        const file = JSON.parse(raw) as { savedAt: number; state: { meta: { lastSavedAt: number } } };
        file.savedAt = Date.now();
        file.state.meta.lastSavedAt = file.savedAt;
        localStorage.setItem('hearthfield-idle/save', JSON.stringify(file));
        localStorage.setItem('hearthfield-idle/prefs', JSON.stringify({ tutorial: 'skipped', music: 0 }));
      }, demo);
      await page.goto('./');
      await expect(page.locator('#splash')).toHaveCount(0);
      await page.waitForFunction(() => !!(window as unknown as Partial<Win>).__game);
      await page.waitForTimeout(4000); // toasts fade, animals settle
      const out = (shot: string): string => `store-shots/${size.store}/${size.name}-${shot}.png`;

      await page.screenshot({ path: out('1-farm') });
      for (const [shot, panel] of [
        ['2-kitchen', /^Kitchen/],
        ['3-ranch', /^Ranch/],
        ['4-fishing', /^Fishing/],
      ] as const) {
        await page.getByRole('button', { name: panel }).first().click();
        await page.waitForTimeout(500);
        await page.screenshot({ path: out(shot) });
        await page.keyboard.press('Escape');
      }
    });
  });
}
