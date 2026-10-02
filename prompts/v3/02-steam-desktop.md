# v3 Phase 02: Steam for Windows, macOS and Linux (Electron)

> **Recommended model:** Opus 5.5. Electron's security settings, a native Steam module, three operating systems and cloud saves all have to be right together, and most of it can only be checked in CI.
> **Depends on:** v3 phase 00 merged (v3-01 is independent and may come first or after).
> **Docs win:** where this prompt conflicts with `docs/`, follow `docs/` and note the difference in `docs/PROGRESS.md`.

## Role and goal
Ship the game as a desktop app for **Steam on Windows, macOS and Linux**, built from `dist-app` through the v3-00 `Platform` interface. It should feel like a proper desktop game:
- a window that remembers its size, and fullscreen
- saves in a real file that **Steam Cloud** syncs
- **Steam achievements** for the milestones
- clean quitting
- builds that CI produces for all three systems

## Owner decisions (fixed)
- **Electron**, not Tauri. Its Chromium is the same engine as the e2e suite, and `steamworks.js` supports it. Tauri's system web views (WebKitGTK on Linux especially) would need their own test pass. Note the size trade-off in the PR.
- Achievements map to the **existing milestones**. No new achievement-only goals, and nothing that rewards grinding.
- Steam Cloud uses **Auto-Cloud** (configured on Steamworks), so the game needs no cloud code.

## Allowed dependencies
These live in **`desktop/package.json`**, a separate package so the game's root package is untouched:
- `electron`
- `electron-builder`
- `steamworks.js`
- `@playwright/test`, as a dev dependency for Electron e2e if the root one can't be reused

Nothing new in the web bundle.

## Read first
- `CLAUDE.md`, especially "Platform conventions", and the v3-00 (and v3-01, if merged) entries in `docs/PROGRESS.md`.
- `src/platform/`, `src/main.ts`, `docs/STORE.md`.
- Electron's security checklist, and the `steamworks.js` README, for the versions you install.

## Requirements

### 1. The shell (`desktop/`)
- `desktop/src/main.ts` (TypeScript, built with `tsc` or esbuild from `desktop/`):
  - **Window:** one `BrowserWindow` with `contextIsolation: true`, `nodeIntegration: false` and `sandbox: true`; no remote content. 1280 × 800 by default, a minimum of 960 × 600, and size, position and maximised / fullscreen state remembered in a small JSON file next to the saves. F11 and Alt+Enter toggle fullscreen. Hide the menu bar on Windows and Linux; keep a minimal app menu on macOS (About, Hide, Quit).
  - **Content:** served from `dist-app` through a **custom protocol** (`app://hearthfield/`), not `file://`, so the origin and relative paths are stable. Block navigation and `window.open`. If anything ever needs to open a link, open it in the system browser after an allow-list check.
  - **Single instance:** a second launch focuses the first.
  - **Quitting:** before the window closes, the renderer flushes the save (the v3-00 `quit()` path), with a short timeout so a hung renderer can't block quitting forever.
- `desktop/src/preload.ts` exposes the smallest possible API through `contextBridge`:
  - `storage.read`, `write` and `remove`
  - `quit`
  - `toggleFullscreen`
  - `achievements.unlock(id)`
  - `exportFile(name, text)`
  - `platformInfo`

  Validate every argument in the main process (string keys from an allow-list, a size cap on writes).
- **`src/platform/desktop.ts`** in the game implements `Platform` over that bridge, and `src/platform/index.ts` detects it.

### 2. Saves on disk
- In `app.getPath('userData')/saves/`: atomic writes (temporary file, then rename), plus v3-00's rotating backups.
- Write the exact path for each OS in `docs/STORE.md`, so the owner can set up Steam Auto-Cloud. Cover the save and backups, but not the window-state file, which is per machine.
- Export uses the system save dialog; Import reads a file the player picks.
- On first launch, nothing to migrate: the desktop app has never stored anything before.

