// The stacking inventory (GDD §6.2, DATA_SCHEMAS.md §6). Deterministic helpers over an `Inventory`:
// they mutate only the inventory passed in, and adds/removes are all-or-nothing so a harvest that
// does not fit leaves both the plot and the bag untouched.
//
// Capacity = slots.length (the backpack upgrade adds slots in phase 03); stack size = stackSize
// (barn storage raises it in phase 04). Stacks merge only when `hearty` matches (phase 06).

import type { GameState, Inventory } from '../core/state';
import type { ItemId } from '../data/ids';
import type { ItemCategory, ItemStack } from '../data/types';
import { fail, OK, type ActionResult, type SimContext } from './context';

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

/**
 * Throws `qty` of `item` away for good (the Inventory's Discard button: out-of-season seeds, junk). `hearty`
 * picks hearty or plain stacks of a dish; omitted, plain ones go first. Nothing else changes.
 */
export function discardItem(
  state: GameState,
  ctx: SimContext,
  item: ItemId,
  qty: number,
  hearty?: boolean,
): ActionResult {
  const def = ctx.data.items[item];
  if (!def) return fail('There is no such item.');
  if (!Number.isInteger(qty) || qty <= 0) return fail('Choose how many to discard.');
  const kind = hearty ?? (countItem(state.inventory, item, false) >= qty ? false : undefined);
  if (!removeItem(state.inventory, item, qty, kind)) return fail(`You don't have ${qty} ${def.name}.`);
  ctx.events.push({ type: 'discarded', item, qty });
  return OK;
}

/**
 * Tops each stack up from later stacks of the same kind, in place, so no two stacks of one kind are both
 * short of `stackSize`. Barn storage calls it when stacks grow, so two full stacks of 99 become 198 and an
 * empty slot. Nothing is gained or lost; returns true if anything moved.
 */
export function mergeStacks(inv: Inventory): boolean {
  let moved = false;
  for (let i = 0; i < inv.slots.length; i++) {
    const s = inv.slots[i];
    if (!s) continue;
    for (let j = i + 1; j < inv.slots.length && s.qty < inv.stackSize; j++) {
      const t = inv.slots[j];
      if (!t || !sameKind(t, s.item, Boolean(s.hearty))) continue;
      const n = Math.min(t.qty, inv.stackSize - s.qty);
      s.qty += n;
      t.qty -= n;
      if (t.qty === 0) inv.slots[j] = null;
      moved = true;
    }
  }
  return moved;
}

/**
 * Moves the stack in slot `from` onto slot `to` (dragging in the Inventory panel): into an empty slot it
 * moves, onto a stack of the same kind it merges as far as the stack size allows (the rest stays behind),
 * onto anything else the two swap.
 */
export function moveStack(state: GameState, ctx: SimContext, from: number, to: number): ActionResult {
  const slots = state.inventory.slots;
  const inRange = (i: number): boolean => Number.isInteger(i) && i >= 0 && i < slots.length;
  if (!inRange(from) || !inRange(to)) return fail('There is no such slot.');
  const s = slots[from];
  if (!s) return fail('That slot is empty.');
  if (from === to) return OK;
  const t = slots[to];
  if (t && sameKind(t, s.item, Boolean(s.hearty)) && t.qty < state.inventory.stackSize) {
    const n = Math.min(s.qty, state.inventory.stackSize - t.qty);
    t.qty += n;
    s.qty -= n;
    if (s.qty === 0) slots[from] = null;
  } else {
    slots[to] = s;
    slots[from] = t ?? null;
  }
  ctx.events.push({ type: 'bagArranged' });
  return OK;
}

/** The Sort button's order: what you plant, what you grow, what you catch and cook, then the rest. */
const SORT_CATEGORIES: readonly ItemCategory[] = [
  'seed',
  'sapling',
  'crop',
  'fruit',
  'animal',
  'fish',
  'dish',
  'drink',
  'feed',
  'ingredient',
  'junk',
];

/**
 * Sorts the bag (the Inventory panel's Sort button): merges every kind into as few stacks as the stack size
 * allows and lays them out from the first slot, by category (`SORT_CATEGORIES`), then name, plain before
 * hearty; empty slots go to the end. Merging never needs more slots than before, so it always fits.
 */
export function sortInventory(state: GameState, ctx: SimContext): ActionResult {
  const inv = state.inventory;
  const totals: ItemStack[] = [];
  for (const s of inv.slots) {
    if (!s) continue;
    const e = totals.find((t) => sameKind(t, s.item, Boolean(s.hearty)));
    if (e) e.qty += s.qty;
    else totals.push(s.hearty ? { item: s.item, qty: s.qty, hearty: true } : { item: s.item, qty: s.qty });
  }
  const rank = (t: ItemStack): number => {
    const r = SORT_CATEGORIES.indexOf(ctx.data.items[t.item]?.category ?? 'junk');
    return r < 0 ? SORT_CATEGORIES.length : r;
  };
  const name = (t: ItemStack): string => ctx.data.items[t.item]?.name ?? t.item;
  totals.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (name(a) < name(b) ? -1 : name(a) > name(b) ? 1 : 0) ||
      (a.item < b.item ? -1 : a.item > b.item ? 1 : 0) ||
      Number(Boolean(a.hearty)) - Number(Boolean(b.hearty)),
  );
  const next: (ItemStack | null)[] = [];
  for (const t of totals) {
    for (let left = t.qty; left > 0;) {
      const n = Math.min(left, inv.stackSize);
      next.push(t.hearty ? { item: t.item, qty: n, hearty: true } : { item: t.item, qty: n });
      left -= n;
    }
  }
  if (next.length > inv.slots.length) return fail('The bag is too full to sort.'); // never: merging only frees slots
  while (next.length < inv.slots.length) next.push(null);
  inv.slots = next;
  ctx.events.push({ type: 'bagArranged' });
  return OK;
}
