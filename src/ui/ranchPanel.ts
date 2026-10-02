// The Ranch panel (GDD §12.4): build and upgrade the coop, barn and silo, buy and name the hens and cows, make or
// buy feed, fill the troughs and collect the eggs and milk, and buy the Collecting Basket. It shows each trough,
// store and production timer, and says gently when the animals would love some feed. Rules live in
// src/systems/ranch.ts; this only reads state and sends actions.

import type { Action } from '../core/actions';
import { formatDuration } from '../core/time';
import type { BuildingState } from '../core/state';
import { FEED_AMOUNTS } from '../data/balance';
import { ANIMAL_IDS, FEED_IDS, type BuildingId } from '../data/ids';
import { spriteDataUrl } from '../render/spriteCache';
import type { ActionResult } from '../systems/context';
import { countItem } from '../systems/inventory';
import { ownsParcel } from '../systems/parcels';
import {
  animalCount,
  animalDefOf,
  animalsIn,
  buildingOfKind,
  capacityOf,
  hasCollector,
  levelDef,
  MAX_NAME_LENGTH,
  storeCount,
  storeSize,
  troughSize,
  upgradeBlock,
} from '../systems/ranch';
import { upgradeCost } from '../systems/upgrades';
import { unlockHint } from '../systems/unlocks';
import { h } from './dom';
import type { GameViewHooks } from './panels';
import type { PanelDef } from './panel';

export interface RanchHooks extends GameViewHooks {
  dispatch(action: Action): ActionResult;
  /** Leaves the panel and enters building mode: buy and place a new building. */
  startBuild(kind: BuildingId): void;
  /** Leaves the panel and enters building mode to move a building. */
  startMove(id: number): void;
}

const BUILDING_ORDER: readonly BuildingId[] = ['coop', 'barn', 'silo'];
const num = (n: number): string => n.toLocaleString('en-US');

/** "Next eggs in 12m", or the gentle reason nothing is on the way. */
function productionLine(hooks: RanchHooks, b: BuildingState): string {
  const state = hooks.state();
  const def = hooks.data.buildings[b.kind];
  const animal = animalDefOf(hooks.data, b);
  if (!animal) return '';
  const n = animalCount(state, b.id);
  const noun = animal.product === 'milk' ? 'milk' : 'eggs';
  if (n === 0) return `Nobody lives here yet. Buy ${animal.name === 'Hen' ? 'a hen' : 'a cow'} below.`;
  if (storeCount(b) >= storeSize(hooks.data, b)) return `The store is full: take the ${noun} to get more.`;
  if (b.trough <= 0) {
    return `The ${animal.plural.toLowerCase()} would love some feed. Fill the trough and they will get going.`;
  }
  const left = animal.intervalSec * 1000 - b.cycleMs;
  return `Next ${noun} in ${formatDuration(left)} · ${n} ${n === 1 ? animal.name.toLowerCase() : animal.plural.toLowerCase()} fed from the trough (${def.name.toLowerCase()})`;
}

