// Panel definitions. Phase 01 shipped every panel as a "Coming soon" stub except Settings; each
// phase replaces its stub's `build` with the real content (phase 02: Inventory; phase 03: Shop,
// plus the Market and Upgrades panels in marketPanel.ts and upgradesPanel.ts).

import type { GameState } from '../core/state';
import type { DishId } from '../data/ids';
import { capitalize, seasonOfWeek, type Calendar } from '../core/time';
import type { GameData } from '../data';
import { SHOP_BUY_AMOUNTS } from '../data/balance';
import { CROP_IDS, type CropId, type RecipeId } from '../data/ids';
import type { ItemDef } from '../data/types';
import { spriteDataUrl } from '../render/spriteCache';
import type { ActionResult } from '../systems/context';
import { inSeason } from '../systems/farming';
import { usedSlots } from '../systems/inventory';
import { unitPrice } from '../systems/market';
import type { Modifiers } from '../systems/modifiers';
import { maxAffordableSeeds, seedStock } from '../systems/shop';
import { recipeCards } from '../systems/cooking';
import { farmLevel } from '../systems/unlocks';
import { reducedMotion, type PrefsStore, type UiScale } from '../core/prefs';
import { h } from './dom';
import { systemPrefersReducedMotion } from './motion';
import { seedNote } from './farmTools';
import type { PanelDef } from './panel';
import { buffEffectText } from './buffBar';
import { eatWithConfirm } from './eat';
import type { Action } from '../core/actions';
import { buffDurationMs, buffMagnitude } from '../systems/buffs';
import { formatDuration } from '../core/time';
import { buildTreeShop, type TreeShopHooks } from './treeShop';
import { ownsParcel } from '../systems/parcels';
import { buildDecorShop, type DecorShopHooks } from './decorShop';

export interface SettingsHooks {
  prefs: PrefsStore;
  /** Replays the first-time tutorial (closes Settings). */
  replayTutorial(): void;
  getRelaxedFishing(): boolean;
  setRelaxedFishing(on: boolean): void;
  exportSave(): string;
  /** Returns an error message, or null when the save was imported. */
  importSave(text: string): string | null;
  hardReset(): void;
  /** The bandstand is built: the Town Square tune can play (v2 phase 02). */
  townTuneOwned(): boolean;
  /** Plays the Town Square tune now (true) or goes back to the seasons (false). */
  playTownTune(on: boolean): void;
}

