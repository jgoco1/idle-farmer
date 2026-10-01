// The restyled farmhouse (ART_STYLE.md §6.2): paints, roofs and the loft are layers of the v1 sprite,
// recoloured and composed here at load, one finished sprite per combination (`obj_farmhouse_<paint>_<roof>`,
// plus `_loft` for the second storey). The original red walls and tiled roof is `obj_farmhouse` itself.

import type { DecorId } from '../../data/ids';
import { objFarmhouse } from './objects';
import type { SpriteDef } from './types';

const SOURCE = objFarmhouse.frames[0]!;
/** The first wall row: everything above is roof and chimney. */
const WALL_TOP = 23;
const DOOR = { x0: 12, x1: 22, y0: 34 };

export type Paint = 'red' | 'sage' | 'sky';
export type Roof = 'tile' | 'thatch' | 'slate';

/** Wall boards: pale, light, mid and dark wood become the paint's four tones. */
const PAINT: Record<Exclude<Paint, 'red'>, Record<string, string>> = {
  sage: { P: 'H', p: 'G', M: 'g', m: 'h' },
  sky: { P: 'x', p: 'J', M: 'j', m: 'j' },
};

const ROOF: Record<Exclude<Roof, 'tile'>, Record<string, string>> = {
  thatch: { Q: 'U', R: 'y', r: 'Y' },
  slate: { Q: 'N', R: 'A', r: 'n' },
};

function walls(paint: Paint, rows: readonly string[], top: number, doorTop: number): string[] {
  if (paint === 'red') return [...rows];
  const map = PAINT[paint];
  return rows.map((row, y) =>
    [...row]
      .map((ch, x) => (y >= top && !(x >= DOOR.x0 && x <= DOOR.x1 && y >= doorTop) ? (map[ch] ?? ch) : ch))
      .join(''),
  );
}

function roofed(roof: Roof, rows: readonly string[], bottom: number): string[] {
  if (roof === 'tile') return [...rows];
  const map = ROOF[roof];
  return rows.map((row, y) => (y < bottom ? [...row].map((ch) => map[ch] ?? ch).join('') : row));
}

/** The dormer window that sits on the loft's roof (its gable takes the roof's colours). */
const DORMER: readonly string[] = [
  '......kk......',
  '.....kRRk.....',
  '....kRRRRk....',
  '...kRRRRRRk...',
  '..kRRRRRRRRk..',
  '.krrrrrrrrrrk.',
  '.kPPPPPPPPPPk.',
  '.kPkkkkkkkkPk.',
  '.kPkccMccckPk.',
  '.kPkccMccckPk.',
  '.kkkkkkkkkkkk.',
];

/** A second storey: the roof and chimney rise one tile, with a copy of the facade's upper rows between, and a dormer on the roof. */
function loftRows(source: readonly string[]): string[] {
  const roof = source.slice(0, WALL_TOP);
  const band = source.slice(WALL_TOP, WALL_TOP + 16).map((row) =>
    // The door is only on the ground floor: plain boards above it.
    [...row].map((ch, x) => (x >= DOOR.x0 && x <= DOOR.x1 ? row[23 + ((x - DOOR.x0) % 6)]! : ch)).join(''),
  );
  const out = [...roof, ...band, ...source.slice(WALL_TOP)].map((r) => [...r]);
  DORMER.forEach((row, j) =>
    [...row].forEach((ch, i) => {
      if (ch !== '.') out[7 + j]![24 + i] = ch;
    }),
  );
  return out.map((r) => r.join(''));
}

function build(paint: Paint, roof: Roof, loft: boolean): string[] {
  const base = loft ? loftRows(SOURCE) : [...SOURCE];
  return walls(paint, roofed(roof, base, WALL_TOP), WALL_TOP, loft ? DOOR.y0 + 16 : DOOR.y0);
}

export function farmhouseSpriteId(paint: DecorId | null, roof: DecorId | null, loft: boolean): string {
  const p: Paint = paint === 'paint_sage' ? 'sage' : paint === 'paint_sky' ? 'sky' : 'red';
  const r: Roof = roof === 'roof_thatch' ? 'thatch' : roof === 'roof_slate' ? 'slate' : 'tile';
  if (p === 'red' && r === 'tile' && !loft) return 'obj_farmhouse';
  return `obj_farmhouse_${p}_${r}${loft ? '_loft' : ''}`;
}

export const FARMHOUSE_SPRITES: readonly SpriteDef[] = (() => {
  const out: SpriteDef[] = [];
  for (const paint of ['red', 'sage', 'sky'] as const)
    for (const roof of ['tile', 'thatch', 'slate'] as const)
      for (const loft of [false, true]) {
        if (paint === 'red' && roof === 'tile' && !loft) continue;
        out.push({
          id: `obj_farmhouse_${paint}_${roof}${loft ? '_loft' : ''}`,
          anchor: 'top-left',
          frames: [build(paint, roof, loft)],
        });
      }
  return out;
})();
