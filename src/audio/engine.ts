// The audio engine: owns the AudioContext and the master / SFX / music gain stages.
// Browsers only allow audio after a user gesture, so nothing is created until `unlock()` runs from
// the first pointer or key event. Before that every sound request is silently dropped. No audio
// files exist anywhere; `Synth` (synth.ts) builds every sound from oscillators and noise.

import type { Prefs } from '../core/prefs';

export type ContextFactory = () => AudioContext;

export interface Volumes {
  master: number;
  sfx: number;
  music: number;
  muted: boolean;
}

export function volumesOf(p: Pick<Prefs, 'master' | 'sfx' | 'music' | 'muted'>): Volumes {
  return { master: p.master, sfx: p.sfx, music: p.music, muted: p.muted };
}

/** Squared so the slider feels even to the ear. */
const curve = (v: number): number => v * v;

export class AudioEngine {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  sfxBus: GainNode | null = null;
  musicBus: GainNode | null = null;
  private vols: Volumes = { master: 0.8, sfx: 0.8, music: 0.35, muted: false };
  private readonly onReady = new Set<() => void>();

  constructor(private readonly create: ContextFactory | null = defaultFactory()) {}

  /** True once a context exists and is running (or about to). */
  get ready(): boolean {
    return this.ctx !== null;
  }

  /** Current time on the audio clock, or 0 before the unlock. */
  get now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  /** Call from a user gesture. Safe to call again: it only resumes a suspended context. */
  unlock(): boolean {
    if (!this.ctx) {
      if (!this.create) return false;
      try {
        this.ctx = this.create();
      } catch {
        return false; // no Web Audio here: the game stays silent, never broken
      }
      const ctx = this.ctx;
      this.master = ctx.createGain();
      this.sfxBus = ctx.createGain();
      this.musicBus = ctx.createGain();
      this.sfxBus.connect(this.master);
      this.musicBus.connect(this.master);
      this.master.connect(ctx.destination);
      this.applyVolumes();
      this.onReady.forEach((fn) => fn());
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
    return true;
  }

  /** Runs `fn` once the context exists (immediately if it already does). */
  whenReady(fn: () => void): void {
    if (this.ctx) fn();
    else this.onReady.add(fn);
  }

  setVolumes(v: Volumes): void {
    this.vols = v;
    this.applyVolumes();
  }

  get volumes(): Volumes {
    return this.vols;
  }

  private applyVolumes(): void {
    if (!this.ctx || !this.master || !this.sfxBus || !this.musicBus) return;
    const t = this.ctx.currentTime;
    const v = this.vols;
    this.master.gain.setTargetAtTime(v.muted ? 0 : curve(v.master), t, 0.02);
    this.sfxBus.gain.setTargetAtTime(curve(v.sfx), t, 0.02);
    this.musicBus.gain.setTargetAtTime(curve(v.music) * 0.5, t, 0.05);
  }
}

function defaultFactory(): ContextFactory | null {
  const g = globalThis as unknown as {
    AudioContext?: new () => AudioContext;
    webkitAudioContext?: new () => AudioContext;
  };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  return Ctor ? () => new Ctor() : null;
}

/** Hooks the first pointer / key / touch event on `target` to unlock the engine, then stops listening. */
export function unlockOnFirstGesture(engine: AudioEngine, target: EventTarget): () => void {
  const events = ['pointerdown', 'keydown', 'touchstart'];
  const off = (): void => events.forEach((e) => target.removeEventListener(e, handler, true));
  const handler = (): void => {
    if (engine.unlock()) off();
  };
  events.forEach((e) => target.addEventListener(e, handler, true));
  return off;
}
