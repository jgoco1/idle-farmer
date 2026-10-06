// Off-screen awareness (GDD §12.1): small arrows on the edge of the scene that point at things that
// want the player but are out of view: ready crops, full traps, a finished dish (and, from later v2
// phases, ripe trees (v2-03), a full animal store and an empty trough (v2-04)). Pure: the UI turns the result into buttons.

import type { Rect } from './camera';
import { TILE } from './scene';

export type PipKind = 'crop' | 'trap' | 'dish' | 'tree' | 'store' | 'trough' | 'menu';

export interface PipTarget {
  kind: PipKind;
  col: number;
  row: number;
}

export type PipSide = 'left' | 'right' | 'top' | 'bottom';

export interface Pip {
  kind: PipKind;
  /** The target tile; clicking the pip pans there. */
  col: number;
  row: number;
  side: PipSide;
  /** Where the pip sits on the view's edge, in world px (inside the view by `inset`). */
  x: number;
  y: number;
  /** Distance from the view's centre to the target, world px. */
  dist: number;
}

export const MAX_PIPS = 4;

/**
 * One pip per kind for the nearest off-screen target of that kind, nearest first, at most MAX_PIPS.
 * A target any part of which is in view gets no pip. `inset` keeps pips off the very edge.
 */
export function edgePips(targets: readonly PipTarget[], view: Rect, inset = 12): Pip[] {
  const cx = view.x + view.w / 2;
  const cy = view.y + view.h / 2;
  const best = new Map<PipKind, PipTarget & { dist: number }>();
  for (const t of targets) {
    const tx = t.col * TILE;
    const ty = t.row * TILE;
    const inView = tx < view.x + view.w && tx + TILE > view.x && ty < view.y + view.h && ty + TILE > view.y;
    if (inView) continue;
    const dist = Math.hypot(tx + TILE / 2 - cx, ty + TILE / 2 - cy);
    const prev = best.get(t.kind);
    if (!prev || dist < prev.dist) best.set(t.kind, { ...t, dist });
  }
  const pips: Pip[] = [];
  for (const t of best.values()) {
    const dx = t.col * TILE + TILE / 2 - cx;
    const dy = t.row * TILE + TILE / 2 - cy;
    const hw = Math.max(1, view.w / 2 - inset);
    const hh = Math.max(1, view.h / 2 - inset);
    // Scale the direction until it touches the inset rectangle.
    const k = Math.min(dx === 0 ? Infinity : hw / Math.abs(dx), dy === 0 ? Infinity : hh / Math.abs(dy));
    const horizontal = Math.abs(dx) * hh >= Math.abs(dy) * hw;
    const side: PipSide = horizontal ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'bottom' : 'top';
    pips.push({ kind: t.kind, col: t.col, row: t.row, side, x: cx + dx * k, y: cy + dy * k, dist: t.dist });
  }
  pips.sort((a, b) => a.dist - b.dist);
  return pips.slice(0, MAX_PIPS);
}
