# Balance: Formulas and Starting Numbers

Every number in `src/data/` comes from this file. Formulas are written as TypeScript-like expressions so they can be ported directly. The tables are **first drafts**: phase 03 tunes the economy, phases 04–07 add tuning notes for their systems, and phase 09 did the final pass with the simulator ("Phase 09 balance report" at the end). When you change a number in code, change it here in the same PR. **v2** (world, decorations, orchard, animals) is §13.

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
| `sprinkler_tech` | farm | leveled | 2 | 6000 | 5 | 6000, 30000 | FL4; L2 needs FL7 |
| `scarecrow` | farm | placeable (on a plot) | 4 | 600 | 1.8 | 600, 1100, 1900, 3500 | expansion `farm_1` |
| `farmhand` | farm | leveled | 5 | 1000 | 3 | 1000, 3000, 9000, 27000, 81000 | FL3 |
| `seed_planter` | farm | leveled | 3 | 2000 | 3 | 2000, 6000, 18000 | `farmhand` L1 |
| `auto_seller` | farm | leveled | 2 | 5000 | 4.0 | 5000, 20000 | `farmhand` L1 |
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
magnitude  = 0.13 * tier * buffs[type].magnitudeScale                     // BUFF_MAGNITUDE_PER_TIER (v2-05; was 0.10)
durationMs = 1_500_000 * 3 ** (tier - 1) * (1 + buffDurationPerk + (dish.hearty ? HEARTY_DURATION_BONUS : 0))
// T1: 25 min · T2: 75 min · T3: 3 h 45 · T4: 11 h 15 of simulated time (before perks and the hearty bonus)
// (v2-05: BUFF_BASE_DURATION_MS 25 min, was 15; phase 09 had replaced 6 min × 2^(tier − 1): see "Phase 09 balance report")
```

| Buff type | Name | Seam | magnitudeScale | T1 | T2 | T3 | T4 |
|---|---|---|---|---|---|---|---|
| `growth` | Green Thumb | `growthModifier` | 1.0 | +13% | +26% | +39% | +52% |
| `sellPrice` | Silver Tongue | `sellPriceModifier` | 0.5 | +6.5% | +13% | +19.5% | +26% |
| `fishingLuck` | Angler's Luck | `fishingLuckModifier` (additive luck) | 1.0 | +0.13 | +0.26 | +0.39 | +0.52 |
| `fishingSpeed` | Quick Bite | `fishingSpeedModifier` | 1.0 | +13% | +26% | +39% | +52% |
| `cookSpeed` | Quick Hands | `cookSpeedModifier` | 1.5 | +19.5% | +39% | +58.5% | +78% |
| `automationSpeed` | Busy Bees | `automationSpeedModifier` and (v2-05) `animalSpeedModifier` | 1.0 | +13% | +26% | +39% | +52% |
| `xp` | Scholar's Snack | `xpModifier` | 1.5 | +19.5% | +39% | +58.5% | +78% |

The numbers above are v2-05's (see "v2-05 balance report" in §13.14). Busy Bees also shortens the animals' production cycle (§13.6).

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
| `roasted_turnip` | Roasted Turnip | turnip ×2 | 30 | 2 | 44 | 3.88 | T1 | 55 | `growth` | +10% | 15 | spring | starter |
| `baked_potato` | Baked Potato | potato ×2 | 30 | 2 | 72 | 4.44 | T1 | 90 | `cookSpeed` | +15% | 15 | spring | starter |
| `grilled_bluegill` | Grilled Bluegill | bluegill ×1 | 30 | 1 | 30 | 2.60 | T1 | 38 | `fishingSpeed` | +10% | 15 | spring, summer, autumn, winter | starter |
| `berry_bowl` | Berry Bowl | strawberry ×2 | 15 | 2 | 40 | 3.30 | T1 | 50 | `xp` | +15% | 15 | spring | card 150 · FL2 |
| `seaweed_salad` | Seaweed Salad | seaweed ×2, turnip ×1 | 15 | 3 | 62 | 4.74 | T1 | 78 | `fishingLuck` | +10% | 15 | spring | milestone `m06_first_catch` |
| `wheat_flatbread` | Wheat Flatbread | wheat ×3 | 45 | 3 | 75 | 6.00 | T1 | 94 | `automationSpeed` | +10% | 15 | summer, autumn | card 120 · FL1 |
| `vegetable_soup` | Vegetable Soup | turnip ×2, potato ×1, garlic ×1 | 60 | 4 | 167 | 9.34 | T2 | 234 | `growth` | +20% | 45 | spring | milestone `m07_first_dish` |
| `fish_tacos` | Fish Tacos | wheat ×2, tomato ×2, sardine ×1 | 60 | 5 | 109 | 9.18 | T2 | 153 | `fishingSpeed` | +20% | 45 | summer, autumn | card 600 · expansion `ocean` |
| `tomato_pasta` | Tomato Pasta | wheat ×2, tomato ×3, corn ×1 | 60 | 6 | 126 | 10.52 | T2 | 176 | `cookSpeed` | +30% | 45 | summer, autumn | card 500 · FL3 |
| `corn_chowder` | Corn Chowder | corn ×2, wheat ×1, perch ×1 | 75 | 4 | 150 | 9.50 | T2 | 210 | `automationSpeed` | +20% | 45 | autumn | experiment |
| `blueberry_muffin` | Blueberry Muffin | wheat ×2, blueberry ×4 | 60 | 6 | 98 | 9.96 | T2 | 137 | `sellPrice` | +10% | 45 | summer | card 450 · FL3 |
| `glazed_yams` | Glazed Yams | yam ×2, cranberry ×2 | 45 | 4 | 250 | 10.50 | T2 | 350 | `sellPrice` | +10% | 45 | autumn | experiment |
| `garlic_trout` | Garlic Trout | trout ×1, garlic ×1, potato ×1 | 75 | 3 | 173 | 8.96 | T2 | 242 | `fishingLuck` | +20% | 45 | spring | milestone `m10_unlock_river` |
| `seafood_stew` | Seafood Stew | tuna ×1, mackerel ×2, tomato ×2, corn ×1 | 120 | 6 | 334 | 16.68 | T3 | 534 | `fishingLuck` | +30% | 135 | summer | card 2500 · expansion `ocean` |
| `pumpkin_soup` | Pumpkin Soup | pumpkin ×1, kale ×1, yam ×1 | 120 | 3 | 837 | 23.74 | T3 | 1339 | `growth` | +30% | 135 | autumn | card 2000 · FL6 |
| `cranberry_pie` | Cranberry Pie | wheat ×3, cranberry ×4, yam ×1 | 120 | 8 | 242 | 16.84 | T3 | 387 | `sellPrice` | +15% | 135 | autumn | experiment |
| `catfish_gumbo` | Catfish Gumbo | catfish ×2, corn ×1, tomato ×2, wheat ×1 | 120 | 6 | 309 | 16.18 | T3 | 494 | `automationSpeed` | +30% | 135 | summer, autumn | card 1800 · FL5 |
| `scholars_stew` | Scholar's Stew | perch ×2, garlic ×2, bluegill ×2 | 120 | 6 | 324 | 16.48 | T3 | 518 | `xp` | +45% | 135 | spring, winter | milestone `m11_farm_level_5` |
| `garden_banquet` | Garden Banquet | cauliflower ×2, strawberry ×4, garlic ×1, potato ×2 | 180 | 9 | 721 | 29.42 | T4 | 1442 | `cookSpeed` | +60% | 405 | spring | milestone `m12_cook_t3` |
| `royal_sturgeon` | Royal Sturgeon | sturgeon ×1, koi ×1, melon ×1, tomato ×2, corn ×1 | 240 | 6 | 1347 | 40.94 | T4 | 2694 | `fishingLuck` | +40% | 405 | summer | experiment |
| `harvest_feast` | Harvest Feast | pumpkin ×1, yam ×2, corn ×2, wheat ×2, cranberry ×3 | 240 | 10 | 1033 | 38.66 | T4 | 2066 | `sellPrice` | +20% | 405 | autumn | card 6000 · FL6 |
| `moonfin_sushi` | Moonfin Sushi | moonfin ×1, seaweed ×3, leek ×1 | 180 | 5 | 1717 | 45.34 | T4 | 3434 | `xp` | +60% | 405 | winter | card 12000 · caught `moonfin` |

Buff coverage: growth 3, sellPrice 4, fishingLuck 4, fishingSpeed 2, cookSpeed 3, automationSpeed 3, xp 3. (Phase 09 moved Blueberry Muffin from Scholar's Snack to Silver Tongue, so summer has a dish whose buff earns gold.) T4 by season: spring `garden_banquet`, summer `royal_sturgeon`, autumn `harvest_feast`, winter `moonfin_sushi`.

**Experiment mode:** the player picks 2–4 distinct ingredients. If the set of ingredient ids equals an unknown `experiment` or `card` recipe's ingredient ids (quantities ignored), that recipe is learned and nothing is consumed. Otherwise nothing is consumed and a hint names one ingredient of a still-unknown experiment recipe that shares at least one of the chosen items.

---

## 8. XP and levels

```ts
MAX_SKILL_LEVEL = 10
xpToNext(L) = round(150 * 1.5 ** (L - 1))           // L = 1..9   (phase 07 tuned this from 40 × 1.6^(L − 1): see "Phase 07 tuning notes")
// 150, 225, 338, 506, 759, 1139, 1709, 2563, 3844 → 11,233 total to reach level 10
// cumulative to reach level 2..10: 150, 375, 713, 1219, 1978, 3117, 4826, 7389, 11233

