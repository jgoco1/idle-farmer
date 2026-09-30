# Hearthfield Idle

A cozy idle farming, fishing and cooking browser game with a pixel-art look inspired by Stardew Valley and Minecraft. Till a small patch of soil, fish the pond, cook what you grow, and come back to a farm that kept going while you were away. The in-game calendar follows your real clock: it is night on the farm when it is night for you, and each real week brings a new season.

All art is drawn in code from string grids and all sound is synthesised with Web Audio; the game loads nothing from the network and has no runtime dependencies.

## Run it

Requires Node 22+.

```sh
npm ci
npm run dev        # http://localhost:5173/idle-farmer/  (add ?debug for the debug overlay in a build)
npm run build      # production build in dist/, served under /idle-farmer/ on GitHub Pages
npm run preview    # serve the production build
```

**Playing:** click a plot to till, plant, water or harvest it. The tools at the right of the toolbar (keys <kbd>1</kbd>–<kbd>5</kbd>) pick Auto, Hoe, Seeds, Watering Can or Hand; drag across plots, or shift-click to use the tool on the whole field. Sell at the Market (instant, 90%) or the Shipping Bin (100%, collected hourly); expand the farm and buy automation (sprinklers, a farmhand, a seed planter, an Auto-Seller) in Upgrades; fish the pond, river and sea; cook in the farmhouse and eat dishes for buffs; follow the milestones, goals and Community Board in Goals. A first-time tutorial covers the first harvest and sale.

Press <kbd>`</kbd> in a dev build (or with `?debug`) for the debug overlay: FPS, ticks, the game clock, a ×60 time warp, and buttons to fake 8 hours offline or jump to the next season. `window.__game` is the running game.

## Test it

```sh
npm run typecheck
npm run lint       # ESLint + Prettier
npm test           # Vitest unit tests (including the QA sweep and the simulator's pacing checks)
npm run test:e2e   # Playwright: smoke, farming, fishing, cooking, goals, polish, accessibility, performance
npm run simulate   # the balance simulator: 30 real days of five strategy bots, report + CSV in scripts/out/
```

`npm run simulate -- --days 7 --seeds 1,2 --bots farmer,idler` narrows a run. The e2e tests use the Chromium in `PLAYWRIGHT_BROWSERS_PATH` when it is set (as in Claude Code cloud sessions); elsewhere run `npx playwright install chromium` once. `node scripts/sprite-sheet.mjs crop_ --soil` renders sprites to `scripts/out/sprites.png` for checking art without a browser.

## How it works

- **`src/core/`**: the game object (`game.ts`), the fixed 100 ms step and the offline walk (`sim.ts`, `offline.ts`), the real-time calendar (`time.ts`), saving, loading and migrations (`save.ts`, `SAVE_VERSION` 7), actions (`actions.ts`, the only way anything changes state), events and the seeded RNG.
- **`src/systems/`**: every rule, as deterministic functions of `(state, ctx, dt)`: farming, market and shipping bin, automation, placement, fishing and traps, cooking and buffs, progression (skills, milestones, goals, the Community Board). One large step gives the same result as many small ones, so eight hours away take a few tens of milliseconds.
- **`src/data/`**: all content and every number (`balance.ts` holds the formula parameters; `docs/BALANCE.md` explains them).
- **`src/render/`** draws the scene on a canvas (static ground cached, everything else redrawn each frame without allocating); **`src/ui/`** is the DOM (HUD, panels, toasts, tutorial); **`src/audio/`** the procedural sound and music. `src/main.ts` wires them to the game.
- **`scripts/sim/`** is the headless simulator: bots that play the real game on real-world schedules, with saves and offline catch-ups between sessions.

The game was built in phases, one Claude Code session each: see [`prompts/README.md`](prompts/README.md) for the runbook, [`CLAUDE.md`](CLAUDE.md) for the standing rules, and [`docs/`](docs/) for the design (`GDD.md`), numbers (`BALANCE.md`), types (`DATA_SCHEMAS.md`), art rules (`ART_STYLE.md`), the progress log (`PROGRESS.md`), the release checklist (`RELEASE.md`) and the ideas backlog (`IDEAS.md`).
