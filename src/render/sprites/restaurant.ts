// v4 phase 02 art (ART_STYLE.md §7.2–7.3): The Bramble Table. A two-storey timber inn (80 × 64) at three
// levels, each with a lit night frame; a terrace table (16 × 16) with two stools, and the same with a plate
// on it; and four diners (16 × 16, facing left) who walk, sit and eat. Shapes are drawn with the shape kit
// (`Pix`) as fills and wrapped in the 1 px outline.

import { Pix } from './draw';
import type { SpriteDef } from './types';

// ---- the inn (80 × 64; its footprint is the bottom 48 rows, the roof rises into the tile above)

/** Window panes: `lit` glows at night; level 1 lights only the kitchen window. */
function window(p: Pix, x: number, y: number, w: number, h: number, lit: boolean): void {
  p.rect(x - 1, y - 1, w + 2, h + 2, 'M');
  p.rect(x, y, w, h, lit ? 'a' : 'J');
  p.vline(x + (w >> 1), y, h, 'M');
  if (!lit) p.set(x, y, 'w').set(x + 1, y, 'w');
}

function restaurantFill(level: 1 | 2 | 3, lit: boolean): string[] {
  const p = new Pix(80, 64);
  const L = 3; // left wall
  const R = 76; // right wall (exclusive)
  // the kitchen chimney on the right (steam rises from it while the menu serves), a second at level 3
  p.rect(60, 2, 8, 14, 'n').vline(61, 3, 12, 'N').rect(59, 1, 10, 2, 'A');
  if (level === 3) p.rect(13, 4, 7, 12, 'n').vline(14, 5, 10, 'N').rect(12, 3, 9, 2, 'A');
  // the tiled roof: a trapezoid from the ridge to the eaves, with rows of tiles
  for (let j = 0; j <= 15; j++) {
    const inset = Math.round(((15 - j) * 14) / 15);
    p.hline(1 + inset, 7 + j, 78 - 2 * inset, j % 3 === 2 ? 'r' : 'R');
  }
  p.hline(15, 7, 50, 'r');
  // upper storey: plaster between timber beams, with braces
  p.rect(L, 23, R - L, 17, 'x');
  for (const x of [L, 22, 39, 57, R - 1]) p.vline(x, 23, 17, 'M');
  p.hline(L, 23, R - L, 'M').hline(L, 39, R - L, 'M');
  p.line(L + 1, 38, 21, 24, 'p').line(58, 24, R - 2, 38, 'p');
  // ground floor: warmer plaster and a timber sill
  p.rect(L, 40, R - L, 22, 'w');
  for (const x of [L, R - 1]) p.vline(x, 40, 22, 'M');
  p.hline(L, 61, R - L, 'm');
  // upper windows
  window(p, 27, 27, 9, 8, lit && level >= 2);
  window(p, 44, 27, 9, 8, lit);
  if (level >= 2) window(p, 8, 27, 9, 8, lit);
  if (level === 3) window(p, 62, 27, 9, 8, lit);
  // the door under a striped awning, with a lantern beside it
  p.rect(35, 47, 10, 14, 'm').frame(35, 47, 10, 14, 'M').set(42, 54, 'u');
  for (let x = 30; x < 50; x++) p.vline(x, 42, 4, (x >> 1) % 2 === 0 ? 'q' : 'w');
  p.hline(30, 46, 20, 'Q');
  p.rect(51, 44, 3, 4, lit ? 'a' : 'u').set(52, 43, 'm');
  // a hanging sign with a bramble berry
  p.rect(33, 37, 14, 4, 'P').hline(33, 40, 14, 'p').rect(39, 38, 2, 2, 'v').set(41, 38, 'h');
  // ground-floor windows: the kitchen on the right always glows at night
  window(p, 58, 48, 12, 8, lit);
  if (level >= 2) {
    // a bay window on the left
    p.rect(7, 45, 20, 16, 'M');
    window(p, 9, 48, 4, 8, lit);
    window(p, 15, 48, 4, 8, lit);
    window(p, 21, 48, 4, 8, lit);
    p.hline(6, 44, 22, 'r');
  } else window(p, 10, 48, 12, 8, false);
  if (level === 3) {
    // flower boxes under the upper windows
    for (const x of [8, 27, 44, 62]) {
      p.rect(x, 36, 9, 2, 'M');
      for (let i = 0; i < 9; i += 2) p.set(x + i, 35, i % 4 === 0 ? 'i' : 'u');
    }
  }
  return p.outlinedRows();
}

// ---- the terrace table (16 × 16, top-left on its tile)

function tableFill(dish: boolean): string[] {
  const p = new Pix(16, 16);
  p.rect(1, 10, 3, 2, 'M').vline(2, 12, 2, 'm'); // the left stool
  p.rect(12, 10, 3, 2, 'M').vline(13, 12, 2, 'm'); // the right stool
  p.vline(7, 9, 5, 'm').vline(8, 9, 5, 'm').hline(6, 13, 4, 'm'); // the leg
  p.ellipse(7.5, 7, 5, 2, 'P').hline(4, 8, 8, 'p'); // the round top
  if (dish) {
    p.ellipse(7.5, 6.5, 2.5, 1, 'w').set(7, 6, 'o').set(8, 6, 'O').set(8, 5, 'h');
    p.set(4, 7, 'C').set(11, 7, 'C'); // two glasses of water
  }
  return p.outlinedRows();
}

