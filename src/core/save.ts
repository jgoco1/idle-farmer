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

export const SAVE_VERSION = 6;
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
export const migrations: Record<number, Migration> = {
  /**
   * v1 → v2 (phase 02, farming): adds the farm and the inventory with the phase-02 starting values,
   * written out inline so later balance changes never alter old migrations. Phase 01 kept gold at
   * 0, so the farm gets its 60 starting gold.
   */
  1: (old) => {
    const plot = (state: string) => ({ state, crop: null, growthMs: 0, harvests: 0, waterMsLeft: 0 });
    const plots = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => plot(i % 4 < 2 ? 'tilled' : 'untilled'));
    const slots: unknown[] = Array.from({ length: 12 }, () => null);
    slots[0] = { item: 'seed_turnip', qty: 6 };
    return {
      ...old,
      gold: Math.max(typeof old.gold === 'number' ? old.gold : 0, 60),
      farm: { grid: { cols: 4, rows: 2 }, plots, greenhouse: [] },
      inventory: { slots, stackSize: 99 },
    };
  },
  /**
   * v2 → v3 (phase 03, economy): adds the market (every item at demand 1.0, no specials until the
   * next 06:00 refresh, empty sparklines), an empty shipping bin with a full hour to its first
   * pickup, no expansions (phase 02 grids were always 4 × 2), zeroed statistics (so the provisional
   * farm level starts at 1) and no upgrades.
   */
  2: (old) => ({
    ...old,
    market: { items: {}, specials: [] },
    shippingBin: { items: [], msToPickup: 3_600_000 },
    expansions: [],
    stats: { lifetimeGold: 0, goldToday: 0, cropsHarvested: 0, itemsShipped: 0, daysPassed: 0 },
    upgrades: {},
  }),
  /**
   * v3 → v4 (phase 04, automation): nothing placed, every auto-sell toggle at its default, no
   * farmhand timer, and no remembered crops (one empty entry per plot).
   */
  3: (old) => ({
    ...old,
    placed: [],
    autoSell: {},
    automation: { farmhandCooldownMs: 0 },
    lastPlantedCrop: Array.from(
      { length: (old.farm?.plots?.length ?? 0) + (old.farm?.greenhouse?.length ?? 0) },
      () => null,
    ),
  }),
  /**
   * v4 → v5 (phase 05, fishing): no traps, an empty Fish Collection, no cast in progress, no fish
   * caught yet, and Relaxed fishing off. Unlocked locations are derived from `expansions`, so a
   * player who already bought River Access (a no-op purchase before phase 05 refused it) keeps it.
   */
  4: (old) => ({
    ...old,
    settings: { ...old.settings, relaxedFishing: false },
    stats: { ...old.stats, fishCaught: 0 },
    fishing: { traps: [], collection: {}, session: null },
  }),
  /**
   * v5 → v6 (phase 06, cooking): the three starter recipes, an empty stove, no buffs, three buff
   * slots and zeroed dish statistics. Recipes that milestones or the farm level would have given
   * are learned on the first tick, and the Shop lists the cards the player qualifies for.
   */
  5: (old) => ({
    ...old,
    stats: { ...old.stats, dishesCooked: 0, dishesEaten: 0, bestDishTier: 0 },
    kitchen: { known: ['roasted_turnip', 'baked_potato', 'grilled_bluegill'], queue: [] },
    buffs: { active: [], baseSlots: 3 },
  }),
};

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
function isInt(x: unknown): x is number {
  return Number.isInteger(x);
}

const PLOT_STATES = ['untilled', 'tilled', 'planted', 'dead'];

function plotProblem(p: unknown): string | null {
  if (!isObj(p) || typeof p.state !== 'string' || !PLOT_STATES.includes(p.state)) return 'bad plot state';
  if (!isInt(p.growthMs) || !isInt(p.harvests) || !isInt(p.waterMsLeft)) return 'bad plot timers';
  if (p.state === 'planted' ? typeof p.crop !== 'string' : p.crop !== null) return 'bad plot crop';
  return null;
}

