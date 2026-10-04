# v2 Phase 06: Taller Fields, Seed Orders and Small Comforts

> **Recommended model:** Opus 5.5. It moves the field, the fence and the path, which decorations, sprinklers and saves all depend on. It adds an automation that spends gold on its own, which needs the simulator to stay green.
> **Depends on:** v2 phase 05 and v3 phase 00 merged (the platform layer is in; this phase needs nothing from v3-01 or v3-02).
> **Docs win:** where this prompt conflicts with `docs/`, follow `docs/` and note the difference in `docs/PROGRESS.md`. The owner decisions in GDD §11 still hold.

## Role and goal
Three things playtesting asked for:
1. **More plots, by growing the field taller.** Today the field stops at 8 × 6 (`farm_4`).
2. **A farmhand upgrade that buys seeds**, so an automated farm doesn't stall overnight when the bag runs out. The simulator found this was the main thing an idle player has to remember before leaving (IDEAS.md, "Seed restocking for idle farms").
3. **A few small comforts** from IDEAS.md.

## Read first
- `CLAUDE.md`: world and camera conventions (the home path and fence), the ranch and bots notes, platform conventions.
- The latest `docs/PROGRESS.md` entries, `docs/IDEAS.md`, and `docs/BALANCE.md` §5 (expansions), §6 (automation) and §13.
- **For the field:** `src/data/expansions.ts`, `src/render/scene.ts` (`PLOT_ORIGIN`, `plotRect`, `fenceRect`, `pathFor`, `SCENERY`, `buildZones`), `src/data/world.ts` (`DECOR_BLOCKED`), and `src/systems/expansions.ts` (`resizePlots`, `remapPlotIndex`).
- **For the seed orders:** `src/systems/automation.ts` (the farmhand and the planter, `lastPlantedCrop`), `src/systems/shippingBin.ts` (the hourly pickup), `src/systems/shop.ts` (`buySeeds`, seasons), and `src/ui/upgradesPanel.ts`.
- **The simulator:** `scripts/sim/brain.ts` (`stockSeeds`, `seedGold`, `starters`) and `report.ts`.

## Requirements

### A. Taller fields
1. **One or two new farm expansions** after `farm_4` (for example `farm_5` "The Long Rows", 8 × 7, and optionally `farm_6`, 8 × 8) that **add rows**, keeping 8 columns. The field may only grow **down**, keeping `PLOT_ORIGIN` (6, 2) and every existing plot index's meaning through `remapPlotIndex`.
   - **The fixed things around it don't move:** the farmhouse, the pond (cols 1–4, rows 7–10), the river (rows 10–11, cols 6–14, once River Access is bought), the market (15–17, 6–8) and the bin (18, 7).
   - So first work out on paper how many rows really fit with a fence ring and a route from the door to the bin, and pick that number. **If only one row fits, ship one expansion.** Explain the choice in the PR, with a sketch.
2. **The path and fence follow it** through `pathFor` and `fenceRect`:
   - corner posts and gates as today
   - a route from the farmhouse door to the bin that never runs under the fence or the field
   - the lane joining at (18, 9)

   Extend the "every size" tests in `tests/scene.test.ts` and `tests/decorRender.test.ts` to the new sizes.
3. **Decorations, buildings and scenery in the way:** the new rows claim tiles that are free today (row 9 west of col 13 is open grass, and players may have decorated it).
   - **Buying the expansion returns any decoration on the new field, fence or path tiles to the decoration stock,** with one toast saying how many went back. Nothing is lost.
   - Add every new tile to `DECOR_BLOCKED` at the largest size.
   - Move any `SCENERY` the new layout covers (the `farm_4` scarecrow post, the stepping stones) and say where.
4. **Prices and unlocks** follow BALANCE §5's curve (the next term of `farmPrice`), with a Farm Level or milestone gate that fits the pacing tables.
   - Check that the farmhand's route time and the planter's speed still cover the bigger field at their top levels (BALANCE §6). If they don't, raise their caps rather than leaving a field the farmhand can't keep up with.
   - Record the numbers in BALANCE.md.
5. **The greenhouse, sprinklers and scarecrows** keep working: placed objects are remapped with the plots (tests exist for `farm_1`–`farm_4`; add the new sizes).

