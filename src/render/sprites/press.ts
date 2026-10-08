// v4 phase 03 art (ART_STYLE.md §7.2–7.5): the Press House (64 × 64 at three levels, each with a lit
// night frame), the press stations in its yard (16 × 32: idle, busy with the screw turning, done with a
// bottle), the beehives (16 × 32: empty, full with a honey drip, wrapped for winter), and the item icons
// for the ten drinks, honey and cocoa. Drinks share three vessel families so the bag reads at a glance:
// bottles (cordials, juice, cider), glasses (lemonade, iced tea, cooler, punch) and mugs (cocoa, honey
// milk). Shapes are drawn with the shape kit (`Pix`) as fills and wrapped in the 1 px outline.

import type { DrinkId } from '../../data/ids';
import { Pix } from './draw';
import type { SpriteDef } from './types';

// ---- item icons (16 × 16)

/** A corked bottle: `body` the drink's colour, `shine` a lighter key down its left side. */
function bottle(body: string, shine: string): string[] {
  const p = new Pix(16, 16);
  p.rect(7, 1, 2, 2, 'P'); // the cork
  p.rect(7, 3, 2, 2, 'w'); // the neck
  p.rect(5, 5, 6, 9, 'w').rect(5, 7, 6, 7, body); // glass, filled most of the way
  p.vline(6, 7, 6, shine).set(6, 5, 'C');
  p.hline(5, 9, 6, 'x').hline(5, 10, 6, 'x'); // a paper label
  p.set(7, 9, 'q').set(8, 10, 'q');
  return p.outlinedRows();
}

/** A tall glass with a `w` highlight, the drink and a garnish on the rim. */
function glass(drink: string, light: string, garnish: readonly [number, number, string][]): string[] {
  const p = new Pix(16, 16);
  p.rect(4, 3, 8, 11, 'C'); // the glass
  p.rect(5, 5, 6, 8, drink).hline(5, 5, 6, light);
  p.vline(5, 6, 6, 'w');
  p.hline(5, 13, 6, 'c');
  for (const [x, y, ch] of garnish) p.set(x, y, ch);
  return p.outlinedRows();
}

/** A cream mug with a handle, `drink` inside and a little steam above. */
function mug(drink: string, foam: string): string[] {
  const p = new Pix(16, 16);
  p.rect(3, 6, 8, 8, 'x').vline(3, 6, 8, 'w').vline(10, 6, 8, 'y');
  p.frame(11, 8, 3, 4, 'x');
  p.hline(4, 6, 6, drink).hline(4, 7, 6, foam);
  p.set(5, 4, 'w').set(6, 3, 'w').set(8, 4, 'w').set(9, 2, 'w'); // steam
  return p.outlinedRows();
}

const DRINK_ICONS: Record<DrinkId, () => string[]> = {
  tomato_juice: () => bottle('q', 'Q'),
  honey_milk: () => mug('w', 'U'),
  strawberry_cordial: () => bottle('i', 'I'),
  blueberry_cordial: () => bottle('j', 'J'),
  lemonade: () =>
    glass('U', 'w', [
      [11, 2, 'u'],
      [12, 3, 'u'],
      [12, 2, 'U'],
    ]),
  apple_cider: () => bottle('O', 'U'),
  peach_iced_tea: () =>
    glass('o', 'O', [
      [11, 2, 'O'],
      [12, 2, 'i'],
      [12, 3, 'O'],
      [7, 7, 'C'],
      [9, 9, 'C'],
    ]),
  melon_cooler: () =>
    glass('G', 'H', [
      [11, 2, 'G'],
      [12, 3, 'H'],
      [8, 8, 'j'],
      [6, 10, 'j'],
      [9, 11, 'j'],
    ]),
  hot_cocoa: () => mug('m', 'M'),
  orchard_punch: () =>
    glass('q', 'o', [
      [11, 2, 'q'],
      [12, 2, 'O'],
      [12, 3, 'u'],
      [7, 8, 'u'],
      [9, 10, 'O'],
    ]),
};

