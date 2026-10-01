// v2 phase 04 art (ART_STYLE.md §6.4): the ranch. Hens (16 × 16) and cows (32 × 32) with walk, idle,
// eat and sleep frames, all facing left (the renderer flips them to face right); the coop at three
// levels (48 × 48), the barn (64 × 64) and the silo (32 × 64), each with a lit-window night frame;
// troughs (16 × 16) in three fullnesses; and the item icons for eggs, milk and the two feeds.
// Shapes are drawn with the shape kit (`Pix`) as fills and wrapped in `outlined()`.

import { Pix } from './draw';
import type { SpriteDef } from './types';

// ---- item icons (16 × 16)

function eggIcon(): string[] {
  const p = new Pix(16, 16);
  p.ellipse(8, 9, 4, 5, 'x').ellipse(8, 10, 3, 4, 'w');
  p.set(6, 6, 'w').set(7, 5, 'w').vline(11, 9, 3, 'y').set(10, 12, 'y').hline(7, 13, 3, 'y');
  return p.outlinedRows();
}

function largeEggIcon(): string[] {
  const p = new Pix(16, 16);
  p.ellipse(8, 8.5, 5.5, 6.5, 'x').ellipse(8, 9.5, 4, 5, 'w');
  p.set(5, 5, 'w').set(6, 4, 'w').vline(12, 8, 4, 'y').hline(7, 14, 4, 'y').set(11, 13, 'y');
  p.set(7, 8, 'U').set(9, 10, 'U'); // a double yolk's warm speckle
  return p.outlinedRows();
}

function milkIcon(): string[] {
  const p = new Pix(16, 16);
  p.rect(6, 2, 4, 2, 'j').rect(6, 4, 4, 2, 'w'); // cap and neck
  p.rect(4, 6, 8, 8, 'w').rect(4, 9, 8, 3, 'J'); // body with a label band
  p.vline(5, 7, 6, 'x').vline(11, 6, 8, 'y').hline(5, 13, 6, 'y');
  return p.outlinedRows();
}

function hayIcon(): string[] {
  const p = new Pix(16, 16);
  p.ellipse(8, 9, 6, 5, 'u');
  for (const [x, y] of [
    [3, 6],
    [5, 5],
    [8, 4],
    [11, 5],
    [13, 6],
    [4, 12],
    [7, 13],
    [10, 13],
    [12, 12],
  ] as const)
    p.set(x, y, 'U');
  p.hline(4, 8, 8, 'U').hline(5, 10, 7, 'Y');
  p.vline(7, 4, 10, 'M').vline(8, 4, 10, 'M'); // the tie
  p.set(5, 3, 'u').set(10, 3, 'u');
  return p.outlinedRows();
}

function cornFeedIcon(): string[] {
  const p = new Pix(16, 16);
  p.rect(4, 5, 8, 9, 'x').rect(3, 7, 10, 6, 'x'); // the sack
  p.hline(5, 4, 6, 'y').set(4, 5, 'y').set(11, 5, 'y'); // its folded top
  p.hline(5, 6, 6, 'M'); // the tie
  p.vline(12, 8, 5, 'y').hline(4, 13, 8, 'y');
  for (const [x, y] of [
    [6, 9],
    [8, 8],
    [10, 9],
    [7, 11],
    [9, 11],
  ] as const)
    p.set(x, y, 'u').set(x + 1, y, 'U');
  return p.outlinedRows();
}

// ---- hens (16 × 16, facing left)

type HenPose = 'stand' | 'walkA' | 'walkB' | 'peck' | 'peckUp' | 'look' | 'sleep';

