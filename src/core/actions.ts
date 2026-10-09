// The dispatch layer. The UI and renderer never edit state: they build an Action and call
// game.dispatch(action). This file validates the action and calls the system that handles it.
//
// To add an action: add a variant to `Action`, handle it in `applyAction` (delegating to a function
// in src/systems/), and return an ActionResult so the UI can show a message on failure.

import type { SimContext, ActionResult } from '../systems/context';
import { OK, fail } from '../systems/context';
import { harvestPlots, plantPlots, tillPlots, useTool, waterPlots, type FarmTool } from '../systems/farming';
import { buyExpansion } from '../systems/expansions';
import { buyParcel } from '../systems/parcels';
import { sellItems } from '../systems/market';
import { discardItem, moveStack, sortInventory } from '../systems/inventory';
import { shipItems, unshipItems } from '../systems/shippingBin';
import { buySeeds } from '../systems/shop';
import { setAutoSell } from '../systems/autoSeller';
import { setSeedOrderCrop, setSeedOrderReserve } from '../systems/seedOrder';
import { pickUpObject, placeObject } from '../systems/placement';
import { buyUpgrade } from '../systems/upgrades';
import { cancelCast, startCast, stepFishing } from '../systems/fishing';
import { collectTrap } from '../systems/traps';
import { buyRecipe, cancelCooking, experiment, startCooking } from '../systems/cooking';
import { eatDish } from '../systems/buffs';
import { donate } from '../systems/bundles';
import { buyDecor, moveDecor, pickUpDecor, placeDecor, styleFarmhouse } from '../systems/decor';
import { adoptCat, chooseCat } from '../systems/cats';
import { donateProject } from '../systems/townProjects';
import { buySapling, moveTree, pickTree, plantTree, removeTree } from '../systems/orchard';
import {
  buildBuilding,
  buyAnimal,
  buyFeed,
  collectBuilding,
  fillTrough,
  makeFeed,
  moveBuilding,
  renameAnimal,
  upgradeBuilding,
} from '../systems/ranch';
import {
  buildRestaurant,
  clearMenuSlot,
  restockMenu,
  stockMenu,
  upgradeRestaurant,
} from '../systems/restaurant';
import {
  buildPress,
  buyCocoa,
  cancelPress,
  collectPress,
  setPressRepeat,
  startPress,
  upgradePress,
} from '../systems/press';
import { buyHive, collectHive } from '../systems/apiary';
import { pickForage } from '../systems/forage';
import { runProgression } from '../systems/progression';
import type {
  AnimalId,
  BuildingId,
  CatId,
  BundleId,
  FeedId,
  CropId,
  DecorId,
  DishId,
  DrinkId,
  ExpansionId,
  FishLocationId,
  FruitId,
  ItemId,
  NorthFieldId,
  ParcelId,
  RecipeId,
  TownProjectId,
  UpgradeId,
} from '../data/ids';
import type { GameState, PlacedKind } from './state';

