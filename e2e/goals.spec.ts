import { expect, test, type Locator, type Page } from '@playwright/test';

type Win = {
  __game: {
    state: {
      gold: number;
      inventory: { slots: ({ item: string; qty: number } | null)[] };
      placed: { kind: string }[];
      progression: {
        skills: Record<string, { xp: number }>;
        milestones: { done: string[] };
        goals: { template: string; objective: unknown; progress: number; rewards: unknown[] }[];
        completedBundles: string[];
      };
    };
    dispatch(action: unknown): { ok: boolean; reason?: string };
    advance(ms: number): number;
  };
};

async function tileCenter(canvas: Locator, col: number, row: number): Promise<{ x: number; y: number }> {
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no box');
  return { x: (box.width * (col + 0.5)) / 20, y: (box.height * (row + 0.5)) / 12 };
}

async function dispatch(page: Page, action: unknown): Promise<void> {
  const r = await page.evaluate((a) => (window as unknown as Win).__game.dispatch(a), action);
  expect(r.ok, r.reason).toBe(true);
}

const advance = (page: Page, ms: number): Promise<number> =>
  page.evaluate((n) => (window as unknown as Win).__game.advance(n), ms);

/** Puts `stacks` into the first bag slots after the starting seeds. */
async function stockBag(page: Page, stacks: { item: string; qty: number }[]): Promise<void> {
  await page.evaluate((list) => {
    const inv = (window as unknown as Win).__game.state.inventory.slots;
    list.forEach((s, i) => (inv[i + 1] = s));
  }, stacks);
}

/** Grows and harvests one turnip on `plot`, the way a player would. */
async function growTurnip(page: Page, plot: number): Promise<void> {
  await dispatch(page, { type: 'plant', crop: 'turnip', plots: [plot] });
  await dispatch(page, { type: 'water', plots: [plot] });
  await advance(page, 125_000);
  await dispatch(page, { type: 'harvest', plots: [plot] });
}

test('milestones, a goal and a level-up: toasts, confetti, and the Goals panel that tracks them', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await expect(page.locator('#scene-canvas')).toBeVisible();

  // The Goals panel opens with three goals and a Farm Level line; the Milestones tab points at the first step.
  await page.getByRole('button', { name: /Goals/ }).click();
  const panel = page.getByRole('dialog', { name: 'Goals' });
  await expect(panel).toBeVisible();
  await expect(panel.locator('.goal-card')).toHaveCount(3);
  await expect(panel).toContainText('Farm Level 1');
  await panel.getByRole('tab', { name: 'Milestones' }).click();
  await expect(panel.locator('.milestone.is-current')).toContainText('Plant your first seed');
  await page.keyboard.press('Escape');

  // Plant a seed: the first milestone, a warm line in a toast, and a burst of confetti.
  await dispatch(page, { type: 'plant', crop: 'turnip', plots: [0] });
  await expect(page.locator('.toast', { hasText: 'Milestone: Plant your first seed' })).toBeVisible();
  await expect(page.locator('.confetti').first()).toBeAttached();

  // A goal that one harvest finishes, and a Farming level one harvest away.
  await page.evaluate(() => {
    const p = (window as unknown as Win).__game.state.progression;
    p.goals[0] = {
      template: 'harvest_any',
      objective: { kind: 'harvest', count: 1 },
      progress: 0,
      rewards: [{ kind: 'gold', amount: 100 }],
    };
    p.skills.farming!.xp = 148;
  });
  const gold = await page.evaluate(() => (window as unknown as Win).__game.state.gold);
  await dispatch(page, { type: 'water', plots: [0] });
  await advance(page, 125_000);
  await dispatch(page, { type: 'harvest', plots: [0] });
  // Progression toasts queue instead of pushing each other out, so all of them show, one after another.
  const toast = (text: string) => page.locator('.toast', { hasText: text });
  await expect(toast('Farming level 2')).toBeVisible({ timeout: 8000 });
  await expect(toast('+5% crop sell price')).toBeVisible();
  await expect(toast('Goal complete: Harvest 1 crops')).toBeVisible({ timeout: 8000 });
  await expect(toast('New seeds in the shop: Garlic, Kale and Leek!')).toBeVisible({ timeout: 8000 });
  expect(await page.evaluate(() => (window as unknown as Win).__game.state.gold)).toBeGreaterThanOrEqual(
    gold + 100 + 25,
  );
  const done = await page.evaluate(() => (window as unknown as Win).__game.state.progression.milestones.done);
  expect(done).toEqual(['m01_first_seed', 'm02_first_harvest']);

  // Make the panel worth a picture: a little of everything done.
  await page.evaluate(() => {
    const p = (window as unknown as Win).__game.state.progression;
    p.skills.farming!.xp = 310;
    p.skills.fishing!.xp = 170;
    p.skills.cooking!.xp = 40;
    p.goals[1]!.progress = 6;
    p.goals[2]!.progress = 2;
  });
  await page.getByRole('button', { name: /Goals/ }).click();
  await panel.getByRole('tab', { name: 'Goals' }).click(); // the panel reopens on the tab it was left on
  await expect(panel.locator('.goal-card')).toHaveCount(3);
  await expect(panel.locator('[role="progressbar"]').first()).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/phase07-goals.png' });
  await panel.getByRole('tab', { name: 'Skills' }).click();
  await expect(panel.locator('[data-skill="farming"]')).toContainText('Level 2');
  await expect(panel.locator('[data-skill="farming"] .perk.is-got')).toHaveCount(1);
  await expect(panel.locator('[data-skill="fishing"]')).toContainText('Level 2');
  expect(errors).toEqual([]);
});

