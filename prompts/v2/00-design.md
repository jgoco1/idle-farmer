# v2 Phase 00: Design Update for the Bigger World, Decorations, Orchard and Animals

> **Recommended model:** Opus 5.5. As v1 phase 00 did, this phase writes the documents every later v2 phase reads. Decisions made here about world size, save shape and numbers are expensive to change later.
> **Depends on:** v1 complete (phase 09 merged).
> **Output:** documentation only. **Do not write game code in this phase.**

## Role and goal
You are the lead designer and architect of **Hearthfield Idle**, a finished cozy idle farming, fishing and cooking browser game. v1 is live. The owner has chosen four v2 features:
- **A.** a bigger world with a pannable camera
- **B.** a decoration shop and town projects, as a late-game gold sink
- **C.** fruit trees and an orchard
- **D.** chickens and cows

Your job is to update the design documents so the four implementation sessions (`prompts/v2/01` to `04`) can build these features consistently.

Start by reading `prompts/README.md` (the v2 section), every file in `prompts/v2/`, `CLAUDE.md`, and all of `docs/`. Pay particular attention to:
- the Phase 09 entry in `docs/PROGRESS.md`
- `docs/IDEAS.md` (the "late-game gold sink" and "bigger scene on narrow phones" entries)
- `docs/BALANCE.md` "Phase 09 balance report"

Then read the code that these features touch: `src/render/scene.ts` and `renderer.ts`, `src/systems/placement.ts` and `expansions.ts`, `src/core/save.ts`, and `scripts/sim/`.

## Owner decisions (fixed; do not change)
- **Build order:** world and camera, then decorations and town projects, then orchard, then animals. There is one PR per phase.
- **Fruit trees mature in real time.** Tree maturity counts **real calendar days** since planting, taken from the injected clock through `ctx.calendar` the same way the weekly seasons are. It is not simulated time, so the offline cap does not slow a tree down. Maturity never decreases if the system clock is set back (the same rule as the season week index). Trees never wither and bear fruit only in their seasons.
- **No casino, slots or games of chance,** and no alternatives to them. Gold sinks are decorations, land and town projects.
- **Decorations are cosmetic.** The most they may do is feed a "farm charm" score that unlocks more decorations, milestones and goals. They give **no income bonus**.
- **Animals are gentle.** An unfed animal simply doesn't produce: it never gets sick, leaves or dies, and there is no penalty meter. Animals are fed from farm produce (hay made from wheat, or corn feed), so they connect back to farming.
- **Pillars and rules still hold:** the pillars in GDD §2, the architecture rules in `CLAUDE.md`, and **existing saves must migrate** (v1 is `SAVE_VERSION` 7).
- **Phase 10 (Fullness meter) stays on hold.** Do not design for it beyond keeping the buff seams intact.

## Deliverables

### 1. `docs/GDD.md`
Add a **§12 "v2"** section, and update the sections these features change: §4 time model (trees), §5 screen layout, §6 systems, and §9 out of scope (animals move into scope; artisan machines stay out). For each feature give the player actions, idle behaviour, unlocks and the phase that builds it.

- **World and camera:**
  - Choose the new world size: roughly 2 to 3 times the v1 area of 20 × 12 tiles, for example 40 × 24. Draw an ASCII map of the whole world with regions: the v1 home area (kept recognisable), the orchard lot, the animal yard, space for decorations, the town square and board, and the water.
  - Explain which regions are **land parcels** bought with gold, and in what order.
  - Controls: drag or one-finger pan, pinch and wheel zoom (integer pixel scales only), arrow and WASD keys, a "home" button, and edge clamping.
  - What happens off-screen: toasts for events in regions you can't see, and optionally small edge arrows.
  - How the phone layout changes. The IDEAS.md entry about a small scene on narrow phones should be solved by this.
- **Decorations and town projects:**
  - Decoration sets. Give 2 or 3 themed sets of 8 to 12 pieces each for the first release (for example Cottage, Harvest Fair and Seaside). Include paths, fences, flower beds, lamps that glow at night, benches, farmhouse paint and roof variants, and a farmhouse extension.
  - Placement: reuse the phase 04 placement mode, including move, pick up and a grid snap. Decorations can't sit on plots, water or buildings.
  - The **charm** score: how it is computed, and what it unlocks (more pieces, milestones and goal templates only).
  - **Town projects** on the Community Board. These are 5 or 6 large, multi-stage gold (and item) donations that visibly change the town and scene. Examples: repair the bridge, rebuild the bakery, a lighthouse, a bandstand. They may give quality-of-life rewards, such as a longer bin pickup window, more decoration slots or a new decoration set. They may **not** give income multipliers.
