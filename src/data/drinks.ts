// The Press House's drinks (v4 phase 03; GDD §13.5, BALANCE.md §14.4). Non-alcoholic by the owner's
// decision (GDD §13.12 decision 1): juices, cordials, sweet cider in the old sense, iced tea, lemonade
// and cocoa. A drink is a recipe with `station: 'press'`; `cookSec` is its press time, which no
// modifier shortens. `tier` and `basePrice` are declared for readability and checked by a test against
// the dish formula with a press time term (`TIER_PRESS_DIV`). Buffs are the seven existing types, in the
// existing slots; no drink gives Silver Tongue (drinks add choice, not gold power). A drink is an item
// whose id is the recipe id (see items.ts). The two forage drinks came with the woods in v4-04.

import type { DrinkId } from './ids';
import type { RecipeDef } from './types';

const FROM_THE_PRESS = [{ kind: 'press', level: 1 }] as const;

export const DRINKS: Readonly<Record<DrinkId, RecipeDef>> = Object.freeze({
  // ---- T1
  tomato_juice: {
    id: 'tomato_juice',
    name: 'Tomato Juice',
    station: 'press',
    ingredients: [{ item: 'tomato', qty: 4 }],
    cookSec: 20 * 60,
    tier: 1,
    buff: 'growth',
    basePrice: 60,
    fresh: ['summer', 'autumn'],
    discovery: { kind: 'press' },
    description: 'Pressed thick and red with a pinch of salt. The seedlings perk up.',
  },
  // ---- T2
  honey_milk: {
    id: 'honey_milk',
    name: 'Honey Milk',
    station: 'press',
    ingredients: [
      { item: 'milk', qty: 1 },
      { item: 'honey', qty: 1 },
    ],
    cookSec: 20 * 60,
    tier: 2,
    buff: 'automationSpeed',
    basePrice: 546,
    fresh: ['spring', 'summer', 'autumn', 'winter'],
    discovery: { kind: 'press' },
    description: 'Warm milk stirred with a spoon of honey. Everyone on the farm works with a hum.',
  },
  strawberry_cordial: {
    id: 'strawberry_cordial',
    name: 'Strawberry Cordial',
    station: 'press',
    ingredients: [
      { item: 'strawberry', qty: 4 },
      { item: 'honey', qty: 1 },
    ],
    cookSec: 30 * 60,
    tier: 2,
    buff: 'fishingSpeed',
    basePrice: 322,
    fresh: ['spring'],
    discovery: { kind: 'card', price: 3_000, unlock: FROM_THE_PRESS },
    description: 'Pink, sweet and fizzing faintly. The fish seem to hurry to the hook.',
  },
  blueberry_cordial: {
    id: 'blueberry_cordial',
    name: 'Blueberry Cordial',
    station: 'press',
    ingredients: [
      { item: 'blueberry', qty: 6 },
      { item: 'honey', qty: 1 },
    ],
    cookSec: 30 * 60,
    tier: 2,
    buff: 'fishingLuck',
    basePrice: 311,
    fresh: ['summer'],
    discovery: { kind: 'card', price: 3_000, unlock: FROM_THE_PRESS },
    description: 'Deep purple and tart. Rare fish come up to see what the colour is.',
  },
  // ---- T3
  lemonade: {
    id: 'lemonade',
    name: 'Lemonade',
    station: 'press',
    ingredients: [
      { item: 'lemon', qty: 1 },
      { item: 'honey', qty: 1 },
    ],
    cookSec: 60 * 60,
    tier: 3,
    buff: 'cookSpeed',
    basePrice: 1360,
    fresh: ['winter', 'spring'],
    discovery: { kind: 'milestone', id: 'm26_first_drink' },
    description: 'Bright, cold and honey-sweet. The cook works twice as fast with a glass of it.',
  },
  apple_cider: {
    id: 'apple_cider',
    name: 'Sweet Cider',
    station: 'press',
    ingredients: [{ item: 'apple', qty: 2 }],
    cookSec: 90 * 60,
    tier: 3,
    buff: 'growth',
    basePrice: 944,
    fresh: ['summer', 'autumn'],
    discovery: { kind: 'card', price: 6_000, unlock: FROM_THE_PRESS },
    description: 'Cloudy pressed apple juice, the old farmhouse kind. Not a drop of anything stronger.',
  },
  peach_iced_tea: {
    id: 'peach_iced_tea',
    name: 'Peach Iced Tea',
    station: 'press',
    ingredients: [
      { item: 'peach', qty: 1 },
      { item: 'honey', qty: 1 },
    ],
    cookSec: 60 * 60,
    tier: 3,
    buff: 'fishingSpeed',
    basePrice: 1040,
    fresh: ['summer'],
    discovery: { kind: 'card', price: 8_000, unlock: FROM_THE_PRESS },
    description: 'Steeped long and poured over ice. A summer afternoon by the water.',
  },
  melon_cooler: {
    id: 'melon_cooler',
    name: 'Melon Cooler',
    station: 'press',
    ingredients: [
      { item: 'melon', qty: 1 },
      { item: 'blueberry', qty: 4 },
    ],
    cookSec: 60 * 60,
    tier: 3,
    buff: 'fishingLuck',
    basePrice: 978,
    fresh: ['summer'],
    discovery: { kind: 'card', price: 8_000, unlock: FROM_THE_PRESS },
    description: 'Green melon and blueberries, crushed and chilled. The deep water feels friendly.',
  },
  hot_cocoa: {
    id: 'hot_cocoa',
    name: 'Hot Cocoa',
    station: 'press',
    ingredients: [
      { item: 'milk', qty: 2 },
      { item: 'cocoa', qty: 1 },
      { item: 'honey', qty: 1 },
    ],
    cookSec: 45 * 60,
    tier: 3,
    buff: 'xp',
    basePrice: 1104,
    fresh: ['spring', 'summer', 'autumn', 'winter'],
    discovery: { kind: 'card', price: 10_000, unlock: FROM_THE_PRESS },
    description: 'Thick, dark and steaming. A cup of it and every lesson sticks.',
  },
  // ---- T4
  orchard_punch: {
    id: 'orchard_punch',
    name: 'Orchard Punch',
    station: 'press',
    ingredients: [
      { item: 'apple', qty: 1 },
      { item: 'pear', qty: 1 },
      { item: 'persimmon', qty: 1 },
      { item: 'cranberry', qty: 4 },
      { item: 'honey', qty: 1 },
    ],
    cookSec: 180 * 60,
    tier: 4,
    buff: 'automationSpeed',
    basePrice: 3372,
    fresh: ['autumn'],
    discovery: { kind: 'card', price: 20_000, unlock: [{ kind: 'press', level: 2 }] },
    description: 'The whole autumn orchard in one bowl, slow-pressed all afternoon. The farm fairly buzzes.',
  },
  // ---- forage drinks (v4 phase 04, BALANCE.md §14.4)
  herbal_tea: {
    id: 'herbal_tea',
    name: 'Herbal Tea',
    station: 'press',
    ingredients: [{ item: 'wild_mint', qty: 2 }],
    cookSec: 20 * 60,
    tier: 1,
    buff: 'xp',
    basePrice: 113,
    fresh: ['spring', 'summer', 'autumn'],
    discovery: { kind: 'milestone', id: 'm28_first_forage' },
    description:
      'Wild mint steeped in a brown pot. Clears the head, and every lesson sticks a little better.',
  },
  elderflower_cordial: {
    id: 'elderflower_cordial',
    name: 'Elderflower Cordial',
    station: 'press',
    ingredients: [
      { item: 'elderflower', qty: 3 },
      { item: 'honey', qty: 1 },
    ],
    cookSec: 60 * 60,
    tier: 3,
    buff: 'cookSpeed',
    basePrice: 528,
    fresh: ['spring'],
    discovery: { kind: 'card', price: 9_000, unlock: FROM_THE_PRESS },
    description: 'Flower heads steeped overnight with honey and lemon peel. The kitchen fairly flies.',
  },
} satisfies Record<DrinkId, RecipeDef>);
