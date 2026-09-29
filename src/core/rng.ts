// Seeded PRNG (mulberry32). Its whole state is one uint32 stored in GameState.rngState, so saving
// and loading reproduces the exact sequence. This is the ONLY source of game randomness.

export interface RngHolder {
  rngState: number;
}

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max], inclusive. */
  int(min: number, max: number): number;
  /** true with probability p. */
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
}

/** One mulberry32 step: returns the next state and the output in [0, 1). */
export function mulberry32(state: number): [next: number, value: number] {
  const next = (state + 0x6d2b79f5) | 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [next >>> 0, ((t ^ (t >>> 14)) >>> 0) / 4294967296];
}

/** An RNG that reads and advances `holder.rngState` (usually the GameState itself). */
export function createRng(holder: RngHolder): Rng {
  const next = (): number => {
    const [state, value] = mulberry32(holder.rngState);
    holder.rngState = state;
    return value;
  };
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (p) => next() < p,
    pick(items) {
      if (items.length === 0) throw new Error('rng.pick on an empty list');
      return items[Math.floor(next() * items.length)] as (typeof items)[number];
    },
  };
}

/** Turns any number (e.g. a timestamp) into a well-mixed uint32 seed. */
export function seedFrom(n: number): number {
  let h = Math.floor(n) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
