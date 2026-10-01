// v2 phase 02: town projects (donating a bit at a time, stages, rewards), and the milestones, goal and
// goal slot that decorations, charm and projects bring (BALANCE.md §13.3, §13.9).

import { describe, expect, it } from 'vitest';
import { applyAction, type Action } from '../src/core/actions';
import type { GameEvent } from '../src/core/events';
import { makeContext } from '../src/core/sim';
import { createInitialState, type GameState } from '../src/core/state';
import { buildCalendar } from '../src/core/time';
import { GAME_DATA } from '../src/data';
import { CHARM_PER_PROJECT_STAGE, GOAL_SLOTS, TOWN_PROJECT_SCALE } from '../src/data/balance';
import { TOWN_PROJECT_IDS, type ItemId, type TownProjectId } from '../src/data/ids';
import { TOWN_PROJECTS } from '../src/data/townProjects';
import { WORLD_LAYOUT } from '../src/data/world';
import { charmOf } from '../src/systems/charm';
import { addItem, countItem } from '../src/systems/inventory';
import { goalAchievable, refillGoals, runProgression } from '../src/systems/progression';
import {
  completedProjects,
  currentStage,
  decorSetOpen,
  decorSlotCap,
  goalSlots,
  hasCosmetic,
  hasMusicTrack,
  isProjectDone,
  projectStatus,
  stageGold,
} from '../src/systems/townProjects';
import { createRng } from '../src/core/rng';
import { farmPoints } from '../src/systems/skills';
import { at, NY, setFarmLevel } from './helpers';

const T = at(NY, 2026, 1, 7, 12);
/** A gold figure from BALANCE.md §13.3 as the game charges it (after TOWN_PROJECT_SCALE). */
const sc = (n: number): number => Math.round(n * TOWN_PROJECT_SCALE);

function farm(gold = 100_000_000): GameState {
  const s = createInitialState(T, NY, 1);
  s.gold = gold;
  setFarmLevel(s, 7);
  return s;
}

function run(s: GameState, action: Action): { ok: boolean; reason?: string; events: GameEvent[] } {
  const events: GameEvent[] = [];
  const ctx = makeContext(s, GAME_DATA, buildCalendar(T, s.calendar, NY), events);
  const r = applyAction(s, ctx, action);
  return { ...r, events };
}

const give = (s: GameState, project: TownProjectId, gold?: number, item?: ItemId, qty?: number) =>
  run(s, { type: 'donateProject', project, gold, item, qty });

/** Pays a whole stage: its gold, and each item (put into the bag first). */
function finishStage(s: GameState, project: TownProjectId): GameEvent[] {
  const stage = currentStage(s, GAME_DATA, project)!;
  const events: GameEvent[] = [];
  for (const it of stage.items) {
    addItem(s.inventory, it.item, it.need - it.have);
    events.push(...give(s, project, undefined, it.item, it.need - it.have).events);
  }
  events.push(...give(s, project, stage.goldNeed - stage.goldHave).events);
  return events;
}

const finish = (s: GameState, project: TownProjectId): void => {
  while (!isProjectDone(s, GAME_DATA, project)) finishStage(s, project);
};

