// The ranch (GDD §12.4, BALANCE.md §13.6–13.7): a coop of hens, a barn of cows and a silo in the Old
// Paddock. Each housing building runs one production cycle on **simulated time**. At the end of a
// cycle every animal in turn, if its building's store has room and its trough has a portion, eats the
// portion and puts one product in the store; otherwise it skips the cycle and nothing else happens.
// Animals are gentle: hunger never costs anything. No sickness, no loss, no mood.
//
// Offline correctness: cycles are `floor((cycleMs + dt) / interval)`, processed one by one in animal
// order, so one large step gives exactly what many small ones do. Nothing here changes a rate mid-step
// (troughs are refilled by actions and at shipping-bin pickups, both step boundaries), so the ranch does
// not report to `msToNextSimEvent`. The only RNG draw is the hens' large-egg roll, and `tickRanch` runs
// first in the tick, so its draws keep their order relative to every other system's.

import type { AnimalState, BuildingState, GameState } from '../core/state';
import type { GameData } from '../data';
import { AUTO_COLLECT_XP_SHARE, SILO_RESERVE } from '../data/balance';
import {
  isAnimalId,
  isBuildingId,
  isFeedId,
  type AnimalId,
  type AnimalProductId,
  type BuildingId,
  type FeedId,
} from '../data/ids';
import type { AnimalDef, BuildingDef, BuildingLevelDef, ItemStack } from '../data/types';
import { inTileRect, fixedBlockReason } from '../data/world';
import { stowHarvest, shipsAutomatically } from './autoSeller';
import { bundleBonuses } from './bundles';
import { fail, OK, type ActionResult, type SimContext } from './context';
import { decorAt } from './decor';
import { canAfford, spend } from './economy';
import { feedAvailable, feedRoom, storeFeed, takeFeed } from './feedStore';
import { countItem, removeItem, spaceFor } from './inventory';
import { ownsParcel } from './parcels';
import { collectAllHives } from './apiary';
import { collectAllPresses, resumeRepeating } from './press';
import { isUnlocked, unlockHint } from './unlocks';
import { hasFlag } from './upgrades';

// ---- derived values

export function buildingDef(data: GameData, b: Pick<BuildingState, 'kind'>): BuildingDef {
  return data.buildings[b.kind];
}

export function levelDef(data: GameData, b: Pick<BuildingState, 'kind' | 'level'>): BuildingLevelDef {
  return data.buildings[b.kind].levels[b.level - 1]!;
}

/** Whether the Old Paddock is owned (the Ranch panel and the coop open with it). */
export function ranchOpen(state: GameState): boolean {
  return ownsParcel(state, 'yard');
}

export function buildingOfKind(state: GameState, kind: BuildingId): BuildingState | undefined {
  return state.ranch.buildings.find((b) => b.kind === kind);
}

export function buildingById(state: GameState, id: number): BuildingState | undefined {
  return state.ranch.buildings.find((b) => b.id === id);
}

export function animalsIn(state: GameState, buildingId: number): AnimalState[] {
  return state.ranch.animals.filter((a) => a.building === buildingId);
}

export function animalCount(state: GameState, buildingId: number): number {
  let n = 0;
  for (const a of state.ranch.animals) if (a.building === buildingId) n++;
  return n;
}

export function capacityOf(data: GameData, b: BuildingState): number {
  return levelDef(data, b).capacity;
}

/** Feed portions the trough holds: the level's size, plus the Barnyard bundle's 50%. */
export function troughSize(state: GameState, data: GameData, b: BuildingState): number {
  const base = levelDef(data, b).trough;
  return Math.floor(base * (1 + bundleBonuses(state, data).troughBonus));
}

export function storeSize(data: GameData, b: BuildingState): number {
  return levelDef(data, b).store;
}

export function storeCount(b: BuildingState): number {
  let n = 0;
  for (let i = 0; i < b.store.length; i++) n += b.store[i]!.qty;
  return n;
}

