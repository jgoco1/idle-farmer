// Generates the page icons and the PWA manifest in public/ from the ready-turnip sprite and the
// palette: icon.svg (favicon and splash), icon-192.png, icon-512.png and manifest.webmanifest.
// Run after changing the sprite or palette:  npx vite-node scripts/make-icons.ts
// (PLAYWRIGHT_BROWSERS_PATH must point at the preinstalled Chromium, as for the e2e tests).

import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { colorOfKey, isPaletteKey, PALETTE } from '../src/render/palette';
import { SPRITES } from '../src/render/sprites';

function svg(size: number): string {
  const rows = SPRITES.crop_turnip_4?.frames[0] ?? [];
  const cells = rows.flatMap((row, y) =>
    [...row].map((ch, x) =>
      isPaletteKey(ch)
        ? `<rect x="${x + 2}" y="${y + 2}" width="1" height="1" fill="${colorOfKey(ch)}"/>`
        : '',
    ),
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="${size}" height="${size}" shape-rendering="crispEdges"><rect width="20" height="20" fill="${PALETTE.grass_2}"/>${cells.join('')}</svg>`;
}

const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
const browser = await chromium.launch(browsersPath ? { executablePath: `${browsersPath}/chromium` } : {});
mkdirSync('public', { recursive: true });
writeFileSync('public/icon.svg', svg(512));
writeFileSync(
  'public/manifest.webmanifest',
  JSON.stringify(
    {
      name: 'Hearthfield Idle',
      short_name: 'Hearthfield',
      description: 'A cozy idle farming, fishing and cooking game in pixel art.',
      start_url: './',
      scope: './',
      display: 'standalone',
      theme_color: PALETTE.wood_mid,
      background_color: PALETTE.grass_dark,
      icons: [
        { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
      ],
    },
    null,
    2,
  ) + '\n',
);
for (const size of [192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<body style="margin:0">${svg(size)}</body>`);
  writeFileSync(`public/icon-${size}.png`, await page.screenshot({ type: 'png' }));
  await page.close();
}
await browser.close();
console.log('icons written', readFileSync('public/icon-192.png').length, 'bytes');
