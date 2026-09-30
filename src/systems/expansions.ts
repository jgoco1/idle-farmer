// Farm expansion (GDD §6.2, BALANCE.md §5): four purchases grow the plot grid from 4 × 2 to 8 × 6.
// Plots are row-major, so growing the grid rebuilds the array by (col, row): every existing plot
// keeps its crop, water and growth, and the new plots start untilled.

import type { GameState, Plot } from '../core/state';
import { emptyPlot } from '../core/state';
import type { GameData } from '../data';
import { FARM_EXPANSIONS } from '../data/expansions';
import type { ExpansionId } from '../data/ids';
import { fail, OK, type ActionResult, type SimContext } from './context';
import { canAfford, spend } from './economy';
import { isUnlocked, unlockHint } from './unlocks';

/** The plots of `grid` resized to `cols × rows`, keeping every plot at its (col, row). */
export function resizePlots(
  plots: readonly Plot[],
  from: { cols: number; rows: number },
  to: { cols: number; rows: number },
): Plot[] {
  const out: Plot[] = [];
  for (let r = 0; r < to.rows; r++) {
    for (let c = 0; c < to.cols; c++) {
      const old = c < from.cols && r < from.rows ? plots[r * from.cols + c] : undefined;
      out.push(old ?? emptyPlot('untilled'));
    }
  }
  return out;
}

/** Old plot index → new plot index after a resize (for anything keyed by plot index). */
export function remapPlotIndex(index: number, from: { cols: number }, to: { cols: number }): number {
  return Math.floor(index / from.cols) * to.cols + (index % from.cols);
}

/** The next farm step to buy, or null when the farm is fully grown. */
export function nextFarmExpansion(state: GameState): ExpansionId | null {
  return FARM_EXPANSIONS.find((id) => !state.expansions.includes(id)) ?? null;
}

export type ExpansionStatus = 'owned' | 'available' | 'locked';

export function expansionStatus(state: GameState, data: GameData, id: ExpansionId): ExpansionStatus {
  if (state.expansions.includes(id)) return 'owned';
  return isUnlocked(state, data.expansions[id].requires) ? 'available' : 'locked';
}

export function buyExpansion(state: GameState, ctx: SimContext, id: ExpansionId): ActionResult {
  const def = ctx.data.expansions[id];
  if (!def) return fail('Unknown expansion.');
  if (state.expansions.includes(id)) return fail(`You already have “${def.name}”.`);
  if (def.kind !== 'farm' || !def.grid) return fail(`“${def.name}” opens with fishing, in a later update.`);
  if (!isUnlocked(state, def.requires)) {
    return fail(unlockHint(state, ctx.data, def.requires) ?? `“${def.name}” is not available yet.`);
  }
  if (!canAfford(state, def.price)) return fail(`You need ${def.price.toLocaleString('en-US')}g for that.`);
  spend(state, def.price);
  const farm = state.farm;
  const grid = {
    cols: Math.max(farm.grid.cols, def.grid.cols),
    rows: Math.max(farm.grid.rows, def.grid.rows),
  };
  // The seed planter's memory is indexed like the plots (field first, then greenhouse): move it too.
  const memory = Array.from({ length: farm.plots.length }, (_, i) => state.lastPlantedCrop[i] ?? null);
  const remembered = resizePlots(
    memory.map((c) => ({ ...emptyPlot('untilled'), crop: c })),
    farm.grid,
    grid,
  ).map((p) => p.crop);
  state.lastPlantedCrop = [...remembered, ...state.lastPlantedCrop.slice(farm.plots.length)];
  farm.plots = resizePlots(farm.plots, farm.grid, grid);
  farm.grid = grid;
  state.expansions.push(id);
  ctx.events.push({ type: 'purchased', what: id, gold: def.price });
  return OK;
}
