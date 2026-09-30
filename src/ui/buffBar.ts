// Active food buffs in the HUD: an icon with a remaining-time ring, a countdown, and a tooltip
// with the exact effect. Reads state only. The ring's full length is the longest time the buff has
// shown (the state stores only what is left), so eating again refills it.

import type { ActiveBuff, GameState } from '../core/state';
import type { GameData } from '../data';
import type { BuffType } from '../data/ids';
import type { BuffDef } from '../data/types';
import { spriteDataUrl } from '../render/spriteCache';
import { h } from './dom';

/** "20%" for percentage buffs, "+0.20" for luck. */
export function formatBuffAmount(def: BuffDef, magnitude: number): string {
  return def.additive ? `+${magnitude.toFixed(2)}` : `${Math.round(magnitude * 100)}%`;
}

/** The buff's sentence with its number filled in: "Crops grow 20% faster." */
export function buffEffectText(def: BuffDef, magnitude: number): string {
  return def.description.replace('{pct}', formatBuffAmount(def, magnitude));
}

/** m:ss for a countdown. */
export function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The tooltip: name and tier, the effect, the time left and the dish it came from. */
export function buffTooltip(data: GameData, b: ActiveBuff): string {
  const def = data.buffs[b.type];
  const dish = data.recipes[b.source]?.name ?? b.source;
  return `${def.name} (tier ${b.tier})\n${buffEffectText(def, b.magnitude)}\n${formatCountdown(b.remainingMs)} left · from ${dish}`;
}

interface Chip {
  root: HTMLElement;
  time: HTMLElement;
}

export class BuffBar {
  private readonly chips = new Map<BuffType, Chip>();
  private readonly peak = new Map<BuffType, number>();
  private shownKey = '';

  constructor(
    private readonly root: HTMLElement,
    private readonly data: GameData,
  ) {}

  update(state: GameState): void {
    const active = state.buffs.active;
    const key = active.map((b) => b.type).join(',');
    if (key !== this.shownKey) {
      this.shownKey = key;
      this.root.replaceChildren();
      this.chips.clear();
      for (const b of active) {
        const def = this.data.buffs[b.type];
        const time = h('span', { class: 'buff-time' });
        const chip = h(
          'div',
          { class: 'buff', 'data-buff': b.type, role: 'img' },
          h(
            'span',
            { class: 'buff-ring' },
            h('img', { class: 'pixel', alt: '', width: 28, height: 28, src: spriteDataUrl(def.icon) }),
          ),
          time,
        );
        this.chips.set(b.type, { root: chip, time });
        this.root.append(chip);
      }
      this.root.hidden = active.length === 0;
    }
    for (const t of [...this.peak.keys()]) if (!active.some((b) => b.type === t)) this.peak.delete(t);
    for (const b of active) {
      const chip = this.chips.get(b.type);
      if (!chip) continue;
      const peak = Math.max(this.peak.get(b.type) ?? 0, b.remainingMs);
      this.peak.set(b.type, peak);
      chip.root.style.setProperty('--p', `${Math.round((b.remainingMs / peak) * 100)}%`);
      const label = formatCountdown(b.remainingMs);
      if (chip.time.textContent !== label) {
        chip.time.textContent = label;
        const tip = buffTooltip(this.data, b);
        chip.root.title = tip;
        chip.root.setAttribute('aria-label', tip.replace(/\n/g, '. '));
      }
    }
  }
}