- **Orchard:** trees take a 2 × 2 footprint, each has a sapling price and real days to maturity, and fruit hangs on the tree and accumulates up to a cap. Decide how fruit is produced: each 06:00 refresh in season is recommended, since it matches real-time maturity. Cover harvesting by click, by the farmhand and by the Auto-Seller; moving or removing a tree, with confirmation, since trees are long-term investments; and how it is shown in the away summary.
  - Also decide whether **fruit uses calendar days or simulated time**, and justify it. Calendar days are consistent with maturity. Simulated time is consistent with the offline cap.
- **Animals:** a coop for chickens and a barn for cows, placed in the animal yard, each with upgrade levels for capacity. Animals are bought from a new **Ranch** section or panel.
  - **Feed:** hay is made from wheat (a silo or hay bale) and feed from corn. A trough holds N portions.
  - **Production:** a fed animal produces on a timer. Recommend simulated time, consistent with the other idle timers, but state the choice. There is **no quality tiers system**; that stays out of scope.
  - Products are egg, large egg (optional) and milk. Cows and chickens wander inside their pens, which is **render-only**: it uses cosmetic randomness and never touches game state.
  - Petting is a cosmetic bonus, like the cat. It must not become a daily chore that gets punished if skipped.
  - Automation: an auto-feeder and a collector, the farmhand's routes, and the Auto-Seller toggles.
  - Recipes: new egg, milk and fruit recipes, including a **winter gold-buff dish** (IDEAS.md). Use the existing 7 buff types and the existing tier formula.

### 2. `docs/BALANCE.md`
Add a **"v2" section** containing:
- **Land parcel prices.** These are part of the gold sink.
- **Decoration price bands and a total "catalogue cost".** Target: gold stays meaningful through **day 30**. The phase 09 simulator showed about 3M gold earned by day 7 against about 523k of things to buy. Set a target curve for "gold still to spend" by day, and a way to check it with the simulator.
- **Town project costs.**
- **A table for every tree:** 6 to 8 trees covering all four seasons with at least one winter tree, with sapling price, real days to mature, fruit per bearing day, cap, and fruit base price.
- **A table for every animal and building:** price, feed per portion, production interval, product value, and building capacity by level.
- **New recipes:** 8 to 12 using eggs, milk and fruit, with the tier computed by the existing formula and one line per buff choice. The design test in `tests/cooking.test.ts` must still pass.
- **Pacing targets** for each feature: when the orchard and animals unlock, and time to the first fruit and first egg. The phase 09 checks should also still pass: no dominant strategy (at most 1.5×), buffs +10–25%, and no early dead time.
- **Simulator changes:** what the bots need to learn for each feature (decorating, buying parcels, planting trees, feeding animals), and which new checks to add.

### 3. `docs/DATA_SCHEMAS.md`
- The new id unions: `TreeId`, `FruitId`, `AnimalId`, `AnimalProductId`, `DecorId`, `DecorSetId`, `ParcelId`, `TownProjectId`.
- The new definitions: `TreeDef`, `AnimalDef`, `BuildingDef`, `DecorDef`, `ParcelDef`, `TownProjectDef`.
- **World coordinates:** how plots, zones, placed objects, trees and buildings address tiles in the bigger world. This is the change most likely to break things. Say exactly how v1 tile coordinates map into the new world (for example, the v1 area becomes an offset region), and whether plot indexes change.
- **The `GameState` additions and a `SAVE_VERSION` plan:** 8 for the world, 9 for decorations, 10 for the orchard and 11 for animals, each with its migration contract. The camera position belongs in **prefs**, not the save, as the phase 08 convention says.

### 4. `docs/ART_STYLE.md`
- Palette additions, if any (keep them few).
- Sprite sizes for trees (32 × 32 or 32 × 48, with growth stages and fruit overlays), buildings (coop and barn with level variants), animals (walk, idle and eat frames), and the decoration sets.
- How lamps glow at night and how the decoration sets stay visually consistent.
- One worked example sprite each for a tree and an animal in the string-grid format. They must pass the rules in `tests/sprites.test.ts`.

### 5. `CLAUDE.md`, `docs/PROGRESS.md`, `docs/IDEAS.md`
- **`CLAUDE.md`:** add a short "v2" note covering world coordinates, the camera being in prefs, and the rule that decorations are cosmetic.
- **`docs/PROGRESS.md`:** add a "v2 Phase 00" entry.
- **`docs/IDEAS.md`:** mark the entries these features absorb.

## Out of scope
Any code. The casino and its alternatives. The phase 10 Fullness meter. Artisan machines (cheese press, jars, kegs): the kitchen makes cheese and jam as recipes instead. Crop or animal quality tiers. NPCs and multiplayer.

## Definition of done
- All documents are updated and consistent with each other. The same ids appear in the GDD, BALANCE and SCHEMAS docs, and all content counts are stated.
- **GDD §11 gains a "v2 open questions" list** of choices the owner should confirm, such as world size, which regions are parcels, the fruit clock, and a starter decoration set. Repeat them in your final message.
- Commit, push, and open a PR to `main` titled `v2 Phase 00: Design update (world, decor, orchard, animals)`.
