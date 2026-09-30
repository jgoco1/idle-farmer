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
dayKey                    = local date of now, minus one day if hour < 6   // a "day" runs 06:00 → 06:00 local (DST-safe)
localDay(t)               = whole local calendar days since 1970-01-01 (DST-safe; built from local Y/M/D)

// seasons change at local Saturday → Sunday midnight, counted from the save's creation
firstSunday   = the first local Sunday 00:00 after createdAt   // if DST skips that midnight: the moment of the jump
seasonEpoch   = (firstSunday - createdAt < 3 days) ? firstSunday + 7 days : firstSunday
sundayWeek(d) = floor((d - 3) / 7)                            // day 3 = 1970-01-04, a Sunday: +1 at every Sunday
epochWeek     = sundayWeek(utcDay(seasonEpoch + 14h))         // the epoch's Sunday, whatever zone the save was made in
weekIndex     = max(0, sundayWeek(localDay(now)) - epochWeek + 1)
weekIndex     = max(weekIndex, state.calendar.maxWeekIndex)  // never goes backwards (clock set back)
season        = SEASONS[weekIndex % 4]                        // every save starts in spring
year          = floor(weekIndex / 4) + 1
```

A new save always starts in **spring**, and the first spring lasts at least 3 real days (up to 10). Counting Sunday-to-Sunday weeks in the *current* zone (rather than days since the epoch) means a player who changes time zone sees the season change at their new local Sunday midnight, and never loses or gains a week; flying west cannot move the season back because of `maxWeekIndex`. After that each season is one real week (Sunday–Saturday) and a year is 4 weeks.

HUD format: `Spring · Year 1 · Tue 9:40 PM`.

Day/night visuals: dawn 06:00–07:30, day 07:30–18:30, dusk 18:30–20:00, night 20:00–06:00.

**Calendar events** (fired by the core when a boundary is crossed, including while away):
- **Daily, 06:00 local:** roll market specials, record a market-history point, reset `goldToday` and per-day goal counters, `daysPassed += 1`. If several days passed while away, the refresh does not fire once per day: it fires at each 06:00 inside the part of the absence that still counts (the first 24 h, so at most twice, because later simulated time depends on it) and then **once** more for the latest day if the absence went beyond that.
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
- Yield per harvest: `rng.int(yield.min, yield.max)`, then `+1` with probability `doubleHarvestChance` (Farming perks). If the harvest does not fit in the inventory, nothing changes, not even the RNG state.
- A step in which the water runs out counts its wet part at full speed and its dry part at half (`growthAfter` in `src/systems/farming.ts`); the core also splits steps at that moment. Each part is rounded once, so a run of 100 ms ticks can differ from one large step by about 1 ms per water-out that falls inside a tick.

### Crop profit formula

Crop prices are derived, not hand-picked. `u` is the crop's value tier (0–3, roughly "how late it unlocks"). `m` is minutes of simulated time.

```ts
profitRate(m, u) = 6.0 * (1 + 0.25 * log2(m / 2)) * (1 + 0.2 * u)   // gold per plot per minute, watered, sold at the Market (90%)
// single-harvest crops, growing m minutes with average yield y:
gross     = profitRate(growMin, u) * growMin / 0.55
basePrice = round(gross / y)
seedPrice = roundNice(0.35 * gross)                  // Market profit = 0.9·gross − 0.35·gross = 0.55·gross (phase 03; was 0.45)
// regrowing crops, regrow time r minutes:
grossPerHarvest = profitRate(r, u) * r * 0.85        // slight discount: no replanting cost or clicks
basePrice       = round(grossPerHarvest / y)
seedPrice       = roundNice(1.7 * grossPerHarvest)   // phase 03; was 2.2
```

Longer crops earn a little more per minute (patience is rewarded), and later crops earn more (progression feels like progress). Regrowers are the "plant once, forget" option that suits idle play.

### Crop table (15 crops)

`u` values: turnip, potato, wheat, tomato, yam 0; garlic, strawberry, blueberry, kale, leek 1; cauliflower, corn, cranberry 2; melon, pumpkin 3. Durations are simulated time, stored in data as seconds (`growSec`, `regrowSec`). `XP/unit` is Farming XP per harvested unit (§8). `Profit/plot/min` is at 1× growth, watered, at demand 1.0, sold at the Market (90%); the Shipping Bin adds 10% of the gross on top.

| id | Name | Seasons | Grow (s / min) | Regrow (s / min) | Yield | Seed price | Base price | XP/unit | Farm Lv | Profit/plot/min |
|---|---|---|---|---|---|---|---|---|---|---|
| `turnip` | Turnip | spring | 120 / 2 | — | 1–1 | 8 | 22 | 3 | 1 | 6.00 |
| `potato` | Potato | spring | 240 / 4 | — | 1–2 | 19 | 36 | 4 | 1 | 7.25 |
| `garlic` | Garlic | winter, spring | 300 / 5 | — | 1–1 | 30 | 87 | 7 | 2 | 9.60 |
| `strawberry` | Strawberry | spring | 480 / 8 | 240 / 4 | 1–2 | 52 | 20 | 3 | 3 | 7.50 (regrow) |
| `cauliflower` | Cauliflower | spring | 600 / 10 | — | 1–1 | 84 | 241 | 13 | 4 | 13.10 |
| `wheat` | Wheat | summer, autumn | 180 / 3 | — | 1–2 | 13 | 25 | 3 | 1 | 6.83 |
| `tomato` | Tomato | summer, autumn | 360 / 6 | 180 / 3 | 1–2 | 30 | 12 | 2 | 1 | 6.00 (regrow) |
| `blueberry` | Blueberry | summer | 600 / 10 | 240 / 4 | 2–3 | 52 | 12 | 2 | 3 | 7.50 (regrow) |
| `corn` | Corn | summer, autumn | 720 / 12 | 360 / 6 | 1–2 | 100 | 40 | 5 | 4 | 10.00 (regrow) |
| `melon` | Melon | summer | 1080 / 18 | — | 1–1 | 200 | 563 | 22 | 6 | 17.39 |
| `yam` | Yam | autumn | 420 / 7 | — | 1–1 | 39 | 111 | 8 | 1 | 8.71 |
| `kale` | Kale | autumn, winter | 300 / 5 | — | 1–1 | 30 | 87 | 7 | 2 | 9.60 |
| `cranberry` | Cranberry | autumn | 540 / 9 | 240 / 4 | 2–3 | 61 | 14 | 2 | 4 | 8.75 (regrow) |
| `pumpkin` | Pumpkin | autumn | 1200 / 20 | — | 1–1 | 220 | 639 | 24 | 6 | 17.45 |
| `leek` | Leek | winter | 480 / 8 | — | 1–1 | 55 | 157 | 10 | 2 | 10.75 |

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
depth(item)  = clamp(round(150 * sqrt(20 / basePrice)), 20, 150)   // units that push demand from 1.0 to the floor (phase 03; was 60, 8, 60)
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

The target is piecewise (constant, linear, constant), so recovery is solved in closed form on each piece (`demandAfter` in `src/systems/market.ts`; on the linear piece `d(t) = T0 + k(t − τ) + (d0 − T0 + kτ)e^(−t/τ)`), and one large step equals many small ones to floating-point precision. The sparkline records `demand × (1 + special)` for every sellable item at each daily refresh (last 7 points); the trend arrow compares the current value with the morning's point (±0.02 counts as steady).

Cheap bulk crops have deep markets (turnip depth 143), expensive items have shallow ones (pumpkin 27, moonfin 20). Growing one crop is never punished (the floor is half price and it recovers in about half an hour), but rotating crops and resting a market pays up to +30%.

### Daily specials

At 06:00 local each day (a calendar event), and once when a new farm is created: `n = 1 + rng.int(0, 2)` items are drawn without replacement from sellable items the player can currently obtain (in-season unlocked crops, fish at unlocked locations, known dishes). Each gets `bonus = 0.20 + 0.05 * rng.int(0, 6)` (so +20% to +50%). Specials last until the next 06:00, which gives players a gentle reason to look in once a day.

### Market depth values (for reference)

turnip 143, potato 112, garlic 72, strawberry 150, cauliflower 43, wheat 134, tomato 150, blueberry 150, corn 106, melon 28, yam 64, kale 72, cranberry 150, pumpkin 27, leek 54; bluegill 122, carp 106, catfish 64, koi 39, trout 95, perch 100, salmon 57, sturgeon 33, sardine 113, mackerel 90, tuna 53, pufferfish 34, moonfin 20, petal_koi 20, ember_salmon 20, sun_marlin 20; seaweed 150, old_boot 150, driftwood 150. Dishes use the same formula with their base price.

### Shop and upgrade buttons

The Shop sells this season's seeds in lots of 1, 5, 10 and "Max" (as many as gold and bag space allow); seeds that need a farm level are listed, locked, with the gold still to earn. The Market sells ×1, ×10 or all at 90%, or ships all to the bin. Constants: `SHOP_BUY_AMOUNTS`, `MARKET_SELL_AMOUNTS` in `src/data/balance.ts`.

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
| `fish_trap` | Rolls one catch every 3 minutes of simulated time, holds up to 5 items. Pool: trappable fish in season at its location (any hour) and junk. Buying one sets it out at the next free water spot (pond 1, pond 2, then river 1, 2 and ocean 1, 2 as those open); the player does not choose the spot. Each location's traps float at fixed tiles (`TRAP_TILES` in `src/render/scene.ts`). |
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
| `farm_3` | Old Orchard Plot | farm | 5500 | 6 × 5 (30 plots) | `farm_2`, FL3 | two trees removed (one where the wider fence goes, one on the greenhouse lot); the lot is revealed |
| `farm_4` | The Back Forty | farm | 20000 | 8 × 6 (48 plots) | `farm_3`, FL6 | the fence reaches the market path; a scarecrow post decoration appears |
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
| `perch` | Perch | river | all | 0–24 | common | 25 | 15–35 | 45 | yes |
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

Every location has at least one common fish in every season **and at every hour**, so fishing never comes up empty (phase 05 made Perch a year-round river fish: with Trout at 5–21 and Perch only in autumn to spring, the river had no common fish on summer nights; `tests/fishing.test.ts` now checks every location, season and half hour). The spring legendary is in the pond, so even a brand-new player has a (small, about 1%) chance at one in their first week.

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
// `progressMs` is in simulated ms at ×1 speed: it grows by round(dt * speed), so one big step = many small ones
// (a Trap Collector pickup empties traps into the bag every 60 min, so a collector trap yields at most 5 per hour)
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
xpToNext(L) = round(150 * 1.5 ** (L - 1))           // L = 1..9   (phase 07 tuned this from 40 × 1.6^(L − 1): see "Phase 07 tuning notes")
// 150, 225, 338, 506, 759, 1139, 1709, 2563, 3844 → 11,233 total to reach level 10
// cumulative to reach level 2..10: 150, 375, 713, 1219, 1978, 3117, 4826, 7389, 11233

farmingXp(unit)  = max(1, round(crop.basePrice ** 0.6 / 2))                 // per harvested unit (table in §2)
fishingXp(catch) = { common: 6, uncommon: 14, rare: 30, legendary: 100 }[rarity] + floor(difficulty / 10)
                   // junk: 2; trap catches give floor(50%)
cookingXp(dish)  = round(8 * tier ** 1.5)                                    // 8, 23, 42, 64
xpGained = round(baseXp * mods.xpModifier)
```

