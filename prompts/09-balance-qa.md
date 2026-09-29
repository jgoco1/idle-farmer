# Phase 09: Balance, QA and Performance

> **Recommended model:** Opus 5.5. This phase needs whole-system reasoning: interactions between the economy, automation, buffs and progression, edge cases in offline simulation, and deciding which bugs matter. Its job is to find and fix subtle problems, not to build features.
> **Depends on:** Phase 08 merged.
> **Docs win:** the phase 00 owner decisions (`docs/GDD.md` §11) changed some details, including a real-time calendar with weekly seasons, timers in simulated minutes, and 7 buff types. Where this prompt conflicts with `docs/`, follow `docs/` and note the difference in `docs/PROGRESS.md`.

## Role and goal
You are the balance designer and QA lead for a feature-complete cozy idle farming and cooking browser game. Make it **well-paced, bug-free and fast**. Don't add features: log feature ideas in `docs/IDEAS.md`.

## Read first
All of `docs/`, especially the pacing targets and every "tuning notes" section in `BALANCE.md` and every "Known issues" entry in `PROGRESS.md`. Then read through `src/systems/` in full.

## Requirements
1. **Headless simulator (`scripts/simulate.ts`, run with `npm run simulate`).**
   - Run the real systems code headlessly (no DOM) using several **player strategy bots**:
     - *Greedy Farmer* (maximises crops and automation)
     - *Angler* (prioritises fishing)
     - *Chef* (cooks everything and always keeps buffs active)
     - *Casual Idler* (checks in for 2 minutes every 4 real hours)
     - *Active Player* (plays for 1 hour straight)
   - Output a report (a markdown table, plus CSV in `scripts/out/`, which is gitignored) with: gold over time, the time to each milestone, the time to the first automation, farm level, recipes known, the fraction of time with nothing to do, and buff uptime.
   - The calendar follows real local time (GDD §4), so the simulator must drive the **injected `now`** through realistic real-world schedules. Bots play at chosen local times (for example, evenings only, or a morning and an evening check-in) with overnight gaps, and the simulation passes through weekly season changes, withering, the daily 06:00 refresh and the offline cap exactly as the real game does.
   - Make it deterministic with a seed, and fast enough that 30 real days of simulated play (about 4 seasons) finish in seconds.
2. **Tuning.** Compare the simulator output with the BALANCE.md pacing targets and adjust `src/data/*` until:
   - Every strategy is viable and none dominates by more than about 1.5× over the same time.
   - There is no early dead time (the player always has an affordable goal).
   - Casual Idlers make meaningful progress and are not badly behind; offline gains matter.
   - No runaway exponential growth breaks the economy late in the game. Check the gold-per-hour curve.
   - Food buffs feel worth it (roughly 10 to 25% faster progression when kept up) but are not mandatory.

   Update `docs/BALANCE.md` with the final numbers and a "Phase 09 balance report" that summarises the simulator results before and after tuning.
3. **QA sweep.** Write tests that hunt for bugs, and fix what you find. At minimum, cover:
   - Offline simulation across season, year and several-day boundaries, with automation, traps, the cook queue and buff expiry all active together. Include DST days and a system clock set back during an absence.
   - Very long offline periods (30 days) are capped correctly
   - Saving mid-minigame and mid-cook
   - Importing an old or corrupt save
   - Floating-point drift in timers over long sessions (`clock.simMs` must stay an integer)
   - Rapid double clicks buying things twice
   - Inventory full during an automated harvest (define and test the behaviour)
   - Market prices at the floor and ceiling
   - Migrating a save from **every** earlier `SAVE_VERSION`. Build fixture saves for each version.
4. **Performance.**
   - Profile the render loop with a fully expanded, fully automated farm. The target is a steady 60 fps on a mid-range laptop, with no garbage-collection stutter from per-frame allocations.
   - Use dirty-rect or layered canvases if needed, and cache the static background.
   - An 8-hour offline step must take under 100 ms, and a 30-day capped step under 300 ms.
   - Keep the bundle size reasonable. Report it.
5. **Code health.** Remove dead code and stale `TODO(phaseNN)` markers. Make sure every system follows the rules in CLAUDE.md. Update `CLAUDE.md` and the root `README.md` to describe the finished architecture.
6. **Release checklist** (`docs/RELEASE.md`): what was verified, known limitations, and ideas for v2, taken from IDEAS.md.

## Out of scope
New systems or content, which belong in IDEAS.md. The one exception: if a pacing gap can only be fixed by adding a small amount of content (for example, one more mid-tier crop), you may add it and explain why in the PR.

## Definition of done
- All checks pass, including the new QA tests.
- `npm run simulate` works and its report is included in BALANCE.md.
- Record the performance numbers in PROGRESS.md.
- Open a PR titled `Phase 09: Balance, QA & performance`. The PR body should give a before/after table of the key pacing numbers.
