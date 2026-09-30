// Terrain tiles, 16 × 16, no outline (ART_STYLE.md §2). Light comes from the top-left.

import { rotateSprite, type SpriteDef } from './types';

export const tileGrassA: SpriteDef = {
  id: 'tile_grass_a',
  frames: [
    [
      'gggggggggggggggg',
      'ggGgggggggghgggg',
      'gGHGgggggggggggg',
      'ggGggggghggggGgg',
      'gggggggghhggggGg',
      'gggggggggggggggg',
      'gggghggggggGgggg',
      'ggghhgggggGHGggg',
      'gggggggggggGgggg',
      'gGgggggggggggggg',
      'gggggggGggggghgg',
      'ggggggggggggghhg',
      'gghggggggggggggg',
      'gghhggggGggggggg',
      'gggggggGHGgggggg',
      'ggggggggGggggggg',
    ],
  ],
};

export const tileGrassB: SpriteDef = {
  id: 'tile_grass_b',
  frames: [
    [
      'gggggggggggggggg',
      'gggggggggGgggggg',
      'ggggggggGHGggggg',
      'gghgggggggGggggg',
      'ghhggggggggggggg',
      'gggggggggggghggg',
      'ggggggGgggggghhg',
      'gggggGHGgggggggg',
      'ggggggGggggggggg',
      'gggggggggggggggg',
      'ggGggggggghggggg',
      'gGHGggggggghgggg',
      'ggGggggggggggggg',
      'ggggggggggggGggg',
      'gggghgggggggGHgg',
      'gggghhgggggggggg',
    ],
  ],
};

export const tileGrassC: SpriteDef = {
  id: 'tile_grass_c',
  frames: [
    [
      'gggggggggggggggg',
      'ggggghgggggggggg',
      'gggghhggggGggggg',
      'ggggggggggHGgggg',
      'gGgggggggggggggg',
      'GHGgggggggggghgg',
      'gGgggggggggghhgg',
      'ggggggghgggggggg',
      'ggggggghhggggggg',
      'gggggggggggGgggg',
      'gghggggggggHGggg',
      'gghhgggggggggggg',
      'ggggggggGggggggg',
      'gggggggGHGgggghg',
      'ggggggggGgggggGg',
      'gggggggggggggggg',
    ],
  ],
};

/** Tilled soil, dry. Ridges catch the light; each plot has a darker bottom/right edge. */
export const tileSoilDry: SpriteDef = {
  id: 'tile_soil_dry',
  frames: [
    [
      'SSSSSSSSSSSSSSSd',
      'SSsSSSsSSSSsSSsd',
      'Sssssssssssssssd',
      'Sddsddddsdddddsd',
      'SSSSSsSSSSSSsSSd',
      'Sssssssssssssssd',
      'Sdddddsddddsdddd',
      'SSsSSSSSsSSSSSsd',
      'Sssssssssssssssd',
      'Sddddsdddddddsdd',
      'SSSSSSSsSSSSSSSd',
      'Sssssssssssssssd',
      'Sdsddddddsdddddd',
      'SSSSsSSSSSSSsSSd',
      'Sssssssssssssssd',
      'dddddddddddddddd',
    ],
  ],
};

/** An untilled plot: packed earth with tufts of grass, ready for the hoe. */
export const tileSoilUntilled: SpriteDef = {
  id: 'tile_soil_untilled',
  frames: [
    [
      'gSSSSSSSgSSSSSSg',
      'SSSsSSSSSSSSgSSs',
      'SSSSSShSSSSShgSs',
      'SsSSSSSSSsSSSSSs',
      'SSSgSSSSSSSSSsSs',
      'SShgSSSsSSSSSSSs',
      'SSSSSSSSSSSgSSSs',
      'SsSSSSSSSShgSSSs',
      'SSSSSSsSSSSSSSSs',
      'SSSSgSSSSSSSSsSs',
      'SSShgSSSSSsSSSSs',
      'SsSSSSSSSSSSSSSs',
      'SSSSSSSSgSSSSSSs',
      'SSSsSSShgSSSsSSs',
      'SSSSSSSSSSSSSSSs',
      'gsssssssssssssss',
    ],
  ],
};

/** Tilled soil, watered: the dry tile one step darker (S→s, s→E, d→e). */
export const tileSoilWet: SpriteDef = {
  id: 'tile_soil_wet',
  frames: [
    [
      'ssssssssssssssse',
      'ssEsssEssssEssEe',
      'sEEEEEEEEEEEEEEe',
      'seeEeeeeEeeeeeEe',
      'sssssEssssssEsse',
      'sEEEEEEEEEEEEEEe',
      'seeeeeEeeeeEeeee',
      'ssEsssssEsssssEe',
      'sEEEEEEEEEEEEEEe',
      'seeeeEeeeeeeeEee',
      'sssssssEssssssse',
      'sEEEEEEEEEEEEEEe',
      'seEeeeeeeEeeeeee',
      'ssssEsssssssEsse',
      'sEEEEEEEEEEEEEEe',
      'eeeeeeeeeeeeeeee',
    ],
  ],
};