describe('the project data (BALANCE.md §13.3)', () => {
  it('has six projects of 3 stages, 4 for the hall: 19 stages and about 8.5M gold', () => {
    expect(TOWN_PROJECT_IDS).toHaveLength(6);
    const stages = TOWN_PROJECT_IDS.map((id) => TOWN_PROJECTS[id].stages.length);
    expect(stages).toEqual([3, 3, 3, 3, 3, 4]);
    const gold = (id: TownProjectId): number => TOWN_PROJECTS[id].stages.reduce((n, s) => n + s.gold, 0);
    expect(TOWN_PROJECT_IDS.map(gold)).toEqual([400_000, 600_000, 900_000, 1_200_000, 1_800_000, 3_600_000]);
    expect(TOWN_PROJECT_IDS.reduce((n, id) => n + gold(id), 0)).toBe(8_500_000);
    // The doc's figures are before the scale, which the simulator's gold-still-to-spend check tunes (BALANCE.md §13.12).
    expect(TOWN_PROJECT_SCALE).toBeGreaterThan(0.5);
    expect(TOWN_PROJECT_SCALE).toBeLessThanOrEqual(1);
  });

  it('sits where the world layout says, and every stage names what changes', () => {
    for (const id of TOWN_PROJECT_IDS) {
      const p = TOWN_PROJECTS[id];
      expect(p.site).toEqual(id === 'old_bridge' ? WORLD_LAYOUT.bridge : WORLD_LAYOUT.townSites[id]);
      for (const st of p.stages) expect(st.sceneChange.length).toBeGreaterThanOrEqual(4);
      expect(p.rewardText.length).toBeGreaterThan(10);
    }
  });

  it('opens in the doc’s order', () => {
    expect(TOWN_PROJECTS.old_bridge.requires).toEqual([{ kind: 'farmLevel', level: 7 }]);
    expect(TOWN_PROJECTS.fountain.requires).toEqual([{ kind: 'farmLevel', level: 7 }]);
    expect(TOWN_PROJECTS.bakery.requires).toEqual([{ kind: 'townProject', id: 'old_bridge' }]);
    expect(TOWN_PROJECTS.bandstand.requires).toEqual([{ kind: 'townProject', id: 'fountain' }]);
    expect(TOWN_PROJECTS.lighthouse.requires).toEqual([{ kind: 'townProject', id: 'bakery' }]);
    expect(TOWN_PROJECTS.community_hall.requires).toHaveLength(5);
  });

  it('gives only quality-of-life and cosmetic rewards: never gold, income or a multiplier', () => {
    for (const id of TOWN_PROJECT_IDS) {
      for (const r of TOWN_PROJECTS[id].rewards) {
        expect(['decorSet', 'decorSlots', 'musicTrack', 'goalSlot', 'cosmetic']).toContain(r.kind);
      }
    }
    expect(TOWN_PROJECTS.old_bridge.rewards).toContainEqual({ kind: 'decorSet', set: 'seaside' });
    expect(TOWN_PROJECTS.bakery.rewards).toContainEqual({ kind: 'decorSet', set: 'harvest_fair' });
    expect(TOWN_PROJECTS.bandstand.rewards).toContainEqual({ kind: 'musicTrack', id: 'town_square' });
    expect(TOWN_PROJECTS.community_hall.rewards).toContainEqual({ kind: 'goalSlot', count: 1 });
  });

  it('every stage item exists in the game, eggs and milk included', () => {
    for (const id of TOWN_PROJECT_IDS)
      for (const st of TOWN_PROJECTS[id].stages)
        for (const it of st.items) expect(GAME_DATA.items[it.item], it.item).toBeDefined();
    const asked = (project: keyof typeof TOWN_PROJECTS, stage: number) =>
      TOWN_PROJECTS[project].stages[stage - 1]!.items.map((i) => `${i.item}×${i.qty}`);
    expect(asked('bakery', 2)).toEqual(['egg×30']);
    expect(asked('community_hall', 1)).toEqual(['milk×30']);
    expect(asked('community_hall', 3)).toEqual(['large_egg×10']);
  });
});

