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

---

## Phase 01: Foundation

### Built
- **Scaffold:** Vite 8 + TypeScript (`strict`, `noUncheckedIndexedAccess`), Vitest, Playwright (pinned to 1.56.1 to match the preinstalled Chromium), ESLint 9 (flat config; `src/systems/**` may not use `Date`, `Math.random`, `localStorage`, `document`, `window`) and Prettier. Scripts: `dev`, `build`, `preview`, `typecheck`, `lint`, `format`, `test`, `test:e2e`. Vite `base` is `/idle-farmer/`. Zero runtime dependencies.
- **Core (`src/core/`):**
  - `state.ts`: the `@01` `GameState` (`clock`, `calendar`, `rngState`, `gold`, `settings.masterVolume`, `meta`) and `createInitialState(now, lc, seed?)`.
  - `actions.ts`: the `Action` union and `applyAction()`; the UI only calls `game.dispatch(action)`, which returns an `ActionResult`. Actions so far: `setMasterVolume`, `plotClicked` (stub), `debugSetTimeWarp`.
  - `time.ts`: the calendar (`buildCalendar`, `LocalClock` with `systemLocalClock` and `zoneClock(tz)` for tests, DST-safe `localTimeToEpoch`, `computeSeasonEpoch`, `weekIndexAt`, `dayKeyAt`, `nextDailyBoundary`, `nextWeeklyBoundary`, `nextSeasonChange`), constants (`TICK_MS` = 100) and formatting (`formatHudDate` → `Spring · Year 1 · Tue 9:40 AM`).
  - `sim.ts`: `makeContext()`, `step(state, ctx, dtMs)` (advances `clock.simMs`, split at `msToNextSimEvent`), and `processCalendar()` (fires `seasonChanged` per week crossed, at most the last 4, then `dayStarted` once; nothing when the clock goes back).
  - `offline.ts`: `runOffline()` walks the calendar timeline from leaving to returning, cutting at 8 h, 24 h, every 06:00 and every Sunday 00:00 inside the counted part, advancing `simMs` by the exact integer integral of the rate per segment; after 24 h it only catches the calendar up. A 30-day absence runs in a few milliseconds (budget: 300 ms).
  - `loop.ts`: `FixedStepper` (fixed 100 ms ticks from uneven frame times) and `startLoop()` (rAF render; pauses on `visibilitychange` hidden and catches up with the offline walk when shown; frames longer than 5 s count as time away).
  - `game.ts`: `Game` owns the state, the bus and the stepper; `advance(realDt)`, `dispatch()`, `catchUp(from, to)`, `replaceState()`, and debug helpers. No DOM, fully tested.
  - `save.ts`: `SAVE_VERSION = 1`, `SAVE_KEY = 'hearthfield-idle/save'`, an empty `migrations` table with the pattern documented, `migrate()`, `parseSave()` (never overwrites a broken or newer save; the UI shows it and offers the raw text), `validateState()`, base64 export/import (UTF-8 safe), autosave every 15 s and on `visibilitychange`/`beforeunload`, hard reset.
  - `events.ts`: the full `GameEvent` union and a typed `EventBus`. `rng.ts`: mulberry32 over `state.rngState`.
