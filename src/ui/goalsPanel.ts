// The Goals panel (GDD §6.6): the goal board, the story milestones, the three skills, the Community
// Board (bundles), the Fish Collection and the statistics. It only reads state; donating an item and
// placing the golden scarecrow go through `dispatch` and the `placeGolden` hook. All rules live in
// src/systems/progression.ts, skills.ts and bundles.ts.

import type { Action } from '../core/actions';
import { DAY_MS, formatDuration } from '../core/time';
import { MAX_SKILL_LEVEL } from '../data/balance';
import { BUNDLE_IDS } from '../data/quests';
import { SKILL_BLURB, SKILL_ICONS, SKILL_IDS, SKILL_NAMES } from '../data/skills';
import type { ItemId } from '../data/ids';
import { spriteDataUrl } from '../render/spriteCache';
import { bundleProgress, bundleSlots, donatable, haveForBundle, isBundleDone } from '../systems/bundles';
import type { ActionResult } from '../systems/context';
import { stockOf } from '../systems/placement';
import { goalTarget, goalText, rewardsText } from '../systems/progression';
import { farmPoints, pointsForFarmLevel, skillLevel, skillProgress } from '../systems/skills';
import { farmLevel } from '../systems/unlocks';
import { h } from './dom';
import type { PanelDef } from './panel';
import type { GameViewHooks } from './panels';
import { renderFishCollection } from './fishingPanel';
import { renderTown } from './townPanel';
import { charmBreakdown, nextCharmUnlock } from '../systems/charm';
import { decorSlotCap, goalSlots } from '../systems/townProjects';
import { slotsUsed } from '../systems/decor';
import type { ItemId as ItemIdT, TownProjectId } from '../data/ids';

export interface GoalsHooks extends GameViewHooks {
  dispatch(action: Action): ActionResult;
  /** Gives toward a town project's current stage (through the purchase guard). */
  donateProject(project: TownProjectId, gold?: number, item?: ItemIdT, qty?: number): ActionResult;
  /** Enters placement mode for the golden scarecrow. */
  placeGolden(): void;
}

type Tab = 'goals' | 'milestones' | 'skills' | 'collections' | 'town' | 'fish' | 'stats';

const TABS: readonly [Tab, string][] = [
  ['goals', 'Goals'],
  ['milestones', 'Milestones'],
  ['skills', 'Skills'],
  ['collections', 'Collections'],
  ['town', 'Town'],
  ['fish', 'Fish'],
  ['stats', 'Stats'],
];

const icon = (sprite: string, size = 24): HTMLElement =>
  h('img', { class: 'pixel', alt: '', width: size, height: size, src: spriteDataUrl(sprite) });

