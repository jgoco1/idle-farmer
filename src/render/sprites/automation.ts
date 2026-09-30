// Phase 04 art: the placed sprinkler and scarecrow, the farmhand (the only animated "person" in the
// game) and the greenhouse roof. Authored as fills and wrapped in `outlined()` where that helps.

import { objScarecrowPost } from './objects';
import { outlined, recolored, type SpriteDef } from './types';

/** Overlays single pixels (x, y, key) onto a grid. */
function dots(rows: readonly string[], list: readonly (readonly [number, number, string])[]): string[] {
  const out = rows.map((r) => [...r]);
  for (const [x, y, key] of list) if (out[y]?.[x] !== undefined) out[y]![x] = key;
  return out.map((r) => r.join(''));
}

// ---- sprinkler: 16 × 16, stands on a plot; sprays for four of its six frames

const SPRINKLER_BASE = outlined([
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '.......NN.......',
  '......NCNn......',
  '......NNNn......',
  '.......nn.......',
  '.......Nn.......',
  '......NNnn......',
  '.....NNNNnn.....',
  '.....nnnnnn.....',
  '................',
  '................',
]);

export const objSprinkler: SpriteDef = {
  id: 'obj_sprinkler',
  anchor: 'top-left',
  frameMs: 240,
  frames: [
    SPRINKLER_BASE,
    SPRINKLER_BASE,
    dots(SPRINKLER_BASE, [
      [5, 4, 'C'],
      [10, 4, 'C'],
      [4, 6, 'c'],
      [11, 6, 'c'],
    ]),
    dots(SPRINKLER_BASE, [
      [3, 3, 'c'],
      [12, 3, 'c'],
      [4, 5, 'C'],
      [11, 5, 'C'],
      [2, 7, 'c'],
      [13, 7, 'c'],
      [7, 3, 'C'],
    ]),
    dots(SPRINKLER_BASE, [
      [2, 5, 'c'],
      [13, 5, 'c'],
      [1, 8, 'C'],
      [14, 8, 'C'],
      [3, 9, 'c'],
      [12, 9, 'c'],
      [5, 3, 'C'],
      [10, 3, 'C'],
    ]),
    dots(SPRINKLER_BASE, [
      [4, 4, 'C'],
      [11, 4, 'C'],
      [3, 8, 'c'],
      [12, 8, 'c'],
    ]),
  ],
};

// ---- scarecrow: the phase-03 post, recoloured (blue shirt, golden straw), swaying on its pole

const SCARECROW_FRONT = recolored(objScarecrowPost.frames[0]!, { q: 'j', Q: 'J', y: 'u', Y: 'U' });

/** Shifts rows [from, to) sideways by dx, leaving the pole and base where they are. */
function swayed(rows: readonly string[], dx: number, from = 3, to = 18): string[] {
  return rows.map((row, y) => {
    if (y < from || y >= to || dx === 0) return row;
    const w = row.length;
    return [...row]
      .map((_, x) => row[x - dx] ?? '.')
      .join('')
      .slice(0, w);
  });
}

export const objScarecrow: SpriteDef = {
  id: 'obj_scarecrow',
  anchor: 'bottom-center',
  frameMs: 520,
  frames: [SCARECROW_FRONT, swayed(SCARECROW_FRONT, 1), SCARECROW_FRONT, swayed(SCARECROW_FRONT, -1)],
};

// ---- the farmhand: 16 × 16, front view, 4-frame walk, 2-frame harvest pop, a slow idle

/** The body from the hat to the overalls (11 rows); `eyes` false = a blink, `armsUp` = reaching high. */
function upper(eyes: boolean, armsUp = false): string[] {
  return [
    '.....yyyyyy.....',
    '....yyyyyyyy....',
    '..YYYYYYYYYYYY..',
    '.....IIIIII.....',
    eyes ? '.....IkIIkI.....' : '.....IIIIII.....',
    '.....IIIIII.....',
    armsUp ? '.I..qqqqqqqq..I.' : '......qqqq......',
    armsUp ? '.I.qqjjjjjjqq.I.' : '....qqqqqqqq....',
    armsUp ? '..qqqjjjjjjqqq..' : '...IqqjjjjqqI...',
    armsUp ? '....qjjjjjjq....' : '...IqjjjjjjqI...',
    '....jjjjjjjj....',
  ];
}