test('the Community Board: give what the bag has, finish Spring Crops, place the golden scarecrow', async ({
  page,
}) => {
  await page.goto('./');
  const canvas = page.locator('#scene-canvas');
  await expect(canvas).toBeVisible();
  await stockBag(page, [
    { item: 'turnip', qty: 10 },
    { item: 'potato', qty: 6 },
  ]);
  await page.getByRole('button', { name: /Goals/ }).click();
  const panel = page.getByRole('dialog', { name: 'Goals' });
  await panel.getByRole('tab', { name: 'Collections' }).click();
  const spring = panel.locator('[data-bundle="spring_crops"]');
  await expect(spring).toContainText('Spring Crops');
  await expect(spring).toContainText('golden scarecrow');

  // One slot at a time, then a slot shows as filled.
  await spring.locator('[data-give="turnip"]').click();
  await expect(spring.locator('[data-slot="turnip"]')).toHaveClass(/is-filled/);
  await expect(spring.locator('[data-slot="turnip"]')).toContainText('10 / 10');
  await spring.locator('[data-give="potato"]').click();
  await expect(spring.locator('[data-slot="potato"]')).toContainText('6 / 10');

  // The rest arrives, and the bundle completes: a toast, the milestone's gold, a button to place the reward.
  await stockBag(page, [
    { item: 'potato', qty: 4 },
    { item: 'strawberry', qty: 5 },
    { item: 'cauliflower', qty: 2 },
  ]);
  await page.getByRole('tab', { name: 'Goals' }).click(); // nudge a redraw
  await page.getByRole('tab', { name: 'Collections' }).click();
  await spring.getByRole('button', { name: 'Give everything I can' }).click();
  await expect(page.locator('.toast', { hasText: 'Spring Crops bundle complete' })).toBeVisible();
  await expect(spring).toContainText('Reward earned');
  const done = await page.evaluate(() => (window as unknown as Win).__game.state.progression.milestones.done);
  expect(done).toContain('m14_first_bundle');
  await page.screenshot({ path: 'docs/screenshots/phase07-community-board.png' });

  await spring.getByRole('button', { name: 'Place the golden scarecrow' }).click();
  await expect(page.getByTestId('placement-banner')).toContainText(/golden scarecrow/);
  await canvas.click({ position: await tileCenter(canvas, 8, 3) }); // plot (2, 1)
  const placed = await page.evaluate(() => (window as unknown as Win).__game.state.placed.map((o) => o.kind));
  expect(placed).toEqual(['golden_scarecrow']);
});

test('the Fish tab and the Stats tab', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#scene-canvas')).toBeVisible();
  await page.getByRole('button', { name: /Goals/ }).click();
  const panel = page.getByRole('dialog', { name: 'Goals' });
  await panel.getByRole('tab', { name: 'Fish' }).click();
  await expect(panel.locator('.fish-card')).toHaveCount(16);
  await expect(panel).toContainText('0 of 16 fish found.');
  await panel.getByRole('tab', { name: 'Stats' }).click();
  await expect(panel.locator('[data-stat="Lifetime gold"]')).toHaveText('0g');
  await expect(panel.locator('[data-stat="Farm Level"]')).toHaveText('1');
  await expect(panel.locator('[data-stat="Farm started"]')).toHaveText('today');
  await growTurnipViaPage(page);
  await expect(panel.locator('[data-stat="Crops harvested"]')).toHaveText('1');
});

async function growTurnipViaPage(page: Page): Promise<void> {
  await growTurnip(page, 0);
}
