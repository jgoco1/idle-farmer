// Phase 05 art: an item icon per fish and junk item, the fish trap, bobber, bite bubble, splash,
// the river and sea water, the bridge and dock, and the rod icon. Fish are two body templates
// (round and slender, facing left) recoloured per species, plus a few pixels of detail; everything
// is authored as fills and wrapped in `outlined()`.

import { tileWater } from './terrain';
import { outlined, recolored, shifted, type SpriteDef } from './types';
import type { FishId, JunkId } from '../../data/ids';

/** Overlays single pixels (x, y, key) onto a grid. */
function dots(rows: readonly string[], list: readonly (readonly [number, number, string])[]): string[] {
  const out = rows.map((r) => [...r]);
  for (const [x, y, key] of list) if (out[y]?.[x] !== undefined) out[y]![x] = key;
  return out.map((r) => r.join(''));
}

// Placeholders: D back, B body, L belly, T tail and fins, E eye, A accent.
const ROUND = [
  '................',
  '................',
  '................',
  '....DDDDDD......',
  '..DDDDDDDDDD....',
  '.DDBBBBBBBBDD.T.',
  '.DBBBBBBBBBBBTTT',
  '.DEBBBBBBBBBBTT.',
  '.DBBBBBBBBBBBTTT',
  '..LBBBBBBBBBBT..',
  '..LLLLLLLLLL.T..',
  '...LLLLLLLL.....',
  '................',
  '................',
  '................',
  '................',
];

const SLENDER = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '..DDDDDDDDDDDD..',
  '.DDBBBBBBBBBDDTT',
  'DDEBBBBBBBBBBBTT',
  'DBBBBBBBBBBBBBTT',
  '.LLBBBBBBBBBBTT.',
  '..LLLLLLLLLLLT..',
  '....LLLLLLLL....',
  '................',
  '................',
  '................',
  '................',
];

const SMALL = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '..DDDDDDDDDD.T..',
  '.DEBBBBBBBBBBTT.',
  '.LLLLLLLLLLLLTT.',
  '...LLLLLLLL.T...',
  '................',
  '................',
  '................',
  '................',
  '................',
];

type Dot = readonly [number, number, string];
interface FishArt {
  body: readonly string[];
  colors: Readonly<Record<string, string>>;
  extra?: readonly Dot[]; // drawn after recolouring
  dx?: number;
}

const SPARKLE_FISH: readonly Dot[] = [
  [1, 3, 'U'],
  [14, 9, 'w'],
  [7, 2, 'w'],
];

// A crayfish (v4-04): claws to the left, a jointed tail to the right; recoloured like the fish.
const CRAY = [
  '................',
  '................',
  '................',
  '................',
  '.DD.............',
  'DBBD..DDDDD.....',
  '.DDBDDBBBBBDDD..',
  '...DEBBBBBBBBBTT',
  '.DDBDDBBBBBDDTTT',
  'DBBD..LLLLLL..TT',
  '.DD...D.D.D.....',
  '................',
  '................',
  '................',
  '................',
  '................',
];

