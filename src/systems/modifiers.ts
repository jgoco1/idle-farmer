// Modifier seams (docs/DATA_SCHEMAS.md §5). Buffs, perks and upgrades are folded into one struct
// once per step; systems read `ctx.mods` and never look at buffs or upgrades themselves.

import type { GameState } from '../core/state';
import type { GameData } from '../data';
import type { SeasonId } from '../data/ids';

export interface Modifiers {
  growthModifier: number; // × crop growth rate          (phase 02 seam)
  sellPriceModifier: number; // × sale price             (phase 03 seam)
  fishingLuckModifier: number; // additive luck, 0 = none (phase 05 seam)
  fishingSpeedModifier: number; // × bite and trap speed  (phase 05 seam)
  cookSpeedModifier: number; // × cooking speed          (phase 06 seam)
  automationSpeedModifier: number; // × farmhand/planter speed (phase 04 seam)
  xpModifier: number; // × XP gained                     (phase 06 stub; used by 07)
  dishSellBonus: number; // additive on dish prices       (season effect, phase 06)
  cookingXpBonus: number; // additive on Cooking XP       (season effect, phase 07)
}

export const NO_MODIFIERS: Readonly<Modifiers> = Object.freeze({
  growthModifier: 1,
  sellPriceModifier: 1,
  fishingLuckModifier: 0,
  fishingSpeedModifier: 1,
  cookSpeedModifier: 1,
  automationSpeedModifier: 1,
  xpModifier: 1,
  dishSellBonus: 0,
  cookingXpBonus: 0,
});

/**
 * Folds every source into one struct as `1 + (buff + perk + upgrade)`, never compounded. Sources
 * today: food buffs (phase 06), the fishing rod's luck (05) and the kitchen's speed (06); perks and
 * bundles join in phase 07. `season` (from `ctx.calendar`) brings in the seasonal dish sell bonus
 * and Cooking XP bonus; leave it out and there are none.
 */
export function computeModifiers(state: GameState, data: GameData, season?: SeasonId): Modifiers {
  const rod = data.upgrades.fishing_rod?.effect[state.upgrades.fishing_rod ?? 0];
  const kitchen = data.upgrades.kitchen?.effect[state.upgrades.kitchen ?? 0];
  const effects = season ? data.seasons[season].effects : NO_EFFECTS;
  const mods: Modifiers = {
    growthModifier: 1,
    sellPriceModifier: 1,
    fishingLuckModifier: rod?.luck ?? 0,
    fishingSpeedModifier: 1,
    cookSpeedModifier: 1 + (kitchen?.cookSpeed ?? 0),
    automationSpeedModifier: 1,
    xpModifier: 1,
    dishSellBonus: effects.dishSellBonus ?? 0,
    cookingXpBonus: effects.cookingXpBonus ?? 0,
  };
  // This runs every simulation step, so buffs are folded in one pass rather than looked up per type.
  for (const b of state.buffs.active) {
    const seam = data.buffs[b.type].seam;
    mods[seam] += b.magnitude;
  }
  return mods;
}

const NO_EFFECTS: { dishSellBonus?: number; cookingXpBonus?: number } = {};
