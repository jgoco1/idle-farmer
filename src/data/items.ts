// Item definitions (docs/DATA_SCHEMAS.md §4.1). Items are generated from the other tables so names
// and prices are defined once: a crop item and a seed item per crop, an item per fish and per junk
// item (phase 05) and a dish per recipe (phase 06).

import { CROPS } from './crops';
import { ANIMALS, FEEDS } from './animals';
import { TREES } from './trees';
import { FISH, JUNK } from './fish';
import { RECIPES } from './recipes';
import { FORAGE } from './forage';
import {
  CROP_IDS,
  FISH_IDS,
  ANIMAL_PRODUCT_IDS,
  FEED_IDS,
  FRUIT_IDS,
  saplingOf,
  treeOfFruit,
  JUNK_IDS,
  RECIPE_IDS,
  DRINK_IDS,
  FORAGE_IDS,
  seedOf,
  type AnimalProductId,
  type CropId,
  type FeedId,
  type FishId,
  type FruitId,
  type ItemId,
  type JunkId,
  type DishId,
  type DrinkId,
  type ForageId,
  type PressItemId,
} from './ids';
import { COCOA_PRICE, HONEY_PRICE } from './balance';
import type { ItemDef } from './types';

function cropItem(id: CropId): ItemDef {
  const c = CROPS[id];
  return {
    id,
    name: c.name,
    description: c.description,
    category: 'crop',
    basePrice: c.basePrice,
    sellable: true,
    edible: false,
    sprite: `item_${id}`,
  };
}

function seedItem(id: CropId): ItemDef {
  const c = CROPS[id];
  const seasons = c.seasons.map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(', ');
  return {
    id: seedOf(id),
    name: `${c.name} Seeds`,
    description:
      `Plant in ${seasons}. Ready in ${Math.round(c.growSec / 60)} min when watered.` +
      (c.regrowSec === null
        ? ''
        : ` Keeps producing: harvest again every ${Math.round(c.regrowSec / 60)} min until its seasons end.`),
    category: 'seed',
    basePrice: c.seedPrice,
    sellable: false,
    edible: false,
    sprite: `item_seed_${id}`,
  };
}

function fishItem(id: FishId): ItemDef {
  const f = FISH[id];
  return {
    id,
    name: f.name,
    description: f.description,
    category: 'fish',
    basePrice: f.basePrice,
    sellable: true,
    edible: false,
    sprite: `item_${id}`,
  };
}

function junkItem(id: JunkId): ItemDef {
  const j = JUNK[id];
  return {
    id,
    name: j.name,
    description: j.description,
    category: 'junk',
    basePrice: j.basePrice,
    sellable: true,
    edible: false,
    sprite: `item_${id}`,
  };
}

function dishItem(id: DishId): ItemDef {
  const r = RECIPES[id];
  return {
    id,
    name: r.name,
    description: r.description,
    category: 'dish',
    basePrice: r.basePrice,
    sellable: true,
    edible: true,
    sprite: `item_${id}`,
  };
}

/** A pressed drink (v4-03): sellable, drunk for a buff like a dish, and it goes on the restaurant's menu. */
function drinkItem(id: DrinkId): ItemDef {
  const r = RECIPES[id];
  return {
    id,
    name: r.name,
    description: r.description,
    category: 'drink',
    basePrice: r.basePrice,
    sellable: true,
    edible: true,
    sprite: `item_${id}`,
  };
}

/** Honey from the apiary and cocoa from the Press House shelf (v4-03). */
const PRESS_ITEMS: Record<PressItemId, ItemDef> = {
  honey: {
    id: 'honey',
    name: 'Honey',
    description: 'A jar of golden honey from the hives on the north road. Sweetens drinks and a cake or two.',
    category: 'animal',
    basePrice: HONEY_PRICE,
    sellable: true,
    edible: false,
    sprite: 'item_honey',
  },
  cocoa: {
    id: 'cocoa',
    name: 'Cocoa Beans',
    description: 'A little sack from the Press House shelf, for Hot Cocoa in any season. Not for selling.',
    category: 'ingredient',
    basePrice: COCOA_PRICE,
    sellable: false,
    edible: false,
    sprite: 'item_cocoa',
  },
};