### Skill perks

Each row is what that level adds, and the effects add up. A cell marked "(total)" shows the running total (5% + 5% double harvest reads "10% (total)"); the data (`src/data/skills.ts`) stores the increment. The luck rows (+0.05, +0.10, +0.15) are read as increments too, so Fishing 9 has +0.30 luck in all. They add to the rod's luck and the River & Sea bundle's +0.10.

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
farmPoints = (farming.level + fishing.level + cooking.level - 3) + milestonesDone     // 0 .. 42
farmLevel  = the highest L whose entry in FARM_LEVEL_POINTS is <= farmPoints
FARM_LEVEL_POINTS = [_, 0, 2, 5, 7, 10, 12, 15, 20, 27, 36]                              // index = level, 1..10
```

Phase 07 replaced the linear `min(20, 1 + floor(farmPoints / 2))` this section used to give with the table above (see "Phase 07 tuning notes"). Level 3 is the five farming milestones (plant, harvest, sell, expand, sprinkler). Levels 8 to 10 gate nothing in §9; they are the long game and want all three skills. A farm-only player tops out at 19 points (Level 7), so Levels 8 and up need a little fishing or cooking.

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

**Provisional farm level (phases 02–06, before skills existed; kept only to backfill old saves):**

```ts
provisionalFarmLevel = 1 + floor(log2(1 + stats.lifetimeGold / 300))
// lifetime gold 300 → 2, 900 → 3, 2100 → 4, 4500 → 5, 9300 → 6, 18900 → 7, 38100 → 8
```

Phase 07 replaced it with the real formula in §8. Its migration (v6 → v7) stores the level the old formula showed as `progression.farmLevelFloor`, and the Farm Level is `max(floor, real)`, so it never drops below what a player already saw. New saves start with a floor of 1.

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

Three goals are active at once. The generator picks a template whose `requires` holds, fills in an item the player can obtain now, and sizes the target so it takes about 5–15 real minutes at the player's current rate. "Obtain now" means a crop the player has unlocked that is in season, an open water, a known recipe whose ingredients can be grown or caught this season; a goal whose season passes is swapped at the change. The target of a harvest goal is `niceTarget(unitsPerMinute × GOAL_TARGET_MINUTES (8) × GOAL_EFFICIENCY (0.5))` with units per minute the whole farm growing that crop (its grow time plus half a minute to come back to it). A goal's reward is gold, or half the gold and 5 seeds (30% of goals), or half the gold and a recipe card the player can buy but does not know yet (15%).

```ts
goalGoldReward = roundNice(max(20, 0.05 * estimatedGoldPerRealMinute * 10))       // phase 07 tuned this from max(50, 0.25 × …)
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

