# Data Schemas

This is the type contract for all content (`src/data/`) and the save state (`src/core/state.ts`, `src/core/save.ts`). It is written as TypeScript so it can be copied into code almost directly. The numbers live in `docs/BALANCE.md`; this document only defines shapes and ids.

Every id listed here also appears in the BALANCE.md tables and the GDD. If you add an id, add it in all three places. If code and this document disagree, fix one of them in the same PR and say so in `docs/PROGRESS.md`. **v2** (world coordinates, decorations, trees, animals and the save plan to version 11) is §9.

---

## 1. Units and conventions

| Quantity | Unit | Notes |
|---|---|---|
| Durations **in data** (`growSec`, `cookSec`, `intervalSec`, …) | seconds of simulated time, integer | Simulated time runs at real speed while playing and at the capped offline rate while away (BALANCE.md §1). |
| Timers **in state** (`growthMs`, `remainingMs`, `waterMsLeft`, …) | simulated milliseconds, integer | Avoids float drift. Round with `Math.round` once per step when a modifier is applied. |
| Simulated clock | `clock.simMs`, integer ms of simulated time since the save was created | Drives every timer. Never derived from `Date`. |
| Calendar | computed from the real local time (`now`) by `src/core/time.ts` | Time of day, day, season and year. Systems receive it as `ctx.calendar`; they never read `Date` themselves. |
| Gold | integer | Never fractional. Prices are floored to an integer at the moment of sale, minimum 1. |
| Percent modifiers | multipliers as numbers, `1.0` = no change | A +20% bonus is stored as `0.2` in data and applied as `1 + 0.2`. |
| Probabilities | `0..1` | |

Constants and calendar types (defined once in `src/core/time.ts`):

```ts
export const TICK_MS = 100;                        // fixed simulation step, 10 ticks per second
export const SEASONS: readonly SeasonId[] = ['spring', 'summer', 'autumn', 'winter'];
export const DAY_START_HOUR = 6;                   // daily calendar events fire at 06:00 local
export const NIGHT_START_HOUR = 20;                // night is 20:00–06:00 local
export const MIN_FIRST_SEASON_DAYS = 3;            // the first spring lasts at least this long

/** Everything a system may know about real-world time. Built by the core from `now`, never inside systems. */
export interface Calendar {
  nowMs: number;            // calendar epoch ms = real now + calendar.debugOffsetMs (only for display and logs)
  hour: number;             // 0..23 local
  minute: number;           // 0..59 local
  weekday: number;          // 0 = Sunday … 6 = Saturday, local
  dayKey: string;           // 'YYYY-MM-DD' local date, minus a day before 06:00: one "day" runs 06:00 → 06:00
  weekIndex: number;        // 0 = the first (possibly longer) spring; +1 at each counted Sunday 00:00
  season: SeasonId;         // SEASONS[weekIndex % 4]
  year: number;             // floor(weekIndex / 4) + 1
  isNight: boolean;
  msToSeasonChange: number; // real ms until the next counted Sunday 00:00
}

/** Wraps the time zone so tests can run in a fixed zone. */
export interface LocalClock { parts(epochMs: number): { y: number; mo: number; d: number; h: number; mi: number; wd: number } }
```

---

## 2. Id types (`src/data/ids.ts`)

Ids are string-literal unions so that every cross-reference in data is checked by the compiler. Data tables are typed as `Record<XId, XDef>` so a missing or extra entry is a compile error.

```ts
export type SeasonId = 'spring' | 'summer' | 'autumn' | 'winter';

export type CropId =
  | 'turnip' | 'potato' | 'garlic' | 'strawberry' | 'cauliflower'
  | 'wheat' | 'tomato' | 'blueberry' | 'corn' | 'melon'
  | 'yam' | 'kale' | 'cranberry' | 'pumpkin' | 'leek';

export type SeedId = `seed_${CropId}`;              // e.g. 'seed_turnip'

export type FishLocationId = 'pond' | 'river' | 'ocean';

export type FishId =
  | 'bluegill' | 'carp' | 'catfish' | 'koi'              // pond
  | 'trout' | 'perch' | 'salmon' | 'sturgeon'            // river
  | 'sardine' | 'mackerel' | 'tuna' | 'pufferfish'                // ocean
  | 'petal_koi' | 'ember_salmon' | 'sun_marlin' | 'moonfin';       // legendaries: spring pond, autumn river, summer ocean, winter ocean

export type JunkId = 'old_boot' | 'seaweed' | 'driftwood';

export type RecipeId =
  // T1
  | 'roasted_turnip' | 'baked_potato' | 'grilled_bluegill' | 'berry_bowl'
  | 'seaweed_salad' | 'wheat_flatbread'
  // T2
  | 'vegetable_soup' | 'fish_tacos' | 'tomato_pasta' | 'corn_chowder'
  | 'blueberry_muffin' | 'glazed_yams' | 'garlic_trout'
  // T3
  | 'seafood_stew' | 'pumpkin_soup' | 'cranberry_pie' | 'catfish_gumbo' | 'scholars_stew'
  // T4
  | 'garden_banquet' | 'royal_sturgeon' | 'harvest_feast' | 'moonfin_sushi';   // spring, summer, autumn, winter

/** A cooked dish is an item whose id is the recipe id. */
export type DishId = RecipeId;

export type ItemId = CropId | SeedId | FishId | JunkId | DishId;

export type UpgradeId =
  // farm automation and tools (phase 04)
  | 'sprinkler' | 'sprinkler_tech' | 'scarecrow' | 'farmhand' | 'seed_planter'
  | 'auto_seller' | 'watering_can' | 'hoe' | 'barn_storage' | 'greenhouse'
  // inventory (phase 03)
  | 'backpack'
  // fishing (phase 05)
  | 'fish_trap' | 'fishing_rod' | 'trap_collector'
  // cooking (phase 06)
  | 'kitchen';

export type ExpansionId = 'farm_1' | 'farm_2' | 'farm_3' | 'farm_4' | 'river' | 'ocean';

export type BuffType =
  | 'growth' | 'sellPrice' | 'fishingLuck' | 'fishingSpeed'
  | 'cookSpeed' | 'automationSpeed' | 'xp';

export type SkillId = 'farming' | 'fishing' | 'cooking';

export type Rarity = 'common' | 'uncommon' | 'rare' | 'legendary';

export type RecipeTier = 1 | 2 | 3 | 4;

export type MilestoneId =
  | 'm01_first_seed' | 'm02_first_harvest' | 'm03_first_sale' | 'm04_first_expansion'
  | 'm05_first_sprinkler' | 'm06_first_catch' | 'm07_first_dish' | 'm08_first_buff'
  | 'm09_hire_farmhand' | 'm10_unlock_river' | 'm11_farm_level_5' | 'm12_cook_t3'
  | 'm13_unlock_ocean' | 'm14_first_bundle' | 'm15_greenhouse';

export type BundleId =
  | 'spring_crops' | 'summer_crops' | 'autumn_harvest'
  | 'pond_fish' | 'river_and_sea' | 'cozy_dinner';

export type GoalTemplateId =
  | 'harvest_crop' | 'harvest_any' | 'earn_gold_day' | 'ship_items'
  | 'catch_fish' | 'catch_rarity' | 'cook_tier' | 'cook_distinct' | 'eat_dish';

export type PanelId =
  | 'inventory' | 'shop' | 'market' | 'kitchen' | 'fishing' | 'upgrades' | 'goals' | 'settings';
```

Helpers that go with them: `seedOf(crop: CropId): SeedId`, `cropOfSeed(seed: SeedId): CropId`, and type guards `isCropId`, `isFishId`, `isDishId`, `isSeedId`.

---

## 3. Shared building blocks

```ts
/** An inclusive hour window on the 24h clock. Wraps past midnight when start > end (e.g. 20 → 6). */
export interface HourWindow { start: number; end: number }   // 0..24, local time

/** `hearty`: a dish finished cooking in winter (BALANCE.md §7). Stacks only merge when `hearty` matches. */
export interface ItemStack { item: ItemId; qty: number; hearty?: true }

/**
 * Something that must be true before content is visible/usable. All entries in an array must hold.
 * Since phase 07 'farmLevel' comes from skills and milestones (BALANCE.md §8); 'skillLevel', 'milestone'
 * and 'bundle' are real. 'knownRecipes' needs `GameData` to read tiers, so `isUnlocked(state, conds, data?)` takes it.
 */
export type UnlockCondition =
  | { kind: 'farmLevel'; level: number }
  | { kind: 'skillLevel'; skill: SkillId; level: number }
  | { kind: 'expansion'; id: ExpansionId }
  | { kind: 'upgrade'; id: UpgradeId; level: number }
  | { kind: 'milestone'; id: MilestoneId }
  | { kind: 'bundle'; id: BundleId }
  | { kind: 'caught'; fish: FishId }
  | { kind: 'lifetimeGold'; amount: number }
  | { kind: 'fishCaught'; count: number }                          // phase 07: fish landed in total
  | { kind: 'knownRecipes'; count: number; minTier: RecipeTier };  // phase 07: recipes known of at least that tier

/** Upgrade cost curve: cost to go from level n to n+1 (or buy the (n+1)th placeable) = roundNice(base * ratio^n). */
export interface CostCurve { base: number; ratio: number }
```

---

## 4. Content definitions (`src/data/*.ts`)

### 4.1 `ItemDef` (`items.ts`)

Items are mostly **generated** from the other tables (`seed_*` from crops, crop items from crops, fish from fish, dishes from recipes) so that names and prices are defined once. Only junk is authored directly in `items.ts`.

```ts
export type ItemCategory = 'seed' | 'crop' | 'fish' | 'junk' | 'dish';

export interface ItemDef {
  id: ItemId;
  name: string;
  description: string;
  category: ItemCategory;
  basePrice: number;          // market base price; seeds use their shop price here but are not sellable
  sellable: boolean;          // seeds: false
  edible: boolean;            // dishes only
  sprite: string;             // sprite id, e.g. 'item_turnip'
}
```

### 4.2 `CropDef` (`crops.ts`)

```ts
export interface CropDef {
  id: CropId;
  name: string;
  seasons: readonly SeasonId[];        // multi-season crops survive the change between listed seasons
  growSec: number;                     // seed → ready, watered, at 1× growth
  regrowSec: number | null;            // null = single harvest; else time from harvest back to ready
  stages: 5;                           // seed, sprout, mid, near-ready, ready (fixed in v1)
  regrowToStage: 2 | null;             // regrowing crops drop back to stage index 2 (mid) after harvest
  yield: { min: number; max: number }; // inclusive, rolled with the seeded RNG
  seedPrice: number;                   // shop price of one seed
  basePrice: number;                   // market base price of one harvested crop
  unlock: readonly UnlockCondition[];  // for the seed in the shop
  xp: number;                          // Farming XP per harvested unit (see BALANCE.md §8)
}
```

Stage shown on screen (`plotStage` in `src/systems/farming.ts`): with `progress = growthMs / needMs`, a crop is stage **4 only when ready** (`progress >= 1`); before that a first growth shows `min(3, floor(4 * progress))` (stages 0–3 in equal quarters), and a regrow cycle shows stage 2 for its first half and 3 for its second. (Phase 02 changed this from `min(4, floor(5 * progress))`, which drew the ready sprite for the last fifth of growth before the crop could be harvested.)

`CropDef` also has a `description: string` (one line for tooltips); items copy it. In phase 02 `ItemStack`, `UnlockCondition`, `ItemDef` and `CropDef` live in `src/data/types.ts`.

### 4.3 `FishDef` (`fish.ts`) and junk

```ts
export interface FishDef {
  id: FishId;
  name: string;
  location: FishLocationId;
  seasons: readonly SeasonId[];
  hours: HourWindow;               // when it bites (local time); {start:0,end:24} = any time. Traps ignore it.
  rarity: Rarity;
  difficulty: number;              // 0..100, drives the reel minigame
  sizeCm: { min: number; max: number };
  basePrice: number;
  trappable: boolean;              // true only for common and uncommon fish
}

export interface JunkDef {
  id: JunkId;
  name: string;
  basePrice: number;
  locations: readonly FishLocationId[];
}
```

### 4.4 `RecipeDef` (`recipes.ts`)

```ts
export interface RecipeDef {
  id: RecipeId;
  name: string;
  ingredients: readonly ItemStack[];   // crops, fish and seaweed only in v1 (no dish-in-dish)
  cookSec: number;                     // seconds of simulated time at 1× cook speed
  tier: RecipeTier;                    // declared, and verified against recipeTier() by a unit test
  buff: BuffType;
  basePrice: number;                   // = round(ingredientValue * TIER_SELL_MULT[tier]), see BALANCE.md §7
  discovery: RecipeDiscovery;
}

export type RecipeDiscovery =
  | { kind: 'starter' }
  | { kind: 'card'; price: number; unlock: readonly UnlockCondition[] }   // bought in the Shop
  | { kind: 'milestone'; id: MilestoneId }
  | { kind: 'experiment' };                                               // only by experimenting
```

`recipeTier(recipe, items)` is a pure function in `src/systems/cooking.ts`. It computes the tier from the ingredients and cook time with the formula in BALANCE.md §7. The declared `tier` is kept in data for readability, and a test asserts the two match for every recipe.

> **Phase 06 status.** `RecipeDef` and `RecipeDiscovery` also carry `description` (one cozy line) in `src/data/types.ts`. `recipeTier()` uses `cookSec / 30` (BALANCE.md §7).

### 4.5 `BuffDef` (`buffs.ts`)

```ts
export interface BuffDef {
  type: BuffType;
  name: string;                 // 'Green Thumb', 'Silver Tongue', …
  description: string;          // "Crops grow {pct} faster."
  magnitudeScale: number;       // multiplies the tier magnitude (BALANCE.md §7)
  seam: keyof Modifiers;        // which modifier it drives
  icon: string;                 // sprite id
  additive: boolean;            // phase 06: luck is added (+0.10); the others are percentages
}
```

### 4.6 `UpgradeDef` (`upgrades.ts`)

```ts
export type UpgradeCategory = 'farm' | 'tools' | 'storage' | 'fishing' | 'kitchen';

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  description: string;                      // one cozy line for the Upgrades panel
  category: UpgradeCategory;
  kind: 'leveled' | 'placeable';
  /** leveled: highest level. placeable: most units the player may own. */
  max: number;
  cost: CostCurve;                          // see BALANCE.md §4
  /** Human-readable effect per level, index = level (index 0 = not owned / base). */
  effectText: readonly string[];
  /** Numeric effect table read by systems, index = level (or number owned for placeables). */
  effect: readonly UpgradeEffect[];
  requires: readonly UnlockCondition[];
  /** Placeables only: where they may be placed. */
  placeOn?: 'plot' | 'water';
  /** Extra conditions for buying one level (key = the level being bought), e.g. Sprinkler Tech. */
  levelRequires?: Readonly<Record<number, readonly UnlockCondition[]>>;
}

/** Each upgrade uses the fields relevant to it; unused fields are omitted. */
export interface UpgradeEffect {
  radius?: number;                // sprinkler/scarecrow area (Chebyshev radius; 'plus' = orthogonal only)
  shape?: 'plus' | 'square';
  growthBonus?: number;           // scarecrow
  intervalSec?: number;           // farmhand, fish trap
  capacity?: number;              // farmhand plots per visit, trap slots, cook-queue slots
  toolArea?: 1 | 3 | 9 | 25;      // watering can / hoe tiles per click
  inventorySlots?: number;        // backpack
  stackSize?: number;             // barn storage
  greenhousePlots?: number;
  reelZoneMult?: number;          // fishing rod
  luck?: number;                  // fishing rod
  cookSpeed?: number;             // kitchen
  flags?: readonly ('replantHarvested' | 'plantEmpty' | 'autoTill' | 'autoShip' | 'keepReserve' | 'autoCollect')[];
}
```

