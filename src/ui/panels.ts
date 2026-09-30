// Panel definitions. Phase 01 shipped every panel as a "Coming soon" stub except Settings; each
// phase replaces its stub's `build` with the real content (phase 02: Inventory, Shop's Seed Crate).

import type { GameState } from '../core/state';
import type { Calendar } from '../core/time';
import type { GameData } from '../data';
import { CROP_IDS, type CropId, type PanelId } from '../data/ids';
import type { ItemDef } from '../data/types';
import { spriteDataUrl } from '../render/spriteCache';
import type { ActionResult } from '../systems/context';
import { inSeason } from '../systems/farming';
import { usedSlots } from '../systems/inventory';
import type { Modifiers } from '../systems/modifiers';
import { isUnlocked } from '../systems/unlocks';
import { h } from './dom';
import { seedNote } from './farmTools';
import type { PanelDef } from './panel';

function stub(id: PanelId, title: string, icon: string, blurb: string): PanelDef {
  return {
    id,
    title,
    icon,
    build(body) {
      body.append(
        h('p', { class: 'coming-soon', text: 'Coming soon' }),
        h('p', { class: 'muted', text: blurb }),
      );
    },
  };
}

export const STUB_PANELS: readonly PanelDef[] = [
  stub('market', 'Market', '⚖', 'Sell crops, fish and dishes at the day’s prices.'),
  stub('kitchen', 'Kitchen', '🍲', 'Cook what you grow and catch into dishes with gentle buffs.'),
  stub('fishing', 'Fishing', '🎣', 'Cast a line in the pond, and later the river and the sea.'),
  stub('upgrades', 'Upgrades', '⚙', 'Sprinklers, a farmhand and better tools will live here.'),
  stub('goals', 'Goals', '★', 'Milestones and the Community Board will point the way.'),
];

export interface SettingsHooks {
  getVolume(): number;
  setVolume(v: number): void;
  exportSave(): string;
  /** Returns an error message, or null when the save was imported. */
  importSave(text: string): string | null;
  hardReset(): void;
}

export function settingsPanel(hooks: SettingsHooks): PanelDef {
  return {
    id: 'settings',
    title: 'Settings',
    icon: '⚙',
    toolbar: false,
    build(body) {
      // Volume (stub until phase 08 adds audio).
      const vol = h('input', { type: 'range', min: 0, max: 100, step: 1, id: 'set-volume' });
      const volOut = h('output', { for: 'set-volume' });
      vol.addEventListener('input', () => {
        hooks.setVolume(Number(vol.value) / 100);
        volOut.textContent = `${vol.value}%`;
      });

      // Export.
      const exportBox = h('textarea', {
        class: 'save-text',
        readonly: true,
        rows: 3,
        'aria-label': 'Exported save',
      });
      const exportBtn = h('button', { type: 'button', class: 'btn', text: 'Export save' });
      const copyBtn = h('button', { type: 'button', class: 'btn', text: 'Copy', hidden: true });
      exportBtn.addEventListener('click', () => {
        exportBox.value = hooks.exportSave();
        exportBox.hidden = false;
        copyBtn.hidden = false;
        exportBox.select();
      });
      copyBtn.addEventListener('click', () => {
        void navigator.clipboard?.writeText(exportBox.value).then(
          () => (copyBtn.textContent = 'Copied!'),
          () => (copyBtn.textContent = 'Select and copy'),
        );
      });
      exportBox.hidden = true;

      // Import.
      const importBox = h('textarea', {
        class: 'save-text',
        rows: 3,
        placeholder: 'Paste an exported save here',
        'aria-label': 'Save to import',
      });
      const importBtn = h('button', { type: 'button', class: 'btn', text: 'Import save' });
      const importMsg = h('p', { class: 'form-msg', role: 'status' });
      importBtn.addEventListener('click', () => {
        const err = hooks.importSave(importBox.value);
        importMsg.textContent = err ?? 'Save imported. Welcome back!';
        importMsg.className = err ? 'form-msg form-error' : 'form-msg form-ok';
        if (!err) importBox.value = '';
      });

      // Hard reset with a confirmation step.
      const resetBtn = h('button', { type: 'button', class: 'btn btn-danger', text: 'Hard reset…' });
      const confirmRow = h(
        'div',
        { class: 'confirm-row', hidden: true },
        h('p', {
          class: 'form-error',
          text: 'This erases your farm for good. Export first if you might want it back.',
        }),
      );
      const yes = h('button', { type: 'button', class: 'btn btn-danger', text: 'Yes, erase my farm' });
      const no = h('button', { type: 'button', class: 'btn', text: 'Cancel' });
      confirmRow.append(h('div', { class: 'btn-row' }, yes, no));
      resetBtn.addEventListener('click', () => {
        confirmRow.hidden = false;
        resetBtn.hidden = true;
        no.focus();
      });
      no.addEventListener('click', () => {
        confirmRow.hidden = true;
        resetBtn.hidden = false;
        resetBtn.focus();
      });
      yes.addEventListener('click', () => {
        confirmRow.hidden = true;
        resetBtn.hidden = false;
        hooks.hardReset();
      });

      body.append(
        h('h3', { text: 'Sound' }),
        h('label', { class: 'field', for: 'set-volume' }, 'Volume ', vol, volOut),
        h('p', { class: 'muted', text: 'Sounds arrive in a later update.' }),
        h('h3', { text: 'Your save' }),
        h('div', { class: 'btn-row' }, exportBtn, copyBtn),
        exportBox,
        importBox,
        h('div', { class: 'btn-row' }, importBtn),
        importMsg,
        h('h3', { text: 'Start over' }),
        h('div', { class: 'btn-row' }, resetBtn),
        confirmRow,
      );

      return {
        refresh() {
          const v = Math.round(hooks.getVolume() * 100);
          vol.value = String(v);
          volOut.textContent = `${v}%`;
          exportBox.hidden = true;
          copyBtn.hidden = true;
          copyBtn.textContent = 'Copy';
          importMsg.textContent = '';
          confirmRow.hidden = true;
          resetBtn.hidden = false;
        },
      };
    },
  };
}

