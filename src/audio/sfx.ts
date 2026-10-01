// Every sound effect, named and procedural. To change how something sounds, edit its entry in
// `SOUNDS`: each one is a few `tone()` / `noise()` calls. To add a sound, add its name to `SfxName`
// and an entry here, then play it with `sfx.play('name')` (events are wired in audio/events.ts).
// Volume per sound is the `vol` of its calls; global levels are in Settings (master / SFX / music).

import type { AudioEngine } from './engine';
import { midiToHz, Synth } from './synth';

export type SfxName =
  | 'hoe'
  | 'plant'
  | 'water'
  | 'harvest'
  | 'coin'
  | 'purchase'
  | 'cast'
  | 'bite'
  | 'reel'
  | 'catch'
  | 'escape'
  | 'sizzle'
  | 'dishReady'
  | 'eat'
  | 'buff'
  | 'levelUp'
  | 'goal'
  | 'panelOpen'
  | 'panelClose'
  | 'click'
  | 'pet'
  | 'cluck'
  | 'moo'
  | 'collect';

export interface PlayOptions {
  /** Coin: the amount of gold, which sets the pitch. Others: a 0..1 intensity. */
  amount?: number;
}

type SoundFn = (s: Synth, t: number, o: PlayOptions) => void;

/** Coin pitch: a semitone per quarter-decade of gold, from C6 up to about A7. */
export function coinSemitones(amount: number): number {
  return Math.min(14, Math.max(0, Math.round(Math.log10(Math.max(1, amount) + 1) * 4)));
}

const arp = (
  s: Synth,
  t: number,
  notes: number[],
  step: number,
  o: { wave: 'triangle' | 'square' | 'sine'; vol: number; len: number },
): void => notes.forEach((n, i) => s.tone(midiToHz(n), o.len, t + i * step, { wave: o.wave, vol: o.vol }));