/** A wild thing from the North Woods (v4-04): sold at the Market, and an ingredient in two drinks and two dishes. */
function forageItem(id: ForageId): ItemDef {
  const f = FORAGE.items[id];
  return {
    id,
    name: f.name,
    description: f.description,
    category: 'forage',
    basePrice: f.basePrice,
    sellable: true,
    edible: false,
    sprite: `item_${id}`,
  };
}

function fruitItem(id: FruitId): ItemDef {
  const t = TREES[treeOfFruit(id)];
  return {
    id,
    name: t.name,
    description: `Picked from the ${t.name.toLowerCase()} tree.`,
    category: 'fruit',
    basePrice: t.fruitPrice,
    sellable: true,
    edible: false,
    sprite: `item_${id}`,
  };
}

function saplingItem(id: FruitId): ItemDef {
  const t = TREES[treeOfFruit(id)];
  const seasons = t.seasons.map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(' and ');
  return {
    id: saplingOf(id),
    name: `${t.name} Sapling`,
    description: `Plant on a tree spot in the orchard. Bears in ${seasons}, ${t.matureDays} days after planting.`,
    category: 'sapling',
    basePrice: t.saplingPrice,
    sellable: false,
    edible: false,
    sprite: `item_sapling_${id}`,
  };
}

const PRODUCTS: Record<AnimalProductId, { name: string; description: string; basePrice: number }> = {
  egg: { name: 'Egg', description: 'Warm from the nest.', basePrice: 90 },
  large_egg: {
    name: 'Large Egg',
    description: 'A double-yolker. Someone is proud of herself.',
    basePrice: 200,
  },
  milk: { name: 'Milk', description: 'Fresh, creamy and still cool from the barn.', basePrice: 240 },
};

function productItem(id: AnimalProductId): ItemDef {
  const p = PRODUCTS[id];
  return {
    id,
    name: p.name,
    description: p.description,
    category: 'animal',
    basePrice: p.basePrice,
    sellable: true,
    edible: false,
    sprite: `item_${id}`,
  };
}

function feedItem(id: FeedId): ItemDef {
  const f = FEEDS[id];
  const eater = ANIMALS[id === 'hay' ? 'cow' : 'chicken'];
  return {
    id,
    name: f.name,
    description: `Fills a trough for the ${eater.plural.toLowerCase()}: one portion per animal each cycle. Made from ${f.from}, or bought at the Ranch; kept in the ranch's feed store.`,
    category: 'feed',
    basePrice: 13,
    sellable: false,
    edible: false,
    sprite: `item_${id}`,
  };
}

/** Every item in the game. */
export type FarmItemId = ItemId;

const ENTRIES: [FarmItemId, ItemDef][] = [
  ...CROP_IDS.flatMap((id): [FarmItemId, ItemDef][] => [
    [id, cropItem(id)],
    [seedOf(id), seedItem(id)],
  ]),
  ...FRUIT_IDS.flatMap((id): [FarmItemId, ItemDef][] => [
    [id, fruitItem(id)],
    [saplingOf(id), saplingItem(id)],
  ]),
  ...ANIMAL_PRODUCT_IDS.map((id): [FarmItemId, ItemDef] => [id, productItem(id)]),
  ...FEED_IDS.map((id): [FarmItemId, ItemDef] => [id, feedItem(id)]),
  ...FISH_IDS.map((id): [FarmItemId, ItemDef] => [id, fishItem(id)]),
  ...JUNK_IDS.map((id): [FarmItemId, ItemDef] => [id, junkItem(id)]),
  ...RECIPE_IDS.map((id): [FarmItemId, ItemDef] => [id, dishItem(id)]),
  ...DRINK_IDS.map((id): [FarmItemId, ItemDef] => [id, drinkItem(id)]),
  ['honey', PRESS_ITEMS.honey],
  ['cocoa', PRESS_ITEMS.cocoa],
  ...FORAGE_IDS.map((id): [FarmItemId, ItemDef] => [id, forageItem(id)]),
];

export const ITEMS: Readonly<Record<FarmItemId, ItemDef>> = Object.freeze(
  Object.fromEntries(ENTRIES) as Record<FarmItemId, ItemDef>,
);
