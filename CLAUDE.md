# CLAUDE.md: Standing Rules for Every Session

This repo builds **Hearthfield Idle** (working title), a cozy idle farming, fishing and cooking browser game, one phase per session. The phase prompts are in `prompts/`; the runbook is `prompts/README.md`.

## Before you write code
1. Read `docs/GDD.md`, `docs/PROGRESS.md`, and the sections of `docs/BALANCE.md` and `docs/DATA_SCHEMAS.md` your phase touches. `docs/ART_STYLE.md` before any sprite or UI work.
2. Read the "Next-phase notes" of the latest entry in `docs/PROGRESS.md`. Reuse existing patterns (actions, panels, sprites, tests); do not invent parallel ones.
3. If the docs and the code disagree, the code is what ships: fix the doc or the code in the same PR and note it under *Deviations*.

## Architecture rules
- **Game logic lives in `src/systems/`** as deterministic functions of `(state, ctx, dt)` where `ctx = { data, rng, mods, events, calendar }` (see `docs/DATA_SCHEMAS.md` §7). A system may mutate only the `state` passed to it. **No DOM, canvas, audio, `localStorage`, `Date.now()`, `Math.random()` or event-bus imports in systems.** Systems push `GameEvent`s to `ctx.events`; the loop flushes them to the bus.
- **Content lives only in `src/data/`**, typed with the id unions in `src/data/ids.ts`. No gameplay numbers hard-coded in systems, UI or rendering; constants that are formula parameters live in `src/data/balance.ts`.
- **Rendering lives in `src/render/`, UI in `src/ui/`.** Both read state and send actions through `dispatch()`. They never mutate state directly.
- **All randomness goes through the seeded RNG in `src/core/rng.ts`**, whose state is stored in `GameState.rngState`. Cosmetic-only randomness (particles, butterflies) uses a separate render-side RNG and must never touch game state.
- **Time:** there are two clocks (see `docs/GDD.md` §4). The **calendar** (time of day, day, season) follows the real local clock and reaches systems only as `ctx.calendar`, built in `src/core/time.ts` from an injected `now` so tests can fix the date and time zone. **Simulated time** (`clock.simMs`, integer ms) drives every timer; data durations are in seconds of simulated time. Never use floats for timers in state, and never call `Date` outside `src/core/`.
- **Modifiers:** multipliers from buffs, perks and upgrades are gathered in `computeModifiers()` and read by systems through `ctx.mods`. Add a new seam there rather than reading buffs inside a system.
- **Offline correctness:** anything timed must give the same result in one large step as in many small steps (within a stated tolerance). Every timed system has a test for this.
- **Derived values are computed, not stored** (day, season, stage, farm level, slots).

## The finished architecture (v1, after phase 09)
- `src/core/`: `game.ts` (owns state, bus, stepper; `dispatch`, `advance`, `catchUp`), `sim.ts` (`step` splits at every `msToNextSimEvent`; `processCalendar` fires season changes and the 06:00 refresh), `offline.ts` (the capped real-time walk), `time.ts` (calendar from an injected `now`), `save.ts` (`SAVE_VERSION` 7, migrations 1→7, validation), `actions.ts`, `events.ts`, `rng.ts`, `prefs.ts` (per-device settings, not in the save).
- `src/systems/`: farming, market, shipping bin, shop, expansions, upgrades, placement, automation (farmhand + planter), auto-seller, fishing, traps, locations, cooking, buffs, modifiers, progression (XP, milestones, goals), skills, bundles, unlocks, inventory, economy. `systems/index.ts` is the tick order.
- `src/data/`: content tables and `balance.ts`. `src/render/`: `renderer.ts`, `scene.ts` (layout and hit-testing), sprites, particles, ambient life. `src/ui/`: HUD, panels, toasts, tutorial, placement mode, `purchaseGuard.ts`. `src/audio/`: procedural sound and music. `src/main.ts` wires everything.
- `scripts/simulate.ts` + `scripts/sim/` (`driver.ts` the harness, `brain.ts` the player, `bots.ts` the strategies and schedules, `report.ts`): the balance simulator.

## v2 (from v2 phase 00; details in GDD §12, BALANCE §13, DATA_SCHEMAS §9, ART_STYLE §6)
- **World coordinates:** the world is 36 × 22 tiles and the v1 scene is its top-left corner **at the same tile coordinates** (`HOME_ORIGIN = (0, 0)` in `src/data/world.ts`). The world only grows right and down; never shift the home region. Plots keep plot coordinates and indexes, traps keep slots, trees use tree-spot indexes, decorations and buildings store the world tile of their footprint's top-left. The layout (regions, parcels, lanes, sea, town sites, tree spots) is data in `src/data/world.ts`, not constants scattered in render code.
- **The camera is per device:** its position and zoom live in prefs (`src/core/prefs.ts`), never in `GameState` or the save. Zoom is an integer pixel scale. A drag past the threshold is a pan and never runs a farm action.
- **Decorations are cosmetic.** Decorations, charm and town projects never feed `computeModifiers`, prices, growth or any timer, and no town project gives gold or an income multiplier. Charm is derived, never stored, and only unlocks decorations, milestones and goals.
- **Trees count real days** through `ctx.calendar.dayIndex` (monotonic, like the week index); everything else in v2 is simulated time. Animals are gentle: unfed means no product, and nothing is ever lost or reduced. Wandering animals use the render-side RNG only.
- **No games of chance**, and nothing that imitates one.

