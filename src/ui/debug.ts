// Debug overlay (backtick to toggle): FPS, tick count, the game clock, a ×60 time warp, and buttons
// to fake 8 h offline or jump to the next season change. Loaded only in dev builds or with ?debug.

import type { Game } from '../core/game';
import { formatDuration, formatHudDate, HOUR_MS } from '../core/time';
import { h } from './dom';

export interface DebugDeps {
  game: Game;
  fps(): number;
  onOffline(report: ReturnType<Game['debugFakeOffline']>): void;
  /** Turns the fake notch insets on or off (v3 phase 00); returns whether they are on. */
  toggleInsets(): boolean;
}

export function installDebugOverlay({ game, fps, onOffline, toggleInsets }: DebugDeps): void {
  const stats = h('pre', { class: 'debug-stats' });
  const warp = h('button', { type: 'button', class: 'btn', text: 'Time warp ×60: off' });
  const offline = h('button', { type: 'button', class: 'btn', text: 'Fake 8 h offline' });
  const season = h('button', { type: 'button', class: 'btn', text: 'Next season' });
  const insets = h('button', {
    type: 'button',
    class: 'btn',
    text: `Fake notch: ${document.documentElement.dataset.fakeInsets === undefined ? 'off' : 'on'}`,
  });
  const root = h(
    'div',
    { class: 'debug', hidden: true, 'aria-label': 'Debug overlay' },
    stats,
    h('div', { class: 'btn-row' }, warp, offline, season, insets),
  );
  document.body.append(root);

  warp.addEventListener('click', () => {
    const on = game.state.clock.speed === 1;
    game.dispatch({ type: 'debugSetTimeWarp', on });
    warp.textContent = `Time warp ×60: ${on ? 'on' : 'off'}`;
  });
  offline.addEventListener('click', () => onOffline(game.debugFakeOffline(8 * HOUR_MS)));
  season.addEventListener('click', () => game.debugJumpToSeasonChange());
  insets.addEventListener(
    'click',
    () => (insets.textContent = `Fake notch: ${toggleInsets() ? 'on' : 'off'}`),
  );

  document.addEventListener('keydown', (e) => {
    if (e.key !== '`' || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
      return;
    root.hidden = !root.hidden;
  });

  const update = (): void => {
    if (!root.hidden) {
      const s = game.state;
      const cal = game.calendar();
      stats.textContent = [
        `fps     ${fps().toFixed(0)}`,
        `ticks   ${game.tickCount}`,
        `simMs   ${s.clock.simMs} (${formatDuration(s.clock.simMs)})`,
        `speed   ×${s.clock.speed}`,
        `cal     ${formatHudDate(cal)}`,
        `day     ${cal.dayKey}  week ${cal.weekIndex}`,
        `season  changes in ${formatDuration(cal.msToSeasonChange)}`,
        `offset  ${formatDuration(s.calendar.debugOffsetMs)}`,
      ].join('\n');
    }
    window.setTimeout(update, 250);
  };
  update();
}
