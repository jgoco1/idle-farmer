# Fix: Fishing results vanish when the player casts again quickly

> **Recommended model:** Sonnet 5.5. The fix is small and UI-only. The hard part is proving it with a reliable Playwright test around the real-time minigame, which Sonnet handles better than Haiku. Haiku 4.5 can do it if you are willing to run the e2e spec a few more times yourself.
> **Use:** in a fresh session, as is. No save change.

---

Fix a controls problem in the fishing minigame of the cozy idle farming game in this repo.

**Bug:** When a fish is landed (or gets away), the result ("You caught a Carp (34 cm)! New for your collection!") disappears almost at once if the player is still pressing Space or tapping the button, because the next press starts a new cast.

**Steps to reproduce:**
1. Open the Fishing panel and cast at the pond.
2. Reel a fish in by tapping Space (or the big button) rapidly, as players do.
3. Keep tapping for a moment after the meter fills.

**Expected:** The result stays on screen long enough to read, and a stray press right after a catch does not start a new cast.

**Actual:** The release ends the reel, the next press immediately casts again, and the result is cleared.

**Where:** all devices. It is worst on phones, where players tap fast.

## Root cause (already found, but check it)
In `src/ui/fishingPanel.ts`:
- The `frame()` loop dispatches `fishStart` as soon as there is no session, `holding` is true and `armed` is true.
- `armed` comes back on any release (`setHold(false)`).
- A successful `fishStart` sets `lastResult = null`, which empties the `.fish-result` element.

So "release, press" after a catch is enough to start a cast and erase the result.

## What to build
1. **A short pause after each result.**
   - After a `caught` (not via trap) or `escaped` event, ignore cast input for **`RESULT_PAUSE_MS` = 1200 ms**.
   - The constant is a named UI constant at the top of `fishingPanel.ts`. It is UI pacing, not a gameplay number, so it does not go in `balance.ts`.
   - During the pause, the button reads something like "Nice!" (or "It got away") and looks disabled with `aria-disabled="true"`, but stays focusable.
   - The status line keeps the result.
2. **A fresh press after the pause.** A press that started before or during the pause never casts, even if it is still held when the pause ends. Only a press that begins after the pause starts a new cast. Extend the existing `armed` logic rather than adding a second mechanism. It applies to Space and to pointer and touch input alike.
3. **The result stays visible.**
   - Starting a new cast no longer clears the result. Instead, it fades to a quieter "Last catch: …" style (a CSS class; respect reduced motion).
   - The next `caught` or `escaped` replaces it.
   - **Put the rod away** and closing the panel may still clear it.
4. **Nothing else changes.**
   - Do not change `src/systems/fishing.ts`, the reel numbers, Relaxed fishing or the session save shape.
   - Do not change offline behaviour or the trap path.
   - Do not touch other panels.

## Read first
- `CLAUDE.md`, and the latest "Next-phase notes" in `docs/PROGRESS.md`.
- `src/ui/fishingPanel.ts`, the whole file: the input section, `frame()`, `paint()`, `renderResult()`.
- `e2e/fishing.spec.ts`. Its scripted reel records results with a `MutationObserver` and must keep passing.
- The phone fishing test in `e2e/polish.spec.ts`.

## Tests
- **Reproduce first.** Write the new Playwright test before the fix, see it fail, then make it pass. In `e2e/fishing.spec.ts`:
  1. Turn on Relaxed fishing, cast, and reel in a fish with scripted input. Copy the existing test's approach: `window.__game` and the `fishTick` / `fishStart` actions, or the button.
  2. Right after the catch, press and release Space several times within about 600 ms.
  3. Assert there is still no fishing session, and that `.fish-result` still contains "You caught".
  4. Wait out the pause, press Space once, and assert that a session starts (phase `charging`) while the result text is still shown, in its "last catch" style.
- Also test the "held through the pause" case: hold Space from the catch until after 1200 ms, and assert no cast until it is released and pressed again.
- Run the fishing spec at least 5 times in a row (`npx playwright test e2e/fishing.spec.ts --repeat-each 5`) and say how many passed. Use `expect.poll` and state checks, not fixed sleeps, wherever you can.
- Run the full quality bar: `npm run typecheck && npm run lint && npm test && npm run build && npm run test:e2e`, then `git checkout docs/screenshots` unless you meant to update them.

## Docs
- Add a short entry to `docs/PROGRESS.md` under a "Fixes" heading, with the root cause and the test that covers it.
- Update the fishing controls description in `docs/GDD.md` if it describes casting again.

## Deliver
Commit, push, and open a PR titled `Fix: fishing results vanish when casting again quickly`. The PR body gives the root cause, the new behaviour, and the names of the new tests.
