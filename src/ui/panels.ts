// Panel definitions. Phase 01 shipped every panel as a "Coming soon" stub except Settings; each
// phase replaces its stub's `build` with the real content (phase 02: Inventory; phase 03: Shop,
// plus the Market and Upgrades panels in marketPanel.ts and upgradesPanel.ts).

import type { GameState } from '../core/state';
import { capitalize, seasonOfWeek, type Calendar } from '../core/time';
import type { GameData } from '../data';
import { SHOP_BUY_AMOUNTS } from '../data/balance';
import { CROP_IDS, type CropId, type PanelId } from '../data/ids';
import type { ItemDef } from '../data/types';
import { spriteDataUrl } from '../render/spriteCache';
import type { ActionResult } from '../systems/context';
import { inSeason } from '../systems/farming';
import { usedSlots } from '../systems/inventory';
import { unitPrice } from '../systems/market';
import type { Modifiers } from '../systems/modifiers';
import { maxAffordableSeeds, seedStock } from '../systems/shop';
import { farmLevel } from '../systems/unlocks';
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
  stub('kitchen', 'Kitchen', '🍲', 'Cook what you grow and catch into dishes with gentle buffs.'),
  stub('fishing', 'Fishing', '🎣', 'Cast a line in the pond, and later the river and the sea.'),
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

function sellText(hooks: GameViewHooks, def: ItemDef): string {
  if (!def.sellable) return "Seeds can't be sold.";
  const now = unitPrice(hooks.state(), hooks.data, hooks.mods(), def.id);
  return `Sells for ${now}g each at the Market right now.`;
}

function itemTooltip(hooks: GameViewHooks, def: ItemDef): string {
  return `${def.name}\n${def.description}\n${sellText(hooks, def)}`;
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
          h('p', { class: def.sellable ? 'inv-value' : 'muted', text: sellText(hooks, def) }),
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
              title: def ? itemTooltip(hooks, def) : undefined,
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

/**
 * The Shop (GDD §6.2): this season's seeds. Unlocked ones can be bought by 1, 5, 10 or as many as
 * gold and bag space allow; locked ones show how to unlock them. The stock changes with the season.
 */
export function shopPanel(hooks: ShopHooks): PanelDef {
  return {
    id: 'shop',
    title: 'Shop',
    icon: '🛒',
    live: true,
    build(body) {
      const gold = h('p', { class: 'shop-gold' });
      const list = h('div', { class: 'crate-list' });
      const later = h('p', { class: 'muted' });
      const msg = h('p', { class: 'form-msg', role: 'status' });
      body.append(h('h3', { text: 'Seeds' }), gold, list, msg, later);

      const render = (): void => {
        // The list is rebuilt, so remember which buy button had focus and restore it after.
        const focused = document.activeElement;
        const focusLabel =
          focused instanceof HTMLElement && list.contains(focused) ? focused.dataset.buy : null;
        const state = hooks.state();
        const cal = hooks.calendar();
        const mods = hooks.mods();
        gold.textContent = `You have ${state.gold.toLocaleString('en-US')}g · Farm Level ${farmLevel(state)}`;
        list.replaceChildren();
        const stock = seedStock(state, hooks.data, cal.season);
        if (stock.length === 0) list.append(h('p', { class: 'muted', text: 'No seeds this season.' }));
        for (const s of stock) {
          const def = hooks.data.crops[s.crop];
          const note = s.unlocked
            ? seedNote(hooks.data, s.crop, cal, mods)
            : { ok: false, text: `Locked. ${s.hint ?? ''}` };
          const max = maxAffordableSeeds(state, hooks.data, s.crop);
          const buttons = s.unlocked
            ? [...SHOP_BUY_AMOUNTS, 'max' as const].map((n) => {
                const qty = n === 'max' ? max : n;
                const cost = def.seedPrice * qty;
                const b = h('button', {
                  type: 'button',
                  class: 'btn btn-small',
                  'data-buy': `${s.crop}:${n}`,
                  text: n === 'max' ? `Max ×${qty}` : `×${n} · ${cost}g`,
                  'aria-label': `Buy ${qty} ${def.name} seeds for ${cost} gold`,
                  disabled: qty <= 0 || state.gold < cost,
                });
                b.addEventListener('click', () => {
                  const r = hooks.buySeeds(s.crop, qty);
                  msg.textContent = r.ok ? `Bought ${qty} ${def.name} seeds for ${cost}g.` : r.reason;
                  msg.className = r.ok ? 'form-msg form-ok' : 'form-msg form-error';
                  render();
                });
                return b;
              })
            : [];
          list.append(
            h(
              'div',
              {
                class: `crate-row${note.ok ? '' : ' is-warn'}${s.unlocked ? '' : ' is-locked'}`,
                'data-seed': s.crop,
              },
              h('img', {
                class: 'pixel',
                alt: '',
                width: 32,
                height: 32,
                src: spriteDataUrl(`item_seed_${s.crop}`),
              }),
              h(
                'div',
                { class: 'crate-text' },
                h('span', { text: `${def.name} · ${def.seedPrice}g` }),
                h('span', { class: 'seed-note', text: note.text }),
              ),
              buttons.length > 0 ? h('div', { class: 'btn-row' }, ...buttons) : null,
            ),
          );
        }
        const next = seasonOfWeek(cal.weekIndex + 1);
        later.textContent = `The stock changes with the seasons. ${capitalize(next)} brings ${CROP_IDS.filter(
          (c) => inSeason(hooks.data.crops[c], next) && !inSeason(hooks.data.crops[c], cal.season),
        )
          .map((c) => hooks.data.crops[c].name.toLowerCase())
          .join(', ') || 'no new seeds'}.`;
        if (focusLabel) {
          list.querySelector<HTMLButtonElement>(`[data-buy="${focusLabel}"]:not([disabled])`)?.focus();
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
