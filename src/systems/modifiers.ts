// Modifier seams (docs/DATA_SCHEMAS.md §5). Buffs, perks and upgrades are folded into one struct
// once per step; systems read `ctx.mods` and never look at buffs or upgrades themselves.

import type { GameState } from '../core/state';
import type { GameData } from '../data';

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

/** Sources are added in later phases: `1 + (buff + perk + upgrade)`, never compounded. */
export function computeModifiers(_state: GameState, _data: GameData): Modifiers {
  return { ...NO_MODIFIERS };
}