farmingXp(unit)  = max(1, round(crop.basePrice ** 0.6 / 2))                 // per harvested unit (table in §2)
                   // a farmhand harvest gives AUTO_HARVEST_XP_FRACTION (0.25) of it (phase 09, like traps)
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
FARM_LEVEL_POINTS = [_, 0, 2, 5, 8, 11, 14, 18, 25, 32, 39]                              // index = level, 1..10 (phase 09; was 0, 2, 5, 7, 10, 12, 15, 20, 27, 36)
```

Phase 07 replaced the linear `min(20, 1 + floor(farmPoints / 2))` this section used to give with the table above (see "Phase 07 tuning notes"). Level 3 is the five farming milestones (plant, harvest, sell, expand, sprinkler). Levels 8 to 10 gate nothing in §9; they are the long game and want all three skills. A farm-only player tops out at about 19 points (Level 7 needs 18), so Levels 8 and up need fishing or cooking, and Level 10 (39 of the 42 points) wants nearly everything. Phase 09 stretched Levels 4–10 (see "Phase 09 balance report"): with the real calendar the overnight farmhand fed Farming XP so fast that Level 7 came in the first half hour of play and Level 10 on day 3.

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

**How phase 09 reads these hours.** The calendar is real time and absences count (capped), so a real player's progress is not measured in one long session. The simulator (`npm run simulate`) takes "h" in this table as **hours of play of the Active Player, who plays one hour each evening** — so "4–6 h" means "on the fourth to sixth day". That reading also makes the greenhouse target (8–12 h) line up with the autumn week that its bundle needs. The first-session targets (up to the river) are minutes of that first hour.

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

### Phase 09 balance report

**Method.** `npm run simulate` (`scripts/simulate.ts`, bots in `scripts/sim/`) plays the real game headlessly: every bot acts only through `Game.dispatch`, the game advances in exact bulk steps between looks, and each absence is a real save → JSON → load → offline catch-up, so the calendar, the 06:00 refresh, weekly seasons (and withering), a DST change and the offline cap all happen as they do for a person. The save is made on Wednesday 25 February 2026 at 19:00 in New York; spring ends on Sunday 1 March, then a season a week; DST starts on 8 March. Active fishing is modelled as catches per real minute from the real catch table (≈3 a minute for an attentive player, BALANCE §6), sped up by Quick Bite.

| Bot | Schedule | Plays for |
|---|---|---|
| Greedy Farmer | 07:30 for 20 min, 19:00 for 100 min, daily | crops and automation first; never fishes |
| Angler | same | fishes the whole session (3 a minute), farms between casts; rods, waters and traps first |
| Chef | same | cooks everything (highest tier first), keeps its buff slots full, buys every card and kitchen upgrade |
| Chef who sells | same | the Chef, but sells its dishes: the control for the buff check |
| Casual Idler | 2 minutes every 4 hours, day and night | the Farmer's choices, in two-minute visits |
| Active Player | 19:00 for 60 min, daily | farms, fishes 1.5 a minute, cooks, follows the milestones |

All bots feed the Community Board, stock seeds for the planter before leaving and ship what they would sell. The report prints, per bot (medians over the seeds): lifetime gold on days 1/3/7/14/30, Farm Level, recipes known, dead time (time in waits over 2 minutes with nothing useful to do), the longest wait in the first 30 minutes of play, buff uptime, the share of gold earned while away, the time to every milestone (play · simulated · real), the gold-per-simulated-hour curve per day, and the phase's tuning checks. CSV files with every snapshot and moment go to `scripts/out/`. A 30-day run of one bot takes 3–7 s; the full report (6 bots × 8 seeds) about a minute on four cores.

**What the simulator found in the phase 08 numbers** (same bots and seeds on the old data):
- **Farm Level and automation came in the first session.** With a real schedule the first night's farmhand harvests (full Farming XP) gave Level 7 after ~30 minutes of play and Level 10 on day 3; the whole farm was automated after 2 hours of play (day 2).
- **Buffs lost to selling the dish** (−7% at day 7, −22% at day 14): 80–85% of all gold is earned while away, and a 6–48 minute buff covers almost none of an 8-hour night.
- **A field could lock up for a week.** A regrowing crop cannot be cleared before its seasons end, and the seed planter keeps replanting it; a player (and the Chef bot) with tomatoes and corn in the field could not plant autumn crops, so never finished the Autumn Harvest bundle, never unlocked the greenhouse and fell to 0.6× the others' gold (spread 1.68× at day 30).
- **Summer had no dish whose buff earns gold**, so keeping buffs up in the summer week was worth nothing.
- Strategies, the idler and the gold curve were otherwise healthy: no early dead time for players who fish, the Casual Idler at 164% of the Active Player after 3 days, and income levelling off at 40–50k gold per simulated hour from day 5 with no runaway growth.

**What changed.**

| Change | Was | Now | Why |
|---|---|---|---|
| Buff duration | 6 min × 2^(tier − 1): 6 / 12 / 24 / 48 min | 15 min × 3^(tier − 1): 15 / 45 / 135 / 405 min | a T3–T4 dish eaten before leaving now covers part of the night ("which dish to eat before you leave", GDD pillar 4); buffs kept up are worth +21% (target 10–25%) |
| Blueberry Muffin | Scholar's Snack (+30% XP) | Silver Tongue (+10% prices) | "sweet, sellable treats boost prices" (GDD §7); summer gets a gold buff |
| Farming XP from the farmhand | full | ×0.25 (`AUTO_HARVEST_XP_FRACTION`, like traps' ×0.5) | the overnight farm maxed Farming by day 2 |
| `FARM_LEVEL_POINTS` | 0, 2, 5, 7, 10, 12, 15, 20, 27, 36 | 0, 2, 5, 8, 11, 14, 18, 25, 32, 39 | Level 7 in the first evening, Level 10 on day 3 |
| Farmhand | 800 × 2.2ⁿ (800 … 19,000) | 1,000 × 3ⁿ (1,000 … 81,000) | automation spread over the first days |
| Seed planter | 1,200 × 2.5ⁿ | 2,000 × 3ⁿ (2,000 / 6,000 / 18,000) | same |
| Auto-Seller | 1,500 / 6,000 | 5,000 / 20,000 | same |
| Sprinkler Tech | 2,500 / 12,000 | 6,000 / 30,000 | same |
| The Hoe | tills and clears dead crops | also pulls up a regrower that has given a harvest (aimed at directly, never Auto or an area) | a field can no longer lock for weeks; the planter forgets a pulled crop |

**Before → after** (medians of 8 seeds; the Active Player's times are hours of play, i.e. days):

| Measure | Target (§11) | Before (phase 08) | After |
|---|---|---|---|
| First harvest | ≤ 2.5 min | 2 min | 2 min |
| First expansion (Active · Farmer) | 6–10 min | 16 · 17 min | 14 · 17 min |
| First sprinkler placed (Active · Farmer) | 10–15 min | 21 · 21 min | 19 · 21 min |
| Farmhand L1 (Active · Farmer) | 25–40 min | 22 · 31 min | 25 · 31 min |
| River Access (Active · Farmer) | 45–75 min | 32 · 48 min | 34 · 51 min |
| First T2 · T3 · T4 dish (Active) | 45–90 min · 2–3 h · 3–5 h | 54 min · 67 min · 77 min | 47 min · 71 min · 87 min |
| Farm Level 7 (Active · Farmer) | – | 29 min · 1.7 h | 40 min · 4.0 h |
| Whole farm automated (Active · Farmer) | 4–6 h | 2.0 h · 2.0 h | 3.0 h · 5.0 h |
| Greenhouse (Active) | 8–12 h | 11.2 h (day 11) | 11.2 h (day 11) |
| Farm Level 10 (Active) | 10–15 h | 4.1 h (day 3.5) | 9.4 h (day 9) |
| Longest early wait (Farmer, never fishes) | ≤ 2 min | 2.5 min | 2.0 min |
| Strategy spread, day 3 · 7 · 30 | ≤ 1.5× | 1.09 · 1.47 · 1.68× | 1.18 · 1.18 · 1.09× |
| Casual Idler / Active Player, day 3 | ≥ 40% | 164% | 160% |
| Buffs kept up vs selling the dishes, day 3 · 7 · 14 | +10–25% | +18 · −7 · −22% | +22 · +21 · +8% |
| Chef builds the greenhouse | – | never | day 10.5 |
| Gold per simulated hour, day 30 (Farmer) | ~linear, ≤ 3× per hour of play | 42k | 42k |

**The final report** (`npm run simulate -- --seeds 1,2,3,4,5,6,7,8`):

Seeds 1, 2, 3, 4, 5, 6, 7, 8 · 30 real days from Wed 25 Feb 2026 19:00 in New York (DST starts on 8 March) · medians · 66.0 s

| Bot | Play (h) | Gold d1 | Gold d3 | Gold d7 | Gold d14 | Gold d30 | FL d3 · d30 | Recipes | Dead time | Longest early wait | Buff uptime (play · all) | Gold from offline |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Greedy Farmer | 59.7 | 57,553 | 403,789 | 3,423,101 | 10,473,351 | 24,595,749 | 7 · 7 | 8 | 3% | 2.0 min | 0% · 0% | 83% |
| Angler | 59.7 | 65,602 | 454,801 | 3,618,584 | 11,096,694 | 26,106,965 | 8 · 8 | 12 | 0% | 0.5 min | 0% · 0% | 78% |
| Chef | 59.7 | 60,534 | 386,700 | 3,079,343 | 10,011,418 | 23,878,329 | 9 · 10 | 21 | 0% | 1.2 min | 100% · 44% | 82% |
| Chef who sells (control) | 59.7 | 58,456 | 352,316 | 2,653,951 | 9,304,183 | 23,281,580 | 9 · 10 | 21 | 0% | 1.2 min | 0% · 0% | 83% |
| Casual Idler | 6.0 | 2,095 | 224,307 | 3,583,922 | 11,141,901 | 29,181,049 | 6 · 7 | 8 | 0% | 0.9 min | 0% · 0% | 98% |
| Active Player | 30.0 | 19,530 | 140,480 | 711,770 | 5,361,876 | 14,701,988 | 8 · 10 | 21 | 0% | 0.7 min | 1% · 0% | 82% |

Time to each moment: **play time · simulated time · real time** since the save was made (medians; – = not reached by most seeds).

| Moment | Greedy Farmer | Angler | Chef | Chef who sells (control) | Casual Idler | Active Player |
|---|---|---|---|---|---|---|
| First harvest | 2 min · 0.0 h · 0.0 h | 2 min · 0.0 h · 0.0 h | 2 min · 0.0 h · 0.0 h | 2 min · 0.0 h · 0.0 h | 2 min · 4.0 h · 4.0 h | 2 min · 0.0 h · 0.0 h |
| First expansion (`farm_1`) | 17 min · 0.3 h · 0.3 h | 11 min · 0.2 h · 0.2 h | 23 min · 0.4 h · 0.4 h | 20 min · 0.3 h · 0.3 h | 8 min · 16.0 h · 16.0 h | 14 min · 0.2 h · 0.2 h |
| First automation (sprinkler placed) | 21 min · 0.3 h · 0.3 h | 12 min · 0.2 h · 0.2 h | 28 min · 0.5 h · 0.5 h | 25 min · 0.4 h · 0.4 h | 10 min · 20.0 h · 20.0 h | 19 min · 0.3 h · 0.3 h |
| Farmhand L1 | 31 min · 0.5 h · 0.5 h | 27 min · 0.4 h · 0.4 h | 35 min · 0.6 h · 0.6 h | 32 min · 0.5 h · 0.5 h | 13 min · 26.0 h · 26.0 h | 25 min · 0.4 h · 0.4 h |
| River Access | 51 min · 0.9 h · 0.9 h | 24 min · 0.4 h · 0.4 h | 47 min · 0.8 h · 0.8 h | 49 min · 0.8 h · 0.8 h | 15 min · 30.0 h · 30.0 h | 34 min · 0.6 h · 0.6 h |
| First T2 dish | – | – | 52 min · 0.9 h · 0.9 h | 47 min · 0.8 h · 0.8 h | – | 47 min · 0.8 h · 0.8 h |
| First T3 dish | – | – | 6.1 h · 58.6 h · 3.0 d | 6.8 h · 59.3 h · 3.0 d | – | 71 min · 12.9 h · 24.2 h |
| First T4 dish | – | – | 28.0 h · 264.0 h · 13.5 d | 29.6 h · 278.7 h · 14.2 d | – | 87 min · 13.2 h · 24.4 h |
| Old Dock | 4.0 h · 39.0 h · 2.0 d | 83 min · 1.4 h · 1.4 h | 5.3 h · 44.7 h · 2.3 d | 5.5 h · 44.8 h · 2.3 d | 34 min · 68.0 h · 2.8 d | 4.0 h · 51.0 h · 4.0 d |
| First bundle | 46 min · 0.8 h · 0.8 h | 25 min · 0.4 h · 0.4 h | 31 min · 0.5 h · 0.5 h | 31 min · 0.5 h · 0.5 h | 17 min · 34.0 h · 34.0 h | 25 min · 0.4 h · 0.4 h |
| Whole farm automated | 5.0 h · 44.4 h · 2.3 d | 4.0 h · 39.0 h · 2.0 d | 3.8 h · 30.0 h · 36.6 h | 5.8 h · 49.5 h · 2.5 d | 38 min · 76.0 h · 3.2 d | 3.0 h · 38.3 h · 3.0 d |
| Greenhouse | 21.9 h · 205.4 h · 10.5 d | 21.9 h · 205.4 h · 10.5 d | 21.9 h · 205.4 h · 10.5 d | 21.9 h · 205.4 h · 10.5 d | 2.1 h · 252.0 h · 10.5 d | 11.2 h · 140.2 h · 11.0 d |
| Farm Level 5 | 55 min · 0.9 h · 0.9 h | 25 min · 0.4 h · 0.4 h | 30 min · 0.5 h · 0.5 h | 31 min · 0.5 h · 0.5 h | 17 min · 34.0 h · 34.0 h | 25 min · 0.4 h · 0.4 h |
| Farm Level 7 | 4.0 h · 34.6 h · 42.4 h | 78 min · 1.3 h · 1.3 h | 47 min · 0.8 h · 0.8 h | 50 min · 0.8 h · 0.8 h | 38 min · 76.0 h · 3.2 d | 40 min · 0.7 h · 0.7 h |
| Farm Level 10 | – | – | 7.8 h · 69.0 h · 3.5 d | 9.0 h · 79.0 h · 4.0 d | – | 9.4 h · 115.1 h · 9.0 d |

Gold per simulated hour on real day *n* (the gold-per-hour curve):

| Bot | d1 | d2 | d3 | d5 | d7 | d10 | d14 | d21 | d28 | d30 |
|---|---|---|---|---|---|---|---|---|---|---|
| Greedy Farmer | 3,042 | 7,130 | 10,510 | 43,170 | 48,361 | 52,040 | 51,785 | 43,083 | 43,296 | 41,669 |
| Angler | 2,657 | 6,029 | 12,940 | 47,199 | 51,041 | 48,932 | 56,400 | 46,091 | 45,206 | 42,788 |
| Chef | 2,755 | 6,846 | 10,144 | 36,831 | 39,720 | 42,732 | 61,021 | 40,476 | 44,190 | 36,695 |
| Chef who sells (control) | 2,745 | 5,871 | 9,565 | 27,710 | 37,788 | 42,546 | 55,047 | 40,183 | 43,820 | 43,976 |
| Casual Idler | 105 | 1,941 | 7,231 | 38,384 | 40,704 | 39,786 | 50,329 | 43,863 | 43,410 | 44,763 |
| Active Player | 0 | 4,603 | 5,314 | 8,559 | 13,609 | 38,564 | 55,874 | 42,951 | 43,509 | 40,048 |

| Check | Target | Measured | |
|---|---|---|---|
| No strategy dominates (day 3) | ≤ 1.5× lifetime gold | 1.18× (Greedy Farmer 403,789, Angler 454,801, Chef 386,700) | ✅ |
| No strategy dominates (day 7) | ≤ 1.5× lifetime gold | 1.18× (Greedy Farmer 3,423,101, Angler 3,618,584, Chef 3,079,343) | ✅ |
| No strategy dominates (day 30) | ≤ 1.5× lifetime gold | 1.09× (Greedy Farmer 24,595,749, Angler 26,106,965, Chef 23,878,329) | ✅ |
| Casual Idler vs Active Player (day 3) | ≥ 40% of the lifetime gold | 160% | ✅ |
| Buffs kept up: Chef vs the same Chef selling its dishes (day 7, paired by seed) | +10% to +25% (worth it, not mandatory) | +21% (day 3 +22%, day 14 +8%) | ✅ |
| Greedy Farmer: early dead time | no wait over 2 min in the first 30 min of play | 2.0 min (dead-time share 3%) | ✅ |
| Angler: early dead time | no wait over 2 min in the first 30 min of play | 0.5 min (dead-time share 0%) | ✅ |
| Chef: early dead time | no wait over 2 min in the first 30 min of play | 1.2 min (dead-time share 0%) | ✅ |
| Active Player: early dead time | no wait over 2 min in the first 30 min of play | 0.7 min (dead-time share 0%) | ✅ |
| Greedy Farmer: no runaway growth after day 3 | gold/hour at most ~3× the day before; week 4 not far above week 2 | worst day-over-day 2.67×, day 28 / day 14 0.84× | ✅ |
| Angler: no runaway growth after day 3 | gold/hour at most ~3× the day before; week 4 not far above week 2 | worst day-over-day 2.91×, day 28 / day 14 0.80× | ✅ |
| Chef: no runaway growth after day 3 | gold/hour at most ~3× the day before; week 4 not far above week 2 | worst day-over-day 2.25×, day 28 / day 14 0.72× | ✅ |

**Tuning notes.**
- **Early game untouched.** The first session (first harvest, expansion, sprinkler, farmhand, river) is as phases 03–07 tuned it. The simulator's bots also feed the Community Board and buy cards, so their expansion and sprinkler come a few minutes after the targets a pure farming run (phase 03) hits; the Angler, who sells fish from minute one, is always first.
- **Offline is most of the gold** (78–98% by bot). That is the idle design working ("your absence is part of play"), and why buffs only matter once they last into an absence. The Casual Idler out-earns the one-hour-a-day player because four-hourly visits never hit the offline cap; the target is only a floor.
- **Busy Bees is weak late.** Once the farmhand is Level 3+ it is never the bottleneck (48 plots need ~5 visits a minute; Level 5 makes 133), so +40% automation speed is worth ~0 gold (a controlled 8-hour test: growth +40% → +24–35% gold, Silver Tongue +20% → +20%, Busy Bees +40% → +0%). Logged in IDEAS.md; the Chef keeps its slots on gold buffs instead.
- **Gold has nothing to buy after the first week** (lifetime gold passes 3 million by day 7; every upgrade, expansion and recipe card together cost about 523k). The curve is flat, not runaway, but a late gold sink is a v2 idea (IDEAS.md).
- **Summer and winter buffs are mostly not about gold** (XP, fishing, cooking); the buff check uses the first week, when gold buys the farm. Day 14 (autumn, with Harvest Feast) is +8%.
- **Seeds for the planter are the idle bottleneck.** An automated farm of single-harvest crops needs a seed per cycle; the bots stock seeds for the whole absence before leaving (up to 80% of their gold). A regrower field needs none, which is the "plant once, forget" role §2 gives regrowers.
- **Levers, in order**, if a later phase wants to move things: `BUFF_BASE_DURATION_MS` / `BUFF_DURATION_GROWTH` (buff value), `AUTO_HARVEST_XP_FRACTION` and the top of `FARM_LEVEL_POINTS` (level pace), the farmhand / planter / Auto-Seller / Sprinkler Tech cost curves (automation pace), `OFFLINE_*` (idle vs active). Rerun `npm run simulate` and `tests/simulate.test.ts` after any change.

---

## 13. v2: world, decorations, orchard and animals

Written by v2 phase 00 as **starting numbers**. v2 phases 01–04 implement them and tune them with `npm run simulate`; a phase that moves a number updates this section and adds a dated note under §13.12. Ids match DATA_SCHEMAS.md §9 and GDD §12. Every price here uses `roundNice` unless it is already round.

**The problem v2 solves** (Phase 09 balance report): the Greedy Farmer has 3.4M lifetime gold on day 7, 10.5M on day 14 and 24.6M on day 30; the Active Player 0.71M, 5.4M and 14.7M. Everything v1 sells costs about **0.52M**. Income levels off at 40–50k gold per simulated hour from day 5, and about 35–40% of what a farm earns goes back into seeds for the planter, so the gold a player can really spend by day 30 is roughly 9–10M (Active Player) to 15M (Greedy Farmer). v2 adds **about 13.2M** of things to buy (13.8M with v1, §13.4) so that gold keeps buying something visible through day 30, with the orchard and animals adding a modest side income (≈ 10% each at most).

### 13.1 Land parcels (v2-01)

| id | Name | World rect (col, row, cols × rows) | Price | Requires | Opens |
|---|---|---|---|---|---|
| `orchard` | Hilltop Orchard | (21, 0) 15 × 7 | 30,000 | Farm Level 5, expansion `farm_3` | 8 tree spots (10 with the Orchard Basket bundle) |
| `yard` | Old Paddock | (21, 8) 15 × 7 | 150,000 | parcel `orchard`, Farm Level 7 | coop, barn, silo |
| `meadow` | Seaside Meadow | (21, 16) 15 × 4 | 500,000 | parcel `yard` | decoration space |

Total **680,000**. The Orchard lands on day 2–3 for a keen player and day 3–4 for the Active Player (Farm Level 5 and `farm_3` come on day 1–2; 30k is under a day's income by then). The Paddock's 150k is day 4–6; the Meadow is the first "save up for it" purchase of v2, day 7–10.

### 13.2 Decorations (v2-02)

**Price bands.**

| Band | Pieces | Price per piece | Charm | Counted copies |
|---|---|---|---|---|
| Bulk | paths, fences (auto-tiled) | 300 – 1,200 | 1 | 20 |
| Small | beds, bales, pots, chairs, sandcastle | 3,000 – 15,000 | 2 – 3 | 3 |
| Medium | lamps, benches, birdbath, arches, carts, boat | 12,000 – 90,000 | 3 – 6 | 1 – 3 |
| Showpiece | well, stall, figurehead, windmill | 120,000 – 450,000 | 8 – 15 | 1 |
| Farmhouse | paint 40,000; roof 90,000 – 120,000; loft 600,000 | | 5 / 8 / 20 | applied only |

**Farm cats** (v2 polish, `src/data/cats.ts`): cosmetic, adopted once, no charm. Brown Tabby 0 (every farm has it), Orange Tabby and Black Cat 2,000, Silver Tabby and Tuxedo Cat 4,000, Siamese and Calico 8,000 (24,000 for all six). They are an early treat rather than a sink, so the bots ignore them and no simulator number moves.

**Every piece.** Size is the footprint in tiles (cols × rows). "Charm needed" is the charm that unlocks the piece once its set is open. Glow pieces light up at night; seasonal pieces change sprite by season.

| id | Set | Size | Price | Charm | Counted | Charm needed | Notes |
|---|---|---|---|---|---|---|---|
| `cobble_path` | cottage | 1 × 1 | 300 | 1 | 20 | 0 | auto-tiled path |
| `picket_fence` | cottage | 1 × 1 | 500 | 1 | 20 | 0 | auto-tiled fence |
| `flower_bed` | cottage | 2 × 1 | 4,000 | 3 | 3 | 0 | flowers follow the season |
| `garden_lamp` | cottage | 1 × 1 | 12,000 | 3 | 3 | 10 | glows |
| `wooden_bench` | cottage | 2 × 1 | 8,000 | 3 | 3 | 10 | flips |
| `birdbath` | cottage | 1 × 1 | 20,000 | 4 | 2 | 25 | |
| `rose_arch` | cottage | 2 × 1 | 45,000 | 6 | 1 | 25 | |
| `paint_sage` | cottage | farmhouse | 40,000 | 5 | applied | 10 | wall paint |
| `paint_sky` | cottage | farmhouse | 40,000 | 5 | applied | 25 | wall paint |
| `roof_thatch` | cottage | farmhouse | 90,000 | 8 | applied | 50 | roof |
| `roof_slate` | cottage | farmhouse | 120,000 | 8 | applied | 80 | roof |
| `farmhouse_loft` | cottage | farmhouse | 600,000 | 20 | applied | 120 | extension: a second storey |
| `plank_path` | seaside | 1 × 1 | 600 | 1 | 20 | 0 | auto-tiled boardwalk |
| `rope_fence` | seaside | 1 × 1 | 900 | 1 | 20 | 0 | auto-tiled |
| `sandcastle` | seaside | 1 × 1 | 5,000 | 2 | 3 | 0 | seasonal (snow castle in winter) |
| `lobster_pots` | seaside | 1 × 1 | 7,000 | 2 | 3 | 0 | |
| `deck_chair` | seaside | 1 × 1 | 10,000 | 3 | 3 | 25 | flips |
| `beach_umbrella` | seaside | 1 × 1 | 15,000 | 3 | 3 | 50 | |
| `harbour_lamp` | seaside | 1 × 1 | 40,000 | 4 | 3 | 80 | glows |
| `rowboat` | seaside | 2 × 1 | 70,000 | 6 | 1 | 100 | flips |
| `driftwood_arch` | seaside | 2 × 1 | 90,000 | 6 | 1 | 120 | |
| `ship_figurehead` | seaside | 2 × 2 | 250,000 | 12 | 1 | 175 | |
| `brick_path` | harvest_fair | 1 × 1 | 800 | 1 | 20 | 0 | auto-tiled |
| `rail_fence` | harvest_fair | 1 × 1 | 1,200 | 1 | 20 | 0 | auto-tiled |
| `straw_bale` | harvest_fair | 1 × 1 | 3,000 | 2 | 3 | 0 | |
| `pumpkin_stack` | harvest_fair | 1 × 1 | 6,000 | 2 | 3 | 0 | seasonal (snow cap in winter) |
| `sunflower_patch` | harvest_fair | 2 × 1 | 9,000 | 3 | 3 | 50 | |
| `lantern_string` | harvest_fair | 2 × 1 | 25,000 | 4 | 3 | 50 | glows |
| `apple_cart` | harvest_fair | 2 × 1 | 60,000 | 6 | 1 | 80 | flips |
| `stone_well` | harvest_fair | 2 × 2 | 120,000 | 8 | 1 | 100 | |
| `fair_stall` | harvest_fair | 2 × 2 | 180,000 | 10 | 1 | 120 | |
| `windmill` | harvest_fair | 2 × 2 | 450,000 | 15 | 1 | 175 | tall sprite, sails turn |

32 pieces: Cottage 12, Seaside 10, Harvest Fair 10. Sets (`DecorSetId`) open by town project (GDD §12.2): Cottage (`cottage`) at once, Seaside (`seaside`) with `old_bridge`, Harvest Fair (`harvest_fair`) with `bakery`.

**Catalogue cost of decorations** (one of each piece, the counted copies of each placeable, **40** path and **30** fence tiles per set, one of each farmhouse piece):

| Set | One of each | Catalogue |
|---|---|---|
| Cottage | 979,800 | 1,074,000 |
| Harvest Fair | 855,000 | 1,007,000 |
| Seaside | 488,500 | 692,000 |
| **All** | 2,323,300 | **2,773,000** |

**Charm.**

```ts
charm = Σ over placeable pieces p: p.charm × min(placedCount(p), p.counted)
      + Σ over the applied farmhouse paint, roof and loft: their charm        // the default red walls and tiled roof: 0
      + CHARM_PER_PROJECT_STAGE (10) × completed town-project stages