describe('who may start which project', () => {
  it('the bridge and the fountain need Farm Level 7; the rest follow the chain', () => {
    const s = createInitialState(T, NY, 1);
    s.gold = 1e9;
    expect(projectStatus(s, GAME_DATA, 'old_bridge')).toBe('locked');
    const r = give(s, 'old_bridge', 1_000);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Farm Level 7/);
    expect(s.gold).toBe(1e9);
    setFarmLevel(s, 7);
    expect(projectStatus(s, GAME_DATA, 'old_bridge')).toBe('open');
    expect(projectStatus(s, GAME_DATA, 'bakery')).toBe('locked');
    expect(give(s, 'bakery', 1_000).reason).toMatch(/Old Bridge/);
    finish(s, 'old_bridge');
    expect(projectStatus(s, GAME_DATA, 'old_bridge')).toBe('done');
    expect(projectStatus(s, GAME_DATA, 'bakery')).toBe('open');
    expect(projectStatus(s, GAME_DATA, 'lighthouse')).toBe('locked');
  });

  it('the hall opens when the other five are done', () => {
    const s = farm();
    for (const id of ['old_bridge', 'fountain', 'bakery', 'bandstand'] as const) finish(s, id);
    expect(projectStatus(s, GAME_DATA, 'community_hall')).toBe('locked');
    finish(s, 'lighthouse');
    expect(projectStatus(s, GAME_DATA, 'community_hall')).toBe('open');
  });
});

