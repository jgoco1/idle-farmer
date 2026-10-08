// Farm and fishing expansions (docs/BALANCE.md §5). Farm steps grow the plot grid from 4 × 2 to
// 8 × 6; their prices follow roundNice(400 * 3.7^n). River and Old Dock open fishing locations
// (phase 05) and are bought the same way.

import { FARM_EXPANSION_COST, roundNice } from './balance';
import type { ExpansionId } from './ids';
import type { ExpansionDef } from './types';

const farmPrice = (n: number): number => roundNice(FARM_EXPANSION_COST.base * FARM_EXPANSION_COST.ratio ** n);

export const EXPANSIONS: Readonly<Record<ExpansionId, ExpansionDef>> = Object.freeze({
  farm_1: {
    id: 'farm_1',
    name: 'Clear the Weeds',
    kind: 'farm',
    price: farmPrice(0), // 400
    requires: [],
    grid: { cols: 4, rows: 3 },
    sceneChange: 'weeds and a stump south of the plots disappear; the fence moves down 1 tile',
    description: 'Pull the weeds and dig out the old stump for a third row of soil.',
  },
  farm_2: {
    id: 'farm_2',
    name: 'Mend the Fence',
    kind: 'farm',
    price: farmPrice(1), // 1500
    requires: [{ kind: 'expansion', id: 'farm_1' }],
    grid: { cols: 5, rows: 4 },
    sceneChange: 'the fence is rebuilt 1 tile east and south; the paths gain stepping stones',
    description:
      'Rebuild the sagging fence a little wider, and lay some stepping stones while you are at it.',
  },
  farm_3: {
    id: 'farm_3',
    name: 'Old Orchard Plot',
    kind: 'farm',
    price: farmPrice(2), // 5500
    requires: [
      { kind: 'expansion', id: 'farm_2' },
      { kind: 'farmLevel', level: 3 },
    ],
    grid: { cols: 6, rows: 5 },
    sceneChange: 'two old trees are removed; the greenhouse lot is revealed',
    description: 'Clear two tired old trees to make room, and uncover the lot behind them.',
  },
  farm_4: {
    id: 'farm_4',
    name: 'The Back Forty',
    kind: 'farm',
    price: farmPrice(3), // 20000
    requires: [
      { kind: 'expansion', id: 'farm_3' },
      { kind: 'farmLevel', level: 6 },
    ],
    grid: { cols: 8, rows: 6 },
    sceneChange: 'the fence reaches the market path; a scarecrow post decoration appears',
    description: 'Take in the rest of the meadow. A proper farm at last!',
  },
  river: {
    id: 'river',
    name: 'River Access',
    kind: 'fishing',
    price: 2000,
    requires: [{ kind: 'farmLevel', level: 3 }],
    location: 'river',
    sceneChange: 'a river is shown along the bottom edge with a small bridge',
    description: 'Cut a path through the reeds down to the river.',
  },
  ocean: {
    id: 'ocean',
    name: 'Old Dock',
    kind: 'fishing',
    price: 8000,
    requires: [
      { kind: 'expansion', id: 'river' },
      { kind: 'farmLevel', level: 6 },
    ],
    location: 'ocean',
    sceneChange: 'a wooden dock and sea tiles appear in the bottom-right corner',
    description: 'Patch up the old dock and reach the open sea.',
  },
  // v4-04 (GDD §13.8, BALANCE.md §14.7): the fourth water, in the North Woods
  lake: {
    id: 'lake',
    name: 'Mountain Lake',
    kind: 'fishing',
    price: 300_000,
    requires: [
      { kind: 'expansion', id: 'ocean' },
      { kind: 'parcel', id: 'north_fields' },
      { kind: 'farmLevel', level: 7 },
    ],
    location: 'lake',
    sceneChange: 'a fishing jetty opens on the mountain lake in the North Woods',
    description: 'Mend the old jetty on the cold, clear lake under the pines.',
  },
});

/** The farm steps in the order they are bought. */
export const FARM_EXPANSIONS: readonly ExpansionId[] = ['farm_1', 'farm_2', 'farm_3', 'farm_4'];

/** The fishing locations in the order they are bought. */
export const FISHING_EXPANSIONS: readonly ExpansionId[] = ['river', 'ocean', 'lake'];
