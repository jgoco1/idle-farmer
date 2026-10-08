// The Upgrades panel: farm expansions, the automation upgrades (sprinklers, scarecrows, farmhand,
// seed planter, auto-seller, greenhouse), the tools and storage. Each card shows the level, what the
// next level does, its cost and what still locks it; buying flashes the card and says what changed.

import {
  CROP_IDS,
  ANIMAL_PRODUCT_IDS,
  DRINK_IDS,
  FRUIT_IDS,
  PARCEL_IDS,
  type CropId,
  type ExpansionId,
  type ItemId,
  type ParcelId,
  type UpgradeId,
} from '../data/ids';
import type { PlacedKind } from '../core/state';
import type { UpgradeCategory } from '../data/types';
import { SEED_ORDER_RESERVES } from '../data/balance';
import { FARM_EXPANSIONS, FISHING_EXPANSIONS } from '../data/expansions';
import { spriteDataUrl } from '../render/spriteCache';
import type { ActionResult } from '../systems/context';
import { autoSellOn } from '../systems/autoSeller';
import { expansionStatus } from '../systems/expansions';
import { parcelStatus } from '../systems/parcels';
import { placedCount, stockOf } from '../systems/placement';
import { unlockHints } from '../systems/unlocks';
import { purchaseBlock, requirementsFor, upgradeCost, upgradeLevel } from '../systems/upgrades';
import { h } from './dom';
import type { PanelDef } from './panel';
import type { GameViewHooks } from './panels';

export interface UpgradesHooks extends GameViewHooks {
  buyExpansion(id: ExpansionId): ActionResult;
  buyUpgrade(id: UpgradeId): ActionResult;
  buyParcel(id: ParcelId): ActionResult;
  /** Enters placement mode for a sprinkler or scarecrow. */
  place(kind: PlacedKind): void;
  setAutoSell(item: ItemId, on: boolean): ActionResult;
  /** Seed Order: the gold reserve (percent of current gold) and a crop's opt-out. */
  setSeedOrderReserve(pct: number): ActionResult;
  setSeedOrderCrop(crop: CropId, on: boolean): ActionResult;
}

/** Upgrade cards by section, in panel order. */
const SECTIONS: readonly { title: string; category: UpgradeCategory; ids: readonly UpgradeId[] }[] = [
  {
    title: 'Automation',
    category: 'farm',
    ids: [
      'sprinkler',
      'sprinkler_tech',
      'scarecrow',
      'farmhand',
      'seed_planter',
      'seed_order',
      'auto_seller',
      'greenhouse',
    ],
  },
  { title: 'Fishing', category: 'fishing', ids: ['fish_trap', 'fishing_rod', 'trap_collector'] },
  { title: 'Kitchen', category: 'kitchen', ids: ['kitchen'] },
  { title: 'Tools', category: 'tools', ids: ['watering_can', 'hoe'] },
  { title: 'Storage', category: 'storage', ids: ['backpack', 'barn_storage'] },
  { title: 'Ranch', category: 'ranch', ids: ['ranch_collector'] },
];

const CARD_ICON: Partial<Record<UpgradeId, string>> = {
  sprinkler: 'obj_sprinkler',
  scarecrow: 'obj_scarecrow',
  farmhand: 'char_farmhand_idle',
  seed_order: 'item_seed_strawberry',
  fish_trap: 'obj_fish_trap',
  fishing_rod: 'ui_tool_rod',
  watering_can: 'ui_tool_water',
  hoe: 'ui_tool_hoe',
  kitchen: 'buff_cookSpeed',
  ranch_collector: 'item_egg',
};

