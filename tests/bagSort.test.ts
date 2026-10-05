// Polish after v4-00: sorting the bag, dragging a stack onto another slot (move, merge or swap), and stacks
// merging when Barn Storage makes them bigger.
import { describe, expect, it } from 'vitest';
import { applyAction, type Action } from '../src/core/actions';
import type { GameEvent } from '../src/core/events';
import { makeContext } from '../src/core/sim';
import { createInitialState, type GameState } from '../src/core/state';
import { buildCalendar } from '../src/core/time';
import { GAME_DATA } from '../src/data';
import { seedOf, type ItemId } from '../src/data/ids';
import type { ItemStack } from '../src/data/types';
import { countItem, mergeStacks } from '../src/systems/inventory';
import { at, NY } from './helpers';

const T = at(NY, 2026, 1, 7, 12);

function bag(slots: (ItemStack | null)[], stackSize = 99): GameState {
  const s = createInitialState(T, NY, 1);
  s.inventory.slots = [...slots.map((x) => (x ? { ...x } : null))];
  while (s.inventory.slots.length < 12) s.inventory.slots.push(null);
  s.inventory.stackSize = stackSize;
  return s;
}

function run(s: GameState, action: Action): { ok: boolean; reason?: string; events: GameEvent[] } {
  const events: GameEvent[] = [];
  const ctx = makeContext(s, GAME_DATA, buildCalendar(T, s.calendar, NY), events);
  return { ...applyAction(s, ctx, action), events };
}

const st = (item: ItemId, qty: number, hearty = false): ItemStack =>
  hearty ? { item, qty, hearty: true } : { item, qty };

/** Every (item, hearty) total in the bag, so a test can check nothing was gained or lost. */
function totals(s: GameState): Record<string, number> {
  const t: Record<string, number> = {};
  for (const x of s.inventory.slots)
    if (x) t[`${x.item}${x.hearty ? '+h' : ''}`] = (t[`${x.item}${x.hearty ? '+h' : ''}`] ?? 0) + x.qty;
  return t;
}

describe('moving a stack', () => {
  it('moves into an empty slot', () => {
    const s = bag([st('turnip', 5)]);
    const r = run(s, { type: 'moveStack', from: 0, to: 7 });
    expect(r.ok).toBe(true);
    expect(s.inventory.slots[0]).toBeNull();
    expect(s.inventory.slots[7]).toEqual(st('turnip', 5));
    expect(r.events).toEqual([{ type: 'bagArranged' }]);
  });

  it('merges onto the same item up to the stack size, leaving the rest behind', () => {
    const s = bag([st('turnip', 60), st('turnip', 70)]);
    run(s, { type: 'moveStack', from: 0, to: 1 });
    expect(s.inventory.slots[0]).toEqual(st('turnip', 31));
    expect(s.inventory.slots[1]).toEqual(st('turnip', 99));
    run(s, { type: 'moveStack', from: 1, to: 0 }); // onto a short stack: 68 more fit
    expect(s.inventory.slots[0]).toEqual(st('turnip', 99));
    expect(s.inventory.slots[1]).toEqual(st('turnip', 31));
  });

  it('merges the whole stack when it fits, emptying the slot it came from', () => {
    const s = bag([st('egg', 10), null, st('egg', 20)]);
    run(s, { type: 'moveStack', from: 2, to: 0 });
    expect(s.inventory.slots[0]).toEqual(st('egg', 30));
    expect(s.inventory.slots[2]).toBeNull();
  });

  it('swaps with a different item, a hearty stack of the same dish, or a full stack', () => {
    const s = bag([st('turnip', 5), st('potato', 9), st('baked_potato', 2), st('baked_potato', 3, true)]);
    run(s, { type: 'moveStack', from: 0, to: 1 });
    expect(s.inventory.slots.slice(0, 2)).toEqual([st('potato', 9), st('turnip', 5)]);
    run(s, { type: 'moveStack', from: 2, to: 3 }); // plain and hearty never merge
    expect(s.inventory.slots.slice(2, 4)).toEqual([st('baked_potato', 3, true), st('baked_potato', 2)]);
    const full = bag([st('turnip', 99), st('turnip', 40)]);
    run(full, { type: 'moveStack', from: 1, to: 0 });
    expect(full.inventory.slots.slice(0, 2)).toEqual([st('turnip', 40), st('turnip', 99)]);
  });

  it('refuses an empty slot or one outside the bag, and changes nothing', () => {
    const s = bag([st('turnip', 5)]);
    const before = structuredClone(s);
    expect(run(s, { type: 'moveStack', from: 3, to: 0 }).ok).toBe(false);
    expect(run(s, { type: 'moveStack', from: 0, to: 12 }).ok).toBe(false);
    expect(run(s, { type: 'moveStack', from: -1, to: 0 }).ok).toBe(false);
    expect(run(s, { type: 'moveStack', from: 0.5, to: 1 }).ok).toBe(false);
    expect(s).toEqual(before);
    expect(run(s, { type: 'moveStack', from: 0, to: 0 })).toEqual({ ok: true, events: [] });
  });
});

