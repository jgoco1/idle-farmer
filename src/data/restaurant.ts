// The restaurant, The Bramble Table (v4 phase 02; GDD §13.4, BALANCE.md §14.3, DATA_SCHEMAS.md §10.4).
// Three levels on its fixed site on the north road; the serving constants are in balance.ts.

import type { RecipeId } from './ids';
import type { RestaurantDef } from './types';

/** Sunday first, one week per season (spring, summer, autumn, winter). */
const SPECIAL_ROTA: readonly RecipeId[] = [
  // spring
  'vegetable_soup',
  'cherry_jam',
  'garlic_trout',
  'apricot_custard',
  'scholars_stew',
  'lemon_meringue_pie',
  'garden_banquet',
  // summer
  'fish_tacos',
  'blueberry_muffin',
  'tomato_pasta',
  'corn_chowder',
  'seafood_stew',
  'peach_cobbler',
  'royal_sturgeon',
  // autumn
  'glazed_yams',
  'pear_crumble',
  'honey_roast_yams', // v4-03 (was a second Corn Chowder)
  'catfish_gumbo',
  'cranberry_pie',
  'pumpkin_soup',
  'harvest_feast',
  // winter
  'soft_cheese',
  'garden_omelette',
  'hot_cocoa', // v4-03: drinks join the rota (was a second Scholar's Stew)
  'honey_cake', // v4-03 (was a second Apricot Custard)
  'lemonade', // v4-03 (was a second Lemon Meringue Pie)
  'persimmon_pudding',
  'moonfin_sushi',
];

export const RESTAURANT: RestaurantDef = Object.freeze({
  name: 'The Bramble Table',
  requires: [
    { kind: 'farmLevel', level: 7 },
    { kind: 'upgrade', id: 'kitchen', level: 2 },
    { kind: 'parcel', id: 'yard' },
  ],
  levels: [
    { price: 120_000, slots: 2, premium: 1.3 },
    { price: 350_000, slots: 3, premium: 1.45 },
    { price: 800_000, slots: 4, premium: 1.6 },
  ],
  specialRota: SPECIAL_ROTA,
  sprites: {
    building: ['obj_restaurant_1', 'obj_restaurant_2', 'obj_restaurant_3'],
    table: 'obj_table',
    tableDish: 'obj_table_dish',
  },
} satisfies RestaurantDef);
