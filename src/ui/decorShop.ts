// The Decor tab of the Shop (GDD §12.2): the three sets with a preview, price, charm, how many you own and
// how many stand on the land; locked pieces show their hint. Bought pieces go to the decoration stock (not the
// bag) and are put down in Decorate mode. Farmhouse paint, roof and loft are owned once and applied here for free,
// and the farm cats are adopted and chosen here too.

import type { GameState } from '../core/state';
import type { GameData } from '../data';
import { DECOR_BUY_AMOUNTS } from '../data/balance';
import { CAT_IDS, DECOR_IDS, DECOR_SET_IDS, type CatId, type DecorId } from '../data/ids';
import type { DecorDef } from '../data/types';
import { spriteDataUrl } from '../render/spriteCache';
import type { ActionResult } from '../systems/context';
import { hasCat } from '../systems/cats';
import { charmOf, nextCharmUnlock } from '../systems/charm';
import { decorStatus, decorStock, ownedDecor, placedDecorCount, slotsUsed } from '../systems/decor';
import { decorSetOpen, decorSlotCap } from '../systems/townProjects';
import { unlockHint } from '../systems/unlocks';
import { h } from './dom';

export interface DecorShopHooks {
  data: GameData;
  state(): GameState;
  buyDecor(id: DecorId, qty: number): ActionResult;
  styleFarmhouse(paint?: DecorId | null, roof?: DecorId | null, loft?: boolean): ActionResult;
  adoptCat(cat: CatId): ActionResult;
  chooseCat(cat: CatId): ActionResult;
  /** Leaves the shop and enters Decorate mode, with `id` chosen when given. */
  startDecorate(id?: DecorId): void;
}

const gold = (n: number): string => `${n.toLocaleString('en-US')}g`;

