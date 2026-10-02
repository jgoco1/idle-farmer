// Objects and buildings, outlined with `k` and lit from the top-left (ART_STYLE.md §2).
// The farmhouse, market stall and tree are larger than one tile and are single grids.

import type { SpriteDef } from './types';

/** 4 × 3 tiles; fills the Farmhouse zone (1,1)–(4,3). */
export const objFarmhouse: SpriteDef = {
  id: 'obj_farmhouse',
  anchor: 'top-left',
  frames: [
    [
      '...........................................kKnnnnnnnKk..........',
      '...........................................kKKKKKKKKKk..........',
      '............................................kNnnnnnnk...........',
      '............................................kNnnnnnnk...........',
      '...................kkkkkkkkkkkkkkkkkkkkkkkkkkNKKKKKKk...........',
      '..................kQQQQQQQQQQQQQQQQQQQQQQQQQQNnnnnnnk...........',
      '.................krRRRRRrRRRRRrRRRRRrRRRRRrRRrnnnnnnk...........',
      '................krrRRRRRrRRRRRrRRRRRrRRRRRrRRRrKKKKKk...........',
      '...............krrRrrrrrRrrrrrRrrrrrRrrrrrRrrrrrnnnnk...........',
      '..............krRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRrnnnk...........',
      '.............krrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRrKKk...........',
      '............krRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRrnk...........',
      '...........krrrRrrrrrRrrrrrRrrrrrRrrrrrRrrrrrRrrrrrrk...........',
      '..........krrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRrk..........',
      '.........krRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRrk.........',
      '........krRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrk........',
      '.......krrrrRrrrrrRrrrrrRrrrrrRrrrrrRrrrrrRrrrrrRrrrrrRrk.......',
      '......krRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRrk......',
      '.....krRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrk.....',
      '....krRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrrk....',
      '...krrrrrRrrrrrRrrrrrRrrrrrRrrrrrRrrrrrRrrrrrRrrrrrRrrrrrRrrk...',
      '.kkrRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrRRRRRrkk.',
      'krrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrk',
      'kKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKk',
      '.kkkpMppppppppppppppppppppppppppppppppppppppppppppppppppppmmkkk.',
      '...kpMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMmmk...',
      '...kpMPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPmmk...',
      '...kpMpppppppppppppppppppppppppPPPPPPPPPPpppppPPPPPPPPPPppmmk...',
      '...kpMpppppppppppppppppppppppppPccccPcccPpppppPccccPcccPppmmk...',
      '...kpMMMMMMMmmmmmmmmmmmMKKMMMMMPcCCcPcccPMMMMMPcCCcPcccPMMmmk...',
      '...kpMPPPPPPmpppppppppmPUOPPPPPPcCccPcccPPPPPPPcCccPcccPPPmmk...',
      '...kpMppppppmMpMpMpMpMmpOOpppppPPPPPPPPPPpppppPPPPPPPPPPppmmk...',
      '...kpMppppppmMpMpMpMpMmpOOpppppPBBBBPBBBPpppppPBBBBPBBBPppmmk...',
      '...kpMMMMMMMmMpMpMpMpMmMMMMMMMMPBBBBPBBBPMMMMMPBBBBPBBBPMMmmk...',
      '...kpMPPPPPPmMpMpMpMpMmPPPPPPPPPqBBBuBBBiPPPPPPqBBBuBBBiPPmmk...',
      '...kpMppppppmMpMpMpMpMmppppppppPGgGgGgGgGgppppPGgGgGgGgGgpmmk...',
      '...kpMppppppmMpMpMpMpMmpppppppppppppppppppppppppppppppppppmmk...',
      '...kpMMMMMMMmMpMpMpMfMmMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMmmk...',
      '...kpMPPPPPPmMpMpMpMFMmPPPPPPPmmmmmmmmmmmmPPPmmmmmmmmmmmmPmmk...',
      '...kpMppppppmMpMpMpMpMmpppppppppppppppppppppppppppppppppppmmk...',
      '...kpMppppppmMpMpMpMpMmpppppppppppppppppppppppppppppppppppmmk...',
      '...kpMMMMMMMmMpMpMpMpMmMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMmmk...',
      '...kpMPPPPPPmMpMpMpMpMmPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPmmk...',
      '...kpMppppppmMpMpMpMpMmpppppppppppppppppppppppppppppppppppmmk...',
      '..kNNNNNNNNNmMpMpMpMpMmNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNk..',
      '..knnKnnnnnNNNNNNNNNNNNNnnnnnKnnnnnKnnnnnKnnnnnKnnnnnKnnnnnKnk..',
      '..kKKKKKKKKNNNNNNNNNNNNNKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKk..',
      '..knnKnnnnnnnnnnnnnnnnnnnnnnnKnnnnnKnnnnnKnnnnnKnnnnnKnnnnnKnk..',
    ],
  ],
};

