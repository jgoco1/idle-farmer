// The HUD strip: gold, season/date/time with a sun or moon, a active food buffs, and the
// settings button. Reads state and the calendar; never changes them.

import type { GameState } from '../core/state';
import { formatDuration, formatHudDate, DAY_MS, type Calendar } from '../core/time';
import { GAME_DATA } from '../data';
import { spriteDataUrl } from '../render/spriteCache';
import { formatNumber, type NumberFormat } from '../core/prefs';
import { farmLevel } from '../systems/unlocks';
import { BuffBar } from './buffBar';
import { h } from './dom';
import { isReducedMotion } from './motion';

/** Show the season countdown during the last two days of a season (GDD §4). */
const SEASON_WARNING_MS = 2 * DAY_MS;
/** Gold counts up to a new total over this long (spending snaps down at once). */
const GOLD_TWEEN_MS = 600;

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
  /** The Farm Level chip next to the gold; main opens the Goals panel from it (v2-06). */
  readonly levelButton: HTMLButtonElement;
  private levelShown = -1;
  private last = '';
  private readonly gold = new GoldCounter();
  private goldShown = -1;
  private numberFormat: NumberFormat = 'full';
  private readonly goldBox: HTMLElement;
  private readonly buffBar: BuffBar;

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
    this.levelButton = h('button', {
      type: 'button',
      class: 'hud-level',
      'data-testid': 'farm-level',
      title: 'Farm Level: open Goals',
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
      role: 'group',
      'aria-label': 'Active buffs',
      'data-testid': 'buffs',
    });
    this.buffBar = new BuffBar(buffs, GAME_DATA);
    this.goldBox = gold;
    root.append(gold, this.levelButton, clock, buffs, h('div', { class: 'hud-right' }, this.settingsButton));
  }

  setNumberFormat(mode: NumberFormat): void {
    this.numberFormat = mode;
    this.goldShown = -1; // redraw the text in the new format
  }

  /** The gold icon's position, where bin payouts fly to. */
  get goldElement(): HTMLElement {
    return this.goldBox;
  }

  update(state: GameState, cal: Calendar, timeMs: number = performance.now()): void {
    const shown = this.gold.value(state.gold, timeMs, !isReducedMotion());
    if (shown !== this.goldShown) {
      this.goldShown = shown;
      this.goldText.textContent = `${formatNumber(shown, this.numberFormat)}g`;
    }
    this.goldBox.classList.toggle('is-counting', this.gold.counting);
    const level = farmLevel(state);
    if (level !== this.levelShown) {
      this.levelShown = level;
      this.levelButton.textContent = `Lv ${level}`;
      this.levelButton.setAttribute('aria-label', `Farm Level ${level}`);
    }
    this.buffBar.update(state);
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
