// The seven fruit trees (docs/BALANCE.md §13.5): planted once on an orchard tree spot, they grow over
// real calendar days, never wither, and bear fruit at each 06:00 refresh in their seasons, up to a cap
// of FRUIT_CAP_DAYS bearing days' worth. Fruit and sapling items are generated in items.ts.

import { FRUIT_CAP_DAYS } from './balance';
import type { FruitId, TreeId } from './ids';
import { treeOfFruit } from './ids';
import type { TreeDef } from './types';

type Row = Omit<TreeDef, 'id' | 'fruitCap'>;

const ROWS: Record<FruitId, Row> = {
  cherry: {
    fruit: 'cherry',
    name: 'Cherry',
    plural: 'Cherries',
    description: 'Pink blossom in spring, then bright red fruit by the handful.',
    seasons: ['spring'],
    saplingPrice: 6_000,
    matureDays: 3,
    fruitPerDay: 10,
    fruitPrice: 150,
    xp: 10,
    shape: 'tall',
  },
  apricot: {
    fruit: 'apricot',
    name: 'Apricot',
    description: 'A sunny little tree that bears from spring into summer.',
    seasons: ['spring', 'summer'],
    saplingPrice: 13_000,
    matureDays: 4,
    fruitPerDay: 8,
    fruitPrice: 210,
    xp: 12,
    shape: 'spread',
  },
  peach: {
    fruit: 'peach',
    name: 'Peach',
    plural: 'Peaches',
    description: 'Soft, blushing summer fruit on a wide, easy tree.',
    seasons: ['summer'],
    saplingPrice: 8_300,
    matureDays: 4,
    fruitPerDay: 8,
    fruitPrice: 260,
    xp: 14,
    shape: 'spread',
  },
  apple: {
    fruit: 'apple',
    name: 'Apple',
    description: 'A sturdy tree for the long days of summer and autumn.',
    seasons: ['summer', 'autumn'],
    saplingPrice: 14_000,
    matureDays: 5,
    fruitPerDay: 10,
    fruitPrice: 180,
    xp: 11,
    shape: 'round',
  },
  pear: {
    fruit: 'pear',
    name: 'Pear',
    plural: 'Pears',
    description: 'Golden autumn pears, heavy and sweet.',
    seasons: ['autumn'],
    saplingPrice: 9_000,
    matureDays: 5,
    fruitPerDay: 8,
    fruitPrice: 280,
    xp: 15,
    shape: 'round',
  },
  persimmon: {
    fruit: 'persimmon',
    name: 'Persimmon',
    description: 'Orange lanterns that keep glowing into the first snow.',
    seasons: ['autumn', 'winter'],
    saplingPrice: 20_000,
    matureDays: 6,
    fruitPerDay: 7,
    fruitPrice: 360,
    xp: 17,
    shape: 'round',
  },
  lemon: {
    fruit: 'lemon',
    name: 'Lemon',
    description: 'Bright fruit in the dead of winter, and again as spring comes.',
    seasons: ['winter', 'spring'],
    saplingPrice: 20_000,
    matureDays: 7,
    fruitPerDay: 8,
    fruitPrice: 320,
    xp: 16,
    shape: 'tall',
  },
};

function build(row: Row): TreeDef {
  return { ...row, id: treeOfFruit(row.fruit), fruitCap: FRUIT_CAP_DAYS * row.fruitPerDay };
}

export const TREES: Readonly<Record<TreeId, TreeDef>> = Object.freeze(
  Object.fromEntries(Object.values(ROWS).map((r) => [treeOfFruit(r.fruit), build(r)])) as Record<
    TreeId,
    TreeDef
  >,
);
