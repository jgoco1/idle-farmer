# v2 Phase 02: Decoration Shop, Charm and Town Projects

> **Recommended model:** Sonnet 5.5. It reuses the placement, shop and bundle patterns that already exist. Most of the effort goes into pixel art and pricing, and the prices come from the design docs. Rerun on Opus if the gold-sink check in the simulator fails and needs rebalancing.
> **Depends on:** v2 phase 01 merged (the bigger world, parcels and camera).
> **Docs win:** where this prompt conflicts with `docs/`, follow `docs/` and note the difference in `docs/PROGRESS.md`.

## Role and goal
The phase 09 simulator found that **by about day 7 a keen player has nothing left to buy with gold**. This phase fixes that with things that are fun to spend on:
- a **decoration shop** of cosmetic pieces you place anywhere on your land
- a **charm** score that unlocks more pieces
- large **town projects** on the Community Board that visibly change the world

Decorations are **cosmetic**. They give no income bonus: that is an owner decision.

## Read first
`CLAUDE.md`, the v2 sections of `docs/GDD.md`, `docs/BALANCE.md` (decoration price bands, town project costs, the gold-still-to-spend target), `docs/DATA_SCHEMAS.md` and `docs/ART_STYLE.md`, and the "v2 Phase 01" next-phase notes in `docs/PROGRESS.md`. Reuse `src/systems/placement.ts`, `src/ui/placement.ts`, `src/systems/bundles.ts`, the Shop panel, `src/ui/purchaseGuard.ts` and the goal and milestone tables.

## Requirements
1. **Decoration data (`src/data/decor.ts`).** Add the decoration sets from the docs, 2 or 3 sets of 8 to 12 pieces each. Every piece has an id, a set, a size (1 × 1, 2 × 1, 2 × 2 and so on), a price, a charm value and any unlock condition. Pieces include paths (auto-tiled so neighbouring path tiles join up), fences (auto-tiled), flower beds, lamps that glow at night (a warm light drawn after the night tint, like the fireflies), benches, signs and seasonal items. Farmhouse **paint colours, roof styles and an extension** are special items that swap the farmhouse sprite rather than being placed.
2. **Decoration shop.** A **Decor** tab in the Shop panel, or its own panel if the docs say so. It lists the sets with previews, prices, owned counts and locked pieces with hints. You can buy several of a piece and place them later from an inventory of decorations; decorations do not go in the item bag.
3. **Placement.**
   - Placement mode works for decorations: a grid snap, a valid/invalid preview, rotate or flip where the sprite supports it, and move or pick up (a picked-up piece returns to your decoration inventory).
   - Decorations can't be placed on plots, water, buildings, trap spots or locked parcels.
   - Add a **"Decorate" mode toggle**, so that clicks place and move decorations instead of using farm tools.
   - Paths and fences recalculate their joined sprites when a neighbour changes.
4. **Charm (`src/systems/charm.ts`).** A score derived from the placed decorations and completed town projects, computed rather than stored. Show it in the Goals panel. Charm thresholds unlock more pieces, one or two new milestones, and a charm goal template. It must not affect prices, growth or any `Modifiers` field; add a test that checks this.
5. **Town projects.**
   - Add the 5 or 6 projects from the docs to the Community Board, as a new "Town" tab. Each has several stages of gold and item donations.
   - Completing a stage visibly changes the world: a repaired bridge, a rebuilt bakery, a lighthouse, a bandstand, and so on.
   - Rewards are quality of life only, as listed in the docs: extra decoration slots, a new decoration set, a longer bin pickup window, and so on. There are **no income multipliers**.
   - Donating reuses `donate` or a sibling action, and the purchase guard applies.
6. **Art.** Every piece and project stage needs sprites in `src/render/sprites/` using palette keys only. Use a consistent style within each set, and include night variants for lamps. Keep drawing allocation-free and culled to the viewport.
7. **Simulator.**
   - Teach `scripts/sim/brain.ts` to spend on decorations and projects in the way the docs describe. For example: after the core upgrades, spend part of each session's gold on decoration and projects.
   - Add a report check for **gold still to spend** against the docs' target curve up to day 30.
   - Confirm the phase 09 checks still pass: no dominant strategy, buffs +10–25%, no early dead time, and no runaway growth.

## Save
`SAVE_VERSION` 9: placed decorations, owned but unplaced decorations, farmhouse style, and project progress. Add a migration and a test, and `tests/fixtures/save-v9.json`.

## Tests (minimum)
- Buying and owning decorations.
- Placement validity, including footprints, blocked tiles and locked parcels.
- Path and fence auto-tiling.
- Picking up and moving.
- Charm computation, plus the test that charm touches no modifier.
- Unlock thresholds.
- Project stages and rewards.
- The farmhouse style swap.
- The v8 → v9 migration.
- The simulator's gold-sink check.
- e2e: buy a lamp and a path, place and move them in Decorate mode, check the lamp glows at night (debug time-warp), and donate a town project stage and see the world change.

## Out of scope
Trees (v2 phase 03) and animals (04). Casino and games of chance. Income bonuses from decorations.

## Definition of done
- All checks pass, including CI e2e.
- Screenshots: a decorated farm by day and by night, the Decor shop, and a completed town project.
- A "v2 Phase 02" entry in `docs/PROGRESS.md` that includes the simulator's gold-still-to-spend table.
- `docs/BALANCE.md` is updated if any numbers moved.
- Open a PR titled `v2 Phase 02: Decorations, charm & town projects`.
