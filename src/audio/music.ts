// Procedural chiptune music: four short seasonal loops and a softer night variation, crossfaded.
// Each loop is 4 bars of 8 eighth notes; a second melody variant and a few dropped notes (from a
// fixed cosmetic generator) keep it from repeating exactly. It is quiet by default (see Settings)
// and is scheduled a short way ahead on the audio clock, so it survives a busy main thread.
// To change a tune, edit `THEMES`: `scale` and `root` set the key, `progression` is the bass degree
// per bar and `melody` holds two 32-step variants (scale degrees, `null` = rest).

import type { SeasonId } from '../data/ids';
import type { AudioEngine } from './engine';
import { midiToHz, Synth, type Wave } from './synth';

/** The four seasons' loops, and the Town Square tune the bandstand project gives (v2 phase 02). */
export type ThemeId = SeasonId | 'town_square';
export type ThemeKey = `${ThemeId}-${'day' | 'night'}`;

export interface Theme {
  bpm: number;
  root: number; // MIDI note of scale degree 0
  scale: readonly number[]; // semitone offsets, one octave
  progression: readonly number[]; // bass degree per bar (4 bars)
  melody: readonly [readonly (number | null)[], readonly (number | null)[]]; // 32 steps each
  lead: Wave;
}

const _ = null;

// Degrees index into a 5-note pentatonic scale (0..4 then the next octave), so nothing clashes.
const PENTA_MAJOR = [0, 2, 4, 7, 9] as const;
const PENTA_MINOR = [0, 3, 5, 7, 10] as const;

export const THEMES: Record<ThemeId, Theme> = {
  spring: {
    bpm: 104,
    root: 60,
    scale: PENTA_MAJOR,
    progression: [0, 3, 4, 2],
    lead: 'square',
    melody: [
      [2, _, 3, _, 4, _, 3, _, 2, _, 1, _, 0, _, _, _, 1, _, 2, _, 3, _, 2, _, 1, _, 0, _, 1, _, _, _],
      [4, _, 5, 4, 3, _, 2, _, 3, _, 2, 1, 0, _, _, _, 1, 2, 3, _, 5, _, 4, _, 3, _, 1, _, 2, _, _, _],
    ],
  },
  summer: {
    bpm: 116,
    root: 67,
    scale: PENTA_MAJOR,
    progression: [0, 2, 3, 4],
    lead: 'square',
    melody: [
      [4, _, 4, 3, 2, _, 3, _, 4, _, 5, _, 4, _, _, _, 3, _, 3, 2, 1, _, 2, _, 3, _, 2, _, 0, _, _, _],
      [0, 2, 4, _, 5, _, 4, _, 3, 4, 3, _, 2, _, _, _, 2, 3, 4, _, 3, _, 1, _, 2, _, 0, 1, 0, _, _, _],
    ],
  },
  autumn: {
    bpm: 88,
    root: 57,
    scale: PENTA_MINOR,
    progression: [0, 2, 3, 1],
    lead: 'triangle',
    melody: [
      [4, _, _, 3, 2, _, 1, _, 2, _, _, 1, 0, _, _, _, 1, _, _, 2, 3, _, 2, _, 1, _, 0, _, _, _, _, _],
      [2, _, 3, _, 4, _, _, 3, 2, _, 1, _, 0, _, 1, _, 3, _, _, 2, 1, _, 2, _, 3, _, _, 1, 0, _, _, _],
    ],
  },
  winter: {
    bpm: 72,
    root: 65,
    scale: PENTA_MAJOR,
    progression: [0, 4, 2, 3],
    lead: 'sine',
    melody: [
      [4, _, _, _, 2, _, _, _, 3, _, _, _, 1, _, _, _, 2, _, _, _, 0, _, _, _, 1, _, _, _, 2, _, _, _],
      [2, _, _, 4, _, _, 5, _, 4, _, _, _, 3, _, _, 1, 2, _, _, _, 1, _, 0, _, 1, _, _, _, _, _, _, _],
    ],
  },
  // A little brass-band waltz for the square: bright, bouncy and a touch ceremonial.
  town_square: {
    bpm: 112,
    root: 62,
    scale: PENTA_MAJOR,
    progression: [0, 3, 4, 0],
    lead: 'square',
    melody: [
      [0, _, 2, _, 4, _, 5, _, 4, _, 2, _, 3, _, 2, _, 1, _, 3, _, 5, _, 6, _, 5, _, 3, _, 4, _, _, _],
      [4, _, 4, 5, 4, _, 2, _, 0, _, 2, 3, 4, _, _, _, 5, _, 6, 5, 4, _, 3, _, 2, _, 1, _, 0, _, _, _],
    ],
  },
};

export function themeKey(season: SeasonId, night: boolean): ThemeKey {
  return `${season}-${night ? 'night' : 'day'}`;
}

/** The theme key for the Town Square tune. */
export function townSquareKey(night: boolean): ThemeKey {
  return `town_square-${night ? 'night' : 'day'}`;
}

export interface NoteEvent {
  /** Start, in beats from the loop start (an eighth note is 0.5 beats). */
  beat: number;
  dur: number; // beats
  midi: number;
  voice: 'lead' | 'bass' | 'arp';
  vol: number;
}

export const LOOP_STEPS = 32;
export const LOOP_BEATS = LOOP_STEPS / 2;

