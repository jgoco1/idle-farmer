# Hearthfield Idle: Game Design Document

> Working title. See the questions for the owner at the end.
> Companion docs: `docs/BALANCE.md` (every number), `docs/DATA_SCHEMAS.md` (every type and id), `docs/ART_STYLE.md` (palette, sprites, UI look). This document says **what** the game is and **why**; the others say **how much** and **in what shape**.

---

## 1. Pitch

*Hearthfield Idle* is a cozy browser game about a small farm that keeps growing while you're away. On a single hand-drawn pixel-art scene you till a patch of soil, plant turnips, fish the pond, and cook what you grow in the farmhouse kitchen. Every dish you eat gives a gentle, themed boost: soup that helps crops grow, fish stew that brings rarer fish. Little by little you hire a farmhand, set up sprinklers and fish traps, open up the river and the old dock, and fill the Community Board, until the farm hums along on its own and every visit brings a basket of things to sell, cook, or save for something new.

## 2. Design pillars

1. **Cozy, never punishing.** Nothing is ever lost. Dry crops grow slower, not die; a full inventory leaves crops waiting in the ground; failed fishing just lets the fish go; failed cooking experiments return the ingredients. The only hard rule is seasons, and the game warns you before it bites.
2. **Always something growing.** At any moment there is a timer about to finish and a next thing to save for. Early on nobody waits more than ~2 minutes with nothing to do.
3. **Your absence is part of play.** Offline time is a feature, not a gap. Automation is the main thing you buy, and coming back to a "While you were away…" basket is a reward.
4. **Small choices with character.** Which crop to grow this season, which dish to eat before you leave, which market to rest. Choices are gentle and legible, never spreadsheets.
5. **Everything visible on one screen.** The farm scene is the game. Every purchase changes it: the fence moves, a river appears, a farmhand trots between rows.

## 3. Core loop

```
         ┌──────────────────────────────────────────────────────────────┐
         │                                                              │
         ▼                                                              │
   ┌──────────┐   ┌──────────┐   ┌───────────┐   ┌──────────────────┐   │
   │  PLANT   │──►│  GROW    │──►│  HARVEST  │──►│ SELL  or  COOK   │   │
   │ (seeds)  │   │ (timers, │   │ (click or │   │ market / bin  /  │   │
   └──────────┘   │  water)  │   │ farmhand) │   │ kitchen → EAT    │   │
         ▲        └──────────┘   └───────────┘   └────────┬─────────┘   │
         │                                                │ gold   buffs│
         │        ┌──────────┐   ┌──────────┐   ┌─────────▼─────────┐   │
         └────────│  EXPAND  │◄──│ AUTOMATE │◄──│     UPGRADE       │◄──┘
                  │ (plots,  │   │ (idle    │   │ (tools, storage,  │
                  │ river,   │   │ income)  │   │  kitchen, rods)   │
                  │ dock)    │   └──────────┘   └───────────────────┘
                  └──────────┘
   Fishing runs alongside: pond → river → ocean; catches are sold or cooked.
   Goals, milestones and bundles sit on top and point at the next step.
```

Short loop (seconds to minutes): click plots, water, harvest, sell, cast a line.
Medium loop (a session): save for an upgrade, cook a dish before leaving, finish a goal.
Long loop (days): unlock locations, complete bundles, reach higher farm levels, build the greenhouse.

## 4. Time model

The game has **two clocks**.

| Clock | Follows | Drives |
|---|---|---|
| **Calendar** | the player's real local clock | time of day (night is 20:00–06:00), the daily 06:00 refresh, seasons (one real week each, changing at local Saturday → Sunday midnight), the year (4 weeks) |
| **Simulated time** | real time while playing; a capped amount while away | every timer: crop growth, watering, cooking, buffs, traps, the farmhand, shipping-bin pickups, market recovery |

**Why two clocks.** A real calendar makes the farm feel like it lives alongside the player: it's dark on the farm when it's dark outside, specials change each morning, and each week has a season with its own crops and fish. That gives a gentle reason to look in daily and weekly without ever demanding it. But crops can't take real days to grow in an idle game's first session, so timers stay short: a turnip takes 2 minutes, a pumpkin 20, a T4 dish 4 minutes to cook, and buffs last 15 minutes to about 7 hours. That keeps the "nobody waits more than ~2 minutes early on" target.

**What follows from it:**
- **Seasons:** every save starts in **spring**, whatever the real date. The first counted Saturday → Sunday midnight at least 3 days after the save was made changes spring to summer; after that, seasons change every week in the order spring, summer, autumn, winter. At a season change, crops that can't grow in the new season wither (greenhouse excepted). During the last two days of a season the HUD shows "Season changes in 2d 4h", and the shop warns about seeds that won't finish in time.
- **Watering:** one watering lasts 2 hours of simulated time. Dry crops grow at half speed. Sprinkler-covered plots are always watered, which is what makes sprinklers worth buying for time spent away.
- **Daily refresh (06:00 local):** market specials re-roll, the market sparkline records a point, and per-day goals and "gold today" reset. If several days pass while away, the refresh happens once.
- **Shipping bin:** collected every 60 minutes of simulated time, paid at the prices of that moment.
- **Day/night** is visual (a tint over the scene, fireflies at night from phase 08) and decides which fish bite. Crops grow at night too.
- **Winter is cooking season** (§7): dishes cooked in winter are *hearty* (their buffs last 50% longer), Cooking XP is +50%, and dishes sell for +25%.
- **Storage:** the simulated clock is one integer, `clock.simMs`. The calendar is computed from the real time and the save's creation date, and the week index is never allowed to go backwards if the system clock is set back. See BALANCE.md §1.
- **Fruit trees (v2) count real days.** A tree's age is the number of real calendar days (06:00 → 06:00 local, the same "day" as the daily refresh) since it was planted, read from a monotonic `calendar.dayIndex` that never goes backwards, like the week index. It is **not** simulated time, so the offline cap does not slow a tree down: a tree planted before a week away is a week older when you come back. Fruit also appears by calendar day (once per day, in season, up to a cap; §12.3). Trees never wither. Trees are the only v2 content on the calendar clock; animals run on simulated time, and decorations and town projects have no timers.

**Offline progress.** On load (and when a hidden tab returns), the game measures the real time since the last save. The first **8 hours count at full rate**; the next **16 hours count at 25%**; anything beyond **24 hours adds nothing** (the farm "rests"). So the most a single absence can be worth is 12 hours of simulated time. While away, the calendar still moves in real time (so a season can change and crops can wither), but timers only advance by the capped amount. The simulation walks the real timeline in large, exact steps, split at every calendar event, buff expiry and cook completion, and a **"While you were away…"** summary lists what happened. Exact formula: BALANCE.md §1.

## 5. Screen layout

> **v2:** the scene becomes a **world of 36 × 22 tiles** seen through a camera you can pan and zoom (§12.1). The v1 layout below is kept tile for tile as the **home region** in the world's top-left corner, and the default view frames exactly that region, so a v1 player sees the same farm. The HUD and toolbar are unchanged apart from three additions: a **Home** button and a **Decorate** toggle in the scene controls, and a **Ranch** toolbar button once the animal yard is bought. On phones the scene fills the space between the HUD and the toolbar at the largest integer zoom that fits the home region's height (at least 2×), and one finger pans (§12.1).

One screen. The scene is a 320 × 192 logical-pixel canvas (20 × 12 tiles) scaled by an integer factor. The HUD is a DOM strip across the top; panels open on the right on desktop and as bottom sheets on phones (phase 08).

