// A tiny typed event bus. Systems push GameEvents to ctx.events; the core flushes them here; the
// UI, renderer and (later) audio subscribe. Systems never import the UI or this bus.

import type {
  BuffType,
  BundleId,
  CropId,
  DecorId,
  ExpansionId,
  FishId,
  FishLocationId,
  GoalTemplateId,
  ItemId,
  JunkId,
  MilestoneId,
  PanelId,
  ParcelId,
  RecipeId,
  RecipeTier,
  SeasonId,
  SeedId,
  SkillId,
  TownProjectId,
  UpgradeId,
} from '../data/ids';
import type { PlacedKind } from './state';

export type GameEvent =
  | { type: 'dayStarted'; dayKey: string }
  | { type: 'seasonChanged'; season: SeasonId; withered: number }
  | { type: 'binCollected'; gold: number; items: number }
  | { type: 'tilled' | 'watered'; plots: number[]; auto?: true }
  | { type: 'planted'; crop: CropId; plots: number[]; auto?: true }
  /** `shipped`: how many of the `qty` went straight to the Shipping Bin (Auto-Seller). */
  | { type: 'harvested'; crop: CropId; qty: number; plot: number; auto: boolean; shipped: number }
  | { type: 'placed' | 'pickedUp'; kind: PlacedKind; col: number; row: number }
  | { type: 'sold'; item: ItemId; qty: number; gold: number; via: 'market' | 'bin' }
  | { type: 'goldEarned'; amount: number; source: 'sale' | 'quest' | 'other' }
  | {
      type: 'purchased';
      what: UpgradeId | ExpansionId | SeedId | RecipeId | ParcelId | DecorId;
      gold: number;
    }
  | { type: 'parcelBought'; parcel: ParcelId }
  | { type: 'decorPlaced' | 'decorMoved' | 'decorPickedUp'; decor: DecorId; id: number }
  /** Charm changed (pushed by decoration and project actions); `gainCharm` goals sum the rises. */
  | { type: 'charmChanged'; from: number; to: number }
  | { type: 'projectDonated'; project: TownProjectId; gold: number; items: number }
  | { type: 'projectStageDone'; project: TownProjectId; stage: number; complete: boolean }
  | { type: 'inventoryFull'; item: ItemId }
  | { type: 'bite' | 'escaped'; location: FishLocationId }
  | { type: 'trapCollected'; location: FishLocationId; items: number }
  | { type: 'caught'; catch: FishId | JunkId; sizeCm: number; location: FishLocationId; viaTrap: boolean }
  | { type: 'cooked'; recipe: RecipeId; tier: RecipeTier; hearty: boolean }
  | { type: 'ate'; recipe: RecipeId; buff: BuffType; hearty: boolean }
  | { type: 'recipeLearned'; recipe: RecipeId; how: 'card' | 'milestone' | 'experiment' }
  | { type: 'buffStarted' | 'buffExpired'; buff: BuffType }
  | { type: 'levelUp'; skill: SkillId; level: number }
  | { type: 'farmLevelUp'; level: number }
  /** A milestone or a goal was finished; `title` is its text, `rewards` what it paid (in words). */
  | {
      type: 'questDone';
      id: MilestoneId | GoalTemplateId;
      kind: 'milestone' | 'goal';
      title: string;
      rewards: string;
    }
  | { type: 'bundleCompleted'; bundle: BundleId }
  /** Something new opened; `panel` is where to find it (the toolbar button pulses). */
  | { type: 'unlocked'; what: string; panel?: PanelId }
  | { type: 'notify'; text: string; tone: 'info' | 'good' | 'warn' };

export type GameEventType = GameEvent['type'];
/** The event variant(s) for `type`, including variants that share a body (`'tilled' | 'watered'`). */
export type EventOf<T extends GameEventType> = GameEvent extends infer E
  ? E extends { type: infer U }
    ? T extends U
      ? E & { type: T }
      : never
    : never
  : never;

type Handler<E> = (event: E) => void;

export class EventBus {
  private readonly handlers = new Map<string, Set<Handler<GameEvent>>>();
  private readonly anyHandlers = new Set<Handler<GameEvent>>();

  /** Subscribe to one event type. Returns an unsubscribe function. */
  on<T extends GameEventType>(type: T, handler: Handler<EventOf<T>>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    const h = handler as Handler<GameEvent>;
    set.add(h);
    return () => set.delete(h);
  }

  /** Subscribe to every event. Returns an unsubscribe function. */
  onAny(handler: Handler<GameEvent>): () => void {
    this.anyHandlers.add(handler);
    return () => this.anyHandlers.delete(handler);
  }

  emit(event: GameEvent): void {
    this.handlers.get(event.type)?.forEach((h) => h(event));
    this.anyHandlers.forEach((h) => h(event));
  }

  emitAll(events: readonly GameEvent[]): void {
    for (const e of events) this.emit(e);
  }
}
