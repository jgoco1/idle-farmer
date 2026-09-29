import { describe, expect, it } from 'vitest';
import { Game, MAX_TICKS_PER_FRAME } from '../src/core/game';
import { FixedStepper } from '../src/core/loop';
import { createInitialState } from '../src/core/state';
import { TICK_MS } from '../src/core/time';
import { GAME_DATA } from '../src/data';
import { at, HOUR, NY } from './helpers';

describe('FixedStepper', () => {
  it('turns uneven frame times into the right number of fixed ticks', () => {
    const s = new FixedStepper(100);
    const dts = [16.7, 33.3, 8, 120, 45.2, 0, 16.6, 250.1, 3, 7.1];
    let ticks = 0;
    for (const dt of dts) ticks += s.push(dt);
    expect(dts.reduce((a, b) => a + b, 0)).toBeCloseTo(500, 9);
    expect(ticks).toBe(5); // float drift must not lose the last tick
    expect(s.alpha).toBeCloseTo(0, 6);
  });

  it('carries the remainder between frames', () => {
    const s = new FixedStepper(100);
    expect(s.push(60)).toBe(0);
    expect(s.push(60)).toBe(1);
    expect(s.push(80)).toBe(1);
    expect(s.push(0.0001)).toBe(0);
  });

  it('ignores zero, negative and NaN frame times', () => {
    const s = new FixedStepper(100);
    expect(s.push(0)).toBe(0);
    expect(s.push(-50)).toBe(0);
    expect(s.push(Number.NaN)).toBe(0);
    expect(s.push(100)).toBe(1);
  });
});

describe('Game.advance', () => {
  const T0 = at(NY, 2026, 1, 7, 10);
  const newGame = (t = T0) => {
    let now = t;
    const game = new Game(createInitialState(t, NY, 1), { data: GAME_DATA, lc: NY, now: () => now });
    return { game, setNow: (n: number) => (now = n) };
  };

  it('advances simulated time in whole ticks', () => {
    const { game } = newGame();
    let ticks = 0;
    for (const dt of [16.7, 16.6, 16.7, 50, 3]) ticks += game.advance(dt);
    expect(ticks).toBe(1);
    expect(game.state.clock.simMs).toBe(TICK_MS);
    expect(game.tickCount).toBe(1);
  });

  it('runs a long frame as ticks plus one exact bulk step', () => {
    const { game } = newGame();
    const due = game.advance(60_000);
    expect(due).toBe(600);
    expect(due).toBeGreaterThan(MAX_TICKS_PER_FRAME);
    expect(game.state.clock.simMs).toBe(60_000);
  });

  it('the ×60 time warp speeds simulated time and moves the calendar', () => {
    const { game } = newGame();
    expect(game.dispatch({ type: 'debugSetTimeWarp', on: true })).toEqual({ ok: true });
    game.advance(1000);
    expect(game.state.clock.simMs).toBe(60_000);
    expect(game.state.calendar.debugOffsetMs).toBe(59_000);
    expect(game.calendarNow()).toBe(T0 + 59_000); // the fake real clock did not move
    game.dispatch({ type: 'debugSetTimeWarp', on: false });
    game.advance(1000);
    expect(game.state.clock.simMs).toBe(61_000);
  });

  it('fires calendar events while playing', () => {
    const { game, setNow } = newGame(at(NY, 2026, 1, 8, 5, 59));
    const seen: string[] = [];
    game.bus.onAny((e) => seen.push(e.type));
    setNow(at(NY, 2026, 1, 8, 6, 0));
    game.advance(16);
    expect(seen).toContain('dayStarted');
  });

  it('catches up a hidden tab with the offline rules', () => {
    const { game } = newGame();
    const r = game.catchUp(T0, T0 + 10 * HOUR);
    expect(r.simulatedMs).toBe(8.5 * HOUR);
    expect(game.state.clock.simMs).toBe(8.5 * HOUR);
  });

  it('debug: fake 8 h offline and jump to the next season', () => {
    const { game } = newGame();
    const r = game.debugFakeOffline(8 * HOUR);
    expect(r.simulatedMs).toBe(8 * HOUR);
    expect(game.calendarNow()).toBe(T0 + 8 * HOUR);
    const seasons: string[] = [];
    game.bus.on('seasonChanged', (e) => seasons.push(e.season));
    game.debugJumpToSeasonChange();
    expect(seasons).toEqual(['summer']);
    expect(game.calendar().season).toBe('summer');
  });
});

describe('actions', () => {
  const game = new Game(createInitialState(0, NY, 1), { data: GAME_DATA, lc: NY, now: () => 0 });

  it('clamps the volume', () => {
    game.dispatch({ type: 'setMasterVolume', value: 1.7 });
    expect(game.state.settings.masterVolume).toBe(1);
    game.dispatch({ type: 'setMasterVolume', value: 0.25 });
    expect(game.state.settings.masterVolume).toBe(0.25);
    expect(game.dispatch({ type: 'setMasterVolume', value: Number.NaN }).ok).toBe(false);
  });

  it('plot clicks explain that farming is not here yet', () => {
    const r = game.dispatch({ type: 'plotClicked', plot: 0 });
    expect(r.ok).toBe(false);
  });
});
