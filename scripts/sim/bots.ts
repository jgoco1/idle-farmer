// The strategy bots (phase 09) and the real-world schedules they keep. Every bot plays the same
// game from the same start date; they differ in what they care about (the Style) and in when they
// play. Sessions are at local wall-clock times, so the calendar passes nights, the 06:00 refresh,
// weekly season changes (and withering) and a DST change exactly as it does for a person.

import { GAME_DATA, type GameData } from '../../src/data';
import { daysFromCivil, localDay, localTimeToEpoch, zoneClock, type LocalClock } from '../../src/core/time';
import { areaOf, areaOffsets, occupiedPlots } from '../../src/systems/placement';
import { upgradeLevel } from '../../src/systems/upgrades';
import type { GameState } from '../../src/core/state';
import { Brain, CHEF_SHOPPING, FARM_SHOPPING, FISH_SHOPPING, type Style } from './brain';
import { DAY, HOUR, MIN, SimRun } from './driver';

export type BotId = 'farmer' | 'angler' | 'chef' | 'idler' | 'active' | 'chef_sells';

/** A session: starts `offsetMs` after the run starts, lasts `lengthMs`. */
export interface Session {
  at: number;
  lengthMs: number;
}

export interface BotDef {
  id: BotId;
  name: string;
  blurb: string;
  style: Style;
  reactionMs: number;
  /** The play sessions over `days` real days, as offsets from the start (the save is made at the first). */
  sessions(start: number, lc: LocalClock, days: number): Session[];
}

/** Local `hh:mm` on local day `day` (DST-safe). */
function localAt(lc: LocalClock, day: number, hour: number, minute = 0): number {
  return localTimeToEpoch(lc, day, hour, minute);
}

/** Daily sessions at fixed local times, from the start's local day (sessions before the start are skipped). */
function daily(times: readonly { h: number; m?: number; min: number }[]) {
  return (start: number, lc: LocalClock, days: number): Session[] => {
    const out: Session[] = [];
    const first = localDay(lc, start);
    for (let d = first; d < first + days; d++) {
      for (const x of times) {
        const at = localAt(lc, d, x.h, x.m ?? 0);
        if (at >= start && at < start + days * DAY) out.push({ at, lengthMs: x.min * MIN });
      }
    }
    return out;
  };
}

const STRATEGY_TIMES = [
  { h: 7, m: 30, min: 20 }, // a morning look before work
  { h: 19, m: 0, min: 100 }, // the evening
];

/** Farming only: crops and automation, never fishes; cooks only for the "eat a dish" milestone. */
const farmerStyle: Style = {
  fishPerMin: 0,
  rotateWaters: false,
  cook: 'none',
  bundles: true,
  cardThrift: 0,
  experiments: false,
  shopping: FARM_SHOPPING,
};

export const BOTS: Record<BotId, BotDef> = {
  farmer: {
    id: 'farmer',
    name: 'Greedy Farmer',
    blurb: 'crops and automation first; never fishes, cooks once',
    style: farmerStyle,
    reactionMs: 10_000,
    sessions: daily(STRATEGY_TIMES),
  },
  angler: {
    id: 'angler',
    name: 'Angler',
    blurb: 'fishes the whole session (3 a minute), farms between casts; rods, waters and traps first',
    style: {
      fishPerMin: 3,
      rotateWaters: false,
      cook: 'none',
      bundles: true,
      cardThrift: 0,
      experiments: false,
      shopping: FISH_SHOPPING,
    },
    reactionMs: 30_000,
    sessions: daily(STRATEGY_TIMES),
  },
  chef: {
    id: 'chef',
    name: 'Chef',
    blurb: 'cooks everything, keeps its buff slots full, buys every recipe and kitchen upgrade',
    style: {
      fishPerMin: 1,
      rotateWaters: true,
      cook: 'eat',
      bundles: true,
      cardThrift: 2,
      experiments: true,
      shopping: CHEF_SHOPPING,
    },
    reactionMs: 10_000,
    sessions: daily(STRATEGY_TIMES),
  },
  chef_sells: {
    id: 'chef_sells',
    name: 'Chef who sells (control)',
    blurb: 'the Chef, but sells every dish and never eats: the buff control',
    style: {
      fishPerMin: 1,
      rotateWaters: true,
      cook: 'sell',
      bundles: true,
      cardThrift: 2,
      experiments: true,
      shopping: CHEF_SHOPPING,
    },
    reactionMs: 10_000,
    sessions: daily(STRATEGY_TIMES),
  },
  idler: {
    id: 'idler',
    name: 'Casual Idler',
    blurb: 'checks in for 2 minutes every 4 real hours, day and night',
    style: { ...farmerStyle, fishPerMin: 0 },
    reactionMs: 15_000,
    sessions: (start, _lc, days) =>
      Array.from({ length: days * 6 }, (_, i) => ({ at: start + i * 4 * HOUR, lengthMs: 2 * MIN })),
  },
  active: {
    id: 'active',
    name: 'Active Player',
    blurb: 'plays one hour straight each evening: farms, fishes (1.5 a minute), cooks, feeds the Board',
    style: {
      fishPerMin: 1.5,
      rotateWaters: true,
      cook: 'sell',
      bundles: true,
      cardThrift: 5,
      experiments: true,
      shopping: FARM_SHOPPING,
    },
    reactionMs: 10_000,
    sessions: daily([{ h: 19, m: 0, min: 60 }]),
  },
};

