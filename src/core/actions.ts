// The dispatch layer. The UI and renderer never edit state: they build an Action and call
// game.dispatch(action). This file validates the action and calls the system that handles it.
//
// To add an action: add a variant to `Action`, handle it in `applyAction` (delegating to a function
// in src/systems/), and return an ActionResult so the UI can show a message on failure.

import type { SimContext, ActionResult } from '../systems/context';
import { OK, fail } from '../systems/context';
import { harvestPlots, plantPlots, tillPlots, useTool, waterPlots, type FarmTool } from '../systems/farming';
import { buySeeds } from '../systems/seedCrate';
import type { CropId } from '../data/ids';
import type { GameState } from './state';

export type Action =
  | { type: 'setMasterVolume'; value: number }
  | { type: 'till' | 'water' | 'harvest'; plots: number[] }
  | { type: 'plant'; crop: CropId; plots: number[] }
  /** A toolbar tool on some plots; `auto` picks the obvious action from the first plot. */
  | { type: 'useTool'; tool: FarmTool; plots: number[]; seed: CropId | null }
  /** TODO(phase03): the temporary Seed Crate; the real Shop replaces it. */
  | { type: 'buySeeds'; crop: CropId; qty: number }
  | { type: 'debugSetTimeWarp'; on: boolean };

export const TIME_WARP_SPEED = 60;

export function applyAction(state: GameState, ctx: SimContext, action: Action): ActionResult {
  switch (action.type) {
    case 'setMasterVolume': {
      if (!Number.isFinite(action.value)) return fail('Volume must be a number.');
      state.settings.masterVolume = Math.min(1, Math.max(0, action.value));
      return OK;
    }
    case 'till':
      return tillPlots(state, ctx, action.plots);
    case 'water':
      return waterPlots(state, ctx, action.plots);
    case 'harvest':
      return harvestPlots(state, ctx, action.plots);
    case 'plant':
      return plantPlots(state, ctx, action.crop, action.plots);
    case 'useTool':
      return useTool(state, ctx, action.tool, action.plots, action.seed);
    case 'buySeeds':
      return buySeeds(state, ctx, action.crop, action.qty);
    case 'debugSetTimeWarp':
      state.clock.speed = action.on ? TIME_WARP_SPEED : 1;
      return OK;
  }
}
