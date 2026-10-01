// Id unions for every content table (docs/DATA_SCHEMAS.md §2). Most tables arrive in later
// phases; the unions exist now so references type-check from the start.

export type SeasonId = 'spring' | 'summer' | 'autumn' | 'winter';

export type CropId =
  | 'turnip'
  | 'potato'
  | 'garlic'
  | 'strawberry'
  | 'cauliflower'
  | 'wheat'
  | 'tomato'
  | 'blueberry'
  | 'corn'
  | 'melon'
  | 'yam'
  | 'kale'
  | 'cranberry'
  | 'pumpkin'
  | 'leek';

export type SeedId = `seed_${CropId}`;

export type FishLocationId = 'pond' | 'river' | 'ocean';

export type FishId =
  | 'bluegill'
  | 'carp'
  | 'catfish'
  | 'koi'
  | 'trout'
  | 'perch'
  | 'salmon'
  | 'sturgeon'
  | 'sardine'
  | 'mackerel'
  | 'tuna'
  | 'pufferfish'
  | 'petal_koi'
  | 'ember_salmon'
  | 'sun_marlin'
  | 'moonfin';

export type JunkId = 'old_boot' | 'seaweed' | 'driftwood';

export type RecipeId =
  // T1
  | 'roasted_turnip'
  | 'baked_potato'
  | 'grilled_bluegill'
  | 'berry_bowl'
  | 'seaweed_salad'
  | 'wheat_flatbread'
  | 'baked_apple'
  // T2
  | 'vegetable_soup'
  | 'fish_tacos'
  | 'tomato_pasta'
  | 'corn_chowder'
  | 'blueberry_muffin'
  | 'glazed_yams'
  | 'garlic_trout'
  | 'cherry_jam'
  | 'pear_crumble'
  // T3
  | 'seafood_stew'
  | 'pumpkin_soup'
  | 'cranberry_pie'
  | 'catfish_gumbo'
  | 'scholars_stew'
  | 'peach_cobbler'
  // T4
  | 'garden_banquet'
  | 'royal_sturgeon'
  | 'harvest_feast'
  | 'moonfin_sushi';

/** A cooked dish is an item whose id is the recipe id. */
export type DishId = RecipeId;

/** The fruits of the orchard's trees (v2 phase 03, BALANCE.md §13.5). A fruit is also an item, like a crop. */
export type FruitId = 'cherry' | 'apricot' | 'peach' | 'apple' | 'pear' | 'persimmon' | 'lemon';
/** A tree is `<fruit>_tree`; its sapling is the bag item `sapling_<fruit>`. */
export type TreeId = `${FruitId}_tree`;
export type SaplingId = `sapling_${FruitId}`;

export type ItemId = CropId | SeedId | FishId | JunkId | DishId | FruitId | SaplingId;

export type UpgradeId =
  // farm automation and tools (phase 04)
  | 'sprinkler'
  | 'sprinkler_tech'
  | 'scarecrow'
  | 'farmhand'
  | 'seed_planter'
  | 'auto_seller'
  | 'watering_can'
  | 'hoe'
  | 'barn_storage'
  | 'greenhouse'
  // inventory (phase 03)
  | 'backpack'
  // fishing (phase 05)
  | 'fish_trap'
  | 'fishing_rod'
  | 'trap_collector'
  // cooking (phase 06)
  | 'kitchen';

export type ExpansionId = 'farm_1' | 'farm_2' | 'farm_3' | 'farm_4' | 'river' | 'ocean';

/** Land parcels of the v2 world, bought in this order (v2 phase 01, BALANCE.md §13.1). */
export type ParcelId = 'orchard' | 'yard' | 'meadow';

/** Town projects (v2 phase 02, GDD §12.2). Their building sites are world layout (v2 phase 01). */
export type TownProjectId =
  'old_bridge' | 'fountain' | 'bakery' | 'bandstand' | 'lighthouse' | 'community_hall';

/** The decoration sets (v2 phase 02): Cottage is open at once, the others open with a town project. */
export type DecorSetId = 'cottage' | 'seaside' | 'harvest_fair';