```
┌────────────────────────────────────────────────────────────────────────────────────────────┐
│ ◉ 1,240g   │ Spring · Tue 9:40 AM ☀│ [🌱 Green Thumb 5m][🐟 Angler's Luck 20m][ + ]  │ 🔔 ⚙ │  HUD
├────────────────────────────────────────────────────────────────┬───────────────────────────┤
│  🌳    ~~~~ sky / tree line ~~~~                    🌳   🌳      │  ┌─ MARKET ────────── ✕ ┐ │
│  ┌──────────┐                                    ┌──────────┐   │  │ Today's specials: 🍅 │ │
│  │FARMHOUSE │  ┌─fence──────────────────────┐    │GREENHOUSE│   │  │  Turnip   22g ▼ ▁▂▄▆ │ │
│  │ (Kitchen)│  │ ▒▒ ▒▒ ▒▒ ▒▒ . . . .        │    │ (locked  │   │  │  Potato   41g ▲ ▆▄▅▇ │ │
│  │  ░chimney│  │ ▒▒ ▒▒ ▒▒ ▒▒ . . . .        │    │  lot)    │   │  │  [Sell 1][10][All]   │ │
│  └──────────┘  │ .  .  .  .  . . . .  PLOTS │    └──────────┘   │  │  Preview: +198g      │ │
│   🐕  path     │ .  .  .  .  . . . .  (4×2  │                   │  └──────────────────────┘ │
│    ░░░░░░░░░░░ │ .  .  .  .  . . . .  → 8×6)│   ┌─────────┐     │                           │
│  ┌──────┐      │ .  .  .  .  . . . .        │   │ MARKET  │ 📦  │  Panels (one at a time):  │
│  │ POND │      └────────────────────────────┘   │  STALL  │ bin │  Inventory · Shop ·       │
│  │  ≈≈  │                                       └─────────┘     │  Market · Kitchen ·       │
│  └──────┘    ≈≈≈≈≈≈≈≈≈ RIVER (unlock) ≈≈≈≈≈≈≈≈≈≈≈   ▤▤ DOCK ≈≈≈  │  Fishing · Upgrades ·     │
│              ≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈≈   ▤▤ (ocean)   │  Goals · Settings         │
├────────────────────────────────────────────────────────────────┴───────────────────────────┤
│ [🎒 Inventory] [🛒 Shop] [⚖ Market] [🍲 Kitchen] [🎣 Fishing] [⚙ Upgrades] [★ Goals]   tools: │
│                                                          [Auto][Hoe][Seeds ▾][Can][Hand]   │  toolbar
└────────────────────────────────────────────────────────────────────────────────────────────┘
      ▲ toasts appear bottom-centre above the toolbar ("+3 Turnips", "New seeds in the shop!")
```

**Clickable zones:**

| Zone | Tiles (col,row) | Click does |
|---|---|---|
| Plot grid | starts at (6,2), 4 × 2; grows to 8 × 6 | runs the selected tool on the plot (Auto picks the obvious action) |
| Farmhouse | (1,1)–(4,3) | opens **Kitchen** |
| Pond | (1,7)–(4,10) | opens **Fishing** (pond) |
| Market stall | (15,6)–(17,8) | opens **Market** |
| Shipping bin | (18,7) | opens the Market panel, whose Shipping Bin section holds items for the next hourly pickup |
| Greenhouse | (15,1)–(18,4) | locked lot → hint; built → greenhouse plots |
| River | row 10–11, cols 6–14 | locked → hint + price; unlocked → **Fishing** (river) |
| Dock | (15,10)–(19,11) | locked → hint + price; unlocked → **Fishing** (ocean) |
| Community Board (v2) | (4,16), in the town square | opens **Goals** (its Community Board tab) |
| "For sale" signs (v2) | (21,3), (21,11), (21,17) | locked parcel → price and what it needs; buyable → a confirm to buy it |

**HUD:** gold (animated count-up from phase 03), season, weekday and local time with a sun/moon icon, active buff icons with a remaining-time ring (phase 06), a notification bell for recent toasts, settings. **Toolbar:** panel buttons and the farming tool selector (phase 02).

## 6. Systems

Each section lists: player actions · idle behaviour · unlocks · the phase that builds it.

### 6.1 Farming (phase 02; automation hooks in 04)
- **Actions:** select a tool (Auto, Hoe, Seeds, Watering Can, Hand) and click plots. (Until v2 a drag also painted the tool across plots; from v2 phase 01 a drag pans the camera and never runs a tool, §12.1.) Hoe tills or clears a dead crop, and can pull up an old regrowing crop (one that has already given a harvest) so a plot is never stuck with it for the rest of its seasons; Seeds plants the chosen seed; Can waters; Hand harvests. Shift-click applies to every plot of the field. Upgraded tools hit an area (BALANCE.md §4).
- **Plot states:** untilled → tilled → planted (stage 0–4) → ready → harvested (back to tilled, or back to stage 2 for regrowers). Plus `dead` after a season change.
- **Watering:** a watered plot grows at full speed; a dry one at half speed. One watering lasts 2 hours of simulated time; sprinkler-covered plots are always watered. This is gentle on purpose: the farm still progresses offline without sprinklers, but sprinklers double it.
- **Seasons:** seeds can only be planted in season. A crop still in the ground when its seasons end (at the weekly season change) withers into a clearable dead crop. The UI warns when a crop won't finish in time. Multi-season crops (garlic, wheat, tomato, corn, kale) carry over.
- **Harvest:** yield is rolled with the seeded RNG; items go to the inventory (or the bin with auto-sell). If the inventory is full, the crop waits in the plot.
- **Idle:** growth continues offline at the recorded water state.
- **Unlocks:** seeds unlock by farm level (BALANCE.md §9). Plots grow through expansions (§6.2). Greenhouse plots from the greenhouse upgrade.
- **Content:** 15 crops across 4 seasons, 5 regrowers, 5 multi-season. Table: BALANCE.md §2.

### 6.2 Economy and market (phase 03)
- **Gold** is the only currency. Integer, never negative.
- **Selling, two ways:** the **Market** panel sells instantly at 90% of the current price; the **Shipping Bin** pays 100% at the next hourly pickup, at that moment's prices. Auto-sell (phase 04) feeds the bin.
- **Dynamic prices:** each item has a demand multiplier (0.5–1.3). Selling lowers it a little per unit (cheap bulk crops have deep markets, pricey ones shallow), and it recovers toward 1.0 within about half an hour. Items left unsold for 3+ hours climb toward 1.3 ("the town misses your pumpkins"). Each morning at 06:00 local, 1–3 **Today's specials** get +20–50%. The Market shows a trend arrow and a 7-day sparkline. The system nudges toward variety without ever making one crop worthless.
- **Shop:** seeds (in-season, unlocked; locked ones show the unlock hint), recipe cards (phase 06), and later nothing else: upgrades live in the Upgrades panel.
- **Farm expansion:** 4 steps from 4 × 2 to 8 × 6 plots on a geometric price curve, bought in the Upgrades panel. Each one visibly changes the scene (weeds and a stump cleared, the fence moved, stepping stones, two old trees cleared, a scarecrow post). Fishing locations are bought the same way (river, ocean) from phase 05.
- **Inventory:** 12 slots of stacks up to 99 at the start. Backpack adds slots (phase 03); barn storage raises the stack size (phase 04).
- **Seams:** `sellPriceModifier`, `goldEarned` event.

