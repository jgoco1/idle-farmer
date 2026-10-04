// Polish after v3-00: discarding from the bag, the regrow note on seeds, and the Kitchen's recipe order.
import { describe, expect, it } from 'vitest';
import { applyAction, type Action } from '../src/core/actions';
import type { GameEvent } from '../src/core/events';
import { DEFAULT_PREFS, sanitizePrefs } from '../src/core/prefs';
import { makeContext } from '../src/core/sim';
import { createInitialState, type GameState } from '../src/core/state';
import { buildCalendar } from '../src/core/time';
import { GAME_DATA } from '../src/data';
import { CROP_IDS, RECIPE_IDS, seedOf, type RecipeId } from '../src/data/ids';
import { addItem, countItem } from '../src/systems/inventory';
import { canCook } from '../src/systems/cooking';
import { computeModifiers } from '../src/systems/modifiers';
import { regrowNote, seedNote } from '../src/ui/farmTools';
import { sortRecipes } from '../src/ui/recipeSort';
import { at, NY } from './helpers';

const T = at(NY, 2026, 1, 7, 12); // a spring day

function farm(): GameState {
  const s = createInitialState(T, NY, 1);
  s.inventory.slots = Array.from({ length: 12 }, () => null);
  return s;
}

function run(s: GameState, action: Action): { ok: boolean; reason?: string; events: GameEvent[] } {
  const events: GameEvent[] = [];
  const ctx = makeContext(s, GAME_DATA, buildCalendar(T, s.calendar, NY), events);
  return { ...applyAction(s, ctx, action), events };
}

describe('discarding from the bag', () => {
  it('throws the chosen amount away, reports it, and changes nothing else', () => {
    const s = farm();
    addItem(s.inventory, seedOf('pumpkin'), 12);
    const gold = s.gold;
    const r = run(s, { type: 'discardItem', item: seedOf('pumpkin'), qty: 5 });
    expect(r.ok).toBe(true);
    expect(countItem(s.inventory, seedOf('pumpkin'))).toBe(7);
    expect(r.events).toContainEqual({ type: 'discarded', item: seedOf('pumpkin'), qty: 5 });
    expect(s.gold).toBe(gold);
    expect(run(s, { type: 'discardItem', item: seedOf('pumpkin'), qty: 7 }).ok).toBe(true);
    expect(s.inventory.slots.every((x) => x === null)).toBe(true);
  });

  it('refuses more than you have, zero, fractions and unknown items, all or nothing', () => {
    const s = farm();
    addItem(s.inventory, 'turnip', 3);
    expect(run(s, { type: 'discardItem', item: 'turnip', qty: 4 })).toMatchObject({
      ok: false,
      reason: "You don't have 4 Turnip.",
    });
    expect(run(s, { type: 'discardItem', item: 'turnip', qty: 0 }).ok).toBe(false);
    expect(run(s, { type: 'discardItem', item: 'turnip', qty: 1.5 }).ok).toBe(false);
    expect(run(s, { type: 'discardItem', item: 'unicorn' as never, qty: 1 }).ok).toBe(false);
    expect(countItem(s.inventory, 'turnip')).toBe(3);
  });

  it('discards only the hearty or only the plain stack of a dish when asked', () => {
    const s = farm();
    const dish = RECIPE_IDS[0]!;
    addItem(s.inventory, dish, 2, false);
    addItem(s.inventory, dish, 3, true);
    expect(run(s, { type: 'discardItem', item: dish, qty: 3, hearty: true }).ok).toBe(true);
    expect(countItem(s.inventory, dish, true)).toBe(0);
    expect(countItem(s.inventory, dish, false)).toBe(2);
    expect(run(s, { type: 'discardItem', item: dish, qty: 3, hearty: false }).ok).toBe(false);
  });
});

describe('seeds that regrow say so', () => {
  const regrowers = CROP_IDS.filter((c) => GAME_DATA.crops[c].regrowSec !== null);

  it('there are regrowing crops (strawberry, tomato, …) and only they mention regrowing', () => {
    expect(regrowers.length).toBeGreaterThanOrEqual(5);
    for (const c of CROP_IDS) {
      const text = GAME_DATA.items[seedOf(c)]!.description;
      const mins = Math.round((GAME_DATA.crops[c].regrowSec ?? 0) / 60);
      if (regrowers.includes(c)) expect(text, c).toContain(`harvest again every ${mins} min`);
      else expect(text, c).not.toContain('harvest again');
      expect(regrowNote(GAME_DATA, c), c).toBe(regrowers.includes(c) ? ` · regrows every ${mins} min` : '');
    }
  });

  it('the Shop and seed-picker note adds it for an in-season regrower', () => {
    const s = farm();
    const cal = buildCalendar(T, s.calendar, NY);
    const mods = computeModifiers(s, GAME_DATA, cal.season);
    const spring = regrowers.find((c) => GAME_DATA.crops[c].seasons.includes(cal.season));
    expect(spring).toBeDefined();
    const note = seedNote(GAME_DATA, spring!, cal, mods);
    expect(note.ok).toBe(true);
    expect(note.text).toMatch(/regrows every \d+ min$/);
  });
});

describe('the Kitchen recipe order', () => {
  const s = farm();
  s.kitchen.known = [...RECIPE_IDS];
  const r = (id: RecipeId) => GAME_DATA.recipes[id];

  it('sell price and tier go highest first; name is alphabetical; buff groups by buff name', () => {
    const price = sortRecipes(s.kitchen.known, s, GAME_DATA, 'price');
    for (let i = 1; i < price.length; i++)
      expect(r(price[i - 1]!).basePrice).toBeGreaterThanOrEqual(r(price[i]!).basePrice);
    const tier = sortRecipes(s.kitchen.known, s, GAME_DATA, 'tier');
    for (let i = 1; i < tier.length; i++)
      expect(r(tier[i - 1]!).tier).toBeGreaterThanOrEqual(r(tier[i]!).tier);
    const names = sortRecipes(s.kitchen.known, s, GAME_DATA, 'name').map((id) => r(id).name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    const buffs = sortRecipes(s.kitchen.known, s, GAME_DATA, 'buff').map(
      (id) => GAME_DATA.buffs[r(id).buff].name,
    );
    expect(buffs).toEqual([...buffs].sort((a, b) => a.localeCompare(b)));
  });

  it('"Can cook now" puts every cookable recipe first, and never changes the list it was given', () => {
    const t = farm();
    t.kitchen.known = [...RECIPE_IDS];
    const target = RECIPE_IDS.find((id) => r(id).ingredients.every((i) => !i.item.startsWith('seed_')))!;
    for (const i of r(target).ingredients) addItem(t.inventory, i.item, i.qty);
    const before = [...t.kitchen.known];
    const order = sortRecipes(t.kitchen.known, t, GAME_DATA, 'ready');
    expect(t.kitchen.known).toEqual(before);
    const cookable = order.map((id) => canCook(t, r(id)));
    expect(cookable[0]).toBe(true);
    expect(cookable.indexOf(false)).toBeGreaterThan(cookable.lastIndexOf(true));
  });

  it('the choice is a pref: default "ready", unknown values fall back', () => {
    expect(DEFAULT_PREFS.kitchenSort).toBe('ready');
    expect(sanitizePrefs({ kitchenSort: 'price' }).kitchenSort).toBe('price');
    expect(sanitizePrefs({ kitchenSort: 'colour' }).kitchenSort).toBe('ready');
  });
});
