// The screenshot sizes each store asks for (docs/STORE.md has the checklist). A shot is taken at
// `width × height` CSS pixels and `scale` device pixels per CSS pixel, so the file is
// (width × scale) × (height × scale). `verified: false` marks sizes not checked against the store's
// current documentation in this session: check them before uploading.

export interface ShotSize {
  store: 'google-play' | 'app-store' | 'steam';
  name: string;
  width: number;
  height: number;
  scale: number;
  touch: boolean;
  verified: boolean;
}

export const STORE_SIZES: readonly ShotSize[] = [
  // Google Play: 16:9 or 9:16, sides 320–3840 px; 1080 px or more for promotion.
  {
    store: 'google-play',
    name: 'phone-portrait',
    width: 360,
    height: 640,
    scale: 3,
    touch: true,
    verified: false,
  }, // 1080 × 1920
  {
    store: 'google-play',
    name: 'tablet-10in-landscape',
    width: 1280,
    height: 720,
    scale: 2,
    touch: true,
    verified: false,
  }, // 2560 × 1440
  // App Store: the 6.9" iPhone and 13" iPad sizes; smaller devices are scaled from these.
  {
    store: 'app-store',
    name: 'iphone-6.9in-portrait',
    width: 440,
    height: 956,
    scale: 3,
    touch: true,
    verified: false,
  }, // 1320 × 2868
  {
    store: 'app-store',
    name: 'ipad-13in-portrait',
    width: 1032,
    height: 1376,
    scale: 2,
    touch: true,
    verified: false,
  }, // 2064 × 2752
  // Steam: 16:9 screenshots, 1920 × 1080 recommended (1280 × 720 minimum).
  {
    store: 'steam',
    name: 'desktop-1080p',
    width: 1920,
    height: 1080,
    scale: 1,
    touch: false,
    verified: false,
  },
];