### 6.3 Automation and upgrades (phase 04)
- **The idle core.** Purchases that do the clicking for you:
  - **Sprinklers** (placed on plots) keep their area permanently watered; **Sprinkler Tech** widens the area (plus → 3 × 3 → 5 × 5).
  - **Scarecrows** (placed on plots) boost growth nearby.
  - **Farmhand** visits every N seconds and harvests up to C ready plots. A small animated character that walks between plots; the animation follows the logic, never drives it.
  - **Seed Planter** replants after the farmhand (L1), fills empty tilled plots (L2), and tills/clears (L3). It never plants out of season.
  - **Auto-Seller** sends harvests to the Shipping Bin, with per-item toggles and (L2) a reserve kept for cooking.
  - **Tools:** watering can and hoe areas (1 → 3 → 9 → 25 tiles).
  - **Barn Storage** (stack size) and the **Greenhouse** (6 then 12 plots that ignore seasons).
- **Order each step:** growth → farmhand harvest → planter → auto-ship → shipping-bin pickup (when due). Calendar events (daily refresh, season change) are applied at their boundary before the step that crosses it.
- **Idle:** everything runs offline with exact batching; the "While you were away…" modal lists crops harvested, items shipped, gold earned and plots left dry.
- **Unlocks:** by farm level and prerequisites (BALANCE.md §4).
- **Seam:** `automationSpeedModifier`.

### 6.4 Fishing (phase 05)
- **Locations:** Pond (start), River (bought, FL3), Ocean via the Old Dock (bought, FL6). 16 fish across 4 rarities plus 3 junk items. Each fish has seasons and a time-of-day window on the player's local clock; windows are wide so evening-only players still meet most fish, and every location always has a common fish. **One legendary per season:** Petal Koi (pond, spring), Sun Marlin (ocean, summer), Ember Salmon (river, autumn), Moonfin (ocean, winter, 16:00–10:00).
- **Active fishing:** hold and release to cast (a strong cast slightly improves the odds), wait 3–10 real seconds for the "!" and bobber dip, then a cozy reel minigame: keep the marker inside a moving sweet zone by holding a button/Space/touch; a meter fills inside and drains slowly outside. Difficulty sets zone size and speed. Losing just lets the fish go. **Relaxed fishing** (Settings) widens and slows the zone.
- **Idle fishing:** Fish Traps placed at water zones (2 per location) roll a common/uncommon/junk catch every 3 minutes and hold 5 items. Traps ignore time of day, so night fish reach players who never play at night. Click to collect; the Trap Collector upgrade empties them at every bin pickup.
- **Rods:** Old → Bamboo → Fiberglass → Iridium widen the zone and add luck.
- **Fish Collection:** first-catch day, biggest size, silhouettes for the uncaught.
- **Seams:** `fishingLuckModifier`, `fishingSpeedModifier`.
- **v2:** the sea continues past the dock as scenery (§12.1). Fishing locations and trap spots do not change.

### 6.5 Cooking and buffs (phase 06)
- **Kitchen:** click the farmhouse. A recipe book shows known recipes, have/need counts, tier and buff. A cook queue (1 slot, +1 per kitchen upgrade to 4) cooks in simulated time, offline too; chimney steam shows while cooking.
- **Recipes:** 22 across 4 tiers (6/7/5/4). Every T3 and T4 can be cooked from one season's fresh ingredients, and each season has its own T4 (spring Garden Banquet, summer Royal Sturgeon, autumn Harvest Feast, winter Moonfin Sushi). Storing crops across seasons still helps, especially for winter. Discovery: starter recipes, recipe cards in the Shop, milestone rewards, and **experiment mode** (pick 2–4 ingredients; a match teaches the recipe, a miss costs nothing and gives a hint).
- **Winter:** dishes that finish cooking in winter are **hearty** (a snowflake badge; their buff lasts 50% longer whenever eaten), Cooking XP is +50%, and dishes sell for +25%. Winter week is cooking week: stock up in autumn, cook in winter.
- **Eat or sell:** every dish has an Eat button in the Inventory and can be sold at the market. Cooking is always worth more than selling the raw ingredients (T1 +25%, T4 +100%).
- See §7 for the buff design.
- **Seam:** `cookSpeedModifier`; `xpModifier` stub.

### 6.6 Progression and goals (phase 07)
- **Skills:** Farming, Fishing, Cooking, levels 1–10, XP from harvesting, catching and cooking (scaled by value, rarity and tier). Every level grants a small shown perk (BALANCE.md §8), e.g. Farming 4: 5% double harvest; Cooking 7: +1 buff slot.
- **Farm Level:** from skill levels plus milestones. It gates seeds, locations, recipes and upgrades (BALANCE.md §9). Phases 02–06 used a provisional level based on lifetime gold; since phase 07 it comes from a table of farm points (BALANCE.md §8).
- **Milestones:** a fixed chain of 15 with a warm line each; the player's main sense of direction and the in-game tutorial after phase 08's intro.
- **Goal board:** 3 rotating goals from 9 templates, always achievable at the current unlock level, sized for 5–15 minutes.
- **Community Board:** 6 bundles with permanent rewards (golden scarecrow, inventory slots, greenhouse unlock, extra traps, fishing luck, +1 buff slot).
- **Stats tab:** lifetime gold, crops, fish, dishes, days, play time.
- Progression **listens to events**; it is not wired into each system.
- **v2** adds 8 milestones (m16–m23) that give rewards but **no farm points** (the Farm Level table stays tuned to the 15 v1 milestones), 3 goal templates (charm, fruit, animal products), 2 bundles (Orchard Basket, Barnyard) and a **Town** tab of town projects on the Community Board (§12.2).

### 6.8 v2 systems (summary; details in §12)

| System | Player actions | Idle behaviour | Unlocks | Phase |
|---|---|---|---|---|
| **World and camera** (§12.1) | pan, zoom, Home; buy land parcels in Upgrades › Land | none (parcels only make space) | parcels by gold, Farm Level and the previous parcel | v2-01 |
| **Decorations and town projects** (§12.2) | buy pieces in Shop › Decor; place, move and pick up in Decorate mode; restyle the farmhouse; donate to town projects | none. Decorations are **cosmetic** and only feed charm; projects never pay out gold | sets by town projects, pieces by charm | v2-02 |
| **Orchard** (§12.3) | buy saplings in Shop › Trees; plant them on tree spots; pick fruit; move or remove a tree | trees age by **real days**; fruit appears once a day in season, up to a cap; the farmhand picks ripe trees | Hilltop Orchard parcel | v2-03 |
| **Animals** (§12.4) | build a coop, barn and silo; buy and name hens and cows; make feed; fill troughs; collect; pet | fed animals produce on a simulated-time cycle into a store; the silo refills troughs and the Collecting Basket empties stores at each bin pickup | Old Paddock parcel | v2-04 |

### 6.7 Audio and feel (phase 08)
- **Sound:** procedural Web Audio only (no files). Every action has a small sound: hoe thunk, seed plip, water splash, harvest pop, coin chime pitched by amount, cast whoosh, bite "!", reel clicks, catch jingle, sizzle, dish-ready bell, eat munch, buff shimmer, level-up fanfare, panel open/close, UI click.
- **Music:** four short seasonal chiptune loops plus a softer night variation, quiet by default, crossfaded.
- **Juice:** pooled particles (soil puffs, droplets, leaf bursts, coins flying to the HUD, splashes, steam, sparkles), tweens (gold count-up, panel bounce, harvest squash-and-stretch), a 2 px shake only on legendary catches. Reduced-motion respected everywhere.
- **Ambient life:** butterflies by day, fireflies at night, a sleeping pet by the farmhouse, drifting cloud shadows, seasonal touches (blossoms, falling leaves, snow on non-crop tiles).
- **First-time experience:** a skippable tutorial overlay (plots → seeds → water → harvest → sell → shop) that hands over to the milestones.

## 7. Food buffs

The owner's key idea: **each dish gives a different benefit, and its strength and duration scale with the recipe's difficulty and value.**

### Buff types

