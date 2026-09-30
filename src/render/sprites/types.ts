export interface SpriteDef {
  id: string; // 'crop_turnip_4', 'tile_grass_a', 'item_turnip'
  frames: readonly (readonly string[])[]; // one or more frames of equal size
  frameMs?: number; // animation speed; omit for static sprites
  anchor?: 'top-left' | 'bottom-center'; // bottom-center for crops, trees, buildings
}

/** Rotates every frame of a sprite 90° clockwise `turns` times (used for pond edges and corners). */
export function rotateSprite(def: SpriteDef, id: string, turns: 1 | 2 | 3): SpriteDef {
  const rot = (rows: readonly string[]): string[] => {
    const h = rows.length;
    const w = rows[0]?.length ?? 0;
    const out: string[] = [];
    for (let x = 0; x < w; x++) {
      let line = '';
      for (let y = h - 1; y >= 0; y--) line += rows[y]?.[x] ?? '.';
      out.push(line);
    }
    return out;
  };
  const frames = def.frames.map((f) => {
    let rows: readonly string[] = f;
    for (let i = 0; i < turns; i++) rows = rot(rows);
    return rows;
  });
  return { ...def, id, frames };
}

const CLEAR = '.';
const OUTLINE = 'k';

/**
 * Adds a 1 px `outline` ring around every non-outline pixel that touches transparency
 * (4-neighbours), so sprites can be authored as fills. Existing `k` pixels are left as they are.
 */
export function outlined(rows: readonly string[]): string[] {
  const h = rows.length;
  const w = rows[0]?.length ?? 0;
  const at = (x: number, y: number): string => (x < 0 || y < 0 || x >= w || y >= h ? CLEAR : rows[y]![x]!);
  return rows.map((row, y) =>
    [...row]
      .map((ch, x) => {
        if (ch !== CLEAR) return ch;
        const near = [at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)];
        return near.some((n) => n !== CLEAR && n !== OUTLINE) ? OUTLINE : CLEAR;
      })
      .join(''),
  );
}

/** Swaps palette keys (e.g. ripe red → unripe green). */
export function recolored(rows: readonly string[], map: Readonly<Record<string, string>>): string[] {
  return rows.map((row) => [...row].map((ch) => map[ch] ?? ch).join(''));
}

/** Moves every pixel by (dx, dy); pixels pushed off the edge are dropped. */
export function shifted(rows: readonly string[], dx: number, dy: number): string[] {
  const h = rows.length;
  const w = rows[0]?.length ?? 0;
  return Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => rows[y - dy]?.[x - dx] ?? CLEAR).join(''),
  );
}

/**
 * A second frame with a small `white_warm` twinkle in the first free spot near the top corners
 * (or anywhere free, top rows first),
 * used for the ready-crop sparkle (ART_STYLE.md §2: 2 frames, 400 ms).
 */
export function sparkled(rows: readonly string[]): string[] {
  const out = rows.map((r) => [...r]);
  const free = (x: number, y: number): boolean => out[y]?.[x] === CLEAR;
  const preferred: [number, number][] = [
    [13, 2],
    [2, 2],
    [13, 4],
    [2, 4],
    [12, 1],
    [3, 1],
  ];
  // Then any free spot, top rows first.
  const h = out.length;
  const w = out[0]?.length ?? 0;
  const scan: [number, number][] = [];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) scan.push([x, y]);
  for (const [x, y] of [...preferred, ...scan]) {
    const plus: [number, number][] = [
      [x, y],
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ];
    if (plus.every(([px, py]) => free(px, py))) {
      out[y]![x] = 'w';
      out[y]![x - 1] = 'U';
      out[y]![x + 1] = 'U';
      out[y - 1]![x] = 'U';
      out[y + 1]![x] = 'U';
      break;
    }
  }
  return out.map((r) => r.join(''));
}
