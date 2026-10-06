// The Press House panel (GDD §13.5–13.6): build and upgrade the Press House, start drinks in its presses
// (Make ×N into free presses), keep a press pressing, take a run off, collect finished drinks, buy drink
// cards and cocoa from the shelf, and the Apiary card: buy hives and collect their honey. The drink book
// uses the Kitchen's sort menu and favourites (the same `prefs.kitchenSort` and `kitchenFavourites`).
// Rules live in src/systems/press.ts and apiary.ts; this only reads state and sends actions.

import type { Action } from '../core/actions';
import { KITCHEN_SORTS, type KitchenSort } from '../core/prefs';
import type { PressSlot } from '../core/state';
import { formatDuration } from '../core/time';
import { COCOA_AMOUNTS, PRESS_SLOT_STORE } from '../data/balance';
import type { RecipeId } from '../data/ids';
import type { RecipeDef } from '../data/types';
import { spriteDataUrl } from '../render/spriteCache';
import {
  hiveBlock,
  hiveCycleMs,
  hiveSpotCount,
  honeyWaiting,
  msToNextJar,
  nextHivePrice,
} from '../systems/apiary';
import { buffDurationMs, buffMagnitude } from '../systems/buffs';
import type { ActionResult } from '../systems/context';
import { canCook, ingredientStatus } from '../systems/cooking';
import { countItem } from '../systems/inventory';
import {
  drinkCards,
  drinksWaiting,
  knownDrinks,
  maxPressBatch,
  pressBlock,
  pressLevel,
  pressMs,
  pressSlotFor,
} from '../systems/press';
import { buffEffectText, formatCountdown } from './buffBar';
import { h } from './dom';
import type { PanelDef } from './panel';
import type { GameViewHooks } from './panels';
import { KITCHEN_SORT_LABELS, pinFavourites, sortRecipes, toggleFavourite } from './recipeSort';

export interface PressHooks extends GameViewHooks {
  dispatch(action: Action): ActionResult;
  /** The drink book's order: the Kitchen's pref (defaults to "can make now" without it). */
  sort?: { get(): KitchenSort; set(mode: KitchenSort): void };
  /** Pinned recipes, shared with the Kitchen's recipe book. */
  favourites?: { get(): readonly RecipeId[]; set(list: RecipeId[]): void };
}

const num = (n: number): string => n.toLocaleString('en-US');

function icon(sprite: string, size = 32, cls = 'pixel'): HTMLElement {
  return h('img', { class: cls, alt: '', width: size, height: size, src: spriteDataUrl(sprite) });
}