| Type | Name | Effect | Seam |
|---|---|---|---|
| `growth` | Green Thumb | crops grow faster | `growthModifier` |
| `sellPrice` | Silver Tongue | everything sells for more | `sellPriceModifier` |
| `fishingLuck` | Angler's Luck | rarer fish bite | `fishingLuckModifier` |
| `fishingSpeed` | Quick Bite | faster bites and trap rolls | `fishingSpeedModifier` |
| `cookSpeed` | Quick Hands | dishes cook faster | `cookSpeedModifier` |
| `automationSpeed` | Busy Bees | farmhand and planter work faster | `automationSpeedModifier` |
| `xp` | Scholar's Snack | more XP from everything | `xpModifier` |

(`fishingSpeed` / Quick Bite is a seventh type beyond the six in the phase-06 prompt; it gives fish dishes a second theme. Phase 06 should add it.)

### Recipe → buff mapping (themed)
Vegetable and grain dishes that feel "earthy" boost growth (Roasted Turnip, Vegetable Soup, Pumpkin Soup). Sweet, sellable treats and feasts boost prices (Blueberry Muffin, Glazed Yams, Cranberry Pie, Harvest Feast). Fish dishes boost fishing: salads and stews for luck (Seaweed Salad, Garlic Trout, Seafood Stew, Royal Sturgeon), quick grilled things for speed (Grilled Bluegill, Fish Tacos). Hearty energy food helps workers (Wheat Flatbread, Corn Chowder, Catfish Gumbo). Comfort food and a spring banquet help the cook (Baked Potato, Tomato Pasta, Garden Banquet). Brain food boosts XP (Berry Bowl, Scholar's Stew, Moonfin Sushi). Full table: BALANCE.md §7.

### Tier
Tier T1–T4 is **computed from the recipe's inputs**: `score = ingredient units + ingredient value / 50 + cook minutes / 60`, with thresholds 8 / 15 / 28. More ingredients, pricier ingredients and longer cooking all push a dish up a tier. A test keeps the data and the formula in agreement.

### Strength and duration
`magnitude = 10% × tier × typeScale` and `duration = 15 minutes × 3^(tier − 1)` of simulated time, +50% for hearty (winter-cooked) dishes. So a T1 Green Thumb is +10% for 15 minutes; a T3 one +30% for 2¼ hours; a T4 Silver Tongue +20% for 6¾ hours (about 10 if hearty), enough to cover most of a night away. (Phase 09 lengthened them from 6 minutes × 2^(tier − 1): most gold is earned while away, and a 48-minute buff made "which dish to eat before you leave" an empty choice.) Per-type scales keep strong effects fair: Silver Tongue is halved (T4 = +20% gold), Quick Hands and Scholar's Snack are ×1.5.

### Stacking
- **One buff per type.** Eating a dish of a type you already have keeps the **stronger** magnitude and the **longer** remaining time. It never weakens or shortens anything.
- **Slots:** 3 at the start, +1 at Cooking level 7, +1 from the Cozy Dinner bundle (max 5 of the 7 types). If all slots are full and you eat a new type, a confirmation offers to replace the buff with the least time left.
- Buffs tick in simulated time, keep running offline, and expire exactly (offline steps split at the expiry moment).
- Buffs are **nice, not needed**: kept up well they speed progression by about 10–25% (phase 09 measured +21% over the first week against selling the same dishes).

## 8. Optional future: the Fullness meter (phase 10)

Off by default and only built if the owner wants it after playing v1. A 0–100 Fullness value that drains slowly in simulated time; eating a dish adds Fullness by tier, and you can't eat past 100 ("Too full", with a tooltip saying when there's room). Fullness **never** slows, harms or hurries the player: at 0 you simply have no buffs to lose. It links to buffs in one of two ways (the phase 10 session picks one and makes the other a flag): **capacity** (more Fullness allows more buff slots) or **well-fed bonus** (above 60 Fullness, buffs are a bit stronger). With the toggle off, the game behaves exactly like v1.

## 9. Out of scope (v1, amended for v2)

