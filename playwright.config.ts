import { defineConfig, devices } from '@playwright/test';

// Cloud sessions ship a preinstalled Chromium; never run `playwright install`.
const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
const executablePath =
  process.env.PW_CHROMIUM_PATH ?? (browsersPath ? `${browsersPath}/chromium` : undefined);

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  timeout: 30_000,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173/idle-farmer/',
    ...devices['Desktop Chrome'],
    // The first-time tutorial is covered by its own spec; every other test starts with it skipped.
    storageState: {
      cookies: [],
      origins: [
        {
          origin: 'http://localhost:4173',
          localStorage: [{ name: 'hearthfield-idle/prefs', value: JSON.stringify({ tutorial: 'skipped' }) }],
        },
      ],
    },
    launchOptions: executablePath ? { executablePath } : {},
    // The Pages build registers a service worker (v3 phase 00). Specs block it so every test loads from the
    // server and measures the same page; e2e/platform.spec.ts allows it for the offline test.
    serviceWorkers: 'block',
  },
  // The perf spec measures frame time, allocation and a load-time catch-up, all of which move with machine load,
  // so it runs by itself, after every other spec has finished (one worker, nothing else busy).
  projects: [
    { name: 'specs', testIgnore: /perf\.spec\.ts/ },
    { name: 'perf', testMatch: /perf\.spec\.ts/, dependencies: ['specs'], fullyParallel: false },
  ],
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/idle-farmer/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
