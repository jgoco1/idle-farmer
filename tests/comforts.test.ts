// Small comforts (v2 phase 06): Harvest all / Water all, Cook ×N and favourites, the Farm Level chip's number.

import { describe, expect, it } from 'vitest';
import { applyAction, type Action } from '../src/core/actions';
import type { GameEvent } from '../src/core/events';
import { DEFAULT_PREFS, PrefsStore, sanitizePrefs } from '../src/core/prefs';
import { makeContext } from '../src/core/sim';
import { createInitialState, emptyPlot, type GameState } from '../src/core/state';
import { buildCalendar } from '../src/core/time';
import { GAME_DATA } from '../src/data';
import { RECIPE_IDS, type RecipeId } from '../src/data/ids';
import { GREENHOUSE_BASE } from '../src/data/balance';
import { canCook, kitchenSlots, maxBatch } from '../src/systems/cooking';
import { isReady, plotWatered } from '../src/systems/farming';
import { addItem, countItem } from '../src/systems/inventory';
import { farmLevel } from '../src/systems/unlocks';
import { bulkPlots } from '../src/ui/farmTools';
import { pinFavourites, sortRecipes, toggleFavourite } from '../src/ui/recipeSort';
import { at, NY, setFarmLevel } from './helpers';

const T = at(NY, 2026, 1, 7, 12); // a spring day

function farm(): GameState {
  const s = createInitialState(T, NY, 1);
  s.inventory.slots = Array.from({ length: 24 }, () => null);
  s.inventory.stackSize = 99;
  return s;
}

function run(s: GameState, action: Action): { ok: boolean; reason?: string; events: GameEvent[] } {
  const events: GameEvent[] = [];
  const ctx = makeContext(s, GAME_DATA, buildCalendar(T, s.calendar, NY), events);
  return { ...applyAction(s, ctx, action), events };
}

