// Automation (GDD §6.3, BALANCE.md §4): the farmhand and its seed planter.
//
// Every `interval` seconds of simulated time the farmhand makes a visit: it harvests up to
// `capacity` ready plots (into the bag, or with the Auto-Seller straight into the Shipping Bin),
// and then the seed planter, if built, replants and tills up to `capacity` plots. The order inside a
// step is growth → farmhand harvest → planter → auto-ship (part of harvesting) → bin pickup.
//
// Offline efficiency: a visit with nothing to do changes nothing, so the core does not have to stop
// for it. `msToNextAutomation` reports only the next *useful* visit (a ready plot to harvest or a
// planter job), snapped to the visit grid; `tickAutomation` then advances the timer by whole
// intervals in one go (`floor((dt - cooldown) / interval) + 1` visits). One large step therefore
// equals many small ones, and 8 hours cost a few hundred steps at most.
//
// The farmhand sprite in the renderer only follows the `harvested`/`planted` events with
// `auto: true`; nothing here depends on it.

import { emptyPlot, type GameState } from '../core/state';
import type { GameData } from '../data';
import { CROP_IDS, seedOf, type CropId } from '../data/ids';
import { shipsAutomatically } from './autoSeller';
import type { SimContext } from './context';
import {
  plotFields,
  envFor,
  harvestOne,
  inSeason,
  isGreenhouseIndex,
  isReady,
  lastPlanted,
  msUntilReady,
  plantOne,
  plotAt,
} from './farming';
import { canAdd, countItem } from './inventory';
import { hasTreeWork, pickTreesFor } from './orchard';
import { coverageOf, occupiedPlots } from './placement';
import { effectOf, hasFlag } from './upgrades';

export interface FarmhandStats {
  intervalMs: number;
  capacity: number;
}

/** The farmhand's visit interval (sped up by `automationSpeedModifier`) and capacity, or null if not hired. */
export function farmhandStats(
  state: GameState,
  ctx: Pick<SimContext, 'data' | 'mods'>,
): FarmhandStats | null {
  const e = effectOf(state, ctx.data, 'farmhand');
  if (!e?.intervalSec || !e.capacity) return null;
  const speed = ctx.mods.automationSpeedModifier > 0 ? ctx.mods.automationSpeedModifier : 1;
  return { intervalMs: Math.max(1, Math.round((e.intervalSec * 1000) / speed)), capacity: e.capacity };
}

// ---- the seed planter

interface PlantJob {
  index: number;
  crop: CropId;
  till: boolean;
}

function averageYield(data: GameData, crop: CropId): number {
  const y = data.crops[crop].yield;
  return (y.min + y.max) / 2;
}

/**
 * The jobs the planter would do right now, at most `capacity`, without changing anything:
 *  1. replant the plots just harvested with their last crop (level 1),
 *  2. fill empty tilled plots with the last crop, else the most valuable seed in season (level 2),
 *  3. till bare soil and clear dead crops, then plant them (level 3).
 * It never plants out of season (greenhouse plots ignore seasons) and never uses a seed it lacks.
 */
export function planPlanter(
  state: GameState,
  ctx: Pick<SimContext, 'data' | 'calendar'>,
  capacity: number,
  harvested: readonly number[],
): PlantJob[] {
  const { data } = ctx;
  const replant = hasFlag(state, data, 'seed_planter', 'replantHarvested');
  const fill = hasFlag(state, data, 'seed_planter', 'plantEmpty');
  const till = hasFlag(state, data, 'seed_planter', 'autoTill');
  if (!replant && !fill && !till) return [];

  const season = ctx.calendar.season;
  const seeds = new Map<CropId, number>();
  const seedsLeft = (c: CropId): number => {
    let n = seeds.get(c);
    if (n === undefined) {
      n = countItem(state.inventory, seedOf(c));
      seeds.set(c, n);
    }
    return n;
  };
  const usable = (c: CropId, index: number): boolean =>
    seedsLeft(c) > 0 && (isGreenhouseIndex(index) || inSeason(data.crops[c], season));
  const choose = (index: number, fallback: boolean): CropId | null => {
    const last = lastPlanted(state, index);
    let pick: CropId | null = last && usable(last, index) ? last : null;
    if (!pick && fallback) {
      let best = -1;
      for (const c of CROP_IDS) {
        if (!usable(c, index)) continue;
        const value = data.crops[c].basePrice * averageYield(data, c);
        if (value > best) {
          best = value;
          pick = c;
        }
      }
    }
    if (pick) seeds.set(pick, seedsLeft(pick) - 1);
    return pick;
  };

  const jobs: PlantJob[] = [];
  const taken = new Set<number>();
  if (replant) {
    for (const index of harvested) {
      if (jobs.length >= capacity) break;
      if (plotAt(state, index)?.state !== 'tilled') continue; // regrowers stay planted
      const crop = choose(index, false);
      if (crop) {
        jobs.push({ index, crop, till: false });
        taken.add(index);
      }
    }
  }
  if (fill || till) {
    const used = state.placed.length > 0 ? occupiedPlots(state) : null;
    const fields = plotFields(state);
    outer: for (let f = 0; f < fields.length; f++) {
      const { plots, base } = fields[f]!;
      for (let i = 0; i < plots.length; i++) {
        if (jobs.length >= capacity) break outer;
        const plot = plots[i]!;
        const bare = plot.state === 'untilled' || plot.state === 'dead';
        if (plot.state === 'tilled' ? !fill : bare ? !till : true) continue;
        const index = base + i;
        if (taken.has(index) || used?.has(index)) continue;
        const crop = choose(index, true);
        if (crop) jobs.push({ index, crop, till: bare });
      }
    }
  }
  return jobs;
}