/** A squat jar of honey with a wooden lid and a label. */
function honeyIcon(): string[] {
  const p = new Pix(16, 16);
  p.rect(5, 3, 6, 2, 'P').hline(5, 4, 6, 'p'); // the lid
  p.rect(4, 5, 8, 9, 'u').rect(4, 5, 8, 1, 'O'); // the jar, honey-filled
  p.vline(5, 6, 6, 'U').set(5, 6, 'w');
  p.rect(6, 8, 4, 3, 'x').set(7, 9, 'u').set(8, 9, 'u'); // the label
  p.hline(4, 13, 8, 'O');
  return p.outlinedRows();
}

/** A small sack of cocoa beans, tied at the neck. */
function cocoaIcon(): string[] {
  const p = new Pix(16, 16);
  p.ellipse(8, 10, 5, 4, 'm');
  p.rect(6, 4, 4, 3, 'm').hline(6, 6, 4, 'p'); // the neck and tie
  p.set(5, 3, 'm').set(10, 3, 'm');
  p.vline(5, 8, 4, 'M').set(6, 8, 'M');
  p.set(7, 9, 'K').set(9, 11, 'K').set(10, 9, 'K'); // beans in the weave
  return p.outlinedRows();
}

// ---- the Press House (64 × 64; its footprint is the bottom 48 rows, the roof rises into the tile above)

function pressHouseFill(level: 1 | 2 | 3, lit: boolean): string[] {
  const p = new Pix(64, 64);
  // the slate roof: a trapezoid from the ridge to the eaves
  for (let j = 0; j <= 13; j++) {
    const inset = Math.round(((13 - j) * 12) / 13);
    p.hline(2 + inset, 10 + j, 60 - 2 * inset, j % 3 === 1 ? 'n' : 'A');
  }
  p.hline(14, 10, 36, 'n');
  // squat stone walls with coursing
  p.rect(4, 24, 56, 38, 'N');
  for (let y = 27; y < 60; y += 4) p.hline(5, y, 54, 'n');
  for (let y = 25; y < 60; y += 4) for (let x = 8 + ((y >> 2) % 2) * 4; x < 58; x += 8) p.set(x, y, 'n');
  p.hline(4, 61, 56, 'K');
  // the open side: the big wooden press inside, under a beam
  p.rect(8, 34, 18, 27, 'K').frame(7, 33, 20, 28, 'M');
  p.rect(11, 46, 12, 9, 'M').hline(11, 46, 12, 'p'); // the press tub
  p.vline(16, 36, 10, 'm').vline(17, 36, 10, 'm'); // the screw
  p.hline(12, 37, 10, 'p'); // its bar
  p.rect(10, 55, 14, 2, 'u'); // juice in the trough
  // the double doors
  p.rect(36, 42, 16, 19, 'M');
  p.vline(43, 42, 19, 'm').vline(44, 42, 19, 'm');
  p.line(37, 43, 42, 60, 'p').line(45, 60, 50, 43, 'p');
  // a window with a lamp at night
  p.rect(37, 30, 10, 8, 'M')
    .rect(38, 31, 8, 6, lit ? 'a' : 'J')
    .vline(42, 31, 6, 'M');
  if (!lit) p.set(38, 31, 'w').set(39, 31, 'w');
  // a sign with a bottle
  p.rect(48, 30, 9, 6, 'P').hline(48, 35, 9, 'p').rect(52, 31, 1, 2, 'w').rect(51, 33, 3, 2, 'q');
  if (level >= 2) {
    // a lean-to on the left with two casks
    p.rect(0, 40, 8, 21, 'p');
    p.line(0, 38, 7, 34, 'A').line(0, 39, 7, 35, 'A');
    p.ellipse(3.5, 49, 3, 3, 'M').vline(3, 46, 7, 'm');
    p.ellipse(3.5, 57, 3, 3, 'M').vline(3, 54, 7, 'm');
  }
  if (level === 3) {
    // a little bottle-green shopfront on the right, with bottles in its window
    p.rect(54, 40, 9, 21, 'G').frame(54, 40, 9, 21, 'h');
    p.rect(56, 44, 5, 7, lit ? 'a' : 'C');
    p.set(57, 46, 'q').set(59, 47, 'o').set(57, 49, 'j');
    p.hline(53, 39, 11, 'h');
  }
  return p.outlinedRows();
}

const building = (level: 1 | 2 | 3): SpriteDef => ({
  id: `obj_press_house_${level}`,
  frames: [pressHouseFill(level, false), pressHouseFill(level, true)],
  anchor: 'bottom-center',
  lit: true,
});