/** 3 × 3 tiles; fills the Market zone (15,6)–(17,8). */
export const objMarketStall: SpriteDef = {
  id: 'obj_market_stall',
  anchor: 'top-left',
  frames: [
    [
      '...............kPPPPPPPPPPPPPPPPk...............',
      '...............kpppmmmmmmmmmmpppk...............',
      '..kkkkkkkkkkkkkkppppppppppppppppkkkkkkkkkkkkkk..',
      '.krrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrk.',
      '.krrrrZZZZrrrrZZZZrrrrZZZZrrrrZZZZrrrrZZZZrrrrk.',
      '.kRRRRxxxxRRRRxxxxRRRRxxxxRRRRxxxxRRRRxxxxRRRRk.',
      '.kRRRRxxxxRRRRxxxxRRRRxxxxRRRRxxxxRRRRxxxxRRRRk.',
      '.kRRRRxxxxRRRRxxxxRRRRxxxxRRRRxxxxRRRRxxxxRRRRk.',
      '.kRRRRxxxxRRRRxxxxRRRRxxxxRRRRxxxxRRRRxxxxRRRRk.',
      '.kRRRRxxxxRRRRxxxxRRRRxxxxRRRRxxxxRRRRxxxxRRRRk.',
      '.kRRRRxxxxRRRRxxxxRRRRxxxxRRRRxxxxRRRRxxxxRRRRk.',
      '.kRRRRxxxxRRRRxxxxRRRRxxxxRRRRxxxxRRRRxxxxRRRRk.',
      '.kRRRRxxxxRRRRxxxxRRRRxxxxRRRRxxxxRRRRxxxxRRRRk.',
      '.kRRRRxxxxRRRRxxxxRRRRxxxxRRRRxxxxRRRRxxxxRRRRk.',
      '.kRRRRxxxxRRRRxxxxRRRRxxxxRRRRxxxxRRRRxxxxRRRRk.',
      '.kRRRRxxxxRRRRxxxxRRRRxxxxRRRRxxxxRRRRxxxxRRRRk.',
      '.kRRRRxxxxRRRRxxxxRRRRxxxxRRRRxxxxRRRRxxxxRRRRk.',
      '..krrpMZZkkrrkkZZkkrrkkZZkkrrkkZZkkrrkkZZMMrrk..',
      '...kkpMMKKKKYKKKKKKKKKKKKKKKKKKKKKKYKKKKpMMkk...',
      '....kpMMKKKKYKKKKKKKKKKKKKKKKKKKKKKYKKKKpMMk....',
      '....kpMMKKKKYKKKKKKKKKKKKKKKKKKKKKKYKKKKpMMk....',
      '....kpMMKKKKYKKKKKKKKKKKKKKKKKKKKKUuuKKKpMMk....',
      '....kpMMKKGKxGKKGKKKKKKKKKKKKKKGKKGuuGKKpMMk....',
      '....kpMMKOooOooOooKKKqKKqKKKKKKvKKvuuvKKpMMk....',
      '....kpMMKoooooooooKQQqqQQqqQQKxxxxxxxxxKpMMk....',
      '....kpMMKoooooooooKQQqqQQqqQQKxxxxxxxxxKpMMk....',
      '....kpMMKPPPPPPPPKKPPPPPPPPPKKPPPPPPPPPKpMMk....',
      '....kpMMkYPYPYPYPkkYPYPYPYPYkkYPYPYPYPYkpMMk....',
      '..kkkpMMkYYYYYYYYkkYYYYYYYYYkkYYYYYYYYYkpMMkkk..',
      '.kPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPk.',
      '.kPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPk.',
      '.kMppppppppppMppppppppppMppppppppppMppppppppppk.',
      '.kMppppppppppMppppppppppMppppppppppMppppppppppk.',
      '.kMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMk.',
      '.kMppppppppppMppppzzzzzzzzzzzzpppppMppppppppppk.',
      '.kMppppppppppMppppzzzzzzzzzzzzpppppMppppppppppk.',
      '.kMppppppppppMppppzzKKKKKKKKzzpppppMppppppppppk.',
      '.kMMMMMMMMMMMMMMMMzzzzzzzzzzzzMMMMMMMMMMMMMMMMk.',
      '.kMppppppppppMppppzzKKKKKKzfzzpppppMppppppppppk.',
      '.kMppppppppppMppppzzzzzzzzzzzzpppppMppppppppppk.',
      '.kMppppppppppMppppppppppMppppppppppMppppppppppk.',
      '.kMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMk.',
      '.kmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmmk.',
      '..kkkpMMkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkppppppppk.',
      '.....kkk.............................kMMMmMMMMk.',
      '.....................................kMMMmMMMMk.',
      '.....................................kMMMmMMMMk.',
      '.....................................kMMMmMMMMk.',
    ],
  ],
};

