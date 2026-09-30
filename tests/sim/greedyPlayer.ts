// A greedy "active player" for the pacing check (BALANCE.md §11, phase 03 tuning notes). It plays
// the real game through `Game.dispatch` and `Game.advance`, looking at the farm every `reactionMs`:
//
//   harvest everything ready → sell it all at the Market → buy the next thing on the shopping list
//   if it leaves enough gold to replant → till → buy and plant the most profitable seed per plot
//   (accounting for the demand its own harvests will push down) → water.
//
// Phase 04/05 purchases (the first sprinkler, the farmhand, River Access) do not exist yet. They are
// bought as *virtual* items: the gold is spent and the time recorded, with no effect. For a player
// who is watching the farm, a sprinkler or farmhand saves clicks rather than adding income, so this
// is a fair stand-in until phase 09's simulator replaces it.

import { Game } from '../../src/core/game';
import { createInitialState, type GameState } from '../../src/core/state';
import { GAME_DATA } from '../../src/data';
import { MARKET_CHANNEL } from '../../src/data/balance';
import { CROP_IDS, seedOf, type CropId, type ExpansionId, type UpgradeId } from '../../src/data/ids';
import { isReady } from '../../src/systems/farming';
import { demandOf, demandStep, specialBonus } from '../../src/systems/market';
import { farmLevel, isUnlocked } from '../../src/systems/unlocks';
import { upgradeCost, upgradeLevel } from '../../src/systems/upgrades';
import { at, NY } from '../helpers';

export type ShoppingItem =
  | { kind: 'expansion'; id: ExpansionId }
  | { kind: 'upgrade'; id: UpgradeId }
  | { kind: 'virtual'; id: string; price: number; farmLevel: number };

/** BALANCE.md §11 order: the first expansion, the first sprinkler, the farmhand, then bigger things. */
export const DEFAULT_SHOPPING_LIST: readonly ShoppingItem[] = [
  { kind: 'expansion', id: 'farm_1' },
  { kind: 'virtual', id: 'sprinkler', price: 300, farmLevel: 1 },
  { kind: 'virtual', id: 'farmhand', price: 800, farmLevel: 3 },
  { kind: 'expansion', id: 'farm_2' },
  { kind: 'virtual', id: 'river', price: 2000, farmLevel: 3 },
  { kind: 'expansion', id: 'farm_3' },
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
}

export interface PacingReport {
  firstHarvestMs: number | null;
  /** Longest stretch in the first 30 minutes with nothing useful to do. */
  longestIdleMs: number;
  /** When the longest idle stretch in the first 30 minutes started (ms). */
  longestIdleAt: number;
  /** When each shopping-list item was bought (ms), by id. */
  bought: Record<string, number>;
  /** When each farm level was reached (ms). */
  farmLevels: Record<number, number>;
  /** Snapshots every 5 minutes. */
  timeline: { min: number; gold: number; lifetimeGold: number; farmLevel: number; plots: number }[];
  /** Units sold per item over the run. */
  sold: Partial<Record<string, number>>;
  /** Average price received per unit as a fraction of the base price (Market channel included). */
  avgPriceFraction: number;
  final: GameState;
}

const MIN = 60_000;

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

export function simulateGreedy(opts: PacingOptions): PacingReport {
  const start = at(NY, 2026, 1, 7, 10, 0);
  let t = start;
  const game = new Game(createInitialState(start, NY, opts.seed), { data: GAME_DATA, lc: NY, now: () => t });
  const shopping = [...(opts.shopping ?? DEFAULT_SHOPPING_LIST)];
  const report: PacingReport = {
    firstHarvestMs: null,
    longestIdleMs: 0,
    longestIdleAt: 0,
    bought: {},
    farmLevels: { 1: 0 },
    timeline: [],
    sold: {},
    avgPriceFraction: 0,
    final: game.state,
  };
  let soldValue = 0;
  let soldBase = 0;
  game.bus.on('sold', (e) => {
    report.sold[e.item] = (report.sold[e.item] ?? 0) + e.qty;
    soldValue += e.gold;
    soldBase += e.qty * (GAME_DATA.items[e.item]?.basePrice ?? 0);
  });

  let lastUseful = 0;
  const endMs = opts.minutes * MIN;
  for (let elapsed = 0; elapsed <= endMs; elapsed += opts.reactionMs) {
    const s = game.state;
    if (opts.noSpecials) s.market.specials = [];
    const all = s.farm.plots.map((_, i) => i);
    let useful = false;
    const act = (r: { ok: boolean }): void => {
      if (r.ok) useful = true;
    };

    // Harvest and sell.
    const ready = all.filter((i) => isReady(s.farm.plots[i]!, GAME_DATA));
    if (ready.length > 0) {
      act(game.dispatch({ type: 'harvest', plots: ready }));
      report.firstHarvestMs ??= elapsed;
    }
    for (const stack of [...s.inventory.slots]) {
      if (stack && GAME_DATA.items[stack.item]?.sellable) {
        act(game.dispatch({ type: 'sell', item: stack.item, qty: stack.qty }));
      }
    }

    // Shopping list: buy the next item if it leaves enough to replant every plot.
    const next = shopping[0];
    if (next) {
      const reserve = 25 * s.farm.plots.length * 0.5;
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
        report.bought[next.id] = elapsed;
        shopping.shift();
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
      const pending: Partial<Record<CropId, number>> = {};
      for (const p of s.farm.plots) if (p.crop) pending[p.crop] = (pending[p.crop] ?? 0) + avgYield(p.crop);
      for (const i of empty) {
        // Best crop we can plant now: one whose seed is in the bag or affordable.
        let best: CropId | null = null;
        let bestScore = 0;
        for (const c of crops) {
          const owned = seedsOwned(s, c) > 0;
          if (!owned && s.gold < GAME_DATA.crops[c].seedPrice) continue;
          const score = plotScore(s, c, pending[c] ?? 0, owned);
          if (score > bestScore) {
            best = c;
            bestScore = score;
          }
        }
        if (!best) break;
        if (seedsOwned(s, best) === 0 && !game.dispatch({ type: 'buySeeds', crop: best, qty: 1 }).ok) break;
        act(game.dispatch({ type: 'plant', crop: best, plots: [i] }));
        pending[best] = (pending[best] ?? 0) + avgYield(best);
      }
    }
    const dry = all.filter((i) => s.farm.plots[i]!.state !== 'untilled' && s.farm.plots[i]!.waterMsLeft === 0);
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
    if (elapsed % (5 * MIN) === 0) {
      report.timeline.push({
        min: elapsed / MIN,
        gold: s.gold,
        lifetimeGold: s.stats.lifetimeGold,
        farmLevel: fl,
        plots: s.farm.plots.length,
      });
    }

    t += opts.reactionMs;
    game.advance(opts.reactionMs);
  }
  report.avgPriceFraction = soldBase > 0 ? soldValue / soldBase : 0;
  report.final = game.state;
  return report;
}
