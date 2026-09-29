// The HUD strip: gold, season/date/time with a sun or moon, a placeholder for active buffs, and the
// settings button. Reads state and the calendar; never changes them.

import type { GameState } from '../core/state';
import { formatDuration, formatHudDate, DAY_MS, type Calendar } from '../core/time';
import { spriteDataUrl } from '../render/spriteCache';
import { h } from './dom';

/** Show the season countdown during the last two days of a season (GDD §4). */
const SEASON_WARNING_MS = 2 * DAY_MS;

export class Hud {
  private readonly goldText: HTMLElement;
  private readonly dateText: HTMLElement;
  private readonly timeIcon: HTMLImageElement;
  private readonly seasonNote: HTMLElement;
  readonly settingsButton: HTMLButtonElement;
  private last = '';

  constructor(root: HTMLElement) {
    this.goldText = h('span', { class: 'gold-amount', 'data-testid': 'gold' });
    this.dateText = h('span', { class: 'date-text', 'data-testid': 'date' });
    this.timeIcon = h('img', { class: 'pixel hud-icon', alt: '', width: 32, height: 32 });
    this.seasonNote = h('span', { class: 'season-note', hidden: true });
    this.settingsButton = h('button', {
      type: 'button',
      class: 'hud-btn',
      'aria-label': 'Settings',
      title: 'Settings',
      text: '⚙',
    });
    const gold = h(
      'div',
      { class: 'hud-gold', title: 'Gold' },
      h('img', {
        class: 'pixel hud-icon',
        alt: 'Gold',
        src: spriteDataUrl('ui_gold'),
        width: 32,
        height: 32,
      }),
      this.goldText,
    );
    const clock = h(
      'div',
      { class: 'hud-clock' },
      this.timeIcon,
      h('div', { class: 'hud-clock-text' }, this.dateText, this.seasonNote),
    );
    const buffs = h('div', {
      class: 'hud-buffs',
      'aria-label': 'Active buffs',
      title: 'Food buffs appear here',
    });
    root.append(gold, clock, buffs, h('div', { class: 'hud-right' }, this.settingsButton));
  }

  update(state: GameState, cal: Calendar): void {
    const key = `${state.gold}|${cal.dayKey}|${cal.hour}:${cal.minute}|${cal.weekIndex}|${Math.floor(cal.msToSeasonChange / 60000)}`;
    if (key === this.last) return;
    this.last = key;
    this.goldText.textContent = `${state.gold.toLocaleString('en-US')}g`;
    this.dateText.textContent = formatHudDate(cal);
    const icon = spriteDataUrl(cal.isNight ? 'ui_moon' : 'ui_sun');
    if (this.timeIcon.src !== icon) this.timeIcon.src = icon;
    this.timeIcon.alt = cal.isNight ? 'Night' : 'Day';
    const warn = cal.msToSeasonChange < SEASON_WARNING_MS;
    this.seasonNote.hidden = !warn;
    if (warn) this.seasonNote.textContent = `Season changes in ${formatDuration(cal.msToSeasonChange)}`;
  }
}
