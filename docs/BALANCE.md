# Balance: Formulas and Starting Numbers

Every number in `src/data/` comes from this file. Formulas are written as TypeScript-like expressions so they can be ported directly. The tables are **first drafts**: phase 03 tunes the economy, phases 04–07 add tuning notes for their systems, and phase 09 does the final pass with the simulator. When you change a number in code, change it here in the same PR.

Units follow `docs/DATA_SCHEMAS.md` §1: data durations are in **in-game minutes**, 1 in-game minute = 500 real ms, 1 in-game hour = 30 real s, 1 in-game day = 12 real minutes.

`roundNice(x)`: integers below 100 are rounded normally; from 100 up, rounded to 2 significant figures (`floor(x / 10^(d-2) + 0.5) * 10^(d-2)` where `d` is the number of digits). All costs and prices below use it unless stated otherwise.

---

## 1. Time and offline progress

```ts
GAME_MINUTE_MS = 500
GAME_DAY_MS    = 720_000                   // 12 real minutes
DAYS_PER_SEASON = 10                       // a season = 2 real hours
DAYS_PER_YEAR   = 40                       // a year = 8 real hours

gameMinutes  = floor(clock.totalMs / GAME_MINUTE_MS)
dayIndex     = floor(gameMinutes / 1440)                 // 0-based; day boundaries fall at 06:00
timeOfDay    = (6 * 60 + gameMinutes % 1440) % 1440       // minutes after midnight; a new save starts at 06:00
season       = SEASONS[floor(dayIndex / 10) % 4]
dayOfSeason  = dayIndex % 10 + 1
year         = floor(dayIndex / 40) + 1
```

Day/night (visual, and fish time windows): dawn 05:00–07:00, day 07:00–18:00, dusk 18:00–20:00, night 20:00–05:00.

**Offline progress.** `away = now - saveFile.savedAt` (real ms, clamped to ≥ 0).

```ts
OFFLINE_FULL_MS    = 8 * 3600_000      // first 8 real hours count fully
OFFLINE_REDUCED_MS = 16 * 3600_000     // the next 16 hours count at 25%
OFFLINE_REDUCED_RATE = 0.25
OFFLINE_MIN_MS     = 60_000            // under a minute: just simulate, no summary modal

simulatedMs = min(away, OFFLINE_FULL_MS)
            + OFFLINE_REDUCED_RATE * clamp(away - OFFLINE_FULL_MS, 0, OFFLINE_REDUCED_MS)
// max simulatedMs = 8h + 4h = 12h of game time (= 60 in-game days); anything past 24h away adds nothing
```

The simulation is advanced in segments that split at every **day boundary (06:00)**, **buff expiry**, **cook completion** and **season change**. Inside a segment, timers use closed-form maths (growth, demand recovery) or per-interval batches (farmhand visits, trap rolls). A hidden tab that becomes visible again uses the same path.

Performance budget (enforced by tests from phase 04): 8 h offline in < 100 ms, the 24 h+ capped case in < 300 ms.

---

## 2. Farming

### Growth

```ts
// per simulation step, for a planted, not-yet-ready plot
waterFactor   = plot.watered ? 1.0 : 0.5           // dry crops still grow, at half speed (never punishing)
plotBonus     = scarecrowBonusAt(plot)              // 0, 0.20 (scarecrow) or 0.30 (golden scarecrow); best one only
rate          = waterFactor * (mods.growthModifier + plotBonus)
plot.growthMs = min(needMs, plot.growthMs + Math.round(dtMs * rate))

needMs = (plot.harvests === 0 ? crop.growMinutes : crop.regrowMinutes) * GAME_MINUTE_MS
ready  = plot.growthMs >= needMs
```

- `watered` resets to `false` at 06:00 each day, then sprinklers water their area straight away (same instant).
- A crop that is planted out of season **cannot be planted** (the UI blocks it; the seed planter skips it). A crop that is still in the ground at 06:00 on the first day of a season that is not in its `seasons` list turns `dead`. Ready crops also wither, so harvest before the change. Greenhouse plots never wither.
- The shop and seed picker warn when a crop will not finish before the season ends (assuming watered growth).
- Yield per harvest: `rng.int(yield.min, yield.max)`, then `+1` with probability `doubleHarvestChance` (Farming perks).

### Crop profit formula

Crop prices are derived, not hand-picked. `u` is the crop's value tier (0–3, roughly "how late it unlocks").

```ts
profitRate(h, u) = 3.0 * (1 + 0.25 * log2(h / 4)) * (1 + 0.2 * u)   // gold per plot per in-game hour, watered
// single-harvest crops, growing h hours with average yield y:
gross     = profitRate(growH, u) * growH / 0.55
basePrice = round(gross / y)
seedPrice = roundNice(0.45 * gross)
// regrowing crops, regrow time r hours:
grossPerHarvest = profitRate(r, u) * r * 0.85        // slight discount: no replanting cost or clicks
basePrice       = round(grossPerHarvest / y)
seedPrice       = roundNice(2.2 * grossPerHarvest)
```