export function ranchPanel(hooks: RanchHooks): PanelDef {
  return {
    id: 'ranch',
    wide: true,
    title: 'Ranch',
    icon: '🐔',
    live: true,
    refreshMs: 1000,
    build(body) {
      const root = h('div', { class: 'ranch', 'data-testid': 'ranch' });
      body.append(root);
      const msg = h('p', { class: 'form-msg', role: 'status' });
      let said: { text: string; ok: boolean } | null = null;

      const say = (r: ActionResult, ok: string): void => {
        said = { text: r.ok ? ok : r.reason, ok: r.ok };
      };
      const act = (action: Action, ok: string): void => {
        say(hooks.dispatch(action), ok);
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

      /** The animals of one building, each with a name box. */
      const animalRows = (b: BuildingState): HTMLElement => {
        const state = hooks.state();
        const list = h('div', { class: 'ranch-animals' });
        for (const a of animalsIn(state, b.id)) {
          const input = h('input', {
            type: 'text',
            class: 'ranch-name',
            value: a.name,
            maxlength: MAX_NAME_LENGTH,
            'aria-label': `Name of ${a.name}`,
            'data-animal-name': String(a.id),
          });
          input.value = a.name;
          input.addEventListener('change', () => {
            const r = hooks.dispatch({ type: 'renameAnimal', id: a.id, name: input.value });
            say(r, `Now she answers to ${input.value.trim()}.`);
            render();
          });
          list.append(h('label', { class: 'ranch-animal' }, input));
        }
        return list;
      };

      const buildingCard = (kind: BuildingId): HTMLElement => {
        const state = hooks.state();
        const def = hooks.data.buildings[kind];
        const b = buildingOfKind(state, kind);
        const first = def.levels[0]!;
        if (!b) {
          const block = unlockHint(state, hooks.data, first.requires);
          const afford = state.gold >= first.price;
          return h(
            'div',
            { class: `crate-row ranch-card${block ? ' is-locked' : ''}`, 'data-building': kind },
            h('img', { class: 'pixel ranch-icon', alt: '', src: spriteDataUrl(`${def.sprite}_1`, 1) }),
            h(
              'div',
              { class: 'crate-text' },
              h('span', { text: `${def.name} · ${num(first.price)}g` }),
              h('span', { class: 'seed-note', text: def.description }),
              block ? h('span', { class: 'seed-note', text: `Locked. ${block}` }) : null,
            ),
            h(
              'div',
              { class: 'btn-row' },
              button(
                'Build and place',
                { 'data-build': kind },
                !block && afford,
                () => hooks.startBuild(kind),
                true,
              ),
            ),
          );
        }
        const lvl = levelDef(hooks.data, b);
        const animal = animalDefOf(hooks.data, b);
        const next = def.levels[b.level];
        const stats: string[] = [];
        if (animal) {
          stats.push(
            `${animalCount(state, b.id)} / ${capacityOf(hooks.data, b)} ${animal.plural.toLowerCase()}`,
            `trough ${b.trough} / ${troughSize(state, hooks.data, b)}`,
            `store ${storeCount(b)} / ${storeSize(hooks.data, b)}`,
          );
        } else {
          stats.push(
            lvl.flags?.includes('autoMill')
              ? 'tops up every trough at each bin pickup, and makes feed from spare wheat and corn'
              : 'tops up every trough from your bag at each bin pickup',
          );
        }
        const buttons: HTMLElement[] = [];
        if (animal) {
          const feed = hooks.data.feeds[animal.feed];
          const room = troughSize(state, hooks.data, b) - b.trough;
          const inBag = countItem(state.inventory, feed.id);
          buttons.push(
            button(
              `Fill trough (${inBag} ${feed.name.toLowerCase()})`,
              { 'data-fill-trough': String(b.id) },
              room > 0 && inBag > 0,
              () => act({ type: 'fillTrough', building: b.id }, 'The trough is topped up.'),
            ),
            button(
              `Collect (${storeCount(b)})`,
              { 'data-collect': String(b.id) },
              storeCount(b) > 0,
              () => act({ type: 'collectBuilding', building: b.id }, 'Collected.'),
              true,
            ),
          );
        }
        if (next) {
          const block = upgradeBlock(state, hooks.data, b);
          buttons.push(
            button(
              `Upgrade · ${num(next.price)}g`,
              { 'data-upgrade-building': String(b.id), title: block ?? '' },
              !block && state.gold >= next.price,
              () => act({ type: 'upgradeBuilding', id: b.id }, `${def.name} is now level ${b.level + 1}.`),
            ),
          );
        }
        buttons.push(
          button('Move', { 'data-move-building': String(b.id) }, true, () => hooks.startMove(b.id)),
        );
        return h(
          'div',
          { class: 'crate-row ranch-card', 'data-building': kind, 'data-level': String(b.level) },
          h('img', { class: 'pixel ranch-icon', alt: '', src: spriteDataUrl(`${def.sprite}_${b.level}`, 1) }),
          h(
            'div',
            { class: 'crate-text' },
            h('span', { text: `${def.name} · level ${b.level} of ${def.levels.length}` }),
            h('span', { class: 'seed-note', text: stats.join(' · ') }),
            animal ? h('span', { class: 'seed-note ranch-status', text: productionLine(hooks, b) }) : null,
          ),
          h('div', { class: 'btn-row' }, ...buttons),
          animal ? animalRows(b) : null,
        );
      };

      const animalShop = (): HTMLElement => {
        const state = hooks.state();
        const box = h('div', { class: 'ranch-shop' }, h('h3', { text: 'Animals' }));
        let any = false;
        for (const id of ANIMAL_IDS) {
          const def = hooks.data.animals[id];
          const home = buildingOfKind(state, def.building);
          if (!home) continue;
          any = true;
          const n = animalCount(state, home.id);
          const cap = capacityOf(hooks.data, home);
          const full = n >= cap;
          const how = full
            ? `The ${hooks.data.buildings[def.building].name.toLowerCase()} is full. Upgrade it for more room.`
            : '';
          box.append(
            h(
              'div',
              { class: 'crate-row', 'data-animal-shop': id },
              h('img', {
                class: 'pixel',
                alt: '',
                width: 32,
                height: 32,
                src: spriteDataUrl(`item_${def.product}`),
              }),
              h(
                'div',
                { class: 'crate-text' },
                h('span', { text: `${def.name} · ${num(def.price)}g` }),
                h('span', {
                  class: 'seed-note',
                  text: `Eats ${hooks.data.feeds[def.feed].name.toLowerCase()}, gives ${hooks.data.items[def.product]!.name.toLowerCase()} every ${Math.round(def.intervalSec / 60)} minutes · ${n} / ${cap} in the ${hooks.data.buildings[def.building].name.toLowerCase()}`,
                }),
              ),
              h(
                'div',
                { class: 'btn-row' },
                button(
                  `Buy a ${def.name.toLowerCase()} · ${num(def.price)}g`,
                  { 'data-buy-animal': id, title: how },
                  !full && state.gold >= def.price,
                  () =>
                    act(
                      { type: 'buyAnimal', animal: id, building: home.id },
                      `A new ${def.name.toLowerCase()} joins the ranch.`,
                    ),
                  true,
                ),
              ),
            ),
          );
        }
        if (!any) return h('div');
        return box;
      };

      const feedShop = (): HTMLElement => {
        const state = hooks.state();
        const box = h('div', { class: 'ranch-feed' }, h('h3', { text: 'Feed' }));
        for (const id of FEED_IDS) {
          const feed = hooks.data.feeds[id];
          const crop = hooks.data.crops[feed.from];
          const haveCrop = countItem(state.inventory, feed.from);
          const haveFeed = countItem(state.inventory, id);
          const make = [...FEED_AMOUNTS, 'all' as const].map((n) => {
            const qty = n === 'all' ? haveCrop : n;
            return button(
              n === 'all' ? `Make all (${qty})` : `Make ×${n}`,
              { 'data-make-feed': `${id}:${n}` },
              qty > 0 && haveCrop >= qty,
              () =>
                act(
                  { type: 'makeFeed', feed: id, qty },
                  `Made ${qty * feed.perUnit} ${feed.name.toLowerCase()}.`,
                ),
            );
          });
          const buy = FEED_AMOUNTS.map((n) =>
            button(
              `Buy ×${n} · ${num(feed.buyPrice * n)}g`,
              { 'data-buy-feed': `${id}:${n}` },
              state.gold >= feed.buyPrice * n,
              () => act({ type: 'buyFeed', feed: id, qty: n }, `Bought ${n} ${feed.name.toLowerCase()}.`),
            ),
          );
          box.append(
            h(
              'div',
              { class: 'crate-row', 'data-feed': id },
              h('img', { class: 'pixel', alt: '', width: 32, height: 32, src: spriteDataUrl(`item_${id}`) }),
              h(
                'div',
                { class: 'crate-text' },
                h('span', { text: `${feed.name} · ${haveFeed} in your bag` }),
                h('span', {
                  class: 'seed-note',
                  text: `1 ${crop.name.toLowerCase()} makes ${feed.perUnit} (you have ${haveCrop}). Cannot be sold; buying costs ${feed.buyPrice}g each, about three times more.`,
                }),
              ),
              h('div', { class: 'btn-row' }, ...make, ...buy),
            ),
          );
        }
        return box;
      };

      const basketCard = (): HTMLElement | null => {
        const state = hooks.state();
        const def = hooks.data.upgrades.ranch_collector;
        if (!def) return null;
        const own = hasCollector(state, hooks.data);
        const block = own ? null : unlockHint(state, hooks.data, def.requires);
        const cost = upgradeCost(def, 0);
        return h(
          'div',
          { class: `crate-row${own ? '' : block ? ' is-locked' : ''}`, 'data-upgrade': 'ranch_collector' },
          h('img', { class: 'pixel', alt: '', width: 32, height: 32, src: spriteDataUrl('item_egg') }),
          h(
            'div',
            { class: 'crate-text' },
            h('span', { text: own ? `${def.name} · owned` : `${def.name} · ${num(cost)}g` }),
            h('span', { class: 'seed-note', text: def.description }),
            block ? h('span', { class: 'seed-note', text: `Locked. ${block}` }) : null,
          ),
          own
            ? null
            : h(
                'div',
                { class: 'btn-row' },
                button(
                  `Buy · ${num(cost)}g`,
                  { 'data-buy-upgrade': 'ranch_collector' },
                  !block && state.gold >= cost,
                  () =>
                    act(
                      { type: 'buyUpgrade', id: 'ranch_collector' },
                      `${def.name} bought: the stores are emptied at every bin pickup.`,
                    ),
                  true,
                ),
              ),
        );
      };

      function render(): void {
        // Do not rebuild under someone who is typing a name.
        if (document.activeElement instanceof HTMLInputElement && root.contains(document.activeElement))
          return;
        const state = hooks.state();
        root.replaceChildren();
        if (!ownsParcel(state, 'yard')) {
          root.append(
            h('p', {
              class: 'muted',
              text: 'Buy the Old Paddock (Upgrades › Land) to build a coop, a barn and a silo.',
            }),
          );
          return;
        }
        root.append(
          h('p', { class: 'shop-gold', text: `You have ${num(state.gold)}g` }),
          h('p', {
            class: 'muted',
            text: 'Animals eat from the trough and give eggs and milk. Hungry animals just wait: nothing is ever lost.',
          }),
          h('h3', { text: 'Buildings' }),
        );
        for (const kind of BUILDING_ORDER) root.append(buildingCard(kind));
        root.append(animalShop(), feedShop(), h('h3', { text: 'Collecting' }));
        const basket = basketCard();
        if (basket) root.append(basket);
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
