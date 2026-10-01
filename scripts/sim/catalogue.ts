// "Gold still to spend" (BALANCE.md §13.4): the catalogue of everything a player can buy once or up
// to a natural count, at list price, and how much of it a farm already owns. v2 phase 01 counts v1
// (every upgrade level, placeable, expansion and recipe card) and the land parcels; later v2 phases
// add saplings, the ranch, decorations and town projects here.

import type { GameState } from '../../src/core/state';
import type { GameData } from '../../src/data';
import { PARCEL_IDS, RECIPE_IDS, type ExpansionId, type UpgradeId } from '../../src/data/ids';
import { upgradeCost, upgradeLevel } from '../../src/systems/upgrades';

function upgradeSpend(data: GameData, id: UpgradeId, levels: number): number {
  const def = data.upgrades[id];
  if (!def) return 0;
  let sum = 0;
  for (let l = 0; l < Math.min(levels, def.max); l++) sum += upgradeCost(def, l);
  return sum;
}

/** The parts of the catalogue, at list price. */
export function catalogueParts(data: GameData): { v1: number; parcels: number } {
  let v1 = 0;
  for (const id of Object.keys(data.upgrades) as UpgradeId[])
    v1 += upgradeSpend(data, id, data.upgrades[id]!.max);
  for (const id of Object.keys(data.expansions) as ExpansionId[]) v1 += data.expansions[id].price;
  for (const id of RECIPE_IDS) {
    const d = data.recipes[id].discovery;
    if (d.kind === 'card') v1 += d.price;
  }
  const parcels = PARCEL_IDS.reduce((sum, id) => sum + data.parcels[id].price, 0);
  return { v1, parcels };
}

export function catalogueTotal(data: GameData): number {
  const p = catalogueParts(data);
  return p.v1 + p.parcels;
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
  return sum;
}

/** Gold still to spend: the catalogue less what is owned. */
export function toSpend(s: GameState, data: GameData): number {
  return Math.max(0, catalogueTotal(data) - catalogueOwned(s, data));
}
