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
  cookSpeedModifier: 1, automationSpeedModifier: 1, xpModifier: 1, dishSellBonus: 0, cookingXpBonus: 0,
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
export function seasonOfDay(cal: CalendarState, d: number): SeasonId;
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

Rules that carry over from §8: migrations take raw JSON and do not import current types; a save newer than the code or one that fails to load is never overwritten (show the error and offer an export); adding content (new decorations, trees, recipes) needs no migration unless the state shape changes. The camera is not in the save, so no migration ever touches it.
