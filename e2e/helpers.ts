// Shared e2e helpers. The scene is a pannable world (v2), so specs address **world tiles** through
// the camera (`window.__view`, exposed by src/main.ts) and never assume where the camera starts.

import type { Page } from '@playwright/test';

type ViewHook = {
  tileClient(col: number, row: number): { x: number; y: number; visible: boolean };
  showTile(col: number, row: number): void;
  camera(): { x: number; y: number; zoom: number; default: boolean };
  chunksDrawn(): number;
  objectsDrawn(): number;
  home(): void;
};
export type WithView = { __view: ViewHook };

/** Is the centre of world tile (col, row) inside the scene element (not under a control)? */
async function onScreen(page: Page, col: number, row: number): Promise<{ x: number; y: number } | null> {
  return page.evaluate(
    ([c, r]) => {
      const v = (window as unknown as WithView).__view;
      const at = v.tileClient(c!, r!);
      const box = document.getElementById('scene')!.getBoundingClientRect();
      const margin = 24;
      const inside =
        at.x > box.left + margin &&
        at.x < box.right - 60 &&
        at.y > box.top + margin &&
        at.y < box.bottom - margin;
      return inside ? { x: at.x, y: at.y } : null;
    },
    [col, row],
  );
}

/**
 * Waits until the camera has stopped moving: some actions glide it (planting mode pans to the
 * orchard, buying land glides to it), and a point read mid-glide is a different tile by the time
 * the click lands. Two reads one frame apart must agree.
 */
async function cameraAtRest(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      new Promise<boolean>((resolve) => {
        const v = (window as unknown as WithView).__view;
        const a = v.camera();
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const b = v.camera();
            resolve(a.x === b.x && a.y === b.y && a.zoom === b.zoom);
          }),
        );
      }),
    undefined,
    { timeout: 5000 },
  );
}

/**
 * Client (page) position of the centre of world tile (col, row), read once the camera is at rest.
 * If the tile is not comfortably in view, the camera jumps to it first.
 */
export async function tilePoint(page: Page, col: number, row: number): Promise<{ x: number; y: number }> {
  await page.waitForFunction(() => !!(window as unknown as Partial<WithView>).__view);
  await cameraAtRest(page);
  let at = await onScreen(page, col, row);
  if (!at) {
    await page.evaluate(([c, r]) => (window as unknown as WithView).__view.showTile(c!, r!), [col, row]);
    await cameraAtRest(page);
    at = await onScreen(page, col, row);
  }
  if (!at) throw new Error(`world tile (${col}, ${row}) could not be brought into view`);
  return at;
}

/** Clicks world tile (col, row) with the mouse. */
export async function clickTile(
  page: Page,
  col: number,
  row: number,
  opts: { modifiers?: ('Shift' | 'Alt' | 'Control' | 'Meta')[] } = {},
): Promise<void> {
  const at = await tilePoint(page, col, row);
  for (const m of opts.modifiers ?? []) await page.keyboard.down(m);
  await page.mouse.click(at.x, at.y);
  for (const m of opts.modifiers ?? []) await page.keyboard.up(m);
}

/** Taps world tile (col, row) on a touch screen. */
export async function tapTile(page: Page, col: number, row: number): Promise<void> {
  const at = await tilePoint(page, col, row);
  await page.touchscreen.tap(at.x, at.y);
}

/** Hovers world tile (col, row). */
export async function hoverTile(page: Page, col: number, row: number): Promise<void> {
  const at = await tilePoint(page, col, row);
  await page.mouse.move(at.x, at.y);
}

/** Plot i of a field `cols` wide sits at world tile (6 + i % cols, 2 + floor(i / cols)). */
export const plotTile = (i: number, cols = 4): [number, number] => [6 + (i % cols), 2 + Math.floor(i / cols)];

export async function clickPlot(
  page: Page,
  i: number,
  opts: { modifiers?: ('Shift' | 'Alt' | 'Control' | 'Meta')[]; cols?: number } = {},
): Promise<void> {
  const [c, r] = plotTile(i, opts.cols);
  await clickTile(page, c, r, opts);
}

export async function camera(page: Page): Promise<{ x: number; y: number; zoom: number; default: boolean }> {
  return page.evaluate(() => (window as unknown as WithView).__view.camera());
}
