// The fixed-timestep simulation loop. Simulation advances in TICK_MS steps (10 per second),
// independent of the frame rate; rendering runs on requestAnimationFrame. The loop pauses when the
// tab is hidden and, when it becomes visible again, catches up with the offline logic.

import type { Game } from './game';
import type { OfflineReport } from './offline';

/** Frames longer than this (a sleeping laptop, a frozen tab) are treated as time away. */
export const LONG_GAP_MS = 5_000;

/** Turns uneven frame times into a whole number of fixed steps, carrying the remainder over. */
export class FixedStepper {
  private acc = 0;
  constructor(readonly stepMs: number) {}

  /** Adds `dtMs` and returns how many whole steps are now due. */
  push(dtMs: number): number {
    if (!(dtMs > 0)) return 0;
    this.acc += dtMs;
    // The epsilon absorbs float drift (16.7 + 33.3 + … landing on 99.99999 instead of 100).
    const steps = Math.floor((this.acc + 1e-6) / this.stepMs);
    this.acc = Math.max(0, this.acc - steps * this.stepMs);
    return steps;
  }

  /** Fraction of the next step already accumulated (0..1), for render interpolation. */
  get alpha(): number {
    return this.acc / this.stepMs;
  }

  reset(): void {
    this.acc = 0;
  }
}

export interface LoopHooks {
  render(frameDtMs: number): void;
  /** Called after a hidden tab (or a long frame gap) has been caught up. */
  onResume?(report: OfflineReport): void;
  /** Called when the tab is hidden, before the loop pauses. */
  onHide?(): void;
}

export interface LoopHandle {
  stop(): void;
  readonly fps: number;
}

/** Starts the browser loop. Real time for offline catch-up comes from `game.now()`. */
export function startLoop(game: Game, hooks: LoopHooks): LoopHandle {
  let raf = 0;
  let last = performance.now();
  let hiddenAt: number | null = null;
  let fps = 0;
  let fpsFrames = 0;
  let fpsStart = last;

  const frame = (t: number): void => {
    const dt = t - last;
    last = t;
    if (dt > LONG_GAP_MS) {
      const now = game.now();
      hooks.onResume?.(game.catchUp(now - dt, now));
    } else {
      game.advance(dt);
    }
    hooks.render(Math.min(dt, 250));
    fpsFrames++;
    if (t - fpsStart >= 500) {
      fps = (fpsFrames * 1000) / (t - fpsStart);
      fpsFrames = 0;
      fpsStart = t;
    }
    raf = requestAnimationFrame(frame);
  };

  const onVisibility = (): void => {
    if (document.hidden) {
      if (hiddenAt !== null) return;
      hiddenAt = game.now();
      cancelAnimationFrame(raf);
      hooks.onHide?.();
    } else if (hiddenAt !== null) {
      const from = hiddenAt;
      hiddenAt = null;
      hooks.onResume?.(game.catchUp(from, game.now()));
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  };

  document.addEventListener('visibilitychange', onVisibility);
  raf = requestAnimationFrame(frame);

  return {
    stop() {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVisibility);
    },
    get fps() {
      return fps;
    },
  };
}
