# v4 Phase 00: Design the North

> **Recommended model:** Opus 5.5. This phase writes the design that every later v4 phase follows: how the world grows north without moving any saved position, the new land and buildings, their numbers checked against the simulator's economy, and the save plan.
> **Depends on:** v2 phase 06 merged. v3 phases can come before or after; v4 needs nothing from the store shells.
> **Output:** documents only, no game code. Open a PR titled `v4 Phase 00: Design the North`.

## Role and goal
The world is 36 × 22 tiles and the camera only scrolls a little vertically. v4 adds a **northern band of new land**: more fields, and buildings that give cooked food and new produce somewhere to go. Design it completely, so phases 01–04 can build it without guessing.

## Owner decisions (fixed)
- **The world grows north.** New land lies above today's row 0. **No saved position moves:** decorations, buildings and the camera keep their tiles and pixels.
  - The recommended way is **negative rows**: the world's top becomes `WORLD_TOP` (for example −14) and the home region stays at (0, 0).
  - Choose a different way only if the audit (requirement 1) shows negative rows can't work, and explain why.
  - CLAUDE.md's "the world only grows right and down" is replaced by your rule in v4-01.
- **More fields in the north**, bought as land parcels like the v2 parcels, each with its own plot grid.
- **A restaurant** that buys cooked dishes (and v4 drinks) at a better return than the Market.
- **A place that makes drinks:** a new recipe family made at its own station.
- **Everything v1 and v2 promised still holds:**
  - decorations stay cosmetic
  - no town project gives gold or an income multiplier (so the restaurant is a building you buy, not a town project)
  - animals stay gentle
  - nothing spoils or is lost
  - no games of chance or anything that imitates one (restaurant customers arrive on a fixed schedule, not at random)

## Read first
- `CLAUDE.md`, all of it.
- `docs/GDD.md` §12 (v2) and §11 (owner decisions), `docs/BALANCE.md` §13 and the latest balance reports, `docs/DATA_SCHEMAS.md` §9, `docs/ART_STYLE.md` §6, `docs/IDEAS.md`.
- The v2 design prompt `prompts/v2/00-design.md`, for the shape of a design phase.
- In code:
  - `src/data/world.ts` (`WORLD_LAYOUT`, regions, lanes, `DECOR_BLOCKED`) and `src/data/parcels.ts`
  - `src/render/scene.ts`, `src/render/camera.ts`
  - `src/systems/farming.ts` and `automation.ts` (how the greenhouse's plots sit beside the field's with `GREENHOUSE_BASE`)
  - `src/systems/cooking.ts`, `market.ts` and `autoSeller.ts`
  - `scripts/sim/`

## Requirements

### 1. Audit: can the world grow up?
List every place that assumes the world starts at row 0 or column 0, with file and line:
- bounds checks
- `tileAt`
- chunk indexes
- the frame canvas
- the camera clamp
- save validation of decoration and building tiles
- `regionAt`
- the e2e helpers
- sprites that tile

For each, say what negative rows need. Estimate the size of the change. This decides the approach, so do it first and put it in the PR.

### 2. The northern map (GDD §13, DATA_SCHEMAS §10)
Draw the new band as an ASCII map at tile scale, joined to today's map. Include:
- **2–3 field parcels** ("North Fields", "Upper Terraces"…), each with a plot grid size, a fence and gates, a path, a price, and an unlock.
  - Decide how their plots are indexed beside the home field and the greenhouse (a base per field, as `GREENHOUSE_BASE`).
  - Decide how the farmhand, the planter, sprinklers, scarecrows, Seed Order, Shift-click and "Harvest all" cover them.
  - The farmhand should never walk off-screen in a way that looks broken. Say how its route crosses fields.
- **The restaurant site** and **the drinks building's site**, on a north road reached by extending the lane at column 20 northwards. Each has a click zone.
- **Room for the North Woods** (requirement 5).
- **Lanes, tree lines and the world's edge**, so the north reads as a place.
- **A camera pass:** the default view, Home, and how far up a phone scrolls.

### 3. The restaurant (GDD, BALANCE)
Recommended shape (change it if the numbers say so, and explain):
- **Bought and upgraded** like a ranch building: levels 1–3, more tables, a better premium.
- **A menu of slots:** the player puts stacks of dishes or drinks on it from the bag. Each slot serves on a **fixed timer** in simulated time (one serving every N minutes per table), in whole cycles like the ranch, so one big step equals many small ones.
- **Prices:**
  - a serving earns the item's base price × a level premium (for example 1.3 / 1.45 / 1.6)
  - Market demand doesn't drop, because restaurant guests aren't the Market
  - the restaurant never pays more than a set multiple of base
