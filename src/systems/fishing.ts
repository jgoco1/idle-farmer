// Fishing (GDD §6.4, BALANCE.md §6): the catch table, the active cast-and-reel minigame, and the
// Fish Collection log. Everything here is a deterministic function of (state, ctx, input, dt): the
// panel only renders and forwards input. The minigame runs in *real* time (the UI passes the frame
// time), while the rest of the game keeps ticking; a session is saved with the game, so closing the
// tab mid-cast is safe. Traps (idle fishing) are in traps.ts and share `chooseCatch` / `landCatch`.

import type { FishingSession, GameState, ReelState } from '../core/state';
import type { Rng } from '../core/rng';
import type { GameData } from '../data';
import {
  BITE_WAIT_MAX_MS,
  BITE_WAIT_MIN_MS,
  BITE_WINDOW_MS,
  CAST_CHARGE_MS,
  CAST_POWER_BONUS,
  CAST_POWER_GOOD,
  JUNK_WEIGHT,
  LUCK_SCALE,
  LUCK_WEIGHT_FLOOR,
  RARITY_WEIGHT,
  REEL,
  SIZE_EXPONENT,
} from '../data/balance';
import {
  FISH_IDS,
  JUNK_IDS,
  type FishId,
  type FishLocationId,
  type JunkId,
  type SeasonId,
} from '../data/ids';
import type { HourWindow } from '../data/types';
import { fail, OK, type ActionResult, type SimContext } from './context';
import { addToBin } from './shippingBin';
import { stowHarvest } from './autoSeller';
import { isLocationUnlocked } from './locations';
import { effectOf } from './upgrades';

// ---- the catch table

export type CatchMode = 'active' | 'trap';

export interface CatchOption {
  id: FishId | JunkId;
  weight: number;
}

export interface CatchQuery {
  location: FishLocationId;
  season: SeasonId;
  /** Local time of day as hours 0..24 (e.g. 17.5 = 17:30). Ignored by traps. */
  hour: number;
  mode: CatchMode;
  /** `mods.fishingLuckModifier`. */
  luck: number;
  /** Active fishing only: 0..1, a good cast gives uncommon-and-better fish a small bonus. */
  castPower?: number;
}

/** Whether local hour `hour` (0..24) is inside `w`; a window with start > end wraps past midnight. */
export function inHourWindow(hour: number, w: HourWindow): boolean {
  if (w.start === w.end) return false;
  if (w.start < w.end) return hour >= w.start && hour < w.end;
  return hour >= w.start || hour < w.end;
}

export function rarityWeight(rarity: keyof typeof RARITY_WEIGHT, luck: number, goodCast: boolean): number {
  const w = RARITY_WEIGHT[rarity] * Math.max(LUCK_WEIGHT_FLOOR, 1 + luck * LUCK_SCALE[rarity]);
  return goodCast && rarity !== 'common' ? w * CAST_POWER_BONUS : w;
}

/**
 * Everything that can bite or land in a trap here and now, with its weight. Active fishing: fish at
 * the location, in season and inside their hours window. Traps: trappable fish in season, any hour.
 * Junk at the location joins either way.
 */
export function catchTable(data: GameData, q: CatchQuery): CatchOption[] {
  const goodCast = q.mode === 'active' && (q.castPower ?? 0) >= CAST_POWER_GOOD;
  const out: CatchOption[] = [];
  for (const id of FISH_IDS) {
    const f = data.fish[id];
    if (f.location !== q.location || !f.seasons.includes(q.season)) continue;
    if (q.mode === 'trap' ? !f.trappable : !inHourWindow(q.hour, f.hours)) continue;
    out.push({ id, weight: rarityWeight(f.rarity, q.luck, goodCast) });
  }
  for (const id of JUNK_IDS) {
    if (data.junk[id].locations.includes(q.location)) out.push({ id, weight: JUNK_WEIGHT[q.mode] });
  }
  return out;
}

/** One weighted draw (one RNG value). */
export function pickWeighted<T extends { weight: number }>(rng: Rng, options: readonly T[]): T {
  const total = options.reduce((n, o) => n + o.weight, 0);
  let r = rng.next() * total;
  for (const o of options) {
    r -= o.weight;
    if (r < 0) return o;
  }
  return options[options.length - 1]!;
}

/** min + (max − min) · u^1.5, so big ones are rarer. Junk has no size (0). */
export function rollSize(rng: Rng, data: GameData, id: FishId | JunkId): number {
  const f = (data.fish as Partial<Record<string, { sizeCm: { min: number; max: number } }>>)[id];
  if (!f) return 0;
  const { min, max } = f.sizeCm;
  return Math.round((min + (max - min) * rng.next() ** SIZE_EXPONENT) * 10) / 10;
}

export function localHour(ctx: Pick<SimContext, 'calendar'>): number {
  return ctx.calendar.hour + ctx.calendar.minute / 60;
}