function farmProblem(farm: unknown): string | null {
  if (!isObj(farm) || !isObj(farm.grid) || !isInt(farm.grid.cols) || !isInt(farm.grid.rows))
    return 'bad farm';
  if (!Array.isArray(farm.plots) || farm.plots.length !== farm.grid.cols * farm.grid.rows) return 'bad plots';
  if (!Array.isArray(farm.greenhouse)) return 'bad greenhouse';
  for (const p of [...farm.plots, ...farm.greenhouse]) {
    const problem = plotProblem(p);
    if (problem) return problem;
  }
  return null;
}

function inventoryProblem(inv: unknown): string | null {
  if (!isObj(inv) || !Array.isArray(inv.slots) || !isInt(inv.stackSize)) return 'bad inventory';
  for (const s of inv.slots) {
    if (s !== null && stackProblem(s)) return 'bad inventory slot';
  }
  return null;
}

function stackProblem(s: unknown): boolean {
  return !isObj(s) || typeof s.item !== 'string' || !isInt(s.qty) || s.qty <= 0;
}

function economyProblem(s: Record<string, unknown>): string | null {
  const { market, shippingBin, expansions, stats, upgrades } = s;
  if (!isObj(market) || !isObj(market.items) || !Array.isArray(market.specials)) return 'bad market';
  for (const e of Object.values(market.items)) {
    if (!isObj(e) || !isNum(e.demand) || !isInt(e.lastSoldSimMs) || !Array.isArray(e.history))
      return 'bad market item';
    if (!e.history.every(isNum)) return 'bad market item';
  }
  for (const sp of market.specials) {
    if (!isObj(sp) || typeof sp.item !== 'string' || !isNum(sp.bonus)) return 'bad market special';
  }
  if (!isObj(shippingBin) || !Array.isArray(shippingBin.items) || !isInt(shippingBin.msToPickup))
    return 'bad shipping bin';
  if (shippingBin.msToPickup <= 0 || shippingBin.items.some(stackProblem)) return 'bad shipping bin';
  if (!Array.isArray(expansions) || !expansions.every((x) => typeof x === 'string')) return 'bad expansions';
  if (!isObj(stats)) return 'bad stats';
  for (const k of [
    'lifetimeGold',
    'goldToday',
    'cropsHarvested',
    'itemsShipped',
    'daysPassed',
    'fishCaught',
    'dishesCooked',
    'dishesEaten',
    'bestDishTier',
  ]) {
    if (!isInt(stats[k])) return 'bad stats';
  }
  if (!isObj(upgrades) || !Object.values(upgrades).every(isInt)) return 'bad upgrades';
  return null;
}

function automationProblem(s: Record<string, unknown>): string | null {
  const { placed, autoSell, automation, lastPlantedCrop, farm } = s;
  const grid = (farm as { grid: { cols: number; rows: number } }).grid;
  if (!Array.isArray(placed)) return 'bad placed objects';
  const seen = new Set<string>();
  for (const o of placed) {
    if (!isObj(o) || !isInt(o.id) || !['sprinkler', 'scarecrow'].includes(o.kind as string))
      return 'bad placed object';
    const at = o.at;
    if (!isObj(at) || !isInt(at.col) || !isInt(at.row)) return 'bad placed object';
    if (at.col < 0 || at.row < 0 || at.col >= grid.cols || at.row >= grid.rows) return 'bad placed object';
    const key = `${at.col},${at.row}`;
    if (seen.has(key)) return 'bad placed object';
    seen.add(key);
  }
  if (!isObj(autoSell) || !Object.values(autoSell).every((v) => typeof v === 'boolean'))
    return 'bad auto-sell';
  if (!isObj(automation) || !isInt(automation.farmhandCooldownMs) || automation.farmhandCooldownMs < 0)
    return 'bad automation';
  const plots = farm as { plots: unknown[]; greenhouse: unknown[] };
  if (
    !Array.isArray(lastPlantedCrop) ||
    lastPlantedCrop.length !== plots.plots.length + plots.greenhouse.length ||
    !lastPlantedCrop.every((c) => c === null || typeof c === 'string')
  )
    return 'bad planter memory';
  return null;
}

