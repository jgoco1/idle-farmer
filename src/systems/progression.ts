// Progression (GDD §6.6, BALANCE.md §8–10): skill XP and levels, the 15 story milestones and the
// goal board. It **listens to events**: every system pushes what happened to `ctx.events`, and
// `runProgression` reads the new ones from a cursor at the end of a simulation step and after an
// action, so offline events count exactly like live ones. Nothing here is called by the other
// systems, apart from the two calendar hooks in `systems/index.ts`.
//
// Levels are derived from XP and the Farm Level from levels and milestones (`systems/skills.ts`);
// this file changes state only through XP, milestone and goal bookkeeping and the rewards they pay.

import type { ActiveGoal, GameState } from '../core/state';
import type { GameEvent } from '../core/events';
import type { Rng } from '../core/rng';
import type { GameData } from '../data';
import {
  AUTO_HARVEST_XP_FRACTION,
  COOKING_XP_BASE,
  COOKING_XP_EXPONENT,
  FISHING_XP_BY_RARITY,
  FISHING_XP_DIFFICULTY_DIV,
  GOAL_CARD_CHANCE,
  GOAL_CATCH_COUNT,
  GOAL_CHARM_MIN,
  GOAL_CHARM_SHARE,
  GOAL_COOK_COUNT,
  GOAL_CYCLE_OVERHEAD_MIN,
  GOAL_DISTINCT_COUNT,
  GOAL_EAT_COUNT,
  GOAL_EFFICIENCY,
  GOAL_GOLD_MIN,
  GOAL_GOLD_SHARE,
  GOAL_RARE_FISHING_LEVEL,
  GOAL_SEED_REWARD,
  GOAL_TARGET_MAX,
  GOAL_TARGET_MIN,
  GOAL_TARGET_MINUTES,
  JUNK_XP,
  MARKET_CHANNEL,
  roundNice,
  TRAP_XP_FRACTION,
} from '../data/balance';
import {
  seedOf,
  type CropId,
  type FishId,
  type ForageId,
  type GoalTemplateId,
  type ItemId,
  type JunkId,
  type PanelId,
  type SeasonId,
  type SkillId,
} from '../data/ids';
import { SKILL_NAMES } from '../data/skills';
import type { CropDef, QuestDef, QuestObjective, QuestReward, RecipeDef } from '../data/types';
import { earn } from './economy';
import type { SimContext } from './context';
import { inSeason, plotCount } from './farming';
import { addItem, countItem } from './inventory';
import { unlockedLocations, isLocationUnlocked } from './locations';
import { FRUIT_IDS, NORTH_FIELD_IDS, RECIPE_IDS, treeOfFruit } from '../data/ids';
import { addToBin } from './shippingBin';
import { farmLevel, isUnlocked } from './unlocks';
import { levelForXp, skillLevel } from './skills';
import { learn } from './cooking';
import { charmOf } from './charm';
import { grantDecor, hasDecorToPlace } from './decor';
import { goalSlots } from './townProjects';
import { fruitXp, ownsMatureTree, treeAge } from './orchard';
import { animalsOfKind, productXp } from './ranch';
import { servingsPerHour } from './restaurant';
import { honeyXp } from './apiary';
import { forageInSeason, forageXp, woodsOpen } from './forage';
import { pressSlots } from './press';

// ---- XP

/** Base Cooking XP of one dish: `round(8 × tier^1.5)` (BALANCE.md §8). */
export function cookingXp(tier: number): number {
  return Math.round(COOKING_XP_BASE * tier ** COOKING_XP_EXPONENT);
}

/** Base Fishing XP of one catch (before the trap fraction and modifiers). */
export function fishingXp(data: GameData, id: FishId | JunkId): number {
  const f = (
    data.fish as Partial<Record<string, { rarity: keyof typeof FISHING_XP_BY_RARITY; difficulty: number }>>
  )[id];
  if (!f) return JUNK_XP;
  return FISHING_XP_BY_RARITY[f.rarity] + Math.floor(f.difficulty / FISHING_XP_DIFFICULTY_DIV);
}

/**
 * Gives `base` XP to `skill`, scaled by the XP modifier (the Scholar's Snack buff) and, for
 * Cooking, the season's bonus (+50% in winter). One `levelUp` event per level gained. Returns the XP granted.
 */
