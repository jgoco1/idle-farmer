# Phase 04: Automation and Upgrades (the idle core)

> **Recommended model:** Sonnet 5.5. This phase follows patterns that already exist: data definitions, pure systems, panels and migrations. Switch to Opus if the offline-simulation tests prove difficult.
> **Depends on:** Phase 03 merged.

## Role and goal
You are adding the **automation** that turns a cozy farming game into an **idle** game. By the end of this phase, a player who invests gold can leave the game and come back to a farm that watered, harvested, replanted and sold its crops on its own, and see a satisfying "While you were away…" summary.

## Read first
`CLAUDE.md`, `docs/PROGRESS.md`, the Automation section of `docs/GDD.md`, the upgrade tables in `docs/BALANCE.md`, and the existing `src/systems/farming.ts` and `src/systems/economy.ts`, including their modifier hooks.

## Requirements
1. **Upgrade data (`src/data/upgrades.ts`).** Add 8 to 10 upgrades from BALANCE.md. Each has an id, a name, a description, a category, a max level, a cost curve, an effect per level, and prerequisites. Suggested set:
   - **Sprinkler** (placeable on the grid; waters an area each morning; tiers widen the area)
   - **Scarecrow / Fertilizer** (growth speed or yield bonus)
   - **Farmhand** (auto-harvests ready plots every N seconds; levels increase speed and capacity)
   - **Seed Planter** (auto-replants the last crop in a plot if there are seeds in the inventory)
   - **Auto-Seller** (sends harvests to the shipping bin; can be toggled per item)
   - **Tool upgrades:** Copper and then Iron Watering Can and Hoe, so that one click affects a larger area
   - **Barn Storage** (more inventory capacity)
   - **Greenhouse** (a later unlock: a few plots that ignore seasons)
2. **Automation system (`src/systems/automation.ts`).**
   - This is a pure tick function. It runs the automated actions in a clear, documented order each tick or day: sprinklers water in the morning, then planting, then harvesting, then shipping.
   - It must be **efficient and correct in large offline steps**. For example, 8 hours of simulation should finish in well under 100 ms. Use closed-form maths or per-day batching where you can, rather than simulating every tick. Add a test that compares a large step with many small steps.
   - It reads growth and throughput modifiers through the existing seams. Add an `automationSpeedModifier` seam for the phase-06 buffs.
3. **Placement.** Sprinklers and the scarecrow are placed objects on the plot grid. Add a placement mode with a range preview overlay, and allow picking objects up again. Give them sprites and simple animations: sprinkler spray in the morning, and a scarecrow bob.
4. **The Farmhand.** A small pixel character sprite that visibly moves between ready plots. This is purely visual: the logic is tick-based, and the sprite follows along. The animation must never block or drive the logic. It is the only animated "person" in the game, so make it charming: a 2 to 4 frame walk and a harvest pop.
5. **Upgrades panel.** Group upgrades by category. Show the current level, the next level's effect, the cost and the locked prerequisites. Give the player feedback when they buy something.
6. **Offline summary.** Complete the stub modal from phase 01. It lists crops harvested, items shipped, gold earned and plots left dry, with small icons. Collapse it if nothing happened.
7. **Rebalance.** Extend the phase-03 pacing simulation so that the greedy strategy buys automation. Check the target for when the first automation should be bought, and that the whole farm can be automated in roughly the time BALANCE.md sets. Tune the numbers and write notes in BALANCE.md.

## Save
Bump `SAVE_VERSION` for upgrade levels, placed objects and per-item auto-sell toggles. Add a migration and a test.

## Tests (minimum)
Sprinkler area coverage for each tier, farmhand throughput, the replant and auto-sell chain, offline equivalence (a large step versus small steps), the performance budget for an 8-hour offline step, upgrade costs and prerequisites, placement validity, and the migration. Extend the e2e test: buy a sprinkler and place it, time-warp one day, and assert that the plots are wet.

## Out of scope
Fishing (and fish traps, phase 05), cooking and buffs (06) and quests (07). Keep the modifier seams, but don't add their sources.

## Definition of done
- All checks pass.
- Take a screenshot of an automated farm with the farmhand and sprinklers visible.
- Add a PROGRESS.md Phase 04 entry with the offline performance numbers.
- Open a PR titled `Phase 04: Automation & upgrades`.
