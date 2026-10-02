// The seven food buffs (docs/BALANCE.md §7). Strength and duration come from the recipe's tier;
// each type only says which modifier seam it drives and how strongly (`magnitudeScale`).

import type { BuffType } from './ids';
import type { BuffDef } from './types';

export const BUFF_TYPES: readonly BuffType[] = [
  'growth',
  'sellPrice',
  'fishingLuck',
  'fishingSpeed',
  'cookSpeed',
  'automationSpeed',
  'xp',
];

export const BUFFS: Readonly<Record<BuffType, BuffDef>> = Object.freeze({
  growth: {
    type: 'growth',
    name: 'Green Thumb',
    description: 'Crops grow {pct} faster.',
    magnitudeScale: 1,
    seam: 'growthModifier',
    additive: false,
    icon: 'buff_growth',
  },
  sellPrice: {
    type: 'sellPrice',
    name: 'Silver Tongue',
    description: 'Everything sells for {pct} more.',
    magnitudeScale: 0.5,
    seam: 'sellPriceModifier',
    additive: false,
    icon: 'buff_sellPrice',
  },
  fishingLuck: {
    type: 'fishingLuck',
    name: "Angler's Luck",
    description: 'Rarer fish bite ({pct} luck).',
    magnitudeScale: 1,
    seam: 'fishingLuckModifier',
    additive: true,
    icon: 'buff_fishingLuck',
  },
  fishingSpeed: {
    type: 'fishingSpeed',
    name: 'Quick Bite',
    description: 'Fish bite and traps roll {pct} faster.',
    magnitudeScale: 1,
    seam: 'fishingSpeedModifier',
    additive: false,
    icon: 'buff_fishingSpeed',
  },
  cookSpeed: {
    type: 'cookSpeed',
    name: 'Quick Hands',
    description: 'Dishes cook {pct} faster.',
    magnitudeScale: 1.5,
    seam: 'cookSpeedModifier',
    additive: false,
    icon: 'buff_cookSpeed',
  },
  automationSpeed: {
    type: 'automationSpeed',
    name: 'Busy Bees',
    description: 'The farmhand, the planter and the animals work {pct} faster.',
    magnitudeScale: 1,
    seam: 'automationSpeedModifier',
    alsoSeam: 'animalSpeedModifier',
    additive: false,
    icon: 'buff_automationSpeed',
  },
  xp: {
    type: 'xp',
    name: "Scholar's Snack",
    description: 'You gain {pct} more XP from everything.',
    magnitudeScale: 1.5,
    seam: 'xpModifier',
    additive: false,
    icon: 'buff_xp',
  },
});