export const STRATEGY_BOTS: readonly BotId[] = ['farmer', 'angler', 'chef'];
export const ALL_BOTS: readonly BotId[] = ['farmer', 'angler', 'chef', 'chef_sells', 'idler', 'active'];

/** BALANCE.md §11: farmhand L3, planter L2, auto-seller, and every open field plot sprinkled. */
export function fullyAutomated(s: GameState, data: GameData = GAME_DATA): boolean {
  if (
    upgradeLevel(s, 'farmhand') < 3 ||
    upgradeLevel(s, 'seed_planter') < 2 ||
    upgradeLevel(s, 'auto_seller') < 1
  )
    return false;
  const { cols, rows } = s.farm.grid;
  const covered = new Set<number>();
  const used = occupiedPlots(s);
  for (const o of s.placed) {
    if (o.kind !== 'sprinkler') continue;
    for (const [dc, dr] of areaOffsets(areaOf(s, data, 'sprinkler')))
      covered.add((o.at.row + dr) * cols + o.at.col + dc);
  }
  for (let i = 0; i < cols * rows; i++) if (!used.has(i) && !covered.has(i)) return false;
  return true;
}

export interface RunOptions {
  seed: number;
  days: number;
  /** Real epoch ms the save is made (defaults to the standard start). */
  start?: number;
  lc?: LocalClock;
  data?: GameData;
}

export const SIM_ZONE = zoneClock('America/New_York');
/**
 * Wednesday 25 February 2026, 19:00 in New York: spring until Sunday 1 March (4 days), then a
 * season a week; US daylight saving starts on Sunday 8 March, inside the first 30 days.
 */
export const SIM_START_LABEL = 'Wed 25 Feb 2026 19:00 in New York (DST starts on 8 March)';
export const SIM_START = localTimeToEpoch(SIM_ZONE, daysFromCivil(2026, 2, 25), 19, 0);

/** Plays one bot through its schedule for `days` real days. */
export function runBot(id: BotId, opts: RunOptions): SimRun {
  const def = BOTS[id];
  const lc = opts.lc ?? SIM_ZONE;
  const start = opts.start ?? SIM_START;
  const data = opts.data ?? GAME_DATA;
  const run = new SimRun(data, lc, start, opts.seed);
  const brain = new Brain(def.style, data);
  const sessions = def.sessions(start, lc, opts.days);
  const end = start + opts.days * DAY;
  sessions.forEach((session, i) => {
    if (session.at > run.t) run.away(session.at - run.t);
    const next = sessions[i + 1]?.at ?? end;
    brain.plan(session.lengthMs, next - session.at - session.lengthMs);
    run.play(session.lengthMs, def.reactionMs, (r) => {
      const useful = brain.look(r);
      if (fullyAutomated(r.state, data)) r.mark('automated');
      return useful;
    });
    brain.leave(run);
  });
  if (run.t < end) run.away(end - run.t);
  run.snapshot();
  return run;
}
