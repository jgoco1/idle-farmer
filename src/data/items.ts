// Item definitions (docs/DATA_SCHEMAS.md §4.1). Items are generated from the other tables so names
// and prices are defined once: a crop item and a seed item per crop, an item per fish and per junk
// item (phase 05) and a dish per recipe (phase 06).

import { CROPS } from './crops';
import { FISH, JUNK } from './fish';
import { RECIPES } from './recipes';
import {
  CROP_IDS,
  FISH_IDS,
  JUNK_IDS,
  RECIPE_IDS,
  seedOf,
  type CropId,
  type FishId,
  type ItemId,
  type JunkId,
  type RecipeId,
} from './ids';
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
    description: `Plant in ${seasons}. Ready in ${Math.round(c.growSec / 60)} min when watered.`,
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

function dishItem(id: RecipeId): ItemDef {
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

/** Every item in the game. */
export type FarmItemId = ItemId;

const ENTRIES: [FarmItemId, ItemDef][] = [
  ...CROP_IDS.flatMap((id): [FarmItemId, ItemDef][] => [
    [id, cropItem(id)],
    [seedOf(id), seedItem(id)],
  ]),
  ...FISH_IDS.map((id): [FarmItemId, ItemDef] => [id, fishItem(id)]),
  ...JUNK_IDS.map((id): [FarmItemId, ItemDef] => [id, junkItem(id)]),
  ...RECIPE_IDS.map((id): [FarmItemId, ItemDef] => [id, dishItem(id)]),
];

export const ITEMS: Readonly<Record<FarmItemId, ItemDef>> = Object.freeze(
  Object.fromEntries(ENTRIES) as Record<FarmItemId, ItemDef>,
);

export function itemDef(items: Readonly<Partial<Record<ItemId, ItemDef>>>, id: ItemId): ItemDef {
  const def = items[id];
  if (!def) throw new Error(`Unknown item '${id}'`);
  return def;
}
