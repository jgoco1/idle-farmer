// A simulated player (phase 09). One configurable brain plays every strategy bot: it looks at the
// farm every few seconds of a session and does what a keen player would, through `Game.dispatch`
// only (the same actions the UI sends), plus active fishing modelled as catches per real minute
// drawn from the real catch table (BALANCE.md §6: an attentive player lands about 3 a minute).
//
// One look: fish → harvest → give to the Community Board → buy recipe cards and try experiments →
// cook → eat for buffs → sell (keeping ingredients) → buy the next wanted upgrade → place sprinklers
// and scarecrows → till → plant the most profitable seed per plot → water. Before leaving it stocks
// seeds for the planter, ships what it would have sold (the bin pays 100% at the next pickup) and,
// if it keeps buffs up, eats.
//
// Grown from `tests/sim/greedyPlayer.ts` (phases 03–07), which it replaces.

import type { GameEvent } from '../../src/core/events';
import { makeContext } from '../../src/core/sim';
import type { GameState, PlacedKind } from '../../src/core/state';
import type { GameData } from '../../src/data';
import type { CropDef } from '../../src/data/types';
import {
  GREENHOUSE_BASE,
  MARKET_CHANNEL,
  OFFLINE_FULL_MS,
  OFFLINE_REDUCED_RATE,
} from '../../src/data/balance';
import {
  CROP_IDS,
  FRUIT_IDS,
  RECIPE_IDS,
  seedOf,
  treeOfFruit,
  type FruitId,
  type BuffType,
  type CropId,
  type DishId,
  type ExpansionId,
  type FishLocationId,
  type ParcelId,
  type ItemId,
  type RecipeId,
  type UpgradeId,
} from '../../src/data/ids';
import { BUNDLE_IDS } from '../../src/data/quests';
import { DECOR_IDS, TOWN_PROJECT_IDS, type DecorId, type TownProjectId } from '../../src/data/ids';
import { decorCopies } from './catalogue';
import { decorPlacementProblem, decorStatus, decorStock, ownedDecor } from '../../src/systems/decor';
import {
  currentStage,
  projectStagesDone,
  projectStatus,
  type StageStatus,
} from '../../src/systems/townProjects';
import { WORLD_COLS, WORLD_ROWS, WORLD_LAYOUT } from '../../src/data/world';
import { dishBuff, planEat } from '../../src/systems/buffs';
import { freeSpots, ripeTrees, saplingsInBag } from '../../src/systems/orchard';
import { animalCount, buildingOfKind, feedOf, storeCount, troughSize } from '../../src/systems/ranch';
import { SILO_RESERVE } from '../../src/data/balance';
import type { AnimalId, BuildingId } from '../../src/data/ids';
import { seasonOfDay } from '../../src/core/time';
import { bundleSlots, isBundleDone } from '../../src/systems/bundles';
import { canCook, ingredientValue, kitchenSlots, recipeCards } from '../../src/systems/cooking';
import { allPlotIndexes, canPullUp, isGreenhouseIndex, isReady, plotAt } from '../../src/systems/farming';
import { chooseCatch, landCatch } from '../../src/systems/fishing';
import { countItem, spaceFor } from '../../src/systems/inventory';
import { unlockedLocations } from '../../src/systems/locations';
import { demandOf, demandStep, specialBonus } from '../../src/systems/market';
import { computeModifiers } from '../../src/systems/modifiers';
import {
  areaOf,
  areaOffsets,
  coverageOf,
  inGrid,
  objectAt,
  occupiedPlots,
  placementProblem,
  stockOf,
} from '../../src/systems/placement';
import { runProgression } from '../../src/systems/progression';
import { isUnlocked } from '../../src/systems/unlocks';
import { purchaseBlock, requirementsFor, upgradeCost, upgradeLevel } from '../../src/systems/upgrades';
import { MIN, type SimRun } from './driver';

/** Something the player saves up for: an expansion, or an upgrade up to a level (a count, for placeables). */
export type Want =
  | { kind: 'expansion'; id: ExpansionId }
  | { kind: 'upgrade'; id: UpgradeId; level: number }
  | { kind: 'parcel'; id: ParcelId }; // v2 phase 01: the land parcels, after the v1 list

export interface Style {
  /** Active catches per real minute while playing (0 = never fishes). */
  fishPerMin: number;
  /** Fish every open water in turn (for bundles and recipes) rather than the newest one. */
  rotateWaters: boolean;
  /** `sell`: cook the best-margin dish and sell it; `eat`: also keep the buff slots full. */
  cook: 'none' | 'sell' | 'eat';
  /** Give the Community Board what it needs, and plant what it wants. */
  bundles: boolean;
  /** Buy recipe cards once they cost less than 1/`cardThrift` of the purse (0 = never). */
  cardThrift: number;
  /** Try the experiment recipes once the bag holds their ingredients. */
  experiments: boolean;
  /** What to save for, in order: the first unlocked one not yet owned is the goal. */
  shopping: readonly Want[];
}

const up = (id: UpgradeId, level: number): Want => ({ kind: 'upgrade', id, level });
const ex = (id: ExpansionId): Want => ({ kind: 'expansion', id });
const pa = (id: ParcelId): Want => ({ kind: 'parcel', id });
const sprinklers = (from: number, to: number): Want[] =>
  Array.from({ length: to - from + 1 }, (_, i) => up('sprinkler', from + i));

/** The farm-first order (BALANCE.md §11): expand, water, hire, automate, then everything else. */
export const FARM_SHOPPING: readonly Want[] = [
  ex('farm_1'),
  up('sprinkler', 1),
  up('farmhand', 1),
  ex('farm_2'),
  ex('river'),
  ex('farm_3'),
  up('seed_planter', 1),
  ...sprinklers(2, 3),
  up('farmhand', 2),
  up('farmhand', 3),
  up('backpack', 1),
  up('sprinkler', 4),
  up('seed_planter', 2),
  up('sprinkler_tech', 1),
  up('barn_storage', 1),
  ex('farm_4'),
  ...sprinklers(5, 7),
  up('auto_seller', 1),
  up('sprinkler_tech', 2),
  up('scarecrow', 1),
  up('seed_planter', 3),
  up('farmhand', 4),
  up('scarecrow', 2),
  up('greenhouse', 1),
  up('auto_seller', 2),
  ex('ocean'),
  up('backpack', 2),
  up('barn_storage', 2),
  up('farmhand', 5),
  up('greenhouse', 2),
  up('kitchen', 1),
  up('fishing_rod', 1),
  up('fish_trap', 2),
  up('scarecrow', 4),
  up('barn_storage', 4),
  up('backpack', 4),
  ...sprinklers(8, 9),
  // v2 (BALANCE.md §13.11): the land parcels in order, after the v1 wish list. Moving the orchard earlier
  // (after `farm_4`, or after the first scarecrow) puts it inside §13.10's day 2–4 but swings the phase 09
  // buff check and the Farmer's spending (BALANCE.md §13.12, v2-03 notes), so it stays here.
  pa('orchard'),
  pa('yard'),
  pa('meadow'),
];