/** Where each level's window glows at night, relative to the sprite's top-left (for the halos). */
export const PRESS_HOUSE_WINDOWS: readonly (readonly { dx: number; dy: number }[])[] = [
  [{ dx: 42, dy: 34 }],
  [{ dx: 42, dy: 34 }],
  [
    { dx: 42, dy: 34 },
    { dx: 58, dy: 47 },
  ],
];

// ---- a press station (16 × 32, bottom-centre on its yard tile)

function pressFill(state: 'idle' | 'busyA' | 'busyB' | 'done'): string[] {
  const p = new Pix(16, 32);
  // the frame: two posts and a crossbeam
  p.rect(2, 12, 2, 18, 'M').rect(12, 12, 2, 18, 'M');
  p.rect(1, 11, 14, 3, 'm').hline(1, 11, 14, 'p');
  // the screw and its bar (the bar turns while busy)
  p.rect(7, 14, 2, 8, 'K');
  if (state === 'busyB') p.vline(5, 15, 3, 'p').vline(10, 15, 3, 'p').hline(6, 16, 4, 'p');
  else p.hline(4, 16, 8, 'p');
  // the tub: wood with iron bands, juice or fruit inside
  p.rect(3, 22, 10, 8, 'M').hline(3, 22, 10, 'p');
  p.hline(3, 24, 10, 'n').hline(3, 28, 10, 'n');
  if (state !== 'idle') p.hline(4, 23, 8, state === 'done' ? 'u' : 'q');
  p.hline(2, 30, 12, 'm');
  if (state === 'busyA' || state === 'busyB') {
    p.set(3, 30, 'q').set(12, 30, 'q'); // juice running from the spouts
  }
  if (state === 'done') {
    // a finished bottle on the beam, with a glint
    p.rect(7, 4, 2, 2, 'P').rect(6, 6, 4, 5, 'q').vline(6, 6, 4, 'Q').set(7, 6, 'w');
  }
  return p.outlinedRows();
}

// ---- a beehive (16 × 32, bottom-centre on its spot)

function hiveFill(look: 'plain' | 'full' | 'winter'): string[] {
  const p = new Pix(16, 32);
  p.rect(3, 26, 2, 4, 'M').rect(11, 26, 2, 4, 'M').hline(2, 25, 12, 'm'); // the stand
  // stacked white boxes with a pale roof
  p.rect(3, 13, 10, 12, 'w').hline(3, 18, 10, 'x').hline(3, 21, 10, 'x');
  p.vline(12, 13, 12, 'x');
  p.rect(2, 10, 12, 3, 'P').hline(2, 12, 12, 'p').hline(3, 9, 10, 'P');
  p.rect(6, 23, 4, 1, 'K'); // the entrance
  if (look === 'full') p.vline(4, 19, 4, 'u').set(4, 23, 'U').set(5, 19, 'u'); // a honey drip
  if (look === 'winter') {
    // straw wraps and a snow cap
    p.rect(3, 14, 10, 2, 'M').rect(3, 20, 10, 2, 'M').hline(3, 15, 10, 'p');
    p.rect(2, 8, 12, 3, 'w').hline(3, 7, 10, 'w').set(2, 11, 'C').set(13, 11, 'C');
  }
  return p.outlinedRows();
}

export const PRESS_SPRITES: readonly SpriteDef[] = [
  ...(Object.keys(DRINK_ICONS) as DrinkId[]).map((id) => ({ id: `item_${id}`, frames: [DRINK_ICONS[id]()] })),
  { id: 'item_honey', frames: [honeyIcon()] },
  { id: 'item_cocoa', frames: [cocoaIcon()] },
  building(1),
  building(2),
  building(3),
  { id: 'obj_press_idle', frames: [pressFill('idle')], anchor: 'bottom-center' },
  {
    id: 'obj_press_busy',
    frames: [pressFill('busyA'), pressFill('busyB')],
    frameMs: 300,
    anchor: 'bottom-center',
  },
  { id: 'obj_press_done', frames: [pressFill('done')], anchor: 'bottom-center' },
  { id: 'obj_hive', frames: [hiveFill('plain')], anchor: 'bottom-center' },
  { id: 'obj_hive_full', frames: [hiveFill('full')], anchor: 'bottom-center' },
  { id: 'obj_hive_winter', frames: [hiveFill('winter')], anchor: 'bottom-center' },
];