function runPlanter(state: GameState, ctx: SimContext, jobs: readonly PlantJob[]): void {
  const tilled: number[] = [];
  const planted = new Map<CropId, number[]>();
  for (const job of jobs) {
    const plot = plotAt(state, job.index)!;
    if (job.till) {
      Object.assign(plot, emptyPlot('tilled'), { waterMsLeft: plot.waterMsLeft });
      tilled.push(job.index);
    }
    if (!plantOne(state, job.index, job.crop)) continue;
    const list = planted.get(job.crop) ?? [];
    list.push(job.index);
    planted.set(job.crop, list);
  }
  if (tilled.length > 0) ctx.events.push({ type: 'tilled', plots: tilled, auto: true });
  for (const [crop, plots] of planted) ctx.events.push({ type: 'planted', crop, plots, auto: true });
}

// ---- the farmhand

/**
 * One visit: pick the ripe trees (each uses one unit of capacity: there are few, and fruit only
 * appears once a day), then harvest ready plots with what is left (field first, then greenhouse), then the planter.
 */
function visit(state: GameState, ctx: SimContext, stats: FarmhandStats): void {
  const picked = state.orchard.trees.length > 0 ? pickTreesFor(state, ctx, stats.capacity) : 0;
  const harvested: number[] = [];
  const fields = plotFields(state);
  outer: for (let f = 0; f < fields.length; f++) {
    const { plots, base } = fields[f]!;
    for (let i = 0; i < plots.length; i++) {
      if (harvested.length + picked >= stats.capacity) break outer;
      const plot = plots[i]!;
      if (plot.state !== 'planted' || !isReady(plot, ctx.data)) continue;
      if (harvestOne(state, ctx, base + i, true) === 'harvested') harvested.push(base + i);
    }
  }
  const jobs = planPlanter(state, ctx, stats.capacity, harvested);
  if (jobs.length > 0) runPlanter(state, ctx, jobs);
}

/**
 * Advances the farmhand's timer by `dtMs`. The core never lets a step run past a *useful* visit
 * (see `msToNextAutomation`), so at most one visit with work falls in a step and it lands at the
 * end; any earlier visits were idle and are skipped arithmetically.
 */
export function tickAutomation(state: GameState, ctx: SimContext, dtMs: number): void {
  const stats = farmhandStats(state, ctx);
  if (!stats) return;
  const auto = state.automation;
  const cd = auto.farmhandCooldownMs > 0 ? auto.farmhandCooldownMs : stats.intervalMs;
  if (dtMs < cd) {
    auto.farmhandCooldownMs = cd - dtMs;
    return;
  }
  const visits = Math.floor((dtMs - cd) / stats.intervalMs) + 1;
  auto.farmhandCooldownMs = cd + visits * stats.intervalMs - dtMs;
  visit(state, ctx, stats);
}

/**
 * Simulated ms until the next farmhand visit that has something to do, or Infinity. Visits happen
 * at `cooldown + k · interval`; with work waiting that is the very next visit, otherwise the first
 * visit at or after the moment the soonest growing crop is ready.
 */
export function msToNextAutomation(state: GameState, ctx: SimContext): number {
  const stats = farmhandStats(state, ctx);
  if (!stats) return Infinity;
  const cd = state.automation.farmhandCooldownMs > 0 ? state.automation.farmhandCooldownMs : stats.intervalMs;
  if (state.orchard.trees.length > 0 && hasTreeWork(state, ctx.data)) return cd;
  // One pass over the plots: a ready crop with somewhere to go means the next visit has work; otherwise
  // the soonest growing crop (a crop ready by the next visit also means the next visit).
  const cov = coverageOf(state, ctx.data);
  let soonest = Infinity;
  const fields = plotFields(state);
  for (let f = 0; f < fields.length; f++) {
    const { plots, base } = fields[f]!;
    for (let i = 0; i < plots.length; i++) {
      const plot = plots[i]!;
      if (plot.state !== 'planted' || plot.crop === null) continue;
      const crop = ctx.data.crops[plot.crop];
      if (isReady(plot, ctx.data)) {
        if (shipsAutomatically(state, ctx.data, crop.id) || canAdd(state.inventory, crop.id, crop.yield.min))
          return cd;
        continue;
      }
      // A crop ready by the next visit means the next visit has work: every other answer is `cd` too.
      const ms = msUntilReady(plot, crop, ctx.mods, envFor(cov, base + i));
      if (ms <= cd) return cd;
      if (ms < soonest) soonest = ms;
    }
  }
  // One planter job is enough to know the next visit has work (a full plan is wasted here).
  if (planPlanter(state, ctx, 1, []).length > 0) return cd;
  if (!Number.isFinite(soonest)) return Infinity;
  if (soonest <= cd) return cd;
  return cd + Math.ceil((soonest - cd) / stats.intervalMs) * stats.intervalMs;
}