/** The water-first order: rods, the river, traps and the dock early, then the farm list. */
export const FISH_SHOPPING: readonly Want[] = [
  up('fishing_rod', 1),
  ex('farm_1'),
  up('sprinkler', 1),
  ex('river'),
  up('fish_trap', 2),
  up('farmhand', 1),
  ex('farm_2'),
  up('fish_trap', 4),
  up('trap_collector', 1),
  up('fishing_rod', 2),
  ex('ocean'),
  up('fish_trap', 6),
  up('fishing_rod', 3),
  up('fish_trap', 9),
  ...FARM_SHOPPING,
];

/** The kitchen-first order: stove slots and speed early, then the farm list. */
export const CHEF_SHOPPING: readonly Want[] = [
  ex('farm_1'),
  up('sprinkler', 1),
  up('kitchen', 1),
  up('farmhand', 1),
  ex('farm_2'),
  up('backpack', 1),
  ex('river'),
  up('kitchen', 2),
  ex('farm_3'),
  up('kitchen', 3),
  ...FARM_SHOPPING,
];

/** Replanting rounds of seed kept in the bag once gold arrives in hourly lumps (Auto-Seller). */
const SEED_STOCK_CYCLES = 8;
/** Gold the player wants in hand before pulling up a regrower to plant something better. */
const PULL_UP_MIN_GOLD = 20_000;
/** Gold the player keeps before giving crops away to the Community Board. */
const DONATE_MIN_GOLD = 200;
/** Share of the gold above the seed reserve that a session spends on decorations and town projects (BALANCE.md §13.11). */
export const V2_SPEND_SHARE = 0.6;
/** Catches per real minute while fishing for the items a town project asks for. */
const ERRAND_FISH_PER_MIN = 3;
/** Decoration pieces bought in one go for the bulk pieces (paths and fences). */
const BULK_CHUNK = 10;
/** Where the bots put the buildings in the Old Paddock (the coop's trough sits right of its footprint). */
const RANCH_SPOTS: Readonly<Record<BuildingId, { col: number; row: number }>> = {
  coop: { col: 22, row: 9 },
  barn: { col: 27, row: 9 },
  silo: { col: 33, row: 9 },
};

/** What the ranch buys, in order (BALANCE.md §13.11): coop → hens → silo → barn → cows → Collecting Basket → levels. */
type RanchStep =
  | { kind: 'build'; id: BuildingId }
  | { kind: 'animals'; animal: AnimalId; count: number }
  | { kind: 'upgrade'; id: BuildingId; level: number }
  | { kind: 'basket' };
const RANCH_PLAN: readonly RanchStep[] = [
  { kind: 'build', id: 'coop' },
  { kind: 'animals', animal: 'chicken', count: 4 },
  { kind: 'build', id: 'silo' },
  { kind: 'build', id: 'barn' },
  { kind: 'animals', animal: 'cow', count: 2 },
  { kind: 'basket' },
  { kind: 'upgrade', id: 'coop', level: 2 },
  { kind: 'animals', animal: 'chicken', count: 8 },
  { kind: 'upgrade', id: 'barn', level: 2 },
  { kind: 'animals', animal: 'cow', count: 4 },
  { kind: 'upgrade', id: 'silo', level: 2 },
  { kind: 'upgrade', id: 'coop', level: 3 },
  { kind: 'animals', animal: 'chicken', count: 12 },
  { kind: 'upgrade', id: 'barn', level: 3 },
  { kind: 'animals', animal: 'cow', count: 6 },
];
/** Wheat and corn the player keeps in the bag for feed (and cooking) instead of selling. */
const FEED_CROP_KEEP = SILO_RESERVE + 10;

/** Seed gold kept back per plot when buying upgrades. */
const SEED_RESERVE_PER_PLOT = 12.5;

/** How much a buff type is worth to a style (0 = not worth a slot): gold first, then speed, then XP. */
function buffPriority(style: Style, s: GameState, type: BuffType): number {
  switch (type) {
    case 'sellPrice':
      return 6;
    case 'growth':
      return 5;
    case 'automationSpeed':
      return upgradeLevel(s, 'farmhand') > 0 || s.ranch.animals.length > 0 ? 4 : 0;
    case 'xp':
      return 2;
    case 'fishingLuck':
      return style.fishPerMin > 0 ? 3 : 0;
    case 'fishingSpeed':
      return style.fishPerMin > 0 ? 2 : s.fishing.traps.length > 0 ? 1 : 0;
    case 'cookSpeed':
      return style.cook !== 'none' ? 1 : 0;
  }
}

function avgYield(data: GameData, crop: CropId): number {
  const y = data.crops[crop].yield;
  return (y.min + y.max) / 2;
}

export class Brain {
  private fishBudget = 0;
  private fishedAt = 0;
  private lastPlayMs = 0;
  /** Real ms until the session ends, and how long the player will then be away. */
  private sessionLeftMs = Infinity;
  private awayMs = 0;
  private placeRetryAt = 0;
  private v2Turn = 0;
  private decorCursor = 0;
  private spiral: { col: number; row: number }[] | null = null;
  private errandBudget = 0;
  /** Crops the Auto-Seller is told to keep (a town project asks for them). */
  private kept = new Set<ItemId>();

  constructor(
    readonly style: Style,
    readonly data: GameData,
  ) {}

  /** Tells the brain how long it will keep playing and then be away (it plants and stocks for that). */
  plan(sessionMs: number, awayMs: number): void {
    this.sessionLeftMs = sessionMs;
    this.awayMs = awayMs;
  }

  // ---- one look at the farm

