// The Market panel (GDD §6.2): today's specials, the Shipping Bin, and one row per sellable item in
// the bag with its current price, a trend arrow, a 7-day sparkline and sell/ship buttons whose
// labels are the exact gold they pay (the preview). Rows are updated in place so buttons keep focus
// while prices drift.

import { formatDuration } from '../core/time';
import type { ItemId } from '../data/ids';
import { BIN_CHANNEL, MARKET_CHANNEL, MARKET_SELL_AMOUNTS } from '../data/balance';
import { spriteDataUrl } from '../render/spriteCache';
import type { ActionResult } from '../systems/context';
import { countItem } from '../systems/inventory';
import { priceTrend, quoteSale, specialBonus, unitPrice } from '../systems/market';
import { binCount, binValueNow } from '../systems/shippingBin';
import { h } from './dom';
import { goldPopupOn } from './goldFx';
import type { PanelDef } from './panel';
import type { GameViewHooks } from './panels';

export interface MarketHooks extends GameViewHooks {
  sell(item: ItemId, qty: number): ActionResult;
  ship(item: ItemId, qty: number): ActionResult;
  unship(item: ItemId): ActionResult;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const TREND = { up: '▲', down: '▼', flat: '▬' } as const;
const TREND_LABEL = { up: 'rising', down: 'falling', flat: 'steady' } as const;

/** A tiny polyline of the daily price multipliers (null when there are fewer than 2 points). */
export function sparklinePoints(history: readonly number[], w = 56, hgt = 16): string | null {
  if (history.length < 2) return null;
  const lo = Math.min(0.5, ...history);
  const hi = Math.max(1.5, ...history);
  return history
    .map((v, i) => {
      const x = (i * (w - 2)) / (history.length - 1) + 1;
      const y = hgt - 1 - ((v - lo) / (hi - lo)) * (hgt - 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

interface Row {
  el: HTMLElement;
  name: HTMLElement;
  price: HTMLElement;
  trend: HTMLElement;
  spark: SVGSVGElement;
  sparkKey: string;
  sells: { n: number | 'all'; btn: HTMLButtonElement }[];
  ship: HTMLButtonElement;
}

export function marketPanel(hooks: MarketHooks): PanelDef {
  return {
    id: 'market',
    title: 'Market',
    icon: '⚖',
    live: true,
    refreshMs: 1000,
    build(body) {
      const specials = h('p', { class: 'market-specials' });
      const binInfo = h('p', { class: 'bin-info' });
      const binList = h('div', { class: 'bin-list' });
      const list = h('div', { class: 'market-list' });
      const empty = h('p', { class: 'muted', text: 'Nothing to sell yet. Harvest something first!' });
      const msg = h('p', { class: 'form-msg', role: 'status' });
      body.append(
        specials,
        h('p', {
          class: 'muted',
          text: 'Sell now for 90% of the price, or drop items in the Shipping Bin to get 100% at the next hourly pickup.',
        }),
        list,
        empty,
        msg,
        h('h3', { text: 'Shipping Bin' }),
        binInfo,
        binList,
      );

      const rows = new Map<ItemId, Row>();
      let order = '';
      let binKey = '';

      const say = (r: ActionResult, ok: string): void => {
        msg.textContent = r.ok ? ok : r.reason;
        msg.className = r.ok ? 'form-msg form-ok' : 'form-msg form-error';
      };

      const makeRow = (item: ItemId): Row => {
        const def = hooks.data.items[item]!;
        const name = h('span', { class: 'market-name' });
        const price = h('span', { class: 'market-price' });
        const trend = h('span', { class: 'market-trend' });
        const spark = document.createElementNS(SVG_NS, 'svg');
        spark.setAttribute('class', 'sparkline');
        spark.setAttribute('viewBox', '0 0 56 16');
        spark.setAttribute('width', '56');
        spark.setAttribute('height', '16');
        spark.setAttribute('aria-hidden', 'true');
        const sells = [...MARKET_SELL_AMOUNTS, 'all' as const].map((n) => {
          const btn = h('button', { type: 'button', class: 'btn btn-small', 'data-sell': String(n) });
          btn.addEventListener('click', () => {
            const have = countItem(hooks.state().inventory, item);
            const qty = n === 'all' ? have : n;
            // What the sale pays, from the quote: the gold counter can also rise from a milestone the sale finishes.
            const gained = quoteSale(hooks.state(), hooks.data, hooks.mods(), item, qty, MARKET_CHANNEL).gold;
            const r = hooks.sell(item, qty);
            say(r, `Sold ${qty} ${def.name} for ${gained}g.`);
            if (r.ok) goldPopupOn(gained, btn);
            refresh();
          });
          return { n, btn };
        });
        const ship = h('button', { type: 'button', class: 'btn btn-small btn-ship', 'data-ship': 'all' });
        ship.addEventListener('click', () => {
          const qty = countItem(hooks.state().inventory, item);
          say(hooks.ship(item, qty), `Put ${qty} ${def.name} in the Shipping Bin.`);
          refresh();
        });
        const el = h(
          'div',
          { class: 'market-row', 'data-item': item },
          h('img', { class: 'pixel', alt: '', width: 32, height: 32, src: spriteDataUrl(def.sprite) }),
          h('div', { class: 'market-text' }, name, h('span', { class: 'market-quote' }, price, trend, spark)),
          h('div', { class: 'btn-row' }, ...sells.map((s) => s.btn), ship),
        );
        return { el, name, price, trend, spark, sparkKey: '', sells, ship };
      };

      const updateRow = (item: ItemId, row: Row): void => {
        const state = hooks.state();
        const mods = hooks.mods();
        const def = hooks.data.items[item]!;
        const have = countItem(state.inventory, item);
        const now = unitPrice(state, hooks.data, mods, item, MARKET_CHANNEL);
        const bin = unitPrice(state, hooks.data, mods, item, BIN_CHANNEL);
        const bonus = specialBonus(state, item);
        row.name.textContent = `${def.name} ×${have}${bonus > 0 ? ` · special +${Math.round(bonus * 100)}%` : ''}`;
        row.price.textContent = `${now}g each (bin ${bin}g)`;
        const t = priceTrend(state, item);
        row.trend.textContent = TREND[t];
        row.trend.className = `market-trend trend-${t}`;
        row.trend.setAttribute('aria-label', `Price ${TREND_LABEL[t]}`);
        row.trend.title = `Price ${TREND_LABEL[t]} since this morning`;
        const hist = state.market.items[item]?.history ?? [];
        const key = hist.join(',');
        if (key !== row.sparkKey) {
          row.sparkKey = key;
          const pts = sparklinePoints(hist);
          row.spark.replaceChildren();
          if (pts) {
            const line = document.createElementNS(SVG_NS, 'polyline');
            line.setAttribute('points', pts);
            row.spark.append(line);
          }
          row.spark.setAttribute('data-points', String(hist.length));
        }
        for (const { n, btn } of row.sells) {
          const qty = n === 'all' ? have : n;
          const q = quoteSale(state, hooks.data, mods, item, qty, MARKET_CHANNEL);
          const label = n === 'all' ? `All · ${q.gold}g` : `×${n} · ${q.gold}g`;
          if (btn.textContent !== label) btn.textContent = label;
          btn.disabled = qty <= 0 || have < qty;
          btn.setAttribute('aria-label', `Sell ${qty} ${def.name} for ${q.gold} gold`);
        }
        row.ship.textContent = 'Ship all';
        row.ship.disabled = have <= 0;
        row.ship.setAttribute('aria-label', `Put all ${def.name} in the Shipping Bin`);
      };

      const renderBin = (): void => {
        const state = hooks.state();
        const ctx = { data: hooks.data, mods: hooks.mods() };
        const n = binCount(state);
        const next = `Next pickup in ${formatDuration(state.shippingBin.msToPickup)}.`;
        binInfo.textContent =
          n === 0
            ? `The bin is empty. ${next}`
            : `${n} item${n === 1 ? '' : 's'} in the bin, worth about ${binValueNow(state, ctx)}g now. ${next}`;
        const key = state.shippingBin.items.map((s) => `${s.item}:${s.qty}`).join('|');
        if (key === binKey) return;
        binKey = key;
        binList.replaceChildren(
          ...state.shippingBin.items.map((s) => {
            const def = hooks.data.items[s.item]!;
            const back = h('button', {
              type: 'button',
              class: 'btn btn-small',
              text: 'Take back',
              'aria-label': `Take the ${def.name} back out of the bin`,
            });
            back.addEventListener('click', () => {
              say(hooks.unship(s.item), `Took ${s.qty} ${def.name} back.`);
              refresh();
            });
            return h(
              'div',
              { class: 'bin-row', 'data-bin-item': s.item },
              h('img', { class: 'pixel', alt: '', width: 32, height: 32, src: spriteDataUrl(def.sprite) }),
              h('span', { text: `${def.name} ×${s.qty}` }),
              back,
            );
          }),
        );
      };

      const refresh = (): void => {
        const state = hooks.state();
        const sp = state.market.specials;
        specials.textContent =
          sp.length === 0
            ? 'No specials today. New ones arrive at 6:00 AM.'
            : `Today's specials: ${sp
                .map((s) => `${hooks.data.items[s.item]?.name ?? s.item} +${Math.round(s.bonus * 100)}%`)
                .join(' · ')}`;

        const items: ItemId[] = [];
        for (const s of state.inventory.slots) {
          if (s && hooks.data.items[s.item]?.sellable && !items.includes(s.item)) items.push(s.item);
        }
        const key = items.join(',');
        if (key !== order) {
          order = key;
          const focused = document.activeElement;
          const focusSel =
            focused instanceof HTMLElement && list.contains(focused)
              ? `[data-item="${focused.closest<HTMLElement>('[data-item]')?.dataset.item}"] [data-sell="${focused.dataset.sell ?? ''}"]`
              : null;
          for (const id of [...rows.keys()]) if (!items.includes(id)) rows.delete(id);
          for (const id of items) if (!rows.has(id)) rows.set(id, makeRow(id));
          list.replaceChildren(...items.map((id) => rows.get(id)!.el));
          if (focusSel) list.querySelector<HTMLElement>(focusSel)?.focus();
        }
        empty.hidden = items.length > 0;
        rows.forEach((row, id) => updateRow(id, row));
        renderBin();
      };

      return { refresh };
    },
  };
}