/** The feed a housing building's animals eat, or null for the silo. */
export function feedOf(data: GameData, b: Pick<BuildingState, 'kind'>): FeedId | null {
  const houses = data.buildings[b.kind].houses;
  return houses ? data.animals[houses].feed : null;
}

export function animalDefOf(data: GameData, b: Pick<BuildingState, 'kind'>): AnimalDef | null {
  const houses = data.buildings[b.kind].houses;
  return houses ? data.animals[houses] : null;
}

/** The building an animal of `kind` lives in, if it has been built. */
export function homeOf(state: GameState, data: GameData, kind: AnimalId): BuildingState | undefined {
  return buildingOfKind(state, data.animals[kind].building);
}

/** Total animals of a kind. */
export function animalsOfKind(state: GameState, kind: AnimalId): number {
  let n = 0;
  for (const a of state.ranch.animals) if (a.kind === kind) n++;
  return n;
}

/** Hungry: animals live here and the trough is empty (the edge pip and the Ranch panel say so gently). */
export function troughIsEmpty(state: GameState, b: BuildingState): boolean {
  return b.trough <= 0 && animalCount(state, b.id) > 0;
}

export function storeIsFull(data: GameData, b: BuildingState): boolean {
  const size = storeSize(data, b);
  return size > 0 && storeCount(b) >= size;
}

/** Whether the silo (at any level) stands in the yard. */
export function siloFlag(state: GameState, data: GameData, flag: 'autoFeed' | 'autoMill'): boolean {
  const silo = buildingOfKind(state, 'silo');
  return silo !== undefined && (levelDef(data, silo).flags?.includes(flag) ?? false);
}

/** Farming XP for `qty` of `product`: a quarter when the Collecting Basket took it. */
export function productXp(data: GameData, product: AnimalProductId, qty: number, auto: boolean): number {
  const per = data.animals[product === 'milk' ? 'cow' : 'chicken'].xp[product] ?? 0;
  return qty * per * (auto ? AUTO_COLLECT_XP_SHARE : 1);
}

// ---- where things stand

/** The tile a housing building's trough is drawn on: just right of its bottom-right corner. */
export function troughTile(
  data: GameData,
  b: Pick<BuildingState, 'kind' | 'at'>,
): { col: number; row: number } {
  const fp = data.buildings[b.kind].footprint;
  return { col: b.at.col + fp.cols, row: b.at.row + fp.rows - 1 };
}

/** Every tile a building at (col, row) reserves: its footprint, plus the trough tile for a housing building. */
function reservedTiles(
  data: GameData,
  kind: BuildingId,
  col: number,
  row: number,
): { col: number; row: number }[] {
  const def = data.buildings[kind];
  const out: { col: number; row: number }[] = [];
  for (let r = 0; r < def.footprint.rows; r++)
    for (let c = 0; c < def.footprint.cols; c++) out.push({ col: col + c, row: row + r });
  if (def.houses) out.push(troughTile(data, { kind, at: { col, row } }));
  return out;
}

/** The building whose footprint (or trough tile) covers world tile (col, row). */
export function buildingAtTile(
  state: GameState,
  data: GameData,
  col: number,
  row: number,
  includeTrough = true,
): BuildingState | undefined {
  for (const b of state.ranch.buildings) {
    const def = data.buildings[b.kind];
    if (
      col >= b.at.col &&
      col < b.at.col + def.footprint.cols &&
      row >= b.at.row &&
      row < b.at.row + def.footprint.rows
    )
      return b;
    if (includeTrough && def.houses) {
      const t = troughTile(data, b);
      if (t.col === col && t.row === row) return b;
    }
  }
  return undefined;
}

