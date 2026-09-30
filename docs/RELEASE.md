# Release checklist: Hearthfield Idle v1

What was verified before calling v1 done (phase 09), what is known not to be perfect, and what v2 could bring. Numbers come from `npm run simulate`, the unit and e2e suites and `e2e/perf.spec.ts`; details are in `docs/BALANCE.md` ("Phase 09 balance report") and `docs/PROGRESS.md` (phase 09).

## Verified

**Checks that must pass on every push**
- [x] `npm run typecheck`, `npm run lint` (ESLint + Prettier), `npm run build`.
- [x] `npm test`: 744 unit tests, including `tests/qa.test.ts` (the QA sweep) and `tests/simulate.test.ts` (pacing on a real-world schedule).
- [x] `npm run test:e2e`: 25 Playwright tests (smoke, farming, market, automation, fishing, cooking, goals, polish, accessibility with axe, phone layouts, performance).

**Balance** (`npm run simulate`, 30 real days, 8 seeds, five strategy bots on real-world schedules)
- [x] Every strategy is viable: Greedy Farmer, Angler and Chef end within 1.18× of each other after 3 and 7 days and 1.09× after 30.
- [x] No early dead time: the longest wait with nothing to do in the first 30 minutes is 2 minutes (a farmer who never fishes, waiting on turnips); players who fish are never idle.
- [x] Casual Idlers progress: two minutes every four hours reaches 160% of the one-hour-a-day player's gold after 3 days; offline gains are 78–98% of all gold.
- [x] No runaway growth: income levels off at 40–55k gold per simulated hour from day 5 and stays there.
- [x] Food buffs are worth it but not required: keeping them up gives +22% (day 3) and +21% (day 7) over selling the same dishes.
- [x] Pacing (hours of play for a one-hour-a-day player): first harvest 2 min, farmhand 25 min, whole farm automated 3 h, greenhouse 11 h (the autumn week), Farm Level 10 at 9.4 h.

**QA sweep** (`tests/qa.test.ts`)
- [x] Offline across a season change and two dawns, into a new year, and over both DST nights, with the farmhand, planter, Auto-Seller, sprinklers, traps, Trap Collector, the stove and buffs all running; the same absence walked in one-minute steps agrees (within 3% of crops, from growth rounding).
- [x] A system clock set back during an absence changes nothing; putting it right does not repeat a season.
- [x] 30 days away: exactly 12 h of simulated time, the calendar caught up (five Sundays, four season changes applied at once), in ~100 ms.
- [x] Saving mid-cast, mid-wait and mid-reel (the loaded session plays on identically) and mid-cook (progress and a perk-saved ingredient survive).
- [x] Every save version (fixtures v1 to v7) migrates, validates, plays 8 h offline and saves again; broken saves (truncated, empty, newer, no state, bad gold, fractional clock, missing plots, bad base64) raise a `SaveError` that keeps the raw text, and a broken stored save is never replaced.
- [x] Timers stay integers over long sessions with 60 Hz, uneven and ×60 warp frames; time played is counted exactly.
- [x] A double click on a buy button buys once (`src/ui/purchaseGuard.ts`; also an e2e test).
- [x] A full bag under automation: ready crops wait in the ground (nothing lost, RNG untouched, no slowdown); with the Auto-Seller they go to the bin; a Trap Collector leaves the catch in the trap and says so.
- [x] Market prices at the floor (half price, never under 1g, quoted exactly) and the ceiling (1.3, never above; specials and Silver Tongue multiply on top).

**Performance**
- [x] Render loop on a fully expanded, fully automated farm in headless Chromium (software canvas): steady 60 fps, worst frame 16.8 ms, 1.3–1.4 ms of script per frame, ~7.8 KB allocated per frame (was ~34 KB). The static ground is cached; the scene view, plot sprites and effects are updated in place.
- [x] Offline: 8 h away on that farm catches up in 60–66 ms on page load in Chromium (budget 100 ms); 30 days in ~100 ms (budget 300 ms).
- [x] Bundle: 281.7 kB JavaScript (88.2 kB gzipped), 21.7 kB CSS (5.0 kB gzipped), a 1.4 kB debug chunk loaded only with `?debug`. No runtime dependencies, nothing fetched at run time.
- [x] The simulator plays 30 real days of one bot in 3–7 s.

## Known limitations
- **Gold has nothing to buy after the first week** for a keen player (everything costs about 523k in total); the long game is seasons, bundles, the Fish Collection, recipes and Farm Level 10.
- **Busy Bees** (automation speed) is worth almost nothing once the farmhand is Level 3 or higher.
- **Summer and winter dishes** boost XP, fishing and cooking more than gold; keeping buffs up pays most in spring and autumn.
- **Goal draws depend on how an offline walk is split into steps**, so the goal board after an absence can differ from a live session's (totals agree).
- The pull-up rule for old regrowers (Hoe) has no tooltip yet.
- `e2e/fishing.spec.ts` "cast, wait for the bite…" depends on random fish and a scripted player and is occasionally flaky (a re-run passes).
- Audio has only been checked with a fake `AudioContext` and headless Chromium, not by ear on a real device.
- Performance was measured in headless Chromium in a cloud container, not on a physical mid-range laptop or phone.
- The old `settings.masterVolume` field and `setMasterVolume` action remain in the save for compatibility (prefs replaced them in phase 08).

## Ideas for v2 (from `docs/IDEAS.md`)
- A late-game gold sink: farmhouse rooms, decorations, town projects.
- A Busy Bees that matters late, and a gold-buff dish for winter and summer; winter-only recipes.
- Seed restocking for idle farms (a planter that buys its own seeds, capped).
- Cook ×N and recipe favourites; a goal reroll and a daily goal streak.
- Rain days tied to the real calendar; weather.
- Pinch-to-zoom, a sticky tab row for long panels on phones, number format everywhere.
- Choosing trap spots and bait; a "line out" cooldown for active fishing if needed.
- Reproducible goal draws (a separate RNG stream) and a human-like fisher in the simulator.
- A real-device audio pass; a dog as well as a cat.
