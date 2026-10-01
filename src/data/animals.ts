// The ranch (docs/BALANCE.md §13.6–13.7, GDD §12.4): a coop of hens, a barn of cows and a silo in the
// Old Paddock. Animals eat one portion of feed per production cycle and give one product into their
// building's store. They are gentle: an unfed animal simply does not produce, and nothing is ever lost.
// Egg, milk and feed items are generated in items.ts.

import { FEED_BUY_PRICE, FEED_PER_CORN, FEED_PER_WHEAT, LARGE_EGG_CHANCE } from './balance';
import type { AnimalId, BuildingId, FeedId } from './ids';
import type { AnimalDef, BuildingDef, FeedDef } from './types';

export const ANIMALS: Readonly<Record<AnimalId, AnimalDef>> = Object.freeze({
  chicken: {
    id: 'chicken',
    name: 'Hen',
    plural: 'Hens',
    building: 'coop',
    price: 3_000,
    feed: 'corn_feed',
    intervalSec: 1_800,
    product: 'egg',
    largeProduct: { id: 'large_egg', chance: LARGE_EGG_CHANCE },
    xp: { egg: 7, large_egg: 12 },
    names: [
      'Clover',
      'Daisy',
      'Pebble',
      'Honey',
      'Biscuit',
      'Poppy',
      'Maple',
      'Pip',
      'Willow',
      'Nutmeg',
      'Marigold',
      'Truffle',
    ],
  },
  cow: {
    id: 'cow',
    name: 'Cow',
    plural: 'Cows',
    building: 'barn',
    price: 12_000,
    feed: 'hay',
    intervalSec: 2_400,
    product: 'milk',
    xp: { milk: 13 },
    names: ['Bluebell', 'Buttercup', 'Clementine', 'Hazel', 'Juniper', 'Rosie'],
  },
});

export const BUILDINGS: Readonly<Record<BuildingId, BuildingDef>> = Object.freeze({
  coop: {
    id: 'coop',
    name: 'Coop',
    description: 'A snug little house for hens, with a trough outside and a basket for the eggs.',
    footprint: { cols: 3, rows: 2 },
    houses: 'chicken',
    placeIn: 'yard',
    sprite: 'obj_coop',
    levels: [
      { price: 25_000, capacity: 4, trough: 64, store: 64, requires: [{ kind: 'parcel', id: 'yard' }] },
      { price: 60_000, capacity: 8, trough: 128, store: 128, requires: [] },
      { price: 150_000, capacity: 12, trough: 192, store: 192, requires: [] },
    ],
  },
  barn: {
    id: 'barn',
    name: 'Barn',
    description: 'A big red barn for cows, with a hay trough and a cool pail for the milk.',
    footprint: { cols: 4, rows: 3 },
    houses: 'cow',
    placeIn: 'yard',
    sprite: 'obj_barn',
    levels: [
      {
        price: 60_000,
        capacity: 2,
        trough: 24,
        store: 24,
        requires: [{ kind: 'building', id: 'coop', level: 1 }],
      },
      { price: 150_000, capacity: 4, trough: 48, store: 48, requires: [] },
      { price: 350_000, capacity: 6, trough: 72, store: 72, requires: [] },
    ],
  },
  silo: {
    id: 'silo',
    name: 'Silo',
    description: 'A tall silo that tops up every trough from your bag, so the animals never go hungry.',
    footprint: { cols: 2, rows: 2 },
    houses: null,
    placeIn: 'yard',
    sprite: 'obj_silo',
    levels: [
      {
        price: 40_000,
        capacity: 0,
        trough: 0,
        store: 0,
        requires: [{ kind: 'building', id: 'coop', level: 1 }],
        flags: ['autoFeed'],
      },
      { price: 120_000, capacity: 0, trough: 0, store: 0, requires: [], flags: ['autoFeed', 'autoMill'] },
    ],
  },
});

export const FEEDS: Readonly<Record<FeedId, FeedDef>> = Object.freeze({
  hay: { id: 'hay', name: 'Hay', from: 'wheat', perUnit: FEED_PER_WHEAT, buyPrice: FEED_BUY_PRICE.hay },
  corn_feed: {
    id: 'corn_feed',
    name: 'Corn Feed',
    from: 'corn',
    perUnit: FEED_PER_CORN,
    buyPrice: FEED_BUY_PRICE.corn_feed,
  },
});