### 4.7 `SeasonDef` (`seasons.ts`)

```ts
export interface SeasonDef {
  id: SeasonId;
  name: string;
  effects: {
    heartyDishes?: boolean;        // dishes finishing in this season are marked hearty (winter)
    cookingXpBonus?: number;       // +0.5 in winter
    dishSellBonus?: number;        // +0.25 in winter
  };
}
```

### 4.8 `ExpansionDef` (`expansions.ts`)

```ts
export interface ExpansionDef {
  id: ExpansionId;
  name: string;
  kind: 'farm' | 'fishing';
  price: number;
  requires: readonly UnlockCondition[];   // farm_n requires farm_(n-1); river/ocean require farm levels
  /** farm: the plot grid size after buying. */
  grid?: { cols: number; rows: number };
  /** fishing: the location it opens. */
  location?: FishLocationId;
  sceneChange: string;                    // short note for the renderer, e.g. 'fence moves east 1 tile'
  description: string;                    // one cozy line for the Upgrades panel (phase 03)
}
```

Phase 03: `EXPANSIONS` (`src/data/expansions.ts`) is a full `Record<ExpansionId, ExpansionDef>`; prices of the farm steps come from `FARM_EXPANSION_COST` with `roundNice`. `buyExpansion` refuses the fishing kinds until phase 05. What each step changes in the scene is `DECOR` in `src/render/scene.ts` (shown `until` / `from` an expansion).

The starting grid (4 × 2) is a constant, `START_GRID`, not an expansion.

### 4.9 Progression (`skills.ts`, `quests.ts`), phase 07

```ts
export interface SkillPerkDef {
  skill: SkillId;
  level: number;                 // 2..10
  text: string;                  // shown to the player; for BALANCE.md's "(total)" rows it names the running total
  effect: PerkEffect;
}

/** Every entry is what THAT LEVEL ADDS. `perkTotals` (src/systems/skills.ts) sums the levels reached. */
export type PerkEffect =
  | { kind: 'doubleHarvestChance'; chance: number }
  | { kind: 'growth'; bonus: number }
  | { kind: 'sellPrice'; bonus: number; category: 'crop' | 'fish' | 'dish' }
  | { kind: 'reelZone'; bonus: number }          // additive: × (1 + Σ) on top of the rod
  | { kind: 'fishingLuck'; bonus: number }
  | { kind: 'trapCapacity'; bonus: number }
  | { kind: 'cookSpeed'; bonus: number }
  | { kind: 'buffDuration'; bonus: number }
  | { kind: 'buffSlot'; count: number }
  | { kind: 'ingredientSaveChance'; chance: number };

/** Objectives are counted from events, never by scanning state (except 'reachFarmLevel', which checks it). */
export type QuestObjective =
  | { kind: 'plant'; crop?: CropId; count: number }
  | { kind: 'harvest'; crop?: CropId; count: number }
  | { kind: 'sell'; count: number }
  | { kind: 'earnGold'; amount: number; withinOneDay?: boolean }   // counts sales and other gold, never quest rewards
  | { kind: 'ship'; count: number }                                // units the Shipping Bin paid for
  | { kind: 'catch'; location?: FishLocationId; rarity?: Rarity; count: number }   // fish only, traps included
  | { kind: 'cook'; tier?: RecipeTier; distinct?: boolean; count: number }        // tier means "at least"
  | { kind: 'eat'; count: number }
  | { kind: 'place'; what: 'sprinkler'; count: number }
  | { kind: 'buyUpgrade'; id: UpgradeId; level?: number }
  | { kind: 'buyExpansion'; id: ExpansionId }
  | { kind: 'reachFarmLevel'; level: number }
  | { kind: 'completeBundle'; count: number };

export type QuestReward =
  | { kind: 'gold'; amount: number }
  | { kind: 'items'; items: readonly ItemStack[] }
  | { kind: 'recipe'; id: RecipeId }
  | { kind: 'xp'; skill: SkillId; amount: number };

/** Used for both the fixed milestone chain and goal-board templates. A template's objective is a pattern; rewards are worked out per goal. */
export interface QuestDef {
  id: MilestoneId | GoalTemplateId;
  kind: 'milestone' | 'goal';
  title: string;                         // goal templates: {n} {crop} {location} {a_rarity} {tier}
  flavor: string;                        // one warm line
  objective: QuestObjective;
  rewards: readonly QuestReward[];
  requires: readonly UnlockCondition[];  // goal templates are only drawn when these hold
}

export interface BundleDef {
  id: BundleId;
  name: string;
  flavor: string;
  slots: readonly ItemStack[];
  reward: BundleReward;
  rewardText: string;                    // the reward in words, for the Community Board
}

export type BundleReward =
  | { kind: 'unlockGreenhouse' }         // read as the `bundle` unlock condition on the greenhouse
  | { kind: 'buffSlot' }
  | { kind: 'inventorySlots'; count: number }
  | { kind: 'trapPerLocation'; count: number }
  | { kind: 'fishingLuck'; bonus: number }
  | { kind: 'goldenScarecrow' };         // radius and bonus are GOLDEN_SCARECROW in balance.ts
```

Phase 07 as built: `CropDef` gained an optional `plural` ("Potatoes", "Garlic") for goal text. `src/data/skills.ts` also has `SKILL_IDS`, `SKILL_NAMES`, `SKILL_BLURB` and `SKILL_ICONS`; `src/data/quests.ts` has `MILESTONES`, `GOAL_TEMPLATES` and `BUNDLES` (plus `MILESTONE_IDS` and `BUNDLE_IDS`).

### 4.10 The data bundle

```ts
/** Everything in src/data, gathered once. Systems receive it as an argument; they never import data files directly. */
export interface GameData {
  items: Record<ItemId, ItemDef>;
  crops: Record<CropId, CropDef>;
  fish: Record<FishId, FishDef>;
  junk: Record<JunkId, JunkDef>;
  recipes: Record<RecipeId, RecipeDef>;
  buffs: Record<BuffType, BuffDef>;
  seasons: Record<SeasonId, SeasonDef>;
  upgrades: Record<UpgradeId, UpgradeDef>;
  expansions: Record<ExpansionId, ExpansionDef>;
  perks: readonly SkillPerkDef[];                        // phase 07
  milestones: readonly QuestDef[];                       // phase 07, in chain order
  goalTemplates: Record<GoalTemplateId, QuestDef>;       // phase 07
  bundles: Record<BundleId, BundleDef>;                  // phase 07
}
```

Passing `GameData` in (rather than importing it inside systems) lets tests use tiny fake tables.

Phase 05 status: `GameData` also has `fish` and `junk` (`src/data/fish.ts`, with `FISH_LOCATIONS` and `LOCATION_NAMES`); `items` now holds an item per fish and per junk item (generated in `items.ts`). `FishDef` and `JunkDef` gained a `description`; `HourWindow`, `FishDef` and `JunkDef` live in `src/data/types.ts`. `UpgradeEffect` gained `reelZoneMult` and `luck` and the `autoCollect` flag; `UpgradeDef.placeOn` may be `'water'` (fish traps). `upgrades` now holds `fish_trap`, `fishing_rod` and `trap_collector`.

Phase 03 status: `GameData` also has `expansions` (full record) and `upgrades` (`Partial<Record<UpgradeId, UpgradeDef>>`, only `backpack` so far; `UpgradeEffect` has only `inventorySlots` until phase 04 adds its fields). `CostCurve`, `UpgradeDef`, `UpgradeEffect` and `ExpansionDef` live in `src/data/types.ts`.

Phase 02 status: `GameData` has `startGrid`, `crops` and `items`. `items` is `Partial<Record<ItemId, ItemDef>>` until phases 05/06 add fish, junk and dishes; it holds a crop item and a `seed_<crop>` item per crop, generated in `src/data/items.ts`.

---

## 5. Modifier seams

Every tunable multiplier goes through one struct, computed once per step by `computeModifiers(state, data)` in `src/systems/modifiers.ts`. Systems never look at buffs, perks or upgrades to work out a multiplier; they read `mods`.

```ts
export interface Modifiers {
  growthModifier: number;           // × crop growth rate          (phase 02 seam; sources: scarecrow is per-plot, perks 07, buff 06)
  sellPriceModifier: number;        // × sale price                 (phase 03 seam; sources: buff 06, perks 07)
  fishingLuckModifier: number;      // additive luck, 0 = none      (phase 05 seam; sources: rod 05, buff 06, perks/bundle 07)
  fishingSpeedModifier: number;     // × bite and trap speed        (phase 05 seam; source: buff 06)
  cookSpeedModifier: number;        // × cooking speed              (phase 06 seam; sources: kitchen 06, buff 06, perks 07)
  automationSpeedModifier: number;  // × farmhand/planter speed     (phase 04 seam; source: buff 06)
  animalSpeedModifier: number;      // × animal production speed    (v2-05 seam; source: the Busy Bees buff, via BuffDef.alsoSeam)
  xpModifier: number;               // × XP gained                  (phase 06 buff; read by 07)
  dishSellBonus: number;            // additive on dish prices      (season effect 06, Cooking perks 07)
  cookingXpBonus: number;           // additive on Cooking XP       (season effect; read by 07)
  cropSellBonus: number;            // additive on crop prices      (Farming perks, 07)
  fishSellBonus: number;            // additive on fish prices      (Fishing perk, 07)
  doubleHarvestChance: number;      // chance a harvest doubles     (Farming perks, 07)
  reelZoneBonus: number;            // additive on the reel zone    (Fishing perks, 07)
  trapCapacityBonus: number;        // extra items a trap holds     (Fishing perks, 07)
  buffDurationBonus: number;        // additive on buff duration    (Cooking perks, 07)
  ingredientSaveChance: number;     // chance a dish saves one ingredient (Cooking perks, 07)
}

export const NO_MODIFIERS: Modifiers = {
  growthModifier: 1, sellPriceModifier: 1, fishingLuckModifier: 0, fishingSpeedModifier: 1,
  cookSpeedModifier: 1, automationSpeedModifier: 1, animalSpeedModifier: 1, xpModifier: 1, dishSellBonus: 0, cookingXpBonus: 0,
  cropSellBonus: 0, fishSellBonus: 0, doubleHarvestChance: 0, reelZoneBonus: 0, trapCapacityBonus: 0,
  buffDurationBonus: 0, ingredientSaveChance: 0,
};
```

Multiplicative sources stack by **adding their bonuses, then multiplying once**: `1 + (buff + perk + upgrade)`. This keeps numbers predictable and stops runaway compounding. Scarecrow growth is per-plot and is applied inside `farming.ts` on top of `growthModifier`.

---

## 6. `GameState` (`src/core/state.ts`)

This is the **full v1 target shape**. Each field is tagged with the phase that introduces it. Phase 01 implements only the `@01` fields; later phases add theirs, bump `SAVE_VERSION`, and write a migration (see §8). State is plain JSON: no classes, `Map`s, `Set`s, `Date`s or functions, so it serialises directly.

```ts
export interface GameState {
  // ---- core (@01)
  clock: { simMs: number; speed: number };        // speed: 1, or 60 with the debug time warp (never saved as ≠1)
  calendar: {
    createdAt: number;                            // real epoch ms of save creation
    seasonEpoch: number;                          // real epoch ms of the first counted Sunday 00:00 (BALANCE.md §1)
    maxWeekIndex: number;                         // highest week index seen; the season never goes backwards
    lastDayKey: string;                           // last '06:00 day' whose daily events have fired
    debugOffsetMs: number;                        // debug time warp only; always 0 in normal play
  };
  rngState: number;                               // mulberry32 state; the ONLY source of randomness
  gold: number;                                   // @01 (always 0 until 02 gives starting gold)
  settings: Settings;                             // @01, extended in 05 and 08
  meta: { createdAt: number; lastSavedAt: number; playTimeMs: number };

  // ---- farming (@02)
  farm: {
    grid: { cols: number; rows: number };          // starts 4 × 2; grows with expansions (@03)
    plots: Plot[];                                 // row-major, length = cols * rows
    greenhouse: Plot[];                            // @04, empty until built
  };
  inventory: {
    slots: (ItemStack | null)[];                   // length = slot capacity
    stackSize: number;                             // 99 base, barn storage raises it (@04)
  };

  // ---- economy (@03)
  market: {
    items: Partial<Record<ItemId, MarketItemState>>;   // no entry = demand 1.0, never sold
    specials: { item: ItemId; bonus: number }[];   // today's specials (always the current day's: rolled
                                                   // at creation and at each 06:00 refresh)
  };
  shippingBin: { items: ItemStack[]; msToPickup: number };   // collected every 60 min of simulated time
  expansions: ExpansionId[];                       // bought, in order
  stats: Stats;                                    // @03, extended by later phases
  upgrades: Partial<Record<UpgradeId, number>>;    // @03 (backpack); level, or number owned for placeables

  // ---- automation (@04)
  placed: PlacedObject[];                          // sprinklers and scarecrows (@04); fish traps live in `fishing.traps` (@05)
  autoSell: Partial<Record<ItemId, boolean>>;      // per-item toggle; a missing entry means on for crops
  automation: { farmhandCooldownMs: number };      // simulated ms to the farmhand's next visit (0 = nobody hired)
  lastPlantedCrop: (CropId | null)[];              // for the seed planter: field plots row-major, then greenhouse plots
                                                   // (an expansion re-indexes the field part; see systems/expansions.ts)

  // ---- fishing (@05)
  fishing: {
    // (phase 05: no `unlocked` list; the pond plus the river and ocean expansions in `expansions`, see systems/locations.ts)
    traps: TrapState[];
    collection: Partial<Record<FishId, { firstCaughtAt: string; bestSizeCm: number; count: number }>>;  // firstCaughtAt = dayKey
    session: FishingSession | null;                // an in-progress cast/reel, so saving mid-minigame is safe
  };

  // ---- cooking and buffs (@06)
  kitchen: {
    known: RecipeId[];
    queue: CookJob[];                              // length ≤ queue slots
  };
  buffs: {
    active: ActiveBuff[];
    baseSlots: number;                             // 3; perks and bundles add on top (@07)
  };

  // ---- progression (@07)
  progression: {
    skills: Record<SkillId, { xp: number }>;                  // the level is derived from the XP (levelForXp)
    milestones: { done: MilestoneId[] };                      // in the order completed; any order is allowed
    goals: ActiveGoal[];                                      // GOAL_SLOTS (3) when enough templates apply
    goalsDone: number;
    bundles: Partial<Record<BundleId, ItemStack[]>>;          // donated so far
    completedBundles: BundleId[];
    farmLevelFloor: number;                                   // the level an older save showed; the Farm Level never drops below it
  };

  // ---- optional (@10)
  fullness?: { value: number };
}

export type PlotState = 'untilled' | 'tilled' | 'planted' | 'dead';

export interface Plot {
  state: PlotState;
  crop: CropId | null;
  growthMs: number;          // effective growth accumulated in the current cycle
  harvests: number;          // completed harvests of this planting (regrowers)
  waterMsLeft: number;       // hand watering left (2 h per watering); sprinkler/greenhouse plots count as watered regardless
}

export interface MarketItemState {
  demand: number;            // 0.5 .. 1.3
  lastSoldSimMs: number;     // clock.simMs of the last sale, -1 if never sold
  history: number[];         // effective price multiplier at each of the last 7 daily (06:00) calendar events (sparkline)
}

export interface PlacedObject {
  id: number;                          // unique; the next one is max(id) + 1
  kind: 'sprinkler' | 'scarecrow' | 'golden_scarecrow';   // @04; the golden one is the Spring Crops reward (@07); fish traps are `fishing.traps`
  at: { col: number; row: number };    // plot (col, row) inside the field grid, so expansions need no remap
}

// Phase 05 as built (src/core/state.ts): traps are not `PlacedObject`s (those stand on plots), they are set out
// at the water by `buyUpgrade('fish_trap')`, so they carry their own id, location and slot.
export interface TrapState {
  id: number;                // unique, monotonically increasing
  location: FishLocationId;
  slot: number;              // 0 or 1: which of the location's two spots (TRAP_TILES in render/scene.ts)
  progressMs: number;        // toward the next catch roll, simulated ms at ×1 speed
  contents: ItemStack[];     // at most TRAP_CAPACITY items in total
}

export interface ReelState {
  marker: number; zoneCenter: number; zoneVel: number;   // bar fractions; velocity in bar-widths per second
  zoneWidth: number; zoneSpeed: number; drainPerSec: number;   // fixed at the start (rod and Relaxed fishing applied)
  retargetMs: number;        // until the zone picks a new heading
  meter: number;             // 0..1
}

export interface FishingSession {
  location: FishLocationId;
  phase: 'charging' | 'waiting' | 'bite' | 'reeling';
  power: number;             // 0..1 cast power
  fish: FishId | JunkId | null;        // decided when the bite happens
  sizeCm: number;
  waitMs: number;            // waiting: until the bite; bite: the window left to start reeling (real ms)
  reel: ReelState | null;
}

/** Phase 06: all jobs cook at once (at most the kitchen's slots). `hearty` is set when a dish that finished in winter is waiting for room in the bag. */
export interface CookJob { recipe: RecipeId; remainingMs: number; hearty?: true; saved?: ItemId }   // saved (@07): the ingredient a Cooking perk did not use up

export interface ActiveBuff {
  type: BuffType;
  magnitude: number;         // already scaled by the type's magnitudeScale
  tier: RecipeTier;
  remainingMs: number;       // counts down in simulated time
  source: RecipeId;
}

export interface ActiveGoal {
  template: GoalTemplateId;
  objective: QuestObjective;           // concrete, filled-in
  progress: number;
  rewards: QuestReward[];
  seen?: RecipeId[];                   // cook_distinct: the dishes cooked toward it so far
}

export interface Stats {
  lifetimeGold: number;        // @03: all gold earned; drives the provisional farm level
  goldToday: number;           // @03: reset at each 06:00 refresh
  cropsHarvested: number;      // @03: units
  itemsShipped: number;        // @03: units sold through the Shipping Bin
  fishCaught: number;          // @05: fish (not junk) landed by rod or trap
  dishesCooked: number;        // @06
  dishesEaten: number;         // @06
  daysPassed: number;          // @03: daily refreshes seen
}

export interface Settings {
  masterVolume: number;        // 0..1 (@01 stub, @08 real)
  sfxVolume: number;           // @08
  musicVolume: number;         // @08
  muted: boolean;              // @08
  reducedMotion: boolean;      // @08
  relaxedFishing: boolean;     // @05
  uiScale: 1 | 1.5 | 2;        // @08
  numberFormat: 'full' | 'short'; // @08
  tutorialDone: boolean;       // @08
  fullnessEnabled: boolean;    // @10, default false
}
```

