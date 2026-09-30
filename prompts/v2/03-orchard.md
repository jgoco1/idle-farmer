# v2 Phase 03: Fruit Trees and the Orchard

> **Recommended model:** Sonnet 5.5. It is a self-contained system on established patterns. The new part is that it runs on the real-time calendar, which is well specified below.
> **Depends on:** v2 phase 02 merged. The orchard parcel exists from v2 phase 01.
> **Docs win:** where this prompt conflicts with `docs/`, follow `docs/` and note the difference in `docs/PROGRESS.md`.

## Role and goal
Add **fruit trees** in the orchard: long-term investments you plant once, watch grow over **real days**, and harvest every season they bear fruit. They add fruit for the market, recipes and bundles, and give the player a new reason to come back each day.

## Owner decision (fixed)
**Tree maturity counts real calendar days** since planting, taken through `ctx.calendar` like the weekly seasons. It is **not** simulated time, so the offline cap does not slow a tree down.
- Maturity never goes backwards if the clock is set back: use a monotonic day index, like `calendar.maxWeekIndex`.
- Trees **never wither** and bear fruit only in their seasons.
- Whether fruit production uses calendar days or simulated time is set in `docs/BALANCE.md` (v2 phase 00 decided it). Follow that.

## Read first
`CLAUDE.md`, the v2 orchard sections of `docs/GDD.md`, `docs/BALANCE.md` (the tree table and pacing) and `docs/DATA_SCHEMAS.md`, `docs/ART_STYLE.md` (tree sprite sizes), and the latest `docs/PROGRESS.md` notes. Then read the code: `src/core/time.ts` (the calendar, `seasonEpoch`, the week index that never decreases), `src/core/sim.ts` (`processCalendar`, `onDayStarted`), `src/systems/farming.ts`, `src/systems/automation.ts` (the farmhand) and `src/systems/autoSeller.ts`.

## Requirements
1. **Data (`src/data/trees.ts`, fruit in `items.ts`).** Add the 6 to 8 trees from BALANCE.md, including at least one winter tree. Each has a sapling price, real days to mature, bearing seasons, fruit per bearing day, a hanging-fruit cap, the fruit's base price, and XP. Fruit items are sellable, so they join the market's demand and specials, and they are available for cooking and bundles.
2. **Calendar day index.** Add a monotonic real-day counter to the calendar, for example `calendar.dayIndex` counted from the save's creation. It never decreases, even when the clock is set back. Test it across daylight-saving changes, time-zone travel, a clock set back, and a 30-day absence. It is the one source of truth for tree age.
3. **Tree system (`src/systems/orchard.ts`):**
   - **Growth.** A tree's growth stage (sapling, young, mature, and a bearing overlay) is **derived** from `dayIndex − plantedDayIndex`, not stored.
   - **Fruit.** Fruit appears at each 06:00 daily refresh while the tree is mature and in season, up to the cap, or on a simulated-time timer if the docs chose that. Nothing is lost when the tree is full: it just stops adding fruit.
   - **Harvesting.** Click a tree to pick all its fruit. The **farmhand** picks mature trees on its route, and the Auto-Seller has toggles for fruit.
   - **Removing a tree.** A confirmation dialog explains that growth progress is lost. The sapling is not refunded unless the docs say otherwise.
   - **Offline.** Fruit accumulates correctly over several days away. When a day counts is set by the calendar, and the offline cap limits only simulated-time effects.
4. **Planting.** Buy saplings in the Shop (a Trees tab), then use placement mode to plant them on the orchard parcel's 2 × 2 tree spots, or anywhere the docs allow. Include a clear footprint preview.
5. **Recipes and bundles.** Add the fruit recipes from BALANCE.md: pies, jams made in the kitchen, and so on. Their tier is computed by the existing formula, so the tier test must pass. Add an **orchard bundle** or a town-project stage if the docs specify one. Milestone: "Harvest your first fruit".
6. **Art.** Tree sprites for each stage, using the docs' size (32 × 32 or 32 × 48). Fruit overlays in the tree's colours. Seasonal looks: blossom in spring, bare branches in winter for trees that don't bear then, and snow-dusted in winter. Fruit item icons. Everything culled to the viewport and allocation-free.
7. **UI.**
   - A tree tooltip shows its stage, days until mature, the seasons it bears in, and fruit hanging / cap.
   - Maturing is a slow event, so the away summary mentions trees that became mature and fruit that grew while you were away.
   - Show off-screen pips for trees with ripe fruit.
8. **Simulator.** Teach the brain to plant trees when the docs' pacing wants it and to harvest them. Add report rows for the first mature tree and orchard income per day, and rerun all checks.

## Save
`SAVE_VERSION` 10: trees with their planted day index and position, hanging fruit, and the calendar day-index state. Add a migration and a test, and `tests/fixtures/save-v10.json`.

## Tests (minimum)
- The day index: DST, time-zone change, clock set back, 30-day absence, and that it never decreases.
- Growth stages derived by age.
- Fruit only in season and up to the cap, with nothing lost when full.
- Several days offline, and one big step equal to many small ones.
- Harvesting by click, by the farmhand and through the Auto-Seller.
- Removal with confirmation.
- Tier derivation for the new recipes.
- The v9 → v10 migration.
- e2e: buy and plant a sapling, fast-forward real days with the debug calendar offset, see it mature and bear fruit in season, and harvest it.

## Out of scope
Animals (v2 phase 04), artisan machines (jam is a recipe), tree quality tiers, and grafting.

## Definition of done
- All checks pass, including CI e2e.
- Screenshots: the orchard in each season, and a tree tooltip.
- A "v2 Phase 03" entry in `docs/PROGRESS.md` with a table of every tree and its measured first-fruit time from the simulator.
- Open a PR titled `v2 Phase 03: Fruit trees & orchard`.
