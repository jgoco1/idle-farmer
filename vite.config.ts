import { defineConfig } from 'vitest/config';
import { pwaPlugin } from './scripts/build/pwa.ts';

// Two builds (v3 phase 00):
// - the Pages build (`npm run build`, dist/): `base` /idle-farmer/ for GitHub Pages, plus the
//   service worker and privacy.html (scripts/build/pwa.ts);
// - the app build (`npm run build:app`, mode "app", dist-app/): relative URLs for the native shells,
//   no service worker, no debug overlay, and no e2e hooks unless VITE_E2E=1 (see src/main.ts).
export default defineConfig(({ mode }) => {
  const app = mode === 'app';
  return {
    base: app ? './' : '/idle-farmer/',
    build: { target: 'es2022', sourcemap: !app, outDir: app ? 'dist-app' : 'dist' },
    plugins: [pwaPlugin()],
    test: {
      include: ['tests/**/*.test.ts'],
      environment: 'node',
    },
  };
});