function midiAt(theme: Theme, degree: number): number {
  const n = theme.scale.length;
  const oct = Math.floor(degree / n);
  return theme.root + (theme.scale[((degree % n) + n) % n] ?? 0) + 12 * oct;
}

/** A small deterministic generator for loop-to-loop variation (cosmetic; never the game's RNG). */
function variation(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** Night plays slower, lower and sparser. */
export const NIGHT_TEMPO = 0.8;

/** The notes of loop number `loopIndex` for a theme, sorted by start. Pure and deterministic. */
export function loopNotes(theme: Theme, night: boolean, loopIndex: number): NoteEvent[] {
  const rand = variation(loopIndex + (night ? 977 : 13));
  const notes: NoteEvent[] = [];
  const melody = theme.melody[loopIndex % 2] ?? theme.melody[0];
  melody.forEach((deg, step) => {
    if (deg === null) return;
    if (night && step % 4 !== 0) return; // sparser at night
    if (rand() < 0.12) return; // an occasional rest keeps it alive
    notes.push({
      beat: step / 2,
      dur: night ? 1.6 : 0.9,
      midi: midiAt(theme, deg) + (night ? 0 : 12),
      voice: 'lead',
      vol: night ? 0.07 : 0.1,
    });
  });
  theme.progression.forEach((deg, bar) => {
    const at = bar * 4;
    notes.push({
      beat: at,
      dur: 1.8,
      midi: midiAt(theme, deg) - 12,
      voice: 'bass',
      vol: night ? 0.13 : 0.16,
    });
    if (!night)
      notes.push({ beat: at + 2, dur: 1.5, midi: midiAt(theme, deg + 2) - 12, voice: 'bass', vol: 0.12 });
    // A soft broken chord on the off beats.
    [0, 2, 4].forEach((third, i) =>
      notes.push({
        beat: at + (night ? 0 : 0.5) + i * (night ? 1.3 : 1),
        dur: night ? 2.4 : 0.7,
        midi: midiAt(theme, deg + third),
        voice: 'arp',
        vol: night ? 0.05 : 0.055,
      }),
    );
  });
  return notes.sort((a, b) => a.beat - b.beat);
}

const CROSSFADE_S = 2.5;
const LOOKAHEAD_S = 0.8;

interface Voice {
  key: ThemeKey;
  gain: GainNode;
  loop: number;
  notes: NoteEvent[];
  next: number; // index into notes
  loopStart: number; // audio-clock seconds
}

export class Music {
  private readonly synth: Synth;
  private current: Voice | null = null;
  private wanted: ThemeKey | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Theme keys started so far (for tests and the debug overlay). */
  readonly history: ThemeKey[] = [];

  constructor(private readonly engine: AudioEngine) {
    this.synth = new Synth(engine);
  }

  /** Chooses the theme to play; it crossfades in when audio is ready. */
  setTheme(key: ThemeKey): void {
    this.wanted = key;
    this.update();
  }

  /** Starts the scheduler (every 200 ms). Safe to call repeatedly. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.update(), 200);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Switches theme if needed and schedules notes up to the look-ahead. */
  update(): void {
    const ctx = this.engine.ctx;
    const bus = this.engine.musicBus;
    if (!ctx || !bus || !this.wanted) return;
    const now = ctx.currentTime;
    if (!this.current || this.current.key !== this.wanted) this.begin(this.wanted, ctx, bus, now);
    const v = this.current;
    if (!v) return;
    const [season, phase] = v.key.split('-') as [ThemeId, 'day' | 'night'];
    const night = phase === 'night';
    const theme = THEMES[season];
    const beatS = 60 / (theme.bpm * (night ? NIGHT_TEMPO : 1));
    for (;;) {
      const note = v.notes[v.next];
      if (!note) {
        v.loop++;
        v.loopStart += LOOP_BEATS * beatS;
        v.notes = loopNotes(theme, night, v.loop);
        v.next = 0;
        continue;
      }
      const at = v.loopStart + note.beat * beatS;
      if (at > now + LOOKAHEAD_S) break;
      v.next++;
      if (at < now - 0.05) continue; // fell behind (tab was throttled): skip rather than burst
      const wave: Wave = note.voice === 'lead' ? theme.lead : note.voice === 'bass' ? 'triangle' : 'sine';
      this.synth.tone(midiToHz(note.midi), note.dur * beatS, at, {
        wave: night && note.voice === 'lead' ? 'sine' : wave,
        vol: note.vol,
        attack: note.voice === 'arp' ? 0.03 : 0.01,
        out: v.gain,
      });
    }
  }

  private begin(key: ThemeKey, ctx: AudioContext, bus: GainNode, now: number): void {
    const old = this.current;
    if (old) {
      old.gain.gain.cancelScheduledValues(now);
      old.gain.gain.setValueAtTime(old.gain.gain.value, now);
      old.gain.gain.linearRampToValueAtTime(0, now + CROSSFADE_S);
      setTimeout(() => old.gain.disconnect(), (CROSSFADE_S + 3) * 1000);
    }
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + (old ? CROSSFADE_S : 1));
    gain.connect(bus);
    const [season, phase] = key.split('-') as [ThemeId, 'day' | 'night'];
    this.current = {
      key,
      gain,
      loop: 0,
      notes: loopNotes(THEMES[season], phase === 'night', 0),
      next: 0,
      loopStart: now + 0.05,
    };
    this.history.push(key);
  }
}