/** A labelled progress bar (an ARIA progressbar over the shared `.meter` look). */
export function progressBar(value: number, max: number, label: string): HTMLElement {
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

export function goalsPanel(hooks: GoalsHooks): { def: PanelDef; showTown(): void } {
  let tab: Tab = 'goals';
  const def: PanelDef = {
    id: 'goals',
    title: 'Goals',
    icon: '★',
    live: true,
    refreshMs: 1000,
    build(body) {
      const tabs = h('div', { class: 'tabs goal-tabs', role: 'tablist' });
      const sections = new Map<Tab, HTMLElement>();
      const buttons = new Map<Tab, HTMLButtonElement>();
      for (const [id, label] of TABS) {
        const b = h('button', {
          type: 'button',
          class: 'btn btn-small',
          role: 'tab',
          'data-tab': id,
          text: label,
        });
        b.addEventListener('click', () => {
          tab = id;
          refresh();
        });
        buttons.set(id, b);
        tabs.append(b);
        sections.set(id, h('div', { class: 'goal-section', 'data-section': id }));
      }
      body.append(tabs, ...sections.values());

      // What each tab last drew, so a refresh with nothing new does not rebuild the DOM under the cursor.
      const drawn = new Map<Tab, string>();

      // ---- Goals
      const renderGoals = (root: HTMLElement): void => {
        const st = hooks.state();
        const level = farmLevel(st);
        const points = farmPoints(st);
        const from = pointsForFarmLevel(level);
        const to = pointsForFarmLevel(level + 1);
        const head = h(
          'div',
          { class: 'goal-head' },
          h('strong', { text: `Farm Level ${level}` }),
          h('span', {
            class: 'seed-note',
            text: ` · ${Math.max(0, to - points)} more farm point${to - points === 1 ? '' : 's'} to Level ${level + 1}`,
          }),
          progressBar(Math.max(0, points - from), to - from, 'Progress to the next Farm Level'),
          h('p', {
            class: 'muted',
            text: 'Skill levels and finished milestones both count as farm points. Each Farm Level opens new seeds, recipes and upgrades.',
          }),
        );
        const charm = charmBreakdown(st, hooks.data);
        const nextUnlock = nextCharmUnlock(st, hooks.data);
        const charmCard = h(
          'div',
          { class: 'goal-head charm-head', 'data-testid': 'charm' },
          h('strong', { text: `Charm ${charm.total}` }),
          h('span', {
            class: 'seed-note',
            text: nextUnlock
              ? ` · ${nextUnlock.amount - charm.total} more to open ${nextUnlock.pieces.map((id) => hooks.data.decor[id].name).join(', ')}`
              : ' · every decoration is open',
          }),
          nextUnlock ? progressBar(charm.total, nextUnlock.amount, 'Charm toward the next decoration') : null,
          h('p', {
            class: 'muted',
            text: `From decorations ${charm.pieces}, the farmhouse ${charm.farmhouse} and town projects ${charm.projects}. ${slotsUsed(st)} of ${decorSlotCap(st, hooks.data)} decoration slots used. Charm only opens more pieces; it never changes prices or income.`,
          }),
        );
        const cards = st.progression.goals.map((g) => {
          const target = goalTarget(g.objective);
          const daily = g.objective.kind === 'earnGold' && g.objective.withinOneDay === true;
          return h(
            'div',
            { class: 'goal-card', 'data-goal': g.template },
            h('div', { class: 'goal-title', text: goalText(hooks.data, g) }),
            progressBar(g.progress, target, goalText(hooks.data, g)),
            h(
              'div',
              { class: 'goal-line' },
              h('span', {
                text: `${Math.min(g.progress, target).toLocaleString('en-US')} / ${target.toLocaleString('en-US')}`,
              }),
              h('span', { class: 'goal-reward', text: `Reward: ${rewardsText(hooks.data, g.rewards)}` }),
            ),
            h('div', {
              class: 'seed-note',
              text: daily
                ? 'Starts again at 6:00 every morning.'
                : hooks.data.goalTemplates[g.template].flavor,
            }),
          );
        });
        root.replaceChildren(
          head,
          charmCard,
          h('h3', { class: 'kitchen-head', text: `Goal board · ${st.progression.goalsDone} finished` }),
          ...cards,
          ...(cards.length < goalSlots(st, hooks.data)
            ? [h('p', { class: 'muted', text: 'New goals appear as you unlock more of the farm.' })]
            : []),
        );
      };

      // ---- Milestones
      const renderMilestones = (root: HTMLElement): void => {
        const st = hooks.state();
        const done = st.progression.milestones.done;
        const next = hooks.data.milestones.find((m) => !done.includes(m.id as never));
        const rows = hooks.data.milestones.map((m) => {
          const isDone = done.includes(m.id as never);
          const cls = `milestone${isDone ? ' is-done' : m === next ? ' is-current' : ''}`;
          return h(
            'div',
            { class: cls, 'data-milestone': m.id },
            h('span', {
              class: 'milestone-mark',
              'aria-hidden': 'true',
              text: isDone ? '✓' : m === next ? '➜' : '·',
            }),
            h(
              'div',
              {},
              h('div', { class: 'goal-title', text: m.title }),
              h('div', { class: 'seed-note', text: isDone || m === next ? m.flavor : 'Later in the story…' }),
              isDone
                ? null
                : h('div', { class: 'goal-reward', text: `Reward: ${rewardsText(hooks.data, m.rewards)}` }),
            ),
          );
        });
        root.replaceChildren(
          h('p', {
            class: 'muted',
            text: `${done.length} of ${hooks.data.milestones.length} milestones. Do them in any order; the arrow shows the next step.`,
          }),
          progressBar(done.length, hooks.data.milestones.length, 'Milestones finished'),
          ...rows,
        );
      };

      // ---- Skills
      const renderSkills = (root: HTMLElement): void => {
        const st = hooks.state();
        root.replaceChildren(
          ...SKILL_IDS.map((skill) => {
            const level = skillLevel(st, skill);
            const { into, need } = skillProgress(st, skill);
            const perks = hooks.data.perks.filter((p) => p.skill === skill);
            const nextPerk = perks.find((p) => p.level > level);
            return h(
              'div',
              { class: 'skill-card', 'data-skill': skill },
              h(
                'div',
                { class: 'skill-head' },
                icon(SKILL_ICONS[skill], 32),
                h(
                  'div',
                  {},
                  h('strong', {
                    text: `${SKILL_NAMES[skill]} · Level ${level}${level >= MAX_SKILL_LEVEL ? ' (max)' : ''}`,
                  }),
                  h('div', { class: 'seed-note', text: SKILL_BLURB[skill] }),
                ),
              ),
              progressBar(need === null ? 1 : into, need ?? 1, `${SKILL_NAMES[skill]} XP`),
              h('div', {
                class: 'seed-note',
                text:
                  need === null
                    ? 'Fully skilled!'
                    : `${into.toLocaleString('en-US')} / ${need.toLocaleString('en-US')} XP to Level ${level + 1}`,
              }),
              h(
                'ul',
                { class: 'perk-list' },
                ...perks.map((p) =>
                  h(
                    'li',
                    { class: `perk${p.level <= level ? ' is-got' : p === nextPerk ? ' is-next' : ''}` },
                    `Level ${p.level}: ${p.text}`,
                  ),
                ),
              ),
            );
          }),
        );
      };

      // ---- Collections (the Community Board)
      const renderCollections = (root: HTMLElement): void => {
        const st = hooks.state();
        const cards = BUNDLE_IDS.map((id) => {
          const def = hooks.data.bundles[id];
          const done = isBundleDone(st, id);
          const { have, need } = bundleProgress(st, hooks.data, id);
          const give = donatable(st, hooks.data, id);
          const slots = bundleSlots(st, hooks.data, id).map((s) => {
            const name = hooks.data.items[s.item]?.name ?? s.item;
            const bag = haveForBundle(st, s.item);
            const btn =
              !done && !s.done && bag > 0
                ? h('button', {
                    type: 'button',
                    class: 'btn btn-small',
                    'data-give': s.item,
                    text: `Give ${Math.min(bag, s.need - s.have)}`,
                    'aria-label': `Give ${name} to ${def.name}`,
                  })
                : null;
            btn?.addEventListener('click', () => {
              const r = hooks.dispatch({
                type: 'donate',
                bundle: id,
                item: s.item as ItemId,
                qty: s.need - s.have,
              });
              if (!r.ok) btn.title = r.reason;
            });
            return h(
              'div',
              { class: `bundle-slot${s.done ? ' is-filled' : ''}`, 'data-slot': s.item },
              icon(`item_${s.item}`, 24),
              h(
                'div',
                { class: 'bundle-slot-text' },
                h('span', { class: 'bundle-slot-name', text: name }),
                h('span', { class: 'seed-note', text: `${s.have} / ${s.need}` }),
              ),
              btn,
            );
          });
          const giveAll =
            !done && give.length > 1
              ? h('button', {
                  type: 'button',
                  class: 'btn btn-small',
                  'data-give-all': id,
                  text: 'Give everything I can',
                })
              : null;
          giveAll?.addEventListener('click', () => {
            for (const s of give) hooks.dispatch({ type: 'donate', bundle: id, item: s.item, qty: s.qty });
          });
          let extra: HTMLElement | null = null;
          if (done && def.reward.kind === 'goldenScarecrow') {
            const left = stockOf(st, 'golden_scarecrow');
            extra =
              left > 0
                ? h('button', {
                    type: 'button',
                    class: 'btn btn-small btn-primary',
                    'data-place-golden': '',
                    text: 'Place the golden scarecrow',
                  })
                : h('button', {
                    type: 'button',
                    class: 'btn btn-small',
                    'data-place-golden': '',
                    text: 'Move it',
                  });
            extra.addEventListener('click', () => hooks.placeGolden());
          }
          return h(
            'div',
            { class: `bundle${done ? ' is-done' : ''}`, 'data-bundle': id },
            h('div', { class: 'goal-title', text: `${def.name}${done ? ' ✓' : ''}` }),
            h('div', { class: 'seed-note', text: def.flavor }),
            progressBar(have, need, `${def.name} bundle`),
            h('div', { class: 'bundle-slots' }, ...slots),
            h(
              'div',
              { class: 'goal-line' },
              h('span', {
                class: 'goal-reward',
                text: `${done ? 'Reward earned' : 'Reward'}: ${def.rewardText}`,
              }),
              giveAll,
              extra,
            ),
          );
        });
        const finished = st.progression.completedBundles.length;
        root.replaceChildren(
          h('p', {
            class: 'muted',
            text: `Community Board: ${finished} of ${BUNDLE_IDS.length} bundles finished. Give items from your bag; each finished bundle rewards you for good.`,
          }),
          ...cards,
        );
      };

      // ---- Fish collection (also on the Fishing panel)
      const fishSummary = h('p', { class: 'muted' });
      const fishGrid = h('div', { class: 'fish-collection' });
      sections.get('fish')!.append(fishSummary, fishGrid);

      // ---- Stats
      const renderStats = (root: HTMLElement): void => {
        const st = hooks.state();
        const cal = hooks.calendar();
        const days = Math.max(0, Math.floor((cal.nowMs - st.calendar.createdAt) / DAY_MS));
        const rows: [string, string][] = [
          ['Lifetime gold', `${st.stats.lifetimeGold.toLocaleString('en-US')}g`],
          ['Gold earned today', `${st.stats.goldToday.toLocaleString('en-US')}g`],
          ['Crops harvested', st.stats.cropsHarvested.toLocaleString('en-US')],
          ['Fish caught', st.stats.fishCaught.toLocaleString('en-US')],
          ['Dishes cooked', st.stats.dishesCooked.toLocaleString('en-US')],
          ['Fruit picked', st.stats.fruitPicked.toLocaleString('en-US')],
          ['Eggs and milk collected', st.stats.productsCollected.toLocaleString('en-US')],
          ['Dishes eaten', st.stats.dishesEaten.toLocaleString('en-US')],
          ['Items shipped', st.stats.itemsShipped.toLocaleString('en-US')],
          ['Goals finished', st.progression.goalsDone.toLocaleString('en-US')],
          ['Milestones', `${st.progression.milestones.done.length} / ${hooks.data.milestones.length}`],
          ['Bundles', `${st.progression.completedBundles.length} / ${BUNDLE_IDS.length}`],
          ['Charm', String(charmBreakdown(st, hooks.data).total)],
          ['Decorations placed', String(st.decor.placed.length)],
          [
            'Town project stages',
            `${Object.values(st.town.projects).reduce((n, p) => n + (p?.stagesDone ?? 0), 0)} / ${Object.values(hooks.data.townProjects).reduce((n, p) => n + p.stages.length, 0)}`,
          ],
          ['Farm Level', String(farmLevel(st))],
          ['Time played', formatDuration(st.meta.playTimeMs)],
          ['Farm started', days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`],
          ['Seasons passed', String(st.calendar.maxWeekIndex)],
        ];
        root.replaceChildren(
          h(
            'dl',
            { class: 'stats-list' },
            ...rows.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v, 'data-stat': k })]),
          ),
        );
      };

      const renderTownTab = (root: HTMLElement): void =>
        renderTown(root, { data: hooks.data, state: hooks.state, donate: hooks.donateProject }, () => {
          drawn.delete('town');
          refresh();
        });

      const renderers: Record<Exclude<Tab, 'fish'>, (root: HTMLElement) => void> = {
        goals: renderGoals,
        town: renderTownTab,
        milestones: renderMilestones,
        skills: renderSkills,
        collections: renderCollections,
        stats: renderStats,
      };

      /** What the tab shows, as a string: equal strings mean nothing to redraw. */
      const signature = (id: Tab): string => {
        const st = hooks.state();
        switch (id) {
          case 'goals':
            return JSON.stringify([
              st.progression.goals,
              st.progression.goalsDone,
              farmPoints(st),
              farmLevel(st),
              st.decor.placed.length,
              st.decor.farmhouse,
              st.town.projects,
            ]);
          case 'town':
            return JSON.stringify([
              st.town.projects,
              st.gold,
              st.inventory.slots.map((x) => (x ? `${x.item}${x.qty}` : '')),
              st.progression.milestones.done.length,
              farmLevel(st),
            ]);
          case 'milestones':
            return JSON.stringify(st.progression.milestones.done);
          case 'skills':
            return JSON.stringify(st.progression.skills);
          case 'collections':
            return JSON.stringify([
              st.progression.bundles,
              st.progression.completedBundles,
              st.inventory.slots.map((s) => (s ? `${s.item}${s.qty}` : '')),
              st.placed.length,
            ]);
          case 'fish':
            return JSON.stringify(st.fishing.collection);
          case 'stats':
            return JSON.stringify([
              st.stats,
              st.progression.goalsDone,
              Math.floor(st.meta.playTimeMs / 1000),
              st.calendar.maxWeekIndex,
            ]);
        }
      };

      function refresh(): void {
        for (const [id, el] of sections) el.hidden = id !== tab;
        for (const [id, b] of buttons) {
          b.setAttribute('aria-selected', String(id === tab));
          b.classList.toggle('is-active', id === tab);
        }
        const sig = signature(tab);
        if (drawn.get(tab) === sig) return;
        drawn.set(tab, sig);
        if (tab === 'fish') renderFishCollection(fishSummary, fishGrid, hooks.state(), hooks.data);
        else renderers[tab](sections.get(tab)!);
      }
      return { refresh };
    },
  };
  return {
    def,
    showTown() {
      tab = 'town';
    },
  };
}