describe('Harvest all and Water all', () => {
  it('bulkPlots is the whole field by index, and not the greenhouse', () => {
    const s = farm();
    s.farm.greenhouse = [emptyPlot('tilled'), emptyPlot('tilled')];
    expect(bulkPlots(s)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(bulkPlots(s).every((i) => i < GREENHOUSE_BASE)).toBe(true);
  });

  it('Harvest all picks every ready crop in the field with the Shift-click action', () => {
    const s = farm();
    for (const i of [0, 3, 6]) {
      s.farm.plots[i] = {
        state: 'planted',
        crop: 'turnip',
        growthMs: 10 * 60_000,
        harvests: 0,
        waterMsLeft: 0,
      };
      expect(isReady(s.farm.plots[i]!, GAME_DATA)).toBe(true);
    }
    s.farm.plots[1] = { state: 'planted', crop: 'turnip', growthMs: 1000, harvests: 0, waterMsLeft: 0 }; // still growing
    const r = run(s, { type: 'useTool', tool: 'hand', plots: bulkPlots(s), seed: null });
    expect(r.ok).toBe(true);
    expect(r.events.filter((e) => e.type === 'harvested').map((e) => (e as { plot: number }).plot)).toEqual([
      0, 3, 6,
    ]);
    expect(s.farm.plots[1]!.state).toBe('planted');
    expect(countItem(s.inventory, 'turnip')).toBeGreaterThanOrEqual(3);
  });

  it('Water all waters every plot that holds a crop', () => {
    const s = farm();
    for (const i of [0, 1, 5]) {
      s.farm.plots[i] = { state: 'planted', crop: 'potato', growthMs: 0, harvests: 0, waterMsLeft: 0 };
    }
    const r = run(s, { type: 'useTool', tool: 'water', plots: bulkPlots(s), seed: null });
    expect(r.ok).toBe(true);
    for (const i of [0, 1, 5]) expect(plotWatered(s, GAME_DATA, i)).toBe(true);
  });

  it('says why when there is nothing to do', () => {
    const s = farm();
    const r = run(s, { type: 'useTool', tool: 'hand', plots: bulkPlots(s), seed: null });
    expect(r.ok).toBe(false);
    expect(r.reason).toBeTruthy();
  });
});

describe('Cook ×N', () => {
  function kitchen(level: number): GameState {
    const s = farm();
    s.upgrades.kitchen = level;
    return s;
  }
  const recipe = GAME_DATA.recipes.roasted_turnip;

  it('is limited by the free stove slots', () => {
    const s = kitchen(1); // Stove: two slots
    addItem(s.inventory, 'turnip', 20);
    expect(kitchenSlots(s, GAME_DATA)).toBe(2);
    expect(maxBatch(s, GAME_DATA, recipe)).toBe(2);
    run(s, { type: 'cook', recipe: 'roasted_turnip' });
    expect(maxBatch(s, GAME_DATA, recipe)).toBe(1);
    run(s, { type: 'cook', recipe: 'roasted_turnip' });
    expect(maxBatch(s, GAME_DATA, recipe)).toBe(0);
  });

  it('is limited by the ingredients in the bag, counting every ingredient', () => {
    const s = kitchen(2); // Oven: three slots
    const need = recipe.ingredients[0]!;
    addItem(s.inventory, need.item, need.qty * 2 + (need.qty - 1));
    expect(maxBatch(s, GAME_DATA, recipe)).toBe(2);
    s.inventory.slots = s.inventory.slots.map(() => null);
    expect(maxBatch(s, GAME_DATA, recipe)).toBe(0);
    expect(canCook(s, recipe)).toBe(false);
  });

  it('N cook actions in a row put N dishes on the stove, using N sets of ingredients', () => {
    const s = kitchen(2);
    const need = recipe.ingredients[0]!;
    addItem(s.inventory, need.item, need.qty * 3);
    const n = maxBatch(s, GAME_DATA, recipe);
    expect(n).toBe(3);
    for (let i = 0; i < n; i++) expect(run(s, { type: 'cook', recipe: 'roasted_turnip' }).ok).toBe(true);
    expect(s.kitchen.queue).toHaveLength(3);
    expect(countItem(s.inventory, need.item)).toBe(0);
    expect(run(s, { type: 'cook', recipe: 'roasted_turnip' }).ok).toBe(false); // the stove is full
  });
});

describe('recipe favourites', () => {
  const s = farm();
  const known = sortRecipes(
    RECIPE_IDS.filter((id) => s.kitchen.known.includes(id)),
    s,
    GAME_DATA,
    'name',
  );

  it('pins keep the book order within each group, in any sort order', () => {
    expect(known.length).toBeGreaterThanOrEqual(3);
    const last = known[known.length - 1]!;
    const first = known[0]!;
    expect(pinFavourites(known, [last])).toEqual([last, ...known.filter((id) => id !== last)]);
    expect(pinFavourites(known, [last, first])).toEqual([
      first,
      last,
      ...known.filter((id) => id !== last && id !== first),
    ]);
    expect(pinFavourites(known, [])).toEqual(known);
    for (const mode of ['ready', 'price', 'tier', 'buff', 'name'] as const) {
      const sorted = sortRecipes(known, s, GAME_DATA, mode);
      expect(pinFavourites(sorted, [last])[0]).toBe(last);
    }
  });

  it('a favourite the player does not know yet is ignored', () => {
    const unknown = RECIPE_IDS.find((id) => !s.kitchen.known.includes(id))!;
    expect(pinFavourites(known, [unknown])).toEqual(known);
  });

  it('toggling adds and removes', () => {
    const a = toggleFavourite([], 'roasted_turnip');
    expect(a).toEqual(['roasted_turnip']);
    expect(toggleFavourite(a, 'baked_potato')).toEqual(['roasted_turnip', 'baked_potato']);
    expect(toggleFavourite(a, 'roasted_turnip')).toEqual([]);
  });

  it('are a per-device pref list that keeps only real recipes, once each', () => {
    expect(DEFAULT_PREFS.kitchenFavourites).toEqual([]);
    expect(
      sanitizePrefs({ kitchenFavourites: ['baked_potato', 'nonsense', 'baked_potato', 7, 'roasted_turnip'] })
        .kitchenFavourites,
    ).toEqual(['baked_potato', 'roasted_turnip']);
    expect(sanitizePrefs({ kitchenFavourites: 'baked_potato' }).kitchenFavourites).toEqual([]);
    const data = new Map<string, string>();
    const store = new PrefsStore({
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => void data.set(k, v),
      removeItem: (k) => void data.delete(k),
    });
    store.set('kitchenFavourites', ['roasted_turnip' as RecipeId]);
    const again = new PrefsStore({
      getItem: (k) => data.get(k) ?? null,
      setItem: () => undefined,
      removeItem: () => undefined,
    });
    expect(again.value.kitchenFavourites).toEqual(['roasted_turnip']);
  });
});

describe('the Farm Level chip', () => {
  it('shows farmLevel(state), which a milestone floor or the skills can raise', () => {
    const s = farm();
    expect(farmLevel(s)).toBe(1);
    setFarmLevel(s, 4);
    expect(farmLevel(s)).toBe(4);
  });
});