  look = (run: SimRun): boolean => {
    const s = run.state;
    const game = run.game;
    const data = this.data;
    const dt = run.playMs - this.lastPlayMs;
    this.sessionLeftMs -= dt;
    this.lastPlayMs = run.playMs;
    let useful = false;
    const act = (r: { ok: boolean }): boolean => {
      if (r.ok) useful = true;
      return r.ok;
    };

    // Fish: the real catch table, at a rate that the Quick Bite buff speeds up (the bite wait is a
    // third of the ~20 s a catch takes).
    if (this.style.fishPerMin > 0) {
      const speed = computeModifiers(s, data).fishingSpeedModifier;
      const rate = (this.style.fishPerMin * 20) / (13.5 + 6.5 / Math.max(0.1, speed));
      this.fishBudget += (rate * dt) / MIN;
      while (this.fishBudget >= 1) {
        this.fishBudget -= 1;
        const events: GameEvent[] = [];
        const ctx = makeContext(s, data, game.calendar(), events);
        const waters = unlockedLocations(s);
        const where = this.style.rotateWaters ? waters[this.fishedAt % waters.length]! : waters.at(-1)!;
        const pick = chooseCatch(s, ctx, where, 'active', 0.6);
        landCatch(s, ctx, pick.id, pick.sizeCm, where);
        runProgression(s, ctx); // what the `fishTick` action does after a catch
        game.bus.emitAll(events);
        this.fishedAt += 1;
        run.metrics.fished += 1;
        useful = true;
      }
    }
    // Traps: empty them when they hold something (no Trap Collector yet).
    if ((s.upgrades.trap_collector ?? 0) === 0) {
      for (const trap of s.fishing.traps) {
        if (trap.contents.length >= 3) act(game.dispatch({ type: 'collectTrap', id: trap.id }));
      }
    }

    const used = occupiedPlots(s);
    const plots = allPlotIndexes(s).filter((i) => !used.has(i));
    const ready = plots.filter((i) => isReady(plotAt(s, i)!, data));
    if (ready.length > 0) act(game.dispatch({ type: 'harvest', plots: ready }));

    const keep = this.keepList(s);
    // Gives to the Community Board, but never the harvest that would buy the next seeds.
    if (this.style.bundles && s.gold >= DONATE_MIN_GOLD) {
      for (const id of BUNDLE_IDS) {
        if (isBundleDone(s, id)) continue;
        for (const slot of bundleSlots(s, data, id)) {
          if (slot.done || countItem(s.inventory, slot.item, false) === 0) continue;
          act(game.dispatch({ type: 'donate', bundle: id, item: slot.item, qty: slot.need - slot.have }));
        }
      }
    }
    if (this.style.cardThrift > 0) {
      for (const card of recipeCards(s, data)) {
        if (card.unlocked && s.gold >= card.price * this.style.cardThrift)
          act(game.dispatch({ type: 'buyRecipe', recipe: card.id }));
      }
    }
    if (this.style.experiments) this.experiment(run);
    if (this.style.cook !== 'none') useful = this.cook(run) || useful;
    if (this.style.cook === 'eat') useful = this.eat(run, false) || useful;
    else if (s.stats.dishesEaten === 0) useful = this.eatAny(run) || useful; // the "eat a dish" milestone
    useful = this.sell(run, keep, false) || useful;
    useful = this.shop(run) || useful;
    this.keepProjectCrops(run);
    useful = this.errands(run, dt) || useful;
    useful = this.orchard(run) || useful;
    useful = this.ranch(run) || useful;
    useful = this.place(run) || useful;
    useful = this.farm(run) || useful;
    return useful;
  };

  /** Before an absence: stock seeds for the planter, ship everything that would be sold, eat. */
  leave(run: SimRun): void {
    const s = run.state;
    this.stockSeeds(run);
    if (this.style.cook === 'eat') this.eat(run, true);
    this.sell(run, this.keepList(s), true);
    this.spendV2(run); // last: what is left after the seeds the planter will need
  }

  // ---- pieces

  /** Ingredients to keep for bundles and for the best recipes the player cooks. */
  private keepList(s: GameState): Map<ItemId, number> {
    const keep = new Map<ItemId, number>();
    const add = (item: ItemId, n: number): void => {
      keep.set(item, Math.max(keep.get(item) ?? 0, n));
    };
    if (this.style.bundles) {
      for (const id of BUNDLE_IDS) {
        if (isBundleDone(s, id)) continue;
        for (const slot of bundleSlots(s, this.data, id))
          if (!slot.done) add(slot.item, slot.need - slot.have);
      }
    }
    for (const w of this.projectWants(s)) add(w.item, w.qty);
    for (const w of this.cropErrands(s)) add(w.item, w.qty);
    for (const [item, qty] of this.fruitStock(s)) add(item, qty);
    // Wheat and corn for the animals' feed (and the silo's reserve) stay in the bag.
    if (s.ranch.animals.some((a) => a.kind === 'cow')) add('wheat', FEED_CROP_KEEP);
    if (s.ranch.animals.some((a) => a.kind === 'chicken')) add('corn', FEED_CROP_KEEP);
    if (this.style.cook !== 'none') {
      const slots = kitchenSlots(s, this.data);
      const targets = s.kitchen.known
        .map((id) => this.data.recipes[id])
        .filter((r) => r.tier >= 2)
        .sort((a, b) => b.tier - a.tier || b.basePrice - a.basePrice)
        .slice(0, 2 + slots);
      for (const r of targets) for (const i of r.ingredients) add(i.item, i.qty * (1 + slots));
    }
    return keep;
  }

  private experiment(run: SimRun): void {
    const s = run.state;
    for (const id of RECIPE_IDS) {
      const r = this.data.recipes[id];
      if (r.discovery.kind !== 'experiment' || s.kitchen.known.includes(id)) continue;
      if (r.ingredients.every((i) => countItem(s.inventory, i.item, false) > 0)) {
        run.game.dispatch({ type: 'experiment', items: r.ingredients.map((i) => i.item) });
      }
    }
  }

  /** Fills the stove: highest margin per second (or, keeping buffs up, the highest tier first). */
  private cook(run: SimRun): boolean {
    const s = run.state;
    let useful = false;
    // What the Community Board still needs is not cooked.
    const reserved = new Map<ItemId, number>();
    if (this.style.bundles) {
      for (const id of BUNDLE_IDS) {
        if (isBundleDone(s, id)) continue;
        for (const slot of bundleSlots(s, this.data, id))
          if (!slot.done) reserved.set(slot.item, (reserved.get(slot.item) ?? 0) + slot.need - slot.have);
      }
    }
    for (const [item, qty] of this.fruitStock(s)) reserved.set(item, (reserved.get(item) ?? 0) + qty); // for the town's later stages
    const spare = (item: ItemId): number => countItem(s.inventory, item, false) - (reserved.get(item) ?? 0);
    while (s.kitchen.queue.length < kitchenSlots(s, this.data)) {
      let best: RecipeId | null = null;
      let bestScore = 0;
      for (const id of s.kitchen.known) {
        const r = this.data.recipes[id];
        if (!canCook(s, r) || r.ingredients.some((i) => spare(i.item) < i.qty)) continue;
        const margin = (r.basePrice - ingredientValue(r, this.data.items)) / r.cookSec;
        // The highest tier first (it pays best and levels Cooking); keeping buffs up, a dish whose buff
        // earns gold (Silver Tongue, Green Thumb) ahead of the others of its tier; then the margin.
        const goldBuff = r.buff === 'sellPrice' || r.buff === 'growth';
        const score = r.tier * 1000 + (this.style.cook === 'eat' && goldBuff ? 500 : 0) + margin;
        if (score > bestScore) {
          best = id;
          bestScore = score;
        }
      }
      if (!best || !run.game.dispatch({ type: 'cook', recipe: best }).ok) break;
      useful = true;
    }
    return useful;
  }

  /**
   * Keeps buffs up: eats the dish whose buff is worth most into a free slot, to refresh a buff that is
   * about to run out, or in place of a less useful buff. `leaving`: top everything up.
   */
  private eat(run: SimRun, leaving: boolean): boolean {
    const s = run.state;
    const worth = (d: { dish: DishId; hearty: boolean }): number =>
      buffPriority(this.style, s, this.data.recipes[d.dish].buff) * 10 + this.data.recipes[d.dish].tier;
    const dishes = s.inventory.slots
      .filter(
        (x): x is NonNullable<typeof x> => x !== null && this.data.recipes[x.item as DishId] !== undefined,
      )
      .map((x) => ({ dish: x.item as DishId, hearty: x.hearty === true }))
      .sort((a, b) => worth(b) - worth(a) || Number(b.hearty) - Number(a.hearty));
    let ate = false;
    const mods = computeModifiers(s, this.data);
    for (const d of dishes) {
      const r = this.data.recipes[d.dish];
      const priority = buffPriority(this.style, s, r.buff);
      if (priority === 0) continue;
      const plan = planEat(s, this.data, d.dish);
      const buff = dishBuff(this.data, d.dish, d.hearty, mods.buffDurationBonus);
      let replace = false;
      if (plan.kind === 'refresh') {
        const e = plan.existing;
        const stronger = buff.magnitude > e.magnitude;
        const runningOut = e.remainingMs < (leaving ? buff.durationMs / 2 : 60_000);
        if (!stronger && !runningOut) continue;
      } else if (plan.kind === 'replace') {
        if (buffPriority(this.style, s, plan.existing.type) >= priority) continue;
        replace = true;
      }
      if (run.game.dispatch({ type: 'eat', dish: d.dish, hearty: d.hearty, replace }).ok) ate = true;
    }
    return ate;
  }

