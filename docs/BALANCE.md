# Balance: Formulas and Starting Numbers

Every number in `src/data/` comes from this file. Formulas are written as TypeScript-like expressions so they can be ported directly. The tables are **first drafts**: phase 03 tunes the economy, phases 04–07 add tuning notes for their systems, and phase 09 does the final pass with the simulator. When you change a number in code, change it here in the same PR.

Units follow `docs/DATA_SCHEMAS.md` §1. There are **two clocks**. The **calendar** (time of day, day, season) follows the player's real local clock. **Timers** (growth, cooking, buffs, traps, the farmhand, the shipping bin) run on **simulated time**, which is real time while playing and a capped amount while away. Data durations are in **real seconds** of simulated time.

`roundNice(x)`: integers below 100 are rounded normally; from 100 up, rounded to 2 significant figures (`floor(x / 10^(d-2) + 0.5) * 10^(d-2)` where `d` is the number of digits). All costs and prices below use it unless stated otherwise.

---

## 1. Time and offline progress

### Calendar (real local time)

```ts
// computed in src/core/time.ts from an injected `now` and the local time zone; systems receive it as ctx.calendar
hour, minute, weekday     = local wall-clock parts of now
isNight                   = hour >= 20 || hour < 6
dayKey                    = local date of (now - 6h)          // a "day" runs 06:00 → 06:00 local
localDay(t)               = whole local calendar days since 1970-01-01 (DST-safe; built from local Y/M/D)

// seasons change at local Saturday → Sunday midnight, counted from the save's creation
firstSunday   = the first local Sunday 00:00 after createdAt
seasonEpoch   = (firstSunday - createdAt < 3 days) ? firstSunday + 7 days : firstSunday
weekIndex     = now < seasonEpoch ? 0 : floor((localDay(now) - localDay(seasonEpoch)) / 7) + 1
weekIndex     = max(weekIndex, state.calendar.maxWeekIndex)  // never goes backwards (clock set back)
season        = SEASONS[weekIndex % 4]                        // every save starts in spring
year          = floor(weekIndex / 4) + 1
```

A new save always starts in **spring**, and the first spring lasts at least 3 real days (up to 10). After that each season is one real week (Sunday–Saturday) and a year is 4 weeks.

HUD format: `Spring · Year 1 · Tue 9:40 PM`.

Day/night visuals: dawn 06:00–07:30, day 07:30–18:30, dusk 18:30–20:00, night 20:00–06:00.

**Calendar events** (fired by the core when a boundary is crossed, including while away):
- **Daily, 06:00 local:** roll market specials, record a market-history point, reset `goldToday` and per-day goal counters, `daysPassed += 1`. If several days passed while away, these fire **once** (the latest day).
- **Weekly, Sunday 00:00 local (season change):** crops that cannot grow in the new season wither (greenhouse excepted). If several season changes passed while away, each one is applied in order (withering is idempotent, so at most 4 need processing).

Clock tampering: if `now` is earlier than `meta.lastSavedAt`, away time is 0, no calendar events fire, and the week index is held at `maxWeekIndex`. Moving the clock forward is limited by the offline cap below, although the calendar does jump.

### Simulated time

```ts
TICK_MS = 100                              // fixed simulation step while playing
clock.simMs                                // integer ms of simulated time since the save was created
```

### Offline progress

`away = max(0, now - saveFile.savedAt)` in real ms.

```ts
OFFLINE_FULL_MS      = 8 * 3600_000        // the first 8 real hours count fully
OFFLINE_REDUCED_MS   = 16 * 3600_000       // the next 16 hours count at 25%
OFFLINE_REDUCED_RATE = 0.25
OFFLINE_MIN_MS       = 60_000              // under a minute: just simulate, no summary modal

rate(t) = t < 8h ? 1 : t < 24h ? 0.25 : 0          // t = real time since leaving
simulatedMs = ∫ rate(t) dt over [0, away]          // max 8h + 4h = 12h of simulated time
```

The offline pass walks the **real** timeline from `savedAt` to `now` in segments. A segment ends at every calendar event (06:00 daily, Sunday 00:00 season change) and at every simulated-time event (buff expiry, cook completion). For each segment it advances simulated time by `∫ rate`, using closed-form maths (growth, demand recovery) or per-interval batches (farmhand, traps, bin pickups). So a crop that would wither at Sunday midnight grows only until then, and a buff that expires two hours in only helps for those two hours. Segments with `rate = 0` only process calendar events, which keeps a 30-day absence cheap.

