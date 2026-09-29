import { defineConfig } from 'vitest/config';

// `base` makes the build work on GitHub Pages under /idle-farmer/.
export default defineConfig({
  base: '/idle-farmer/',
  build: { target: 'es2022', sourcemap: true },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
