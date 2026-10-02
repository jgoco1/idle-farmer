// The world camera (GDD §12.1, ART_STYLE.md §6): a centre in world pixels and an integer zoom.
// Pure math, no DOM: world ↔ screen, edge clamping, zoom around a point, the default view, which
// ground chunks are visible, and the pan-versus-click rule for a press. The renderer owns one
// camera and eases it on the render clock; its position lives in prefs, never in the game state.
//
// Units: "screen" is the canvas' backing store in device pixels (so an integer zoom is crisp on every
// display); "world" is logical pixels (a tile is 16).

import { HOME_RECT } from '../data/world';
import { TILE, WORLD_H, WORLD_W } from './scene';

/** A press that moves farther than this (CSS px) becomes a pan and never runs a farm tool. */
export const DRAG_THRESHOLD_PX = 6;
/** The ground is cached in square chunks of this many tiles. */
export const CHUNK_TILES = 16;
export const CHUNK_PX = CHUNK_TILES * TILE;
/** Zoom may go this far above the default view's zoom (and is at least MIN_MAX_ZOOM). */
export const ZOOM_ABOVE_DEFAULT = 2;
export const MIN_MAX_ZOOM = 3;
/** Screens narrower than this (CSS px) use the phone rule: fit the home region's height. */
export const PHONE_MAX_WIDTH = 600;
/** Phones never start below this many CSS px per logical px (a 32 px tile). */
export const PHONE_MIN_CSS_ZOOM = 2;

export interface Camera {
  /** Centre of the view in world pixels. */
  x: number;
  y: number;
  /** Device pixels per logical pixel: an integer ≥ 1. */
  zoom: number;
}