## Code conventions (from phase 01)
- **Where things plug in:** a new system is a `tickX(state, ctx, dtMs)` in `src/systems/x.ts`, called from `tickSystems` in `src/systems/index.ts`. Any timer that changes a rate mid-step (water running out, a buff expiring) must be reported by `msToNextSimEvent` so the core splits steps there. Daily and seasonal reactions go in `onDayStarted` / `onSeasonChanged`.
- **Adding an action:** add a variant to `Action` in `src/core/actions.ts`, handle it in `applyAction` by calling a system function, return an `ActionResult`. UI code calls `game.dispatch(action)` and shows `result.reason` on failure.
- **Adding a panel:** its id is in `PanelId` (`src/data/ids.ts`); replace its stub in `src/ui/panels.ts` with a `PanelDef` whose `build(body)` creates the DOM once and returns an optional `refresh()` run on every open. `PanelManager` handles open/close/ESC/focus; panels never edit state.
- **Adding a sprite:** a `SpriteDef` string grid in `src/render/sprites/*.ts`, included in `ALL_SPRITES` (`src/render/sprites/index.ts`); `tests/sprites.test.ts` checks it. Draw with `spriteFrame(id, timeMs)`, or `spriteDataUrl(id)` for DOM icons. Scene placement lives in `src/render/scene.ts`.
- **Time in the core:** only `src/main.ts` reads `Date.now()` (injected into `Game` as `now`). Tests use `zoneClock('America/New_York')` and the `at()` helper in `tests/helpers.ts`.
- **Debugging:** `?debug` (or any dev build) enables the overlay on `` ` ``; `window.__game` exposes the `Game` for e2e tests and the console.
- **e2e:** `npm run test:e2e` builds and serves the app and uses the Chromium in `PLAYWRIGHT_BROWSERS_PATH`; never run `playwright install` in cloud sessions. Look at `test-results/farm.png` after visual changes. Some specs rewrite `docs/screenshots/*.png`; `git checkout docs/screenshots` unless you meant to update them.
- **Balance (phase 09):** after changing any number, run `npm run simulate` (report + CSV in `scripts/out/`) and `npx vitest run tests/simulate.test.ts`; record the change in `docs/BALANCE.md`. The bots act only through `Game.dispatch`; teach the brain (`scripts/sim/brain.ts`) about a new action rather than letting it edit state.
- **Performance (phase 09):** the render path (`Renderer.render`, `sceneView()` in `main.ts`, `plotSpritesInto`, particles, ambient) must not allocate per frame: reuse scratch objects and indexed loops. Budgets: 8 h offline on a full farm < 100 ms and 30 days < 300 ms (`tests/automation.test.ts`, `tests/qa.test.ts`, `e2e/perf.spec.ts`); a timed system that asks for data every step should cache it (see `coverageOf`, `allPlotIndexes`).

## Save rules
- Any change to the shape of `GameState` needs a `SAVE_VERSION` bump **and** a migration in `src/core/save.ts` **and** a test that migrates a fixture save of the previous version (`tests/fixtures/save-vN.json`). Add the new fixture for your version too.
- Never break an existing save. Never silently discard a save that fails to load; show an error and offer an export.
- Adding content to data tables does not need a migration unless state shape changes.

## Quality bar
- `npm run typecheck && npm run lint && npm test && npm run build && npm run test:e2e` must pass before every push.
- Every new system gets unit tests. Every bug fix gets a regression test.
- TypeScript `strict`. No `any` except in migrations operating on old raw JSON.
- Keep runtime dependencies at zero unless a phase prompt allows one.

## Scope rule
- Stay inside the current phase's prompt. If you have an idea outside it, add a line to `docs/IDEAS.md` (what, why, which phase could own it) instead of building it.
- Small typed seams for later phases are fine; behaviour is not.

## Handoff rule
Before finishing, add a section to `docs/PROGRESS.md` for your phase with four headings: **Built**, **Deviations** (from the prompt or docs, with reasons), **Known issues**, **Next-phase notes** (exact files, action names and patterns the next session should use). If you changed numbers, update `docs/BALANCE.md` and add tuning notes.

## Git
- Small, descriptive commits. One PR per phase against `main`, titled as the phase prompt says.
- Do not commit build output, `node_modules`, `test-results/` or `scripts/out/`.