/** Stacks figure rows so the last one rests on row 14 (row 14 - `lift` when bobbing), then outlines them. */
function stack(rows: readonly string[], lift = 0): string[] {
  const out = Array.from({ length: 16 }, () => '.'.repeat(16));
  const end = 15 - lift;
  rows.forEach((r, i) => (out[end - rows.length + i] = r));
  return outlined(out);
}

const LEGS_STAND = ['.....jj..jj.....', '.....mm..mm.....'];
const LEGS_APART = ['....jj....jj....', '...mm......mm...'];
const LEGS_TOGETHER = ['.....jjjjjj.....', '.....mmmmmm.....'];
const walkFrame = (legs: readonly string[], lift = 0): string[] => stack([...upper(true), ...legs], lift);
const standFrame = (eyes: boolean, armsUp = false): string[] =>
  stack([...upper(eyes, armsUp), ...LEGS_STAND]);

export const charFarmhandWalk: SpriteDef = {
  id: 'char_farmhand_walk',
  anchor: 'bottom-center',
  frameMs: 130,
  frames: [
    walkFrame(LEGS_APART),
    walkFrame(LEGS_TOGETHER, 1),
    walkFrame(LEGS_APART),
    walkFrame(LEGS_TOGETHER, 1),
  ],
};

export const charFarmhandIdle: SpriteDef = {
  id: 'char_farmhand_idle',
  anchor: 'bottom-center',
  frameMs: 700,
  frames: [standFrame(true), standFrame(true), standFrame(true), standFrame(false)],
};

/** Crouch to pick the crop, then straighten up with arms raised. */
export const charFarmhandPop: SpriteDef = {
  id: 'char_farmhand_pop',
  anchor: 'bottom-center',
  frameMs: 160,
  frames: [stack([...upper(true), '....mmmmmmmm....']), standFrame(true, true)],
};

// ---- greenhouse roof: 64 × 16, a glass gable above the greenhouse plots (row 1 of the lot)

function greenhouseRoof(): string[] {
  const W = 64;
  const rows: string[] = [];
  const pad = (n: number, ch = '.'): string => ch.repeat(n);
  // Gable: the glass widens from the ridge down to the full width.
  const spans = [
    [10, 54],
    [7, 57],
    [5, 59],
    [3, 61],
    [2, 62],
    [1, 63],
  ];
  spans.forEach(([a, b], r) => {
    let line = pad(W);
    const chars = [...line];
    for (let x = a!; x < b!; x++) {
      const edge = x === a || x === b! - 1;
      chars[x] = r === 0 ? 'n' : edge ? 'n' : x % 8 === 0 ? 'N' : r % 2 === 0 ? 'C' : 'c';
    }
    line = chars.join('');
    rows.push(line);
  });
  // Full-width glass with vertical bars every 8 px and a highlight line.
  for (let r = 0; r < 6; r++) {
    const chars = [...pad(W, r % 2 === 0 ? 'C' : 'c')];
    chars[0] = chars[W - 1] = 'n';
    for (let x = 8; x < W - 1; x += 8) chars[x] = 'N';
    rows.push(chars.join(''));
  }
  // Frame base with posts.
  const base = [...pad(W, 'n')];
  rows.push(base.join(''));
  const posts = [...pad(W, 'N')];
  for (let x = 0; x < W; x += 8) posts[x] = 'n';
  rows.push(posts.join(''));
  rows.push(pad(W, 'k'));
  rows.push(pad(W));
  return outlined(rows).slice(0, 16);
}

export const objGreenhouseRoof: SpriteDef = {
  id: 'obj_greenhouse_roof',
  anchor: 'top-left',
  frames: [greenhouseRoof()],
};

export const AUTOMATION_SPRITES: readonly SpriteDef[] = [
  objSprinkler,
  objScarecrow,
  charFarmhandWalk,
  charFarmhandIdle,
  charFarmhandPop,
  objGreenhouseRoof,
];