- Multiplayer, trading or any online features
- NPCs with relationships, romance or dialogue trees (the town is buildings and projects, not people)
- Combat, mines, monsters or health
- A walkable player character (the farmhand is a visual-only helper)
- ~~Animals (chickens, cows)~~ **In scope from v2** (§12.4), chickens and cows only. Still out: other animal types, breeding, and animal quality, affection or mood systems beyond cosmetic petting.
- Artisan machines (kegs, preserve jars, a cheese press, mayonnaise machines): **still out in v2**. The kitchen makes cheese and jam as ordinary recipes.
- Weather events (rain, storms) and festivals (the Community Hall's festival lights are a decoration, not an event)
- Crafting beyond cooking. Making hay and corn feed in the Ranch panel is a one-click conversion, not a crafting system.
- Quality tiers for crops, fruit or animal products (silver/gold stars). A large egg is its own item, not a tier.
- Casinos, slots, lotteries, prize wheels, loot boxes or any other game of chance, and "alternatives" to them. The gold sinks are land, decorations and town projects.
- Income bonuses from decorations or charm
- Monetisation, ads, accounts or cloud saves
- A hunger meter that affects play (only the optional, gentle Fullness meter in phase 10, which is on hold)

Ideas like these go to `docs/IDEAS.md`.

## 10. Build phases

| Phase | Builds |
|---|---|
| 00 | these documents |
| 01 | scaffold, loop, clock, save/offline, renderer, UI shell, CI/deploy |
| 02 | farming |
| 03 | economy, market, shop, expansions, backpack |
| 04 | automation and tool upgrades |
| 05 | fishing |
| 06 | cooking and food buffs |
| 07 | skills, farm level, milestones, goals, bundles, stats |
| 08 | audio, juice, tutorial, settings, mobile, accessibility |
| 09 | simulator, balance, QA, performance |
| 10 | optional Fullness meter (on hold) |
| v2-00 | the v2 design update (§12, BALANCE.md §13, DATA_SCHEMAS.md §9, ART_STYLE.md §6) |
| v2-01 | the 36 × 22 world, the camera, land parcels, off-screen pips, the phone layout, e2e in CI (save 8) |
| v2-02 | decoration shop, Decorate mode, charm, town projects (save 9) |
| v2-03 | fruit trees, the calendar day index, fruit recipes, the Orchard Basket bundle (save 10) |
| v2-04 | coop, barn and silo; chickens and cows; feed; egg and milk recipes; the Barnyard bundle (save 11) |


## 11. Owner decisions

Decided after the first review of this document:
1. **Name:** keep "Hearthfield Idle" for now; it may change later. The save key is `hearthfield-idle/save`.
2. **Offline cap:** as designed (8 h full, then 16 h at 25%, nothing after 24 h).
3. **Withering:** crops still growing at a season change wither, as designed.
4. **Seventh buff type:** Quick Bite (`fishingSpeed`) is in.
5. **Buff slots:** start with **3** (max 5).
6. **Real-time calendar:** time of day follows the local clock (night 20:00–06:00) and seasons change weekly at local Saturday → Sunday midnight, counted from the save's creation so every save starts in spring (§4). Timers stay short and run on simulated time; watering lasts 2 h; the shipping bin is collected hourly.
7. **Winter is cooking season:** hearty dishes (+50% buff duration), +50% Cooking XP, dishes sell for +25% (§6.5, §7, BALANCE.md §7).
8. **One legendary fish per season**, plus traps that ignore time of day, so real-time fish windows don't lock anyone out (§6.4).

No open questions remain for phase 01.

### v2 owner decisions (confirmed after v2 phase 00)

v2 phase 00 proposed these twelve choices as open questions; the owner confirmed all twelve as recommended. The alternatives are kept for the record and are **not** to be built.

1. **World size: 36 × 22 tiles** (3.3× the v1 area), with the v1 farm unchanged in the top-left corner (§12.1). *Alternatives:* 40 × 24 (4×, more empty land to fill) or 32 × 20 (2.7×, tighter; the meadow becomes 2 rows).
2. **Which regions are parcels:** three parcels, bought in order: **Hilltop Orchard** (30,000g, Farm Level 5 and `farm_3`), **Old Paddock** (the animal yard, 150,000g, Farm Level 7), **Seaside Meadow** (decoration space, 500,000g). The **town square is public** (always open, no parcel) and the lanes and sea are scenery. *Alternative:* make the town square a fourth parcel, or drop the meadow and let decorations use only the home region and spare parcel tiles.
3. **Fruit clock: calendar days.** Fruit appears once per real day, at the 06:00 refresh, in season, up to a cap of 4 days' fruit (§12.3). *Alternative:* fruit on a simulated-time timer (consistent with the offline cap, but a tree that matures in real days and then fruits in capped minutes is two rules for one object).
4. **Starter decoration set: Cottage**, available as soon as v2 phase 02 ships (its cheaper pieces at charm 0). Seaside comes from the Old Bridge project and Harvest Fair from the Bakery. *Alternative:* start with Seaside or Harvest Fair.
5. **Tree spots, not free placement:** trees stand on 10 fixed 2 × 2 spots in the orchard (8, plus 2 from the Orchard Basket bundle). *Alternative:* any free 2 × 2 on owned land (more freedom, harder to read, and trees would compete with decorations).
6. **Saplings are not refunded** when a tree is removed (moving a tree is free and keeps its age). *Alternative:* refund 50%.
7. **Animal production runs on simulated time** (a hen lays every 30 minutes, a cow gives milk every 40), so animals obey the offline cap like every other idle timer (§12.4). *Alternative:* one product per real day, like fruit (much slower, and animals would become a daily check-in).
8. **Petting is purely cosmetic** (hearts and a sound, no bonus at all). *Alternative:* a tiny bonus, such as the next product being a large egg, once per animal per day and never a penalty.
9. **Feed can also be bought** at the Ranch (hay and corn feed at 40g a portion), so a player with no wheat or corn in winter or spring is never stuck; home-made feed is about three times cheaper. *Alternative:* home-made only (stricter tie to farming, but a spring player with no stock would have hungry hens).
10. **The farmhand picks ripe trees but does no animal chores**; the silo (troughs) and the Collecting Basket (stores) automate animals. *Alternative:* the farmhand also collects eggs and milk, and the Collecting Basket is dropped.
11. **Town projects cost about 8.5M gold in all** (six projects, nineteen stages; the whole v2 catalogue is about 13.2M), so a one-hour-a-day player still has gold to spend on day 30 and a keen player runs out around day 25 (BALANCE.md §13.4). *Alternative:* scale every project by 0.5 or 1.5.
12. **v2 milestones give no farm points.** The Farm Level stays tuned to the 15 v1 milestones. *Alternative:* count them and raise the top of `FARM_LEVEL_POINTS`.

No open questions remain for v2 phase 01.

---

## 12. v2: a bigger world, decorations, an orchard and animals

v2 was chosen by the owner after playing v1. It adds four features, built in this order, one PR each:

| Phase | Feature | Save |
|---|---|---|
| v2-01 | **A.** a bigger world with a pannable camera, and land parcels | 8 |
| v2-02 | **B.** a decoration shop, charm and town projects: the late-game gold sink | 9 |
| v2-03 | **C.** fruit trees and the orchard | 10 |
| v2-04 | **D.** chickens and cows | 11 |

**Why these, in this order.** The phase 09 simulator found that a keen player has earned about 3 million gold by day 7, when everything in v1 costs about 523k together: gold stops meaning anything for the last three weeks of a month. v2 fixes that with things that are fun to spend on (land, decorations, town projects) and gives the new land something to grow (trees) and someone to live on it (animals). The world comes first because every later feature needs space and the coordinate system under it.

**Pillars still hold.**
1. *Cozy, never punishing.* Trees never wither. An unfed animal just doesn't produce: it never gets sick, leaves or dies, and nothing is lost or reduced. A full tree or store stops adding and loses nothing. Decorations can always be picked up again.
2. *Always something growing.* Trees add a days-long timer and animals a half-hour one; town projects are the long thing to save for.
3. *Your absence is part of play.* Trees keep ageing and fruiting in real days while you're away, without the offline cap (fruit stops at the tree's own four-day cap). Animals run on the capped offline time like every other idle timer, and troughs hold a full night's feed.
4. *Small choices with character.* Which trees for which seasons, which decorations where, which town project next.
5. *Everything visible* becomes *everything visible in one world*: every purchase still changes the scene, and the camera starts on home.

**Fixed owner decisions:** trees mature in real calendar days; decorations are cosmetic and give no income; animals are gentle and are fed from farm produce; no games of chance and no alternatives to them; the phase 10 Fullness meter stays on hold (v2 keeps the buff seams as they are and adds no buff types).

### 12.1 The world and the camera (v2 phase 01)

#### Size and map

The world is **36 × 22 tiles** (576 × 352 logical pixels), 3.3 times the v1 area. The v1 scene (20 × 12) is the **home region** at the world's top-left corner, **at the same tile coordinates** (world tile (c, r) is v1 tile (c, r)), so nothing a v1 save stores has to move (DATA_SCHEMAS.md §9.3). The world grows only to the right and down; the home region never shifts.

```
    000000000011111111112222222222333333
    012345678901234567890123456789012345
  0 ....................=ooooooooooooooo
  1 .HHHH##########GGGG.=oTToTToTToTTo22
  2 .HHHH#PPPPPPPP#GGGG.=oTToTToTToTTo22
  3 .HHHH#PPPPPPPP#GGGG.=ooooooooooooooo
  4 ..=..#PPPPPPPP#GGGG.=oTToTToTToTTo22
  5 ..====PPPPPPPP=.....=oTToTToTToTTo22
  6 .....#PPPPPPPP=MMM..=ooooooooooooooo
  7 .~~~~#PPPPPPPP=MMMb.================
  8 .~~~~#########=MMM..=yyyyyyyyyyyyyyy
  9 .~~~~.........=======yyyyyyyyyyyyyyy
 10 .~~~~.rrrrrrrrrDDDDD=yyyyyyyyyyyyyyy
 11 ......rrrrrrrrrDDDDD=yyyyyyyyyyyyyyy
 12 ===============BBBBB=yyyyyyyyyyyyyyy
 13 ,,,,,,,,,,,,,,,~~~~~=yyyyyyyyyyyyyyy
 14 ,KKK,,,,,,AAAA,~~~~~=yyyyyyyyyyyyyyy
 15 ,KKK,,FFF,AAAA,~~~~~================
 16 ,KKKn,FFF,AAAA,~~~~~=mmmmmmmmmmmmmmm
 17 ,,,,,,FFF,,,,,,~~~~~.mmmmmmmmmmmmmmm
 18 ,,SSS,,,,,,,LL,~~~~~.mmmmmmmmmmmmmmm
 19 ,,SSS,,,,,,,LL,~~~~~.sssssssssssssss
 20 ,,,,,,,,,,,,LL,~~~~~~~~~~~~~~~~~~~~~
 21 ,,,,,,,,,,,,,,,~~~~~~~~~~~~~~~~~~~~~
```

