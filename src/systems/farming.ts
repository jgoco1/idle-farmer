// Farming (GDD §6.1, BALANCE.md §2): plot states, watering, growth, seasons and harvest.
//
// Plot states: untilled → tilled → planted (stage 0–4) → harvested (back to tilled, or back to
// stage 2 for regrowers), plus `dead` after a season change. "Ready" and the visible stage are
// derived from `growthMs`, never stored.
//
// Growth is a pure function of (plot, dt, modifiers): see `growthAfter`. Watered plots grow at full
// speed, dry plots at DRY_GROWTH_FACTOR; they never stop and never die. The watering timer running
// out is reported by `msToNextWaterOut` so the core splits steps there, and `growthAfter` also
// handles a step that straddles it, so one large step equals many small ones.

import type { GameState, Plot } from '../core/state';
import { emptyPlot } from '../core/state';
import { formatDuration, seasonOfWeek, type Calendar } from '../core/time';
import { DRY_GROWTH_FACTOR, WATER_DURATION_MS } from '../data/balance';
import { seedOf, type CropId, type SeasonId } from '../data/ids';
import type { CropDef } from '../data/types';
import type { GameData } from '../data';
import { fail, OK, type ActionResult, type SimContext } from './context';
import { addItem, canAdd, countItem, removeItem } from './inventory';
import type { Modifiers } from './modifiers';

/** The farming tools of the toolbar. `auto` picks the obvious one for the clicked plot. */
export type FarmTool = 'auto' | 'hoe' | 'seeds' | 'water' | 'hand';
export type ConcreteTool = Exclude<FarmTool, 'auto'>;

// ---- derived values

/** Growth needed for the current cycle: the full grow time, or the regrow time after a harvest. */
export function needMs(plot: Plot, crop: CropDef): number {
  const sec = plot.harvests > 0 && crop.regrowSec !== null ? crop.regrowSec : crop.growSec;
  return sec * 1000;
}

export function isWatered(plot: Plot): boolean {
  // phase 04: || coveredBySprinkler(plot) || inGreenhouse(plot)
  return plot.waterMsLeft > 0;
}

export function isReady(plot: Plot, data: GameData): boolean {
  if (plot.state !== 'planted' || plot.crop === null) return false;
  return plot.growthMs >= needMs(plot, data.crops[plot.crop]);
}

/** 0..1 through the current cycle. */
export function growthProgress(plot: Plot, data: GameData): number {
  if (plot.state !== 'planted' || plot.crop === null) return 0;
  return Math.min(1, plot.growthMs / needMs(plot, data.crops[plot.crop]));
}

/**
 * The stage to draw, 0–4, or -1 when nothing is planted. Stage 4 is shown only when ready; a first
 * growth spreads stages 0–3 evenly, and a regrow cycle maps onto stages 2–3 (DATA_SCHEMAS.md §4.2).
 */
export function plotStage(plot: Plot, data: GameData): number {
  if (plot.state !== 'planted' || plot.crop === null) return -1;
  const crop = data.crops[plot.crop];
  const p = plot.growthMs / needMs(plot, crop);
  if (p >= 1) return 4;
  if (plot.harvests > 0 && crop.regrowToStage !== null) return p < 0.5 ? crop.regrowToStage : 3;
  return Math.min(3, Math.floor(p * 4));
}

/** Growth rate multiplier for a plot: water × (growthModifier + per-plot bonus). */
function rate(wet: boolean, mods: Modifiers): number {
  // phase 04: + scarecrowBonusAt(plot) inside the parentheses (best scarecrow only)
  return (wet ? 1 : DRY_GROWTH_FACTOR) * mods.growthModifier;
}

/**
 * Pure growth: the plot's `growthMs` after `dtMs` of simulated time. Watered time counts fully and
 * dry time at half speed; a step in which the water runs out is split at that moment.
 */
export function growthAfter(plot: Plot, crop: CropDef, dtMs: number, mods: Modifiers): number {
  const need = needMs(plot, crop);
  if (plot.growthMs >= need) return plot.growthMs;
  const wetMs = Math.min(dtMs, plot.waterMsLeft);
  const dryMs = dtMs - wetMs;
  const gained = Math.round(wetMs * rate(true, mods)) + Math.round(dryMs * rate(false, mods));
  return Math.min(need, plot.growthMs + gained);
}

/** Simulated ms until this plot is ready at the current water level and modifiers (0 if ready). */
export function msUntilReady(plot: Plot, crop: CropDef, mods: Modifiers): number {
  const left = needMs(plot, crop) - plot.growthMs;
  if (left <= 0) return 0;
  const wetRate = rate(true, mods);
  const wetGrowth = plot.waterMsLeft * wetRate;
  if (left <= wetGrowth) return Math.ceil(left / wetRate);
  return Math.ceil(plot.waterMsLeft + (left - wetGrowth) / rate(false, mods));
}

// ---- simulation

