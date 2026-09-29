import { describe, expect, it } from 'vitest';
import { createRng, mulberry32, seedFrom } from '../src/core/rng';

describe('seeded RNG', () => {
  it('the same seed gives the same sequence', () => {
    const a = createRng({ rngState: 12345 });
    const b = createRng({ rngState: 12345 });
    const sa = Array.from({ length: 50 }, () => a.next());
    const sb = Array.from({ length: 50 }, () => b.next());
    expect(sa).toEqual(sb);
  });

  it('is stable across versions (known first values for seed 1)', () => {
    const r = createRng({ rngState: 1 });
    expect(r.next()).toBe(mulberry32(1)[1]);
    expect(mulberry32(1)[1]).toBeCloseTo(0.6270739405881613, 12);
  });

  it('keeps all of its state in the holder, so a save resumes the sequence', () => {
    const holder = { rngState: 99 };
    const r = createRng(holder);
    r.next();
    r.next();
    const saved = holder.rngState;
    const expected = [r.next(), r.next(), r.next()];
    const resumed = createRng({ rngState: saved });
    expect([resumed.next(), resumed.next(), resumed.next()]).toEqual(expected);
  });

  it('different seeds give different sequences', () => {
    expect(createRng({ rngState: 1 }).next()).not.toBe(createRng({ rngState: 2 }).next());
  });

  it('stays in range', () => {
    const r = createRng({ rngState: seedFrom(Date.UTC(2026, 0, 1)) });
    for (let i = 0; i < 5000; i++) {
      const v = r.next();
      expect(v >= 0 && v < 1).toBe(true);
      const n = r.int(3, 7);
      expect(Number.isInteger(n) && n >= 3 && n <= 7).toBe(true);
    }
    expect(r.pick(['a'])).toBe('a');
    expect(() => r.pick([])).toThrow();
  });

  it('state is always a uint32', () => {
    const holder = { rngState: 0xffffffff };
    const r = createRng(holder);
    for (let i = 0; i < 100; i++) {
      r.next();
      expect(Number.isInteger(holder.rngState) && holder.rngState >= 0 && holder.rngState <= 0xffffffff).toBe(
        true,
      );
    }
  });
});
