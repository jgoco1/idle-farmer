# v2 Phase 05: Balance and Polish Pass

> **Recommended model:** Opus 5.5. Most of the work is cross-system balance that has to keep every simulator check green at once, plus two input changes (tap-to-inspect and paint mode) that interact with the camera's "a drag is a pan" rule.
> **Depends on:** v2 phase 04 merged (v2 complete).
> **Docs win:** where this prompt conflicts with `docs/`, follow `docs/` and note the difference in `docs/PROGRESS.md`. The owner decisions in GDD §11 (v1 and v2) still hold, except where this prompt explicitly asks for a number change.

## Role and goal
All four v2 features are in, but the v2 simulator runs left a few balance misses, and playtesting with a phone shows some rough edges. This phase is a **focused cleanup**. Every item below comes from a v2 phase's "Known issues" or from `docs/IDEAS.md`. **Don't add new content or systems beyond what's listed.**

## Read first
- `CLAUDE.md`
- The v2 entries of `docs/PROGRESS.md`, especially the Known issues
- `docs/BALANCE.md` §13, including the v2-02 to v2-04 tuning notes and the "v2 balance report"
- `docs/IDEAS.md`, the entries this prompt names
- `scripts/sim/` (`brain.ts`, `report.ts`, `catalogue.ts`)

Run `npm run simulate` (8 seeds, 30 days) **before changing anything** and keep the report as your "before" table.

## Requirements

### A. Balance (verify everything with the simulator; record before and after in BALANCE.md)
1. **Food buffs back in band.** Keeping buffs up currently measures about +28% against the 10–25% target (phase 09, v2-03, v2-04). Bring it to about +18–22% at day 7, paired by seed against the "Chef who sells" control. Do this with the buff constants in `src/data/balance.ts` (base duration, growth and magnitude scales), not by changing recipes. Keep the phase 06 rules: the formula is driven by tier, the stacking rules stay, and there are 3 base slots.
2. **An orchard worth planting.** Orchard income is about 1% of gold against the 5–15% the design expected. Raise **fruit value** (fruit base prices, and sapling prices through the existing `saplingPrice` formula) and/or **fruit per bearing day**, so that a full orchard of 8 trees earns about **5–8%** of a player's daily gold by day 14. **Don't change days to mature or seasons:** those are owner decisions. Check that fruit recipes still compute the same tiers, or update the tier tests deliberately, and that town-project fruit stages still make sense.
3. **Earlier first milk.** First milk is day 9 for the Greedy Farmer and day 16 for the Active Player, against targets of 4–7 and 5–9. Fix this through a combination of brain priorities (`RANCH_PLAN`, the order in `spendV2`) and, only if needed, the barn's or Old Paddock's price. A real player shouldn't need to wait two weeks for a cow. Also fix the Active Player's day-14 "still to spend" check (86% against an 85% limit).
4. **Busy Bees that matters late** (IDEAS.md). Once the farmhand is Level 3+, `automationSpeed` is worth almost nothing. Let the buff **also shorten animal production cycles** through a new `ctx.mods` seam read in `tickRanch`'s interval. The cycle stays a whole number of ms, and offline equivalence must still hold. **No other new seams.**
5. After 1–4, **every** phase 09 and v2 check must pass on 8 seeds: no dominant strategy (at most 1.5×), buffs +10–25%, no early dead time, no runaway growth, gold still to spend through day 30, and the orchard and animal checks. Tune `TOWN_PROJECT_SCALE` if the gold-sink curve moves.

### B. Phone and input polish
6. **Tap to inspect on touch.** On a touch screen, the **first tap** on a tree or an animal shows its label and the **second tap** acts (picks or pets). On desktop, hovering keeps working as now. Add the **animal label** too, on hover and on first tap: name, building, and for its building the trough, store and next product time. Labels are DOM, appear near the target through the camera helpers, and hide on pan.
7. **Optional drag-to-farm ("Paint" toggle).**
   - Add a toggle next to the farm tools. While it's on, a one-finger or mouse drag over plots applies the selected tool along the stroke, as v1 did, instead of panning.
   - Two-finger drag still pans, and the arrow keys and Home still work.
   - On desktop, **Alt-drag** paints even with the toggle off.
   - Off by default. Persist it in **prefs**, not the save.
   - The "a drag never runs a tool" rule applies when Paint is off.
   - Update CLAUDE.md's world and camera conventions accordingly.
8. **A feed store instead of bag clutter.**
   - Hay and corn feed no longer take bag slots. They live in a **feed store** that belongs to the ranch, shown in the Ranch panel.
   - Making, buying, the silo's milling and filling troughs all use it.
   - Wheat and corn as crops still live in the bag.
   - Give the store a capacity; when it's full, making or buying feed says so politely. Nothing is ever lost.
   - **Save change:** `SAVE_VERSION` 13 (12 is the farm cats, from the polish pass after v2-04). The migration moves existing hay and corn feed from the bag into the store, up to its capacity, leaving any remainder in the bag so nothing is lost. Add a fixture and a migration test.
9. **Start the phone view on the field** (IDEAS.md). On a narrow phone, the default view centres on the plot grid rather than the home region's centre. Home goes to the same place.

### C. Test hygiene
10. **Screenshots are opt-in.** e2e specs from many phases rewrite `docs/screenshots/*.png` on every run, so every session has to `git checkout docs/screenshots`. Make writing into `docs/screenshots/` happen only with `UPDATE_SCREENSHOTS=1`; otherwise write to `test-results/`. Update CLAUDE.md's e2e note.

## Out of scope
New crops, fish, recipes, trees, animals, decorations or projects. New buff types. The Fullness meter (phase 10, on hold). Casino or chance mechanics. Changing tree maturity days or seasons.

## Save
`SAVE_VERSION` 13, for the feed store only (requirement 8). Save 12 already exists (the farm cats); start from `tests/fixtures/save-v12.json`. Paint mode and the camera live in prefs.

## Tests (minimum)
- Buff numbers at each tier after tuning.
- The fruit price and yield table against the new formula, and recipe tiers still matching.
- The Busy Bees seam shortening animal cycles, with offline equivalence.
- The feed store: making, buying, the silo, troughs, capacity, nothing lost, and the v12 → v13 migration.
- Tap-to-inspect: the first tap shows the label and the second acts; on desktop, hovering shows it.
- Paint mode: a drag with the toggle on tills along the stroke, with it off it pans, Alt-drag paints, and two fingers pan in paint mode.
- The phone default view.
- e2e for tap-to-inspect and paint mode on a 390 × 844 touch viewport.
- Performance: per-frame allocation stays under 11 KB (currently about 4.4 KB) and the 8 h catch-up stays under 100 ms.

## Definition of done
- `npm run typecheck && npm run lint && npm test && npm run build && npm run test:e2e` pass. Both CI jobs are green.
- `docs/BALANCE.md` has a **"v2-05 balance report"** with before and after tables for every check, and the new constants.
- Screenshots (generated with `UPDATE_SCREENSHOTS=1`): an animal label, a tree label on a phone, paint mode in action, and the Ranch panel's feed store.
- A "v2 Phase 05" entry in `docs/PROGRESS.md`. Mark the IDEAS.md entries this phase resolves.
- Open a PR titled `v2 Phase 05: Balance & polish`.