export function grantXp(state: GameState, ctx: SimContext, skill: SkillId, base: number): number {
  if (!(base > 0)) return 0;
  const seasonal = skill === 'cooking' ? 1 + ctx.mods.cookingXpBonus : 1;
  const gain = Math.max(1, Math.round(base * ctx.mods.xpModifier * seasonal));
  const s = state.progression.skills[skill];
  const before = levelForXp(s.xp);
  s.xp += gain;
  const after = levelForXp(s.xp);
  for (let level = before + 1; level <= after; level++) ctx.events.push({ type: 'levelUp', skill, level });
  return gain;
}

// ---- rewards

/** One formatter for every reward line (toLocaleString builds a new one on each call, which an offline walk that finishes many goals feels). */
const GOLD_FORMAT = new Intl.NumberFormat('en-US');

export function rewardText(data: GameData, r: QuestReward): string {
  switch (r.kind) {
    case 'gold':
      return `${GOLD_FORMAT.format(r.amount)}g`;
    case 'items':
      return r.items.map((i) => `${i.qty} × ${data.items[i.item]?.name ?? i.item}`).join(', ');
    case 'recipe':
      return `the ${data.recipes[r.id].name} recipe`;
    case 'xp':
      return `${r.amount} ${SKILL_NAMES[r.skill]} XP`;
    case 'decor':
      return `${r.qty} × ${data.decor[r.id].name}`;
  }
}

export function rewardsText(data: GameData, rewards: readonly QuestReward[]): string {
  return rewards.map((r) => rewardText(data, r)).join(' and ');
}

function grantRewards(
  state: GameState,
  ctx: SimContext,
  rewards: readonly QuestReward[],
  how: 'milestone' | 'card',
): void {
  for (const r of rewards) {
    switch (r.kind) {
      case 'gold':
        earn(state, ctx, r.amount, 'quest');
        break;
      case 'items':
        // Nothing is ever lost: what does not fit in the bag goes to the Shipping Bin.
        for (const i of r.items) if (!addItem(state.inventory, i.item, i.qty)) addToBin(state, i.item, i.qty);
        break;
      case 'recipe':
        learn(state, ctx, r.id, how);
        break;
      case 'xp':
        grantXp(state, ctx, r.skill, r.amount);
        break;
      case 'decor':
        grantDecor(state, r.id, r.qty);
        break;
    }
  }
}

// ---- objectives

/** How much of `o` the event `e` completes (0 when it is not about it). `reachFarmLevel` is state-checked. */
function advance(state: GameState, data: GameData, o: QuestObjective, e: GameEvent): number {
  switch (o.kind) {
    case 'plant':
      return e.type === 'planted' && (!o.crop || o.crop === e.crop) ? e.plots.length : 0;
    case 'harvest':
      return e.type === 'harvested' && (!o.crop || o.crop === e.crop) ? e.qty : 0;
    case 'sell':
      return e.type === 'sold' ? e.qty : 0;
    case 'earnGold':
      return e.type === 'goldEarned' && e.source !== 'quest' ? e.amount : 0;
    case 'ship':
      return e.type === 'binCollected' ? e.items : 0;
    case 'catch': {
      if (e.type !== 'caught') return 0;
      const fish = (data.fish as Partial<Record<string, { rarity: string }>>)[e.catch];
      if (!fish) return 0; // junk is not a fish
      if (o.location && o.location !== e.location) return 0;
      if (o.rarity && o.rarity !== fish.rarity) return 0;
      return 1;
    }
    case 'cook':
      // A distinct-dishes goal counts in `stepGoal`, which knows what has been cooked already.
      return e.type === 'cooked' && !o.distinct && (o.tier === undefined || e.tier >= o.tier) ? 1 : 0;
    case 'eat':
      return e.type === 'ate' ? 1 : 0;
    case 'place':
      return e.type === 'placed' && e.kind === o.what ? 1 : 0;
    case 'buyUpgrade':
      return e.type === 'purchased' && e.what === o.id && (state.upgrades[o.id] ?? 0) >= (o.level ?? 1)
        ? 1
        : 0;
    case 'buyExpansion':
      return e.type === 'purchased' && e.what === o.id ? 1 : 0;
    case 'completeBundle':
      return e.type === 'bundleCompleted' ? 1 : 0;
    case 'placeDecor':
      return e.type === 'decorPlaced' ? 1 : 0;
    case 'gainCharm':
      return e.type === 'charmChanged' && e.to > e.from ? e.to - e.from : 0;
    case 'projectStage':
      return e.type === 'projectStageDone' ? 1 : 0;
    case 'pickFruit':
      return e.type === 'fruitPicked' && (!o.fruit || o.fruit === e.fruit) ? e.qty : 0;
    case 'collectProduct':
      // "Eggs" means an egg or a large egg.
      return e.type === 'collected' &&
        (!o.product || o.product === e.product || (o.product === 'egg' && e.product === 'large_egg'))
        ? e.qty
        : 0;
    case 'serve':
      return e.type === 'served' ? e.qty : 0;
    case 'press':
      return e.type === 'drinkPressed' ? 1 : 0;
    case 'collectHoney':
      return e.type === 'honeyCollected' ? e.qty : 0;
    case 'forage':
      return e.type === 'foragePicked' ? e.qty : 0;
    case 'reachFarmLevel':
    case 'ownParcel':
    case 'ownNorthField':
    case 'reachCharm':
      return 0;
  }
}