- **Systems seam (`src/systems/`):** `index.ts` (`tickSystems`, `msToNextSimEvent`, `onDayStarted`, `onSeasonChanged`, all empty with comments showing where each phase plugs in), `modifiers.ts` (`Modifiers`, `NO_MODIFIERS`, `computeModifiers`), `context.ts` (`SimContext`, `ActionResult`).
- **Data (`src/data/`):** `ids.ts` with every id union from DATA_SCHEMAS §2 plus `seedOf`/`cropOfSeed` and type guards; `balance.ts` (offline constants, `START_GRID`); `index.ts` (`GameData`, currently only `startGrid`).
- **Rendering (`src/render/`):** `palette.ts` (47 colours, `KEY_TO_NAME`, `--c-<name>` CSS variables), sprites in `sprites/terrain.ts` (3 grass, dry and wet soil, 2-frame water, path, pond edges and corners), `sprites/objects.ts` (farmhouse 64 × 48, market stall 48 × 48, tree 32 × 48, horizontal and vertical fence, two flower clumps), `sprites/ui.ts` (gold, clock, sun, moon); `spriteCache.ts` (rasterise once to canvases, `spriteFrame`, `spriteDataUrl` for DOM icons); `scene.ts` (pure tile map, zones from GDD §5, hit-testing, plot indexes); `renderer.ts` (composes at 320 × 192 then copies at the largest integer device-pixel scale, animated water, day/night tint from `tint.ts`, hover highlight, zone clicks).
- **UI (`src/ui/`):** `hud.ts` (gold, date/time with sun or moon, buff placeholder, "Season changes in …" in the last two days), `panel.ts` (`PanelManager`: one panel at a time, ESC/✕/toolbar toggle, focus in and back), `panels.ts` (7 "Coming soon" stubs + Settings with volume stub, export, import, hard reset with confirmation), `modal.ts`, `awaySummary.ts` ("While you were away…", skipped under 60 s), `toast.ts`, `toolbar.ts`, `debug.ts`, `styles.css` (wood strip, parchment panels, no network fonts).
- **Clicks:** farmhouse → Kitchen, pond → Fishing, market → Market, plots → `plotClicked` (toasts "The soil is ready. Seeds arrive soon!"), greenhouse lot / river / dock → a hint toast.
- **Debug overlay** (`` ` `` in dev builds or with `?debug`): FPS, ticks, sim clock, calendar, ×60 time warp (speeds sim time and moves `calendar.debugOffsetMs`), "Fake 8 h offline", "Next season". It is a separate chunk loaded only when enabled.
- **DevOps:** `.github/workflows/ci.yml` (typecheck, lint, test, build on PRs and pushes to main), `.github/workflows/deploy.yml` (GitHub Pages via `actions/deploy-pages`), `.claude/settings.json` SessionStart hook (`npm ci` when `node_modules` is missing), new README.
- **Tests:** 102 unit tests (calendar incl. DST 23/25 h days, a Sunday midnight skipped by DST in Santiago, clock set back, zone changes; save round-trip against `tests/fixtures/save-v1.json` and a fake v0 → v1 migration; offline cap, splitting and 30/40-day absences; RNG determinism; fixed-step accumulation; sprite validation; scene/hit-testing; tint) and 2 Playwright tests (desktop load/render/Settings/Kitchen click with a screenshot at `test-results/farm.png`, and a 360 px phone layout).

### Deviations
- **HUD format includes the year** (`Spring · Year 1 · Tue 9:40 AM`), following BALANCE.md §1 rather than the prompt's `Spring · Tue 9:40 AM`.
- **`dayKey`** is "the local date, minus one day before 06:00" instead of "the local date of (now − 6 h)": the latter flips at 05:00 or 07:00 on DST days. BALANCE.md §1 and DATA_SCHEMAS.md §1 updated.
- **Week index** counts local Sunday-to-Sunday weeks against a zone-independent epoch week, instead of `floor(days since epoch / 7)`. Same result in one zone, but a time-zone change now moves the season at the new zone's Sunday midnight rather than on another weekday. BALANCE.md §1 updated.
- **Offline daily refresh:** fires at each 06:00 inside the counted first 24 h (at most two) and once more for the latest day, rather than strictly once. The walk has to split there anyway (BALANCE says segments end at every calendar event), and later systems (market specials, bin pickups) depend on it. BALANCE.md §1 updated.
- **Season changes** while away: all weeks advance `maxWeekIndex`, but at most the last four `seasonChanged` events fire (BALANCE: "at most 4 need processing").
- **`GameData`** only has `startGrid` for now; each phase adds its tables.
- **No shipping-bin zone yet**: it belongs to phase 03 (noted in IDEAS.md).
- **CI does not run the e2e test** (the prompt lists install, typecheck, lint, test, build); it runs locally with `npm run test:e2e`.
- `tsconfig` includes Node types (for tests and configs), so browser code could reference Node globals without a type error.

### Known issues
- At 360 px wide and a device pixel ratio of 1, the integer-scale rule draws the scene at 1× (320 × 192 CSS px, 16 px tiles). It works but taps are small; on 2×/3× phones it is crisp at the same size. Idea logged for phase 08.
- Pond edges and corners are rotations of one sprite, so the south and east banks are not lit from the top-left.
- Trees along the top and right edges are cut off by the scene border (intended as a tree line).
- Time warp only moves the calendar forward while the tab is open; `debugOffsetMs` is saved, so a debug session leaves the calendar ahead until a hard reset.
- The night tint is gentle before 22:00 by design (0 % at 20:00 rising to 55 % at midnight).

### Next-phase notes (for phase 02: farming)
- **State:** add the `@02` fields (`farm: { grid, plots, greenhouse }`, `inventory`) to `GameState` and `createInitialState` in `src/core/state.ts`; give starting gold. Then bump `SAVE_VERSION` to 2, add `migrations[1] = (old) => ({ ...old, farm: …, inventory: … })` in `src/core/save.ts`, extend `validateState`, add `tests/fixtures/save-v2.json`, and add a test migrating `save-v1.json`. The "fixture has exactly the shape of a new state" test in `tests/save.test.ts` fails until you do.
- **Data:** `src/data/crops.ts` (`CROPS: Record<CropId, CropDef>`) and `src/data/items.ts`; add them to `GameData` and `GAME_DATA` in `src/data/index.ts`. Put formula constants (`WATER_DURATION_MS`, dry growth rate) in `src/data/balance.ts`.
- **System:** `src/systems/farming.ts` with `tickFarming(state, ctx, dtMs)`, called from `tickSystems` in `src/systems/index.ts`. Make `msToNextSimEvent` return the soonest `waterMsLeft` expiry so steps split where growth halves. Implement withering in `onSeasonChanged` (return the count). Tests: one big step equals many small steps.
- **Actions:** replace the `plotClicked` stub in `src/core/actions.ts` with tool actions, e.g. `{ type: 'till' | 'water' | 'harvest'; plots: number[] }` and `{ type: 'plant'; crop: CropId; plots: number[] }`, each delegating to a function in `farming.ts` and returning an `ActionResult`. The selected tool is UI state (toolbar), not game state. The click handler for the `plots` zone is in `src/main.ts` (`onZoneClick`) and already computes the index with `plotIndexAt(grid, col, row)`.
- **Rendering:** the static ground layer draws every plot as `tile_soil_dry`. In `Renderer.render` (`src/render/renderer.ts`) there is a `// phase 02` marker between the ground and objects: draw per-plot soil (`tile_soil_wet` when watered, grass or untilled dirt for untilled) and crop sprites there. `renderer.setGrid(grid)` rebuilds the static layer and zones; call it from the state's `farm.grid` instead of `GAME_DATA.startGrid` in `main.ts`.
- **Adding a sprite:** write a `SpriteDef` (string grid, palette keys only, `anchor: 'bottom-center'` for crops) in a file under `src/render/sprites/` (e.g. `crops.ts`, named `crop_<id>_<stage>` and `item_<id>`), then spread its module into `ALL_SPRITES` in `src/render/sprites/index.ts`. `tests/sprites.test.ts` validates it automatically. Draw with `spriteFrame(id, timeMs)`; use `spriteDataUrl(id)` for DOM icons.
- **Events and UI:** systems push `GameEvent`s to `ctx.events`; `main.ts` subscribes on `game.bus` (toasts use `notify`). Add farming lines to `awaySummaryLines()` in `src/ui/awaySummary.ts` from `report.events`. Replace the Inventory stub in `src/ui/panels.ts`.

---

## Phase 02: Farming

### Built
- **Data:** `src/data/crops.ts` (the 15 crops of BALANCE.md §2 as `Record<CropId, CropDef>`: seasons, grow/regrow time, 5 stages, `regrowToStage`, yield, seed and base price, farm-level unlock, XP, a description), `src/data/items.ts` (a crop item and an unsellable `seed_<crop>` item per crop, generated from the crop table), `src/data/types.ts` (`ItemStack`, `UnlockCondition`, `ItemDef`, `CropDef`), farming and starting constants in `src/data/balance.ts` (`WATER_DURATION_MS`, `DRY_GROWTH_FACTOR`, `START_GOLD`, `START_TILLED_COLS`, `START_SEEDS`, `START_INVENTORY_SLOTS`, `START_STACK_SIZE`, `SEED_CRATE_BUY_AMOUNTS`). `GameData` gains `crops` and `items`.
- **State and save:** `farm { grid, plots, greenhouse }` and `inventory { slots, stackSize }` in `GameState` (`Plot`, `PlotState`, `Inventory`, `emptyPlot`, `createStartingFarm`, `createStartingInventory` in `src/core/state.ts`). New saves start with 60 gold, a 4 × 2 grid whose left two columns are tilled, and 6 turnip seeds in 12 slots of 99. `SAVE_VERSION = 2`; `migrations[1]` gives v1 saves the same farm and inventory (values written inline) and `max(gold, 60)`. `validateState` checks plots and inventory. Fixture `tests/fixtures/save-v2.json` (a farm mid-growth, with a dead plot).
- **Systems:**
  - `src/systems/inventory.ts`: `addItem`, `removeItem` (all or nothing), `hasItems`, `countItem`, plus `spaceFor`, `canAdd`, `usedSlots`. Stacks merge only when `hearty` matches (phase 06 seam).
  - `src/systems/farming.ts`: derived `needMs`, `isWatered`, `isReady`, `growthProgress`, `plotStage`, `msUntilReady`; pure growth `growthAfter(plot, crop, dtMs, mods)`; `tickFarming`; `msToNextWaterOut` (wired into `msToNextSimEvent`); `witherOutOfSeasonCrops` (wired into `onSeasonChanged`); `inSeason`, `finishesBeforeSeasonEnds`; actions `tillPlots`, `waterPlots`, `plantPlots`, `harvestPlots`, `autoToolFor`, `useTool`.
  - `src/systems/seedCrate.ts` (`TODO(phase03)`): `buySeeds` for unlocked, in-season seeds. `src/systems/unlocks.ts`: `isUnlocked`, `farmLevel`, `provisionalFarmLevel` (always level 1 until phase 03 adds lifetime gold).
- **Actions** (`src/core/actions.ts`): `till`, `water`, `harvest` (`plots: number[]`), `plant` (`crop`, `plots`), `useTool` (`tool: FarmTool`, `plots`, `seed`), `buySeeds` (`crop`, `qty`). The phase-01 `plotClicked` stub is gone.
- **Sprites:** `src/render/sprites/crops.ts` (`crop_<id>_0..4` for all 15 crops, 2-frame 400 ms sparkle on stage 4, `crop_dead`), `src/render/sprites/items.ts` (`item_<crop>` icons and `item_seed_<crop>` kraft seed packets), `tile_soil_untilled`, tool icons `ui_tool_auto|hoe|water|hand`. New authoring helpers in `sprites/types.ts`: `outlined` (adds the 1 px outline to a fill), `recolored`, `shifted`, `sparkled`. `scripts/sprite-sheet.mjs` renders sprites to `scripts/out/sprites.png` for review.
- **Rendering:** `plotSprites`/`plotTile` in `src/render/scene.ts` (pure); the renderer draws per-plot soil (untilled, dry, wet) and crops between the ground and the objects, turns pointer input on the plots into strokes (`onPlotDown`, `onPlotEnter`, `onStrokeEnd`), and shows the harvested item rising from the plot (`addPlotFx`, cosmetic, render clock only). The grid now comes from `state.farm.grid`.
- **UI:** a tool selector at the right of the toolbar (`src/ui/farmTools.ts`: Auto, Hoe, Seeds ▾ with the chosen packet and count, Can, Hand; keys 1–5) with a seed picker that shows which seeds are in season and warns about crops that won't finish before the season changes. Click a plot to use the tool, drag across plots, or shift-click for the whole field; a drag uses the tool Auto picked for the first plot. The Inventory panel (icon grid with counts; hover, focus or tap shows name, description and sell value) and the Shop's Seed Crate (buy ×1 / ×5, out-of-season seeds disabled, same warnings) replace their stubs; both are `live` panels that refresh while open (`PanelManager.refreshOpen`). Harvests show one "+3 Turnip" toast per click or stroke, a bag-full warning, and a toast when crops wither. The away summary adds withered crops and crops ready to harvest.
- **Tests:** 260 unit tests (was 102), including `tests/farming.test.ts` (transitions, stages, growth wet/dry and water running out mid-step, big step vs 100 ms ticks, a growth modifier within rounding tolerance, 8 h offline vs 8 h of `Game.advance`, withering online and across one or several offline season changes, multi-season survival, the "won't finish" warning, seeded yields, regrowth, full inventory, Auto, the Seed Crate), `tests/inventory.test.ts`, the v1 → v2 migration, and sprite coverage. The e2e test tills, plants (click and shift-click), buys a potato seed, drags the hoe, picks a seed, waters, time-warps from the debug overlay until a turnip is ready, harvests it, and checks the Inventory; screenshots in `test-results/farm-planted.png` and `test-results/inventory.png`.

### Deviations
- **"Ready" is derived, not a stored plot state.** The prompt lists untilled → tilled → planted → ready; `docs/DATA_SCHEMAS.md` §6 keeps `PlotState = 'untilled' | 'tilled' | 'planted' | 'dead'` with ready computed from `growthMs`, and the code follows the docs.
- **Stage rule changed** (DATA_SCHEMAS.md §4.2 updated): stage 4 is shown only when the crop is ready; stages 0–3 cover growth in quarters. The old `min(4, floor(5 * progress))` drew the ready sprite for the last fifth of growth, before the crop could be harvested.
- **Harvest notification:** the system emits one `harvested` event per plot (plus `inventoryFull`), and the UI builds the notification from those events, grouped per click or drag stroke. A `notify` event per dispatch would have shown eight "+1 Turnip" toasts for a drag across eight plots.
- **Near-ready art is derived:** stage 3 is the ready sprite with its produce recoloured (unripe fruit is green, roots are still soil mounds), and stages 0–2 are shared shapes per plant form (leafy, bush, stalk, stake, vine). Every ready crop and item icon is hand-drawn and distinct (a test checks this).
- **Withering** clears the crop (`crop: null`) and keeps the plot's water. Watering works on tilled soil too, so a plot can be watered before planting.
- **Tool details not in the prompt:** keyboard shortcuts 1–5; shift-click uses the tool on every plot; a drag keeps the tool that Auto chose for the first plot. The Seed Crate sells in lots of 1 and 5.
- **Toolbar layout:** the farm tools hide their text labels below 1400 px (icons keep an accessible name and a tooltip), and on phones the toolbar wraps to two rows (`--toolbar-h: 104px`).
- **v1 saves get 60 gold** (`max(gold, 60)`), since phase 01 kept gold at 0 by design.
- **Big-step equivalence is within tolerance, not exact.** Growth is rounded once per step part; when a water-out falls inside a 100 ms tick, the dry plots of that tick round two half-ms instead of one, so ticks and one large step can differ by about 1 ms per water-out (the tests allow 4 ms for a farm where four plots run dry). Plot states, water and readiness match exactly. BALANCE.md §2 notes this.
- `EventOf<T>` in `src/core/events.ts` now also resolves variants that share a body (`'tilled' | 'watered'`); before, `bus.on('tilled', …)` typed its event as `never`.

### Known issues
- Wet and dry soil differ by one shade, which is easy to miss on small screens (idea logged for phase 08).
- Seeds that go out of season stay in the bag until their season returns; they can't be sold (idea logged for phase 03).
- Dragging on touch screens uses pointer events with `touch-action: none` on the canvas; it is covered by the desktop e2e test but has not been tried on a real phone.
- The provisional farm level is always 1 (no lifetime gold before phase 03), so the Seed Crate only offers the farm-level-1 seeds: turnip and potato in spring, wheat and tomato in summer, wheat, tomato and yam in autumn, and nothing in winter.
- The Shop and Inventory lists are rebuilt on every state change while open; cheap at this size, but phase 03's market panel should update rows in place if it grows large.

### Next-phase notes (for phase 03: economy and market)
- **Selling hooks in** through `removeItem(state.inventory, item, qty)` (`src/systems/inventory.ts`) and `ItemDef.basePrice` / `sellable` in `GAME_DATA.items` (seeds are `sellable: false`). The Inventory panel (`inventoryPanel` in `src/ui/panels.ts`) prints "Sell value: {basePrice}g each"; switch it to the market price once demand exists. Emit `sold` / `goldEarned` from the market system; the UI already refreshes live panels on any event.
- **Replace the Seed Crate:** `src/systems/seedCrate.ts` (`buySeeds`), the `buySeeds` action, `shopPanel` in `src/ui/panels.ts` and `SEED_CRATE_BUY_AMOUNTS` in `src/data/balance.ts` are all marked `TODO(phase03)`. Keep the `purchased` event. The seed advice (`seedNote` in `src/ui/farmTools.ts`, built on `inSeason` and `finishesBeforeSeasonEnds` in `src/systems/farming.ts`) is ready to reuse in the real shop.
- **Farm level:** `farmLevel(state)` in `src/systems/unlocks.ts` returns 1; make it `provisionalFarmLevel(state.stats.lifetimeGold)` once `stats` exists. `isUnlocked` evaluates `farmLevel` and treats `bundle` as met; add `expansion` there.
- **Expansions:** `state.farm.plots` is row-major over `state.farm.grid`, so adding columns changes plot indexes. Rebuild the array by (col, row) when the grid grows (new plots `emptyPlot('untilled')`). The renderer calls `setGrid(game.state.farm.grid)` every frame and rebuilds its static layer and zones only when the size changes. The backpack adds `null` slots to `state.inventory.slots`.
- **Growth modifiers live in** `rate()` in `src/systems/farming.ts`: `(wet ? 1 : DRY_GROWTH_FACTOR) * mods.growthModifier`. `mods.growthModifier` comes from `computeModifiers` (`src/systems/modifiers.ts`; add buff/perk sources there, phases 06–07). The per-plot scarecrow bonus goes inside `rate()` (marked `phase 04`), sprinkler and greenhouse watering in `isWatered()`, greenhouse plots in `tickFarming` and `msToNextWaterOut`. `msToNextWaterOut` must keep reporting every moment a plot's growth rate changes.
- **Events:** `tilled`, `watered` (`plots`), `planted` (`crop`, `plots`), `harvested` (`crop`, `qty`, `plot`, `auto: false`; automation in phase 04 should send `auto: true`), `inventoryFull`, `purchased`, `seasonChanged.withered`.
- **Sprites:** new art can be written as fills and wrapped in `outlined()`; check it with `node scripts/sprite-sheet.mjs <prefix> [--soil]`. A shipping-bin sprite is still to do (IDEAS.md).
