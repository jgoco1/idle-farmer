// The Trees tab of the Shop (GDD §12.3): every sapling with its price, the seasons it bears in, the real
// days it takes to mature and the day a sapling planted today would first bear. Saplings are bag items
// (like seeds); "Plant" leaves the shop and enters planting mode on the orchard's free tree spots.

import type { GameState } from '../core/state';
import { civilFromDays, weekdayOfDay, type Calendar } from '../core/time';
import type { GameData } from '../data';
import { FRUIT_IDS, treeOfFruit, type FruitId } from '../data/ids';
import { spriteDataUrl } from '../render/spriteCache';
import type { ActionResult } from '../systems/context';
import {
  daysToMature,
  firstBearingDay,
  freeSpots,
  saplingsInBag,
  treeAge,
  treeStage,
} from '../systems/orchard';
import { showModal } from './modal';
import { ownsParcel } from '../systems/parcels';
import { h } from './dom';

export interface TreeShopHooks {
  data: GameData;
  state(): GameState;
  calendar(): Calendar;
  buySapling(fruit: FruitId, qty: number): ActionResult;
  /** Leaves the shop and enters planting mode for `fruit`. */
  startPlanting(fruit: FruitId): void;
  pickTree(id: number): ActionResult;
  /** Leaves the shop and enters move mode for tree `id`. */
  startMove(id: number): void;
  removeTree(id: number): ActionResult;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** "Mon 4 Mar" for a real day index. */
export function formatDayIndex(cal: Pick<Calendar, 'dayZero'>, d: number): string {
  const day = cal.dayZero + d;
  const c = civilFromDays(day);
  return `${DAYS[weekdayOfDay(day)]} ${c.d} ${MONTHS[c.mo - 1]}`;
}

export function buildTreeShop(hooks: TreeShopHooks): { el: HTMLElement; render(): void } {
  const el = h('div', { class: 'tree-shop', 'data-testid': 'tree-shop' });
  const msg = h('p', { class: 'form-msg', role: 'status' });

  const render = (): void => {
    const state = hooks.state();
    const cal = hooks.calendar();
    el.replaceChildren();
    if (!ownsParcel(state, 'orchard')) {
      el.append(
        h('p', { class: 'muted', text: 'Buy the Hilltop Orchard (Upgrades › Land) to plant trees.' }),
      );
      return;
    }
    const free = freeSpots(state, hooks.data).length;
    el.append(
      h('p', {
        class: 'shop-gold',
        text: `You have ${state.gold.toLocaleString('en-US')}g · ${free} free tree spot${free === 1 ? '' : 's'}`,
      }),
      h('p', {
        class: 'muted',
        text: 'Trees grow in real days, even while you are away, never wither, and bear fruit in their seasons.',
      }),
    );
    for (const fruit of FRUIT_IDS) {
      const def = hooks.data.trees[treeOfFruit(fruit)];
      const have = saplingsInBag(state, fruit);
      const first = firstBearingDay(def, cal.dayIndex, cal.dayIndex, cal);
      const seasons = def.seasons.map(cap).join(' and ');
      const buy = h('button', {
        type: 'button',
        class: 'btn btn-small',
        'data-sapling-buy': fruit,
        text: `Buy · ${def.saplingPrice.toLocaleString('en-US')}g`,
        'aria-label': `Buy a ${def.name} sapling for ${def.saplingPrice} gold`,
        disabled: state.gold < def.saplingPrice,
      });
      buy.addEventListener('click', () => {
        const r = hooks.buySapling(fruit, 1);
        msg.textContent = r.ok ? `You bought a ${def.name} sapling. Plant it on a free tree spot.` : r.reason;
        msg.className = r.ok ? 'form-msg form-ok' : 'form-msg form-error';
        render();
      });
      const plant = h('button', {
        type: 'button',
        class: 'btn btn-small btn-primary',
        'data-sapling-plant': fruit,
        text: `Plant (${have})`,
        disabled: have <= 0 || free <= 0,
        title: have <= 0 ? 'Buy a sapling first' : free <= 0 ? 'No free tree spot' : '',
      });
      plant.addEventListener('click', () => hooks.startPlanting(fruit));
      el.append(
        h(
          'div',
          { class: 'crate-row', 'data-tree': def.id },
          h('img', {
            class: 'pixel',
            alt: '',
            width: 32,
            height: 32,
            src: spriteDataUrl(`item_sapling_${fruit}`),
          }),
          h(
            'div',
            { class: 'crate-text' },
            h('span', { text: `${def.name} tree · ${def.saplingPrice.toLocaleString('en-US')}g` }),
            h('span', {
              class: 'seed-note',
              text: `Bears in ${seasons} · mature in ${def.matureDays} days · ${def.fruitPerDay} fruit a day (up to ${def.fruitCap}) · worth ${def.fruitPrice}g each`,
            }),
            h('span', {
              class: 'seed-note',
              text:
                first === null ? '' : `Planted today, it would first bear on ${formatDayIndex(cal, first)}.`,
            }),
          ),
          h('div', { class: 'btn-row' }, buy, plant),
        ),
      );
    }
    el.append(msg);
    renderYourTrees(state, cal);
  };

  /** The planted trees: stage, fruit hanging, and pick / move / remove (removing asks first). */
  const renderYourTrees = (state: GameState, cal: Calendar): void => {
    if (state.orchard.trees.length === 0) return;
    el.append(h('h3', { text: 'Your trees' }));
    for (const t of state.orchard.trees) {
      const def = hooks.data.trees[t.tree];
      const stage = treeStage(hooks.data, t, cal.dayIndex);
      const left = daysToMature(hooks.data, t, cal.dayIndex);
      const status =
        stage === 'mature'
          ? `Mature · ${t.fruit} / ${def.fruitCap} fruit hanging`
          : `${stage === 'sapling' ? 'Sapling' : 'Young'} · ${left} more day${left === 1 ? '' : 's'} to mature`;
      const pick = h('button', {
        type: 'button',
        class: 'btn btn-small',
        'data-tree-pick': String(t.id),
        text: 'Pick fruit',
        disabled: t.fruit <= 0,
      });
      pick.addEventListener('click', () => {
        const r = hooks.pickTree(t.id);
        msg.textContent = r.ok ? `You picked the ${def.name.toLowerCase()} tree.` : r.reason;
        msg.className = r.ok ? 'form-msg form-ok' : 'form-msg form-error';
        render();
      });
      const move = h('button', {
        type: 'button',
        class: 'btn btn-small',
        'data-tree-move': String(t.id),
        text: 'Move',
      });
      move.addEventListener('click', () => hooks.startMove(t.id));
      const remove = h('button', {
        type: 'button',
        class: 'btn btn-small',
        'data-tree-remove': String(t.id),
        text: 'Remove',
      });
      remove.addEventListener('click', () => confirmRemove(t.id, def.name, treeAge(t, cal.dayIndex)));
      el.append(
        h(
          'div',
          { class: 'crate-row', 'data-your-tree': String(t.id) },
          h('img', {
            class: 'pixel',
            alt: '',
            width: 32,
            height: 32,
            src: spriteDataUrl(`item_${def.fruit}`),
          }),
          h(
            'div',
            { class: 'crate-text' },
            h('span', { text: `${def.name} tree` }),
            h('span', { class: 'seed-note', text: status }),
          ),
          h('div', { class: 'btn-row' }, pick, move, remove),
        ),
      );
    }
  };

  const confirmRemove = (id: number, name: string, age: number): void => {
    showModal({
      title: `Remove this ${name.toLowerCase()} tree?`,
      body: h('p', {
        text: `It is ${age} day${age === 1 ? '' : 's'} old. Its growth and any fruit on it will be lost, and the sapling is not refunded. (Moving a tree is free and keeps its growth.)`,
      }),
      buttons: [
        { label: 'Keep it' },
        {
          label: 'Remove the tree',
          primary: true,
          onClick() {
            const r = hooks.removeTree(id);
            msg.textContent = r.ok ? `The ${name.toLowerCase()} tree is gone.` : r.reason;
            msg.className = r.ok ? 'form-msg form-ok' : 'form-msg form-error';
            render();
          },
        },
      ],
    });
  };
  return { el, render };
}
