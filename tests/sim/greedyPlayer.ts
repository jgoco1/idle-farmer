// A greedy "active player" for the pacing check (BALANCE.md §11, phase 03 tuning notes). It plays
// the real game through `Game.dispatch` and `Game.advance`, looking at the farm every `reactionMs`:
//
//   harvest everything ready → sell it all at the Market → buy the next thing on the shopping list
//   if it leaves enough gold to replant → till → buy and plant the most profitable seed per plot
//   (accounting for the demand its own harvests will push down) → water.
//
// Phase 04 purchases (sprinklers, scarecrows, farmhand, planter, auto-seller, tool upgrades) are
// real: sprinklers and scarecrows are placed where they cover the most plots. River Access is a real
// expansion since phase 05. Active fishing is modelled as `fishPerMin` catches per real minute
// (BALANCE.md §6: "3 catches per real minute while actively fishing"), drawn from the real catch
// table at the best open location and sold with the crops; the default is 0 (a farming-only player).
// An active player keeps clicking as well, so automation shows up as saved effort and, once the
// whole farm is automated, as income that would continue while away.

import { Game } from '../../src/core/game';
import { createInitialState, type GameState } from '../../src/core/state';
import { GAME_DATA } from '../../src/data';
import { MARKET_CHANNEL } from '../../src/data/balance';
import {
  CROP_IDS,
  seedOf,
  type CropId,
  type ExpansionId,
  type ItemId,
  type MilestoneId,
  type UpgradeId,
} from '../../src/data/ids';
import { BUNDLE_IDS } from '../../src/data/quests';
import { bundleSlots, isBundleDone } from '../../src/systems/bundles';
import { countItem } from '../../src/systems/inventory';
import { isReady } from '../../src/systems/farming';
import {
  areaOf,
  areaOffsets,
  inGrid,
  objectAt,
  occupiedPlots,
  placementProblem,
  stockOf,
} from '../../src/systems/placement';
import { demandOf, demandStep, specialBonus } from '../../src/systems/market';
import { farmLevel, isUnlocked } from '../../src/systems/unlocks';
import { skillLevel } from '../../src/systems/skills';
import { chooseCatch, landCatch } from '../../src/systems/fishing';
import { canCook, ingredientValue, kitchenSlots } from '../../src/systems/cooking';
import type { RECIPE_IDS } from '../../src/data/ids';
import { unlockedLocations } from '../../src/systems/locations';
import { makeContext } from '../../src/core/sim';
import type { GameEvent } from '../../src/core/events';
import { runProgression } from '../../src/systems/progression';
import { recipeCards } from '../../src/systems/cooking';
import { upgradeCost, upgradeLevel } from '../../src/systems/upgrades';
import { at, NY } from '../helpers';

export type ShoppingItem =
  | { kind: 'expansion'; id: ExpansionId }
  | { kind: 'upgrade'; id: UpgradeId; key?: string }
  | { kind: 'virtual'; id: string; price: number; farmLevel: number };

const buyKey = (item: ShoppingItem): string => (item.kind === 'upgrade' ? (item.key ?? item.id) : item.id);

/** BALANCE.md §11 order: the first expansion, the first sprinkler, the farmhand, then bigger things. */
export const DEFAULT_SHOPPING_LIST: readonly ShoppingItem[] = [
  { kind: 'expansion', id: 'farm_1' },
  { kind: 'upgrade', id: 'sprinkler', key: 'sprinkler' },
  { kind: 'upgrade', id: 'farmhand', key: 'farmhand' },
  { kind: 'expansion', id: 'farm_2' },
  { kind: 'expansion', id: 'river' },
  { kind: 'expansion', id: 'farm_3' },
];

/**
 * The long run for the "whole farm automated" check (BALANCE.md §11): everything above, then the
 * planter, the auto-seller, more sprinklers and Sprinkler Tech, up to the full 8 × 6 field.
 */
