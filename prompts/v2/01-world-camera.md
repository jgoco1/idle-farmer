# v2 Phase 01: Bigger World and Pannable Camera

> **Recommended model:** Opus 5.5. This changes the coordinate system under the renderer, hit-testing, placement, e2e tests and the save. It is the v2 counterpart of v1 phase 01.
> **Depends on:** v2 phase 00 merged. Its docs define the world size, regions, parcels and coordinates.
> **Docs win:** where this prompt conflicts with `docs/`, which v2 phase 00 updated, follow `docs/` and note the difference in `docs/PROGRESS.md`.

## Role and goal
Grow Hearthfield Idle's single fixed screen into a **larger world you can pan and zoom**. By the end of this phase:
- A v1 player's farm looks and works exactly as before, now as the "home" region of a bigger map.
- New regions exist as locked **land parcels** that can be bought with gold.
- The camera moves smoothly with mouse, touch and keyboard.
- The empty regions are scenery for now: the orchard, animal yard, decoration space and town square are only laid out and locked. Later v2 phases fill them.

## Read first
`CLAUDE.md`, the v2 sections of `docs/GDD.md`, `docs/BALANCE.md` and `docs/DATA_SCHEMAS.md`, `docs/ART_STYLE.md`, and the latest entries of `docs/PROGRESS.md`. Then read the code: `src/render/scene.ts` (layout, zones, `SCENE_W`/`SCENE_H`, hit-testing), `src/render/renderer.ts`, `src/render/ambient.ts` and `particles.ts`, `src/ui/sceneControls.ts` (the phase 08 zoom and pan), `src/ui/placement.ts`, `src/systems/placement.ts` and `expansions.ts`, `src/main.ts` (`sceneView()`), and every `e2e/*.spec.ts` (they click tiles with a 20 × 12 helper).

## Requirements
1. **World model.** Implement the world size, regions and tile coordinates from DATA_SCHEMAS.md. Put the world layout (regions, parcels, water, paths, decoration tiles) in `src/data/` or a `scene.ts` layout table, not scattered constants. The v1 area maps into the world exactly as the docs say, and v1 plot indexes, trap spots, placed objects and zones keep working.
2. **Camera** (new `src/render/camera.ts`, pure and unit-tested):
   - It holds a world position and a zoom, converts world to screen and back, and clamps at the world's edges.
   - Zoom levels are integer pixel scales only, so pixels stay crisp.
   - It follows the docs' default view: centred on the home region, sized to the viewport.
   - Controls: mouse drag, one-finger drag (replacing the phase 08 pan switch), pinch zoom, wheel or trackpad zoom around the cursor, arrow and WASD keys, a **Home** button, and a double-tap or double-click to zoom in.
   - A drag must never trigger a plot action. Use a small movement threshold, then treat the gesture as a pan.
   - **The camera position and zoom live in prefs** (`src/core/prefs.ts`), not the save.
3. **Rendering at scale:**
   - Draw only tiles and objects inside the viewport (culling).
   - Cache the static ground in chunks, for example 16 × 16 tiles, instead of one full-screen layer.
   - The day/night tint, ambient life (butterflies, fireflies, cloud shadows, snow) and particles work across the whole world, but only what is visible is simulated or drawn.
   - Keep the phase 09 rule that **nothing is allocated per frame**.
4. **Hit-testing and placement** use world coordinates through the camera. The placement preview, the farmhand's walking route, `tileRectClient` (used by the tutorial ring) and coin flights all follow the camera.
5. **Land parcels** (`src/data/parcels.ts` and a system in `src/systems/parcels.ts`, or an extension of `expansions.ts` if the docs say so):
   - A parcel is bought with gold, and some have farm level or prerequisite conditions.
   - Locked parcels look overgrown and show a "For sale" sign with a click hint.
   - Buying a parcel clears it with a small scene change and a toast.
   - Add a **Land** section to the Upgrades panel.
   - Parcels only make space for now. Don't add orchard, animal or decoration behaviour.
6. **Off-screen awareness.** Toasts for events outside the view already exist. Add small edge arrows or pips that point to off-screen ready things: ready crops, full traps, a finished dish. Clicking one pans the camera there. Hide them under reduced motion if they animate.
7. **Phone layout.** On narrow phones the scene now fills the space between the HUD and the toolbar at the largest integer zoom that fits, and panning replaces the fixed small view. This resolves the IDEAS.md entry about a small phone scene; mark it done.
8. **Test helpers.** Add a helper for e2e tests that clicks a **world** tile through the camera, for example `window.__game` or a test hook that returns the client position of a world tile, and update every existing spec to use it. The specs must not depend on the default camera position.
9. **CI.** Add an e2e job to `.github/workflows/ci.yml`: on GitHub runners, `npx playwright install --with-deps chromium` is allowed there. The browser tests then protect every future PR. Keep it a separate job so unit results still show quickly.
10. **Simulator.** Teach `scripts/sim/brain.ts` to buy parcels when the docs' pacing wants it. Update `scripts/sim/report.ts` with "gold still to spend", and run the tuning checks.

## Save
Bump to `SAVE_VERSION` 8 with a migration that maps a v7 save into world coordinates without changing anything the player sees. Add `tests/fixtures/save-v8.json`, a migration test, and update `tests/qa.test.ts`'s "a fixture for every save version".

## Tests (minimum)
- The camera's math: world to screen and back, clamping, zoom around a point, integer zoom levels.
- Pan versus click: a drag performs no action.
- Viewport culling: only visible chunks are drawn.
- The v7 → v8 migration, with every v1 zone, plot and trap still hit-tested correctly.
- Parcel purchase and its conditions.
- Off-screen pip targets.
- **Performance:** extend `e2e/perf.spec.ts` to a full world, including a pan across it. It must stay at 60 fps with no per-frame allocation, and 8 hours offline must still take under 100 ms.
- e2e tests for pan by mouse and by touch (Playwright touch emulation), the Home button, buying a parcel, and a phone-viewport run.

## Out of scope
Decorations and town projects (v2 phase 02), trees (03), animals (04), and new crops or recipes.

## Definition of done
- `npm run typecheck && npm run lint && npm test && npm run build && npm run test:e2e` all pass, and the new CI e2e job is green on the PR.
- Screenshots: the default view, zoomed out to show the whole world, and a phone view.
- `docs/PROGRESS.md` has a "v2 Phase 01" entry with Built, Deviations, Known issues and Next-phase notes. The notes should say exactly how later phases place things in regions and add parcels.
- `CLAUDE.md` is updated with the world-coordinate and camera conventions.
- Open a PR titled `v2 Phase 01: Bigger world & pannable camera`.