| Mark | Region | World tiles (col, row, cols × rows) | Notes |
|---|---|---|---|
| (cols 0–19, rows 0–11) | **Home** (the whole v1 scene) | (0, 0) 20 × 12 | Drawn exactly as v1 (schematic above: `H` farmhouse, `P` the full 8 × 6 field, `#` its fence, `G` greenhouse lot, `M` market, `b` bin, `~` pond, `r` river, `D` dock, `=` paths). Open from the start. |
| `o`, `T`, `2` | **Hilltop Orchard** parcel | (21, 0) 15 × 7 | 10 tree spots of 2 × 2 (`TT`): 8 open when the parcel is bought, the 2 marked `2` open with the Orchard Basket bundle. The rest is grass where decorations may go. |
| `y` | **Old Paddock** parcel (animal yard) | (21, 8) 15 × 7 | Coop, barn and silo are placed here; hens and cows wander inside it. |
| `m`, `s` | **Seaside Meadow** parcel | (21, 16) 15 × 4 | Open meadow and a strip of beach: the main decoration space. |
| `,` `K` `F` `A` `S` `L` `n` | **Town square** | (0, 13) 15 × 9 | Public: always visible and open, never bought. `n` is the Community Board (a sign that opens Goals › Community Board). The five building sites are town projects in ruins: `K` bakery, `F` fountain, `A` community hall, `S` bandstand, `L` lighthouse on the point. |
| `B` | **Old Bridge** | (15, 12) 5 × 1 | A broken bridge over the sea inlet; the first town project. |
| `=` (col 20, rows 7, 12, 15) | **Lanes** | | Scenery paths that join the regions. Nothing is placed on them. |
| `~` (cols 15–35, rows 10–21) | **The sea** | | The v1 dock water continues south as an inlet and along the bottom as open sea. Scenery only: the ocean fishing zone and its trap spots stay at the dock (15–19, 10–11). |

Two small v1 changes come with the map, both deliberate: the sea under the old dock is now always drawn (the dock planks still appear with `ocean`, and before that a "For sale" sign stands on the shore, which also closes the IDEAS.md "decor on locked lots" entry); and the forest edge of the v1 scene now runs along the world's edges instead of the home region's.

#### Land parcels

A **parcel** is a region bought with gold in **Upgrades › Land** (a new section under the expansions) or by clicking its "For sale" sign. Locked parcels look overgrown (tall grass, weeds, a stump or two) with a sign that shows the price and condition on hover. Buying one clears it with a puff of leaves and a toast, like `farm_1`. Parcels are bought **in order**, and each one opens the next feature:

| Order | Parcel | Price | Needs | Opens |
|---|---|---|---|---|
| 1 | Hilltop Orchard (`orchard`) | 30,000g | Farm Level 5 and `farm_3` | tree spots (v2-03), decoration space |
| 2 | Old Paddock (`yard`) | 150,000g | `orchard` and Farm Level 7 | coop, barn, silo (v2-04), decoration space |
| 3 | Seaside Meadow (`meadow`) | 500,000g | `yard` | the largest decoration space |

In v2 phase 01 the parcels only make space. Phases 02–04 fill them.

#### Camera and controls

The camera holds a **world position** and a **zoom**. Zoom levels are **integer pixel scales only** (1×, 2×, 3×, …), so pixels stay crisp, as in ART_STYLE.md §3.

| Input | Does |
|---|---|
| Mouse drag, one-finger drag | pans. A press that moves more than **6 CSS px** becomes a pan and never runs a farm tool; a shorter press is a click. This replaces the phase 08 pan switch. |
| Wheel or trackpad | zooms one level around the cursor (trackpad deltas are accumulated so one gesture is one step) |
| Pinch | zooms around the pinch centre, one level at a time |
| Double-click, double-tap | zooms in one level around that point |
| Arrow keys, WASD | pan by one tile per press, smoothly while held (ignored while typing or while a panel has focus) |
| `+` / `-` | zoom in or out around the view centre |
| **Home** button (scene controls), `H` key | glides back to the default view |

- **Default view:** centred on the home region at the largest integer zoom at which the whole home region (320 × 192) fits the scene area, which is exactly the v1 scale. If the world at that zoom is smaller than the viewport it is centred and the rest is `grass_dark`.
- **Limits:** zoom from **1×** to **the default zoom + 2** (at least 3×). The view is clamped so it never shows past the world's edges; on a wide screen at 1× the whole world fits and is centred.
- **Remembered per device:** the camera's position and zoom are stored in **prefs** (`src/core/prefs.ts`, phase 08's per-device settings), not in the save, so a shared or exported save never carries a view. A missing or out-of-range value falls back to the default view.
- The camera moves on the render clock with a short ease (off under reduced motion). It never touches game state.

#### What happens off-screen

- **Toasts** already announce events wherever they happen. From v2, events in a region you can't see get a small "→ Orchard" style suffix, and clicking the toast pans there.
- **Edge pips:** small arrows on the edge of the scene point at off-screen things that want you: ready crops, full traps, a finished dish, (v2-03) trees with ripe fruit, (v2-04) a full animal store or an empty trough. At most four at once, one per kind, nearest first. Clicking a pip pans the camera there. They are drawn over the scene, never tinted, and do not pulse under reduced motion.
- The farmhand, particles and ambient life keep working across the whole world; only what is in view is drawn or simulated.

#### Phones

On narrow screens the scene fills the space between the HUD and the toolbar. The zoom is the largest integer at which the home region's **height** (12 tiles) fits that space, and at least **2×** (32 CSS px tiles, near the 44 px touch target at 3× on taller phones). One finger pans, two fingers pinch. This replaces the phase 08 zoom button and pan switch and closes the IDEAS.md entry "a bigger scene on narrow phones".

### 12.2 Decorations, charm and town projects (v2 phase 02)

#### Decorations

Decorations are **cosmetic pieces** you buy with gold and place on your own land. They give **no income, growth, price or speed bonus of any kind**; the most they do is add **charm** (below). They are the everyday gold sink: cheap paths and fences in bulk, mid-priced lamps and benches, and a few expensive showpieces.

**Where to buy:** a **Decor** tab in the Shop panel lists the sets with a preview of each piece, its price, its charm, how many you own and how many are placed. Locked pieces show their hint ("Reach charm 25", "Mend the Old Bridge"). You can buy several of a piece; bought pieces go to your **decoration stock**, not the bag.

**Three sets for the first release** (32 pieces; prices and charm in BALANCE.md §13.2):

| Set | How it unlocks | Pieces |
|---|---|---|
| **Cottage** (`cottage`, 12) | open from the start of v2-02 | `cobble_path`, `picket_fence`, `flower_bed`, `garden_lamp` (glows), `wooden_bench`, `birdbath`, `rose_arch`; farmhouse **paint** `paint_sage` and `paint_sky`; farmhouse **roof** `roof_thatch` and `roof_slate`; the **farmhouse loft** `farmhouse_loft` (the extension: a second storey with a dormer window) |
| **Seaside** (`seaside`, 10) | completing the **Old Bridge** project | `plank_path` (a boardwalk), `rope_fence`, `sandcastle` (seasonal), `lobster_pots`, `deck_chair`, `beach_umbrella`, `harbour_lamp` (glows), `rowboat`, `driftwood_arch`, `ship_figurehead` |
| **Harvest Fair** (`harvest_fair`, 10) | completing the **Bakery** project | `brick_path`, `rail_fence`, `straw_bale`, `pumpkin_stack` (seasonal), `sunflower_patch`, `lantern_string` (glows), `apple_cart`, `stone_well`, `fair_stall`, `windmill` |

Inside a set, pieces open by **charm** (0 → 175). Each set has one path and one fence (auto-tiled: neighbouring pieces join up), at least one lamp that **glows at night**, something to sit on, and a large showpiece. Seasonal pieces change look by season (the sandcastle becomes a snow castle in winter, the pumpkin stack wears snow). Every placed piece gets the phase 08 snow dusting in winter.