/** The building whose sprite covers (col, row): its footprint and the rows of roof above it. */
export function buildingAtSprite(
  state: GameState,
  data: GameData,
  col: number,
  row: number,
): BuildingState | undefined {
  for (const b of state.ranch.buildings) {
    const fp = data.buildings[b.kind].footprint;
    const top = b.kind === 'silo' ? b.at.row - 2 : b.at.row - 1;
    if (col >= b.at.col && col < b.at.col + fp.cols && row >= top && row < b.at.row + fp.rows) return b;
  }
  return undefined;
}

/** Why building `kind` cannot stand with its top-left at (col, row), or null. `movingId` is a building being moved. */
export function buildingPlacementProblem(
  state: GameState,
  data: GameData,
  kind: BuildingId,
  col: number,
  row: number,
  movingId?: number,
): string | null {
  const def = data.buildings[kind];
  if (!ownsParcel(state, def.placeIn)) return `Buy the ${data.parcels[def.placeIn].name} first.`;
  if (!Number.isInteger(col) || !Number.isInteger(row)) return 'That is not a tile.';
  const yard = data.parcels[def.placeIn].rect;
  for (const t of reservedTiles(data, kind, col, row)) {
    if (!inTileRect(yard, t.col, t.row)) {
      return def.houses && t.col >= yard.col + yard.cols
        ? `Leave a tile on the right for the trough, inside the ${data.parcels[def.placeIn].name}.`
        : `${def.name} must stand inside the ${data.parcels[def.placeIn].name}.`;
    }
    const fixed = fixedBlockReason(t.col, t.row);
    if (fixed) return fixed;
    const other = buildingAtTile(state, data, t.col, t.row);
    if (other && other.id !== movingId) return `${data.buildings[other.kind].name} is already there.`;
    const decor = decorAt(state, data, t.col, t.row);
    if (decor) return `${data.decor[decor.decor].name} is in the way. Pick it up first.`;
  }
  if (def.houses && row + def.footprint.rows > yard.row + yard.rows - 1)
    return 'Leave a row of grass in front for the animals to walk on.';
  return null;
}

// ---- building and upgrading

function nextBuildingId(state: GameState): number {
  return state.ranch.buildings.reduce((m, b) => Math.max(m, b.id), 0) + 1;
}

export function buildBuilding(
  state: GameState,
  ctx: SimContext,
  kind: BuildingId,
  col: number,
  row: number,
): ActionResult {
  if (!isBuildingId(kind)) return fail('There is no such building.');
  const def = ctx.data.buildings[kind];
  if (!ranchOpen(state)) return fail('Buy the Old Paddock first.');
  if (buildingOfKind(state, kind)) return fail(`You already have a ${def.name.toLowerCase()}.`);
  const level = def.levels[0]!;
  if (!isUnlocked(state, level.requires, ctx.data))
    return fail(unlockHint(state, ctx.data, level.requires) ?? `${def.name} is not available yet.`);
  const problem = buildingPlacementProblem(state, ctx.data, kind, col, row);
  if (problem) return fail(problem);
  if (!canAfford(state, level.price))
    return fail(`You need ${level.price.toLocaleString('en-US')}g for that.`);
  spend(state, level.price);
  const id = nextBuildingId(state);
  state.ranch.buildings.push({ id, kind, level: 1, at: { col, row }, trough: 0, store: [], cycleMs: 0 });
  ctx.events.push({ type: 'purchased', what: kind, gold: level.price });
  ctx.events.push({ type: 'buildingBuilt', building: kind, level: 1, id });
  return OK;
}

/** Why a building cannot be upgraded right now (gold aside), or null. */
export function upgradeBlock(state: GameState, data: GameData, b: BuildingState): string | null {
  const def = data.buildings[b.kind];
  const next = def.levels[b.level];
  if (!next) return `${def.name} is fully upgraded.`;
  if (!isUnlocked(state, next.requires, data)) return unlockHint(state, data, next.requires);
  return null;
}

