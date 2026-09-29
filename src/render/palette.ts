// The 47-colour palette (docs/ART_STYLE.md §1). Never write a hex colour anywhere else: sprites use
// the one-character keys, code uses PALETTE.<name>, and CSS uses the generated --c-<name> variables.

export const PALETTE = {
  // outline and neutrals
  outline: '#2b1d1a',
  shadow: '#4a3430',
  stone_dark: '#6b625c',
  stone_light: '#a09689',
  white_warm: '#fff4dc',
  // soil and sand
  soil_dark: '#4e3326',
  soil_mid: '#6f4a33',
  soil_light: '#8e6445',
  soil_wet_dark: '#35241c',
  soil_wet: '#4f3426',
  sand: '#dcc28e',
  sand_dark: '#b99a68',
  // grass and foliage
  grass_dark: '#44692e',
  grass_1: '#5d8a3a',
  grass_2: '#78a64a',
  grass_3: '#9cc062',
  leaf_dark: '#2f5231',
  leaf_light: '#b5d27a',
  // water
  water_1: '#2c5a84',
  water_2: '#3d7aab',
  water_3: '#68a6cc',
  water_foam: '#cde6ec',
  // wood and roof
  wood_dark: '#5a3a25',
  wood_mid: '#7d5634',
  wood_light: '#a67a4b',
  wood_pale: '#c9a26d',
  roof_dark: '#8a3a33',
  roof_light: '#b8573f',
  // produce and accents
  red: '#c9463b',
  red_light: '#e67a5f',
  orange: '#d9822b',
  orange_light: '#f0ab52',
  yellow: '#e3bf45',
  yellow_light: '#f6e08f',
  purple: '#74467f',
  purple_light: '#a574b0',
  pink: '#d98c98',
  pink_light: '#f3bcc0',
  berry_blue: '#4a5ea6',
  berry_blue_light: '#7a90d2',
  cream: '#efe4c8',
  // UI and lighting
  ui_parchment: '#f2e1b6',
  ui_parchment_dark: '#d8bd88',
  gold: '#f2c14e',
  gold_dark: '#c28b2c',
  night_tint: '#1d2748',
  dusk_tint: '#e0875a',
} as const;

export type PaletteName = keyof typeof PALETTE;

export const KEY_TO_NAME = {
  k: 'outline',
  K: 'shadow',
  n: 'stone_dark',
  N: 'stone_light',
  w: 'white_warm',
  d: 'soil_dark',
  s: 'soil_mid',
  S: 'soil_light',
  e: 'soil_wet_dark',
  E: 'soil_wet',
  y: 'sand',
  Y: 'sand_dark',
  h: 'grass_dark',
  g: 'grass_1',
  G: 'grass_2',
  H: 'grass_3',
  l: 'leaf_dark',
  L: 'leaf_light',
  b: 'water_1',
  B: 'water_2',
  c: 'water_3',
  C: 'water_foam',
  m: 'wood_dark',
  M: 'wood_mid',
  p: 'wood_light',
  P: 'wood_pale',
  r: 'roof_dark',
  R: 'roof_light',
  q: 'red',
  Q: 'red_light',
  o: 'orange',
  O: 'orange_light',
  u: 'yellow',
  U: 'yellow_light',
  v: 'purple',
  V: 'purple_light',
  i: 'pink',
  I: 'pink_light',
  j: 'berry_blue',
  J: 'berry_blue_light',
  x: 'cream',
  z: 'ui_parchment',
  Z: 'ui_parchment_dark',
  f: 'gold',
  F: 'gold_dark',
  t: 'night_tint',
  T: 'dusk_tint',
} as const satisfies Record<string, PaletteName>;

export type PaletteKey = keyof typeof KEY_TO_NAME;

/** The transparent pixel in sprite grids. */
export const TRANSPARENT = '.';

export function isPaletteKey(ch: string): ch is PaletteKey {
  return Object.prototype.hasOwnProperty.call(KEY_TO_NAME, ch);
}

export function colorOfKey(key: PaletteKey): string {
  return PALETTE[KEY_TO_NAME[key]];
}

/** Writes every palette colour to `--c-<name>` custom properties so CSS never repeats a hex value. */
export function applyPaletteCssVars(el: HTMLElement): void {
  for (const [name, hex] of Object.entries(PALETTE)) el.style.setProperty(`--c-${name}`, hex);
}