export function tickFarming(state: GameState, ctx: SimContext, dtMs: number): void {
  // phase 04: greenhouse plots too (always watered, never wither)
  for (const plot of state.farm.plots) {
    if (plot.state === 'planted' && plot.crop !== null) {
      plot.growthMs = growthAfter(plot, ctx.data.crops[plot.crop], dtMs, ctx.mods);
    }
    if (plot.waterMsLeft > 0) plot.waterMsLeft = Math.max(0, plot.waterMsLeft - dtMs);
  }
}

/** The soonest moment a growing crop's water runs out (its growth rate halves), or Infinity. */
export function msToNextWaterOut(state: GameState, ctx: SimContext): number {
  let soonest = Infinity;
  for (const plot of state.farm.plots) {
    if (plot.waterMsLeft > 0 && plot.state === 'planted' && !isReady(plot, ctx.data)) {
      soonest = Math.min(soonest, plot.waterMsLeft);
    }
  }
  return soonest;
}

/**
 * The weekly season change: every crop in the ground (ready or not) whose seasons do not include
 * the new one withers into a clearable dead crop. Idempotent. Returns how many withered.
 */
export function witherOutOfSeasonCrops(state: GameState, ctx: SimContext, season: SeasonId): number {
  let withered = 0;
  for (const plot of state.farm.plots) {
    if (plot.state !== 'planted' || plot.crop === null) continue;
    if (ctx.data.crops[plot.crop].seasons.includes(season)) continue;
    Object.assign(plot, emptyPlot('dead'), { waterMsLeft: plot.waterMsLeft });
    withered++;
  }
  return withered;
}

// ---- seasons, for the UI

export function inSeason(crop: CropDef, season: SeasonId): boolean {
  return crop.seasons.includes(season);
}

/**
 * Whether a crop planted now finishes before the season changes, assuming watered growth. Crops
 * that also grow next season always make it (GDD §4).
 */
export function finishesBeforeSeasonEnds(crop: CropDef, cal: Calendar, mods: Modifiers): boolean {
  if (crop.seasons.includes(seasonOfWeek(cal.weekIndex + 1))) return true;
  return (crop.growSec * 1000) / rate(true, mods) <= cal.msToSeasonChange;
}

// ---- player actions

function validPlots(state: GameState, plots: readonly number[]): number[] {
  const n = state.farm.plots.length;
  return [...new Set(plots)].filter((i) => Number.isInteger(i) && i >= 0 && i < n);
}

function cropName(data: GameData, id: CropId): string {
  return data.crops[id].name.toLowerCase();
}

/** Hoe: tills untilled soil and clears dead crops. */
export function tillPlots(state: GameState, ctx: SimContext, plots: readonly number[]): ActionResult {
  const done: number[] = [];
  for (const i of validPlots(state, plots)) {
    const plot = state.farm.plots[i]!;
    if (plot.state !== 'untilled' && plot.state !== 'dead') continue;
    Object.assign(plot, emptyPlot('tilled'), { waterMsLeft: plot.waterMsLeft });
    done.push(i);
  }
  if (done.length === 0) return fail('Nothing to till here.');
  ctx.events.push({ type: 'tilled', plots: done });
  return OK;
}

/** Watering can: 2 hours of full-speed growth. Works on tilled soil and planted crops. */
export function waterPlots(state: GameState, ctx: SimContext, plots: readonly number[]): ActionResult {
  const done: number[] = [];
  let untilled = false;
  for (const i of validPlots(state, plots)) {
    const plot = state.farm.plots[i]!;
    if (plot.state === 'untilled' || plot.state === 'dead') {
      untilled = true;
      continue;
    }
    if (plot.waterMsLeft >= WATER_DURATION_MS) continue;
    plot.waterMsLeft = WATER_DURATION_MS;
    done.push(i);
  }
  if (done.length === 0) return fail(untilled ? 'Till the soil before watering it.' : 'Already watered.');
  ctx.events.push({ type: 'watered', plots: done });
  return OK;
}

/** Seeds: plants one seed per empty tilled plot, as far as the seeds go. In season only. */
export function plantPlots(
  state: GameState,
  ctx: SimContext,
  crop: CropId,
  plots: readonly number[],
): ActionResult {
  const def = ctx.data.crops[crop];
  if (!def) return fail('Unknown seed.');
  if (!inSeason(def, ctx.calendar.season)) {
    return fail(`${def.name} can't be planted in ${ctx.calendar.season}.`);
  }
  const seed = seedOf(crop);
  const done: number[] = [];
  let noSoil = false;
  for (const i of validPlots(state, plots)) {
    const plot = state.farm.plots[i]!;
    if (plot.state !== 'tilled') {
      noSoil ||= plot.state === 'untilled' || plot.state === 'dead';
      continue;
    }
    if (!removeItem(state.inventory, seed, 1)) break;
    Object.assign(plot, emptyPlot('planted'), { crop, waterMsLeft: plot.waterMsLeft });
    done.push(i);
  }
  if (done.length === 0) {
    if (countItem(state.inventory, seed) === 0) return fail(`You have no ${cropName(ctx.data, crop)} seeds.`);
    return fail(noSoil ? 'Till the soil first.' : 'Something is already growing here.');
  }
  ctx.events.push({ type: 'planted', crop, plots: done });
  return OK;
}