export function upgradeBuilding(state: GameState, ctx: SimContext, id: number): ActionResult {
  const b = buildingById(state, id);
  if (!b) return fail('There is no such building.');
  const def = ctx.data.buildings[b.kind];
  const block = upgradeBlock(state, ctx.data, b);
  if (block) return fail(block);
  const next = def.levels[b.level]!;
  if (!canAfford(state, next.price)) return fail(`You need ${next.price.toLocaleString('en-US')}g for that.`);
  spend(state, next.price);
  b.level += 1;
  ctx.events.push({ type: 'purchased', what: b.kind, gold: next.price });
  ctx.events.push({ type: 'buildingUpgraded', building: b.kind, level: b.level, id: b.id });
  return OK;
}

/** Moving is free; the feed, products and animals stay with the building. */
export function moveBuilding(
  state: GameState,
  ctx: SimContext,
  id: number,
  col: number,
  row: number,
): ActionResult {
  const b = buildingById(state, id);
  if (!b) return fail('There is no such building.');
  if (b.at.col === col && b.at.row === row) return fail('It already stands there.');
  const problem = buildingPlacementProblem(state, ctx.data, b.kind, col, row, id);
  if (problem) return fail(problem);
  b.at = { col, row };
  ctx.events.push({ type: 'buildingMoved', building: b.kind, level: b.level, id });
  return OK;
}

// ---- animals

function nextAnimalId(state: GameState): number {
  return state.ranch.animals.reduce((m, a) => Math.max(m, a.id), 0) + 1;
}

/** The next default name for an animal of `kind`: the list in order, never random. */
export function defaultName(state: GameState, data: GameData, kind: AnimalId): string {
  const def = data.animals[kind];
  const n = animalsOfKind(state, kind);
  return def.names[n % def.names.length] ?? `${def.name} ${n + 1}`;
}

export function buyAnimal(
  state: GameState,
  ctx: SimContext,
  kind: AnimalId,
  buildingId: number,
): ActionResult {
  if (!isAnimalId(kind)) return fail('There is no such animal.');
  const def = ctx.data.animals[kind];
  const b = buildingById(state, buildingId);
  if (!b || b.kind !== def.building)
    return fail(`${def.plural} live in the ${ctx.data.buildings[def.building].name.toLowerCase()}.`);
  if (animalCount(state, b.id) >= capacityOf(ctx.data, b))
    return fail(`The ${ctx.data.buildings[b.kind].name.toLowerCase()} is full. Upgrade it for more room.`);
  if (!canAfford(state, def.price)) return fail(`You need ${def.price.toLocaleString('en-US')}g for that.`);
  spend(state, def.price);
  const id = nextAnimalId(state);
  state.ranch.animals.push({ id, kind, name: defaultName(state, ctx.data, kind), building: b.id });
  // The first animal starts the building's cycle from zero; later ones join the cycle in progress.
  ctx.events.push({ type: 'purchased', what: kind, gold: def.price });
  ctx.events.push({ type: 'animalBought', animal: kind, id });
  return OK;
}

export const MAX_NAME_LENGTH = 16;

/** Tidies a typed name: no control characters, single spaces, at most 16 characters. */
export function cleanName(name: string): string {
  const printable = [...name]
    .map((c) => (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 ? ' ' : c))
    .join('');
  return printable.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
}

export function renameAnimal(state: GameState, id: number, name: string): ActionResult {
  const a = state.ranch.animals.find((x) => x.id === id);
  if (!a) return fail('There is no such animal.');
  const clean = cleanName(typeof name === 'string' ? name : '');
  if (clean === '') return fail('Give it a name of at least one letter.');
  a.name = clean;
  return OK;
}

// ---- feed

