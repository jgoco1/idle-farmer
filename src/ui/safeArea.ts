// Safe areas (v3 phase 00): src/styles.css reads the notch and rounded-corner insets through
// --safe-top/right/bottom/left, which default to env(safe-area-inset-*). This debug helper overrides
// them with fixed values so a plain desktop browser (and e2e) can check the layout around a notch.

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** An iPhone-like portrait notch and home indicator. */
export const FAKE_INSETS: Insets = { top: 44, right: 0, bottom: 34, left: 0 };

const SIDES = ['top', 'right', 'bottom', 'left'] as const;

/** "44,0,34,0" (CSS order: top, right, bottom, left) → insets; missing or bad numbers take FAKE_INSETS'. */
export function parseInsets(spec: string): Insets {
  const parts = spec.split(',');
  const out = { ...FAKE_INSETS };
  SIDES.forEach((side, i) => {
    const raw = parts[i]?.trim();
    const n = raw ? Number(raw) : NaN;
    if (Number.isFinite(n) && n >= 0 && n <= 200) out[side] = Math.round(n);
  });
  return out;
}

/**
 * Fakes the insets on `root`: a spec string turns them on (an empty string gives FAKE_INSETS),
 * null turns them off, undefined toggles. Returns whether they are on.
 */
export function applyFakeInsets(root: HTMLElement, spec: string | null | undefined): boolean {
  const on = spec === undefined ? root.dataset.fakeInsets === undefined : spec !== null;
  if (!on) {
    delete root.dataset.fakeInsets;
    for (const side of SIDES) root.style.removeProperty(`--safe-${side}`);
    return false;
  }
  const insets = parseInsets(spec ?? '');
  root.dataset.fakeInsets = '';
  for (const side of SIDES) root.style.setProperty(`--safe-${side}`, `${insets[side]}px`);
  return true;
}
