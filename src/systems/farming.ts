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
import { DRY_GROWTH_FACTOR, FIELD_BASE, GREENHOUSE_BASE, WATER_DURATION_MS } from '../data/balance';
import {
  NORTH_FIELD_IDS,
  seedOf,
  type CropId,
  type FieldId,
  type NorthFieldId,
  type SeasonId,
} from '../data/ids';
import { WORLD_LAYOUT } from '../data/world';
import type { CropDef } from '../data/types';
import type { GameData } from '../data';
import { stowHarvest } from './autoSeller';
import { fail, OK, type ActionResult, type SimContext } from './context';
import { countItem, removeItem } from './inventory';
import type { Modifiers } from './modifiers';
import { coverageOf, objectAt, occupiedPlots, type Coverage } from './placement';
import { upgradeLevel } from './upgrades';

/** The farming tools of the toolbar. `auto` picks the obvious one for the clicked plot. */
export type FarmTool = 'auto' | 'hoe' | 'seeds' | 'water' | 'hand';
export type ConcreteTool = Exclude<FarmTool, 'auto'>;

// ---- derived values

/** Growth needed for the current cycle: the full grow time, or the regrow time after a harvest. */
export function needMs(plot: Plot, crop: CropDef): number {
  const sec = plot.harvests > 0 && crop.regrowSec !== null ? crop.regrowSec : crop.growSec;
  return sec * 1000;
}

/** What surrounds a plot besides its own water: a sprinkler or greenhouse keeps it wet; a scarecrow adds growth. */
export interface PlotEnv {
  sprinkled: boolean;
  bonus: number; // added to the growth modifier
}
export const NO_ENV: PlotEnv = Object.freeze({ sprinkled: false, bonus: 0 });
const GREENHOUSE_ENV: PlotEnv = Object.freeze({ sprinkled: true, bonus: 0 });

export function isWatered(plot: Plot, env: PlotEnv = NO_ENV): boolean {
  return env.sprinkled || plot.waterMsLeft > 0;
}

// ---- plot addressing (DATA_SCHEMAS §10.3): home field plots are 0..n-1, greenhouse plots start at
// GREENHOUSE_BASE (1000), and each north field's at FIELD_BASE[field] (2000, 3000), row-major.

/** Which field plot `index` is in, from the index alone. */
export function fieldOf(index: number): FieldId {
  if (index < GREENHOUSE_BASE) return 'home';
  if (index < FIELD_BASE.north_fields) return 'greenhouse';
  if (index < FIELD_BASE.terraces) return 'north_fields';
  return 'terraces';
}

/** The north field plot `index` is in, or null for the home field and the greenhouse. */
export function northFieldOf(index: number): NorthFieldId | null {
  const f = fieldOf(index);
  return f === 'home' || f === 'greenhouse' ? null : f;
}

export function isGreenhouseIndex(index: number): boolean {
  return index >= GREENHOUSE_BASE && index < FIELD_BASE.north_fields;
}

export function plotAt(state: GameState, index: number): Plot | undefined {
  if (index < GREENHOUSE_BASE) return state.farm.plots[index];
  if (index < FIELD_BASE.north_fields) return state.farm.greenhouse[index - GREENHOUSE_BASE];
  const f = index < FIELD_BASE.terraces ? 'north_fields' : 'terraces';
  return state.farm.north[f]?.plots[index - FIELD_BASE[f]];
}

/** The number of plots on the farm, every field included. */
export function plotCount(state: GameState): number {
  let n = state.farm.plots.length + state.farm.greenhouse.length;
  for (const f of NORTH_FIELD_IDS) n += state.farm.north[f]?.plots.length ?? 0;
  return n;
}

/** One field's plots and the index of its first plot (for loops that visit every plot without `plotAt`). */
export interface PlotField {
  plots: readonly Plot[];
  base: number;
  greenhouse: boolean;
}

interface FieldsEntry {
  home: readonly Plot[];
  greenhouse: readonly Plot[];
  north: (readonly Plot[] | undefined)[];
  list: PlotField[];
}
const fieldsCache = new WeakMap<GameState['farm'], FieldsEntry>();