/** Makes feed from crops: `qty` units of the crop become `qty × perUnit` portions in the feed store. */
export function makeFeed(state: GameState, ctx: SimContext, feed: FeedId, qty: number): ActionResult {
  if (!isFeedId(feed)) return fail('There is no such feed.');
  const def = ctx.data.feeds[feed];
  const crop = ctx.data.crops[def.from];
  if (!ranchOpen(state)) return fail('Buy the Old Paddock first.');
  if (!Number.isInteger(qty) || qty <= 0) return fail('Choose how much to make.');
  if (countItem(state.inventory, def.from) < qty)
    return fail(`You need ${qty} ${crop.name.toLowerCase()} for that.`);
  const problem = storeRoomProblem(state, def.name, feed, qty * def.perUnit);
  if (problem) return fail(problem);
  removeItem(state.inventory, def.from, qty);
  storeFeed(state, feed, qty * def.perUnit);
  return OK;
}

/** The polite refusal when `portions` of feed would not fit in the store, or null (the action then changes nothing). */
function storeRoomProblem(state: GameState, name: string, feed: FeedId, portions: number): string | null {
  const room = feedRoom(state, feed);
  if (portions <= room) return null;
  const what = name.toLowerCase();
  return room === 0
    ? `The feed store is full of ${what}. Fill a trough first.`
    : `The feed store only has room for ${room} more ${what}.`;
}

/** How many units of crop (or of bought feed) fit in the store now, at `perUnit` portions each. */
export function feedUnitsThatFit(state: GameState, feed: FeedId, perUnit: number): number {
  return Math.floor(feedRoom(state, feed) / perUnit);
}

export function buyFeed(state: GameState, ctx: SimContext, feed: FeedId, qty: number): ActionResult {
  if (!isFeedId(feed)) return fail('There is no such feed.');
  const def = ctx.data.feeds[feed];
  if (!ranchOpen(state)) return fail('Buy the Old Paddock first.');
  if (!Number.isInteger(qty) || qty <= 0) return fail('Choose how much to buy.');
  const cost = def.buyPrice * qty;
  const problem = storeRoomProblem(state, def.name, feed, qty);
  if (problem) return fail(problem);
  if (!canAfford(state, cost)) return fail(`You need ${cost.toLocaleString('en-US')}g for that.`);
  spend(state, cost);
  storeFeed(state, feed, qty);
  ctx.events.push({ type: 'purchased', what: feed, gold: cost });
  return OK;
}

/** Moves feed from the feed store (then any left in the bag) into a trough, as much as fits. Returns the portions moved. */
export function topUp(state: GameState, ctx: Pick<SimContext, 'data'>, b: BuildingState): number {
  const feed = feedOf(ctx.data, b);
  if (!feed) return 0;
  const room = troughSize(state, ctx.data, b) - b.trough;
  if (room <= 0) return 0;
  const moved = takeFeed(state, feed, room);
  b.trough += moved;
  return moved;
}

export function fillTrough(state: GameState, ctx: SimContext, buildingId: number): ActionResult {
  const b = buildingById(state, buildingId);
  if (!b) return fail('There is no such building.');
  const feed = feedOf(ctx.data, b);
  if (!feed) return fail('A silo has no trough.');
  if (b.trough >= troughSize(state, ctx.data, b)) return fail('The trough is already full.');
  if (topUp(state, ctx, b) <= 0) {
    return fail(
      `The feed store has no ${ctx.data.feeds[feed].name.toLowerCase()}. Make some, or buy it, in the Ranch panel.`,
    );
  }
  return OK;
}

// ---- production

/**
 * One production cycle in whole simulated ms: the animal's interval, shortened by Busy Bees
 * (`animalSpeedModifier`, v2-05). The modifier only changes when a buff starts or ends, and buff
 * expiry is a step boundary, so the interval is fixed within a step and big steps equal small ones.
 */
export function cycleMsOf(def: AnimalDef, speed: number): number {
  const base = def.intervalSec * 1000;
  return speed > 1 ? Math.max(1, Math.round(base / speed)) : base;
}