### 3. Steam
- `steamworks.js` is initialised in the main process **only when it can be**: with Steam running and an app id. Without Steam (a CI run, a non-Steam build) the game runs normally and achievements are a no-op. Read the app id from `steam_appid.txt` in development (Valve's test app id 480 works for local testing) and from the packaged build otherwise. **Never require Steam to play.**
- **Achievements:** `src/data/achievements.ts` maps each milestone id (the `MILESTONES` in `src/data/quests.ts`) to a Steam achievement API name such as `ACH_FIRST_HARVEST`, with its display name and description. `main.ts` listens for `questDone` events with `kind: 'milestone'` on the bus and calls `platform.achievements?.unlock(name)`. On boot, it also unlocks every milestone the save already has (idempotent), so old saves and other devices catch up.
- A script `npm run steam:achievements` in `desktop/`:
  - writes `desktop/steam/achievements.csv` (API name, display name, description) for the owner to enter on Steamworks
  - renders **64 × 64 icons** for each, from game sprites: an unlocked colour version and a greyed locked version
- **Steam overlay:** enable it as `steamworks.js` documents for Electron. If it doesn't render reliably (a known Electron issue), document that and leave it off rather than hurting frame rate.

### 4. Builds (`electron-builder`)
- **Windows:** x64, an unpacked directory for Steam (no installer needed; Steam installs it). **macOS:** a universal `.app`, hardened runtime, with notarization when the secrets exist. **Linux:** x64, an unpacked directory that runs under the Steam Linux Runtime.
- Name the app and files with the owner's final name; use the v3-00 icon set (`.ico`, `.icns`, `.png`).
- CI (GitHub Actions, public repo): a matrix on `windows-latest`, `macos-latest` and `ubuntu-latest`:
  1. builds `dist-app`
  2. builds the shell
  3. packages
  4. uploads each build as an artifact

  The macOS job signs and notarizes only when `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` and `CSC_LINK` / `CSC_KEY_PASSWORD` are set; otherwise it builds unsigned and says so. Run it on `main` and on PRs touching `desktop/` or `src/platform/`.
- **Uploading to Steam stays manual** in this phase. Write `desktop/steam/README.md` for the owner:
  - SteamPipe depots per OS
  - the app build VDF templates, which you write
  - `steamcmd +run_app_build`
  - setting a build live on a beta branch first

### 5. Desktop feel
- Offer **mouse wheel zoom** and the existing keyboard controls. Make sure Escape and the v3-00 back order never quit the game; quitting is the window close, Cmd+Q or Alt+F4.
- Make the **interface size** default to 1.5× when the window is at least 1600 px wide on first launch only; the player's choice in Settings wins after that.
- Add **pause when minimised** (the v3-00 `onPause`), with the offline catch-up on restore, exactly as a hidden tab.
- Settings gains **Fullscreen** and **Quit** buttons on desktop only.

### 6. Testing
- **Unit tests** (Node, in `desktop/`): argument validation in the main process, atomic save writes and backups in a temporary directory, the protocol handler refusing paths outside `dist-app`, and the achievement map covering every milestone with unique API names.
- **Electron e2e** with Playwright's Electron support on the Linux CI job (under `xvfb-run`):
  - launch the packaged app
  - the farm renders
  - plant and harvest a turnip
  - close
  - relaunch: the save is intact
  - a milestone unlock calls the bridge (with Steam absent, through a test hook that records the calls)
- The web suite and the mobile jobs stay green.

## Save
No `SAVE_VERSION` change.

## Tests (minimum)
As in requirement 6, plus everything in the quality bar.

## Out of scope
- Gamepad and Steam Deck support (v3-03).
- Steam Workshop, trading cards, leaderboards and multiplayer.
- Rich presence: optional. If it's a few lines, add it with no personal data, such as "Farming in Spring, Year 2". Otherwise list it in IDEAS.md.
- Automatic Steam uploads from CI.
- Any DRM beyond Steam's own.

## Owner steps (not for the session; check Valve's current terms and fees)
- **Steam:**
  - Join Steamworks and pay the per-app fee (Steam Direct), then fill in the tax and bank forms.
  - Create the app. Set Auto-Cloud to the save paths in `docs/STORE.md`.
  - Enter the achievements from `achievements.csv` with the generated icons.
  - Build the store page: capsule images in Steam's listed sizes, screenshots from `npm run shots:store` at 1920 × 1080, and the description from `docs/STORE.md`.
  - Valve asks for a "Coming soon" page to be live for a while before release, and reviews both the store page and the build.
- **macOS signing:** an Apple Developer account (the same one as iOS), a Developer ID Application certificate, and the notarization secrets in the repo. Without them, macOS players get a Gatekeeper warning, so don't ship the Mac build unsigned.
- Play the CI builds on each OS you can reach. Steam's own client can launch a non-Steam game for a quick check.

## Definition of done
- The quality bar passes; the desktop unit tests and Electron e2e pass; the three-OS build matrix is green, and its artifacts launch (the owner checks Windows and Mac by hand: list it in the PR).
- A "v3 Phase 02" entry in `docs/PROGRESS.md`. The CLAUDE.md platform section gains `desktop/`, the bridge API, the save paths and the achievement map rule ("every new milestone gets an achievement row").
- Open a PR titled `v3 Phase 02: Steam desktop builds`.
