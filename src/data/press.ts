// The Press House and the apiary (v4 phase 03; GDD §13.5–13.6, BALANCE.md §14.4–14.5,
// DATA_SCHEMAS.md §10.4). The Press House stands on its fixed north-road site with 2, 3 or 4 press
// slots; the hives go on the apiary's six spots (`WORLD_LAYOUT.hiveSpots`), next free spot first.
// The drink recipes are in drinks.ts; the timing constants in balance.ts.

import { COCOA_PRICE, HIVE_BASE_PRICE, HIVE_CYCLE_SEC, HIVE_PRICE_RATIO, HIVE_STORE } from './balance';
import type { HiveDef, PressHouseDef } from './types';

export const PRESS_HOUSE: PressHouseDef = Object.freeze({
  name: 'Press House',
  requires: [
    { kind: 'farmLevel', level: 7 },
    { kind: 'parcel', id: 'orchard' },
  ],
  levels: [
    { price: 90_000, slots: 2 },
    { price: 250_000, slots: 3 },
    { price: 600_000, slots: 4 },
  ],
  shelf: { cocoa: COCOA_PRICE },
  sprites: {
    building: ['obj_press_house_1', 'obj_press_house_2', 'obj_press_house_3'],
    press: 'obj_press_idle',
    pressBusy: 'obj_press_busy',
    pressDone: 'obj_press_done',
  },
} satisfies PressHouseDef);

export const HIVE: HiveDef = Object.freeze({
  basePrice: HIVE_BASE_PRICE,
  ratio: HIVE_PRICE_RATIO,
  cycleSec: HIVE_CYCLE_SEC,
  store: HIVE_STORE,
  product: 'honey',
  requires: [{ kind: 'press', level: 1 }],
  sprite: 'obj_hive',
} satisfies HiveDef);