/** Simulated ms until a housing building's next production cycle, at today's speed (for the panel and labels). */
export function msToNextProduct(data: GameData, b: BuildingState, speed: number): number {
  const def = animalDefOf(data, b);
  return def ? Math.max(0, cycleMsOf(def, speed) - b.cycleMs) : 0;
}

/**
 * Advances every housing building by `dtMs` of simulated time: whole cycles are run in order (see the
 * file header). A building with no animals keeps its cycle at zero. Events are batched per building.
 */
export function tickRanch(state: GameState, ctx: SimContext, dtMs: number): void {
  const buildings = state.ranch.buildings;
  if (buildings.length === 0 || dtMs <= 0) return;
  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i]!;
    const animalDef = animalDefOf(ctx.data, b);
    if (!animalDef) continue;
    const animals = animalCount(state, b.id);
    if (animals === 0) {
      b.cycleMs = 0;
      continue;
    }
    const interval = cycleMsOf(animalDef, ctx.mods.animalSpeedModifier);
    const total = b.cycleMs + dtMs;
    const cycles = Math.floor(total / interval);
    b.cycleMs = total % interval;
    if (cycles > 0) runCycles(ctx, b, animalDef, animals, cycles);
  }
}

function addProduct(b: BuildingState, product: AnimalProductId): void {
  for (const s of b.store) {
    if (s.item === product) {
      s.qty += 1;
      return;
    }
  }
  b.store.push({ item: product, qty: 1 });
}

function runCycles(ctx: SimContext, b: BuildingState, def: AnimalDef, animals: number, cycles: number): void {
  const cap = storeSize(ctx.data, b);
  let stored = storeCount(b);
  const hadFeed = b.trough > 0;
  let eggs = 0;
  let large = 0;
  for (let c = 0; c < cycles; c++) {
    let made = 0;
    for (let a = 0; a < animals; a++) {
      if (stored >= cap || b.trough <= 0) break; // later animals are in the same position: nothing is lost
      b.trough -= 1;
      stored += 1;
      made += 1;
      const isLarge = def.largeProduct !== undefined && ctx.rng.chance(def.largeProduct.chance);
      const product = isLarge ? def.largeProduct!.id : def.product;
      addProduct(b, product);
      if (isLarge) large += 1;
      else eggs += 1;
    }
    // A cycle that made nothing means an empty trough or a full store; neither changes without an action.
    if (made === 0) break;
  }
  if (eggs > 0) ctx.events.push({ type: 'produced', product: def.product, qty: eggs, building: b.id });
  if (large > 0 && def.largeProduct)
    ctx.events.push({ type: 'produced', product: def.largeProduct.id, qty: large, building: b.id });
  if (hadFeed && b.trough <= 0) ctx.events.push({ type: 'troughEmpty', building: b.id, animal: def.id });
}

// ---- collecting

/** How many of `qty` of `product` can leave a store right now: all if it ships automatically, else what the bag holds. */
function movable(state: GameState, data: GameData, product: AnimalProductId, qty: number): number {
  if (shipsAutomatically(state, data, product)) return qty;
  return Math.min(qty, spaceFor(state.inventory, product));
}

/** Moves what fits from a store to the bag (or the bin). Returns the number of products moved. */
export function emptyStore(state: GameState, ctx: SimContext, b: BuildingState, auto: boolean): number {
  let moved = 0;
  const left: ItemStack[] = [];
  for (const stack of b.store) {
    const product = stack.item as AnimalProductId;
    const qty = movable(state, ctx.data, product, stack.qty);
    const stowed = qty > 0 ? stowHarvest(state, ctx.data, product, qty) : null;
    if (!stowed) {
      left.push(stack);
      continue;
    }
    state.stats.productsCollected += qty;
    moved += qty;
    ctx.events.push({ type: 'collected', product, qty, auto, building: b.id, shipped: stowed.bin });
    if (qty < stack.qty) left.push({ item: product, qty: stack.qty - qty });
  }
  b.store = left;
  if (left.length > 0) ctx.events.push({ type: 'inventoryFull', item: left[0]!.item });
  return moved;
}

