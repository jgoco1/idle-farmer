// Unlock conditions (DATA_SCHEMAS.md §3) and the provisional farm level (BALANCE.md §9). Kinds that
// belong to later phases (skills, milestones, catches) are typed seams that evaluate as not met,
// except bundles, which count as met until phase 07 adds them.

import type { GameState } from '../core/state';
import { FARM_LEVEL_GOLD_UNIT } from '../data/balance';
import type { GameData } from '../data';
import type { UnlockCondition } from '../data/types';

/** BALANCE.md §9: 1 + floor(log2(1 + lifetimeGold / 300)). Phase 07 replaces it with skills. */
export function provisionalFarmLevel(lifetimeGold: number): number {
  return 1 + Math.floor(Math.log2(1 + Math.max(0, lifetimeGold) / FARM_LEVEL_GOLD_UNIT));
}

/** Lifetime gold needed for provisional farm level `level`: 300 · (2^(level − 1) − 1). */
export function lifetimeGoldForLevel(level: number): number {
  return FARM_LEVEL_GOLD_UNIT * (2 ** (level - 1) - 1);
}

export function farmLevel(state: GameState): number {
  return provisionalFarmLevel(state.stats.lifetimeGold);
}

function conditionMet(state: GameState, c: UnlockCondition): boolean {
  switch (c.kind) {
    case 'farmLevel':
      return farmLevel(state) >= c.level;
    case 'expansion':
      return state.expansions.includes(c.id);
    case 'upgrade':
      return (state.upgrades[c.id] ?? 0) >= c.level;
    case 'lifetimeGold':
      return state.stats.lifetimeGold >= c.amount;
    case 'bundle':
      return true; // bundles count as met until phase 07 (BALANCE.md §4)
    case 'caught':
      return state.fishing.collection[c.fish] !== undefined;
    default:
      return false; // later phases: skills, milestones, catches
  }
}

export function isUnlocked(state: GameState, conditions: readonly UnlockCondition[]): boolean {
  return conditions.every((c) => conditionMet(state, c));
}

/** Short hints for every unmet condition (empty when everything is met). */
export function unlockHints(
  state: GameState,
  data: GameData,
  conditions: readonly UnlockCondition[],
): string[] {
  return conditions.filter((c) => !conditionMet(state, c)).map((c) => hintFor(state, data, c));
}

/** A short hint for the first unmet condition, or null when everything is met. */
export function unlockHint(
  state: GameState,
  data: GameData,
  conditions: readonly UnlockCondition[],
): string | null {
  return unlockHints(state, data, conditions)[0] ?? null;
}

function hintFor(state: GameState, data: GameData, c: UnlockCondition): string {
  switch (c.kind) {
    case 'farmLevel': {
      const more = lifetimeGoldForLevel(c.level) - state.stats.lifetimeGold;
      return `Reach Farm Level ${c.level} (earn ${more.toLocaleString('en-US')}g more).`;
    }
    case 'expansion':
      return `Needs “${data.expansions[c.id].name}” first.`;
    case 'upgrade':
      return `Needs ${data.upgrades[c.id]?.name ?? c.id} level ${c.level}.`;
    case 'lifetimeGold':
      return `Earn ${c.amount.toLocaleString('en-US')}g in total.`;
    case 'caught':
      return `Catch a ${data.fish[c.fish].name} first.`;
    default:
      return 'Not available yet.';
  }
}
