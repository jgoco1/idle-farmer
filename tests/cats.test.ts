// The farm cats: a brown tabby on every farm, more to adopt in the Shop's Decor tab. Cosmetic only.
import { describe, expect, it } from 'vitest';
import { applyAction, type Action } from '../src/core/actions';
import type { GameEvent } from '../src/core/events';
import { makeContext } from '../src/core/sim';
import { createInitialState, type GameState } from '../src/core/state';
import { buildCalendar } from '../src/core/time';
import { GAME_DATA } from '../src/data';
import { CAT_IDS, type CatId } from '../src/data/ids';
import { spriteDef } from '../src/render/sprites';
import { charmOf } from '../src/systems/charm';
import { computeModifiers } from '../src/systems/modifiers';
import { at, NY } from './helpers';

const T = at(NY, 2026, 1, 7, 12);

function farm(gold = 100_000): GameState {
  const s = createInitialState(T, NY, 1);
  s.gold = gold;
  return s;
}

function run(s: GameState, action: Action): { ok: boolean; reason?: string; events: GameEvent[] } {
  const events: GameEvent[] = [];
  const ctx = makeContext(s, GAME_DATA, buildCalendar(T, s.calendar, NY), events);
  const r = applyAction(s, ctx, action);
  return { ...r, events };
}

const adopt = (s: GameState, cat: CatId) => run(s, { type: 'adoptCat', cat });
const choose = (s: GameState, cat: CatId) => run(s, { type: 'chooseCat', cat });

describe('farm cats', () => {
  it('every farm starts with the brown tabby napping by the door, for free', () => {
    const s = farm();
    expect(s.cats).toEqual({ adopted: ['cat_tabby'], active: 'cat_tabby' });
    expect(GAME_DATA.cats.cat_tabby.name).toBe('Brown Tabby');
    expect(GAME_DATA.cats.cat_tabby.price).toBe(0);
  });

  it('the shop has an orange tabby and a Siamese among the cats to adopt, each with a price', () => {
    expect(CAT_IDS).toContain('cat_orange');
    expect(CAT_IDS).toContain('cat_siamese');
    for (const id of CAT_IDS) {
      if (id === 'cat_tabby') continue;
      expect(GAME_DATA.cats[id].price, id).toBeGreaterThan(0);
    }
  });

  it('adopting costs gold once and puts the new cat by the door', () => {
    const s = farm(10_000);
    const r = adopt(s, 'cat_siamese');
    expect(r.ok).toBe(true);
    expect(s.gold).toBe(10_000 - GAME_DATA.cats.cat_siamese.price);
    expect(s.cats).toEqual({ adopted: ['cat_tabby', 'cat_siamese'], active: 'cat_siamese' });
    expect(r.events).toContainEqual({
      type: 'purchased',
      what: 'cat_siamese',
      gold: GAME_DATA.cats.cat_siamese.price,
    });
    expect(adopt(s, 'cat_siamese')).toMatchObject({ ok: false, reason: 'The Siamese already lives here.' });
    expect(adopt(s, 'cat_tabby').ok).toBe(false);
  });

  it('cannot adopt without the gold, and nothing changes', () => {
    const s = farm(GAME_DATA.cats.cat_calico.price - 1);
    const before = structuredClone(s);
    expect(adopt(s, 'cat_calico')).toMatchObject({ ok: false });
    expect(s).toEqual(before);
  });

  it('choosing is free and only for adopted cats', () => {
    const s = farm();
    expect(choose(s, 'cat_orange')).toMatchObject({ ok: false, reason: 'Adopt the Orange Tabby first.' });
    adopt(s, 'cat_orange');
    adopt(s, 'cat_black');
    const gold = s.gold;
    expect(choose(s, 'cat_orange').ok).toBe(true);
    expect(s.cats.active).toBe('cat_orange');
    expect(choose(s, 'cat_tabby').ok).toBe(true);
    expect(s.cats.active).toBe('cat_tabby');
    expect(s.gold).toBe(gold);
    expect(choose(s, 'cat_lion' as CatId).ok).toBe(false);
  });

  it('is cosmetic: no charm and no modifier changes', () => {
    const s = farm(1_000_000);
    const charm = charmOf(s, GAME_DATA);
    const mods = computeModifiers(s, GAME_DATA);
    for (const id of CAT_IDS) if (id !== 'cat_tabby') adopt(s, id);
    expect(charmOf(s, GAME_DATA)).toBe(charm);
    expect(computeModifiers(s, GAME_DATA)).toEqual(mods);
  });

  it('every cat has its own two-frame sleeping sprite', () => {
    const looks = new Set<string>();
    for (const id of CAT_IDS) {
      const def = spriteDef(GAME_DATA.cats[id].sprite);
      expect(def.frames, id).toHaveLength(2);
      expect(def.frames[0]).not.toEqual(def.frames[1]); // it breathes
      looks.add(def.frames[0]!.join('\n'));
    }
    expect(looks.size).toBe(CAT_IDS.length);
  });
});
