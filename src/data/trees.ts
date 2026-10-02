// The seven fruit trees (docs/BALANCE.md §13.5): planted once on an orchard tree spot, they grow over
// real calendar days, never wither, and bear fruit at each 06:00 refresh in their seasons, up to a cap
// of FRUIT_CAP_DAYS bearing days' worth. Fruit and sapling items are generated in items.ts.

import { FRUIT_CAP_DAYS, roundNice, SAPLING_PRICE_FACTOR } from './balance';
import type { FruitId, TreeId } from './ids';
import { treeOfFruit } from './ids';
import type { TreeDef } from './types';

type Row = Omit<TreeDef, 'id' | 'fruitCap' | 'saplingPrice'>;

const ROWS: Record<FruitId, Row> = {
  cherry: {
    fruit: 'cherry',
    name: 'Cherry',
    plural: 'Cherries',
    description: 'Pink blossom in spring, then bright red fruit by the handful.',
    seasons: ['spring'],
    matureDays: 3,
    fruitPerDay: 40,
    fruitPrice: 165,
    xp: 11,
    shape: 'tall',
  },
  apricot: {
    fruit: 'apricot',
    name: 'Apricot',
    description: 'A sunny little tree that bears from spring into summer.',
    seasons: ['spring', 'summer'],
    matureDays: 4,
    fruitPerDay: 32,
    fruitPrice: 270,
    xp: 14,
    shape: 'spread',
  },
  peach: {
    fruit: 'peach',
    name: 'Peach',
    plural: 'Peaches',
    description: 'Soft, blushing summer fruit on a wide, easy tree.',
    seasons: ['summer'],
    matureDays: 4,
    fruitPerDay: 32,
    fruitPrice: 500,
    xp: 21,
    shape: 'spread',
  },
  apple: {
    fruit: 'apple',
    name: 'Apple',
    description: 'A sturdy tree for the long days of summer and autumn.',
    seasons: ['summer', 'autumn'],
    matureDays: 5,
    fruitPerDay: 44,
    fruitPrice: 295,
    xp: 15,
    shape: 'round',
  },
  pear: {
    fruit: 'pear',
    name: 'Pear',
    plural: 'Pears',
    description: 'Golden autumn pears, heavy and sweet.',
    seasons: ['autumn'],
    matureDays: 5,
    fruitPerDay: 36,
    fruitPrice: 470,
    xp: 20,
    shape: 'round',
  },
  persimmon: {
    fruit: 'persimmon',
    name: 'Persimmon',
    description: 'Orange lanterns that keep glowing into the first snow.',
    seasons: ['autumn', 'winter'],
    matureDays: 6,
    fruitPerDay: 32,
    fruitPrice: 715,
    xp: 26,
    shape: 'round',
  },
  lemon: {
    fruit: 'lemon',
    name: 'Lemon',
    description: 'Bright fruit in the dead of winter, and again as spring comes.',
    seasons: ['winter', 'spring'],
    matureDays: 7,
    fruitPerDay: 32,
    fruitPrice: 700,
    xp: 25,
    shape: 'tall',
  },
};

/** BALANCE.md §13.5: a sapling repays in about SAPLING_PRICE_FACTOR bearing days of each of its seasons. */
export function saplingPriceOf(row: Pick<TreeDef, 'fruitPerDay' | 'fruitPrice' | 'seasons'>): number {
  return roundNice(SAPLING_PRICE_FACTOR * row.fruitPerDay * row.fruitPrice * row.seasons.length);
}

function build(row: Row): TreeDef {
  return {
    ...row,
    id: treeOfFruit(row.fruit),
    saplingPrice: saplingPriceOf(row),
    fruitCap: FRUIT_CAP_DAYS * row.fruitPerDay,
  };
}

export const TREES: Readonly<Record<TreeId, TreeDef>> = Object.freeze(
  Object.fromEntries(Object.values(ROWS).map((r) => [treeOfFruit(r.fruit), build(r)])) as Record<
    TreeId,
    TreeDef
  >,
);
