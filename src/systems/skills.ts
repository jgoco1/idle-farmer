// Skills, levels and perks (BALANCE.md §8), as pure functions of the state. Levels come from XP and
// the Farm Level from the levels and milestones, so nothing derived is stored. Everything that
// reads a perk goes through `computeModifiers`; this file only totals them.

import type { GameState } from '../core/state';
import type { GameData } from '../data';
import {
  FARM_LEVEL_MAX,
  FARM_LEVEL_POINTS,
  FARM_POINT_MILESTONES,
  MAX_SKILL_LEVEL,
  XP_BASE,
  XP_GROWTH,
} from '../data/balance';
import type { SkillId } from '../data/ids';
import { SKILL_IDS } from '../data/skills';

/** XP to go from level `level` to the next (`level` = 1..9). */
export function xpToNext(level: number): number {
  return Math.round(XP_BASE * XP_GROWTH ** (level - 1));
}

/** Cumulative XP to reach each level, index = level (level 1 = 0). Built once: levels are read every step. */
const XP_TABLE: readonly number[] = (() => {
  const t = [0, 0];
  for (let l = 1; l < MAX_SKILL_LEVEL; l++) t.push(t[l]! + xpToNext(l));
  return t;
})();

/** Cumulative XP needed to reach `level` (level 1 = 0). */
export function xpForLevel(level: number): number {
  return XP_TABLE[Math.max(1, Math.min(level, MAX_SKILL_LEVEL))]!;
}

/** The level `xp` reaches, 1..MAX_SKILL_LEVEL. */
export function levelForXp(xp: number): number {
  let level = 1;
  while (level < MAX_SKILL_LEVEL && xp >= XP_TABLE[level + 1]!) level += 1;
  return level;
}

export function skillXp(state: GameState, skill: SkillId): number {
  return state.progression.skills[skill].xp;
}

export function skillLevel(state: GameState, skill: SkillId): number {
  return levelForXp(skillXp(state, skill));
}

/** XP into the current level and what the level needs (null at the top). */
export function skillProgress(state: GameState, skill: SkillId): { into: number; need: number | null } {
  const xp = skillXp(state, skill);
  const level = levelForXp(xp);
  if (level >= MAX_SKILL_LEVEL) return { into: 0, need: null };
  return { into: xp - xpForLevel(level), need: xpToNext(level) };
}

/** `Σ(level − 1) + milestonesDone` (BALANCE.md §8). */
export function farmPoints(state: GameState): number {
  // Only the original fifteen milestones are farm points (BALANCE.md §13.9): the v2 ones (m16 and on) pay their own rewards.
  let points = 0;
  for (const id of state.progression.milestones.done)
    if (Number(id.slice(1, 3)) <= FARM_POINT_MILESTONES) points += 1;
  for (const s of SKILL_IDS) points += skillLevel(state, s) - 1;
  return points;
}

/** The Farm Level the skills and milestones give, ignoring the floor an older save carries. */
export function earnedFarmLevel(state: GameState): number {
  const points = farmPoints(state);
  let level = 1;
  while (level < FARM_LEVEL_MAX && points >= FARM_LEVEL_POINTS[level + 1]!) level += 1;
  return level;
}

/** Farm points needed for Farm Level `level` (past the table, five more per level). */
export function pointsForFarmLevel(level: number): number {
  if (level <= 1) return 0;
  return level <= FARM_LEVEL_MAX
    ? FARM_LEVEL_POINTS[level]!
    : FARM_LEVEL_POINTS[FARM_LEVEL_MAX]! + 5 * (level - FARM_LEVEL_MAX);
}

/** Everything the skill perks add up to at the player's levels. */
export interface PerkTotals {
  doubleHarvestChance: number;
  growth: number;
  cropSell: number;
  fishSell: number;
  dishSell: number;
  reelZone: number;
  luck: number;
  trapCapacity: number;
  cookSpeed: number;
  buffDuration: number;
  buffSlots: number;
  ingredientSaveChance: number;
}

export const NO_PERKS: Readonly<PerkTotals> = Object.freeze({
  doubleHarvestChance: 0,
  growth: 0,
  cropSell: 0,
  fishSell: 0,
  dishSell: 0,
  reelZone: 0,
  luck: 0,
  trapCapacity: 0,
  cookSpeed: 0,
  buffDuration: 0,
  buffSlots: 0,
  ingredientSaveChance: 0,
});

const perkCache = new WeakMap<GameData, Map<number, Readonly<PerkTotals>>>();

/**
 * Sums the perks of every level reached. Rounded so 0.05 + 0.05 + 0.05 is 0.15, not 0.1500000002.
 * The result depends only on the three levels, so it is kept per data set; do not modify it.
 */
export function perkTotals(state: GameState, data: GameData): Readonly<PerkTotals> {
  const f = skillLevel(state, 'farming');
  const g = skillLevel(state, 'fishing');
  const c = skillLevel(state, 'cooking');
  const key = (f * 100 + g) * 100 + c;
  let byLevels = perkCache.get(data);
  if (!byLevels) perkCache.set(data, (byLevels = new Map()));
  let t = byLevels.get(key);
  if (!t) byLevels.set(key, (t = computePerks({ farming: f, fishing: g, cooking: c }, data)));
  return t;
}

function computePerks(levels: Record<SkillId, number>, data: GameData): Readonly<PerkTotals> {
  const t: PerkTotals = { ...NO_PERKS };
  for (const p of data.perks) {
    if (levels[p.skill] < p.level) continue;
    const e = p.effect;
    switch (e.kind) {
      case 'doubleHarvestChance':
        t.doubleHarvestChance += e.chance;
        break;
      case 'growth':
        t.growth += e.bonus;
        break;
      case 'sellPrice':
        if (e.category === 'crop') t.cropSell += e.bonus;
        else if (e.category === 'fish') t.fishSell += e.bonus;
        else t.dishSell += e.bonus;
        break;
      case 'reelZone':
        t.reelZone += e.bonus;
        break;
      case 'fishingLuck':
        t.luck += e.bonus;
        break;
      case 'trapCapacity':
        t.trapCapacity += e.bonus;
        break;
      case 'cookSpeed':
        t.cookSpeed += e.bonus;
        break;
      case 'buffDuration':
        t.buffDuration += e.bonus;
        break;
      case 'buffSlot':
        t.buffSlots += e.count;
        break;
      case 'ingredientSaveChance':
        t.ingredientSaveChance += e.chance;
        break;
    }
  }
  for (const k of Object.keys(t) as (keyof PerkTotals)[]) t[k] = Math.round(t[k] * 10_000) / 10_000;
  return Object.freeze(t);
}
