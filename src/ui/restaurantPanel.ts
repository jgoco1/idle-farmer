// The Restaurant panel (GDD §13.4): build and upgrade The Bramble Table, put dishes from the bag on its tables,
// top them up or clear them, and see what each table serves next, today's takings and this week's specials.
// Rules live in src/systems/restaurant.ts; this only reads state and sends actions.

import type { Action } from '../core/actions';
import type { MenuSlot } from '../core/state';
import { formatDuration, weekdayOfDay } from '../core/time';
import { MENU_FILL_AMOUNTS, MENU_SLOT_CAP, SERVE_MIN_PER_TIER } from '../data/balance';
import type { ItemId } from '../data/ids';
import { spriteDataUrl } from '../render/spriteCache';
import type { ActionResult } from '../systems/context';
import {
  isMenuable,
  menuTier,
  msToNextServing,
  restaurantBlock,
  restaurantLevel,
  servingPrice,
  specialOn,
  todaysSpecial,
} from '../systems/restaurant';
import { h } from './dom';
import type { GameViewHooks } from './panels';
import type { PanelDef } from './panel';

export interface RestaurantHooks extends GameViewHooks {
  dispatch(action: Action): ActionResult;
}

const num = (n: number): string => n.toLocaleString('en-US');
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** A dish stack in the bag, plain and hearty counted apart. */
interface BagDish {
  item: ItemId;
  hearty: boolean;
  qty: number;
}

/** Where "Fill from bag" puts a dish: the table already serving it with room, else the first free table. */
export function fillTarget(menu: readonly MenuSlot[], item: ItemId, hearty: boolean): number {
  const same = menu.findIndex((s) => s.item === item && s.hearty === hearty && s.qty < MENU_SLOT_CAP);
  if (same >= 0) return same;
  return menu.findIndex((s) => s.qty === 0);
}

