# v4 Phase 03: Drinks and the Apiary

> **Recommended model:** Sonnet 5.5, then an Opus review using `prompts/templates/phase-review.md` before merging. It is content and a timer-based station on established patterns (the kitchen, the ranch, the restaurant's menu). The review checks the balance and the offline equivalence.
> **Depends on:** v4 phase 02 merged.
> **Docs win:** follow `docs/GDD.md` §13 (including the owner's answer about alcohol), `BALANCE.md` §14 and `DATA_SCHEMAS.md` §10. Note any difference in `docs/PROGRESS.md`.

## Role and goal
Add the drinks building (named as the design and the owner decided) with its slow presses or casks and a family of drink recipes. Add the **apiary**, whose honey feeds drinks and dishes. Drinks go on the restaurant's menu, sell at the Market, and give the buff the design chose.

## Read first
- `CLAUDE.md`, the v4 docs, the v4-02 entry in `docs/PROGRESS.md`.
- `src/systems/cooking.ts` (recipes, tiers, stove slots, `msToNextSimEvent`), `src/data/recipes.ts`, `src/systems/buffs.ts`, `src/systems/ranch.ts` (timed producers, gentleness), `src/systems/restaurant.ts`.

## Requirements
1. **Drink recipes** (`src/data/drinks.ts`, or the `kind: 'drink'` the design specifies): the 8–12 recipes from BALANCE §14. Tiers come from the existing formula (`tests/cooking.test.ts`'s tier test must cover them), and the buff rule is the one the design picked (existing buff types, or a separate drink slot).
2. **The station** (a building on its northern site, bought and upgraded per BALANCE §14):
   - its own slots and long timers
   - start, take off (ingredients back) and collect, with the same rules as the stove
   - offline-correct, with timers reported through `msToNextSimEvent` where a rate changes
   - a panel (or a tab of the Kitchen, as designed) with the same sort menu as the recipe book (`prefs.kitchenSort` rules)
3. **The apiary:** beehives bought and placed on the northern site the design gives. Honey is made on a simulated-time timer in whole cycles, with a store cap where production waits; nothing is lost.
   - Hives don't read decorations (they are cosmetic).
   - Honey is an item with a Market price and recipe uses.
   - Bees are render-only life, if any.
4. **Integration:**
   - drinks on the restaurant's menu
   - drinks and honey in bundles or town stages, as designed
   - Auto-Seller toggles, defaulting off for drinks and honey
   - away-summary lines
   - milestones from the design
5. **The simulator:** the brain makes drinks, keeps hives, and stocks the menu with drinks. Every check passes on 8 seeds.
6. **Save:** the `SAVE_VERSION` from DATA_SCHEMAS §10, with a migration, a fixture and a test.

## Tests (minimum)
- Drink tiers and buffs (the slot rule if there is one).
- The station's timers, take-off and collect.
- Honey cycles and the store cap, nothing lost.
- Offline equivalence for the station and the hives.
- Drinks served at the restaurant.
- The migration.
- e2e: build the station and a hive, make a drink from honey and fruit, put it on the menu, and see it served.
- Performance budgets.

## Out of scope
The North Woods and the mountain lake (v4-04), new animals, and anything alcoholic unless the owner's answer in GDD §13 says otherwise.

## Definition of done
- The quality bar passes, and both CI jobs are green.
- `npm run simulate` passes on 8 seeds, with the drink and honey rows in BALANCE.md.
- Screenshots: the station, the hives, and a drink on the menu.
- A "v4 Phase 03" entry in `docs/PROGRESS.md`.
- Open a PR titled `v4 Phase 03: Drinks & the apiary`.
- The owner runs an Opus review with `prompts/templates/phase-review.md` before merging.
