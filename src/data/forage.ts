// The North Woods' forage (v4 phase 04; GDD §13.7, BALANCE.md §14.7, DATA_SCHEMAS.md §10.4). Eight
// spots on the woods floor (`WORLD_LAYOUT.forageSpots`), two of each kind; the season picks what a spot
// grows, `perDay` a day at the 06:00 refresh, up to FORAGE_CAP_DAYS days' worth. A kind with nothing
// in a season rests. The forage items are items of category 'forage' (see items.ts).

import type { ForageId, ForageKind } from './ids';
import type { ForageDef, ForageItemDef } from './types';

const FORAGE_ITEMS: Readonly<Record<ForageId, ForageItemDef>> = {
  morel: {
    id: 'morel',
    name: 'Morel',
    basePrice: 160,
    xp: 10,
    description: 'A honeycombed spring mushroom from under the pines. Earthy and much sought after.',
  },
  chanterelle: {
    id: 'chanterelle',
    name: 'Chanterelle',
    basePrice: 140,
    xp: 10,
    description: 'A golden, apricot-scented mushroom of the summer and autumn woods.',
  },
  wild_mint: {
    id: 'wild_mint',
    name: 'Wild Mint',
    basePrice: 45,
    xp: 5,
    description: 'A fragrant handful from the damp ground by the lake. Lovely in a tea.',
  },
  elderflower: {
    id: 'elderflower',
    name: 'Elderflower',
    basePrice: 60,
    xp: 6,
    description: 'Creamy flower heads that smell of early summer. Made for cordial.',
  },
  blackberry: {
    id: 'blackberry',
    name: 'Blackberry',
    basePrice: 50,
    xp: 5,
    description: 'Glossy, purple-black and a little thorny to pick. Worth every scratch.',
  },
  rose_hip: {
    id: 'rose_hip',
    name: 'Rose Hip',
    basePrice: 55,
    xp: 5,
    description: 'Bright red hips from the wild roses, still on the briar after the frost.',
  },
  hazelnut: {
    id: 'hazelnut',
    name: 'Hazelnut',
    basePrice: 70,
    xp: 6,
    description: 'Picked from under the hazels before the squirrels find them.',
  },
};

export const FORAGE: ForageDef = Object.freeze({
  items: FORAGE_ITEMS,
  kinds: {
    mushroom: {
      spring: { item: 'morel', perDay: 2 },
      summer: { item: 'chanterelle', perDay: 2 },
      autumn: { item: 'chanterelle', perDay: 3 },
      winter: null,
    },
    herb: {
      spring: { item: 'wild_mint', perDay: 5 },
      summer: { item: 'wild_mint', perDay: 5 },
      autumn: { item: 'wild_mint', perDay: 4 },
      winter: null,
    },
    flower: {
      spring: { item: 'elderflower', perDay: 4 },
      summer: { item: 'blackberry', perDay: 4 },
      autumn: { item: 'blackberry', perDay: 5 },
      winter: { item: 'rose_hip', perDay: 4 },
    },
    nut: {
      spring: null,
      summer: null,
      autumn: { item: 'hazelnut', perDay: 5 },
      winter: { item: 'hazelnut', perDay: 4 },
    },
  },
  spotKinds: [
    'mushroom',
    'herb',
    'mushroom',
    'herb',
    'flower',
    'nut',
    'flower',
    'nut',
  ] satisfies ForageKind[],
} satisfies ForageDef);

/** Display names for a spot's kind (labels and the away summary). */
export const FORAGE_KIND_NAMES: Readonly<Record<ForageKind, string>> = {
  mushroom: 'Mushroom patch',
  herb: 'Wild mint',
  flower: 'Bramble and elder',
  nut: 'Hazel',
};
