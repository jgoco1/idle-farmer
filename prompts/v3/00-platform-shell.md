# v3 Phase 00: The Platform Shell

> **Recommended model:** Opus 5.5. This phase changes how the game boots, saves and reacts to being paused, which every later platform phase depends on. A mistake here loses saves.
> **Depends on:** v2 phase 05 merged (and any open fix PRs).
> **Docs win:** where this prompt conflicts with `docs/`, follow `docs/` and note the difference in `docs/PROGRESS.md`.

## Role and goal
The game is a single web page today: it saves to `localStorage`, assumes it lives at `/idle-farmer/`, and only knows browser events. v3 ships it as an **Android and iOS app** (v3-01) and a **Steam game for Windows, macOS and Linux** (v3-02, with optional gamepad and Steam Deck support in v3-03).

This phase builds the **platform layer** those shells plug into, and makes the web version an installable, offline-capable app on the way. **No native code and no new runtime dependency in this phase.** When it is done, the web game must behave exactly as before.

## Owner decisions (fixed)
- **No ads, no in-app purchases, no accounts, no analytics, no network calls** from the game. The privacy policy can then honestly say "this game collects no data".
- **One codebase.** The web build, the mobile apps and the desktop app run the same `src/`. Platform differences live behind one interface, chosen at boot.
- **Saves stay local to the device.** Steam Cloud (v3-02) syncs a file and needs no code; cross-platform sync is out of scope. Export and import of a save (Settings) stay available everywhere.

## Read first
- `CLAUDE.md`, and the latest "Next-phase notes" in `docs/PROGRESS.md`.
- `src/main.ts`: `safeStorage()`, `save`, `onHide` / `onResume`, `beforeunload`, the `?debug` overlay and `window.__game` / `window.__view`.
- `src/core/save.ts` (`SaveStorage`, `loadGame`, `writeSave`, `exportSave`, `importSave`) and `src/core/prefs.ts`.
- `src/core/offline.ts` (the catch-up after time away).
- `src/audio/engine.ts` (`resume()` of the `AudioContext`).
- `src/core/prefs.ts` (v2-05 added `paint`) and `src/render/sceneInput.ts` / `src/ui/inspectLabel.ts` (Paint strokes and tap-to-inspect), which the back order must respect.
- `vite.config.ts` (`base`), `index.html`, `public/manifest.webmanifest`, `.github/workflows/`.

## Requirements

### 1. A platform interface (`src/platform/`)
- `src/platform/types.ts` defines a `Platform` with:
  - `kind`: `'web' | 'android' | 'ios' | 'desktop'`
  - `storage`: async `read(key)`, `write(key, text)`, `remove(key)`
  - `onPause(fn)` and `onResume(fn)`: the app is backgrounded, minimised, or the screen locks
  - `onBack(fn)`: the Android back button or a gamepad B; returns whether it was handled
  - `quit()`: or `null` where quitting isn't a thing (web, iOS)
  - `exportFile(name, text)`: download on the web; native share or save dialog later
  - `achievements`: `{ unlock(id) }` or `null`, a seam for Steam
  - `safeAreaInsets`: or rely on CSS, see 4
- `src/platform/web.ts` implements it for browsers. It uses `localStorage` with today's fallback to memory, `visibilitychange` / `pagehide` for pause and resume, and `onBack` is a no-op.
- `src/platform/index.ts` picks the implementation at boot. Native shells will announce themselves later, through a global the shell injects, or through Capacitor's own global. Keep the detection in this one file. Use dynamic `import()` so the web bundle never contains another platform's code.
- **Systems never see the platform.** `src/core/` keeps its rules (only `main.ts` reads the clock); the platform reaches the game only through `main.ts`.

### 2. Saving that can't be lost
Native storage is asynchronous, but the game saves synchronously today.
- **Keep the game's save path synchronous** over an in-memory copy. At boot, `await` the platform's `read` of the save and prefs before creating the `Game`. A save then writes the memory copy at once and persists it asynchronously. Writes are serialised: never two in flight; the last one wins.
- On `onPause`, on the autosave interval, and before `quit()`, **flush** and wait for it where the platform allows.
- **Rotating backups:** keep the previous good save as `save.bak` (and up to 3 older ones on native platforms). If the main save fails to parse, offer the backup in the existing "your save could not be loaded" dialog, next to Export. **Never overwrite a save that failed to load** (the existing rule).
- Prefs (camera, UI scale, volumes) go through the same storage under their own key.
- Tests: an in-memory fake platform storage. Cover:
  - boot waits for the read
  - a burst of saves leaves the last state
  - a failed write is retried and reported once (a toast), never silently dropped
  - the backup rotates only after a save that validates
  - a corrupt main save offers the backup
  - the web adapter's memory fallback

