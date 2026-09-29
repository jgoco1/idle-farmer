# Phase 02: Farming (crops, soil, watering, growth, seasons, harvest)

> **Recommended model:** Sonnet 5.5. The architecture and patterns come from phase 01. This phase is feature work that follows them.
> **Depends on:** Phase 01 merged.
> **Docs win:** the phase 00 owner decisions (`docs/GDD.md` §11) changed some details, including a real-time calendar with weekly seasons, timers in simulated minutes, and 7 buff types. Where this prompt conflicts with `docs/`, follow `docs/` and note the difference in `docs/PROGRESS.md`.

## Role and goal
You are adding the **farming** system to a cozy idle farming and cooking browser game with a pixel-art look inspired by Stardew Valley and Minecraft. By the end of this phase, the player can buy seeds (using a temporary seed source), till and plant plots, water them, watch crops grow through their visible stages, and harvest crops into the inventory. Growth continues offline, and the season matters.

## Read first
`CLAUDE.md`, `docs/PROGRESS.md` (especially the Phase 01 next-phase notes), the Farming section of `docs/GDD.md`, the crop tables and formulas in `docs/BALANCE.md`, `docs/DATA_SCHEMAS.md` and `docs/ART_STYLE.md`. Reuse the existing patterns for actions, panels, sprites and tests. Do not invent parallel ones.

## Requirements
1. **Crop data (`src/data/crops.ts`).** Add all v1 crops from BALANCE.md (about 15). Each has its seasons, grow time, number of stages, whether it regrows (and the regrow time), yield range, seed cost and base sell value. Use id types so that data references are checked at compile time.
2. **Items and inventory (`src/data/items.ts`, `src/systems/inventory.ts`).** Seeds and crops are items. Build a stacking inventory with a capacity limit (the limit is expanded later by upgrades). Add pure helpers `addItem`, `removeItem`, `hasItems` and `countItem`.
3. **Plot states (`src/systems/farming.ts`).** Each plot is one of: untilled → tilled → planted (with a stage and growth progress) → ready. Each plot also tracks when its watering runs out. One watering lasts **2 hours of simulated time**. Watered plots grow at full speed, and dry plots grow at **half speed**: they never stop growing and never die (GDD §6.1). Dry soil and wet soil have different sprites.
4. **Growth ticking.** Growth is a pure function of `(plot, dt, modifiers)`. Leave a `modifiers` hook so that later buffs and upgrades can scale growth speed; pass 1.0 for now. Growth must be correct under the offline large-step simulation. Test that a single 8-hour step gives the same result as many small steps, within tolerance.
5. **Seasons.** Seasons follow the real-time calendar from phase 01 and change weekly. Seeds can only be planted in season. A crop still growing when the weekly season change arrives withers into a "dead crop" tile that can be cleared, and this must also work when the change happens during offline time. Crops that span several seasons survive the change. The seed list shows which seeds are in season. During the last two days of a season, the HUD shows "Season changes in 2d 4h" and the seed list warns about crops that won't finish in time.
6. **Harvest.** Clicking a ready plot harvests it: the yield goes to the inventory, using the seeded RNG for the yield range. A crop that regrows goes back to an earlier stage, and any other crop leaves the plot tilled. Emit events for a harvest effect and a notification.
7. **Interaction.** Clicking a plot runs the right action for its state. A tool selector in the toolbar lets the player choose Auto, Hoe, Seeds, Watering Can or Hand. Auto picks the obvious action. Add click-and-drag or shift-click to act on several plots at once. The starting farm is the **4 × 2** plot grid at tile (6,2) from GDD §5; expansion comes in phase 03.
8. **Temporary seed source.** Add a small "Seed Crate" section in the Shop panel that lets the player buy a few starter seeds with a starting amount of gold, so the loop is playable. Phase 03 replaces or extends this with the real shop and market, so keep it minimal and mark it with a `TODO(phase03)` comment.
9. **Sprites.** For every crop, add growth-stage sprites (seed, sprout, mid-growth, near-ready, ready) and a harvested item icon. Crops should be recognisable at 16×16, with distinct silhouettes and colours from the palette. Add a withered-crop sprite, and a subtle sway or sparkle animation on ready crops.
10. **Inventory panel.** Replace the stub with a grid of item icons, counts and a tooltip showing name, description and sell value.

## Save
The `GameState` changes (plots, inventory), so bump `SAVE_VERSION` and add a migration that turns a phase-01 save into a valid phase-02 save. Add a test for it.

## Tests (minimum)
Plot state transitions, growth over time with and without water (including water running out partway through a step), season withering (online and across an offline season change), regrowth, harvest yields using a fixed RNG seed, inventory capacity limits, offline growth equal to online growth, and the migration. Extend the e2e smoke test: till, plant and water a plot, use the debug time-warp to make it ready, harvest it, and check the inventory count.

## Out of scope
Selling crops or market prices (phase 03), sprinklers or any automation (04), fishing, cooking, buffs and XP. If you add hooks for these, keep them as small typed seams with no behaviour.

## Definition of done
- `npm run typecheck && npm run lint && npm test && npm run build && npm run test:e2e` pass.
- Look at an e2e screenshot of a planted farm and make sure the crops look good.
- Add a `docs/PROGRESS.md` Phase 02 entry covering Built, Deviations, Known issues and Next-phase notes. The notes should cover where selling hooks in and where the growth modifiers live.
- Commit, push, and open a PR to `main` titled `Phase 02: Farming`.