  /** Eats one dish of any kind (for the "eat a dish" milestone). */
  private eatAny(run: SimRun): boolean {
    const dish = run.state.inventory.slots.find((x) => x && this.data.recipes[x.item as DishId]);
    if (!dish) return false;
    return run.game.dispatch({ type: 'eat', dish: dish.item as DishId, replace: true }).ok;
  }

  /**
   * Sells everything sellable except what is kept (and, when keeping buffs up, three of each dish).
   * `ship`: into the bin instead (100% at the next pickup; for leaving).
   */
  private sell(run: SimRun, keep: Map<ItemId, number>, ship: boolean): boolean {
    const s = run.state;
    let useful = false;
    const seen = new Set<ItemId>();
    for (const stack of [...s.inventory.slots]) {
      if (!stack || seen.has(stack.item)) continue;
      seen.add(stack.item);
      const def = this.data.items[stack.item];
      if (!def?.sellable) continue;
      // Keeping buffs up: two of each dish worth eating stay in the bag (more would crowd out seeds).
      const hold =
        def.category === 'dish'
          ? Math.max(
              this.style.cook === 'eat' &&
                buffPriority(this.style, s, this.data.recipes[stack.item as DishId].buff) >= 2
                ? 2
                : 0,
              this.projectWants(s).find((w) => w.item === stack.item)?.qty ?? 0,
            )
          : (keep.get(stack.item) ?? 0);
      const qty = countItem(s.inventory, stack.item) - hold;
      if (qty <= 0) continue;
      const r = ship
        ? run.game.dispatch({ type: 'ship', item: stack.item, qty })
        : run.game.dispatch({ type: 'sell', item: stack.item, qty });
      if (r.ok) useful = true;
    }
    return useful;
  }

  /** Price and availability of a want, or null when it is owned or cannot be bought yet. */
  private offer(s: GameState, w: Want): number | null {
    if (w.kind === 'parcel') {
      if (s.land.parcels.includes(w.id)) return null;
      const def = this.data.parcels[w.id];
      return isUnlocked(s, def.requires, this.data) ? def.price : null;
    }
    if (w.kind === 'expansion') {
      if (s.expansions.includes(w.id)) return null;
      const def = this.data.expansions[w.id];
      return isUnlocked(s, def.requires) ? def.price : null;
    }
    const def = this.data.upgrades[w.id]!;
    const level = upgradeLevel(s, w.id);
    if (level >= w.level || level >= def.max) return null;
    if (!isUnlocked(s, requirementsFor(def, level)) || purchaseBlock(s, this.data, w.id)) return null;
    return upgradeCost(def, level);
  }

  private shop(run: SimRun): boolean {
    const s = run.state;
    let useful = false;
    for (let guard = 0; guard < 4; guard++) {
      let target: { want: Want; price: number } | null = null;
      for (const want of this.style.shopping) {
        const price = this.offer(s, want);
        if (price !== null) {
          target = { want, price };
          break;
        }
      }
      if (!target) return useful;
      const restock = upgradeLevel(s, 'auto_seller') > 0 ? SEED_STOCK_CYCLES : 1;
      const reserve = SEED_RESERVE_PER_PLOT * s.farm.plots.length * restock;
      if (s.gold < target.price + reserve) return useful;
      const w = target.want;
      const r =
        w.kind === 'expansion'
          ? run.game.dispatch({ type: 'buyExpansion', id: w.id })
          : w.kind === 'parcel'
            ? run.game.dispatch({ type: 'buyParcel', parcel: w.id })
            : run.game.dispatch({ type: 'buyUpgrade', id: w.id });
      if (!r.ok) return useful;
      useful = true;
    }
    return useful;
  }

  // ---- v2 phase 03: the orchard (BALANCE.md §13.11)

  /**
   * Picks ripe trees, then plants while there is a free spot and the gold (above the seed reserve) allows: first a
   * tree that bears in the season it will mature in (one of each kind, cheapest first: the quickest payback),
   * then the two-season trees until the spots are full.
   */
  private orchard(run: SimRun): boolean {
    const s = run.state;
    if (!s.land.parcels.includes('orchard')) return false;
    const game = run.game;
    let useful = false;
    for (const t of ripeTrees(s)) useful = game.dispatch({ type: 'pickTree', id: t.id }).ok || useful;
    const restock = upgradeLevel(s, 'auto_seller') > 0 ? SEED_STOCK_CYCLES : 1;
    const reserve = SEED_RESERVE_PER_PLOT * s.farm.plots.length * restock;
    for (let guard = 0; guard < 10; guard++) {
      const spots = freeSpots(s, this.data);
      if (spots.length === 0) break;
      const cal = game.calendar();
      const planted = (f: FruitId): number => s.orchard.trees.filter((t) => t.tree === treeOfFruit(f)).length;
      const price = (f: FruitId): number => this.data.trees[treeOfFruit(f)].saplingPrice;
      const bearsOnArrival = (f: FruitId): boolean => {
        const def = this.data.trees[treeOfFruit(f)];
        return def.seasons.includes(seasonOfDay(cal, cal.dayIndex + def.matureDays));
      };
      const byPrice = (a: FruitId, b: FruitId): number => price(a) - price(b);
      const fresh = FRUIT_IDS.filter((f) => planted(f) === 0 && bearsOnArrival(f)).sort(byPrice);
      const twice = FRUIT_IDS.filter(
        (f) => this.data.trees[treeOfFruit(f)].seasons.length > 1 && planted(f) < 2,
      )
        .filter(bearsOnArrival)
        .sort(byPrice);
      const held = FRUIT_IDS.find((f) => saplingsInBag(s, f) > 0);
      const pick = held ?? fresh[0] ?? twice[0]; // a spot waits for a tree that suits its season rather than a third peach
      if (!pick) break;
      if (saplingsInBag(s, pick) === 0) {
        if (s.gold < price(pick) + reserve) break;
        if (!game.dispatch({ type: 'buySapling', fruit: pick, qty: 1 }).ok) break;
      }
      if (!game.dispatch({ type: 'plantTree', fruit: pick, spot: spots[0]! }).ok) break;
      useful = true;
    }
    return useful;
  }

  // ---- v2 phase 04: the ranch (BALANCE.md §13.11)