### B. Seed Orders (a farmhand upgrade)
6. **A new upgrade, "Seed Order"** (`seed_order`), after the Seed Planter in the Automation section. At each **Shipping Bin pickup** it tops up the seeds the planter needs.
   - **Which seeds:** every crop the planter last planted somewhere (`lastPlantedCrop`) that is **in season and will finish before the season ends** (`finishesBeforeSeasonEnds`). Never buy an out-of-season seed, and never buy one the planter won't use.
   - **How many:** enough to bring the bag up to the level's target (for example 20, 50, 100 per crop at levels 1–3) at the normal Shop price, plus a small delivery fee (for example 10%) that makes it a gentle gold sink and a reason to stock up by hand.
   - **A gold floor:** a reserve the order never spends below. Set it in the Upgrades card (none, 10%, 25% or 50% of current gold), default 25%. It is a setting, not a cost.
   - **Space:** bag space is respected, all or nothing per crop (like a harvest).
   - **Per-crop opt-out:** a toggle list in the card, like the Auto-Seller's.
   - **Event and summary:** an event `seedsOrdered` (crop, qty, gold), and an away-summary line ("Seed Order bought 40 strawberry seeds for 2,288g").
7. **Offline-correct by construction:** it acts only at bin pickups, in simulated time, in a fixed crop order, with no RNG. Test that one big step equals many small ones over a day with the season changing in the middle, and that it spends nothing when the reserve would be crossed.
8. **Save:** the order's settings (reserve, opted-out crops) live in the save, so this is **`SAVE_VERSION` 14** with a migration (defaults: 25% reserve, nothing opted out; the upgrade itself is level 0), a fixture `tests/fixtures/save-v14.json` and a migration test. The upgrade level is in `upgrades` as usual.
9. **Simulator:**
   - Teach the brain to buy Seed Order when the farm is automated, and to drop its overnight `stockSeeds` once it owns the upgrade, so the report shows what the upgrade is worth.
   - Add a report row: idle-farm income on the night after buying it, compared with the same seed without it.
   - Every phase 09 and v2 check must still pass on 8 seeds, especially "no dominant strategy" (at most 1.5×) and the gold-sink curve.
   - Record before and after in BALANCE.md.

### C. Small comforts (each small, each tested)
10. **"Harvest all" and "Water all" buttons** next to the farm tools, for touch players without Shift-click (IDEAS.md). They do what Shift-click does today, through the same action.
11. **Cook ×N and favourites** in the Kitchen (IDEAS.md):
    - a stepper next to Cook (up to the free stove slots)
    - a ☆ pin that keeps a recipe at the top of the book in any sort order (`prefs.kitchenSort` stays; favourites are a per-device pref list)
12. **A Farm Level chip in the HUD** (IDEAS.md): "Lv 4" next to the gold, opening the Goals panel, so the shop's "Reach Farm Level N" hints are always in sight.

## Out of scope
- New crops, fish, recipes or animals: use `templates/add-content.md`.
- A second field on another parcel.
- Rain or weather.
- Compost or fertilizer.
- A dog.

If you have ideas, add them to IDEAS.md.

## Save
`SAVE_VERSION` 14, for the Seed Order settings only. New expansions and a bigger grid need no shape change (the grid is derived from expansions), but test that a v13 save with `farm_4` and decorations on row 9 loads, and that buying the new expansion afterwards returns those decorations to the stock.

## Tests (minimum)
- Layout: the fence ring and gates at every size, the path from the door to the bin, and every path tile blocked for decorations.
- Decorations returned to the stock on purchase, with nothing lost.
- Plot and placed-object remapping into the new sizes.
- Seed Order:
  - only in-season, finishing crops the planter uses
  - targets per level
  - the fee
  - the reserve
  - bag space all or nothing
  - opt-outs
  - offline equivalence across a season change
  - the away-summary line
- The v13 → v14 migration.
- Harvest all, Water all, Cook ×N, favourites and the HUD chip: unit tests where pure, plus e2e.
- e2e: buy the new expansion on a farm with a decoration on row 9 (it returns to the stock), then buy Seed Order, set the reserve, and advance an hour: seeds are bought and the gold floor holds.
- Performance: per-frame allocation and the 8 h catch-up stay within budget with the bigger field.

## Definition of done
- `npm run typecheck && npm run lint && npm test && npm run build && npm run build:app && npm run test:e2e` pass. Both CI jobs are green.
- `npm run simulate`: every check passes on 8 seeds. BALANCE.md has a "v2-06 balance report" with the expansion prices, Seed Order's levels, fee and value, and before and after tables.
- Screenshots (`UPDATE_SCREENSHOTS=1`):
  - the tallest field with its fence and path
  - the Seed Order card
  - the Kitchen with a favourite and Cook ×N
  - the HUD chip
- A "v2 Phase 06" entry in `docs/PROGRESS.md`. Mark the IDEAS.md entries this phase resolves.
- Open a PR titled `v2 Phase 06: Taller fields & seed orders`.
