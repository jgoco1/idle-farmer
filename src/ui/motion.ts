// One place that says whether motion should be reduced: the player's setting (Settings → Motion) or,
// on "auto", the `prefers-reduced-motion` media query. CSS follows through `data-motion` on <html>.

import { reducedMotion, type Prefs } from '../core/prefs';

let reduced = false;

export function isReducedMotion(): boolean {
  return reduced;
}

export function systemPrefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Applies prefs to the flag and the document. Call at start-up and on every prefs change. */
export function applyMotionPrefs(prefs: Pick<Prefs, 'motion'>, root?: HTMLElement): void {
  reduced = reducedMotion(prefs, systemPrefersReducedMotion());
  root?.setAttribute('data-motion', reduced ? 'reduce' : 'full');
}

/** Test hook. */
export function setReducedMotion(value: boolean): void {
  reduced = value;
}
