// The Kitchen's recipe-book order (a per-device pref, `prefs.kitchenSort`). Pure, so it is unit-tested
// without a DOM. Every order is stable: ties keep the order the recipes were learned in.

import type { GameState } from '../core/state';
import type { GameData } from '../data';
import type { RecipeId } from '../data/ids';
import type { KitchenSort } from '../core/prefs';
import { canCook } from '../systems/cooking';

export const KITCHEN_SORT_LABELS: Readonly<Record<KitchenSort, string>> = {
  ready: 'Can cook now',
  price: 'Sell price',
  tier: 'Tier',
  buff: 'Buff',
  name: 'Name',
};

/** The known recipes in `mode` order (a new array; `known` is not changed). */
export function sortRecipes(
  known: readonly RecipeId[],
  state: GameState,
  data: GameData,
  mode: KitchenSort,
): RecipeId[] {
  const r = (id: RecipeId) => data.recipes[id];
  const by: Record<KitchenSort, (a: RecipeId, b: RecipeId) => number> = {
    // Cookable first; then the best sellers, so the top of the list is the best thing to put on the stove.
    ready: (a, b) =>
      Number(canCook(state, r(b))) - Number(canCook(state, r(a))) || r(b).basePrice - r(a).basePrice,
    price: (a, b) => r(b).basePrice - r(a).basePrice,
    tier: (a, b) => r(b).tier - r(a).tier || r(b).basePrice - r(a).basePrice,
    buff: (a, b) =>
      data.buffs[r(a).buff].name.localeCompare(data.buffs[r(b).buff].name) || r(b).tier - r(a).tier,
    name: (a, b) => r(a).name.localeCompare(r(b).name),
  };
  return [...known].sort(by[mode]);
}