/**
 * Every field's plots in `allPlotIndexes` order (home, greenhouse, the owned north fields). The hot
 * loops of the farmhand, the planter and the step boundaries walk these arrays directly; the list is
 * kept per farm and rebuilt only when one of its plot arrays is replaced. Never modify it.
 */
export function plotFields(state: GameState): readonly PlotField[] {
  const farm = state.farm;
  const e = fieldsCache.get(farm);
  if (e && e.home === farm.plots && e.greenhouse === farm.greenhouse) {
    let same = true;
    for (let i = 0; i < NORTH_FIELD_IDS.length; i++)
      if (e.north[i] !== farm.north[NORTH_FIELD_IDS[i]!]?.plots) same = false;
    if (same) return e.list;
  }
  const list: PlotField[] = [
    { plots: farm.plots, base: 0, greenhouse: false },
    { plots: farm.greenhouse, base: GREENHOUSE_BASE, greenhouse: true },
  ];
  const north: (readonly Plot[] | undefined)[] = [];
  for (const f of NORTH_FIELD_IDS) {
    const plots = farm.north[f]?.plots;
    north.push(plots);
    if (plots) list.push({ plots, base: FIELD_BASE[f], greenhouse: false });
  }
  fieldsCache.set(farm, { home: farm.plots, greenhouse: farm.greenhouse, north, list });
  return list;
}

const indexCache = new Map<number, readonly number[]>();

/**
 * Every plot index: the home field first, then the greenhouse, then each owned north field in
 * NORTH_FIELD_IDS order. Asked several times per simulation step, so the list is shared per farm
 * shape: never modify it.
 */
export function allPlotIndexes(state: GameState): readonly number[] {
  const f = state.farm.plots.length;
  const g = state.farm.greenhouse.length;
  let mask = 0;
  for (let i = 0; i < NORTH_FIELD_IDS.length; i++) if (state.farm.north[NORTH_FIELD_IDS[i]!]) mask |= 1 << i;
  const key = (mask * 1024 + f) * 1024 + g;
  let out = indexCache.get(key);
  if (!out) {
    const list = [
      ...Array.from({ length: f }, (_, i) => i),
      ...Array.from({ length: g }, (_, i) => GREENHOUSE_BASE + i),
    ];
    for (const field of NORTH_FIELD_IDS) {
      const n = state.farm.north[field]?.plots.length ?? 0;
      for (let i = 0; i < n; i++) list.push(FIELD_BASE[field] + i);
    }
    out = list;
    indexCache.set(key, out);
  }
  return out;
}

/** The plot indexes of one field (home, or an owned north field); the greenhouse is not a field here. */
export function fieldPlotIndexes(state: GameState, field: 'home' | NorthFieldId): number[] {
  if (field === 'home') return state.farm.plots.map((_, i) => i);
  const n = state.farm.north[field]?.plots.length ?? 0;
  return Array.from({ length: n }, (_, i) => FIELD_BASE[field] + i);
}

/** Index into `state.lastPlantedCrop` (home field plots first, then the greenhouse); -1 for a north plot. */
export function lastPlantedIndex(state: GameState, index: number): number {
  if (index < GREENHOUSE_BASE) return index;
  if (isGreenhouseIndex(index)) return state.farm.plots.length + (index - GREENHOUSE_BASE);
  return -1;
}

/** The crop last planted on plot `index` (the seed planter's memory), in any field. */
export function lastPlanted(state: GameState, index: number): CropId | null {
  const f = northFieldOf(index);
  if (f) return state.farm.north[f]?.lastPlantedCrop[index - FIELD_BASE[f]] ?? null;
  return state.lastPlantedCrop[lastPlantedIndex(state, index)] ?? null;
}

export function setLastPlanted(state: GameState, index: number, crop: CropId | null): void {
  const f = northFieldOf(index);
  if (f) {
    const field = state.farm.north[f];
    if (field) field.lastPlantedCrop[index - FIELD_BASE[f]] = crop;
    return;
  }
  state.lastPlantedCrop[lastPlantedIndex(state, index)] = crop;
}

