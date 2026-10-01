// How long each fruit tree takes to first bear (BALANCE.md §13.5, v2 phase 03): every tree is planted on the
// first evening of the simulator's schedule (the same real calendar the bots play on, across the first
// spring, summer and autumn), and the real calendar is walked day by day until fruit hangs on it.

import { Game } from '../../src/core/game';
import { createInitialState } from '../../src/core/state';
import { GAME_DATA, type GameData } from '../../src/data';
import { FRUIT_IDS, saplingOf, treeOfFruit, type FruitId, type SeasonId } from '../../src/data/ids';
import { addItem } from '../../src/systems/inventory';
import { SIM_START, SIM_ZONE } from './bots';

const DAY = 24 * 3_600_000;

export interface FirstFruit {
  fruit: FruitId;
  matureDays: number;
  /** Real days from planting to the first fruit on the tree (≥ matureDays when the tree matures out of season). */
  firstFruitDays: number | null;
  /** The season of that day. */
  season: SeasonId | null;
}

/** Plants one tree of each kind on day 0 (the schedule's first evening) and finds the day each first bears. */
export function firstFruitTimes(planted: number = SIM_START, data: GameData = GAME_DATA): FirstFruit[] {
  return FRUIT_IDS.map((fruit): FirstFruit => {
    let t = planted;
    const state = createInitialState(planted, SIM_ZONE, 1);
    state.land.parcels.push('orchard');
    state.gold = 1_000_000;
    state.inventory.stackSize = 99;
    addItem(state.inventory, saplingOf(fruit), 1);
    const game = new Game(state, { data, lc: SIM_ZONE, now: () => t });
    game.dispatch({ type: 'plantTree', fruit, spot: 0 });
    const def = data.trees[treeOfFruit(fruit)];
    const plantedDay = game.calendar().dayIndex;
    for (let days = 1; days <= 400; days++) {
      const from = t;
      t += DAY;
      game.catchUp(from, t);
      if (state.orchard.trees[0]!.fruit > 0) {
        return {
          fruit,
          matureDays: def.matureDays,
          firstFruitDays: game.calendar().dayIndex - plantedDay,
          season: game.calendar().season,
        };
      }
    }
    return { fruit, matureDays: def.matureDays, firstFruitDays: null, season: null };
  });
}