Early-game sanity check (by hand): 8 watered turnip plots earn about `8 * 6 = 48` gold profit per minute of active play at the Market before the market drop. That puts `farm_1` (400) at ~8 minutes and the first sprinkler (300) soon after, inside the targets. The phase 03 simulation (tuning notes below) confirms it.

---

## 12. Tuning notes

Each phase that tunes numbers adds a dated subsection here: what changed, why, and the simulation evidence.

### Phase 00 notes
- All crop prices come from `profitRate`. If a crop feels wrong, change its `u`, grow time or yield, not its price directly, so the table stays consistent.
- Seed prices such as 39 and 67 are formula outputs; phase 03 may snap them to friendlier numbers if it keeps profit/hour within ±5%.
- The provisional farm level (§9) is deliberately generous so phases 02–06 can be playtested without progression.
- **Revision after owner review:** the calendar now follows real local time (weekly seasons, night 20:00–06:00) and all timers are in seconds of simulated time. Prices are unchanged: the old "in-game hour" was 30 real seconds, so `profitRate` was restated per real minute with the same results. Watering lasts 2 h and sprinklers keep plots permanently watered; the shipping bin is collected every 60 minutes. Recipes were reworked so every T3/T4 can be cooked from one season's ingredients (`melon_sorbet_tower` was replaced by the spring T4 `garden_banquet`), three seasonal legendary fish were added (`petal_koi`, `sun_marlin`, `ember_salmon`), fish time windows were widened, traps ignore time windows, and winter gained cooking bonuses (hearty dishes, Cooking XP, dish prices).

