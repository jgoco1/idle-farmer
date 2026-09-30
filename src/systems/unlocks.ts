// Unlock conditions (DATA_SCHEMAS.md §3). Only what phase 02 needs is evaluated for real; the rest
// are typed seams that later phases fill in.

import type { GameState } from '../core/state';
import type { UnlockCondition } from '../data/types';

/**
 * BALANCE.md §9 provisional farm level: 1 + floor(log2(1 + lifetimeGold / 300)).
 * TODO(phase03): read state.stats.lifetimeGold once stats exist; until then nothing is earned.
 */
export function provisionalFarmLevel(lifetimeGold: number): number {
  return 1 + Math.floor(Math.log2(1 + Math.max(0, lifetimeGold) / 300));
}

export function farmLevel(_state: GameState): number {
  return provisionalFarmLevel(0);
}

export function isUnlocked(state: GameState, conditions: readonly UnlockCondition[]): boolean {
  return conditions.every((c) => {
    switch (c.kind) {
      case 'farmLevel':
        return farmLevel(state) >= c.level;
      case 'bundle':
        return true; // bundles count as met until phase 07 (BALANCE.md §4)
      default:
        return false; // later phases: expansions, upgrades, skills, milestones, catches, gold
    }
  });
}
