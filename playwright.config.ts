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
    launchOptions: executablePath ? { executablePath } : {},
  },
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/idle-farmer/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