/** Draws what bites (active) at `location` right now. */
export function chooseCatch(
  state: GameState,
  ctx: SimContext,
  location: FishLocationId,
  mode: CatchMode,
  castPower = 0,
): { id: FishId | JunkId; sizeCm: number } {
  void state;
  const table = catchTable(ctx.data, {
    location,
    season: ctx.calendar.season,
    hour: localHour(ctx),
    mode,
    luck: ctx.mods.fishingLuckModifier,
    castPower,
  });
  const id = pickWeighted(ctx.rng, table).id;
  return { id, sizeCm: rollSize(ctx.rng, ctx.data, id) };
}

// ---- landing a catch

/** Notes a fish in the Fish Collection: first-catch day, biggest size and how many. */
export function recordCollection(state: GameState, ctx: SimContext, id: FishId, sizeCm: number): boolean {
  const log = state.fishing.collection;
  const known = log[id];
  if (known) {
    known.count += 1;
    known.bestSizeCm = Math.max(known.bestSizeCm, sizeCm);
    return false;
  }
  log[id] = { firstCaughtAt: ctx.calendar.dayKey, bestSizeCm: sizeCm, count: 1 };
  return true;
}

/** A trap roll or a reeled-in fish: the collection, the count and the `caught` event. */
export function recordCatch(
  state: GameState,
  ctx: SimContext,
  id: FishId | JunkId,
  sizeCm: number,
  location: FishLocationId,
  viaTrap: boolean,
): void {
  if (id in ctx.data.fish) {
    recordCollection(state, ctx, id as FishId, sizeCm);
    state.stats.fishCaught += 1;
  }
  ctx.events.push({ type: 'caught', catch: id, sizeCm, location, viaTrap });
}

/**
 * The player's catch goes in the bag (or the Shipping Bin if the Auto-Seller ships fish). A full
 * bag never loses a fish: it goes into the bin instead.
 */
function stowCatch(state: GameState, ctx: SimContext, id: FishId | JunkId): void {
  if (stowHarvest(state, ctx.data, id, 1) !== null) return;
  addToBin(state, id, 1);
  ctx.events.push({ type: 'inventoryFull', item: id });
}

/** Records a caught fish and puts it in the bag. Also the pacing simulation's "N catches per minute". */
export function landCatch(
  state: GameState,
  ctx: SimContext,
  id: FishId | JunkId,
  sizeCm: number,
  location: FishLocationId,
): void {
  recordCatch(state, ctx, id, sizeCm, location, false);
  stowCatch(state, ctx, id);
}

// ---- the reel minigame (pure physics)

export interface ReelParams {
  zoneWidth: number;
  zoneSpeed: number;
  drainPerSec: number;
}

/** BALANCE.md §6: the zone shrinks and speeds up with difficulty; the rod widens it; Relaxed eases all three. */
export function reelParams(difficulty: number, rodZoneMult: number, relaxed: boolean): ReelParams {
  const d = difficulty / 100;
  return {
    zoneWidth:
      (REEL.zoneWidthBase - REEL.zoneWidthPerDifficulty * d) *
      rodZoneMult *
      (relaxed ? REEL.relaxedWidthMult : 1),
    zoneSpeed: (REEL.zoneSpeedBase + REEL.zoneSpeedPerDifficulty * d) * (relaxed ? REEL.relaxedSpeedMult : 1),
    drainPerSec: relaxed ? REEL.relaxedDrainPerSec : REEL.drainPerSec,
  };
}

export function difficultyOf(data: GameData, id: FishId | JunkId): number {
  return (data.fish as Partial<Record<string, { difficulty: number }>>)[id]?.difficulty ?? 10;
}

function retarget(reel: ReelState, rng: Rng): void {
  const towardMiddle = reel.zoneCenter < 0.5 ? 1 : -1;
  const dir = rng.chance(0.65) ? towardMiddle : -towardMiddle;
  reel.zoneVel = dir * reel.zoneSpeed * (0.5 + 0.5 * rng.next());
  reel.retargetMs = rng.int(REEL.retargetMinMs, REEL.retargetMaxMs);
}

/** Whether the marker is inside the sweet zone. */
export function markerInZone(reel: ReelState): boolean {
  return Math.abs(reel.marker - reel.zoneCenter) <= reel.zoneWidth / 2;
}

/** Advances the reel by one short slice. Returns true when the meter is full (caught) or empty (escaped). */
function stepReel(reel: ReelState, rng: Rng, holding: boolean, ms: number): 'caught' | 'escaped' | null {
  const dt = ms / 1000;
  reel.marker = Math.min(
    1,
    Math.max(0, reel.marker + (holding ? REEL.markerUpPerSec : -REEL.markerDownPerSec) * dt),
  );
  reel.retargetMs -= ms;
  if (reel.retargetMs <= 0) retarget(reel, rng);
  const half = reel.zoneWidth / 2;
  reel.zoneCenter += reel.zoneVel * dt;
  if (reel.zoneCenter < half) {
    reel.zoneCenter = half;
    reel.zoneVel = Math.abs(reel.zoneVel);
  } else if (reel.zoneCenter > 1 - half) {
    reel.zoneCenter = 1 - half;
    reel.zoneVel = -Math.abs(reel.zoneVel);
  }
  reel.meter += (markerInZone(reel) ? REEL.fillPerSec : -reel.drainPerSec) * dt;
  if (reel.meter >= 1) {
    reel.meter = 1;
    return 'caught';
  }
  if (reel.meter <= 0) {
    reel.meter = 0;
    return 'escaped';
  }
  return null;
}