/** The only event type that can advance each objective (`reachFarmLevel` is checked against state). */
const EVENT_FOR: Readonly<Record<QuestObjective['kind'], GameEvent['type'] | null>> = {
  plant: 'planted',
  harvest: 'harvested',
  sell: 'sold',
  earnGold: 'goldEarned',
  ship: 'binCollected',
  catch: 'caught',
  cook: 'cooked',
  eat: 'ate',
  place: 'placed',
  buyUpgrade: 'purchased',
  buyExpansion: 'purchased',
  completeBundle: 'bundleCompleted',
  reachFarmLevel: null,
  ownParcel: null,
  ownNorthField: null,
  placeDecor: 'decorPlaced',
  reachCharm: null,
  gainCharm: 'charmChanged',
  projectStage: 'projectStageDone',
  pickFruit: 'fruitPicked',
  collectProduct: 'collected',
  serve: 'served',
  press: 'drinkPressed',
  collectHoney: 'honeyCollected',
  forage: 'foragePicked',
};

/** What a goal's progress is measured against. */
export function goalTarget(o: QuestObjective): number {
  switch (o.kind) {
    case 'earnGold':
    case 'gainCharm':
    case 'reachCharm':
      return o.amount;
    case 'buyUpgrade':
    case 'buyExpansion':
    case 'reachFarmLevel':
      return 1;
    default:
      return o.count;
  }
}

function stepGoal(state: GameState, data: GameData, g: ActiveGoal, e: GameEvent): void {
  const o = g.objective;
  if (o.kind === 'cook' && o.distinct) {
    if (e.type === 'cooked' && !(g.seen ?? []).includes(e.recipe)) {
      (g.seen ??= []).push(e.recipe);
      g.progress += 1;
    }
    return;
  }
  g.progress += advance(state, data, o, e);
}

// ---- the goal board

/** The text of a goal, from its template's title. */
export function goalText(data: GameData, g: Pick<ActiveGoal, 'template' | 'objective'>): string {
  const o = g.objective;
  const rarity = o.kind === 'catch' && o.rarity ? o.rarity : 'common';
  const values: Record<string, string> = {
    n: String(goalTarget(o)),
    fruit:
      o.kind === 'pickFruit' && o.fruit
        ? (data.trees[treeOfFruit(o.fruit)].plural ?? pluralName(data.trees[treeOfFruit(o.fruit)].name))
        : 'fruit',
    product: o.kind === 'collectProduct' && o.product === 'milk' ? 'milk' : 'eggs',
    crop:
      o.kind === 'harvest' && o.crop
        ? (data.crops[o.crop].plural ?? pluralName(data.crops[o.crop].name))
        : 'crops',
    location: o.kind === 'catch' && o.location ? o.location : 'water',
    a_rarity: `${'aeiou'.includes(rarity[0]!) ? 'an' : 'a'} ${rarity}`,
    tier: o.kind === 'cook' && o.tier ? String(o.tier) : '',
  };
  return data.goalTemplates[g.template].title.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? '');
}

function pluralName(name: string): string {
  return /(s|sh|ch|x|z)$/i.test(name)
    ? `${name}es`
    : /[^aeiou]y$/i.test(name)
      ? `${name.slice(0, -1)}ies`
      : `${name}s`;
}

/** Nearest whole number for small targets, nearest 5 up to 100, then nearest 10; clamped to the goal bounds. */
export function niceTarget(x: number): number {
  const v = x < 20 ? Math.round(x) : x < 100 ? Math.round(x / 5) * 5 : Math.round(x / 10) * 10;
  return Math.min(GOAL_TARGET_MAX, Math.max(GOAL_TARGET_MIN, v));
}

function avgYield(c: CropDef): number {
  return (c.yield.min + c.yield.max) / 2;
}