export const AUTOMATION_SHOPPING_LIST: readonly ShoppingItem[] = [
  ...DEFAULT_SHOPPING_LIST,
  { kind: 'upgrade', id: 'seed_planter', key: 'seed_planter' },
  { kind: 'upgrade', id: 'sprinkler' },
  { kind: 'upgrade', id: 'sprinkler' },
  { kind: 'upgrade', id: 'farmhand', key: 'farmhand_2' },
  { kind: 'upgrade', id: 'farmhand', key: 'farmhand_3' },
  { kind: 'upgrade', id: 'sprinkler' },
  { kind: 'upgrade', id: 'seed_planter', key: 'seed_planter_2' },
  { kind: 'upgrade', id: 'sprinkler_tech', key: 'sprinkler_tech' },
  { kind: 'expansion', id: 'farm_4' },
  { kind: 'upgrade', id: 'sprinkler' },
  { kind: 'upgrade', id: 'sprinkler' },
  { kind: 'upgrade', id: 'sprinkler' },
  { kind: 'upgrade', id: 'sprinkler_tech', key: 'sprinkler_tech_2' },
  { kind: 'upgrade', id: 'sprinkler' },
  // Last: the bin pays once an hour, which makes an active player's income lumpy.
  { kind: 'upgrade', id: 'auto_seller', key: 'auto_seller' },
];

/**
 * The phase-07 run (`milestones: true`): the automation list with the Old Dock, the last farm step and
 * the greenhouse added where the milestones want them. A blocked item (a Farm Level, a bundle) waits;
 * everything behind it waits with it, as for a real player saving up for the next thing.
 */
export const MILESTONE_SHOPPING_LIST: readonly ShoppingItem[] = [
  { kind: 'expansion', id: 'farm_1' },
  { kind: 'upgrade', id: 'sprinkler', key: 'sprinkler' },
  { kind: 'upgrade', id: 'farmhand', key: 'farmhand' },
  { kind: 'expansion', id: 'farm_2' },
  { kind: 'expansion', id: 'river' },
  { kind: 'expansion', id: 'farm_3' },
  { kind: 'upgrade', id: 'seed_planter', key: 'seed_planter' },
  { kind: 'upgrade', id: 'sprinkler' },
  { kind: 'upgrade', id: 'sprinkler' },
  { kind: 'upgrade', id: 'farmhand', key: 'farmhand_2' },
  { kind: 'expansion', id: 'ocean' },
  { kind: 'upgrade', id: 'farmhand', key: 'farmhand_3' },
  { kind: 'upgrade', id: 'sprinkler' },
  { kind: 'upgrade', id: 'seed_planter', key: 'seed_planter_2' },
  { kind: 'expansion', id: 'farm_4' },
  { kind: 'upgrade', id: 'sprinkler_tech', key: 'sprinkler_tech' },
  { kind: 'upgrade', id: 'sprinkler' },
  { kind: 'upgrade', id: 'sprinkler' },
  { kind: 'upgrade', id: 'sprinkler' },
  { kind: 'upgrade', id: 'auto_seller', key: 'auto_seller' },
  { kind: 'upgrade', id: 'sprinkler_tech', key: 'sprinkler_tech_2' },
  { kind: 'upgrade', id: 'greenhouse', key: 'greenhouse' },
];

export interface PacingOptions {
  minutes: number;
  reactionMs: number; // how often the player looks at the farm and acts
  seed: number;
  shopping?: readonly ShoppingItem[];
  /** Only ever plant these crops (to measure a one-crop player). */
  onlyCrops?: readonly CropId[];
  /** Clear today's specials (to measure demand alone). */
  noSpecials?: boolean;
  /** Active fishing: catches per real minute while playing (0 = never fishes). */
  fishPerMin?: number;
  /**
   * Cooking (phase 06): after each harvest the player puts the best-margin dish they can make on
   * the stove. `sell` sells the dishes at the Market; `eat` eats every dish for its buff instead.
   */
  cooking?: 'sell' | 'eat';
  /**
   * Phase 07: play toward the milestones. The player fishes (1.5 catches a minute unless `fishPerMin`
   * says otherwise), cooks for the milestones (the highest tier its bag allows, keeping the
   * ingredients of the recipes it is working toward), eats one dish, gives what the Community Board
   * still needs to its bundles instead of selling it, and plants crops the bundles want. Its
   * shopping list defaults to MILESTONE_SHOPPING_LIST.
   */
  milestones?: boolean;
}