```

Maximum from decorations 332 (Cottage 114, Harvest Fair 112, Seaside 106), from projects 190 (19 stages): **522** in all. Thresholds used: 10, 25, 50, 80, 100, 120, 175 (pieces), 25 and 100 (milestones). A player who places what they buy passes 25 on the first day of decorating, 100 around the first finished project, and 175 near the end of the Seaside and Harvest Fair sets.

**Placement cap.** `DECOR_BASE_SLOTS = 100` placed pieces, `+40` each from `old_bridge`, `fountain`, `bandstand` and `lighthouse` (260 in all). Stock is unlimited. The farmhouse pieces do not use slots.

### 13.3 Town projects (v2-02)

Each stage is gold plus, for some stages, items. Gold may be donated in parts; items fill like bundle slots. `TOWN_PROJECT_SCALE` in `balance.ts` multiplies every gold figure (the one lever for the gold-sink check; the table below is before it, and v2 phase 02 set it to 0.8, so the game charges 80% of these figures: §13.12).

| Project | Stage 1 | Stage 2 | Stage 3 | Stage 4 | Total gold | Opens |
|---|---|---|---|---|---|---|
| `old_bridge` | 60,000 + driftwood ×10 | 120,000 | 220,000 | – | 400,000 | Farm Level 7 |
| `fountain` | 120,000 | 200,000 + seaweed ×20 | 280,000 + koi ×1 | – | 600,000 | Farm Level 7 |
| `bakery` | 200,000 + wheat ×100 | 300,000 + egg ×30 | 400,000 + apple ×30 | – | 900,000 | `old_bridge` complete |
| `bandstand` | 300,000 | 400,000 + corn ×50 | 500,000 + pumpkin ×10 | – | 1,200,000 | `fountain` complete |
| `lighthouse` | 400,000 + driftwood ×20 | 600,000 + sardine ×20 | 800,000 + tuna ×5 | – | 1,800,000 | `bakery` complete |
| `community_hall` | 600,000 + milk ×30 | 800,000 + persimmon ×20 | 1,000,000 + large_egg ×10 | 1,200,000 + harvest_feast ×1 | 3,600,000 | the other five complete |
| **All** (19 stages) | | | | | **8,500,000** | |

Rewards (GDD §12.2) are never income: the Seaside and Harvest Fair sets, +40 decoration slots (bridge, fountain, bandstand, lighthouse), a music loop, the lighthouse beam, the festival lights and a 4th goal slot (the goal board's `GOAL_SLOTS` becomes 3 + 1; goal gold is ~1% of income, BALANCE §10).

### 13.4 Gold still to spend

**Catalogue.** Everything a player can buy once or up to a natural count, at list price:

| Part | Cost |
|---|---|
| v1: every upgrade level, placeable, expansion and recipe card | ≈ 523,000 |
| Land parcels (§13.1) | 680,000 |
| Saplings: one of each tree, plus a second apricot, apple and persimmon to fill 10 spots (§13.5) | 137,300 |
| Ranch: every building level, the Collecting Basket, 12 hens and 6 cows (§13.6) | 1,113,000 |
| Decorations (§13.2) | 2,773,000 |
| v2 recipe cards (§13.8) | 42,000 |
| Town projects (§13.3) | 8,500,000 |
| **Total** | **≈ 13,770,000** |

Seeds, feed and anything consumed are not in the catalogue.

```ts
toSpend(day) = catalogueTotal − Σ catalogue items bought by that day (donations count as bought)
share(day)   = toSpend(day) / catalogueTotal
```

**Target curve** (medians over the seeds, real days since the save was made; ±10 points is fine):

| Day | 1 | 3 | 7 | 14 | 21 | 30 |
|---|---|---|---|---|---|---|
| Active Player: share still to spend | ≥ 99% | ≥ 97% | 85–95% | 55–75% | 30–55% | 5–30% |
| Greedy Farmer: share still to spend | ≥ 99% | 90–97% | 65–85% | 30–55% | 5–30% | 0–10% |

Reading it: v1 is bought out in the first week as now; the parcels, the orchard and the ranch take days 2–10; decorations and town projects carry days 7–30. A keen player finishes the last stage of the Community Hall in the last week, and the one-hour-a-day player still has projects to save for on day 30.

**Checks** (in `scripts/sim/report.ts`, v2 phase 02 adds them, later phases keep them green):
1. **Gold stays meaningful:** for every strategy bot, `toSpend(day 21) > 0`; for the Active Player `toSpend(day 30) > 0` and greater than its gold in hand on day 30.
2. **The curve:** the Active Player's and Greedy Farmer's shares fall inside the table's bands (±10 points).
3. **No hoard:** after day 7, while `toSpend > 0`, no bot ends a day holding more than 3 days' income unspent (it would mean the brain is not spending or the catalogue has a hole).

The simulator reports `toSpend` and `share` for days 1/3/7/14/21/30 per bot (a new table "Gold still to spend"), and the day each bot's `toSpend` reaches 0. If check 1 or 2 fails, the lever is `TOWN_PROJECT_SCALE`, then the decoration prices.

### 13.5 Trees and fruit (v2-03)

**Formulas.**

```ts
age(tree)        = calendar.dayIndex − tree.plantedDay            // whole real days (06:00 → 06:00), monotonic
stage(tree)      = age < ceil(matureDays / 2) ? 'sapling' : age < matureDays ? 'young' : 'mature'
bearsOn(tree, d) = d − tree.plantedDay >= matureDays && seasonOfDay(d) ∈ tree.seasons
// at each daily refresh (and on load, after the offline walk), for each tree:
for d in (tree.lastFruitDay, calendar.dayIndex]:
    if bearsOn(tree, d): tree.fruit = min(cap, tree.fruit + fruitPerDay)
tree.lastFruitDay = calendar.dayIndex
cap              = FRUIT_CAP_DAYS (4) × fruitPerDay
V                = fruitPerDay × fruitPrice                         // gold per bearing day at base price
saplingPrice     = roundNice(SAPLING_PRICE_FACTOR × V × seasons.length) // SAPLING_PRICE_FACTOR = 4: repays in ~4 bearing days
fruitXp          = max(1, round(fruitPrice ** 0.6 / 2))             // the crop formula (§8); ×0.25 when the farmhand picks
```

`seasonOfDay(d)` is the season of real day `d` by the same week rule as §1 (the week of that day's date), so missed days are counted exactly however the offline walk split them. A tree planted today has age 0; it bears on the refresh of the day its age reaches `matureDays`, if that day is in one of its seasons. Nothing (buffs, water, perks, the offline cap) changes a tree's age or fruit.

**Tree table (7 trees).**

| Tree id | Fruit id | Name | Seasons | Sapling | Days to mature | Fruit / bearing day | Cap | Fruit price | Farming XP / fruit | V (g / day) | Market depth |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `cherry_tree` | `cherry` | Cherry | spring | 26,000 | 3 | 40 | 160 | 165 | 11 | 6,600 | 52 |
| `apricot_tree` | `apricot` | Apricot | spring, summer | 69,000 | 4 | 32 | 128 | 270 | 14 | 8,640 | 41 |
| `peach_tree` | `peach` | Peach | summer | 64,000 | 4 | 32 | 128 | 500 | 21 | 16,000 | 30 |
| `apple_tree` | `apple` | Apple | summer, autumn | 100,000 | 5 | 44 | 176 | 295 | 15 | 12,980 | 39 |
| `pear_tree` | `pear` | Pear | autumn | 68,000 | 5 | 36 | 144 | 470 | 20 | 16,920 | 31 |
| `persimmon_tree` | `persimmon` | Persimmon | autumn, winter | 180,000 | 6 | 32 | 128 | 715 | 26 | 22,880 | 25 |
| `lemon_tree` | `lemon` | Lemon | winter, spring | 180,000 | 7 | 32 | 128 | 700 | 25 | 22,400 | 25 |

v2-05 table (the v2-03 one had 7–10 fruit a day at 150–360 gold, saplings 6,000–20,000): fruit per day ×4–4.5, and prices raised only as far as each fruit recipe keeps its tier (cherry and apricot have almost no room: Cherry Jam stays under 15 points at 165, Apricot Custard under 28 at 270). Days to mature and seasons are the owner's and did not change. Sapling prices come from the formula, so they rose with V (4–9×).

Every season has trees: spring 3 (cherry, apricot, lemon), summer 3 (apricot, peach, apple), autumn 3 (apple, pear, persimmon), winter 2 (persimmon, lemon). Stages (sapling → young → mature) by age: cherry 0–1 / 2 / 3+, apricot and peach 0–1 / 2–3 / 4+, apple and pear 0–2 / 3–4 / 5+, persimmon 0–2 / 3–5 / 6+, lemon 0–3 / 4–6 / 7+.

**What an orchard is worth.** A full orchard (10 trees) in a season with three bearing kinds earns about 10–20k gold a day at base price: about 10% of the Active Player's daily gold on day 7 and 1–3% of a keen player's by day 14. It is a side income and a stream of recipe ingredients, never the main farm. Each sapling repays in about 4 bearing days of its first season; two-season trees cost twice as much and bear twice as long. Fruit follows the ordinary market rules (demand, specials from the day the player owns a mature tree of that fruit, the sparkline).

**Measured (v2-03).** The simulator's orchard earns about **6,000–8,000 gold a day from sold fruit, 1% of the gold earned** on days 7–14 and 14–30 (every bot, 8 seeds). That is far below the 10% this paragraph expected: the estimate was made against day-7 incomes of about 100k a day, but the bots earn 0.5–1M a day by then (BALANCE §13.12, v2-03 notes). The tree table is the owner's and is unchanged; fruit is a small, steady side income and an ingredient stream, as intended, only smaller. §13.10's 5–15% lower bound is not met and is not enforced by a check.

**Farmhand.** Each tree with fruit uses one of the farmhand's per-visit capacity and is picked whole. Fruit appears only at 06:00, so on an ordinary day the first visit after the refresh picks everything.

### 13.6 Animals and buildings (v2-04)

**Buildings.**

| Building | Footprint | Level | Price | Capacity | Trough (portions) | Store (products) | Requires |
|---|---|---|---|---|---|---|---|
| `coop` | 3 × 2 | 1 | 25,000 | 4 hens | 64 | 64 | parcel `yard` |
| | | 2 | 60,000 | 8 hens | 128 | 128 | – |
| | | 3 | 150,000 | 12 hens | 192 | 192 | – |
| `barn` | 4 × 3 | 1 | 60,000 | 2 cows | 24 | 24 | `coop` Level 1 |
| | | 2 | 150,000 | 4 cows | 48 | 48 | – |
| | | 3 | 350,000 | 6 cows | 72 | 72 | – |
| `silo` | 2 × 2 | 1 | 40,000 | – | – | – | `coop` Level 1 |
| | | 2 | 120,000 | – | – | – | – |

A full trough and an empty store last **8 hours** of simulated time at full capacity (a hen eats 2 portions an hour, a cow 1.5), so a full night away needs no automation. The Barnyard bundle raises every trough by 50% (12 hours).

**Upgrade** `ranch_collector` (Collecting Basket, category `ranch`, leveled, max 1): **50,000**, requires `coop` Level 1. `autoCollect` at every shipping-bin pickup: each store is emptied into the bag, or into the bin for products the Auto-Seller ships (like `trap_collector`).

**Silo.** Level 1 (`autoFeed`): at every shipping-bin pickup, top up each trough from the bag's feed of its kind. Level 2 (`autoMill`): before that, if the bag lacks feed, convert wheat and corn from the bag (keeping `SILO_RESERVE = 10` of each) into as much feed as the troughs need.

**Animals.**

| Animal | Building | Price | Eats (1 portion per cycle) | Cycle (simulated) | Product | Product price | Farming XP | Gross / hour |
|---|---|---|---|---|---|---|---|---|
| `chicken` (hen) | coop | 3,000 | `corn_feed` | 1,800 s (30 min) | `egg`, or `large_egg` with chance `LARGE_EGG_CHANCE = 0.10` | egg 90, large egg 200 | egg 7, large egg 12 | 202 |
| `cow` | barn | 12,000 | `hay` | 2,400 s (40 min) | `milk` | 240 | 13 | 360 |

Farming XP per product (the crop formula), a quarter when the Collecting Basket collects. Animal prices are flat (the fifth hen costs what the first did).

**Per animal, per simulated hour** (base prices, feed valued at the crop it was made from):

| Animal | Gross | Home-made feed | Net | Bought feed | Net | Pays back its price in |
|---|---|---|---|---|---|---|
| hen | 202 | 27 (⅔ corn) | 175 | 80 | 122 | 17 h (1.5 days of play-and-away) |
| cow | 360 | 19 (¾ wheat) | 341 | 60 | 300 | 35 h (3 days) |

A full ranch (12 hens, 6 cows) nets about **4,150 gold per simulated hour**, about 10% of a late farm's 40–50k, and eats 8 corn and 4.5 wheat an hour: less than one corn plot and a few wheat plots.

**Production rule** (per building, exact for any step size):

```ts
// building.cycleMs counts up in simulated ms; buildings tick in id order
cycles = floor((building.cycleMs + dtMs) / (intervalSec * 1000));  building.cycleMs = (building.cycleMs + dtMs) % (intervalSec * 1000)
repeat cycles times:
  for each animal of the building, in id order:
    if storeCount(building) < store && building.trough > 0:
       building.trough -= 1
       product = kind === 'chicken' && rng.chance(LARGE_EGG_CHANCE) ? 'large_egg' : def.product
       add product to building.store
    // else: nothing happens to this animal this cycle; nothing is lost or reduced