Longer crops earn a little more per hour (patience is rewarded), and later crops earn more (progression feels like progress). Regrowers are the "plant once, forget" option that suits idle play.

### Crop table (15 crops)

`u` values: turnip, potato, wheat, tomato, yam 0; garlic, strawberry, blueberry, kale, leek 1; cauliflower, corn, cranberry 2; melon, pumpkin 3. `XP/unit` is Farming XP per harvested unit (§8). `Profit/plot/h` is at 1× growth, watered, at demand 1.0.

| id | Name | Seasons | Grow (h / min) | Regrow (h / min) | Yield | Seed price | Base price | XP/unit | Farm Lv | Profit/plot/h |
|---|---|---|---|---|---|---|---|---|---|---|
| `turnip` | Turnip | spring | 4 / 240 | — | 1–1 | 10 | 22 | 3 | 1 | 3.00 |
| `potato` | Potato | spring | 8 / 480 | — | 1–2 | 25 | 36 | 4 | 1 | 3.62 |
| `garlic` | Garlic | winter, spring | 10 / 600 | — | 1–1 | 39 | 87 | 7 | 2 | 4.80 |
| `strawberry` | Strawberry | spring | 16 / 960 | 8 / 480 | 1–2 | 67 | 20 | 3 | 3 | 3.75 (regrow) |
| `cauliflower` | Cauliflower | spring | 20 / 1200 | — | 1–1 | 110 | 241 | 13 | 4 | 6.55 |
| `wheat` | Wheat | summer, autumn | 6 / 360 | — | 1–2 | 17 | 25 | 3 | 1 | 3.42 |
| `tomato` | Tomato | summer, autumn | 12 / 720 | 6 / 360 | 1–2 | 39 | 12 | 2 | 1 | 3.00 (regrow) |
| `blueberry` | Blueberry | summer | 20 / 1200 | 8 / 480 | 2–3 | 67 | 12 | 2 | 3 | 3.75 (regrow) |
| `corn` | Corn | summer, autumn | 24 / 1440 | 12 / 720 | 1–2 | 130 | 40 | 5 | 4 | 5.00 (regrow) |
| `melon` | Melon | summer | 36 / 2160 | — | 1–1 | 250 | 563 | 22 | 6 | 8.69 |
| `yam` | Yam | autumn | 14 / 840 | — | 1–1 | 50 | 111 | 8 | 1 | 4.36 |
| `kale` | Kale | autumn, winter | 10 / 600 | — | 1–1 | 39 | 87 | 7 | 2 | 4.80 |
| `cranberry` | Cranberry | autumn | 18 / 1080 | 8 / 480 | 2–3 | 79 | 14 | 2 | 4 | 4.38 (regrow) |
| `pumpkin` | Pumpkin | autumn | 40 / 2400 | — | 1–1 | 290 | 639 | 24 | 6 | 8.72 |
| `leek` | Leek | winter | 16 / 960 | — | 1–1 | 71 | 157 | 10 | 2 | 5.38 |

Spring, summer and autumn each have Farm Level 1 crops (spring: turnip, potato; summer: wheat, tomato; autumn: yam, wheat, tomato). Winter's crops (garlic, kale, leek) start at Farm Level 2, which a player reaches long before their first winter (day 31, about 6 real hours in), so winter is leaner and leans on fishing. Multi-season crops: garlic, wheat, tomato, corn, kale. Regrowers: strawberry, tomato, blueberry, corn, cranberry.

---

## 3. Economy and market

### Starting state

| Thing | Value |
|---|---|
| Gold | 60 |
| Plot grid | 4 × 2 = 8 plots, of which the left 4 start tilled |
| Seeds | 6 × `seed_turnip` |
| Inventory | 12 slots, stack size 99 |
| Date | Spring 1, Year 1, 06:00 |

### Price of one unit

```ts
unitPrice = max(1, floor(basePrice * demand * (1 + specialBonus) * mods.sellPriceModifier * channel))
channel   = 0.9   // Market panel: instant sale
          | 1.0   // Shipping Bin: paid at 06:00 at that morning's prices
```

When several units are sold at once, they are priced one at a time and demand drops after each unit, so the preview total is the exact sum.

### Demand

```ts
DEMAND_FLOOR = 0.5
DEMAND_CEIL  = 1.3
depth(item)  = clamp(round(60 * sqrt(20 / basePrice)), 8, 60)   // units that push demand from 1.0 to the floor
// after each unit sold:
demand = max(DEMAND_FLOOR, demand - 0.5 / depth(item))

// recovery, every step (exact for any dt, so offline steps are correct):
TAU_H = 8                                                        // in-game hours
target = restTarget(daysSinceSold)
demand = target + (demand - target) * exp(-dtGameHours / TAU_H)
demand = clamp(demand, DEMAND_FLOOR, DEMAND_CEIL)

restTarget(d) = d < 2 ? 1.0 : min(1.3, 1.0 + 0.1 * (d - 1))    // unsold for 4+ days: up to 1.3
// items never sold: target 1.0
```

Cheap bulk crops have deep markets (turnip depth 57), expensive items have shallow ones (pumpkin 11, moonfin 8). Growing one crop is never punished (the floor is half price and it recovers within a day), but rotating crops and resting a market pays up to +30%.

