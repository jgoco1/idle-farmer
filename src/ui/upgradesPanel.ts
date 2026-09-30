// The Upgrades panel: farm expansions (phase 03) and the backpack (phase 03). Phase 04 adds the
// automation and tool upgrades here, phase 05 the fishing locations and gear, phase 06 the kitchen.

import type { ExpansionId, UpgradeId } from '../data/ids';
import { FARM_EXPANSIONS } from '../data/expansions';
import type { ActionResult } from '../systems/context';
import { expansionStatus } from '../systems/expansions';
import { isUnlocked, unlockHint } from '../systems/unlocks';
import { upgradeCost, upgradeLevel } from '../systems/upgrades';
import { h } from './dom';
import type { PanelDef } from './panel';
import type { GameViewHooks } from './panels';

export interface UpgradesHooks extends GameViewHooks {
  buyExpansion(id: ExpansionId): ActionResult;
  buyUpgrade(id: UpgradeId): ActionResult;
}

/** Upgrades offered so far, in panel order. */
const UPGRADE_IDS: readonly UpgradeId[] = ['backpack'];

export function upgradesPanel(hooks: UpgradesHooks): PanelDef {
  return {
    id: 'upgrades',
    title: 'Upgrades',
    icon: '⚙',
    live: true,
    build(body) {
      const gold = h('p', { class: 'shop-gold' });
      const farm = h('div', { class: 'crate-list' });
      const storage = h('div', { class: 'crate-list' });
      const msg = h('p', { class: 'form-msg', role: 'status' });
      body.append(
        gold,
        h('h3', { text: 'Farm' }),
        farm,
        h('h3', { text: 'Storage' }),
        storage,
        msg,
        h('p', { class: 'muted', text: 'Sprinklers, a farmhand and better tools are on their way.' }),
      );

      const say = (r: ActionResult, ok: string): void => {
        msg.textContent = r.ok ? ok : r.reason;
        msg.className = r.ok ? 'form-msg form-ok' : 'form-msg form-error';
      };

      const card = (
        key: string,
        title: string,
        text: string,
        state: 'owned' | 'available' | 'locked',
        button: HTMLButtonElement | null,
      ): HTMLElement =>
        h(
          'div',
          { class: `crate-row upgrade-row is-${state}`, 'data-upgrade': key },
          h('span', {
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
          button ? h('div', { class: 'btn-row' }, button) : null,
        );

      const render = (): void => {
        const state = hooks.state();
        const focusedKey =
          document.activeElement instanceof HTMLElement && body.contains(document.activeElement)
            ? document.activeElement.closest<HTMLElement>('[data-upgrade]')?.dataset.upgrade
            : undefined;
        gold.textContent = `You have ${state.gold.toLocaleString('en-US')}g`;

        farm.replaceChildren(
          ...FARM_EXPANSIONS.map((id) => {
            const def = hooks.data.expansions[id];
            const status = expansionStatus(state, hooks.data, id);
            const grid = def.grid ? `${def.grid.cols} × ${def.grid.rows} plots` : '';
            let button: HTMLButtonElement | null = null;
            let text = `${def.description} (${grid})`;
            if (status === 'available') {
              button = h('button', {
                type: 'button',
                class: 'btn btn-small btn-primary',
                text: `Buy · ${def.price.toLocaleString('en-US')}g`,
                'aria-label': `Buy ${def.name} for ${def.price} gold`,
                disabled: state.gold < def.price,
              });
              button.addEventListener('click', () => {
                say(hooks.buyExpansion(id), `${def.name}: your field is now ${grid}.`);
                render();
              });
            } else if (status === 'locked') {
              text = `${def.price.toLocaleString('en-US')}g · ${unlockHint(state, hooks.data, def.requires) ?? ''}`;
            } else {
              text = `Done · ${grid}`;
            }
            return card(id, def.name, text, status, button);
          }),
        );

        storage.replaceChildren(
          ...UPGRADE_IDS.map((id) => {
            const def = hooks.data.upgrades[id]!;
            const level = upgradeLevel(state, id);
            const maxed = level >= def.max;
            const unlocked = isUnlocked(state, def.requires);
            const cost = maxed ? 0 : upgradeCost(def, level);
            const title = `${def.name} · level ${level}/${def.max}`;
            let text = `Now ${def.effectText[level] ?? ''}`;
            let button: HTMLButtonElement | null = null;
            if (!maxed && unlocked) {
              text += ` → ${def.effectText[level + 1] ?? ''}`;
              button = h('button', {
                type: 'button',
                class: 'btn btn-small btn-primary',
                text: `Upgrade · ${cost.toLocaleString('en-US')}g`,
                'aria-label': `Upgrade ${def.name} for ${cost} gold`,
                disabled: state.gold < cost,
              });
              button.addEventListener('click', () => {
                say(hooks.buyUpgrade(id), `${def.name} upgraded: ${def.effectText[level + 1] ?? ''}.`);
                render();
              });
            } else if (!maxed) {
              text += ` · ${unlockHint(state, hooks.data, def.requires) ?? ''}`;
            }
            return card(id, title, text, maxed ? 'owned' : unlocked ? 'available' : 'locked', button);
          }),
        );
        if (focusedKey)
          body.querySelector<HTMLElement>(`[data-upgrade="${focusedKey}"] button:not([disabled])`)?.focus();
      };
      return { refresh: render };
    },
  };
}
