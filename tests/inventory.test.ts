import { describe, expect, it } from 'vitest';
import type { Inventory } from '../src/core/state';
import {
  addItem,
  canAdd,
  countItem,
  hasItems,
  removeItem,
  spaceFor,
  usedSlots,
} from '../src/systems/inventory';

function inv(slots = 3, stackSize = 10): Inventory {
  return { slots: Array.from({ length: slots }, () => null), stackSize };
}

describe('inventory', () => {
  it('stacks up to the stack size, then opens new slots', () => {
    const i = inv();
    expect(addItem(i, 'turnip', 7)).toBe(true);
    expect(addItem(i, 'turnip', 5)).toBe(true);
    expect(i.slots).toEqual([{ item: 'turnip', qty: 10 }, { item: 'turnip', qty: 2 }, null]);
    expect(countItem(i, 'turnip')).toBe(12);
    expect(usedSlots(i)).toBe(2);
  });

  it('respects the capacity limit, all or nothing', () => {
    const i = inv(2, 10);
    expect(addItem(i, 'turnip', 15)).toBe(true);
    expect(spaceFor(i, 'turnip')).toBe(5);
    expect(spaceFor(i, 'potato')).toBe(0);
    expect(canAdd(i, 'turnip', 6)).toBe(false);
    const before = structuredClone(i);
    expect(addItem(i, 'turnip', 6)).toBe(false);
    expect(addItem(i, 'potato', 1)).toBe(false);
    expect(i).toEqual(before);
    expect(addItem(i, 'turnip', 5)).toBe(true);
    expect(countItem(i, 'turnip')).toBe(20);
  });

  it('removes from the last stacks first and frees empty slots', () => {
    const i = inv();
    addItem(i, 'turnip', 15);
    addItem(i, 'potato', 1);
    expect(removeItem(i, 'turnip', 7)).toBe(true);
    expect(i.slots).toEqual([{ item: 'turnip', qty: 8 }, null, { item: 'potato', qty: 1 }]);
    expect(removeItem(i, 'turnip', 9)).toBe(false);
    expect(countItem(i, 'turnip')).toBe(8);
    expect(removeItem(i, 'potato', 1)).toBe(true);
    expect(i.slots[2]).toBeNull();
  });

  it('checks several needs at once, adding up repeats', () => {
    const i = inv();
    addItem(i, 'turnip', 3);
    addItem(i, 'seed_turnip', 2);
    expect(
      hasItems(i, [
        { item: 'turnip', qty: 3 },
        { item: 'seed_turnip', qty: 2 },
      ]),
    ).toBe(true);
    expect(
      hasItems(i, [
        { item: 'turnip', qty: 2 },
        { item: 'turnip', qty: 2 },
      ]),
    ).toBe(false);
    expect(hasItems(i, [{ item: 'potato', qty: 1 }])).toBe(false);
    expect(hasItems(i, [])).toBe(true);
  });

  it('keeps hearty stacks apart (seam for phase 06)', () => {
    const i = inv();
    addItem(i, 'roasted_turnip', 1);
    addItem(i, 'roasted_turnip', 1, true);
    expect(usedSlots(i)).toBe(2);
    expect(countItem(i, 'roasted_turnip')).toBe(2);
    expect(countItem(i, 'roasted_turnip', true)).toBe(1);
  });

  it('rejects nonsense quantities', () => {
    const i = inv();
    expect(addItem(i, 'turnip', -1)).toBe(false);
    expect(addItem(i, 'turnip', 1.5)).toBe(false);
    expect(removeItem(i, 'turnip', -1)).toBe(false);
  });
});
