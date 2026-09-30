// Upgrades bought with gold (BALANCE.md §4). Phase 03 has the backpack (inventory slots); phase 04
// adds the farm and tool upgrades through the same `buyUpgrade` action and cost curve.

import type { GameState } from '../core/state';
import type { GameData } from '../data';
import { roundNice } from '../data/balance';
import type { UpgradeId } from '../data/ids';
import type { UpgradeDef } from '../data/types';
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

/** Applies an upgrade's effect for its new level. */
function applyEffect(state: GameState, data: GameData, id: UpgradeId, level: number): void {
  if (id === 'backpack') {
    const slots = backpackSlots(data, level);
    while (slots !== null && state.inventory.slots.length < slots) state.inventory.slots.push(null);
  }
}

export function buyUpgrade(state: GameState, ctx: SimContext, id: UpgradeId): ActionResult {
  const def = ctx.data.upgrades[id];
  if (!def) return fail('That upgrade is not available yet.');
  const level = upgradeLevel(state, id);
  if (level >= def.max) return fail(`${def.name} is fully upgraded.`);
  if (!isUnlocked(state, def.requires)) {
    return fail(unlockHint(state, ctx.data, def.requires) ?? `${def.name} is not available yet.`);
  }
  const cost = upgradeCost(def, level);
  if (!canAfford(state, cost)) return fail(`You need ${cost.toLocaleString('en-US')}g for that.`);
  spend(state, cost);
  state.upgrades[id] = level + 1;
  applyEffect(state, ctx.data, id, level + 1);
  ctx.events.push({ type: 'purchased', what: id, gold: cost });
  return OK;
}