/** Click a building: collect everything in its store that fits. */
export function collectBuilding(state: GameState, ctx: SimContext, id: number): ActionResult {
  const b = buildingById(state, id);
  if (!b) return fail('There is no such building.');
  if (!ctx.data.buildings[b.kind].houses) return fail('A silo holds feed, not products.');
  if (storeCount(b) === 0) {
    return fail(
      animalCount(state, b.id) === 0
        ? 'Nobody lives here yet. Buy an animal in the Ranch panel.'
        : b.trough <= 0
          ? 'Nothing yet. A little feed in the trough gets things going.'
          : 'Nothing yet. The next batch is on its way.',
    );
  }
  emptyStore(state, ctx, b, false);
  return storeCount(b) === 0 ? OK : fail('Your bag is too full to take it all.');
}

// ---- the shipping-bin pickup: the silo and the Collecting Basket

/** Level 2 silo: makes feed from the bag's wheat and corn (keeping 10 of each back) where a trough needs it, into the store. */
function mill(state: GameState, ctx: SimContext, b: BuildingState, feed: FeedId): void {
  const def = ctx.data.feeds[feed];
  const need = troughSize(state, ctx.data, b) - b.trough - feedAvailable(state, feed);
  if (need <= 0) return;
  const spare = Math.max(0, countItem(state.inventory, def.from) - SILO_RESERVE);
  const units = Math.min(spare, Math.ceil(need / def.perUnit), feedUnitsThatFit(state, feed, def.perUnit));
  if (units <= 0) return;
  removeItem(state.inventory, def.from, units);
  storeFeed(state, feed, units * def.perUnit);
}

/** The silo's visit: top up every trough from the bag, making feed first with a level 2 silo. */
export function runSilo(state: GameState, ctx: SimContext): void {
  const feeding = siloFlag(state, ctx.data, 'autoFeed');
  if (!feeding) return;
  const milling = siloFlag(state, ctx.data, 'autoMill');
  for (const b of state.ranch.buildings) {
    const feed = feedOf(ctx.data, b);
    if (!feed || animalCount(state, b.id) === 0) continue;
    if (milling) mill(state, ctx, b, feed);
    topUp(state, ctx, b);
  }
}

/** The Collecting Basket: empties every store at a pickup. Returns the products moved. */
export function collectAllStores(state: GameState, ctx: SimContext): number {
  let moved = 0;
  for (const b of state.ranch.buildings) if (b.store.length > 0) moved += emptyStore(state, ctx, b, true);
  return moved;
}

/**
 * What the ranch does at each shipping-bin pickup: the silo feeds, then the Collecting Basket empties the
 * stores and (v4-03) the hives and the finished presses, and restarts "keep pressing" slots that had
 * stopped. The basket makes every pickup a step boundary (`msToNextPickup`), so this is step-size exact.
 */
export function ranchPickup(state: GameState, ctx: SimContext): void {
  if (state.ranch.buildings.length > 0) runSilo(state, ctx);
  if (!hasFlag(state, ctx.data, 'ranch_collector', 'autoCollect')) return;
  if (state.ranch.buildings.length > 0) collectAllStores(state, ctx);
  if (state.apiary.hives.length > 0) collectAllHives(state, ctx);
  if (state.press.slots.length > 0) {
    collectAllPresses(state, ctx);
    resumeRepeating(state, ctx);
  }
}

/** Whether the Collecting Basket has been bought. */
export function hasCollector(state: GameState, data: GameData): boolean {
  return hasFlag(state, data, 'ranch_collector', 'autoCollect');
}

/** Products waiting in all stores. */
export function productsWaiting(state: GameState): number {
  let n = 0;
  for (const b of state.ranch.buildings) n += storeCount(b);
  return n;
}