const FISH_ART: Record<FishId, FishArt> = {
  bluegill: {
    body: ROUND,
    colors: { D: 'l', B: 'G', L: 'O', T: 'g', E: 'k' },
    extra: [
      [5, 7, 'l'],
      [8, 7, 'l'],
      [4, 9, 'o'],
    ],
  },
  carp: {
    body: ROUND,
    colors: { D: 'M', B: 'o', L: 'U', T: 'M', E: 'k' },
    extra: [
      [6, 6, 'O'],
      [9, 8, 'O'],
      [4, 8, 'M'],
    ],
  },
  catfish: {
    body: SLENDER,
    colors: { D: 'n', B: 'N', L: 'x', T: 'n', E: 'k' },
    extra: [
      [0, 8, 'K'],
      [0, 9, 'K'],
      [1, 10, 'K'],
      [6, 7, 'n'],
      [10, 8, 'n'],
    ],
  },
  koi: {
    body: ROUND,
    colors: { D: 'x', B: 'w', L: 'x', T: 'O', E: 'k' },
    extra: [
      [4, 5, 'o'],
      [5, 5, 'o'],
      [8, 6, 'o'],
      [9, 6, 'o'],
      [9, 7, 'o'],
      [6, 9, 'q'],
      [7, 9, 'q'],
    ],
  },
  petal_koi: {
    body: ROUND,
    colors: { D: 'i', B: 'I', L: 'w', T: 'I', E: 'k' },
    extra: [
      [4, 5, 'w'],
      [8, 6, 'w'],
      [6, 9, 'i'],
      [1, 3, 'I'],
      [14, 10, 'w'],
      [7, 2, 'w'],
      [11, 3, 'I'],
    ],
  },
  trout: {
    body: SLENDER,
    colors: { D: 'g', B: 'H', L: 'x', T: 'g', E: 'k' },
    extra: [
      [4, 7, 'q'],
      [7, 7, 'k'],
      [9, 8, 'q'],
      [11, 7, 'k'],
      [5, 8, 'k'],
    ],
  },
  perch: {
    body: SLENDER,
    colors: { D: 'l', B: 'G', L: 'U', T: 'q', E: 'k' },
    extra: [
      [5, 6, 'l'],
      [5, 7, 'l'],
      [5, 8, 'l'],
      [8, 6, 'l'],
      [8, 7, 'l'],
      [8, 8, 'l'],
      [11, 6, 'l'],
      [11, 7, 'l'],
    ],
  },
  salmon: {
    body: SLENDER,
    colors: { D: 'i', B: 'I', L: 'w', T: 'i', E: 'k' },
    extra: [
      [6, 7, 'Q'],
      [9, 8, 'Q'],
    ],
  },
  sturgeon: {
    body: SLENDER,
    colors: { D: 'n', B: 'N', L: 'x', T: 'n', E: 'k' },
    extra: [
      [3, 5, 'w'],
      [5, 5, 'n'],
      [7, 5, 'n'],
      [9, 5, 'n'],
      [11, 5, 'n'],
      [0, 8, 'N'],
      [0, 9, 'N'],
    ],
  },
  ember_salmon: {
    body: SLENDER,
    colors: { D: 'q', B: 'O', L: 'U', T: 'q', E: 'k' },
    extra: [
      [6, 7, 'q'],
      [9, 8, 'q'],
      [3, 3, 'U'],
      [12, 4, 'w'],
      [7, 3, 'U'],
    ],
  },
  sardine: {
    body: SMALL,
    colors: { D: 'j', B: 'N', L: 'w', T: 'N', E: 'k' },
    extra: [
      [5, 8, 'j'],
      [8, 8, 'j'],
    ],
  },
  mackerel: {
    body: SLENDER,
    colors: { D: 'j', B: 'B', L: 'w', T: 'j', E: 'k' },
    extra: [
      [4, 6, 'j'],
      [6, 7, 'j'],
      [8, 6, 'j'],
      [10, 7, 'j'],
    ],
  },
  tuna: {
    body: ROUND,
    colors: { D: 'j', B: 'J', L: 'N', T: 'j', E: 'k' },
    extra: [
      [13, 4, 'u'],
      [12, 10, 'u'],
      [5, 7, 'j'],
    ],
  },
  pufferfish: {
    body: ROUND,
    colors: { D: 'Y', B: 'y', L: 'x', T: 'Y', E: 'k' },
    extra: [
      [5, 2, 'k'],
      [8, 2, 'k'],
      [3, 4, 'k'],
      [11, 4, 'k'],
      [1, 6, 'k'],
      [3, 12, 'k'],
      [8, 12, 'k'],
      [5, 8, 'Y'],
      [8, 8, 'Y'],
    ],
  },
  sun_marlin: {
    body: SLENDER,
    colors: { D: 'F', B: 'u', L: 'U', T: 'F', E: 'k' },
    extra: [
      [0, 8, 'k'],
      [1, 8, 'k'],
      [1, 7, 'F'],
      [5, 4, 'f'],
      [6, 3, 'f'],
      [7, 3, 'f'],
      [8, 4, 'f'],
      ...SPARKLE_FISH,
    ],
  },
  // ---- the mountain lake (v4-04, ART_STYLE §7.5): cool, deep-water colours
  whitefish: {
    body: SLENDER,
    colors: { D: 'n', B: 'N', L: 'w', T: 'N', E: 'k' },
    extra: [
      [6, 7, 'w'],
      [9, 7, 'w'],
    ],
  },
  lake_trout: {
    body: SLENDER,
    colors: { D: 'h', B: 'g', L: 'x', T: 'h', E: 'k' },
    extra: [
      [5, 6, 'H'],
      [8, 7, 'H'],
      [11, 6, 'H'],
      [6, 8, 'x'],
      [10, 8, 'x'],
    ],
  },
  crayfish: {
    body: CRAY,
    colors: { D: 'r', B: 'q', L: 'R', T: 'r', E: 'k' },
    extra: [
      [8, 7, 'Q'],
      [11, 7, 'Q'],
    ],
  },
  pike: {
    body: SLENDER,
    colors: { D: 'l', B: 'g', L: 'L', T: 'l', E: 'k' },
    extra: [
      [5, 7, 'L'],
      [8, 8, 'L'],
      [11, 7, 'L'],
      [1, 8, 'w'],
    ],
  },
  golden_trout: {
    body: SLENDER,
    colors: { D: 'F', B: 'f', L: 'q', T: 'o', E: 'k' },
    extra: [
      [5, 8, 'q'],
      [7, 8, 'q'],
      [9, 8, 'q'],
      [7, 2, 'w'],
    ],
  },
  alpine_char: {
    body: ROUND,
    colors: { D: 'A', B: 'n', L: 'q', T: 'A', E: 'k' },
    extra: [
      [5, 6, 'x'],
      [8, 7, 'x'],
      [10, 6, 'x'],
      [4, 9, 'Q'],
    ],
  },
  moonfin: {
    body: SLENDER,
    colors: { D: 'v', B: 'V', L: 'w', T: 'J', E: 'k' },
    extra: [
      [5, 7, 'w'],
      [9, 8, 'w'],
      [2, 3, 'C'],
      [13, 4, 'w'],
      [8, 3, 'C'],
    ],
  },
};