Performance budget (enforced by tests from phase 04): 8 h offline in < 100 ms, a 30-day absence in < 300 ms.

---

## 2. Farming

### Growth

```ts
// per simulation step, for a planted, not-yet-ready plot
WATER_DURATION_MS = 2 * 3600_000                    // one watering lasts 2 hours of simulated time
isWatered   = coveredBySprinkler(plot) || inGreenhouse(plot) || plot.waterMsLeft > 0
waterFactor = isWatered ? 1.0 : 0.5                  // dry crops still grow, at half speed (never punishing)
plotBonus   = scarecrowBonusAt(plot)                 // 0, 0.20 (scarecrow) or 0.30 (golden scarecrow); best one only
rate        = waterFactor * (mods.growthModifier + plotBonus)
plot.growthMs   = min(needMs, plot.growthMs + Math.round(dtMs * rate))
plot.waterMsLeft = max(0, plot.waterMsLeft - dtMs)

needMs = (plot.harvests === 0 ? crop.growSec : crop.regrowSec) * 1000
ready  = plot.growthMs >= needMs
```

- Watering sets `waterMsLeft = WATER_DURATION_MS`. Plots covered by a sprinkler are **always watered**, so there is no sprinkler timer to simulate. Offline, a hand-watered plot is exact: full speed until `waterMsLeft` runs out, then half speed.
- A crop that is out of season **cannot be planted** (the UI blocks it; the seed planter skips it). At a season change, any crop in the ground whose `seasons` list does not include the new season turns `dead`. Ready crops also wither, so harvest before Sunday midnight. Greenhouse plots never wither.
- The shop and seed picker warn when a crop will not finish before the season changes (assuming watered growth). The HUD shows "Season changes in 2d 4h" during the last two days.
- Yield per harvest: `rng.int(yield.min, yield.max)`, then `+1` with probability `doubleHarvestChance` (Farming perks).

### Crop profit formula

Crop prices are derived, not hand-picked. `u` is the crop's value tier (0–3, roughly "how late it unlocks"). `m` is minutes of simulated time.

```ts
profitRate(m, u) = 6.0 * (1 + 0.25 * log2(m / 2)) * (1 + 0.2 * u)   // gold per plot per minute, watered
// single-harvest crops, growing m minutes with average yield y:
gross     = profitRate(growMin, u) * growMin / 0.55
basePrice = round(gross / y)
seedPrice = roundNice(0.45 * gross)
// regrowing crops, regrow time r minutes:
grossPerHarvest = profitRate(r, u) * r * 0.85        // slight discount: no replanting cost or clicks
basePrice       = round(grossPerHarvest / y)
seedPrice       = roundNice(2.2 * grossPerHarvest)
```

Longer crops earn a little more per minute (patience is rewarded), and later crops earn more (progression feels like progress). Regrowers are the "plant once, forget" option that suits idle play.

### Crop table (15 crops)

`u` values: turnip, potato, wheat, tomato, yam 0; garlic, strawberry, blueberry, kale, leek 1; cauliflower, corn, cranberry 2; melon, pumpkin 3. Durations are simulated time, stored in data as seconds (`growSec`, `regrowSec`). `XP/unit` is Farming XP per harvested unit (§8). `Profit/plot/min` is at 1× growth, watered, at demand 1.0.

