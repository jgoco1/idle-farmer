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
import { shipItems, unshipItems } from '../systems/shippingBin';
import { buySeeds } from '../systems/shop';
import { setAutoSell } from '../systems/autoSeller';
import { pickUpObject, placeObject } from '../systems/placement';
import { buyUpgrade } from '../systems/upgrades';
import { cancelCast, startCast, stepFishing } from '../systems/fishing';
import { collectTrap } from '../systems/traps';
import { buyRecipe, cancelCooking, experiment, startCooking } from '../systems/cooking';
import { eatDish } from '../systems/buffs';
import { donate } from '../systems/bundles';
import { buyDecor, moveDecor, pickUpDecor, placeDecor, styleFarmhouse } from '../systems/decor';
import { donateProject } from '../systems/townProjects';
import { runProgression } from '../systems/progression';
import type {
  BundleId,
  CropId,
  DecorId,
  DishId,
  ExpansionId,
  FishLocationId,
  ItemId,
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
  /** Shipping Bin: drop items in (paid at 100% at the next hourly pickup), or take them back out. */
  | { type: 'ship'; item: ItemId; qty: number }
  | { type: 'unship'; item: ItemId }
  | { type: 'buyExpansion'; id: ExpansionId }
  | { type: 'buyUpgrade'; id: UpgradeId }
  /** Upgrades › Land or a "For sale" sign: buy the next land parcel (v2 phase 01). */
  | { type: 'buyParcel'; parcel: ParcelId }
  /** Puts a bought sprinkler or scarecrow on plot (col, row), or takes a placed one back. */
  | { type: 'place'; kind: PlacedKind; col: number; row: number }
  | { type: 'pickUp'; id: number }
  /** Auto-Seller: ship (or keep) one item's harvests. */
  | { type: 'setAutoSell'; item: ItemId; on: boolean }
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
  | { type: 'eat'; dish: DishId; hearty?: boolean; replace?: boolean }
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
  /** Community Board › Town: give gold and/or items toward a project's current stage. */
  | { type: 'donateProject'; project: TownProjectId; gold?: number; item?: ItemId; qty?: number }
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
      return placeObject(state, ctx, action.kind, action.col, action.row);
    case 'pickUp':
      return pickUpObject(state, ctx, action.id);
    case 'setAutoSell':
      return setAutoSell(state, ctx.data, action.item, action.on);
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
    case 'donateProject':
      return donateProject(state, ctx, action.project, action.gold, action.item, action.qty);
    case 'debugSetTimeWarp':
      state.clock.speed = action.on ? TIME_WARP_SPEED : 1;
      return OK;
  }
}