/** Crops the player could plant right now: unlocked and in season (or anything, with a greenhouse). */
export function plantableCrops(state: GameState, data: GameData, season: SeasonId): CropDef[] {
  const greenhouse = state.farm.greenhouse.length > 0;
  return Object.values(data.crops).filter(
    (c) => isUnlocked(state, c.unlock) && (greenhouse || inSeason(c, season)),
  );
}

/** Ideal units per real minute if every plot grows `c` (cycle = grow time + a moment to come back). */
function unitsPerMin(state: GameState, c: CropDef): number {
  const plots = plotCount(state);
  const cycleMin = (c.regrowSec ?? c.growSec) / 60 + GOAL_CYCLE_OVERHEAD_MIN;
  return (plots * avgYield(c)) / cycleMin;
}

/** A rough gold-per-real-minute for the current farm: the best crop's profit on every plot. Sizes gold targets and rewards. */
export function estimatedGoldPerMin(state: GameState, data: GameData, season: SeasonId): number {
  const plots = plotCount(state);
  let best = 0;
  for (const c of plantableCrops(state, data, season)) {
    const cycleMin = (c.regrowSec ?? c.growSec) / 60 + GOAL_CYCLE_OVERHEAD_MIN;
    best = Math.max(best, (avgYield(c) * c.basePrice * MARKET_CHANNEL - c.seedPrice) / cycleMin);
  }
  return plots * best;
}

/** Whether every ingredient of `r` can be had now: in the bag, grown, or caught at an open water this season. */
export function recipeObtainable(state: GameState, data: GameData, season: SeasonId, r: RecipeDef): boolean {
  const has = (item: ItemId): boolean => {
    if (countItem(state.inventory, item) > 0) return true;
    const crop = data.crops[item as CropId];
    if (crop)
      return isUnlocked(state, crop.unlock) && (inSeason(crop, season) || state.farm.greenhouse.length > 0);
    const fish = data.fish[item as FishId];
    if (fish) return isLocationUnlocked(state, fish.location) && fish.seasons.includes(season);
    // Eggs and milk are obtainable once the animal that gives them lives on the ranch.
    if (item === 'egg' || item === 'large_egg') return animalsOfKind(state, 'chicken') > 0;
    if (item === 'milk') return animalsOfKind(state, 'cow') > 0;
    // v4-03: honey once a hive stands in the apiary; cocoa from the Press House shelf.
    if (item === 'honey') return state.apiary.hives.length > 0;
    if (item === 'cocoa') return state.press.level > 0;
    // v4-04: forage once the woods are open and some spot of its kind grows it this season.
    const wild = data.forage.items[item as ForageId];
    if (wild) return woodsOpen(state) && forageInSeason(data, wild.id, season);
    const junk = data.junk[item as JunkId];
    return junk ? junk.locations.some((l) => isLocationUnlocked(state, l)) : false;
  };
  return r.ingredients.every((i) => has(i.item));
}

function cookableRecipes(state: GameState, data: GameData, season: SeasonId): RecipeDef[] {
  return RECIPE_IDS.filter((id) => state.kitchen.known.includes(id))
    .map((id) => data.recipes[id])
    .filter((r) => recipeObtainable(state, data, season, r));
}

/** A fish of `rarity` that can bite at an open water this season. */
function rarityAvailable(
  state: GameState,
  data: GameData,
  season: SeasonId,
  rarity: 'uncommon' | 'rare',
): boolean {
  return Object.values(data.fish).some(
    (f) => f.rarity === rarity && isLocationUnlocked(state, f.location) && f.seasons.includes(season),
  );
}

interface Variant {
  key: string;
  objective: QuestObjective;
}