const LOCATIONS = ['pond', 'river', 'ocean'];
const PHASES = ['charging', 'waiting', 'bite', 'reeling'];

function sessionProblem(x: unknown): string | null {
  if (x === null) return null;
  if (!isObj(x) || !LOCATIONS.includes(x.location as string) || !PHASES.includes(x.phase as string))
    return 'bad fishing session';
  if (!isNum(x.power) || !isNum(x.sizeCm) || !isNum(x.waitMs)) return 'bad fishing session';
  if (x.fish !== null && typeof x.fish !== 'string') return 'bad fishing session';
  if (x.phase !== 'charging' && x.phase !== 'waiting' && typeof x.fish !== 'string') {
    return 'bad fishing session';
  }
  if (x.phase === 'reeling') {
    const r = x.reel;
    if (!isObj(r)) return 'bad fishing session';
    for (const k of [
      'marker',
      'zoneCenter',
      'zoneVel',
      'zoneWidth',
      'zoneSpeed',
      'retargetMs',
      'drainPerSec',
      'meter',
    ]) {
      if (!isNum(r[k])) return 'bad fishing session';
    }
  }
  return null;
}

function fishingProblem(s: Record<string, unknown>): string | null {
  const f = s.fishing;
  if (!isObj(f) || !Array.isArray(f.traps) || !isObj(f.collection)) return 'bad fishing';
  const ids = new Set<number>();
  for (const t of f.traps) {
    if (!isObj(t) || !isInt(t.id) || !LOCATIONS.includes(t.location as string) || !isInt(t.slot))
      return 'bad trap';
    if (!isInt(t.progressMs) || t.progressMs < 0 || !Array.isArray(t.contents)) return 'bad trap';
    if (t.contents.some(stackProblem) || ids.has(t.id)) return 'bad trap';
    ids.add(t.id);
  }
  for (const e of Object.values(f.collection)) {
    if (!isObj(e) || typeof e.firstCaughtAt !== 'string' || !isNum(e.bestSizeCm) || !isInt(e.count))
      return 'bad fish collection';
  }
  return sessionProblem(f.session);
}

function cookingProblem(s: Record<string, unknown>): string | null {
  const { kitchen, buffs } = s;
  if (!isObj(kitchen) || !Array.isArray(kitchen.known) || !Array.isArray(kitchen.queue)) return 'bad kitchen';
  if (!kitchen.known.every((r) => typeof r === 'string')) return 'bad kitchen';
  for (const j of kitchen.queue) {
    if (!isObj(j) || typeof j.recipe !== 'string' || !isInt(j.remainingMs) || j.remainingMs < 0)
      return 'bad cook job';
  }
  if (!isObj(buffs) || !Array.isArray(buffs.active) || !isInt(buffs.baseSlots) || buffs.baseSlots < 1)
    return 'bad buffs';
  const types = new Set<string>();
  for (const b of buffs.active) {
    if (!isObj(b) || typeof b.type !== 'string' || typeof b.source !== 'string') return 'bad buff';
    if (!isNum(b.magnitude) || !isInt(b.tier) || !isInt(b.remainingMs) || b.remainingMs <= 0)
      return 'bad buff';
    if (types.has(b.type)) return 'bad buff';
    types.add(b.type);
  }
  return null;
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
  if (!isObj(settings) || !isNum(settings.masterVolume) || typeof settings.relaxedFishing !== 'boolean')
    return 'bad settings';
  if (!isObj(meta) || !isNum(meta.createdAt) || !isNum(meta.lastSavedAt) || !isNum(meta.playTimeMs))
    return 'bad meta';
  if (!Number.isInteger(s.gold) || s.gold < 0) return 'bad gold';
  return (
    farmProblem(s.farm) ??
    inventoryProblem(s.inventory) ??
    economyProblem(s) ??
    automationProblem(s) ??
    fishingProblem(s) ??
    cookingProblem(s)
  );
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