export interface PacingReport {
  firstHarvestMs: number | null;
  /** Longest stretch in the first 30 minutes with nothing useful to do. */
  longestIdleMs: number;
  /** When the longest idle stretch in the first 30 minutes started (ms). */
  longestIdleAt: number;
  /** When each shopping-list item was bought (ms), by key (`key` or id; the first purchase of an id). */
  bought: Record<string, number>;
  /** When farmhand ≥ 3, planter ≥ 2, auto-seller ≥ 1 and every field plot is sprinkled (ms), if ever. */
  automatedAt: number | null;
  /** When each farm level was reached (ms). */
  farmLevels: Record<number, number>;
  /** Snapshots every 5 minutes. */
  timeline: {
    min: number;
    gold: number;
    lifetimeGold: number;
    farmLevel: number;
    plots: number;
    cropsHarvested: number;
    /** Skill XP and milestones done, so a level curve can be tried against the run afterwards. */
    xp: { farming: number; fishing: number; cooking: number };
    milestonesDone: number;
  }[];
  /** When each milestone was completed (ms), by id. */
  milestones: Partial<Record<MilestoneId, number>>;
  /** When the first dish of each tier was cooked (ms). */
  firstDish: Partial<Record<1 | 2 | 3 | 4, number>>;
  /** When each bundle was completed (ms). */
  bundles: Record<string, number>;
  /** Gold that came from quest rewards (milestones and goals), and goals finished. */
  questGold: number;
  goalsDone: number;
  /** When each skill first reached each level (ms). */
  skillLevels: Record<string, Record<number, number>>;
  /** Units sold per item over the run. */
  sold: Partial<Record<string, number>>;
  /** Average price received per unit as a fraction of the base price (Market channel included). */
  avgPriceFraction: number;
  /** Catches made by the modelled active fishing. */
  fished: number;
  /** Dishes cooked and eaten, and the gold dishes fetched at the Market. */
  cooked: number;
  eaten: number;
  dishGold: number;
  /** Simulated minutes each buff type was active over the run. */
  buffMinutes: Record<string, number>;
  final: GameState;
}

const MIN = 60_000;
/** Replanting rounds of seeds the player keeps in stock once the Auto-Seller makes income hourly. */
const SEED_STOCK_CYCLES = 8;

/** Expected market value of one more unit of `crop` after `pending` more units are sold first. */
function unitValue(state: GameState, crop: CropId, pending: number): number {
  const base = GAME_DATA.crops[crop].basePrice;
  const d = Math.max(0.5, demandOf(state, crop) - pending * demandStep(base));
  return base * d * (1 + specialBonus(state, crop)) * MARKET_CHANNEL;
}

function avgYield(crop: CropId): number {
  const y = GAME_DATA.crops[crop].yield;
  return (y.min + y.max) / 2;
}

/**
 * Profit per plot-minute of planting `crop` now, given units already on their way to market. A seed
 * already in the bag costs nothing more.
 */
function plotScore(state: GameState, crop: CropId, pending: number, owned: boolean): number {
  const c = GAME_DATA.crops[crop];
  const y = avgYield(crop);
  const value = unitValue(state, crop, pending + y / 2) * y;
  const seed = owned ? 0 : c.seedPrice;
  if (c.regrowSec === null) return (value - seed) / (c.growSec / 60);
  // Regrowers: value over the next hour of harvests.
  const harvests = 1 + Math.floor((3600 - c.growSec) / c.regrowSec);
  return (value * harvests - seed) / 60;
}

function seedsOwned(state: GameState, crop: CropId): number {
  const seed = seedOf(crop);
  return state.inventory.slots.reduce((n, x) => n + (x?.item === seed ? x.qty : 0), 0);
}