### Daily specials

At 06:00 each day: `n = 1 + rng.int(0, 2)` items are drawn without replacement from sellable items the player can currently obtain (in-season unlocked crops, fish at unlocked locations, known dishes). Each gets `bonus = 0.20 + 0.05 * rng.int(0, 6)` (so +20% to +50%). Specials last until the next 06:00.

### Market depth values (for reference)

turnip 57, potato 45, garlic 29, strawberry 60, cauliflower 17, wheat 54, tomato 60, blueberry 60, corn 42, melon 11, yam 25, kale 29, cranberry 60, pumpkin 11, leek 21; bluegill 49, carp 42, catfish 26, koi 15, trout 38, perch 40, salmon 23, sturgeon 13, sardine 45, mackerel 36, tuna 21, pufferfish 14, moonfin 8; seaweed 60, old_boot 60, driftwood 60. Dishes use the same formula with their base price.

---

## 4. Upgrade cost curves

```ts
// leveled upgrade: cost to go from level n to n+1
// placeable upgrade: cost of the (n+1)th unit when you own n
cost(n) = roundNice(base * ratio ** n)
```

| id | Category | Kind | Max | base | ratio | Costs | Requires |
|---|---|---|---|---|---|---|---|
| `sprinkler` | farm | placeable (on a plot) | 12 | 300 | 1.35 | 300, 410, 550, 740, 1000, 1300, 1800, 2500, 3300, 4500, 6000, 8100 | — |
| `sprinkler_tech` | farm | leveled | 2 | 2500 | 4.8 | 2500, 12000 | FL4; L2 needs FL7 |
| `scarecrow` | farm | placeable (on a plot) | 4 | 600 | 1.8 | 600, 1100, 1900, 3500 | expansion `farm_1` |
| `farmhand` | farm | leveled | 5 | 800 | 2.2 | 800, 1800, 3900, 8500, 19000 | FL3 |
| `seed_planter` | farm | leveled | 3 | 1200 | 2.5 | 1200, 3000, 7500 | `farmhand` L1 |
| `auto_seller` | farm | leveled | 2 | 1500 | 4.0 | 1500, 6000 | `farmhand` L1 |
| `watering_can` | tools | leveled | 3 | 400 | 5.0 | 400, 2000, 10000 | — |
| `hoe` | tools | leveled | 3 | 250 | 4.8 | 250, 1200, 5800 | — |
| `barn_storage` | storage | leveled | 4 | 1000 | 2.5 | 1000, 2500, 6300, 16000 | FL2 |
| `greenhouse` | farm | leveled | 2 | 25000 | 2.4 | 25000, 60000 | expansion `farm_3`, FL7, bundle `autumn_harvest` |
| `backpack` | storage | leveled | 4 | 200 | 2.2 | 200, 440, 970, 2100 | — |
| `fish_trap` | fishing | placeable (at water) | 6 | 500 | 1.5 | 500, 750, 1100, 1700, 2500, 3800 | 2 per unlocked location (+1 each with bundle `pond_fish`) |
| `fishing_rod` | fishing | leveled | 3 | 300 | 8.0 | 300, 2400, 19000 | — ; L3 needs `ocean` |
| `trap_collector` | fishing | leveled | 1 | 4000 | 1 | 4000 | `fish_trap` owned ≥ 2 |
| `kitchen` | kitchen | leveled | 3 | 1000 | 3.5 | 1000, 3500, 12000 | — |

Until phase 07 exists, `bundle` conditions evaluate as **met** (bundles are not in the game yet) and `farmLevel` conditions use the provisional formula in §9.

### Upgrade effects

