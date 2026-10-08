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

export type FishLocationId = 'pond' | 'river' | 'ocean' | 'lake';

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
  | 'moonfin'
  | LakeFishId;

/** The mountain lake's fish (v4 phase 04, BALANCE.md §14.7). */
export type LakeFishId = 'whitefish' | 'lake_trout' | 'crayfish' | 'pike' | 'golden_trout' | 'alpine_char';

export type JunkId = 'old_boot' | 'seaweed' | 'driftwood';

/** The kitchen's dishes (the stove's recipes). */
export type DishId =
  // T1
  | 'roasted_turnip'
  | 'baked_potato'
  | 'grilled_bluegill'
  | 'berry_bowl'
  | 'seaweed_salad'
  | 'wheat_flatbread'
  | 'baked_apple'
  | 'fried_egg'
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
  | 'soft_cheese'
  | 'garden_omelette'
  // T3
  | 'seafood_stew'
  | 'pumpkin_soup'
  | 'cranberry_pie'
  | 'catfish_gumbo'
  | 'scholars_stew'
  | 'peach_cobbler'
  | 'apricot_custard'
  | 'lemon_meringue_pie'
  | 'persimmon_pudding'
  // T4
  | 'garden_banquet'
  | 'royal_sturgeon'
  | 'harvest_feast'
  | 'moonfin_sushi'
  // v4-03: honey dishes
  | 'honey_cake'
  | 'honey_roast_yams'
  // v4-04: forage dishes
  | 'mushroom_risotto'
  | 'blackberry_tart';

/** The Press House's drinks (v4 phase 03, BALANCE.md §14.4); v4-04 adds the two forage drinks. Non-alcoholic. */
export type DrinkId =
  | 'tomato_juice'
  | 'honey_milk'
  | 'strawberry_cordial'
  | 'blueberry_cordial'
  | 'lemonade'
  | 'apple_cider'
  | 'peach_iced_tea'
  | 'melon_cooler'
  | 'hot_cocoa'
  | 'orchard_punch'
  // v4-04: forage drinks
  | 'herbal_tea'
  | 'elderflower_cordial';

/**
 * Every recipe: the kitchen's dishes and (v4-03) the Press House's drinks, which are recipes with
 * `station: 'press'`. A cooked dish or a pressed drink is an item whose id is the recipe id.
 */
export type RecipeId = DishId | DrinkId;

/** The fruits of the orchard's trees (v2 phase 03, BALANCE.md §13.5). A fruit is also an item, like a crop. */
export type FruitId = 'cherry' | 'apricot' | 'peach' | 'apple' | 'pear' | 'persimmon' | 'lemon';
/** A tree is `<fruit>_tree`; its sapling is the bag item `sapling_<fruit>`. */
export type TreeId = `${FruitId}_tree`;
export type SaplingId = `sapling_${FruitId}`;

/** The animals of the ranch (v2 phase 04, BALANCE.md §13.6). Hens live in the coop, cows in the barn. */
export type AnimalId = 'chicken' | 'cow';
/** What the animals give. A large egg is its own item, not a quality tier. */
export type AnimalProductId = 'egg' | 'large_egg' | 'milk';
/** What the animals eat: made from wheat and corn, or bought at the Ranch. */
export type FeedId = 'hay' | 'corn_feed';
export type BuildingId = 'coop' | 'barn' | 'silo';

/** The apiary's honey and the Press House shelf's cocoa (v4 phase 03). */
export type PressItemId = 'honey' | 'cocoa';

/** What the North Woods' forage spots grow (v4 phase 04, BALANCE.md §14.7). */
export type ForageId =
  'morel' | 'chanterelle' | 'wild_mint' | 'elderflower' | 'blackberry' | 'rose_hip' | 'hazelnut';
/** A forage spot's kind; the season picks its item (`FORAGE_KINDS` in src/data/forage.ts). */
export type ForageKind = 'mushroom' | 'herb' | 'flower' | 'nut';

