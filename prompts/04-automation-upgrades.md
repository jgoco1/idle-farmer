# Phase 04: Automation and Upgrades (the idle core)

> **Recommended model:** Sonnet 5.5. This phase follows patterns that already exist: data definitions, pure systems, panels and migrations. Switch to Opus if the offline-simulation tests prove difficult.
> **Depends on:** Phase 03 merged.
> **Docs win:** the phase 00 owner decisions (`docs/GDD.md` §11) changed some details, including a real-time calendar with weekly seasons, timers in simulated minutes, and 7 buff types. Where this prompt conflicts with `docs/`, follow `docs/` and note the difference in `docs/PROGRESS.md`.

## Role and goal
You are adding the **automation** that turns a cozy farming game into an **idle** game. By the end of this phase, a player who invests gold can leave the game and come back to a farm that watered, harvested, replanted and sold its crops on its own, and see a satisfying "While you were away…" summary.

## Read first
`CLAUDE.md`, `docs/PROGRESS.md`, the Automation section of `docs/GDD.md`, the upgrade tables in `docs/BALANCE.md`, and the existing `src/systems/farming.ts` and `src/systems/economy.ts`, including their modifier hooks.

## Requirements
1. **Upgrade data (`src/data/upgrades.ts`).** Add the 10 phase-04 upgrades from BALANCE.md §4 (`sprinkler`, `sprinkler_tech`, `scarecrow`, `farmhand`, `seed_planter`, `auto_seller`, `watering_can`, `hoe`, `barn_storage`, `greenhouse`). Each has an id, a name, a description, a category, a max level, a cost curve, an effect per level, and prerequisites. In summary (GDD §6.3):
   - **Sprinkler:** placeable on the grid. It keeps its area **permanently watered**. **Sprinkler Tech** widens the area (plus shape → 3 × 3 → 5 × 5).
   - **Scarecrow:** placeable on the grid. It boosts growth in an area. There is no separate fertilizer.
   - **Farmhand:** harvests up to C ready plots every N seconds. Levels increase speed and capacity.
   - **Seed Planter:** L1 replants after the farmhand, L2 fills empty tilled plots, and L3 tills and clears. It never plants out of season.
   - **Auto-Seller:** sends harvests to the shipping bin, with per-item toggles. L2 keeps a reserve for cooking.
   - **Tool upgrades:** the watering can and hoe hit a larger area (1 → 3 → 9 → 25 tiles).
   - **Barn Storage:** raises the stack size (the backpack from phase 03 adds slots).
   - **Greenhouse:** 6 and then 12 plots that ignore seasons.
2. **Automation system (`src/systems/automation.ts`).**
   - This is a pure tick function. It runs the automated actions in the order from GDD §6.3: growth → farmhand harvest → planter → auto-ship → shipping-bin pickup (when due). Calendar events (the daily refresh and the season change) are applied at their boundary before the step that crosses it.
   - It must be **efficient and correct in large offline steps**. For example, 8 hours of simulation should finish in well under 100 ms. Use closed-form maths or per-day batching where you can, rather than simulating every tick. Add a test that compares a large step with many small steps.
   - It reads growth and throughput modifiers through the existing seams. Add an `automationSpeedModifier` seam for the phase-06 buffs.
3. **Placement.** Sprinklers and the scarecrow are placed objects on the plot grid. Add a placement mode with a range preview overlay, and allow picking objects up again. Give them sprites and simple animations: a periodic sprinkler spray, and a scarecrow bob.
4. **The Farmhand.** A small pixel character sprite that visibly moves between ready plots. This is purely visual: the logic is tick-based, and the sprite follows along. The animation must never block or drive the logic. It is the only animated "person" in the game, so make it charming: a 2 to 4 frame walk and a harvest pop.
5. **Upgrades panel.** Group upgrades by category. Show the current level, the next level's effect, the cost and the locked prerequisites. Give the player feedback when they buy something.
6. **Offline summary.** Complete the stub modal from phase 01. It lists crops harvested, items shipped, gold earned and plots left dry, with small icons. Collapse it if nothing happened.
7. **Rebalance.** Extend the phase-03 pacing simulation so that the greedy strategy buys automation. Check the target for when the first automation should be bought, and that the whole farm can be automated in roughly the time BALANCE.md sets. Tune the numbers and write notes in BALANCE.md.

## Save
Bump `SAVE_VERSION` for upgrade levels, placed objects and per-item auto-sell toggles. Add a migration and a test.

## Tests (minimum)
Sprinkler area coverage for each tier, scarecrow growth area, farmhand throughput, the replant and auto-sell chain (including the planter never planting out of season, and behaviour across an offline season change), offline equivalence (a large step versus small steps), the performance budget for an 8-hour offline step, upgrade costs and prerequisites, placement validity, and the migration. Extend the e2e test: buy a sprinkler and place it, time-warp past 2 hours of simulated time, and assert that the covered plots are still watered while uncovered plots have dried.

## Out of scope
Fishing (and fish traps, phase 05), cooking and buffs (06) and quests (07). Keep the modifier seams, but don't add their sources.

## Definition of done
- All checks pass.
- Take a screenshot of an automated farm with the farmhand and sprinklers visible.
- Add a PROGRESS.md Phase 04 entry with the offline performance numbers.
- Open a PR titled `Phase 04: Automation & upgrades`.