export function settingsPanel(hooks: SettingsHooks): PanelDef {
  return {
    id: 'settings',
    title: 'Settings',
    icon: '⚙',
    toolbar: false,
    build(body) {
      // Sound: master / effects / music sliders and a mute switch (saved in the prefs key, not the farm).
      const prefs = hooks.prefs;
      const slider = (id: string, label: string, key: 'master' | 'sfx' | 'music') => {
        const input = h('input', { type: 'range', min: 0, max: 100, step: 1, id });
        const out = h('output', { for: id });
        input.addEventListener('input', () => {
          prefs.set(key, Number(input.value) / 100);
          out.textContent = `${input.value}%`;
        });
        const row = h('label', { class: 'field', for: id }, `${label} `, input, out);
        return { row, input, out, key };
      };
      const sliders = [
        slider('set-volume', 'Master', 'master'),
        slider('set-sfx', 'Effects', 'sfx'),
        slider('set-music', 'Music', 'music'),
      ];
      const mute = h('input', { type: 'checkbox', id: 'set-mute' });
      mute.addEventListener('change', () => prefs.set('muted', mute.checked));

      // Display: reduced motion (follows the system until changed), UI size, number format.
      const motion = h('input', { type: 'checkbox', id: 'set-reduce-motion' });
      motion.addEventListener('change', () => prefs.set('motion', motion.checked ? 'reduce' : 'full'));
      const scale = h(
        'select',
        { id: 'set-ui-scale' },
        ...([1, 1.5, 2] as const).map((v) => h('option', { value: String(v), text: `${v}×` })),
      );
      scale.addEventListener('change', () => prefs.set('uiScale', Number(scale.value) as UiScale));
      const numbers = h(
        'select',
        { id: 'set-number-format' },
        h('option', { value: 'full', text: 'Full (12,345)' }),
        h('option', { value: 'short', text: 'Short (12.3K, 3.4M)' }),
      );
      numbers.addEventListener('change', () =>
        prefs.set('numberFormat', numbers.value === 'short' ? 'short' : 'full'),
      );

      // The Town Square tune: only once the Bandstand stands.
      const tune = h('input', { type: 'checkbox', id: 'set-town-tune' });
      tune.addEventListener('change', () => prefs.set('townTune', tune.checked));
      const tuneRow = h(
        'label',
        { class: 'field', for: 'set-town-tune' },
        tune,
        ' Town Square tune in the rotation',
      );
      let tunePlaying = false;
      const tuneNow = h('button', {
        type: 'button',
        class: 'btn',
        'data-play-town-tune': '',
        text: 'Play the Town Square tune now',
      });
      tuneNow.addEventListener('click', () => {
        tunePlaying = !tunePlaying;
        hooks.playTownTune(tunePlaying);
        tuneNow.textContent = tunePlaying ? 'Back to the seasons' : 'Play the Town Square tune now';
      });
      const tuneBox = h(
        'div',
        { class: 'town-tune', hidden: true },
        tuneRow,
        h('div', { class: 'btn-row' }, tuneNow),
      );

      // Help: replay the tutorial and a short glossary.
      const replay = h('button', { type: 'button', class: 'btn', text: 'Replay the tutorial' });
      replay.addEventListener('click', () => hooks.replayTutorial());
      const glossary = h(
        'dl',
        { class: 'glossary' },
        ...(
          [
            ['Plot', 'A square of soil. Till it, plant a seed, water it, then harvest.'],
            ['Watered', 'Crops grow twice as fast while their soil is wet.'],
            ['Shipping Bin', 'Drop crops here and they are sold at the next hourly pickup.'],
            ['Demand', 'Prices drop as you sell one item and recover with time. Mix your crops.'],
            ['Buff', 'A food effect. Eat a dish from your bag; it lasts a few minutes.'],
            ['Farm Level', 'Grows with milestones and skills, and unlocks seeds, recipes and upgrades.'],
            ['Season', 'Follows the real-world week: each Sunday at midnight the season changes.'],
          ] as const
        ).flatMap(([t, d]) => [h('dt', { text: t }), h('dd', { text: d })]),
      );

      // Accessibility: Relaxed fishing (a wider, slower sweet zone and a gentler meter).
      const relaxed = h('input', { type: 'checkbox', id: 'set-relaxed-fishing' });
      relaxed.addEventListener('change', () => hooks.setRelaxedFishing(relaxed.checked));

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
        ...sliders.map((x) => x.row),
        h('label', { class: 'field', for: 'set-mute' }, mute, ' Mute everything'),
        tuneBox,
        h('h3', { text: 'Display' }),
        h('label', { class: 'field', for: 'set-reduce-motion' }, motion, ' Reduce motion'),
        h('p', {
          class: 'muted',
          text: 'Turns off particles, shakes, bounces and ambient creatures. Follows your system setting until you change it.',
        }),
        h('label', { class: 'field', for: 'set-ui-scale' }, 'Interface size ', scale),
        h('label', { class: 'field', for: 'set-number-format' }, 'Numbers ', numbers),
        h('h3', { text: 'Accessibility' }),
        h('label', { class: 'field', for: 'set-relaxed-fishing' }, relaxed, ' Relaxed fishing'),
        h('p', {
          class: 'muted',
          text: 'A wider, slower sweet zone and a meter that drains half as fast. Applies to your next catch.',
        }),
        h('h3', { text: 'Help' }),
        h('div', { class: 'btn-row' }, replay),
        glossary,
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
          const p = prefs.value;
          for (const sl of sliders) {
            const v = Math.round(p[sl.key] * 100);
            sl.input.value = String(v);
            sl.out.textContent = `${v}%`;
          }
          mute.checked = p.muted;
          tuneBox.hidden = !hooks.townTuneOwned();
          tune.checked = p.townTune;
          motion.checked = reducedMotion(p, systemPrefersReducedMotion());
          scale.value = String(p.uiScale);
          numbers.value = p.numberFormat;
          relaxed.checked = hooks.getRelaxedFishing();
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

export interface InventoryHooks extends GameViewHooks {
  dispatch(action: Action): ActionResult;
}

/** What eating a dish gives, as one line: "Green Thumb: Crops grow 10% faster for 6m". */
function eatText(hooks: GameViewHooks, def: ItemDef, hearty: boolean): string {
  const r = hooks.data.recipes[def.id as keyof GameData['recipes']];
  const buff = hooks.data.buffs[r.buff];
  const mag = buffMagnitude(hooks.data, r.buff, r.tier);
  return `${buff.name} (tier ${r.tier}): ${buffEffectText(buff, mag)} Lasts ${formatDuration(buffDurationMs(r.tier, hearty, hooks.mods().buffDurationBonus))}${hearty ? ', hearty' : ''}.`;
}

/** Inventory: a grid of slots with icons and counts; hovering or focusing a slot shows its details. */
export function inventoryPanel(hooks: InventoryHooks): PanelDef {
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

      const eatMsg = h('p', { class: 'form-msg', role: 'status' });
      const describe = (def: ItemDef | undefined, qty: number, hearty = false): void => {
        if (!def) {
          detail.replaceChildren(h('p', { class: 'muted', text: blank }), eatMsg);
          return;
        }
        const parts: (HTMLElement | null)[] = [
          h('p', { class: 'inv-name', text: `${def.name}${hearty ? ' ❄ hearty' : ''} ×${qty}` }),
          h('p', { text: def.description }),
        ];
        if (def.edible) {
          parts.push(h('p', { class: 'inv-buff', text: eatText(hooks, def, hearty) }));
          const eat = h('button', {
            type: 'button',
            class: 'btn btn-small btn-primary',
            'data-eat': def.id,
            text: 'Eat',
            'aria-label': `Eat ${def.name}`,
          });
          eat.addEventListener('click', () => {
            eatWithConfirm(hooks, def.id as DishId, hearty, (r) => {
              eatMsg.textContent = r ? (r.ok ? `You ate the ${def.name}. Delicious!` : r.reason) : '';
              eatMsg.className = r && !r.ok ? 'form-msg form-error' : 'form-msg form-ok';
            });
          });
          parts.push(h('div', { class: 'btn-row' }, eat));
        }
        parts.push(h('p', { class: def.sellable ? 'inv-value' : 'muted', text: sellText(hooks, def) }));
        detail.replaceChildren(...parts.filter((p): p is HTMLElement => p !== null), eatMsg);
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
              'aria-label':
                stack && def ? `${def.name}${stack.hearty ? ' (hearty)' : ''}, ${stack.qty}` : 'Empty slot',
              title: def ? itemTooltip(hooks, def) : undefined,
            });
            if (stack && def) {
              slot.append(
                h('img', { class: 'pixel', alt: '', width: 32, height: 32, src: spriteDataUrl(def.sprite) }),
              );
              if (stack.hearty) {
                slot.append(
                  h('img', {
                    class: 'pixel inv-hearty',
                    alt: 'Hearty',
                    width: 20,
                    height: 20,
                    src: spriteDataUrl('ui_hearty'),
                  }),
                );
              }
              slot.append(h('span', { class: 'inv-qty', text: String(stack.qty) }));
              if (stack.hearty) slot.dataset.hearty = 'true';
              const show = (): void => describe(def, stack.qty, stack.hearty === true);
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
          describe(sel ? hooks.data.items[sel.item] : undefined, sel?.qty ?? 0, sel?.hearty === true);
        },
      };
    },
  };
}