export interface GameViewHooks {
  data: GameData;
  state(): GameState;
  calendar(): Calendar;
  mods(): Modifiers;
}

function itemTooltip(def: ItemDef): string {
  const value = def.sellable ? `Sells for about ${def.basePrice}g` : "Seeds can't be sold";
  return `${def.name}\n${def.description}\n${value}`;
}

/** Inventory: a grid of slots with icons and counts; hovering or focusing a slot shows its details. */
export function inventoryPanel(hooks: GameViewHooks): PanelDef {
  return {
    id: 'inventory',
    title: 'Inventory',
    icon: '🎒',
    live: true,
    build(body) {
      const summary = h('p', { class: 'muted inv-summary' });
      const grid = h('div', { class: 'inv-grid', role: 'list', 'aria-label': 'Inventory slots' });
      const detail = h('div', { class: 'inv-detail', 'aria-live': 'polite' });
      const blank = 'Hover or tap an item to see what it is worth.';
      let selected: number | null = null;
      body.append(summary, grid, detail);

      const describe = (def: ItemDef | undefined, qty: number): void => {
        if (!def) {
          detail.replaceChildren(h('p', { class: 'muted', text: blank }));
          return;
        }
        detail.replaceChildren(
          h('p', { class: 'inv-name', text: `${def.name} ×${qty}` }),
          h('p', { text: def.description }),
          h('p', {
            class: def.sellable ? 'inv-value' : 'muted',
            text: def.sellable ? `Sell value: ${def.basePrice}g each` : "Seeds can't be sold.",
          }),
        );
      };

      return {
        refresh() {
          const inv = hooks.state().inventory;
          summary.textContent = `${usedSlots(inv)} / ${inv.slots.length} slots · stacks of ${inv.stackSize}`;
          grid.replaceChildren();
          inv.slots.forEach((stack, i) => {
            const def = stack ? hooks.data.items[stack.item] : undefined;
            const slot = h('button', {
              type: 'button',
              class: `inv-slot${stack ? '' : ' is-empty'}`,
              role: 'listitem',
              'data-item': stack?.item,
              'aria-label': stack && def ? `${def.name}, ${stack.qty}` : 'Empty slot',
              title: def ? itemTooltip(def) : undefined,
            });
            if (stack && def) {
              slot.append(
                h('img', { class: 'pixel', alt: '', width: 32, height: 32, src: spriteDataUrl(def.sprite) }),
                h('span', { class: 'inv-qty', text: String(stack.qty) }),
              );
              const show = (): void => describe(def, stack.qty);
              slot.addEventListener('mouseenter', show);
              slot.addEventListener('focus', show);
              slot.addEventListener('click', () => {
                selected = i;
                show();
              });
            }
            grid.append(slot);
          });
          const sel = selected !== null ? inv.slots[selected] : null;
          describe(sel ? hooks.data.items[sel.item] : undefined, sel?.qty ?? 0);
        },
      };
    },
  };
}

