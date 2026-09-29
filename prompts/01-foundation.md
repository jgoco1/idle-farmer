# Phase 01: Foundation (scaffold, loop, save, renderer, UI shell, CI)

> **Recommended model:** Opus 5.5. This phase fixes the architecture that every later phase builds on: the tick model, the state shape, save and migrations, offline progress, and the sprite pipeline. A mistake here is expensive to undo later.
> **Depends on:** Phase 00 merged. `CLAUDE.md` and `docs/*` exist.
> **Docs win:** the phase 00 owner decisions (`docs/GDD.md` §11) changed some details, including a real-time calendar with weekly seasons, timers in simulated minutes, and 7 buff types. Where this prompt conflicts with `docs/`, follow `docs/` and note the difference in `docs/PROGRESS.md`.

## Role and goal
You are building the technical foundation of a cozy idle farming and cooking browser game in pixel-art style. By the end of this phase there should be a **running, deployable, empty farm scene**. It shows the farm with its zones drawn from code-generated sprites, a working HUD clock, and panels that open and close. It saves and loads, and it calculates offline time. There is no crop, fishing or cooking gameplay yet.

## Read first
`CLAUDE.md`, `docs/GDD.md`, `docs/DATA_SCHEMAS.md`, `docs/ART_STYLE.md`, `docs/BALANCE.md` (the time and offline sections), and `docs/PROGRESS.md`. Follow them. If you must deviate, record the reason in PROGRESS.md.

## Requirements

### 1. Project scaffold
- Set up Vite and TypeScript with `strict: true`. Keep dependencies minimal. Runtime code should have none if possible.
- Set up Vitest for unit tests and Playwright for one e2e smoke test. Chromium is preinstalled in cloud sessions. Use it and do not run `playwright install`. If needed, launch with `executablePath` from `PLAYWRIGHT_BROWSERS_PATH`.
- Add ESLint and Prettier with a small, sensible config.
- Add these npm scripts: `dev`, `build`, `preview`, `typecheck`, `lint`, `test`, `test:e2e`.
- Set the Vite `base` option so the build works on GitHub Pages under `/idle-farmer/`.

### 2. Core (`src/core/`)
- `state.ts`: the `GameState` type (from DATA_SCHEMAS.md) and `createInitialState()`. Changes to state happen through a small action or dispatch layer, so the UI never edits state directly.
- `loop.ts`: a fixed-timestep simulation tick (for example, 10 ticks per second) that is separate from `requestAnimationFrame` rendering. It pauses cleanly when the tab is hidden, and catches up using the offline logic when the tab is shown again.
- `time.ts`: the **two clocks** from GDD §4 and BALANCE.md §1.
  - The **calendar** is built from an injected `now` and a `LocalClock`. In the browser the `LocalClock` uses the local time zone; in tests it uses a fixed zone. The calendar gives time of day (night is 20:00–06:00), the daily 06:00 refresh, and the season. Seasons change weekly at local Saturday → Sunday midnight, counted from `calendar.seasonEpoch`, so every save starts in spring. The week index never goes backwards.
  - **Simulated time** (`clock.simMs`, an integer) drives every timer.
  - The HUD shows `Spring · Tue 9:40 AM` with a sun or moon icon.
- `save.ts`: autosave to `localStorage` every N seconds and on `visibilitychange` and `beforeunload`. Store a `SAVE_VERSION` and a `lastSavedAt` timestamp. Include a `migrations` array that is empty for now, with the pattern documented, plus export and import of the save as a base64 string (for the Settings panel) and a "hard reset" option.
- **Offline progress:** on load (and when a hidden tab returns), walk the real timeline from `savedAt` to `now`. The first 8 h count at full rate, the next 16 h at 25%, and anything after 24 h adds nothing. Split the walk at every daily (06:00) and weekly (season) calendar event, and advance `simMs` in large exact steps. This must be efficient for a 30-day absence. Show a "While you were away…" summary modal, stubbed for now, and skip it for absences under 60 s.
- `events.ts`: a tiny typed event bus for notifications, sounds and effects, so that systems never import the UI.
- `rng.ts`: a seeded PRNG (for example, mulberry32 or sfc32). The seed is stored in state.

