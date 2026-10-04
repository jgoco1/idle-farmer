# v2 Phase 06: Seed Orders and Small Comforts

> **Recommended model:** Sonnet 5.5. It is one new upgrade on the existing automation pattern plus three small UI features. The only delicate part is an automation that spends gold on its own, and the simulator checks it. Use Opus 5.5 if the simulator checks will not settle.
> **Depends on:** v2 phase 05 and v3 phase 00 merged (the platform layer is in; this phase needs nothing from v3-01 or v3-02).
> **Docs win:** where this prompt conflicts with `docs/`, follow `docs/` and note the difference in `docs/PROGRESS.md`. The owner decisions in GDD §11 still hold.

## Role and goal
Two things playtesting asked for:
1. **A farmhand upgrade that buys seeds**, so an automated farm doesn't stall overnight when the bag runs out. The simulator found this was the main thing an idle player has to remember before leaving (IDEAS.md, "Seed restocking for idle farms").
2. **A few small comforts** from IDEAS.md.

(More fields come from new land to the north in the v4 series, not from a taller home field.)

## Read first
- `CLAUDE.md`: the ranch and bots notes, platform conventions.
- The latest `docs/PROGRESS.md` entries, `docs/IDEAS.md`, and `docs/BALANCE.md` §6 (automation) and §13.
- **For the seed orders:** `src/systems/automation.ts` (the farmhand and the planter, `lastPlantedCrop`), `src/systems/shippingBin.ts` (the hourly pickup), `src/systems/shop.ts` (`buySeeds`, seasons), and `src/ui/upgradesPanel.ts`.
- **The simulator:** `scripts/sim/brain.ts` (`stockSeeds`, `seedGold`, `starters`) and `report.ts`.

## Requirements

### A. Seed Orders (a farmhand upgrade)
1. **A new upgrade, "Seed Order"** (`seed_order`), after the Seed Planter in the Automation section. At each **Shipping Bin pickup** it tops up the seeds the planter needs.
   - **Which seeds:** every crop the planter last planted somewhere (`lastPlantedCrop`) that is **in season and will finish before the season ends** (`finishesBeforeSeasonEnds`). Never buy an out-of-season seed, and never buy one the planter won't use.
   - **How many:** enough to bring the bag up to the level's target (for example 20, 50, 100 per crop at levels 1–3) at the normal Shop price, plus a small delivery fee (for example 10%) that makes it a gentle gold sink and a reason to stock up by hand.
   - **A gold floor:** a reserve the order never spends below. Set it in the Upgrades card (none, 10%, 25% or 50% of current gold), default 25%. It is a setting, not a cost.
   - **Space:** bag space is respected, all or nothing per crop (like a harvest).
   - **Per-crop opt-out:** a toggle list in the card, like the Auto-Seller's.
   - **Event and summary:** an event `seedsOrdered` (crop, qty, gold), and an away-summary line ("Seed Order bought 40 strawberry seeds for 2,288g").
2. **Offline-correct by construction:** it acts only at bin pickups, in simulated time, in a fixed crop order, with no RNG. Test that one big step equals many small ones over a day with the season changing in the middle, and that it spends nothing when the reserve would be crossed.
3. **Save:** the order's settings (reserve, opted-out crops) live in the save, so this is **`SAVE_VERSION` 14** with a migration (defaults: 25% reserve, nothing opted out; the upgrade itself is level 0), a fixture `tests/fixtures/save-v14.json` and a migration test. The upgrade level is in `upgrades` as usual.
4. **Simulator:**
   - Teach the brain to buy Seed Order when the farm is automated, and to drop its overnight `stockSeeds` once it owns the upgrade, so the report shows what the upgrade is worth.
   - Add a report row: idle-farm income on the night after buying it, compared with the same seed without it.
   - Every phase 09 and v2 check must still pass on 8 seeds, especially "no dominant strategy" (at most 1.5×) and the gold-sink curve.
   - Record before and after in BALANCE.md.

### B. Small comforts (each small, each tested)
5. **"Harvest all" and "Water all" buttons** next to the farm tools, for touch players without Shift-click (IDEAS.md). They do what Shift-click does today, through the same action.
6. **Cook ×N and favourites** in the Kitchen (IDEAS.md):
    - a stepper next to Cook (up to the free stove slots)
    - a ☆ pin that keeps a recipe at the top of the book in any sort order (`prefs.kitchenSort` stays; favourites are a per-device pref list)
7. **A Farm Level chip in the HUD** (IDEAS.md): "Lv 4" next to the gold, opening the Goals panel, so the shop's "Reach Farm Level N" hints are always in sight.

## Out of scope
- New crops, fish, recipes or animals: use `templates/add-content.md`.
- New land, fields or buildings (the v4 series, to the north).
- Rain or weather.
- Compost or fertilizer.
- A dog.

If you have ideas, add them to IDEAS.md.

## Save
`SAVE_VERSION` 14, for the Seed Order settings only. The upgrade level lives in `upgrades` as usual.

## Tests (minimum)
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
- e2e: buy Seed Order, set the reserve, and advance an hour: seeds are bought and the gold floor holds.
- Performance: the 8 h catch-up stays within budget with Seed Order at its top level.

## Definition of done
- `npm run typecheck && npm run lint && npm test && npm run build && npm run build:app && npm run test:e2e` pass. Both CI jobs are green.
- `npm run simulate`: every check passes on 8 seeds. BALANCE.md has a "v2-06 balance report" with Seed Order's levels, fee and value, and before and after tables.
- Screenshots (`UPDATE_SCREENSHOTS=1`):
  - the Seed Order card
  - the Kitchen with a favourite and Cook ×N
  - the HUD chip
- A "v2 Phase 06" entry in `docs/PROGRESS.md`. Mark the IDEAS.md entries this phase resolves.
- Open a PR titled `v2 Phase 06: Seed orders & small comforts`.