  /** The price of the next ranch purchase and what buys it, or null when the plan is done or the next step is not open. */
  private nextRanchStep(
    s: GameState,
  ): { price: number; buy: () => { type: string } & Record<string, unknown> } | null {
    for (const step of RANCH_PLAN) {
      if (step.kind === 'build') {
        if (buildingOfKind(s, step.id)) continue;
        const lvl = this.data.buildings[step.id].levels[0]!;
        if (!isUnlocked(s, lvl.requires, this.data)) return null;
        const at = RANCH_SPOTS[step.id];
        return { price: lvl.price, buy: () => ({ type: 'buildBuilding', building: step.id, ...at }) };
      }
      if (step.kind === 'upgrade') {
        const b = buildingOfKind(s, step.id);
        if (!b) return null;
        if (b.level >= step.level) continue;
        return {
          price: this.data.buildings[step.id].levels[b.level]!.price,
          buy: () => ({ type: 'upgradeBuilding', id: b.id }),
        };
      }
      if (step.kind === 'basket') {
        if (upgradeLevel(s, 'ranch_collector') > 0) continue;
        const def = this.data.upgrades.ranch_collector!;
        if (!isUnlocked(s, requirementsFor(def, 0), this.data)) return null;
        return { price: upgradeCost(def, 0), buy: () => ({ type: 'buyUpgrade', id: 'ranch_collector' }) };
      }
      const home = buildingOfKind(s, this.data.animals[step.animal].building);
      if (!home) return null;
      if (animalCount(s, home.id) >= step.count) continue;
      return {
        price: this.data.animals[step.animal].price,
        buy: () => ({ type: 'buyAnimal', animal: step.animal, building: home.id }),
      };
    }
    return null;
  }

  /** Makes feed from spare wheat or corn, buys it only when a trough is nearly dry, and fills the trough. */
  private feed(run: SimRun, buildingId: number, reserve: number): boolean {
    const s = run.state;
    const b = s.ranch.buildings.find((x) => x.id === buildingId)!;
    const feed = feedOf(this.data, b);
    if (!feed) return false;
    const size = troughSize(s, this.data, b);
    const need = size - b.trough;
    if (need <= 0) return false;
    const def = this.data.feeds[feed];
    let have = countItem(s.inventory, feed);
    if (have < need) {
      const spare = countItem(s.inventory, def.from) - FEED_CROP_KEEP;
      const units = Math.min(spare, Math.ceil((need - have) / def.perUnit));
      if (units > 0) run.game.dispatch({ type: 'makeFeed', feed, qty: units });
      have = countItem(s.inventory, feed);
    }
    if (have < need && b.trough * 4 < size) {
      const buy = Math.min(need - have, Math.floor(Math.max(0, s.gold - reserve) / (def.buyPrice * 4)));
      if (buy > 0) run.game.dispatch({ type: 'buyFeed', feed, qty: buy });
    }
    return run.game.dispatch({ type: 'fillTrough', building: buildingId }).ok;
  }

  /** Collects, feeds and, with gold above the seed reserve, buys the next step of the ranch plan. */
  private ranch(run: SimRun): boolean {
    const s = run.state;
    if (!s.land.parcels.includes('yard')) return false;
    let useful = false;
    const restock = upgradeLevel(s, 'auto_seller') > 0 ? SEED_STOCK_CYCLES : 1;
    const reserve = SEED_RESERVE_PER_PLOT * s.farm.plots.length * restock;
    for (const b of s.ranch.buildings) {
      if (!this.data.buildings[b.kind].houses) continue;
      if (storeCount(b) > 0 && run.game.dispatch({ type: 'collectBuilding', building: b.id }).ok)
        useful = true;
      if (animalCount(s, b.id) > 0 && this.feed(run, b.id, reserve)) useful = true;
    }
    return useful;
  }

  /**
   * Buys the next step of the ranch plan if the gold above `keep` pays for it. Returns the gold spent. It is one of the
   * three things `spendV2` takes turns at (the ranch, a project's gold, decorations), so the animals do not starve the
   * town of gold, nor the town the animals.
   */
  private ranchOne(run: SimRun, keep: number): number {
    const s = run.state;
    if (!s.land.parcels.includes('yard')) return 0;
    const next = this.nextRanchStep(s);
    if (!next || s.gold < next.price + keep) return 0;
    const before = s.gold;
    return run.game.dispatch(next.buy() as never).ok ? before - s.gold : 0;
  }

  // ---- v2 phase 02: decorations and town projects (BALANCE.md §13.11)

  /** What the open projects' current stages still ask for in items, and the bag does not hold. */
  private projectWants(s: GameState): { item: ItemId; qty: number }[] {
    const out: { item: ItemId; qty: number }[] = [];
    for (const id of TOWN_PROJECT_IDS) {
      if (projectStatus(s, this.data, id) !== 'open') continue;
      const stage = currentStage(s, this.data, id);
      // The player gathers items once the gold for the stage is in (the town waits on them, not on gold).
      if (!stage || stage.goldHave < stage.goldNeed) continue;
      for (const it of stage.items) if (!it.done) out.push({ item: it.item, qty: it.need - it.have });
    }
    return out.slice(0, 6);
  }

  /**
   * A few of a seasonal crop that an open project's current stage asks for (the bandstand's ten pumpkins). A player
   * plants and keeps these before the stage's gold is in, because the crop only grows in its season and the stage
   * would otherwise wait a year for it.
   */
  private cropErrands(s: GameState): { item: ItemId; qty: number }[] {
    const out: { item: ItemId; qty: number }[] = [];
    for (const id of TOWN_PROJECT_IDS) {
      const def = this.data.townProjects[id];
      for (let i = projectStagesDone(s, this.data, id); i < def.stages.length; i++) {
        for (const it of def.stages[i]!.items) {
          const crop = this.data.crops[it.item as CropId] as CropDef | undefined;
          if (!crop || it.qty > 20 || crop.seasons.some((x) => x === 'spring' || x === 'winter')) continue;
          if (!out.some((w) => w.item === it.item)) out.push({ item: it.item, qty: it.qty });
        }
      }
    }
    return out
      .filter((w) => countItem(s.inventory, w.item) < w.qty)
      .map((w) => ({ ...w, qty: w.qty - countItem(s.inventory, w.item) }));
  }

  /**
   * Fruit that the unfinished projects will ask for in later stages (the bakery's apples, the hall's persimmons).
   * Fruit only grows in its seasons, so a player keeps what the trees give rather than selling it and waiting a year.
   */
  private fruitStock(s: GameState): Map<ItemId, number> {
    const out = new Map<ItemId, number>();
    for (const id of TOWN_PROJECT_IDS) {
      const def = this.data.townProjects[id];
      for (let i = projectStagesDone(s, this.data, id); i < def.stages.length; i++)
        for (const it of def.stages[i]!.items)
          if (['fruit', 'animal'].includes(this.data.items[it.item]?.category ?? ''))
            out.set(it.item, Math.max(out.get(it.item) ?? 0, it.qty));
    }
    return out;
  }