function henFill(pose: HenPose): string[] {
  const p = new Pix(16, 16);
  if (pose === 'sleep') {
    p.ellipse(8, 11, 5.5, 3.5, 'w').ellipse(9, 11, 3, 2, 'x'); // a round hen with her head tucked under her wing
    p.set(4, 8, 'q').set(5, 8, 'q').set(4, 9, 'w').set(5, 10, 'w');
    p.set(13, 8, 'x').set(13, 9, 'w'); // tail tip
    p.hline(6, 13, 2, 'o').hline(10, 13, 2, 'o');
    return p.outlinedRows();
  }
  const peck = pose === 'peck' || pose === 'peckUp';
  const bob = pose === 'walkB' ? -1 : 0;
  // body
  p.ellipse(9, 9 + bob + (peck ? 1 : 0), 4.5, 3.5, 'w');
  p.ellipse(10, 10 + bob + (peck ? 1 : 0), 3, 1.6, 'x'); // wing
  p.set(13, 6 + bob + (peck ? 1 : 0), 'x')
    .set(14, 6 + bob + (peck ? 1 : 0), 'x')
    .set(14, 7 + bob + (peck ? 1 : 0), 'w'); // tail
  // head
  const hx = pose === 'peck' ? 4 : pose === 'peckUp' ? 4 : 5;
  const hy = pose === 'peck' ? 10 : pose === 'peckUp' ? 9 : pose === 'look' ? 5 : 6;
  p.ellipse(hx, hy, 2, 2, 'w');
  p.set(hx, hy - 3, 'q')
    .set(hx + 1, hy - 3, 'q')
    .set(hx, hy - 2, 'q'); // comb
  p.set(hx - 2, hy, 'o').set(hx - 3, hy + (peck ? 1 : 0), 'o'); // beak
  p.set(hx - 1, hy, 'k'); // eye
  p.set(hx - 1, hy + 2, 'q'); // wattle
  // legs
  const legY = 12 + bob;
  if (pose === 'walkA')
    p.vline(6, legY, 3 - bob, 'o')
      .vline(11, legY, 3 - bob, 'o')
      .set(5, 14, 'o')
      .set(10, 14, 'o');
  else if (pose === 'walkB')
    p.vline(8, legY + 1, 2, 'o')
      .vline(9, legY + 1, 2, 'o')
      .set(7, 14, 'o')
      .set(10, 14, 'o');
  else p.vline(8, 12, 3, 'o').vline(10, 12, 3, 'o').set(7, 14, 'o').set(9, 14, 'o');
  return p.outlinedRows();
}

// ---- cows (32 × 32, facing left)

type CowPose = 'stand' | 'walk0' | 'walk1' | 'walk2' | 'walk3' | 'graze0' | 'graze1' | 'swish' | 'sleep';