export const SOUNDS: Record<SfxName, SoundFn> = {
  hoe(s, t) {
    s.tone(150, 0.14, t, { wave: 'sine', slideTo: 55, vol: 0.5 });
    s.noise(0.09, t, { filter: 'lowpass', freq: 900, filterTo: 200, vol: 0.35 });
  },
  plant(s, t) {
    s.tone(520, 0.09, t, { wave: 'sine', slideTo: 900, vol: 0.3 });
    s.tone(780, 0.07, t + 0.06, { wave: 'sine', vol: 0.15 });
  },
  water(s, t) {
    s.noise(0.3, t, { filter: 'bandpass', freq: 1400, filterTo: 700, q: 0.8, vol: 0.22, attack: 0.05 });
    s.tone(700, 0.06, t + 0.08, { wave: 'sine', slideTo: 1100, vol: 0.12 });
    s.tone(600, 0.06, t + 0.17, { wave: 'sine', slideTo: 1000, vol: 0.1 });
  },
  harvest(s, t) {
    s.tone(320, 0.09, t, { wave: 'square', slideTo: 760, vol: 0.2 });
    s.tone(1020, 0.05, t + 0.07, { wave: 'triangle', vol: 0.15 });
  },
  coin(s, t, o) {
    const base = 84 + coinSemitones(o.amount ?? 10); // C6 = 84
    s.tone(midiToHz(base), 0.07, t, { wave: 'square', vol: 0.16 });
    s.tone(midiToHz(base + 7), 0.22, t + 0.06, { wave: 'square', vol: 0.14 });
  },
  purchase(s, t) {
    arp(s, t, [72, 76, 79], 0.06, { wave: 'triangle', vol: 0.25, len: 0.14 });
    s.tone(midiToHz(91), 0.25, t + 0.18, { wave: 'sine', vol: 0.18 });
  },
  cast(s, t, o) {
    s.noise(0.32, t, {
      filter: 'bandpass',
      freq: 3000,
      filterTo: 500,
      q: 1.2,
      vol: 0.25 * (0.6 + (o.amount ?? 0.5)),
      attack: 0.03,
    });
  },
  bite(s, t) {
    s.tone(880, 0.09, t, { wave: 'square', vol: 0.28 });
    s.tone(1175, 0.16, t + 0.1, { wave: 'square', vol: 0.3 });
  },
  reel(s, t) {
    s.tone(240, 0.03, t, { wave: 'square', vol: 0.12 });
    s.noise(0.02, t, { filter: 'highpass', freq: 3000, vol: 0.1 });
  },
  catch(s, t) {
    arp(s, t, [72, 76, 79, 84, 88], 0.08, { wave: 'square', vol: 0.18, len: 0.16 });
    s.tone(midiToHz(91), 0.4, t + 0.42, { wave: 'triangle', vol: 0.22 });
  },
  escape(s, t) {
    s.tone(520, 0.4, t, { wave: 'triangle', slideTo: 130, vol: 0.25 });
  },
  sizzle(s, t) {
    s.noise(0.7, t, { filter: 'highpass', freq: 4500, q: 0.5, vol: 0.12, attack: 0.08 });
    for (let i = 0; i < 6; i++)
      s.noise(0.03, t + 0.05 + i * 0.1, { filter: 'highpass', freq: 6000, vol: 0.15 });
  },
  dishReady(s, t) {
    s.tone(1319, 0.9, t, { wave: 'sine', vol: 0.25 });
    s.tone(2637, 0.6, t, { wave: 'sine', vol: 0.08 });
    s.tone(1319, 0.9, t + 0.28, { wave: 'sine', vol: 0.2 });
  },
  eat(s, t) {
    for (let i = 0; i < 3; i++) {
      s.noise(0.07, t + i * 0.13, { filter: 'lowpass', freq: 1200, filterTo: 300, vol: 0.3 });
      s.tone(180, 0.06, t + i * 0.13, { wave: 'sine', slideTo: 90, vol: 0.2 });
    }
  },
  buff(s, t) {
    arp(s, t, [76, 79, 83, 88, 91], 0.05, { wave: 'triangle', vol: 0.16, len: 0.22 });
  },
  levelUp(s, t) {
    arp(s, t, [67, 72, 76, 79], 0.1, { wave: 'square', vol: 0.18, len: 0.2 });
    arp(s, t + 0.45, [72, 76, 79, 84], 0.0, { wave: 'triangle', vol: 0.16, len: 0.7 });
    s.tone(midiToHz(96), 0.5, t + 0.5, { wave: 'sine', vol: 0.1 });
  },
  goal(s, t) {
    arp(s, t, [72, 79, 84], 0.09, { wave: 'square', vol: 0.17, len: 0.18 });
    s.tone(midiToHz(88), 0.35, t + 0.3, { wave: 'triangle', vol: 0.2 });
  },
  panelOpen(s, t) {
    s.tone(420, 0.07, t, { wave: 'triangle', slideTo: 640, vol: 0.14 });
  },
  panelClose(s, t) {
    s.tone(560, 0.07, t, { wave: 'triangle', slideTo: 340, vol: 0.12 });
  },
  click(s, t) {
    s.tone(900, 0.025, t, { wave: 'square', vol: 0.07 });
  },
  pet(s, t) {
    s.tone(620, 0.12, t, { wave: 'sine', slideTo: 900, vol: 0.16 });
    s.tone(900, 0.2, t + 0.1, { wave: 'sine', slideTo: 560, vol: 0.14 });
  },
  // A hen: two quick, rounded clucks and a little trailing one.
  cluck(s, t) {
    s.tone(620, 0.06, t, { wave: 'triangle', slideTo: 430, vol: 0.2 });
    s.tone(700, 0.06, t + 0.09, { wave: 'triangle', slideTo: 470, vol: 0.18 });
    s.tone(540, 0.09, t + 0.2, { wave: 'triangle', slideTo: 380, vol: 0.12 });
  },
  // A cow: a long low note that swells and sags, with a soft overtone.
  moo(s, t) {
    s.tone(150, 0.55, t, { wave: 'triangle', slideTo: 108, vol: 0.28, attack: 0.12 });
    s.tone(225, 0.5, t + 0.02, { wave: 'sine', slideTo: 162, vol: 0.1, attack: 0.12 });
  },
  // Taking the eggs or milk: a soft wooden knock and a bright little lift.
  collect(s, t) {
    s.tone(240, 0.07, t, { wave: 'sine', slideTo: 150, vol: 0.3 });
    arp(s, t + 0.05, [76, 83], 0.07, { wave: 'triangle', vol: 0.16, len: 0.12 });
  },
};

/** Minimum gap between two plays of the same sound, so a drag over eight plots is not a buzz. */
export const MIN_GAP_S: Partial<Record<SfxName, number>> = {
  hoe: 0.07,
  plant: 0.06,
  water: 0.08,
  harvest: 0.05,
  coin: 0.05,
  reel: 0.08,
  click: 0.03,
  cluck: 0.15,
  moo: 0.4,
  collect: 0.1,
};

export class Sfx {
  private readonly synth: Synth;
  private readonly last = new Map<SfxName, number>();
  /** Names played since creation; tests and the debug overlay read it. */
  readonly played: SfxName[] = [];

  constructor(private readonly engine: AudioEngine) {
    this.synth = new Synth(engine);
  }

  /** Plays `name` now. Returns false when audio is locked or the sound was throttled. */
  play(name: SfxName, o: PlayOptions = {}): boolean {
    if (!this.engine.ready) return false;
    const now = this.engine.now;
    const gap = MIN_GAP_S[name] ?? 0.02;
    const prev = this.last.get(name);
    if (prev !== undefined && now - prev < gap) return false;
    this.last.set(name, now);
    this.played.push(name);
    if (this.played.length > 64) this.played.shift();
    SOUNDS[name](this.synth, now + 0.005, o);
    return true;
  }
}