| id | Level / unit effects |
|---|---|
| `sprinkler` | Each unit occupies one plot and waters its area at 06:00. Area is set by `sprinkler_tech`. |
| `sprinkler_tech` | L0 Basic: plus shape, radius 1 (4 plots). L1 Quality: square radius 1 (8 plots). L2 Iridium: square radius 2 (24 plots). |
| `scarecrow` | Each unit occupies one plot. Plots within square radius 2 get `+0.20` growth. Overlaps do not stack. |
| `farmhand` | Every `interval` in-game minutes, harvests up to `capacity` ready plots (oldest-ready first). L1 60 min / 6, L2 45 / 9, L3 34 / 12, L4 25 / 16, L5 19 / 20. |
| `seed_planter` | Acts right after each farmhand visit, with the same capacity. L1 `replantHarvested` (replants the plot's last crop if a seed is in inventory and it is in season). L2 + `plantEmpty` (tilled empty plots get the last crop, else the highest-value in-season seed in inventory). L3 + `autoTill` (clears dead crops and tills untilled plots). |
| `auto_seller` | L1 `autoShip`: automated harvests (and manual ones, if the per-item toggle is on) go to the Shipping Bin instead of the inventory. L2 `keepReserve`: keeps up to 10 of each item in the inventory for cooking and ships the rest. |
| `watering_can` | Tiles per click: base 1, Copper 3 (a 1 × 3 row), Iron 9 (3 × 3), Gold 25 (5 × 5). |
| `hoe` | Same areas as the watering can, for tilling and clearing dead crops. |
| `barn_storage` | Stack size: 99 → 199 → 299 → 499 → 999. |
| `greenhouse` | L1: 6 greenhouse plots (3 × 2) that ignore seasons and are always watered. L2: 12 plots (4 × 3). |
| `backpack` | Inventory slots: 12 → 16 → 20 → 24 → 28. |
| `fish_trap` | Rolls one catch every 360 in-game minutes (6 h), holds up to 5 items. Pool: common + uncommon fish and junk at its location. |
| `fishing_rod` | Starter "Old Rod" L0: zone ×1.00, luck 0. Bamboo L1: ×1.10, +0.05. Fiberglass L2: ×1.20, +0.15. Iridium L3: ×1.35, +0.30. |
| `trap_collector` | `autoCollect`: at 06:00 each trap is emptied into the inventory (or the Shipping Bin if auto-sell is on for that item). |
| `kitchen` | Old Hearth L0: 1 queue slot, +0 speed. Stove L1: 2 slots, +0.15. Oven L2: 3 slots, +0.30. Pro Kitchen L3: 4 slots, +0.50. |

### Automation throughput

```ts
farmhandVisitsPerHour = 60 * mods.automationSpeedModifier / intervalMinutes
plotsPerHour          = farmhandVisitsPerHour * capacity
// L1: 6/h, L2: 12/h, L3: ~21/h, L4: ~38/h, L5: ~63/h
// a farm is "fully automated" when plotsPerHour ≥ plots / avgGrowHours of what is planted,
// and every plot is covered by a sprinkler (or is a greenhouse plot)
```

The farmhand cooldown counts down in simulated time. Offline, visits are batched: `visits = floor((cooldownElapsed + dtMs) / intervalMs)`, each visit processed in order, so large and small steps match exactly.

If the inventory is full during an automated harvest, the crop **stays ready in the plot** (nothing is lost), the farmhand skips that plot, and one `inventoryFull` event is emitted per day. Auto-shipped items never need inventory space.

---

## 5. Expansions

`price(n) = roundNice(400 * 3.7 ** n)` for the farm steps.

| id | Name | Kind | Price | Grid after / location | Requires | Scene change |
|---|---|---|---|---|---|---|
| `farm_1` | Clear the Weeds | farm | 400 | 4 × 3 (12 plots) | — | weeds and a stump south of the plots disappear; fence moves down 1 tile |
| `farm_2` | Mend the Fence | farm | 1500 | 5 × 4 (20 plots) | `farm_1` | fence rebuilt 1 tile east and south; a path gains stepping stones |
| `farm_3` | Old Orchard Plot | farm | 5500 | 6 × 5 (30 plots) | `farm_2`, FL3 | two trees removed; the greenhouse lot is revealed |
| `farm_4` | The Back Forty | farm | 20000 | 8 × 6 (48 plots) | `farm_3`, FL6 | fence reaches the scene edge; a scarecrow post decoration appears |
| `river` | River Access | fishing | 2000 | location `river` | FL3 | a river is shown along the bottom edge with a small bridge |
| `ocean` | Old Dock | fishing | 8000 | location `ocean` | `river`, FL6 | a wooden dock and sea tiles appear in the bottom-right corner |

---

## 6. Fishing

### Fish table (13 fish + 3 junk)

`Hours` is the bite window on the 24 h clock (wraps past midnight). `Trap` = can come from traps.

| id | Name | Location | Seasons | Hours | Rarity | Difficulty | Size (cm) | Base price | Trap |
|---|---|---|---|---|---|---|---|---|---|
| `bluegill` | Bluegill | pond | all | 0–24 | common | 15 | 10–25 | 30 | yes |
| `carp` | Carp | pond | spring, summer, autumn | 0–24 | common | 25 | 30–70 | 40 | yes |
| `catfish` | Catfish | pond | spring, summer, autumn | 20–6 | uncommon | 45 | 40–110 | 110 | yes |
| `koi` | Koi | pond | spring, summer | 9–17 | rare | 65 | 30–60 | 300 | no |
| `trout` | Trout | river | spring, summer, autumn | 6–20 | common | 30 | 25–60 | 50 | yes |
| `perch` | Perch | river | autumn, winter, spring | 0–24 | common | 25 | 15–35 | 45 | yes |
| `salmon` | Salmon | river | autumn | 0–24 | uncommon | 50 | 50–100 | 140 | yes |
| `sturgeon` | Sturgeon | river | summer, winter | 6–18 | rare | 75 | 90–200 | 420 | no |
| `sardine` | Sardine | ocean | all | 0–24 | common | 20 | 10–20 | 35 | yes |
| `mackerel` | Mackerel | ocean | spring, summer, autumn | 6–20 | common | 35 | 25–45 | 55 | yes |
| `tuna` | Tuna | ocean | summer, winter | 6–20 | uncommon | 60 | 60–180 | 160 | yes |
| `pufferfish` | Pufferfish | ocean | summer | 12–16 | rare | 70 | 15–35 | 380 | no |
| `moonfin` | Moonfin | ocean | winter | 22–4 | legendary | 90 | 70–140 | 1500 | no |
| `old_boot` | Old Boot | all | all | — | junk | — | — | 5 | yes |
| `seaweed` | Seaweed | pond, ocean | all | — | junk | — | — | 20 | yes |
| `driftwood` | Driftwood | river, ocean | all | — | junk | — | — | 8 | yes |

Every location has at least one common fish in every season, so fishing never comes up empty.

### Catch selection

```ts
RARITY_WEIGHT = { common: 60, uncommon: 25, rare: 8, legendary: 2 }
LUCK_SCALE    = { common: -0.3, uncommon: 0.5, rare: 1.5, legendary: 2.5 }
JUNK_WEIGHT   = { active: 10, trap: 25 }       // per junk item eligible at the location

luck = mods.fishingLuckModifier                 // rod + buff + perks + bundle, additive; 0 at start
weight(fish) = RARITY_WEIGHT[r] * max(0.3, 1 + luck * LUCK_SCALE[r])
pool = fish at location, in season, inside hours window (traps: trappable only)  + junk at location
pick = rng.weighted(pool, weight)
sizeCm = min + (max - min) * rng.float() ** 1.5   // big ones are rarer; size only affects the collection log
```

Worked example, active fishing at the pond, summer, 12:00, luck 0: bluegill 60, carp 60, koi 8, seaweed 10, old boot 10 (catfish is night-only) → bluegill 40.5%, carp 40.5%, koi 5.4%, seaweed 6.8%, old boot 6.8%. With luck 1.0 the commons drop to 42 each and koi rises to 20, so koi becomes about 16%, roughly three times as likely.

### Active fishing

```ts
biteWaitMs   = rng.range(3000, 10000) / mods.fishingSpeedModifier     // REAL ms, not game time
castPower ≥ 0.8  → uncommon+ weights ×1.15 (a small reward for a good cast)

// reel minigame, positions are fractions of the bar (0..1), times in real seconds
zoneWidth = (0.35 - 0.20 * difficulty / 100) * rodZoneMult * perkZoneMult * (relaxed ? 1.5 : 1)
zoneSpeed = (0.15 + 0.50 * difficulty / 100) * (relaxed ? 0.6 : 1)    // bar-widths per second, direction changes randomly
meterFill  = 0.35 per s while the marker is inside the zone
meterDrain = 0.15 per s outside (relaxed: 0.075)
meterStart = 0.30; caught at 1.0; escapes at 0.0  (no penalty beyond losing the fish)
```

Active fishing runs in real time; the rest of the game keeps ticking while you fish. The simulator models it as "3 catches per real minute while actively fishing".

### Traps

```ts
TRAP_INTERVAL_MIN = 360           // one roll every 6 in-game hours (3 real minutes)
TRAP_CAPACITY     = 5 (+ perks)
rolls = floor((trap.progressMs + dtMs * mods.fishingSpeedModifier) / (TRAP_INTERVAL_MIN * GAME_MINUTE_MS))
// each roll adds one item if the trap has space; a full trap stops rolling (progress is kept at the threshold)
```

---

## 7. Cooking and buffs

### Recipe tier

```ts
units = sum of ingredient quantities
value = sum of qty * items[ingredient].basePrice
score = units + value / 50 + cookMinutes / 60
tier  = score >= 28 ? 4 : score >= 15 ? 3 : score >= 8 ? 2 : 1
```

Tier rises with how many things go in, how valuable they are, and how long the dish takes. The declared `tier` in data must match `recipeTier()`; a test checks every recipe, so if a price change moves a recipe across a threshold, either retune the recipe or accept the new tier and update this table.

### Dish price

```ts
TIER_SELL_MULT = { 1: 1.25, 2: 1.40, 3: 1.60, 4: 2.00 }
dish.basePrice = round(value * TIER_SELL_MULT[tier])
cookMs         = cookMinutes * GAME_MINUTE_MS / mods.cookSpeedModifier
```

### Buff magnitude and duration

```ts
magnitude    = 0.10 * tier * buffs[type].magnitudeScale
durationMs   = 720 * 2 ** (tier - 1) * GAME_MINUTE_MS * (1 + buffDurationPerk)
// T1: 12 in-game hours (6 real min) · T2: 24 h (12 min) · T3: 48 h (24 min) · T4: 96 h (48 min)
```

| Buff type | Name | Seam | magnitudeScale | T1 | T2 | T3 | T4 |
|---|---|---|---|---|---|---|---|
| `growth` | Green Thumb | `growthModifier` | 1.0 | +10% | +20% | +30% | +40% |
| `sellPrice` | Silver Tongue | `sellPriceModifier` | 0.5 | +5% | +10% | +15% | +20% |
| `fishingLuck` | Angler's Luck | `fishingLuckModifier` (additive luck) | 1.0 | +0.10 | +0.20 | +0.30 | +0.40 |
| `fishingSpeed` | Quick Bite | `fishingSpeedModifier` | 1.0 | +10% | +20% | +30% | +40% |
| `cookSpeed` | Quick Hands | `cookSpeedModifier` | 1.5 | +15% | +30% | +45% | +60% |
| `automationSpeed` | Busy Bees | `automationSpeedModifier` | 1.0 | +10% | +20% | +30% | +40% |
| `xp` | Scholar's Snack | `xpModifier` | 1.5 | +15% | +30% | +45% | +60% |

### Stacking

```ts
BASE_BUFF_SLOTS = 2        // +1 from Cooking level 7, +1 from bundle cozy_dinner → max 4
eat(dish):
  existing = active buff of the same type
  if existing:
      existing.magnitude   = max(existing.magnitude, new.magnitude)      // stronger replaces
      existing.remainingMs = max(existing.remainingMs, new.durationMs)   // never shortens
  else if active.length < slots:
      add new buff
  else:
      UI asks to confirm replacing the buff with the least remaining time; if confirmed, replace it
```

Buffs count down in simulated time. Offline, the step is split at each expiry so a buff only affects the time it was active.

### Recipe table (22 recipes: 6 × T1, 7 × T2, 5 × T3, 4 × T4)

`Magnitude` is already multiplied by the buff's `magnitudeScale` (luck is shown as a percentage of 1.0 luck). "card N" = a recipe card bought in the Shop for N gold once the condition holds. Starter recipes are known in a new save.

| id | Name | Ingredients | Cook (min) | Units | Value | Score | Tier | Base price | Buff | Magnitude | Duration (h) | Discovery |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `roasted_turnip` | Roasted Turnip | turnip ×2 | 60 | 2 | 44 | 3.88 | T1 | 55 | `growth` | +10% | 12 | starter |
| `baked_potato` | Baked Potato | potato ×2 | 60 | 2 | 72 | 4.44 | T1 | 90 | `cookSpeed` | +15% | 12 | starter |
| `grilled_bluegill` | Grilled Bluegill | bluegill ×1 | 60 | 1 | 30 | 2.60 | T1 | 38 | `fishingSpeed` | +10% | 12 | starter |
| `berry_bowl` | Berry Bowl | strawberry ×2 | 30 | 2 | 40 | 3.30 | T1 | 50 | `xp` | +15% | 12 | card 150 · FL2 |
| `seaweed_salad` | Seaweed Salad | seaweed ×2, turnip ×1 | 30 | 3 | 62 | 4.74 | T1 | 78 | `fishingLuck` | +10% | 12 | milestone `m06_first_catch` |
| `wheat_flatbread` | Wheat Flatbread | wheat ×3 | 90 | 3 | 75 | 6.00 | T1 | 94 | `automationSpeed` | +10% | 12 | card 120 · FL1 |
| `vegetable_soup` | Vegetable Soup | turnip ×2, potato ×1, kale ×1 | 120 | 4 | 167 | 9.34 | T2 | 234 | `growth` | +20% | 24 | milestone `m07_first_dish` |
| `fish_tacos` | Fish Tacos | wheat ×2, tomato ×2, sardine ×1 | 120 | 5 | 109 | 9.18 | T2 | 153 | `fishingSpeed` | +20% | 24 | card 600 · expansion `ocean` |
| `tomato_pasta` | Tomato Pasta | wheat ×2, tomato ×3, garlic ×1 | 120 | 6 | 173 | 11.46 | T2 | 242 | `cookSpeed` | +30% | 24 | card 500 · FL3 |
| `corn_chowder` | Corn Chowder | corn ×2, potato ×1, perch ×1 | 150 | 4 | 161 | 9.72 | T2 | 225 | `automationSpeed` | +20% | 24 | experiment |
| `blueberry_muffin` | Blueberry Muffin | wheat ×2, blueberry ×4 | 120 | 6 | 98 | 9.96 | T2 | 137 | `xp` | +30% | 24 | card 450 · FL3 |
| `glazed_yams` | Glazed Yams | yam ×2, cranberry ×2 | 90 | 4 | 250 | 10.50 | T2 | 350 | `sellPrice` | +10% | 24 | experiment |
| `garlic_trout` | Garlic Trout | trout ×1, garlic ×1, leek ×1 | 120 | 3 | 294 | 10.88 | T2 | 412 | `fishingLuck` | +20% | 24 | milestone `m10_unlock_river` |
| `seafood_stew` | Seafood Stew | tuna ×1, salmon ×1, tomato ×2, potato ×1 | 240 | 5 | 360 | 16.20 | T3 | 576 | `fishingLuck` | +30% | 48 | card 2500 · expansion `ocean` |
| `pumpkin_soup` | Pumpkin Soup | pumpkin ×1, leek ×1, garlic ×1 | 240 | 3 | 883 | 24.66 | T3 | 1413 | `growth` | +30% | 48 | card 2000 · FL6 |
| `cranberry_pie` | Cranberry Pie | wheat ×3, cranberry ×4, strawberry ×2 | 240 | 9 | 171 | 16.42 | T3 | 274 | `sellPrice` | +15% | 48 | experiment |
| `catfish_gumbo` | Catfish Gumbo | catfish ×2, corn ×1, tomato ×2, garlic ×1 | 240 | 6 | 371 | 17.42 | T3 | 594 | `automationSpeed` | +30% | 48 | card 1800 · FL5 |
| `scholars_stew` | Scholar's Stew | kale ×2, leek ×1, carp ×2 | 240 | 5 | 411 | 17.22 | T3 | 658 | `xp` | +45% | 48 | milestone `m11_farm_level_5` |
| `harvest_feast` | Harvest Feast | pumpkin ×1, cauliflower ×1, corn ×2, yam ×2, wheat ×2 | 480 | 8 | 1232 | 40.64 | T4 | 2464 | `sellPrice` | +20% | 96 | milestone `m12_cook_t3` |
| `royal_sturgeon` | Royal Sturgeon | sturgeon ×1, koi ×1, leek ×1, garlic ×1 | 480 | 4 | 964 | 31.28 | T4 | 1928 | `fishingLuck` | +40% | 96 | experiment |
| `moonfin_sushi` | Moonfin Sushi | moonfin ×1, seaweed ×3, wheat ×2 | 360 | 6 | 1610 | 44.20 | T4 | 3220 | `xp` | +60% | 96 | card 12000 · caught `moonfin` |
| `melon_sorbet_tower` | Melon Sorbet Tower | melon ×2, strawberry ×4, blueberry ×4 | 360 | 10 | 1254 | 41.08 | T4 | 2508 | `cookSpeed` | +60% | 96 | card 8000 · FL8 |

Buff coverage: growth 3, sellPrice 3, fishingLuck 4, fishingSpeed 2, cookSpeed 3, automationSpeed 3, xp 4.

**Experiment mode:** the player picks 2–4 distinct ingredients. If the set of ingredient ids equals an unknown `experiment` or `card` recipe's ingredient ids (quantities ignored), that recipe is learned and nothing is consumed. Otherwise nothing is consumed and a hint names one ingredient of a still-unknown experiment recipe that shares at least one of the chosen items.

---

## 8. XP and levels

```ts
MAX_SKILL_LEVEL = 10
xpToNext(L) = round(40 * 1.6 ** (L - 1))            // L = 1..9
// 40, 64, 102, 164, 262, 419, 671, 1074, 1718 → 4514 total to reach level 10
// cumulative to reach level 2..10: 40, 104, 206, 370, 632, 1051, 1722, 2796, 4514

farmingXp(unit)  = max(1, round(crop.basePrice ** 0.6 / 2))                 // per harvested unit (table in §2)
fishingXp(catch) = { common: 6, uncommon: 14, rare: 30, legendary: 100 }[rarity] + floor(difficulty / 10)
                   // junk: 2; trap catches give floor(50%)
cookingXp(dish)  = round(8 * tier ** 1.5)                                    // 8, 23, 42, 64
xpGained = round(baseXp * mods.xpModifier)
```

### Skill perks

| Level | Farming | Fishing | Cooking |
|---|---|---|---|
| 2 | +5% crop sell price | +5% reel zone | +10% cook speed |
| 3 | +5% growth | +0.05 luck | dish sell price +5% |
| 4 | 5% double-harvest chance | trap capacity +1 | +10% buff duration |
| 5 | +5% growth | +10% reel zone | 10% chance to save one ingredient |
| 6 | +5% crop sell price | +0.10 luck | +10% cook speed |
| 7 | 10% double-harvest chance (total) | trap capacity +2 (total) | **+1 buff slot** |
| 8 | +5% growth | +10% reel zone | +20% buff duration (total) |
| 9 | +5% crop sell price | +0.15 luck | dish sell price +10% (total) |
| 10 | 15% double-harvest chance (total) | fish sell price +10% | 20% ingredient-save chance (total) |

### Farm Level

```ts
farmPoints = (farming.level + fishing.level + cooking.level - 3) + milestonesDone
farmLevel  = min(20, 1 + floor(farmPoints / 2))
```

---

## 9. Unlock gating

| Farm Level | Unlocks |
|---|---|
| 1 | turnip, potato, wheat, tomato, yam seeds; `wheat_flatbread` card; sprinkler, hoe, watering can, backpack, kitchen, fishing rod |
| 2 | garlic, kale, leek seeds; `berry_bowl` card; barn storage |
| 3 | strawberry, blueberry seeds; farmhand; `river`; `farm_3`; `tomato_pasta`, `blueberry_muffin` cards |
| 4 | cauliflower, corn, cranberry seeds; `sprinkler_tech` L1 |
| 5 | `catfish_gumbo` card |
| 6 | melon, pumpkin seeds; `ocean`; `farm_4`; `pumpkin_soup` card |
| 7 | `sprinkler_tech` L2; greenhouse |
| 8 | `melon_sorbet_tower` card |

**Provisional farm level (phases 02–06, before skills exist):**

```ts
provisionalFarmLevel = 1 + floor(log2(1 + stats.lifetimeGold / 300))
// lifetime gold 300 → 2, 900 → 3, 2100 → 4, 4500 → 5, 9300 → 6, 18900 → 7, 38100 → 8
```

Phase 07 replaces it with the real formula in §8 and its migration must never lower the level a player already sees (take `max(provisional, real)` for existing saves until the real level catches up, and record that in the save).

---

## 10. Progression content

### Milestone chain (15)

| id | Objective | Reward |
|---|---|---|
| `m01_first_seed` | Plant a seed | 5 × `seed_turnip` |
| `m02_first_harvest` | Harvest a crop | 25 gold |
| `m03_first_sale` | Sell anything | 50 gold |
| `m04_first_expansion` | Buy `farm_1` | 3 × `seed_potato` |
| `m05_first_sprinkler` | Place a sprinkler | 100 gold |
| `m06_first_catch` | Catch a fish | recipe `seaweed_salad` |
| `m07_first_dish` | Cook any dish | recipe `vegetable_soup` |
| `m08_first_buff` | Eat a dish | 150 gold |
| `m09_hire_farmhand` | Buy `farmhand` L1 | 300 gold |
| `m10_unlock_river` | Buy `river` | recipe `garlic_trout` |
| `m11_farm_level_5` | Reach Farm Level 5 | recipe `scholars_stew` |
| `m12_cook_t3` | Cook a T3 dish | recipe `harvest_feast` |
| `m13_unlock_ocean` | Buy `ocean` | 1000 gold |
| `m14_first_bundle` | Complete a bundle | 1500 gold |
| `m15_greenhouse` | Build the greenhouse | 5000 gold |

### Goal board templates

Three goals are active at once. The generator picks a template whose `requires` holds, fills in an item the player can obtain now, and sizes the target so it takes about 5–15 real minutes at the player's current rate.

```ts
goalGoldReward = roundNice(max(50, 0.25 * estimatedGoldPerRealMinute * 10))
```

| Template | Example | Requires |
|---|---|---|
| `harvest_crop` | Harvest 20 turnips | — |
| `harvest_any` | Harvest 40 crops | — |
| `earn_gold_day` | Earn 500 gold in one day | first sale |
| `ship_items` | Ship 30 items | first sale |
| `catch_fish` | Catch 5 fish at the river | a fishing location |
| `catch_rarity` | Catch an uncommon fish | 5 fish caught |
| `cook_tier` | Cook 3 T2 dishes | a known T2 recipe |
| `cook_distinct` | Cook 3 different dishes | 3 known recipes |
| `eat_dish` | Eat 2 dishes | a known recipe |

### Bundles (Community Board)

| id | Slots | Reward |
|---|---|---|
| `spring_crops` | turnip ×10, potato ×10, strawberry ×5, cauliflower ×2 | golden scarecrow (radius 3, +0.30 growth) |
| `summer_crops` | tomato ×10, blueberry ×10, corn ×5, melon ×1 | +4 inventory slots |
| `autumn_harvest` | yam ×5, cranberry ×10, pumpkin ×2, wheat ×20 | unlocks the greenhouse |
| `pond_fish` | bluegill ×5, carp ×5, catfish ×2, koi ×1 | +1 fish trap per location |
| `river_and_sea` | trout ×3, salmon ×2, sardine ×5, tuna ×1 | +0.10 fishing luck, permanent |
| `cozy_dinner` | roasted_turnip ×2, vegetable_soup ×1, fish_tacos ×1, seafood_stew ×1 | +1 buff slot |

---

## 11. Pacing targets

Times are real time for a player who is actively playing, unless noted. Phase 09's simulator checks all of them.

| Moment | Target |
|---|---|
| First harvest | ≤ 2.5 min |
| Longest wait with nothing useful to do, first 30 min | ≤ 2 min |
| First expansion (`farm_1`) | 6–10 min |
| First automation (first sprinkler) | 10–15 min |
| Farmhand L1 | 25–40 min |
| River unlocked | 45–75 min |
| First T2 dish cooked | 45–90 min |
| First T3 dish cooked | 2–3 h |
| First T4 dish cooked | 3–5 h (active + idle combined) |
| Whole farm automated (farmhand L3, planter L2, auto-seller, all plots sprinkled) | 4–6 h |
| Greenhouse | 8–12 h |
| Farm Level 10 | 10–15 h |
| Casual idler (2 min every 4 h) | reaches ≥ 40% of the active player's lifetime gold after 3 real days |
| Food buffs kept up | 10–25% faster progression, never required |
| Late game gold/hour | grows roughly linearly with upgrades, never more than ~3× per real hour of play |

Early-game sanity check (by hand): 8 turnip plots watered earn about `8 * 3 = 24` gold profit per in-game hour, which is about 48 gold per real minute of active play before market drop. That puts `farm_1` (400) at ~8 minutes and the first sprinkler (300) soon after, inside the targets.

---

## 12. Tuning notes

Each phase that tunes numbers adds a dated subsection here: what changed, why, and the simulation evidence.

### Phase 00 notes
- All crop prices come from `profitRate`. If a crop feels wrong, change its `u`, grow time or yield, not its price directly, so the table stays consistent.
- Seed prices such as 39 and 67 are formula outputs; phase 03 may snap them to friendlier numbers if it keeps profit/hour within ±5%.
- The provisional farm level (§9) is deliberately generous so phases 02–06 can be playtested without progression.