### Phase 02 notes (kept for history)
- No numbers changed. The 15 crops, `WATER_DURATION_MS`, `DRY_GROWTH_FACTOR = 0.5`, starting gold (60), 6 turnip seeds, 12 slots × 99 and the tilled left half of the 4 × 2 grid (columns 0–1 in both rows) are in `src/data/crops.ts` and `src/data/balance.ts`.
- The temporary Seed Crate sells unlocked, in-season seeds at `seedPrice` in lots of `SEED_CRATE_BUY_AMOUNTS = [1, 5]`. With the 6 starting turnip seeds the first harvest comes 2 minutes after planting when watered (the ≤ 2.5 min target), and the 60 starting gold buys six more seeds for the other plots.

### Phase 03 tuning notes
**Method.** `tests/sim/greedyPlayer.ts` plays the real game (`Game.dispatch` / `Game.advance`) for 60 minutes, looking at the farm every 5 s: harvest everything, sell it all at the Market, buy the next item on a shopping list when that leaves 12.5 g per plot for seeds, till, plant the crop with the best profit per plot-minute *after* the demand drop its own pending harvests will cause, water. Phase 04/05 purchases (first sprinkler 300 g, farmhand 800 g at FL3, River Access 2000 g at FL3) are bought as virtual items: gold is spent, nothing happens. The list is farm_1 → sprinkler → farmhand → farm_2 → river → farm_3. `tests/pacing.test.ts` runs 8 seeds and asserts the targets on the medians.

**What was wrong.** The first run (phase 00 numbers) put `farm_1` at ~13 min on a day without specials and a one-crop farm at 63% of base price. Two causes: the seed-price formula assumed selling at 100%, but instant Market sales pay 90%, so Market profit was 45% of gross instead of 55% (turnip: 19 − 10 = 9 g, not 12 g); and markets 60 units deep made 8 plots of one crop sink to ~0.65 demand within minutes.

**Changes.**
- `seedPrice = roundNice(0.35 · gross)` (was 0.45) and `1.7 · grossPerHarvest` for regrowers (was 2.2), so `profitRate` is exactly the Market profit again. Seeds: turnip 10→8, potato 25→19, garlic 39→30, strawberry 67→52, cauliflower 110→84, wheat 17→13, tomato 39→30, blueberry 67→52, corn 130→100, melon 250→200, yam 50→39, kale 39→30, cranberry 79→61, pumpkin 290→220, leek 71→55. Base prices are unchanged, so recipe values and tiers (§7) are unaffected.
- Market depth `clamp(round(150 · sqrt(20 / basePrice)), 20, 150)` (was 60, 8, 60): about 2.5× deeper. `TAU_MIN = 10`, the floor, the ceiling and the rest curve are unchanged.
- Nothing else changed: starting gold 60, expansion curve 400 · 3.7ⁿ, backpack 200 · 2.2ⁿ, bin every 60 min, channels 0.9 / 1.0.

