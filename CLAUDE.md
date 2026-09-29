# CLAUDE.md: Standing Rules for Every Session

This repo builds **Hearthfield Idle** (working title), a cozy idle farming, fishing and cooking browser game, one phase per session. The phase prompts are in `prompts/`; the runbook is `prompts/README.md`.

## Before you write code
1. Read `docs/GDD.md`, `docs/PROGRESS.md`, and the sections of `docs/BALANCE.md` and `docs/DATA_SCHEMAS.md` your phase touches. `docs/ART_STYLE.md` before any sprite or UI work.
2. Read the "Next-phase notes" of the latest entry in `docs/PROGRESS.md`. Reuse existing patterns (actions, panels, sprites, tests); do not invent parallel ones.
3. If the docs and the code disagree, the code is what ships: fix the doc or the code in the same PR and note it under *Deviations*.

## Architecture rules
- **Game logic lives in `src/systems/`** as deterministic functions of `(state, ctx, dt)` where `ctx = { data, rng, mods, events }` (see `docs/DATA_SCHEMAS.md` §7). A system may mutate only the `state` passed to it. **No DOM, canvas, audio, `localStorage`, `Date.now()`, `Math.random()` or event-bus imports in systems.** Systems push `GameEvent`s to `ctx.events`; the loop flushes them to the bus.
- **Content lives only in `src/data/`**, typed with the id unions in `src/data/ids.ts`. No gameplay numbers hard-coded in systems, UI or rendering; constants that are formula parameters live in `src/data/balance.ts`.
- **Rendering lives in `src/render/`, UI in `src/ui/`.** Both read state and send actions through `dispatch()`. They never mutate state directly.
- **All randomness goes through the seeded RNG in `src/core/rng.ts`**, whose state is stored in `GameState.rngState`. Cosmetic-only randomness (particles, butterflies) uses a separate render-side RNG and must never touch game state.
- **Time:** simulated time is integer milliseconds (`clock.totalMs`); data durations are in-game minutes (1 in-game minute = 500 ms). Never use floats for timers in state.
- **Modifiers:** multipliers from buffs, perks and upgrades are gathered in `computeModifiers()` and read by systems through `ctx.mods`. Add a new seam there rather than reading buffs inside a system.
- **Offline correctness:** anything timed must give the same result in one large step as in many small steps (within a stated tolerance). Every timed system has a test for this.
- **Derived values are computed, not stored** (day, season, stage, farm level, slots).

## Save rules
- Any change to the shape of `GameState` needs a `SAVE_VERSION` bump **and** a migration in `src/core/save.ts` **and** a test that migrates a fixture save of the previous version (`tests/fixtures/save-vN.json`). Add the new fixture for your version too.
- Never break an existing save. Never silently discard a save that fails to load; show an error and offer an export.
- Adding content to data tables does not need a migration unless state shape changes.

## Quality bar
- `npm run typecheck && npm test && npm run build` must pass before every push (plus `npm run lint` and `npm run test:e2e` once they exist).
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