function cowFill(pose: CowPose): string[] {
  const p = new Pix(32, 32);
  const sleeping = pose === 'sleep';
  const grazing = pose === 'graze0' || pose === 'graze1';
  const by = sleeping ? 4 : 0; // the body sits lower when she lies down
  // body
  p.ellipse(19, 17 + by, 10, 6.5, 'w');
  p.rect(10, 15 + by, 19, 6, 'w');
  p.ellipse(16, 14 + by, 3, 2.5, 'K')
    .ellipse(24, 19 + by, 3, 2.5, 'K')
    .ellipse(27, 14 + by, 2, 2, 'K'); // patches
  p.hline(11, 22 + by, 17, 'x'); // belly shade
  if (!sleeping) p.rect(19, 22, 4, 2, 'I').set(20, 24, 'I').set(22, 24, 'I'); // udder
  // tail
  const tailUp = pose === 'swish';
  if (tailUp) p.line(29, 14 + by, 31, 10, 'K').rect(30, 8, 2, 3, 'K');
  else p.line(29, 14 + by, 30, 21 + by, 'K').rect(29, 21 + by, 2, 3, 'K');
  // head
  const hy = grazing
    ? 21 + (pose === 'graze1' ? 1 : 0)
    : sleeping
      ? 19 + by - 3
      : 14 + (pose === 'swish' ? 1 : 0);
  const hx = grazing ? 6 : sleeping ? 7 : 6;
  p.ellipse(hx, hy, 4, 3.6, 'w');
  p.ellipse(hx - 3, hy + 2, 2.4, 2, 'i'); // muzzle
  p.set(hx - 4, hy + 2, 'A').set(hx - 4, hy + 3, 'A'); // nostril shading
  p.set(hx - 1, hy - 1, 'k'); // eye
  p.set(hx + 3, hy - 3, 'K').set(hx + 4, hy - 2, 'K'); // ear
  p.set(hx - 1, hy - 4, 'P')
    .set(hx + 1, hy - 4, 'P')
    .set(hx - 1, hy - 5, 'P'); // horns
  p.rect(hx, hy - 2, 3, 2, 'K'); // forehead patch
  // neck joins head to body
  if (!sleeping) p.rect(hx + 2, hy, 6, 5, 'w');
  // legs
  if (sleeping) {
    p.rect(12, 25 + by - 3, 5, 2, 'w').rect(20, 25 + by - 3, 5, 2, 'w');
    p.set(11, 25 + by - 3, 'K').set(25, 25 + by - 3, 'K');
    return p.outlinedRows();
  }
  const legs: Record<CowPose, readonly [number, number, number, number]> = {
    stand: [11, 14, 22, 25],
    swish: [11, 14, 22, 25],
    graze0: [11, 14, 22, 25],
    graze1: [11, 14, 22, 25],
    walk0: [10, 14, 22, 26],
    walk1: [12, 15, 21, 25],
    walk2: [14, 11, 25, 21],
    walk3: [12, 13, 23, 23],
    sleep: [11, 14, 22, 25],
  };
  for (const x of legs[pose]) p.rect(x, 22, 2, 7, 'w').rect(x, 28, 2, 1, 'K');
  return p.outlinedRows();
}

// ---- troughs (16 × 16)

function troughFill(level: 0 | 1 | 2): string[] {
  const p = new Pix(16, 16);
  p.shaded(1, 7, 14, 7, 'M', 'p', 'm'); // the wooden box
  p.rect(2, 8, 12, 3, 'm'); // its inside, dark when empty
  if (level >= 1) p.rect(3, 9, 10, 2, 'u').hline(4, 8, 8, 'U');
  if (level >= 2)
    p.rect(3, 6, 10, 3, 'U').hline(4, 5, 8, 'U').hline(5, 4, 5, 'u').hline(3, 7, 3, 'u').hline(9, 7, 4, 'u');
  p.rect(2, 14, 2, 1, 'm').rect(12, 14, 2, 1, 'm'); // feet
  return p.outlinedRows();
}

// ---- buildings

/** A gable roof from the eave line up: `rows` rows, the widest `half` px each side of the centre. */
function gable(
  p: Pix,
  cx: number,
  eaveY: number,
  rows: number,
  half: number,
  light: string,
  dark: string,
): void {
  for (let i = 0; i < rows; i++) {
    const w = Math.round((half * (i + 1)) / rows);
    const y = eaveY - rows + 1 + i;
    p.hline(cx - w, y, w * 2 + 1, light);
    p.set(cx - w, y, dark).set(cx + w, y, dark);
  }
  p.hline(cx - half, eaveY, half * 2 + 1, dark);
}

function planks(p: Pix, x: number, y: number, w: number, h: number): void {
  p.rect(x, y, w, h, 'P');
  for (let i = x + 3; i < x + w; i += 4) p.vline(i, y, h, 'p');
  p.hline(x, y + h - 1, w, 'M');
}

function wire(p: Pix, x: number, y: number, w: number, h: number): void {
  p.rect(x, y, w, h, '.');
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if ((i + j) % 3 === 0) p.set(x + i, y + j, 'N');
  p.frame(x, y, w, h, 'n');
}