| id | Name | Seasons | Grow (s / min) | Regrow (s / min) | Yield | Seed price | Base price | XP/unit | Farm Lv | Profit/plot/min |
|---|---|---|---|---|---|---|---|---|---|---|
| `turnip` | Turnip | spring | 120 / 2 | — | 1–1 | 10 | 22 | 3 | 1 | 6.00 |
| `potato` | Potato | spring | 240 / 4 | — | 1–2 | 25 | 36 | 4 | 1 | 7.25 |
| `garlic` | Garlic | winter, spring | 300 / 5 | — | 1–1 | 39 | 87 | 7 | 2 | 9.60 |
| `strawberry` | Strawberry | spring | 480 / 8 | 240 / 4 | 1–2 | 67 | 20 | 3 | 3 | 7.50 (regrow) |
| `cauliflower` | Cauliflower | spring | 600 / 10 | — | 1–1 | 110 | 241 | 13 | 4 | 13.10 |
| `wheat` | Wheat | summer, autumn | 180 / 3 | — | 1–2 | 17 | 25 | 3 | 1 | 6.83 |
| `tomato` | Tomato | summer, autumn | 360 / 6 | 180 / 3 | 1–2 | 39 | 12 | 2 | 1 | 6.00 (regrow) |
| `blueberry` | Blueberry | summer | 600 / 10 | 240 / 4 | 2–3 | 67 | 12 | 2 | 3 | 7.50 (regrow) |
| `corn` | Corn | summer, autumn | 720 / 12 | 360 / 6 | 1–2 | 130 | 40 | 5 | 4 | 10.00 (regrow) |
| `melon` | Melon | summer | 1080 / 18 | — | 1–1 | 250 | 563 | 22 | 6 | 17.39 |
| `yam` | Yam | autumn | 420 / 7 | — | 1–1 | 50 | 111 | 8 | 1 | 8.71 |
| `kale` | Kale | autumn, winter | 300 / 5 | — | 1–1 | 39 | 87 | 7 | 2 | 9.60 |
| `cranberry` | Cranberry | autumn | 540 / 9 | 240 / 4 | 2–3 | 79 | 14 | 2 | 4 | 8.75 (regrow) |
| `pumpkin` | Pumpkin | autumn | 1200 / 20 | — | 1–1 | 290 | 639 | 24 | 6 | 17.45 |
| `leek` | Leek | winter | 480 / 8 | — | 1–1 | 71 | 157 | 10 | 2 | 10.75 |

Spring, summer and autumn each have Farm Level 1 crops (spring: turnip, potato; summer: wheat, tomato; autumn: yam, wheat, tomato). Winter's crops (garlic, kale, leek) start at Farm Level 2, which a player reaches long before their first winter (week 4 at the earliest), so winter is lean on crops and leans on cooking (§7, seasonal effects) and fishing. Multi-season crops: garlic, wheat, tomato, corn, kale. Regrowers: strawberry, tomato, blueberry, corn, cranberry.

---

## 3. Economy and market

### Starting state

| Thing | Value |
|---|---|
| Gold | 60 |
| Plot grid | 4 × 2 = 8 plots, of which the left 4 start tilled |
| Seeds | 6 × `seed_turnip` |
| Inventory | 12 slots, stack size 99 |
| Calendar | Spring, Year 1, at the player's current local time |

### Price of one unit

```ts
unitPrice = max(1, floor(basePrice * demand * (1 + specialBonus) * (1 + seasonalSellBonus) * mods.sellPriceModifier * channel))
seasonalSellBonus = seasons[current].dishSellBonus if the item is a dish, else 0     // winter: +0.25 (§7)
channel   = 0.9   // Market panel: instant sale
          | 1.0   // Shipping Bin: paid at the next pickup
```

When several units are sold at once, they are priced one at a time and demand drops after each unit, so the preview total is the exact sum.

### Shipping bin

```ts
BIN_PICKUP_MS = 60 * 60_000     // the bin is collected every 60 minutes of simulated time
```

Items dropped in the bin are sold at the prices of the moment of pickup. The Market panel shows "Next pickup in 23 min". Offline, each pickup is processed in order, so demand drops and recovers between pickups exactly as it would online.

### Demand

```ts
DEMAND_FLOOR = 0.5
DEMAND_CEIL  = 1.3
depth(item)  = clamp(round(60 * sqrt(20 / basePrice)), 8, 60)   // units that push demand from 1.0 to the floor
// after each unit sold:
demand = max(DEMAND_FLOOR, demand - 0.5 / depth(item))

// recovery, every step (exact for any dt, so offline steps are correct):
TAU_MIN = 10                                                     // minutes of simulated time
target = restTarget(hoursSinceSold)                              // simulated hours since the last sale
demand = target + (demand - target) * exp(-dtMinutes / TAU_MIN)
demand = clamp(demand, DEMAND_FLOOR, DEMAND_CEIL)

restTarget(h) = h < 1 ? 1.0 : min(1.3, 1.0 + 0.1 * h)           // unsold for 3+ hours: up to 1.3
// items never sold: target 1.0
```

