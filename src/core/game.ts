// The game object: owns the state, the event bus and the fixed stepper, and is the only thing that
// runs systems. No DOM here, so it is fully testable; src/main.ts wires it to the browser.

import type { GameData } from '../data';
import type { ActionResult } from '../systems/context';
import { plotWatered } from '../systems/farming';
import { applyAction, type Action } from './actions';
import { EventBus, type GameEvent } from './events';
import { FixedStepper } from './loop';
import { runOffline, type OfflineReport } from './offline';
import { makeContext, processCalendar, step } from './sim';
import type { GameState } from './state';
import {
  buildCalendar,
  calendarTime,
  nextSeasonChange,
  TICK_MS,
  type Calendar,
  type LocalClock,
} from './time';

/** Most individual ticks per frame; any extra (time warp, slow frames) runs as one exact bulk step. */
export const MAX_TICKS_PER_FRAME = 240;

export interface GameOptions {
  data: GameData;
  lc: LocalClock;
  /** Real epoch ms. Injected so tests control time. */
  now: () => number;
}

export class Game {
  readonly bus = new EventBus();
  readonly data: GameData;
  readonly lc: LocalClock;
  readonly now: () => number;
  tickCount = 0;
  /** True while an offline catch-up's events are being flushed to the bus, so the UI can summarise instead of reacting to each one. */
  replaying = false;
  private readonly stepper = new FixedStepper(TICK_MS);

  constructor(
    public state: GameState,
    opts: GameOptions,
  ) {
    this.data = opts.data;
    this.lc = opts.lc;
    this.now = opts.now;
  }

  /** Calendar time now (real time plus the debug offset). */
  calendarNow(): number {
    return calendarTime(this.state.calendar, this.now());
  }

  calendar(): Calendar {
    return buildCalendar(this.calendarNow(), this.state.calendar, this.lc);
  }

  /** Whether plot `index` counts as watered (hand watering, a sprinkler or the greenhouse). */
  isPlotWatered(index: number): boolean {
    return plotWatered(this.state, this.data, index);
  }

  /** The only way the UI and renderer change state. */
  dispatch(action: Action): ActionResult {
    const events: GameEvent[] = [];
    const ctx = makeContext(this.state, this.data, this.calendar(), events);
    const result = applyAction(this.state, ctx, action);
    this.bus.emitAll(events);
    return result;
  }

  /** Advances by one frame of real time: calendar events, then whole fixed ticks. Returns ticks run. */
  advance(realDtMs: number): number {
    if (!(realDtMs > 0)) return 0;
    const speed = this.state.clock.speed;
    this.state.meta.playTimeMs += Math.round(realDtMs);
    if (speed !== 1) this.state.calendar.debugOffsetMs += Math.round(realDtMs * (speed - 1));

    const events: GameEvent[] = [];
    const t = this.calendarNow();
    processCalendar(this.state, this.data, this.lc, t, events);

    const due = this.stepper.push(realDtMs * speed);
    if (due > 0) {
      const ctx = makeContext(this.state, this.data, buildCalendar(t, this.state.calendar, this.lc), events);
      const single = Math.min(due, MAX_TICKS_PER_FRAME);
      for (let i = 0; i < single; i++) step(this.state, ctx, TICK_MS);
      if (due > single) step(this.state, ctx, (due - single) * TICK_MS);
      this.tickCount += due;
    }
    this.bus.emitAll(events);
    return due;
  }

  /** Applies offline progress for real time [fromReal, toReal] and emits the resulting events. */
  catchUp(fromReal: number, toReal: number): OfflineReport {
    const off = this.state.calendar.debugOffsetMs;
    return this.runOfflineCal(fromReal + off, toReal + off);
  }

  replaceState(state: GameState): void {
    this.state = state;
    this.stepper.reset();
  }

  // ---- debug helpers (used only by the debug overlay)

  /** Pretends the player was away for `ms`: moves the calendar forward and runs the offline walk. */
  debugFakeOffline(ms: number): OfflineReport {
    const from = this.calendarNow();
    this.state.calendar.debugOffsetMs += ms;
    return this.runOfflineCal(from, from + ms);
  }

  /** Moves the calendar just past the next season change (no simulated time passes). */
  debugJumpToSeasonChange(): void {
    const t = this.calendarNow();
    const target = nextSeasonChange(t, this.state.calendar.seasonEpoch, this.lc);
    this.state.calendar.debugOffsetMs += target - t + 1000;
    const events: GameEvent[] = [];
    processCalendar(this.state, this.data, this.lc, this.calendarNow(), events);
    this.bus.emitAll(events);
  }

  private runOfflineCal(from: number, to: number): OfflineReport {
    const report = runOffline(this.state, this.data, this.lc, from, to);
    this.replaying = true;
    try {
      this.bus.emitAll(report.events);
    } finally {
      this.replaying = false;
    }
    return report;
  }
}
