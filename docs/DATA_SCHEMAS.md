# Data Schemas

This is the type contract for all content (`src/data/`) and the save state (`src/core/state.ts`, `src/core/save.ts`). It is written as TypeScript so it can be copied into code almost directly. The numbers live in `docs/BALANCE.md`; this document only defines shapes and ids.

Every id listed here also appears in the BALANCE.md tables and the GDD. If you add an id, add it in all three places. If code and this document disagree, fix one of them in the same PR and say so in `docs/PROGRESS.md`.

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
 * Before phase 07, 'farmLevel' is evaluated against the provisional formula in BALANCE.md §9.
 */
export type UnlockCondition =
  | { kind: 'farmLevel'; level: number }
  | { kind: 'skillLevel'; skill: SkillId; level: number }
  | { kind: 'expansion'; id: ExpansionId }
  | { kind: 'upgrade'; id: UpgradeId; level: number }
  | { kind: 'milestone'; id: MilestoneId }
  | { kind: 'bundle'; id: BundleId }
  | { kind: 'caught'; fish: FishId }
  | { kind: 'lifetimeGold'; amount: number };

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

Stage shown on screen: `stage = min(4, floor(5 * progress))` for a first growth, where `progress = growthMs / (growSec * 1000)`, and stage 4 means ready. After a regrow harvest, the regrow cycle maps its progress onto stages 2 → 4.

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

### 4.5 `BuffDef` (`buffs.ts`)

```ts
export interface BuffDef {
  type: BuffType;
  name: string;                 // 'Green Thumb', 'Silver Tongue', …
  description: string;          // "Crops grow {pct} faster."
  magnitudeScale: number;       // multiplies the tier magnitude (BALANCE.md §7)
  seam: keyof Modifiers;        // which modifier it drives
  icon: string;                 // sprite id
}
```

### 4.6 `UpgradeDef` (`upgrades.ts`)

```ts
export type UpgradeCategory = 'farm' | 'tools' | 'storage' | 'fishing' | 'kitchen';

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
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
}
```

The starting grid (4 × 2) is a constant, `START_GRID`, not an expansion.

### 4.9 Progression (`skills.ts`, `quests.ts`), phase 07

```ts
export interface SkillPerkDef {
  skill: SkillId;
  level: number;                 // 2..10
  text: string;                  // shown to the player
  effect: PerkEffect;
}

export type PerkEffect =
  | { kind: 'doubleHarvestChance'; chance: number }
  | { kind: 'growth'; bonus: number }
  | { kind: 'sellPrice'; bonus: number; category: ItemCategory }
  | { kind: 'reelZone'; mult: number }
  | { kind: 'fishingLuck'; bonus: number }
  | { kind: 'trapCapacity'; bonus: number }
  | { kind: 'cookSpeed'; bonus: number }
  | { kind: 'buffDuration'; bonus: number }
  | { kind: 'buffSlot'; count: number }
  | { kind: 'ingredientSaveChance'; chance: number };

/** Objectives are counted from events, never by scanning state (except 'reach*' kinds, which check state). */
export type QuestObjective =
  | { kind: 'plant'; crop?: CropId; count: number }
  | { kind: 'harvest'; crop?: CropId; count: number }
  | { kind: 'sell'; item?: ItemId; count: number }
  | { kind: 'earnGold'; amount: number; withinOneDay?: boolean }
  | { kind: 'ship'; count: number }
  | { kind: 'catch'; fish?: FishId; location?: FishLocationId; rarity?: Rarity; count: number }
  | { kind: 'cook'; recipe?: RecipeId; tier?: RecipeTier; distinct?: boolean; count: number }
  | { kind: 'eat'; count: number }
  | { kind: 'buyUpgrade'; id: UpgradeId; level?: number }
  | { kind: 'buyExpansion'; id: ExpansionId }
  | { kind: 'reachFarmLevel'; level: number }
  | { kind: 'completeBundle'; count: number };

export type QuestReward =
  | { kind: 'gold'; amount: number }
  | { kind: 'items'; items: readonly ItemStack[] }
  | { kind: 'recipe'; id: RecipeId }
  | { kind: 'xp'; skill: SkillId; amount: number };

/** Used for both the fixed milestone chain and goal-board templates. */
export interface QuestDef {
  id: MilestoneId | GoalTemplateId;
  kind: 'milestone' | 'goal';
  title: string;                         // may contain {crop}, {n}, … for goal templates
  flavor: string;                        // one warm line
  objective: QuestObjective;             // for goal templates, a pattern the generator fills in
  rewards: readonly QuestReward[];
  requires: readonly UnlockCondition[];  // goal templates are only drawn when these hold
}

export interface BundleDef {
  id: BundleId;
  name: string;
  slots: readonly ItemStack[];
  reward: BundleReward;
}

export type BundleReward =
  | { kind: 'unlockGreenhouse' }
  | { kind: 'buffSlot' }
  | { kind: 'inventorySlots'; count: number }
  | { kind: 'trapPerLocation'; count: number }
  | { kind: 'fishingLuck'; bonus: number }
  | { kind: 'goldenScarecrow' };
```

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
  xpModifier: number;               // × XP gained                  (phase 06 stub; used by 07)
  dishSellBonus: number;            // additive on dish prices      (season effect, phase 06)
  cookingXpBonus: number;           // additive on Cooking XP       (season effect, phase 07)
}