**The farmhouse** is restyled, not placed: paint and roof pieces and the loft **swap the farmhouse sprite** (walls, roof and loft are layers). You own them once; applying one is free and can be switched back any time in the Decor tab. The default red walls and tiled roof are always available.

**Placement** reuses the phase 04 placement mode:
- A **Decorate** toggle in the scene controls switches clicks from farm tools to decorating. In Decorate mode: pick a piece from the stock tray, see a **grid-snapped footprint preview** (green valid, red invalid with the reason as a tooltip), click to place, click a placed piece to **move** it (it follows the pointer and keeps its place until dropped) or **pick it up** (back to stock). Pieces whose sprite allows it can be **flipped** (the `F` key or a button); nothing rotates in v2.
- Pieces go only on **owned land** (home region, bought parcels) and only on **free grass tiles**. Never on plots or the field's fence ring, water, buildings and their zones (farmhouse, market, bin, greenhouse lot), trap spots, tree spots, coop/barn/silo footprints, lanes and v1 paths, the town square, or locked parcels.
- A path or fence recalculates its joined sprite when a neighbour is placed, moved or picked up.
- There is a cap on placed pieces (100 at first, raised by town projects) so drawing and hit-testing stay cheap. Stock is unlimited.

**Lamps glow at night:** from dusk to dawn, lamp pieces switch to a lit frame and add a soft warm halo drawn **after** the night tint (like the fireflies), so they light the dark farm. Under reduced motion the halo is steady.

#### Charm

**Charm** is a single number that says how lovely the farm is. It is **derived, never stored**: computed from what is placed, the farmhouse style and completed town-project stages.

- Each piece has a charm value, and only the first few copies of a piece count (20 path or fence tiles, 1–3 of anything else), so variety beats spam.
- The applied farmhouse paint, roof and loft count once each.
- Each completed town-project stage adds 10.
- Pieces in stock (not placed) count nothing.

Charm is shown on the Goals panel with the next threshold. It **unlocks only** more decoration pieces, two milestones (charm 25 and charm 100) and the "Raise charm" goal template. It must never feed a price, a growth rate, a timer or any `Modifiers` field, and a test checks that.

#### Town projects

The **Town** tab of the Community Board (Goals panel; also opened by clicking a project site in the town square) holds six big projects. Each has **3 or 4 stages**; a stage asks for gold and sometimes items, which you can donate **a bit at a time** (buttons for 10%, 25%, "all I can" of the gold, and the items like a bundle slot). The purchase guard applies. Finishing a stage visibly changes the town, plays the bundle flourish and adds 10 charm. Rewards are **quality of life or cosmetic only**; no project gives an income bonus, a multiplier or gold.

| Project | Stages | Opens | What changes in the world | Reward when complete |
|---|---|---|---|---|
| **Mend the Old Bridge** (`old_bridge`) | 3 | Farm Level 7 | posts → planks → railings and lanterns across the inlet | the **Seaside** set; +40 decoration slots |
| **Restore the Fountain** (`fountain`) | 3 | Farm Level 7 | dry basin → mended basin → water plays (a koi for the pool is the last donation) | +40 decoration slots |
| **Rebuild the Bakery** (`bakery`) | 3 | `old_bridge` done | rubble → frame → a bakery with a smoking chimney each morning | the **Harvest Fair** set |
| **Build the Bandstand** (`bandstand`) | 3 | `fountain` done | a platform → a roof → bunting; on Saturday evenings a little band plays | a **Town Square** music loop (added to the seasonal rotation, playable from Settings); +40 decoration slots |
| **Relight the Lighthouse** (`lighthouse`) | 3 | `bakery` done | a dark tower → a painted tower → a turning beam across the sea at night | +40 decoration slots |
| **Raise the Community Hall** (`community_hall`) | 4 | the other five done | foundations → walls → roof → festival lights strung across the square | a **4th goal slot** on the goal board; the festival lights |

Costs are in BALANCE.md §13.3: about 8.5M gold in all, with items (driftwood, wheat, eggs, apples, milk, pumpkins, a koi…) that pull the other systems in.

**Idle behaviour:** none. Decorations and projects have no timers, and the simulator spends on them only while a player is present.

#### As built in v2 phase 02

- **Decorate** is a button in the scene controls (a palette); the stock tray appears above the toolbar. Click a chip to choose a piece, click a free tile to place it (a refused tile says why in the tooltip), click a placed piece to pick it up into your hand, click a free tile to drop it, `F` flips, `Delete` (or the button) returns it to the stock, `Esc` drops what you hold, then leaves the mode.
- **Charm** is on the Goals tab (with the next threshold and what it opens) and in the Stats tab. The charm milestones and the "Raise your charm" goal are in BALANCE.md §13.9.
- **Town projects** are on the Goals panel's **Town** tab; clicking a project's site in the square opens it. Gold is given in 10%, 25% or "all I can" bites and items like bundle slots. Two of the table's items per stage that do not exist yet (eggs, milk, apples, persimmons, large eggs) join in v2 phases 03 and 04.
- The **Town Square tune** (the bandstand's reward) is in the rotation about one hour in three, and can be switched off or played on demand in Settings.

### 12.3 The orchard (v2 phase 03)

Fruit trees are long-term investments: planted once, they grow over **real days**, never wither and bear fruit in their seasons forever.

**Trees:** 7 kinds covering all four seasons, two of them bearing in winter (BALANCE.md §13.5): `cherry_tree` (spring), `apricot_tree` (spring, summer), `peach_tree` (summer), `apple_tree` (summer, autumn), `pear_tree` (autumn), `persimmon_tree` (autumn, winter), `lemon_tree` (winter, spring). Each gives the fruit of the same name (`cherry`, `apricot`, `peach`, `apple`, `pear`, `persimmon`, `lemon`), and its sapling is the bag item `sapling_<fruit>`.

**Planting.** Buy a sapling in the Shop's **Trees** tab (saplings are bag items, like seeds; the tab shows each tree's seasons, days to mature and "would first bear on: …" for a sapling planted today). Planting uses placement mode: pick the sapling, and the orchard's free **tree spots** light up (2 × 2 footprint preview); click one. There are 10 spots (8 with the parcel, 2 more from the Orchard Basket bundle); trees grow nowhere else.

**Growth, in real days.** A tree's **age** is `calendar.dayIndex − plantedDay` (whole 06:00 → 06:00 days, monotonic, the offline cap does not apply). Its stage is derived from age: **sapling** (age below half its days to mature), **young**, then **mature**. A mature tree looks seasonal: blossom in spring, full leaves in summer, gold leaves in autumn, bare branches in winter (snow-dusted and still leafy for the two winter bearers). Growth is never affected by buffs, watering or any modifier.

**Fruit: calendar days (decided).** At each **06:00 daily refresh**, every mature tree whose seasons include that day's season gains its **fruit per day**, up to a **cap of four days' worth**. A full tree simply stops adding; nothing is lost. Days missed while away are counted exactly (each missed day is checked for maturity and season), so an absence gives the same fruit as daily visits would have, up to the cap. *Why calendar days and not simulated time:* one object, one clock. Maturity is on the calendar by owner decision. If fruit then ran on a simulated-time timer, a mature tree would just be a slow regrowing crop: it would need a timer of minutes to feel alive while you play, and it would pay the same for a week away as for one night (the offline cap). On the calendar, trees are the one thing that rewards coming back after days, and the four-day cap keeps a long absence from paying more than a few days' worth, the same role the offline cap plays for timers. It also keeps the two clocks' rule simple for players: *trees count days, everything else counts minutes*. Tree income is small next to the farm's (BALANCE.md §13.5), so escaping the offline cap does not unbalance anything.