/**
 * Hand: harvests ready crops into the inventory, rolling the yield with the seeded RNG. Regrowers
 * go back to stage 2; other crops leave the plot tilled. If the harvest does not fit, the crop
 * waits in the ground and nothing (not even the RNG) changes.
 */
export function harvestPlots(state: GameState, ctx: SimContext, plots: readonly number[]): ActionResult {
  let harvested = 0;
  let full: CropId | null = null;
  let notReady: { crop: CropId; ms: number } | null = null;
  for (const i of validPlots(state, plots)) {
    const plot = state.farm.plots[i]!;
    if (plot.state !== 'planted' || plot.crop === null) continue;
    const crop = ctx.data.crops[plot.crop];
    if (!isReady(plot, ctx.data)) {
      notReady ??= { crop: crop.id, ms: msUntilReady(plot, crop, ctx.mods) };
      continue;
    }
    const rngBefore = state.rngState;
    const qty = ctx.rng.int(crop.yield.min, crop.yield.max);
    // phase 07: + 1 with probability doubleHarvestChance (Farming perks)
    if (!canAdd(state.inventory, crop.id, qty)) {
      state.rngState = rngBefore;
      full ??= crop.id;
      continue;
    }
    addItem(state.inventory, crop.id, qty);
    if (crop.regrowSec !== null) {
      plot.harvests += 1;
      plot.growthMs = 0;
    } else {
      Object.assign(plot, emptyPlot('tilled'), { waterMsLeft: plot.waterMsLeft });
    }
    harvested++;
    ctx.events.push({ type: 'harvested', crop: crop.id, qty, plot: i, auto: false });
  }
  if (full) ctx.events.push({ type: 'inventoryFull', item: full });
  if (harvested === 0) {
    if (full) return fail('Your bag is full. The crop will wait in the ground.');
    if (notReady) {
      return fail(`The ${cropName(ctx.data, notReady.crop)} needs ${formatDuration(notReady.ms)} more.`);
    }
    return fail('Nothing to harvest here.');
  }
  // The `harvested` events drive both the harvest effect and the "+3 Turnip" notification, which the
  // UI groups per click or drag stroke (see src/main.ts).
  return OK;
}

/**
 * What Auto does on this plot: clear or till bare soil, plant the chosen seed on empty soil (or
 * water it when there is no seed), harvest a ready crop, water a dry one. Returns null when there
 * is nothing obvious to do (a watered crop that is still growing).
 */
export function autoToolFor(
  state: GameState,
  data: GameData,
  season: SeasonId,
  plotIndex: number,
  seed: CropId | null,
): ConcreteTool | null {
  const plot = state.farm.plots[plotIndex];
  if (!plot) return null;
  switch (plot.state) {
    case 'untilled':
    case 'dead':
      return 'hoe';
    case 'tilled': {
      const plantable =
        seed !== null && inSeason(data.crops[seed], season) && countItem(state.inventory, seedOf(seed)) > 0;
      if (plantable) return 'seeds';
      return plot.waterMsLeft < WATER_DURATION_MS ? 'water' : 'seeds';
    }
    case 'planted':
      if (isReady(plot, data)) return 'hand';
      return isWatered(plot) ? null : 'water';
  }
}

/** Runs a tool on some plots. `auto` resolves from the first plot and applies that tool to all. */
export function useTool(
  state: GameState,
  ctx: SimContext,
  tool: FarmTool,
  plots: readonly number[],
  seed: CropId | null,
): ActionResult {
  const valid = validPlots(state, plots);
  if (valid.length === 0) return fail('That is not a plot.');
  let t: ConcreteTool | null = tool === 'auto' ? null : tool;
  if (tool === 'auto') {
    t = autoToolFor(state, ctx.data, ctx.calendar.season, valid[0]!, seed);
    if (t === null) {
      const plot = state.farm.plots[valid[0]!]!;
      const crop = ctx.data.crops[plot.crop!];
      return fail(
        `The ${cropName(ctx.data, crop.id)} is growing (${formatDuration(msUntilReady(plot, crop, ctx.mods))} left).`,
      );
    }
  }
  switch (t) {
    case 'hoe':
      return tillPlots(state, ctx, valid);
    case 'water':
      return waterPlots(state, ctx, valid);
    case 'hand':
      return harvestPlots(state, ctx, valid);
    case 'seeds':
      if (seed === null) return fail('Choose a seed first.');
      return plantPlots(state, ctx, seed, valid);
    default:
      return fail('Choose a tool first.');
  }
}
