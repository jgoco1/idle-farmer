# Hearthfield Idle

A cozy idle farming, fishing and cooking browser game with a pixel-art look inspired by Stardew Valley and Minecraft. Till a small patch of soil, fish the pond, cook what you grow, and come back to a farm that kept going while you were away. The in-game calendar follows your real clock: it is night on the farm when it is night for you, and each real week brings a new season.

All art is drawn in code from string grids; the game loads nothing from the network and has no runtime dependencies.

## Run it

Requires Node 22+.

```sh
npm ci
npm run dev        # http://localhost:5173/idle-farmer/  (add ?debug for the debug overlay in a build)
npm run build      # production build in dist/, served under /idle-farmer/ on GitHub Pages
npm run preview    # serve the production build
```

**Playing:** click a plot to till, plant, water or harvest it. The tools at the right of the toolbar (keys <kbd>1</kbd>–<kbd>5</kbd>) pick Auto, Hoe, Seeds, Watering Can or Hand; drag across plots, or shift-click to use the tool on the whole field. The Shop's Seed Crate sells starter seeds for the current season.

Press <kbd>`</kbd> in a dev build (or with `?debug`) for the debug overlay: FPS, ticks, the game clock, a ×60 time warp, and buttons to fake 8 hours offline or jump to the next season.

## Test it

```sh
npm run typecheck
npm run lint       # ESLint + Prettier
npm test           # Vitest unit tests
npm run test:e2e   # Playwright smoke test; screenshots land in test-results/
```

`node scripts/sprite-sheet.mjs crop_ --soil` renders sprites whose id starts with a prefix to `scripts/out/sprites.png` (×4, optionally over soil) for checking art without a browser.

The e2e test uses the Chromium in `PLAYWRIGHT_BROWSERS_PATH` when it is set (as in Claude Code cloud sessions); elsewhere run `npx playwright install chromium` once.

## How it is built

The game is built in phases, one Claude Code session each. See [`prompts/README.md`](prompts/README.md) for the runbook, [`CLAUDE.md`](CLAUDE.md) for the standing rules, and [`docs/`](docs/) for the design (`GDD.md`), numbers (`BALANCE.md`), types (`DATA_SCHEMAS.md`), art rules (`ART_STYLE.md`) and the progress log (`PROGRESS.md`).