/** The coop (48 × 48): a hen house on legs with a ramp and a nest window; bigger at each level. */
function coopFill(level: 1 | 2 | 3, lit: boolean): string[] {
  const p = new Pix(48, 48);
  const pane = lit ? 'a' : 'J';
  if (level === 1) {
    // legs and ramp
    p.rect(11, 36, 3, 9, 'm').rect(34, 36, 3, 9, 'm');
    p.line(14, 45, 22, 36, 'M').line(15, 45, 23, 36, 'M').line(8, 45, 17, 45, 'M');
    planks(p, 9, 22, 30, 14);
    gable(p, 24, 22, 11, 18, 'R', 'r');
    p.rect(17, 28, 6, 8, 'm').hline(16, 27, 8, 'M'); // the pop-hole
    p.shaded(28, 26, 7, 6, 'x', 'w', 'y').rect(29, 27, 5, 4, pane); // nest window
    p.vline(31, 27, 4, 'M');
    return p.outlinedRows();
  }
  if (level === 2) {
    // the house moves left; a wire run joins it on the right
    p.rect(7, 36, 3, 9, 'm').rect(26, 36, 3, 9, 'm');
    p.line(10, 45, 17, 36, 'M').line(11, 45, 18, 36, 'M').line(4, 45, 13, 45, 'M');
    planks(p, 5, 22, 26, 14);
    gable(p, 18, 22, 11, 16, 'R', 'r');
    p.rect(13, 28, 6, 8, 'm').hline(12, 27, 8, 'M');
    p.shaded(22, 26, 6, 6, 'x', 'w', 'y').rect(23, 27, 4, 4, pane);
    // the run: posts, wire and a low roof
    p.rect(33, 30, 2, 15, 'M').rect(45, 30, 2, 15, 'M').rect(31, 28, 16, 2, 'r').hline(31, 27, 16, 'R');
    wire(p, 35, 31, 10, 13);
    p.hline(31, 45, 16, 'm');
    return p.outlinedRows();
  }
  // level 3: a second storey, a bigger run and a weathervane
  p.rect(7, 38, 3, 7, 'm').rect(26, 38, 3, 7, 'm');
  p.line(10, 45, 17, 38, 'M').line(11, 45, 18, 38, 'M').line(4, 45, 13, 45, 'M');
  planks(p, 5, 29, 26, 9);
  planks(p, 7, 19, 22, 10);
  p.hline(5, 28, 26, 'M');
  gable(p, 18, 19, 8, 14, 'R', 'r');
  p.hline(3, 29, 30, 'r'); // lower eave
  p.rect(13, 31, 6, 7, 'm').hline(12, 30, 8, 'M');
  p.shaded(11, 21, 6, 5, 'x', 'w', 'y').rect(12, 22, 4, 3, pane);
  p.shaded(21, 21, 6, 5, 'x', 'w', 'y').rect(22, 22, 4, 3, pane);
  p.shaded(22, 31, 6, 5, 'x', 'w', 'y').rect(23, 32, 4, 3, pane);
  p.vline(18, 7, 4, 'm').hline(15, 8, 7, 'm').set(15, 7, 'q').set(15, 9, 'q'); // weathervane
  p.rect(33, 30, 2, 15, 'M').rect(45, 30, 2, 15, 'M').rect(31, 28, 16, 2, 'r').hline(31, 27, 16, 'R');
  wire(p, 35, 31, 10, 13);
  p.hline(31, 45, 16, 'm');
  return p.outlinedRows();
}

