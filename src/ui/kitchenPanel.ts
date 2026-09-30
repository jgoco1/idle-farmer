// The Kitchen (GDD §6.5): the stove with its cook progress, the recipe book with have/need for each
// ingredient, and experiment mode. All rules live in src/systems/cooking.ts and buffs.ts; this file
// renders them and sends actions through dispatch().

import { formatDuration } from '../core/time';
import { EXPERIMENT_MAX_ITEMS, EXPERIMENT_MIN_ITEMS } from '../data/balance';
import type { ItemId } from '../data/ids';
import type { RecipeDef } from '../data/types';
import { spriteDataUrl } from '../render/spriteCache';
import type { Action } from '../core/actions';
import type { ActionResult } from '../systems/context';
import { buffDurationMs, buffMagnitude } from '../systems/buffs';
import { canCook, cookMs, ingredientStatus, kitchenSlots, knownRecipes } from '../systems/cooking';
import { countItem } from '../systems/inventory';
import { buffEffectText, formatCountdown } from './buffBar';
import { h } from './dom';
import type { PanelDef } from './panel';
import type { GameViewHooks } from './panels';

export interface KitchenHooks extends GameViewHooks {
  dispatch(action: Action): ActionResult;
}

type Tab = 'cook' | 'experiment';

/** Icon plus name of an item, for ingredient chips. */
function chipIcon(sprite: string): HTMLElement {
  return h('img', { class: 'pixel', alt: '', width: 24, height: 24, src: spriteDataUrl(sprite) });
}

