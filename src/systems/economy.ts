// Currency (GDD §6.2). Gold is a non-negative integer. `earn` is the only way gold comes in: it also
// keeps the lifetime and daily statistics and reports a `goldEarned` event for progression (phase
// 07). `spend` refuses to overspend and changes nothing when it does.

import type { GameState } from '../core/state';
import type { SimContext } from './context';

export type GoldSource = 'sale' | 'quest' | 'restaurant' | 'other';

function assertGold(amount: number): void {
  if (!Number.isInteger(amount) || amount < 0)
    throw new Error(`Gold amounts are whole numbers ≥ 0 (got ${amount})`);
}

/** Adds `amount` gold, counts it toward lifetime and today's gold, and emits `goldEarned`. */
export function earn(
  state: GameState,
  ctx: Pick<SimContext, 'events'>,
  amount: number,
  source: GoldSource,
): void {
  assertGold(amount);
  if (amount === 0) return;
  state.gold += amount;
  state.stats.lifetimeGold += amount;
  state.stats.goldToday += amount;
  ctx.events.push({ type: 'goldEarned', amount, source });
}

export function canAfford(state: GameState, amount: number): boolean {
  return Number.isInteger(amount) && amount >= 0 && state.gold >= amount;
}

/** Takes `amount` gold. Returns false (and changes nothing) when there is not enough. */
export function spend(state: GameState, amount: number): boolean {
  assertGold(amount);
  if (state.gold < amount) return false;
  state.gold -= amount;
  return true;
}