describe('sorting the bag', () => {
  it('merges every kind into full stacks, orders by category then name, and puts empty slots last', () => {
    const s = bag([
      null,
      st('old_boot', 1),
      st('turnip', 50),
      st('baked_potato', 1, true),
      null,
      st(seedOf('turnip'), 30),
      st('turnip', 80),
      st('potato', 4),
      st('baked_potato', 2),
      st(seedOf('potato'), 10),
      st('egg', 3),
    ]);
    const before = totals(s);
    const r = run(s, { type: 'sortInventory' });
    expect(r.ok).toBe(true);
    expect(r.events).toEqual([{ type: 'bagArranged' }]);
    expect(totals(s)).toEqual(before);
    expect(s.inventory.slots).toEqual([
      st(seedOf('potato'), 10),
      st(seedOf('turnip'), 30),
      st('potato', 4),
      st('turnip', 99),
      st('turnip', 31),
      st('egg', 3),
      st('baked_potato', 2),
      st('baked_potato', 1, true),
      st('old_boot', 1),
      null,
      null,
      null,
    ]);
  });

  it('is stable: sorting a sorted bag changes nothing', () => {
    const s = bag([st('potato', 4), st('turnip', 3), st(seedOf('turnip'), 2)]);
    run(s, { type: 'sortInventory' });
    const once = structuredClone(s.inventory.slots);
    run(s, { type: 'sortInventory' });
    expect(s.inventory.slots).toEqual(once);
  });

  it('always fits, even in a full bag', () => {
    const s = bag(Array.from({ length: 12 }, (_, i) => st(i % 2 ? 'turnip' : 'potato', 40)));
    expect(run(s, { type: 'sortInventory' }).ok).toBe(true);
    expect(countItem(s.inventory, 'turnip')).toBe(240);
    expect(countItem(s.inventory, 'potato')).toBe(240);
    expect(s.inventory.slots.filter((x) => x === null)).toHaveLength(6);
  });
});

describe('bigger stacks merge', () => {
  it('Barn Storage tops stacks up from later ones of the same kind, in place', () => {
    const s = bag([st('turnip', 99), st('potato', 99), st('turnip', 99), st('turnip', 99)]);
    s.gold = 1_000_000;
    s.progression.farmLevelFloor = 2;
    expect(run(s, { type: 'buyUpgrade', id: 'barn_storage' }).ok).toBe(true);
    expect(s.inventory.stackSize).toBe(199);
    expect(s.inventory.slots.slice(0, 4)).toEqual([
      st('turnip', 199),
      st('potato', 99),
      null,
      st('turnip', 98),
    ]);
  });

  it('mergeStacks keeps hearty and plain apart and reports whether anything moved', () => {
    const s = bag([st('baked_potato', 3), st('baked_potato', 2, true), st('baked_potato', 4)]);
    expect(mergeStacks(s.inventory)).toBe(true);
    expect(s.inventory.slots.slice(0, 3)).toEqual([st('baked_potato', 7), st('baked_potato', 2, true), null]);
    expect(mergeStacks(s.inventory)).toBe(false);
  });
});