**Results** (8 seeds, medians with ranges, minutes):

| Measure | Target | Real game (specials rolled at creation) | Day without specials |
|---|---|---|---|
| First harvest | ≤ 2.5 | 2.0 | 2.0 |
| First expansion `farm_1` | 6–10 | 8.0 (6–10) | 11.0 |
| First sprinkler (virtual) | 10–15 | 14.0 (10–15) | 16.0 |
| Farmhand L1 (virtual) | 25–40 | 28.0 (16–30) | 31.0 |
| `farm_2` | — | 36 (28–39) | 41 |
| River (virtual) | 45–75 | 48 (42–51) | 56 |
| Lifetime gold at 60 min | — | 14,000 (FL6 at ~47 min) | 12,100 |
| Average Market price / base price | — | 0.95 | 0.83 |

- **Specials matter early.** At Farm Level 1 in spring only turnip and potato can be specials, so a new farm almost always has one or both at +20–50% for its first day. The "day without specials" column is the unlucky floor; both columns sit inside or at the edge of the targets.
- **Variety, gently.** With specials off, a turnip-only farm sells at 0.725 of base price (≈ 0.81 of what an infinitely deep market would pay) and still buys `farm_1` at 10 min; the greedy mixed farm sells at 0.83. With the phase 00 depths the turnip-only farm fell to 0.57.
- **Waiting.** A player on the starter crops never waits more than 2 min (turnips take 2). After Farm Level 4 (~17 min) the greedy player fills the field with 10-minute cauliflower and waits up to ~6–8 min between waves: its own choice, and fishing (phase 05) fills those gaps. The test asserts the ≤ 2 min target before FL4 and for a starter-crop player.
- **Provisional farm level** (§9, unchanged) is generous: FL3 at ~10 min, FL4 ~17, FL6 ~47. Phase 07 replaces it.
- **Watch in phase 04:** the Shipping Bin sells its whole load at one moment, so an hour of auto-shipped harvest of one crop sells far down its demand curve (e.g. 240 turnips average ~0.65). That makes selling as you go better than a full bin, which is intended, but check it against the casual-idler target when auto-selling arrives.

### Phase 04 tuning notes
**Method.** `tests/sim/greedyPlayer.ts` now buys the real phase 04 upgrades. It places sprinklers and scarecrows where they cover the most uncovered plots (harvesting the crop in the way first), keeps clicking like an active player, and stocks eight rounds of seed once the Auto-Seller makes its income hourly. `AUTOMATION_SHOPPING_LIST` runs farm_1 → sprinkler → farmhand → farm_2 → river (virtual) → farm_3 → seed planter → sprinklers → farmhand 2, 3 → planter 2 → Sprinkler Tech → farm_4 → Sprinkler Tech 2 → sprinklers → Auto-Seller last. `tests/pacing.test.ts` asserts the results below on three seeds.

**Result: no numbers changed.** The costs, unlocks and farmhand table of §4 already land inside the targets (medians of 3–6 seeds, minutes of an active player, so these are the fastest a player can go):

| Moment | Target | Measured |
|---|---|---|
| First sprinkler (real) | 10–15 min | 10–15 (median 12–14) |
| Farmhand L1 | 25–40 min | 16–30 (median 28) |
| Seed planter L1 | — | ~80 min |
| Farmhand L3 + planter L2 | — | 104–118 min |
| Farm_4 (8 × 6) | — | ~203 min |
| Whole farm automated (farmhand 3, planter 2, auto-seller, every open plot sprinkled) | 4–6 h | 4.3–4.8 h |

- **Away income.** A player who stocks 150 seeds of each crop the planter remembers and leaves the finished farm for 8 hours earns about 45,000g (803 items shipped) and the offline step takes ~9 ms. An active player earns about four times that per hour at that stage, so idling is worth roughly a quarter of playing: automation is the main thing to buy, not a replacement for playing.
- **The Auto-Seller makes income lumpy.** The bin pays once an hour, at that moment's prices, so an active player who buys it early sees gold arrive in hourly lumps and spends the gaps with an empty purse (in the simulation their lifetime gold at 4 h was 54k against 95k without it). It is therefore the last item on the shopping list and a comfortable "I am about to leave" purchase. If phase 09 finds idle income too low, the levers are a shorter `BIN_PICKUP_MS` while a farmhand is hired, or gentler bin demand steps; neither is needed for the targets above.
- **Sprinklers eat plots.** Each one removes a plot from the field (12 of 48 at most). Two Sprinkler Tech levels are what make a full 8 × 6 field coverable with 8–9 sprinklers.

