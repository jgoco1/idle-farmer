// Land parcels (GDD §12.1, BALANCE.md §13.1): the three regions of the v2 world that are bought
// with gold, in order. In v2 phase 01 they only make space; phases 02–04 fill them.

import type { ParcelId } from './ids';
import type { ParcelDef } from './types';
import { WORLD_LAYOUT } from './world';

const rectOf = (id: ParcelId) => WORLD_LAYOUT.regions.find((r) => r.id === id)!.rect;

export const PARCELS: Readonly<Record<ParcelId, ParcelDef>> = Object.freeze({
  orchard: {
    id: 'orchard',
    name: 'Hilltop Orchard',
    description: 'A sunny slope above the farm, all brambles and long grass for now.',
    rect: rectOf('orchard'),
    price: 30_000,
    requires: [
      { kind: 'farmLevel', level: 5 },
      { kind: 'expansion', id: 'farm_3' },
    ],
    opens: 'Room for fruit trees',
  },
  yard: {
    id: 'yard',
    name: 'Old Paddock',
    description: 'A fenced field where animals grazed long ago. The fence posts are still sound.',
    rect: rectOf('yard'),
    price: 150_000,
    requires: [
      { kind: 'parcel', id: 'orchard' },
      { kind: 'farmLevel', level: 7 },
    ],
    opens: 'Room for a coop, a barn and a silo',
  },
  meadow: {
    id: 'meadow',
    name: 'Seaside Meadow',
    description: 'Wildflowers running down to a strip of beach. The best view on the coast.',
    rect: rectOf('meadow'),
    price: 500_000,
    requires: [{ kind: 'parcel', id: 'yard' }],
    opens: 'The largest space for decorations',
  },
});