function fishIcon(id: FishId): SpriteDef {
  const art = FISH_ART[id];
  const body = recolored(art.body, { ...art.colors, A: 'w' });
  // Shift down one row so the outline ring stays inside the tile.
  const rows = outlined(
    dots(
      shifted(body, art.dx ?? 0, 1),
      (art.extra ?? []).map(([x, y, k]) => [x, y + 1, k]),
    ),
  );
  return { id: `item_${id}`, frames: [rows] };
}

export const FISH_ICONS: readonly SpriteDef[] = (Object.keys(FISH_ART) as FishId[]).map(fishIcon);

const JUNK_ART: Record<JunkId, readonly string[]> = {
  old_boot: outlined([
    '................',
    '................',
    '....MMMMM.......',
    '....MMMMM.......',
    '....mMMMM.......',
    '....MMwMM.......',
    '....MMMMM.......',
    '....MMwMM.......',
    '....MMMMMMMM....',
    '...MpMMMMMMMMM..',
    '..MpPMMMMMMMMMm.',
    '..MMMMMMMMMMMmm.',
    '..mmmmmmmmmmmmm.',
    '................',
    '................',
    '................',
  ]),
  seaweed: outlined([
    '................',
    '................',
    '...G......G.....',
    '...GG....GG.....',
    '....G...GG..G...',
    '....GG..G...G...',
    '.....G..GG.GG...',
    '.....GG.G..G....',
    '..G...GGGG.G....',
    '..GG..GlG.GG....',
    '...G.GGlG.G.....',
    '...GGGGlGGG.....',
    '....gGGlGg......',
    '.....ggggg......',
    '................',
    '................',
  ]),
  driftwood: outlined([
    '................',
    '................',
    '................',
    '..............P.',
    '............PPp.',
    '..........PPPp..',
    '.....P...PPPp...',
    '....PPPPPPPp....',
    '...PPyPPPPp.....',
    '..PPPPPPpp......',
    '.PPyPPPpp.......',
    '.PPPPpp.........',
    '..pppp..........',
    '................',
    '................',
    '................',
  ]),
};

export const JUNK_ICONS: readonly SpriteDef[] = (Object.keys(JUNK_ART) as JunkId[]).map((id) => ({
  id: `item_${id}`,
  frames: [JUNK_ART[id]],
}));

// ---- the trap: a wicker basket floating on the water, 2 frames of calm ripples

const TRAP_BASE = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '....pppppppp....',
  '...pPpPpPpPpp...',
  '..pPMpPMpPMpPp..',
  '..pMpPMpPMpPMp..',
  '..pPMpPMpPMpPp..',
  '..pMpPMpPMpPMp..',
  '...pMpPMpPMpp...',
  '....mmmmmmmm....',
  '................',
  '................',
  '................',
];
const TRAP_FULL = dots(TRAP_BASE, [
  [6, 3, 'O'],
  [7, 3, 'O'],
  [7, 4, 'o'],
  [8, 4, 'O'],
  [9, 4, 'w'],
  [10, 3, 'I'],
]);
const ripples = (a: boolean): string[] =>
  dots(
    Array.from({ length: 16 }, () => '.'.repeat(16)),
    a
      ? [
          [2, 13, 'C'],
          [3, 13, 'C'],
          [12, 13, 'C'],
          [13, 13, 'C'],
          [4, 14, 'c'],
          [11, 14, 'c'],
        ]
      : [
          [1, 13, 'C'],
          [2, 13, 'C'],
          [13, 13, 'C'],
          [14, 13, 'C'],
          [3, 14, 'c'],
          [12, 14, 'c'],
        ],
  );
