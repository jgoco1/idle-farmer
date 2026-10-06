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
import { bundleBonuses } from './bundles';
import { mergeStacks } from './inventory';
import { addTrap, maxTraps, trapsPerLocation } from './locations';
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

/**
 * Grows the bag to the slots its Backpack level gives, plus the Summer Crops bundle's extra slots. Buying a level
 * calls it, and so does loading a save, so a save made when the levels gave fewer slots gets the difference
 * (polish after v4-01). It never removes a slot.
 */
export function syncBagSlots(state: GameState, data: GameData): void {
  const slots = backpackSlots(data, upgradeLevel(state, 'backpack'));
  if (slots === null) return;
  const target = slots + bundleBonuses(state, data).inventorySlots;
  while (state.inventory.slots.length < target) state.inventory.slots.push(null);
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

/**
 * A reason `id` cannot be bought right now that has nothing to do with its unlock conditions, or
 * null. Fish traps need a free spot: two per unlocked water.
 */
export function purchaseBlock(state: GameState, data: GameData, id: UpgradeId): string | null {
  if (id === 'fish_trap' && upgradeLevel(state, id) >= maxTraps(state, data)) {
    return `Every water you can reach already has its ${trapsPerLocation(state, data)} traps. Open the River or the Old Dock for more.`;
  }
  return null;
}

/** Applies an upgrade's effect for its new level. */
function applyEffect(state: GameState, data: GameData, id: UpgradeId, level: number): void {
  const effect = data.upgrades[id]?.effect[level];
  if (id === 'backpack') {
    syncBagSlots(state, data);
  } else if (id === 'barn_storage' && effect?.stackSize) {
    state.inventory.stackSize = Math.max(state.inventory.stackSize, effect.stackSize);
    mergeStacks(state.inventory); // two full stacks of the old size become one
  } else if (id === 'farmhand') {
    // Hiring starts the timer; a better farmhand never has to wait longer than the new interval.
    const interval = (effect?.intervalSec ?? 0) * 1000;
    const cd = state.automation.farmhandCooldownMs;
    state.automation.farmhandCooldownMs = cd > 0 ? Math.min(cd, interval) : interval;
  } else if (id === 'fish_trap') {
    addTrap(state, data); // set out at the next free spot at the water
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
  const blocked = purchaseBlock(state, ctx.data, id);
  if (blocked) return fail(blocked);
  const cost = upgradeCost(def, level);
  if (!canAfford(state, cost)) return fail(`You need ${cost.toLocaleString('en-US')}g for that.`);
  spend(state, cost);
  state.upgrades[id] = level + 1;
  applyEffect(state, ctx.data, id, level + 1);
  ctx.events.push({ type: 'purchased', what: id, gold: cost });
  return OK;
}
