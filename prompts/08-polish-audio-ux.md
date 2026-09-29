# Phase 08: Polish (audio, juice, tutorial, settings, mobile, accessibility)

> **Recommended model:** Sonnet 5.5. The work is broad but shallow: many small UX improvements across the existing UI.
> **Depends on:** Phase 07 merged.
> **Docs win:** the phase 00 owner decisions (`docs/GDD.md` §11) changed some details, including a real-time calendar with weekly seasons, timers in simulated minutes, and 7 buff types. Where this prompt conflicts with `docs/`, follow `docs/` and note the difference in `docs/PROGRESS.md`.

## Role and goal
All the systems now exist. This phase makes the game **feel** cozy. The work falls into four areas:
- sound and music
- satisfying feedback, or "juice"
- a first-time player experience
- solid settings, a good mobile layout and accessibility

Aim for the warm, tactile feel of Stardew Valley: every click should respond with a small sound and a small animation.

## Read first
`CLAUDE.md`, `docs/PROGRESS.md`, the Audio/Feel section of `docs/GDD.md`, `docs/ART_STYLE.md`, and the event bus. Most of this phase should be event listeners, so avoid changing game logic.

## Requirements
1. **Sound effects (`src/audio/sfx.ts`).**
   - Generate every sound procedurally with the **Web Audio API**: oscillators, noise and envelopes. There are no audio files and nothing is fetched over the network.
   - Write a small synth helper, plus named sounds for: hoe, plant, water, harvest pop, coin (with pitch that varies by amount), purchase, the fishing cast, the bite "!", reeling, the catch jingle, the fish escaping, cooking sizzle, dish ready, eating, buff gained, level up, goal complete, and panel open/close. Add a UI click for every button.
   - Audio starts only after the first user interaction, as browsers require.
2. **Music (`src/audio/music.ts`).** Add a gentle procedural or sequenced chiptune loop for each season (4 short themes), plus a softer night variation that plays during the local-clock night (20:00–06:00). Crossfade between them. It should be quiet by default and must never get grating. Short loops with slight variation work better than long compositions.
3. **Settings.** Add master, SFX and music volume sliders and a mute toggle, and persist them in the save or a separate prefs key. Add a reduced-motion toggle, which also follows `prefers-reduced-motion`. Add the "Relaxed fishing" toggle from phase 05, a UI scale option (1×, 1.5×, 2×), and number formatting (full numbers or 1.2K/3.4M).
4. **Juice.**
   - Particles through a small pooled particle system on the render layer: soil puffs when tilling, water droplets, a leaf burst on harvest, coins flying to the HUD gold counter on sales, splash ripples, cooking steam, and sparkle bursts for level-ups.
   - Tweens for the gold counter as it counts up, a slight bounce when a panel opens, squash and stretch on harvest pops, and a hover wobble on ready crops.
   - Screen feedback: a gentle shake of about 2px on a legendary catch only.
   - Respect the reduced-motion setting everywhere.
5. **Ambient life.** Add a few cheap, charming touches: butterflies by day, fireflies at night, a cat or dog sleeping by the farmhouse (clicking it gives a "pet" heart), drifting clouds that cast shadows, and seasonal visuals (spring blossoms, autumn leaves, winter snow on tiles, with snow shown only on non-crop tiles).
6. **First-time experience.** Add a short, skippable **tutorial overlay** for new saves that highlights the plots → seeds → water → harvest → sell → shop steps, then hands over to the milestone chain from phase 07. Also add a "Help" entry in Settings that replays the tutorial and shows a short glossary.
7. **Mobile and responsive.** At phone widths, panels become bottom sheets, touch targets are at least 44px, the minigame works with touch, and the scene can be panned or zoomed if it doesn't fit. Test at 360×740 and 390×844 in Playwright.
8. **Accessibility.** All panels can be used with the keyboard, focus is visible, ARIA labels are on the icon buttons, colour is never the only signal (ready crops get a sparkle as well as a colour change), and text contrast meets WCAG AA on the parchment panels.
9. **Page metadata.** Add a title, a favicon generated from a crop sprite at build time or as an inline SVG, a theme colour, and a minimal PWA manifest so the game can be installed. Don't add a service worker unless it is trivial to do safely.
10. **Loading and errors.** Show a brief pixel-art loading splash. If a save is corrupt, show a friendly error screen that offers to export the raw save and start fresh. Never lose data silently.

## Tests (minimum)
Settings persistence, the audio unlock logic (mock `AudioContext`), the reduced-motion flag skipping particles, the tutorial flow's state machine, and Playwright mobile-viewport runs of the smoke test with screenshots. Run a quick automated accessibility check (for example, `@axe-core/playwright`) on the main screen and one panel, and fix any serious findings.

## Out of scope
New content or systems. Rebalancing (phase 09). The Fullness meter (10).

## Definition of done
- All checks pass.
- Take desktop and mobile screenshots.
- Describe in the PR how the sound design works and how to adjust it.
- Add a PROGRESS.md Phase 08 entry.
- Open a PR titled `Phase 08: Polish, audio & UX`.
