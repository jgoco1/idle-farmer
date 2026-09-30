// Skill perks (docs/BALANCE.md §8). Every row is what that level *adds*; the running total is what
// the player has. Rows that BALANCE.md marks "(total)" are written as their increments (a 5%
// double-harvest chance at 4, +5% at 7, +5% at 10) and worded as totals for the player.

import type { SkillId } from './ids';
import type { SkillPerkDef } from './types';

export const SKILL_IDS: readonly SkillId[] = ['farming', 'fishing', 'cooking'];

export const SKILL_NAMES: Readonly<Record<SkillId, string>> = {
  farming: 'Farming',
  fishing: 'Fishing',
  cooking: 'Cooking',
};

export const SKILL_BLURB: Readonly<Record<SkillId, string>> = {
  farming: 'Grows with every crop you harvest.',
  fishing: 'Grows with every fish you land, by rod or trap.',
  cooking: 'Grows with every dish that comes off the stove.',
};

/** A sprite id for each skill's icon in the Goals panel. */
export const SKILL_ICONS: Readonly<Record<SkillId, string>> = {
  farming: 'item_turnip',
  fishing: 'item_bluegill',
  cooking: 'item_roasted_turnip',
};

export const SKILL_PERKS: readonly SkillPerkDef[] = Object.freeze([
  // ---- Farming
  {
    skill: 'farming',
    level: 2,
    text: '+5% crop sell price',
    effect: { kind: 'sellPrice', bonus: 0.05, category: 'crop' },
  },
  { skill: 'farming', level: 3, text: '+5% growth speed', effect: { kind: 'growth', bonus: 0.05 } },
  {
    skill: 'farming',
    level: 4,
    text: '5% chance of a double harvest',
    effect: { kind: 'doubleHarvestChance', chance: 0.05 },
  },
  { skill: 'farming', level: 5, text: '+5% growth speed', effect: { kind: 'growth', bonus: 0.05 } },
  {
    skill: 'farming',
    level: 6,
    text: '+5% crop sell price',
    effect: { kind: 'sellPrice', bonus: 0.05, category: 'crop' },
  },
  {
    skill: 'farming',
    level: 7,
    text: '10% chance of a double harvest (total)',
    effect: { kind: 'doubleHarvestChance', chance: 0.05 },
  },
  { skill: 'farming', level: 8, text: '+5% growth speed', effect: { kind: 'growth', bonus: 0.05 } },
  {
    skill: 'farming',
    level: 9,
    text: '+5% crop sell price',
    effect: { kind: 'sellPrice', bonus: 0.05, category: 'crop' },
  },
  {
    skill: 'farming',
    level: 10,
    text: '15% chance of a double harvest (total)',
    effect: { kind: 'doubleHarvestChance', chance: 0.05 },
  },
  // ---- Fishing
  { skill: 'fishing', level: 2, text: '+5% reel zone', effect: { kind: 'reelZone', bonus: 0.05 } },
  { skill: 'fishing', level: 3, text: '+0.05 fishing luck', effect: { kind: 'fishingLuck', bonus: 0.05 } },
  { skill: 'fishing', level: 4, text: 'Traps hold 1 more', effect: { kind: 'trapCapacity', bonus: 1 } },
  { skill: 'fishing', level: 5, text: '+10% reel zone', effect: { kind: 'reelZone', bonus: 0.1 } },
  { skill: 'fishing', level: 6, text: '+0.10 fishing luck', effect: { kind: 'fishingLuck', bonus: 0.1 } },
  {
    skill: 'fishing',
    level: 7,
    text: 'Traps hold 2 more (total)',
    effect: { kind: 'trapCapacity', bonus: 1 },
  },
  { skill: 'fishing', level: 8, text: '+10% reel zone', effect: { kind: 'reelZone', bonus: 0.1 } },
  { skill: 'fishing', level: 9, text: '+0.15 fishing luck', effect: { kind: 'fishingLuck', bonus: 0.15 } },
  {
    skill: 'fishing',
    level: 10,
    text: '+10% fish sell price',
    effect: { kind: 'sellPrice', bonus: 0.1, category: 'fish' },
  },
  // ---- Cooking
  { skill: 'cooking', level: 2, text: '+10% cooking speed', effect: { kind: 'cookSpeed', bonus: 0.1 } },
  {
    skill: 'cooking',
    level: 3,
    text: '+5% dish sell price',
    effect: { kind: 'sellPrice', bonus: 0.05, category: 'dish' },
  },
  { skill: 'cooking', level: 4, text: '+10% buff duration', effect: { kind: 'buffDuration', bonus: 0.1 } },
  {
    skill: 'cooking',
    level: 5,
    text: '10% chance to save an ingredient',
    effect: { kind: 'ingredientSaveChance', chance: 0.1 },
  },
  { skill: 'cooking', level: 6, text: '+10% cooking speed', effect: { kind: 'cookSpeed', bonus: 0.1 } },
  { skill: 'cooking', level: 7, text: '+1 buff slot', effect: { kind: 'buffSlot', count: 1 } },
  {
    skill: 'cooking',
    level: 8,
    text: '+20% buff duration (total)',
    effect: { kind: 'buffDuration', bonus: 0.1 },
  },
  {
    skill: 'cooking',
    level: 9,
    text: '+10% dish sell price (total)',
    effect: { kind: 'sellPrice', bonus: 0.05, category: 'dish' },
  },
  {
    skill: 'cooking',
    level: 10,
    text: '20% chance to save an ingredient (total)',
    effect: { kind: 'ingredientSaveChance', chance: 0.1 },
  },
]);