export interface ShopHooks extends GameViewHooks {
  buySeeds(crop: CropId, qty: number): ActionResult;
  buyRecipe(recipe: RecipeId): ActionResult;
  /** The Decor tab (v2 phase 02). */
  decor: Omit<DecorShopHooks, 'data' | 'state'>;
  /** The Trees tab (v2 phase 03). */
  trees: Omit<TreeShopHooks, 'data' | 'state' | 'calendar'>;
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
      const cardsHead = h('h3', { text: 'Recipe cards' });
      const cards = h('div', { class: 'crate-list', 'data-testid': 'recipe-cards' });
      const seedsSection = h(
        'div',
        { class: 'shop-section', 'data-section': 'seeds' },
        h('h3', { text: 'Seeds' }),
        gold,
        list,
        msg,
        later,
        cardsHead,
        cards,
      );
      const decorShop = buildDecorShop({ ...hooks.decor, data: hooks.data, state: hooks.state });
      const decorSection = h(
        'div',
        { class: 'shop-section', 'data-section': 'decor', hidden: true },
        decorShop.el,
      );
      const treeShop = buildTreeShop({
        ...hooks.trees,
        data: hooks.data,
        state: hooks.state,
        calendar: hooks.calendar,
      });
      const treesSection = h(
        'div',
        { class: 'shop-section', 'data-section': 'trees', hidden: true },
        treeShop.el,
      );
      let tab: 'seeds' | 'decor' | 'trees' = 'seeds';
      const tabButtons = new Map<string, HTMLButtonElement>();
      const tabs = h('div', { class: 'tabs', role: 'tablist' });
      for (const [id, label] of [
        ['seeds', 'Seeds & recipes'],
        ['trees', 'Trees'],
        ['decor', 'Decor'],
      ] as const) {
        const b = h('button', {
          type: 'button',
          class: 'btn btn-small',
          role: 'tab',
          'data-tab': id,
          text: label,
        });
        b.addEventListener('click', () => {
          tab = id;
          showTab();
          render();
        });
        tabButtons.set(id, b);
        tabs.append(b);
      }
      const showTab = (): void => {
        seedsSection.hidden = tab !== 'seeds';
        decorSection.hidden = tab !== 'decor';
        treesSection.hidden = tab !== 'trees';
        const owned = ownsParcel(hooks.state(), 'orchard');
        const treesTab = tabButtons.get('trees');
        if (treesTab) treesTab.hidden = !owned; // the orchard opens the Trees tab
        if (!owned && tab === 'trees') tab = 'seeds';
        seedsSection.hidden = tab !== 'seeds';
        for (const [id, b] of tabButtons) {
          b.setAttribute('aria-selected', String(id === tab));
          b.classList.toggle('is-active', id === tab);
        }
      };
      body.append(tabs, seedsSection, treesSection, decorSection);
      showTab();

