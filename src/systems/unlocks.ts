// Unlock conditions (DATA_SCHEMAS.md §3) and the Farm Level (BALANCE.md §8–9). Since phase 07 the
// Farm Level comes from the three skills and the milestones (`systems/skills.ts`); the phase 02–06
// lifetime-gold formula survives only to give older saves the level they already had.

import type { GameState } from '../core/state';
import { FARM_LEVEL_GOLD_UNIT } from '../data/balance';
import type { GameData } from '../data';
import { SKILL_NAMES } from '../data/skills';
import type { UnlockCondition } from '../data/types';
import { charmOf } from './charm';
import { earnedFarmLevel, farmPoints, pointsForFarmLevel, skillLevel } from './skills';

/** BALANCE.md §9: 1 + floor(log2(1 + lifetimeGold / 300)). Used to backfill `farmLevelFloor` for old saves. */
export function provisionalFarmLevel(lifetimeGold: number): number {
  return 1 + Math.floor(Math.log2(1 + Math.max(0, lifetimeGold) / FARM_LEVEL_GOLD_UNIT));
}

/** The Farm Level: from skills and milestones, never below the level an older save already showed. */
export function farmLevel(state: GameState): number {
  return Math.max(state.progression.farmLevelFloor, earnedFarmLevel(state));
}

/** How many known recipes are at least `minTier`. Tiers come from `data`; without it every recipe counts. */
function knownOfTier(state: GameState, data: GameData | undefined, minTier: number): number {
  if (!data) return state.kitchen.known.length;
  return state.kitchen.known.filter((id) => data.recipes[id].tier >= minTier).length;
}

function conditionMet(state: GameState, c: UnlockCondition, data?: GameData): boolean {
  switch (c.kind) {
    case 'farmLevel':
      return farmLevel(state) >= c.level;
    case 'expansion':
      return state.expansions.includes(c.id);
    case 'upgrade':
      return (state.upgrades[c.id] ?? 0) >= c.level;
    case 'lifetimeGold':
      return state.stats.lifetimeGold >= c.amount;
    case 'skillLevel':
      return skillLevel(state, c.skill) >= c.level;
    case 'milestone':
      return state.progression.milestones.done.includes(c.id);
    case 'bundle':
      return state.progression.completedBundles.includes(c.id);
    case 'caught':
      return state.fishing.collection[c.fish] !== undefined;
    case 'fishCaught':
      return state.stats.fishCaught >= c.count;
    case 'knownRecipes':
      return knownOfTier(state, data, c.minTier) >= c.count;
    case 'parcel':
      return state.land.parcels.includes(c.id);
    case 'charm':
      return data !== undefined && charmOf(state, data) >= c.amount;
    case 'townProject':
      return (
        data !== undefined &&
        (state.town.projects[c.id]?.stagesDone ?? 0) >= (c.stage ?? data.townProjects[c.id].stages.length)
      );
  }
}

/** Whether every condition holds. `data` is needed for `knownRecipes`, `charm` and `townProject` (without it those are false or count every recipe). */
export function isUnlocked(
  state: GameState,
  conditions: readonly UnlockCondition[],
  data?: GameData,
): boolean {
  return conditions.every((c) => conditionMet(state, c, data));
}

/** Short hints for every unmet condition (empty when everything is met). */
export function unlockHints(
  state: GameState,
  data: GameData,
  conditions: readonly UnlockCondition[],
): string[] {
  return conditions.filter((c) => !conditionMet(state, c, data)).map((c) => hintFor(state, data, c));
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
      const more = Math.max(1, pointsForFarmLevel(c.level) - farmPoints(state));
      return `Reach Farm Level ${c.level} (${more} more farm point${more === 1 ? '' : 's'}).`;
    }
    case 'expansion':
      return `Needs “${data.expansions[c.id].name}” first.`;
    case 'upgrade':
      return `Needs ${data.upgrades[c.id]?.name ?? c.id} level ${c.level}.`;
    case 'lifetimeGold':
      return `Earn ${c.amount.toLocaleString('en-US')}g in total.`;
    case 'caught':
      return `Catch a ${data.fish[c.fish].name} first.`;
    case 'skillLevel':
      return `Reach ${SKILL_NAMES[c.skill]} level ${c.level}.`;
    case 'milestone':
      return `Finish the “${data.milestones.find((m) => m.id === c.id)?.title ?? c.id}” milestone.`;
    case 'bundle':
      return `Complete the ${data.bundles[c.id].name} bundle on the Community Board.`;
    case 'fishCaught':
      return `Catch ${c.count} fish first.`;
    case 'knownRecipes':
      return `Learn ${c.count} recipe${c.count === 1 ? '' : 's'} first.`;
    case 'parcel':
      return `Buy the ${data.parcels[c.id].name} first.`;
    case 'charm':
      return `Reach charm ${c.amount}.`;
    case 'townProject': {
      const p = data.townProjects[c.id];
      return c.stage === undefined || c.stage >= p.stages.length
        ? `Finish “${p.name}” on the Community Board.`
        : `Finish stage ${c.stage} of “${p.name}”.`;
    }
  }
}
