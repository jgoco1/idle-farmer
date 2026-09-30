// Ambient scenery: the farm cat, asleep by the farmhouse (two frames: it breathes).

import { outlined, type SpriteDef } from './types';

const CAT_FILL = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '.o..o...........',
  '.oooo...........',
  'okokoooooo......',
  'oOooOooooooo....',
  'oooooooooOoooo..',
  'oOoooooOooooooo.',
  '.oooooooooooooo.',
  '..ooooooooooo...',
  '................',
  '................',
];

// Breathing: the back rises by a pixel on the second frame.
const CAT_BREATH = CAT_FILL.map((row, y) => {
  if (y === 8) return 'okokoooooooo....';
  if (y === 9) return 'oOooOoooooooo...';
  return row;
});

export const objCatSleep: SpriteDef = {
  id: 'obj_cat_sleep',
  frames: [outlined(CAT_FILL), outlined(CAT_BREATH)],
  frameMs: 900,
};

export const AMBIENT_SPRITES: readonly SpriteDef[] = [objCatSleep];