Derived values (the calendar, stage of a plot, whether a plot is watered, buff slot count, farm level, inventory capacity) are **computed by functions, never stored**, so they can't disagree with the state they come from.

---

## 7. How systems read `data/` and change `state`

```
            ┌──────────── src/data (static, typed tables) ───────────┐
            │                                                         │
UI / render │  dispatch(action) ─► actions.ts ─► systems/*.ts ◄── tick(state, ctx)  ◄── core/loop.ts
 (read-only)│                        │                │                                  (fixed 100 ms steps,
            │                        ▼                ▼                                   big steps offline)
            └──────────────────  GameState  ──► ctx.events[] ──► core/events.ts bus ──► ui, render, audio
```

1. **Content is read-only.** `src/data/*.ts` export frozen tables. They are gathered into one `GameData` object in `src/data/index.ts`.
2. **Systems are deterministic state transitions.** A system function looks like:

   ```ts
   export function tickFarming(state: GameState, ctx: SimContext, dtMs: number): void;
   export function harvestPlot(state: GameState, ctx: SimContext, plotIndex: number): ActionResult;

   export interface SimContext {
     data: GameData;
     rng: Rng;               // wraps state.rngState; advancing it updates state.rngState
     calendar: Calendar;     // real-world time of day and season, fixed for the duration of the step
     mods: Modifiers;        // computed once per step
     events: GameEvent[];    // systems push events here; the loop flushes them to the bus
   }

   export type ActionResult = { ok: true } | { ok: false; reason: string };
   ```

   A system may mutate the `state` it is given, and nothing else. It never touches the DOM, canvas, `Date` / `Date.now()`, `Math.random()`, `localStorage` or the event bus; real-world time arrives only through `ctx.calendar`. Given the same state, context and input, it always produces the same result, which is what makes offline simulation and tests reliable. Tests build a state, call the function, and assert on the state and `ctx.events`.
3. **The UI never edits state.** It calls `dispatch({ type: 'harvest', plot: 7 })`. `actions.ts` validates the action, calls the system, and returns the `ActionResult` so the UI can show a message.
4. **Events flow outward.** Systems describe what happened (`{ type: 'harvested', crop: 'turnip', qty: 2, plot: 7 }`); the UI, renderer, audio and (from phase 07) progression listen. Progression updates its state from events inside the same step, so offline events count toward goals.
5. **Modifiers flow inward.** Buffs, perks and upgrades are turned into one `Modifiers` struct (§5) before systems run.

### Event type

```ts
export type GameEvent =
  | { type: 'dayStarted'; dayKey: string }
  | { type: 'seasonChanged'; season: SeasonId; withered: number }
  | { type: 'binCollected'; gold: number; items: number }
  | { type: 'tilled' | 'watered'; plots: number[] }
  | { type: 'planted'; crop: CropId; plots: number[] }
  | { type: 'harvested'; crop: CropId; qty: number; plot: number; auto: boolean }
  | { type: 'sold'; item: ItemId; qty: number; gold: number; via: 'market' | 'bin' }
  | { type: 'goldEarned'; amount: number; source: 'sale' | 'quest' | 'other' }
  | { type: 'purchased'; what: UpgradeId | ExpansionId | SeedId | RecipeId; gold: number }
  | { type: 'inventoryFull'; item: ItemId }
  | { type: 'bite' | 'escaped'; location: FishLocationId }
  | { type: 'caught'; catch: FishId | JunkId; sizeCm: number; location: FishLocationId; viaTrap: boolean }
  | { type: 'cooked'; recipe: RecipeId; tier: RecipeTier; hearty: boolean }
  | { type: 'ate'; recipe: RecipeId; buff: BuffType; hearty: boolean }
  | { type: 'buffStarted' | 'buffExpired'; buff: BuffType }
  | { type: 'levelUp'; skill: SkillId; level: number }
  | { type: 'farmLevelUp'; level: number }
  | { type: 'questDone'; id: MilestoneId | GoalTemplateId; kind: 'milestone' | 'goal'; title: string; rewards: string }
  | { type: 'bundleCompleted'; bundle: BundleId }
  | { type: 'unlocked'; what: string; panel?: PanelId }   // panel: where to look (its toolbar button pulses)
  | { type: 'notify'; text: string; tone: 'info' | 'good' | 'warn' };
```

Phase 07 reads these events in `runProgression` (`src/systems/progression.ts`), which `tickSystems` and `applyAction` call last, from a per-event-log cursor; it pushes `levelUp`, `farmLevelUp`, `questDone`, `bundleCompleted` and `unlocked` itself. Phases add event variants as they need them; adding a variant never needs a save migration. `EventOf<'tilled'>` (in `src/core/events.ts`) also resolves variants that share a body, such as `'tilled' | 'watered'`.

---

## 8. `SaveFile` and migrations (`src/core/save.ts`)

```ts
export const SAVE_VERSION = 7;                 // phase 01 started at 1, … phase 07 → 7 (v1 final); v2 goes to 8–11 (§9.10); every GameState change bumps it
export const SAVE_KEY = 'hearthfield-idle/save';

export interface SaveFile {
  version: number;          // SAVE_VERSION at the time of saving
  savedAt: number;          // Date.now() at save; used for offline progress
  state: GameState;
}

/** migrations[n] turns a version-n save into a version-(n+1) save. */
export type Migration = (old: any) => any;
export const migrations: Record<number, Migration> = {};

export function migrate(file: { version: number; state: unknown }): SaveFile;  // applies n, n+1, … in order
```

Rules:
- A migration takes the **raw JSON** of the old version and returns the next version. It must not import current types for the old shape. Write the old shape inline if needed.
- New fields get sensible defaults (for example, a market entry for an item never sold starts at `demand: 1`).
- Every migration has a test that loads a fixture save of the old version (kept in `tests/fixtures/save-vN.json`) and checks the result.
- A save with a **newer** version than the code, or one that fails to parse, is never overwritten. The game shows an error and offers to export the raw text (phase 08 makes this screen friendly).
- Export/import uses `btoa(JSON.stringify(saveFile))` with UTF-8 safe encoding.

**Where saves live (v3 phase 00).** The save is written through the platform's storage (`src/platform/`): `localStorage` on the web, native storage in the shells. The game stays synchronous over an in-memory copy (`SyncStore` in `src/platform/store.ts`), loaded before the `Game` is created. Keys, all in the `SaveFile` format above (no `SAVE_VERSION` change):

| Key | What |
|---|---|
| `hearthfield-idle/save` | the save |
| `hearthfield-idle/save.bak` | the previous good save; `SaveSlots.write` moves the replaced save here when both validate |
| `hearthfield-idle/save.bak2` … `.bak4` | native platforms only (`Platform.olderBackups`, up to 3): older backups, moved along at most once an hour |
| `hearthfield-idle/save.bak-at` | when the older backups last moved (epoch ms) |
| `hearthfield-idle/save-corrupt-backup` | a save that failed to load, kept when the player starts over or loads the backup |
| `hearthfield-idle/prefs` | per-device preferences (`src/core/prefs.ts`), not a save |

A save that fails to load offers the newest backup that loads, next to Download and Start a new farm.

---

## 9. v2: world, decorations, orchard and animals

Written by v2 phase 00. Numbers are in BALANCE.md §13 and behaviour in GDD §12; this section fixes ids, shapes, coordinates and the save plan. Each item is tagged with the v2 phase that builds it (`@v2-01` … `@v2-04`). As in §2, every id here appears in BALANCE.md and the GDD, and a data table keyed by an id union is a full `Record`, so a missing entry is a compile error.

### 9.1 New id unions (`src/data/ids.ts`)

```ts
export type ParcelId = 'orchard' | 'yard' | 'meadow';                                        // @v2-01

export type DecorSetId = 'cottage' | 'seaside' | 'harvest_fair';                             // @v2-02
export type DecorId =                                                                         // @v2-02
  // cottage (12)
  | 'cobble_path' | 'picket_fence' | 'flower_bed' | 'garden_lamp' | 'wooden_bench' | 'birdbath'
  | 'rose_arch' | 'paint_sage' | 'paint_sky' | 'roof_thatch' | 'roof_slate' | 'farmhouse_loft'
  // seaside (10)
  | 'plank_path' | 'rope_fence' | 'sandcastle' | 'lobster_pots' | 'deck_chair' | 'beach_umbrella'
  | 'harbour_lamp' | 'rowboat' | 'driftwood_arch' | 'ship_figurehead'
  // harvest_fair (10)
  | 'brick_path' | 'rail_fence' | 'straw_bale' | 'pumpkin_stack' | 'sunflower_patch' | 'lantern_string'
  | 'apple_cart' | 'stone_well' | 'fair_stall' | 'windmill';

export type TownProjectId =                                                                   // @v2-02
  | 'old_bridge' | 'fountain' | 'bakery' | 'bandstand' | 'lighthouse' | 'community_hall';

export type FruitId = 'cherry' | 'apricot' | 'peach' | 'apple' | 'pear' | 'persimmon' | 'lemon';   // @v2-03
export type TreeId = `${FruitId}_tree`;                  // 'cherry_tree', …: the TreeDef key       @v2-03
export type SaplingId = `sapling_${FruitId}`;            // the bag item bought in Shop › Trees     @v2-03

export type AnimalId = 'chicken' | 'cow';                                                     // @v2-04
export type AnimalProductId = 'egg' | 'large_egg' | 'milk';                                   // @v2-04
export type FeedId = 'hay' | 'corn_feed';                                                     // @v2-04
export type BuildingId = 'coop' | 'barn' | 'silo';                                            // @v2-04

// Extended unions
export type ItemId = CropId | SeedId | FishId | JunkId | DishId
  | FruitId | SaplingId | AnimalProductId | FeedId;                                           // @v2-03, @v2-04
export type RecipeId = /* the 22 v1 ids */
  | 'baked_apple' | 'cherry_jam' | 'pear_crumble' | 'peach_cobbler'                           // @v2-03
  | 'fried_egg' | 'soft_cheese' | 'garden_omelette' | 'apricot_custard'
  | 'lemon_meringue_pie' | 'persimmon_pudding';                                               // @v2-04
export type UpgradeId = /* the 15 v1 ids */ | 'ranch_collector';                              // @v2-04
export type MilestoneId = /* m01 … m15 */
  | 'm16_first_parcel' | 'm17_first_decor' | 'm18_charm_25' | 'm19_first_project' | 'm23_charm_100'   // @v2-02
  | 'm20_first_fruit'                                                                          // @v2-03
  | 'm21_first_egg' | 'm22_first_milk';                                                        // @v2-04
export type GoalTemplateId = /* the 9 v1 ids */
  | 'raise_charm'                                                                               // @v2-02
  | 'pick_fruit'                                                                                // @v2-03
  | 'collect_produce';                                                                          // @v2-04
export type BundleId = /* the 6 v1 ids */ | 'orchard_basket' | 'barnyard';                     // @v2-03, @v2-04
export type PanelId = /* the 8 v1 ids */ | 'ranch';                                             // @v2-04
```

Helpers alongside the v1 ones: `treeOfFruit(f: FruitId): TreeId`, `fruitOfTree(t: TreeId): FruitId`, `saplingOf(f: FruitId): SaplingId`, `fruitOfSapling(s: SaplingId): FruitId`, and the guards `isFruitId`, `isSaplingId`, `isAnimalProductId`, `isFeedId`. The fruit item id is the fruit's own id (like a crop), so `'apple'` is both the `FruitId` and the `ItemId`.

**Name clash, fixed in v2-01:** `src/render/scene.ts` already has a `Decor` interface, a `DECOR` table and `decorFor()` for the scenery that expansions change. Rename them `Scenery`, `SCENERY` and `sceneryFor()` before v2-02 adds player decorations, so "decor" means only the new placeable pieces.

### 9.2 Shared building blocks, extended

```ts
export type ItemCategory = 'seed' | 'crop' | 'fish' | 'junk' | 'dish'
  | 'fruit' | 'sapling' | 'animal' | 'feed';                 // animal = egg, large egg, milk
// fruit and animal: sellable; sapling and feed: not sellable, like seeds.

export type UnlockCondition = /* the v1 kinds */
  | { kind: 'parcel'; id: ParcelId }                                  // @v2-01
  | { kind: 'charm'; amount: number }                                 // @v2-02 (derived charm ≥ amount)
  | { kind: 'townProject'; id: TownProjectId; stage?: number }        // @v2-02 (stages done ≥ stage; omitted = complete)
  | { kind: 'building'; id: BuildingId; level: number };              // @v2-04

export type UpgradeCategory = 'farm' | 'tools' | 'storage' | 'fishing' | 'kitchen' | 'ranch';   // @v2-04
// UpgradeEffect.flags gains nothing: ranch_collector uses the existing 'autoCollect' flag.

export type QuestObjective = /* the v1 kinds */
  | { kind: 'ownParcel'; count: number }                              // @v2-02, checks state (like reachFarmLevel)
  | { kind: 'placeDecor'; count: number }                             // @v2-02, counts 'decorPlaced'
  | { kind: 'reachCharm'; amount: number }                            // @v2-02, checks derived charm
  | { kind: 'gainCharm'; amount: number }                             // @v2-02, sums positive 'charmChanged' deltas
  | { kind: 'projectStage'; count: number }                           // @v2-02, counts 'projectStageDone'
  | { kind: 'pickFruit'; fruit?: FruitId; count: number }             // @v2-03, counts 'fruitPicked'
  | { kind: 'collectProduct'; product?: AnimalProductId; count: number };   // @v2-04, counts 'collected'

export type QuestReward = /* the v1 kinds */
  | { kind: 'decor'; id: DecorId; qty: number };                      // @v2-02, goes to decoration stock

export type BundleReward = /* the v1 kinds */
  | { kind: 'treeSpots'; count: number }                              // @v2-03, Orchard Basket
  | { kind: 'troughBonus'; bonus: number };                           // @v2-04, Barnyard

export type RecipeDiscovery = /* unchanged */;
// RecipeDef.ingredients may now also hold fruit and animal products (still never a dish).
```

