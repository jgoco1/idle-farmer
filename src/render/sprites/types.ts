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
