// Where and how placed decorations are drawn (ART_STYLE.md §6): pure, so it is unit-tested. The renderer
// rebuilds the draw list only when the placed pieces change (`decorKey`), then walks it each frame, culled
// to the view and merged by depth with the scene's objects, allocating nothing.

import type { PlacedDecor } from '../core/state';
import type { DecorDef } from '../data/types';
import type { DecorId, SeasonId, TownProjectId } from '../data/ids';
import { autotileMask } from '../systems/decor';
import { spriteDef } from './sprites';

export const TILE = 16;
export const SEASON_INDEX: Readonly<Record<SeasonId, number>> = {
  spring: 0,
  summer: 1,
  autumn: 2,
  winter: 3,
};
const SEASON_NAMES: readonly SeasonId[] = ['spring', 'summer', 'autumn', 'winter'];

/** A halo centre relative to the sprite's top-left, and which halo to use. */
export interface GlowPoint {
  dx: number;
  dy: number;
  large: boolean;
}

/** Where each glowing piece's lights are (the lamp's head, the lantern string's two ends). */
const PIECE_GLOWS: Readonly<Partial<Record<DecorId, readonly GlowPoint[]>>> = {
  garden_lamp: [{ dx: 8, dy: 8, large: false }],
  harbour_lamp: [{ dx: 8, dy: 8, large: false }],
  lantern_string: [
    { dx: 10, dy: 18, large: false },
    { dx: 20, dy: 18, large: false },
  ],
};

/** One piece ready to draw. */
export interface DecorDraw {
  /** Sprite id for each season (spring, summer, autumn, winter). */
  sprites: [string, string, string, string];
  x: number;
  y: number;
  w: number;
  h: number;
  /** y + h: pieces are drawn in order of this, like the layout's objects. */
  bottom: number;
  flipped: boolean;
  glows: boolean;
  glowPoints: readonly GlowPoint[];
  windmill: boolean;
}

const NO_GLOW: readonly GlowPoint[] = [];

function resolve(def: DecorDef, mask: number, season: SeasonId): string {
  if (def.autotile) return `${def.sprite}_${mask}`;
  if (def.seasonal) {
    const id = `${def.sprite}_${season}`;
    try {
      spriteDef(id);
      return id;
    } catch {
      return def.sprite;
    }
  }
  return def.sprite;
}

/** Top-left of a piece's sprite: centred on its footprint, with its bottom on the footprint's bottom edge. */
export function decorPosition(
  def: DecorDef,
  col: number,
  row: number,
  w: number,
  h: number,
): { x: number; y: number } {
  if (def.autotile) return { x: col * TILE, y: row * TILE };
  return { x: col * TILE + Math.round((def.size.cols * TILE - w) / 2), y: (row + def.size.rows) * TILE - h };
}

/** Rebuilds the draw list, sorted by bottom edge. */
export function buildDecorDraws(
  placed: readonly PlacedDecor[],
  defs: Readonly<Record<DecorId, DecorDef>>,
): DecorDraw[] {
  const out: DecorDraw[] = [];
  for (const p of placed) {
    const def = defs[p.decor];
    if (!def || def.kind !== 'place') continue;
    const mask = def.autotile ? autotileMask(placed, p.decor, p.at.col, p.at.row) : 0;
    const sprites = SEASON_NAMES.map((s) => resolve(def, mask, s)) as DecorDraw['sprites'];
    const f = spriteDef(sprites[1]).frames[0]!;
    const w = f[0]!.length;
    const h = f.length;
    const pos = decorPosition(def, p.at.col, p.at.row, w, h);
    out.push({
      sprites,
      x: pos.x,
      y: pos.y,
      w,
      h,
      bottom: (p.at.row + def.size.rows) * TILE,
      flipped: p.flipped === true,
      glows: def.glows === true,
      glowPoints: PIECE_GLOWS[p.decor] ?? NO_GLOW,
      windmill: p.decor === 'windmill',
    });
  }
  out.sort((a, b) => a.bottom - b.bottom || a.x - b.x);
  return out;
}

/** A number that changes when any placed piece is added, removed or moved (no allocation). */
export function decorKey(placed: readonly PlacedDecor[]): number {
  let k = placed.length;
  for (let i = 0; i < placed.length; i++) {
    const p = placed[i]!;
    k =
      (Math.imul(k, 31) + p.id * 7 + p.at.col * 131 + p.at.row * 17 + (p.flipped ? 1 : 0) + p.decor.length) |
      0;
  }
  return k;
}

/** Lit from dusk to dawn: 18:30 to 07:30 (ART_STYLE.md §6.5). */
export function isLitTime(hour: number, minute: number): boolean {
  const h = hour + minute / 60;
  return h >= 18.5 || h < 7.5;
}

/** How strongly halos show: 0 by day, a gentle start at dusk, full at midnight. */
export function glowStrength(night: number, dusk: number): number {
  if (night > 0) return Math.min(1, 0.35 + (0.65 * night) / 0.55);
  return Math.min(0.35, (dusk / 0.25) * 0.35);
}

// ---- the town's lights, by project and stage (halo centres relative to the building's top-left)

const TOWN_GLOWS: Readonly<Partial<Record<TownProjectId, Readonly<Record<number, readonly GlowPoint[]>>>>> = {
  old_bridge: {
    3: [
      { dx: 4, dy: 3, large: false },
      { dx: 39, dy: 3, large: false },
      { dx: 75, dy: 3, large: false },
    ],
  },
  bakery: {
    3: [
      { dx: 11, dy: 42, large: false },
      { dx: 37, dy: 42, large: false },
    ],
  },
  bandstand: {
    3: [
      { dx: 12, dy: 24, large: false },
      { dx: 36, dy: 24, large: false },
    ],
  },
  lighthouse: { 3: [{ dx: 16, dy: 7, large: true }] },
  community_hall: {
    4: [
      { dx: 12, dy: 38, large: false },
      { dx: 49, dy: 38, large: false },
      { dx: 32, dy: 33, large: true },
    ],
  },
};

export function townGlows(project: TownProjectId, stage: number): readonly GlowPoint[] {
  return TOWN_GLOWS[project]?.[stage] ?? NO_GLOW;
}