### 9.3 World coordinates (@v2-01)

This is the change most likely to break things, so it is kept as small as possible: **the v1 scene is the world's top-left corner at the same tile coordinates.**

```ts
// src/data/world.ts
export const WORLD_COLS = 36;
export const WORLD_ROWS = 22;
export const HOME_ORIGIN = { col: 0, row: 0 } as const;           // where the v1 20 × 12 scene sits; never changes
export const HOME_RECT: TileRect = { col: 0, row: 0, cols: 20, rows: 12 };
// world tile (c, r) of a v1 scene tile (c1, r1) = (HOME_ORIGIN.col + c1, HOME_ORIGIN.row + r1) = (c1, r1)
```

There are four coordinate spaces. Each stored position uses exactly one of them:

| Space | Units | Used by | Stored in the save as |
|---|---|---|---|
| **World tile** | integer (col 0..35, row 0..21) | zones, scenery, parcels, decorations, buildings, hit-testing | `{ col, row }` of a footprint's **top-left** tile (decorations, buildings) |
| **Plot coordinates** | (col, row) inside the field grid; plot index = `row * cols + col` | plots, sprinklers and scarecrows (`placed[].at`), `lastPlantedCrop` | unchanged from v1: world tile = `PLOT_ORIGIN + (col, row)`; greenhouse plots stay `GREENHOUSE_BASE + n` with `GREENHOUSE_LAYOUT` |
| **Slots and spots** | an index into a fixed table in `src/data/world.ts` | fish traps (`TRAP_TILES`, unchanged), tree spots (`TREE_SPOTS`, 10 entries) | `slot` (traps, unchanged), `spot` (trees) |
| **World pixels → screen** | logical px = tile × 16; screen px through the camera | rendering, pointer input | never stored; the camera is in **prefs** |

Consequences:
- **Plot indexes do not change**, and nothing in a v7 save holds a scene coordinate (`placed[].at` is in plot coordinates, traps are slots), so the v7 → v8 migration moves nothing.
- `PLOT_ORIGIN`, `BIN_TILE`, `PET_TILE`, `TRAP_TILES`, `GREENHOUSE_ORIGIN` and every zone rect keep their values; they are now world tiles. `SCENE_COLS`/`SCENE_ROWS` (20 × 12) become `HOME_RECT`; `tileAt()` and the ground cache use `WORLD_COLS × WORLD_ROWS`.
- **The world may only grow right and down.** Never move `HOME_ORIGIN` or shift a region: decorations and buildings are stored in world tiles, and a shift would need a migration of every placed piece.
- Trees use **spot indexes**, not tiles, so the orchard's layout can be redrawn without a migration (as trap tiles can).
- The layout itself (regions, parcel rects, lanes, sea, town sites, tree spots, blocked tiles) is **data** in `src/data/world.ts`:

```ts
export type RegionId = 'home' | ParcelId | 'town' | 'lanes' | 'sea';

export interface WorldLayout {
  cols: number; rows: number;                                   // WORLD_COLS, WORLD_ROWS
  regions: readonly { id: RegionId; rect: TileRect }[];         // home, the three parcels, town
  lanes: readonly { col: number; row: number }[];               // scenery path tiles outside home
  sea: readonly TileRect[];                                     // always-drawn sea (the dock water is one of them)
  sand: readonly TileRect[];                                    // the dock's landing (15, 10) 1 × 2 and the meadow's beach (21, 19) 15 × 1 (v2-01)
  bridge: TileRect;                                             // the Old Bridge over the inlet (15, 12) 5 × 1
  townSites: Readonly<Record<Exclude<TownProjectId, 'old_bridge'>, TileRect>>;   // where each project's building stands (the bridge's is `bridge`)
  boardTile: { col: number; row: number };                      // the Community Board sign (4, 16)
  treeSpots: readonly { col: number; row: number }[];           // 10 top-left tiles of 2 × 2 spots; the last 2 need the bundle
  forSaleSigns: Readonly<Record<ParcelId, { col: number; row: number }>>;
}
```

As built in v2-01: `TileRect` lives in `src/data/types.ts` (re-exported by `src/render/scene.ts`), `WORLD_LAYOUT`, `REGION_NAMES` and `regionAt(col, row)` in `src/data/world.ts`, and the Community Board is a v1-style zone (`'board'`, in `buildZones`).

Hit-testing order in the world: edge pips and scene controls (DOM, above the canvas) → placement preview (placement or Decorate mode) → animals (petting) → trees → buildings → decorations → v1 zones (`buildZones`) → town sites and the board → "For sale" signs → nothing.

### 9.4 Content definitions (v2)

```ts
// src/data/parcels.ts  @v2-01
export interface ParcelDef {
  id: ParcelId;
  name: string;                            // 'Hilltop Orchard'
  description: string;                     // one cozy line for Upgrades › Land
  rect: TileRect;                          // world tiles (BALANCE.md §13.1)
  price: number;
  requires: readonly UnlockCondition[];    // e.g. [{ kind: 'parcel', id: 'orchard' }, { kind: 'farmLevel', level: 7 }]
  opens: string;                           // what it is for, shown on the sign ('Room for fruit trees')
}

// src/data/decor.ts  @v2-02
export interface DecorSetDef {
  id: DecorSetId;
  name: string;                            // 'Cottage'
  description: string;
  unlock: readonly UnlockCondition[];      // [] for cottage; [{ kind: 'townProject', id: 'old_bridge' }] for seaside
}

export type DecorKind =
  | 'place'                                // stands on the ground
  | 'paint' | 'roof' | 'loft';             // restyle the farmhouse; never placed, never use a slot

export interface DecorDef {
  id: DecorId;
  set: DecorSetId;
  name: string;
  description: string;
  kind: DecorKind;
  size: { cols: number; rows: number };    // footprint in tiles; farmhouse pieces: { cols: 0, rows: 0 }
  price: number;
  charm: number;
  counted: number;                         // copies that count toward charm (paths and fences 20); farmhouse pieces 1
  unlock: readonly UnlockCondition[];      // e.g. [{ kind: 'charm', amount: 25 }]; the set's unlock also applies
  autotile?: 'path' | 'fence';             // joins with same-id neighbours (4-neighbour mask, ART_STYLE.md §6)
  glows?: true;                            // has a lit frame and a night halo
  flips?: true;                            // may be mirrored when placed
  seasonal?: true;                         // has per-season sprites (`decor_<id>_<season>`)
  sprite: string;                          // base sprite id, 'decor_garden_lamp'
}

// src/data/townProjects.ts  @v2-02
export interface TownProjectStage {
  gold: number;                            // before TOWN_PROJECT_SCALE
  items: readonly ItemStack[];             // may be []
  sceneChange: string;                     // note for the renderer: 'planks laid across the inlet'
}

export type TownProjectReward =
  | { kind: 'decorSet'; set: DecorSetId }
  | { kind: 'decorSlots'; count: number }
  | { kind: 'musicTrack'; id: 'town_square' }
  | { kind: 'goalSlot'; count: number }
  | { kind: 'cosmetic'; what: 'bakerySmoke' | 'bandSaturday' | 'lighthouseBeam' | 'festivalLights' };

export interface TownProjectDef {
  id: TownProjectId;
  name: string;                            // 'Mend the Old Bridge'
  flavor: string;
  site: TileRect;                          // = WORLD_LAYOUT.townSites[id] (the bridge: WORLD_LAYOUT.bridge)
  stages: readonly TownProjectStage[];     // 3, or 4 for the hall
  rewards: readonly TownProjectReward[];   // given when the last stage completes
  rewardText: string;
  requires: readonly UnlockCondition[];
}

// src/data/trees.ts  @v2-03 (fruit and sapling items generated in items.ts, like crops and seeds)
export interface TreeDef {
  id: TreeId;
  fruit: FruitId;
  name: string;                            // 'Apple'
  fruitName: string;                       // 'Apple' / plural via the existing `plural` convention
  description: string;
  seasons: readonly SeasonId[];            // when it bears
  saplingPrice: number;
  matureDays: number;                      // real calendar days from planting
  fruitPerDay: number;                     // added at each bearing day's 06:00 refresh
  fruitCap: number;                        // = FRUIT_CAP_DAYS × fruitPerDay (declared; a test checks it)
  fruitPrice: number;                      // market base price of one fruit
  xp: number;                              // Farming XP per fruit picked
  shape: 'round' | 'tall' | 'spread';      // canopy family for sprites (ART_STYLE.md §6)
  plural?: string;                         // 'Cherries', 'Peaches' (as built; the others add an s)
}

// src/data/animals.ts  @v2-04 (product and feed items generated in items.ts)
export interface AnimalDef {
  id: AnimalId;
  name: string;                            // 'Hen', 'Cow'
  building: BuildingId;                    // 'coop' | 'barn'
  price: number;
  feed: FeedId;                            // one portion per cycle
  intervalSec: number;                     // simulated seconds per production cycle
  product: AnimalProductId;
  largeProduct?: { id: AnimalProductId; chance: number };   // hens: large_egg at LARGE_EGG_CHANCE
  names: readonly string[];                // default names, used in order (never random)
}

export interface BuildingLevelDef {
  price: number;
  capacity: number;                        // animals housed (silo: 0)
  trough: number;                          // feed portions (silo: 0)
  store: number;                           // products held (silo: 0)
  requires: readonly UnlockCondition[];
  flags?: readonly ('autoFeed' | 'autoMill')[];   // silo levels 1 and 2
}

export interface BuildingDef {
  id: BuildingId;
  name: string;                            // 'Coop'
  description: string;
  footprint: { cols: number; rows: number };   // coop 3 × 2, barn 4 × 3, silo 2 × 2
  houses: AnimalId | null;                 // silo: null
  levels: readonly BuildingLevelDef[];     // index 0 = level 1
  placeIn: ParcelId;                       // 'yard'
  sprite: string;                          // 'obj_coop' → obj_coop_1..3
}

export interface FeedDef { id: FeedId; from: CropId; perUnit: number; buyPrice: number }   // hay from wheat ×2, corn_feed from corn ×3
```

**`GameData` gains** (each a full `Record` except the layout):

```ts
parcels: Record<ParcelId, ParcelDef>;                  // @v2-01
world: WorldLayout;                                    // @v2-01
decorSets: Record<DecorSetId, DecorSetDef>;            // @v2-02
decor: Record<DecorId, DecorDef>;                      // @v2-02
townProjects: Record<TownProjectId, TownProjectDef>;   // @v2-02
trees: Record<TreeId, TreeDef>;                        // @v2-03
animals: Record<AnimalId, AnimalDef>;                  // @v2-04
buildings: Record<BuildingId, BuildingDef>;            // @v2-04
feeds: Record<FeedId, FeedDef>;                        // @v2-04
```

`items` grows with a fruit item and a sapling item per tree (@v2-03), and the three products and two feeds (@v2-04), all generated in `items.ts`.

### 9.5 The calendar day index (@v2-03)

```ts
// Calendar (src/core/time.ts) gains:
dayIndex: number;   // real days since the save's day zero, counted in 06:00 → 06:00 days; never decreases

// CalendarState gains:
dayZeroKey: string;     // the dayKey that is day 0 (a new save: its first dayKey)
maxDayIndex: number;    // the highest dayIndex seen, like maxWeekIndex

dayIndex = max(state.calendar.maxDayIndex, civilDay(calendar.dayKey) − civilDay(state.calendar.dayZeroKey))
// civilDay: whole days since 1970-01-01 of a 'YYYY-MM-DD' key (daysFromCivil), DST-safe

/** The season of real day d (by the §1 week rule applied to that day's date). Pure; used for fruit on missed days. */
export function seasonOfDay(cal: Pick<Calendar, 'dayZero' | 'epochWeek'>, d: number): SeasonId;
// Calendar also carries `dayZero` (the civil day number of day 0) and `epochWeek` (the Sunday week of the season epoch),
// so a system can ask for any day's season from `ctx.calendar` alone (@v2-03: as built; not CalendarState).
```

Moving the clock back or flying west holds `dayIndex` at `maxDayIndex`; a DST change never skips or repeats a day (days are keyed by date, not by 24 h). The core updates `maxDayIndex` with `maxWeekIndex`. The v10 migration sets `dayZeroKey` to the save's `calendar.lastDayKey` and `maxDayIndex` to 0: day zero only has to be consistent, because every tree's age is a difference of two day indexes.

### 9.6 `GameState` additions

```ts
export interface GameState {
  /* … all v1 fields … */

  // ---- world (@v2-01, save 8)
  land: {
    parcels: ParcelId[];                        // bought, in order
  };

  // ---- decorations and town (@v2-02, save 9)
  decor: {
    owned: Partial<Record<DecorId, number>>;    // bought in total; stock = owned − placed count (like upgrades vs placed)
    placed: PlacedDecor[];
    farmhouse: { paint: DecorId | null; roof: DecorId | null; loft: boolean };   // applied; null = the v1 look
  };
  town: {
    projects: Partial<Record<TownProjectId, TownProjectState>>;   // no entry = not started
  };

  // ---- orchard (@v2-03, save 10)
  orchard: {
    trees: TreeState[];
  };
  // calendar gains dayZeroKey and maxDayIndex (§9.5); saplings are bag items

  // ---- animals (@v2-04, save 11)
  ranch: {
    buildings: BuildingState[];
    animals: AnimalState[];
  };
  // products and feed are bag items; autoSell gains entries for egg, large_egg, milk (missing = off) and fruit (missing = on)
}

// Stats gains fruitPicked (@v2-03) and productsCollected (@v2-04) for the Stats tab; the migrations set them to 0.

export interface PlacedDecor {
  id: number;                    // unique, monotonically increasing (max + 1)
  decor: DecorId;
  at: { col: number; row: number };   // world tile of the footprint's top-left
  flipped?: true;
}
// The auto-tile mask of a path or fence is derived from its neighbours when drawn, never stored.

export interface TownProjectState {
  stagesDone: number;            // 0 … stages.length
  gold: number;                  // gold donated toward the current stage
  items: ItemStack[];            // items donated toward the current stage
}

export interface TreeState {
  id: number;
  tree: TreeId;
  spot: number;                  // index into WORLD_LAYOUT.treeSpots
  plantedDay: number;            // calendar.dayIndex on the day it was planted
  fruit: number;                 // hanging now, 0 … fruitCap
  lastFruitDay: number;          // the last day index whose fruit has been added (starts at plantedDay)
}
// stage, age and "ripe" are derived (BALANCE.md §13.5)

export interface BuildingState {
  id: number;
  kind: BuildingId;
  level: number;                 // 1 … levels.length
  at: { col: number; row: number };   // world tile, top-left of the footprint, inside the yard
  trough: number;                // feed portions (0 for the silo)
  store: ItemStack[];            // products waiting; total ≤ the level's store size (the Barnyard bonus is for troughs only)
  cycleMs: number;               // simulated ms into the current cycle
}

export interface AnimalState {
  id: number;
  kind: AnimalId;
  name: string;                  // default from AnimalDef.names, renamable
  building: number;              // BuildingState.id
}
```

