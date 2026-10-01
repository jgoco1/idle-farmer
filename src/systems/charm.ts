// Charm (GDD §12.2, BALANCE.md §13.2): one number that says how lovely the farm is. It is derived,
// never stored: from the decorations standing on the land (only the first few copies of a piece
// count), the applied farmhouse paint, roof and loft, and each finished town-project stage.
//
// Charm only unlocks things: more decoration pieces, two milestones and a goal template. It never
// feeds a price, a growth rate, a timer or any Modifiers field (tests/decor.test.ts checks that).

import type { GameState } from '../core/state';
import type { GameData } from '../data';
import { CHARM_PER_PROJECT_STAGE } from '../data/balance';
import type { DecorId } from '../data/ids';
import type { SimContext } from './context';

export interface CharmBreakdown {
  pieces: number;
  farmhouse: number;
  projects: number;
  total: number;
}

/** The three parts of charm, and their sum. */
export function charmBreakdown(state: GameState, data: GameData): CharmBreakdown {
  const { placed, farmhouse } = state.decor;
  let pieces = 0;
  if (placed.length > 0) {
    // Placed pieces are few (at most 260), and most of them are paths and fences: count per id as we go.
    const seen: Partial<Record<DecorId, number>> = {};
    for (const p of placed) {
      const def = data.decor[p.decor];
      const n = (seen[p.decor] ?? 0) + 1;
      seen[p.decor] = n;
      if (def && n <= def.counted) pieces += def.charm;
    }
  }
  let house = 0;
  for (const id of [farmhouse.paint, farmhouse.roof]) if (id) house += data.decor[id]?.charm ?? 0;
  if (farmhouse.loft) house += data.decor.farmhouse_loft.charm;
  let stages = 0;
  for (const id in state.town.projects)
    stages += state.town.projects[id as keyof typeof state.town.projects]?.stagesDone ?? 0;
  const projects = stages * CHARM_PER_PROJECT_STAGE;
  return { pieces, farmhouse: house, projects, total: pieces + house + projects };
}

export function charmOf(state: GameState, data: GameData): number {
  const { placed, farmhouse } = state.decor;
  if (placed.length === 0 && !farmhouse.paint && !farmhouse.roof && !farmhouse.loft) {
    let stages = 0;
    for (const id in state.town.projects)
      stages += state.town.projects[id as keyof typeof state.town.projects]?.stagesDone ?? 0;
    return stages * CHARM_PER_PROJECT_STAGE;
  }
  return charmBreakdown(state, data).total;
}

/** The next charm level at which a decoration piece opens, with the pieces it opens (null when everything is open). */
export function nextCharmUnlock(
  state: GameState,
  data: GameData,
): { amount: number; pieces: DecorId[] } | null {
  const charm = charmOf(state, data);
  let best = Infinity;
  for (const def of Object.values(data.decor)) {
    for (const c of def.unlock)
      if (c.kind === 'charm' && c.amount > charm && c.amount < best) best = c.amount;
  }
  if (best === Infinity) return null;
  const pieces = Object.values(data.decor)
    .filter((d) => d.unlock.some((c) => c.kind === 'charm' && c.amount === best))
    .map((d) => d.id);
  return { amount: best, pieces };
}

/** Pushes `charmChanged` when charm is not what it was before an action (`before` from `charmOf` ahead of the change). */
export function noteCharm(state: GameState, ctx: SimContext, before: number): void {
  const now = charmOf(state, ctx.data);
  if (now !== before) ctx.events.push({ type: 'charmChanged', from: before, to: now });
}
