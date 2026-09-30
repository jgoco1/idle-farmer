// Upgrades (docs/BALANCE.md §4). Phase 03 adds the backpack; phase 04 adds the farm and tool
// upgrades, 05 the fishing ones and 06 the kitchen, after which this becomes a full Record.

import type { UpgradeId } from './ids';
import type { UpgradeDef } from './types';

export const UPGRADES: Readonly<Partial<Record<UpgradeId, UpgradeDef>>> = Object.freeze({
  backpack: {
    id: 'backpack',
    name: 'Backpack',
    category: 'storage',
    kind: 'leveled',
    max: 4,
    cost: { base: 200, ratio: 2.2 }, // 200, 440, 970, 2100
    effectText: ['12 slots', '16 slots', '20 slots', '24 slots', '28 slots'],
    effect: [
      { inventorySlots: 12 },
      { inventorySlots: 16 },
      { inventorySlots: 20 },
      { inventorySlots: 24 },
      { inventorySlots: 28 },
    ],
    requires: [],
  },
});