/** Every crop the planter remembers, in any field (for Seed Order). */
export function rememberedCrops(state: GameState): Set<CropId> {
  const set = new Set<CropId>();
  for (const c of state.lastPlantedCrop) if (c) set.add(c);
  for (const f of NORTH_FIELD_IDS)
    for (const c of state.farm.north[f]?.lastPlantedCrop ?? []) if (c) set.add(c);
  return set;
}

/** A fresh north field: every plot untilled, nothing remembered (v4-01: the parcel's overgrowth is cleared). */
export function newNorthField(field: NorthFieldId): { plots: Plot[]; lastPlantedCrop: (CropId | null)[] } {
  const { cols, rows } = WORLD_LAYOUT.northFields[field].grid;
  return {
    plots: Array.from({ length: cols * rows }, () => emptyPlot('untilled')),
    lastPlantedCrop: Array.from({ length: cols * rows }, () => null),
  };
}

/** The surroundings of plot `index`, from a coverage map (null = nothing placed). */
export function envFor(cov: Coverage | null, index: number): PlotEnv {
  if (index < GREENHOUSE_BASE) {
    if (!cov) return NO_ENV;
    return sharedEnv(cov.sprinkled[index] === 1, cov.bonus[index]!);
  }
  if (index < FIELD_BASE.north_fields) return GREENHOUSE_ENV;
  if (!cov) return NO_ENV;
  const f = index < FIELD_BASE.terraces ? 'north_fields' : 'terraces';
  const fc = cov.byField[f];
  if (!fc) return NO_ENV;
  const i = index - FIELD_BASE[f];
  return sharedEnv(fc.sprinkled[i] === 1, fc.bonus[i]!);
}

// A handful of distinct surroundings exist (sprinkled or not × a scarecrow bonus or none), so they
// are shared rather than built per plot per step.
const envCache = new Map<number, PlotEnv>();
function sharedEnv(sprinkled: boolean, bonus: number): PlotEnv {
  const key = bonus * 2 + (sprinkled ? 1 : 0);
  let env = envCache.get(key);
  if (!env) {
    env = Object.freeze({ sprinkled, bonus });
    envCache.set(key, env);
  }
  return env;
}

/** Whether plot `index` counts as watered right now (hand watering, a sprinkler or the greenhouse). */
export function plotWatered(state: GameState, data: GameData, index: number): boolean {
  const plot = plotAt(state, index);
  return plot !== undefined && isWatered(plot, envFor(coverageOf(state, data), index));
}

export function isReady(plot: Plot, data: GameData): boolean {
  if (plot.state !== 'planted' || plot.crop === null) return false;
  return plot.growthMs >= needMs(plot, data.crops[plot.crop]);
}

/**
 * The stage to draw, 0–4, or -1 when nothing is planted. Stage 4 is shown only when ready; a first
 * growth spreads stages 0–3 evenly, and a regrow cycle maps onto stages 2–3 (DATA_SCHEMAS.md §4.2).
 */
export function plotStage(plot: Plot, data: GameData): number {
  if (plot.state !== 'planted' || plot.crop === null) return -1;
  const crop = data.crops[plot.crop];
  // Integer maths only (compare growth × 4 with multiples of the need): the renderer asks per plot per
  // frame, and a division or a Math.floor would hand back a boxed double every time.
  const need = needMs(plot, crop);
  const growth = plot.growthMs;
  if (growth >= need) return 4;
  const g4 = growth * 4;
  if (plot.harvests > 0 && crop.regrowToStage !== null) return g4 < need * 2 ? crop.regrowToStage : 3;
  return g4 >= need * 3 ? 3 : g4 >= need * 2 ? 2 : g4 >= need ? 1 : 0;
}

/** Growth rate multiplier for a plot: water × (growthModifier + scarecrow bonus). */
function rate(wet: boolean, mods: Modifiers, bonus = 0): number {
  return (wet ? 1 : DRY_GROWTH_FACTOR) * (mods.growthModifier + bonus);
}

/**
 * Pure growth: the plot's `growthMs` after `dtMs` of simulated time. Watered time counts fully and
 * dry time at half speed; a step in which the water runs out is split at that moment. A sprinkler
 * or the greenhouse keeps the plot watered for the whole step.
 */
