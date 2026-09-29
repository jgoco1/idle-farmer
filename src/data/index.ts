import { START_GRID } from './balance';

/**
 * Everything in src/data, gathered once (DATA_SCHEMAS.md §4.10). Systems receive it through
 * `ctx.data` and never import data files directly. Phase 01 has no content tables yet; each phase
 * adds its table here (items, crops, fish, …).
 */
export interface GameData {
  startGrid: { readonly cols: number; readonly rows: number };
}

export const GAME_DATA: GameData = Object.freeze({
  startGrid: START_GRID,
});