describe('donating a bit at a time', () => {
  it('takes gold in parts, never more than the stage needs or than you have', () => {
    const need = sc(60_000); // stage 1 of the bridge
    const have = Math.round(need * 0.8);
    const s = farm(have);
    const r = give(s, 'old_bridge', need / 10);
    expect(r.ok).toBe(true);
    expect(s.gold).toBe(have - need / 10);
    expect(s.town.projects.old_bridge).toEqual({ stagesDone: 0, gold: need / 10, items: [] });
    expect(r.events).toContainEqual({
      type: 'projectDonated',
      project: 'old_bridge',
      gold: need / 10,
      items: 0,
    });
    // Asking for more than you have gives what you have.
    give(s, 'old_bridge', 1_000_000);
    expect(s.gold).toBe(0);
    expect(s.town.projects.old_bridge!.gold).toBe(have);
    expect(give(s, 'old_bridge', 1).ok).toBe(false); // nothing left to give
    s.gold = 100_000;
    give(s, 'old_bridge', 1_000_000); // only what is still missing
    expect(s.gold).toBe(100_000 - (need - have));
    expect(currentStage(s, GAME_DATA, 'old_bridge')!.goldHave).toBe(need);
    expect(give(s, 'old_bridge', 1).reason).toMatch(/all the gold/);
  });

  it('takes items like a bundle slot: from the bag, up to what the stage needs', () => {
    const s = farm();
    addItem(s.inventory, 'driftwood', 14);
    const r = give(s, 'old_bridge', undefined, 'driftwood', 6);
    expect(r.ok).toBe(true);
    expect(countItem(s.inventory, 'driftwood')).toBe(8);
    expect(currentStage(s, GAME_DATA, 'old_bridge')!.items).toEqual([
      { item: 'driftwood', need: 10, have: 6, done: false },
    ]);
    give(s, 'old_bridge', undefined, 'driftwood', 99);
    expect(countItem(s.inventory, 'driftwood')).toBe(4); // only 4 more were missing
    expect(give(s, 'old_bridge', undefined, 'driftwood', 1).ok).toBe(false);
  });

  it('refuses things the stage does not ask for, empty bags and nonsense', () => {
    const s = farm();
    expect(give(s, 'old_bridge', undefined, 'wheat', 5).reason).toMatch(/does not need/);
    expect(give(s, 'old_bridge', undefined, 'driftwood', 5).reason).toMatch(/don't have/);
    expect(give(s, 'old_bridge').reason).toMatch(/Choose/);
    expect(give(s, 'old_bridge', -5).ok).toBe(false);
    expect(give(s, 'old_bridge', 1.5).ok).toBe(false);
    expect(give(s, 'nonsense' as TownProjectId, 5).ok).toBe(false);
  });

  it('gold and an item together in one action', () => {
    const s = farm();
    addItem(s.inventory, 'driftwood', 10);
    const r = give(s, 'old_bridge', 10_000, 'driftwood', 10);
    expect(r.ok).toBe(true);
    expect(r.events).toContainEqual({
      type: 'projectDonated',
      project: 'old_bridge',
      gold: 10_000,
      items: 10,
    });
  });

  it('finishing a stage needs both the gold and the items, then the next stage opens with a clean slate', () => {
    const s = farm();
    expect(give(s, 'old_bridge', sc(60_000)).events.map((e) => e.type)).not.toContain('projectStageDone'); // items missing
    addItem(s.inventory, 'driftwood', 10);
    const done = give(s, 'old_bridge', undefined, 'driftwood', 10);
    expect(done.events).toContainEqual({
      type: 'projectStageDone',
      project: 'old_bridge',
      stage: 1,
      complete: false,
    });
    expect(s.town.projects.old_bridge).toEqual({ stagesDone: 1, gold: 0, items: [] });
    const next = currentStage(s, GAME_DATA, 'old_bridge')!;
    expect(next.index).toBe(1);
    expect(next.goldNeed).toBe(sc(120_000));
    expect(next.items).toEqual([]);
  });

  it('a finished stage adds 10 charm and reports it', () => {
    const s = farm();
    expect(charmOf(s, GAME_DATA)).toBe(0);
    addItem(s.inventory, 'driftwood', 10);
    give(s, 'old_bridge', sc(60_000));
    const r = give(s, 'old_bridge', undefined, 'driftwood', 10);
    expect(charmOf(s, GAME_DATA)).toBe(CHARM_PER_PROJECT_STAGE);
    expect(r.events).toContainEqual({ type: 'charmChanged', from: 0, to: 10 });
  });

  it('a finished project refuses more', () => {
    const s = farm();
    finish(s, 'old_bridge');
    expect(give(s, 'old_bridge', 100).reason).toMatch(/finished/);
    expect(currentStage(s, GAME_DATA, 'old_bridge')).toBeNull();
  });

  it('the gold figure is scaled by TOWN_PROJECT_SCALE', () => {
    expect(stageGold(TOWN_PROJECTS.fountain, 1)).toBe(Math.round(200_000 * TOWN_PROJECT_SCALE));
  });
});

describe('what finishing a project gives', () => {
  it('the bridge opens the Seaside set and 40 decoration slots', () => {
    const s = farm();
    expect(decorSetOpen(s, GAME_DATA, 'seaside')).toBe(false);
    expect(decorSlotCap(s, GAME_DATA)).toBe(100);
    const events = (() => {
      const all: GameEvent[] = [];
      while (!isProjectDone(s, GAME_DATA, 'old_bridge')) all.push(...finishStage(s, 'old_bridge'));
      return all;
    })();
    expect(events.filter((e) => e.type === 'projectStageDone')).toHaveLength(3);
    expect(events).toContainEqual({
      type: 'projectStageDone',
      project: 'old_bridge',
      stage: 3,
      complete: true,
    });
    expect(decorSetOpen(s, GAME_DATA, 'seaside')).toBe(true);
    expect(decorSlotCap(s, GAME_DATA)).toBe(140);
    expect(charmOf(s, GAME_DATA)).toBe(30);
  });

  it('the bakery opens Harvest Fair and the bakery smoke; the fountain, bandstand and lighthouse give slots', () => {
    const s = farm();
    finish(s, 'old_bridge');
    finish(s, 'fountain');
    expect(decorSlotCap(s, GAME_DATA)).toBe(180);
    expect(hasCosmetic(s, GAME_DATA, 'bakerySmoke')).toBe(false);
    finish(s, 'bakery');
    expect(decorSetOpen(s, GAME_DATA, 'harvest_fair')).toBe(true);
    expect(hasCosmetic(s, GAME_DATA, 'bakerySmoke')).toBe(true);
    expect(hasMusicTrack(s, GAME_DATA, 'town_square')).toBe(false);
    finish(s, 'bandstand');
    expect(hasMusicTrack(s, GAME_DATA, 'town_square')).toBe(true);
    expect(hasCosmetic(s, GAME_DATA, 'bandSaturday')).toBe(true);
    finish(s, 'lighthouse');
    expect(hasCosmetic(s, GAME_DATA, 'lighthouseBeam')).toBe(true);
    expect(decorSlotCap(s, GAME_DATA)).toBe(260);
    expect(completedProjects(s, GAME_DATA)).toHaveLength(5);
  });

  it('the hall gives a 4th goal slot and the festival lights, and the board fills it', () => {
    const s = farm();
    expect(goalSlots(s, GAME_DATA)).toBe(GOAL_SLOTS);
    for (const id of TOWN_PROJECT_IDS) finish(s, id);
    expect(goalSlots(s, GAME_DATA)).toBe(4);
    expect(hasCosmetic(s, GAME_DATA, 'festivalLights')).toBe(true);
    expect(charmOf(s, GAME_DATA)).toBe(190);
    const events: GameEvent[] = [];
    const ctx = makeContext(s, GAME_DATA, buildCalendar(T, s.calendar, NY), events);
    s.progression.goals = [];
    runProgression(s, ctx);
    expect(s.progression.goals).toHaveLength(4);
  });

  it('half a hall is no extra slot', () => {
    const s = farm();
    s.town.projects.community_hall = { stagesDone: 3, gold: 0, items: [] };
    expect(goalSlots(s, GAME_DATA)).toBe(GOAL_SLOTS);
  });

  it('finishing every project costs the doc’s 8.5M (scaled) and pays back only the two milestone purses (m18, m19), no gold of its own', () => {
    const s = farm(1e10);
    for (const id of TOWN_PROJECT_IDS) finish(s, id);
    const cost = TOWN_PROJECT_IDS.reduce(
      (n, id) => n + TOWN_PROJECTS[id].stages.reduce((m, _st, i) => m + stageGold(TOWN_PROJECTS[id], i), 0),
      0,
    );
    expect(s.gold).toBe(1e10 - cost + 10_000 + 20_000);
    expect(s.stats.lifetimeGold).toBe(30_000);
  });
});

describe('the v2 milestones and the charm goal', () => {
  /** One progression pass, as the step after any action does: a (null) event makes it look at the state again. */
  function settle(s: GameState): GameEvent[] {
    const events: GameEvent[] = [{ type: 'charmChanged', from: 0, to: 0 }];
    const ctx = makeContext(s, GAME_DATA, buildCalendar(T, s.calendar, NY), events);
    runProgression(s, ctx);
    return events;
  }
  const done = (s: GameState): string[] => s.progression.milestones.done;

  it('m16 comes from state: a save that already owns a parcel gets it, and its pieces, on the first step', () => {
    const s = farm();
    s.land.parcels.push('orchard');
    const events = settle(s);
    expect(done(s)).toContain('m16_first_parcel');
    expect(s.decor.owned.cobble_path).toBe(10);
    expect(s.decor.owned.flower_bed).toBe(1);
    expect(events.map((e) => e.type)).toContain('questDone');
    settle(s);
    expect(s.decor.owned.cobble_path).toBe(10); // once
  });

  it('m17 on the first decoration, paying a lamp; m18 at charm 25 paying 10,000g; m23 at charm 100 paying a rose arch', () => {
    const s = farm(1_000_000);
    settle(s);
    run(s, { type: 'buyDecor', decor: 'flower_bed', qty: 10 });
    const placed = run(s, { type: 'placeDecor', decor: 'flower_bed', col: 6, row: 9 });
    expect(placed.ok).toBe(true);
    expect(done(s)).toContain('m17_first_decor');
    expect(s.decor.owned.garden_lamp).toBe(1);
    expect(done(s)).not.toContain('m18_charm_25');
    // Eight more flower beds' worth: charm is 3 per bed for 3 beds (9), so reach 25 with projects.
    const gold = s.gold;
    s.town.projects.fountain = { stagesDone: 2, gold: 0, items: [] }; // 20
    settle(s);
    expect(charmOf(s, GAME_DATA)).toBe(23);
    expect(done(s)).not.toContain('m18_charm_25');
    run(s, { type: 'placeDecor', decor: 'flower_bed', col: 9, row: 9 });
    expect(done(s)).toContain('m18_charm_25');
    expect(s.gold).toBe(gold + 10_000);
    s.town.projects.old_bridge = { stagesDone: 3, gold: 0, items: [] };
    s.town.projects.bakery = { stagesDone: 3, gold: 0, items: [] };
    s.town.projects.fountain = { stagesDone: 3, gold: 0, items: [] };
    settle(s);
    expect(done(s)).not.toContain('m23_charm_100'); // 90 + 6
    s.town.projects.bandstand = { stagesDone: 1, gold: 0, items: [] };
    settle(s);
    expect(charmOf(s, GAME_DATA)).toBe(106);
    expect(done(s)).toContain('m23_charm_100');
    expect(s.decor.owned.rose_arch).toBe(1);
  });

  it('m19 on the first finished stage, paying 20,000g', () => {
    const s = farm();
    settle(s);
    const gold = s.gold;
    give(s, 'fountain', sc(120_000));
    expect(done(s)).toContain('m19_first_project');
    expect(s.gold).toBe(gold - sc(120_000) + 20_000);
  });

  it('the v2 milestones are not farm points', () => {
    const s = farm();
    s.progression.milestones.done.push(
      'm01_first_seed',
      'm16_first_parcel',
      'm17_first_decor',
      'm23_charm_100',
    );
    expect(farmPoints(s)).toBe(1); // only m01 counts
  });

  it('the Raise-charm goal needs a placed decoration and something to place or buy', () => {
    const s = farm();
    s.progression.goals = [];
    const rng = createRng(s);
    refillGoals(s, GAME_DATA, rng, 'spring');
    expect(s.progression.goals.map((g) => g.template)).not.toContain('raise_charm');
    s.progression.milestones.done.push('m17_first_decor');
    const found: number[] = [];
    for (let i = 0; i < 40; i++) {
      s.progression.goals = [];
      refillGoals(s, GAME_DATA, rng, 'spring');
      const g = s.progression.goals.find((x) => x.template === 'raise_charm');
      if (g) {
        expect(g.objective.kind).toBe('gainCharm');
        found.push((g.objective as { amount: number }).amount);
        expect(goalAchievable(s, GAME_DATA, 'spring', g)).toBe(true);
      }
    }
    expect(found.length).toBeGreaterThan(0);
    for (const amount of found) expect(amount).toBeGreaterThanOrEqual(3);
  });

  it('a Raise-charm goal counts charm gained, and finishes with its gold', () => {
    const s = farm(1_000_000);
    settle(s);
    s.progression.milestones.done.push('m17_first_decor');
    s.progression.goals = [
      {
        template: 'raise_charm',
        objective: { kind: 'gainCharm', amount: 5 },
        progress: 0,
        rewards: [{ kind: 'gold', amount: 777 }],
      },
    ];
    run(s, { type: 'buyDecor', decor: 'flower_bed', qty: 3 });
    run(s, { type: 'placeDecor', decor: 'flower_bed', col: 6, row: 9 }); // +3
    expect(s.progression.goals[0]?.progress).toBe(3);
    const gold = s.gold;
    run(s, { type: 'placeDecor', decor: 'flower_bed', col: 8, row: 9 }); // +3: done
    expect(s.gold).toBeGreaterThanOrEqual(gold + 777);
    expect(s.progression.goalsDone).toBe(1);
    // Taking a piece away is not "gaining" charm.
    s.progression.goals = [
      {
        template: 'raise_charm',
        objective: { kind: 'gainCharm', amount: 5 },
        progress: 0,
        rewards: [{ kind: 'gold', amount: 1 }],
      },
    ];
    run(s, { type: 'pickUpDecor', id: 1 });
    expect(s.progression.goals[0]?.progress).toBe(0);
  });
});
