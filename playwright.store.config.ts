import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// `npm run shots:store` (v3 phase 00): store screenshots at each store's sizes from the demo save
// (tests/fixtures/store-demo.json), written to store-shots/. Not part of the e2e suite.
export default defineConfig({
  ...base,
  testDir: 'scripts/store',
  projects: undefined,
  timeout: 120_000,
  use: { ...base.use, serviceWorkers: 'block' },
});