/** Open water, 2 frames at 600 ms. Ripples stay off the edges so tiles join seamlessly. */
export const tileWater: SpriteDef = {
  id: 'tile_water',
  frameMs: 600,
  frames: [
    [
      'BBBBBBBBBBBBBBBB',
      'BBBBBBBBBBBBBBBB',
      'BBBccBBBBBBBBBBB',
      'BBBBBccBBBBBBBBB',
      'BBBBBBBBBBBBBBBB',
      'BBBBBBBBBBBcccBB',
      'BbBBBBBBBBBBBBBB',
      'BBBBBBBBBBBBBBBB',
      'BBBBBBBBBBBBBBBB',
      'BBBBBBcccBBBBBBB',
      'BBBBBBBBBcBBBBBB',
      'BBBBBBBBBBBBBBbB',
      'BBBBBBBBBBBBBBBB',
      'BBcCBBBBBBBBBBBB',
      'BBBBcBBBBBBBBBBB',
      'BBBBBBBBBBBBBBBB',
    ],
    [
      'BBBBBBBBBBBBBBBB',
      'BBBBBBBBBBBBBBBB',
      'BBBBBccBBBBBBBBB',
      'BBBBBBBccBBBBBBB',
      'BBBBBBBBBBBBBBBB',
      'BBBBBBBBBcccBBBB',
      'BBbBBBBBBBBBBBBB',
      'BBBBBBBBBBBBBBBB',
      'BBBBBBBBBBBBBBBB',
      'BBBBcccBBBBBBBBB',
      'BBBBBBBcBBBBBBBB',
      'BBBBBBBBBBBBBbBB',
      'BBBBBBBBBBBBBBBB',
      'BBBBcCBBBBBBBBBB',
      'BBBBBBcBBBBBBBBB',
      'BBBBBBBBBBBBBBBB',
    ],
  ],
};

export const tilePath: SpriteDef = {
  id: 'tile_path',
  frames: [
    [
      'yyyyyyyyyyyyyyyy',
      'yyyYyyyyyyyyyyyy',
      'yyyyyyyyyyNyyyyy',
      'yYyyyyyyyyynyyyy',
      'yyyyyyYyyyyyyyyy',
      'yyyyyyyyyyyyyYyy',
      'yyyNyyyyyyyyyyyy',
      'yyyynyyyyYyyyyyy',
      'yyyyyyyyyyyyyyyy',
      'yyyyyyyyyyyyyyyy',
      'yyYyyyyyyyyNyyyy',
      'yyyyyyyyyyyynyyy',
      'yyyyyyYyyyyyyyyy',
      'yNyyyyyyyyyyyyYy',
      'yynyyyyyyyyyyyyy',
      'yyyyyyyyyYyyyyyy',
    ],
  ],
};

/** The north bank of the pond: grass, a sandy lip, then water. Other sides are rotations. */
export const tilePondEdgeN: SpriteDef = {
  id: 'tile_pond_edge_n',
  frames: [
    [
      'gggggggggggggggg',
      'ggGgggggghgggggg',
      'gggggggggggggGgg',
      'gggghggggggggggg',
      'hghhhghhhhghhhgh',
      'YyyYyyyyYyyyyYyy',
      'YYYYYYYYYYYYYYYY',
      'bbbbbbbbbbbbbbbb',
      'BBBBBBBBBBBBBBBB',
      'BCBBBBBBBBBCBBBB',
      'BBBBBBBBBBBBBBBB',
      'BBBBBBccBBBBBBBB',
      'BBBBBBBBBBBBBBBB',
      'BBBBBBBBBBBBBBBB',
      'BBBBBBBBBBBcBBBB',
      'BBBBBBBBBBBBBBBB',
    ],
  ],
};

/** The north-west outer corner of the pond. Other corners are rotations. */
export const tilePondCornerNW: SpriteDef = {
  id: 'tile_pond_corner_nw',
  frames: [
    [
      'gggggggggggggggg',
      'ggGgggggggggghgg',
      'gggggggggggggggg',
      'gggghgggggGggggg',
      'gggggggghhhhghhh',
      'gggggghhYyyyYyyy',
      'ggggghYYYYYYYYYY',
      'ggggghYYbbbbbbbb',
      'gggghyYbBBBBBBBB',
      'gggghyYbBBBBBBBB',
      'gggghyYbBBBBBCBB',
      'gggghYYbBBBBBBBB',
      'ggGghyYbBBBBBBBB',
      'gggghyYbBBBBBcBB',
      'gggghyYbBBBBBBBB',
      'gggghYYbBBBBBBBB',
    ],
  ],
};

export const tilePondEdgeE = rotateSprite(tilePondEdgeN, 'tile_pond_edge_e', 1);
export const tilePondEdgeS = rotateSprite(tilePondEdgeN, 'tile_pond_edge_s', 2);
export const tilePondEdgeW = rotateSprite(tilePondEdgeN, 'tile_pond_edge_w', 3);
export const tilePondCornerNE = rotateSprite(tilePondCornerNW, 'tile_pond_corner_ne', 1);
export const tilePondCornerSE = rotateSprite(tilePondCornerNW, 'tile_pond_corner_se', 2);
export const tilePondCornerSW = rotateSprite(tilePondCornerNW, 'tile_pond_corner_sw', 3);