      const renderCards = (state: GameState): void => {
        const stock = recipeCards(state, hooks.data);
        cardsHead.hidden = cards.hidden = stock.length === 0;
        cards.replaceChildren();
        for (const c of stock) {
          const r = hooks.data.recipes[c.id];
          const buy = h('button', {
            type: 'button',
            class: 'btn btn-small',
            'data-card': c.id,
            text: `Buy · ${c.price.toLocaleString('en-US')}g`,
            'aria-label': `Buy the ${r.name} recipe for ${c.price} gold`,
            disabled: !c.unlocked || state.gold < c.price,
          });
          buy.addEventListener('click', () => {
            const res = hooks.buyRecipe(c.id);
            msg.textContent = res.ok ? `You learned ${r.name}!` : res.reason;
            msg.className = res.ok ? 'form-msg form-ok' : 'form-msg form-error';
            render();
          });
          cards.append(
            h(
              'div',
              { class: `crate-row${c.unlocked ? '' : ' is-locked'}`, 'data-recipe-card': c.id },
              h('img', {
                class: 'pixel',
                alt: '',
                width: 32,
                height: 32,
                src: spriteDataUrl(`item_${c.id}`),
              }),
              h(
                'div',
                { class: 'crate-text' },
                h('span', { text: `${r.name} (tier ${r.tier})` }),
                h('span', {
                  class: 'seed-note',
                  text: c.unlocked ? r.description : `Locked. ${c.hint ?? ''}`,
                }),
              ),
              h('div', { class: 'btn-row' }, buy),
            ),
          );
        }
      };

      const render = (): void => {
        showTab();
        if (tab === 'decor') {
          decorShop.render();
          return;
        }
        if (tab === 'trees') {
          treeShop.render();
          return;
        }
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
        later.textContent = `The stock changes with the seasons. ${capitalize(next)} brings ${
          CROP_IDS.filter(
            (c) => inSeason(hooks.data.crops[c], next) && !inSeason(hooks.data.crops[c], cal.season),
          )
            .map((c) => hooks.data.crops[c].name.toLowerCase())
            .join(', ') || 'no new seeds'
        }.`;
        renderCards(state);
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
