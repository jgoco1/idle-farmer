// Town projects (GDD §12.2, BALANCE.md §13.3): six big projects on the Community Board's Town tab.
// Each has 3 or 4 stages of gold and items, donated a bit at a time. Finishing a stage changes the town
// and adds charm; finishing the last one gives the project's reward, which is quality of life or
// cosmetic only (a decoration set, decoration slots, a music loop, a goal slot, or a cosmetic): never
// gold, income or a multiplier. Nothing here has a timer.

import type { GameState, TownProjectState } from '../core/state';
import type { GameData } from '../data';
import { GOAL_SLOTS, GOAL_SLOTS_HALL_BONUS, DECOR_BASE_SLOTS, TOWN_PROJECT_SCALE } from '../data/balance';
import {
  isTownProjectId,
  TOWN_PROJECT_IDS,
  type DecorSetId,
  type ItemId,
  type TownProjectId,
} from '../data/ids';
import type { ItemStack, TownProjectDef, TownProjectReward } from '../data/types';
import { noteCharm, charmOf } from './charm';
import { fail, OK, type ActionResult, type SimContext } from './context';
import { spend } from './economy';
import { countItem, removeItem } from './inventory';
import { isUnlocked, unlockHint } from './unlocks';

export type ProjectStatus = 'done' | 'open' | 'locked';

export function projectStagesDone(state: GameState, data: GameData, id: TownProjectId): number {
  return Math.min(state.town.projects[id]?.stagesDone ?? 0, data.townProjects[id].stages.length);
}

export function isProjectDone(state: GameState, data: GameData, id: TownProjectId): boolean {
  return projectStagesDone(state, data, id) >= data.townProjects[id].stages.length;
}

export function projectStatus(state: GameState, data: GameData, id: TownProjectId): ProjectStatus {
  if (isProjectDone(state, data, id)) return 'done';
  return isUnlocked(state, data.townProjects[id].requires, data) ? 'open' : 'locked';
}

/** A stage's gold after `TOWN_PROJECT_SCALE`. */
export function stageGold(def: TownProjectDef, stage: number): number {
  return Math.round((def.stages[stage]?.gold ?? 0) * TOWN_PROJECT_SCALE);
}

/** What the current stage of a project needs, and what has been given so far. Null when the project is done. */
export interface StageStatus {
  /** 0-based index of the stage being worked on. */
  index: number;
  goldNeed: number;
  goldHave: number;
  items: { item: ItemId; need: number; have: number; done: boolean }[];
}

export function currentStage(state: GameState, data: GameData, id: TownProjectId): StageStatus | null {
  const def = data.townProjects[id];
  const index = projectStagesDone(state, data, id);
  const stage = def.stages[index];
  if (!stage) return null;
  const st = state.town.projects[id];
  const goldNeed = stageGold(def, index);
  return {
    index,
    goldNeed,
    goldHave: Math.min(goldNeed, st?.gold ?? 0),
    items: stage.items.map((s) => {
      const have = Math.min(s.qty, st?.items.find((x) => x.item === s.item)?.qty ?? 0);
      return { item: s.item, need: s.qty, have, done: have >= s.qty };
    }),
  };
}

/** Units given and units needed over the whole project: gold counts by the gold, items by the unit. Drives progress bars. */
export function projectProgress(
  state: GameState,
  data: GameData,
  id: TownProjectId,
): { done: number; total: number } {
  const def = data.townProjects[id];
  return { done: projectStagesDone(state, data, id), total: def.stages.length };
}

export function completedProjects(state: GameState, data: GameData): TownProjectId[] {
  return TOWN_PROJECT_IDS.filter((id) => isProjectDone(state, data, id));
}

// ---- rewards (derived from the completed projects)

function rewardsOf(state: GameState, data: GameData): TownProjectReward[] {
  const out: TownProjectReward[] = [];
  for (const id of TOWN_PROJECT_IDS)
    if (isProjectDone(state, data, id)) out.push(...data.townProjects[id].rewards);
  return out;
}

/** How many decorations may stand on the land: the base plus each finished project's slots. */
export function decorSlotCap(state: GameState, data: GameData): number {
  if (Object.keys(state.town.projects).length === 0) return DECOR_BASE_SLOTS;
  let cap = DECOR_BASE_SLOTS;
  for (const r of rewardsOf(state, data)) if (r.kind === 'decorSlots') cap += r.count;
  return cap;
}

/** Goals on the board: three, and one more once the Community Hall stands. */
export function goalSlots(state: GameState, data: GameData): number {
  if (!state.town.projects.community_hall) return GOAL_SLOTS;
  return GOAL_SLOTS + (isProjectDone(state, data, 'community_hall') ? GOAL_SLOTS_HALL_BONUS : 0);
}

/** Whether a decoration set is open (Cottage always; the others with a finished project). */
export function decorSetOpen(state: GameState, data: GameData, set: DecorSetId): boolean {
  return isUnlocked(state, data.decorSets[set].unlock, data);
}

