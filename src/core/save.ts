// Saving, loading, migrations and export/import (docs/DATA_SCHEMAS.md §8).
//
// Migration pattern: `migrations[n]` turns the raw JSON of a version-n save into a version-(n+1)
// save. A migration works on `any` (the old shape), must not import current types for the old
// shape, and gives every new field a sensible default. When GameState changes shape:
//   1. bump SAVE_VERSION,
//   2. add `migrations[SAVE_VERSION - 1] = (old) => ({ ...old, newField: default })`,
//   3. add tests/fixtures/save-v<new>.json and a test migrating save-v<old>.json.

import { createInitialState, cloneState, type GameState } from './state';
import type { LocalClock } from './time';

export const SAVE_VERSION = 1;
export const SAVE_KEY = 'hearthfield-idle/save';
export const AUTOSAVE_MS = 15_000;

export interface SaveFile {
  version: number; // SAVE_VERSION at the time of saving
  savedAt: number; // real epoch ms at save; used for offline progress
  state: GameState;
}

/** migrations[n] turns a version-n save into a version-(n+1) save. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Migration = (old: any) => any;
export const migrations: Record<number, Migration> = {};

export class SaveError extends Error {
  constructor(
    message: string,
    readonly raw: string,
  ) {
    super(message);
    this.name = 'SaveError';
  }
}

/** Applies migrations n, n+1, … until the file reaches `target`. Throws on a newer or unknown version. */
export function migrate(
  file: { version: number; savedAt?: number; state: unknown },
  table: Record<number, Migration> = migrations,
  target: number = SAVE_VERSION,
): SaveFile {
  if (!Number.isInteger(file.version) || file.version < 0) throw new Error('The save has no valid version.');
  if (file.version > target) {
    throw new Error(`This save is from a newer version of the game (v${file.version}, this is v${target}).`);
  }
  let state: unknown = file.state;
  for (let v = file.version; v < target; v++) {
    const m = table[v];
    if (!m) throw new Error(`No migration from save version ${v}.`);
    state = m(state);
  }
  const savedAt = typeof file.savedAt === 'number' ? file.savedAt : 0;
  return { version: target, savedAt, state: state as GameState };
}

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}
function isNum(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

/** Structural check of a current-version state. Returns a reason, or null if it looks valid. */
export function validateState(s: unknown): string | null {
  if (!isObj(s)) return 'state is not an object';
  const { clock, calendar, settings, meta } = s;
  if (!isObj(clock) || !isNum(clock.simMs) || !Number.isInteger(clock.simMs)) return 'bad clock';
  if (
    !isObj(calendar) ||
    !isNum(calendar.createdAt) ||
    !isNum(calendar.seasonEpoch) ||
    !isNum(calendar.maxWeekIndex) ||
    typeof calendar.lastDayKey !== 'string' ||
    !isNum(calendar.debugOffsetMs)
  )
    return 'bad calendar';
  if (!isNum(s.rngState)) return 'bad rngState';
  if (!isNum(s.gold)) return 'bad gold';
  if (!isObj(settings) || !isNum(settings.masterVolume)) return 'bad settings';
  if (!isObj(meta) || !isNum(meta.createdAt) || !isNum(meta.lastSavedAt) || !isNum(meta.playTimeMs))
    return 'bad meta';
  return null;
}

/** Builds the SaveFile for `state` at real time `now`. The debug time warp is never saved. */
export function toSaveFile(state: GameState, now: number): SaveFile {
  const copy = cloneState(state);
  copy.clock.speed = 1;
  copy.meta.lastSavedAt = now;
  return { version: SAVE_VERSION, savedAt: now, state: copy };
}

/** Parses save JSON, migrates it and validates it. Throws SaveError (keeping the raw text) on failure. */
export function parseSave(raw: string): SaveFile {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new SaveError('The save could not be read (it is not valid JSON).', raw);
  }
  if (!isObj(json) || !('state' in json)) throw new SaveError('The save is missing its game state.', raw);
  let file: SaveFile;
  try {
    file = migrate(json as { version: number; savedAt?: number; state: unknown });
  } catch (e) {
    throw new SaveError((e as Error).message, raw);
  }
  const problem = validateState(file.state);
  if (problem) throw new SaveError(`The save is damaged (${problem}).`, raw);
  file.state.clock.speed = 1;
  return file;
}

// ---- export / import as base64 (UTF-8 safe)

export function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function decodeBase64(b64: string): string {
  const bin = atob(b64.replace(/\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function exportSave(file: SaveFile): string {
  return encodeBase64(JSON.stringify(file));
}

/** Decodes an exported string. Throws SaveError on anything that is not a valid save. */
export function importSave(b64: string): SaveFile {
  let raw: string;
  try {
    raw = decodeBase64(b64.trim());
  } catch {
    throw new SaveError('That text is not an exported save.', b64);
  }
  return parseSave(raw);
}

// ---- storage

/** The subset of `Storage` the save code needs, so tests can pass a fake. */
export type SaveStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type LoadResult =
  | { kind: 'new'; file: SaveFile }
  | { kind: 'loaded'; file: SaveFile }
  | { kind: 'error'; message: string; raw: string };

/** Loads the save, or creates a new game when there is none. A broken save is reported, never replaced. */
export function loadGame(storage: SaveStorage, now: number, lc: LocalClock): LoadResult {
  let raw: string | null;
  try {
    raw = storage.getItem(SAVE_KEY);
  } catch (e) {
    return { kind: 'error', message: `Saves are unavailable: ${(e as Error).message}`, raw: '' };
  }
  if (raw === null) {
    const state = createInitialState(now, lc);
    return { kind: 'new', file: { version: SAVE_VERSION, savedAt: now, state } };
  }
  try {
    return { kind: 'loaded', file: parseSave(raw) };
  } catch (e) {
    const err = e as SaveError;
    return { kind: 'error', message: err.message, raw };
  }
}

export function writeSave(storage: SaveStorage, file: SaveFile): void {
  storage.setItem(SAVE_KEY, JSON.stringify(file));
}

export function clearSave(storage: SaveStorage): void {
  storage.removeItem(SAVE_KEY);
}
