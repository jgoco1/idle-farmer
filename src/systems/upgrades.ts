// Upgrades bought with gold (BALANCE.md §4): the backpack and barn (storage), the tools, and the
// farm automation. One `buyUpgrade` action and cost curve serve all of them; placeables
// (sprinkler, scarecrow) count units bought, and the Placement code puts them on the field.

import { emptyPlot, type GameState } from '../core/state';
import type { GameData } from '../data';
import { roundNice } from '../data/balance';
import type { UpgradeId } from '../data/ids';
import type { AutomationFlag, UnlockCondition, UpgradeDef, UpgradeEffect } from '../data/types';
import { fail, OK, type ActionResult, type SimContext } from './context';
import { canAfford, spend } from './economy';
import { isUnlocked, unlockHint } from './unlocks';

export function upgradeLevel(state: GameState, id: UpgradeId): number {
  return state.upgrades[id] ?? 0;
}

/** Cost to go from level n to n + 1: roundNice(base · ratio^n). */
export function upgradeCost(def: UpgradeDef, level: number): number {
  return roundNice(def.cost.base * def.cost.ratio ** level);
}

/** Inventory slots for a backpack level. */
export function backpackSlots(data: GameData, level: number): number | null {
  return data.upgrades.backpack?.effect[level]?.inventorySlots ?? null;
}

/** The effect row of `id` at the player's current level (level 0 = nothing bought). */
export function effectOf(state: GameState, data: GameData, id: UpgradeId): UpgradeEffect | undefined {
  return data.upgrades[id]?.effect[upgradeLevel(state, id)];
}

/** Whether the current level of `id` switches on `flag` (levels are cumulative in the data). */
export function hasFlag(state: GameState, data: GameData, id: UpgradeId, flag: AutomationFlag): boolean {
  return effectOf(state, data, id)?.flags?.includes(flag) ?? false;
}

/** Everything that must hold to buy level `level + 1`: the upgrade's own and that level's conditions. */
export function requirementsFor(def: UpgradeDef, level: number): UnlockCondition[] {
  return [...def.requires, ...(def.levelRequires?.[level + 1] ?? [])];
}

/** Applies an upgrade's effect for its new level. */
function applyEffect(state: GameState, data: GameData, id: UpgradeId, level: number): void {
  const effect = data.upgrades[id]?.effect[level];
  if (id === 'backpack') {
    const slots = backpackSlots(data, level);
    while (slots !== null && state.inventory.slots.length < slots) state.inventory.slots.push(null);
  } else if (id === 'barn_storage' && effect?.stackSize) {
    state.inventory.stackSize = Math.max(state.inventory.stackSize, effect.stackSize);
  } else if (id === 'farmhand') {
    // Hiring starts the timer; a better farmhand never has to wait longer than the new interval.
    const interval = (effect?.intervalSec ?? 0) * 1000;
    const cd = state.automation.farmhandCooldownMs;
    state.automation.farmhandCooldownMs = cd > 0 ? Math.min(cd, interval) : interval;
  } else if (id === 'greenhouse' && effect?.greenhousePlots) {
    // Greenhouse plots start tilled; L2 adds the other six.
    while (state.farm.greenhouse.length < effect.greenhousePlots) {
      state.farm.greenhouse.push(emptyPlot('tilled'));
      state.lastPlantedCrop.push(null);
    }
  }
}

export function buyUpgrade(state: GameState, ctx: SimContext, id: UpgradeId): ActionResult {
  const def = ctx.data.upgrades[id];
  if (!def) return fail('That upgrade is not available yet.');
  const level = upgradeLevel(state, id);
  if (level >= def.max) {
    return fail(
      def.kind === 'placeable' ? `You own every ${def.name} you can use.` : `${def.name} is fully upgraded.`,
    );
  }
  const needs = requirementsFor(def, level);
  if (!isUnlocked(state, needs)) {
    return fail(unlockHint(state, ctx.data, needs) ?? `${def.name} is not available yet.`);
  }
  const cost = upgradeCost(def, level);
  if (!canAfford(state, cost)) return fail(`You need ${cost.toLocaleString('en-US')}g for that.`);
  spend(state, cost);
  state.upgrades[id] = level + 1;
  applyEffect(state, ctx.data, id, level + 1);
  ctx.events.push({ type: 'purchased', what: id, gold: cost });
  return OK;
}