/** Every decoration piece (GDD §12.2, BALANCE.md §13.2). Farmhouse paint, roof and loft are pieces too. */
export type DecorId =
  // Cottage
  | 'cobble_path'
  | 'picket_fence'
  | 'flower_bed'
  | 'garden_lamp'
  | 'wooden_bench'
  | 'birdbath'
  | 'rose_arch'
  | 'paint_sage'
  | 'paint_sky'
  | 'roof_thatch'
  | 'roof_slate'
  | 'farmhouse_loft'
  // Seaside
  | 'plank_path'
  | 'rope_fence'
  | 'sandcastle'
  | 'lobster_pots'
  | 'deck_chair'
  | 'beach_umbrella'
  | 'harbour_lamp'
  | 'rowboat'
  | 'driftwood_arch'
  | 'ship_figurehead'
  // Harvest Fair
  | 'brick_path'
  | 'rail_fence'
  | 'straw_bale'
  | 'pumpkin_stack'
  | 'sunflower_patch'
  | 'lantern_string'
  | 'apple_cart'
  | 'stone_well'
  | 'fair_stall'
  | 'windmill';

export type BuffType =
  'growth' | 'sellPrice' | 'fishingLuck' | 'fishingSpeed' | 'cookSpeed' | 'automationSpeed' | 'xp';

export type SkillId = 'farming' | 'fishing' | 'cooking';

export type Rarity = 'common' | 'uncommon' | 'rare' | 'legendary';

export type RecipeTier = 1 | 2 | 3 | 4;

export type MilestoneId =
  | 'm01_first_seed'
  | 'm02_first_harvest'
  | 'm03_first_sale'
  | 'm04_first_expansion'
  | 'm05_first_sprinkler'
  | 'm06_first_catch'
  | 'm07_first_dish'
  | 'm08_first_buff'
  | 'm09_hire_farmhand'
  | 'm10_unlock_river'
  | 'm11_farm_level_5'
  | 'm12_cook_t3'
  | 'm13_unlock_ocean'
  | 'm14_first_bundle'
  | 'm15_greenhouse'
  // v2 (checked from state or counted from events; no farm points, BALANCE.md §13.9)
  | 'm16_first_parcel'
  | 'm17_first_decor'
  | 'm18_charm_25'
  | 'm19_first_project'
  | 'm23_charm_100'
  // v2-03
  | 'm20_first_fruit';

export type BundleId =
  | 'spring_crops'
  | 'summer_crops'
  | 'autumn_harvest'
  | 'pond_fish'
  | 'river_and_sea'
  | 'cozy_dinner'
  | 'orchard_basket';

export type GoalTemplateId =
  | 'harvest_crop'
  | 'harvest_any'
  | 'earn_gold_day'
  | 'ship_items'
  | 'catch_fish'
  | 'catch_rarity'
  | 'cook_tier'
  | 'cook_distinct'
  | 'eat_dish'
  | 'raise_charm'
  | 'pick_fruit';

export type PanelId =
  'inventory' | 'shop' | 'market' | 'kitchen' | 'fishing' | 'upgrades' | 'goals' | 'settings';

export const CROP_IDS: readonly CropId[] = [
  'turnip',
  'potato',
  'garlic',
  'strawberry',
  'cauliflower',
  'wheat',
  'tomato',
  'blueberry',
  'corn',
  'melon',
  'yam',
  'kale',
  'cranberry',
  'pumpkin',
  'leek',
];

export const FISH_IDS: readonly FishId[] = [
  'bluegill',
  'carp',
  'catfish',
  'koi',
  'trout',
  'perch',
  'salmon',
  'sturgeon',
  'sardine',
  'mackerel',
  'tuna',
  'pufferfish',
  'petal_koi',
  'ember_salmon',
  'sun_marlin',
  'moonfin',
];

export const JUNK_IDS: readonly JunkId[] = ['old_boot', 'seaweed', 'driftwood'];

