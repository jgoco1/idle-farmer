// The ranch's feed store (v2-05, save 13): hay and corn feed live here, not in the bag. Making, buying, the silo's
// milling and filling troughs all go through it. It has a capacity per feed; a full store refuses politely and
// nothing is ever lost. Feed an older save still carries in the bag (more than the migration could fit) is used
// after the store's, so it is never stranded.

import type { GameState } from '../core/state';
import { FEED_STORE_CAPACITY } from '../data/balance';
import type { FeedId } from '../data/ids';
import { countItem, removeItem } from './inventory';

/** Portions of `feed` in the store. */
export function feedInStore(state: GameState, feed: FeedId): number {
  return state.ranch.feedStore[feed];
}

/** Room left in the store for `feed`. */
export function feedRoom(state: GameState, feed: FeedId): number {
  return Math.max(0, FEED_STORE_CAPACITY - state.ranch.feedStore[feed]);
}

/** All the `feed` the player can use: the store, then any left in the bag. */
export function feedAvailable(state: GameState, feed: FeedId): number {
  return state.ranch.feedStore[feed] + countItem(state.inventory, feed);
}

/** Puts up to `qty` portions in the store. Returns how many fitted (the caller checks room first). */
export function storeFeed(state: GameState, feed: FeedId, qty: number): number {
  const put = Math.min(qty, feedRoom(state, feed));
  state.ranch.feedStore[feed] += put;
  return put;
}

/** Takes up to `qty` portions, from the store first and then the bag. Returns how many were taken. */
export function takeFeed(state: GameState, feed: FeedId, qty: number): number {
  const fromStore = Math.min(qty, state.ranch.feedStore[feed]);
  state.ranch.feedStore[feed] -= fromStore;
  const fromBag = Math.min(qty - fromStore, countItem(state.inventory, feed));
  if (fromBag > 0) removeItem(state.inventory, feed, fromBag);
  return fromStore + fromBag;
}