/** 2 × 3 tiles, anchored at the bottom centre of its base tile. */
export const objTree: SpriteDef = {
  id: 'obj_tree',
  anchor: 'bottom-center',
  frames: [
    [
      '................................',
      '..............kkkkk.............',
      '............kkHHHHHkk...........',
      '...........kHHGLHHHGGk..........',
      '..........kHHGHHHHGGHGk.........',
      '.........kHHGHHLGGGGGHGk........',
      '.........kHHHHGGGGGgGGHk........',
      '........kHLGHGGGGGGGGHGHk.......',
      '........kHHGGGGHHgGQGGGgk.......',
      '......kkHHHGGGgGGGGGqGGggkk.....',
      '.....kHHGGHGGGgHGGGGggghgGgk....',
      '....kHGGHQGGGHGGGGgggggGggggk...',
      '...kHGGGGHqGGGGGgGggggggGggGgk..',
      '...kHGHGGGGGGGGggggggggGGggggk..',
      '..kGGGHGGHGGGGggGggghhGggGhghhk.',
      '..kHgGGGGGGGggQGGGgghgggGggghgk.',
      '..kGGGgGgGgggggqGGggggghgggghhk.',
      '..kgGGGHGggggGgggggggggGggGlhgk.',
      '..kGGGGggggggggggghghghgghghhhk.',
      '...kGGgggGgggggggggggggQhhhhhk..',
      '...kggghggGghgggGggggghhqhhghk..',
      '....kggQggggggggghGghhghhhhhk...',
      '....kgGgqggggggGggghhhlhhhhgk...',
      '....kggggGggggggghhlhhhhghhlk...',
      '...kgggggghggggghhhhhhhhhglllk..',
      '...kggggGggGgghhhhQhhhhhlllllk..',
      '...kgggghgghhghhhhhqglhllllllk..',
      '....kggGggghhhhhhhhhhlllllllk...',
      '....kgGgghhghhhhhhhlllllllllk...',
      '.....kgghhllhhhhhhlllllllllk....',
      '......khhhhghglhlllhllllllk.....',
      '.......kkhhhhhllllllllllkk......',
      '.........kkkhhlllllllkkk........',
      '............klhlllllk...........',
      '............kpmlllmk............',
      '............kpmMMMmk............',
      '............kpmMMMmk............',
      '............kpmMMMmk............',
      '............kpmMMMmk............',
      '............kpMMMMmk............',
      '............kpMMMMmk............',
      '............kpMMMMmk............',
      '............kpMMMMmk............',
      '............kpMMMMmk............',
      '...........kMpMMMMmmk...........',
      '..........kMMMMMMMMMmk..........',
      '...........kkkkkkkkkk...........',
      '................................',
    ],
  ],
};

/** A horizontal run of fence with posts every 8 px, drawn over grass. */
export const objFenceH: SpriteDef = {
  id: 'obj_fence_h',
  frames: [
    [
      '................',
      '................',
      '..kkkk....kkkk..',
      '..kPpk....kPpk..',
      'kkkPpkkkkkkPpkkk',
      'PPPPPPPPPPPPPPPP',
      'pppppppppppppppp',
      'MMMMMMMMMMMMMMMM',
      'kkkpMkkkkkkpMkkk',
      '..kpMk....kpMk..',
      'kkkpMkkkkkkpMkkk',
      'PPPPPPPPPPPPPPPP',
      'pppppppppppppppp',
      'MMMMMMMMMMMMMMMM',
      'kkkpMkkkkkkpMkkk',
      '..KKKK....KKKK..',
    ],
  ],
};

/** A vertical run of fence seen from above: a rail with square posts every 8 px. */
export const objFenceV: SpriteDef = {
  id: 'obj_fence_v',
  frames: [
    [
      '......kPMk......',
      '......kPMk......',
      '.....kkkkkk.....',
      '.....kPppMk.....',
      '.....kpppMk.....',
      '.....kMMMmk.....',
      '.....kkkkkk.....',
      '......kPMk......',
      '......kPMk......',
      '......kPMk......',
      '.....kkkkkk.....',
      '.....kPppMk.....',
      '.....kpppMk.....',
      '.....kMMMmk.....',
      '.....kkkkkk.....',
      '......kPMk......',
    ],
  ],
};

