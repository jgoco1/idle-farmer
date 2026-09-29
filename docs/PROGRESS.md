# Progress Log

Each phase appends a section with **Built / Deviations / Known issues / Next-phase notes**. This file is how sessions hand work to each other; read the latest entry first.

---

## Phase 00: Game design doc and conventions

### Built
- `docs/GDD.md`: pitch, 5 pillars, core loop, time model (12-minute days, 10-day seasons, 8-hour years), offline rules, screen layout with zone coordinates, one section per system, the food-buff design, the optional Fullness meter, the v1 out-of-scope list, and questions for the owner.
- `docs/BALANCE.md`: formulas for growth, crop pricing, market demand, specials, upgrade costs, automation throughput, fishing weights and minigame, recipe tier, dish price, buff magnitude/duration/stacking, XP and farm level, provisional farm level, offline cap. Tables for 15 crops, 13 fish + 3 junk, 22 recipes, 15 upgrades, 6 expansions, skill perks, 15 milestones, 9 goal templates, 6 bundles, and pacing targets.
- `docs/DATA_SCHEMAS.md`: id unions, content interfaces (`ItemDef`, `CropDef`, `FishDef`, `RecipeDef`, `BuffDef`, `UpgradeDef`, `ExpansionDef`, `QuestDef`, `BundleDef`, `SkillPerkDef`), `Modifiers`, the full v1 `GameState` with the phase that adds each field, `GameEvent`, `SaveFile` and the migration contract, and how systems use data and state.
- `docs/ART_STYLE.md`: a 47-colour palette with single-character sprite keys, sprite format and naming, animation frame counts, integer-scaling rules, UI look and font plan, and three worked 16 × 16 sprites (validated: every row is 16 characters and uses palette keys only).
- `CLAUDE.md`: standing rules. `docs/IDEAS.md`: empty backlog.

### Deviations
- **A seventh buff type, `fishingSpeed` (Quick Bite).** The phase-00 prompt lists it among the buff types; the phase-06 prompt's seam table has only six. Phase 06 should add `fishingSpeedModifier` (bite wait and trap interval).
- **22 recipes** (6/7/5/4 by tier) rather than exactly 20, so every buff type has at least two dishes and every tier has a fish option. **13 fish** rather than 12, so the ocean has a legendary.
- **Upgrades:** 10 farm/tool upgrades (`sprinkler`, `sprinkler_tech`, `scarecrow`, `farmhand`, `seed_planter`, `auto_seller`, `watering_can`, `hoe`, `barn_storage`, `greenhouse`), plus `backpack` (phase 03), `fish_trap`/`fishing_rod`/`trap_collector` (05) and `kitchen` (06). Backpack adds slots; barn storage raises stack size, so the two storage upgrades in the prompts don't overlap.
- The phase-04 prompt pairs "Scarecrow / Fertilizer". The design uses a placeable scarecrow (growth in an area) and no separate fertilizer; the Farming skill perks cover yield.
- Systems are "pure" in the sense of **deterministic and free of I/O**: they may mutate the `state` they are given, which keeps offline simulation fast. Documented in DATA_SCHEMAS.md §7 and CLAUDE.md.

### Known issues
- All numbers are first drafts from formulas and a hand check of the first 10 minutes; nothing has been simulated yet. Phase 03 runs the first pacing simulation.
- Seed prices are unrounded formula outputs (39, 67, 71…); phase 03 may tidy them.
- Owner decisions and the remaining open questions (real-time calendar, winter cooking bonuses) are in `docs/GDD.md` §11. Buff slots were changed to start at 3 (max 5) after owner feedback.

### Next-phase notes (for phase 01)
- Implement only the `@01` fields of `GameState` (`clock`, `rngState`, `gold`, `settings` with `masterVolume`, `meta`) and start `SAVE_VERSION` at **1** with an empty `migrations` record, plus a `tests/fixtures/save-v1.json`.
- Time constants and the clock formulas are in BALANCE.md §1 (`GAME_MINUTE_MS = 500`, days start at 06:00, 10-day seasons). The HUD format is `Spring 3 · 9:40 AM`.
- Offline: `simulatedMs = min(away, 8h) + 0.25 × clamp(away − 8h, 0, 16h)`; no modal under 60 s.
- Scene: 320 × 192 logical px (20 × 12 tiles), integer scale, zone rectangles as in GDD §5. Plot grid origin at tile (6,2), 4 × 2 at start, growing to 8 × 6.
- Palette: copy the 47 entries from ART_STYLE.md §1 into `src/render/palette.ts` with the `KEY_TO_NAME` map, and add a unit test that every sprite uses only known keys and has equal-length rows.
- Create `src/data/ids.ts` with all the id unions from DATA_SCHEMAS.md §2 even though most tables come later; it lets later phases type-check references immediately.
- `SimContext`, `Modifiers`/`NO_MODIFIERS`, `GameEvent` and `ActionResult` shapes are in DATA_SCHEMAS.md §5 and §7.