/** Every concrete goal `template` could be right now (empty when it does not apply or cannot be done yet). */
function variantsOf(state: GameState, data: GameData, season: SeasonId, id: GoalTemplateId): Variant[] {
  const t = data.goalTemplates[id];
  if (!isUnlocked(state, t.requires, data)) return [];
  switch (id) {
    case 'harvest_crop':
      return plantableCrops(state, data, season).map((c) => ({
        key: `${id}:${c.id}`,
        objective: {
          kind: 'harvest',
          crop: c.id,
          count: niceTarget(unitsPerMin(state, c) * GOAL_TARGET_MINUTES * GOAL_EFFICIENCY),
        },
      }));
    case 'harvest_any': {
      const crops = plantableCrops(state, data, season);
      if (crops.length === 0) return [];
      const rate = crops.reduce((n, c) => n + unitsPerMin(state, c), 0) / crops.length;
      return [
        {
          key: id,
          objective: { kind: 'harvest', count: niceTarget(rate * 2 * GOAL_TARGET_MINUTES * GOAL_EFFICIENCY) },
        },
      ];
    }
    case 'earn_gold_day': {
      const est = estimatedGoldPerMin(state, data, season);
      if (est <= 0) return [];
      const amount = Math.max(GOAL_GOLD_MIN, roundNice(est * GOAL_TARGET_MINUTES * GOAL_EFFICIENCY));
      return [{ key: id, objective: { kind: 'earnGold', amount, withinOneDay: true } }];
    }
    case 'ship_items': {
      const crops = plantableCrops(state, data, season);
      if (crops.length === 0) return [];
      const rate = crops.reduce((n, c) => n + unitsPerMin(state, c), 0) / crops.length;
      return [
        {
          key: id,
          objective: { kind: 'ship', count: niceTarget(rate * 2 * GOAL_TARGET_MINUTES * GOAL_EFFICIENCY) },
        },
      ];
    }
    case 'catch_fish':
      return unlockedLocations(state).map((location) => ({
        key: `${id}:${location}`,
        objective: { kind: 'catch', location, count: GOAL_CATCH_COUNT },
      }));
    case 'catch_rarity': {
      const out: Variant[] = [];
      if (rarityAvailable(state, data, season, 'uncommon'))
        out.push({ key: `${id}:uncommon`, objective: { kind: 'catch', rarity: 'uncommon', count: 1 } });
      if (
        skillLevel(state, 'fishing') >= GOAL_RARE_FISHING_LEVEL &&
        rarityAvailable(state, data, season, 'rare')
      )
        out.push({ key: `${id}:rare`, objective: { kind: 'catch', rarity: 'rare', count: 1 } });
      return out;
    }
    case 'cook_tier': {
      const tiers = new Set(
        cookableRecipes(state, data, season)
          .map((r) => r.tier)
          .filter((tier) => tier >= 2),
      );
      return [...tiers].map((tier) => ({
        key: `${id}:${tier}`,
        objective: { kind: 'cook', tier, count: tier === 2 ? GOAL_COOK_COUNT.t2 : GOAL_COOK_COUNT.higher },
      }));
    }
    case 'cook_distinct':
      return cookableRecipes(state, data, season).length >= GOAL_DISTINCT_COUNT
        ? [{ key: id, objective: { kind: 'cook', distinct: true, count: GOAL_DISTINCT_COUNT } }]
        : [];
    case 'eat_dish':
      return cookableRecipes(state, data, season).length >= 1
        ? [{ key: id, objective: { kind: 'eat', count: GOAL_EAT_COUNT } }]
        : [];
    case 'pick_fruit': {
      // One goal per fruit the player has a mature tree of and that bears this season: about a day's worth.
      const day = state.calendar.maxDayIndex;
      const out: Variant[] = [];
      for (const f of FRUIT_IDS) {
        const def = data.trees[treeOfFruit(f)];
        if (!def.seasons.includes(season) || !ownsMatureTree(state, data, f, day)) continue;
        const trees = state.orchard.trees.filter(
          (t) => t.tree === def.id && treeAge(t, day) >= def.matureDays,
        ).length;
        out.push({
          key: `${id}:${f}`,
          objective: { kind: 'pickFruit', fruit: f, count: niceTarget(trees * def.fruitPerDay) },
        });
      }
      return out;
    }
    case 'collect_produce': {
      // About an hour of the animals' production (hens lay 2 an hour each, cows give 1.5).
      const out: Variant[] = [];
      const hens = animalsOfKind(state, 'chicken');
      const cows = animalsOfKind(state, 'cow');
      if (hens > 0)
        out.push({
          key: `${id}:egg`,
          objective: { kind: 'collectProduct', product: 'egg', count: niceTarget(hens * 2) },
        });
      if (cows > 0)
        out.push({
          key: `${id}:milk`,
          objective: { kind: 'collectProduct', product: 'milk', count: niceTarget(cows * 1.5) },
        });
      return out;
    }
    case 'press_drinks':
      // One drink per press slot (BALANCE.md §14.6), once the Press House is built.
      return state.press.level > 0
        ? [{ key: id, objective: { kind: 'press', count: Math.max(1, pressSlots(state, data)) } }]
        : [];
    case 'serve_dishes':
      // About an hour of the menu's servings (an empty table counts as a T2 dish), at least 3.
      return state.restaurant.level > 0
        ? [
            {
              key: id,
              objective: { kind: 'serve', count: Math.max(3, niceTarget(servingsPerHour(state, data))) },
            },
          ]
        : [];
    case 'raise_charm': {
      if (!hasDecorToPlace(state, data)) return [];
      const amount = Math.max(GOAL_CHARM_MIN, niceTarget(GOAL_CHARM_SHARE * charmOf(state, data)));
      return [{ key: id, objective: { kind: 'gainCharm', amount } }];
    }
  }
}

