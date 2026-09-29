// Day/night overlay strengths from the local clock (ART_STYLE.md §3). Pure, so it is unit-tested.

export interface Tint {
  night: number; // night_tint alpha with 'multiply', 0..0.55
  dusk: number; // dusk_tint alpha with 'soft-light', 0..0.25
}

const NIGHT_MAX = 0.55;
const DUSK_MAX = 0.25;

/** `hour` and `minute` are local wall-clock values. */
export function tintAt(hour: number, minute: number): Tint {
  const h = hour + minute / 60;
  let night = 0;
  if (h >= 20)
    night = ((h - 20) / 4) * NIGHT_MAX; // 20:00 → midnight rises to the max
  else if (h < 6) night = ((6 - h) / 6) * NIGHT_MAX; // midnight → 06:00 falls back to 0
  let dusk = 0;
  if (h >= 18.5 && h < 20)
    dusk = triangle((h - 18.5) / 1.5) * DUSK_MAX; // dusk 18:30–20:00
  else if (h >= 6 && h < 7.5) dusk = triangle((h - 6) / 1.5) * DUSK_MAX; // dawn 06:00–07:30
  return { night, dusk };
}

/** 0 → 1 → 0 over [0, 1]. */
function triangle(x: number): number {
  return 1 - Math.abs(2 * x - 1);
}
