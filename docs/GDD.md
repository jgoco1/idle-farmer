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

**Why two clocks.** A real calendar makes the farm feel like it lives alongside the player: it's dark on the farm when it's dark outside, specials change each morning, and each week has a season with its own crops and fish. That gives a gentle reason to look in daily and weekly without ever demanding it. But crops can't take real days to grow in an idle game's first session, so timers stay short: a turnip takes 2 minutes, a pumpkin 20, a T4 dish 4 minutes to cook, and buffs last 6–48 minutes. That keeps the "nobody waits more than ~2 minutes early on" target.

**What follows from it:**
- **Seasons:** every save starts in **spring**, whatever the real date. The first counted Saturday → Sunday midnight at least 3 days after the save was made changes spring to summer; after that, seasons change every week in the order spring, summer, autumn, winter. At a season change, crops that can't grow in the new season wither (greenhouse excepted). During the last two days of a season the HUD shows "Season changes in 2d 4h", and the shop warns about seeds that won't finish in time.
- **Watering:** one watering lasts 2 hours of simulated time. Dry crops grow at half speed. Sprinkler-covered plots are always watered, which is what makes sprinklers worth buying for time spent away.
- **Daily refresh (06:00 local):** market specials re-roll, the market sparkline records a point, and per-day goals and "gold today" reset. If several days pass while away, the refresh happens once.
- **Shipping bin:** collected every 60 minutes of simulated time, paid at the prices of that moment.
- **Day/night** is visual (a tint over the scene, fireflies at night from phase 08) and decides which fish bite. Crops grow at night too.
- **Winter is cooking season** (§7): dishes cooked in winter are *hearty* (their buffs last 50% longer), Cooking XP is +50%, and dishes sell for +25%.
- **Storage:** the simulated clock is one integer, `clock.simMs`. The calendar is computed from the real time and the save's creation date, and the week index is never allowed to go backwards if the system clock is set back. See BALANCE.md §1.

**Offline progress.** On load (and when a hidden tab returns), the game measures the real time since the last save. The first **8 hours count at full rate**; the next **16 hours count at 25%**; anything beyond **24 hours adds nothing** (the farm "rests"). So the most a single absence can be worth is 12 hours of simulated time. While away, the calendar still moves in real time (so a season can change and crops can wither), but timers only advance by the capped amount. The simulation walks the real timeline in large, exact steps, split at every calendar event, buff expiry and cook completion, and a **"While you were away…"** summary lists what happened. Exact formula: BALANCE.md §1.

## 5. Screen layout

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
| Shipping bin | (18,7) | opens the bin (drop items to sell at the next hourly pickup) |
| Greenhouse | (15,1)–(18,4) | locked lot → hint; built → greenhouse plots |
| River | row 10–11, cols 6–14 | locked → hint + price; unlocked → **Fishing** (river) |
| Dock | (15,10)–(19,11) | locked → hint + price; unlocked → **Fishing** (ocean) |

**HUD:** gold (animated count-up from phase 03), season, weekday and local time with a sun/moon icon, active buff icons with a remaining-time ring (phase 06), a notification bell for recent toasts, settings. **Toolbar:** panel buttons and the farming tool selector (phase 02).

## 6. Systems

Each section lists: player actions · idle behaviour · unlocks · the phase that builds it.

### 6.1 Farming (phase 02; automation hooks in 04)
- **Actions:** select a tool (Auto, Hoe, Seeds, Watering Can, Hand) and click or drag across plots. Hoe tills or clears a dead crop; Seeds plants the chosen seed; Can waters; Hand harvests. Shift-click or drag applies to many plots. Upgraded tools hit an area (BALANCE.md §4).
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
- **Farm expansion:** 4 steps from 4 × 2 to 8 × 6 plots on a geometric price curve. Each one visibly changes the scene. Fishing locations are bought the same way (river, ocean).
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

### 6.5 Cooking and buffs (phase 06)
- **Kitchen:** click the farmhouse. A recipe book shows known recipes, have/need counts, tier and buff. A cook queue (1 slot, +1 per kitchen upgrade to 4) cooks in simulated time, offline too; chimney steam shows while cooking.
- **Recipes:** 22 across 4 tiers (6/7/5/4). Every T3 and T4 can be cooked from one season's fresh ingredients, and each season has its own T4 (spring Garden Banquet, summer Royal Sturgeon, autumn Harvest Feast, winter Moonfin Sushi). Storing crops across seasons still helps, especially for winter. Discovery: starter recipes, recipe cards in the Shop, milestone rewards, and **experiment mode** (pick 2–4 ingredients; a match teaches the recipe, a miss costs nothing and gives a hint).
- **Winter:** dishes that finish cooking in winter are **hearty** (a snowflake badge; their buff lasts 50% longer whenever eaten), Cooking XP is +50%, and dishes sell for +25%. Winter week is cooking week: stock up in autumn, cook in winter.
- **Eat or sell:** every dish has an Eat button in the Inventory and can be sold at the market. Cooking is always worth more than selling the raw ingredients (T1 +25%, T4 +100%).
- See §7 for the buff design.
- **Seam:** `cookSpeedModifier`; `xpModifier` stub.

