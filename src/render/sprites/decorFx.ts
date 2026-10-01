// Night lighting and the town's festive bits (ART_STYLE.md §6.5): the soft halos drawn over lit lamps, windows
// and the lighthouse after the night tint, the little band on the bandstand, and the festival lights strung
// across the square. Halos are `lamp_glow` (`a`) pixels in a dithered round pattern, drawn with the `lighter`
// composite, so they never touch the cached scene.

import { Pix } from './draw';
import type { SpriteDef } from './types';

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** A round halo: dense in the middle, sparse at the edge, dithered. */
function halo(size: number): string[] {
  const p = new Pix(size, size);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c) / (size / 2);
      if (d >= 1) continue;
      const density = (1 - d) ** 1.4 * 1.15;
      if (density > BAYER[(y % 4) * 4 + (x % 4)]! / 16 + 0.04) p.set(x, y, 'a');
    }
  return p.rows();
}

/** Four little musicians on the bandstand's platform, bobbing in two frames. */
function band(frame: number): string[] {
  const p = new Pix(32, 16);
  const coats = ['q', 'j', 'v', 'o'];
  coats.forEach((coat, i) => {
    const x = 3 + i * 7;
    const bob = (i + frame) % 2;
    const y = 6 + bob;
    p.rect(x, y + 3, 4, 5 - bob, coat)
      .hline(x, y + 3, 4, 'w')
      .set(x, y + 3, coat);
    p.rect(x + 1, y, 2, 3, 'I')
      .set(x + 1, y, i % 2 ? 'm' : 'M')
      .set(x + 2, y, i % 2 ? 'm' : 'M');
    // an instrument held in front: a fiddle, a horn, a drum, a flute
    if (i === 0) p.line(x + 3, y + 4, x + 6, y + 6, 'p');
    if (i === 1) p.rect(x + 4, y + 3, 2, 2, 'f').set(x + 6, y + 2, 'F');
    if (i === 2) p.rect(x, y + 6, 4, 2, 'P').hline(x, y + 6, 4, 'w');
    if (i === 3) p.hline(x + 3, y + 3, 4, 'x');
  });
  return p.outlinedRows();
}

/** A tall pole with a bracket for the festival lights. */
const LIGHTS_POLE: string[] = (() => {
  const p = new Pix(16, 32);
  p.rect(7, 4, 3, 26, 'M').vline(7, 4, 26, 'p');
  p.hline(5, 4, 7, 'M').set(5, 3, 'p').set(11, 3, 'p');
  p.rect(5, 28, 7, 2, 'm');
  const q = new Pix(16, 32).paste(p.outlinedRows(), 0, 0);
  for (let x = 4; x <= 12; x++) if (q.get(x, 31) === '.') q.set(x, 31, 'K');
  return q.rows();
})();

/** A tile of festival lights: a drooping string with five bulbs. */
const LIGHTS_STRING: string[] = (() => {
  const p = new Pix(16, 16);
  const colours = ['q', 'u', 'j', 'i', 'o'];
  for (let x = 0; x < 16; x++) p.set(x, 2 + Math.round(3 * Math.sin((Math.PI * x) / 15)), 'm');
  [1, 4, 7, 10, 13].forEach((x, i) => {
    const y = 3 + Math.round(3 * Math.sin((Math.PI * x) / 15));
    p.rect(x, y + 1, 2, 3, colours[i]!).set(x, y + 1, 'U');
  });
  return p.rows();
})();

export const FX_SPRITES: readonly SpriteDef[] = [
  { id: 'fx_glow_small', frames: [halo(16)] },
  { id: 'fx_glow_large', frames: [halo(32)] },
  { id: 'fx_band', anchor: 'top-left', frameMs: 420, frames: [band(0), band(1)] },
  { id: 'obj_lights_pole', anchor: 'bottom-center', frames: [LIGHTS_POLE] },
  { id: 'obj_lights_string', anchor: 'top-left', frames: [LIGHTS_STRING] },
];
