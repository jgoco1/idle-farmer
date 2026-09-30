// Seasonal effects (docs/BALANCE.md §7). Only winter has any in v1: it is cooking season.

import type { SeasonId } from './ids';
import type { SeasonDef } from './types';

export const SEASONS: Readonly<Record<SeasonId, SeasonDef>> = Object.freeze({
  spring: { id: 'spring', name: 'Spring', effects: {} },
  summer: { id: 'summer', name: 'Summer', effects: {} },
  autumn: { id: 'autumn', name: 'Autumn', effects: {} },
  winter: {
    id: 'winter',
    name: 'Winter',
    effects: { heartyDishes: true, cookingXpBonus: 0.5, dishSellBonus: 0.25 },
  },
});
