// The Town tab of the Community Board (GDD §12.2): six big projects, each with 3 or 4 stages of gold and items
// that you donate a bit at a time (10%, 25% or all you can of the gold; items like a bundle slot). Finishing a
// stage changes the town and adds charm. Rewards are quality of life only: never gold or income.

import type { GameState } from '../core/state';
import type { GameData } from '../data';
import { PROJECT_DONATE_SHARES } from '../data/balance';
import { TOWN_PROJECT_IDS, type ItemId, type TownProjectId } from '../data/ids';
import { spriteDataUrl } from '../render/spriteCache';
import type { ActionResult } from '../systems/context';
import { countItem } from '../systems/inventory';
import { currentStage, projectStatus } from '../systems/townProjects';
import { unlockHints } from '../systems/unlocks';
import { h } from './dom';

export interface TownHooks {
  data: GameData;
  state(): GameState;
  donate(project: TownProjectId, gold?: number, item?: ItemId, qty?: number): ActionResult;
}

const g = (n: number): string => `${n.toLocaleString('en-US')}g`;

function bar(value: number, max: number, label: string): HTMLElement {
  const frac = max > 0 ? Math.min(1, Math.max(0, value / max)) : 1;
  const fill = h('div', { class: 'meter-fill goal-fill' });
  fill.style.width = `${Math.round(frac * 100)}%`;
  return h(
    'div',
    {
      class: 'meter goal-meter',
      role: 'progressbar',
      'aria-valuemin': 0,
      'aria-valuemax': max,
      'aria-valuenow': Math.min(value, max),
      'aria-label': label,
    },
    fill,
  );
}

export function renderTown(root: HTMLElement, hooks: TownHooks, onChange: () => void): void {
  const st = hooks.state();
  const data = hooks.data;
  const msg = h('p', { class: 'form-msg', role: 'status' });
  const cards = TOWN_PROJECT_IDS.map((id) => {
    const def = data.townProjects[id];
    const status = projectStatus(st, data, id);
    const stage = currentStage(st, data, id);
    const done = st.town.projects[id]?.stagesDone ?? 0;
    const body: (HTMLElement | null)[] = [];
    const give = (gold?: number, item?: ItemId, qty?: number): void => {
      const r = hooks.donate(id, gold, item, qty);
      msg.textContent = r.ok ? 'Thank you! The town is grateful.' : r.reason;
      msg.className = r.ok ? 'form-msg form-ok' : 'form-msg form-error';
      onChange();
    };
    if (status === 'locked') {
      body.push(
        h('p', {
          class: 'seed-note',
          text: `Not open yet. ${unlockHints(st, data, def.requires).join(' ')}`,
        }),
      );
    } else if (stage) {
      const next = def.stages[stage.index]!;
      body.push(
        h('p', {
          class: 'seed-note',
          text: `Stage ${stage.index + 1} of ${def.stages.length}: ${next.sceneChange}.`,
        }),
      );
      const missing = stage.goldNeed - stage.goldHave;
      if (stage.goldNeed > 0) {
        const buttons = [
          ...PROJECT_DONATE_SHARES.map((share) => {
            const amount = Math.min(missing, Math.max(1, Math.round(stage.goldNeed * share)));
            const b = h('button', {
              type: 'button',
              class: 'btn btn-small',
              'data-donate': `${id}:${Math.round(share * 100)}`,
              text: `${Math.round(share * 100)}% · ${g(amount)}`,
              disabled: missing <= 0 || st.gold <= 0,
            });
            b.addEventListener('click', () => give(amount));
            return b;
          }),
          (() => {
            const all = Math.min(missing, st.gold);
            const b = h('button', {
              type: 'button',
              class: 'btn btn-small btn-primary',
              'data-donate': `${id}:all`,
              text: all > 0 ? `All I can · ${g(all)}` : 'All I can',
              disabled: all <= 0,
            });
            b.addEventListener('click', () => give(all));
            return b;
          })(),
        ];
        body.push(
          h(
            'div',
            { class: 'project-gold' },
            h('span', { text: `Gold ${g(stage.goldHave)} / ${g(stage.goldNeed)}` }),
            bar(stage.goldHave, stage.goldNeed, `${def.name} gold`),
            h('div', { class: 'btn-row' }, ...buttons),
          ),
        );
      }
      for (const slot of stage.items) {
        const name = data.items[slot.item]?.name ?? slot.item;
        const bag = countItem(st.inventory, slot.item);
        const btn =
          !slot.done && bag > 0
            ? h('button', {
                type: 'button',
                class: 'btn btn-small',
                'data-give': `${id}:${slot.item}`,
                text: `Give ${Math.min(bag, slot.need - slot.have)}`,
                'aria-label': `Give ${name} to ${def.name}`,
              })
            : null;
        btn?.addEventListener('click', () => give(undefined, slot.item, slot.need - slot.have));
        body.push(
          h(
            'div',
            { class: `bundle-slot${slot.done ? ' is-filled' : ''}`, 'data-slot': slot.item },
            h('img', {
              class: 'pixel',
              alt: '',
              width: 24,
              height: 24,
              src: spriteDataUrl(`item_${slot.item}`),
            }),
            h(
              'div',
              { class: 'bundle-slot-text' },
              h('span', { class: 'bundle-slot-name', text: name }),
              h('span', { class: 'seed-note', text: `${slot.have} / ${slot.need}` }),
            ),
            btn,
          ),
        );
      }
    } else {
      body.push(h('p', { class: 'seed-note', text: 'Finished. Come and look at the square!' }));
    }
    return h(
      'div',
      {
        class: `bundle project${status === 'done' ? ' is-done' : ''}${status === 'locked' ? ' is-locked' : ''}`,
        'data-project': id,
      },
      h('div', { class: 'goal-title', text: `${def.name}${status === 'done' ? ' ✓' : ''}` }),
      h('div', { class: 'seed-note', text: def.flavor }),
      bar(done, def.stages.length, `${def.name} stages`),
      ...body,
      h('div', {
        class: 'goal-reward',
        text: `${status === 'done' ? 'Reward earned' : 'Reward'}: ${def.rewardText}`,
      }),
    );
  });
  root.replaceChildren(
    h('p', {
      class: 'muted',
      text: 'Town projects: give gold and items a bit at a time. Each finished stage changes the town and adds 10 charm. Rewards are for looks and comfort only, never income.',
    }),
    msg,
    ...cards,
  );
}