export function upgradesPanel(hooks: UpgradesHooks): PanelDef {
  return {
    id: 'upgrades',
    wide: true,
    title: 'Upgrades',
    icon: '🔨',
    live: true,
    build(body) {
      const gold = h('p', { class: 'shop-gold' });
      const farm = h('div', { class: 'crate-list' });
      const waters = h('div', { class: 'crate-list' });
      const land = h('div', { class: 'crate-list', 'data-section': 'land' });
      const sections = SECTIONS.map((sec) => ({ sec, list: h('div', { class: 'crate-list' }) }));
      const msg = h('p', { class: 'form-msg', role: 'status' });
      body.append(
        gold,
        h('h3', { text: 'Field' }),
        farm,
        h('h3', { text: 'Land' }),
        land,
        ...sections.flatMap(({ sec, list }) => [
          h('h3', { text: sec.title }),
          ...(sec.category === 'fishing' ? [waters] : []),
          list,
        ]),
        msg,
      );
      let flash: string | null = null;

      const say = (r: ActionResult, ok: string, key?: string): void => {
        msg.textContent = r.ok ? ok : r.reason;
        msg.className = r.ok ? 'form-msg form-ok' : 'form-msg form-error';
        if (r.ok && key) flash = key;
      };

      const card = (
        key: string,
        title: string,
        text: string,
        state: 'owned' | 'available' | 'locked',
        buttons: HTMLElement[],
        icon?: string,
        extra?: HTMLElement,
      ): HTMLElement =>
        h(
          'div',
          {
            class: `crate-row upgrade-row is-${state}${flash === key ? ' just-bought' : ''}`,
            'data-upgrade': key,
          },
          icon
            ? h('img', {
                class: 'pixel upgrade-icon',
                alt: '',
                width: 24,
                height: 24,
                src: spriteDataUrl(icon),
              })
            : h('span', {
                class: 'upgrade-mark',
                'aria-hidden': 'true',
                text: state === 'owned' ? '✓' : state === 'locked' ? '🔒' : '★',
              }),
          h(
            'div',
            { class: 'crate-text' },
            h('span', { text: title }),
            h('span', { class: 'seed-note', text }),
          ),
          buttons.length ? h('div', { class: 'btn-row' }, ...buttons) : null,
          extra ?? null,
        );

      const render = (): void => {
        const state = hooks.state();
        const focusedKey =
          document.activeElement instanceof HTMLElement && body.contains(document.activeElement)
            ? document.activeElement.closest<HTMLElement>('[data-upgrade]')?.dataset.upgrade
            : undefined;
        const focusedRole =
          document.activeElement instanceof HTMLElement ? document.activeElement.dataset.role : undefined;
        gold.textContent = `You have ${state.gold.toLocaleString('en-US')}g`;

        const expansionCards = (ids: readonly ExpansionId[]): HTMLElement[] =>
          ids.map((id) => {
            const def = hooks.data.expansions[id];
            const status = expansionStatus(state, hooks.data, id);
            const grid = def.grid ? `${def.grid.cols} × ${def.grid.rows} plots` : '';
            const done = def.grid ? `your field is now ${grid}` : `${def.sceneChange}`;
            const buttons: HTMLElement[] = [];
            let text = `${def.description} (${grid})`;
            if (status === 'available') {
              const button = h('button', {
                type: 'button',
                class: 'btn btn-small btn-primary',
                text: `Buy · ${def.price.toLocaleString('en-US')}g`,
                'aria-label': `Buy ${def.name} for ${def.price} gold`,
                disabled: state.gold < def.price,
              });
              button.addEventListener('click', () => {
                say(hooks.buyExpansion(id), `${def.name}: ${done}.`, id);
                render();
              });
              buttons.push(button);
            } else if (status === 'locked') {
              text = `${def.price.toLocaleString('en-US')}g · ${unlockHints(state, hooks.data, def.requires).join(' ')}`;
            } else {
              text = def.grid ? `Done · ${grid}` : 'Open · fish here from the Fishing panel.';
            }
            return card(id, def.name, text, status, buttons);
          });
        farm.replaceChildren(...expansionCards(FARM_EXPANSIONS));
        land.replaceChildren(
          ...PARCEL_IDS.map((id) => {
            const def = hooks.data.parcels[id];
            const status = parcelStatus(state, hooks.data, id);
            const buttons: HTMLElement[] = [];
            let text = `${def.description} ${def.opens}.`;
            if (status === 'available') {
              const button = h('button', {
                type: 'button',
                class: 'btn btn-small btn-primary',
                text: `Buy · ${def.price.toLocaleString('en-US')}g`,
                'aria-label': `Buy ${def.name} for ${def.price} gold`,
                disabled: state.gold < def.price,
              });
              button.addEventListener('click', () => {
                say(hooks.buyParcel(id), `${def.name} is yours!`, id);
                render();
              });
              buttons.push(button);
            } else if (status === 'locked') {
              text = `${def.price.toLocaleString('en-US')}g · ${def.opens}. ${unlockHints(state, hooks.data, def.requires).join(' ')}`;
            } else {
              text = `Yours · ${def.opens}.`;
            }
            return card(id, def.name, text, status, buttons);
          }),
        );
        waters.replaceChildren(...expansionCards(FISHING_EXPANSIONS));

        for (const { sec, list } of sections) {
          list.replaceChildren(
            ...sec.ids.flatMap((id) => {
              const def = hooks.data.upgrades[id];
              if (!def) return [];
              const level = upgradeLevel(state, id);
              const maxed = level >= def.max;
              const needs = requirementsFor(def, level);
              const blocked = maxed ? null : purchaseBlock(state, hooks.data, id);
              const hints = maxed
                ? []
                : [...unlockHints(state, hooks.data, needs), ...(blocked ? [blocked] : [])];
              const unlocked = hints.length === 0;
              const cost = maxed ? 0 : upgradeCost(def, level);
              const placeable = def.kind === 'placeable';
              const onField = id === 'sprinkler' || id === 'scarecrow'; // traps are set out at the water for you
              const title = placeable
                ? `${def.name} · ${level}/${def.max} bought`
                : `${def.name} · level ${level}/${def.max}`;
              let text = def.description;
              text += ` Now: ${def.effectText[level] ?? ''}`;
              if (!maxed && !placeable) text += ` → next: ${def.effectText[level + 1] ?? ''}.`;
              if (placeable && onField)
                text += ` (${placedCount(state, id as PlacedKind)} placed, ${stockOf(state, id as PlacedKind)} in stock)`;
              else if (placeable)
                text += ' It is set out at the water for you; collect from the Fishing panel or the scene.';
              if (!maxed && !unlocked) text += ` 🔒 ${hints.join(' ')}`;
              const buttons: HTMLElement[] = [];
              if (!maxed && unlocked) {
                const button = h('button', {
                  type: 'button',
                  class: 'btn btn-small btn-primary',
                  text: `${placeable ? 'Buy' : 'Upgrade'} · ${cost.toLocaleString('en-US')}g`,
                  'aria-label': `${placeable ? 'Buy' : 'Upgrade'} ${def.name} for ${cost} gold`,
                  'data-role': 'buy',
                  disabled: state.gold < cost,
                });
                button.addEventListener('click', () => {
                  const next = def.effectText[level + 1] ?? '';
                  say(hooks.buyUpgrade(id), `${def.name}: ${next}.`, id);
                  render();
                });
                buttons.push(button);
              }
              if (
                placeable &&
                onField &&
                (placedCount(state, id as PlacedKind) > 0 || stockOf(state, id as PlacedKind) > 0)
              ) {
                const place = h('button', {
                  type: 'button',
                  class: 'btn btn-small',
                  text: stockOf(state, id as PlacedKind) > 0 ? 'Place' : 'Move / pick up',
                  'data-role': 'place',
                });
                place.addEventListener('click', () => hooks.place(id as PlacedKind));
                buttons.push(place);
              }
              const extra =
                id === 'auto_seller' && level > 0
                  ? sellerToggles()
                  : id === 'seed_order' && level > 0
                    ? orderControls()
                    : undefined;
              const state2 = maxed ? 'owned' : unlocked ? 'available' : 'locked';
              return [card(id, title, text, state2, buttons, CARD_ICON[id], extra)];
            }),
          );
        }
        flash = null;
        if (focusedKey) {
          const sel = focusedRole ? `[data-role="${focusedRole}"]` : 'button:not([disabled])';
          (
            body.querySelector<HTMLElement>(`[data-upgrade="${focusedKey}"] ${sel}`) ??
            body.querySelector<HTMLElement>(`[data-upgrade="${focusedKey}"] button:not([disabled])`)
          )?.focus();
        }
      };

      /** The Seed Order's gold reserve and its per-crop opt-outs (v2-06). */
      const orderControls = (): HTMLElement => {
        const state = hooks.state();
        const select = h('select', { 'data-role': 'order-reserve', id: 'order-reserve' });
        for (const pct of SEED_ORDER_RESERVES)
          select.append(
            h('option', {
              value: String(pct),
              text: pct === 0 ? 'None' : `${pct}% of my gold`,
            }),
          );
        select.value = String(state.seedOrder.reservePct);
        select.addEventListener('change', () => {
          hooks.setSeedOrderReserve(Number(select.value));
          render();
        });
        const toggles = CROP_IDS.map((crop) => {
          const box = h('input', { type: 'checkbox', 'data-role': `order-${crop}` });
          box.checked = !state.seedOrder.off.includes(crop);
          box.addEventListener('change', () => {
            hooks.setSeedOrderCrop(crop, box.checked);
            render();
          });
          return h(
            'label',
            { class: 'seller-toggle', title: `${hooks.data.crops[crop].name} seeds` },
            box,
            h('img', {
              class: 'pixel',
              alt: `${hooks.data.crops[crop].name} seeds`,
              width: 16,
              height: 16,
              src: spriteDataUrl(`item_seed_${crop}`),
            }),
          );
        });
        return h(
          'div',
          { class: 'seed-order-controls' },
          h(
            'label',
            { class: 'field', for: 'order-reserve' },
            'Keep a reserve of ',
            select,
            ' (the order never spends below it)',
          ),
          h('div', { class: 'seller-toggles', role: 'group', 'aria-label': 'Seeds to order' }, ...toggles),
        );
      };

      /** Per-crop "ship it automatically" toggles under the Auto-Seller card. */
      const sellerToggles = (): HTMLElement => {
        const state = hooks.state();
        return h(
          'div',
          { class: 'seller-toggles', role: 'group', 'aria-label': 'Ship automatically' },
          ...(
            [...CROP_IDS, ...FRUIT_IDS, ...ANIMAL_PRODUCT_IDS, 'honey', ...DRINK_IDS] as readonly ItemId[]
          ).map((crop) => {
            const on = autoSellOn(state, hooks.data, crop);
            const box = h('input', { type: 'checkbox', 'data-role': `sell-${crop}` });
            box.checked = on;
            box.addEventListener('change', () => {
              hooks.setAutoSell(crop, box.checked);
              render();
            });
            return h(
              'label',
              { class: 'seller-toggle', title: hooks.data.items[crop]?.name ?? crop },
              box,
              h('img', {
                class: 'pixel',
                alt: hooks.data.items[crop]?.name ?? crop,
                width: 16,
                height: 16,
                src: spriteDataUrl(`item_${crop}`),
              }),
            );
          }),
        );
      };

      return { refresh: render };
    },
  };
}