// ---- diners (16 × 16, facing left; four palettes from the skin, hair and cloth keys)

type DinerPose = 'walkA' | 'walkB' | 'sit' | 'eatA' | 'eatB';

interface DinerLook {
  hair: string;
  skin: string;
  shirt: string;
  legs: string;
}

const DINERS: Readonly<Record<'a' | 'b' | 'c' | 'd', DinerLook>> = {
  a: { hair: 'm', skin: 'I', shirt: 'q', legs: 'j' },
  b: { hair: 'u', skin: 'I', shirt: 'J', legs: 'M' },
  c: { hair: 'K', skin: 'P', shirt: 'G', legs: 'n' },
  d: { hair: 'O', skin: 'P', shirt: 'v', legs: 'm' },
};

function dinerFill(look: DinerLook, pose: DinerPose): string[] {
  const p = new Pix(16, 16);
  const sitting = pose === 'sit' || pose === 'eatA' || pose === 'eatB';
  const top = sitting ? 4 : 2; // sitting lowers the head and body two rows
  p.ellipse(8, top + 2, 2.5, 2.5, look.skin); // the head
  p.hline(6, top, 5, look.hair)
    .hline(7, top - 1, 3, look.hair)
    .vline(10, top + 1, 2, look.hair);
  p.set(6, top + 2, 'k'); // the eye (facing left)
  p.rect(6, top + 5, 5, sitting ? 4 : 5, look.shirt); // the body
  if (sitting) {
    p.hline(4, top + 9, 6, look.legs).vline(4, top + 10, 2, look.legs); // knees forward, shins down
    p.set(4, top + 12, 'm');
    if (pose === 'eatB')
      p.set(5, top + 4, look.skin).set(5, top + 5, look.skin); // a forkful up
    else p.set(5, top + 7, look.skin);
  } else {
    const apart = pose === 'walkA';
    p.vline(apart ? 6 : 7, top + 10, 3, look.legs).vline(apart ? 10 : 9, top + 10, 3, look.legs);
    p.set(apart ? 6 : 7, top + 13, 'm').set(apart ? 10 : 9, top + 13, 'm');
    p.set(apart ? 5 : 6, top + 7, look.skin); // a swinging hand
  }
  return p.outlinedRows();
}

const building = (level: 1 | 2 | 3): SpriteDef => ({
  id: `obj_restaurant_${level}`,
  frames: [restaurantFill(level, false), restaurantFill(level, true)],
  anchor: 'bottom-center',
  lit: true,
});

function diners(): SpriteDef[] {
  const out: SpriteDef[] = [];
  for (const [key, look] of Object.entries(DINERS)) {
    out.push(
      {
        id: `npc_diner_${key}_walk`,
        frames: [dinerFill(look, 'walkA'), dinerFill(look, 'walkB')],
        frameMs: 160,
        anchor: 'bottom-center',
      },
      { id: `npc_diner_${key}_sit`, frames: [dinerFill(look, 'sit')], anchor: 'bottom-center' },
      {
        id: `npc_diner_${key}_eat`,
        frames: [dinerFill(look, 'eatA'), dinerFill(look, 'eatB')],
        frameMs: 400,
        anchor: 'bottom-center',
      },
    );
  }
  return out;
}

export const RESTAURANT_SPRITES: readonly SpriteDef[] = [
  building(1),
  building(2),
  building(3),
  { id: 'obj_table', frames: [tableFill(false)] },
  { id: 'obj_table_dish', frames: [tableFill(true)] },
  ...diners(),
];

/** Sprite ids built once, so the renderer never builds a string per frame. */
export const DINER_SPRITE_IDS: readonly { walk: string; sit: string; eat: string }[] = [
  'a',
  'b',
  'c',
  'd',
].map((k) => ({ walk: `npc_diner_${k}_walk`, sit: `npc_diner_${k}_sit`, eat: `npc_diner_${k}_eat` }));

/** Where each level's windows glow at night, relative to the sprite's top-left (for the halos). */
export const RESTAURANT_WINDOWS: readonly (readonly { dx: number; dy: number }[])[] = [
  [
    { dx: 48, dy: 31 },
    { dx: 64, dy: 52 },
  ],
  [
    { dx: 12, dy: 31 },
    { dx: 31, dy: 31 },
    { dx: 48, dy: 31 },
    { dx: 17, dy: 52 },
    { dx: 64, dy: 52 },
  ],
  [
    { dx: 12, dy: 31 },
    { dx: 31, dy: 31 },
    { dx: 48, dy: 31 },
    { dx: 66, dy: 31 },
    { dx: 17, dy: 52 },
    { dx: 64, dy: 52 },
  ],
];
/** The lantern by the door (a large halo) and the kitchen chimney's top (where steam rises), sprite-relative. */
export const RESTAURANT_LANTERN = { dx: 52, dy: 45 } as const;
export const RESTAURANT_CHIMNEY = { dx: 64, dy: 1 } as const;
