// A small celebration for level-ups, finished goals and completed bundles: a burst of pixel
// confetti over the scene. Purely cosmetic, so it uses its own tiny RNG (never the game's) and
// stays quiet when the player prefers reduced motion. Driven by the event bus from src/main.ts.

import { h } from './dom';
import { isReducedMotion } from './motion';

export type CelebrationKind = 'level' | 'goal' | 'big';

/** Palette variables for the confetti squares (colours come from CSS, never from hex codes here). */
const COLOURS = [
  '--c-gold',
  '--c-red_light',
  '--c-grass_3',
  '--c-water_3',
  '--c-pink_light',
  '--c-yellow_light',
];
const PIECES: Record<CelebrationKind, number> = { level: 26, goal: 18, big: 44 };

export class Celebration {
  private seed = 0x9e3779b9;

  constructor(private readonly host: HTMLElement) {}

  /** mulberry32: a cosmetic-only generator, separate from the game's seeded RNG. */
  private rand(): number {
    this.seed = (this.seed + 0x6d2b79f5) | 0;
    let t = this.seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Bursts confetti; returns how many pieces were made (0 with reduced motion). */
  burst(kind: CelebrationKind): number {
    if (isReducedMotion()) return 0;
    this.seed ^= Math.floor(performance.now());
    const n = PIECES[kind];
    for (let i = 0; i < n; i++) {
      const piece = h('span', { class: 'confetti', 'aria-hidden': 'true' });
      const size = 4 + Math.floor(this.rand() * 3) * 2; // 4, 6 or 8 px: a chunky pixel
      piece.style.width = piece.style.height = `${size}px`;
      piece.style.left = `${20 + this.rand() * 60}%`;
      piece.style.background = `var(${COLOURS[Math.floor(this.rand() * COLOURS.length)]})`;
      piece.style.setProperty('--dx', `${Math.round((this.rand() - 0.5) * 220)}px`);
      piece.style.setProperty('--rise', `${Math.round(60 + this.rand() * 120)}px`);
      piece.style.setProperty('--fall', `${Math.round(120 + this.rand() * 140)}px`);
      piece.style.animationDuration = `${(0.9 + this.rand() * 0.9).toFixed(2)}s`;
      piece.style.animationDelay = `${(this.rand() * 0.15).toFixed(2)}s`;
      this.host.append(piece);
      window.setTimeout(() => piece.remove(), 2400);
    }
    return n;
  }
}