**Harvesting.**
- **Click** a tree (any tool, or in normal mode) to pick all its fruit into the bag (or the bin if the Auto-Seller ships that fruit). A full bag leaves the rest on the tree.
- **The farmhand** adds the orchard to its route: on each visit it picks ripe trees as well as plots, each tree using one of its per-visit capacity (it walks there; the animation follows the logic).
- **The Auto-Seller** gets per-fruit toggles; fruit defaults to **on**, like crops, and Level 2's reserve keeps 10 of each for cooking.
- Picked fruit gives Farming XP (BALANCE.md §13.5), a quarter when the farmhand picks it.

**Moving or removing a tree** (the Trees tab's "Your trees" list has Pick, Move and Remove). **Moving** enters the same spot-picking mode as planting (a banner says "it keeps its age and fruit") and is free; leaving the mode cancels it. **Removing** asks first: the tree and its growth are gone and the sapling is not refunded.

**While you were away** lists trees that became mature and fruit that grew ("Your peach tree is ready to bear", "+24 apples on the trees"). Edge pips point at trees with ripe fruit; the tree tooltip shows stage, days until mature, the seasons it bears in, and fruit hanging / cap.

**Content hooks:** fruit items are sellable (they join demand, specials and the market sparkline), and cooking uses them (§12.5). Milestone "Harvest your first fruit" (`m20_first_fruit`), the **Orchard Basket** bundle, the "Pick fruit" goal template, and fruit items in town-project stages (apples for the Bakery, persimmons for the Hall).

**Unlocks:** the Hilltop Orchard parcel opens the Trees tab. Every tree is available once the parcel is owned; saplings are the gate (their prices, BALANCE.md §13.5).

### 12.4 Chickens and cows (v2 phase 04)

Animals live in the **Old Paddock**. They are fed from what you grow and give eggs and milk. They are **gentle**: an unfed animal simply doesn't produce. It never gets sick, never leaves, never dies, never loses anything, and has no mood or penalty meter.

**Buildings** (bought and upgraded in the new **Ranch** panel (`ranch`), then placed in the yard with placement mode; each can be moved later):
- **Coop** (3 × 2 tiles): houses hens. Levels 1–3 raise capacity (4 → 8 → 12 hens), the trough and the egg store. The building looks bigger at each level.
- **Barn** (4 × 3 tiles): houses cows. Levels 1–3: 2 → 4 → 6 cows, trough and milk store. Needs a Level 1 coop.
- **Silo** (2 × 2 tiles, a tall sprite): the **auto-feeder**. Level 1: at every shipping-bin pickup it tops up every trough from the feed in your bag. Level 2: it also turns wheat and corn from your bag into feed as needed, keeping 10 of each back for cooking.
- One of each building. Each has a **trough** (portions of feed) and a **store** (products waiting to be collected).

**Animals** are bought in the Ranch panel for a building with room: **hens** (`chicken`: eat `corn_feed`, lay an `egg`, sometimes a `large_egg`) and **cows** (`cow`: eat `hay`, give `milk`). Buildings are `coop`, `barn` and `silo`; the collector upgrade is `ranch_collector`. Each gets a name from a gentle list, which the player can change (names are state, not randomness). Petting is cosmetic (below).

**Feed** connects animals to farming:
- **Hay** is made from **wheat** (1 wheat → 2 hay) and **corn feed** from **corn** (1 corn → 3 corn feed), with one click in the Ranch panel ("Make hay ×1 / ×10 / all"). Both are bag items and cannot be sold.
- The Ranch also **sells** both at a fair price, so a player with no wheat or corn (spring and winter have neither in the field) is never stuck; making your own is about three times cheaper.
- **Fill trough** moves feed from the bag into a building's trough, up to its size.

**Production, on simulated time (decided).** Each building runs one **cycle** timer (hens every 30 minutes, cows every 40, simulated time). At the end of each cycle, each animal in turn that has room in the store **eats one portion** from the trough and **produces one product** into the store. No portion, or no room: that animal skips the cycle and nothing else happens. *Why simulated time:* animals are a timer like crops, traps and cooking, so they follow the same offline cap and batching, and a full trough covers a normal night; a real-day clock would make them either trivial or a daily chore. Offline, cycles are processed one by one in order (like trap rolls), so one big step gives exactly what many small ones do. No quality tiers: a large egg is a separate item rolled with the seeded RNG.

**Collecting.**
- **Click** a building to open its Ranch page and collect the store into the bag (or the bin for products the Auto-Seller ships).
- The **Collecting Basket** upgrade (Ranch panel) empties every store at each shipping-bin pickup, like the Trap Collector.
- The **Auto-Seller** has toggles for egg, large egg and milk, **off by default** so the kitchen gets them.
- The **farmhand does no animal chores**; its route covers plots and trees. Animals are automated by the silo and the Collecting Basket.

**Petting** a hen or cow (click it) shows hearts and plays a cluck or a moo, like the cat. It gives **nothing** and skipping it costs nothing; there is no daily petting count.

**Life in the yard (render only).** Hens and cows wander inside the yard near their building, peck and graze, and eat at the trough when a cycle fires. All of this uses the **render-side cosmetic RNG** and never touches game state or `rngState`. At night they sleep inside or beside their building. Sounds (cluck, moo, collect) go through `src/audio/events.ts` and stay silent during offline replay.

**While you were away** lists eggs and milk collected and, gently, buildings whose trough ran dry ("The hens would love some feed"). An edge pip points at a full store or an empty trough.

**Content hooks:** egg, large egg and milk are sellable items and ingredients (§12.5). Milestones "First egg" (`m21_first_egg`) and "First milk" (`m22_first_milk`), the **Barnyard** bundle, the "Collect produce" goal template, eggs and milk in town-project stages.

**Unlocks:** the Old Paddock parcel opens the Ranch panel and the coop; the barn needs the coop; the silo and the Collecting Basket need the coop.

### 12.5 Recipes, milestones, goals and bundles (phases 02–04)

- **10 new recipes** (BALANCE.md §13.8): 2 × T1, 4 × T2, 4 × T3, using fruit, eggs and milk with the v1 crops. Tiers come from the existing formula; buffs are the existing 7 types; there is no new T4, so each season keeps its one T4 feast.
  - v2-03 (fruit): `baked_apple`, `cherry_jam`, `pear_crumble`, `peach_cobbler`.
  - v2-04 (eggs and milk): `fried_egg`, `soft_cheese`, `garden_omelette`, `apricot_custard`, `lemon_meringue_pie`, `persimmon_pudding`.
  - Gold buffs by season: **Cherry Jam** (spring, Silver Tongue), **Peach Cobbler** (summer, Silver Tongue), and **Persimmon Pudding**, the **winter gold-buff dish** (Silver Tongue, cooked from winter-fresh persimmon, eggs and milk, and hearty when cooked in winter). Cheese and jam are recipes: there are no artisan machines.
- **8 milestones**, no farm points: `m16_first_parcel`, `m17_first_decor`, `m18_charm_25`, `m19_first_project`, `m23_charm_100` (v2-02), `m20_first_fruit` (v2-03), `m21_first_egg`, `m22_first_milk` (v2-04). Rewards are gold, decorations or recipes.
- **3 goal templates:** `raise_charm` "Raise your charm by N" (v2-02), `pick_fruit` "Pick N fruit" (v2-03), `collect_produce` "Collect N eggs or milk" (v2-04).
- **2 bundles:** `orchard_basket` (a spread of fruit; opens the last 2 tree spots; v2-03) and `barnyard` (eggs, a large egg, milk, hay; troughs hold 50% more; v2-04).
- **Town projects** (v2-02): `old_bridge`, `fountain`, `bakery`, `bandstand`, `lighthouse`, `community_hall` (§12.2).