// ---- fence corners and gates: the side rail (x 6–9 of obj_fence_v) meets the top and bottom rails at a
// corner post centred on it, so the ring closes.

/** The colour of each row of obj_fence_h's two rails (rows 4–8 and 10–14). */
const RAIL_ROW: Readonly<Record<number, string>> = {
  4: 'k',
  5: 'P',
  6: 'p',
  7: 'M',
  8: 'k',
  10: 'k',
  11: 'P',
  12: 'p',
  13: 'M',
  14: 'k',
};
const SIDE_RAIL = 'kPMk'; // obj_fence_v's rail, x 6–9

/** A corner post (x 5–10) with the rails running off to one side and the side rail to the top or bottom edge. */
function fenceCorner(rails: 'left' | 'right', side: 'up' | 'down'): string[] {
  const rows: string[] = [];
  for (let y = 0; y < 16; y++) {
    const line = Array.from({ length: 16 }, () => '.');
    const rail = RAIL_ROW[y];
    if (rail) for (let x = rails === 'right' ? 11 : 0; x < (rails === 'right' ? 16 : 5); x++) line[x] = rail;
    const post = y === 2 || y === 14 ? 'kkkkkk' : y === 3 ? 'kPPPMk' : y > 3 && y < 14 ? 'kPppMk' : null;
    if (post) for (let i = 0; i < 6; i++) line[5 + i] = post[i]!;
    if ((side === 'up' && y < 2) || (side === 'down' && y === 15))
      for (let i = 0; i < 4; i++) line[6 + i] = SIDE_RAIL[i]!;
    if (side === 'up' && y === 15) for (let x = 6; x < 10; x++) line[x] = 'K';
    rows.push(line.join(''));
  }
  return rows;
}

export const objFenceNw: SpriteDef = { id: 'obj_fence_nw', frames: [fenceCorner('right', 'down')] };
export const objFenceNe: SpriteDef = { id: 'obj_fence_ne', frames: [fenceCorner('left', 'down')] };
export const objFenceSw: SpriteDef = { id: 'obj_fence_sw', frames: [fenceCorner('right', 'up')] };
export const objFenceSe: SpriteDef = { id: 'obj_fence_se', frames: [fenceCorner('left', 'up')] };

/** A gateway in a side of the fence where the path goes through: a post at each end, the way between them open. */
export const objFenceGateV: SpriteDef = {
  id: 'obj_fence_gate_v',
  frames: [
    [
      '......kPMk......',
      '.....kkkkkk.....',
      '.....kPPPMk.....',
      '.....kpppMk.....',
      '.....kMMMmk.....',
      '.....kkkkkk.....',
      '......KKKK......',
      '................',
      '................',
      '................',
      '.....kkkkkk.....',
      '.....kPPPMk.....',
      '.....kpppMk.....',
      '.....kpppMk.....',
      '.....kMMMmk.....',
      '.....kkkkkk.....',
    ],
  ],
};

/** A gate in the bottom rail: a post at each edge for the rails to meet, the way between them open. */
export const objFenceGateH: SpriteDef = {
  id: 'obj_fence_gate_h',
  frames: [
    [
      '................',
      '................',
      'kkkk........kkkk',
      'kPPk........kPPk',
      'kPpk........kPpk',
      'kPpk........kPpk',
      'kPpk........kPpk',
      'kPpk........kPpk',
      'kPpk........kPpk',
      'kPpk........kPpk',
      'kPpk........kPpk',
      'kPpk........kPpk',
      'kPpk........kPpk',
      'kpMk........kpMk',
      'kkkk........kkkk',
      'KKKK........KKKK',
    ],
  ],
};

/** Wild flowers scattered on grass (no outline: they are terrain decoration). */
export const objFlowerA: SpriteDef = {
  id: 'obj_flower_a',
  frames: [
    [
      '................',
      '................',
      '................',
      '................',
      '...........I....',
      '..........IuI...',
      '....i......I....',
      '...iui.....G....',
      '....i.....hG....',
      '....G......G....',
      '....Gh..........',
      '....G....U......',
      '........UuU.....',
      '.........U......',
      '.........G......',
      '................',
    ],
  ],
};