function keyOf(g: ActiveGoal): string {
  const o = g.objective;
  switch (g.template) {
    case 'harvest_crop':
      return `${g.template}:${o.kind === 'harvest' ? o.crop : ''}`;
    case 'catch_fish':
      return `${g.template}:${o.kind === 'catch' ? o.location : ''}`;
    case 'catch_rarity':
      return `${g.template}:${o.kind === 'catch' ? o.rarity : ''}`;
    case 'cook_tier':
      return `${g.template}:${o.kind === 'cook' ? o.tier : ''}`;
    case 'pick_fruit':
      return `${g.template}:${o.kind === 'pickFruit' ? o.fruit : ''}`;
    case 'collect_produce':
      return `${g.template}:${o.kind === 'collectProduct' ? o.product : ''}`;
    default:
      return g.template;
  }
}

/** Whether `g` can still be completed given what the player has unlocked and the season. */
export function goalAchievable(state: GameState, data: GameData, season: SeasonId, g: ActiveGoal): boolean {
  const key = keyOf(g);
  return variantsOf(state, data, season, g.template).some((v) => v.key === key);
}

function goalRewards(state: GameState, data: GameData, season: SeasonId, rng: Rng): QuestReward[] {
  const gold = roundNice(
    Math.max(GOAL_GOLD_MIN, GOAL_GOLD_SHARE * estimatedGoldPerMin(state, data, season) * 10),
  );
  const roll = rng.next();
  if (roll < GOAL_CARD_CHANCE) {
    const cards = RECIPE_IDS.filter((id) => {
      const d = data.recipes[id].discovery;
      return d.kind === 'card' && !state.kitchen.known.includes(id) && isUnlocked(state, d.unlock);
    });
    if (cards.length > 0) {
      return [
        { kind: 'gold', amount: roundNice(gold / 2) },
        { kind: 'recipe', id: rng.pick(cards) },
      ];
    }
  } else if (roll < GOAL_CARD_CHANCE + GOAL_SEED_REWARD.chance) {
    const crops = plantableCrops(state, data, season);
    if (crops.length > 0) {
      const crop = rng.pick(crops);
      return [
        { kind: 'gold', amount: roundNice(gold / 2) },
        { kind: 'items', items: [{ item: seedOf(crop.id), qty: GOAL_SEED_REWARD.qty }] },
      ];
    }
  }
  return [{ kind: 'gold', amount: gold }];
}

/** Draws goals until the board is full (three, four with the Community Hall) or nothing new applies. Uses the seeded RNG only when it adds one. */
export function refillGoals(state: GameState, data: GameData, rng: Rng, season: SeasonId): number {
  const goals = state.progression.goals;
  let added = 0;
  while (goals.length < goalSlots(state, data)) {
    const active = new Set(goals.map(keyOf));
    const onBoard = new Set(goals.map((g) => g.template));
    const ids = Object.keys(data.goalTemplates) as GoalTemplateId[];
    const options: { id: GoalTemplateId; variants: Variant[] }[] = [];
    for (const id of ids) {
      const variants = variantsOf(state, data, season, id).filter((v) => !active.has(v.key));
      if (variants.length > 0) options.push({ id, variants });
    }
    if (options.length === 0) break;
    // Prefer a template that is not on the board yet, so three goals are three different kinds.
    const fresh = options.filter((o) => !onBoard.has(o.id));
    const pool = fresh.length > 0 ? fresh : options;
    const template = rng.pick(pool);
    const variant = rng.pick(template.variants);
    goals.push({
      template: template.id,
      objective: variant.objective,
      progress: 0,
      rewards: goalRewards(state, data, season, rng),
    });
    added += 1;
  }
  return added;
}

/** Drops goals that can no longer be done (a season change, say) and draws new ones. */
export function revalidateGoals(state: GameState, data: GameData, rng: Rng, season: SeasonId): void {
  const goals = state.progression.goals;
  state.progression.goals = goals.filter((g) => goalAchievable(state, data, season, g));
  refillGoals(state, data, rng, season);
}

/** The 06:00 refresh: per-day goals start again from zero. */
export function resetDailyGoals(state: GameState): void {
  for (const g of state.progression.goals) {
    if (g.objective.kind === 'earnGold' && g.objective.withinOneDay) g.progress = 0;
  }
}

// ---- unlock announcements

const listNames = (names: string[]): string =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