/** The barn (64 × 64): the classic red barn with white trim; a hay-loft door at level 2, a lean-to and a cupola at 3. */
function barnFill(level: 1 | 2 | 3, lit: boolean): string[] {
  const p = new Pix(64, 64);
  const pane = lit ? 'a' : 'J';
  const x0 = level === 3 ? 12 : 4; // the main barn's left wall (level 3 makes room for the lean-to)
  const w = level === 3 ? 48 : 56;
  const cx = x0 + Math.floor(w / 2);
  const wallTop = 28;
  const floor = 61;
  // main walls with vertical boards
  p.rect(x0, wallTop, w, floor - wallTop, 'R');
  for (let x = x0 + 3; x < x0 + w; x += 4) p.vline(x, wallTop, floor - wallTop, 'r');
  p.frame(x0, wallTop, w, floor - wallTop, 'w');
  p.hline(x0, floor - 1, w, 'r');
  // gambrel roof: a steep lower slope and a shallow upper one
  const steps: [number, number][] = [
    [0, 28],
    [2, 24],
    [5, 20],
    [9, 17],
    [14, 15],
  ];
  for (let i = 0; i < steps.length - 1; i++) {
    const [dx, y] = steps[i]!;
    p.rect(x0 + dx - 2, y - 4, w - 2 * dx + 4, 5, i % 2 === 0 ? 'r' : 'R');
  }
  p.rect(x0 + 12, 12, w - 24, 4, 'r').hline(x0 + 12, 12, w - 24, 'R');
  p.hline(x0 + 11, 16, w - 22, 'w');
  // trim lines up the gable
  p.line(x0, 28, x0 + 4, 20, 'w').line(x0 + w - 1, 28, x0 + w - 5, 20, 'w');
  // big doors with an X brace
  const dx = cx - 9;
  p.rect(dx, 40, 18, 21, 'M')
    .frame(dx, 40, 18, 21, 'w')
    .vline(dx + 9, 40, 21, 'w');
  p.line(dx + 1, 41, dx + 8, 59, 'w').line(dx + 8, 41, dx + 1, 59, 'w');
  p.line(dx + 10, 41, dx + 17, 59, 'w').line(dx + 17, 41, dx + 10, 59, 'w');
  // a side window
  p.shaded(x0 + 5, 36, 7, 7, 'w', 'w', 'x').rect(x0 + 6, 37, 5, 5, pane);
  if (level >= 2) {
    // the hay-loft door above the big doors
    p.rect(cx - 5, 28, 10, 10, 'M')
      .frame(cx - 5, 28, 10, 10, 'w')
      .rect(cx - 3, 31, 6, 5, 'u')
      .hline(cx - 3, 31, 6, 'U');
    p.hline(cx - 6, 25, 12, 'm').vline(cx, 24, 2, 'M'); // the hoist beam
  }
  if (level === 3) {
    // a lean-to on the left with a low roof
    p.rect(2, 44, 12, 17, 'R').frame(2, 44, 12, 17, 'w');
    for (let x = 5; x < 14; x += 4) p.vline(x, 44, 17, 'r');
    p.rect(0, 40, 16, 4, 'r').hline(0, 40, 16, 'R');
    p.rect(5, 50, 6, 11, 'M').frame(5, 50, 6, 11, 'w');
    // a cupola with a weathervane on the ridge
    p.rect(cx - 4, 5, 8, 8, 'w').rect(cx - 3, 6, 6, 5, pane);
    p.rect(cx - 5, 3, 10, 2, 'r')
      .hline(cx - 4, 2, 8, 'R')
      .vline(cx, 0, 3, 'm');
  }
  return p.outlinedRows();
}

