# v3 Phase 01: Android and iOS Apps (Capacitor)

> **Recommended model:** Sonnet 5.5. The architecture is set by v3-00; this phase is wiring and build tooling. Use Opus 5.5 if the session gets stuck on Gradle or Xcode problems twice.
> **Depends on:** v3 phase 00 merged. The owner has picked the final name and app id.
> **Docs win:** where this prompt conflicts with `docs/`, follow `docs/` and note the difference in `docs/PROGRESS.md`.

## Role and goal
Wrap the game in **Capacitor** so it ships on the Google Play Store and the Apple App Store from the same `src/`, using the `Platform` interface from v3-00. The result is:
- an Android project that builds a signed release bundle (AAB) in CI when the signing secrets exist, and a debug APK otherwise
- an iOS project that builds for the simulator in CI
- a short guide for the owner's part

## Allowed dependencies
This phase may add **`@capacitor/core`, `@capacitor/cli`, `@capacitor/android`, `@capacitor/ios`, `@capacitor/app`, `@capacitor/filesystem`, `@capacitor/status-bar`, `@capacitor/splash-screen`** and, as a dev dependency, **`@capacitor/assets`**. Use their current major version.
- Platform code imports them **only** from `src/platform/capacitor.ts`, loaded by dynamic `import()`. The Pages bundle must not grow; check its size before and after, and record both.
- No other dependency. In particular: no ads, analytics, crash-reporting or notification SDKs.

## Read first
- `CLAUDE.md`, especially "Platform conventions" from v3-00, and the v3-00 entry in `docs/PROGRESS.md`.
- `src/platform/`, `src/main.ts` (boot, back order), `docs/STORE.md`, `docs/privacy.md`.
- Capacitor's own docs for the version you install. Follow them over this prompt where they differ, and note it.

## Requirements

### 1. The projects
- `capacitor.config.ts` at the repo root: the owner's app id and name, `webDir: 'dist-app'`, and Android's `androidScheme: 'https'` (so storage and audio behave like a secure origin). Native projects in `android/` and `ios/` as Capacitor generates them, committed.
- npm scripts:
  - `cap:sync`: `build:app`, then `npx cap sync`
  - `android:debug`: a Gradle debug build
  - `ios:sim`: an `xcodebuild` simulator build, no signing; it runs on macOS only and says so elsewhere
- `.gitignore` excludes build output, Gradle caches, Pods and `local.properties`.

### 2. `src/platform/capacitor.ts`
- **Storage:** `@capacitor/filesystem` in the app's data directory (`Directory.Data`), one file per key, UTF-8. Write to `key.tmp`, then rename over `key`, so a crash mid-write never corrupts the save. Keep v3-00's rotating backups. **Do not use WebView `localStorage` for the save**, because the OS may clear it. On first launch, migrate a `localStorage` save if one exists (a player who used an early build), then leave the old copy in place.
- **Lifecycle:** `App.addListener('pause' | 'resume')` drives `onPause` and `onResume`. `appStateChange` is a fallback.
- **Back button (Android):** `App.addListener('backButton')` calls the v3-00 back order. When nothing is left to close, `App.minimizeApp()`. Never quit: idle games keep their state.
- **Export save:** write the export to the cache directory, then use the native share sheet. A small plugin-free route is fine if Capacitor's `Share` would be a new dependency; otherwise list `@capacitor/share` in the PR as an extra dependency with the reason.
- `kind` is `'android'` or `'ios'` from `Capacitor.getPlatform()`.

### 3. Look and feel on a phone
- **Status bar:** overlay the web view, with light or dark icons to suit the HUD. v3-00's safe-area CSS keeps the HUD clear of it.
- **Splash and icons:** generate from one source image with `@capacitor/assets`. Commit the source in `assets/` (pixel art scaled with nearest-neighbour, never smoothed) and the generated files. Android adaptive icon with a plain background layer.
- **Orientation:** portrait and landscape on phones and tablets. Check that the phone bottom sheet and the toolbar's compact mode work in both.
- **Text input** (naming animals): the keyboard must not cover the field. Scroll it into view; test on the 390 × 844 phone viewport with a simulated keyboard inset if possible.
- **Audio** starts after the first tap, as on the web, and stops when the app is backgrounded.
- **No pinch-zoom of the page**, only of the camera (already true on the web; check in the WebView).

