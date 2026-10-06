// Upgrades (docs/BALANCE.md §4). Phase 03 added the backpack; phase 04 the farm and tool upgrades;
// phase 05 the fishing ones; phase 06 the kitchen.
//
// Leveled upgrades: `effect[level]` and `effectText[level]` (index 0 = not owned). Placeables
// (sprinkler, scarecrow): the level is the number of units bought.

import { TRAP_CAPACITY, TRAP_INTERVAL_SEC } from './balance';
import type { UpgradeId } from './ids';
import type { UpgradeDef, UpgradeEffect } from './types';

/** `effectText`/`effect` for a placeable owned n times: `text(n)` for n = 0..max. */
function perUnit(
  max: number,
  text: (n: number) => string,
  effect: UpgradeEffect,
): [string[], UpgradeEffect[]] {
  const n = Array.from({ length: max + 1 }, (_, i) => i);
  return [n.map(text), n.map(() => effect)];
}

const [sprinklerText, sprinklerEffect] = perUnit(
  12,
  (n) => (n === 0 ? 'none yet' : n === 1 ? '1 sprinkler' : `${n} sprinklers`),
  {},
);
const [scarecrowText, scarecrowEffect] = perUnit(
  4,
  (n) => (n === 0 ? 'none yet' : n === 1 ? '1 scarecrow' : `${n} scarecrows`),
  { shape: 'square', radius: 2, growthBonus: 0.2 },
);

const [trapText, trapEffect] = perUnit(9, (n) => (n === 0 ? 'none yet' : n === 1 ? '1 trap' : `${n} traps`), {
  intervalSec: TRAP_INTERVAL_SEC,
  capacity: TRAP_CAPACITY,
});