/** The silo (32 × 64): a tall metal cylinder with a slate dome; a chute to the troughs at level 2. */
function siloFill(level: 1 | 2): string[] {
  const p = new Pix(32, 64);
  p.ellipse(15.5, 14, 11, 8, 'A'); // the dome, then the cylinder under it
  p.rect(0, 14, 32, 50, '.');
  p.rect(6, 14, 20, 48, 'N');
  p.vline(7, 14, 48, 'w').vline(8, 14, 48, 'w');
  p.vline(21, 14, 48, 'n')
    .vline(22, 14, 48, 'n')
    .vline(23, 14, 48, 'n')
    .vline(24, 14, 48, 'n')
    .vline(25, 14, 48, 'n');
  for (const y of [22, 32, 42, 52]) p.hline(6, y, 20, 'n').hline(7, y + 1, 18, 'N');
  p.hline(5, 14, 22, 'A').hline(5, 15, 22, 'n'); // the cap's rim
  p.set(11, 9, 'N').set(12, 8, 'N').hline(10, 10, 2, 'N'); // a gleam on the cap
  p.vline(15, 2, 4, 'n').rect(14, 1, 3, 2, 'q'); // a little vane
  // door
  p.rect(12, 50, 8, 12, 'm').frame(12, 50, 8, 12, 'M');
  if (level === 2) {
    // the chute
    p.rect(24, 36, 3, 4, 'n').line(26, 39, 29, 52, 'n').line(27, 39, 30, 52, 'n').rect(28, 52, 3, 3, 'M');
  }
  return p.outlinedRows();
}

// ---- the sprite list

const hen = (id: string, frames: HenPose[], frameMs?: number): SpriteDef => ({
  id,
  frames: frames.map(henFill),
  anchor: 'bottom-center',
  ...(frameMs ? { frameMs } : {}),
});

const cow = (id: string, frames: CowPose[], frameMs?: number): SpriteDef => ({
  id,
  frames: frames.map(cowFill),
  anchor: 'bottom-center',
  ...(frameMs ? { frameMs } : {}),
});

const building = (id: string, day: string[], lit: string[]): SpriteDef => ({
  id,
  frames: [day, lit],
  anchor: 'bottom-center',
  lit: true,
});

export const RANCH_SPRITES: readonly SpriteDef[] = [
  { id: 'item_egg', frames: [eggIcon()] },
  { id: 'item_large_egg', frames: [largeEggIcon()] },
  { id: 'item_milk', frames: [milkIcon()] },
  { id: 'item_hay', frames: [hayIcon()] },
  { id: 'item_corn_feed', frames: [cornFeedIcon()] },
  hen('animal_chicken_walk', ['walkA', 'walkB'], 150),
  hen('animal_chicken_idle', ['stand', 'look'], 600),
  hen('animal_chicken_eat', ['peck', 'peckUp'], 200),
  hen('animal_chicken_sleep', ['sleep']),
  cow('animal_cow_walk', ['walk0', 'walk1', 'walk2', 'walk3'], 180),
  cow('animal_cow_idle', ['stand', 'swish'], 900),
  cow('animal_cow_eat', ['graze0', 'graze1'], 300),
  cow('animal_cow_sleep', ['sleep']),
  { id: 'obj_trough_empty', frames: [troughFill(0)], anchor: 'top-left' },
  { id: 'obj_trough_some', frames: [troughFill(1)], anchor: 'top-left' },
  { id: 'obj_trough_full', frames: [troughFill(2)], anchor: 'top-left' },
  ...([1, 2, 3] as const).map((l) => building(`obj_coop_${l}`, coopFill(l, false), coopFill(l, true))),
  ...([1, 2, 3] as const).map((l) => building(`obj_barn_${l}`, barnFill(l, false), barnFill(l, true))),
  ...([1, 2] as const).map((l) => ({
    id: `obj_silo_${l}`,
    frames: [siloFill(l)],
    anchor: 'bottom-center' as const,
  })),
];

/** Sprite ids by level, built once so the renderer never builds a string per frame. */
export const COOP_SPRITE_IDS: readonly string[] = ['obj_coop_1', 'obj_coop_2', 'obj_coop_3'];
export const BARN_SPRITE_IDS: readonly string[] = ['obj_barn_1', 'obj_barn_2', 'obj_barn_3'];
export const SILO_SPRITE_IDS: readonly string[] = ['obj_silo_1', 'obj_silo_2'];
export const TROUGH_SPRITE_IDS: readonly string[] = [
  'obj_trough_empty',
  'obj_trough_some',
  'obj_trough_full',
];