Derived, never stored: charm, decoration stock and slots used and slot cap, tree stage and age and ripeness, a building's capacity, trough size and store size (from level and the Barnyard bundle), the number of free tree spots.

### 9.7 Prefs additions (@v2-01)

The camera is per device, in `Prefs` (`src/core/prefs.ts`), never in the save (phase 08's rule for settings that belong to the browser):

```ts
export interface Prefs {
  /* … v1 fields … */
  camera: { x: number; y: number; zoom: number } | null;   // centre in world px and integer zoom; null = the default view
}
// sanitizePrefs: x and y finite numbers, zoom an integer 1..16 (MAX_CAMERA_ZOOM), else null. Out-of-world values are clamped when used.
// The zoom is in device pixels per logical pixel (as v1's integer scale was), so it is crisp at any device pixel ratio;
// a 3× phone's default zoom is about 8, which is why the limit is 16 and not 8 (v2 phase 01).
```

### 9.8 Actions and events

New `Action` variants (each handled in `applyAction` by a system function returning `ActionResult`):

```ts
| { type: 'buyParcel'; parcel: ParcelId }                                               // @v2-01
| { type: 'buyDecor'; decor: DecorId; qty: number }                                     // @v2-02
| { type: 'placeDecor'; decor: DecorId; col: number; row: number; flipped?: boolean }   // @v2-02
| { type: 'moveDecor'; id: number; col: number; row: number; flipped?: boolean }        // @v2-02
| { type: 'pickUpDecor'; id: number }                                                   // @v2-02
| { type: 'styleFarmhouse'; paint?: DecorId | null; roof?: DecorId | null; loft?: boolean }   // @v2-02
| { type: 'donateProject'; project: TownProjectId; gold?: number; item?: ItemId; qty?: number }   // @v2-02
| { type: 'buySapling'; fruit: FruitId; qty: number }                                   // @v2-03
| { type: 'plantTree'; fruit: FruitId; spot: number }                                   // @v2-03
| { type: 'pickTree'; id: number }                                                      // @v2-03
| { type: 'moveTree'; id: number; spot: number }                                        // @v2-03 (UI confirms first)
| { type: 'removeTree'; id: number }                                                    // @v2-03 (UI confirms first)
| { type: 'buildBuilding'; building: BuildingId; col: number; row: number }             // @v2-04 (buys level 1 and places it)
| { type: 'upgradeBuilding'; id: number }                                               // @v2-04
| { type: 'moveBuilding'; id: number; col: number; row: number }                        // @v2-04
| { type: 'buyAnimal'; animal: AnimalId; building: number }                             // @v2-04
| { type: 'renameAnimal'; id: number; name: string }                                    // @v2-04
| { type: 'makeFeed'; feed: FeedId; qty: number }                                       // @v2-04 (qty of crop used)
| { type: 'buyFeed'; feed: FeedId; qty: number }                                        // @v2-04
| { type: 'fillTrough'; building: number }                                              // @v2-04
| { type: 'collectBuilding'; building: number }                                         // @v2-04
```

Petting is not an action: it is render and audio only and never reaches state.

New `GameEvent` variants (adding variants never needs a migration):

```ts
| { type: 'parcelBought'; parcel: ParcelId }                                            // @v2-01
| { type: 'decorPlaced' | 'decorMoved' | 'decorPickedUp'; decor: DecorId; id: number }  // @v2-02
| { type: 'charmChanged'; from: number; to: number }                                   // @v2-02, pushed by decor and project actions
| { type: 'projectDonated'; project: TownProjectId; gold: number; items: number }      // @v2-02
| { type: 'projectStageDone'; project: TownProjectId; stage: number; complete: boolean }   // @v2-02
| { type: 'treePlanted' | 'treeRemoved' | 'treeMoved'; tree: TreeId; id: number }      // @v2-03
| { type: 'treeMatured'; tree: TreeId; id: number }                                    // @v2-03, at the refresh it turns mature
| { type: 'fruitGrown'; fruit: FruitId; qty: number }                                  // @v2-03, at a refresh (for the away summary)
| { type: 'fruitPicked'; fruit: FruitId; qty: number; tree: number; auto: boolean }    // @v2-03
| { type: 'buildingBuilt' | 'buildingUpgraded'; building: BuildingId; level: number } // @v2-04
| { type: 'animalBought'; animal: AnimalId; id: number }                               // @v2-04
| { type: 'produced'; product: AnimalProductId; qty: number; building: number }       // @v2-04, into the store
| { type: 'collected'; product: AnimalProductId; qty: number; auto: boolean }         // @v2-04, out of the store
| { type: 'troughEmpty'; building: number }                                            // @v2-04, once per emptying (away summary: "The hens would love some feed")
```

`purchased.what` widens to include `ParcelId | DecorId | SaplingId | BuildingId | AnimalId | FeedId`.

### 9.9 Modifiers

**No new `Modifiers` fields in v2.** Charm, decorations and town projects are never read by `computeModifiers()`, and a v2-02 test asserts that placing every decoration and completing every project leaves `computeModifiers(state, data)` unchanged. Trees and animals read no modifier for their timing (trees are calendar-driven; animal cycles are fixed). Fruit and animal products sell through the normal price formula, so `sellPriceModifier` and the specials apply to them as to any item; the category bonuses (`cropSellBonus`, `fishSellBonus`, `dishSellBonus`) do not.

### 9.10 `SAVE_VERSION` plan and migration contracts

Each v2 phase bumps the version once, adds `migrations[n]`, adds `tests/fixtures/save-v(n+1).json`, and adds a test that loads `save-vn.json` and checks the result (and `tests/qa.test.ts` "a fixture for every save version" keeps passing).

| Version | Phase | Adds | Migration `migrations[n]` (raw JSON of version n → n + 1) |
|---|---|---|---|
| **8** | v2-01 | `land.parcels` | 7 → 8: `{ ...old, land: { parcels: [] } }`. Nothing else changes: plots, `placed`, traps and every other v1 field already mean the same thing in the world (§9.3). The test also checks that every v1 zone, plot and trap spot of the fixture hit-tests to the same thing as before. |
| **9** | v2-02 | `decor`, `town` | 8 → 9: `decor: { owned: {}, placed: [], farmhouse: { paint: null, roof: null, loft: false } }`, `town: { projects: {} }`. Milestones `m16`–`m19`, `m23` are checked on the next step (a v8 player who owns a parcel gets `m16` at once). |
| **10** | v2-03 | `orchard`, `calendar.dayZeroKey`, `calendar.maxDayIndex` | 9 → 10: `orchard: { trees: [] }`, `calendar: { ...old.calendar, dayZeroKey: old.calendar.lastDayKey, maxDayIndex: 0 }`, `stats.fruitPicked: 0`. |
| **11** | v2-04 | `ranch` | 10 → 11: `ranch: { buildings: [], animals: [] }`, `stats.productsCollected: 0`. `autoSell` needs no entries (missing means off for animal products). |
| **12** | v2 polish | `cats` | 11 → 12: `cats: { adopted: ['cat_tabby'], active: 'cat_tabby' }` (the old orange cat becomes the brown tabby; the orange one is now adopted). |
| **13** | v2-05 | `ranch.feedStore` | 12 → 13: `ranch: { ...old.ranch, feedStore: { hay, corn_feed } }`, moving each bag stack of `hay` and `corn_feed` into the store up to 600 of each (the capacity written out in the migration); what does not fit stays in the bag. |
| **14** | v2-06 | `seedOrder` | 13 → 14: `seedOrder: { reservePct: 25, off: [] }` (the defaults are written out in the migration). The upgrade itself is `upgrades.seed_order` and needs no entry. |

Rules that carry over from §8: migrations take raw JSON and do not import current types; a save newer than the code or one that fails to load is never overwritten (show the error and offer an export); adding content (new decorations, trees, recipes) needs no migration unless the state shape changes. The camera is not in the save, so no migration ever touches it.

### 9.11 As built in v2 phase 02

- **Content:** `src/data/decor.ts` (`DECOR_SETS`, `DECOR`, `DECOR_ORDER`), `src/data/townProjects.ts` (`TOWN_PROJECTS`, plus `LATER_STAGE_ITEMS`), and `GameData.decorSets`, `.decor` and `.townProjects`. `DecorDef.sprite` is `decor_<id>`, except the five farmhouse pieces, whose `sprite` is the styled farmhouse the shop previews. `DecorSetId`, `DecorId`, `TownProjectId` and their arrays and guards are in `src/data/ids.ts`.
- **Where decorations may not go** is data in `src/data/world.ts`: `DECOR_BLOCKED` (rectangles with the reason shown), the lanes and the tree spots, read through `fixedBlockReason(col, row)`. The field is blocked at its full 8 × 6 size with its fence ring, so a later expansion never meets a decoration. `tests/decorRender.test.ts` checks the rectangles against the scene's zones, paths and fence ring.
- **Unlock conditions** `charm` and `townProject` are in `UnlockCondition`; `isUnlocked` needs `data` for them (it is false without). Quest objectives `ownParcel` and `reachCharm` are checked from state (and once on the first step after a save loads, `settledOnce` in `progression.ts`); `placeDecor`, `gainCharm` and `projectStage` are counted from events. The `decor` quest reward goes to the stock (`grantDecor`).
- **Actions** `buyDecor`, `placeDecor`, `moveDecor`, `pickUpDecor`, `styleFarmhouse` and `donateProject` are as §9.8; events `decorPlaced`, `decorMoved`, `decorPickedUp`, `charmChanged`, `projectDonated` and `projectStageDone`, and `purchased.what` includes a `DecorId`. `donateProject` takes `gold`, or `item` and `qty`, or both; the gold and the items fill the current stage, and the stage finishes when both are full.
- **Derived, never stored:** charm (`src/systems/charm.ts`: `charmOf`, `charmBreakdown`, `nextCharmUnlock`), stock (`decorStock`), slots used and the slot cap (`decorSlotCap`), a path's or fence's mask (`autotileMask`), a set being open (`decorSetOpen`), the goal slots (`goalSlots`), the cosmetics and the music track a finished project gave (`hasCosmetic`, `hasMusicTrack`).
- **Prefs** gained `townTune: boolean` (play the Town Square tune in the music rotation once the bandstand is built; default true). Not in the save.
- **Save 9** is `decor` and `town` as §9.6 (`validateState` checks ids, tiles and the farmhouse style; `tests/fixtures/save-v9.json` holds a farm with pieces placed, a flipped one, a farmhouse paint and a project under way).
- **Goal slots:** `GOAL_SLOTS` (3) is the base; the board's size is `goalSlots(state, data)` (4 once the Community Hall is finished).
- **Farm points:** `farmPoints` counts only milestones m01 to m15 (`FARM_POINT_MILESTONES`), so the v2 milestones (`m16`, `m17`, `m18`, `m19`, `m23`) pay their own rewards and move no Farm Level.


### 9.12 As built in v2 phase 04

- **Content:** `src/data/animals.ts` (`ANIMALS`, `BUILDINGS`, `FEEDS`), the shapes `AnimalDef`, `BuildingLevelDef`, `BuildingDef`, `FeedDef` in `src/data/types.ts` (`AnimalDef.plural` and `.xp` per product were added; `xp` is Farming XP per product collected by hand), `GameData.animals`, `.buildings` and `.feeds`, the ids in `src/data/ids.ts` (`AnimalId`, `AnimalProductId`, `FeedId`, `BuildingId`, their arrays and guards), egg, large egg, milk, hay and corn feed in `items.ts` (categories `animal` and `feed`), the six recipes, milestones `m21_first_egg` and `m22_first_milk`, the goal template `collect_produce`, the Barnyard bundle (`BundleReward` `troughBonus`, read through `bundleBonuses(state, data).troughBonus`), the upgrade `ranch_collector` (category `ranch`, flag `autoCollect`), the unlock condition `{ kind: 'building', id, level }` (met by a built building of at least that level; it needs no `data`), and the constants in `balance.ts` (`LARGE_EGG_CHANCE`, `FEED_PER_WHEAT`, `FEED_PER_CORN`, `FEED_BUY_PRICE`, `SILO_RESERVE`, `BARNYARD_TROUGH_BONUS`, `AUTO_COLLECT_XP_SHARE`, `FEED_AMOUNTS`).
- **State** is `ranch: { buildings: BuildingState[]; animals: AnimalState[] }` and `stats.productsCollected` as §9.6. `cycleMs` is 0 while a building has no animals. Save 11 (`migrations[10]`, `validateState` checks ids, one building of each kind, levels, tiles, stacks and that every animal lives in a building; `tests/fixtures/save-v11.json` has a level 2 coop with a laden store, a barn, a silo and three animals).
- **Actions** are as §9.8 (`makeFeed`'s `qty` is the crop used; `buyFeed`'s is the feed bought, at 40g a portion). **Events** are as §9.8 with two additions: `buildingMoved`, and `troughEmpty` carries `animal` so the away summary can say who is hungry; `collected` carries `building` and `shipped` (how many went straight to the bin) and `produced` is batched per building and product per step.
- **Systems:** `src/systems/ranch.ts` (`tickRanch`, `ranchPickup`, `collectBuilding`, `buildBuilding`, the derived `troughSize`, `storeSize`, `capacityOf`, placement rules and tile lookups). `tickRanch` is the first system in `tickSystems`; the silo and the basket run just before the bin pickup; `msToNextSimEvent` is unchanged and `msToNextPickup` reports pickups while a silo or the basket exists.
- **Derived, never stored:** capacity, trough size (with the Barnyard bonus) and store size, a building's footprint and trough tile, an animal's default name (by order), the Ranch pips.
- **Auto-Seller:** `autoSellOn` is off for eggs and milk (only crops and fruit default on); the toggles are under the Auto-Seller card.

### 9.13 As built in the v2 polish pass (farm cats, save 12)

- **Content:** `CatId` (`cat_tabby`, `cat_orange`, `cat_black`, `cat_silver`, `cat_tuxedo`, `cat_siamese`, `cat_calico`), `CAT_IDS` and `isCatId` in `src/data/ids.ts`; `CatDef { id, name, description, price, sprite }` in `src/data/types.ts`; `CATS` in `src/data/cats.ts`, read as `GameData.cats`. Each sprite is `obj_<id>_sleep` (two breathing frames, `src/render/sprites/ambient.ts`); the old `obj_cat_sleep` is gone.
- **State:** `cats: { adopted: CatId[]; active: CatId }`. `adopted` always holds `cat_tabby`, has no repeats, and holds `active` (`validateState`: `bad cats`). Save 12 (`migrations[11]`, `tests/fixtures/save-v12.json` has a Siamese napping).
- **Actions:** `{ type: 'adoptCat'; cat: CatId }` (pays `price`, adds the cat, makes it the active one, emits `purchased` with `what: CatId`) and `{ type: 'chooseCat'; cat: CatId }` (free, adopted cats only), in `src/systems/cats.ts`.
- **Drawing:** `SceneView.cat` is the active cat's sprite id; the renderer draws it at `PET_TILE` as before.


### 9.14 As built in v2 phase 05

- **State (save 13):** `ranch.feedStore: Record<FeedId, number>` (hay and corn feed portions, each an integer 0 … `FEED_STORE_CAPACITY`; `validateState`: `bad feed store` for a negative or fractional count, a missing store or another key). `migrations[12]` moves bag feed into it (§9.10); `tests/fixtures/save-v13.json`.
- **Systems:** `src/systems/feedStore.ts` (`feedInStore`, `feedRoom`, `feedAvailable`, `storeFeed`, `takeFeed`: the store first, then any feed an old save left in the bag). `makeFeed`, `buyFeed`, `fillTrough`, the silo (`topUp`, `mill`) and bundle donations (`donate`, `donatable`, `haveForBundle` for feed items) use it. A full store refuses politely and nothing is used.
- **Modifiers:** `animalSpeedModifier` (above). `BuffDef.alsoSeam?: 'animalSpeedModifier'` lets one buff drive a second seam; only Busy Bees has it. `tickRanch` reads it through `cycleMsOf(def, speed)` (whole ms); `msToNextProduct(data, building, speed)` is the countdown the Ranch panel and the animal label show.
- **Prefs:** `paint: boolean` (Paint mode; default false). Not in the save.
- **Render input:** `src/render/sceneInput.ts` (pure: `tapActs`, `paintArmed`, `PaintStroke`, `Inspected`); the renderer's `inspected`, `paintMode`, `hoverAnimal()` and the options `onPaintStart` / `onPaintPlot` / `onPaintEnd`. `defaultCamera(view, out, phoneFocus)` and `fieldCentre(grid)` give a phone's default view.

### 9.15 As built in the bag and kitchen polish (after v3-00)

- **Action** `{ type: 'discardItem'; item: ItemId; qty: number; hearty?: boolean }` (`discardItem` in `src/systems/inventory.ts`): removes `qty` (all or nothing; `hearty` picks hearty or plain stacks, omitted means plain first) and emits **event** `{ type: 'discarded'; item; qty }`. Nothing else changes: no gold, no XP.
- **Prefs** gained `kitchenSort: 'ready' | 'price' | 'tier' | 'buff' | 'name'` (default `ready`), the Kitchen recipe book's order (`sortRecipes` in `src/ui/recipeSort.ts`, stable over the learned order). Not in the save.
- **Seed items** of regrowing crops end their description with "Keeps producing: harvest again every N min until its seasons end." (`seedItem` in `src/data/items.ts`); `regrowNote` in `src/ui/farmTools.ts` adds " · regrows every N min" to the Shop and seed-picker note. No `SAVE_VERSION` change.

### 9.16 As built in v2 phase 06: Seed Order and small comforts

- **State (save 14):** `seedOrder: { reservePct: number; off: CropId[] }` (`SeedOrderState` in `src/core/state.ts`). `reservePct` is one of `SEED_ORDER_RESERVES` (0, 10, 25, 50; default `SEED_ORDER_DEFAULT_RESERVE` 25), `off` lists the crops opted out, once each. `validateState`: `bad seed order`. `migrations[13]` adds the defaults; `tests/fixtures/save-v14.json`.
- **Upgrade** `seed_order` (`src/data/upgrades.ts`): 3 levels, cost 4,000 × 3ⁿ (4,000, 12,000, 36,000), requires Seed Planter level 1, effect `{ seedTarget: 20 | 50 | 100 }` (`UpgradeEffect.seedTarget`: seeds per crop the bag is topped up to).
- **System** `src/systems/seedOrder.ts`: `runSeedOrder(state, ctx)` runs from `tickSystems` right after `tickShippingBin` at a pickup (so it spends what the pickup just paid). `orderedCrops` is every crop in `state.lastPlantedCrop`, in table order, in season and `finishesBeforeSeasonEnds`, not in `seedOrder.off`; `orderCost` is the Shop price plus `SEED_ORDER_FEE` (10%, rounded up); the reserve is `floor(gold at the start of the pickup × reservePct / 100)`; each crop is all or nothing for space and for the reserve. No RNG. `msToNextPickup` reports pickups while the upgrade is owned, so a large step never skips one.
- **Actions** `{ type: 'setSeedOrderReserve'; pct }` and `{ type: 'setSeedOrderCrop'; crop; on }`. **Event** `{ type: 'seedsOrdered'; crop; qty; gold }` (the fee is in `gold`); the away summary has a line for it (`AwayTotals.ordered`).
- **Prefs** gained `kitchenFavourites: RecipeId[]` (default `[]`): recipes pinned to the top of the book in any sort order (`pinFavourites`, `toggleFavourite` in `src/ui/recipeSort.ts`). Not in the save.
- **Cook ×N:** `maxBatch(state, data, recipe)` in `src/systems/cooking.ts` (free stove slots, then the ingredients in the bag); the stepper is UI state in `kitchenPanel.ts` and Cook sends N `cook` actions.
- **Harvest all / Water all:** `bulkPlots(state)` in `src/ui/farmTools.ts` (the whole field, not the greenhouse) is used by Shift-click and the two buttons, which send the same `useTool` action (`useOnField` in `main.ts`).
- **HUD chip:** `Hud.levelButton` shows `Lv ${farmLevel(state)}`; `main.ts` toggles the Goals panel from it.

### 9.17 As built in the bag-arranging polish (after v4-00)

- **Actions** `{ type: 'moveStack'; from: number; to: number }` (`moveStack` in `src/systems/inventory.ts`): onto an empty slot the stack moves; onto a stack of the same item and `hearty` it merges up to `stackSize` (the rest stays in `from`); onto anything else (or a full stack) the two swap. `from === to` is a no-op. A slot outside the bag or an empty `from` is refused. `{ type: 'sortInventory' }` (`sortInventory`): merges every (item, hearty) kind into as few stacks as `stackSize` allows and lays them out from slot 0 by category (`seed`, `sapling`, `crop`, `fruit`, `animal`, `fish`, `dish`, `feed`, `junk`), then item name, then plain before hearty; empty slots last. Both emit **event** `{ type: 'bagArranged' }`; nothing else changes.
- **Barn Storage** now calls `mergeStacks(inventory)` after raising `stackSize`: each stack is topped up in place from later stacks of the same kind, so two stacks of 99 become one of 198.
- **UI:** `src/ui/bagDrag.ts` (`attachBagDrag`): a mouse drags after 6 px; a finger holds for 300 ms first (a quick swipe still scrolls). Slots carry `data-slot`. The Inventory panel has a Sort button (`data-testid="inv-sort"`) and a "Move…" button in the detail (`data-move`), the keyboard way: pick, then press a slot. No `SAVE_VERSION` change.
- **Backpack** (polish after v4-01): levels give 12 / 18 / 24 / 30 / 36 / 42 slots (a fifth level at 4,700). `syncBagSlots(state, data)` in `src/systems/upgrades.ts` grows `inventory.slots` to the level's slots plus the Summer Crops bundle's; buying a level and the `Game` constructor (every load) call it, and it never removes a slot. Not a shape change, so no migration.

## 10. v4: the North

Written by v4 phase 00. Numbers are in BALANCE.md §14 and behaviour in GDD §13; this section fixes ids, coordinates, shapes and the save plan. Each item is tagged with the phase that builds it (`@v4-01` … `@v4-04`). As in §9, a data table keyed by an id union is a full `Record`, so a missing entry is a compile error.

### 10.1 New id unions (`src/data/ids.ts`)

```ts
export type ParcelId = 'orchard' | 'yard' | 'meadow'
  | 'north_fields' | 'terraces';                                                              // @v4-01
export type NorthFieldId = 'north_fields' | 'terraces';    // a parcel that carries a field; the FieldId of its plots   @v4-01
export type FieldId = 'home' | 'greenhouse' | NorthFieldId;                                    // @v4-01 (derived from a plot index)
export type RegionId = 'home' | ParcelId | 'town' | 'lanes' | 'sea' | 'northroad' | 'woods';   // @v4-01 (src/data/world.ts)

export type DrinkId =                                                                         // @v4-03, @v4-04
  | 'tomato_juice' | 'honey_milk' | 'strawberry_cordial' | 'blueberry_cordial' | 'lemonade'
  | 'apple_cider' | 'peach_iced_tea' | 'melon_cooler' | 'hot_cocoa' | 'orchard_punch'        // @v4-03
  | 'herbal_tea' | 'elderflower_cordial';                                                     // @v4-04
export type ForageId = 'morel' | 'chanterelle' | 'wild_mint' | 'elderflower'
  | 'blackberry' | 'rose_hip' | 'hazelnut';                                                   // @v4-04
export type LakeFishId = 'whitefish' | 'lake_trout' | 'crayfish' | 'pike' | 'golden_trout' | 'alpine_char';   // @v4-04

// Extended unions
export type FishLocationId = 'pond' | 'river' | 'ocean' | 'lake';                             // @v4-04
export type FishId = /* the 16 v1 ids */ | LakeFishId;                                        // @v4-04
export type ExpansionId = /* the 6 v1 ids */ | 'lake';                                        // @v4-04 (kind 'fishing', location 'lake')
export type ItemId = /* v2 */ | DrinkId | 'honey' | 'cocoa' | ForageId;                       // @v4-03, @v4-04
export type RecipeId = /* the 32 dishes */
  | 'honey_cake' | 'honey_roast_yams'                                                         // @v4-03 (dishes)
  | 'mushroom_risotto' | 'blackberry_tart'                                                    // @v4-04 (dishes)
  | DrinkId;                                                                                  // drinks are recipes with station 'press'
export type UpgradeId = /* v2 */ | 'forager_basket';                                          // @v4-04 (confirmed, GDD §13.12)
export type MilestoneId = /* v2 */
  | 'm24_north_field' | 'm25_first_serving' | 'm26_first_drink' | 'm27_first_honey'
  | 'm28_first_forage' | 'm29_lake_fish';
export type GoalTemplateId = /* v2 */ | 'serve_dishes' | 'press_drinks';                      // @v4-02, @v4-03
export type BundleId = /* v2 */ | 'press_house' | 'forager';                                  // @v4-03, @v4-04
export type PanelId = /* v2 */ | 'restaurant' | 'press';                                      // @v4-02, @v4-03
```

Guards and arrays alongside the v2 ones: `NORTH_FIELD_IDS`, `isNorthFieldId`, `DRINK_IDS`, `isDrinkId`, `FORAGE_IDS`, `isForageId`. A drink's item id is its recipe id (as a dish's is). `PARCEL_IDS` keeps purchase order: orchard, yard, meadow, north_fields, terraces; a parcel's `requires` (not its place in the list) decides when it can be bought.