export const UPGRADES: Readonly<Partial<Record<UpgradeId, UpgradeDef>>> = Object.freeze({
  sprinkler: {
    id: 'sprinkler',
    name: 'Sprinkler',
    description: 'A little spinning sprinkler. Every plot around it stays watered, day and night.',
    category: 'farm',
    kind: 'placeable',
    placeOn: 'plot',
    max: 12,
    cost: { base: 300, ratio: 1.35 }, // 300, 410, 550, 740, 1000, 1300, 1800, 2500, 3300, 4500, 6000, 8100
    effectText: sprinklerText,
    effect: sprinklerEffect,
    requires: [],
  },
  sprinkler_tech: {
    id: 'sprinkler_tech',
    name: 'Sprinkler Tech',
    description: 'Better nozzles for every sprinkler, so each one waters more plots.',
    category: 'farm',
    kind: 'leveled',
    max: 2,
    cost: { base: 6000, ratio: 5 }, // 6000, 30000
    effectText: ['plus shape (4 plots)', 'wider: 3 × 3 (8 plots)', 'widest: 5 × 5 (24 plots)'],
    effect: [
      { shape: 'plus', radius: 1 },
      { shape: 'square', radius: 1 },
      { shape: 'square', radius: 2 },
    ],
    requires: [],
    levelRequires: { 1: [{ kind: 'farmLevel', level: 4 }], 2: [{ kind: 'farmLevel', level: 7 }] },
  },
  scarecrow: {
    id: 'scarecrow',
    name: 'Scarecrow',
    description: 'A cheerful scarecrow. Crops within two tiles grow 20% faster.',
    category: 'farm',
    kind: 'placeable',
    placeOn: 'plot',
    max: 4,
    cost: { base: 600, ratio: 1.8 }, // 600, 1100, 1900, 3500
    effectText: scarecrowText,
    effect: scarecrowEffect,
    requires: [{ kind: 'expansion', id: 'farm_1' }],
  },
  farmhand: {
    id: 'farmhand',
    name: 'Farmhand',
    description: 'A helper who trots out to harvest ripe crops, even while you are away.',
    category: 'farm',
    kind: 'leveled',
    max: 5,
    cost: { base: 1000, ratio: 3 }, // 1000, 3000, 9000, 27000, 81000
    effectText: [
      'no one is hired',
      'harvests 6 plots every 30 s',
      'harvests 9 plots every 22 s',
      'harvests 12 plots every 17 s',
      'harvests 16 plots every 12 s',
      'harvests 20 plots every 9 s',
    ],
    effect: [
      {},
      { intervalSec: 30, capacity: 6 },
      { intervalSec: 22, capacity: 9 },
      { intervalSec: 17, capacity: 12 },
      { intervalSec: 12, capacity: 16 },
      { intervalSec: 9, capacity: 20 },
    ],
    requires: [{ kind: 'farmLevel', level: 3 }],
  },
  seed_planter: {
    id: 'seed_planter',
    name: 'Seed Planter',
    description: 'The farmhand sows seeds behind them, so the field replants itself.',
    category: 'farm',
    kind: 'leveled',
    max: 3,
    cost: { base: 2000, ratio: 3 }, // 2000, 6000, 18000
    effectText: [
      'not built',
      'replants what the farmhand harvested',
      '+ fills empty tilled plots',
      '+ tills soil and clears dead crops',
    ],
    effect: [
      {},
      { flags: ['replantHarvested'] },
      { flags: ['replantHarvested', 'plantEmpty'] },
      { flags: ['replantHarvested', 'plantEmpty', 'autoTill'] },
    ],
    requires: [{ kind: 'upgrade', id: 'farmhand', level: 1 }],
  },
  auto_seller: {
    id: 'auto_seller',
    name: 'Auto-Seller',
    description: 'Harvests roll straight into the Shipping Bin. Choose what to ship.',
    category: 'farm',
    kind: 'leveled',
    max: 2,
    cost: { base: 5000, ratio: 4 }, // 5000, 20000
    effectText: ['not built', 'harvests go to the Shipping Bin', '+ keeps 10 of each item for cooking'],
    effect: [{}, { flags: ['autoShip'] }, { flags: ['autoShip', 'keepReserve'] }],
    requires: [{ kind: 'upgrade', id: 'farmhand', level: 1 }],
  },
  seed_order: {
    id: 'seed_order',
    name: 'Seed Order',
    description:
      'At every Shipping Bin pickup, a standing order tops up the seeds your planter uses (in season, and ripe before the season ends) at the Shop price plus a 10% delivery fee. Never spends below your gold reserve.',
    category: 'farm',
    kind: 'leveled',
    max: 3,
    cost: { base: 4000, ratio: 3 }, // 4000, 12000, 36000
    effectText: [
      'not ordered',
      'keeps 100 seeds of each crop in the bag',
      'keeps 300 seeds of each crop in the bag',
      'keeps 1,000 seeds of each crop in the bag',
    ],
    effect: [{}, { seedTarget: 100 }, { seedTarget: 300 }, { seedTarget: 1000 }],
    requires: [{ kind: 'upgrade', id: 'seed_planter', level: 1 }],
  },
  watering_can: {
    id: 'watering_can',
    name: 'Watering Can',
    description: 'A bigger can that waters several plots with one click.',
    category: 'tools',
    kind: 'leveled',
    max: 3,
    cost: { base: 400, ratio: 5 }, // 400, 2000, 10000
    effectText: ['waters 1 plot', 'Copper: waters 3 in a row', 'Iron: waters 3 × 3', 'Gold: waters 5 × 5'],
    effect: [{ toolArea: 1 }, { toolArea: 3 }, { toolArea: 9 }, { toolArea: 25 }],
    requires: [],
  },
  hoe: {
    id: 'hoe',
    name: 'Hoe',
    description: 'A sturdier hoe that tills and clears several plots with one click.',
    category: 'tools',
    kind: 'leveled',
    max: 3,
    cost: { base: 250, ratio: 4.8 }, // 250, 1200, 5800
    effectText: ['tills 1 plot', 'Copper: tills 3 in a row', 'Iron: tills 3 × 3', 'Gold: tills 5 × 5'],
    effect: [{ toolArea: 1 }, { toolArea: 3 }, { toolArea: 9 }, { toolArea: 25 }],
    requires: [],
  },
  barn_storage: {
    id: 'barn_storage',
    name: 'Barn Storage',
    description: 'Sturdy barn shelves. Every stack in your bag holds more.',
    category: 'storage',
    kind: 'leveled',
    max: 4,
    cost: { base: 1000, ratio: 2.5 }, // 1000, 2500, 6300, 16000
    effectText: ['99 per stack', '199 per stack', '299 per stack', '499 per stack', '999 per stack'],
    effect: [
      { stackSize: 99 },
      { stackSize: 199 },
      { stackSize: 299 },
      { stackSize: 499 },
      { stackSize: 999 },
    ],
    requires: [{ kind: 'farmLevel', level: 2 }],
  },
  greenhouse: {
    id: 'greenhouse',
    name: 'Greenhouse',
    description: 'Glass-roofed beds where the seasons never change and the soil is always damp.',
    category: 'farm',
    kind: 'leveled',
    max: 2,
    cost: { base: 25000, ratio: 2.4 }, // 25000, 60000
    effectText: ['not built', '6 plots that ignore the seasons', '12 plots that ignore the seasons'],
    effect: [{ greenhousePlots: 0 }, { greenhousePlots: 6 }, { greenhousePlots: 12 }],
    requires: [
      { kind: 'expansion', id: 'farm_3' },
      { kind: 'farmLevel', level: 7 },
      { kind: 'bundle', id: 'autumn_harvest' },
    ],
  },
  backpack: {
    id: 'backpack',
    name: 'Backpack',
    description: 'More pockets for more things.',
    category: 'storage',
    kind: 'leveled',
    max: 5,
    cost: { base: 200, ratio: 2.2 }, // 200, 440, 970, 2100, 4700
    // Six slots a level (four before the polish after v4-01), and a fifth level: the bag filled up with v2's
    // animal products and v4's north fields. Saves get the new slots on load (`syncBagSlots`).
    effectText: ['12 slots', '18 slots', '24 slots', '30 slots', '36 slots', '42 slots'],
    effect: [
      { inventorySlots: 12 },
      { inventorySlots: 18 },
      { inventorySlots: 24 },
      { inventorySlots: 30 },
      { inventorySlots: 36 },
      { inventorySlots: 42 },
    ],
    requires: [],
  },
  fish_trap: {
    id: 'fish_trap',
    name: 'Fish Trap',
    description:
      'A wicker trap that catches a little something every 3 minutes, day and night. Two per open water (three once the Pond Fish bundle is done).',
    category: 'fishing',
    kind: 'placeable',
    placeOn: 'water',
    max: 9, // 3 waters × (2 spots + 1 from the Pond Fish bundle)
    cost: { base: 500, ratio: 1.5 }, // 500, 750, 1100, 1700, 2500, 3800, 5700, 8600, 12800
    effectText: trapText,
    effect: trapEffect,
    requires: [],
  },
  fishing_rod: {
    id: 'fishing_rod',
    name: 'Fishing Rod',
    description: 'A better rod widens the sweet zone when you reel, and nudges the rarer fish your way.',
    category: 'fishing',
    kind: 'leveled',
    max: 3,
    cost: { base: 300, ratio: 8 }, // 300, 2400, 19000
    effectText: [
      'Old rod',
      'Bamboo rod: zone ×1.10, +0.05 luck',
      'Fiberglass rod: zone ×1.20, +0.15 luck',
      'Iridium rod: zone ×1.35, +0.30 luck',
    ],
    effect: [
      { reelZoneMult: 1, luck: 0 },
      { reelZoneMult: 1.1, luck: 0.05 },
      { reelZoneMult: 1.2, luck: 0.15 },
      { reelZoneMult: 1.35, luck: 0.3 },
    ],
    requires: [],
    levelRequires: { 3: [{ kind: 'expansion', id: 'ocean' }] },
  },
  trap_collector: {
    id: 'trap_collector',
    name: 'Trap Collector',
    description:
      'A little cart that empties every trap into your bag each time the Shipping Bin is collected.',
    category: 'fishing',
    kind: 'leveled',
    max: 1,
    cost: { base: 4000, ratio: 1 },
    effectText: ['not built', 'empties the traps at every bin pickup'],
    effect: [{}, { flags: ['autoCollect'] }],
    requires: [{ kind: 'upgrade', id: 'fish_trap', level: 2 }],
  },
  ranch_collector: {
    id: 'ranch_collector',
    name: 'Collecting Basket',
    description:
      'A wicker basket on a little cart that empties every egg and milk store into your bag each time the Shipping Bin is collected.',
    category: 'ranch',
    kind: 'leveled',
    max: 1,
    cost: { base: 50_000, ratio: 1 },
    effectText: ['not built', 'empties the stores at every bin pickup'],
    effect: [{}, { flags: ['autoCollect'] }],
    requires: [{ kind: 'building', id: 'coop', level: 1 }],
  },
  kitchen: {
    id: 'kitchen',
    name: 'Kitchen',
    description: 'A better stove, a bigger oven: more dishes cooking at once, and faster.',
    category: 'kitchen',
    kind: 'leveled',
    max: 3,
    cost: { base: 1000, ratio: 3.5 }, // 1000, 3500, 12000
    effectText: [
      'Old Hearth: 1 dish at a time',
      'Stove: 2 dishes at once, cooks 15% faster',
      'Oven: 3 dishes at once, cooks 30% faster',
      'Pro Kitchen: 4 dishes at once, cooks 50% faster',
    ],
    effect: [
      { capacity: 1, cookSpeed: 0 },
      { capacity: 2, cookSpeed: 0.15 },
      { capacity: 3, cookSpeed: 0.3 },
      { capacity: 4, cookSpeed: 0.5 },
    ],
    requires: [],
  },
});