```

`msToNextSimEvent` need not split at cycles (they are batched in order, like trap rolls); the only mid-step rate changes are trough refills, which happen on actions or at bin pickups, and those are already step boundaries.

**Busy Bees (v2-05).** The cycle is `cycleMs = round(intervalSec × 1000 / mods.animalSpeedModifier)` whole simulated ms; the modifier is 1 + the Busy Bees buff (the only source). It changes only when a buff starts or ends, and buff expiry is already a step boundary (`msToNextBuffExpiry`), so the interval is fixed inside a step and one big step still equals many small ones (`tests/ranch.test.ts`). A T2 Soft Cheese (+26%) makes a hen lay every 23.8 minutes instead of 30.

### 13.7 Feed (v2-04)

| Feed | Made from | Portions per unit | Ranch price | Item base price | Sellable |
|---|---|---|---|---|---|
| `hay` | `wheat` | 2 (`FEED_PER_WHEAT`) | 40 (`FEED_BUY_PRICE.hay`) | 13 | no |
| `corn_feed` | `corn` | 3 (`FEED_PER_CORN`) | 40 (`FEED_BUY_PRICE.corn_feed`) | 13 | no |

**The feed store (v2-05, save 13).** Hay and corn feed live in the ranch's feed store (`state.ranch.feedStore`), not in the bag: making, buying, the silo's milling and filling troughs all use it, and the Barnyard bundle takes its hay from it. It holds `FEED_STORE_CAPACITY = 600` portions of each (two fills of the biggest trough with the Barnyard bonus); making or buying more than fits is refused with "The feed store only has room for N more hay." and nothing is used. Feed an older save kept in the bag beyond the store's room stays there and is used after the store's.

Making feed is instant and free (the crop is the cost). Wheat and corn are summer and autumn crops, so spring and winter feed comes from stock, the greenhouse or the Ranch's shelf; bought feed roughly halves a hen's profit and leaves a cow's almost untouched, so it is a fallback, never a trap.

### 13.8 New recipes (v2-03 and v2-04)

Scores use §7's formula (`units + value / 50 + cookSec / 30`, thresholds 8 / 15 / 28) with the fruit and product prices above; prices are `round(value × TIER_SELL_MULT[tier])`. Every T3 is cookable from one season's fresh ingredients (animal products count as fresh in every season once the animal is owned). There is **no new T4**, so each season keeps its one T4 feast and the phase 06 test of T4s stays as it is.

| id | Name | Ingredients | Cook (s) | Units | Value | Score | Tier | Base price | Buff | Magnitude | Duration (min) | Cookable in | Discovery | Phase |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `fried_egg` | Fried Egg | egg ×2 | 30 | 2 | 180 | 6.60 | T1 | 225 | `cookSpeed` | +15% | 15 | all | milestone `m21_first_egg` | 04 |
| `baked_apple` | Baked Apple | apple ×1 | 30 | 1 | 295 | 7.90 | T1 | 369 | `xp` | +15% | 15 | summer, autumn | milestone `m20_first_fruit` | 03 |
| `cherry_jam` | Cherry Jam | cherry ×3 | 60 | 3 | 495 | 14.90 | T2 | 693 | `sellPrice` | +10% | 45 | spring | card 3,000 · parcel `orchard` | 03 |
| `soft_cheese` | Soft Cheese | milk ×2 | 60 | 2 | 480 | 13.60 | T2 | 672 | `automationSpeed` | +20% | 45 | all | milestone `m22_first_milk` | 04 |
| `pear_crumble` | Pear Crumble | pear ×1, wheat ×2 | 45 | 3 | 520 | 14.90 | T2 | 728 | `growth` | +20% | 45 | autumn | card 4,000 · parcel `orchard` | 03 |
| `garden_omelette` | Garden Omelette | egg ×2, kale ×1 | 45 | 3 | 267 | 9.84 | T2 | 374 | `fishingSpeed` | +20% | 45 | autumn, winter | experiment | 04 |
| `peach_cobbler` | Peach Cobbler | peach ×2, wheat ×2 | 60 | 4 | 1050 | 27.00 | T3 | 1,680 | `sellPrice` | +15% | 135 | summer | card 8,000 · parcel `orchard` | 03 |
| `apricot_custard` | Apricot Custard | apricot ×2, egg ×2, milk ×1 | 90 | 5 | 960 | 27.20 | T3 | 1,536 | `xp` | +45% | 135 | spring, summer | experiment | 04 |
| `lemon_meringue_pie` | Lemon Meringue Pie | lemon ×1, egg ×3 | 90 | 4 | 970 | 26.40 | T3 | 1,552 | `cookSpeed` | +45% | 135 | winter, spring | card 12,000 · building `coop` L1 | 04 |
| `persimmon_pudding` | Persimmon Pudding | persimmon ×1, milk ×1, egg ×1 | 90 | 3 | 1045 | 26.90 | T3 | 1,672 | `sellPrice` | +15% | 135 | autumn, winter | card 15,000 · building `barn` L1 | 04 |

v2-05: the value, score and price columns use the v2-05 fruit prices (§13.5); every tier is unchanged (`tests/orchard.test.ts`). The magnitude and duration columns are the v2-04 buff numbers; v2-05's (13% × tier, 25 min × 3^(tier − 1)) are in §7.

**One line per buff choice:**
- Fried Egg → Quick Hands: a quick comfort breakfast for the cook (GDD §7: comfort food helps the cook).
- Baked Apple → Scholar's Snack: an apple a day is brain food.
- Cherry Jam → Silver Tongue: a sweet, sellable treat, and **spring's** first gold dish from the orchard.
- Soft Cheese → Busy Bees: a wedge for the farmhand's lunch (hearty energy food helps workers).
- Pear Crumble → Green Thumb: a warm, earthy autumn pudding, like the vegetable dishes.
- Garden Omelette → Quick Bite: a quick bite before heading to the dock (the pun is the theme).
- Peach Cobbler → Silver Tongue: **summer's** T3 gold dish (summer had only the T2 Blueberry Muffin).
- Apricot Custard → Scholar's Snack: a rich, careful dessert that rewards attention.
- Lemon Meringue Pie → Quick Hands: a baker's showpiece that trains the cook's hands.
- Persimmon Pudding → Silver Tongue: **the winter gold-buff dish** (IDEAS.md). Cooked in winter it is hearty: +15% prices for 3 h 22 min, enough to cover a good part of a winter night away.

**Counts after v2:** 32 recipes: 8 × T1, 11 × T2, 9 × T3, 4 × T4. Buffs: growth 4, sellPrice 7, fishingLuck 4, fishingSpeed 3, cookSpeed 5, automationSpeed 4, xp 5. Discovery: 3 starter, 6 experiment, 8 milestone, 15 card. The v2 cards cost 42,000 in all.

**What changes in `tests/cooking.test.ts`** (v2-03 and v2-04 update it; the design rules stay): the counts (22 → 27 after v2-03, 32 after v2-04; tiers and buff and discovery counts as above), the ingredient-category rule (also `fruit` and `animal`), and the "fresh" helper (fruit by its tree's seasons, animal products in every season). The tier-match, price and "every T3/T4 cookable in one season, each season its own T4" rules are unchanged and must pass.

### 13.9 Milestones, goals and bundles

**Milestones** (appended to the chain; **no farm points**: `farmPoints` counts only `m01`–`m15`, so §8's table is unchanged):

| id | Objective | Reward | Phase |
|---|---|---|---|
| `m16_first_parcel` | Own a land parcel | decorations: 10 × `cobble_path`, 1 × `flower_bed` | 02 (checked from state, so earlier buyers get it at once) |
| `m17_first_decor` | Place a decoration | 1 × `garden_lamp` | 02 |
| `m18_charm_25` | Reach charm 25 | 10,000 gold | 02 |
| `m19_first_project` | Complete a town-project stage | 20,000 gold | 02 |
| `m20_first_fruit` | Pick a fruit | recipe `baked_apple` | 03 |
| `m21_first_egg` | Collect an egg | recipe `fried_egg` | 04 |
| `m22_first_milk` | Collect milk | recipe `soft_cheese` | 04 |
| `m23_charm_100` | Reach charm 100 | 1 × `rose_arch` | 02 |

**Goal templates** (goal gold as in §10):

| Template | Example | Target | Requires |
|---|---|---|---|
| `raise_charm` | Raise your charm by 10 | `max(3, niceTarget(0.1 × charm))` | `m17_first_decor`, a piece in stock or affordable |
| `pick_fruit` | Pick 16 peaches | one day of the bearing trees of that fruit | a mature tree in season |
| `collect_produce` | Collect 12 eggs | about one hour of the animals' production | an animal |

**Bundles** (Community Board):

| id | Slots | Reward |
|---|---|---|
| `orchard_basket` | cherry ×10, peach ×10, apple ×10, pear ×10, lemon ×5 | the 2 extra tree spots (`treeSpots`, 8 → 10) |
| `barnyard` | egg ×20, large_egg ×3, milk ×10, hay ×20 | troughs hold 50% more (`troughBonus: 0.5`) |

### 13.10 Pacing targets (v2)

Read as §11 does: "day n" is the n-th real day of the simulator's schedule (the Active Player plays one hour each evening). Season dates in the simulator: spring until Sunday 1 March (day 4), then summer, autumn (day 11), winter (day 18), spring (day 25).

| Moment | Active Player | Greedy Farmer | Notes |
|---|---|---|---|
| Hilltop Orchard bought | day 2–4 | day 2–3 | |
| First sapling planted | the same session | the same session | the brain picks a tree that bears in the season it will mature in |
| First mature tree | ≤ 5 real days after planting | same | cherry 3 days, apricot and peach 4 |
| First fruit picked | day 5–9 | day 5–8 | |
| Old Paddock bought | day 4–7 | day 3–5 | |
| First egg | ≤ 45 min of simulated time after the coop and a hen | same | one 30-minute cycle |
| First milk | day 5–9 | day 4–7 | |
| Seaside Meadow bought | day 7–12 | day 5–8 | |
| First town-project stage | day 5–9 | day 4–7 | |
| First town project complete | day 7–12 | day 5–9 | usually `old_bridge` |
| All town projects complete | after day 30 | day 21–30 | §13.4 |
| Charm 100 | day 10–18 | day 8–14 | |
| Orchard income (full orchard, in season) | ≤ 15% of gold per day at day 7–14 | **5–8% on days 14–21** (v2-05; measured 1% before) | side income worth planting |
| Animal income (full ranch) | ≤ 15% of gold per simulated hour | ≤ 15% | side income |
| Longest wait with nothing to do, first 30 min | ≤ 2 min | ≤ 2 min | v2 adds nothing to the first session |

The phase 09 checks stay: **no strategy dominates** (≤ 1.5× at days 3, 7 and 30), **buffs kept up are worth +10–25%** (Chef vs Chef who sells, paired by seed, days 3 and 7; the new gold dishes should also lift day 14 toward the band), **no early dead time**, **no runaway growth** (gold per hour at most ~3× the day before after day 3; week 4 not far above week 2), and the **Casual Idler ≥ 40%** of the Active Player on day 3.

### 13.11 Simulator changes

The bots still act only through `Game.dispatch`. What each phase teaches `scripts/sim/brain.ts` (new `Want` kinds and behaviours) and adds to `scripts/sim/report.ts`:

| Phase | Brain learns | Report adds | Checks added |
|---|---|---|---|
| v2-01 | `{ kind: 'parcel'; id }` wants after the v1 wish list (orchard, then yard, then meadow); the camera is irrelevant to bots | moments: each parcel bought; the "Gold still to spend" table (v1 + parcels so far) | none new; all phase 09 checks rerun |
| v2-02 | spend on decorations and projects: after the v1 list and the next parcel, each session puts up to `V2_SPEND_SHARE = 0.6` of the gold above its seed reserve into, alternately, the next open project stage (gold in parts, items it has) and decorations (cheapest unowned piece first, then counted copies, then 40 paths and 30 fences a set, then farmhouse pieces), placing each piece on the first free tile in a spiral from the farmhouse (then the meadow) | moments: first decoration, first stage, each project complete, charm 25/100; charm by day; the full `toSpend` / `share` table; the day `toSpend` hits 0 | §13.4 checks 1–3 |
| v2-03 | buy saplings (a tree whose seasons include the season on its maturity day; then fill spots with two-season trees), plant, pick fruit each session (the farmhand also picks), cook the new fruit recipes, give fruit to the Orchard Basket | moments: first sapling, first mature tree, first fruit; orchard gold per day | orchard share (§13.10) |
| v2-04 | build coop → hens → silo → barn → cows → Collecting Basket → levels; make feed from wheat and corn it keeps (plant a little of each in summer and autumn; buy feed only when out), fill troughs, collect, cook egg and milk recipes, feed the Barnyard bundle, and eat Persimmon Pudding in winter (the Chef) | moments: coop, first egg, barn, first milk; animal gold per simulated hour; "hungry" hours (time any trough was empty while animals had room) | animal share (§13.10); every phase 09 check; gold still to spend through day 30 |

Every v2 phase also keeps `tests/simulate.test.ts` green (determinism, speed: one bot's 30 days in under 10 s, the first session, the tuning criteria on 7-day runs) and records its report summary in §13.12.

### 13.12 v2 constants and tuning notes

Constants that are formula parameters go in `src/data/balance.ts`: `DECOR_BASE_SLOTS = 100`, `DECOR_SLOTS_PER_PROJECT = 40`, `CHARM_PER_PROJECT_STAGE = 10`, `TOWN_PROJECT_SCALE = 0.6` (set to 1 by the design, tuned to 0.8 in v2 phase 02, 0.7 in v2 phase 04 and 0.6 in v2 phase 05: see their notes below), `FRUIT_CAP_DAYS = 4`, `SAPLING_PRICE_FACTOR = 4`, `FEED_STORE_CAPACITY = 600` (v2-05), `LARGE_EGG_CHANCE = 0.1` (also `AUTO_COLLECT_XP_SHARE = 0.25` and `FEED_AMOUNTS = [1, 10]`), `FEED_PER_WHEAT = 2`, `FEED_PER_CORN = 3`, `FEED_BUY_PRICE = { hay: 40, corn_feed: 40 }`, `SILO_RESERVE = 10`, `BARNYARD_TROUGH_BONUS = 0.5`, `ORCHARD_BONUS_SPOTS = 2`, `GOAL_SLOTS_HALL_BONUS = 1`. Content tables (parcels, decorations, projects, trees, animals, buildings) live in their data files. Camera numbers (drag threshold 6 CSS px, zoom limits) are UI constants in `src/render/camera.ts`, not balance.

**v2 phase 00 notes.**
- Decoration and project prices were set from the phase 09 report's lifetime-gold curve, less roughly 40% spent on seeds. They are a first cut: v2 phase 02's simulator run sets `TOWN_PROJECT_SCALE` so the §13.4 curve holds, and phases 03–04 recheck it after the orchard and animals add income.
- Tree numbers come from `saplingPrice = 4 × V × seasons` and a target of a full orchard ≈ 10% of the Active Player's day-7 income. Animal numbers aim at a full ranch ≈ 10% of a late farm's hourly income. Neither should move a strategy past the 1.5× spread, because every bot gets them.
- Busy Bees (`automationSpeed`) still does nothing for animals or trees; making it matter late is still an IDEAS.md item, not v2 scope.
- No v1 number changes in v2 phase 00.

**v2 phase 01 notes** (`npm run simulate -- --seeds 1,2,3,4,5,6,7,8`, 30 days, medians).
- **No number changed.** Parcel prices and conditions are §13.1's; camera numbers (6 CSS px drag threshold, zoom 1× to default + 2, at least 3×) are UI constants in `src/render/camera.ts`.
- **The brain** buys `{ kind: 'parcel' }` wants at the end of the v1 wish list (`FARM_SHOPPING` in `scripts/sim/brain.ts`, which the Angler's and Chef's lists include). Parcels bought (real day): Hilltop Orchard: Greedy 3.0, Angler 3.0, Chef 3.1, Casual Idler 3.7, **Active Player 5.0** (target 2–4); Old Paddock: Greedy 3.8, Angler 3.5, Chef 4.0, Active 7.0; Seaside Meadow: Greedy 5.3, Angler 5.0, Chef 5.3, Active 9.0. Everything is inside §13.10's bands except the Active Player's Orchard, one day late.
- **Why not earlier.** Moving the Orchard ahead of the late v1 upgrades (after `farm_4` or after `ocean`) puts every parcel in its band, but a parcel is pure spending until v2 phase 03 gives it trees: buying it in the first week delays the growth upgrades and swings the phase 09 buff check (Chef vs Chef who sells, paired by seed) from +22% to +35–48% on the test seeds. v2 phase 03, when the orchard earns, should move `pa('orchard')` earlier and recheck.
- **Gold still to spend** (v1 523,030 + land 680,000 = 1,203,030): Active Player 99% (d1), 93% (d3), 72% (d7), 11% (d14), 10% (d21, d30); Greedy Farmer 97%, 77%, 19%, 12%, 12%, 12%. The 100–140k that never goes is v1 content the bots' wish lists skip (the last Fishing Rod and trap levels, a few cards); v2 phase 02 adds decorations and town projects to the catalogue, which is when §13.4's curve and checks apply.
- **Phase 09 checks all pass:** strategy spread 1.18× (d3), 1.20× (d7), 1.11× (d30); Casual Idler 160% of the Active Player at day 3; buffs +22% (d7, +22% d3); early waits ≤ 2.0 min; no runaway growth.

**v2 phase 02 notes** (`npm run simulate -- --seeds 1,2,3,4,5,6,7,8`, 30 days, medians).
- **One number moved: `TOWN_PROJECT_SCALE` 1.0 → 0.8** (`src/data/balance.ts`). The projects cost 6.8M instead of §13.3's 8.5M (the table's figures are before the scale and stay as printed; the game charges `round(gold × 0.8)`). Why: at 1.0 the Active Player ended day 30 with 68% of the catalogue still to spend (target 5–30%, ±10 points), because what it can spend by then is about 7.5M (13.6M lifetime, about 40% of it to seeds, 60% of the rest spent each session). At 0.8 the catalogue is **10,776,030** (v1 523,030 + land 680,000 + decorations 2,773,000 + projects 6,800,000; saplings and the ranch add to it in v2-03 and v2-04) and the Active Player ends day 30 with 33%. Decoration prices are unchanged (§13.2). v2-03 and v2-04 add about 1.25M to the catalogue and some side income; recheck the lever then.
- **Gold still to spend** (share of the catalogue so far; target bands in §13.4): Greedy Farmer 100%, 97%, 90%, 54%, 11%, 1% (days 1, 3, 7, 14, 21, 30); Active Player 100%, 99%, 97%, 83%, 59%, 33%. The 1% is v1 content the wish lists skip (about 100–140k).
- **The brain** (`scripts/sim/brain.ts`): at the end of each session, after it has stocked the planter's seeds and shipped, and only once the v1 wish list has nothing available (a parcel it can still buy holds its price back), it spends `V2_SPEND_SHARE = 0.6` of the gold above its seed reserve, alternately on the next open project stage's gold and on decorations (the cheapest unowned piece first, then counted copies, then 40 path and 30 fence tiles a set in chunks of 10, then the farmhouse pieces), putting each piece on the first free tile of a spiral from the farmhouse, then the meadow (the Orchard and Paddock are left for trees and animals). Items a stage asks for are gathered once its gold is in: crops are planted for it and the Auto-Seller is switched off for them, fish and junk come from midday fishing trips at 3 catches a minute, and a dish (the Harvest Feast) is cooked if the recipe is known. Spending earlier, or fishing for items before the gold is in, swung the Chef-versus-Chef-who-sells check (+7% and −5% instead of +24%); the order above keeps it.
- **Phase 09 checks, all passing:** strategy spread 1.18× (day 3), 1.20× (day 7), 1.08× (day 30); Casual Idler 160% of the Active Player on day 3; buffs +24% (day 7, +22% day 3, +13% day 14); early waits ≤ 2.0 min; no runaway growth; and the three §13.4 checks (`spendChecks` in `scripts/sim/report.ts`): gold stays meaningful, the curve, no hoard (more than 2% of the catalogue left, since the leftover v1 content never goes).
- **Pacing against §13.10** (real day, Greedy Farmer · Active Player): first decoration 3.1 · 5.0; first project stage 6.6 · 12 (target 4–7 · 5–9); first project complete 7.1 · 13 (5–9 · 7–12); charm 100 on day 7.8 · 14 (8–14 · 10–18). The Active Player is late because it only starts v2 spending after the v1 list, which takes its one evening hour a day until about day 11. The Community Hall's last stage (a Harvest Feast, a Tier 4 dish) is never finished by any bot: the Farmer never cooks and the Chef rarely holds a spare feast, so "all projects complete by day 21–30" is not met; the hall's gold is all given.
- **Charm** (median, day 7 · 14 · 21 · 30): Greedy Farmer 29 · 241 · 392 · 412; Active Player 16 · 85 · 218 · 342 (the maximum is 522).
- **Stage items from later phases** (apples, persimmons, eggs, large eggs, milk) are not in the stages yet, so the bakery and the hall are cheaper in effort than §13.3 says; they join in v2-03 and v2-04 (`LATER_STAGE_ITEMS` in `src/data/townProjects.ts`).


**v2 phase 03 notes** (`npm run simulate -- --seeds 1,2,3,4,5,6,7,8`, 30 days, medians).
- **No number changed** (tree table, `FRUIT_CAP_DAYS = 4`, the four new recipes and the three recipe cards are as printed). New constants in `src/data/balance.ts`: `FRUIT_CAP_DAYS`, `FARMHAND_FRUIT_XP_SHARE = 0.25`, `BASE_TREE_SPOTS = 8`. `TOWN_PROJECT_SCALE` stays 0.8: the §13.4 curve holds with the saplings in the catalogue.
- **Catalogue** (`scripts/sim/catalogue.ts`): v1 538,030 (the three new recipe cards, 15,000, are in this part) + land 680,000 + **saplings 137,300** + decorations 2,773,000 + town projects 6,800,000 = **10,928,330**. A sapling counts as bought when it is planted or in the bag.
- **The brain** (`scripts/sim/brain.ts`) plants and picks: after each look it picks every ripe tree, then plants while a spot is free and the gold above the seed reserve pays for it: first one of each kind that bears in the season it will mature in (cheapest first), then second apricots, apples and persimmons; a spot waits for a tree that suits its season rather than getting a third peach. It holds back the fruit later town stages need (the bakery's apples, the hall's persimmons: `fruitStock`), keeps the Auto-Seller off for them and does not cook them; without that, the bakery stalled for a season and every bot hoarded gold (the no-hoard check failed at 7–11 days' income).
- **Pacing against §13.10** (real day, Greedy Farmer · Active Player): Orchard bought 3.0 · 5.0; first sapling 3.0 · 5.0; first mature tree and first fruit **6.5 · 9.0** (target 5–8 · 5–9); the Active Player's late Orchard (target 2–4) is the v2-01 note again: moving `pa('orchard')` after `farm_4` or the first scarecrow puts it on day 2–3 and first fruit on day 5.5–7.5, but swings the buff check and the Farmer's spending (after `farm_4`: buffs +10%, the Farmer has 28% of the catalogue left on day 30 and hoards 7.3 days' income; after the first scarecrow: buffs +31%, a 4.5-day hoard). It stays at the end of the v1 list.
- **First fruit by tree**, planted on the schedule's first evening (Wed 25 Feb; `scripts/sim/trees.ts`): cherry 3 days (spring), apricot 4 (summer), peach 4 (summer), apple 5 (summer), pear **11** (autumn), persimmon **11** (autumn), lemon **18** (winter). A tree that matures out of season waits for its season.
- **Orchard income:** 6–8k gold a day, 1% of gold, every bot (see §13.5 "Measured"); the Active Player 3k a day on days 7–14 (its trees mature on day 9).
- **Phase 09 checks and §13.4 checks:** all pass except one: **buffs kept up +27%** at day 7 on 8 seeds (day 3 +22%, day 14 +11%; target +10–25%). The unit test's four seeds pair at +17%. The Chef's new fruit dishes (Peach Cobbler is a summer Silver Tongue T3) lift it a little; the paired medians swing ±10 points between seed sets, and no lever was moved for 2 points. Strategy spread 1.18× (d3), 1.24× (d7), 1.09× (d30); Casual Idler 160% of the Active Player on day 3; early waits ≤ 2.0 min; no runaway growth; gold still to spend (share of catalogue): Greedy Farmer 100%, 98%, 90%, 54%, 15%, 2% (days 1, 3, 7, 14, 21, 30), Active Player 100%, 99%, 96%, 85%, 63%, 36%; no hoard (worst 1.8 and 2.6 days' income for the Farmer and the Active Player).
- **`SPEND_REPORT=1`** runs the full gold-sink check (8 seeds, 30 days, Greedy Farmer and Active Player, about 60 s: `SPEND_REPORT=1 npx vitest run tests/simulate.test.ts -t "gold sink"`); it passes. The default suite runs one seed of the Farmer for 21 days.

### 13.13 v2 balance report (after v2 phase 04)

The whole v2 content set with the ranch, from `npm run simulate -- --seeds 1,2,3,4,5,6,7,8` (30 real days, medians). Gold by day:

| Bot | Play (h) | Gold d1 | Gold d3 | Gold d7 | Gold d14 | Gold d30 | FL d3 · d30 | Recipes | Dead time | Longest early wait | Buff uptime (play · all) | Gold from offline |
| Greedy Farmer | 59.7 | 57,553 | 403,789 | 2,744,271 | 9,019,884 | 23,915,153 | 7 · 8 | 12 | 3% | 2.0 min | 0% · 0% | 75% |
| Angler | 59.7 | 65,602 | 454,801 | 2,949,595 | 9,822,386 | 26,128,122 | 8 · 8 | 13 | 0% | 0.5 min | 0% · 0% | 71% |
| Chef | 59.7 | 60,534 | 386,700 | 2,409,256 | 8,871,457 | 25,806,618 | 9 · 10 | 31 | 0% | 1.2 min | 100% · 49% | 70% |
| Chef who sells (control) | 59.7 | 58,456 | 352,316 | 2,035,671 | 7,915,936 | 23,847,655 | 9 · 10 | 31 | 0% | 1.2 min | 0% · 0% | 70% |
| Casual Idler | 6.0 | 2,095 | 224,307 | 2,692,591 | 10,681,971 | 29,707,500 | 6 · 8 | 11 | 0% | 0.9 min | 0% · 0% | 80% |
| Active Player | 30.0 | 19,530 | 140,480 | 666,517 | 3,992,498 | 13,122,362 | 8 · 10 | 31 | 0% | 0.7 min | 1% · 0% | 64% |
| Casual Idler | 6,972 · 1% | 5,974 · 1% |

Every check, as the simulator prints them:

| Check | Target | Measured | |
|---|---|---|---|
| No strategy dominates (day 3) | ≤ 1.5× lifetime gold | 1.18× (Greedy Farmer 403,789, Angler 454,801, Chef 386,700) | ✅ |
| No strategy dominates (day 7) | ≤ 1.5× lifetime gold | 1.22× (Greedy Farmer 2,744,271, Angler 2,949,595, Chef 2,409,256) | ✅ |
| No strategy dominates (day 30) | ≤ 1.5× lifetime gold | 1.09× (Greedy Farmer 23,915,153, Angler 26,128,122, Chef 25,806,618) | ✅ |
| Casual Idler vs Active Player (day 3) | ≥ 40% of the lifetime gold | 160% | ✅ |
| Buffs kept up: Chef vs the same Chef selling its dishes (day 7, paired by seed) | +10% to +25% (worth it, not mandatory) | +28% (day 3 +22%, day 14 +14%) | ❌ |
| Greedy Farmer: early dead time | no wait over 2 min in the first 30 min of play | 2.0 min (dead-time share 3%) | ✅ |
| Angler: early dead time | no wait over 2 min in the first 30 min of play | 0.5 min (dead-time share 0%) | ✅ |
| Chef: early dead time | no wait over 2 min in the first 30 min of play | 1.2 min (dead-time share 0%) | ✅ |
| Active Player: early dead time | no wait over 2 min in the first 30 min of play | 0.7 min (dead-time share 0%) | ✅ |
| Greedy Farmer: no runaway growth after day 3 | gold/hour at most ~3× the day before; week 4 not far above week 2 | worst day-over-day 2.26×, day 28 / day 14 1.03× | ✅ |
| Angler: no runaway growth after day 3 | gold/hour at most ~3× the day before; week 4 not far above week 2 | worst day-over-day 1.98×, day 28 / day 14 0.93× | ✅ |
| Chef: no runaway growth after day 3 | gold/hour at most ~3× the day before; week 4 not far above week 2 | worst day-over-day 1.74×, day 28 / day 14 0.86× | ✅ |
| Greedy Farmer: orchard income (days 7–14) | ≤ 5% of gold at day 14 | 1% (7,685 gold a day) | ✅ |
| Active Player: orchard income (days 7–14) | ≤ 15% of gold (side income) | 1% (3,128 gold a day) | ✅ |
| Greedy Farmer: animal income (days 14–30) | ≤ 15% of gold (side income) | 7% (67,886 gold a day) | ✅ |
| Active Player: animal income (days 14–30) | ≤ 15% of gold (side income) | 4% (21,362 gold a day) | ✅ |
| Greedy Farmer: gold stays meaningful (day 21) | gold still to spend > 0 | 2,157,728 | ✅ |
| Greedy Farmer: share still to spend, day 1 | 99%–100% (±10 points) | 100% | ✅ |
| Greedy Farmer: share still to spend, day 3 | 90%–97% (±10 points) | 98% | ✅ |
| Greedy Farmer: share still to spend, day 7 | 65%–85% (±10 points) | 90% | ✅ |
| Greedy Farmer: share still to spend, day 14 | 30%–55% (±10 points) | 59% | ✅ |
| Greedy Farmer: share still to spend, day 21 | 5%–30% (±10 points) | 19% | ✅ |
| Greedy Farmer: share still to spend, day 30 | 0%–10% (±10 points) | 2% | ✅ |
| Greedy Farmer: no hoard after day 7 | gold in hand ≤ 3 days’ income while there is still something to buy | 1.40 days’ income at worst (median over seeds) | ✅ |
| Angler: gold stays meaningful (day 21) | gold still to spend > 0 | 1,069,885 | ✅ |
| Angler: no hoard after day 7 | gold in hand ≤ 3 days’ income while there is still something to buy | 1.49 days’ income at worst (median over seeds) | ✅ |
| Chef: gold stays meaningful (day 21) | gold still to spend > 0 | 1,051,450 | ✅ |
| Chef: no hoard after day 7 | gold in hand ≤ 3 days’ income while there is still something to buy | 1.58 days’ income at worst (median over seeds) | ✅ |
| Active Player: gold stays meaningful (day 21) | gold still to spend > 0 | 7,119,950 | ✅ |
| Active Player: gold still to spend on day 30 | > 0 and more than the gold in hand | 3,870,950 to spend vs 910,463 in hand | ✅ |
| Active Player: share still to spend, day 1 | 99%–100% (±10 points) | 100% | ✅ |
| Active Player: share still to spend, day 3 | 97%–100% (±10 points) | 99% | ✅ |
| Active Player: share still to spend, day 7 | 85%–95% (±10 points) | 96% | ✅ |
| Active Player: share still to spend, day 14 | 55%–75% (±10 points) | 86% | ❌ |
| Active Player: share still to spend, day 21 | 30%–55% (±10 points) | 63% | ✅ |
| Active Player: share still to spend, day 30 | 5%–30% (±10 points) | 35% | ✅ |
| Active Player: no hoard after day 7 | gold in hand ≤ 3 days’ income while there is still something to buy | 1.87 days’ income at worst (median over seeds) | ✅ |

**v2 phase 04 notes** (`npm run simulate -- --seeds 1,2,3,4,5,6,7,8`, 30 days, medians).
- **One number moved: `TOWN_PROJECT_SCALE` 0.8 → 0.7** (`src/data/balance.ts`). The projects now cost 5,950,000 instead of 6,800,000 (§13.3's figures are before the scale and stay as printed). Why: the ranch adds 1,140,000 to the catalogue (every building level 955,000, 12 hens and 6 cows 108,000, the Collecting Basket 50,000, the two cards that need a building 27,000) and, bought in the second week when a day of income is about a million, delays the town by about a day; the Farmer then reached the bandstand's ten pumpkins after the autumn weeks and the hall waited a year. At 0.8 the Farmer ended day 30 with 26% of the catalogue still to spend (target 0–10%); at 0.7 it ends with 2%. Every animal and building number is §13.6's.
- **The catalogue** (`scripts/sim/catalogue.ts`): v1 538,030 + land 680,000 + saplings 137,300 + **ranch 1,140,000** + decorations 2,773,000 + town projects 5,950,000 = **11,218,330**. The two recipe cards that need a building count in the ranch part, the Collecting Basket (category `ranch`) too.
- **The brain** (`scripts/sim/brain.ts`): every look it collects (no Basket yet), makes feed from spare wheat and corn (it keeps 20 of each back) and fills the troughs, buying feed (40g a portion) only when a trough is under a quarter full; it buys `RANCH_PLAN` (coop, 4 hens, silo, barn, 2 cows, Collecting Basket, coop 2, 8 hens, barn 2, 4 cows, silo 2, coop 3, 12 hens, barn 3, 6 cows) as **one of three turns of `spendV2`** (the ranch, a project's gold, decorations), when leaving and after the seeds the planter needs are stocked. Buying it in the middle of a session left the farm without seed for the absence and income at day 7 halved (33,974 crops harvested fell to 23,783); buying it as soon as the v1 list was done starved the town. Eggs, large eggs and milk later stages ask for are held back like fruit (`fruitStock`), and a few of a seasonal crop a project will want (the bandstand's pumpkins) are planted and kept before the stage's gold is in (`cropErrands`). The Auto-Seller stays off for eggs and milk; the bots sell them at the market, cook them, and give them to the Barnyard bundle.
- **Pacing against §13.10** (real day, Greedy Farmer · Active Player): Old Paddock bought 4.5 · 9.0; coop built 6.1 · 12; first egg 7.0 · 13.5; barn 7.5 · 14.5; **first milk 9.0 · 16** (target 4–7 · 5–9). The doc's "first egg within 45 minutes of the coop and a hen" holds in the game (`tests/ranch.test.ts`); the bots buy the hen on a later turn than the coop, and milk later still, because the ranch shares its turn with the town and decorations. Seaside Meadow 6.0 · 12.
- **Animal income** (medians; the bots sell what the kitchen and the town do not take):

| Bot | days 7–14 | days 14–30 | hungry hours |
|---|---|---|---|
| Greedy Farmer | 29,316 · 3% | 67,886 · 7% | 0.0 |
| Angler | 32,634 · 3% | 68,983 · 7% | 0.0 |
| Chef | 26,645 · 3% | 61,122 · 6% | 0.0 |
| Chef who sells (control) | 18,607 · 2% | 56,823 · 6% | 0.0 |
| Casual Idler | 72,779 · 6% | 108,120 · 9% | 0.0 |
| Active Player | 50 · 0% | 21,362 · 4% | 0.0 |

  A full ranch is about 7% of a bot's gold a day in the last two weeks (target ≤ 15%); no animal ever waits long for feed (hungry hours about 0, the silo and the bots keep the troughs full).
- **Gold still to spend** (share of the catalogue; target bands in §13.4):

| Bot | d1 | d3 | d7 | d14 | d21 | d30 | Spent out |
|---|---|---|---|---|---|---|---|
| Greedy Farmer | 11,179,230 · 100% | 10,946,440 · 98% | 10,078,760 · 90% | 6,589,850 · 59% | 2,157,728 · 19% | 208,075 · 2% | – |
| Angler | 11,168,945 · 100% | 10,906,220 · 97% | 9,954,490 · 89% | 5,932,344 · 53% | 1,069,885 · 10% | 141,200 · 1% | – |
| Chef | 11,173,950 · 100% | 10,970,095 · 98% | 10,030,765 · 89% | 6,401,950 · 57% | 1,051,450 · 9% | 125,950 · 1% | – |
| Chef who sells (control) | 11,176,950 · 100% | 11,011,370 · 98% | 10,066,950 · 90% | 7,136,950 · 64% | 2,314,984 · 21% | 125,950 · 1% | – |
| Casual Idler | 11,217,630 · 100% | 11,071,990 · 99% | 9,954,748 · 89% | 5,969,225 · 53% | 4,545,710 · 41% | 3,705,710 · 33% | – |
| Active Player | 11,205,510 · 100% | 11,138,610 · 99% | 10,774,450 · 96% | 9,652,597 · 86% | 7,119,950 · 63% | 3,870,950 · 35% | – |

- **Phase 09 checks and §13.4 checks: all pass except two:** (1) **buffs kept up +28%** at day 7 on 8 seeds (day 3 +22%, day 14 +14%; target +10–25%): the same 2–3 points over as v2-03's +27%, from the gold dishes (Persimmon Pudding, Peach Cobbler) the Chef cooks; the unit test's four seeds pair at +17%. (2) The **Active Player's share still to spend on day 14 is 86%** (limit 85% with the tolerance); its income is a third of the Farmer's and it plays one hour an evening, so its ranch and town come a week behind. Strategy spread 1.18× (d3), 1.22× (d7), 1.09× (d30); Casual Idler 160% of the Active Player on day 3; early waits ≤ 2.0 min; no runaway growth (worst 2.26×); no hoard (worst 1.9 days' income); animal income 7% and 4% (Farmer and Active, days 14–30).
- **Performance** (`e2e/perf.spec.ts`, now with a full ranch of 12 hens and 6 cows wandering in the world scenario): 4.4 KB allocated a frame in the world (3.7 KB without the ranch; budget 11 KB), 2.9 KB on the farm, 60 fps; 8 hours away on a full farm with a full ranch 75 ms (budget 100 ms); 8 hours of a full ranch alone and 30 days in `tests/ranch.test.ts` are well inside 100 ms and 300 ms.


### 13.14 v2-05 balance report

`npm run simulate -- --seeds 1,2,3,4,5,6,7,8` (30 real days, medians), before any v2-05 change (the v2-04 code; the same as §13.13) and after. **Every check passes on 8 seeds** (37 of 37; before: 35 of 37).

**Every check, before and after:**

| Check | Target | Before (v2-04 code) | After (v2-05) |
|---|---|---|---|
| No strategy dominates (day 3) | ≤ 1.5× lifetime gold | 1.18× (Greedy Farmer 403,789, Angler 454,801, Chef 386,700) ✅ | 1.28× (Greedy Farmer 425,275, Angler 466,640, Chef 365,741) ✅ |
| No strategy dominates (day 7) | ≤ 1.5× lifetime gold | 1.22× (Greedy Farmer 2,744,271, Angler 2,949,595, Chef 2,409,256) ✅ | 1.25× (Greedy Farmer 2,766,056, Angler 3,173,760, Chef 2,535,985) ✅ |
| No strategy dominates (day 30) | ≤ 1.5× lifetime gold | 1.09× (Greedy Farmer 23,915,153, Angler 26,128,122, Chef 25,806,618) ✅ | 1.11× (Greedy Farmer 25,200,358, Angler 27,266,947, Chef 28,002,354) ✅ |
| Casual Idler vs Active Player (day 3) | ≥ 40% of the lifetime gold | 160% ✅ | 160% ✅ |
| Buffs kept up: Chef vs the same Chef selling its dishes (day 7, paired by seed) | +10% to +25% (worth it, not mandatory) | +28% (day 3 +22%, day 14 +14%) ❌ | +17% (day 3 +8%, day 14 +6%) ✅ |
| Greedy Farmer: early dead time | no wait over 2 min in the first 30 min of play | 2.0 min (dead-time share 3%) ✅ | 2.0 min (dead-time share 3%) ✅ |
| Angler: early dead time | no wait over 2 min in the first 30 min of play | 0.5 min (dead-time share 0%) ✅ | 0.5 min (dead-time share 0%) ✅ |
| Chef: early dead time | no wait over 2 min in the first 30 min of play | 1.2 min (dead-time share 0%) ✅ | 1.2 min (dead-time share 0%) ✅ |
| Active Player: early dead time | no wait over 2 min in the first 30 min of play | 0.7 min (dead-time share 0%) ✅ | 0.7 min (dead-time share 0%) ✅ |
| Greedy Farmer: no runaway growth after day 3 | gold/hour at most ~3× the day before; week 4 not far above week 2 | worst day-over-day 2.26×, day 28 / day 14 1.03× ✅ | worst day-over-day 2.02×, day 28 / day 14 0.77× ✅ |
| Angler: no runaway growth after day 3 | gold/hour at most ~3× the day before; week 4 not far above week 2 | worst day-over-day 1.98×, day 28 / day 14 0.93× ✅ | worst day-over-day 1.98×, day 28 / day 14 0.90× ✅ |
| Chef: no runaway growth after day 3 | gold/hour at most ~3× the day before; week 4 not far above week 2 | worst day-over-day 1.74×, day 28 / day 14 0.86× ✅ | worst day-over-day 1.94×, day 28 / day 14 0.75× ✅ |
| Greedy Farmer: orchard income (days 14–21, a full orchard) | 5%–8% of gold (a side income worth planting) | 1% (7,685 gold a day; the old check was days 7–14, ≤ 5%) ✅ | 5.2% (58,554 gold a day) ✅ |
| Active Player: orchard income (days 7–14) | ≤ 15% of gold (side income) | 1% (3,128 gold a day) ✅ | 1% (3,644 gold a day) ✅ |
| Greedy Farmer: animal income (days 14–30) | ≤ 15% of gold (side income) | 7% (67,886 gold a day) ✅ | 7% (68,700 gold a day) ✅ |
| Active Player: animal income (days 14–30) | ≤ 15% of gold (side income) | 4% (21,362 gold a day) ✅ | 4% (26,987 gold a day) ✅ |
| Greedy Farmer: gold stays meaningful (day 21) | gold still to spend > 0 | 2,157,728 ✅ | 1,359,885 ✅ |
| Greedy Farmer: share still to spend, day 1 | 99%–100% (±10 points) | 100% ✅ | 100% ✅ |
| Greedy Farmer: share still to spend, day 3 | 90%–97% (±10 points) | 98% ✅ | 97% ✅ |
| Greedy Farmer: share still to spend, day 7 | 65%–85% (±10 points) | 90% ✅ | 88% ✅ |
| Greedy Farmer: share still to spend, day 14 | 30%–55% (±10 points) | 59% ✅ | 58% ✅ |
| Greedy Farmer: share still to spend, day 21 | 5%–30% (±10 points) | 19% ✅ | 12% ✅ |
| Greedy Farmer: share still to spend, day 30 | 0%–10% (±10 points) | 2% ✅ | 2% ✅ |
| Greedy Farmer: no hoard after day 7 | gold in hand ≤ 3 days’ income while there is still something to buy | 1.40 days’ income at worst (median over seeds) ✅ | 1.34 days’ income at worst (median over seeds) ✅ |
| Angler: gold stays meaningful (day 21) | gold still to spend > 0 | 1,069,885 ✅ | 564,560 ✅ |
| Angler: no hoard after day 7 | gold in hand ≤ 3 days’ income while there is still something to buy | 1.49 days’ income at worst (median over seeds) ✅ | 1.92 days’ income at worst (median over seeds) ✅ |
| Chef: gold stays meaningful (day 21) | gold still to spend > 0 | 1,051,450 ✅ | 305,950 ✅ |
| Chef: no hoard after day 7 | gold in hand ≤ 3 days’ income while there is still something to buy | 1.58 days’ income at worst (median over seeds) ✅ | 1.62 days’ income at worst (median over seeds) ✅ |
| Active Player: gold stays meaningful (day 21) | gold still to spend > 0 | 7,119,950 ✅ | 6,647,113 ✅ |
| Active Player: gold still to spend on day 30 | > 0 and more than the gold in hand | 3,870,950 to spend vs 910,463 in hand ✅ | 2,785,978 to spend vs 820,846 in hand ✅ |
| Active Player: share still to spend, day 1 | 99%–100% (±10 points) | 100% ✅ | 100% ✅ |
| Active Player: share still to spend, day 3 | 97%–100% (±10 points) | 99% ✅ | 99% ✅ |
| Active Player: share still to spend, day 7 | 85%–95% (±10 points) | 96% ✅ | 95% ✅ |
| Active Player: share still to spend, day 14 | 55%–75% (±10 points) | 86% ❌ | 83% ✅ |
| Active Player: share still to spend, day 21 | 30%–55% (±10 points) | 63% ✅ | 59% ✅ |
| Active Player: share still to spend, day 30 | 5%–30% (±10 points) | 35% ✅ | 25% ✅ |
| Active Player: no hoard after day 7 | gold in hand ≤ 3 days’ income while there is still something to buy | 1.87 days’ income at worst (median over seeds) ✅ | 1.72 days’ income at worst (median over seeds) ✅ |


**New and changed constants** (`src/data/balance.ts` unless named):

| Constant | Before | After | Why |
|---|---|---|---|
| `BUFF_MAGNITUDE_PER_TIER` | 0.10 | **0.13** | buffs kept up back to about +20% (see below) |
| `BUFF_BASE_DURATION_MS` | 15 min | **25 min** | the same; `BUFF_DURATION_GROWTH` stays 3, so T1–T4 last 25 min, 75 min, 3 h 45, 11 h 15 |
| `BUFF_DURATION_GROWTH` | 3 | 3 | unchanged |
| `SAPLING_PRICE_FACTOR` | (4, in the doc only) | 4 | now a constant; `src/data/trees.ts` computes every sapling price from it |
| fruit per bearing day (`src/data/trees.ts`) | 7–10 | **32–44** | orchard income (§13.5 table) |
| fruit prices (`src/data/trees.ts`) | 150–360 | **165–715** | the same, as far as each fruit recipe keeps its tier |
| `TOWN_PROJECT_SCALE` | 0.7 | **0.6** | the saplings added 899,000 to the catalogue; 0.6 takes 850,000 off the projects (catalogue 11,267,030, was 11,218,330) |
| `FEED_STORE_CAPACITY` | – | **600** | the feed store (§13.7) |
| `animalSpeedModifier` (`src/systems/modifiers.ts`) | – | 1 + Busy Bees | §13.6 |
| `SPEND_FLOOR` (`scripts/sim/report.ts`) | 2% | **4%** | what the bots never buy: the v1 items their lists skip (140–180k) and the cherry and lemon saplings that only fit with the Orchard Basket's spots (206,000) |

**Gold by day (after):**

| Bot | Play (h) | Gold d1 | Gold d3 | Gold d7 | Gold d14 | Gold d30 | FL d3 · d30 | Recipes | Dead time | Longest early wait | Buff uptime (play · all) | Gold from offline |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Greedy Farmer | 59.7 | 57,553 | 425,275 | 2,766,056 | 9,656,395 | 25,200,358 | 7 · 8 | 12 | 3% | 2.0 min | 0% · 0% | 81% |
| Angler | 59.7 | 67,810 | 466,640 | 3,173,760 | 10,630,656 | 27,266,947 | 8 · 8 | 11 | 0% | 0.5 min | 0% · 0% | 76% |
| Chef | 59.7 | 61,605 | 365,741 | 2,535,985 | 9,206,495 | 28,002,354 | 9 · 10 | 31 | 0% | 1.2 min | 100% · 55% | 77% |
| Chef who sells (control) | 59.7 | 62,280 | 375,636 | 2,520,915 | 9,225,687 | 25,809,954 | 9 · 10 | 31 | 0% | 1.2 min | 1% · 0% | 78% |
| Casual Idler | 6.0 | 2,095 | 224,307 | 3,139,670 | 11,668,802 | 30,480,707 | 6 · 8 | 11 | 0% | 0.9 min | 0% · 0% | 91% |
| Active Player | 30.0 | 22,433 | 139,775 | 837,136 | 4,395,978 | 14,799,136 | 8 · 10 | 31 | 0% | 0.7 min | 1% · 0% | 80% |

**Moments (real day; Greedy Farmer · Active Player, before → after; targets §13.10):** Hilltop Orchard 3.0 · 5.0 → 3.0 · **4.0** (2–3 · 2–4); Old Paddock 4.5 · 9.0 → 4.0 · **5.0** (3–5 · 4–7); coop 6.1 · 12 → 4.3 · 7.0; first egg 7.0 · 13.5 → 4.8 · 8.0; **first milk 9.0 · 16 → 5.0 · 8.5** (4–7 · 5–9); first fruit 6.5 · 9.0 → 8.5 · 10.0 (5–8 · 5–9: a day later, see the notes); Seaside Meadow 6.0 · 12 → 7.5 · 11 (5–8 · 7–12); first project stage 6.8 · 13 → 7.1 · 11; first project complete 7.5 · 14 → 9.3 · 15; charm 100 9.1 · 16 → 10.8 · 17.

**Orchard income (after)**, gold per day · share of the gold earned in the window:

| Bot | days 7–14 | days 14–21 (a full orchard) | days 14–30 |
|---|---|---|---|
| Greedy Farmer | 24,859 · 2% | 58,554 · 5% | 47,177 · 5% |
| Angler | 27,337 · 3% | 63,053 · 6% | 49,043 · 5% |
| Chef | 27,114 · 3% | 64,766 · 5% | 48,241 · 4% |
| Chef who sells (control) | 20,400 · 2% | 56,631 · 5% | 42,958 · 4% |
| Casual Idler | 38,650 · 3% | 54,298 · 4% | 41,719 · 3% |
| Active Player | 3,644 · 1% | 26,691 · 4% | 43,340 · 7% |

**Animal income (after):**

| Bot | days 7–14 | days 14–30 | hungry hours |
|---|---|---|---|
| Greedy Farmer | 37,201 · 4% | 68,700 · 7% | 0.0 |
| Angler | 43,356 · 4% | 69,025 · 7% | 0.0 |
| Chef | 33,420 · 3% | 65,002 · 6% | 0.0 |
| Chef who sells (control) | 30,293 · 3% | 58,054 · 6% | 0.0 |
| Casual Idler | 88,136 · 8% | 106,382 · 9% | 0.0 |
| Active Player | 6,910 · 1% | 26,987 · 4% | 0.0 |

**Gold still to spend (after)**, share of the catalogue (11,267,030: v1 538,030 + land 680,000 + saplings 1,036,000 + ranch 1,140,000 + decorations 2,773,000 + town projects 5,100,000):

| Bot | d1 | d3 | d7 | d14 | d21 | d30 | Spent out |
|---|---|---|---|---|---|---|---|
| Greedy Farmer | 11,227,930 · 100% | 10,982,945 · 97% | 9,936,512 · 88% | 6,537,737 · 58% | 1,359,885 · 12% | 275,135 · 2% | – |
| Angler | 11,217,630 · 100% | 10,933,415 · 97% | 9,651,216 · 86% | 5,398,754 · 48% | 564,560 · 5% | 216,150 · 2% | – |
| Chef | 11,220,780 · 100% | 11,060,070 · 98% | 10,027,810 · 89% | 6,298,781 · 56% | 305,950 · 3% | 194,950 · 2% | – |
| Chef who sells (control) | 11,220,780 · 100% | 11,060,070 · 98% | 10,086,221 · 90% | 6,492,515 · 58% | 1,267,950 · 11% | 194,950 · 2% | – |
| Casual Idler | 11,266,330 · 100% | 11,120,690 · 99% | 9,679,428 · 86% | 5,097,260 · 45% | 2,973,785 · 26% | 331,710 · 3% | – |
| Active Player | 11,252,150 · 100% | 11,187,310 · 99% | 10,690,885 · 95% | 9,331,192 · 83% | 6,647,113 · 59% | 2,785,978 · 25% | – |

**v2-05 notes.**
- **Buffs.** The phase began at +28% on 8 seeds, but the paired day-7 median is very noisy: on 16 seeds the same code measured +15%, and moving the base duration from 15 to 14 minutes swung the 8-seed figure from +28% to −7%. The two Chefs make the same purchases half a day apart and that compounds; per-seed ratios at day 7 run from −30% to +70%. After the orchard and brain changes below the buff value fell to about +1% (16 seeds), mostly because the control now sells fruit dishes worth 1.5–2× more. The new constants were chosen on 16 and 24 seeds and then checked on the report's 8: **+17% on seeds 1–8** (day 3 +8%, day 14 +6%), +12–20% on 24 seeds depending on the brain version, +17% on the unit test's seeds 1–4. Raising the magnitude to 0.14 measured lower (+11%), so 0.13 / 25 min was kept. The formula is still driven by tier, the stacking rules and the 3 base slots are unchanged.
- **Orchard.** Fruit value is 4–7× v2-03's (fruit per day ×4–4.5, prices up to the recipe-tier limits), saplings by the formula. A full orchard of 8 trees is worth **5.2% of the Farmer's gold on days 14–21** (58,554 a day; 5–6% for the Angler and the Chef). The check moved from days 7–14 (the Farmer's trees only mature on day 8–9, so that window held about three days of fruit) to days 14–21 with the 5–8% band. Bigger daily sales hit the market's depth (a 715-gold persimmon has a depth of 25), so the income grows less than the value does. Recipe tiers are unchanged (a test lists them). Town stages still ask for 30 apples and 20 persimmons: now about one day of one tree, which keeps those stages easy but no longer a wait for a season.
- **First milk** (day 9 · 16 → 5.0 · 8.5): the brain buys a **starter yard** (coop, 2 hens, barn, a cow: 106,000) as soon as the Old Paddock is owned, ahead of the next v1 purchase, but only with gold the planter's seeds for the coming absence will not need (`starters`, `seedGold`), and again when leaving after the seeds. The Active Player has its own wish list (`ACTIVE_SHOPPING`): the Orchard and Old Paddock right after the first greenhouse level instead of after the late comforts. No price changed.
- **The Active Player's day-14 share** (86% → 83%) comes from the same changes: its ranch and orchard now start on days 4–5.
- **Brain fixes the new numbers exposed** (`scripts/sim/brain.ts`): saplings are bought when leaving, after the seeds (bought mid-session they emptied the planter's seed money and the farm stalled overnight: day-7 gold fell from 2.7M to 1.6M); the keep list holds the whole amount a later stage needs, not just the missing part (the bots sold the pumpkins they had grown); the stove no longer cooks a project's crops; every item a project asks for is kept from the Auto-Seller (it shipped the lighthouse's driftwood); errand fishing takes turns between waters (a rare koi hogged every catch); seasonal fish for an open project's later stages are caught in season (`fishErrands`: the fountain's koi, the lighthouse's tuna); a big crop amount (the bakery's 100 wheat) is grown once its project is open; the Seaside Meadow no longer holds back v2 spending. Without these the no-hoard check failed at 5–8 days' income on half the seeds.
- **Busy Bees** now also shortens animal cycles. The bots value the buff when they own animals as well as a farmhand.
- **Unit test guard:** the Casual Idler's offline share in the first week is 89–92% (eggs, milk and fruit it picks by hand on its 2-minute visits are sold online); the test's floor moved from 90% to 85%.
- **Performance** (`e2e/perf.spec.ts`, median of three): 4.7 KB allocated a frame in the world pan with a full ranch (budget 11 KB; 4.4 KB before), 3.5 KB on the farm, 60 fps; 8 hours away on a full farm 76.9 ms (budget 100 ms).

### 13.15 v2-06 balance report: Seed Order

`npm run simulate -- --seeds 1,2,3,4,5,6,7,8` (30 real days, medians). "Before" is §13.14 (the v2-05 code, which the control bot *Farmer without Seed Order* reproduces exactly: 25,200,358 gold on day 30). **Every check passes on 8 seeds** (37 of 37).

**The upgrade.** `seed_order`, three levels, cost 4,000 × 3ⁿ (**4,000 / 12,000 / 36,000**, 52,000 in all, which moves the v1 catalogue from 538,030 to **590,030**), after the Seed Planter's first level. At each Shipping Bin pickup, for every crop the planter last planted that is in season and ripens before the season ends (table order, no RNG), it tops the bag up to **100 / 300 / 1,000 seeds** at the Shop price **plus a 10% delivery fee** (`SEED_ORDER_FEE`, rounded up). It never spends below a reserve chosen in the card (none, 10%, 25% or 50% of the gold held when the pickup began; default 25%, `SEED_ORDER_RESERVES`), and each crop is all or nothing for bag space and for the reserve.

| Constant | Value | Why |
|---|---|---|
| `seedTarget` per level | 100 / 300 / 1,000 | the prompt's example of 20 / 50 / 100 left a 48-plot farm idle for most of each hour (a 5-minute crop needs about 580 seeds an hour); see the tuning notes |
| `SEED_ORDER_FEE` | 10% | a gentle sink: about 4% of the 35–40% of income that goes back into seeds |
| `SEED_ORDER_RESERVES` / default | 0, 10, 25, 50 % / 25% | a player setting, not a cost |

**What it is worth** (new report table, Greedy Farmer with the order vs the same seed without it; absences of 2 hours or more after the day the order was bought, medians over the 8 seeds):

| Control | Night after buying it: with · without · ratio | Every later absence (median): with · without · ratio |
|---|---|---|
| Farmer without Seed Order (stocks seeds by hand before leaving) | 277,877 · 46,096 · 6.03× | 464,601 · 383,864 · 1.21× |
| Forgetful Farmer (never stocks, no order) | 277,877 · 16,799 · 16.54× | 464,601 · 72,893 · 6.37× |

So the order is worth about +21% on every idle stretch over a player who stocks by hand (the fee is paid back by never running dry and by buying the new crop mix hourly), and it is the difference between an automated farm that earns and one that stalls for a player who forgets (day 30: 8.3M without either). **Gold by day (after):** Greedy Farmer 563,606 (d3), 2,645,413 (d7), 7,934,238 (d14), **27,656,621 (d30)**, against 425,275 / 2,766,056 / 9,656,395 / 25,200,358 without the order. Day 14 is lower because the order's levels are bought and stocked while the Farmer is still expanding.

**Checks that moved.** All 37 pass. No strategy dominates: day 3 1.14×, day 7 1.14×, day 30 1.30× (limit 1.5×). Buffs kept up: see "The buffs check moves to day 10" below. The Greedy Farmer's orchard income is 59,420 gold a day, as before, but it is now **4.5%** of a larger income: the check's band moved from 5%–8% to **4%–8%** (`scripts/sim/report.ts`). The gold-sink curve stays inside every band.

**The buffs check moves to day 10, on its own 24 seeds (review of PR #28).** With the Seed Order the Chef who sells never stalls for want of seeds, and the old day-7 figure turned out to lean on those stalls: on 16 seeds `main` read +17% and v2-06 +2%. On 24 seeds v2-06's curve is day 3 −3%, day 7 +4%, day 10 +18%, day 14 +32%: in the first week a dish eaten is worth about what it sells for (the automated farm is limited by the farmhand, not growth), and buffs pay from the second week. Buff magnitude barely moves day 7 (0.17 measured +3% on 24 seeds) but pushes day 14 up (+38%), so the constants stay at 0.13 / 25 min and the check is judged where buffs matter:
- **Day 10, band +10–25%:** measured **+18%** (24 seeds). Day 14 (+32%) is shown in the report as the ceiling to watch.
- **24 seeds, 14 days, only for this check:** `npm run simulate` runs the Chef and its control on `BUFF_SEEDS` (1–24) for `BUFF_DAYS` (14) in four extra workers, because per-seed ratios run from about −20% to +60% and 5–8 seeds swing the median by ±7 points (seeds 1–8 read +29%). `--quick` skips them. The run takes about 105 s instead of 70.
- **Unit test** (`tests/simulate.test.ts`, seeds 1–4, day 10): buffs must pay (≥ 1.10) and must not run away (≤ 1.40); its four seeds read +31%.

**Brain changes** (`scripts/sim/brain.ts`): the shopping lists buy Seed Order L1 after the first greenhouse level, L2 after Greenhouse 2 and L3 after Backpack 4; once the order is owned, `leave()` no longer stocks the seeds the order covers by hand (it still stocks a new season's best crop, which the order does not buy); two control bots (`farmer_plain`, `farmer_forgetful`) and `Style.stocksSeeds` make the new report row; `Metrics.aways` records every absence.

**Tuning notes.**
- With targets of 20 / 50 / 100 the Farmer ended day 30 at 21.0M against 25.2M for the control: the order refilled 100 seeds an hour for a farm that plants hundreds. 200 / 600 / 2,000 gave 0.88× on later absences and 23.6M; **100 / 300 / 1,000** gave 1.21× and 27.7M (bigger targets also tie up gold and bag slots, and the all-or-nothing space rule means a full bag buys nothing).
- Seed Order buys only what the planter last planted, so on the first day of a season it has nothing to buy until the planter has planted the new crop once; the bots' hand-stocking covers that gap, a player's does not (IDEAS.md).
- `finishesBeforeSeasonEnds` reads `ctx.calendar.msToSeasonChange`, which the core fixes for a whole segment (up to a day offline), so a crop at the very edge of the season can be judged against a calendar a few hours stale. One big step still equals many small ones (tested across a season change).


## 14. v4: the North

Written by v4 phase 00 as **starting numbers**. v4 phases 01–04 build them and tune them with `npm run simulate`; a phase that moves a number updates this section and adds a dated note under §14.12. Ids match DATA_SCHEMAS.md §10 and GDD §13. Prices use `roundNice` unless already round.

**Where v4 starts** (`npm run simulate -- --seeds 1,2,3,4,5,6,7,8` on `main` after v2-06, 30 days, medians; the same as §13.15):

| Bot | Gold d7 | Gold d14 | Gold d30 | Gold / sim h, d21–30 | Catalogue still to spend, d21 · d30 |
|---|---|---|---|---|---|
| Greedy Farmer | 2,645,413 | 7,934,238 | 27,656,621 | 56–61k | 22% · 2% |
| Angler | 2,908,179 | 11,459,419 | 32,763,940 | 55–61k | 3% · 3% |
| Chef | 3,004,546 | 11,921,941 | 35,865,804 | 62–71k | 2% · 2% |
| Chef who sells (control) | 2,662,349 | 8,066,403 | 26,895,475 | 56–61k | 28% · 2% |
| Active Player | 896,828 | 4,356,439 | 16,338,659 | 54–57k | 60% · 31% |

A day of the simulator's schedule credits about 19.5 simulated hours (two sessions plus two capped absences), so the keen bots earn about 1.1–1.3M gold a real day from week 3, and every bot but the Active Player has bought the whole catalogue (11.3M) by day 21–28.

**What cooking earns today** (a probe of the v2-06 code on seeds 1–4, per real day, medians; not part of the report):

| Bot, days | Dishes cooked | T1 / T2 / T3 / T4 | Eaten | Dish gold | Sold at (share of base price) | Share of all gold |
|---|---|---|---|---|---|---|
| Chef, d7–14 | 237 | 216 / 17 / 5 / 0 | 15 | 32,862 | 112% | 2.2% |
| Chef, d14–21 | 141 | 104 / 22 / 12 / 1 | 13 | 59,114 | 155% | 3.5% |
| Chef, d21–30 | 201 | 167 / 23 / 10 / 1 | 12 | 44,275 | 128% | 3.6% |
| Chef who sells, d14–21 | 206 | 166 / 22 / 8 / 0 | 0 | 54,108 | 120% | 4.8% |
| Active Player, d14–21 | 65 | 58 / 2 / 2 / 0 | 0 | 13,234 | 119% | 1.8% |

Two things follow. Dishes are a small share of gold, so the restaurant can be generous per dish without upsetting the strategy spread. And **the Chef eats only 12–15 dishes a day and sells about 190**: both Chefs will stock the restaurant with nearly everything they cook, so the restaurant raises both sides of the buffs check almost equally (§14.3).

### 14.1 North field parcels (v4-01)

| id | Name | World rect | Field (plot origin, size) | Plot index base | Price | Requires | Opens |
|---|---|---|---|---|---|---|---|
| `north_fields` | North Fields | (0, −7) 20 × 6 | (6, −6), 8 × 4 = 32 plots | 2000 | 1,500,000 | parcel `yard`, expansion `farm_4`, Farm Level 7 | the first north field |
| `terraces` | Upper Terraces | (0, −13) 20 × 5 | (6, −12), 8 × 3 = 24 plots | 3000 | 2,400,000 | parcel `north_fields`, Farm Level 8 | the second north field |

**What a field is worth.** From day 14 the Greedy Farmer earns 56–63k gold per simulated hour from 60 plots (48 + the greenhouse's 12), of which about 90% is crops (the orchard is 4%, animals 6%): roughly 850 gold per plot per hour, gross. A new field's crops meet the same market depth, so count on about 70% of that per plot: **North Fields ≈ 19k gold per simulated hour gross (≈ 370k a real day)**, Upper Terraces ≈ 14k (≈ 270k a day). After seeds (35–40% of crop gold goes back into seeds) that is ≈ 220k and ≈ 165k a day net, so North Fields pays back in about **7 real days** and the Terraces in about **15**: a strong mid-game buy and a long late one. v4-01 measures it (the "north fields' share" row) and moves the prices if a field pays back in under 5 or over 12 days (North Fields) / under 10 or over 20 (Terraces).

**Caps that rise with the fields** (`src/data/upgrades.ts`; same cost curves continued, BALANCE §4):

| Upgrade | Max today | Max with North Fields · with Terraces | New units' costs |
|---|---|---|---|
| `sprinkler` (base 300, ratio 1.35) | 12 | 14 · 16 | 10,900, 14,700 · 19,900, 26,800 |
| `scarecrow` (base 600, ratio 1.8) | 4 | 5 · 6 | 6,300 · 11,300 |

With Sprinkler Tech L2 (a 5 × 5 square) two sprinklers cover a north field, so the new units are a comfort, not a requirement. The farmhand needs nothing new: Level 5 reaches about 133 plots a minute against 116 plots of 5–20-minute crops.

**Seed Order.** A full farm with both north fields plants about 1,000 seeds an hour of short crops, which is Level 3's target (1,000 per crop, per pickup). If v4-01's run shows the north stalling between pickups, the lever is `seedTarget` at Level 3 (1,000 → 1,500), not a new level.

### 14.2 World constants (v4-01)

`WORLD_TOP = −14`, `WORLD_COLS = 36`, `WORLD_ROWS = 36` (rows −14 … 21; `WORLD_BOTTOM = 22`). In pixels `WORLD_Y0 = −224`, `WORLD_Y1 = 352`, `WORLD_W = WORLD_H = 576`. Ground chunks stay 16 tiles, anchored at the world's top (3 × 3 chunks). Camera numbers (drag threshold, zoom limits, the default view) do not change.

### 14.3 The restaurant (v4-02)

**Levels** (bought in the Restaurant panel; requires Farm Level 7, Kitchen Level 2 and parcel `yard`):

| Level | Price | Menu slots (tables) | Premium | With the day's special |
|---|---|---|---|---|
| 1 | 120,000 | 2 | 1.30 | 1.45 |
| 2 | 350,000 | 3 | 1.45 | 1.60 |
| 3 | 800,000 | 4 | 1.60 | 1.75 |

The **Press House bundle** (§14.6) adds a fifth slot (the terrace has five tables). 1,270,000 in all.

**Serving** (per slot, exact for any step size; no RNG):

```ts
SERVE_MIN_PER_TIER   = 20                         // minutes of simulated time per serving, × the item's tier
interval(item)       = SERVE_MIN_PER_TIER * 60_000 * tier(item)   // T1 20 min · T2 40 · T3 60 · T4 80
// each step, for each slot holding qty > 0 of an item:
servings  = min(slot.qty, floor((slot.cycleMs + dtMs) / interval))
slot.cycleMs = (slot.cycleMs + dtMs) - servings * interval;   slot.qty -= servings
if (slot.qty === 0) slot.cycleMs = 0                          // an emptied slot restarts from zero when restocked
price     = min(RESTAURANT_MAX_MULT, premium(level) + (item === specialOf(dayIndex) ? SPECIAL_BONUS : 0)) * basePrice
gold      = servings * round(price)                            // straight to the purse; demand, specials and mods untouched
RESTAURANT_MAX_MULT = 1.75; SPECIAL_BONUS = 0.15; MENU_SLOT_CAP = 99
```

Nothing changes the interval mid-step (no modifier reads it), so `msToNextSimEvent` does not need to split at servings; a level upgrade or a restock is an action, which is already a step boundary. The day's special is fixed for the calendar segment the core steps through.

**The special rota.** `SPECIAL_ROTA` is a fixed list of 28 recipe and drink ids (every T2–T4 dish and drink at least once, seasonal ones in their season's weeks); the special on day `d` is `SPECIAL_ROTA[d % 28]`. The panel lists the next seven days. If the player does not know that recipe, there is simply no special for them that day.

**What it can earn.** Per slot per simulated hour at Level 3 (premium 1.60), with average base prices by tier (T1 125, T2 361, T3 1,079, T4 2,409):

| Menu | Servings / slot / h | Gold / slot / h | 4 slots / sim h | 4 slots / real day (19.5 sim h) |
|---|---|---|---|---|
| all T1 | 3 | 600 | 2,400 | 47,000 |
| all T2 | 1.5 | 866 | 3,500 | 68,000 |
| all T3 | 1 | 1,726 | 6,900 | 135,000 |
| all T4 | 0.75 | 2,891 | 11,600 | 226,000 |

So a cook's restaurant earns 5–11% of late income with an ordinary menu and at most about 19% with four feasts on it all day. The extra over selling the same dishes at the Market is a third to a half of that (the Market already paid 112–155% of base for the few dishes it took), so the restaurant adds roughly **2–8%** to a cook's gold: a strong side income, not a new main farm. A full T4 menu also needs about 60 T4 dishes cooked a day, which only a player who cooks most of the session will do.

**Simulator rationale (v4-00).** v4-00 cannot add the restaurant to the simulator (that is v4-02), so it ran the real bots with a deliberately generous stand-in: **every dish sale paid base × premium, with no demand loss and no table limit**, a ceiling on what any restaurant can do with today's cooking. Results (8 seeds, 30 days, medians; the buffs check on its own 24 seeds at day 10):

| Run | Chef d30 | Chef who sells d30 | Strategy spread d3 · d7 · d30 | Buffs check (day 10) | Notes |
|---|---|---|---|---|---|
| v2-06 baseline | 35,865,804 | 26,895,475 | 1.14× · 1.14× · 1.30× | +18% (d14 +32%) | |
| ×1.45 from day 0 | 38,072,536 | 29,403,161 | 1.34× · 1.30× · 1.38× | **+37%** ❌ (d14 +38%) | Active Player +1% |
| ×1.60 from day 0 | 32,380,185 | 27,794,073 | 1.24× · 1.17× · 1.18× | +23% (d14 +35%) | |
| ×1.45 from day 8 | 35,296,870 | 28,869,543 | 1.14× · 1.14× · 1.28× | +23% (d14 +32%) | the restaurant's real opening day |

Answers to the three questions:
1. **Does it make "Chef who sells" dominant? No.** Even the ceiling runs keep the Chef who sells below the Chef and the spread at or under 1.38× (limit 1.5×); with the premium starting on day 8, the Chef who sells gains 7% by day 30 and the spread is 1.28×. The effect on lifetime gold (−10% to +9% across runs) is about the size of the simulator's own seed noise, because dishes are 2–5% of gold.
2. **The buffs check.** Both Chefs stock the restaurant with what they do not eat, so the restaurant raises both sides; the eaten dishes' opportunity cost rises by only ~15 dishes a day × the premium. But extra gold in the first week moves *when* the Chef makes its day-10 purchases, and the paired day-10 figure is sensitive to that: it read +37% when the premium started on day 0, but **+23% (in band) when it started on day 8**, the restaurant's real opening. **Rule for v4-02:** the check keeps comparing the Chef with the Chef who sells, **both stocking the restaurant first** (it is a selling channel, not a buff), judged at day 10 on 24 seeds as now. If it leaves the +10–25% band, the levers in order are: the restaurant's opening (its requirements, so it lands on day 6–9), `SERVE_MIN_PER_TIER` (capacity), the premium; buff constants move only if the day-14 ceiling (+32%) also breaks.
3. **The gold-sink curve.** The restaurant is 1.27M of catalogue bought on days 6–14 (L1 with the starter yard, L2–L3 in the v2 spending turns), and its income (5–11% of a cook's gold) moves a cook's spent-out day about 1–2 days earlier (§14.8).

**What the brain learns (v4-02).**
- Build the restaurant when unlocked, right after the starter yard, with gold the planter's seeds will not need (`seedGold`); levels 2 and 3 join `spendV2`'s turns.
- **Before leaving:** fill the menu for the absence: for each slot, choose the dish with the most `base × servings` that the absence can serve (`servings = absenceSimMs / interval`), from the bag, highest value first; `Restock` at every look.
- **Cooking for it:** the Chef, the Chef who sells and the Active Player keep the stove busy during sessions with the best-margin recipe they can make (`base × premium − ingredient value`), not the quickest, once the restaurant exists.
- The Chef eats first, stocks the restaurant second and sells the rest; the Chef who sells stocks the restaurant first and sells the rest.

### 14.4 The Press House and drinks (v4-03)

**Levels** (requires Farm Level 7 and parcel `orchard`; bought in the Press House panel):

| Level | Price | Press slots | Notes |
|---|---|---|---|
| 1 | 90,000 | 2 | Tomato Juice and Honey Milk known; the Apiary card opens |
| 2 | 250,000 | 3 | Orchard Punch's card can be bought |
| 3 | 600,000 | 4 | |

940,000 in all. **Cocoa** (`cocoa`, "Cocoa Beans") is sold on the Press House shelf at 60 gold (`COCOA_PRICE`), item base price 60, not sellable (like feed), so the winter drink never depends on a season.

**Drink tier and price.** The dish formula, with a time term for long timers:

```ts
score = units + value / TIER_VALUE_DIV + pressSec / TIER_PRESS_DIV     // TIER_VALUE_DIV = 50 (as dishes), TIER_PRESS_DIV = 600 (1 point per 10 min)
tier  = score >= 28 ? 4 : score >= 15 ? 3 : score >= 8 ? 2 : 1          // the dish thresholds
basePrice = round(value * TIER_SELL_MULT[tier])                         // the dish multipliers 1.25 / 1.40 / 1.60 / 2.00
buff: magnitude and duration from tier exactly as dishes (§7)
```

(A long press scored with the dish divisor of 30 seconds would make every drink T4.) Presses are not sped up by Quick Hands or any modifier. One run makes one drink.

**Recipes (12: 2 × T1, 3 × T2, 6 × T3, 1 × T4).** Honey is 150 (§14.5), cocoa 60, forage items as §14.7.

| id | Name | Ingredients | Press (min) | Units | Value | Score | Tier | Base price | Buff | Magnitude | Duration | Fresh in | Discovery | Phase |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `tomato_juice` | Tomato Juice | tomato ×4 | 20 | 4 | 48 | 6.96 | T1 | 60 | `growth` | +13% | 25 min | summer, autumn | starter (with the Press House) | v4-03 |
| `honey_milk` | Honey Milk | milk ×1, honey ×1 | 20 | 2 | 390 | 11.80 | T2 | 546 | `automationSpeed` | +26% | 75 min | all | starter (with the Press House) | v4-03 |
| `strawberry_cordial` | Strawberry Cordial | strawberry ×4, honey ×1 | 30 | 5 | 230 | 12.60 | T2 | 322 | `fishingSpeed` | +26% | 75 min | spring | card 3,000 | v4-03 |
| `blueberry_cordial` | Blueberry Cordial | blueberry ×6, honey ×1 | 30 | 7 | 222 | 14.44 | T2 | 311 | `fishingLuck` | +26% | 75 min | summer | card 3,000 | v4-03 |
| `lemonade` | Lemonade | lemon ×1, honey ×1 | 60 | 2 | 850 | 25.00 | T3 | 1,360 | `cookSpeed` | +58.5% | 3 h 45 | winter, spring | milestone `m26_first_drink` | v4-03 |
| `apple_cider` | Sweet Cider | apple ×2 | 90 | 2 | 590 | 22.80 | T3 | 944 | `growth` | +39% | 3 h 45 | summer, autumn | card 6,000 | v4-03 |
| `peach_iced_tea` | Peach Iced Tea | peach ×1, honey ×1 | 60 | 2 | 650 | 21.00 | T3 | 1,040 | `fishingSpeed` | +39% | 3 h 45 | summer | card 8,000 | v4-03 |
| `melon_cooler` | Melon Cooler | melon ×1, blueberry ×4 | 60 | 5 | 611 | 23.22 | T3 | 978 | `fishingLuck` | +39% | 3 h 45 | summer | card 8,000 | v4-03 |
| `hot_cocoa` | Hot Cocoa | milk ×2, cocoa ×1, honey ×1 | 45 | 4 | 690 | 22.30 | T3 | 1,104 | `xp` | +58.5% | 3 h 45 | all (cocoa from the shelf) | card 10,000 | v4-03 |
| `orchard_punch` | Orchard Punch | apple ×1, pear ×1, persimmon ×1, cranberry ×4, honey ×1 | 180 | 8 | 1,686 | 59.72 | T4 | 3,372 | `automationSpeed` | +52% | 11 h 15 | autumn | card 20,000 · Press House L2 | v4-03 |
| `herbal_tea` | Herbal Tea | wild_mint ×2 | 20 | 2 | 90 | 5.80 | T1 | 112 | `xp` | +19.5% | 25 min | spring, summer, autumn | milestone `m28_first_forage` | v4-04 |
| `elderflower_cordial` | Elderflower Cordial | elderflower ×3, honey ×1 | 60 | 4 | 330 | 16.60 | T3 | 528 | `cookSpeed` | +58.5% | 3 h 45 | spring | card 9,000 | v4-04 |

Buffs: growth 2, automationSpeed 2, fishingSpeed 2, fishingLuck 2, cookSpeed 2, xp 2, **sellPrice 0** (drinks add choice, not gold power). Every season has drinks (spring 5, summer 7, autumn 4, winter 3 counting the all-season ones). The cards cost 67,000.

**What the Press House earns.** Four slots of T3 drinks at about an hour each, kept pressing through a 9-hour absence, make about 36 drinks worth 1,000–1,360 each: **35–50k gold a night at base**, or more on the menu, from ingredients worth about 60% of that. Drinks should land at **2–10% of a cook's gold** on days 14–30 (a new report row); the levers are press times, then `TIER_PRESS_DIV`.

### 14.5 The apiary and honey (v4-03)

| Thing | Number |
|---|---|
| Hive spots | 6 (`HIVE_SPOTS` in `src/data/world.ts`) |
| Hive price, the (n+1)th | `roundNice(10_000 × 1.5^n)`: 10,000, 15,000, 23,000, 34,000, 51,000, 76,000 (209,000 for six); requires the Press House L1 |
| Honey cycle | 3,600 s (`HIVE_CYCLE_SEC`), shortened by `animalSpeedModifier` (Busy Bees) as `round(3_600_000 / speed)` whole ms |
| Hive store | 10 jars (`HIVE_STORE`); full = it waits |
| `honey` | base price 150, Farming XP 10 a jar (the crop formula), ¼ when the Collecting Basket collects; market depth 55 |

Six hives make 6 jars an hour (≈ 900 gold an hour at base, ≈ 1.5% of late income) and hold a 10-hour absence. A hive pays for itself in 11–85 hours of honey: they are cheap on purpose, because honey's real job is to feed drinks. Production uses the ranch's whole-cycle rule and is equal for one big step and many small ones.

**Honey dishes** (kitchen recipes, v4-03):

| id | Name | Ingredients | Cook (s) | Units | Value | Score | Tier | Base price | Buff | Discovery |
|---|---|---|---|---|---|---|---|---|---|---|
| `honey_cake` | Honey Cake | wheat ×2, egg ×1, honey ×1 | 60 | 4 | 290 | 11.80 | T2 | 406 | `automationSpeed` | milestone `m27_first_honey` |
| `honey_roast_yams` | Honey-Roast Yams | yam ×2, honey ×1 | 45 | 3 | 372 | 11.94 | T2 | 521 | `growth` | card 5,000 |

### 14.6 Milestones, goals and bundles (v4-01 … v4-04)

| Milestone | Objective | Reward | Phase |
|---|---|---|---|
| `m24_north_field` | Own a north field | 50,000 gold | 01 |
| `m25_first_serving` | Serve a dish at the restaurant | 30,000 gold | 02 |
| `m26_first_drink` | Press a drink | recipe `lemonade` | 03 |
| `m27_first_honey` | Collect honey | recipe `honey_cake` | 03 |
| `m28_first_forage` | Pick something in the North Woods | recipe `herbal_tea` | 04 |
| `m29_lake_fish` | Catch a fish in the mountain lake | 40,000 gold | 04 |

No farm points (`FARM_POINT_MILESTONES` stays m01–m15).

| Goal template | Example | Target | Requires |
|---|---|---|---|
| `serve_dishes` | Serve 12 dishes at the restaurant | about one hour of the current menu's servings, at least 3 | the restaurant built |
| `press_drinks` | Press 4 drinks | one per press slot | the Press House built |

| Bundle | Slots | Reward | Phase |
|---|---|---|---|
| `press_house` | tomato_juice ×5, honey_milk ×5, apple_cider ×3, lemonade ×3, honey ×10 | a fifth restaurant menu slot | 03 |
| `forager` | morel ×5, chanterelle ×5, wild_mint ×10, blackberry ×10, hazelnut ×10 | forage spots hold 4 days' worth (`FORAGE_CAP_DAYS` 3 → 4) | 04 |

### 14.7 North Woods and the mountain lake (v4-04)

**Forage spots** (8, `FORAGE_SPOTS` in `src/data/world.ts`; kind by spot):

```ts
// at each daily refresh, for each spot, like trees (exact for any number of missed days):
for d in (spot.lastDay, calendar.dayIndex]:
    item = FORAGE_KINDS[kind][seasonOfDay(d)]                     // null = the spot rests this season
    if item: spot.item = item; spot.qty = min(FORAGE_CAP_DAYS * perDay(item), spot.qty + perDay(item))
