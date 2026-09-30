// A small synth helper over the Web Audio API: enveloped oscillators and filtered noise. Every
// sound effect and every music note is built from these two calls; times are on the audio clock.

import type { AudioEngine } from './engine';

export type Wave = 'sine' | 'square' | 'triangle' | 'sawtooth';
export type Bus = 'sfx' | 'music';

export interface ToneOptions {
  wave?: Wave;
  /** Peak gain, 0..1 (default 0.3). */
  vol?: number;
  /** Seconds to reach the peak (default 0.005). */
  attack?: number;
  /** Frequency at the end of the note, for slides. */
  slideTo?: number;
  /** Detune in cents. */
  detune?: number;
  bus?: Bus;
  /** Extra destination (music voices connect to a per-theme gain for crossfades). */
  out?: AudioNode;
}

export interface NoiseOptions {
  vol?: number;
  attack?: number;
  filter?: BiquadFilterType;
  /** Filter frequency; `filterTo` sweeps it over the duration. */
  freq?: number;
  filterTo?: number;
  q?: number;
  bus?: Bus;
  out?: AudioNode;
}

/** MIDI note number → Hz. */
export const midiToHz = (m: number): number => 440 * 2 ** ((m - 69) / 12);

export class Synth {
  private noiseBuffer: AudioBuffer | null = null;

  constructor(private readonly engine: AudioEngine) {}

  /** Plays one tone starting at `when` (audio-clock seconds) for `dur` seconds. */
  tone(freq: number, dur: number, when: number, o: ToneOptions = {}): void {
    const ctx = this.engine.ctx;
    const dest = o.out ?? (o.bus === 'music' ? this.engine.musicBus : this.engine.sfxBus);
    if (!ctx || !dest) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = o.wave ?? 'square';
    osc.frequency.setValueAtTime(freq, when);
    if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.slideTo), when + dur);
    if (o.detune) osc.detune.value = o.detune;
    const peak = Math.max(0.0001, o.vol ?? 0.3);
    const attack = Math.min(o.attack ?? 0.005, dur / 2);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.linearRampToValueAtTime(peak, when + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(gain).connect(dest);
    osc.start(when);
    osc.stop(when + dur + 0.02);
  }

  /** Plays filtered white noise starting at `when` for `dur` seconds. */
  noise(dur: number, when: number, o: NoiseOptions = {}): void {
    const ctx = this.engine.ctx;
    const dest = o.out ?? (o.bus === 'music' ? this.engine.musicBus : this.engine.sfxBus);
    if (!ctx || !dest) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise1s(ctx);
    src.loop = true;
    const gain = ctx.createGain();
    const peak = Math.max(0.0001, o.vol ?? 0.2);
    const attack = Math.min(o.attack ?? 0.005, dur / 2);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.linearRampToValueAtTime(peak, when + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    let node: AudioNode = src;
    if (o.filter) {
      const f = ctx.createBiquadFilter();
      f.type = o.filter;
      f.frequency.setValueAtTime(o.freq ?? 1000, when);
      if (o.filterTo) f.frequency.exponentialRampToValueAtTime(Math.max(10, o.filterTo), when + dur);
      f.Q.value = o.q ?? 1;
      node.connect(f);
      node = f;
    }
    node.connect(gain).connect(dest);
    src.start(when);
    src.stop(when + dur + 0.02);
  }

  private noise1s(ctx: AudioContext): AudioBuffer {
    if (this.noiseBuffer) return this.noiseBuffer;
    const len = ctx.sampleRate;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    // A fixed cosmetic generator, so sounds are the same every run (and never touch game RNG).
    let s = 0x1234abcd;
    for (let i = 0; i < len; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      data[i] = (s / 0x80000000 - 1) * 0.9;
    }
    this.noiseBuffer = buf;
    return buf;
  }
}