export type Action =
  | { type: 'setMasterVolume'; value: number }
  | { type: 'till' | 'water' | 'harvest'; plots: number[] }
  | { type: 'plant'; crop: CropId; plots: number[] }
  /** A toolbar tool on some plots; `auto` picks the obvious action from the first plot. */
  | { type: 'useTool'; tool: FarmTool; plots: number[]; seed: CropId | null }
  /** Shop: buy seeds of an unlocked, in-season crop. */
  | { type: 'buySeeds'; crop: CropId; qty: number }
  /** Market panel: sell instantly at 90%. */
  | { type: 'sell'; item: ItemId; qty: number }
  /** Throw items away for good (`hearty` picks hearty or plain dishes). */
  | { type: 'discardItem'; item: ItemId; qty: number; hearty?: boolean }
  /** Inventory: drag a stack onto another slot (move, merge or swap). */
  | { type: 'moveStack'; from: number; to: number }
  /** Inventory: merge and sort the whole bag. */
  | { type: 'sortInventory' }
  /** Shipping Bin: drop items in (paid at 100% at the next hourly pickup), or take them back out. */
  | { type: 'ship'; item: ItemId; qty: number }
  | { type: 'unship'; item: ItemId }
  | { type: 'buyExpansion'; id: ExpansionId }
  | { type: 'buyUpgrade'; id: UpgradeId }
  /** Upgrades › Land or a "For sale" sign: buy the next land parcel (v2 phase 01). */
  | { type: 'buyParcel'; parcel: ParcelId }
  /** Puts a bought sprinkler or scarecrow on plot (col, row), or takes a placed one back. */
  /** `field` (v4-01): a plot of that north field; absent for the home field. */
  | { type: 'place'; kind: PlacedKind; col: number; row: number; field?: NorthFieldId }
  | { type: 'pickUp'; id: number }
  /** Auto-Seller: ship (or keep) one item's harvests. */
  | { type: 'setAutoSell'; item: ItemId; on: boolean }
  /** Seed Order: the gold reserve it never spends below (0, 10, 25 or 50 percent of current gold), and a crop's opt-out. */
  | { type: 'setSeedOrderReserve'; pct: number }
  | { type: 'setSeedOrderCrop'; crop: CropId; on: boolean }
  /** Fishing: press to start charging a cast at a location, then `fishTick` every frame with the button state. */
  | { type: 'fishStart'; location: FishLocationId }
  | { type: 'fishTick'; holding: boolean; dtMs: number }
  | { type: 'fishCancel' }
  /** Click a trap: take what is in it. */
  | { type: 'collectTrap'; id: number }
  | { type: 'setRelaxedFishing'; on: boolean }
  /** Kitchen: put a known recipe on the stove, or take a dish off it (the ingredients come back). */
  | { type: 'cook'; recipe: RecipeId }
  | { type: 'cancelCook'; index: number }
  /** Kitchen: try 2 to 4 ingredients together; a match teaches the recipe, a miss costs nothing. */
  | { type: 'experiment'; items: ItemId[] }
  /** Shop: buy a recipe card. */
  | { type: 'buyRecipe'; recipe: RecipeId }
  /** Inventory: eat a dish for its buff. `hearty` picks the stack; `replace` confirms swapping out the buff with the least time left. */
  /** Eat a dish or (v4-03) drink a drink: both give a buff. */
  | { type: 'eat'; dish: DishId | DrinkId; hearty?: boolean; replace?: boolean }
  /** Community Board: give up to `qty` of an item from the bag to a bundle. */
  | { type: 'donate'; bundle: BundleId; item: ItemId; qty: number }
  /** Shop › Decor: buy pieces for the decoration stock (v2 phase 02). Farmhouse pieces are owned once. */
  | { type: 'buyDecor'; decor: DecorId; qty: number }
  /** Decorate mode: stand a piece from the stock on the land, move a placed one, or take it back to the stock. */
  | { type: 'placeDecor'; decor: DecorId; col: number; row: number; flipped?: boolean }
  | { type: 'moveDecor'; id: number; col: number; row: number; flipped?: boolean }
  | { type: 'pickUpDecor'; id: number }
  /** Applies owned farmhouse pieces (null = the original look; omitted = unchanged). Free and reversible. */
  | { type: 'styleFarmhouse'; paint?: DecorId | null; roof?: DecorId | null; loft?: boolean }
  // the farm cats (cosmetic)
  | { type: 'adoptCat'; cat: CatId }
  | { type: 'chooseCat'; cat: CatId }
  /** Community Board › Town: give gold and/or items toward a project's current stage. */
  | { type: 'donateProject'; project: TownProjectId; gold?: number; item?: ItemId; qty?: number }
  /** Shop › Trees: buy saplings (bag items). Planting uses a tree spot of the orchard (v2 phase 03). */
  | { type: 'buySapling'; fruit: FruitId; qty: number }
  | { type: 'plantTree'; fruit: FruitId; spot: number }
  /** Click a tree: pick all its fruit. Moving keeps its age; removing loses it (the UI confirms both). */
  | { type: 'pickTree'; id: number }
  | { type: 'moveTree'; id: number; spot: number }
  | { type: 'removeTree'; id: number }
  /** Ranch panel: buy and place a building (level 1), upgrade it, or move it (v2 phase 04). */
  | { type: 'buildBuilding'; building: BuildingId; col: number; row: number }
  | { type: 'upgradeBuilding'; id: number }
  | { type: 'moveBuilding'; id: number; col: number; row: number }
  /** Buy a hen or cow for a building with room; names are chosen from a list and can be changed. */
  | { type: 'buyAnimal'; animal: AnimalId; building: number }
  | { type: 'renameAnimal'; id: number; name: string }
  /** Feed: make it from crops (`qty` is the crop used) or buy it, then fill a trough from the bag. */
  | { type: 'makeFeed'; feed: FeedId; qty: number }
  | { type: 'buyFeed'; feed: FeedId; qty: number }
  | { type: 'fillTrough'; building: number }
  /** Click a building: take what is in its store. */
  | { type: 'collectBuilding'; building: number }
  /** Restaurant panel (v4 phase 02): build it (level 1) or buy the next level. */
  | { type: 'buildRestaurant' }
  | { type: 'upgradeRestaurant' }
  /** Put `qty` of a dish from the bag on a menu slot (all or nothing); top every slot up; or clear one back into the bag. */
  | { type: 'stockMenu'; slot: number; item: ItemId; qty: number; hearty?: boolean }
  | { type: 'restockMenu' }
  | { type: 'clearMenuSlot'; slot: number }
  /** Press House panel (v4 phase 03): build it (level 1) or buy the next level. */
  | { type: 'buildPress' }
  | { type: 'upgradePress' }
  /** Start a drink in a press slot (ingredients from the bag), "keep pressing", take a run off, collect. */
  | { type: 'startPress'; slot: number; recipe: RecipeId; repeat?: boolean }
  | { type: 'setPressRepeat'; slot: number; repeat: boolean }
  | { type: 'cancelPress'; slot: number }
  | { type: 'collectPress'; slot?: number }
  /** Cocoa beans from the Press House shelf. */
  | { type: 'buyCocoa'; qty: number }
  /** The apiary: a hive on the next free spot; collect one hive's honey (by id) or every hive's. */
  | { type: 'buyHive' }
  | { type: 'collectHive'; hive?: number }
  // the North Woods (v4 phase 04)
  | { type: 'pickForage'; spot: number }
  | { type: 'debugSetTimeWarp'; on: boolean };