export const NO_MODIFIERS: Modifiers = {
  growthModifier: 1, sellPriceModifier: 1, fishingLuckModifier: 0, fishingSpeedModifier: 1,
  cookSpeedModifier: 1, automationSpeedModifier: 1, xpModifier: 1, dishSellBonus: 0, cookingXpBonus: 0,
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
    items: Partial<Record<ItemId, MarketItemState>>;
    specials: { item: ItemId; bonus: number }[];   // today's specials
    lastRolledDay: number;
  };
  shippingBin: { items: ItemStack[]; msToPickup: number };   // collected every 60 min of simulated time
  expansions: ExpansionId[];                       // bought, in order
  stats: Stats;                                    // @03, extended by later phases

  // ---- automation (@04)
  upgrades: Partial<Record<UpgradeId, number>>;    // level, or number owned for placeables
  placed: PlacedObject[];                          // sprinklers, scarecrows, fish traps (@05)
  autoSell: Partial<Record<ItemId, boolean>>;      // per-item toggle; default true for crops
  automation: { farmhandCooldownMs: number; farmhandTarget: number | null };
  lastPlantedCrop: (CropId | null)[];              // per plot, for the seed planter (index = plot index)

  // ---- fishing (@05)
  fishing: {
    unlocked: FishLocationId[];                    // ['pond'] at start
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
    skills: Record<SkillId, { xp: number; level: number }>;
    milestones: { done: MilestoneId[]; progress: number };   // progress toward the current milestone
    goals: ActiveGoal[];                                      // always 3
    bundles: Partial<Record<BundleId, ItemStack[]>>;          // donated so far
    completedBundles: BundleId[];
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
  id: number;                          // unique, monotonically increasing
  kind: 'sprinkler' | 'scarecrow' | 'golden_scarecrow' | 'fish_trap';
  at: { col: number; row: number } | { location: FishLocationId; slot: number };
}

export interface TrapState {
  placedId: number;
  progressMs: number;        // toward the next catch roll
  contents: ItemStack[];     // at most capacity items in total
}

export interface FishingSession {
  location: FishLocationId;
  phase: 'casting' | 'waiting' | 'bite' | 'reeling';
  fish: FishId | JunkId | null;        // decided when the bite happens
  biteInMs: number;
  reel: { marker: number; zoneCenter: number; zoneVel: number; meter: number } | null;
}

export interface CookJob { recipe: RecipeId; remainingMs: number }

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
}

export interface Stats {
  lifetimeGold: number;
  goldToday: number;
  cropsHarvested: number;
  itemsShipped: number;
  fishCaught: number;          // @05
  dishesCooked: number;        // @06
  dishesEaten: number;         // @06
  daysPassed: number;
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
  | { type: 'ate'; recipe: RecipeId; buff: BuffType }
  | { type: 'buffStarted' | 'buffExpired'; buff: BuffType }
  | { type: 'levelUp'; skill: SkillId; level: number }
  | { type: 'questDone'; id: MilestoneId | GoalTemplateId }
  | { type: 'unlocked'; what: string }
  | { type: 'notify'; text: string; tone: 'info' | 'good' | 'warn' };
```

Phases add event variants as they need them; adding a variant never needs a save migration.

---

## 8. `SaveFile` and migrations (`src/core/save.ts`)

```ts
export const SAVE_VERSION = 1;                 // phase 01 starts at 1; every GameState change bumps it
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