  /** Switches the Auto-Seller off for the crops a project asks for, and back on when it no longer does. */
  private keepProjectCrops(run: SimRun): void {
    const need = new Set<ItemId>([
      ...[...this.projectWants(run.state), ...this.cropErrands(run.state)]
        .filter((w) => w.item in this.data.crops)
        .map((w) => w.item),
      ...this.fruitStock(run.state).keys(),
    ]);
    for (const item of need) {
      if (this.kept.has(item)) continue;
      run.game.dispatch({ type: 'setAutoSell', item, on: false });
      this.kept.add(item);
    }
    for (const item of [...this.kept]) {
      if (need.has(item)) continue;
      run.game.dispatch({ type: 'setAutoSell', item, on: true });
      this.kept.delete(item);
    }
  }

  /** Free tiles in a spiral out from the farmhouse, then the meadow; the orchard and paddock are kept for trees and animals. */
  private tiles(): { col: number; row: number }[] {
    if (this.spiral) return this.spiral;
    const home: { col: number; row: number; d: number }[] = [];
    const meadow: { col: number; row: number; d: number }[] = [];
    const m = WORLD_LAYOUT.regions.find((r) => r.id === 'meadow')!.rect;
    for (let row = 0; row < WORLD_ROWS; row++)
      for (let col = 0; col < WORLD_COLS; col++) {
        if (col < 20 && row < 12) home.push({ col, row, d: Math.hypot(col - 2.5, row - 2) });
        else if (col >= m.col && col < m.col + m.cols && row >= m.row && row < m.row + m.rows)
          meadow.push({ col, row, d: Math.hypot(col - m.col, row - m.row) });
      }
    const order = (
      a: { d: number; row: number; col: number },
      b: { d: number; row: number; col: number },
    ): number => a.d - b.d || a.row - b.row || a.col - b.col;
    this.spiral = [...home.sort(order), ...meadow.sort(order)].map(({ col, row }) => ({ col, row }));
    return this.spiral;
  }

  /** Puts every piece in the stock on the first free tile of the spiral. */
  private placeDecor(run: SimRun): boolean {
    const s = run.state;
    let useful = false;
    const tiles = this.tiles();
    for (const id of DECOR_IDS) {
      if (this.data.decor[id].kind !== 'place') continue;
      while (decorStock(s, this.data, id) > 0) {
        let placed = false;
        for (let i = this.decorCursor; i < tiles.length; i++) {
          const t = tiles[i]!;
          if (decorPlacementProblem(s, this.data, id, t.col, t.row) !== null) continue;
          if (run.game.dispatch({ type: 'placeDecor', decor: id, col: t.col, row: t.row }).ok) {
            placed = true;
            useful = true;
            this.decorCursor = i;
            break;
          }
        }
        if (!placed) break; // the land or the slots are full
      }
    }
    return useful;
  }

  /** The next decoration to buy: the cheapest unowned piece, then counted copies, then bulk paths and fences, then the farmhouse. */
  private nextDecor(s: GameState): { id: DecorId; qty: number } | null {
    const open = DECOR_IDS.filter((id) => decorStatus(s, this.data, id).unlocked);
    const byPrice = (a: DecorId, b: DecorId): number => this.data.decor[a].price - this.data.decor[b].price;
    const placeable = open.filter((id) => this.data.decor[id].kind === 'place').sort(byPrice);
    const first = placeable.find((id) => ownedDecor(s, id) === 0 && !this.data.decor[id].autotile);
    if (first) return { id: first, qty: 1 };
    const copies = placeable.find(
      (id) => !this.data.decor[id].autotile && ownedDecor(s, id) < decorCopies(this.data, id),
    );
    if (copies) return { id: copies, qty: 1 };
    const bulk = placeable.find((id) => ownedDecor(s, id) < decorCopies(this.data, id));
    if (bulk)
      return { id: bulk, qty: Math.min(BULK_CHUNK, decorCopies(this.data, bulk) - ownedDecor(s, bulk)) };
    const house = open
      .filter((id) => this.data.decor[id].kind !== 'place' && ownedDecor(s, id) === 0)
      .sort(byPrice)[0];
    return house ? { id: house, qty: 1 } : null;
  }

  /** Applies the best owned farmhouse pieces (the newest paint, roof and the loft). */
  private styleHouse(run: SimRun): void {
    const s = run.state;
    const owned = (kind: string): DecorId[] =>
      DECOR_IDS.filter((id) => this.data.decor[id].kind === kind && ownedDecor(s, id) > 0);
    const paint = owned('paint').at(-1);
    const roof = owned('roof').at(-1);
    const loft = ownedDecor(s, 'farmhouse_loft') > 0;
    const f = s.decor.farmhouse;
    if ((paint && f.paint !== paint) || (roof && f.roof !== roof) || (loft && !f.loft))
      run.game.dispatch({ type: 'styleFarmhouse', paint, roof, loft: loft || undefined });
  }

  /**
   * Spends up to V2_SPEND_SHARE of the gold above the seed reserve (and above the next parcel's price) once the
   * v1 wish list is done: alternately on the next open project stage's gold and items, and on decorations.
   */
  private spendV2(run: SimRun): boolean {
    const s = run.state;
    let hold = 0;
    for (const want of this.style.shopping) {
      const price = this.offer(s, want);
      if (price === null) continue;
      if (want.kind !== 'parcel') return false; // still saving for the v1 list
      hold = price;
      break;
    }
    const restock = upgradeLevel(s, 'auto_seller') > 0 ? SEED_STOCK_CYCLES : 1;
    const reserve = SEED_RESERVE_PER_PLOT * s.farm.plots.length * restock;
    let budget = Math.floor(Math.max(0, s.gold - reserve - hold) * V2_SPEND_SHARE);
    let useful = this.placeDecor(run);
    this.styleHouse(run);
    // Items the bag holds go to the project at once (they are not gold).
    for (const id of TOWN_PROJECT_IDS) {
      if (projectStatus(s, this.data, id) !== 'open') continue;
      for (const it of currentStage(s, this.data, id)?.items ?? []) {
        if (!it.done && countItem(s.inventory, it.item, false) > 0)
          useful =
            run.game.dispatch({ type: 'donateProject', project: id, item: it.item, qty: it.need - it.have })
              .ok || useful;
      }
    }
    for (let guard = 0; guard < 8 && budget > 0; guard++) {
      const turn = this.v2Turn++ % 3;
      let spent = 0;
      if (turn === 0) spent = this.ranchOne(run, reserve + hold);
      if (spent === 0 && turn !== 2) spent = this.donateGold(run, budget);
      if (spent === 0) spent = this.buyDecor(run, budget);
      if (spent === 0 && turn === 2) spent = this.donateGold(run, budget);
      if (spent === 0) break;
      budget -= spent;
      useful = true;
    }
    return useful;
  }

  /** Gives gold to the first open project whose current stage still needs some. Returns what was given. */
  private donateGold(run: SimRun, budget: number): number {
    const s = run.state;
    for (const id of TOWN_PROJECT_IDS) {
      if (projectStatus(s, this.data, id) !== 'open') continue;
      const stage: StageStatus | null = currentStage(s, this.data, id);
      if (!stage || stage.goldHave >= stage.goldNeed) continue;
      const amount = Math.min(stage.goldNeed - stage.goldHave, budget, s.gold);
      if (amount <= 0) return 0;
      const before = s.gold;
      if (run.game.dispatch({ type: 'donateProject', project: id as TownProjectId, gold: amount }).ok)
        return before - s.gold;
      return 0;
    }
    return 0;
  }