/** What Farm Levels `from`+1 … `to` opened, as short lines ("New seeds in the shop: …") and where to look. */
export function describeUnlocks(
  data: GameData,
  from: number,
  to: number,
): { what: string; panel: PanelId }[] {
  const crossed = (conds: readonly { kind: string; level?: number }[]): boolean =>
    conds.some((c) => c.kind === 'farmLevel' && c.level !== undefined && c.level > from && c.level <= to);
  const lines: { what: string; panel: PanelId }[] = [];
  const seeds = Object.values(data.crops)
    .filter((c) => crossed(c.unlock))
    .map((c) => c.name);
  if (seeds.length) lines.push({ what: `New seeds in the shop: ${listNames(seeds)}!`, panel: 'shop' });
  const cards = RECIPE_IDS.filter((id) => {
    const d = data.recipes[id].discovery;
    return d.kind === 'card' && crossed(d.unlock);
  }).map((id) => data.recipes[id].name);
  if (cards.length) lines.push({ what: `New recipe cards in the shop: ${listNames(cards)}!`, panel: 'shop' });
  const upgrades: string[] = [];
  for (const e of Object.values(data.expansions)) if (crossed(e.requires)) upgrades.push(e.name);
  for (const u of Object.values(data.upgrades)) {
    if (!u) continue;
    const levels = Object.values(u.levelRequires ?? {});
    if (crossed(u.requires) || levels.some((l) => crossed(l))) upgrades.push(u.name);
  }
  if (upgrades.length) lines.push({ what: `New in Upgrades: ${listNames(upgrades)}!`, panel: 'upgrades' });
  return lines;
}

// ---- the event pass

const cursors = new WeakMap<GameEvent[], number>();

function completeMilestone(state: GameState, ctx: SimContext, m: QuestDef): void {
  const id = m.id as (typeof state.progression.milestones.done)[number];
  if (state.progression.milestones.done.includes(id)) return;
  state.progression.milestones.done.push(id);
  grantRewards(state, ctx, m.rewards, 'milestone');
  ctx.events.push({
    type: 'questDone',
    id,
    kind: 'milestone',
    title: m.title,
    rewards: rewardsText(ctx.data, m.rewards),
  });
}

function handle(state: GameState, ctx: SimContext, e: GameEvent): void {
  const data = ctx.data;
  // XP first, so a level-up from this event is in place before its goals and milestones are counted.
  switch (e.type) {
    case 'harvested':
      grantXp(state, ctx, 'farming', e.qty * data.crops[e.crop].xp * (e.auto ? AUTO_HARVEST_XP_FRACTION : 1));
      break;
    case 'fruitPicked':
      grantXp(state, ctx, 'farming', fruitXp(data, e.fruit, e.qty, e.auto));
      break;
    case 'collected':
      grantXp(state, ctx, 'farming', productXp(data, e.product, e.qty, e.auto));
      break;
    case 'caught': {
      const base = fishingXp(data, e.catch);
      grantXp(state, ctx, 'fishing', e.viaTrap ? Math.floor(base * TRAP_XP_FRACTION) : base);
      break;
    }
    case 'cooked':
      grantXp(state, ctx, 'cooking', cookingXp(e.tier));
      break;
    case 'drinkPressed': // v4-03: a drink is Cooking work, paid like a dish of its tier
      grantXp(state, ctx, 'cooking', cookingXp(e.tier));
      break;
    case 'honeyCollected':
      grantXp(state, ctx, 'farming', honeyXp(e.qty, e.auto));
      break;
    case 'foragePicked':
      grantXp(state, ctx, 'farming', forageXp(data, e.item, e.qty, e.auto));
      break;
    case 'bundleCompleted': {
      const r = data.bundles[e.bundle].reward;
      if (r.kind === 'unlockGreenhouse')
        ctx.events.push({
          type: 'unlocked',
          what: 'The greenhouse can be built now: look in Upgrades!',
          panel: 'upgrades',
        });
      break;
    }
  }
  // Only the milestones and goals this kind of event can move are looked at (an offline walk
  // reports thousands of harvests; checking all fifteen milestones against each was the walk's
  // biggest cost).
  const ms = milestoneIndex(data).byEvent.get(e.type);
  if (ms)
    for (const m of ms) {
      if (state.progression.milestones.done.includes(m.id as never)) continue;
      if (
        advance(state, data, m.objective, e) >= Math.max(1, 'count' in m.objective ? m.objective.count : 1)
      ) {
        completeMilestone(state, ctx, m);
      }
    }
  // Goals: count, then finish the ones that are there. A finished goal pays out and leaves the board.
  const goals = state.progression.goals;
  if (!goals.some((g) => EVENT_FOR[g.objective.kind] === e.type)) return;
  for (const g of [...goals]) {
    if (EVENT_FOR[g.objective.kind] !== e.type) continue;
    stepGoal(state, data, g, e);
    if (g.progress >= goalTarget(g.objective)) {
      goals.splice(goals.indexOf(g), 1);
      state.progression.goalsDone += 1;
      grantRewards(state, ctx, g.rewards, 'card');
      ctx.events.push({
        type: 'questDone',
        id: g.template,
        kind: 'goal',
        title: goalText(data, g),
        rewards: rewardsText(data, g.rewards),
      });
    }
  }
}

