// Rasterises sprite definitions once, at 1×, to canvases and caches them (ART_STYLE.md §3).
// Frames animate on the render clock only, never on simulated time.

import { colorOfKey, isPaletteKey, TRANSPARENT } from './palette';
import { spriteDef, type SpriteDef } from './sprites';

const cache = new Map<string, HTMLCanvasElement[]>();

function rasterizeFrame(rows: readonly string[]): HTMLCanvasElement {
  const h = rows.length;
  const w = rows[0]?.length ?? 0;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  for (let y = 0; y < h; y++) {
    const row = rows[y] ?? '';
    for (let x = 0; x < w; x++) {
      const ch = row[x] ?? TRANSPARENT;
      if (ch === TRANSPARENT || !isPaletteKey(ch)) continue;
      ctx.fillStyle = colorOfKey(ch);
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return canvas;
}

export function frames(def: SpriteDef): HTMLCanvasElement[] {
  let f = cache.get(def.id);
  if (!f) {
    f = def.frames.map(rasterizeFrame);
    cache.set(def.id, f);
  }
  return f;
}

/** The frame of sprite `id` to show at render time `timeMs`. */
export function spriteFrame(id: string, timeMs = 0): HTMLCanvasElement {
  const def = spriteDef(id);
  const f = frames(def);
  const i = def.frameMs && f.length > 1 ? Math.floor(timeMs / def.frameMs) % f.length : 0;
  const frame = f[i] ?? f[0];
  if (!frame) throw new Error(`Sprite '${id}' has no frames`);
  return frame;
}

/** Top-left draw position for a sprite placed on tile (col, row), honouring its anchor. */
export function anchoredPosition(
  def: SpriteDef,
  col: number,
  row: number,
  tile = 16,
  out: { x: number; y: number } = { x: 0, y: 0 },
): { x: number; y: number } {
  const w = def.frames[0]?.[0]?.length ?? tile;
  const h = def.frames[0]?.length ?? tile;
  if (def.anchor === 'bottom-center') {
    out.x = col * tile + Math.floor(tile / 2) - Math.floor(w / 2);
    out.y = (row + 1) * tile - h;
  } else {
    out.x = col * tile;
    out.y = row * tile;
  }
  return out;
}

const urlCache = new Map<string, string>();

/** A data URL of the sprite at an integer scale, for DOM icons (shown with the .pixel CSS rule). */
export function spriteDataUrl(id: string, scale = 2): string {
  const key = `${id}@${scale}`;
  let url = urlCache.get(key);
  if (!url) {
    const src = spriteFrame(id);
    const c = document.createElement('canvas');
    c.width = src.width * scale;
    c.height = src.height * scale;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, 0, 0, c.width, c.height);
    url = c.toDataURL();
    urlCache.set(key, url);
  }
  return url;
}