### 10.2 World coordinates: growing north (@v4-01)

```ts
// src/data/world.ts
export const WORLD_COLS = 36;
export const WORLD_TOP = -14;                    // the north band is rows −14 … −1
export const WORLD_BOTTOM = 22;                  // exclusive; today's bottom
export const WORLD_ROWS = WORLD_BOTTOM - WORLD_TOP;   // 36: a count, never a bound
export const HOME_ORIGIN = { col: 0, row: 0 } as const;   // unchanged
// src/render/scene.ts
export const WORLD_Y0 = WORLD_TOP * TILE;        // −224
export const WORLD_Y1 = WORLD_BOTTOM * TILE;     // 352
export const WORLD_H = WORLD_ROWS * TILE;        // 576 (a size)
```

The four coordinate spaces of §9.3 are unchanged; **world tile rows may now be negative**. Rules:
- A bound is `WORLD_TOP ≤ row < WORLD_BOTTOM` and `0 ≤ col < WORLD_COLS`, or `WORLD_Y0 ≤ y < WORLD_Y1` in pixels. Never `row < 0` or `y < 0`.
- Arrays over rows are indexed `row − WORLD_TOP` (the layout's `ground`, chunk rows).
- **The world may grow in any direction by adding tiles outside it; existing tiles never move.** A future band adds a new `WORLD_TOP`, `WORLD_BOTTOM` or `WORLD_COLS`; nothing stored changes meaning.

**Audit: every place that assumes the world starts at row 0** (line numbers on `main` at v2-06). "Change" is what negative rows need.

| # | Where | What it assumes | Change |
|---|---|---|---|
| 1 | `src/data/world.ts:11–12` | `WORLD_COLS`, `WORLD_ROWS` are the size and `0` the top | add `WORLD_TOP`, `WORLD_BOTTOM`; `WORLD_ROWS` derived; `WorldLayout` gains `top` |
| 2 | `src/data/world.ts:1–6` | comment: "may only grow right and down" | the new rule above |
| 3 | `src/data/world.ts:121–122` `regionAt` | `row < 0 \|\| row >= layout.rows` is outside | `row < layout.top \|\| row >= layout.top + layout.rows` |
| 4 | `src/data/world.ts:160, 173` blocked-tile key `row × WORLD_COLS + col` | – | none: unique for negative rows while `0 ≤ col < 36` (a test pins it) |
| 5 | `src/render/scene.ts:29–30` `WORLD_W`, `WORLD_H` | `WORLD_H` is also the bottom bound | add `WORLD_Y0`, `WORLD_Y1`; `WORLD_H` stays a size |
| 6 | `src/render/scene.ts:125–126` `tileAt` | `y < 0` is outside | `y < WORLD_Y0 \|\| y >= WORLD_Y1`; `Math.floor` already maps −0.5 to −1 |
| 7 | `src/render/scene.ts:467–498` `buildLayout` | loops `row = 0 … WORLD_ROWS`, `ground[row]` | loop `WORLD_TOP … WORLD_BOTTOM`, `ground[row − WORLD_TOP]` (a `groundAt(layout, col, row)` helper) |
| 8 | `src/render/scene.ts:281` forest `TREES`, `SCENERY` | the world's edge is row 0 at the top | the tree line at row −14 and the north scenery are data (`WORLD_LAYOUT.treeLine`, `SCENERY`) |
| 9 | `src/render/scene.ts:219` `tileHash` | – | none: integer maths works for negatives |
| 10 | `src/render/scene.ts:169–197` `tileOfPlot`, `plotIndexAt`; `:226` `fenceRect`; `:245` `pathFor` | one field (plus the greenhouse) | per field (§10.3): `fieldOf(index)`, `FIELD_LAYOUT[field]`, `fenceRectFor(field, grid)`, `pathFor` stays the home path; north fields have fixed fences and paths in `WORLD_LAYOUT` |
| 11 | `src/render/camera.ts:83–86` `clampCamera` | y clamped to `[halfH, WORLD_H − halfH]`, centred at `WORLD_H / 2` | `[WORLD_Y0 + halfH, WORLD_Y1 − halfH]`, centre `(WORLD_Y0 + WORLD_Y1) / 2` |
| 12 | `src/render/camera.ts:160–161` `CHUNK_ROWS` | `ceil(WORLD_H / CHUNK_PX)` | unchanged formula (3 rows of chunks) |
| 13 | `src/render/camera.ts:167–176` `visibleChunks` | `r0 = floor(rect.y / CHUNK_PX)`, chunk row 0 at y 0 | `floor((rect.y − WORLD_Y0) / CHUNK_PX)` (chunks anchored at the world's top) |
| 14 | `src/render/camera.ts:95–105` `defaultCamera` | – | none (home region); a test pins it |
| 15 | `src/render/renderer.ts:366–379` frame canvas and chunk canvases | the frame canvas's (0, 0) is world (0, 0) | the frame stays `WORLD_W × WORLD_H`; `fctx.setTransform(1, 0, 0, 1, 0, −WORLD_Y0)` once, so every draw stays in world px; chunk height `min(CHUNK_PX, WORLD_H − r × CHUNK_PX)` unchanged |
| 16 | `src/render/renderer.ts:943–945` `buildChunks` | ground row `r0` = chunk row × 16 | unchanged once `ground` is indexed from the top (#7) |
| 17 | `src/render/renderer.ts:988–991` the composed region | `y0 = max(0, …)`, `y1 = min(WORLD_H, …)` | `max(WORLD_Y0, …)`, `min(WORLD_Y1, …)` |
| 18 | `src/render/renderer.ts:1027–1030` chunk draw position | `cy = chunkRow × CHUNK_PX` | `+ WORLD_Y0` |
| 19 | `src/render/renderer.ts:1130` copy to screen | source rect `(x0, y0)` is canvas px | source `y0 − WORLD_Y0` (the canvas is not transformed for `drawImage` reads) |
| 20 | `src/render/ambient.ts:93` clouds; `:132–137` `setBounds` | clouds spawn in `[20, WORLD_H]`; bounds clamped to `[0, WORLD_H]` | `[WORLD_Y0 + 20, WORLD_Y1]`; `[WORLD_Y0, WORLD_Y1]` |
| 21 | `src/systems/decor.ts:140–143` `tileProblem` | `row < 0` is past the edge | `row < WORLD_TOP`; new region cases: north parcels need ownership, `northroad` and `woods` are refused ("The north road belongs to everyone.", "Leave the woods wild.") |
| 22 | `src/core/save.ts:485` decoration validation | `at.row < 0` is bad | `at.row < WORLD_TOP` |
| 23 | `src/core/save.ts:373` placed objects | `at` inside the one grid | inside its field's grid (`field` absent = home, §10.6) |
| 24 | `src/core/save.ts:528–545` ranch buildings | – | none (no bound checked; buildings stay in the yard) |
| 25 | `src/systems/ranch.ts:203–231` building placement | – | none (the yard's rect) |
| 26 | `src/render/pips.ts:37–60` `edgePips` | – | none (pure maths on world px) |
| 27 | `src/main.ts:498` `regionAt` for toasts | regions known to `REGION_NAMES` | add `north_fields` "North Fields", `terraces` "Upper Terraces", `northroad` "North Road", `woods` "North Woods" |
| 28 | `src/core/prefs.ts` `sanitizeCamera` | – | none: any finite world px; clamped when used |
| 29 | `e2e/helpers.ts:99` `plotTile` | the home field only | add `fieldPlotTile(field, i)`; `tilePoint`, `showTile`, `onScreen` work in world tiles and need nothing |
| 30 | `scripts/sim/brain.ts:947` decoration spiral | rows `0 … WORLD_ROWS` | rows `WORLD_TOP … WORLD_BOTTOM` if the north becomes decoration space for bots (home and meadow only today: no change needed) |
| 31 | `tests/world.test.ts:44, 60–64`, `tests/decorRender.test.ts:256–266` | the world is 36 × 22 from row 0 | the new size and bounds |
| 32 | sprites that tile | – | none: ground, water, fences and paths are drawn per tile at world px; auto-tile masks use `"col,row"` keys; particles and ambient use float world px |

About 30 sites, a dozen with real edits; roughly 250 lines plus tests. Hit-testing order (§9.3) gains the north's zones after the v1 zones: restaurant site, Press House site, hive spots, forage spots, the lake.

### 10.3 The north layout and fields (@v4-01)

```ts
// WorldLayout additions (src/data/world.ts)
export interface WorldLayout {
  /* … §9.3 … */
  top: number;                                              // WORLD_TOP
  treeLine: TileRect;                                       // (0, −14) 36 × 1
  hedges: readonly TileRect[];                              // (0, −1) 20 × 1, (0, −8) 20 × 1
  northFields: Readonly<Record<NorthFieldId, NorthFieldLayout>>;
  restaurantSite: TileRect;                                 // (22, −6) 5 × 5: footprint (22, −5) 5 × 3, terrace (22, −2) 5 × 1
  pressSite: TileRect;                                      // (28, −6) 4 × 5: footprint (28, −5) 4 × 3, yard (28, −2) 4 × 1 (one press per slot)
  hiveSpots: readonly WorldTile[];                          // (32, −6), (34, −6), (32, −4), (34, −4), (32, −2), (34, −2)
  lake: TileRect;                                           // (27, −13) 7 × 3, jetty (30, −10)
  forageSpots: readonly { col: number; row: number; kind: ForageKind }[];   // @v4-04, 8 entries
  // forSaleSigns gains north_fields (18, −6) and terraces (18, −12)
}
export interface NorthFieldLayout {
  origin: WorldTile;               // top-left plot: north_fields (6, −6), terraces (6, −12)
  grid: { cols: number; rows: number };   // 8 × 4, 8 × 3 (fixed: no expansions)
  gate: WorldTile & { sprite: 'obj_fence_gate_v' };   // (14, −5), (14, −11)
  path: readonly WorldTile[];      // (15 … 19, −5), (15 … 19, −11), to the north road
  rest: WorldTile;                 // where the farmhand figure waits: the path tile by the gate
}
export type ForageKind = 'mushroom' | 'herb' | 'berry' | 'nut';
```

Regions (`WORLD_LAYOUT.regions`): `north_fields` (0, −7) 20 × 6, `terraces` (0, −13) 20 × 5, `northroad` (21, −7) 15 × 6, `woods` (21, −13) 15 × 5. Lanes add col 20 rows −13 … −1 and rows −1 and −8 at cols 21 … 35. `DECOR_BLOCKED` adds each north field's fence ring (the whole field plus ring), its path, the hedges and the tree line; `fixedBlockReason` covers them.

**Plot addressing** (`src/data/balance.ts`, `src/systems/farming.ts`):

```ts
GREENHOUSE_BASE = 1000                                       // unchanged
FIELD_BASE: Readonly<Record<NorthFieldId, number>> = { north_fields: 2000, terraces: 3000 };
fieldOf(index): FieldId      // < 1000 home · < 2000 greenhouse · < 3000 north_fields · < 4000 terraces
plotAt(state, index)         // home plots, greenhouse, or state.farm.north[field].plots[index − FIELD_BASE[field]]
allPlotIndexes(state)        // home, greenhouse, then each owned north field in NORTH_FIELD_IDS order (cached per farm shape)
tileOfPlot(grid, index)      // north: FIELD origin + (i % cols, floor(i / cols))
plotIndexAt(grid, col, row, greenhousePlots, ownedNorth)     // inverse, −1 off any plot
```

Coverage maps (sprinklers, scarecrows) are kept per field (`Coverage` gains `byField`), and an area never crosses into another field. `expandToolArea` clips to the clicked plot's field. `bulkPlots(state)` (Shift-click and Harvest all / Water all) takes the clicked field for Shift-click and every non-greenhouse field for the buttons.

### 10.4 Content definitions (v4)

```ts
// src/data/parcels.ts: ParcelDef gains an optional field
export interface ParcelDef { /* … §9.4 … */ field?: NorthFieldId }   // north parcels carry their field   @v4-01

// src/data/restaurant.ts  @v4-02
export interface RestaurantLevelDef { price: number; slots: number; premium: number }
export const RESTAURANT: {
  name: 'The Bramble Table'; requires: readonly UnlockCondition[];
  levels: readonly [RestaurantLevelDef, RestaurantLevelDef, RestaurantLevelDef];   // BALANCE §14.3
  specialRota: readonly RecipeId[];                         // 28 ids; special(d) = rota[d % 28]
};
// a menuable item: an ItemDef with category 'dish' or 'drink'; serving interval from its recipe's tier

// src/data/recipes.ts: RecipeDef gains a station  @v4-03
export interface RecipeDef {
  /* … §4.4 … */
  station?: 'kitchen' | 'press';                            // absent = kitchen
  // for 'press', cookSec is the press time (BALANCE §14.4); the tier formula divides it by TIER_PRESS_DIV
}
// ItemCategory gains 'drink' (sellable, edible, menuable) and 'forage' (sellable); honey is 'animal'
// (a sellable product, Auto-Seller off by default); cocoa is 'feed'-like: category 'ingredient', not sellable.
export type ItemCategory = /* v2 */ | 'drink' | 'forage' | 'ingredient';

// src/data/press.ts  @v4-03
export interface PressLevelDef { price: number; slots: number }
export const PRESS_HOUSE: { name: 'Press House'; requires: readonly UnlockCondition[]; levels: readonly PressLevelDef[]; shelf: { cocoa: number } };
export const HIVE: { basePrice: number; ratio: number; cycleSec: number; store: number; product: 'honey'; requires: readonly UnlockCondition[] };

// src/data/forage.ts  @v4-04
export const FORAGE_KINDS: Readonly<Record<ForageKind, Readonly<Record<SeasonId, { item: ForageId; perDay: number } | null>>>>;

// src/data/fish.ts  @v4-04
export interface ReelTuning { zoneSpeedMult: number; zoneWidthMult: number; biteWaitMult: number }
export const LOCATION_REEL: Readonly<Record<FishLocationId, ReelTuning>>;   // pond, river, ocean all 1; lake 0.85 / 0.92 / 1.15
```

One new `UnlockCondition` kind. The restaurant uses `farmLevel`, `upgrade` (kitchen 2) and `parcel`; the Press House `farmLevel` and `parcel`; hives `{ kind: 'press', level: 1 }`, the new kind (@v4-03: met by a built Press House of at least that level). New `QuestObjective` kinds: `{ kind: 'ownNorthField'; count }` (checked from state, @v4-01), `{ kind: 'serve'; count }` (counts `served`, @v4-02), `{ kind: 'press'; count }` (counts `drinkPressed`, @v4-03), `{ kind: 'collectHoney'; count }` (@v4-03), `{ kind: 'forage'; count }` (@v4-04); the existing `catch` objective already takes a `location`, so `m29_lake_fish` is `{ kind: 'catch', location: 'lake', count: 1 }`. New `BundleReward` kinds: `{ kind: 'menuSlot'; count: 1 }` (@v4-03), `{ kind: 'forageCap'; days: 1 }` (@v4-04).

### 10.5 `GameState` additions

```ts
export interface GameState {
  /* … v1 and v2 fields … */

  // ---- north fields (@v4-01, save 15)
  farm: {
    grid; plots; greenhouse;                                 // unchanged
    north: Partial<Record<NorthFieldId, NorthField>>;        // an entry once the parcel is bought
  };
  // placed objects on north plots: PlacedObject gains `field?: NorthFieldId` (absent = home); `at` is in that field's plot coordinates

  // ---- restaurant (@v4-02, save 16)
  restaurant: {
    level: number;                                           // 0 = not built, 1 … 3
    menu: MenuSlot[];                                        // length = slots for the level (+1 with the bundle)
    today: { day: number; gold: number; served: number };    // calendar.dayIndex; reset by onDayStarted
  };

  // ---- Press House and apiary (@v4-03, save 17)
  press: {
    level: number;                                           // 0 = not built
    slots: PressSlot[];                                      // length = slots for the level
  };
  apiary: { hives: HiveState[] };

  // ---- North Woods (@v4-04, save 18)
  forage: { spots: ForageSpotState[] };                     // one per WORLD_LAYOUT.forageSpots entry, created when the woods open
}

export interface NorthField {
  plots: Plot[];                                             // row-major, cols × rows of its layout
  lastPlantedCrop: (CropId | null)[];                        // same length; the planter's memory for this field
}
export interface MenuSlot {
  item: ItemId | null;                                       // a dish or drink; null = empty
  qty: number;                                               // 0 … MENU_SLOT_CAP
  hearty: boolean;                                           // which stack it holds (served at the same price)
  cycleMs: number;                                           // simulated ms into the current serving; 0 when empty
}
export interface PressSlot {
  recipe: RecipeId | null;                                   // a 'press' recipe
  remainingMs: number;                                       // 0 = finished
  done: number;                                              // finished drinks waiting (0 or 1; a repeating slot that finds no room waits)
  repeat: boolean;                                           // "keep pressing"
  saved?: ItemId;                                            // like CookJob.saved (the Cooking perk)
}
export interface HiveState { id: number; spot: number; honey: number; cycleMs: number }
export interface ForageSpotState { spot: number; item: ForageId | null; qty: number; lastDay: number }
// Stats gains: restaurantGold, served (@v4-02); drinksPressed, honeyCollected (@v4-03); foraged (@v4-04).
```

Derived, never stored: a field's owned state (from `land.parcels`), coverage per field, the day's special, a menu slot's serving interval and next serving time, the restaurant's slot count, press slot count, hive count and next free spot, forage ripeness and cap. `state.lastPlantedCrop` keeps its v1 layout (home field then greenhouse); north fields keep their own.

### 10.6 Actions and events

```ts
// @v4-01: buyParcel already covers the fields; farming actions take any plot index; placement gains a field
| { type: 'place'; kind: PlacedKind; col: number; row: number; field?: NorthFieldId }   // extends the v1 placement action
// @v4-02
| { type: 'buildRestaurant' }                                                           // level 1
| { type: 'upgradeRestaurant' }
| { type: 'stockMenu'; slot: number; item: ItemId; qty: number; hearty?: boolean }      // all or nothing; same item (and stack kind) as the slot holds
| { type: 'restockMenu' }                                                               // tops every slot up from the bag
| { type: 'clearMenuSlot'; slot: number }                                               // back to the bag; refused if it does not fit
// @v4-03
| { type: 'buildPress' } | { type: 'upgradePress' }
| { type: 'startPress'; slot: number; recipe: RecipeId; repeat?: boolean }
| { type: 'setPressRepeat'; slot: number; repeat: boolean }
| { type: 'cancelPress'; slot: number }                                                 // ingredients back, like cancelCook
| { type: 'collectPress'; slot?: number }                                               // omitted = all
| { type: 'buyCocoa'; qty: number }
| { type: 'buyHive' }                                                                   // next free spot
| { type: 'collectHive'; hive?: number }                                                // omitted = all
// @v4-04
| { type: 'pickForage'; spot: number }
```

```ts
| { type: 'northFieldBought'; field: NorthFieldId }                                     // @v4-01 (with parcelBought)
| { type: 'restaurantBuilt' | 'restaurantUpgraded'; level: number }                     // @v4-02
| { type: 'served'; item: ItemId; qty: number; gold: number; slot: number; special: boolean }   // @v4-02, batched per slot per step
| { type: 'menuEmpty'; slot: number }                                                   // @v4-02, once when a slot runs out (away summary, pip)
| { type: 'pressBuilt' | 'pressUpgraded'; level: number }                              // @v4-03
| { type: 'drinkPressed'; recipe: RecipeId; slot: number; auto: boolean }               // @v4-03, a run finished
| { type: 'pressCollected'; recipe: RecipeId; qty: number; auto: boolean }              // @v4-03
| { type: 'hiveBought'; id: number } | { type: 'honeyMade'; qty: number }               // @v4-03 (batched)
| { type: 'honeyCollected'; qty: number; auto: boolean }                                // @v4-03
| { type: 'forageGrown'; item: ForageId; qty: number }                                  // @v4-04, at a refresh (away summary)
| { type: 'foragePicked'; item: ForageId; qty: number; spot: number; auto: boolean }    // @v4-04
// harvested, planted, watered gain `field: FieldId` (derived from the index; a convenience for the farmhand figure and the report)
```

`goldEarned.source` gains `'restaurant'`. `purchased.what` widens with `'restaurant' | 'press' | 'hive' | 'cocoa'` and the new parcel ids.

### 10.7 Modifiers

No new `Modifiers` fields. Hives read `animalSpeedModifier` (Busy Bees), like the animals. The restaurant reads none (its price is base × premium; `sellPriceModifier` and the category bonuses do not apply). Presses read none (Quick Hands is for the stove). Drinks give buffs through the existing seven types and slots. Decorations, charm and town projects still feed nothing, and the v2-02 test that places everything and checks `computeModifiers` keeps passing.

### 10.8 Simulated-time reporting

| System | Step size independence | `msToNextSimEvent`? |
|---|---|---|
| restaurant (`tickRestaurant`, after `tickCooking` so a dish cooked this step is not served in it) | whole cycles per slot; fixed interval inside a step | no: nothing changes the interval mid-step |
| presses (`tickPress`, after `tickRestaurant`) | a run's remaining time counts down; a "keep pressing" restart takes ingredients from the bag | **yes**: `msToNextPressFinish`, because a restart reads the bag, which other systems change |
| hives (`tickApiary`, right after `tickRanch`, before farming; it uses no RNG) | whole cycles; Busy Bees fixed inside a step | no (buff expiry is already a boundary) |
| forage (`growForage`, from `onDayStarted`, like `growOrchard`) | calendar days | – |

The Collecting Basket empties hives and finished presses in `ranchPickup`, before the bin pickup (so drinks and honey the Auto-Seller ships are paid at that pickup).

### 10.9 `SAVE_VERSION` plan and migration contracts

One version per build phase that changes state. v3 changes no state (its prompts say so), so the numbers follow v2-06's 14. If any other phase bumps the version first, each v4 phase takes the next free number and keeps the contract.

| Version | Phase | Adds | Migration `migrations[n]` (raw JSON of version n → n + 1) | Fixture `tests/fixtures/save-v(n+1).json` holds |
|---|---|---|---|---|
| **15** | v4-01 | `farm.north`, `placed[].field` | 14 → 15: `farm: { ...old.farm, north: {} }`. `placed` entries stay as they are (no `field` = home). Nothing moves: the test loads `save-v14.json` and checks that every decoration, building, tree, trap, placed object and zone hit-tests to the same thing as before, and that a stored camera pref clamps to the same view at the default zoom. | `north_fields` owned with a mix of plots (tilled, planted, ready, dead), a sprinkler and a scarecrow on north plots, `lastPlantedCrop` for the field, and a decoration on a north parcel tile with a negative row |
| **16** | v4-02 | `restaurant`, `stats.restaurantGold`, `stats.served` | 15 → 16: `restaurant: { level: 0, menu: [], today: { day: old.calendar.maxDayIndex, gold: 0, served: 0 } }`, the two stats at 0 | a level 2 restaurant with three slots: a full stack, a hearty stack mid-cycle, an empty slot |
| **17** | v4-03 | `press`, `apiary`, `stats.drinksPressed`, `stats.honeyCollected` | 16 → 17: `press: { level: 0, slots: [] }`, `apiary: { hives: [] }`, the stats at 0. Known recipes need nothing (drinks are learned on build). | a level 2 Press House with a running slot, a finished one and a repeating one; three hives (one full); honey and cocoa in the bag; a drink on the menu |
| **18** | v4-04 | `forage`, `stats.foraged` | 17 → 18: `forage: { spots: [] }` (spots are created when the woods open, with `lastDay` = that day), `stats.foraged: 0`. The lake needs no state: `'lake'` joins `expansions`, `fishing.traps[].location` and the collection when bought. | eight spots in mixed states (ripe, capped, resting), the lake bought with a trap, a lake fish in the collection |

The §8 and §9.10 rules carry over: migrations take raw JSON and import no current types; a save newer than the code or one that fails to load is never overwritten (show the error, offer an export); adding content needs no migration unless the state shape changes; the camera is not in the save. `validateState` gains: north field plots and `lastPlantedCrop` of the layout's length (`bad north field`), placed objects inside their field (`bad placed object`), decorations with `WORLD_TOP ≤ row` (`bad decoration`), menu slots (`bad menu`: a menuable item, `0 ≤ qty ≤ 99`, `cycleMs ≥ 0`, length ≤ 5), press slots (`bad press`), hives (`bad hive`: unique spots inside `hiveSpots`), forage spots (`bad forage`).

### 10.10 As built in v4 phase 01

- **World constants** as §10.2: `WORLD_TOP = −14`, `WORLD_BOTTOM = 22`, `WORLD_ROWS = 36` (a count) in `src/data/world.ts`, `WORLD_Y0`/`WORLD_Y1` in `src/render/scene.ts`; `WorldLayout.top`. Every audited site reads them. `groundAt(ground, col, row)` reads the layout's ground (indexed `row − WORLD_TOP`). `defaultCamera` keeps the v2 framing: the default view's top edge stays at row 0 while the world below leaves room, so a stored camera and Home show exactly what they did.
- **Layout additions** as §10.3, plus `northRoadCol` (20), `jetty` and `pines` (the woods' trees as data). `forageSpots` waits for v4-04 (its tiles are left free of pines). `northFenceRect(field)` gives a field's fence ring.
- **Plot addressing** as §10.3. Added helpers: `northFieldOf`, `plotCount`, `fieldPlotIndexes`, `plotFields` (each field's plot array with its base, cached per farm; the farmhand, the planter and the step boundaries walk these instead of calling `plotAt` per index), `lastPlanted`/`setLastPlanted`, `rememberedCrops`, `newNorthField`; in `placement.ts`: `gridOf`, `fieldPlotIndex`, `plotCoordsOf`, and `objectAt`/`inGrid`/`placementProblem`/`placeObject` take an optional `field`. `occupiedPlots` returns a cached, shared `ReadonlySet`.
- **State and save 15** exactly as §10.5 and §10.9 (`farm.north`, `PlacedObject.field`); validation errors `bad north field` (an unknown field, a field whose parcel is not owned, plots or memory of the wrong length) and `bad placed object` (a `field` not owned, `at` outside its field's grid). Fixture `tests/fixtures/save-v15.json`; the migration test compares every tile of the v2 world against `tests/fixtures/hitmap-v14.json`, written by `tests/hitMap.ts` at the v4-00 commit.
- **Events:** `northFieldBought` and `placed`/`pickedUp` with `field` as §10.6. **Deviation:** `harvested`, `planted` and `watered` do **not** gain a `field`: it is derived from the plot index (`fieldOf`), which every listener (the farmhand figure, the report) already has.
- **Milestone** `m24_north_field` with the new objective kind `{ kind: 'ownNorthField'; count }` (checked from state).

### 10.11 As built in v4 phase 02

- **Data** as §10.4: `RESTAURANT` in `src/data/restaurant.ts` (`name`, `requires`, three `levels`, `specialRota`, and `sprites`: the three building ids and the two table ids), exposed as `GameData.restaurant` (systems read it through `ctx.data`, never the file). `RestaurantDef`/`RestaurantLevelDef` are in `src/data/types.ts`. **Deviation:** there are no `obj_restaurant_<n>_lit` ids: each building sprite has the lit look as frame 1 (`lit: true`), like the coop and the barn.
- **State and save 16** exactly as §10.5 and §10.9 (`restaurant`, `stats.restaurantGold`, `stats.served`), with one refinement: a `MenuSlot` that has served everything keeps its `item` with `qty` 0 (so Restock knows what it serves; `cycleMs` is 0); `item: null` means a table never stocked or cleared. Validation `bad restaurant` (shape, level 0–3, today's numbers) and `bad menu` (no slots before it is built, at most 5, a dish, `0 ≤ qty ≤ 99`, a count only with an item, `cycleMs` 0 when empty, `hearty` boolean). Fixture `tests/fixtures/save-v16.json` (a level 2 restaurant: a full stack, a hearty stack mid-cycle, an empty table).
- **Actions** as §10.6 (`buildRestaurant`, `upgradeRestaurant`, `stockMenu`, `restockMenu`, `clearMenuSlot`). `stockMenu` is all or nothing and refuses more than the slot's room rather than stocking part of it.
- **Events** as §10.6, except `menuEmpty` also carries the `item` (the toast names it). `goldEarned.source` gains `'restaurant'`; `purchased.what` gains `'restaurant'`.
- **The special (deviation from `rota[d % 28]`):** `specialOn(data, calendar, d)` = `specialRota[seasonIndex(seasonOfDay(d)) × 7 + weekday(d)]`. A save's day 0 is any weekday and seasons turn on Sundays, so `d % 28` could not keep "seasonal ones in their season's weeks"; season × weekday does, and it is still a pure function of the day index (the panel lists the next seven days).
- **Progression:** milestone `m25_first_serving` (objective `{ kind: 'serve'; count }`, counting `served`), goal template `serve_dishes` (about an hour of the current menu's servings, an empty table counted as a T2 dish, at least 3; offered once the restaurant is built).
- **Tick order:** `tickRestaurant` runs right after `tickCooking`; `openRestaurantDay` (today's takings) runs from `onDayStarted`. No `msToNextSimEvent` entry (§10.8).

### 10.12 As built in v4 phase 03

- **Ids** as §10.1, with the kitchen's dishes as their own union: `DishId` (the 34 dishes, `honey_cake` and `honey_roast_yams` included), `DrinkId` (the ten v4-03 drinks; v4-04 adds `herbal_tea` and `elderflower_cordial`) and `RecipeId = DishId | DrinkId`. `RECIPE_IDS` stays the kitchen's dishes (every Kitchen, Shop, goal and experiment loop reads it unchanged), `DRINK_IDS` the drinks and `ALL_RECIPE_IDS` both; guards `isDishId`, `isDrinkId`, `isRecipeId`. `PressItemId = 'honey' | 'cocoa'` joins `ItemId`. `MilestoneId` gains `m26_first_drink`, `m27_first_honey`; `GoalTemplateId` `press_drinks`; `BundleId` `press_house`; `PanelId` `press`.
- **Data** as §10.4: drinks are `RecipeDef`s with `station: 'press'` in `src/data/drinks.ts` (`DRINKS`, merged into `RECIPES`), `cookSec` being the press time; `RecipeDef` also gains `fresh` (the seasons a drink's ingredients are fresh in, for the book). `PRESS_HOUSE` and `HIVE` in `src/data/press.ts` (`GameData.press`, `GameData.hive`; `PressHouseDef`, `PressLevelDef`, `HiveDef` in `types.ts`, with sprite ids). `RecipeDiscovery` gains `{ kind: 'press' }` (learned when the Press House is built: Tomato Juice and Honey Milk). `ItemCategory` gains `'drink'` (sellable, edible) and `'ingredient'` (cocoa, not sellable); honey is `'animal'`. The recipe score divides a drink's press time by `TIER_PRESS_DIV` (`recipeScore` reads `station`).
- **State and save 17** as §10.5 and §10.9, with these refinements: `PressSlot` is `{ recipe, remainingMs, done, repeat }` without `saved` (presses read no modifier, so the Cooking perks' ingredient saving is the stove's alone); `recipe` stays set after a run so the slot can press it again; `done` counts finished drinks waiting in the slot, up to `PRESS_SLOT_STORE` (24), not 0 or 1, so a "keep pressing" slot can work through a night and the Collecting Basket or a click brings them in. `HiveState` is `{ id, spot, honey, cycleMs }`, `cycleMs` 0 while full. Validation `bad press` (level 0–3, no more slots than the level, a drink, `0 ≤ done ≤ 24`, an empty slot has nothing running) and `bad hive` (unique spots and ids inside `hiveSpots`, `0 ≤ honey ≤ 10`). Fixture `tests/fixtures/save-v17.json`: a level 2 Press House with a running slot, a finished one and a repeating one; three hives (one full); honey and cocoa in the bag; Lemonade on the menu.
- **Actions** as §10.6. `startPress` also refuses a slot holding finished drinks of another recipe ("collect first"); the same recipe joins them. `cancelPress` turns "keep pressing" off. `collectPress` and `collectHive` move what fits (or what the Auto-Seller ships) and say so when the bag is too full.
- **Events** as §10.6, with `drinkPressed` carrying the recipe's `tier` (Cooking XP) and `auto` meaning "the slot keeps pressing"; `pressCollected` and `honeyCollected` carry `shipped`; one more event, `pressStopped { recipe, slot, reason: 'ingredients' | 'full' }`, once when a "keep pressing" slot rests (the away summary and a toast). `hiveBought` carries the `spot`. `recipeLearned.how` gains `'press'`. `purchased.what` gains `'press' | 'hive' | 'cocoa'`.
- **Tick order and step boundaries** as §10.8: `tickApiary` right after `tickRanch` (no RNG, no `msToNextSimEvent`), `tickPress` right after `tickRestaurant`, `msToNextPressFinish` in `msToNextSimEvent`. The Collecting Basket (`ranchPickup`) empties the stores, the hives and the finished presses and restarts resting "keep pressing" slots, all at a pickup, which the basket makes a step boundary.
- **Unlocks and progression:** `UnlockCondition { kind: 'press'; level }`; objectives `{ kind: 'press'; count }` (counts `drinkPressed`) and `{ kind: 'collectHoney'; count }`; `BundleReward { kind: 'menuSlot'; count }` (`bundleBonuses().menuSlots`; `menuSlots()` adds it once the restaurant is built, and completing the bundle lays the table at once). The `knownRecipes` condition counts dishes only. Drinks give Cooking XP like a dish of their tier; honey Farming XP `HONEY_XP` (10) a jar, a quarter by the basket.

### 10.13 As built in v4 phase 04

- **Ids** as §10.1: `ForageId` (seven), `ForageKind` (`'mushroom' | 'herb' | 'flower' | 'nut'`, with `FORAGE_KINDS_IDS`), `LakeFishId` (six, appended to `FISH_IDS` so older saves draw the same specials), `FishLocationId` and `ExpansionId` gain `'lake'`, `DishId` gains `mushroom_risotto` and `blackberry_tart`, `DrinkId` gains `herbal_tea` and `elderflower_cordial`, `UpgradeId` gains `forager_basket`, `MilestoneId` `m28_first_forage` and `m29_lake_fish`, `BundleId` `forager`. Guards `isForageId`, arrays `FORAGE_IDS`.
- **Data** as §10.4: `FORAGE` in `src/data/forage.ts` (`GameData.forage`: `items` with price and Farming XP, `kinds[kind][season]` = `{ item, perDay }` or `null`, and `spotKinds`, the kind of each spot by index; `ForageDef`, `ForageItemDef`, `ForageSeasonYield` in `types.ts`), `FORAGE_KIND_NAMES` for labels; `WORLD_LAYOUT.forageSpots` (eight world tiles, clear of every pine's trunk and crown); `LOCATION_REEL` in `src/data/fish.ts` exposed as `GameData.locationReel` (`ReelTuning`: `zoneSpeedMult`, `zoneWidthMult`, `biteWaitMult`; pond, river and ocean all 1). `ItemCategory` gains `'forage'` (sellable). `AutomationFlag` gains `'autoForage'`; `QuestObjective` `{ kind: 'forage'; count }` (counts `foragePicked`); `BundleReward` `{ kind: 'forageCap'; days }` (`bundleBonuses().forageCapDays`). **Deviation:** the Mountain Lake's reel tuning is a table beside the fish (`LOCATION_REEL`), not a `reel` block on an expansion.
- **State and save 18** exactly as §10.5 and §10.9 (`forage.spots`, `stats.foraged`), with one refinement: a spot that has been picked clean has `item: null` (and `qty` 0); an unpicked spot keeps last season's item until picked. Validation `bad forage`: no spots or exactly eight, `spot` equal to its index, `0 ≤ qty ≤ 20` (four days of the largest yield), an item only with a quantity, `lastDay` an integer; trap locations may be `'lake'`. Fixture `tests/fixtures/save-v18.json` (eight spots in mixed states: a capped one, ripe ones, resting ones, last season's chanterelles waiting; the lake bought with a trap holding two whitefish; an Alpine Char in the collection).
- **Opening the woods:** spots are created when the woods open (`openWoods`: on buying the North Fields, at a refresh, or when a save that owned the fields is loaded, `Game.prepareState`), with **one day's growth**, so the first visit finds something (DATA_SCHEMAS planned `lastDay` = that day and nothing until the next refresh). An event `woodsOpened` marks it.
- **Action** `pickForage { spot }` as §10.6. **Events** `forageGrown` (batched per item at a refresh) and `foragePicked` as §10.6, with `shipped` (what the Auto-Seller sent to the bin), plus `woodsOpened`.
- **Calendar, not ticks:** `growForage` runs from `onDayStarted` right after `growOrchard` and walks each spot's days since `lastDay` (§10.8); no RNG, no `msToNextSimEvent`. The Forager's Basket picks at each bin pickup in `tickSystems` (just after `ranchPickup`); owning it makes every pickup a step boundary (`msToNextPickup`).
- **Fishing:** `startReel(state, ctx, id, location?)` multiplies the zone's width and speed by the water's tuning (the fish's own water by default) and `release` the bite wait by `biteWaitMult`; Relaxed fishing and the rod multiply on top. `fish_trap`'s max is 12 (four waters × three spots with the Pond Fish bundle); the 10th–12th cost 19,000, 29,000 and 43,000.
