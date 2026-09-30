// The farming tool selector in the toolbar (GDD §5): Auto, Hoe, Seeds ▾, Can, Hand. The selected
// tool and seed are UI state, not game state. The seed picker lists the seeds in the inventory, which
// of them are in season, and warns about crops that won't finish before the season changes.

import type { GameState } from '../core/state';
import { capitalize, type Calendar } from '../core/time';
import type { GameData } from '../data';
import { CROP_IDS, seedOf, type CropId } from '../data/ids';
import { spriteDataUrl } from '../render/spriteCache';
import { finishesBeforeSeasonEnds, inSeason, type FarmTool } from '../systems/farming';
import { countItem } from '../systems/inventory';
import type { Modifiers } from '../systems/modifiers';
import { h } from './dom';

interface ToolDef {
  tool: FarmTool;
  label: string;
  icon: string; // sprite id
  key: string; // keyboard shortcut
  hint: string;
}

const TOOLS: readonly ToolDef[] = [
  { tool: 'auto', label: 'Auto', icon: 'ui_tool_auto', key: '1', hint: 'Does the obvious thing' },
  { tool: 'hoe', label: 'Hoe', icon: 'ui_tool_hoe', key: '2', hint: 'Till soil, clear dead crops' },
  { tool: 'seeds', label: 'Seeds', icon: 'item_seed_turnip', key: '3', hint: 'Plant the chosen seed' },
  { tool: 'water', label: 'Can', icon: 'ui_tool_water', key: '4', hint: 'Water for 2 hours' },
  { tool: 'hand', label: 'Hand', icon: 'ui_tool_hand', key: '5', hint: 'Harvest ready crops' },
];

export interface FarmToolsDeps {
  data: GameData;
  state(): GameState;
  calendar(): Calendar;
  mods(): Modifiers;
}

/** Seed advice for the picker and the shop: in season, and whether it finishes in time. */
export function seedNote(
  data: GameData,
  crop: CropId,
  cal: Calendar,
  mods: Modifiers,
): {
  ok: boolean;
  text: string;
} {
  const def = data.crops[crop];
  if (!inSeason(def, cal.season)) {
    return { ok: false, text: `Out of season (${def.seasons.map(capitalize).join(', ')})` };
  }
  if (!finishesBeforeSeasonEnds(def, cal, mods)) {
    return { ok: false, text: "Won't finish before the season changes" };
  }
  return { ok: true, text: `In season · ${Math.round(def.growSec / 60)} min` };
}

export class FarmTools {
  tool: FarmTool = 'auto';
  seed: CropId | null = null;
  private readonly buttons = new Map<FarmTool, HTMLButtonElement>();
  private readonly seedIcon: HTMLImageElement;
  private readonly seedCount: HTMLElement;
  private readonly picker: HTMLElement;
  private readonly pickerList: HTMLElement;
  private last = '';

