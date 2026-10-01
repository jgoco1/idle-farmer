// v2 phase 01 art (ART_STYLE.md §6.2): a "For sale" sign and tall grass for locked parcels, the
// town's Community Board, beach sand, and the arrow of the off-screen edge pips.

import { tilePath } from './terrain';
import { outlined, recolored, type SpriteDef } from './types';

/** A little post with a red board: stands on each locked parcel (and on the dock's shore). */
export const objForSale: SpriteDef = {
  id: 'obj_for_sale',
  anchor: 'bottom-center',
  frames: [
    [
      '................',
      '..kkkkkkkkkkkk..',
      '.kQQQQQQQQQQQqk.',
      '.kQwwQwQwwQwQqk.',
      '.kQwQQwQwQQwQqk.',
      '.kQwwQwQwwQwQqk.',
      '.kQQQQQQQQQQQqk.',
      '.kqqqqqqqqqqqqk.',
      '..kkkkkMmkkkkk..',
      '......kMmk......',
      '......kMmk......',
      '......kMmk......',
      '......kMmk......',
      '....kkkMmkkk....',
      '...khhhMmhhhk...',
      '....kkkkkkkk....',
    ],
  ],
};

/** A tuft of long grass: overgrowth on a parcel nobody has bought. */
export const objTallGrass: SpriteDef = {
  id: 'obj_tall_grass',
  anchor: 'bottom-center',
  frames: [
    [
      '................',
      '................',
      '................',
      '....k.....k.....',
      '...kHk...kHk..k.',
      '...kHk.k.kHk.kHk',
      '..kHGkkHkkGk.kGk',
      '..kGgkHGkkGgkkGk',
      '.kHGgkGgkHGgkHgk',
      '.kGgkHGgkGgkkGgk',
      '.kGgkGggkGgkGgk.',
      'kHGgkGgkGggkGgk.',
      'kGggkGgkGgkGggk.',
      'kGgghGghGghGghk.',
      '.khhhhhhhhhhhhk.',
      '..kkkkkkkkkkkk..',
    ],
  ],
};

/** The Community Board in the town square: a notice board under a little roof. */
export const objBoard: SpriteDef = {
  id: 'obj_board',
  anchor: 'bottom-center',
  frames: [
    [
      '...kkkkkkkkkk...',
      '..krRRRRRRRRrk..',
      '.krRRRRRRRRRRrk.',
      '.kkkkkkkkkkkkkk.',
      '..kMPPPPPPPPMk..',
      '..kMPwwPzzzPMk..',
      '..kMPwwPzZzPMk..',
      '..kMPPPPPPPPMk..',
      '..kMPzzzPwwPMk..',
      '..kMPzZzPwwPMk..',
      '..kMPPPPPPPPMk..',
      '..kkkkkkkkkkkk..',
      '...kMk....kMk...',
      '...kMk....kMk...',
      '..khMhk..khMhk..',
      '...kkk....kkk...',
    ],
  ],
};

/** Pale beach sand: the path's grain in lighter colours. */
export const tileSand: SpriteDef = {
  id: 'tile_sand',
  frames: [recolored(tilePath.frames[0]!, { Y: 'x', N: 'Y', n: 'Y' })],
};

/** The off-screen pip's arrow, pointing right; the renderer turns it for the other edges. */
export const uiPipArrow: SpriteDef = {
  id: 'ui_pip_arrow',
  frames: [
    outlined([
      '................',
      '................',
      '................',
      '................',
      '.......f........',
      '.......ff.......',
      '..ffffffUf......',
      '..fUUUUUUUf.....',
      '..fUUUUUUUf.....',
      '..ffffffUf......',
      '.......ff.......',
      '.......f........',
      '................',
      '................',
      '................',
      '................',
    ]),
  ],
};