export const TIME_WARP_SPEED = 60;

/**
 * Runs an action, then lets progression read whatever it reported (XP, milestones, goals), so a
 * click counts exactly as a simulation step does.
 */
export function applyAction(state: GameState, ctx: SimContext, action: Action): ActionResult {
  const result = handleAction(state, ctx, action);
  runProgression(state, ctx);
  return result;
}

function handleAction(state: GameState, ctx: SimContext, action: Action): ActionResult {
  switch (action.type) {
    case 'setMasterVolume': {
      if (!Number.isFinite(action.value)) return fail('Volume must be a number.');
      state.settings.masterVolume = Math.min(1, Math.max(0, action.value));
      return OK;
    }
    case 'till':
      return tillPlots(state, ctx, action.plots, false, action.plots);
    case 'water':
      return waterPlots(state, ctx, action.plots);
    case 'harvest':
      return harvestPlots(state, ctx, action.plots);
    case 'plant':
      return plantPlots(state, ctx, action.crop, action.plots);
    case 'useTool':
      return useTool(state, ctx, action.tool, action.plots, action.seed);
    case 'buySeeds':
      return buySeeds(state, ctx, action.crop, action.qty);
    case 'sell':
      return sellItems(state, ctx, action.item, action.qty);
    case 'discardItem':
      return discardItem(state, ctx, action.item, action.qty, action.hearty);
    case 'moveStack':
      return moveStack(state, ctx, action.from, action.to);
    case 'sortInventory':
      return sortInventory(state, ctx);
    case 'ship':
      return shipItems(state, ctx, action.item, action.qty);
    case 'unship':
      return unshipItems(state, ctx, action.item);
    case 'buyExpansion':
      return buyExpansion(state, ctx, action.id);
    case 'buyUpgrade':
      return buyUpgrade(state, ctx, action.id);
    case 'buyParcel':
      return buyParcel(state, ctx, action.parcel);
    case 'place':
      return placeObject(state, ctx, action.kind, action.col, action.row, action.field);
    case 'pickUp':
      return pickUpObject(state, ctx, action.id);
    case 'setAutoSell':
      return setAutoSell(state, ctx.data, action.item, action.on);
    case 'setSeedOrderReserve':
      return setSeedOrderReserve(state, action.pct);
    case 'setSeedOrderCrop':
      return setSeedOrderCrop(state, action.crop, action.on);
    case 'fishStart':
      return startCast(state, ctx, action.location);
    case 'fishTick':
      return stepFishing(state, ctx, action.holding, action.dtMs);
    case 'fishCancel':
      return cancelCast(state);
    case 'collectTrap':
      return collectTrap(state, ctx, action.id);
    case 'setRelaxedFishing':
      state.settings.relaxedFishing = action.on;
      return OK;
    case 'cook':
      return startCooking(state, ctx, action.recipe);
    case 'cancelCook':
      return cancelCooking(state, ctx, action.index);
    case 'experiment':
      return experiment(state, ctx, action.items);
    case 'buyRecipe':
      return buyRecipe(state, ctx, action.recipe);
    case 'eat':
      return eatDish(state, ctx, action.dish, action.hearty, action.replace ?? false);
    case 'donate':
      return donate(state, ctx, action.bundle, action.item, action.qty);
    case 'buyDecor':
      return buyDecor(state, ctx, action.decor, action.qty);
    case 'placeDecor':
      return placeDecor(state, ctx, action.decor, action.col, action.row, action.flipped);
    case 'moveDecor':
      return moveDecor(state, ctx, action.id, action.col, action.row, action.flipped);
    case 'pickUpDecor':
      return pickUpDecor(state, ctx, action.id);
    case 'styleFarmhouse':
      return styleFarmhouse(state, ctx, action.paint, action.roof, action.loft);
    case 'adoptCat':
      return adoptCat(state, ctx, action.cat);
    case 'chooseCat':
      return chooseCat(state, ctx, action.cat);
    case 'donateProject':
      return donateProject(state, ctx, action.project, action.gold, action.item, action.qty);
    case 'buySapling':
      return buySapling(state, ctx, action.fruit, action.qty);
    case 'plantTree':
      return plantTree(state, ctx, action.fruit, action.spot);
    case 'pickTree':
      return pickTree(state, ctx, action.id);
    case 'moveTree':
      return moveTree(state, ctx, action.id, action.spot);
    case 'removeTree':
      return removeTree(state, ctx, action.id);
    case 'buildBuilding':
      return buildBuilding(state, ctx, action.building, action.col, action.row);
    case 'upgradeBuilding':
      return upgradeBuilding(state, ctx, action.id);
    case 'moveBuilding':
      return moveBuilding(state, ctx, action.id, action.col, action.row);
    case 'buyAnimal':
      return buyAnimal(state, ctx, action.animal, action.building);
    case 'renameAnimal':
      return renameAnimal(state, action.id, action.name);
    case 'makeFeed':
      return makeFeed(state, ctx, action.feed, action.qty);
    case 'buyFeed':
      return buyFeed(state, ctx, action.feed, action.qty);
    case 'fillTrough':
      return fillTrough(state, ctx, action.building);
    case 'collectBuilding':
      return collectBuilding(state, ctx, action.building);
    case 'buildRestaurant':
      return buildRestaurant(state, ctx);
    case 'upgradeRestaurant':
      return upgradeRestaurant(state, ctx);
    case 'stockMenu':
      return stockMenu(state, ctx, action.slot, action.item, action.qty, action.hearty);
    case 'restockMenu':
      return restockMenu(state, ctx);
    case 'clearMenuSlot':
      return clearMenuSlot(state, ctx, action.slot);
    case 'buildPress':
      return buildPress(state, ctx);
    case 'upgradePress':
      return upgradePress(state, ctx);
    case 'startPress':
      return startPress(state, ctx, action.slot, action.recipe, action.repeat);
    case 'setPressRepeat':
      return setPressRepeat(state, ctx, action.slot, action.repeat);
    case 'cancelPress':
      return cancelPress(state, ctx, action.slot);
    case 'collectPress':
      return collectPress(state, ctx, action.slot);
    case 'buyCocoa':
      return buyCocoa(state, ctx, action.qty);
    case 'buyHive':
      return buyHive(state, ctx);
    case 'collectHive':
      return collectHive(state, ctx, action.hive);
    case 'pickForage':
      return pickForage(state, ctx, action.spot);
    case 'debugSetTimeWarp':
      state.clock.speed = action.on ? TIME_WARP_SPEED : 1;
      return OK;
  }
}
