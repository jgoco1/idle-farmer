import { expect, test, type Page } from '@playwright/test';
import { clickTile, shot } from './helpers';

type Session = {
  phase: string;
  reel: { marker: number; zoneCenter: number; zoneWidth: number; meter: number } | null;
  waitMs: number;
} | null;

type Win = {
  __game: {
    state: {
      gold: number;
      stats: { lifetimeGold: number; fishCaught: number };
      progression: { farmLevelFloor: number };
      upgrades: Record<string, number>;
      settings: { relaxedFishing: boolean };
      inventory: { slots: ({ item: string; qty: number } | null)[] };
      fishing: {
        session: Session;
        collection: Record<string, { count: number }>;
        traps: { id: number; location: string; slot: number; contents: { item: string; qty: number }[] }[];
      };
    };
    dispatch(action: unknown): { ok: boolean; reason?: string };
    advance(ms: number): number;
  };
};

async function dispatch(page: Page, action: unknown): Promise<void> {
  const r = await page.evaluate((a) => (window as unknown as Win).__game.dispatch(a), action);
  expect(r.ok, r.reason).toBe(true);
}

const session = (page: Page): Promise<Session> =>
  page.evaluate(() => (window as unknown as Win).__game.state.fishing.session);

const fishInBag = (page: Page): Promise<number> =>
  page.evaluate(() =>
    (window as unknown as Win).__game.state.inventory.slots.reduce(
      (n, s) =>
        n + (s && !s.item.startsWith('seed_') && s.item !== 'turnip' && s.item !== 'potato' ? s.qty : 0),
      0,
    ),
  );

test('cast, wait for the bite and reel a fish in with scripted input', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  const canvas = page.locator('#scene-canvas');
  await expect(canvas).toBeVisible();

  // Relaxed fishing from Settings (also keeps this scripted player, which polls every ~30 ms, reliable).
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Relaxed fishing').check();
  expect(await page.evaluate(() => (window as unknown as Win).__game.state.settings.relaxedFishing)).toBe(
    true,
  );
  await page.keyboard.press('Escape');

  // Clicking the pond opens the Fishing panel.
  await clickTile(page, 2, 8);
  const panel = page.getByRole('dialog', { name: 'Fishing' });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Biting now at the pond');
  await page.waitForTimeout(400); // the panel pops in; measure the button once it has settled
  // Record every message the result line shows. The scripted player polls the game, so its next
  // press can land just after a catch and start a new cast, which (correctly) clears the message.
  await panel.locator('.fish-result').evaluate((el) => {
    const w = window as unknown as { __fishResults: string[] };
    w.__fishResults = [];
    new MutationObserver(() => {
      if (el.textContent) w.__fishResults.push(el.textContent);
    }).observe(el, { childList: true, subtree: true, characterData: true });
  });
  const cast = panel.getByRole('button', { name: 'Hold to cast' });
  await cast.scrollIntoViewIfNeeded(); // the panel body scrolls when the window is short
  const box = (await cast.boundingBox())!;
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  let landed = false;
  for (let attempt = 0; attempt < 5 && !landed; attempt++) {
    // Hold to charge the cast, release to throw.
    if (attempt === 0) {
      // The first cast uses the keyboard (Space), the rest use the mouse button.
      await page.keyboard.down('Space');
      await page.waitForTimeout(700);
      await page.keyboard.up('Space');
    } else {
      await page.mouse.move(centre.x, centre.y);
      await page.mouse.down();
      await page.waitForTimeout(700);
      await page.mouse.up();
    }
    await expect.poll(async () => (await session(page))?.phase).toBe('waiting');
    // Test shortcut: skip most of the 3–10 s wait.
    await page.evaluate(() => {
      const s = (window as unknown as Win).__game.state.fishing.session;
      if (s) s.waitMs = 300;
    });
    await expect.poll(async () => (await session(page))?.phase, { timeout: 5000 }).toBe('bite');
    await expect(panel).toContainText('A bite!');

    // Hold to reel; keep the marker inside the zone by holding when it is below the zone's centre.
    let down = false;
    let shotTaken = false;
    await page.mouse.move(centre.x, centre.y); // reeling is held on the button
    for (let i = 0; i < 900; i++) {
      const s = await session(page);
      // Stop once the cast is over: no session, or a new cast started by a press after the catch.
      if (!s || s.phase === 'charging' || s.phase === 'waiting') break;
      const r = s.reel;
      const want = r ? r.marker < r.zoneCenter : true;
      if (want !== down) {
        if (want) await page.mouse.down();
        else await page.mouse.up();
        down = want;
      }
      if (!shotTaken && r && r.meter > 0.5) {
        shotTaken = true;
        await page.screenshot({ path: shot('phase05-fishing-minigame.png') });
      }
      await page.waitForTimeout(25);
    }
    if (down) await page.mouse.up();
    landed = (await fishInBag(page)) > 0;
  }
  expect(landed).toBe(true);
  const results = (): Promise<string> =>
    page.evaluate(() => (window as unknown as { __fishResults: string[] }).__fishResults.join('\n'));
  await expect.poll(results).toContain('You caught');
  // Put away a cast that a late press may have started, so the panel is idle for the next checks.
  if (await session(page)) await dispatch(page, { type: 'fishCancel' });

  // The Collection tab lists what was caught (fish, or a junk item that has no entry).
  await panel.getByRole('tab', { name: 'Collection' }).click();
  await expect(panel).toContainText(/of 16 fish found/);
  await page.screenshot({ path: 'test-results/fishing-collection.png' });
  expect(errors).toEqual([]);
});

