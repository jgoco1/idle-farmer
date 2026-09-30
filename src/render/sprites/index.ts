// The sprite registry. To add a sprite: define a SpriteDef in the right file (terrain, objects, ui,
// or a new file such as crops.ts), add it to ALL_SPRITES, and draw it by id via spriteCache.

import * as terrain from './terrain';
import * as objects from './objects';
import * as ui from './ui';
import { AMBIENT_SPRITES } from './ambient';
import { AUTOMATION_SPRITES } from './automation';
import { COOKING_SPRITES } from './cooking';
import { CROP_SPRITES } from './crops';
import { FISHING_SPRITES } from './fishing';
import { ITEM_SPRITES } from './items';
import type { SpriteDef } from './types';

export type { SpriteDef } from './types';

export const ALL_SPRITES: readonly SpriteDef[] = [
  ...Object.values(terrain),
  ...Object.values(objects),
  ...Object.values(ui),
  ...CROP_SPRITES,
  ...ITEM_SPRITES,
  ...AUTOMATION_SPRITES,
  ...FISHING_SPRITES,
  ...COOKING_SPRITES,
  ...AMBIENT_SPRITES,
];

export const SPRITES: Readonly<Record<string, SpriteDef>> = Object.freeze(
  Object.fromEntries(ALL_SPRITES.map((s) => [s.id, s])),
);

export function spriteDef(id: string): SpriteDef {
  const def = SPRITES[id];
  if (!def) throw new Error(`Unknown sprite '${id}'`);
  return def;
}
