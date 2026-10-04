# v4 Phase 04: The North Woods, the Mountain Lake, and Balance

> **Recommended model:** Opus 5.5. It adds two smaller features, then does the cross-system balance pass that closes v4, with every simulator check green at once.
> **Depends on:** v4 phase 03 merged.
> **Docs win:** follow `docs/GDD.md` §13, `BALANCE.md` §14, `DATA_SCHEMAS.md` §10 and `ART_STYLE.md` §7. Note any difference in `docs/PROGRESS.md`.

## Role and goal
Finish the north with the content the design picked for this phase. Recommended: **foraging in the North Woods** and a **mountain lake** for fishing. Then run the v4 balance and polish pass over everything v4 added.

## Read first
- `CLAUDE.md`, the v4 docs, and every v4 entry in `docs/PROGRESS.md` (especially their Known issues).
- `src/systems/orchard.ts` (calendar-day growth: the model for forage spots), `src/systems/fishing.ts` and `src/data/fish.ts` (locations), `scripts/sim/`.

## Requirements
1. **Foraging** (if the design keeps it):
   - Spots in the North Woods regrow wild items on **calendar days** (`ctx.calendar.dayIndex`, like trees), by season, up to a cap. They're picked by hand, with a pip when ripe.
   - Forage items are sellable and usable in recipes and drinks.
   - An automation upgrade only if the owner said yes in GDD §13.
2. **The mountain lake** (if the design keeps it):
   - a fourth fishing location, unlocked as designed, with its own fish (5–8), its own minigame tuning and its own collection entries
   - traps there if the design allows
   - offline and Relaxed fishing behave as at the other waters
3. **Balance pass:** with every v4 feature in, run `npm run simulate` over 8 seeds and 30 days (and 60 days if BALANCE §14 sets 60-day targets). Bring every check into its band using the levers BALANCE §14 names, and record before and after in a "v4 balance report". Pay particular attention to:
   - the restaurant's share of income
   - drinks against dishes
   - the north fields' payback time
   - "gold still to spend" over the longer run
4. **Polish:**
   - fix the Known issues of v4-01 to v4-03 that are small
   - make sure every new toast that names a place goes through `toastAt`, and every new "come here" has a pip
   - check the north on a 390 × 844 phone and at 1.5× interface size
5. **Save:** the `SAVE_VERSION` from DATA_SCHEMAS §10 if foraging or the lake adds state, with a migration, a fixture and a test.

## Tests (minimum)
- Forage regrowth by calendar day and season, the cap, and a long absence giving the same as daily visits.
- The lake's fish table by season and its unlock.
- The migration.
- e2e: forage a spot, and catch a fish at the lake.
- Performance budgets with the whole north in use.

## Out of scope
New animals, a second restaurant, weather, multiplayer, and anything the owner hasn't approved in GDD §13.

## Definition of done
- The quality bar passes, and both CI jobs are green.
- BALANCE.md has the "v4 balance report" with every check passing.
- Screenshots: the woods in two seasons, the lake, and the whole north from a zoomed-out view.
- A "v4 Phase 04" entry in `docs/PROGRESS.md`; mark the IDEAS.md entries v4 resolved.
- Open a PR titled `v4 Phase 04: Woods, lake & balance`.