test('traps fill while time passes and are collected by a click in the scene', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  const canvas = page.locator('#scene-canvas');
  await expect(canvas).toBeVisible();

  await page.evaluate(() => ((window as unknown as Win).__game.state.gold = 5000));
  await page.getByRole('button', { name: /Upgrades/ }).click();
  const upgrades = page.getByRole('dialog', { name: 'Upgrades' });
  await upgrades.getByRole('button', { name: 'Buy Fish Trap for 500 gold' }).click();
  // A second click straight away would count as a double click (phase 09 guard): pause like a person.
  await page.waitForTimeout(450);
  await upgrades.getByRole('button', { name: 'Buy Fish Trap for 750 gold' }).click();
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => (window as unknown as Win).__game.state.fishing.traps.length)).toBe(2);

  // Twenty minutes of simulated time fill both traps to their capacity of 5.
  await page.evaluate(() => (window as unknown as Win).__game.advance(20 * 60_000));
  const traps = await page.evaluate(() =>
    (window as unknown as Win).__game.state.fishing.traps.map((t) =>
      t.contents.reduce((n, c) => n + c.qty, 0),
    ),
  );
  expect(traps).toEqual([5, 5]);
  await page.waitForTimeout(300);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: 'test-results/traps-full.png' });

  // Clicking the first pond trap (tile 2,9) collects it.
  await clickTile(page, 2, 9);
  const after = await page.evaluate(() =>
    (window as unknown as Win).__game.state.fishing.traps.map((t) =>
      t.contents.reduce((n, c) => n + c.qty, 0),
    ),
  );
  // The first trap was emptied into the bag. A full trap keeps its next roll waiting, so the next
  // game tick may already drop one new catch into the emptied trap: 0 or 1 are both right.
  expect(after[0]).toBeLessThanOrEqual(1);
  expect(after[1]).toBe(5);
  expect(await fishInBag(page)).toBe(5);
  expect(errors).toEqual([]);
});

test('River Access opens the river in the scene and the Fishing panel', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  const canvas = page.locator('#scene-canvas');
  await expect(canvas).toBeVisible();

  // Locked: clicking the riverbank explains how to open it.
  await clickTile(page, 9, 11);
  await expect(page.locator('#toasts')).toContainText('River Access');

  await page.evaluate(() => {
    const g = (window as unknown as Win).__game.state;
    g.gold = 10_000;
    g.progression.farmLevelFloor = 3; // Farm Level 3
  });
  await page.getByRole('button', { name: /Upgrades/ }).click();
  const upgrades = page.getByRole('dialog', { name: 'Upgrades' });
  await upgrades.getByRole('button', { name: 'Buy River Access for 2000 gold' }).click();
  await page.keyboard.press('Escape');
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/farm-river.png' });

  await clickTile(page, 9, 11);
  const panel = page.getByRole('dialog', { name: 'Fishing' });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Biting now at the river');
  await page.keyboard.press('Escape');

  // The whole shoreline: the Old Dock, and all six traps out on the water (some full).
  await page.evaluate(() => {
    const g = (window as unknown as Win).__game.state;
    g.gold = 100_000;
    g.progression.farmLevelFloor = 6; // Farm Level 6
  });
  await dispatch(page, { type: 'buyExpansion', id: 'ocean' });
  for (let i = 0; i < 6; i++) await dispatch(page, { type: 'buyUpgrade', id: 'fish_trap' });
  await page.evaluate(() => {
    const t = (window as unknown as Win).__game.state.fishing.traps;
    t[0]!.contents = [{ item: 'bluegill', qty: 2 }];
    t[3]!.contents = [{ item: 'trout', qty: 1 }];
    t[5]!.contents = [{ item: 'sardine', qty: 3 }];
  });
  await page.evaluate(() => (document.getElementById('toasts')!.style.display = 'none'));
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
  await canvas.screenshot({ path: shot('phase05-waters.png') });
  expect(errors).toEqual([]);
});