export const RECIPE_IDS: readonly RecipeId[] = [
  'roasted_turnip',
  'baked_potato',
  'grilled_bluegill',
  'berry_bowl',
  'seaweed_salad',
  'wheat_flatbread',
  'baked_apple',
  'vegetable_soup',
  'fish_tacos',
  'tomato_pasta',
  'corn_chowder',
  'blueberry_muffin',
  'glazed_yams',
  'garlic_trout',
  'cherry_jam',
  'pear_crumble',
  'seafood_stew',
  'pumpkin_soup',
  'cranberry_pie',
  'catfish_gumbo',
  'scholars_stew',
  'peach_cobbler',
  'garden_banquet',
  'royal_sturgeon',
  'harvest_feast',
  'moonfin_sushi',
];

export const PARCEL_IDS: readonly ParcelId[] = ['orchard', 'yard', 'meadow'];

export const TOWN_PROJECT_IDS: readonly TownProjectId[] = [
  'old_bridge',
  'fountain',
  'bakery',
  'bandstand',
  'lighthouse',
  'community_hall',
];

export const DECOR_SET_IDS: readonly DecorSetId[] = ['cottage', 'seaside', 'harvest_fair'];

export const DECOR_IDS: readonly DecorId[] = [
  'cobble_path',
  'picket_fence',
  'flower_bed',
  'garden_lamp',
  'wooden_bench',
  'birdbath',
  'rose_arch',
  'paint_sage',
  'paint_sky',
  'roof_thatch',
  'roof_slate',
  'farmhouse_loft',
  'plank_path',
  'rope_fence',
  'sandcastle',
  'lobster_pots',
  'deck_chair',
  'beach_umbrella',
  'harbour_lamp',
  'rowboat',
  'driftwood_arch',
  'ship_figurehead',
  'brick_path',
  'rail_fence',
  'straw_bale',
  'pumpkin_stack',
  'sunflower_patch',
  'lantern_string',
  'apple_cart',
  'stone_well',
  'fair_stall',
  'windmill',
];

export const FRUIT_IDS: readonly FruitId[] = [
  'cherry',
  'apricot',
  'peach',
  'apple',
  'pear',
  'persimmon',
  'lemon',
];

export function treeOfFruit(f: FruitId): TreeId {
  return `${f}_tree`;
}

export function fruitOfTree(t: TreeId): FruitId {
  return t.slice(0, -'_tree'.length) as FruitId;
}

export function saplingOf(f: FruitId): SaplingId {
  return `sapling_${f}`;
}

export function fruitOfSapling(s: SaplingId): FruitId {
  return s.slice('sapling_'.length) as FruitId;
}

export function isFruitId(id: string): id is FruitId {
  return (FRUIT_IDS as readonly string[]).includes(id);
}

export function isSaplingId(id: string): id is SaplingId {
  return id.startsWith('sapling_') && isFruitId(id.slice('sapling_'.length));
}

export function isDecorId(id: string): id is DecorId {
  return (DECOR_IDS as readonly string[]).includes(id);
}

export function isTownProjectId(id: string): id is TownProjectId {
  return (TOWN_PROJECT_IDS as readonly string[]).includes(id);
}

export function isParcelId(id: string): id is ParcelId {
  return (PARCEL_IDS as readonly string[]).includes(id);
}

export function seedOf(crop: CropId): SeedId {
  return `seed_${crop}`;
}

export function cropOfSeed(seed: SeedId): CropId {
  return seed.slice('seed_'.length) as CropId;
}

export function isCropId(id: string): id is CropId {
  return (CROP_IDS as readonly string[]).includes(id);
}

export function isSeedId(id: string): id is SeedId {
  return id.startsWith('seed_') && isCropId(id.slice('seed_'.length));
}

export function isFishId(id: string): id is FishId {
  return (FISH_IDS as readonly string[]).includes(id);
}

export function isJunkId(id: string): id is JunkId {
  return (JUNK_IDS as readonly string[]).includes(id);
}

export function isDishId(id: string): id is DishId {
  return (RECIPE_IDS as readonly string[]).includes(id);
}
