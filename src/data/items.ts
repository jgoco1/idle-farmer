// Item definitions (docs/DATA_SCHEMAS.md §4.1). Items are generated from the other tables so names
// and prices are defined once: a crop item and a seed item per crop. Fish, junk and dishes join in
// phases 05 and 06.

import { CROPS } from './crops';
import { CROP_IDS, seedOf, type CropId, type ItemId, type SeedId } from './ids';
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

/** Every item that exists so far. Phase 05/06 widen this to the full `Record<ItemId, ItemDef>`. */
export type FarmItemId = CropId | SeedId;

export const ITEMS: Readonly<Record<FarmItemId, ItemDef>> = Object.freeze(
  Object.fromEntries(
    CROP_IDS.flatMap((id) => [
      [id, cropItem(id)],
      [seedOf(id), seedItem(id)],
    ]),
  ) as Record<FarmItemId, ItemDef>,
);

export function itemDef(items: Readonly<Partial<Record<ItemId, ItemDef>>>, id: ItemId): ItemDef {
  const def = items[id];
  if (!def) throw new Error(`Unknown item '${id}'`);
  return def;
}
