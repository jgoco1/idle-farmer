// Player preferences that belong to the browser, not the farm: volumes, motion, UI scale, number
// format and (v2) the camera. Stored under their own key so they survive a hard reset and never touch SAVE_VERSION.

import type { SaveStorage } from './save';

export const PREFS_KEY = 'hearthfield-idle/prefs';

export type UiScale = 1 | 1.5 | 2;
export type NumberFormat = 'full' | 'short';
/** `auto` follows the `prefers-reduced-motion` media query. */
export type MotionPref = 'auto' | 'reduce' | 'full';
export type TutorialStatus = 'pending' | 'done' | 'skipped';

export interface Prefs {
  master: number; // 0..1
  sfx: number;
  music: number;
  muted: boolean;
  motion: MotionPref;
  uiScale: UiScale;
  numberFormat: NumberFormat;
  tutorial: TutorialStatus;
  /** The world camera: centre in world px and an integer zoom; null = the default view (v2 phase 01). */
  camera: CameraPref | null;
}

export interface CameraPref {
  x: number;
  y: number;
  zoom: number;
}

/** The highest zoom kept (device pixels per logical pixel; a 3× phone at its default + 2 fits). */
export const MAX_CAMERA_ZOOM = 16;

export const DEFAULT_PREFS: Prefs = {
  master: 0.8,
  sfx: 0.8,
  music: 0.35, // quiet by default
  muted: false,
  motion: 'auto',
  uiScale: 1,
  numberFormat: 'full',
  tutorial: 'pending',
  camera: null,
};

function sanitizeCamera(raw: unknown): CameraPref | null {
  if (!raw || typeof raw !== 'object') return null;
  const { x, y, zoom } = raw as Record<string, unknown>;
  if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y))
    return null;
  if (typeof zoom !== 'number' || !Number.isInteger(zoom) || zoom < 1 || zoom > MAX_CAMERA_ZOOM) return null;
  return { x, y, zoom };
}

const clamp01 = (n: unknown, fallback: number): number =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;

/** Accepts anything (a stale or hand-edited value) and returns valid prefs. */
export function sanitizePrefs(raw: unknown): Prefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_PREFS;
  return {
    master: clamp01(r.master, d.master),
    sfx: clamp01(r.sfx, d.sfx),
    music: clamp01(r.music, d.music),
    muted: typeof r.muted === 'boolean' ? r.muted : d.muted,
    motion: r.motion === 'reduce' || r.motion === 'full' || r.motion === 'auto' ? r.motion : d.motion,
    uiScale: r.uiScale === 1.5 || r.uiScale === 2 || r.uiScale === 1 ? r.uiScale : d.uiScale,
    numberFormat: r.numberFormat === 'short' || r.numberFormat === 'full' ? r.numberFormat : d.numberFormat,
    tutorial:
      r.tutorial === 'done' || r.tutorial === 'skipped' || r.tutorial === 'pending' ? r.tutorial : d.tutorial,
    camera: sanitizeCamera(r.camera),
  };
}

export function loadPrefs(storage: SaveStorage): Prefs {
  try {
    const text = storage.getItem(PREFS_KEY);
    return sanitizePrefs(text ? JSON.parse(text) : null);
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(storage: SaveStorage, prefs: Prefs): void {
  try {
    storage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Storage full or blocked: preferences are a convenience, never an error.
  }
}

/** Live preferences with change notification. Tests build one over an in-memory storage. */
export class PrefsStore {
  private readonly listeners = new Set<(p: Prefs) => void>();
  private current: Prefs;

  constructor(private readonly storage: SaveStorage) {
    this.current = loadPrefs(storage);
  }

  get value(): Prefs {
    return this.current;
  }

  set<K extends keyof Prefs>(key: K, value: Prefs[K]): void {
    this.current = sanitizePrefs({ ...this.current, [key]: value });
    savePrefs(this.storage, this.current);
    this.listeners.forEach((fn) => fn(this.current));
  }

  onChange(fn: (p: Prefs) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

/** True when animation and particles should be skipped. */
export function reducedMotion(prefs: Pick<Prefs, 'motion'>, systemPrefersReduced: boolean): boolean {
  return prefs.motion === 'reduce' || (prefs.motion === 'auto' && systemPrefersReduced);
}

/** 1234 → "1,234"; short: 1.2K, 3.4M, 5.6B. Used for gold and big counts. */
export function formatNumber(n: number, mode: NumberFormat): string {
  const v = Math.round(n);
  if (mode === 'full' || Math.abs(v) < 1000) return v.toLocaleString('en-US');
  const units: [number, string][] = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ];
  for (const [size, suffix] of units) {
    if (Math.abs(v) >= size) {
      const x = v / size;
      const text = x >= 100 ? x.toFixed(0) : x.toFixed(1).replace(/\.0$/, '');
      return `${text}${suffix}`;
    }
  }
  return String(v);
}
