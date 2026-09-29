// The dispatch layer. The UI and renderer never edit state: they build an Action and call
// game.dispatch(action). This file validates the action and calls the system that handles it.
//
// To add an action: add a variant to `Action`, handle it in `applyAction` (delegating to a function
// in src/systems/), and return an ActionResult so the UI can show a message on failure.

import type { SimContext, ActionResult } from '../systems/context';
import { OK, fail } from '../systems/context';
import type { GameState } from './state';

export type Action =
  | { type: 'setMasterVolume'; value: number }
  | { type: 'plotClicked'; plot: number }
  | { type: 'debugSetTimeWarp'; on: boolean };

export const TIME_WARP_SPEED = 60;

export function applyAction(state: GameState, _ctx: SimContext, action: Action): ActionResult {
  switch (action.type) {
    case 'setMasterVolume': {
      if (!Number.isFinite(action.value)) return fail('Volume must be a number.');
      state.settings.masterVolume = Math.min(1, Math.max(0, action.value));
      return OK;
    }
    case 'plotClicked':
      // phase 02: return useToolOnPlots(state, ctx, tool, [action.plot])
      return fail('The soil is ready. Seeds arrive soon!');
    case 'debugSetTimeWarp':
      state.clock.speed = action.on ? TIME_WARP_SPEED : 1;
      return OK;
  }
}
