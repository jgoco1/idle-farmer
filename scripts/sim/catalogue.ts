// "Gold still to spend" (BALANCE.md §13.4): the catalogue of everything a player can buy once or up
// to a natural count, at list price, and how much of it a farm already owns. Counts v1 (every upgrade
// level, placeable, expansion and recipe card), the land parcels (v2-01), and (v2-02) the decorations
// (the counted copies of each piece, 40 path and 30 fence tiles a set, the farmhouse pieces) and the town
// projects' gold. Later v2 phases add saplings and the ranch.

import type { GameState } from '../../src/core/state';
import type { GameData } from '../../src/data';
import {
  DECOR_IDS,
  PARCEL_IDS,
  RECIPE_IDS,
  TOWN_PROJECT_IDS,
  type ExpansionId,
  type UpgradeId,
} from '../../src/data/ids';
import { projectStagesDone, stageGold } from '../../src/systems/townProjects';
import { ownedDecor } from '../../src/systems/decor';
import { upgradeCost, upgradeLevel } from '../../src/systems/upgrades';

function upgradeSpend(data: GameData, id: UpgradeId, levels: number): number {
  const def = data.upgrades[id];
  if (!def) return 0;
  let sum = 0;
  for (let l = 0; l < Math.min(levels, def.max); l++) sum += upgradeCost(def, l);
  return sum;
}

/** Copies of a piece the catalogue counts: its charm-counted copies, 40 path or 30 fence tiles, or the one farmhouse piece. */
export function decorCopies(data: GameData, id: (typeof DECOR_IDS)[number]): number {
  const d = data.decor[id];
  if (d.kind !== 'place') return 1;
  return d.autotile === 'path' ? 40 : d.autotile === 'fence' ? 30 : d.counted;
}

/** The parts of the catalogue, at list price. */
export function catalogueParts(data: GameData): {
  v1: number;
  parcels: number;
  decor: number;
  projects: number;
} {
  let v1 = 0;
  for (const id of Object.keys(data.upgrades) as UpgradeId[])
    v1 += upgradeSpend(data, id, data.upgrades[id]!.max);
  for (const id of Object.keys(data.expansions) as ExpansionId[]) v1 += data.expansions[id].price;
  for (const id of RECIPE_IDS) {
    const d = data.recipes[id].discovery;
    if (d.kind === 'card') v1 += d.price;
  }
  const parcels = PARCEL_IDS.reduce((sum, id) => sum + data.parcels[id].price, 0);
  const decor = DECOR_IDS.reduce((sum, id) => sum + decorCopies(data, id) * data.decor[id].price, 0);
  const projects = TOWN_PROJECT_IDS.reduce(
    (sum, id) =>
      sum + data.townProjects[id].stages.reduce((n, _s, i) => n + stageGold(data.townProjects[id], i), 0),
    0,
  );
  return { v1, parcels, decor, projects };
}

export function catalogueTotal(data: GameData): number {
  const p = catalogueParts(data);
  return p.v1 + p.parcels + p.decor + p.projects;
}

/** The list price of everything in the catalogue this farm already owns (a known recipe card counts). */
export function catalogueOwned(s: GameState, data: GameData): number {
  let sum = 0;
  for (const id of Object.keys(data.upgrades) as UpgradeId[])
    sum += upgradeSpend(data, id, upgradeLevel(s, id));
  for (const id of s.expansions) sum += data.expansions[id]?.price ?? 0;
  for (const id of s.kitchen.known) {
    const d = data.recipes[id]?.discovery;
    if (d?.kind === 'card') sum += d.price;
  }
  for (const id of s.land.parcels) sum += data.parcels[id].price;
  for (const id of DECOR_IDS)
    sum += Math.min(ownedDecor(s, id), decorCopies(data, id)) * data.decor[id].price;
  for (const id of TOWN_PROJECT_IDS) {
    const def = data.townProjects[id];
    const done = projectStagesDone(s, data, id);
    for (let i = 0; i < done; i++) sum += stageGold(def, i);
    sum += Math.min(s.town.projects[id]?.gold ?? 0, done < def.stages.length ? stageGold(def, done) : 0);
  }
  return sum;
}

/** Gold still to spend: the catalogue less what is owned. */
export function toSpend(s: GameState, data: GameData): number {
  return Math.max(0, catalogueTotal(data) - catalogueOwned(s, data));
}
