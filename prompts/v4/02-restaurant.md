# v4 Phase 02: The Restaurant

> **Recommended model:** Opus 5.5. It is a new income path for dishes, and the simulator has to prove it doesn't make one strategy dominant or break the buffs balance.
> **Depends on:** v4 phase 01 merged.
> **Docs win:** follow `docs/GDD.md` §13, `BALANCE.md` §14 and `DATA_SCHEMAS.md` §10. Note any difference in `docs/PROGRESS.md`.

## Role and goal
Build the restaurant on its northern site: a place that buys the player's cooked dishes (and later drinks) at a better return than the Market, served to guests on a steady, predictable schedule. It gives cooking a purpose beyond buffs and a reason to keep the kitchen busy while away.

## Read first
- `CLAUDE.md` (the ranch conventions are the model: whole cycles, gentleness, render-only life), the v4 docs.
- `src/systems/ranch.ts` (building levels, whole-cycle timers, collection, `msToNext…` reporting), `src/systems/market.ts`, `src/systems/autoSeller.ts`, `src/systems/cooking.ts`.
- `src/ui/ranchPanel.ts`, `src/ui/buildMode.ts`, `scripts/sim/brain.ts`.

## Requirements
1. **Data** (`src/data/restaurant.ts`): its levels from BALANCE §14 (price, tables or menu slots, premium, serving interval), the unlock, and its sprite ids.
2. **The system** (`src/systems/restaurant.ts`, a tick in `tickSystems` placed as the design says):
   - **Menu slots** hold stacks moved from the bag (dishes, and drinks once v4-03 exists).
   - Each slot **serves one item per interval** in simulated time, in **whole cycles**: `floor((cycleMs + dt) / interval)`. One big step equals many small ones.
   - **Each serving earns** base price × the level premium, capped as designed. Market demand isn't touched. The gold goes straight to the purse with an event.
   - **Gentle:** an empty slot does nothing, a dish waits on the menu forever, and nothing spoils.
   - **Determinism:** no RNG. If the design has a daily special, it comes from the calendar's day index, not chance.
   - Report the next serving through `msToNextSimEvent` only if a rate changes mid-step. Otherwise whole cycles are enough, as for the ranch.
3. **Actions:**
   - `buildRestaurant` and `upgradeRestaurant`
   - `stockMenu(slot, item, qty)` and `clearMenuSlot(slot)` (the items go back to the bag; refused politely if the bag is full)
   - plus whatever the design adds
4. **UI:**
   - A **Restaurant panel** (`wide: true`): the menu slots with what's on them and the next serving time, "Fill from bag" with amounts, today's takings and the level.
   - Clicking the building opens it.
   - Toasts and an away-summary line ("The restaurant served 46 dishes for 12,880g").
   - A Restaurant section in Upgrades if the design puts levels there.
5. **Art and life:**
   - the building at three levels, with lit windows at night and steam from the kitchen
   - guests that come and go, **render only**, with a private generator and typed arrays, as `ranchLife.ts` does
   - everything culled to the view and allocation-free
6. **Balance** (the core of this phase):
   - Teach the brain to build and stock the restaurant.
   - Retune per BALANCE §14 so every check passes on 8 seeds: no dominant strategy (at most 1.5×), gold still to spend, and no runaway growth.
   - **The buffs check:** decide with the simulator whether it still compares buffs against "a Chef who sells" (now through the restaurant), or gets a new baseline. Record the decision and the before and after numbers.
7. **Save:** the `SAVE_VERSION` from DATA_SCHEMAS §10, with a migration, a fixture and a test.

## Tests (minimum)
- Serving cycles, the premium and the cap.
- Demand untouched.
- An empty or full menu changes nothing.
- Stocking and clearing slots, all or nothing.
- Offline equivalence: one big step against many, across a level upgrade.
- Render-only guests leave the state and `rngState` untouched.
- The migration.
- e2e: build the restaurant, put dishes on the menu, advance an hour, and see the gold and the away summary.
- Performance budgets.

## Out of scope
Drinks (v4-03; leave the menu ready for them), staff or wages, reviews or ratings, and random events.

## Definition of done
- The quality bar passes, and both CI jobs are green.
- `npm run simulate` passes on 8 seeds, with a "v4-02 balance report" in BALANCE.md.
- Screenshots: the restaurant by day and by night, and its panel.
- A "v4 Phase 02" entry in `docs/PROGRESS.md`, and a "Restaurant conventions" section in CLAUDE.md.
- Open a PR titled `v4 Phase 02: The restaurant`.