### 6.6 Progression and goals (phase 07)
- **Skills:** Farming, Fishing, Cooking, levels 1–10, XP from harvesting, catching and cooking (scaled by value, rarity and tier). Every level grants a small shown perk (BALANCE.md §8), e.g. Farming 4: 5% double harvest; Cooking 7: +1 buff slot.
- **Farm Level:** from skill levels plus milestones. It gates seeds, locations, recipes and upgrades (BALANCE.md §9). Before phase 07, a provisional level based on lifetime gold stands in.
- **Milestones:** a fixed chain of 15 with a warm line each; the player's main sense of direction and the in-game tutorial after phase 08's intro.
- **Goal board:** 3 rotating goals from 9 templates, always achievable at the current unlock level, sized for 5–15 minutes.
- **Community Board:** 6 bundles with permanent rewards (golden scarecrow, inventory slots, greenhouse unlock, extra traps, fishing luck, +1 buff slot).
- **Stats tab:** lifetime gold, crops, fish, dishes, days, play time.
- Progression **listens to events**; it is not wired into each system.

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
Vegetable and grain dishes that feel "earthy" boost growth (Roasted Turnip, Vegetable Soup, Pumpkin Soup). Sweet, sellable treats and feasts boost prices (Glazed Yams, Cranberry Pie, Harvest Feast). Fish dishes boost fishing: salads and stews for luck (Seaweed Salad, Garlic Trout, Seafood Stew, Royal Sturgeon), quick grilled things for speed (Grilled Bluegill, Fish Tacos). Hearty energy food helps workers (Wheat Flatbread, Corn Chowder, Catfish Gumbo). Comfort food and a spring banquet help the cook (Baked Potato, Tomato Pasta, Garden Banquet). Brain food boosts XP (Berry Bowl, Blueberry Muffin, Scholar's Stew, Moonfin Sushi). Full table: BALANCE.md §7.

### Tier
Tier T1–T4 is **computed from the recipe's inputs**: `score = ingredient units + ingredient value / 50 + cook minutes / 60`, with thresholds 8 / 15 / 28. More ingredients, pricier ingredients and longer cooking all push a dish up a tier. A test keeps the data and the formula in agreement.

### Strength and duration
`magnitude = 10% × tier × typeScale` and `duration = 6 minutes × 2^(tier − 1)` of simulated time, +50% for hearty (winter-cooked) dishes. So a T1 Green Thumb is +10% for 6 minutes; a T4 Green Thumb is +40% for 48 minutes (72 if hearty). Per-type scales keep strong effects fair: Silver Tongue is halved (T4 = +20% gold), Quick Hands and Scholar's Snack are ×1.5.

### Stacking
- **One buff per type.** Eating a dish of a type you already have keeps the **stronger** magnitude and the **longer** remaining time. It never weakens or shortens anything.
- **Slots:** 3 at the start, +1 at Cooking level 7, +1 from the Cozy Dinner bundle (max 5 of the 7 types). If all slots are full and you eat a new type, a confirmation offers to replace the buff with the least time left.
- Buffs tick in simulated time, keep running offline, and expire exactly (offline steps split at the expiry moment).
- Buffs are **nice, not needed**: kept up well they speed progression by about 10–25% (a phase 09 target).

## 8. Optional future: the Fullness meter (phase 10)

Off by default and only built if the owner wants it after playing v1. A 0–100 Fullness value that drains slowly in simulated time; eating a dish adds Fullness by tier, and you can't eat past 100 ("Too full", with a tooltip saying when there's room). Fullness **never** slows, harms or hurries the player: at 0 you simply have no buffs to lose. It links to buffs in one of two ways (the phase 10 session picks one and makes the other a flag): **capacity** (more Fullness allows more buff slots) or **well-fed bonus** (above 60 Fullness, buffs are a bit stronger). With the toggle off, the game behaves exactly like v1.

## 9. Out of scope for v1

- Multiplayer, trading or any online features
- NPCs with relationships, romance or dialogue trees
- Combat, mines, monsters or health
- A walkable player character (the farmhand is a visual-only helper)
- Animals (chickens, cows) and artisan machines (kegs, preserves)
- Weather events (rain, storms) and festivals
- Crafting beyond cooking
- Crop quality tiers (silver/gold stars)
- Monetisation, ads, accounts or cloud saves
- A hunger meter that affects play (only the optional, gentle Fullness meter in phase 10)

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
| 10 | optional Fullness meter |

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
