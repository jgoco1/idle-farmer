// Modifier seams (docs/DATA_SCHEMAS.md §5). Buffs, perks and upgrades are folded into one struct
// once per step; systems read `ctx.mods` and never look at buffs or upgrades themselves.

import type { GameState } from '../core/state';
import type { GameData } from '../data';
import type { SeasonId } from '../data/ids';
import { bundleBonuses } from './bundles';
import { perkTotals } from './skills';

export interface Modifiers {
  growthModifier: number; // × crop growth rate          (phase 02 seam)
  sellPriceModifier: number; // × sale price             (phase 03 seam)
  fishingLuckModifier: number; // additive luck, 0 = none (phase 05 seam)
  fishingSpeedModifier: number; // × bite and trap speed  (phase 05 seam)
  cookSpeedModifier: number; // × cooking speed          (phase 06 seam)
  automationSpeedModifier: number; // × farmhand/planter speed (phase 04 seam)
  xpModifier: number; // × XP gained                     (phase 06 buff; read by 07)
  dishSellBonus: number; // additive on dish prices       (season effect 06, Cooking perks 07)
  cookingXpBonus: number; // additive on Cooking XP       (season effect, read by 07)
  cropSellBonus: number; // additive on crop prices       (Farming perks, 07)
  fishSellBonus: number; // additive on fish prices       (Fishing perk, 07)
  doubleHarvestChance: number; // chance of a double yield  (Farming perks, 07)
  reelZoneBonus: number; // additive on the reel zone     (Fishing perks, 07)
  trapCapacityBonus: number; // extra items a trap holds  (Fishing perks, 07)
  buffDurationBonus: number; // additive on buff duration (Cooking perks, 07)
  ingredientSaveChance: number; // chance a dish saves one ingredient (Cooking perks, 07)
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
  cropSellBonus: 0,
  fishSellBonus: 0,
  doubleHarvestChance: 0,
  reelZoneBonus: 0,
  trapCapacityBonus: 0,
  buffDurationBonus: 0,
  ingredientSaveChance: 0,
});

/**
 * Folds every source into one struct as `1 + (buff + perk + upgrade)`, never compounded. Sources:
 * food buffs (phase 06), the fishing rod's luck (05), the kitchen's speed (06), and since phase 07
 * the skill perks and the Community Board's luck. `season` (from `ctx.calendar`) brings in the seasonal dish sell bonus
 * and Cooking XP bonus; leave it out and there are none.
 */
export function computeModifiers(state: GameState, data: GameData, season?: SeasonId): Modifiers {
  const rod = data.upgrades.fishing_rod?.effect[state.upgrades.fishing_rod ?? 0];
  const kitchen = data.upgrades.kitchen?.effect[state.upgrades.kitchen ?? 0];
  const effects = season ? data.seasons[season].effects : NO_EFFECTS;
  const perks = perkTotals(state, data);
  const bundles = bundleBonuses(state, data);
  const mods: Modifiers = {
    growthModifier: 1 + perks.growth,
    sellPriceModifier: 1,
    fishingLuckModifier: (rod?.luck ?? 0) + perks.luck + bundles.luck,
    fishingSpeedModifier: 1,
    cookSpeedModifier: 1 + (kitchen?.cookSpeed ?? 0) + perks.cookSpeed,
    automationSpeedModifier: 1,
    xpModifier: 1,
    dishSellBonus: (effects.dishSellBonus ?? 0) + perks.dishSell,
    cookingXpBonus: effects.cookingXpBonus ?? 0,
    cropSellBonus: perks.cropSell,
    fishSellBonus: perks.fishSell,
    doubleHarvestChance: perks.doubleHarvestChance,
    reelZoneBonus: perks.reelZone,
    trapCapacityBonus: perks.trapCapacity,
    buffDurationBonus: perks.buffDuration,
    ingredientSaveChance: perks.ingredientSaveChance,
  };
  // This runs every simulation step, so buffs are folded in one pass rather than looked up per type.
  for (const b of state.buffs.active) {
    const seam = data.buffs[b.type].seam;
    mods[seam] += b.magnitude;
  }
  return mods;
}

const NO_EFFECTS: { dishSellBonus?: number; cookingXpBonus?: number } = {};