### 4. CI (GitHub Actions; the repo is public, so runner minutes are free)
- **Android:** a job on `ubuntu-latest` with JDK 21 and the Android SDK:
  1. `npm ci`
  2. `npm run cap:sync`
  3. `./gradlew assembleDebug`
  4. upload the APK as an artifact

  When the secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD` exist, also run `bundleRelease` signed with them and upload the AAB. Never print the secrets, and never commit a keystore.
- **iOS:** a job on `macos-latest`: `cap sync ios`, then `xcodebuild … -sdk iphonesimulator CODE_SIGNING_ALLOWED=NO build`. It only proves the project builds. Signing and upload stay with the owner.
- Run both on pushes to `main` and on PRs that touch `android/`, `ios/`, `capacitor.config.ts` or `src/platform/`, so ordinary game PRs stay fast.
- **Versioning:** `versionName` and the iOS marketing version come from `package.json`'s `version`; `versionCode` and the build number come from the CI run number. Document how to bump them.

### 5. Testing what can be tested in a container
There is probably no Android emulator or iOS simulator in the session's container. Don't spend the session trying to boot one.
- Unit-test `capacitor.ts` against a **mocked plugin layer**:
  - atomic writes
  - backup rotation
  - the `localStorage` migration
  - pause and resume wiring
  - the back button minimising only when nothing is open
- Keep the web e2e suite green (it is the same UI); add an e2e run of the `dist-app` build on the phone viewports.
- Write **`docs/MOBILE_TESTING.md`**: a 15-minute manual checklist for the owner on a real device, covering:
  - install
  - first launch and the tutorial
  - play 5 minutes
  - background for 10 minutes, then come back (the away summary)
  - kill the app from the app switcher and relaunch (the save is intact)
  - the back button at every level
  - rotate
  - export a save
  - airplane mode (still plays)
  - a low-storage warning, if the OS shows one

### 6. Store listing support
- `npm run shots:store` (from v3-00) also produces Play and App Store screenshot sizes. Phone and 7-inch / 10-inch tablet for Play; 6.9-inch and 6.5-inch iPhone and 13-inch iPad for Apple, or whatever sizes the stores currently require: check, and note what you checked.
- Add a **Play feature graphic** (1024 × 500) built from game sprites by a script, plus the 512 px store icon.
- Update `docs/STORE.md` with the Data safety answers (no data collected or shared), the age rating answers, and the App Store privacy "nutrition label" (Data Not Collected).

## Save
No `SAVE_VERSION` change. The save file's format is the same; only its location changes on mobile. A test proves a web export imports on the app and back.

## Tests (minimum)
- The mocked Capacitor adapter (requirement 5).
- The export / import round trip between `web` and `capacitor` storage.
- The Pages bundle size is unchanged (± 1 KB) with Capacitor installed.
- Everything in the quality bar; the new Android job green; the iOS simulator build green.

## Out of scope
- Notifications ("your crops are ready") and widgets: add a line to `docs/IDEAS.md` with the design question (gentle, opt-in, at most one a day).
- Haptics.
- Tablet-specific layouts beyond "nothing overlaps".
- Steam (v3-02).
- In-app review prompts.
- Any purchase.

## Owner steps (not for the session; prices and rules change, check the stores' current terms)
- **Google Play:**
  - Create a Play Console developer account. There is a one-time fee, and new personal accounts must run a closed test with a number of testers for a period before production; check the current rule.
  - Create the app with the chosen id, and generate an upload keystore. Keep two backups; Play App Signing holds the real key.
  - Add the four `ANDROID_*` secrets to the repo.
  - Upload the CI-built AAB to internal testing, then the closed test.
  - Fill in the listing, Data safety, content rating, the privacy policy URL (Pages `privacy.html`) and the price.
- **Apple:**
  - Enrol in the Apple Developer Program (yearly fee).
  - You need a Mac with Xcode, or a cloud build service, to sign and upload: open `ios/App/App.xcworkspace`, set your team, Product → Archive, then upload to App Store Connect.
  - Test with TestFlight, fill in the privacy label and age rating, and submit for review.
  - The App Store sometimes rejects "repackaged websites". A full offline game with native saving, back handling and no remote content is normally fine. Make sure the build has no debug hooks and works in airplane mode.
- Run `docs/MOBILE_TESTING.md` on at least one Android phone and one iPhone before submitting.

## Definition of done
- The quality bar passes, plus `npm run cap:sync` and `npm run android:debug` in the container if the Android SDK can be installed there. If it can't, the CI job is the proof; say which.
- The Android and iOS CI jobs are green on the PR. The APK artifact installs on a phone (the owner checks; list it in the PR as a manual step).
- A "v3 Phase 01" entry in `docs/PROGRESS.md`. The CLAUDE.md platform section gains the Capacitor files, scripts and CI jobs.
- Open a PR titled `v3 Phase 01: Android & iOS apps`.
