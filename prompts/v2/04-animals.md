# v2 Phase 04: Chickens and Cows

> **Recommended model:** Sonnet 5.5, then an Opus review using `prompts/templates/phase-review.md` before merging. It is the largest content addition in v2 and touches automation, recipes, bundles and the simulator.
> **Depends on:** v2 phase 03 merged. The animal-yard parcel exists from v2 phase 01.
> **Docs win:** where this prompt conflicts with `docs/`, follow `docs/` and note the difference in `docs/PROGRESS.md`.

## Role and goal
Add **animals**: a coop of chickens and a barn of cows in the animal yard. Fed from what you grow, they give eggs and milk for the market and a new family of recipes. They should be charming to watch and completely **gentle**.

## Owner decisions (fixed)
- An unfed animal simply **doesn't produce**. It never gets sick, leaves, dies or loses anything, and there is no mood or penalty meter.
- Feed comes from the farm: **hay made from wheat** and **feed made from corn** (the docs give exact sources and amounts). This connects animals to farming.
- Animal wandering is **render-only**: it uses cosmetic randomness and never touches game state or `rngState`.
- **No quality tiers and no artisan machines.** Cheese, butter and so on are kitchen recipes.

## Read first
`CLAUDE.md`, the v2 animals sections of `docs/GDD.md`, `docs/BALANCE.md` (the animal and building tables, the production choice and pacing) and `docs/DATA_SCHEMAS.md`, `docs/ART_STYLE.md` (animal and building sprites), and the latest `docs/PROGRESS.md` notes. Then read the code: `src/systems/automation.ts` (the farmhand), `autoSeller.ts`, `traps.ts` (a good model for "produce on a timer, hold up to a cap, collect"), `cooking.ts`, `bundles.ts`, `upgrades.ts`, and `src/render/farmhand.ts` (sprites that follow logic without driving it).

## Requirements
1. **Data (`src/data/animals.ts`, products and feed in `items.ts`).** Add the animals from BALANCE.md (chicken, cow, and any variants the docs list). Each has a price, the feed it eats, its production interval, its product and value, and XP. Add the buildings (coop and barn) with their levels and capacity. Products (egg, milk and any large variants) and feed (hay, corn feed) are items.
2. **Buildings.** Buy and place the coop and barn in the animal yard, using the placement footprints from the docs, and upgrade them for capacity. Buildings look different at each level.
3. **Animal system (`src/systems/animals.ts`):**
   - **Feeding.** Each building has a trough with N portions. The player fills it from the bag. Each animal eats one portion when its production cycle starts.
   - **Production.** A fed animal produces on the docs' timer (simulated time unless the docs chose otherwise) into the building's store, up to a cap. When the store is full, production waits; nothing is lost.
   - **Collection.** Click the building to collect. A **collector** upgrade empties it at each bin pickup (as the trap collector does), and the farmhand can refill troughs if the docs give it that job.
   - **Auto-feeder upgrade.** It pulls feed from a **silo** that turns wheat into hay, if the docs define one.
   - **Offline correctness.** Report every production and feeding moment through `msToNextSimEvent`, and test that one big step equals many small ones.
4. **Ranch UI.** A Ranch panel, or a section of an existing panel as the docs say, for buying animals, naming them, and seeing trough, store and production timers. Clicking a building opens it. Petting an animal plays hearts and a sound, like the cat. It is cosmetic, or gives at most the tiny bonus the docs allow, and there is **never a penalty for skipping it**.
5. **Recipes, bundles and milestones.** Add the egg and milk recipes from BALANCE.md, including the **winter gold-buff dish** (IDEAS.md). They use the existing tier formula and buff types. Add a Barnyard bundle and milestones ("First egg", "First milk") as the docs define.
6. **Art and life.**
   - Chickens and cows with walk, idle and eat frames, wandering inside their pens (render-side RNG).
   - Coop and barn sprites for each level, feed and troughs, and product icons.
   - Night: animals are drawn asleep inside or next to their building.
   - Everything culled to the viewport and allocation-free.
   - Sounds: a cluck, a moo and a collect sound through `src/audio/events.ts`, silent during offline replay.
7. **Automation hooks.** Auto-Seller toggles for eggs and milk (default off, so the kitchen gets them). The away summary lists eggs and milk collected and animals that went unfed, worded gently, for example "The hens would love some feed".
8. **Simulator.** Teach the brain to buy animals, make and fill feed, collect, and cook the new recipes. Add report rows for the first egg, first milk and animal income per day. Rerun every check: no dominant strategy (at most 1.5×), buffs +10–25%, no early dead time, no runaway growth, and gold still to spend through day 30.

## Save
`SAVE_VERSION` 11: buildings with their levels and positions, animals with names and building, troughs, stores and timers. Add a migration and a test, and `tests/fixtures/save-v11.json`.

## Tests (minimum)
- Feeding, production and the store cap.
- An unfed animal produces nothing and has **no other effect**; include a test that asserts nothing is lost or reduced.
- The collector and the auto-feeder.
- The farmhand's trough refilling, if the docs include it.
- Offline equivalence and the 8-hour and 30-day performance budgets.
- Building upgrades and capacity.
- Recipe tiers.
- Bundle and milestone completion.
- The render-only wandering leaves `rngState` untouched.
- The v10 → v11 migration.
- e2e: build a coop, buy two chickens, fill the trough, advance time, collect eggs, and cook an egg recipe.

## Out of scope
Artisan machines, animal quality or affection systems beyond cosmetic petting, animal breeding, more animal types than the docs list, and the Fullness meter.

## Definition of done
- All checks pass, including CI e2e.
- Screenshots: the animal yard by day and by night, and the Ranch panel.
- A "v2 Phase 04" entry in `docs/PROGRESS.md`, plus the full simulator report summary in `docs/BALANCE.md` ("v2 balance report").
- Open a PR titled `v2 Phase 04: Chickens & cows`.
- Then the owner runs an Opus review with `prompts/templates/phase-review.md` before merging.