export interface ShopHooks extends GameViewHooks {
  buySeeds(crop: CropId, qty: number): ActionResult;
}

/** TODO(phase03): the Shop is only the temporary Seed Crate for now; the real shop replaces it. */
export function shopPanel(hooks: ShopHooks, amounts: readonly number[]): PanelDef {
  return {
    id: 'shop',
    title: 'Shop',
    icon: '🛒',
    live: true,
    build(body) {
      const gold = h('p', { class: 'shop-gold' });
      const list = h('div', { class: 'crate-list' });
      const msg = h('p', { class: 'form-msg', role: 'status' });
      body.append(
        h('h3', { text: 'Seed Crate' }),
        h('p', { class: 'muted', text: 'A few starter seeds, until the market opens.' }),
        gold,
        list,
        msg,
      );

      const render = (): void => {
        // The list is rebuilt, so remember which buy button had focus and restore it after.
        const focused = document.activeElement;
        const focusLabel =
          focused instanceof HTMLElement && list.contains(focused)
            ? focused.getAttribute('aria-label')
            : null;
        const state = hooks.state();
        const cal = hooks.calendar();
        const mods = hooks.mods();
        gold.textContent = `You have ${state.gold}g`;
        list.replaceChildren();
        const crops = CROP_IDS.filter((c) => isUnlocked(state, hooks.data.crops[c].unlock));
        // In-season seeds first, then the rest in table order.
        crops.sort(
          (a, b) =>
            Number(inSeason(hooks.data.crops[b], cal.season)) -
            Number(inSeason(hooks.data.crops[a], cal.season)),
        );
        for (const crop of crops) {
          const def = hooks.data.crops[crop];
          const note = seedNote(hooks.data, crop, cal, mods);
          const seasonal = inSeason(def, cal.season);
          const buttons = amounts.map((n) => {
            const cost = def.seedPrice * n;
            const b = h('button', {
              type: 'button',
              class: 'btn btn-small',
              text: `×${n} · ${cost}g`,
              'aria-label': `Buy ${n} ${def.name} seeds for ${cost} gold`,
              disabled: !seasonal || state.gold < cost,
            });
            b.addEventListener('click', () => {
              const r = hooks.buySeeds(crop, n);
              msg.textContent = r.ok ? `Bought ${n} ${def.name} seeds.` : r.reason;
              msg.className = r.ok ? 'form-msg form-ok' : 'form-msg form-error';
              render();
            });
            return b;
          });
          list.append(
            h(
              'div',
              { class: `crate-row${note.ok ? '' : ' is-warn'}`, 'data-seed': crop },
              h('img', {
                class: 'pixel',
                alt: '',
                width: 32,
                height: 32,
                src: spriteDataUrl(`item_seed_${crop}`),
              }),
              h(
                'div',
                { class: 'crate-text' },
                h('span', { text: `${def.name} · ${def.seedPrice}g` }),
                h('span', { class: 'seed-note', text: note.text }),
              ),
              h('div', { class: 'btn-row' }, ...buttons),
            ),
          );
        }
        if (focusLabel) {
          [...list.querySelectorAll<HTMLButtonElement>('button')]
            .find((b) => b.getAttribute('aria-label') === focusLabel && !b.disabled)
            ?.focus();
        }
      };
      return {
        refresh() {
          render();
        },
      };
    },
  };
}
