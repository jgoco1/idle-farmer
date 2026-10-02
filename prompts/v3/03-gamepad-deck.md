# v3 Phase 03 (optional): Gamepad and Steam Deck

> **Recommended model:** Opus 5.5. It adds a third way to drive every screen (after mouse and touch), and it touches the camera, the farm tools, every panel and the fishing minigame without breaking the other two.
> **Depends on:** v3 phase 02 merged.
> **Docs win:** where this prompt conflicts with `docs/`, follow `docs/` and note the difference in `docs/PROGRESS.md`.

## Role and goal
Make the whole game playable with a **controller**, so the Steam build can be reviewed for **Steam Deck "Verified"**. Today the game is mouse, keyboard and touch only. On the Deck it would work through the touchscreen and trackpads ("Playable" at best).

## Owner decisions (fixed)
- Mouse, keyboard and touch keep working exactly as now. The game switches its on-screen hints to whichever input was used last.
- No new mechanics. Everything a mouse can do, a controller can do. Nothing is controller-only.

## Read first
- `CLAUDE.md` (world and camera conventions, platform conventions, per-frame garbage rules), and the v3-02 entry in `docs/PROGRESS.md`.
- `src/render/camera.ts`, `src/render/renderer.ts` (hover, `decorateMode` routing, `inspected`), `src/render/sceneInput.ts` (Paint strokes and `tapActs`, v2-05), `src/ui/inspectLabel.ts`, `src/ui/farmTools.ts`, `src/ui/panel.ts` and its `FOCUSABLE`, `src/ui/fishingPanel.ts`, `src/ui/decorate.ts`, `plantMode.ts`, `buildMode.ts`, `src/ui/modal.ts`, `src/ui/tutorial.ts`.
- Valve's current Steam Deck compatibility review criteria (input, text legibility, the on-screen keyboard, default config, resolution). Follow them, and list each criterion in the PR with how it is met.

## Requirements

### 1. Reading the pad (`src/ui/input/gamepad.ts`)
- Poll `navigator.getGamepads()` once a frame in the main loop, using the standard mapping only. Give the sticks a dead zone, and add repeat-on-hold for the D-pad (a delay, then a rate).
- Turn presses into a small set of **commands**: `confirm`, `back`, `menu`, `toolNext`, `toolPrev`, `panelNext`, `panelPrev`, `zoomIn`, `zoomOut`, `cursor(dx, dy)` and `pan(dx, dy)`. Everything below consumes commands, not buttons, so remapping is possible later.
- **No allocation per frame:** reuse the command buffer, and keep axis state in typed arrays (CLAUDE.md).
- Track the **last input** (`mouse`, `touch`, `keyboard` or `gamepad`) as a body class and a small store, so glyphs and the cursor appear only while the pad is in use.

### 2. In the world
- **A tile cursor:** the left stick or D-pad moves a highlighted tile. It snaps to tiles, keeps a short repeat, and the camera follows when the cursor nears the view edge (through the existing `panToTile` and easing, never by moving the world). The right stick pans freely; the triggers or bumpers zoom (the integer zoom steps).
- `confirm` on the cursor does exactly what a click on that tile does: the farm tool on a plot, opening a zone, picking a tree, collecting from a building, petting. It goes through the same `onPlotClick` / `onZoneClick` / `onSignClick` routes, so there is no second set of rules.
- Decorate, plant and build modes work with the cursor: `confirm` places or picks up, a face button flips (`F` today), and `back` drops or leaves.
- The label (`src/ui/inspectLabel.ts`) shows for the cursor tile as it does on mouse hover; use the renderer's `inspected` target rather than a second label.
- **Paint mode** works with the cursor: holding `confirm` while moving the cursor over plots is a stroke (`onPaintStart` / `onPaintPlot` / `onPaintEnd`), when the Paint pref is on.

### 3. In the panels and dialogs
- **Spatial navigation** between focusable elements in the open panel or modal: the D-pad moves focus to the nearest element in that direction. Write it as a pure, unit-tested function over element rectangles. `confirm` activates the focused element, `back` runs the v3-00 back order, and the bumpers switch tabs inside a panel.
- **A clear focus ring**, visible at 1280 × 800 and with the interface size at 1.5×.
- **The toolbar:** `menu` opens a radial-free toolbar focus mode (focus jumps to the toolbar buttons), or the bumpers cycle panels directly. Choose one, and justify it in the PR.
- Sliders (volumes) change with left and right; checkboxes toggle with `confirm`.
- **Text fields** (animal names): on Steam, open the **Deck's on-screen keyboard** through the v3-02 bridge (`steamworks.js`'s floating gamepad text input). Elsewhere, focus the field normally.

### 4. Fishing
`confirm` (or a trigger) is the minigame button: hold to charge and release to cast, hold to reel. Keep the result pause from the fishing fix. Add gentle controller rumble on a bite if the Gamepad API offers it, off by default.

### 5. Glyphs and hints
- Button prompts beside the actions that matter: the farm tools, the panel close button, the fishing button and Decorate mode. They show while the gamepad is the last input, in **Xbox, PlayStation or Steam Deck** style, picked from the pad's id string, with a Settings override.
- Draw the glyphs as small pixel sprites in the existing sprite system. Don't add a font or an image pack.
- The tutorial's text adapts ("Press A to till" instead of "Click a plot").

### 6. Steam Deck specifics
- **1280 × 800 is the target:** check every panel and the HUD there at the default interface size. If any text is under Valve's minimum legible size, make 1.5× the Deck default (detected through the platform info, first launch only).
- **Steam Input:** document a recommended default controller config in `desktop/steam/README.md`: "Gamepad", with the right trackpad as a mouse for anyone who wants it.
- **Suspend and resume** (the Deck's sleep) is the v3-00 pause and resume. Test it as minimise and restore.
- No launcher, no mouse-only dialogs (the save-error dialog, the export dialog), and no tiny buttons: everything is reachable by pad.

## Tests (minimum)
- **Unit:** the command mapper (dead zones, repeat timing with a fake clock), spatial navigation over sample layouts, the cursor's camera-follow maths, and the glyph style from pad ids.
- **e2e** with a stubbed `navigator.getGamepads` (inject a fake pad whose buttons the test sets):
  - move the cursor to a plot and till, plant, water and harvest
  - open the Shop with the bumpers, buy seeds by D-pad and `confirm`, and close it with `back`
  - cast and reel a fish
  - place a decoration
  - rename an animal (the field gets focus)
  - glyphs appear after a pad press and disappear after a mouse move
- **Performance:** per-frame allocation stays under the budget with the pad polled. Mouse and touch e2e stay green.

## Out of scope
Remapping UI (commands make it possible later), split screen, local multiplayer, and analog-stick tool painting.

## Owner steps
- Run through the game on a Deck, or with a controller on desktop. Then request a Steam Deck compatibility review on Steamworks; Valve tests it and reports what fails.
- Publish the recommended Steam Input config as the official default.

## Definition of done
- The quality bar and the desktop e2e pass.
- The PR lists every Deck review criterion and how it is met.
- A "v3 Phase 03" entry in `docs/PROGRESS.md`. The CLAUDE.md input section explains commands, the cursor, spatial navigation, and "every new clickable thing must be reachable by the cursor or by focus".
- Open a PR titled `v3 Phase 03: Gamepad & Steam Deck`.