export function pressPanel(hooks: PressHooks): PanelDef {
  return {
    id: 'press',
    wide: true,
    title: 'Press House',
    icon: '🍹',
    live: true,
    refreshMs: 1000,
    build(body) {
      const root = h('div', { class: 'press', 'data-testid': 'press' });
      const top = h('div');
      const presses = h('div', { class: 'press-slots', 'data-testid': 'press-slots' });
      const sortSelect = h('select', { id: 'press-sort', 'data-testid': 'press-sort' });
      for (const mode of KITCHEN_SORTS)
        sortSelect.append(h('option', { value: mode, text: KITCHEN_SORT_LABELS[mode] }));
      sortSelect.value = hooks.sort?.get() ?? 'ready';
      sortSelect.addEventListener('change', () => {
        hooks.sort?.set(sortSelect.value as KitchenSort);
        render(true);
      });
      const bookHead = h(
        'div',
        { class: 'kitchen-book-head' },
        h('h3', { text: 'Drinks' }),
        h('label', { class: 'field', for: 'press-sort' }, 'Sort by ', sortSelect),
      );
      const book = h('div', { class: 'crate-list', 'data-testid': 'drink-book' });
      const rest = h('div');
      const msg = h('p', { class: 'form-msg', role: 'status' });
      const built = h('div', {}, presses, bookHead, book);
      root.append(top, built, rest, msg);
      body.append(root);
      /** How many of each drink the Make ×N stepper is set to (UI state, not saved). */
      const batch = new Map<RecipeId, number>();
      let said: { text: string; ok: boolean } | null = null;
      let topSig = '';
      let slotSig = '';
      let bookSig = '';
      let restSig = '';

      const say = (text: string, ok: boolean): void => {
        said = { text, ok };
      };

      const act = (action: Action, ok: string): boolean => {
        const r = hooks.dispatch(action);
        say(r.ok ? ok : r.reason, r.ok);
        render(true);
        return r.ok;
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

      /** Before it is built: what it is, its price and what it still needs. */
      const buildCard = (): HTMLElement => {
        const state = hooks.state();
        const def = hooks.data.press;
        const first = def.levels[0];
        const block = pressBlock(state, hooks.data);
        return h(
          'div',
          { class: `crate-row press-card${block ? ' is-locked' : ''}`, 'data-press-build': '' },
          h('img', { class: 'pixel press-icon', alt: '', src: spriteDataUrl(def.sprites.building[0], 1) }),
          h(
            'div',
            { class: 'crate-text' },
            h('span', { text: `${def.name} · ${num(first.price)}g` }),
            h('span', {
              class: 'seed-note',
              text: `A stone press house on the north road. Its ${first.slots} presses turn fruit, milk and honey into juices, cordials, sweet cider, teas and cocoa over twenty minutes to three hours, even while you are away. Nothing in a press ever spoils. Comes with Tomato Juice and Honey Milk, and opens the apiary.`,
            }),
            block ? h('span', { class: 'seed-note', text: `Locked. ${block}` }) : null,
          ),
          h(
            'div',
            { class: 'btn-row' },
            button(
              `Build · ${num(first.price)}g`,
              { 'data-build-press': '' },
              !block && state.gold >= first.price,
              () => act({ type: 'buildPress' }, `The ${def.name} is built! Start a drink in a press.`),
              true,
            ),
          ),
        );
      };

      /** The level and the next level's upgrade. */
      const header = (): HTMLElement => {
        const state = hooks.state();
        const def = hooks.data.press;
        const level = state.press.level;
        const lvl = pressLevel(state, hooks.data)!;
        const next = def.levels[level];
        const block = pressBlock(state, hooks.data);
        return h(
          'div',
          { class: 'crate-row press-card', 'data-press-level': String(level) },
          h('img', {
            class: 'pixel press-icon',
            alt: '',
            src: spriteDataUrl(def.sprites.building[level - 1]!, 1),
          }),
          h(
            'div',
            { class: 'crate-text' },
            h('span', { text: `${def.name} · level ${level} of ${def.levels.length}` }),
            h('span', {
              class: 'seed-note',
              text: `${lvl.slots} presses · drinks keep in their press until collected; the Collecting Basket brings them in at each bin pickup`,
            }),
          ),
          next
            ? h(
                'div',
                { class: 'btn-row' },
                button(
                  `Upgrade · ${num(next.price)}g`,
                  { 'data-upgrade-press': '', title: block ?? `${next.slots} presses` },
                  !block && state.gold >= next.price,
                  () => act({ type: 'upgradePress' }, `The ${def.name} is now level ${level + 1}.`),
                ),
              )
            : null,
        );
      };

      const slotRow = (slot: PressSlot, i: number): HTMLElement => {
        const lines: (HTMLElement | null)[] = [];
        const buttons: HTMLElement[] = [];
        if (slot.recipe === null) {
          lines.push(h('span', { text: `Press ${i + 1} · free` }));
          lines.push(h('span', { class: 'seed-note', text: 'Pick a drink below.' }));
        } else {
          const r = hooks.data.recipes[slot.recipe];
          const pressing = slot.remainingMs > 0;
          const head = `Press ${i + 1} · ${r.name}${slot.done > 0 ? ` · ${slot.done} ready` : ''}`;
          lines.push(h('span', { text: head }));
          lines.push(
            h('span', {
              class: 'seed-note',
              'data-press-status': String(i),
              text: pressing
                ? `${formatCountdown(slot.remainingMs)} left`
                : slot.done >= PRESS_SLOT_STORE
                  ? 'Full. Collect the drinks to keep pressing.'
                  : slot.repeat
                    ? 'Resting: the bag is out of ingredients.'
                    : 'Done.',
            }),
          );
          if (pressing) {
            const fill = 1 - slot.remainingMs / pressMs(r);
            lines.push(
              h(
                'div',
                { class: 'meter' },
                h('div', { class: 'meter-fill', style: `width:${Math.round(fill * 100)}%` }),
              ),
            );
          }
          const keep = h('input', { type: 'checkbox', 'data-press-repeat': String(i) });
          keep.checked = slot.repeat;
          keep.addEventListener('change', () =>
            act(
              { type: 'setPressRepeat', slot: i, repeat: keep.checked },
              keep.checked
                ? `Press ${i + 1} will keep pressing ${r.name} while the bag has the ingredients.`
                : `Press ${i + 1} will stop after this run.`,
            ),
          );
          buttons.push(
            h(
              'label',
              { class: 'press-keep', title: 'Start the same drink again when it finishes' },
              keep,
              'Keep pressing',
            ),
          );
          if (pressing)
            buttons.push(
              button(
                'Take off',
                {
                  'data-cancel-press': String(i),
                  'aria-label': `Take ${r.name} off press ${i + 1} and get the ingredients back`,
                },
                true,
                () => act({ type: 'cancelPress', slot: i }, `${r.name} taken off. Ingredients returned.`),
              ),
            );
          if (slot.done > 0)
            buttons.push(
              button(
                `Collect ${slot.done}`,
                { 'data-collect-press': String(i) },
                true,
                () => act({ type: 'collectPress', slot: i }, `${slot.done} ${r.name} into your bag.`),
                true,
              ),
            );
          else if (!pressing)
            buttons.push(
              button('Press again', { 'data-press-again': String(i) }, canCook(hooks.state(), r), () =>
                act({ type: 'startPress', slot: i, recipe: r.id }, `${r.name} is in press ${i + 1}.`),
              ),
            );
        }
        return h(
          'div',
          { class: 'stove-slot press-slot', 'data-press-slot': String(i) },
          icon(
            slot.recipe === null
              ? 'obj_press_idle'
              : slot.done > 0
                ? `item_${slot.recipe}`
                : slot.remainingMs > 0
                  ? `item_${slot.recipe}`
                  : 'obj_press_idle',
            32,
          ),
          h('div', { class: 'crate-text' }, ...lines),
          h('div', { class: 'btn-row' }, ...buttons),
        );
      };

      const drinkRow = (r: RecipeDef): HTMLElement => {
        const state = hooks.state();
        const mods = hooks.mods();
        const buff = hooks.data.buffs[r.buff];
        const mag = buffMagnitude(hooks.data, r.buff, r.tier);
        const dur = buffDurationMs(r.tier, false, mods.buffDurationBonus);
        const can = canCook(state, r);
        const most = maxPressBatch(state, r);
        const n = Math.min(Math.max(1, batch.get(r.id) ?? 1), Math.max(1, most));
        const make = h('button', {
          type: 'button',
          class: 'btn btn-small',
          'data-press': r.id,
          text: n > 1 ? `Press ×${n}` : 'Press',
          disabled: !can || most <= 0,
          'aria-label': n > 1 ? `Press ${n} ${r.name}` : `Press ${r.name}`,
        });
        make.addEventListener('click', () => {
          let done = 0;
          let why = '';
          for (let k = 0; k < n; k++) {
            const slot = pressSlotFor(hooks.state(), r.id);
            const res =
              slot < 0
                ? { ok: false as const, reason: 'Every press is busy.' }
                : hooks.dispatch({ type: 'startPress', slot, recipe: r.id });
            if (!res.ok) {
              why = res.reason;
              break;
            }
            done++;
          }
          say(
            done === 0
              ? why
              : done === 1
                ? `${r.name} is in the press.`
                : `${done} × ${r.name} are in the presses.`,
            done > 0,
          );
          render(true);
        });
        const step = (by: number): void => {
          batch.set(r.id, Math.min(Math.max(1, n + by), Math.max(1, most)));
          render(true);
          book
            .querySelector<HTMLElement>(`[data-drink="${r.id}"] [data-role="${by > 0 ? 'more' : 'less'}"]`)
            ?.focus();
        };
        const less = h('button', {
          type: 'button',
          class: 'btn btn-small step-btn',
          'data-role': 'less',
          text: '−',
          'aria-label': `Press one fewer ${r.name}`,
          disabled: n <= 1,
        });
        const more = h('button', {
          type: 'button',
          class: 'btn btn-small step-btn',
          'data-role': 'more',
          text: '+',
          'aria-label': `Press one more ${r.name}`,
          disabled: n >= most,
        });
        less.addEventListener('click', () => step(-1));
        more.addEventListener('click', () => step(1));
        const pinned = hooks.favourites?.get().includes(r.id) ?? false;
        const pin = hooks.favourites
          ? h('button', {
              type: 'button',
              class: `fav-btn${pinned ? ' is-fav' : ''}`,
              'data-fav': r.id,
              'aria-pressed': String(pinned),
              'aria-label': pinned ? `Unpin ${r.name}` : `Pin ${r.name} to the top`,
              title: pinned ? 'Unpin' : 'Pin to the top of the book',
              text: pinned ? '★' : '☆',
            })
          : null;
        pin?.addEventListener('click', () => {
          hooks.favourites?.set(toggleFavourite(hooks.favourites.get(), r.id));
          render(true);
          book.querySelector<HTMLElement>(`[data-fav="${r.id}"]`)?.focus();
        });
        const ingredients = h(
          'div',
          { class: 'ingredients' },
          ...ingredientStatus(state, r).map((i) => {
            const def = hooks.data.items[i.item]!;
            return h(
              'span',
              { class: `ingredient${i.have >= i.need ? ' is-have' : ' is-missing'}`, title: def.name },
              icon(def.sprite, 24),
              h('span', { text: `${i.have}/${i.need}` }),
            );
          }),
        );
        const fresh = r.fresh && r.fresh.length < 4 ? ` · fresh in ${r.fresh.join(' and ')}` : '';
        return h(
          'div',
          { class: `recipe-row${can ? ' can-cook' : ''}`, 'data-drink': r.id },
          icon(`item_${r.id}`),
          h(
            'div',
            { class: 'crate-text' },
            h(
              'span',
              { text: `${r.name} ` },
              h('span', { class: `tier tier-${r.tier}`, text: `T${r.tier}` }),
              pin,
            ),
            h(
              'span',
              { class: 'seed-note' },
              `${buff.name}: ${buffEffectText(buff, mag).replace(/\.$/, '')}, ${formatDuration(dur)}`,
            ),
            h(
              'span',
              { class: 'seed-note' },
              `${formatDuration(pressMs(r))} to press · sells ${num(r.basePrice)}g${fresh}`,
            ),
            ingredients,
          ),
          h(
            'div',
            { class: 'cook-controls' },
            h(
              'div',
              { class: 'cook-stepper', role: 'group', 'aria-label': `How many ${r.name} to press` },
              less,
              h('span', { class: 'step-n', text: String(n), 'aria-live': 'polite' }),
              more,
            ),
            make,
          ),
        );
      };

      /** Drink cards on sale here, the cocoa shelf and the apiary. */
      const extras = (): HTMLElement[] => {
        const state = hooks.state();
        const out: HTMLElement[] = [];
        const cards = drinkCards(state, hooks.data);
        if (cards.length > 0) {
          out.push(h('h3', { text: 'Drink cards' }));
          for (const c of cards) {
            const r = hooks.data.recipes[c.id];
            out.push(
              h(
                'div',
                { class: `crate-row${c.unlocked ? '' : ' is-locked'}`, 'data-drink-card': c.id },
                icon(`item_${c.id}`),
                h(
                  'div',
                  { class: 'crate-text' },
                  h('span', { text: `${r.name} · T${r.tier} · ${num(c.price)}g` }),
                  h('span', { class: 'seed-note', text: c.hint ? `Locked. ${c.hint}` : r.description }),
                ),
                h(
                  'div',
                  { class: 'btn-row' },
                  button(
                    `Buy · ${num(c.price)}g`,
                    { 'data-buy-card': c.id },
                    c.unlocked && state.gold >= c.price,
                    () => act({ type: 'buyRecipe', recipe: c.id }, `You learned ${r.name}!`),
                  ),
                ),
              ),
            );
          }
        }
        // The shelf: cocoa beans, so the winter drink never waits on a season.
        const cocoa = hooks.data.press.shelf.cocoa;
        out.push(
          h('h3', { text: 'The shelf' }),
          h(
            'div',
            { class: 'crate-row', 'data-shelf': 'cocoa' },
            icon('item_cocoa'),
            h(
              'div',
              { class: 'crate-text' },
              h('span', { text: `Cocoa Beans · ${cocoa}g each` }),
              h('span', {
                class: 'seed-note',
                text: `For Hot Cocoa in any season. You have ${countItem(state.inventory, 'cocoa')}.`,
              }),
            ),
            h(
              'div',
              { class: 'btn-row' },
              ...COCOA_AMOUNTS.map((n) =>
                button(
                  `×${n} · ${num(n * cocoa)}g`,
                  { 'data-buy-cocoa': String(n) },
                  state.gold >= n * cocoa,
                  () => act({ type: 'buyCocoa', qty: n }, `${n} cocoa beans into your bag.`),
                ),
              ),
            ),
          ),
        );
        out.push(apiary());
        return out;
      };

      /** The Apiary card: hives on their spots, honey waiting, the next hive's price. */
      const apiary = (): HTMLElement => {
        const state = hooks.state();
        const hives = state.apiary.hives;
        const price = nextHivePrice(state, hooks.data);
        const block = hiveBlock(state, hooks.data);
        const waiting = honeyWaiting(state);
        const speed = hooks.mods().animalSpeedModifier;
        const box = h('div', { class: 'press-apiary', 'data-testid': 'apiary' }, h('h3', { text: 'Apiary' }));
        box.append(
          h(
            'div',
            { class: 'crate-row' },
            icon('obj_hive', 32),
            h(
              'div',
              { class: 'crate-text' },
              h('span', {
                text: `${hives.length} of ${hiveSpotCount()} hives · ${waiting} jar${waiting === 1 ? '' : 's'} of honey waiting`,
              }),
              h('span', {
                class: 'seed-note',
                text: `Each hive makes a jar every ${formatDuration(hiveCycleMs(hooks.data, speed))} and holds ${hooks.data.hive.store}; a full hive simply waits. Hives need nothing at all.`,
              }),
            ),
            h(
              'div',
              { class: 'btn-row' },
              price !== null
                ? button(
                    `Buy a hive · ${num(price)}g`,
                    { 'data-buy-hive': '', title: block ?? 'It goes on the next free spot' },
                    !block && state.gold >= price,
                    () => act({ type: 'buyHive' }, 'A new hive by the road. The bees are moving in.'),
                    hives.length === 0,
                  )
                : null,
              button(
                waiting > 0 ? `Collect ${waiting}` : 'Collect',
                { 'data-collect-honey': '' },
                waiting > 0,
                () =>
                  act(
                    { type: 'collectHive' },
                    `${waiting} jar${waiting === 1 ? '' : 's'} of honey into your bag.`,
                  ),
              ),
            ),
          ),
        );
        for (const hv of hives) {
          const full = hv.honey >= hooks.data.hive.store;
          box.append(
            h(
              'div',
              { class: 'crate-row press-hive', 'data-hive': String(hv.id) },
              icon(full ? 'obj_hive_full' : 'item_honey', 32),
              h(
                'div',
                { class: 'crate-text' },
                h('span', { text: `Hive ${hv.spot + 1} · ${hv.honey}/${hooks.data.hive.store} jars` }),
                h('span', {
                  class: 'seed-note',
                  text: full
                    ? 'Full. Collect the honey and the bees carry on.'
                    : `Next jar in about ${formatDuration(Math.max(60_000, msToNextJar(hooks.data, hv, speed)))}`,
                }),
              ),
            ),
          );
        }
        return box;
      };

      function render(force: boolean): void {
        const state = hooks.state();
        const builtNow = state.press.level > 0;
        // The top: gold, then the build card or the level.
        const tSig = `${state.gold}|${state.press.level}|${pressBlock(state, hooks.data)}`;
        if (force || tSig !== topSig) {
          topSig = tSig;
          top.replaceChildren(
            h('p', { class: 'shop-gold', text: `You have ${num(state.gold)}g` }),
            builtNow ? header() : buildCard(),
          );
        }
        built.hidden = !builtNow;
        if (builtNow) {
          const sSig = state.press.slots
            .map((s) => `${s.recipe}:${Math.ceil(s.remainingMs / 1000)}:${s.done}:${s.repeat}`)
            .join('|');
          const waiting = drinksWaiting(state);
          if (force || sSig !== slotSig) {
            slotSig = sSig;
            presses.replaceChildren(
              h(
                'div',
                { class: 'restaurant-menu-head' },
                h('h3', { text: 'Presses' }),
                button(
                  waiting > 0 ? `Collect all (${waiting})` : 'Collect all',
                  { 'data-collect-all-presses': '' },
                  waiting > 0,
                  () =>
                    act(
                      { type: 'collectPress' },
                      `${waiting} drink${waiting === 1 ? '' : 's'} into your bag.`,
                    ),
                ),
              ),
              ...state.press.slots.map(slotRow),
            );
          }
          const mode = (KITCHEN_SORTS as readonly string[]).includes(sortSelect.value)
            ? (sortSelect.value as KitchenSort)
            : 'ready';
          const favourites = hooks.favourites?.get() ?? [];
          const known = pinFavourites(sortRecipes(knownDrinks(state), state, hooks.data, mode), favourites);
          const bSig = [
            mode,
            favourites.join(','),
            known.join(','),
            known.map((id) => batch.get(id) ?? 1).join('.'),
            sSig.replace(/:\d+:/g, ':'),
            ...known.map((id) =>
              hooks.data.recipes[id].ingredients.map((i) => countItem(state.inventory, i.item)).join('.'),
            ),
          ].join('|');
          if (force || bSig !== bookSig) {
            bookSig = bSig;
            book.replaceChildren(...known.map((id) => drinkRow(hooks.data.recipes[id])));
          }
          const rSig = `${state.gold}|${state.kitchen.known.length}|${countItem(state.inventory, 'cocoa')}|${state.apiary.hives
            .map(
              (hv) =>
                `${hv.honey}:${Math.ceil(msToNextJar(hooks.data, hv, hooks.mods().animalSpeedModifier) / 60_000)}`,
            )
            .join(',')}`;
          if (force || rSig !== restSig) {
            restSig = rSig;
            rest.replaceChildren(...extras());
          }
        } else {
          rest.replaceChildren();
          restSig = '';
        }
        msg.textContent = said?.text ?? '';
        msg.className = said ? (said.ok ? 'form-msg form-ok' : 'form-msg form-error') : 'form-msg';
      }

      return {
        refresh() {
          render(false);
        },
      };
    },
  };
}

/** The recipe ids the drink book shows (for tests): known drinks in the shared sort order. */
export function drinkBookOrder(
  hooks: Pick<PressHooks, 'data' | 'state'>,
  mode: KitchenSort,
  favourites: readonly RecipeId[],
): RecipeId[] {
  const state = hooks.state();
  return pinFavourites(sortRecipes(knownDrinks(state), state, hooks.data, mode), favourites);
}
