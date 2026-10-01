// The six town projects of the Community Board (GDD §12.2, BALANCE.md §13.3). Each has 3 or 4 stages of
// gold and items, donated a bit at a time; finishing a stage changes the town and adds charm. Rewards
// are quality of life or cosmetic only: there is no income, multiplier or gold reward.
//
// Gold figures are before `TOWN_PROJECT_SCALE` (src/data/balance.ts), the lever for the
// gold-still-to-spend check. Stage items follow the doc's table except those that do not exist until
// later phases: eggs and large eggs and milk (animals, v2-04).
// Those requirements are listed in `LATER_STAGE_ITEMS` and join the stages when their items do.

import type { TownProjectId } from './ids';
import type { ItemStack, TownProjectDef } from './types';
import { WORLD_LAYOUT } from './world';

const items = (...xs: [ItemStack['item'], number][]): ItemStack[] => xs.map(([item, qty]) => ({ item, qty }));

const site = (id: TownProjectId) => (id === 'old_bridge' ? WORLD_LAYOUT.bridge : WORLD_LAYOUT.townSites[id]);

export const TOWN_PROJECTS: Readonly<Record<TownProjectId, TownProjectDef>> = Object.freeze({
  old_bridge: {
    id: 'old_bridge',
    name: 'Mend the Old Bridge',
    flavor: 'The bridge over the inlet has been broken since before anyone can remember.',
    site: site('old_bridge'),
    stages: [
      { gold: 60_000, items: items(['driftwood', 10]), sceneChange: 'new posts stand in the inlet' },
      { gold: 120_000, items: [], sceneChange: 'planks are laid across the inlet' },
      { gold: 220_000, items: [], sceneChange: 'railings and lanterns line the bridge' },
    ],
    rewards: [
      { kind: 'decorSet', set: 'seaside' },
      { kind: 'decorSlots', count: 40 },
    ],
    rewardText: 'The Seaside decoration set and +40 decoration slots',
    requires: [{ kind: 'farmLevel', level: 7 }],
  },
  fountain: {
    id: 'fountain',
    name: 'Restore the Fountain',
    flavor: 'A dry stone basin in the middle of the square. It used to sing.',
    site: site('fountain'),
    stages: [
      { gold: 120_000, items: [], sceneChange: 'the basin is cleared and mended' },
      { gold: 200_000, items: items(['seaweed', 20]), sceneChange: 'the basin is sealed and filled' },
      { gold: 280_000, items: items(['koi', 1]), sceneChange: 'the water plays, and a koi swims in it' },
    ],
    rewards: [{ kind: 'decorSlots', count: 40 }],
    rewardText: '+40 decoration slots',
    requires: [{ kind: 'farmLevel', level: 7 }],
  },
  bakery: {
    id: 'bakery',
    name: 'Rebuild the Bakery',
    flavor: 'Somebody remembers the smell of the old bakery every morning.',
    site: site('bakery'),
    stages: [
      {
        gold: 200_000,
        items: items(['wheat', 100]),
        sceneChange: 'the rubble is cleared and a frame goes up',
      },
      { gold: 300_000, items: [], sceneChange: 'walls and a roof' },
      {
        gold: 400_000,
        items: items(['apple', 30]),
        sceneChange: 'a bakery with a smoking chimney each morning',
      },
    ],
    rewards: [
      { kind: 'decorSet', set: 'harvest_fair' },
      { kind: 'cosmetic', what: 'bakerySmoke' },
    ],
    rewardText: 'The Harvest Fair decoration set, and fresh bread smoke each morning',
    requires: [{ kind: 'townProject', id: 'old_bridge' }],
  },
  bandstand: {
    id: 'bandstand',
    name: 'Build the Bandstand',
    flavor: 'A stage for the square. Someone has already offered to play the fiddle.',
    site: site('bandstand'),
    stages: [
      { gold: 300_000, items: [], sceneChange: 'a platform' },
      { gold: 400_000, items: items(['corn', 50]), sceneChange: 'a roof' },
      {
        gold: 500_000,
        items: items(['pumpkin', 10]),
        sceneChange: 'bunting, and on Saturday evenings a band',
      },
    ],
    rewards: [
      { kind: 'musicTrack', id: 'town_square' },
      { kind: 'decorSlots', count: 40 },
      { kind: 'cosmetic', what: 'bandSaturday' },
    ],
    rewardText: 'A Town Square music loop, +40 decoration slots, and a band on Saturday evenings',
    requires: [{ kind: 'townProject', id: 'fountain' }],
  },
  lighthouse: {
    id: 'lighthouse',
    name: 'Relight the Lighthouse',
    flavor: 'A dark tower on the point. The boats would like it lit again.',
    site: site('lighthouse'),
    stages: [
      { gold: 400_000, items: items(['driftwood', 20]), sceneChange: 'the dark tower is shored up' },
      { gold: 600_000, items: items(['sardine', 20]), sceneChange: 'a freshly painted tower' },
      { gold: 800_000, items: items(['tuna', 5]), sceneChange: 'a beam turns across the sea at night' },
    ],
    rewards: [
      { kind: 'decorSlots', count: 40 },
      { kind: 'cosmetic', what: 'lighthouseBeam' },
    ],
    rewardText: '+40 decoration slots, and a beam across the sea at night',
    requires: [{ kind: 'townProject', id: 'bakery' }],
  },
  community_hall: {
    id: 'community_hall',
    name: 'Raise the Community Hall',
    flavor: 'Everyone has a seat saved. All that is missing is the hall.',
    site: site('community_hall'),
    stages: [
      { gold: 600_000, items: [], sceneChange: 'foundations' },
      { gold: 800_000, items: items(['persimmon', 20]), sceneChange: 'walls' },
      { gold: 1_000_000, items: [], sceneChange: 'a roof' },
      {
        gold: 1_200_000,
        items: items(['harvest_feast', 1]),
        sceneChange: 'festival lights strung across the square',
      },
    ],
    rewards: [
      { kind: 'goalSlot', count: 1 },
      { kind: 'cosmetic', what: 'festivalLights' },
    ],
    rewardText: 'A 4th goal slot on the goal board, and festival lights across the square',
    requires: [
      { kind: 'townProject', id: 'old_bridge' },
      { kind: 'townProject', id: 'fountain' },
      { kind: 'townProject', id: 'bakery' },
      { kind: 'townProject', id: 'bandstand' },
      { kind: 'townProject', id: 'lighthouse' },
    ],
  },
});

/**
 * Stage items from BALANCE.md §13.3 that wait for later phases, because their items do not exist yet.
 * v2 phase 04 adds the eggs, milk and large eggs: append each to
 * its stage in `TOWN_PROJECTS` (stage numbers are 1-based) and delete the line here.
 */
export const LATER_STAGE_ITEMS: readonly {
  project: TownProjectId;
  stage: number;
  item: string;
  qty: number;
  phase: string;
}[] = [
  { project: 'bakery', stage: 2, item: 'egg', qty: 30, phase: 'v2-04' },
  { project: 'community_hall', stage: 1, item: 'milk', qty: 30, phase: 'v2-04' },
  { project: 'community_hall', stage: 3, item: 'large_egg', qty: 10, phase: 'v2-04' },
];