export const objFlowerB: SpriteDef = {
  id: 'obj_flower_b',
  frames: [
    [
      '................',
      '................',
      '................',
      '......V.........',
      '.....VvV........',
      '......V....w....',
      '......G...wUw...',
      '......Gh...w....',
      '......G....G....',
      '...........Gh...',
      '..V........G....',
      '.VvV............',
      '..V.............',
      '..G.............',
      '..Gh............',
      '................',
    ],
  ],
};

/** 1 tile at (18,7): the Shipping Bin, a lidded crate with a gold coin plate (phase 03). */
export const objShippingBin: SpriteDef = {
  id: 'obj_shipping_bin',
  anchor: 'top-left',
  frames: [
    [
      '................',
      '..kkkkkkkkkkkk..',
      '.kPPPPPPPPPPPPk.',
      'kPppppppppppppPk',
      'kMMMMMMMMMMMMMMk',
      'kkkkkkkkkkkkkkkk',
      'kPpppppppppppPMk',
      'kPppppkkkkppppMk',
      'kPpppkfUfFkpppMk',
      'kPppppkkkkppppMk',
      'kMMMMMMMMMMMMMMk',
      'kPpppppppppppPMk',
      'kPpppppppppppPMk',
      'kMMMMMMMMMMMMMmk',
      '.kkkkkkkkkkkkkk.',
      '..KKKKKKKKKKKK..',
    ],
  ],
};

/** Weeds south of the starting field; cleared by the first expansion. */
export const objWeeds: SpriteDef = {
  id: 'obj_weeds',
  anchor: 'top-left',
  frames: [
    [
      '................',
      '................',
      '................',
      '.......k........',
      '......khk...k...',
      '..k...khk..khk..',
      '.khk.khhhk.khk..',
      '.khhkkhGhk.khhk.',
      '..khhhhGhkkhhk..',
      '..khGhhhhhhGhk..',
      '...khhGhhhhhk...',
      '...kkhhhhhhkk...',
      '....kkkkkkkk....',
      '................',
      '................',
      '................',
    ],
  ],
};

/** An old tree stump beside the weeds; cleared by the first expansion. */
export const objStump: SpriteDef = {
  id: 'obj_stump',
  anchor: 'top-left',
  frames: [
    [
      '................',
      '................',
      '................',
      '................',
      '................',
      '....kkkkkkkk....',
      '...kPPPPPPPPk...',
      '..kPpPPmmPPpPk..',
      '..kPPmPPPPmPPk..',
      '..kmPPPPPPPPmk..',
      '..kMmMMmMMmMMk..',
      '..kMmMMmMMmMMk..',
      '.kmMmMMmMMmMMmk.',
      'kmmkkmkkkkmkkmmk',
      '.kk..k....k..kk.',
      '................',
    ],
  ],
};

/** Flat stepping stones laid on the paths by the second expansion. */
export const objStones: SpriteDef = {
  id: 'obj_stones',
  anchor: 'top-left',
  frames: [
    [
      '................',
      '................',
      '...kkkk.........',
      '..kNNNNk........',
      '..kNNNnk........',
      '...knnk.........',
      '...........kkk..',
      '..........kNNNk.',
      '..........kNnnk.',
      '...........kkk..',
      '....kkkk........',
      '...kNNNNk.......',
      '...kNNnnk.......',
      '....kkkk........',
      '................',
      '................',
    ],
  ],
};

/** A straw-hatted scarecrow post, a decoration for the full farm (phase 04's scarecrows are placed on plots). */
export const objScarecrowPost: SpriteDef = {
  id: 'obj_scarecrow_post',
  anchor: 'bottom-center',
  frames: [
    [
      '................',
      '................',
      '................',
      '......kkkk......',
      '.....kyyyyk.....',
      '....kyYYYYyk....',
      '..kkkkkkkkkkkk..',
      '..kyyyyyyyyyyk..',
      '...kkkxxxxkkk...',
      '.....kxkkxk.....',
      '.....kxxxxk.....',
      '......kkkk......',
      'kkkkkkkqqkkkkkkk',
      'kyyqqqqqqqqqqyyk',
      'kkkkqqQqqQqqkkkk',
      '...kqqqqqqqqk...',
      '...kqqQqqQqqk...',
      '...kqqqqqqqqk...',
      '...kkkkMmkkkk...',
      '......kMmk......',
      '......kMmk......',
      '......kMmk......',
      '......kMmk......',
      '......kMmk......',
      '......kMmk......',
      '......kMmk......',
      '......kMmk......',
      '......kMmk......',
      '......kMmk......',
      '......kMmk......',
      '.....kMMmmk.....',
      '.....kkkkkk.....',
    ],
  ],
};