/** The starting reel for a fish: zone in the middle, meter at 30%. */
export function startReel(
  state: GameState,
  ctx: Pick<SimContext, 'data' | 'rng' | 'mods'>,
  id: FishId | JunkId,
): ReelState {
  const rod = effectOf(state, ctx.data, 'fishing_rod');
  const p = reelParams(
    difficultyOf(ctx.data, id),
    (rod?.reelZoneMult ?? 1) * (1 + ctx.mods.reelZoneBonus),
    state.settings.relaxedFishing,
  );
  const reel: ReelState = {
    marker: 0.5,
    zoneCenter: 0.5,
    zoneVel: 0,
    zoneWidth: Math.min(1, p.zoneWidth),
    zoneSpeed: p.zoneSpeed,
    retargetMs: 0,
    drainPerSec: p.drainPerSec,
    meter: REEL.meterStart,
  };
  retarget(reel, ctx.rng);
  return reel;
}

// ---- the session

/** Starts a cast: the panel calls this when the player presses the cast button. */
export function startCast(state: GameState, ctx: SimContext, location: FishLocationId): ActionResult {
  if (!isLocationUnlocked(state, location)) return fail('You cannot fish there yet.');
  if (state.fishing.session) return fail('You already have a line in the water.');
  state.fishing.session = {
    location,
    phase: 'charging',
    power: 0,
    fish: null,
    sizeCm: 0,
    waitMs: 0,
    reel: null,
  };
  void ctx;
  return OK;
}

/** Reels the line in without a catch (closing the panel keeps the session; this is "put the rod away"). */
export function cancelCast(state: GameState): ActionResult {
  state.fishing.session = null;
  return OK;
}

function release(s: FishingSession, state: GameState, ctx: SimContext): void {
  const speed = Math.max(0.1, ctx.mods.fishingSpeedModifier);
  const wait = BITE_WAIT_MIN_MS + ctx.rng.next() * (BITE_WAIT_MAX_MS - BITE_WAIT_MIN_MS);
  s.phase = 'waiting';
  s.waitMs = Math.round(wait / speed);
  void state;
}

function bite(s: FishingSession, state: GameState, ctx: SimContext): void {
  const pick = chooseCatch(state, ctx, s.location, 'active', s.power);
  s.fish = pick.id;
  s.sizeCm = pick.sizeCm;
  s.phase = 'bite';
  s.waitMs = BITE_WINDOW_MS;
  ctx.events.push({ type: 'bite', location: s.location });
}

/**
 * Advances the session by `dtMs` of real time with the button held or not:
 * charging (hold to charge, release to cast) → waiting (3–10 s) → bite ("!", start reeling within
 * a few seconds by pressing) → reeling (hold to raise the marker, keep it in the sweet zone until
 * the meter fills) → caught or escaped. Nothing is lost on an escape.
 */
export function stepFishing(state: GameState, ctx: SimContext, holding: boolean, dtMs: number): ActionResult {
  if (!Number.isFinite(dtMs) || dtMs < 0) return fail('Bad time step.');
  let left = dtMs;
  for (;;) {
    const s = state.fishing.session;
    if (!s) return OK;
    if (s.phase === 'charging') {
      if (!holding) {
        release(s, state, ctx);
        continue;
      }
      s.power = Math.min(1, s.power + left / CAST_CHARGE_MS);
      return OK;
    }
    if (s.phase === 'waiting') {
      const use = Math.min(left, s.waitMs);
      s.waitMs -= use;
      left -= use;
      if (s.waitMs > 0) return OK;
      bite(s, state, ctx);
      continue;
    }
    if (s.phase === 'bite') {
      if (holding) {
        s.reel = startReel(state, ctx, s.fish!);
        s.phase = 'reeling';
        continue;
      }
      const use = Math.min(left, s.waitMs);
      s.waitMs -= use;
      left -= use;
      if (s.waitMs > 0) return OK;
      state.fishing.session = null;
      ctx.events.push({ type: 'escaped', location: s.location });
      return OK;
    }
    // reeling
    const reel = s.reel!;
    if (left <= 0) return OK;
    const slice = Math.min(left, REEL.maxSliceMs);
    left -= slice;
    const end = stepReel(reel, ctx.rng, holding, slice);
    if (end === 'caught') {
      state.fishing.session = null;
      landCatch(state, ctx, s.fish!, s.sizeCm, s.location);
      return OK;
    }
    if (end === 'escaped') {
      state.fishing.session = null;
      ctx.events.push({ type: 'escaped', location: s.location });
      return OK;
    }
  }
}
