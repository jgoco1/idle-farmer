// The HUD strip: gold, season/date/time with a sun or moon, a placeholder for active buffs, and the
// settings button. Reads state and the calendar; never changes them.

import type { GameState } from '../core/state';
import { formatDuration, formatHudDate, DAY_MS, type Calendar } from '../core/time';
import { spriteDataUrl } from '../render/spriteCache';
import { h } from './dom';

/** Show the season countdown during the last two days of a season (GDD §4). */
const SEASON_WARNING_MS = 2 * DAY_MS;
/** Gold counts up to a new total over this long (spending snaps down at once). */
const GOLD_TWEEN_MS = 600;

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The animated gold counter: when the total rises it counts up from what is shown with an ease-out;
 * when it falls (a purchase) it snaps. UI state only.
 */
export class GoldCounter {
  shown: number | null = null;
  private from = 0;
  private to = 0;
  private start = 0;

  /** The value to display at `timeMs` for the current total `gold`. */
  value(gold: number, timeMs: number, animate = true): number {
    if (this.shown === null || !animate || gold < (this.shown ?? 0)) {
      this.shown = this.from = this.to = gold;
      return gold;
    }
    if (gold !== this.to) {
      this.from = this.shown;
      this.to = gold;
      this.start = timeMs;
    }
    const p = Math.min(1, Math.max(0, (timeMs - this.start) / GOLD_TWEEN_MS));
    const eased = 1 - (1 - p) ** 3;
    this.shown = p >= 1 ? this.to : Math.round(this.from + (this.to - this.from) * eased);
    return this.shown;
  }

  get counting(): boolean {
    return this.shown !== this.to;
  }
}

export class Hud {
  private readonly goldText: HTMLElement;
  private readonly dateText: HTMLElement;
  private readonly timeIcon: HTMLImageElement;
  private readonly seasonNote: HTMLElement;
  readonly settingsButton: HTMLButtonElement;
  private last = '';
  private readonly gold = new GoldCounter();
  private goldShown = -1;
  private readonly goldBox: HTMLElement;

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
      { class: 'hud-gold', title: 'Gold', 'aria-live': 'off' },
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
    this.goldBox = gold;
    root.append(gold, clock, buffs, h('div', { class: 'hud-right' }, this.settingsButton));
  }

  /** The gold icon's position, where bin payouts fly to. */
  get goldElement(): HTMLElement {
    return this.goldBox;
  }

  update(state: GameState, cal: Calendar, timeMs: number = performance.now()): void {
    const shown = this.gold.value(state.gold, timeMs, !prefersReducedMotion());
    if (shown !== this.goldShown) {
      this.goldShown = shown;
      this.goldText.textContent = `${shown.toLocaleString('en-US')}g`;
    }
    this.goldBox.classList.toggle('is-counting', this.gold.counting);
    const key = `${cal.dayKey}|${cal.hour}:${cal.minute}|${cal.weekIndex}|${Math.floor(cal.msToSeasonChange / 60000)}`;
    if (key === this.last) return;
    this.last = key;
    this.dateText.textContent = formatHudDate(cal);
    const icon = spriteDataUrl(cal.isNight ? 'ui_moon' : 'ui_sun');
    if (this.timeIcon.src !== icon) this.timeIcon.src = icon;
    this.timeIcon.alt = cal.isNight ? 'Night' : 'Day';
    const warn = cal.msToSeasonChange < SEASON_WARNING_MS;
    this.seasonNote.hidden = !warn;
    if (warn) this.seasonNote.textContent = `Season changes in ${formatDuration(cal.msToSeasonChange)}`;
  }
}