export function buildDecorShop(hooks: DecorShopHooks): { el: HTMLElement; render(): void } {
  const el = h('div', { class: 'decor-shop', 'data-testid': 'decor-shop' });
  const msg = h('p', { class: 'form-msg', role: 'status' });
  const say = (r: ActionResult, ok: string): void => {
    msg.textContent = r.ok ? ok : r.reason;
    msg.className = r.ok ? 'form-msg form-ok' : 'form-msg form-error';
  };

  const row = (state: GameState, def: DecorDef): HTMLElement => {
    const status = decorStatus(state, hooks.data, def.id);
    const farmhouse = def.kind !== 'place';
    const owned = ownedDecor(state, def.id);
    const buttons: HTMLElement[] = [];
    if (status.unlocked) {
      if (farmhouse) {
        if (owned === 0) {
          const b = h('button', {
            type: 'button',
            class: 'btn btn-small',
            'data-decor-buy': `${def.id}:1`,
            text: `Buy · ${gold(def.price)}`,
            'aria-label': `Buy ${def.name} for ${def.price} gold`,
            disabled: state.gold < def.price,
          });
          b.addEventListener('click', () => {
            say(hooks.buyDecor(def.id, 1), `${def.name} is yours. Apply it above.`);
            render();
          });
          buttons.push(b);
        }
      } else {
        for (const n of DECOR_BUY_AMOUNTS) {
          const cost = def.price * n;
          const b = h('button', {
            type: 'button',
            class: 'btn btn-small',
            'data-decor-buy': `${def.id}:${n}`,
            text: n === 1 ? `Buy · ${gold(def.price)}` : `×${n} · ${gold(cost)}`,
            'aria-label': `Buy ${n} ${def.name} for ${cost} gold`,
            disabled: state.gold < cost,
          });
          b.addEventListener('click', () => {
            say(
              hooks.buyDecor(def.id, n),
              `Bought ${n} ${def.name} for ${gold(cost)}. Put it down in Decorate mode.`,
            );
            render();
          });
          buttons.push(b);
        }
        if (decorStock(state, hooks.data, def.id) > 0) {
          const place = h('button', {
            type: 'button',
            class: 'btn btn-small btn-primary',
            'data-decor-place': def.id,
            text: 'Place',
          });
          place.addEventListener('click', () => hooks.startDecorate(def.id));
          buttons.push(place);
        }
      }
    }
    const counts = farmhouse
      ? owned > 0
        ? 'Owned'
        : ''
      : `Owned ${owned} · placed ${placedDecorCount(state, def.id)}`;
    return h(
      'div',
      { class: `crate-row decor-row${status.unlocked ? '' : ' is-locked'}`, 'data-decor': def.id },
      h('img', { class: 'pixel decor-preview', alt: '', src: spriteDataUrl(def.sprite) }),
      h(
        'div',
        { class: 'crate-text' },
        h('span', {
          text: `${def.name} · ${gold(def.price)} · charm ${def.charm}${def.glows ? ' · glows' : ''}${def.seasonal ? ' · seasonal' : ''}`,
        }),
        h('span', {
          class: 'seed-note',
          text: status.unlocked ? `${def.description} ${counts}`.trim() : `Locked. ${status.hint ?? ''}`,
        }),
      ),
      buttons.length > 0 ? h('div', { class: 'btn-row' }, ...buttons) : null,
    );
  };

  const farmhouseCard = (state: GameState): HTMLElement => {
    const f = state.decor.farmhouse;
    const choose = (label: string, kind: 'paint' | 'roof', current: DecorId | null): HTMLElement => {
      const options = DECOR_IDS.filter(
        (id) => hooks.data.decor[id].kind === kind && ownedDecor(state, id) > 0,
      );
      const make = (id: DecorId | null, name: string): HTMLButtonElement => {
        const b = h('button', {
          type: 'button',
          class: `btn btn-small${current === id ? ' is-active' : ''}`,
          'data-farmhouse': `${kind}:${id ?? 'original'}`,
          'aria-pressed': String(current === id),
          text: name,
        });
        b.addEventListener('click', () => {
          say(
            kind === 'paint'
              ? hooks.styleFarmhouse(id, undefined, undefined)
              : hooks.styleFarmhouse(undefined, id, undefined),
            `${name} applied.`,
          );
          render();
        });
        return b;
      };
      return h(
        'div',
        { class: 'btn-row' },
        h('span', { class: 'decor-label', text: label }),
        make(null, 'Original'),
        ...options.map((id) => make(id, hooks.data.decor[id].name)),
      );
    };
    const loftOwned = ownedDecor(state, 'farmhouse_loft') > 0;
    const loft = h('button', {
      type: 'button',
      class: `btn btn-small${f.loft ? ' is-active' : ''}`,
      'data-farmhouse': 'loft',
      'aria-pressed': String(f.loft),
      text: f.loft ? 'Loft on' : 'Loft off',
      disabled: !loftOwned,
    });
    loft.addEventListener('click', () => {
      say(
        hooks.styleFarmhouse(undefined, undefined, !f.loft),
        f.loft ? 'The loft is hidden.' : 'The loft is back.',
      );
      render();
    });
    return h(
      'div',
      { class: 'decor-farmhouse' },
      h('h4', { text: 'Farmhouse look' }),
      choose('Walls', 'paint', f.paint),
      choose('Roof', 'roof', f.roof),
      h('div', { class: 'btn-row' }, h('span', { class: 'decor-label', text: 'Extension' }), loft),
    );
  };

  const catsCard = (state: GameState): HTMLElement => {
    const rows = CAT_IDS.map((id) => {
      const def = hooks.data.cats[id];
      const adopted = hasCat(state, id);
      const napping = state.cats.active === id;
      let button: HTMLButtonElement;
      if (!adopted) {
        button = h('button', {
          type: 'button',
          class: 'btn btn-small',
          'data-cat': id,
          text: `Adopt · ${gold(def.price)}`,
          'aria-label': `Adopt the ${def.name} for ${def.price} gold`,
          disabled: state.gold < def.price,
        });
        button.addEventListener('click', () => {
          say(hooks.adoptCat(id), `The ${def.name} has moved in, and is already asleep by the door.`);
          render();
        });
      } else {
        button = h('button', {
          type: 'button',
          class: `btn btn-small${napping ? ' is-active' : ''}`,
          'data-cat': id,
          'aria-pressed': String(napping),
          text: napping ? 'Napping' : 'Choose',
          'aria-label': napping
            ? `The ${def.name} is napping by the door`
            : `Let the ${def.name} nap by the door`,
        });
        button.addEventListener('click', () => {
          if (!napping) say(hooks.chooseCat(id), `The ${def.name} curls up by the door.`);
          render();
        });
      }
      return h(
        'div',
        { class: 'crate-row decor-row', 'data-cat-row': id },
        h('img', { class: 'pixel decor-preview', alt: '', src: spriteDataUrl(def.sprite) }),
        h(
          'div',
          { class: 'crate-text' },
          h('span', { text: def.price > 0 ? `${def.name} · ${gold(def.price)}` : def.name }),
          h('span', { class: 'seed-note', text: adopted ? `${def.description} Adopted.` : def.description }),
        ),
        h('div', { class: 'btn-row' }, button),
      );
    });
    return h(
      'div',
      { class: 'decor-set', 'data-testid': 'farm-cats' },
      h('h4', { text: 'Farm cats' }),
      h('p', {
        class: 'seed-note',
        text: 'Adopt a cat once, then choose who naps by the farmhouse door. Just for company: cats add no charm.',
      }),
      ...rows,
    );
  };

  function render(): void {
    const state = hooks.state();
    const data = hooks.data;
    const focused = document.activeElement;
    const keep =
      focused instanceof HTMLElement && el.contains(focused)
        ? (focused.dataset.decorBuy ?? focused.dataset.farmhouse ?? focused.dataset.cat ?? null)
        : null;
    const charm = charmOf(state, data);
    const next = nextCharmUnlock(state, data);
    const decorate = h('button', {
      type: 'button',
      class: 'btn btn-primary',
      'data-decorate-start': '',
      text: 'Decorate…',
    });
    decorate.addEventListener('click', () => hooks.startDecorate());
    const parts: (HTMLElement | null)[] = [
      h(
        'div',
        { class: 'decor-head' },
        h('p', {
          class: 'shop-gold',
          text: `Charm ${charm}${next ? ` · next piece at ${next.amount}` : ''} · ${slotsUsed(state)} / ${decorSlotCap(state, data)} pieces placed`,
        }),
        decorate,
      ),
      h('p', {
        class: 'muted',
        text: 'Decorations are for looks only: they never change prices, growth or income. They add charm, which opens more pieces.',
      }),
      farmhouseCard(state),
      msg,
      catsCard(state),
    ];
    for (const set of DECOR_SET_IDS) {
      const sd = data.decorSets[set];
      const open = decorSetOpen(state, data, set);
      parts.push(
        h(
          'div',
          { class: 'decor-set', 'data-decor-set': set },
          h('h4', { text: `${sd.name}${open ? '' : ' · locked'}` }),
          h('p', {
            class: 'seed-note',
            text: open ? sd.description : `${sd.description} ${hooksHint(state, data, set)}`,
          }),
          ...DECOR_IDS.filter((id) => data.decor[id].set === set).map((id) => row(state, data.decor[id])),
        ),
      );
    }
    el.replaceChildren(...parts.filter((p): p is HTMLElement => p !== null));
    if (keep) {
      const sel = keep.startsWith('cat_')
        ? `[data-cat="${keep}"]:not([disabled])`
        : keep.includes(':') && !keep.startsWith('paint') && !keep.startsWith('roof')
          ? `[data-decor-buy="${keep}"]:not([disabled])`
          : `[data-farmhouse="${keep}"]:not([disabled])`;
      el.querySelector<HTMLButtonElement>(sel)?.focus();
    }
  }

  return { el, render };
}

function hooksHint(state: GameState, data: GameData, set: (typeof DECOR_SET_IDS)[number]): string {
  return unlockHint(state, data, data.decorSets[set].unlock) ?? '';
}
