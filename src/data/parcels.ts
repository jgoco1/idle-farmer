// Land parcels (GDD §12.1, §13.3; BALANCE.md §13.1, §14.1): the regions of the world that are bought
// with gold. The three v2 parcels make space; the two north parcels (v4-01) each carry a field.

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
  // The north (v4-01, BALANCE §14.1): two fields with their own plot grids.
  north_fields: {
    id: 'north_fields',
    name: 'North Fields',
    description: 'Good dark soil behind a hawthorn hedge, just up the north road.',
    rect: rectOf('north_fields'),
    price: 3_000_000,
    requires: [
      { kind: 'parcel', id: 'yard' },
      { kind: 'expansion', id: 'farm_4' },
      { kind: 'farmLevel', level: 7 },
    ],
    opens: 'A second field of 32 plots',
    field: 'north_fields',
  },
  terraces: {
    id: 'terraces',
    name: 'Upper Terraces',
    description: 'Old terraces stepping up the hill toward the pines. The walls just need a mend.',
    rect: rectOf('terraces'),
    price: 6_500_000, // v4-04 (BALANCE §14.12): 4,500,000 paid back in 8 days on 60-day runs (band 10–20)
    requires: [
      { kind: 'parcel', id: 'north_fields' },
      { kind: 'farmLevel', level: 8 },
    ],
    opens: 'A third field of 24 plots',
    field: 'terraces',
  },
});
