// Ambient scenery: the farm cat, asleep by the farmhouse (two frames: it breathes). One sprite per cat in
// src/data/cats.ts, all drawn from the same curled-up shape and coloured by coat.

import { CAT_IDS, type CatId } from '../../data/ids';
import { outlined, recolored, type SpriteDef } from './types';

// The shape, in coat roles: a body, b stripes or patches, c light fur (muzzle, chest, paws),
// d face, ears and tail tip (a Siamese's points), e tail rings, i nose. The head rests on the left.
const CAT_SHAPE = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '.d..d...........',
  '.dddd..aaaaa....',
  'dkdkd.abaabaaa..',
  'ddidd.abaabaaba.',
  'dcccdaabaabaaba.',
  '.cccaabaabaabaa.',
  '..caaaaaaaaaaad.',
  '..cceedeedeeddd.',
  '................',
  '................',
];

// Breathing: the back rises by a pixel on the second frame.
const CAT_BREATH = CAT_SHAPE.map((row, y) => {
  if (y === 6) return '.d..d..aaaa.....';
  if (y === 7) return '.dddd.aaaaaa....';
  return row;
});

/** The palette key for each role of a coat; `patch` repaints single pixels (a calico's patches, a tuxedo's bib). */
interface Coat {
  roles: Readonly<Record<'a' | 'b' | 'c' | 'd' | 'e' | 'i', string>>;
  patch?: readonly (readonly [x: number, y: number, key: string])[];
}

const COATS: Readonly<Record<CatId, Coat>> = {
  // Standard issue: warm brown with dark stripes and a cream muzzle.
  cat_tabby: { roles: { a: 'p', b: 'm', c: 'x', d: 'p', e: 'm', i: 'i' } },
  cat_orange: { roles: { a: 'O', b: 'o', c: 'x', d: 'O', e: 'o', i: 'i' } },
  cat_black: { roles: { a: 'K', b: 'K', c: 'K', d: 'K', e: 'K', i: 'i' } },
  cat_silver: { roles: { a: 'N', b: 'n', c: 'w', d: 'N', e: 'n', i: 'i' } },
  cat_tuxedo: {
    roles: { a: 'K', b: 'K', c: 'w', d: 'K', e: 'K', i: 'i' },
    patch: [
      [6, 11, 'w'],
      [7, 12, 'w'],
      [8, 12, 'w'],
    ],
  },
  cat_siamese: { roles: { a: 'x', b: 'x', c: 'x', d: 'M', e: 'M', i: 'M' } },
  cat_calico: {
    roles: { a: 'w', b: 'w', c: 'w', d: 'w', e: 'w', i: 'i' },
    patch: [
      // a ginger ear and cheek, a black ear
      [1, 6, 'o'],
      [1, 7, 'o'],
      [0, 9, 'o'],
      [4, 6, 'K'],
      [4, 7, 'K'],
      // ginger and black patches on the back
      [7, 7, 'o'],
      [8, 7, 'o'],
      [7, 8, 'o'],
      [8, 8, 'o'],
      [9, 8, 'o'],
      [8, 9, 'o'],
      [10, 7, 'K'],
      [11, 7, 'K'],
      [11, 8, 'K'],
      [12, 8, 'K'],
      [12, 9, 'K'],
      [13, 9, 'K'],
      [9, 11, 'K'],
      [10, 11, 'K'],
      [10, 10, 'K'],
      // a ginger tail tip
      [12, 13, 'o'],
      [13, 13, 'o'],
      [14, 12, 'o'],
      [14, 13, 'o'],
    ],
  },
};

function coatFrame(shape: readonly string[], coat: Coat): string[] {
  const rows = recolored(shape, coat.roles).map((r) => [...r]);
  for (const [x, y, key] of coat.patch ?? []) {
    // A patch only repaints fur, never the outline or the space around the cat (the breathing frame moves the back).
    const ch = rows[y]?.[x];
    if (ch !== undefined && ch !== '.' && ch !== 'k') rows[y]![x] = key;
  }
  return outlined(rows.map((r) => r.join('')));
}

export const CAT_SPRITES: readonly SpriteDef[] = CAT_IDS.map((id) => ({
  id: `obj_${id}_sleep`,
  frames: [coatFrame(CAT_SHAPE, COATS[id]), coatFrame(CAT_BREATH, COATS[id])],
  frameMs: 900,
}));

export const AMBIENT_SPRITES: readonly SpriteDef[] = CAT_SPRITES;
