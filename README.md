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

Press <kbd>`</kbd> in a dev build (or with `?debug`) for the debug overlay: FPS, ticks, the game clock, a ×60 time warp, and buttons to fake 8 hours offline or jump to the next season.

## Test it

```sh
npm run typecheck
npm run lint       # ESLint + Prettier
npm test           # Vitest unit tests
npm run test:e2e   # Playwright smoke test; screenshots land in test-results/
```

The e2e test uses the Chromium in `PLAYWRIGHT_BROWSERS_PATH` when it is set (as in Claude Code cloud sessions); elsewhere run `npx playwright install chromium` once.

## How it is built

The game is built in phases, one Claude Code session each. See [`prompts/README.md`](prompts/README.md) for the runbook, [`CLAUDE.md`](CLAUDE.md) for the standing rules, and [`docs/`](docs/) for the design (`GDD.md`), numbers (`BALANCE.md`), types (`DATA_SCHEMAS.md`), art rules (`ART_STYLE.md`) and the progress log (`PROGRESS.md`).