  /** Buys the next decoration if the budget covers it (bulk pieces in chunks). Returns the gold spent. */
  private buyDecor(run: SimRun, budget: number): number {
    const s = run.state;
    const next = this.nextDecor(s);
    if (!next) return 0;
    const price = this.data.decor[next.id].price;
    const qty = Math.min(next.qty, Math.floor(budget / price));
    if (qty <= 0) return 0;
    if (!run.game.dispatch({ type: 'buyDecor', decor: next.id, qty }).ok) return 0;
    this.placeDecor(run);
    this.styleHouse(run);
    return qty * price;
  }

  /** Goes fishing, and cooks, for the items a town project asks for that the bag does not hold. */
  private errands(run: SimRun, dtMs: number): boolean {
    const s = run.state;
    const wants = this.projectWants(s);
    if (wants.length === 0) return false;
    let useful = false;
    this.errandBudget += (ERRAND_FISH_PER_MIN * dtMs) / MIN;
    for (const w of wants) {
      const def = this.data.items[w.item];
      if (def?.category === 'dish') {
        if (
          s.kitchen.known.includes(w.item as RecipeId) &&
          s.kitchen.queue.length < kitchenSlots(s, this.data)
        )
          useful = run.game.dispatch({ type: 'cook', recipe: w.item as RecipeId }).ok || useful;
        continue;
      }
      const fish = (this.data.fish as Partial<Record<string, { location: FishLocationId }>>)[w.item];
      const junk = (this.data.junk as Partial<Record<string, { locations: readonly FishLocationId[] }>>)[
        w.item
      ];
      const places = fish ? [fish.location] : (junk?.locations ?? []);
      const where = unlockedLocations(s).find((l) => places.includes(l));
      if (!where) continue;
      while (this.errandBudget >= 1) {
        this.errandBudget -= 1;
        const events: GameEvent[] = [];
        // A deliberate fishing trip goes out at midday (some fish only bite in the day); the season is the real one.
        const noon = { ...run.game.calendar(), hour: 12, minute: 0, isNight: false };
        const ctx = makeContext(s, this.data, noon, events);
        const pick = chooseCatch(s, ctx, where, 'active', 0.6);
        landCatch(s, ctx, pick.id, pick.sizeCm, where);
        runProgression(s, ctx);
        run.game.bus.emitAll(events);
        run.metrics.fished += 1;
        useful = true;
      }
    }
    if (this.errandBudget > 3) this.errandBudget = 3;
    return useful;
  }

  /** Puts bought sprinklers and scarecrows where they cover the most plots not yet covered. */
  private place(run: SimRun): boolean {
    const s = run.state;
    let useful = false;
    // Looking for a spot is the brain's slowest step; after a look that found none, wait a minute.
    if (run.playMs < this.placeRetryAt) return false;
    this.placeRetryAt = 0;
    for (const kind of ['sprinkler', 'golden_scarecrow', 'scarecrow'] as const) {
      while (stockOf(s, kind) > 0) {
        const spot = this.bestSpot(s, kind, false) ?? this.bestSpot(s, kind, true);
        if (!spot) break;
        const idx = spot.row * s.farm.grid.cols + spot.col;
        const p = s.farm.plots[idx]!;
        if (p.state === 'planted') {
          if (!isReady(p, this.data)) break; // wait for the crop, then clear the spot
          run.game.dispatch({ type: 'harvest', plots: [idx] });
          if (s.farm.plots[idx]!.state === 'planted') {
            // A regrower stays planted: pull it up by placing elsewhere later.
            break;
          }
        }
        if (!run.game.dispatch({ type: 'place', kind, col: spot.col, row: spot.row }).ok) break;
        useful = true;
      }
      if (stockOf(s, kind) > 0) this.placeRetryAt = run.playMs + MIN;
    }
    return useful;
  }