Cheap bulk crops have deep markets (turnip depth 57), expensive items have shallow ones (pumpkin 11, moonfin 8). Growing one crop is never punished (the floor is half price and it recovers in about half an hour), but rotating crops and resting a market pays up to +30%.

### Daily specials

At 06:00 local each day (a calendar event): `n = 1 + rng.int(0, 2)` items are drawn without replacement from sellable items the player can currently obtain (in-season unlocked crops, fish at unlocked locations, known dishes). Each gets `bonus = 0.20 + 0.05 * rng.int(0, 6)` (so +20% to +50%). Specials last until the next 06:00, which gives players a gentle reason to look in once a day.

### Market depth values (for reference)

turnip 57, potato 45, garlic 29, strawberry 60, cauliflower 17, wheat 54, tomato 60, blueberry 60, corn 42, melon 11, yam 25, kale 29, cranberry 60, pumpkin 11, leek 21; bluegill 49, carp 42, catfish 26, koi 15, trout 38, perch 40, salmon 23, sturgeon 13, sardine 45, mackerel 36, tuna 21, pufferfish 14, moonfin 8, petal_koi 8, ember_salmon 8, sun_marlin 8; seaweed 60, old_boot 60, driftwood 60. Dishes use the same formula with their base price.

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
| `sprinkler` | Each unit occupies one plot. Plots in its area are always watered. Area is set by `sprinkler_tech`. |
| `sprinkler_tech` | L0 Basic: plus shape, radius 1 (4 plots). L1 Quality: square radius 1 (8 plots). L2 Iridium: square radius 2 (24 plots). |
| `scarecrow` | Each unit occupies one plot. Plots within square radius 2 get `+0.20` growth. Overlaps do not stack. |
| `farmhand` | Every `interval` seconds of simulated time, harvests up to `capacity` ready plots (oldest-ready first). L1 30 s / 6, L2 22 s / 9, L3 17 s / 12, L4 12 s / 16, L5 9 s / 20. |
| `seed_planter` | Acts right after each farmhand visit, with the same capacity. L1 `replantHarvested` (replants the plot's last crop if a seed is in inventory and it is in season). L2 + `plantEmpty` (tilled empty plots get the last crop, else the highest-value in-season seed in inventory). L3 + `autoTill` (clears dead crops and tills untilled plots). |
| `auto_seller` | L1 `autoShip`: automated harvests (and manual ones, if the per-item toggle is on) go to the Shipping Bin instead of the inventory. L2 `keepReserve`: keeps up to 10 of each item in the inventory for cooking and ships the rest. |
| `watering_can` | Tiles per click: base 1, Copper 3 (a 1 × 3 row), Iron 9 (3 × 3), Gold 25 (5 × 5). |
| `hoe` | Same areas as the watering can, for tilling and clearing dead crops. |
| `barn_storage` | Stack size: 99 → 199 → 299 → 499 → 999. |
| `greenhouse` | L1: 6 greenhouse plots (3 × 2) that ignore seasons and are always watered. L2: 12 plots (4 × 3). |
| `backpack` | Inventory slots: 12 → 16 → 20 → 24 → 28. |
| `fish_trap` | Rolls one catch every 3 minutes of simulated time, holds up to 5 items. Pool: trappable fish in season at its location (any hour) and junk. |
| `fishing_rod` | Starter "Old Rod" L0: zone ×1.00, luck 0. Bamboo L1: ×1.10, +0.05. Fiberglass L2: ×1.20, +0.15. Iridium L3: ×1.35, +0.30. |
| `trap_collector` | `autoCollect`: at each shipping-bin pickup (every 60 min) each trap is emptied into the inventory (or the Shipping Bin if auto-sell is on for that item). |
| `kitchen` | Old Hearth L0: 1 queue slot, +0 speed. Stove L1: 2 slots, +0.15. Oven L2: 3 slots, +0.30. Pro Kitchen L3: 4 slots, +0.50. |

### Automation throughput

```ts
farmhandVisitsPerMin = 60 * mods.automationSpeedModifier / intervalSec
plotsPerMin          = farmhandVisitsPerMin * capacity
// L1: 12/min, L2: ~25/min, L3: ~42/min, L4: 80/min, L5: ~133/min
// a farm is "fully automated" when plotsPerMin ≥ plots / avgGrowMinutes of what is planted,
// and every plot is covered by a sprinkler (or is a greenhouse plot)
```

The farmhand cooldown counts down in simulated time. Offline, visits are batched: `visits = floor((cooldownElapsed + dtMs) / intervalMs)`, each visit processed in order, so large and small steps match exactly.

If the inventory is full during an automated harvest, the crop **stays ready in the plot** (nothing is lost), the farmhand skips that plot, and one `inventoryFull` event is emitted per shipping-bin pickup at most. Auto-shipped items never need inventory space.

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

### Fish table (16 fish + 3 junk)

`Hours` is the bite window on the player's **local clock** (wraps past midnight). Windows are deliberately wide so that people who only play in the evening or at lunch still meet most fish. `Trap` = can come from traps; **traps ignore the hours window** (they still respect seasons), so night fish can be caught by someone who never plays at night. There is **one legendary per season**, each at a different location and never trap-catchable.

| id | Name | Location | Seasons | Hours | Rarity | Difficulty | Size (cm) | Base price | Trap |
|---|---|---|---|---|---|---|---|---|---|
| `bluegill` | Bluegill | pond | all | 0–24 | common | 15 | 10–25 | 30 | yes |
| `carp` | Carp | pond | spring, summer, autumn | 0–24 | common | 25 | 30–70 | 40 | yes |
| `catfish` | Catfish | pond | spring, summer, autumn | 18–8 | uncommon | 45 | 40–110 | 110 | yes |
| `koi` | Koi | pond | spring, summer | 8–18 | rare | 65 | 30–60 | 300 | no |
| `petal_koi` | Petal Koi | pond | spring | 0–24 | legendary | 85 | 40–80 | 1200 | no |
| `trout` | Trout | river | spring, summer, autumn | 5–21 | common | 30 | 25–60 | 50 | yes |
| `perch` | Perch | river | autumn, winter, spring | 0–24 | common | 25 | 15–35 | 45 | yes |
| `salmon` | Salmon | river | autumn | 0–24 | uncommon | 50 | 50–100 | 140 | yes |
| `sturgeon` | Sturgeon | river | summer, winter | 6–20 | rare | 75 | 90–200 | 420 | no |
| `ember_salmon` | Ember Salmon | river | autumn | 0–24 | legendary | 88 | 60–120 | 1300 | no |
| `sardine` | Sardine | ocean | all | 0–24 | common | 20 | 10–20 | 35 | yes |
| `mackerel` | Mackerel | ocean | spring, summer, autumn | 5–21 | common | 35 | 25–45 | 55 | yes |
| `tuna` | Tuna | ocean | summer, winter | 6–22 | uncommon | 60 | 60–180 | 160 | yes |
| `pufferfish` | Pufferfish | ocean | summer | 10–18 | rare | 70 | 15–35 | 380 | no |
| `sun_marlin` | Sun Marlin | ocean | summer | 6–20 | legendary | 92 | 150–300 | 1400 | no |
| `moonfin` | Moonfin | ocean | winter | 16–10 | legendary | 90 | 70–140 | 1500 | no |
| `old_boot` | Old Boot | all | all | — | junk | — | — | 5 | yes |
| `seaweed` | Seaweed | pond, ocean | all | — | junk | — | — | 20 | yes |
| `driftwood` | Driftwood | river, ocean | all | — | junk | — | — | 8 | yes |

Every location has at least one common fish in every season, so fishing never comes up empty. The spring legendary is in the pond, so even a brand-new player has a (small, about 1%) chance at one in their first week.

### Catch selection

```ts
RARITY_WEIGHT = { common: 60, uncommon: 25, rare: 8, legendary: 2 }
LUCK_SCALE    = { common: -0.3, uncommon: 0.5, rare: 1.5, legendary: 2.5 }
JUNK_WEIGHT   = { active: 10, trap: 25 }       // per junk item eligible at the location

luck = mods.fishingLuckModifier                 // rod + buff + perks + bundle, additive; 0 at start
weight(fish) = RARITY_WEIGHT[r] * max(0.3, 1 + luck * LUCK_SCALE[r])
pool = active: fish at location, in season, inside the hours window (local time)
       trap:   trappable fish at location, in season (any hour)
       + junk at location
pick = rng.weighted(pool, weight)
sizeCm = min + (max - min) * rng.float() ** 1.5   // big ones are rarer; size only affects the collection log
```

Worked example, active fishing at the pond, summer, 12:00, luck 0: bluegill 60, carp 60, koi 8, seaweed 10, old boot 10 (catfish bites 18:00–08:00) → bluegill 40.5%, carp 40.5%, koi 5.4%, seaweed 6.8%, old boot 6.8%. With luck 1.0 the commons drop to 42 each and koi rises to 20, so koi becomes about 16%, roughly three times as likely.

### Active fishing

```ts
biteWaitMs   = rng.range(3000, 10000) / mods.fishingSpeedModifier     // real ms
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
TRAP_INTERVAL_SEC = 180           // one roll every 3 minutes of simulated time
TRAP_CAPACITY     = 5 (+ perks)
rolls = floor((trap.progressMs + dtMs * mods.fishingSpeedModifier) / (TRAP_INTERVAL_SEC * 1000))
// each roll adds one item if the trap has space; a full trap stops rolling (progress is kept at the threshold)
```

---

## 7. Cooking and buffs

### Recipe tier

```ts
units = sum of ingredient quantities
value = sum of qty * items[ingredient].basePrice
score = units + value / 50 + cookSec / 30
tier  = score >= 28 ? 4 : score >= 15 ? 3 : score >= 8 ? 2 : 1
```

Tier rises with how many things go in, how valuable they are, and how long the dish takes. The declared `tier` in data must match `recipeTier()`; a test checks every recipe, so if a price change moves a recipe across a threshold, either retune the recipe or accept the new tier and update this table.

### Dish price

```ts
TIER_SELL_MULT = { 1: 1.25, 2: 1.40, 3: 1.60, 4: 2.00 }
dish.basePrice = round(value * TIER_SELL_MULT[tier])
cookMs         = cookSec * 1000 / mods.cookSpeedModifier
```

### Buff magnitude and duration

```ts
magnitude  = 0.10 * tier * buffs[type].magnitudeScale
durationMs = 360_000 * 2 ** (tier - 1) * (1 + buffDurationPerk + (dish.hearty ? HEARTY_DURATION_BONUS : 0))
// T1: 6 min · T2: 12 min · T3: 24 min · T4: 48 min of simulated time (before perks and the hearty bonus)
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
BASE_BUFF_SLOTS = 3        // +1 from Cooking level 7, +1 from bundle cozy_dinner → max 5
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

### Seasonal effects: winter is cooking season

Seasonal effects live in `src/data/seasons.ts` and are applied through the normal seams. Only winter has effects in v1.

| Season | Effect | Value | Applied where |
|---|---|---|---|
| winter | **Hearty dishes:** a dish that *finishes cooking* in winter is marked `hearty` and its buff lasts longer when eaten (any season) | `HEARTY_DURATION_BONUS = 0.5` (+50% duration) | cooking system sets the flag; buff system reads it |
| winter | Cooking XP | +50% (`cookingXpBonus = 0.5`) | progression (phase 07), at the moment a dish finishes |
| winter | Dishes sell for more | +25% (`dishSellBonus = 0.25`), separate from demand, so it can't push past the demand ceiling | market price formula (§3) |

Hearty dishes are a separate inventory stack (same item id, `hearty: true`) shown with a small snowflake badge. The duration bonus, not a magnitude bonus, keeps winter from compounding with growth buffs. Together these make the winter week a "cooking week": stock up on crops in autumn, cook in winter, and sell or eat the hearty dishes.

### Recipe table (22 recipes: 6 × T1, 7 × T2, 5 × T3, 4 × T4)

`Magnitude` is already multiplied by the buff's `magnitudeScale` (luck is shown as a percentage of 1.0 luck). "card N" = a recipe card bought in the Shop for N gold once the condition holds. Starter recipes are known in a new save. **Cookable in** is the season(s) in which every ingredient can be harvested or caught fresh; with weekly seasons, every T3 and T4 recipe is completable within one season, and there is one T4 per season. Dishes marked spring are what a new player works toward in their first week.

| id | Name | Ingredients | Cook (s) | Units | Value | Score | Tier | Base price | Buff | Magnitude | Duration (min) | Cookable in | Discovery |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `roasted_turnip` | Roasted Turnip | turnip ×2 | 30 | 2 | 44 | 3.88 | T1 | 55 | `growth` | +10% | 6 | spring | starter |
| `baked_potato` | Baked Potato | potato ×2 | 30 | 2 | 72 | 4.44 | T1 | 90 | `cookSpeed` | +15% | 6 | spring | starter |
| `grilled_bluegill` | Grilled Bluegill | bluegill ×1 | 30 | 1 | 30 | 2.60 | T1 | 38 | `fishingSpeed` | +10% | 6 | spring, summer, autumn, winter | starter |
| `berry_bowl` | Berry Bowl | strawberry ×2 | 15 | 2 | 40 | 3.30 | T1 | 50 | `xp` | +15% | 6 | spring | card 150 · FL2 |
| `seaweed_salad` | Seaweed Salad | seaweed ×2, turnip ×1 | 15 | 3 | 62 | 4.74 | T1 | 78 | `fishingLuck` | +10% | 6 | spring | milestone `m06_first_catch` |
| `wheat_flatbread` | Wheat Flatbread | wheat ×3 | 45 | 3 | 75 | 6.00 | T1 | 94 | `automationSpeed` | +10% | 6 | summer, autumn | card 120 · FL1 |
| `vegetable_soup` | Vegetable Soup | turnip ×2, potato ×1, garlic ×1 | 60 | 4 | 167 | 9.34 | T2 | 234 | `growth` | +20% | 12 | spring | milestone `m07_first_dish` |
| `fish_tacos` | Fish Tacos | wheat ×2, tomato ×2, sardine ×1 | 60 | 5 | 109 | 9.18 | T2 | 153 | `fishingSpeed` | +20% | 12 | summer, autumn | card 600 · expansion `ocean` |
| `tomato_pasta` | Tomato Pasta | wheat ×2, tomato ×3, corn ×1 | 60 | 6 | 126 | 10.52 | T2 | 176 | `cookSpeed` | +30% | 12 | summer, autumn | card 500 · FL3 |
| `corn_chowder` | Corn Chowder | corn ×2, wheat ×1, perch ×1 | 75 | 4 | 150 | 9.50 | T2 | 210 | `automationSpeed` | +20% | 12 | autumn | experiment |
| `blueberry_muffin` | Blueberry Muffin | wheat ×2, blueberry ×4 | 60 | 6 | 98 | 9.96 | T2 | 137 | `xp` | +30% | 12 | summer | card 450 · FL3 |
| `glazed_yams` | Glazed Yams | yam ×2, cranberry ×2 | 45 | 4 | 250 | 10.50 | T2 | 350 | `sellPrice` | +10% | 12 | autumn | experiment |
| `garlic_trout` | Garlic Trout | trout ×1, garlic ×1, potato ×1 | 75 | 3 | 173 | 8.96 | T2 | 242 | `fishingLuck` | +20% | 12 | spring | milestone `m10_unlock_river` |
| `seafood_stew` | Seafood Stew | tuna ×1, mackerel ×2, tomato ×2, corn ×1 | 120 | 6 | 334 | 16.68 | T3 | 534 | `fishingLuck` | +30% | 24 | summer | card 2500 · expansion `ocean` |
| `pumpkin_soup` | Pumpkin Soup | pumpkin ×1, kale ×1, yam ×1 | 120 | 3 | 837 | 23.74 | T3 | 1339 | `growth` | +30% | 24 | autumn | card 2000 · FL6 |
| `cranberry_pie` | Cranberry Pie | wheat ×3, cranberry ×4, yam ×1 | 120 | 8 | 242 | 16.84 | T3 | 387 | `sellPrice` | +15% | 24 | autumn | experiment |
| `catfish_gumbo` | Catfish Gumbo | catfish ×2, corn ×1, tomato ×2, wheat ×1 | 120 | 6 | 309 | 16.18 | T3 | 494 | `automationSpeed` | +30% | 24 | summer, autumn | card 1800 · FL5 |
| `scholars_stew` | Scholar's Stew | perch ×2, garlic ×2, bluegill ×2 | 120 | 6 | 324 | 16.48 | T3 | 518 | `xp` | +45% | 24 | spring, winter | milestone `m11_farm_level_5` |
| `garden_banquet` | Garden Banquet | cauliflower ×2, strawberry ×4, garlic ×1, potato ×2 | 180 | 9 | 721 | 29.42 | T4 | 1442 | `cookSpeed` | +60% | 48 | spring | milestone `m12_cook_t3` |
| `royal_sturgeon` | Royal Sturgeon | sturgeon ×1, koi ×1, melon ×1, tomato ×2, corn ×1 | 240 | 6 | 1347 | 40.94 | T4 | 2694 | `fishingLuck` | +40% | 48 | summer | experiment |
| `harvest_feast` | Harvest Feast | pumpkin ×1, yam ×2, corn ×2, wheat ×2, cranberry ×3 | 240 | 10 | 1033 | 38.66 | T4 | 2066 | `sellPrice` | +20% | 48 | autumn | card 6000 · FL6 |
| `moonfin_sushi` | Moonfin Sushi | moonfin ×1, seaweed ×3, leek ×1 | 180 | 5 | 1717 | 45.34 | T4 | 3434 | `xp` | +60% | 48 | winter | card 12000 · caught `moonfin` |

Buff coverage: growth 3, sellPrice 3, fishingLuck 4, fishingSpeed 2, cookSpeed 3, automationSpeed 3, xp 4. T4 by season: spring `garden_banquet`, summer `royal_sturgeon`, autumn `harvest_feast`, winter `moonfin_sushi`.

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
| 6 | melon, pumpkin seeds; `ocean`; `farm_4`; `pumpkin_soup`, `harvest_feast` cards |
| 7 | `sprinkler_tech` L2; greenhouse |

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
| `m12_cook_t3` | Cook a T3 dish | recipe `garden_banquet` |
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
| `earn_gold_day` | Earn 500 gold in one day (06:00–06:00 local) | first sale |
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
| First T4 dish cooked | 3–5 h (active + idle combined), normally spring's `garden_banquet` in the first week |
| Whole farm automated (farmhand L3, planter L2, auto-seller, all plots sprinkled) | 4–6 h |
| Greenhouse | 8–12 h |
| First season change | 3–10 real days after the save is created (always after at least 3 days of spring) |
| Winter week | cooking a hearty T2+ dish earns more than selling its raw ingredients in any season |
| Farm Level 10 | 10–15 h |
| Casual idler (2 min every 4 h) | reaches ≥ 40% of the active player's lifetime gold after 3 real days |
| Food buffs kept up | 10–25% faster progression, never required |
| Late game gold/hour | grows roughly linearly with upgrades, never more than ~3× per real hour of play |

Early-game sanity check (by hand): 8 watered turnip plots earn about `8 * 6 = 48` gold profit per minute of active play before the market drop. That puts `farm_1` (400) at ~8 minutes and the first sprinkler (300) soon after, inside the targets.

---

## 12. Tuning notes

Each phase that tunes numbers adds a dated subsection here: what changed, why, and the simulation evidence.

### Phase 00 notes
- All crop prices come from `profitRate`. If a crop feels wrong, change its `u`, grow time or yield, not its price directly, so the table stays consistent.
- Seed prices such as 39 and 67 are formula outputs; phase 03 may snap them to friendlier numbers if it keeps profit/hour within ±5%.
- The provisional farm level (§9) is deliberately generous so phases 02–06 can be playtested without progression.
- **Revision after owner review:** the calendar now follows real local time (weekly seasons, night 20:00–06:00) and all timers are in seconds of simulated time. Prices are unchanged: the old "in-game hour" was 30 real seconds, so `profitRate` was restated per real minute with the same results. Watering lasts 2 h and sprinklers keep plots permanently watered; the shipping bin is collected every 60 minutes. Recipes were reworked so every T3/T4 can be cooked from one season's ingredients (`melon_sorbet_tower` was replaced by the spring T4 `garden_banquet`), three seasonal legendary fish were added (`petal_koi`, `sun_marlin`, `ember_salmon`), fish time windows were widened, traps ignore time windows, and winter gained cooking bonuses (hearty dishes, Cooking XP, dish prices).