### 3. Rendering (`src/render/`)
- `palette.ts`: the full palette from ART_STYLE.md, with typed keys.
- `sprites/*.ts`: sprite definitions as string grids in the format from ART_STYLE.md. For this phase, create at least: grass (2 or 3 variants), tilled soil (dry and wet), water (2-frame animation), a wood fence, a path, the farmhouse (larger than 16×16, made from several tiles), a market stall, a pond edge, a tree, a flower, and UI icons for gold and the clock.
- `spriteCache.ts`: converts sprite definitions to `ImageBitmap` or an offscreen canvas once, and caches them.
- `renderer.ts` and `scene.ts`: draw the farm scene from a tile map. Use integer scaling to fit the viewport, `imageSmoothingEnabled = false`, and a crisp CSS rule. Add a **day/night tint** overlay driven by the local-time calendar (ART_STYLE.md §3). Add hit-testing so that clicking a zone (farm plot grid, pond, kitchen, market) dispatches an action or opens a panel. Draw a hover highlight on tiles.
- The scene must resize responsively and stay usable at a 360px-wide mobile viewport.

### 4. UI shell (`src/ui/`)
- `hud.ts`: gold, date and time, a placeholder for active buffs, and a notification toast area.
- A panel system: one reusable component for a panel with a pixel border (parchment or wood style), with open, close and focus handling. Panels open and close with ESC and with clicks. Create empty stub panels for Inventory, Shop, Market, Kitchen, Fishing, Upgrades, Goals and Settings, each with a "Coming soon" body.
- Settings panel: export save, import save, hard reset (with a confirmation step), and a volume slider stub.
- `styles.css`: panel styles from ART_STYLE.md and a font stack that loads nothing from the network.

### 5. DevOps
- `.github/workflows/ci.yml`: on PRs and pushes, run install, typecheck, lint, test and build.
- `.github/workflows/deploy.yml`: build and deploy to GitHub Pages when `main` is pushed (using `actions/deploy-pages`).
- `.claude/settings.json`: a SessionStart hook that runs `npm ci` when `node_modules` is missing, so later cloud sessions can run tests right away.
- Replace the root `README.md` with a short description of the game, how to run it and how to run the tests. Link to `prompts/README.md`.

### 6. Dev helpers
Add a debug overlay toggled with the backtick key (`` ` ``) that shows FPS, tick count and the game clock. It should also have a "time warp ×60" toggle for playtesting, which speeds up simulated time and also moves `calendar.debugOffsetMs` so that night and season changes can be tested. Add buttons that fake 8 hours of offline time and jump to the next season change. Exclude it from production builds, or hide it behind `?debug`.

## Tests (minimum)
- The calendar: night boundaries, the 06:00 refresh, weekly season and year rollover, a DST day (23 h and 25 h), the system clock set back (the week index never decreases), and a change of time zone.
- Save round-trip against `tests/fixtures/save-v1.json`, and running a migration on a fake old-version save.
- The offline cap and reduction (8 h full, 16 h at 25%, then nothing), including a 30-day absence and splitting at calendar events.
- Determinism of the seeded RNG.
- Fixed-step loop accumulation (feed it uneven `dt` values and check the tick count is correct).
- An e2e smoke test: the page loads, the canvas renders, the Settings panel opens, and a screenshot is saved to `test-results/`.

## Out of scope
Crops, the economy, fishing, cooking, progression, audio, the tutorial, and real content data beyond what rendering the scene needs.

## Definition of done
- `npm run typecheck && npm run lint && npm test && npm run build && npm run test:e2e` all pass.
- Look at the e2e screenshot yourself and check that the scene reads as cozy pixel art and not as placeholder boxes. Adjust the sprites if it doesn't.
- `docs/PROGRESS.md` has a Phase 01 entry covering Built, Deviations, Known issues, and Next-phase notes. The next-phase notes should tell the next session exactly where crops plug in: the files, the action names, and how to add a sprite.
- `CLAUDE.md` is updated with any new conventions, such as how to add a panel, sprite or action.
- Commit, push, and open a PR to `main` titled `Phase 01: Foundation`. Attach or describe the screenshot.
