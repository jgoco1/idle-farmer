// The stacking inventory (GDD §6.2, DATA_SCHEMAS.md §6). Deterministic helpers over an `Inventory`:
// they mutate only the inventory passed in, and adds/removes are all-or-nothing so a harvest that
// does not fit leaves both the plot and the bag untouched.
//
// Capacity = slots.length (the backpack upgrade adds slots in phase 03); stack size = stackSize
// (barn storage raises it in phase 04). Stacks merge only when `hearty` matches (phase 06).

import type { Inventory } from '../core/state';
import type { ItemId } from '../data/ids';
import type { ItemStack } from '../data/types';

function sameKind(s: ItemStack, item: ItemId, hearty: boolean): boolean {
  return s.item === item && Boolean(s.hearty) === hearty;
}

/** How many of `item` could be added right now (existing stacks first, then empty slots). */
export function spaceFor(inv: Inventory, item: ItemId, hearty = false): number {
  let space = 0;
  for (let i = 0; i < inv.slots.length; i++) {
    const s = inv.slots[i]!;
    if (s === null) space += inv.stackSize;
    else if (sameKind(s, item, hearty)) space += Math.max(0, inv.stackSize - s.qty);
  }
  return space;
}

export function canAdd(inv: Inventory, item: ItemId, qty: number, hearty = false): boolean {
  return qty <= spaceFor(inv, item, hearty);
}

/**
 * Adds `qty` of `item`, topping up existing stacks before opening new slots. All or nothing:
 * returns false (and changes nothing) when it does not all fit.
 */
export function addItem(inv: Inventory, item: ItemId, qty: number, hearty = false): boolean {
  if (!Number.isInteger(qty) || qty < 0) return false;
  if (!canAdd(inv, item, qty, hearty)) return false;
  let left = qty;
  for (const s of inv.slots) {
    if (left === 0) break;
    if (s && sameKind(s, item, hearty) && s.qty < inv.stackSize) {
      const n = Math.min(left, inv.stackSize - s.qty);
      s.qty += n;
      left -= n;
    }
  }
  for (let i = 0; i < inv.slots.length && left > 0; i++) {
    if (inv.slots[i] !== null) continue;
    const n = Math.min(left, inv.stackSize);
    inv.slots[i] = hearty ? { item, qty: n, hearty: true } : { item, qty: n };
    left -= n;
  }
  return true;
}

/** Total quantity of `item` across all stacks (hearty and plain alike unless `hearty` is given). */
export function countItem(inv: Inventory, item: ItemId, hearty?: boolean): number {
  let n = 0;
  for (let i = 0; i < inv.slots.length; i++) {
    const s = inv.slots[i];
    if (s && s.item === item && (hearty === undefined || Boolean(s.hearty) === hearty)) n += s.qty;
  }
  return n;
}

/** True when the inventory holds every stack in `needs` (quantities of the same item add up). */
export function hasItems(inv: Inventory, needs: readonly ItemStack[]): boolean {
  const want = new Map<string, { item: ItemId; hearty?: boolean; qty: number }>();
  for (const n of needs) {
    const key = `${n.item}|${n.hearty ? 'h' : ''}`;
    const e = want.get(key);
    if (e) e.qty += n.qty;
    else want.set(key, { item: n.item, hearty: n.hearty ? true : undefined, qty: n.qty });
  }
  for (const w of want.values()) if (countItem(inv, w.item, w.hearty) < w.qty) return false;
  return true;
}

/**
 * Removes `qty` of `item`, emptying the last stacks first. All or nothing: returns false (and
 * changes nothing) when there are not enough.
 */
export function removeItem(inv: Inventory, item: ItemId, qty: number, hearty?: boolean): boolean {
  if (!Number.isInteger(qty) || qty < 0) return false;
  if (countItem(inv, item, hearty) < qty) return false;
  let left = qty;
  for (let i = inv.slots.length - 1; i >= 0 && left > 0; i--) {
    const s = inv.slots[i];
    if (!s || s.item !== item || (hearty !== undefined && Boolean(s.hearty) !== hearty)) continue;
    const n = Math.min(left, s.qty);
    s.qty -= n;
    left -= n;
    if (s.qty === 0) inv.slots[i] = null;
  }
  return true;
}

/** Number of occupied slots. */
export function usedSlots(inv: Inventory): number {
  return inv.slots.reduce((n, s) => n + (s ? 1 : 0), 0);
}