  constructor(
    root: HTMLElement,
    private readonly deps: FarmToolsDeps,
  ) {
    const group = h('div', { class: 'tool-group', role: 'group', 'aria-label': 'Farming tools' });
    this.seedIcon = h('img', { class: 'pixel tool-img', alt: '', width: 32, height: 32 });
    this.seedCount = h('span', { class: 'tool-count', 'data-testid': 'seed-count' });
    for (const t of TOOLS) {
      const img =
        t.tool === 'seeds'
          ? this.seedIcon
          : h('img', { class: 'pixel tool-img', alt: '', width: 32, height: 32, src: spriteDataUrl(t.icon) });
      const btn = h(
        'button',
        {
          type: 'button',
          class: 'tool-btn farm-tool',
          'data-tool': t.tool,
          'aria-pressed': 'false',
          'aria-label': t.label,
          title: `${t.label} (${t.key}): ${t.hint}`,
        },
        img,
        h('span', { class: 'tool-label farm-tool-label', text: t.tool === 'seeds' ? 'Seeds ▾' : t.label }),
        t.tool === 'seeds' ? this.seedCount : null,
      );
      btn.addEventListener('click', () => {
        if (t.tool === 'seeds') this.togglePicker();
        else this.select(t.tool);
      });
      this.buttons.set(t.tool, btn);
      group.append(btn);
    }
    root.append(group);

    this.pickerList = h('div', { class: 'seed-list' });
    this.picker = h(
      'div',
      { class: 'seed-picker', role: 'dialog', 'aria-label': 'Choose a seed', hidden: true },
      h('h3', { text: 'Seeds' }),
      this.pickerList,
    );
    document.body.append(this.picker);

    document.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'Escape' && !this.picker.hidden) {
        e.preventDefault();
        this.closePicker();
        return;
      }
      const t = TOOLS.find((d) => d.key === e.key);
      if (t && !e.ctrlKey && !e.metaKey && !e.altKey) this.select(t.tool);
    });
    document.addEventListener('pointerdown', (e) => {
      const target = e.target as Node;
      if (
        !this.picker.hidden &&
        !this.picker.contains(target) &&
        !this.buttons.get('seeds')?.contains(target)
      )
        this.closePicker();
    });
    this.select('auto');
  }

  select(tool: FarmTool): void {
    this.tool = tool;
    this.buttons.forEach((b, t) => b.setAttribute('aria-pressed', String(t === tool)));
  }

  /** Keeps the seed button in step with the inventory (runs every frame; cheap when unchanged). */
  update(): void {
    const state = this.deps.state();
    const owned = CROP_IDS.filter((c) => countItem(state.inventory, seedOf(c)) > 0);
    if (this.seed === null || !owned.includes(this.seed)) {
      const season = this.deps.calendar().season;
      this.seed = owned.find((c) => inSeason(this.deps.data.crops[c], season)) ?? owned[0] ?? this.seed;
    }
    const n = this.seed ? countItem(state.inventory, seedOf(this.seed)) : 0;
    const key = `${this.seed}|${n}`;
    if (key === this.last) return;
    this.last = key;
    this.seedIcon.src = spriteDataUrl(this.seed ? `item_seed_${this.seed}` : 'item_seed_turnip');
    this.seedCount.textContent = String(n);
    const btn = this.buttons.get('seeds');
    if (btn && this.seed)
      btn.setAttribute('aria-label', `Seeds: ${this.deps.data.crops[this.seed].name}, ${n} left`);
  }

  private togglePicker(): void {
    if (this.picker.hidden) this.openPicker();
    else this.closePicker();
  }

  private openPicker(): void {
    const state = this.deps.state();
    const cal = this.deps.calendar();
    const mods = this.deps.mods();
    this.pickerList.replaceChildren();
    const owned = CROP_IDS.filter((c) => countItem(state.inventory, seedOf(c)) > 0);
    if (owned.length === 0) {
      this.pickerList.append(
        h('p', { class: 'muted', text: 'No seeds. The Shop has some.' }),
      );
    }
    for (const crop of owned) {
      const def = this.deps.data.crops[crop];
      const note = seedNote(this.deps.data, crop, cal, mods);
      const btn = h(
        'button',
        {
          type: 'button',
          class: `seed-option${crop === this.seed ? ' is-selected' : ''}${note.ok ? '' : ' is-warn'}`,
          'data-seed': crop,
        },
        h('img', { class: 'pixel', alt: '', width: 32, height: 32, src: spriteDataUrl(`item_seed_${crop}`) }),
        h(
          'span',
          { class: 'seed-text' },
          h('span', { text: `${def.name} ×${countItem(state.inventory, seedOf(crop))}` }),
          h('span', { class: 'seed-note', text: note.text }),
        ),
      );
      btn.addEventListener('click', () => {
        this.seed = crop;
        this.last = '';
        this.update();
        this.select('seeds');
        this.closePicker();
      });
      this.pickerList.append(btn);
    }
    this.picker.hidden = false;
    (
      this.pickerList.querySelector<HTMLElement>('.is-selected') ?? this.pickerList.querySelector('button')
    )?.focus();
  }

  private closePicker(): void {
    this.picker.hidden = true;
  }
}