/** The open plot where a new `kind` would cover the most plots not yet covered by its own kind. */
function bestSpot(
  s: GameState,
  kind: 'sprinkler' | 'scarecrow',
  standing = false,
): { col: number; row: number } | null {
  const { cols, rows } = s.farm.grid;
  const offsets = areaOffsets(areaOf(s, GAME_DATA, kind));
  const covered = new Set<number>();
  for (const o of s.placed.filter((x) => x.kind === kind)) {
    for (const [dc, dr] of areaOffsets(areaOf(s, GAME_DATA, kind)))
      covered.add((o.at.row + dr) * cols + o.at.col + dc);
  }
  const used = occupiedPlots(s);
  let best: { col: number; row: number } | null = null;
  let bestGain = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      // Crops in the way are harvested first, so any bare-or-planted plot is a candidate.
      const p = s.farm.plots[row * cols + col]!;
      if (p.state === 'planted' && !standing) continue; // first choice: somewhere free right now
      if (p.state !== 'planted' && placementProblem(s, kind, col, row) !== null) continue;
      if (p.state === 'planted' && (objectAt(s, col, row) || stockOf(s, kind) <= 0)) continue;
      let gain = 0;
      for (const [dc, dr] of offsets) {
        const c = col + dc;
        const r = row + dr;
        if (inGrid(s, c, r) && !covered.has(r * cols + c) && !used.has(r * cols + c)) gain++;
      }
      if (gain > bestGain) {
        bestGain = gain;
        best = { col, row };
      }
    }
  }
  return best;
}

/** BALANCE.md §11: farmhand L3, planter L2, auto-seller, and every open field plot sprinkled. */
export function fullyAutomated(s: GameState): boolean {
  if (
    upgradeLevel(s, 'farmhand') < 3 ||
    upgradeLevel(s, 'seed_planter') < 2 ||
    upgradeLevel(s, 'auto_seller') < 1
  )
    return false;
  const { cols, rows } = s.farm.grid;
  const covered = new Set<number>();
  const used = occupiedPlots(s);
  for (const o of s.placed.filter((x) => x.kind === 'sprinkler')) {
    for (const [dc, dr] of areaOffsets(areaOf(s, GAME_DATA, 'sprinkler')))
      covered.add((o.at.row + dr) * cols + o.at.col + dc);
  }
  for (let i = 0; i < cols * rows; i++) if (!used.has(i) && !covered.has(i)) return false;
  return true;
}