  private bestSpot(s: GameState, kind: PlacedKind, standing: boolean): { col: number; row: number } | null {
    const { cols, rows } = s.farm.grid;
    const offsets = areaOffsets(areaOf(s, this.data, kind));
    const scarecrow = kind !== 'sprinkler';
    const covered = new Set<number>();
    for (const o of s.placed) {
      if ((o.kind !== 'sprinkler') !== scarecrow) continue;
      for (const [dc, dr] of areaOffsets(areaOf(s, this.data, o.kind)))
        covered.add((o.at.row + dr) * cols + o.at.col + dc);
    }
    const used = occupiedPlots(s);
    let best: { col: number; row: number } | null = null;
    let bestGain = scarecrow ? 3 : 1; // a scarecrow is worth moving a crop for only if it helps a few plots
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const p = s.farm.plots[row * cols + col]!;
        if (p.state === 'planted' && !standing) continue;
        if (p.state !== 'planted' && placementProblem(s, kind, col, row) !== null) continue;
        if (p.state === 'planted' && (objectAt(s, col, row) || p.harvests > 0)) continue;
        let gain = 0;
        for (const [dc, dr] of offsets) {
          const c = col + dc;
          const r = row + dr;
          if (inGrid(s, c, r) && !covered.has(r * cols + c) && !used.has(r * cols + c)) gain++;
        }
        if (gain >= bestGain + (best ? 1 : 0)) {
          bestGain = gain;
          best = { col, row };
        }
      }
    }
    return best;
  }

  /** Expected value of one more unit of `crop` after `pending` more units are sold first. */
  private unitValue(s: GameState, crop: CropId, pending: number): number {
    const base = this.data.crops[crop].basePrice;
    const d = Math.max(0.5, demandOf(s, crop) - pending * demandStep(base));
    return base * d * (1 + specialBonus(s, crop)) * MARKET_CHANNEL;
  }

  /**
   * How good planting `crop` is now: profit per plot-minute while someone will harvest it soon; for
   * a crop that will only be picked after the absence (no farmhand), its whole value over the absence.
   */
  private plotScore(s: GameState, crop: CropId, pending: number, owned: boolean, horizonMin: number): number {
    const c = this.data.crops[crop];
    const y = avgYield(this.data, crop);
    const value = this.unitValue(s, crop, pending + y / 2) * y;
    const seed = owned ? 0 : c.seedPrice;
    const growMin = c.growSec / 60;
    if (growMin > horizonMin) return (value - seed) / Math.max(growMin, horizonMin + this.awayMinutes());
    if (c.regrowSec === null) return (value - seed) / growMin;
    const harvests = 1 + Math.floor((Math.min(horizonMin, 60) * 60 - c.growSec) / c.regrowSec);
    return (value * Math.max(1, harvests) - seed) / Math.min(horizonMin, 60);
  }

  private awayMinutes(): number {
    const full = Math.min(this.awayMs, OFFLINE_FULL_MS);
    return (full + Math.max(0, this.awayMs - OFFLINE_FULL_MS) * OFFLINE_REDUCED_RATE) / MIN;
  }

  /** Till, plant, water. */
  private farm(run: SimRun): boolean {
    const s = run.state;
    const game = run.game;
    const data = this.data;
    let useful = false;
    const used = occupiedPlots(s);
    const plots = allPlotIndexes(s).filter((i) => !used.has(i));
    const bare = plots.filter((i) => ['untilled', 'dead'].includes(plotAt(s, i)!.state));
    if (bare.length > 0 && game.dispatch({ type: 'till', plots: bare }).ok) useful = true;
    // Old regrowers the Community Board no longer needs are pulled up for something better, once the
    // purse can pay for the seeds that replace them (a regrower needs none).
    const stale = plots.filter((i) => {
      if (s.gold < PULL_UP_MIN_GOLD) return false;
      const p = plotAt(s, i)!;
      return !isGreenhouseIndex(i) && canPullUp(p, data) && !this.boardWants(s).has(p.crop!);
    });
    if (stale.length > 0 && game.dispatch({ type: 'till', plots: stale }).ok) useful = true;

    const empty = plots.filter((i) => plotAt(s, i)!.state === 'tilled');
    if (empty.length > 0) {
      const season = game.calendar().season;
      // A farmhand harvests while the player is away, so plant for the rate; without one, a crop that
      // is not ready by the end of the session waits for the next one.
      const horizonMin = upgradeLevel(s, 'farmhand') > 0 ? Infinity : this.sessionLeftMs / MIN;
      const wanted = new Map<CropId, number>();
      if (this.style.bundles) {
        for (const id of BUNDLE_IDS) {
          if (isBundleDone(s, id)) continue;
          for (const slot of bundleSlots(s, data, id)) {
            if (!(slot.item in data.crops)) continue;
            const c = slot.item as CropId;
            wanted.set(c, (wanted.get(c) ?? 0) + slot.need - slot.have - countItem(s.inventory, c));
          }
        }
      }
      for (const w of [...this.projectWants(s), ...this.cropErrands(s)]) {
        if (!(w.item in data.crops)) continue;
        const c = w.item as CropId;
        wanted.set(c, (wanted.get(c) ?? 0) + w.qty);
      }
      const pending: Partial<Record<CropId, number>> = {};
      for (const i of allPlotIndexes(s)) {
        const p = plotAt(s, i)!;
        if (p.crop) pending[p.crop] = (pending[p.crop] ?? 0) + avgYield(data, p.crop);
      }
      for (const i of empty) {
        const greenhouse = isGreenhouseIndex(i);
        let best: CropId | null = null;
        let bestScore = 0;
        for (const c of CROP_IDS) {
          const def = data.crops[c];
          if (!isUnlocked(s, def.unlock)) continue;
          const inSeason = def.seasons.includes(season);
          const owned = countItem(s.inventory, seedOf(c)) > 0;
          if (!greenhouse && !inSeason) continue;
          // A regrower holds its plot until the season ends (it cannot be cleared), so the bots only
          // plant one for the Community Board; otherwise a field locks up for a week on one choice.
          if (!greenhouse && def.regrowSec !== null && !((wanted.get(c) ?? 0) > (pending[c] ?? 0))) continue;
          if (!owned && (!inSeason || s.gold < def.seedPrice)) continue;
          let score = this.plotScore(s, c, pending[c] ?? 0, owned, horizonMin);
          if ((wanted.get(c) ?? 0) > (pending[c] ?? 0)) score = score * 4 + 100;
          if (score > bestScore) {
            best = c;
            bestScore = score;
          }
        }
        if (!best) continue;
        if (countItem(s.inventory, seedOf(best)) === 0) {
          // Stock up when gold arrives hourly; a regrower's seed is bought one at a time (the planter would spread it).
          const regrows = data.crops[best].regrowSec !== null;
          const stock = upgradeLevel(s, 'auto_seller') > 0 && !regrows ? SEED_STOCK_CYCLES : 1;
          const price = data.crops[best].seedPrice;
          const qty = Math.max(1, Math.min(stock, Math.floor(s.gold / price)));
          if (!game.dispatch({ type: 'buySeeds', crop: best, qty }).ok) continue;
        }
        if (game.dispatch({ type: 'plant', crop: best, plots: [i] }).ok) useful = true;
        pending[best] = (pending[best] ?? 0) + avgYield(data, best);
      }
    }
    const cov = coverageOf(s, data);
    const dry = plots.filter((i) => {
      if (i >= GREENHOUSE_BASE) return false;
      const p = s.farm.plots[i]!;
      return p.state !== 'untilled' && p.state !== 'dead' && p.waterMsLeft === 0 && cov?.sprinkled[i] !== 1;
    });
    if (dry.length > 0 && game.dispatch({ type: 'water', plots: dry }).ok) useful = true;
    return useful;
  }

  /** Crops the Community Board still wants. */
  private boardWants(s: GameState): Set<CropId> {
    const out = new Set<CropId>();
    if (!this.style.bundles) return out;
    for (const id of BUNDLE_IDS) {
      if (isBundleDone(s, id)) continue;
      for (const slot of bundleSlots(s, this.data, id))
        if (!slot.done && slot.item in this.data.crops) out.add(slot.item as CropId);
    }
    return out;
  }

  /**
   * Stocks the seeds the planter will need while the player is away (as far as gold and bag allow):
   * each open plot's last crop, or the best single-harvest crop in season for plots whose last crop
   * was a regrower (it may wither) or none.
   */
  private stockSeeds(run: SimRun): void {
    const s = run.state;
    if (upgradeLevel(s, 'seed_planter') === 0) return;
    const data = this.data;
    const season = run.game.calendar().season;
    let fallback: CropId | null = null;
    let best = 0;
    for (const c of CROP_IDS) {
      const def = data.crops[c];
      if (def.regrowSec !== null || !def.seasons.includes(season) || !isUnlocked(s, def.unlock)) continue;
      const perMin =
        (def.basePrice * avgYield(data, c) * MARKET_CHANNEL - def.seedPrice) / (def.growSec / 60);
      if (perMin > best) {
        best = perMin;
        fallback = c;
      }
    }
    const counts = new Map<CropId, number>();
    const used = occupiedPlots(s);
    for (const i of allPlotIndexes(s)) {
      if (used.has(i)) continue;
      const p = plotAt(s, i)!;
      if (p.state === 'planted' && p.crop && data.crops[p.crop].regrowSec !== null) continue; // keeps regrowing
      const last = s.lastPlantedCrop[isGreenhouseIndex(i) ? s.farm.plots.length + i - GREENHOUSE_BASE : i];
      const def = last ? data.crops[last] : null;
      const ok = def && def.regrowSec === null && (isGreenhouseIndex(i) || def.seasons.includes(season));
      const crop = ok ? last! : fallback;
      if (crop) counts.set(crop, (counts.get(crop) ?? 0) + 1);
    }
    const awayMin = this.awayMinutes();
    let budget = Math.floor(s.gold * 0.8);
    for (const [crop, plots] of counts) {
      const def = data.crops[crop];
      if (!def.seasons.includes(season)) continue; // greenhouse-only crops out of season: cannot be bought now
      const cycles = Math.ceil(awayMin / (def.growSec / 60));
      const want = plots * cycles - countItem(s.inventory, seedOf(crop));
      const qty = Math.min(want, Math.floor(budget / def.seedPrice), spaceFor(s.inventory, seedOf(crop)));
      if (qty <= 0) continue;
      if (run.game.dispatch({ type: 'buySeeds', crop, qty }).ok) budget -= qty * def.seedPrice;
    }
  }
}