export type ItemId =
  | CropId
  | SeedId
  | FishId
  | JunkId
  | DishId
  | DrinkId
  | FruitId
  | SaplingId
  | AnimalProductId
  | FeedId
  | PressItemId
  | ForageId;

export type UpgradeId =
  // farm automation and tools (phase 04)
  | 'sprinkler'
  | 'sprinkler_tech'
  | 'scarecrow'
  | 'farmhand'
  | 'seed_planter'
  | 'auto_seller'
  | 'seed_order'
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
  | 'kitchen'
  // the ranch (v2 phase 04)
  | 'ranch_collector'
  // the North Woods (v4 phase 04)
  | 'forager_basket';

export type ExpansionId = 'farm_1' | 'farm_2' | 'farm_3' | 'farm_4' | 'river' | 'ocean' | 'lake';

/** Land parcels, bought in this order (v2 phase 01, BALANCE.md §13.1; the north fields v4-01, §14.1). */
export type ParcelId = 'orchard' | 'yard' | 'meadow' | NorthFieldId;

/** A north parcel that carries a plot grid (v4-01): also the field id of its plots. */
export type NorthFieldId = 'north_fields' | 'terraces';

/** Which field a plot is in (v4-01), derived from its index (`fieldOf` in src/systems/farming.ts). */
export type FieldId = 'home' | 'greenhouse' | NorthFieldId;

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
  | 'm20_first_fruit'
  // v2-04
  | 'm21_first_egg'
  | 'm22_first_milk'
  // v4-01
  | 'm24_north_field'
  // v4-02
  | 'm25_first_serving'
  // v4-03
  | 'm26_first_drink'
  | 'm27_first_honey'
  // v4-04
  | 'm28_first_forage'
  | 'm29_lake_fish';

export type BundleId =
  | 'spring_crops'
  | 'summer_crops'
  | 'autumn_harvest'
  | 'pond_fish'
  | 'river_and_sea'
  | 'cozy_dinner'
  | 'orchard_basket'
  | 'barnyard'
  // v4-03
  | 'press_house'
  // v4-04
  | 'forager';

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
  | 'pick_fruit'
  | 'collect_produce'
  // v4-02
  | 'serve_dishes'
  // v4-03
  | 'press_drinks';

export type PanelId =
  | 'inventory'
  | 'shop'
  | 'market'
  | 'kitchen'
  | 'fishing'
  | 'upgrades'
  | 'goals'
  | 'settings'
  | 'ranch'
  | 'restaurant'
  | 'press';

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
  // v4-04: the mountain lake
  'whitefish',
  'lake_trout',
  'crayfish',
  'pike',
  'golden_trout',
  'alpine_char',
];

export const JUNK_IDS: readonly JunkId[] = ['old_boot', 'seaweed', 'driftwood'];

/** The kitchen's dishes in table order (drinks are in `DRINK_IDS`; `ALL_RECIPE_IDS` has both). */
export const RECIPE_IDS: readonly DishId[] = [
  'roasted_turnip',
  'baked_potato',
  'grilled_bluegill',
  'berry_bowl',
  'seaweed_salad',
  'wheat_flatbread',
  'baked_apple',
  'fried_egg',
  'vegetable_soup',
  'fish_tacos',
  'tomato_pasta',
  'corn_chowder',
  'blueberry_muffin',
  'glazed_yams',
  'garlic_trout',
  'cherry_jam',
  'soft_cheese',
  'pear_crumble',
  'garden_omelette',
  'seafood_stew',
  'pumpkin_soup',
  'cranberry_pie',
  'catfish_gumbo',
  'scholars_stew',
  'peach_cobbler',
  'apricot_custard',
  'lemon_meringue_pie',
  'persimmon_pudding',
  'garden_banquet',
  'royal_sturgeon',
  'harvest_feast',
  'moonfin_sushi',
  'honey_cake',
  'honey_roast_yams',
  'mushroom_risotto',
  'blackberry_tart',
];