const withRipples = (rows: readonly string[], a: boolean): string[] => {
  const r = ripples(a);
  return outlined(rows).map((row, y) =>
    [...row].map((ch, x) => (ch === '.' ? (r[y]![x] ?? '.') : ch)).join(''),
  );
};

export const objFishTrap: SpriteDef = {
  id: 'obj_fish_trap',
  frameMs: 700,
  frames: [withRipples(TRAP_BASE, true), withRipples(TRAP_BASE, false)],
};

export const objFishTrapFull: SpriteDef = {
  id: 'obj_fish_trap_full',
  frameMs: 700,
  frames: [withRipples(TRAP_FULL, true), withRipples(TRAP_FULL, false)],
};

// ---- bobber, bite bubble, splash (used by the Fishing panel's little pond)

const BOBBER = outlined([
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '.......qq.......',
  '......qQQq......',
  '......qqqq......',
  '......wwww......',
  '......wwww......',
  '.......ww.......',
  '................',
  '................',
  '................',
  '................',
]);
const BOBBER_LOW = dots(shifted(BOBBER, 0, 2), [
  [4, 13, 'C'],
  [5, 14, 'c'],
  [10, 13, 'C'],
  [11, 14, 'c'],
  [6, 14, 'C'],
  [9, 14, 'C'],
]);
const BOBBER_HIGH = shifted(BOBBER, 0, 1);

export const objBobber: SpriteDef = {
  id: 'obj_bobber',
  frameMs: 900,
  frames: [
    dots(BOBBER_HIGH, [
      [5, 14, 'c'],
      [10, 14, 'c'],
    ]),
    dots(shifted(BOBBER, 0, 2), [
      [4, 14, 'c'],
      [5, 14, 'C'],
      [10, 14, 'C'],
      [11, 14, 'c'],
    ]),
  ],
};

/** The bite: the float bobs deep and fast. */
export const objBobberDip: SpriteDef = {
  id: 'obj_bobber_dip',
  frameMs: 160,
  frames: [
    BOBBER_LOW,
    dots(shifted(BOBBER, 0, 4), [
      [3, 14, 'C'],
      [12, 14, 'C'],
      [4, 13, 'c'],
      [11, 13, 'c'],
    ]),
  ],
};

export const uiBite: SpriteDef = {
  id: 'ui_bite',
  frameMs: 260,
  frames: [
    outlined([
      '................',
      '................',
      '....wwwwwwww....',
      '...wwwwqqwwww...',
      '...wwwwqqwwww...',
      '...wwwwqqwwww...',
      '...wwwwqqwwww...',
      '...wwwwqqwwww...',
      '....wwwwwwww....',
      '.....wwqqww.....',
      '......wwww......',
      '.......ww.......',
      '................',
      '................',
      '................',
      '................',
    ]),
    shifted(
      outlined([
        '................',
        '................',
        '....wwwwwwww....',
        '...wwwwqqwwww...',
        '...wwwwqqwwww...',
        '...wwwwqqwwww...',
        '...wwwwqqwwww...',
        '...wwwwqqwwww...',
        '....wwwwwwww....',
        '.....wwqqww.....',
        '......wwww......',
        '.......ww.......',
        '................',
        '................',
        '................',
        '................',
      ]),
      0,
      -1,
    ),
  ],
};

const blank = (): string[] => Array.from({ length: 16 }, () => '.'.repeat(16));

