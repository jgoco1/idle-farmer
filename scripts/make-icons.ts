// Generates the page icons and the PWA manifest in public/ from the ready-turnip sprite and the
// palette: icon.svg (favicon and splash), icon-192.png, icon-512.png, icon-maskable-512.png (v3 phase 00:
// the turnip inside the central safe circle, for launchers that crop icons) and manifest.webmanifest.
// Run after changing the sprite or palette:  npm run icons
// (PLAYWRIGHT_BROWSERS_PATH must point at the preinstalled Chromium, as for the e2e tests).

import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { colorOfKey, isPaletteKey, PALETTE } from '../src/render/palette';
import { SPRITES } from '../src/render/sprites';

/** The 16 px turnip on grass, `pad` cells from each edge (2 for the plain icon; 7 keeps it inside a maskable icon's safe circle). */
function svg(size: number, pad = 2): string {
  const rows = SPRITES.crop_turnip_4?.frames[0] ?? [];
  const box = 16 + pad * 2;
  const cells = rows.flatMap((row, y) =>
    [...row].map((ch, x) =>
      isPaletteKey(ch)
        ? `<rect x="${x + pad}" y="${y + pad}" width="1" height="1" fill="${colorOfKey(ch)}"/>`
        : '',
    ),
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${box} ${box}" width="${size}" height="${size}" shape-rendering="crispEdges"><rect width="${box}" height="${box}" fill="${PALETTE.grass_2}"/>${cells.join('')}</svg>`;
}

const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
const browser = await chromium.launch(browsersPath ? { executablePath: `${browsersPath}/chromium` } : {});
mkdirSync('public', { recursive: true });
writeFileSync('public/icon.svg', svg(512));
writeFileSync(
  'public/manifest.webmanifest',
  JSON.stringify(
    {
      id: './',
      name: 'Hearthfield Idle',
      short_name: 'Hearthfield',
      description: 'A cozy idle farming, fishing and cooking game in pixel art.',
      start_url: './',
      scope: './',
      display: 'standalone',
      orientation: 'any',
      lang: 'en',
      categories: ['games'],
      theme_color: PALETTE.wood_mid,
      background_color: PALETTE.grass_dark,
      icons: [
        { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
      ],
    },
    null,
    2,
  ) + '\n',
);
for (const [file, size, pad] of [
  ['icon-192.png', 192, 2],
  ['icon-512.png', 512, 2],
  ['icon-maskable-512.png', 512, 7],
] as const) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<body style="margin:0">${svg(size, pad)}</body>`);
  writeFileSync(`public/${file}`, await page.screenshot({ type: 'png' }));
  await page.close();
}
await browser.close();
console.log('icons written', readFileSync('public/icon-192.png').length, 'bytes');