export function restaurantPanel(hooks: RestaurantHooks): PanelDef {
  return {
    id: 'restaurant',
    wide: true,
    title: 'Restaurant',
    icon: '🍽',
    live: true,
    refreshMs: 1000,
    build(body) {
      const root = h('div', { class: 'restaurant', 'data-testid': 'restaurant' });
      body.append(root);
      const msg = h('p', { class: 'form-msg', role: 'status' });
      let said: { text: string; ok: boolean } | null = null;

      const act = (action: Action, ok: string): void => {
        const r = hooks.dispatch(action);
        said = { text: r.ok ? ok : r.reason, ok: r.ok };
        render();
      };

      const button = (
        text: string,
        attrs: Record<string, string>,
        enabled: boolean,
        onClick: () => void,
        primary = false,
      ): HTMLButtonElement => {
        const b = h('button', {
          type: 'button',
          class: `btn btn-small${primary ? ' btn-primary' : ''}`,
          text,
          disabled: !enabled,
          ...attrs,
        });
        b.addEventListener('click', onClick);
        return b;
      };

      const itemName = (item: ItemId, hearty: boolean): string => {
        const name = hooks.data.items[item]?.name ?? item;
        return hearty ? `Hearty ${name.toLowerCase()}` : name;
      };

      /** Before it is built: what it is, its price and what it still needs. */
      const buildCard = (): HTMLElement => {
        const state = hooks.state();
        const def = hooks.data.restaurant;
        const first = def.levels[0];
        const block = restaurantBlock(state, hooks.data);
        return h(
          'div',
          { class: `crate-row restaurant-card${block ? ' is-locked' : ''}`, 'data-restaurant-build': '' },
          h('img', {
            class: 'pixel restaurant-icon',
            alt: '',
            src: spriteDataUrl(def.sprites.building[0], 1),
          }),
          h(
            'div',
            { class: 'crate-text' },
            h('span', { text: `${def.name} · ${num(first.price)}g` }),
            h('span', {
              class: 'seed-note',
              text: `A little inn on the north road. Guests buy the dishes and drinks you put on its ${first.slots} tables for ${first.premium.toFixed(2)}× their price, one every ${SERVE_MIN_PER_TIER} minutes × the dish's tier, even while you are away. Nothing on the menu ever spoils.`,
            }),
            block ? h('span', { class: 'seed-note', text: `Locked. ${block}` }) : null,
          ),
          h(
            'div',
            { class: 'btn-row' },
            button(
              `Build · ${num(first.price)}g`,
              { 'data-build-restaurant': '' },
              !block && state.gold >= first.price,
              () => act({ type: 'buildRestaurant' }, `${def.name} is open! Put some dishes on the menu.`),
              true,
            ),
          ),
        );
      };

      /** The level, today's takings and the next level's upgrade. */
      const header = (): HTMLElement => {
        const state = hooks.state();
        const def = hooks.data.restaurant;
        const r = state.restaurant;
        const lvl = restaurantLevel(state, hooks.data)!;
        const next = def.levels[r.level];
        const block = restaurantBlock(state, hooks.data);
        return h(
          'div',
          { class: 'crate-row restaurant-card', 'data-restaurant-level': String(r.level) },
          h('img', {
            class: 'pixel restaurant-icon',
            alt: '',
            src: spriteDataUrl(def.sprites.building[r.level - 1]!, 1),
          }),
          h(
            'div',
            { class: 'crate-text' },
            h('span', { text: `${def.name} · level ${r.level} of ${def.levels.length}` }),
            h('span', {
              class: 'seed-note',
              text: `${lvl.slots} tables · guests pay ${lvl.premium.toFixed(2)}× a dish's price (the day's special a little more)`,
            }),
            h('span', {
              class: 'seed-note restaurant-today',
              'data-restaurant-today': '',
              text: `Today: ${num(r.today.served)} served for ${num(r.today.gold)}g`,
            }),
          ),
          next
            ? h(
                'div',
                { class: 'btn-row' },
                button(
                  `Upgrade · ${num(next.price)}g`,
                  {
                    'data-upgrade-restaurant': '',
                    title: block ?? `${next.slots} tables, ${next.premium.toFixed(2)}× a dish's price`,
                  },
                  !block && state.gold >= next.price,
                  () => act({ type: 'upgradeRestaurant' }, `${def.name} is now level ${r.level + 1}.`),
                ),
              )
            : null,
        );
      };

      /** The next seven days' specials, from the calendar (a rota, not a draw). */
      const specials = (): HTMLElement => {
        const state = hooks.state();
        const cal = hooks.calendar();
        const list = h('ul', { class: 'restaurant-specials', 'data-testid': 'restaurant-specials' });
        for (let d = cal.dayIndex; d < cal.dayIndex + 7; d++) {
          const id = specialOn(hooks.data, cal, d);
          const known = state.kitchen.known.includes(id);
          list.append(
            h('li', {
              class: `${d === cal.dayIndex ? 'is-today' : ''}${known ? '' : ' is-unknown'}`.trim(),
              text: `${d === cal.dayIndex ? 'Today' : DAYS[weekdayOfDay(cal.dayZero + d)]} ${hooks.data.recipes[id].name}${known ? '' : ' (not known yet)'}`,
            }),
          );
        }
        return h(
          'div',
          { class: 'restaurant-week' },
          h('h3', { text: "Chef's specials" }),
          h('p', { class: 'seed-note', text: 'The special earns a little extra on the menu that day.' }),
          list,
        );
      };

      const tableCard = (slot: MenuSlot, i: number): HTMLElement => {
        const state = hooks.state();
        const sprites = hooks.data.restaurant.sprites;
        const special = todaysSpecial(state, hooks.data, hooks.calendar());
        const serving = slot.item !== null && slot.qty > 0;
        const lines: (HTMLElement | null)[] = [];
        if (slot.item === null) {
          lines.push(h('span', { text: `Table ${i + 1} · free` }));
          lines.push(
            h('span', { class: 'seed-note', text: 'Put a dish or a drink on it from your bag below.' }),
          );
        } else {
          const name = itemName(slot.item, slot.hearty);
          const price = servingPrice(state, hooks.data, slot.item, special);
          lines.push(
            h('span', {
              text: `Table ${i + 1} · ${name} ×${slot.qty}${slot.item === special ? ' · today’s special' : ''}`,
            }),
          );
          lines.push(
            h('span', {
              class: 'seed-note restaurant-status',
              'data-table-status': String(i),
              text: serving
                ? `Next serving in ${formatDuration(msToNextServing(hooks.data, slot))} · ${num(price)}g each`
                : `Out of ${name.toLowerCase()}. Restock it, or put another dish on.`,
            }),
          );
        }
        return h(
          'div',
          { class: 'crate-row restaurant-table', 'data-table': String(i) },
          h('img', {
            class: 'pixel',
            alt: '',
            width: 32,
            height: 32,
            src: spriteDataUrl(slot.item ? `item_${slot.item}` : serving ? sprites.tableDish : sprites.table),
          }),
          h('div', { class: 'crate-text' }, ...lines),
          slot.item !== null
            ? h(
                'div',
                { class: 'btn-row' },
                button('Clear', { 'data-clear-table': String(i) }, true, () =>
                  act(
                    { type: 'clearMenuSlot', slot: i },
                    `Table ${i + 1} is cleared; the dishes are back in your bag.`,
                  ),
                ),
              )
            : null,
        );
      };

      /** Dishes in the bag, with buttons to put some on a table. */
      const fromBag = (): HTMLElement => {
        const state = hooks.state();
        const menu = state.restaurant.menu;
        const special = todaysSpecial(state, hooks.data, hooks.calendar());
        const dishes: BagDish[] = [];
        for (const s of state.inventory.slots) {
          if (!s || !isMenuable(hooks.data, s.item)) continue;
          const hearty = s.hearty === true;
          const e = dishes.find((d) => d.item === s.item && d.hearty === hearty);
          if (e) e.qty += s.qty;
          else dishes.push({ item: s.item, hearty, qty: s.qty });
        }
        dishes.sort(
          (a, b) =>
            servingPrice(state, hooks.data, b.item, special) -
            servingPrice(state, hooks.data, a.item, special),
        );
        const box = h(
          'div',
          { class: 'restaurant-bag', 'data-testid': 'restaurant-bag' },
          h('h3', { text: 'Fill from bag' }),
        );
        if (dishes.length === 0) {
          box.append(
            h('p', {
              class: 'muted',
              text: 'No dishes or drinks in your bag. Cook something in the Kitchen, or press a drink.',
            }),
          );
          return box;
        }
        for (const d of dishes) {
          const target = fillTarget(menu, d.item, d.hearty);
          const room =
            target >= 0
              ? MENU_SLOT_CAP -
                (menu[target]!.item === d.item && menu[target]!.hearty === d.hearty ? menu[target]!.qty : 0)
              : 0;
          const tier = menuTier(hooks.data, d.item);
          const price = servingPrice(state, hooks.data, d.item, special);
          const buttons = MENU_FILL_AMOUNTS.map((n) => {
            const qty = n === Infinity ? Math.min(d.qty, room) : n;
            return button(
              n === Infinity ? (qty > 0 ? `All (${qty})` : 'All') : `×${n}`,
              {
                'data-fill': `${d.item}${d.hearty ? ':hearty' : ''}:${n === Infinity ? 'all' : n}`,
                title: target < 0 ? 'Every table is busy. Clear one first.' : `Onto table ${target + 1}`,
              },
              target >= 0 && qty > 0 && qty <= d.qty && qty <= room,
              () =>
                act(
                  { type: 'stockMenu', slot: target, item: d.item, qty, hearty: d.hearty },
                  `${qty} ${itemName(d.item, d.hearty).toLowerCase()} on table ${target + 1}.`,
                ),
            );
          });
          box.append(
            h(
              'div',
              { class: 'crate-row', 'data-bag-dish': `${d.item}${d.hearty ? ':hearty' : ''}` },
              h('img', {
                class: 'pixel',
                alt: '',
                width: 32,
                height: 32,
                src: spriteDataUrl(`item_${d.item}`),
              }),
              h(
                'div',
                { class: 'crate-text' },
                h('span', { text: `${itemName(d.item, d.hearty)} ×${d.qty}` }),
                h('span', {
                  class: 'seed-note',
                  text: `T${tier} · ${num(price)}g a serving, one every ${SERVE_MIN_PER_TIER * tier} minutes`,
                }),
              ),
              h('div', { class: 'btn-row' }, ...buttons),
            ),
          );
        }
        return box;
      };

      function render(): void {
        const state = hooks.state();
        root.replaceChildren();
        root.append(h('p', { class: 'shop-gold', text: `You have ${num(state.gold)}g` }));
        if (state.restaurant.level <= 0) {
          root.append(buildCard());
        } else {
          const menu = state.restaurant.menu;
          const canRestock = menu.some(
            (s) =>
              s.item !== null &&
              s.qty < MENU_SLOT_CAP &&
              state.inventory.slots.some((b) => b?.item === s.item && Boolean(b.hearty) === s.hearty),
          );
          root.append(
            header(),
            h(
              'div',
              { class: 'restaurant-menu-head' },
              h('h3', { text: 'Menu' }),
              button('Restock all', { 'data-restock': '' }, canRestock, () =>
                act({ type: 'restockMenu' }, 'Every table is topped up from your bag.'),
              ),
            ),
            ...menu.map(tableCard),
            fromBag(),
            specials(),
          );
        }
        msg.textContent = said?.text ?? '';
        msg.className = said ? (said.ok ? 'form-msg form-ok' : 'form-msg form-error') : 'form-msg';
        root.append(msg);
      }

      return {
        refresh() {
          render();
        },
      };
    },
  };
}