/** Whether a state-checked objective (the Farm Level, owning land, charm) is met right now; every other kind is counted from events. */
function stateMet(state: GameState, data: GameData, o: QuestObjective): boolean {
  switch (o.kind) {
    case 'reachFarmLevel':
      return farmLevel(state) >= o.level;
    case 'ownParcel':
      return state.land.parcels.length >= o.count;
    case 'ownNorthField': {
      let n = 0;
      for (const f of NORTH_FIELD_IDS) if (state.farm.north[f]) n++;
      return n >= o.count;
    }
    case 'reachCharm':
      return charmOf(state, data) >= o.amount;
    default:
      return false;
  }
}

/** The milestones each event type can advance, and the ones checked against state, in table order (per data). */
interface MilestoneIndex {
  byEvent: Map<GameEvent['type'], QuestDef[]>;
  stateChecked: QuestDef[];
}
const milestoneIndexes = new WeakMap<readonly QuestDef[], MilestoneIndex>();
function milestoneIndex(data: GameData): MilestoneIndex {
  let idx = milestoneIndexes.get(data.milestones);
  if (!idx) {
    idx = { byEvent: new Map(), stateChecked: [] };
    for (const m of data.milestones) {
      const type = EVENT_FOR[m.objective.kind];
      if (type === null) idx.stateChecked.push(m);
      else {
        const list = idx.byEvent.get(type) ?? [];
        list.push(m);
        idx.byEvent.set(type, list);
      }
    }
    milestoneIndexes.set(data.milestones, idx);
  }
  return idx;
}

/** States that have been through one full settle, so a loaded save gets its state-checked milestones on the first step. */
const settledOnce = new WeakSet<GameState>();

/** Milestones checked against state (`reachFarmLevel`, `ownParcel`, `reachCharm`), and the Farm Level announcement. */
function settle(state: GameState, ctx: SimContext, levelBefore: number): number {
  let level = levelBefore;
  for (let guard = 0; guard < 8; guard++) {
    let changed = false;
    for (const m of milestoneIndex(ctx.data).stateChecked) {
      if (
        state.progression.milestones.done.includes(m.id as never) ||
        !stateMet(state, ctx.data, m.objective)
      )
        continue;
      completeMilestone(state, ctx, m);
      changed = true;
    }
    if (!changed) break;
  }
  const now = farmLevel(state);
  if (now > level) {
    ctx.events.push({ type: 'farmLevelUp', level: now });
    for (const u of describeUnlocks(ctx.data, level, now)) ctx.events.push({ type: 'unlocked', ...u });
    level = now;
  }
  return level;
}

/**
 * Reads the events pushed since the last call (per events array), pays XP, completes milestones and
 * goals, announces unlocks, and keeps the board full. Cheap when nothing happened. Events that this
 * pass pushes itself (level-ups, quest rewards) are read in the same pass.
 */
export function runProgression(state: GameState, ctx: SimContext): void {
  const events = ctx.events;
  let i = cursors.get(events) ?? 0;
  if (i > events.length) i = 0;
  if (
    i === events.length &&
    state.progression.goals.length >= goalSlots(state, ctx.data) &&
    settledOnce.has(state)
  )
    return;
  settledOnce.add(state);
  let level = farmLevel(state);
  // Handling an event can push more (a reward levels a skill up, a milestone raises the Farm Level),
  // so read until the log stops growing. Every pass ends by settling the state-checked milestones.
  for (let pass = 0; pass < 16; pass++) {
    while (i < events.length) {
      handle(state, ctx, events[i]!);
      i += 1;
    }
    level = settle(state, ctx, level);
    if (i >= events.length) break;
  }
  cursors.set(events, events.length);
  if (state.progression.goals.length < goalSlots(state, ctx.data)) {
    refillGoals(state, ctx.data, ctx.rng, ctx.calendar.season);
  }
}
