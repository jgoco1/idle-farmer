# Progress Log

Each phase appends a section with **Built / Deviations / Known issues / Next-phase notes**. This file is how sessions hand work to each other; read the latest entry first.

---

## Phase 00: Game design doc and conventions

### Built
- `docs/GDD.md`: pitch, 5 pillars, core loop, time model (a real-time calendar with weekly seasons, plus short simulated-time timers), offline rules, screen layout with zone coordinates, one section per system, the food-buff design, the optional Fullness meter, the v1 out-of-scope list, and questions for the owner.
- `docs/BALANCE.md`: formulas for growth, crop pricing, market demand, specials, upgrade costs, automation throughput, fishing weights and minigame, recipe tier, dish price, buff magnitude/duration/stacking, XP and farm level, provisional farm level, offline cap. Tables for 15 crops, 16 fish (one legendary per season) + 3 junk, 22 recipes, 15 upgrades, 6 expansions, skill perks, 15 milestones, 9 goal templates, 6 bundles, and pacing targets.
- `docs/DATA_SCHEMAS.md`: id unions, content interfaces (`ItemDef`, `CropDef`, `FishDef`, `RecipeDef`, `BuffDef`, `UpgradeDef`, `ExpansionDef`, `QuestDef`, `BundleDef`, `SkillPerkDef`), `Modifiers`, the full v1 `GameState` with the phase that adds each field, `GameEvent`, `SaveFile` and the migration contract, and how systems use data and state.
- `docs/ART_STYLE.md`: a 47-colour palette with single-character sprite keys, sprite format and naming, animation frame counts, integer-scaling rules, UI look and font plan, and three worked 16 × 16 sprites (validated: every row is 16 characters and uses palette keys only).
- `CLAUDE.md`: standing rules. `docs/IDEAS.md`: empty backlog.

### Deviations
- **A seventh buff type, `fishingSpeed` (Quick Bite).** The phase-00 prompt lists it among the buff types; the phase-06 prompt's seam table has only six. Phase 06 should add `fishingSpeedModifier` (bite wait and trap interval).
- **22 recipes** (6/7/5/4 by tier) rather than exactly 20, so every buff type has at least two dishes and every tier has a fish option. **16 fish** rather than 12, so that each season has a legendary (owner request).
- **Upgrades:** 10 farm/tool upgrades (`sprinkler`, `sprinkler_tech`, `scarecrow`, `farmhand`, `seed_planter`, `auto_seller`, `watering_can`, `hoe`, `barn_storage`, `greenhouse`), plus `backpack` (phase 03), `fish_trap`/`fishing_rod`/`trap_collector` (05) and `kitchen` (06). Backpack adds slots; barn storage raises stack size, so the two storage upgrades in the prompts don't overlap.
- The phase-04 prompt pairs "Scarecrow / Fertilizer". The design uses a placeable scarecrow (growth in an area) and no separate fertilizer; the Farming skill perks cover yield.
- Systems are "pure" in the sense of **deterministic and free of I/O**: they may mutate the `state` they are given, which keeps offline simulation fast. Documented in DATA_SCHEMAS.md §7 and CLAUDE.md.

### Known issues
- All numbers are first drafts from formulas and a hand check of the first 10 minutes; nothing has been simulated yet. Phase 03 runs the first pacing simulation.
- Seed prices are unrounded formula outputs (39, 67, 71…); phase 03 may tidy them.
- Owner decisions are recorded in `docs/GDD.md` §11. After review the owner chose: 3 starting buff slots; a real-time calendar with weekly seasons; winter cooking bonuses; one legendary fish per season.
- The real-time calendar creates edge cases that phase 01 must test: DST days (23/25 h), the system clock being set back (the week index never decreases), time-zone travel, and a 30-day absence.

### Next-phase notes (for phase 01)
- Implement only the `@01` fields of `GameState` (`clock` with `simMs`, `calendar`, `rngState`, `gold`, `settings` with `masterVolume`, `meta`) and start `SAVE_VERSION` at **1** with an empty `migrations` record, plus a `tests/fixtures/save-v1.json`.
- **Two clocks** (GDD §4, BALANCE.md §1, DATA_SCHEMAS.md §1): `src/core/time.ts` builds a `Calendar` from an injected `now` and a `LocalClock` (the local time zone in the browser, a fixed zone in tests). Seasons are counted from `calendar.seasonEpoch` (the first local Sunday 00:00 at least 3 days after creation), so every save starts in spring. Timers use `clock.simMs`. The HUD format is `Spring · Tue 9:40 PM`.
- Offline: walk the real timeline from `savedAt` to `now` with `rate = 1` for the first 8 h, `0.25` up to 24 h and `0` after, splitting at daily (06:00 local) and weekly (Sunday 00:00 local) calendar events. No modal under 60 s. Test a DST day, a clock set back, and a 30-day absence.
- The debug time warp speeds up simulated time and also moves `calendar.debugOffsetMs`, so night and season changes can be playtested.
- Scene: 320 × 192 logical px (20 × 12 tiles), integer scale, zone rectangles as in GDD §5. Plot grid origin at tile (6,2), 4 × 2 at start, growing to 8 × 6. The day/night tint follows `ctx.calendar` (ART_STYLE.md §3).
- Palette: copy the 47 entries from ART_STYLE.md §1 into `src/render/palette.ts` with the `KEY_TO_NAME` map, and add a unit test that every sprite uses only known keys and has equal-length rows.
- Create `src/data/ids.ts` with all the id unions from DATA_SCHEMAS.md §2 even though most tables come later; it lets later phases type-check references immediately.
- `SimContext` (now including `calendar`), `Modifiers`/`NO_MODIFIERS`, `GameEvent` and `ActionResult` shapes are in DATA_SCHEMAS.md §5 and §7.