- **Takings** go straight to gold with an event, and the away summary has a line. An empty menu does nothing. A dish waits on the menu forever without spoiling.
- **Optional:** a "Chef's special", one menu slot that earns a little more and rotates daily on the calendar, if it's not a chance mechanic. Decide.
- **Balance questions to answer with the simulator** (not by guessing):
  - Does it make "Chef who sells" dominant?
  - What does it do to the buffs check (today buffs vs selling dishes is +10–25%)? The restaurant raises the selling side, so buffs need retuning or a rule.
  - Where does it land on the gold-sink curve?

  Propose the numbers and the brain changes.

### 4. Drinks
- **Content-rating decision.** Recommend **non-alcoholic** drinks: a Press House or Tea House with cider, lemonade, berry cordial, herbal teas, hot cocoa (a winter drink, IDEAS.md), a melon cooler, honey milk. The v3 store listings say there is no alcohol, and alcohol changes the age rating on Google Play, the App Store and Steam.
  - If you think a "brewery" with real alcohol is worth it, write the trade-off as an open question. Don't decide it.
- **The station:** its own building and slots, with **long timers** (presses and casks: tens of minutes to hours), so drinks are an idle activity next to cooking. Levels add slots.
- **Recipes:** 8–12 drinks using fruit, crops, milk and honey. Give tiers from the existing formula, and buffs:
  - either the existing buff types
  - or a separate **drink slot** (one buff from a drink alongside the dish buffs)

  Pick one, with the reason. No new buff *types* unless the simulator shows a gap.
- Drinks sell at the Market and the restaurant, and can fill bundles and town stages.

### 5. Other northern content (pick what fits, with reasons)
Write each as a short section with numbers, and mark which v4 phase builds it:
- **An apiary:** beehives that make honey on a simulated-time timer (an ingredient for drinks and recipes). Gentle like the animals. Hives may *not* depend on decorations, which are cosmetic; flowers that count must be crops or trees.
- **The North Woods:** **foraging spots** that regrow wild mushrooms, berries and herbs on calendar days (like trees, picked by hand or by a later upgrade).
- **A mountain lake:** a fourth fishing location with its own fish and its own minigame tuning.
- **A mill:** wheat to flour, unlocking bread recipes, if wheat needs more uses.
- Anything else you think the north needs to feel like a place. Keep the list short: v4 is 4 build phases.

### 6. Numbers and checks (BALANCE §14)
- Prices, unlocks and pacing targets for every parcel, building, level and recipe.
- The day each should first be bought by the bots.
- How the gold-sink curve ("gold still to spend") changes over 30 and 60 days.
- New simulator checks: restaurant share of income, drink income, north fields' share.
- Extend `scripts/sim/` in the build phases, not here. Here, write what the brain must learn.

### 7. Art (ART_STYLE §7)
Sprite sizes and palettes for:
- the northern ground, fences and paths
- the restaurant at three levels, by day and by night (lit windows and diners)
- the drinks building and its stations
- beehives
- forage spots by season
- lake water
- item icons

Use the existing 49-colour palette and add colours only if you must.

### 8. Save plan (DATA_SCHEMAS §10.x)
One `SAVE_VERSION` per build phase that changes state, with each migration's contract and fixture contents. v2-06 used 14.

### 9. The build phases
Confirm or change the split below, and write a "what each phase owns" table:
- v4-01: the north, its parcels and fields
- v4-02: the restaurant
- v4-03: drinks and the apiary
- v4-04: the North Woods, the mountain lake, and a balance and polish pass

### 10. Open questions for the owner
End `docs/GDD.md` §13 with a numbered list of decisions only the owner can make, each with your recommendation:
- alcohol or not
- the restaurant's premium
- how many north fields
- whether foraging gets an automation upgrade

## Definition of done
- `docs/GDD.md` §13, `docs/BALANCE.md` §14, `docs/DATA_SCHEMAS.md` §10 and `docs/ART_STYLE.md` §7 are written; `docs/IDEAS.md` is updated; no code changes.
- The PR body summarises:
  - the audit's result and the chosen approach
  - the map
  - the restaurant numbers and their simulator rationale
  - the open questions
- Open the PR titled `v4 Phase 00: Design the North`.
