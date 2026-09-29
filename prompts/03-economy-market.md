# Phase 03: Economy, Market and Farm Expansion

> **Recommended model:** Opus 5.5. The economy is where idle games succeed or fail. Price dynamics, cost curves and pacing need careful numerical reasoning, and every later system is priced on top of what this phase sets up.
> **Depends on:** Phase 02 merged.
> **Docs win:** the phase 00 owner decisions (`docs/GDD.md` §11) changed some details, including a real-time calendar with weekly seasons, timers in simulated minutes, and 7 buff types. Where this prompt conflicts with `docs/`, follow `docs/` and note the difference in `docs/PROGRESS.md`.

## Role and goal
You are designing and building the **economy** of a cozy idle farming and cooking browser game. By the end of this phase, the player can sell crops through a market with gently changing prices, buy seeds in a real shop, and spend gold to expand the farm. The first 30 minutes should feel well paced: there is always a next thing to save for, and gold is never too scarce to act on nor so plentiful that choices stop mattering.

## Read first
`CLAUDE.md`, `docs/PROGRESS.md`, the Economy section of `docs/GDD.md`, `docs/BALANCE.md` (prices, curves and pacing targets) and `docs/DATA_SCHEMAS.md`. Look at how the phase-02 temporary Seed Crate works: you will replace it.

## Requirements
1. **Currency (`src/systems/economy.ts`).** Gold is an integer. Add pure `earn`/`spend` helpers that refuse overspending. Keep a lifetime-earned statistic for later progression.
2. **Market with dynamic prices.**
   - Each sellable item has a `basePrice`. The current price is `basePrice × demandMultiplier`.
   - Selling an item lowers its demand multiplier using the formula from BALANCE.md. It recovers toward 1.0 over about half an hour of simulated time, and items left unsold for 3 or more hours climb toward 1.3. The floor is 0.5 and the ceiling is 1.3.
   - **Today's specials:** at the daily refresh (06:00 local, from the phase-01 calendar), 1 to 3 random items get a +20 to 50% bonus. Use the seeded RNG. If several days pass while the player is away, the refresh happens once.
   - The design should nudge players toward growing a variety of crops, but never punish them for growing one.
3. **Selling UX.** The Market panel lists sellable items with their current price, a trend arrow and a 7-day sparkline, with one point recorded at each daily refresh. It has sell-1, sell-10 and sell-all buttons and shows a preview of the total gold before selling. Also add a **Shipping Bin** zone in the scene. The bin is **collected every 60 minutes of simulated time** and pays 100% of the prices at that moment. The Market panel sells instantly at **90%**, so each option has a reason to exist.
4. **Seed shop.** Replace the phase-02 `TODO(phase03)` Seed Crate with the real Shop panel. It lists in-season seeds, locks seeds that need progression (with the unlock hint shown), and supports buy-1 and buy-N. Its stock can change by season.
5. **Farm expansion (`src/data/expansions.ts`).** Add the 4 plot-expansion steps from BALANCE.md, which grow the grid from 4 × 2 to 8 × 6. Each step adds plot rows and columns, visibly change the scene (a fence moves, grass is cleared) and cost gold on a geometric curve. Rendering must handle the plot grid growing.
6. **Inventory upgrades.** Add backpack capacity upgrades, bought with gold.
7. **Rebalance.** Using the formulas, write a small pure helper (or a Vitest test that acts as a simulation) that plays out the first 60 minutes of play with a simple greedy strategy. Check that the pacing targets in BALANCE.md hold. Adjust the numbers in `src/data/` and `docs/BALANCE.md`, keep the two in sync, and record your reasoning in BALANCE.md under "Phase 03 tuning notes".
8. **HUD.** Animate the gold counter as it counts up. Show a small "+N gold" popup where a sale happens.
9. **Hooks for later phases.** Add a `sellPriceModifier` seam, which food buffs will drive in phase 06, and a `goldEarned` event, which progression will use in phase 07. If BALANCE.md §9 defines a provisional farm level based on lifetime gold for gating seeds before phase 07, implement it here.

## Save
Bump `SAVE_VERSION` for the market state, gold statistics and expansion level, and add a migration and a test. Give an old save sensible default demand values.

## Tests (minimum)
Price decay and recovery, clamping to the floor and ceiling, specials re-rolling at 06:00 local and deterministic for a given seed (and refreshing once after several days away), hourly shipping bin payouts at the prices of that moment (including many pickups during a long offline period), expansion purchase and plot-grid growth, refusal to overspend, the pacing simulation, and the migration.

## Out of scope
Automation such as sprinklers and helpers (phase 04), tool upgrades (04), fishing, cooking, buffs and quests.

## Definition of done
- All checks pass: `typecheck`, `lint`, `test`, `build` and `test:e2e`. Extend the e2e test so that it sells an item and buys an expansion.
- `docs/BALANCE.md` and `src/data/` agree.
- Add a PROGRESS.md Phase 03 entry that includes your pacing simulation results.
- Commit, push, and open a PR titled `Phase 03: Economy & market`.