export function growthAfter(
  plot: Plot,
  crop: CropDef,
  dtMs: number,
  mods: Modifiers,
  env: PlotEnv = NO_ENV,
): number {
  const need = needMs(plot, crop);
  if (plot.growthMs >= need) return plot.growthMs;
  const wetMs = env.sprinkled ? dtMs : Math.min(dtMs, plot.waterMsLeft);
  const dryMs = dtMs - wetMs;
  const gained =
    Math.round(wetMs * rate(true, mods, env.bonus)) + Math.round(dryMs * rate(false, mods, env.bonus));
  return Math.min(need, plot.growthMs + gained);
}

/** Simulated ms until this plot is ready at the current water level and modifiers (0 if ready). */
export function msUntilReady(plot: Plot, crop: CropDef, mods: Modifiers, env: PlotEnv = NO_ENV): number {
  const left = needMs(plot, crop) - plot.growthMs;
  if (left <= 0) return 0;
  const wetRate = rate(true, mods, env.bonus);
  if (env.sprinkled) return Math.ceil(left / wetRate);
  const wetGrowth = plot.waterMsLeft * wetRate;
  if (left <= wetGrowth) return Math.ceil(left / wetRate);
  return Math.ceil(plot.waterMsLeft + (left - wetGrowth) / rate(false, mods, env.bonus));
}

// ---- simulation

export function tickFarming(state: GameState, ctx: SimContext, dtMs: number): void {
  const cov = coverageOf(state, ctx.data);
  const plots = state.farm.plots;
  for (let i = 0; i < plots.length; i++) growPlot(plots[i]!, envFor(cov, i), ctx, dtMs);
  const greenhouse = state.farm.greenhouse;
  for (let i = 0; i < greenhouse.length; i++) growPlot(greenhouse[i]!, GREENHOUSE_ENV, ctx, dtMs);
  for (let n = 0; n < NORTH_FIELD_IDS.length; n++) {
    const f = NORTH_FIELD_IDS[n]!;
    const north = state.farm.north[f]?.plots;
    if (!north) continue;
    const base = FIELD_BASE[f];
    for (let i = 0; i < north.length; i++) growPlot(north[i]!, envFor(cov, base + i), ctx, dtMs);
  }
}

function growPlot(plot: Plot, env: PlotEnv, ctx: SimContext, dtMs: number): void {
  if (plot.state === 'planted' && plot.crop !== null) {
    plot.growthMs = growthAfter(plot, ctx.data.crops[plot.crop], dtMs, ctx.mods, env);
  }
  if (plot.waterMsLeft > 0) plot.waterMsLeft = Math.max(0, plot.waterMsLeft - dtMs);
}