/** The Press House's drinks in table order (T1 first). */
export const DRINK_IDS: readonly DrinkId[] = [
  'tomato_juice',
  'honey_milk',
  'strawberry_cordial',
  'blueberry_cordial',
  'lemonade',
  'apple_cider',
  'peach_iced_tea',
  'melon_cooler',
  'hot_cocoa',
  'orchard_punch',
  'herbal_tea',
  'elderflower_cordial',
];

/** Every recipe: dishes, then drinks. */
export const ALL_RECIPE_IDS: readonly RecipeId[] = [...RECIPE_IDS, ...DRINK_IDS];

export const PARCEL_IDS: readonly ParcelId[] = ['orchard', 'yard', 'meadow', 'north_fields', 'terraces'];

/** The north fields in plot-index order (v4-01). */
export const NORTH_FIELD_IDS: readonly NorthFieldId[] = ['north_fields', 'terraces'];

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

/** The North Woods' forage items (v4-04). */
export const FORAGE_IDS: readonly ForageId[] = [
  'morel',
  'chanterelle',
  'wild_mint',
  'elderflower',
  'blackberry',
  'rose_hip',
  'hazelnut',
];

export const FORAGE_KINDS_IDS: readonly ForageKind[] = ['mushroom', 'herb', 'flower', 'nut'];

export function isForageId(id: string): id is ForageId {
  return (FORAGE_IDS as readonly string[]).includes(id);
}

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

export const ANIMAL_IDS: readonly AnimalId[] = ['chicken', 'cow'];
export const ANIMAL_PRODUCT_IDS: readonly AnimalProductId[] = ['egg', 'large_egg', 'milk'];
export const FEED_IDS: readonly FeedId[] = ['hay', 'corn_feed'];
export const BUILDING_IDS: readonly BuildingId[] = ['coop', 'barn', 'silo'];

export function isAnimalProductId(id: string): id is AnimalProductId {
  return (ANIMAL_PRODUCT_IDS as readonly string[]).includes(id);
}

export function isFeedId(id: string): id is FeedId {
  return (FEED_IDS as readonly string[]).includes(id);
}

export function isAnimalId(id: string): id is AnimalId {
  return (ANIMAL_IDS as readonly string[]).includes(id);
}

export function isBuildingId(id: string): id is BuildingId {
  return (BUILDING_IDS as readonly string[]).includes(id);
}

export function isSaplingId(id: string): id is SaplingId {
  return id.startsWith('sapling_') && isFruitId(id.slice('sapling_'.length));
}

export function isDecorId(id: string): id is DecorId {
  return (DECOR_IDS as readonly string[]).includes(id);
}

/** The farm cats (cosmetic): the brown tabby everyone starts with, and the ones adopted in the Shop's Decor tab. */
export type CatId =
  'cat_tabby' | 'cat_orange' | 'cat_black' | 'cat_silver' | 'cat_tuxedo' | 'cat_siamese' | 'cat_calico';

export const CAT_IDS: readonly CatId[] = [
  'cat_tabby',
  'cat_orange',
  'cat_black',
  'cat_silver',
  'cat_tuxedo',
  'cat_siamese',
  'cat_calico',
];

export function isCatId(id: string): id is CatId {
  return (CAT_IDS as readonly string[]).includes(id);
}

export function isTownProjectId(id: string): id is TownProjectId {
  return (TOWN_PROJECT_IDS as readonly string[]).includes(id);
}

export function isParcelId(id: string): id is ParcelId {
  return (PARCEL_IDS as readonly string[]).includes(id);
}

export function isNorthFieldId(id: string): id is NorthFieldId {
  return (NORTH_FIELD_IDS as readonly string[]).includes(id);
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

export function isDrinkId(id: string): id is DrinkId {
  return (DRINK_IDS as readonly string[]).includes(id);
}

export function isRecipeId(id: string): id is RecipeId {
  return isDishId(id) || isDrinkId(id);
}