export const fxSplash: SpriteDef = {
  id: 'fx_splash',
  frameMs: 110,
  frames: [
    dots(blank(), [
      [6, 12, 'C'],
      [7, 12, 'C'],
      [8, 12, 'C'],
      [9, 12, 'C'],
      [7, 10, 'w'],
      [8, 9, 'C'],
    ]),
    dots(blank(), [
      [4, 12, 'C'],
      [5, 12, 'c'],
      [10, 12, 'c'],
      [11, 12, 'C'],
      [6, 8, 'w'],
      [9, 7, 'C'],
      [7, 5, 'w'],
      [8, 10, 'C'],
      [5, 9, 'c'],
      [10, 9, 'c'],
    ]),
    dots(blank(), [
      [3, 12, 'C'],
      [4, 12, 'c'],
      [11, 12, 'c'],
      [12, 12, 'C'],
      [5, 5, 'C'],
      [10, 5, 'C'],
      [7, 3, 'w'],
      [8, 4, 'w'],
      [4, 8, 'c'],
      [11, 8, 'c'],
    ]),
    dots(blank(), [
      [2, 13, 'c'],
      [3, 13, 'C'],
      [12, 13, 'C'],
      [13, 13, 'c'],
      [5, 8, 'c'],
      [10, 8, 'c'],
      [6, 10, 'C'],
      [9, 10, 'C'],
    ]),
  ],
};

// ---- water: a gently flowing river and deep sea, rolled and recoloured from the pond's water

/** Rotates a row sideways with wrap-around, so a tile stays opaque and seamless. */
function roll(row: string, dx: number): string {
  const n = row.length;
  const k = ((dx % n) + n) % n;
  return row.slice(n - k) + row.slice(0, n - k);
}

export const tileRiver: SpriteDef = {
  id: 'tile_river',
  frameMs: 450,
  frames: [0, 1, 2, 3].map((i) => tileWater.frames[i % 2]!.map((row) => roll(row, i * 4))),
};

export const tileSea: SpriteDef = {
  id: 'tile_sea',
  frameMs: 700,
  frames: tileWater.frames.map((f) => recolored(f, { B: 'b', c: 'B', C: 'c' })),
};

// ---- the bridge over the river and the dock at the sea

export const objBridge: SpriteDef = {
  id: 'obj_bridge',
  frames: [
    [
      'mMpPPPPPPPPPPpMm',
      'mMppppppppppppMm',
      'mMPPPPPPPPPPPPMm',
      'mMmmmmmmmmmmmmMm',
      'mMpPPPPPPPPPPpMm',
      'mMppppppppppppMm',
      'mMPPPPPPPPPPPPMm',
      'mMmmmmmmmmmmmmMm',
      'mMpPPPPPPPPPPpMm',
      'mMppppppppppppMm',
      'mMPPPPPPPPPPPPMm',
      'mMmmmmmmmmmmmmMm',
      'mMpPPPPPPPPPPpMm',
      'mMppppppppppppMm',
      'mMPPPPPPPPPPPPMm',
      'mMmmmmmmmmmmmmMm',
    ],
  ],
};

export const objDock: SpriteDef = {
  id: 'obj_dock',
  frames: [
    [
      '................',
      '................',
      'mmmmmmmmmmmmmmmm',
      'pPPPpPPPPpPPPPpP',
      'pppppppppppppppp',
      'mmmmmmmmmmmmmmmm',
      'pPPPPpPPPPpPPPPp',
      'pppppppppppppppp',
      'mmmmmmmmmmmmmmmm',
      'PPpPPPPpPPPPpPPP',
      'pppppppppppppppp',
      'mmmmmmmmmmmmmmmm',
      'KKKKKKKKKKKKKKKK',
      '................',
      '................',
      '................',
    ],
  ],
};

export const objDockPost: SpriteDef = {
  id: 'obj_dock_post',
  frames: [
    outlined([
      '................',
      '................',
      '................',
      '.......pp.......',
      '......pMMp......',
      '......pMMm......',
      '......pMMm......',
      '......pMMm......',
      '......pMMm......',
      '......pMMm......',
      '.....CpMMmC.....',
      '....CCcmmcCC....',
      '.....cCCCCc.....',
      '................',
      '................',
      '................',
    ]),
  ],
};

export const uiToolRod: SpriteDef = {
  id: 'ui_tool_rod',
  frames: [
    outlined([
      '................',
      '..............pp',
      '.............pMp',
      '............pMp.',
      '...........pMp.w',
      '..........pMp.w.',
      '.........pMp.w..',
      '........pMp..w..',
      '.......pMp...w..',
      '..qq..pMp....w..',
      '.qQq.pMp.....w..',
      '.qqq.mm.....wc..',
      '.mmm.m.......C..',
      '................',
      '................',
      '................',
    ]),
  ],
};

export const FISHING_SPRITES: readonly SpriteDef[] = [
  ...FISH_ICONS,
  ...JUNK_ICONS,
  objFishTrap,
  objFishTrapFull,
  objBobber,
  objBobberDip,
  uiBite,
  fxSplash,
  tileRiver,
  tileSea,
  objBridge,
  objDock,
  objDockPost,
  uiToolRod,
];