### Phase 05 tuning notes
**Method.** `tests/sim/greedyPlayer.ts` now buys the real River Access (`{ kind: 'expansion', id: 'river' }`) and has a `fishPerMin` option: every reaction step it converts `fishPerMin × minutes` into catches drawn from the real catch table (`chooseCatch` + `landCatch`, cast power 0.5) at the newest open location, and sells them with the crops like everything else. The default is 0, so every phase 03 and 04 number above still describes a farming-only player. `tests/pacing.test.ts` has a third group for the fishing player. Medians of 8 seeds, greedy active player, 60 real minutes, spring:

| Player | `farm_1` | 1st sprinkler | Farmhand | River | Lifetime gold at 60 min |
|---|---|---|---|---|---|
| Farming only | 9.0 min | 14.1 | 30.1 | 54.0 | 12,400 |
| + 1 catch a minute | 6.0 | 11.0 | 24.0 | 38.9 | 17,200 (1.4×) |
| + 3 catches a minute (BALANCE §6 model) | 3.6 | 5.7 | 8.1 | 22.9 | 25,500 (2.0×) |

- **Numbers changed:** only Perch's seasons (now all four). Every price, weight, interval and cost is as in §4 and §6.
- **Daily specials now include fish.** The pool is the in-season crops plus the in-season fish of the open locations (BALANCE §3 already said "fish at unlocked locations"), so on a new farm five of the seven candidates are pond fish. A farming-only player therefore sees crop specials less often: it sometimes plants 3-minute potatoes instead of 2-minute turnips, and its longest idle stretch before Farm Level 4 grew from 2 to 3 minutes on some seeds. The phase 03 test bound for that is now 3 minutes for a farming-only player; a player who fishes between chores is never idle for more than 2 minutes, which is the point of fishing (GDD §6.4).
- **What one catch is worth** (base price, before the Market's 90% and demand): pond, spring noon 62g (the rare koi and the legendary Petal Koi carry most of it); summer noon 49g; winter 26g (bluegill and junk only). The reel takes about 15 s of real time per fish (charge ~1 s, wait 3–10 s, react ~1 s, reel 2–8 s), so an attentive player lands 3 to 4 a minute, which is where the "3 catches per real minute" model comes from.
- **Finding for phase 09.** At 3 catches a minute an active fisher earns about twice what an active farmer does in the first hour and buys `farm_1` in under 4 minutes; pond commons alone (30–40g, 3 a minute) are ~100g a minute against ~50g a minute for eight turnip plots. Fishing is the attention-heavy way to play (a held button every 15 s) and the demand curve does bite (average price fraction stays ≈ 0.88 in the run), so nothing is capped yet, but the levers, in order of preference, are: a longer minimum bite wait or a short "line out" cooldown after a catch (fewer catches a minute, no price changes), lower base prices for Koi and the legendaries (they are about half of the pond's expected value in spring). The rest of the game's pacing targets (§11) are unchanged for a farming-only player.
- **Traps.** One trap is 500g and rolls 20 catches an hour but holds 5, so it is worth at most one full load (~5 × 30g) per collection; the Trap Collector (4,000g, two traps needed) makes that at most 5 things per trap per hour. That is deliberately small: traps are for the nights and the days away, not for income (a full pond trap is ~150g).

### Phase 06 tuning notes
**Method.** `tests/sim/greedyPlayer.ts` has a `cooking` option. After each harvest the player puts the best-margin dish they can make on the stove (`(basePrice − ingredient value) / cookSec`, one slot), then either sells every dish at the Market (`'sell'`) or eats every dish (`'eat'`, replacing a buff when the slots are full). Medians of 8 seeds, greedy active player, 60 real minutes, spring, farming only:

| Player | Lifetime gold at 60 min | Dishes cooked | Dish revenue | `farm_1` |
|---|---|---|---|---|
| No cooking | 12,442 | – | – | 9.0 min |
| Cooks and sells | 12,169 (−2%) | 19 | 918g | 9.0 min |
| Cooks and eats | 10,530 (−15%) | 26 (all eaten) | – | 10.3 min |

- **Numbers changed:** none. Every price, tier multiplier, magnitude and duration is as in §7, and the tier formula (`cookSec / 30`) is the one in the code and the tests.
- **Cooking beats selling raw.** Every recipe is priced at exactly `round(ingredient value × multiplier)`: T1 +25%, T2 +40%, T3 +60%, T4 +100% (a test checks all 22). In the simulation a dish fetched 1.22× what its ingredients would have at the Market (median): the 1.25 of T1, less the Market's demand drop on the dish itself.
- **Cooking is optional in hour one.** The cooking player finishes level with the farming-only one (−2%): the dish is worth 25% more, but it holds the crop back for its 15–45 seconds on the stove, and one slot cooks two turnips (55g) at a time, which cannot keep up with a field. More stove slots (Stove, Oven, Pro Kitchen) are what turn cooking into real income, and they cost 1,000g and up, well after the first hour.
- **Buffs are "nice, not needed".** A player who eats everything keeps Green Thumb up for about 40 of the 60 minutes and still finishes 15% behind, because a T1 buff (+10% growth for 6 minutes on 4 to 8 plots is worth roughly 30g) is smaller than the dish's sale price (55g). Duration doubles per tier while the sale price rises by a smaller factor, so buffs pull ahead at T3 and T4 (T4 growth is +40% for 48 minutes, 72 when hearty) and over long absences (a T4 buff spans 48 to 72 minutes of an 8 hour absence). This hour-one model does not include that.
- **Finding for phase 09.** The GDD target is "kept up well, buffs speed progression by about 10–25%". At T1 they do not pay for themselves against selling the dish. If the simulator finds the same at T2 to T4, the levers, in order of preference, are: a longer base duration (`BUFF_BASE_DURATION_MS`, 6 → 10 minutes helps every tier equally), a higher `BUFF_MAGNITUDE_PER_TIER`, or a lower `TIER_SELL_MULT` for T1 and T2 (the dishes players are most tempted to sell). Winter is already the strongest lever: hearty dishes last 50% longer for free and dishes sell 25% higher, so it is the week that rewards both eating and selling.
- **Stove time.** A T4 dish takes 3 to 4 minutes at 1× speed (`cookSec` 180 to 240). With Quick Hands +60% and the Pro Kitchen +50% (a 2.1× rate) the same dish takes about 86 to 114 seconds, and four cook at once.

### Phase 07 tuning notes
**Method.** `tests/sim/greedyPlayer.ts` has a `milestones` option: the greedy player also fishes (1.5 catches a minute, visiting every open water in turn), cooks the highest tier its bag allows while keeping the ingredients of its two best recipes, eats one dish, buys any recipe card it can afford five times over, gives what the Community Board wants to its bundles instead of selling it, and plants crops the bundles are missing. Its shopping list is `MILESTONE_SHOPPING_LIST`. The table below is `PACING_REPORT=1 MINUTES=960 SEEDS=1,2,3 npx vitest run tests/pacingReport.test.ts` (medians of three seeds, 16 simulated hours, spring calendar; the bot is faster than a person, roughly 2×, because it never dithers and always fishes and farms at once).

| Moment | Median (range over seeds) | BALANCE.md §11 target |
|---|---|---|
| Plant · harvest · first sale | 0 · 2 · 7 min | first harvest ≤ 2.5 min |
| First expansion `farm_1` (m04) | 19 min (16–22) | 6–10 min *(see below)* |
| First sprinkler placed (m05) | 21 min (17–25) | 10–15 min |
| Farmhand L1 (m09) | 25 min (23–27) | 25–40 min |
| River unlocked (m10) | 36 min (32–37) | 45–75 min |
| First T2 dish | 31 min (22–78) | 45–90 min |
| First T3 dish (m12) | 60 min (45–60) | 2–3 h |
| First T4 dish | 3.0 h (54 min–3.0 h) | 3–5 h |
| Old Dock (m13) | 85 min (85–93) | – |
| Spring Crops bundle (m14) | 25 min (25–27) | – |
| Whole farm automated | 4.0 h | 4–6 h |
| Farm Level 3 · 5 · 7 | 6 · 21 · 31 min | – |
| Farm Level 8 · 9 · 10 | 46 min · 100 min · 9.2 h (5.7–15.8 h) | Level 10 in 10–15 h |
| Farming 2 · 5 · 7 · 10 | 19 min · 64 min · 111 min · 4.6 h | – |
| Fishing 2 · 5 · 7 · 10 | 13 min · 99 min · 4.0 h · 14.7 h | – |
| Cooking 2 · 5 · 7 | 26 min · 100 min · 9.4 h | – |

(`m04_first_expansion` and `m05_first_sprinkler` show later than for the plain farming player in the table below (`farm_1` at 7 minutes, first sprinkler bought at 12) because this bot also spends its early gold on recipe cards and seeds for the bundles.)

**What was changed, and why.**
- **The XP curve is `150 × 1.5^(L − 1)`** (was `40 × 1.6^(L − 1)`, 4,514 XP for level 10; now 11,233). With the old curve a fully automated farm reached Farming 10 in about two hours, and Level 5 a minute or two after the first sale of crops. The new curve keeps the same shape (about 1.5× per level) and puts Farming 5 at about an hour of active play and Farming 10 at about 4.5 hours of play with a farmhand, the other two skills much later (they only grow when the player fishes or cooks).
- **Farm Level is a table, not `1 + floor(points / 2)`** (§8). The milestones alone are 15 points, and skill levels came quickly early, so the linear formula gave Level 10 (18 points) after an hour. The table keeps the low levels at the pace the docs assumed (a farm-only player is Level 3 with the five farming milestones, at about 15 minutes, which the farmhand and the river need) and stretches the top: Levels 7 (15 points) is where sprinkler tech II and the greenhouse open; Level 10 needs 36 of the 42 possible points, that is all fifteen milestones (the greenhouse, at the end of the chain, among them) and about 21 skill levels. A test checks that a farm-only player reaches Level 7 inside the 5.5 hours it takes them to automate the farm.
- **Goal gold is `max(20, 0.05 × estimate × 10)`** (was `max(50, 0.25 × …)`). With the full formula three goals a ten-minute stretch paid the player about 60% of their own income and pulled the river forward by ten minutes; quest gold is now around 1% of the total in the simulation (the milestone gold, which is fixed, is most of that). Goals stay worth doing for their seeds and recipe cards.
- **Milestone gold and the perks are as the docs give them, and they speed the plain farming player up.** Same greedy player as `tests/pacing.test.ts` (8 seeds for the first hour, 3 for the 5.5 hour run), phase 06 against phase 07:

  | Moment | Phase 06 | Phase 07 | Without the perks | Without milestone gold |
  |---|---|---|---|---|
  | `farm_1` | 9 min | 7 min | 7 min | 9 min |
  | First sprinkler bought | 14 min | 12 min | 12 min | 13 min |
  | Farmhand L1 | 30 min | 19 min | 19 min | 21 min |
  | River Access | 54 min | 47 min | 50 min | 51 min |
  | Whole farm automated | 4.9 h | 3.6 h | 4.8 h | 3.7 h |

  The early gains are the milestones' gold and seeds (25 + 50 + 100 gold and 5 turnip seeds before the farmhand's 800g), the late ones the Farming perks: +15% sale price, +15% growth and a 15% double harvest multiply, about 25% more income by hour four. Both are what BALANCE.md §8 and §10 specify, and both land outside the farmhand (25–40 min) and automation (4–6 h) targets, so `tests/pacing.test.ts` lowers those bounds to 17 minutes and 3.5 hours and says why. This is the first thing for phase 09 to look at: the cheapest levers are the sale-price and double-harvest perks, then the gold on `m03` and `m05`.

**Findings for phase 09.**
- **T3 and T4 arrive early.** The T3 recipe (`scholars_stew`) is the reward for Farm Level 5, which the bot reaches at 21 minutes, and `garden_banquet` (T4) for the first T3 dish. A person is slower (they have to find perch, garlic and bluegill), but the docs' 2–3 h and 3–5 h assume Level 5 comes around the first hour. If phase 09 agrees, the levers are the Level 5 threshold in `FARM_LEVEL_POINTS`, or moving the recipe reward from `m11_farm_level_5` to a later milestone.
- **Seasonal bundles and the greenhouse cannot be checked in 16 simulated hours.** The calendar starts in spring and seasons last a real week, so Summer Crops, Autumn Harvest and River & Sea (sardines and tuna are ocean fish, in season all year) need a multi-day simulation. The greenhouse milestone (m15) needs the Autumn Harvest bundle, Level 7, `farm_3` and 25,000g, and its 8–12 h target is untested.
- **Cooking XP is slow for the bot** (Cooking 7 at 9.4 h, 10 never): a dish is worth 8–64 XP and the bot cooks about one every few minutes. A person who cooks in bursts will be slower still. If Cooking 7's fourth buff slot should be a mid-game reward, raise dish XP (`COOKING_XP_BASE`) before touching the curve.
- **Fishing XP outpaces Cooking but not Farming.** The Fishing skill only grows while someone fishes or has traps; a farm-only player never leaves Level 1 in it, which is why Level 8 and up ask for some fishing or cooking.
- **Goal targets are estimates.** A goal is sized at 8 minutes × 50% of the ideal rate; the bot finishes about one every 50 minutes (16–19 in 16 hours). That is slower than the "5–15 minutes" the prompt names, because the bot spends most of its time on the milestones and its harvest goals need a crop it may not be planting. Tune `GOAL_TARGET_MINUTES` and `GOAL_EFFICIENCY` in `balance.ts` once real play data exists.
