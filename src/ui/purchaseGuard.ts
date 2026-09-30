// Rapid double clicks (phase 09 QA). A buy button is rebuilt in place after a purchase, so the
// second click of a double click lands on the *next* level's button and buys it too. The guard
// refuses a second purchase of the same thing within DOUBLE_CLICK_MS of a successful one; a
// deliberate second click a moment later still works. DOM-free, so it is unit tested.

import type { ActionResult } from '../systems/context';
import { fail } from '../systems/context';

/** Two clicks on the same buy button closer together than this count as one double click. */
export const DOUBLE_CLICK_MS = 400;

export class PurchaseGuard {
  private readonly last = new Map<string, number>();

  constructor(
    private readonly now: () => number,
    readonly windowMs = DOUBLE_CLICK_MS,
  ) {}

  /** Runs `buy` unless `key` was bought less than `windowMs` ago. */
  run(key: string, buy: () => ActionResult): ActionResult {
    const t = this.now();
    const prev = this.last.get(key);
    if (prev !== undefined && t - prev < this.windowMs) {
      return fail('Bought! Click again if you want another.');
    }
    const r = buy();
    if (r.ok) this.last.set(key, t);
    return r;
  }
}