export function kitchenPanel(hooks: KitchenHooks): PanelDef {
  return {
    id: 'kitchen',
    title: 'Kitchen',
    icon: '🍲',
    live: true,
    refreshMs: 500,
    build(body) {
      let tab: Tab = 'cook';
      const picked = new Set<ItemId>();

      const tabs = h('div', { class: 'fish-tabs', role: 'tablist' });
      const tabButtons = new Map<Tab, HTMLButtonElement>();
      for (const [id, label] of [
        ['cook', 'Cook'],
        ['experiment', 'Experiment'],
      ] as const) {
        const b = h('button', { type: 'button', class: 'btn', role: 'tab', 'data-tab': id, text: label });
        b.addEventListener('click', () => {
          tab = id;
          sync();
          render(true);
        });
        tabButtons.set(id, b);
        tabs.append(b);
      }

      // ---- cook tab
      const stoveHead = h('h3', { class: 'kitchen-head' });
      const stove = h('div', { class: 'stove', 'data-testid': 'stove' });
      const speedNote = h('p', { class: 'muted' });
      const msg = h('p', { class: 'form-msg', role: 'status' });
      const bookHead = h('h3', { text: 'Recipe book' });
      const book = h('div', { class: 'crate-list', 'data-testid': 'recipe-book' });
      const more = h('p', { class: 'muted' });
      const cookTab = h('div', {}, stoveHead, stove, speedNote, msg, bookHead, book, more);

      // ---- experiment tab
      const exIntro = h('p', {
        class: 'muted',
        text: `Pick ${EXPERIMENT_MIN_ITEMS} to ${EXPERIMENT_MAX_ITEMS} ingredients to try together. If they make a dish you don't know, you learn it. If not, nothing is used up.`,
      });
      const exList = h('div', { class: 'ex-list', 'data-testid': 'experiment-items' });
      const exMsg = h('p', { class: 'form-msg', role: 'status', 'data-testid': 'experiment-msg' });
      const exGo = h('button', { type: 'button', class: 'btn btn-primary', 'data-testid': 'experiment-go' });
      const exTab = h('div', {}, exIntro, exList, h('div', { class: 'btn-row' }, exGo), exMsg);
      exGo.addEventListener('click', () => {
        const r = hooks.dispatch({ type: 'experiment', items: [...picked] });
        if (r.ok) {
          picked.clear();
          exMsg.textContent = 'You learned something new! Look in the Cook tab.';
          exMsg.className = 'form-msg form-ok';
        } else {
          exMsg.textContent = r.reason;
          exMsg.className = 'form-msg form-error';
        }
        render(true);
      });

      body.append(tabs, cookTab, exTab);

      const sync = (): void => {
        cookTab.hidden = tab !== 'cook';
        exTab.hidden = tab !== 'experiment';
        for (const [id, b] of tabButtons) {
          b.setAttribute('aria-selected', String(id === tab));
          b.classList.toggle('is-active', id === tab);
        }
      };

      // Rebuilt only when their signature changes, so focus and hover survive the timed refresh.
      let stoveSig = '';
      let bookSig = '';
      let exSig = '';

      const renderStove = (force: boolean): void => {
        const state = hooks.state();
        const mods = hooks.mods();
        const slots = kitchenSlots(state, hooks.data);
        const jobs = state.kitchen.queue;
        stoveHead.textContent = `Stove · ${jobs.length} of ${slots} in use`;
        speedNote.textContent =
          mods.cookSpeedModifier !== 1
            ? `Cooking at ${Math.round(mods.cookSpeedModifier * 100)}% speed.`
            : 'Cooking at normal speed.';
        const sig = jobs.map((j) => `${j.recipe}:${Math.ceil(j.remainingMs / 1000)}`).join('|') + `/${slots}`;
        if (!force && sig === stoveSig) return;
        stoveSig = sig;
        stove.replaceChildren();
        for (let i = 0; i < slots; i++) {
          const job = jobs[i];
          if (!job) {
            stove.append(h('div', { class: 'stove-slot is-empty', text: 'Empty. Pick a recipe below.' }));
            continue;
          }
          const r = hooks.data.recipes[job.recipe];
          const done = job.remainingMs === 0;
          const total = r.cookSec * 1000;
          const speed = Math.max(0.01, mods.cookSpeedModifier);
          const fill = done ? 1 : 1 - job.remainingMs / total;
          const cancel = h('button', {
            type: 'button',
            class: 'btn btn-small',
            text: 'Take off',
            'aria-label': `Take ${r.name} off the stove and get the ingredients back`,
            hidden: done,
          });
          cancel.addEventListener('click', () => {
            const res = hooks.dispatch({ type: 'cancelCook', index: i });
            msg.textContent = res.ok ? `${r.name} taken off the stove. Ingredients returned.` : res.reason;
            msg.className = res.ok ? 'form-msg form-ok' : 'form-msg form-error';
            render(true);
          });
          stove.append(
            h(
              'div',
              { class: 'stove-slot', 'data-job': job.recipe },
              chipIcon(`item_${job.recipe}`),
              h(
                'div',
                { class: 'crate-text' },
                h('span', { text: r.name + (job.hearty ? ' ❄' : '') }),
                h('span', {
                  class: 'seed-note',
                  text: done
                    ? 'Done. Waiting for room in your bag.'
                    : `${formatCountdown(job.remainingMs / speed)} left`,
                }),
                h(
                  'div',
                  { class: 'meter' },
                  h('div', { class: 'meter-fill', style: `width:${Math.round(fill * 100)}%` }),
                ),
              ),
              cancel,
            ),
          );
        }
      };

      const recipeRow = (r: RecipeDef): HTMLElement => {
        const state = hooks.state();
        const cal = hooks.calendar();
        const mods = hooks.mods();
        const buff = hooks.data.buffs[r.buff];
        const winter = hooks.data.seasons[cal.season].effects.heartyDishes === true;
        const mag = buffMagnitude(hooks.data, r.buff, r.tier);
        const dur = buffDurationMs(r.tier, false);
        const hearty = buffDurationMs(r.tier, true);
        const free = kitchenSlots(state, hooks.data) - state.kitchen.queue.length;
        const can = canCook(state, r);
        const cook = h('button', {
          type: 'button',
          class: 'btn btn-small',
          'data-cook': r.id,
          text: 'Cook',
          disabled: !can || free <= 0,
          'aria-label': `Cook ${r.name}`,
        });
        cook.addEventListener('click', () => {
          const res = hooks.dispatch({ type: 'cook', recipe: r.id });
          msg.textContent = res.ok ? `${r.name} is on the stove.` : res.reason;
          msg.className = res.ok ? 'form-msg form-ok' : 'form-msg form-error';
          render(true);
        });
        const ingredients = h(
          'div',
          { class: 'ingredients' },
          ...ingredientStatus(state, r).map((i) => {
            const def = hooks.data.items[i.item]!;
            return h(
              'span',
              { class: `ingredient${i.have >= i.need ? ' is-have' : ' is-missing'}`, title: def.name },
              chipIcon(def.sprite),
              h('span', { text: `${i.have}/${i.need}` }),
            );
          }),
        );
        return h(
          'div',
          { class: `recipe-row${can ? ' can-cook' : ''}`, 'data-recipe': r.id },
          h('img', { class: 'pixel', alt: '', width: 32, height: 32, src: spriteDataUrl(`item_${r.id}`) }),
          h(
            'div',
            { class: 'crate-text' },
            h(
              'span',
              { text: `${r.name} ` },
              h('span', { class: `tier tier-${r.tier}`, text: `T${r.tier}` }),
            ),
            h(
              'span',
              { class: 'seed-note' },
              `${buff.name}: ${buffEffectText(buff, mag).replace(/\.$/, '')}, ${formatDuration(dur)}` +
                (winter ? ` (${formatDuration(hearty)} when hearty)` : ''),
            ),
            h(
              'span',
              { class: 'seed-note' },
              `${formatDuration(cookMs(r, mods.cookSpeedModifier))} to cook · sells ${r.basePrice}g`,
            ),
            ingredients,
          ),
          cook,
        );
      };

      const renderBook = (force: boolean): void => {
        const state = hooks.state();
        const known = knownRecipes(state);
        const free = kitchenSlots(state, hooks.data) - state.kitchen.queue.length;
        const sig = [
          known.join(','),
          free,
          hooks.calendar().season,
          Math.round(hooks.mods().cookSpeedModifier * 100),
          ...known.map((id) =>
            hooks.data.recipes[id].ingredients
              .map((i) => countItem(state.inventory, i.item, false))
              .join('.'),
          ),
        ].join('|');
        if (!force && sig === bookSig) return;
        bookSig = sig;
        book.replaceChildren(...known.map((id) => recipeRow(hooks.data.recipes[id])));
        const left = Object.keys(hooks.data.recipes).length - known.length;
        more.textContent =
          left > 0
            ? `${left} more recipe${left === 1 ? '' : 's'} to discover: recipe cards in the Shop, milestones, and experiments.`
            : 'You know every recipe. What a cook!';
      };

      const renderExperiment = (force: boolean): void => {
        const state = hooks.state();
        const owned = new Map<ItemId, number>();
        for (const s of state.inventory.slots) {
          const cat = s ? hooks.data.items[s.item]?.category : undefined;
          if (s && !s.hearty && (cat === 'crop' || cat === 'fish' || cat === 'junk')) {
            owned.set(s.item, (owned.get(s.item) ?? 0) + s.qty);
          }
        }
        for (const id of [...picked]) if (!owned.has(id)) picked.delete(id);
        const sig = [...owned].map(([k, v]) => `${k}:${v}`).join(',') + `/${[...picked].join(',')}`;
        if (!force && sig === exSig) return;
        exSig = sig;
        exGo.textContent = `Try together (${picked.size} picked)`;
        exGo.disabled = picked.size < EXPERIMENT_MIN_ITEMS || picked.size > EXPERIMENT_MAX_ITEMS;
        exList.replaceChildren();
        if (owned.size === 0)
          exList.append(h('p', { class: 'muted', text: 'Your bag has no ingredients yet.' }));
        for (const [item, n] of owned) {
          const def = hooks.data.items[item]!;
          const on = picked.has(item);
          const b = h('button', {
            type: 'button',
            class: `btn btn-small ex-item${on ? ' is-active' : ''}`,
            'aria-pressed': String(on),
            'data-ex': item,
            title: def.name,
          });
          b.append(chipIcon(def.sprite), h('span', { text: `${def.name} ×${n}` }));
          b.addEventListener('click', () => {
            if (picked.has(item)) picked.delete(item);
            else if (picked.size < EXPERIMENT_MAX_ITEMS) picked.add(item);
            render(true);
            exList.querySelector<HTMLElement>(`[data-ex="${item}"]`)?.focus();
          });
          exList.append(b);
        }
      };

      const render = (force: boolean): void => {
        if (tab === 'cook') {
          renderStove(force);
          renderBook(force);
        } else renderExperiment(force);
      };

      return {
        refresh() {
          sync();
          render(false);
        },
      };
    },
  };
}