### 3. Lifecycle
- **Pause:** save and flush, suspend the `AudioContext`, and stop the render loop (the loop already sleeps when hidden; make it explicit through `onPause`).
- **Resume:** run the offline catch-up exactly as returning to the tab does today (`onResume` in `main.ts`), then resume audio after the next user gesture (mobile rules).
- **Back** (`onBack`), in order:
  1. close an open modal
  2. leave Decorate, plant or build mode (or end a Paint stroke)
  3. close the open panel
  4. clear a tap-to-inspect label (`renderer.inspected`, v2-05)
  5. otherwise return `false`, so the shell can minimise the app (Android) or ask to quit (desktop)

  Escape keeps doing the same on the web. One function in `main.ts` implements the order, and both use it.

### 4. Screens with notches and rounded corners
- Use `env(safe-area-inset-*)` so the HUD, toolbar, panels (including the phone bottom sheet), toasts and the tutorial card never sit under a notch, the home indicator or rounded corners, in portrait and landscape. Follow the CLAUDE.md "Interface size" rule: insets are real pixels, so do not multiply them by `--ui-scale` inside zoomed elements.
- Add a debug toggle that fakes insets (for example 44 px top and 34 px bottom) so e2e can check them in plain Chromium.

### 5. Builds for shells
- A second build mode for the shells: `npm run build:app` writes `dist-app/` with `base: './'`, no `?debug` overlay, and no `window.__game` / `__view` unless `VITE_E2E=1`. The Pages build (`npm run build`, `/idle-farmer/`) is unchanged.
- Everything the app loads must come from the bundle: no CDN fonts or remote assets. Check this with a test that scans `dist-app` for `http` URLs other than in comments and licences.

### 6. An installable, offline web app
- Add a **hand-written service worker** (no plugin dependency). It precaches the built files from a list a small build script generates, serves them cache-first, and updates on the next launch. Show "A new version is ready, reload to update" as a toast; never reload by itself in the middle of play.
- Register it only in the Pages build, never in `dist-app` (the shells serve local files).
- Check the manifest (name, icons including a maskable 512 px icon, `display: standalone`, colours) so Chromium offers "Install".
- e2e: load once, go offline (`context.setOffline(true)`), reload, and the farm still loads with the save intact.

### 7. Store-ready basics (shared by every store)
- `docs/privacy.md`, rendered to `privacy.html` on Pages: no data collected, saves stay on the device, no network access. The owner links it from the store listings.
- `docs/STORE.md`:
  - a short and a long description
  - feature bullets
  - the content rating answers (no violence, no chance-based items, no user content, no data collection)
  - a screenshot shot list per store (phone portrait, tablet, 16:9 desktop)
  - the **icon and art sizes** each store asks for, as a checklist for the owner
- A script `npm run shots:store` that uses Playwright, writing through the `shot()` helper in `e2e/helpers.ts` (v2-05), to capture those screenshots at the right sizes from a prepared demo save (`tests/fixtures/` style). Mark any size you couldn't verify as such.

## Save
No `SAVE_VERSION` change: the save's shape does not change, only where it is stored. Backups use the same format.

## Tests (minimum)
- The storage layer and backups (requirement 2), against the fake.
- The back order (requirement 3) as a unit test over a small stand-in for the UI state, and in e2e by pressing Escape.
- Offline reload (requirement 6).
- Fake insets keep the HUD, toolbar and an open panel inside the safe area on a 390 × 844 viewport (requirement 4).
- `dist-app` has relative URLs, no debug hooks and no remote URLs (requirement 5).
- Everything in the quality bar, including the perf spec.

## Out of scope
Capacitor, Electron, Steam and any native project (v3-01, v3-02). Push or local notifications, cloud sync, accounts. A game rename: the working title stays, and `docs/STORE.md` leaves the final name as a placeholder (see owner steps).

## Owner steps (not for the session)
- **Pick the final game name and an app id** before v3-01, for example `io.github.jgoco1.hearthfield`. Store ids can't be changed after the first upload.
- Optionally, check the installed web app on your own phone (Chrome: Install app; Safari: Share → Add to Home Screen).

## Definition of done
- `npm run typecheck && npm run lint && npm test && npm run build && npm run build:app && npm run test:e2e` pass. Both CI jobs are green; add `build:app` to the `check` job.
- The web game plays exactly as before, and an old save loads.
- A "v3 Phase 00" entry in `docs/PROGRESS.md`. Update CLAUDE.md with a short "Platform conventions" section covering:
  - where `Platform` lives
  - the async storage with a sync game
  - the back order
  - safe areas
  - `build:app`
- Open a PR titled `v3 Phase 00: Platform shell`.
