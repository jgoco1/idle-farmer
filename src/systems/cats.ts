// The farm cats (GDD §12.2): cosmetic only. Adopting one costs gold once; choosing which cat naps by the
// farmhouse door is free and can be changed at any time. Cats never give charm, gold or any modifier.

import type { GameState } from '../core/state';
import { isCatId, type CatId } from '../data/ids';
import { fail, OK, type ActionResult, type SimContext } from './context';
import { canAfford, spend } from './economy';

export function hasCat(state: GameState, id: CatId): boolean {
  return state.cats.adopted.includes(id);
}

export function adoptCat(state: GameState, ctx: SimContext, id: CatId): ActionResult {
  if (!isCatId(id)) return fail('There is no such cat.');
  const def = ctx.data.cats[id];
  if (hasCat(state, id)) return fail(`The ${def.name} already lives here.`);
  if (!canAfford(state, def.price)) return fail(`You need ${def.price.toLocaleString('en-US')}g for that.`);
  spend(state, def.price);
  state.cats.adopted.push(id);
  state.cats.active = id; // a new cat takes the warm spot by the door straight away
  ctx.events.push({ type: 'purchased', what: id, gold: def.price });
  return OK;
}

export function chooseCat(state: GameState, ctx: SimContext, id: CatId): ActionResult {
  if (!isCatId(id)) return fail('There is no such cat.');
  if (!hasCat(state, id)) return fail(`Adopt the ${ctx.data.cats[id].name} first.`);
  state.cats.active = id;
  return OK;
}