/** Whether a finished project gave this cosmetic. Indexed loops, no allocation: the renderer asks every frame. */
export function hasCosmetic(
  state: GameState,
  data: GameData,
  what: Extract<TownProjectReward, { kind: 'cosmetic' }>['what'],
): boolean {
  for (let i = 0; i < TOWN_PROJECT_IDS.length; i++) {
    const id = TOWN_PROJECT_IDS[i]!;
    if (!state.town.projects[id] || !isProjectDone(state, data, id)) continue;
    const rewards = data.townProjects[id].rewards;
    for (let k = 0; k < rewards.length; k++) {
      const r = rewards[k]!;
      if (r.kind === 'cosmetic' && r.what === what) return true;
    }
  }
  return false;
}

export function hasMusicTrack(state: GameState, data: GameData, track: 'town_square'): boolean {
  for (let i = 0; i < TOWN_PROJECT_IDS.length; i++) {
    const id = TOWN_PROJECT_IDS[i]!;
    if (!state.town.projects[id] || !isProjectDone(state, data, id)) continue;
    const rewards = data.townProjects[id].rewards;
    for (let k = 0; k < rewards.length; k++) {
      const r = rewards[k]!;
      if (r.kind === 'musicTrack' && r.id === track) return true;
    }
  }
  return false;
}

// ---- donating

function entryOf(state: GameState, id: TownProjectId): TownProjectState {
  return (state.town.projects[id] ??= { stagesDone: 0, gold: 0, items: [] });
}

/**
 * The `donateProject` action: gives `gold` and/or up to `qty` of `item` toward the project's current
 * stage (never more than it still needs, never more than the player has). Filling the last gap
 * finishes the stage: the town changes, charm rises by 10 and the next stage opens.
 */
export function donateProject(
  state: GameState,
  ctx: SimContext,
  id: TownProjectId,
  gold: number | undefined,
  item: ItemId | undefined,
  qty: number | undefined,
): ActionResult {
  if (!isTownProjectId(id)) return fail('There is no such project.');
  const def = ctx.data.townProjects[id];
  if (isProjectDone(state, ctx.data, id)) return fail(`${def.name} is finished.`);
  if (!isUnlocked(state, def.requires, ctx.data)) {
    return fail(unlockHint(state, ctx.data, def.requires) ?? `${def.name} is not open yet.`);
  }
  const wantsGold = gold !== undefined;
  const wantsItem = item !== undefined;
  if (!wantsGold && !wantsItem) return fail('Choose what to give.');
  const stage = currentStage(state, ctx.data, id)!;
  let gaveGold = 0;
  let gaveItems = 0;
  if (wantsGold) {
    if (!Number.isInteger(gold) || gold <= 0) return fail('Choose how much gold to give.');
    const missing = stage.goldNeed - stage.goldHave;
    if (missing <= 0) return fail('This stage has all the gold it needs.');
    const give = Math.min(gold, missing, state.gold);
    if (give <= 0) return fail("You don't have any gold to give.");
    gaveGold = give;
  }
  const name = item ? (ctx.data.items[item]?.name ?? item) : '';
  let slot: StageStatus['items'][number] | undefined;
  if (wantsItem) {
    slot = stage.items.find((s) => s.item === item);
    if (!slot) return fail(`This stage does not need ${name}.`);
    if (!Number.isInteger(qty) || (qty ?? 0) <= 0) return fail('Choose how many to give.');
    const missing = slot.need - slot.have;
    if (missing <= 0) return fail(`This stage has all the ${name} it needs.`);
    gaveItems = Math.min(qty!, missing, countItem(state.inventory, item!));
    if (gaveItems <= 0) return fail(`You don't have any ${name}.`);
  }
  const charmBefore = charmOf(state, ctx.data);
  const entry = entryOf(state, id);
  if (gaveGold > 0) {
    spend(state, gaveGold);
    entry.gold += gaveGold;
  }
  if (gaveItems > 0 && item) {
    // Plain stacks first: hearty dishes are worth more to eat.
    const plain = Math.min(gaveItems, countItem(state.inventory, item, false));
    if (plain > 0) removeItem(state.inventory, item, plain, false);
    if (gaveItems - plain > 0) removeItem(state.inventory, item, gaveItems - plain, true);
    const held = entry.items.find((s: ItemStack) => s.item === item);
    if (held) held.qty += gaveItems;
    else entry.items.push({ item, qty: gaveItems });
  }
  ctx.events.push({ type: 'projectDonated', project: id, gold: gaveGold, items: gaveItems });
  const now = currentStage(state, ctx.data, id)!;
  if (now.goldHave >= now.goldNeed && now.items.every((s) => s.done)) {
    entry.stagesDone += 1;
    entry.gold = 0;
    entry.items = [];
    const complete = entry.stagesDone >= def.stages.length;
    ctx.events.push({ type: 'projectStageDone', project: id, stage: entry.stagesDone, complete });
    noteCharm(state, ctx, charmBefore);
  }
  return OK;
}

/** Bag stacks (and gold) that could go into the current stage right now, for the "Give" buttons. */
export function donatableItems(state: GameState, data: GameData, id: TownProjectId): ItemStack[] {
  const stage = currentStage(state, data, id);
  if (!stage) return [];
  return stage.items
    .filter((s) => !s.done && countItem(state.inventory, s.item) > 0)
    .map((s) => ({ item: s.item, qty: Math.min(s.need - s.have, countItem(state.inventory, s.item)) }));
}