export function simulateGreedy(opts: PacingOptions): PacingReport {
  const start = at(NY, 2026, 1, 7, 10, 0);
  let t = start;
  const game = new Game(createInitialState(start, NY, opts.seed), { data: GAME_DATA, lc: NY, now: () => t });
  const shopping = [
    ...(opts.shopping ?? (opts.milestones ? MILESTONE_SHOPPING_LIST : DEFAULT_SHOPPING_LIST)),
  ];
  const fishPerMin = opts.fishPerMin ?? (opts.milestones ? 1.5 : 0);
  const cookingMode = opts.cooking ?? (opts.milestones ? 'sell' : undefined);
  let elapsedNow = 0;
  const report: PacingReport = {
    firstHarvestMs: null,
    longestIdleMs: 0,
    longestIdleAt: 0,
    bought: {},
    automatedAt: null,
    farmLevels: { 1: 0 },
    milestones: {},
    firstDish: {},
    bundles: {},
    questGold: 0,
    goalsDone: 0,
    skillLevels: { farming: { 1: 0 }, fishing: { 1: 0 }, cooking: { 1: 0 } },
    timeline: [],
    sold: {},
    avgPriceFraction: 0,
    fished: 0,
    cooked: 0,
    eaten: 0,
    dishGold: 0,
    buffMinutes: {},
    final: game.state,
  };
  let soldValue = 0;
  let soldBase = 0;
  game.bus.on('sold', (e) => {
    report.sold[e.item] = (report.sold[e.item] ?? 0) + e.qty;
    soldValue += e.gold;
    soldBase += e.qty * (GAME_DATA.items[e.item]?.basePrice ?? 0);
    if (GAME_DATA.items[e.item]?.category === 'dish') report.dishGold += e.gold;
  });
  game.bus.on('cooked', (e) => {
    report.cooked += 1;
    report.firstDish[e.tier] ??= elapsedNow;
  });
  game.bus.on('ate', () => (report.eaten += 1));
  game.bus.on('questDone', (e) => {
    if (e.kind === 'milestone') report.milestones[e.id as MilestoneId] = elapsedNow;
    else report.goalsDone += 1;
  });
  game.bus.on('goldEarned', (e) => {
    if (e.source === 'quest') report.questGold += e.amount;
  });
  game.bus.on('bundleCompleted', (e) => (report.bundles[e.bundle] = elapsedNow));

  let lastUseful = 0;
  let fishBudget = 0;
  let fished = 0;
  const endMs = opts.minutes * MIN;
  for (let elapsed = 0; elapsed <= endMs; elapsed += opts.reactionMs) {
    elapsedNow = elapsed;
    const s = game.state;
    if (opts.noSpecials) s.market.specials = [];
    const used = occupiedPlots(s);
    const all = s.farm.plots.map((_, i) => i).filter((i) => !used.has(i));
    let useful = false;
    const act = (r: { ok: boolean }): void => {
      if (r.ok) useful = true;
    };

    // Fish: N catches per real minute at the newest open water, then sell them with the crops.
    if (fishPerMin) {
      fishBudget += (fishPerMin * opts.reactionMs) / MIN;
      while (fishBudget >= 1) {
        fishBudget -= 1;
        const fev: GameEvent[] = [];
        const fctx = makeContext(s, GAME_DATA, game.calendar(), fev);
        // Milestone play visits every open water in turn (the recipes want pond and river fish alike).
        const waters = unlockedLocations(s);
        const location = opts.milestones ? waters[fished % waters.length]! : waters.at(-1)!;
        const pick = chooseCatch(s, fctx, location, 'active', 0.5);
        landCatch(s, fctx, pick.id, pick.sizeCm, location);
        runProgression(s, fctx); // what a `fishTick` action does: XP, milestones and goals hear the catch
        game.bus.emitAll(fev);
        fished += 1;
        useful = true;
      }
    }

    // Harvest and sell.
    const ready = all.filter((i) => isReady(s.farm.plots[i]!, GAME_DATA));
    if (ready.length > 0) {
      act(game.dispatch({ type: 'harvest', plots: ready }));
      report.firstHarvestMs ??= elapsed;
    }
    // Milestone play: give the Community Board what it still needs before anything is sold, and buy a
    // recipe card once it is comfortably affordable.
    const keep = new Map<ItemId, number>();
    if (opts.milestones) {
      for (const id of BUNDLE_IDS) {
        if (isBundleDone(s, id)) continue;
        for (const slot of bundleSlots(s, GAME_DATA, id)) {
          if (slot.done || countItem(s.inventory, slot.item) === 0) continue;
          act(game.dispatch({ type: 'donate', bundle: id, item: slot.item, qty: slot.need - slot.have }));
        }
      }
      for (const card of recipeCards(s, GAME_DATA)) {
        if (card.unlocked && s.gold >= card.price * 5)
          act(game.dispatch({ type: 'buyRecipe', recipe: card.id }));
      }
      // Ingredients of the best recipes it knows stay in the bag (its two highest tiers, T2 and up).
      const targets = s.kitchen.known
        .map((id) => GAME_DATA.recipes[id])
        .filter((r) => r.tier >= 2)
        .sort((x, y) => y.tier - x.tier)
        .slice(0, 2);
      for (const r of targets)
        for (const i of r.ingredients) keep.set(i.item, Math.max(keep.get(i.item) ?? 0, i.qty * 2));
    }
    // Cook: the best margin per second of stove time among the dishes the bag can make now (milestone play: the highest tier).
    if (cookingMode) {
      while (s.kitchen.queue.length < kitchenSlots(s, GAME_DATA)) {
        let best: (typeof RECIPE_IDS)[number] | null = null;
        let bestScore = 0;
        for (const id of s.kitchen.known) {
          const r = GAME_DATA.recipes[id];
          if (!canCook(s, r)) continue;
          const margin = (r.basePrice - ingredientValue(r, GAME_DATA.items)) / r.cookSec;
          const score = opts.milestones ? r.tier * 1000 + margin : margin;
          if (score > bestScore) {
            best = id;
            bestScore = score;
          }
        }
        if (!best || !game.dispatch({ type: 'cook', recipe: best }).ok) break;
        useful = true;
      }
    }
    for (const stack of [...s.inventory.slots]) {
      if (!stack) continue;
      const def = GAME_DATA.items[stack.item];
      const eatOne = opts.milestones && report.milestones.m08_first_buff === undefined;
      if (def?.category === 'dish' && (cookingMode === 'eat' || eatOne)) {
        for (let n = 0; n < stack.qty; n++) {
          const r = game.dispatch({
            type: 'eat',
            dish: stack.item as never,
            hearty: stack.hearty === true,
            replace: true,
          });
          if (r.ok) useful = true;
          if (eatOne) break;
        }
      } else if (def?.sellable) {
        const qty = stack.qty - (def.category === 'dish' ? 0 : (keep.get(stack.item) ?? 0));
        if (qty > 0) act(game.dispatch({ type: 'sell', item: stack.item, qty }));
      }
    }
    for (const b of s.buffs.active) {
      report.buffMinutes[b.type] =
        (report.buffMinutes[b.type] ?? 0) + Math.min(b.remainingMs, opts.reactionMs) / MIN;
    }

    // Shopping list: buy the next item if it leaves enough to replant every plot.
    const next = shopping[0];
    if (next) {
      // With the Auto-Seller gold only arrives once an hour, so the player keeps enough back to
      // replant the whole field several times between pickups.
      const restock = upgradeLevel(s, 'auto_seller') > 0 ? SEED_STOCK_CYCLES : 1;
      const reserve = 25 * s.farm.plots.length * 0.5 * restock;
      let price = Infinity;
      let can = false;
      if (next.kind === 'expansion') {
        const def = GAME_DATA.expansions[next.id];
        price = def.price;
        can = isUnlocked(s, def.requires);
      } else if (next.kind === 'upgrade') {
        const def = GAME_DATA.upgrades[next.id]!;
        price = upgradeCost(def, upgradeLevel(s, next.id));
        can = isUnlocked(s, def.requires);
      } else {
        price = next.price;
        can = farmLevel(s) >= next.farmLevel;
      }
      if (can && s.gold >= price + reserve) {
        if (next.kind === 'expansion') act(game.dispatch({ type: 'buyExpansion', id: next.id }));
        else if (next.kind === 'upgrade') act(game.dispatch({ type: 'buyUpgrade', id: next.id }));
        else {
          s.gold -= price;
          useful = true;
        }
        report.bought[buyKey(next)] ??= elapsed;
        report.bought[next.id] ??= elapsed;
        shopping.shift();
      }
    }

    // Put sprinklers and scarecrows where they cover the most plots that nothing covers yet.
    for (const kind of ['sprinkler', 'scarecrow'] as const) {
      while (stockOf(s, kind) > 0) {
        // A free plot first; only when there is none, wait for a crop to be ready and clear its plot.
        const spot = bestSpot(s, kind) ?? bestSpot(s, kind, true);
        if (!spot) break;
        const idx = spot.row * s.farm.grid.cols + spot.col;
        if (s.farm.plots[idx]!.state === 'planted') {
          if (!isReady(s.farm.plots[idx]!, GAME_DATA)) break; // wait for the crop, then clear the spot
          act(game.dispatch({ type: 'harvest', plots: [idx] }));
        }
        act(game.dispatch({ type: 'place', kind, col: spot.col, row: spot.row }));
      }
    }

    // Till, plant the best seeds, water.
    const untilled = all.filter((i) => ['untilled', 'dead'].includes(s.farm.plots[i]!.state));
    if (untilled.length > 0) act(game.dispatch({ type: 'till', plots: untilled }));
    const empty = all.filter((i) => s.farm.plots[i]!.state === 'tilled');
    if (empty.length > 0) {
      const cal = game.calendar();
      const crops = CROP_IDS.filter(
        (c) =>
          GAME_DATA.crops[c].seasons.includes(cal.season) &&
          isUnlocked(s, GAME_DATA.crops[c].unlock) &&
          (!opts.onlyCrops || opts.onlyCrops.includes(c)),
      );
      const wanted = new Map<CropId, number>();
      if (opts.milestones) {
        for (const id of BUNDLE_IDS) {
          if (isBundleDone(s, id)) continue;
          for (const slot of bundleSlots(s, GAME_DATA, id)) {
            if (GAME_DATA.crops[slot.item as CropId]) {
              const c = slot.item as CropId;
              wanted.set(c, (wanted.get(c) ?? 0) + slot.need - slot.have - countItem(s.inventory, c));
            }
          }
        }
      }
      const pending: Partial<Record<CropId, number>> = {};
      for (const p of s.farm.plots) if (p.crop) pending[p.crop] = (pending[p.crop] ?? 0) + avgYield(p.crop);
      for (const i of empty) {
        // Best crop we can plant now: one whose seed is in the bag or affordable.
        let best: CropId | null = null;
        let bestScore = 0;
        for (const c of crops) {
          const owned = seedsOwned(s, c) > 0;
          if (!owned && s.gold < GAME_DATA.crops[c].seedPrice) continue;
          let score = plotScore(s, c, pending[c] ?? 0, owned);
          // The Community Board wants some crops: plant them ahead of the rest until they are on their way.
          if (opts.milestones && (wanted.get(c) ?? 0) > (pending[c] ?? 0)) score = score * 4 + 100;
          if (score > bestScore) {
            best = c;
            bestScore = score;
          }
        }
        if (!best) break;
        if (seedsOwned(s, best) === 0) {
          // Stock up when gold comes in lumps (the bag is the planter's seed supply too).
          const stockUp = upgradeLevel(s, 'auto_seller') > 0 ? SEED_STOCK_CYCLES : 1;
          const price = GAME_DATA.crops[best].seedPrice;
          const qty = Math.max(1, Math.min(stockUp, Math.floor(s.gold / price)));
          if (!game.dispatch({ type: 'buySeeds', crop: best, qty }).ok) break;
        }
        act(game.dispatch({ type: 'plant', crop: best, plots: [i] }));
        pending[best] = (pending[best] ?? 0) + avgYield(best);
      }
    }
    const dry = all.filter(
      (i) => s.farm.plots[i]!.state !== 'untilled' && s.farm.plots[i]!.waterMsLeft === 0,
    );
    if (dry.length > 0) act(game.dispatch({ type: 'water', plots: dry }));

    if (useful) {
      if (elapsed <= 30 * MIN && elapsed - lastUseful > report.longestIdleMs) {
        report.longestIdleMs = elapsed - lastUseful;
        report.longestIdleAt = lastUseful;
      }
      lastUseful = elapsed;
    }
    const fl = farmLevel(s);
    report.farmLevels[fl] ??= elapsed;
    for (const skill of ['farming', 'fishing', 'cooking'] as const) {
      report.skillLevels[skill]![skillLevel(s, skill)] ??= elapsed;
    }
    if (report.automatedAt === null && fullyAutomated(s)) report.automatedAt = elapsed;
    if (elapsed % (5 * MIN) === 0) {
      report.timeline.push({
        min: elapsed / MIN,
        gold: s.gold,
        lifetimeGold: s.stats.lifetimeGold,
        farmLevel: fl,
        plots: s.farm.plots.length,
        cropsHarvested: s.stats.cropsHarvested,
        xp: {
          farming: s.progression.skills.farming.xp,
          fishing: s.progression.skills.fishing.xp,
          cooking: s.progression.skills.cooking.xp,
        },
        milestonesDone: s.progression.milestones.done.length,
      });
    }

    t += opts.reactionMs;
    game.advance(opts.reactionMs);
  }
  report.avgPriceFraction = soldBase > 0 ? soldValue / soldBase : 0;
  report.fished = fished;
  report.final = game.state;
  return report;
}