/** The canvas: its size in device pixels, the device pixel ratio and its CSS width (for the phone rule). */
export interface Viewport {
  w: number;
  h: number;
  dpr: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A phone-sized view (by CSS width). */
export function isPhone(view: Viewport): boolean {
  return view.w / view.dpr < PHONE_MAX_WIDTH;
}

/**
 * The default zoom: the largest integer at which the whole home region fits (the v1 scale). On a
 * phone, the largest at which the home region's height fits, and at least 2 CSS px per logical px.
 */
export function defaultZoom(view: Viewport): number {
  const homeW = HOME_RECT.cols * TILE;
  const homeH = HOME_RECT.rows * TILE;
  if (isPhone(view)) {
    return Math.max(1, Math.floor(view.h / homeH), Math.round(PHONE_MIN_CSS_ZOOM * view.dpr));
  }
  return Math.max(1, Math.floor(Math.min(view.w / homeW, view.h / homeH)));
}

/** Zoom limits: 1× up to the default + 2 (at least 3×). */
export function zoomLimits(view: Viewport): { min: number; max: number } {
  return { min: 1, max: Math.max(MIN_MAX_ZOOM, defaultZoom(view) + ZOOM_ABOVE_DEFAULT) };
}

export function clampZoom(zoom: number, view: Viewport): number {
  const { min, max } = zoomLimits(view);
  return Math.min(max, Math.max(min, Math.round(zoom)));
}

/**
 * Keeps the view inside the world. On an axis where the world is smaller than the view, it is
 * centred (the rest is letterboxed in `grass_dark`).
 */
export function clampCamera(cam: Camera, view: Viewport): Camera {
  cam.zoom = clampZoom(cam.zoom, view);
  const halfW = view.w / 2 / cam.zoom;
  const halfH = view.h / 2 / cam.zoom;
  cam.x = WORLD_W <= halfW * 2 ? WORLD_W / 2 : Math.min(WORLD_W - halfW, Math.max(halfW, cam.x));
  cam.y = WORLD_H <= halfH * 2 ? WORLD_H / 2 : Math.min(WORLD_H - halfH, Math.max(halfH, cam.y));
  if (!Number.isFinite(cam.x)) cam.x = WORLD_W / 2;
  if (!Number.isFinite(cam.y)) cam.y = WORLD_H / 2;
  return cam;
}

/**
 * The default view: centred on the home region at the default zoom, clamped. On a phone (v2-05) it centres on
 * `phoneFocus` instead when one is given: the renderer passes the plot grid's centre, so a narrow screen starts on
 * the field rather than between the field and the market.
 */
export function defaultCamera(
  view: Viewport,
  out: Camera = { x: 0, y: 0, zoom: 1 },
  phoneFocus?: { x: number; y: number },
): Camera {
  const focus = phoneFocus && isPhone(view) ? phoneFocus : null;
  out.x = focus ? focus.x : (HOME_RECT.col + HOME_RECT.cols / 2) * TILE;
  out.y = focus ? focus.y : (HOME_RECT.row + HOME_RECT.rows / 2) * TILE;
  out.zoom = defaultZoom(view);
  return clampCamera(out, view);
}

/** World pixel → screen (device) pixel. */
export function worldToScreen(
  cam: Camera,
  view: Viewport,
  wx: number,
  wy: number,
  out: { x: number; y: number } = { x: 0, y: 0 },
): { x: number; y: number } {
  out.x = (wx - cam.x) * cam.zoom + view.w / 2;
  out.y = (wy - cam.y) * cam.zoom + view.h / 2;
  return out;
}

/** Screen (device) pixel → world pixel. */
export function screenToWorld(
  cam: Camera,
  view: Viewport,
  sx: number,
  sy: number,
  out: { x: number; y: number } = { x: 0, y: 0 },
): { x: number; y: number } {
  out.x = (sx - view.w / 2) / cam.zoom + cam.x;
  out.y = (sy - view.h / 2) / cam.zoom + cam.y;
  return out;
}

/** Sets a new zoom while keeping the world point under screen pixel (sx, sy) where it is, then clamps. */
export function zoomAt(cam: Camera, view: Viewport, zoom: number, sx: number, sy: number): Camera {
  const next = clampZoom(zoom, view);
  const wx = (sx - view.w / 2) / cam.zoom + cam.x;
  const wy = (sy - view.h / 2) / cam.zoom + cam.y;
  cam.zoom = next;
  cam.x = wx - (sx - view.w / 2) / next;
  cam.y = wy - (sy - view.h / 2) / next;
  return clampCamera(cam, view);
}

/** Moves the view by a screen (device px) drag, then clamps. */
export function panBy(cam: Camera, view: Viewport, dxScreen: number, dyScreen: number): Camera {
  cam.x -= dxScreen / cam.zoom;
  cam.y -= dyScreen / cam.zoom;
  return clampCamera(cam, view);
}

/** The part of the world the view shows, in world pixels (may reach past the world at 1×). */
export function visibleRect(cam: Camera, view: Viewport, out: Rect = { x: 0, y: 0, w: 0, h: 0 }): Rect {
  out.w = view.w / cam.zoom;
  out.h = view.h / cam.zoom;
  out.x = cam.x - out.w / 2;
  out.y = cam.y - out.h / 2;
  return out;
}

export const CHUNK_COLS = Math.ceil(WORLD_W / CHUNK_PX);
export const CHUNK_ROWS = Math.ceil(WORLD_H / CHUNK_PX);

/**
 * Indexes (row-major, CHUNK_COLS wide) of the ground chunks that overlap `rect`, written into `out`
 * (reused every frame). The renderer draws only these.
 */
export function visibleChunks(rect: Rect, out: number[] = []): number[] {
  const c0 = Math.max(0, Math.floor(rect.x / CHUNK_PX));
  const r0 = Math.max(0, Math.floor(rect.y / CHUNK_PX));
  const c1 = Math.min(CHUNK_COLS - 1, Math.floor((rect.x + rect.w - 1e-6) / CHUNK_PX));
  const r1 = Math.min(CHUNK_ROWS - 1, Math.floor((rect.y + rect.h - 1e-6) / CHUNK_PX));
  // Written by index and trimmed after, so the array's storage is reused (no garbage per frame).
  let n = 0;
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out[n++] = r * CHUNK_COLS + c;
  out.length = n;
  return out;
}

/** Whether a world-pixel box overlaps `rect`. */
export function overlaps(rect: Rect, x: number, y: number, w: number, h: number): boolean {
  return x < rect.x + rect.w && x + w > rect.x && y < rect.y + rect.h && y + h > rect.y;
}

/** Eases `cam` toward `target` (position only) over the frame; returns true once it has arrived. */
export function easeToward(cam: Camera, target: Camera, dtMs: number, instant: boolean): boolean {
  cam.zoom = target.zoom;
  if (instant) {
    cam.x = target.x;
    cam.y = target.y;
    return true;
  }
  const k = 1 - Math.exp(-dtMs / 90);
  cam.x += (target.x - cam.x) * k;
  cam.y += (target.y - cam.y) * k;
  if (Math.abs(target.x - cam.x) < 0.05 && Math.abs(target.y - cam.y) < 0.05) {
    cam.x = target.x;
    cam.y = target.y;
    return true;
  }
  return false;
}

/**
 * Tells a click from a pan. A press starts `pending`; once the pointer has moved more than
 * DRAG_THRESHOLD_PX (CSS px) from where it went down, the gesture is a pan for good, and releasing it
 * runs nothing.
 */
export class PressGesture {
  private startX = 0;
  private startY = 0;
  active = false;
  panning = false;
  /** A second finger or a cancel: the press can no longer be a click. */
  cancelled = false;

  down(x: number, y: number): void {
    this.startX = x;
    this.startY = y;
    this.active = true;
    this.panning = false;
    this.cancelled = false;
  }

  /** Returns true once the press has become a pan. */
  move(x: number, y: number): boolean {
    if (!this.active) return false;
    if (!this.panning && Math.hypot(x - this.startX, y - this.startY) > DRAG_THRESHOLD_PX)
      this.panning = true;
    return this.panning;
  }

  /** Ends the press; true when it was a click (it never became a pan and was not cancelled). */
  up(): boolean {
    const click = this.active && !this.panning && !this.cancelled;
    this.active = false;
    return click;
  }

  cancel(): void {
    this.cancelled = true;
  }
}

/** Sanitised camera prefs → a camera for this view, or null for the default view. */
export function cameraFromPrefs(
  pref: { x: number; y: number; zoom: number } | null,
  view: Viewport,
): Camera | null {
  if (!pref) return null;
  return clampCamera({ x: pref.x, y: pref.y, zoom: pref.zoom }, view);
}
