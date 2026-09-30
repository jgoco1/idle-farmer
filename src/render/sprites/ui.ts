// UI icons, 16 × 16, shown at 2× in the HUD and panels.

import { outlined, type SpriteDef } from './types';

export const uiGold: SpriteDef = {
  id: 'ui_gold',
  frames: [
    [
      '................',
      '................',
      '.....kkkkkk.....',
      '....kUUffffk....',
      '...kUffffffFk...',
      '...kUffFFffFk...',
      '...kffFffFfFk...',
      '...kffFffffFk...',
      '...kffFffffFk...',
      '...kffFffFfFk...',
      '...kfffFFffFk...',
      '...kffffffFFk...',
      '....kfFFFFFk....',
      '.....kkkkkk.....',
      '................',
      '................',
    ],
  ],
};

export const uiClock: SpriteDef = {
  id: 'ui_clock',
  frames: [
    [
      '......kkkk......',
      '....kkppppkk....',
      '...kppppppMMk...',
      '..kppwwKxxxMMk..',
      '.kppwwxkxxxxMMk.',
      '.kpwwxxkxxxxxMk.',
      'kppwxxxkxxxxxMMk',
      'kppKxxxkxxxxKMMk',
      'kppxxxxqkkkxxMMk',
      'kppxxxxxxxxxxMMk',
      '.kMxxxxxxxxxxMk.',
      '.kMMxxxxxxxxMMk.',
      '..kMMxxKxxxMMk..',
      '...kMMMMMMMMk...',
      '....kkMMMMkk....',
      '......kkkk......',
    ],
  ],
};

export const uiSun: SpriteDef = {
  id: 'ui_sun',
  frames: [
    [
      '......kOOk......',
      '..k....kk....k..',
      '.kOk..kkkk..kOk.',
      '..kOkkUUUukkOk..',
      '...kkUUUuuukk...',
      '...kUUUuuuuuk...',
      'k.kUUUuuuuuuuk.k',
      'OkkUUuuuuuuuokkO',
      'OkkUuuuuuuuookkO',
      'k.kuuuuuuuoook.k',
      '...kuuuuuoook...',
      '...kkuuuoookk...',
      '..kOkkuoookkOk..',
      '.kOk..kkkk..kOk.',
      '..k....kk....k..',
      '......kOOk......',
    ],
  ],
};

export const uiMoon: SpriteDef = {
  id: 'ui_moon',
  frames: [
    [
      '................',
      '.....kkk........',
      '....kwwwk.......',
      '...kwwwk........',
      '..kwwwwk........',
      '.kwwwwUk........',
      '.kwwwUUk........',
      '.kwwUUUk........',
      '.kwUYUUUk.......',
      '.kUUUUUUUkkkkk..',
      '.kUUUuUUUUUUUUk.',
      '..kUUUYUUUUUUk..',
      '...kUUUUUUUUk...',
      '....kUUUUUUk....',
      '.....kkkkkk.....',
      '................',
    ],
  ],
};

// ---- farming tools (toolbar), drawn as fills and outlined

export const uiToolAuto: SpriteDef = {
  id: 'ui_tool_auto',
  frames: [
    outlined([
      '................',
      '.......U........',
      '.......f........',
      '......UfF.......',
      '..UffffwfffF....',
      '....UfffffF.....',
      '.....ffffF......',
      '....fffFffF.....',
      '...fF.....fF....',
      '................',
      '..........G.....',
      '.........GHG....',
      '...GG.....G.....',
      '..GHG...........',
      '...G............',
      '................',
    ]),
  ],
};

export const uiToolHoe: SpriteDef = {
  id: 'ui_tool_hoe',
  frames: [
    outlined([
      '................',
      '..NNNNn.........',
      '.NNnnnn.........',
      '.Nn.mMp.........',
      '.n...mMp........',
      '......mMp.......',
      '.......mMp......',
      '........mMp.....',
      '.........mMp....',
      '..........mMp...',
      '...........mMp..',
      '............mM..',
      '................',
      '................',
      '................',
      '................',
    ]),
  ],
};

export const uiToolWater: SpriteDef = {
  id: 'ui_tool_water',
  frames: [
    outlined([
      '................',
      '................',
      '.....NNNNN......',
      '....N.....n.....',
      '...N.......n....',
      '..NNNNNNNNn.....',
      '..NcNNNNNnn...n.',
      '..NNNNNNNnnnnNn.',
      '..NNNNNNnnnn....',
      '..NNNNNNnnn.....',
      '..NNNNNnnnn.....',
      '..nnnnnnnnn...c.',
      '.............c.C',
      '...............c',
      '................',
      '................',
    ]),
  ],
};

export const uiToolHand: SpriteDef = {
  id: 'ui_tool_hand',
  frames: [
    outlined([
      '................',
      '......P.P.......',
      '.....PPkPPP.....',
      '.....PPkPPkP....',
      '.....PPkPPkP....',
      '..P..PPkPPkP....',
      '.PPP.PPPPPPP....',
      '..PPPPPPPPPp....',
      '...PPPPPPPPp....',
      '....PPPPPPpp....',
      '....PPPPPPp.....',
      '.....PPPPpp.....',
      '.....RRRRRR.....',
      '.....rrrrrr.....',
      '................',
      '................',
    ]),
  ],
};