/** The soonest moment a growing crop's water runs out (its growth rate halves), or Infinity. */
export function msToNextWaterOut(state: GameState, ctx: SimContext): number {
  let soonest = Infinity;
  const cov = coverageOf(state, ctx.data);
  const fields = plotFields(state);
  for (let f = 0; f < fields.length; f++) {
    const { plots, base, greenhouse } = fields[f]!;
    if (greenhouse) continue; // always watered: no rate change
    for (let i = 0; i < plots.length; i++) {
      const plot = plots[i]!;
      if (plot.waterMsLeft > 0 && plot.state === 'planted' && !isReady(plot, ctx.data)) {
        if (cov && envFor(cov, base + i).sprinkled) continue; // always watered: no rate change
        soonest = Math.min(soonest, plot.waterMsLeft);
      }
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
  const north = NORTH_FIELD_IDS.flatMap((f) => state.farm.north[f]?.plots ?? []);
  for (const plot of [...state.farm.plots, ...north]) {
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

/** Distinct, existing plots, without the ones a sprinkler or scarecrow stands on. */
function validPlots(state: GameState, plots: readonly number[]): number[] {
  const used = state.placed.length > 0 ? occupiedPlots(state) : null;
  return [...new Set(plots)].filter(
    (i) => Number.isInteger(i) && i >= 0 && plotAt(state, i) !== undefined && !used?.has(i),
  );
}

function cropName(data: GameData, id: CropId): string {
  return data.crops[id].name.toLowerCase();
}

/**
 * Whether the Hoe may pull up this plot's crop: a regrower that has given at least one harvest and
 * is not ready now. Without this a regrowing crop would hold its plot until its seasons end (and
 * the seed planter keeps replanting it), which could lock a field for weeks (phase 09).
 */
export function canPullUp(plot: Plot, data: GameData): boolean {
  if (plot.state !== 'planted' || plot.crop === null) return false;
  return data.crops[plot.crop].regrowSec !== null && plot.harvests > 0 && !isReady(plot, data);
}

/**
 * Hoe: tills untilled soil and clears dead crops. `pullUp` (plots the player aimed at directly, never
 * an upgraded hoe's wider area) may also clear an old regrower (see `canPullUp`).
 */
export function tillPlots(
  state: GameState,
  ctx: SimContext,
  plots: readonly number[],
  auto = false,
  pullUp: readonly number[] = [],
): ActionResult {
  const done: number[] = [];
  let young: CropId | null = null;
  for (const i of validPlots(state, plots)) {
    const plot = plotAt(state, i)!;
    if (plot.state === 'planted' && pullUp.includes(i)) {
      if (!canPullUp(plot, ctx.data)) {
        if (plot.crop && ctx.data.crops[plot.crop].regrowSec !== null) young ??= plot.crop;
        continue;
      }
      setLastPlanted(state, i, null); // pulled up: the planter should not bring it back
    } else if (plot.state !== 'untilled' && plot.state !== 'dead') continue;
    Object.assign(plot, emptyPlot('tilled'), { waterMsLeft: plot.waterMsLeft });
    done.push(i);
  }
  if (done.length === 0) {
    return fail(
      young
        ? `Let the ${cropName(ctx.data, young)} give a harvest (and pick it) before pulling it up.`
        : 'Nothing to till here.',
    );
  }
  ctx.events.push(auto ? { type: 'tilled', plots: done, auto: true } : { type: 'tilled', plots: done });
  return OK;
}

/** Watering can: 2 hours of full-speed growth. Works on tilled soil and planted crops. */
export function waterPlots(state: GameState, ctx: SimContext, plots: readonly number[]): ActionResult {
  const done: number[] = [];
  let untilled = false;
  const cov = coverageOf(state, ctx.data);
  for (const i of validPlots(state, plots)) {
    const plot = plotAt(state, i)!;
    if (plot.state === 'untilled' || plot.state === 'dead') {
      untilled = true;
      continue;
    }
    if (plot.waterMsLeft >= WATER_DURATION_MS || envFor(cov, i).sprinkled) continue;
    plot.waterMsLeft = WATER_DURATION_MS;
    done.push(i);
  }
  if (done.length === 0) return fail(untilled ? 'Till the soil before watering it.' : 'Already watered.');
  ctx.events.push({ type: 'watered', plots: done });
  return OK;
}

/** Puts one seed of `crop` into the tilled plot `index` and remembers it for the seed planter. */
export function plantOne(state: GameState, index: number, crop: CropId): boolean {
  const plot = plotAt(state, index);
  if (!plot || plot.state !== 'tilled') return false;
  if (!removeItem(state.inventory, seedOf(crop), 1)) return false;
  Object.assign(plot, emptyPlot('planted'), { crop, waterMsLeft: plot.waterMsLeft });
  setLastPlanted(state, index, crop);
  return true;
}

/**
 * Seeds: plants one seed per empty tilled plot, as far as the seeds go. Field plots need the crop to
 * be in season; greenhouse plots ignore seasons.
 */
export function plantPlots(
  state: GameState,
  ctx: SimContext,
  crop: CropId,
  plots: readonly number[],
): ActionResult {
  const def = ctx.data.crops[crop];
  if (!def) return fail('Unknown seed.');
  const seasonOk = inSeason(def, ctx.calendar.season);
  const valid = validPlots(state, plots);
  if (!seasonOk && !valid.some(isGreenhouseIndex)) {
    return fail(`${def.name} can't be planted in ${ctx.calendar.season}.`);
  }
  const seed = seedOf(crop);
  const done: number[] = [];
  let noSoil = false;
  for (const i of valid) {
    if (!seasonOk && !isGreenhouseIndex(i)) continue;
    const plot = plotAt(state, i)!;
    if (plot.state !== 'tilled') {
      noSoil ||= plot.state === 'untilled' || plot.state === 'dead';
      continue;
    }
    if (!plantOne(state, i, crop)) break;
    done.push(i);
  }
  if (done.length === 0) {
    if (countItem(state.inventory, seed) === 0) return fail(`You have no ${cropName(ctx.data, crop)} seeds.`);
    return fail(noSoil ? 'Till the soil first.' : 'Something is already growing here.');
  }
  ctx.events.push({ type: 'planted', crop, plots: done });
  return OK;
}

export type HarvestOutcome = 'harvested' | 'full' | 'notReady' | 'none';

/**
 * Harvests plot `index` if its crop is ready, rolling the yield with the seeded RNG. Regrowers go
 * back to stage 2; other crops leave the plot tilled. With the Auto-Seller the yield goes straight
 * to the Shipping Bin; otherwise, if it does not fit in the bag, the crop waits in the ground and
 * nothing (not even the RNG) changes. Shared by the Hand tool and the farmhand.
 */
export function harvestOne(state: GameState, ctx: SimContext, index: number, auto: boolean): HarvestOutcome {
  const plot = plotAt(state, index);
  if (!plot || plot.state !== 'planted' || plot.crop === null) return 'none';
  const crop = ctx.data.crops[plot.crop];
  if (!isReady(plot, ctx.data)) return 'notReady';
  const rngBefore = state.rngState;
  let qty = ctx.rng.int(crop.yield.min, crop.yield.max);
  // Farming perks: a chance of a double harvest (the RNG is only touched once the perk exists).
  if (ctx.mods.doubleHarvestChance > 0 && ctx.rng.next() < ctx.mods.doubleHarvestChance) qty *= 2;
  const stowed = stowHarvest(state, ctx.data, crop.id, qty);
  if (!stowed) {
    state.rngState = rngBefore;
    return 'full';
  }
  state.stats.cropsHarvested += qty;
  if (crop.regrowSec !== null) {
    plot.harvests += 1;
    plot.growthMs = 0;
  } else {
    Object.assign(plot, emptyPlot('tilled'), { waterMsLeft: plot.waterMsLeft });
  }
  ctx.events.push({ type: 'harvested', crop: crop.id, qty, plot: index, auto, shipped: stowed.bin });
  return 'harvested';
}

/** Hand: harvests ready crops (see `harvestOne`). */
export function harvestPlots(state: GameState, ctx: SimContext, plots: readonly number[]): ActionResult {
  let harvested = 0;
  let full: CropId | null = null;
  let notReady: { crop: CropId; ms: number } | null = null;
  const cov = coverageOf(state, ctx.data);
  for (const i of validPlots(state, plots)) {
    const outcome = harvestOne(state, ctx, i, false);
    if (outcome === 'harvested') harvested++;
    else if (outcome === 'full') full ??= plotAt(state, i)!.crop;
    else if (outcome === 'notReady' && !notReady) {
      const plot = plotAt(state, i)!;
      const crop = ctx.data.crops[plot.crop!];
      notReady = { crop: crop.id, ms: msUntilReady(plot, crop, ctx.mods, envFor(cov, i)) };
    }
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
 * is nothing obvious to do (a watered crop that is still growing, or a spot a sprinkler stands on).
 */
export function autoToolFor(
  state: GameState,
  data: GameData,
  season: SeasonId,
  plotIndex: number,
  seed: CropId | null,
): ConcreteTool | null {
  const plot = plotAt(state, plotIndex);
  if (!plot) return null;
  if (state.placed.length > 0 && occupiedPlots(state).has(plotIndex)) return null;
  const env = envFor(coverageOf(state, data), plotIndex);
  switch (plot.state) {
    case 'untilled':
    case 'dead':
      return 'hoe';
    case 'tilled': {
      const plantable =
        seed !== null &&
        (inSeason(data.crops[seed], season) || isGreenhouseIndex(plotIndex)) &&
        countItem(state.inventory, seedOf(seed)) > 0;
      if (plantable) return 'seeds';
      return plot.waterMsLeft < WATER_DURATION_MS && !env.sprinkled ? 'water' : 'seeds';
    }
    case 'planted':
      if (isReady(plot, data)) return 'hand';
      return isWatered(plot, env) ? null : 'water';
  }
}

/** Tiles a watering can or hoe covers per click at the player's upgrades (1, 3, 9 or 25). */
export function toolArea(state: GameState, data: GameData, tool: 'hoe' | 'water'): 1 | 3 | 9 | 25 {
  const id = tool === 'hoe' ? 'hoe' : 'watering_can';
  return data.upgrades[id]?.effect[upgradeLevel(state, id)]?.toolArea ?? 1;
}

/**
 * The field plots an area tool reaches when used on `plots`: 3 = a row of three, 9 = 3 × 3,
 * 25 = 5 × 5, all centred on each plot and clipped to that plot's field (it never jumps a fence).
 * Greenhouse plots stay single.
 */
export function expandToolArea(state: GameState, plots: readonly number[], area: 1 | 3 | 9 | 25): number[] {
  if (area === 1) return [...plots];
  const rx = area === 25 ? 2 : 1;
  const ry = area === 3 ? 0 : area === 9 ? 1 : 2;
  const out = new Set<number>();
  for (const i of plots) {
    const field = northFieldOf(i);
    const base = field ? FIELD_BASE[field] : 0;
    const { cols, rows } = field ? WORLD_LAYOUT.northFields[field].grid : state.farm.grid;
    const local = i - base;
    if (isGreenhouseIndex(i) || local < 0 || local >= cols * rows || (field && !state.farm.north[field])) {
      out.add(i);
      continue;
    }
    const c0 = local % cols;
    const r0 = Math.floor(local / cols);
    for (let r = Math.max(0, r0 - ry); r <= Math.min(rows - 1, r0 + ry); r++) {
      for (let c = Math.max(0, c0 - rx); c <= Math.min(cols - 1, c0 + rx); c++) out.add(base + r * cols + c);
    }
  }
  return [...out];
}

/** The placed object on plot `index` (any field), if one stands there. */
export function objectOnPlot(state: GameState, index: number): ReturnType<typeof objectAt> {
  if (index < 0 || isGreenhouseIndex(index)) return undefined;
  const field = northFieldOf(index);
  const base = field ? FIELD_BASE[field] : 0;
  const cols = field ? WORLD_LAYOUT.northFields[field].grid.cols : state.farm.grid.cols;
  const local = index - base;
  return objectAt(state, local % cols, Math.floor(local / cols), field ?? undefined);
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
  if (valid.length === 0) {
    const first = plots[0];
    const here = first !== undefined && plotAt(state, first) ? objectOnPlot(state, first) : undefined;
    return fail(
      here
        ? `A ${here.kind} stands here. Pick it up from placement mode to use this plot.`
        : 'That is not a plot.',
    );
  }
  let t: ConcreteTool | null = tool === 'auto' ? null : tool;
  if (tool === 'auto') {
    t = autoToolFor(state, ctx.data, ctx.calendar.season, valid[0]!, seed);
    if (t === null) {
      const plot = plotAt(state, valid[0]!)!;
      const crop = ctx.data.crops[plot.crop!];
      const env = envFor(coverageOf(state, ctx.data), valid[0]!);
      return fail(
        `The ${cropName(ctx.data, crop.id)} is growing (${formatDuration(msUntilReady(plot, crop, ctx.mods, env))} left).`,
      );
    }
  }
  switch (t) {
    case 'hoe':
      return tillPlots(
        state,
        ctx,
        expandToolArea(state, valid, toolArea(state, ctx.data, 'hoe')),
        false,
        valid,
      );
    case 'water':
      return waterPlots(state, ctx, expandToolArea(state, valid, toolArea(state, ctx.data, 'water')));
    case 'hand':
      return harvestPlots(state, ctx, valid);
    case 'seeds':
      if (seed === null) return fail('Choose a seed first.');
      return plantPlots(state, ctx, seed, valid);
    default:
      return fail('Choose a tool first.');
  }
}