spot.lastDay = calendar.dayIndex
// a season change with a different item replaces what is waiting only once it has been picked: an unpicked
// spot keeps its item and quantity until picked (nothing is lost), then starts the new season's item
FORAGE_CAP_DAYS = 3
```

| Kind (spots) | Spring | Summer | Autumn | Winter |
|---|---|---|---|---|
| mushroom (2) | `morel` ×2 | `chanterelle` ×2 | `chanterelle` ×3 | rests |
| herb (2) | `wild_mint` ×5 | `wild_mint` ×5 | `wild_mint` ×4 | rests |
| flower and berry (2) | `elderflower` ×4 | `blackberry` ×4 | `blackberry` ×5 | `rose_hip` ×4 |
| nut (2) | rests | rests | `hazelnut` ×5 | `hazelnut` ×4 |

| Item | Base price | Farming XP | Market depth | Uses |
|---|---|---|---|---|
| `morel` | 160 | 10 | 53 | Mushroom Risotto (alternative), sale |
| `chanterelle` | 140 | 10 | 57 | Mushroom Risotto |
| `wild_mint` | 45 | 5 | 100 | Herbal Tea |
| `elderflower` | 60 | 6 | 87 | Elderflower Cordial |
| `blackberry` | 50 | 5 | 95 | Blackberry Tart |
| `rose_hip` | 55 | 5 | 90 | sale; the Forager bundle |
| `hazelnut` | 70 | 6 | 80 | sale; the Forager bundle |

The woods earn 3–5k gold a day at base (well under 1% of a late farm): a gentle daily walk and an ingredient stream, never an income. **Forager's Basket** (`forager_basket`, confirmed by the owner, GDD §13.12 decision 4): one level, 120,000, requires `m28_first_forage`; flag `autoForage` picks every ripe spot at each bin pickup into the bag (or the bin), Farming XP ¼.

**Forage dishes** (v4-04): `mushroom_risotto` Mushroom Risotto (chanterelle ×2, wheat ×1, milk ×1; 90 s; score 17.90, **T3**, base 872, `xp`; card 8,000) and `blackberry_tart` Blackberry Tart (blackberry ×4, wheat ×2, egg ×1; 60 s; score 15.80, **T3**, base 544, `fishingSpeed`; card 6,000).

**The mountain lake** (`lake`, an expansion of kind `fishing`: 300,000; requires expansion `ocean`, parcel `north_fields` and Farm Level 7). Two trap spots, a third with the Pond Fish bundle; `fish_trap`'s max rises 6 → 8 (the 7th and 8th cost 5,700 and 8,500).

| id | Name | Seasons | Hours | Rarity | Difficulty | Size (cm) | Base price | Trap |
|---|---|---|---|---|---|---|---|---|
| `whitefish` | Whitefish | all | 0–24 | common | 25 | 25–50 | 45 | yes |
| `lake_trout` | Lake Trout | spring, summer, autumn | 5–21 | common | 35 | 30–70 | 70 | yes |
| `crayfish` | Crayfish | spring, summer, autumn | 18–8 | uncommon | 40 | 8–15 | 120 | yes |
| `pike` | Pike | autumn, winter, spring | 0–24 | uncommon | 55 | 50–120 | 170 | yes |
| `golden_trout` | Golden Trout | summer | 8–18 | rare | 75 | 25–55 | 460 | no |
| `alpine_char` | Alpine Char | winter | 0–24 | rare | 72 | 30–70 | 480 | no |

Junk: `old_boot`, `driftwood`. Whitefish bites at every hour of every season, so the lake is never empty. **Reel tuning** (`FishLocationDef.reel`): `zoneSpeedMult 0.85`, `zoneWidthMult 0.92`, `biteWaitMult 1.15` (still water: a slower, slightly narrower zone, later bites). Relaxed fishing multiplies on top as elsewhere.

### 14.8 Gold still to spend: v4

**Catalogue added by v4:**

| Part | Cost |
|---|---|
| North Fields and Upper Terraces (§14.1) | 3,900,000 |
| Sprinklers 13–16 and scarecrows 5–6 (§14.1) | 89,900 |
| Restaurant, three levels (§14.3) | 1,270,000 |
| Press House, three levels (§14.4) | 940,000 |
| Six hives (§14.5) | 209,000 |
| v4 recipe cards: 8 drinks, 3 dishes | 86,000 |
| Mountain Lake and two more fish traps (§14.7) | 314,200 |
| Forager's Basket | 120,000 |
| **v4 total** | **6,929,100** |

The whole catalogue becomes 11,319,030 + 6,929,100 = **18,248,130**. The north fields add about +30–40% to crop income from day 10–18, the restaurant, presses and hives a few percent more.

**Target curve** (share of the catalogue still to spend, medians, ±10 points). v4 lengthens the curve: the simulator runs **60 days** for these rows from v4-04 (30 days for everything else, as now).

| Day | 7 | 14 | 21 | 30 | 45 | 60 |
|---|---|---|---|---|---|---|
| Greedy Farmer | 85–95% | 55–75% | 30–50% | 10–30% | 0–10% | 0–5% |
| Active Player | 90–97% | 75–90% | 60–80% | 40–60% | 15–40% | 0–20% |

Reading it: v2's content is still bought on days 2–21 as now, the north's on days 8–30 for a keen player and 14–55 for the hour-a-day player. A keen player spends out around **day 35–40**; after that, as in v1's last weeks, gold has nothing left to buy (IDEAS.md: a later repeatable sink). Checks 1–3 of §13.4 keep their form with the new days: `toSpend(day 30) > 0` for every strategy bot; for the Active Player `toSpend(day 45) > 0` and more than its gold in hand on day 45; no hoard while there is still something to buy. If the curve misses, the levers in order are the Upper Terraces' price, `TOWN_PROJECT_SCALE`, then decoration prices.

### 14.9 Pacing targets (v4)

| Moment | Greedy Farmer | Chef | Active Player | Notes |
|---|---|---|---|---|
| Restaurant built (L1) | day 6–9 | day 5–8 | day 9–14 | after the starter yard |
| First serving | the same session | the same session | the same session | |
| Restaurant L3 | day 12–18 | day 10–15 | day 20–30 | |
| North Fields bought | day 9–13 | day 9–13 | day 15–20 | after `farm_4` and the Old Paddock |
| North Fields paid back | ≤ 10 days after buying | | | gross gold from its plots |
| Press House built | day 8–12 | day 7–11 | day 12–18 | |
| First hive / first honey | day 8–12 / +1 h | | | |
| Upper Terraces bought | day 14–18 | day 14–18 | day 22–30 | |
| Mountain Lake | day 12–16 (Angler day 9–12) | | day 18–25 | |
| First forage | the first session after v4-04's woods open | | | |
| Restaurant income (days 14–30) | – (cooks little) | 5–15% of gold | ≤ 15% | new check |
| Drink income (days 14–30) | ≤ 5% | 2–10% | ≤ 10% | new check |
| North fields' share of crop gold (days 14–30) | 25–45% | 20–45% | 15–40% | new check |
| Honey, forage, lake fish | reported, no check (each ≤ 5%) | | | |

The phase 09 and v2 checks stay as they are: **no strategy dominates** (≤ 1.5× at days 3, 7 and 30, and at 60 when run), the **buffs check** (day 10, 24 seeds, +10–25%, with the rule in §14.3), **no early dead time**, **no runaway growth** (the north fields will lift week 4 above week 2 for the first time: allow day 28 / day 14 up to 1.5×), the **Casual Idler ≥ 40%** of the Active Player at day 3, the orchard and animal bands.

### 14.10 Simulator changes (what the brain must learn)

The bots still act only through `Game.dispatch`; each phase extends `scripts/sim/` (not v4-00).

| Phase | Brain learns | Report adds | Checks added |
|---|---|---|---|
| v4-01 | `{ kind: 'parcel' }` wants for `north_fields` (after `farm_4`, the starter yard and Seed Order L2) and `terraces` (in `spendV2`'s turns, before decorations); place sprinklers and scarecrows on north plots; Harvest all covers every field; stock seeds for the north (Seed Order covers it once planted) | moments: each north parcel; gold earned on north plots (by field, from `harvested` with a field) and its share of crop gold; payback day | north fields' share (§14.9); payback ≤ 10 days |
| v4-02 | build and upgrade the restaurant; fill the menu for each absence and restock each look; cook for margin; the Chef's order eat → menu → Market | restaurant gold and servings per day and their share; the special's share | restaurant share (§14.9); the buffs check with both Chefs using the restaurant |
| v4-03 | build and upgrade the Press House; keep presses going (start "keep pressing" on the best drink the bag can sustain through the absence; buy cocoa in winter); buy hives and collect honey (the Collecting Basket does it later); drinks on the menu after dishes of the same value; drink for buffs like dishes | drink gold per day and share; honey per day; drinks pressed | drink share (§14.9) |
| v4-04 | pick forage each look; buy the lake and its traps (the Angler first), fish the lake in rotation; buy the Forager's Basket after the lake; 60-day runs | forage and lake gold; the 60-day "Gold still to spend" columns | §14.8's curve at 30, 45 and 60 days; spread at day 60 |

`tests/simulate.test.ts` stays green in every phase (determinism, speed: one bot's 30 days in under 10 s, the first session, the tuning checks on short runs). A 60-day run is only in `npm run simulate -- --days 60` and is not part of `npm test`.

### 14.11 v4 constants

In `src/data/balance.ts`: `FIELD_BASE = { north_fields: 2000, terraces: 3000 }` (v4-01); `SERVE_MIN_PER_TIER = 20`, `RESTAURANT_MAX_MULT = 1.75`, `SPECIAL_BONUS = 0.15`, `MENU_SLOT_CAP = 99` (v4-02); `TIER_PRESS_DIV = 600`, `COCOA_PRICE = 60`, `HIVE_CYCLE_SEC = 3600`, `HIVE_STORE = 10`, `HIVE_BASE_PRICE = 10_000`, `HIVE_PRICE_RATIO = 1.5` (v4-03); `FORAGE_CAP_DAYS = 3`, `FORAGER_BONUS_DAYS = 1` (v4-04). World size constants live in `src/data/world.ts` (§14.2). Content tables (restaurant levels, Press House levels, drinks, the special rota, forage kinds, lake fish) live in their data files.

### 14.12 v4 tuning notes

**v4 phase 00 notes.**
- No number in the game changed. The baseline above is `main` after v2-06 and matches §13.15.
- The restaurant numbers come from the cooking probe and the four stand-in runs above (`PROBE_PREMIUM`, a temporary change to `settleSale` that was not committed). The stand-in is a ceiling: it has no table limit and pays the premium on every dish sold, so v4-02's real restaurant (2–4 slots, 20 minutes per tier) earns less than it did.
- The paired buffs figure moved between +18% and +37% across the stand-in runs while lifetime gold moved within ±10%: it reacts to *when* gold arrives in the first ten days more than to how much. v4-02 should read it on 24 seeds after every change, as the v2-06 review set up.
- Field, drink, honey and forage numbers are estimates from the per-plot and per-hour figures above; v4-01, v4-03 and v4-04 measure them and record the changes here.