// A result must stay readable when the player keeps tapping (fix: fishing-result-pause).
async function openFishingAndLand(page: Page): Promise<ReturnType<Page['getByRole']>> {
  await page.goto('./');
  await expect(page.locator('#scene-canvas')).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as Win).__game.state.settings.relaxedFishing = true;
  });
  await clickTile(page, 2, 8);
  const panel = page.getByRole('dialog', { name: 'Fishing' });
  await expect(panel).toBeVisible();
  await page.waitForTimeout(400);
  // Cast with Space, skip the wait, then reel with scripted holds until the fish is landed.
  await page.keyboard.down('Space');
  await page.waitForTimeout(500);
  await page.keyboard.up('Space');
  await expect.poll(async () => (await session(page))?.phase).toBe('waiting');
  await page.evaluate(() => {
    const s = (window as unknown as Win).__game.state.fishing.session;
    if (s) s.waitMs = 300;
  });
  await expect.poll(async () => (await session(page))?.phase, { timeout: 5000 }).toBe('bite');
  return panel;
}

// Holds Space while the marker is below the zone's centre; returns when the session is over.
async function reelWithSpace(page: Page, keepHolding: boolean): Promise<void> {
  let down = false;
  for (let i = 0; i < 900; i++) {
    const s = await session(page);
    if (!s) break;
    const r = s.reel;
    const want = r ? r.marker < r.zoneCenter : true;
    if (want !== down) {
      if (want) await page.keyboard.down('Space');
      else await page.keyboard.up('Space');
      down = want;
    }
    await page.waitForTimeout(25);
  }
  if (down && !keepHolding) await page.keyboard.up('Space');
  else if (!down && keepHolding) await page.keyboard.down('Space');
}

test('tapping Space right after a catch neither casts nor clears the result', async ({ page }) => {
  test.setTimeout(90_000);
  const panel = await openFishingAndLand(page);
  await reelWithSpace(page, false);
  const result = panel.locator('.fish-result');
  const t0 = Date.now();
  for (let i = 0; i < 4; i++) {
    await page.keyboard.down('Space');
    await page.keyboard.up('Space');
  }
  expect(Date.now() - t0).toBeLessThan(900); // all inside the pause
  expect(await session(page)).toBeNull();
  await expect(result).toContainText(/You caught|It got away/);
  await expect(panel.locator('.fish-action')).toHaveAttribute('aria-disabled', 'true');

  // After the pause one fresh press casts, and the result stays, as the quieter last catch.
  await page.waitForTimeout(1300);
  await expect(panel.locator('.fish-action')).not.toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.down('Space');
  await expect.poll(async () => (await session(page))?.phase).toBe('charging');
  await expect(result).toContainText(/You caught|It got away/);
  await expect(result).toHaveClass(/is-last/);
  await expect(result).toContainText('Last');
  await page.keyboard.up('Space');
});

test('holding Space through the pause does not cast until pressed again', async ({ page }) => {
  test.setTimeout(90_000);
  const panel = await openFishingAndLand(page);
  await reelWithSpace(page, true); // Space is held at the catch
  await page.waitForTimeout(1500); // past the pause, still held
  expect(await session(page)).toBeNull();
  await expect(panel.locator('.fish-result')).toContainText(/You caught|It got away/);
  await page.keyboard.up('Space');
  await page.keyboard.down('Space');
  await expect.poll(async () => (await session(page))?.phase).toBe('charging');
  await page.keyboard.up('Space');
});
