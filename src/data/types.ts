// Content definitions shared by the data tables (docs/DATA_SCHEMAS.md §3–4). Only the shapes the
// current phases use live here; later phases add theirs (FishDef, RecipeDef, …).

import type {
  BundleId,
  CropId,
  ExpansionId,
  FishId,
  ItemId,
  MilestoneId,
  SeasonId,
  SkillId,
  UpgradeId,
} from './ids';

/** `hearty`: a dish finished cooking in winter (phase 06). Stacks only merge when `hearty` matches. */
export interface ItemStack {
  item: ItemId;
  qty: number;
  hearty?: true;
}

/** Something that must be true before content is visible/usable. All entries in an array must hold. */
export type UnlockCondition =
  | { kind: 'farmLevel'; level: number }
  | { kind: 'skillLevel'; skill: SkillId; level: number }
  | { kind: 'expansion'; id: ExpansionId }
  | { kind: 'upgrade'; id: UpgradeId; level: number }
  | { kind: 'milestone'; id: MilestoneId }
  | { kind: 'bundle'; id: BundleId }
  | { kind: 'caught'; fish: FishId }
  | { kind: 'lifetimeGold'; amount: number };

export type ItemCategory = 'seed' | 'crop' | 'fish' | 'junk' | 'dish';

export interface ItemDef {
  id: ItemId;
  name: string;
  description: string;
  category: ItemCategory;
  basePrice: number; // market base price; seeds use their shop price here but are not sellable
  sellable: boolean; // seeds: false
  edible: boolean; // dishes only
  sprite: string; // sprite id, e.g. 'item_turnip'
}

export interface CropDef {
  id: CropId;
  name: string;
  seasons: readonly SeasonId[]; // multi-season crops survive the change between listed seasons
  growSec: number; // seed → ready, watered, at 1× growth
  regrowSec: number | null; // null = single harvest; else time from harvest back to ready
  stages: 5; // seed, sprout, mid, near-ready, ready (fixed in v1)
  regrowToStage: 2 | null; // regrowing crops drop back to stage 2 (mid) after harvest
  yield: { min: number; max: number }; // inclusive, rolled with the seeded RNG
  seedPrice: number; // shop price of one seed
  basePrice: number; // market base price of one harvested crop
  unlock: readonly UnlockCondition[]; // for the seed in the shop
  xp: number; // Farming XP per harvested unit (phase 07)
  description: string; // one cozy line for tooltips
}
