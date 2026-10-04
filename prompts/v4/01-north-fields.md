# v4 Phase 01: The North and Its Fields

> **Recommended model:** Opus 5.5. It changes the world's shape under every system that stores a position, and adds fields that the farmhand, the planter, sprinklers and saves must all understand.
> **Depends on:** v4 phase 00 merged, with the owner's answers to its open questions recorded in GDD §13.
> **Docs win:** follow `docs/GDD.md` §13, `BALANCE.md` §14, `DATA_SCHEMAS.md` §10 and `ART_STYLE.md` §7. Note any difference in `docs/PROGRESS.md`.

## Role and goal
Grow the world north as v4-00 designed it, and add the north field parcels with their own plot grids. No saved position may move. When this phase is done, a player can scroll north, buy a field and farm it, by hand and with every automation.

## Read first
- `CLAUDE.md`, the v4 sections of the docs above, and the v4-00 audit in its PR.
- `src/data/world.ts`, `src/data/parcels.ts`, `src/render/scene.ts`, `src/render/camera.ts`, `src/render/renderer.ts`, `src/systems/farming.ts`, `src/systems/automation.ts`, `src/systems/placement.ts`, `src/core/save.ts` (tile validation), `e2e/helpers.ts`.

## Requirements
1. **The world grows north** as designed (recommended: negative rows down to `WORLD_TOP`).
   - Fix every place the audit listed.
   - Update the camera's clamp and default view, Home, the edge pips, the minimap (if one exists) and `e2e/helpers.ts`.
   - Replace CLAUDE.md's "the world only grows right and down" with the new rule, written so a later phase cannot break it.
2. **No saved position moves.** Decorations, buildings, trees, traps, placed objects and the camera pref keep their meaning: a v-current save loads with everything where it was. Test it with the latest fixture: every stored tile hit-tests to the same thing as before.
3. **The north band's scenery:** ground, tree lines, lanes, the north road, locked parcels overgrown with "For sale" signs (as v2-01 did), and sites for later phases' buildings, shown as empty lots. All of it goes in `WORLD_LAYOUT` and `SCENERY` as data.
4. **The north fields:** the parcels, prices and unlocks from BALANCE §14. Each field has:
   - its own plot grid, indexed beside the home field and the greenhouse as designed
   - a fence, gates and a path through `fenceRect` / `pathFor`, or their generalisation for several fields
   - all of their tiles in `DECOR_BLOCKED`

   Buying one works like the v2 parcels.
5. **Everything that farms covers every field:**
   - Hoe, Seeds, Can and Hand, Shift-click per field, and Harvest all / Water all (v2-06)
   - the farmhand and its route, and the planter's `lastPlantedCrop`
   - Seed Order
   - sprinklers and scarecrows placed on north plots
   - the Auto-Seller
   - offline catch-up

   Offline equivalence still holds: one big step equals many small ones, with a north field in use.
6. **Save:** the `SAVE_VERSION` from DATA_SCHEMAS §10 for owning north parcels and their plots, with a migration, a fixture and a migration test.
7. **The simulator:** the brain buys the north fields when BALANCE §14 says, and the report shows their share of income. Every existing check passes on 8 seeds.

## Tests (minimum)
- **Coordinates:**
  - `tileAt`, `regionAt` and decoration and building placement on negative rows
  - chunk drawing above row 0
  - the camera clamp
  - an old save hit-testing exactly as before
- **Every field size:**
  - the fence ring and gates
  - paths blocked for decorations
  - plot index mapping both ways
- **Automation across fields:**
  - the farmhand route
  - the planter
  - sprinklers on north plots
  - offline equivalence
- **e2e:** scroll north, buy a field from its sign, till, plant and harvest a north plot, and watch the farmhand reach it.
- **Performance:** per-frame allocation and the 8 h catch-up stay within budget with every field automated.

## Out of scope
The restaurant (v4-02), drinks and the apiary (v4-03), the woods and the lake (v4-04).

## Definition of done
- The quality bar passes, including `build:app`, and both CI jobs are green.
- Screenshots (`UPDATE_SCREENSHOTS=1`): the north by day with a field farmed, the north at night, and a phone scrolled north.
- A "v4 Phase 01" entry in `docs/PROGRESS.md`, and CLAUDE.md's world conventions updated.
- Open a PR titled `v4 Phase 01: The North & its fields`.
