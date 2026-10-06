// The simulator's clock and harness (phase 09). A `SimRun` owns one real `Game` and the real-world
// time `t` injected into it as `now`, and moves that time through a schedule the way a player's
// days go: a session of play (the bot looks at the farm every `reactionMs` and the game advances in
// exact bulk steps), then an absence (the game is saved to JSON, parsed back and caught up with the
// real offline walk, exactly as `src/main.ts` does on load). Nothing here changes the rules: the
// systems, the calendar, the offline cap and the save code are the ones that ship.

import { troughIsEmpty } from '../../src/systems/ranch';
import { Game } from '../../src/core/game';
import type { GameEvent } from '../../src/core/events';
import { makeContext, processCalendar, step } from '../../src/core/sim';
import { simulatedMsFor } from '../../src/core/offline';
import { parseSave, toSaveFile } from '../../src/core/save';
import { createInitialState, type GameState } from '../../src/core/state';
import {
  buildCalendar,
  calendarTime,
  localDay,
  localTimeToEpoch,
  nextDailyBoundary,
  nextWeeklyBoundary,
  type LocalClock,
} from '../../src/core/time';
import type { GameData } from '../../src/data';
import { PARCEL_IDS, type MilestoneId, type NorthFieldId } from '../../src/data/ids';
import { isUnlocked } from '../../src/systems/unlocks';
import { northFieldOf, plotCount } from '../../src/systems/farming';
import { farmLevel as farmLevelOf } from '../../src/systems/unlocks';
import { charmOf } from '../../src/systems/charm';
import { toSpend } from './catalogue';

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

/** A moment worth reporting: real time since the save was made, time spent playing, and simulated time (play plus the credited part of absences). */
export interface Moment {
  realMs: number;
  playMs: number;
  simMs: number;
}

/** One row of the gold-over-time table, taken at the end of every session. */
export interface Snapshot {
  realMs: number;
  playMs: number;
  simMs: number;
  gold: number;
  lifetimeGold: number;
  farmLevel: number;
  recipesKnown: number;
  plots: number;
  milestones: number;
  /** Gold still to spend on the catalogue (BALANCE.md §13.4). */
  toSpend: number;
  /** Derived charm (v2 phase 02). */
  charm: number;
  /** Gold from selling fruit so far (v2 phase 03). */
  orchardGold: number;
  /** Gold from selling eggs and milk so far (v2 phase 04). */
  animalGold: number;
  /** Simulated ms so far with an empty trough while animals lived there (v2 phase 04). */
  hungryMs: number;
  /** v4-01: the price of the cheapest parcel on sale (every condition met, not owned), 0 when none: what gold is saved for. */
  parcelSaving: number;
  /** Gold from selling crops so far, and the crops harvested so far at base price, in all and per north field (v4-01). */
  cropGold: number;
  harvestValue: number;
  northValue: Record<NorthFieldId, number>;
  /** v4-02: the restaurant's takings and servings so far, and the takings from the day's special. */
  restaurantGold: number;
  served: number;
  specialGold: number;
  /** v4-03: gold from drinks (sold at the Market or served at the restaurant), drinks pressed, honey sold and collected. */
  drinkGold: number;
  drinksPressed: number;
  honeyGold: number;
  honeyCollected: number;
}

export interface Metrics {
  /** Time to each milestone, first dish of each tier, farm level and named moment (`first_harvest`, …). */
  moments: Record<string, Moment>;
  snapshots: Snapshot[];
  /** Total time played and time spent in sessions with nothing useful to do for more than `DEAD_AFTER_MS`. */
  playMs: number;
  deadMs: number;
  /** The longest wait with nothing useful to do in the first 30 minutes of play. */
  longestEarlyWaitMs: number;
  /** Simulated ms with at least one food buff running, and summed per type. */
  buffAnyMs: number;
  /** The same while playing only. */
  buffPlayMs: number;
  buffMs: Record<string, number>;
  /** Simulated ms granted in total (play and away). */
  simMs: number;
  goldFromQuests: number;
  /** Gold dishes fetched when sold. */
  dishGold: number;
  fished: number;
  cooked: number;
  eaten: number;
  offlineSimMs: number;
  /** Gold earned while away (from the offline walks). */
  offlineGold: number;
  /** Gold from selling fruit (v2 phase 03). */
  orchardGold: number;
  /** Gold from selling eggs and milk, and the simulated ms (while playing) an animal's trough was empty (v2 phase 04). */
  animalGold: number;
  hungryMs: number;
  /** v4-01: gold from selling crops, the base-price value of every harvest, and of the harvests on each north field. */
  cropGold: number;
  harvestValue: number;
  northValue: Record<NorthFieldId, number>;
  /** v4-02: gold the restaurant's guests paid, servings, and the gold from servings of the day's special. */
  restaurantGold: number;
  served: number;
  specialGold: number;
  /** v4-03: gold from drinks (sold or served), drinks pressed, honey sold and jars collected. */
  drinkGold: number;
  drinksPressed: number;
  honeyGold: number;
  honeyCollected: number;
  /** Every absence: when it began (real ms since the start), how long it was, and the gold earned during it (v2 phase 06). */
  aways: { startMs: number; ms: number; gold: number }[];
}

/** A wait longer than this with nothing useful to do counts as dead time (GDD §2: "nobody waits more than ~2 minutes"). */
export const DEAD_AFTER_MS = 2 * MIN;

export class SimRun {
  readonly game: Game;
  /** Real epoch ms (what `Date.now()` would say). */
  t: number;
  readonly start: number;
  readonly metrics: Metrics = {
    moments: {},
    snapshots: [],
    playMs: 0,
    deadMs: 0,
    longestEarlyWaitMs: 0,
    buffAnyMs: 0,
    buffPlayMs: 0,
    buffMs: {},
    simMs: 0,
    goldFromQuests: 0,
    dishGold: 0,
    fished: 0,
    cooked: 0,
    eaten: 0,
    offlineSimMs: 0,
    offlineGold: 0,
    orchardGold: 0,
    animalGold: 0,
    hungryMs: 0,
    cropGold: 0,
    harvestValue: 0,
    northValue: { north_fields: 0, terraces: 0 },
    restaurantGold: 0,
    served: 0,
    specialGold: 0,
    drinkGold: 0,
    drinksPressed: 0,
    honeyGold: 0,
    honeyCollected: 0,
    aways: [],
  };
  private lastUsefulPlayMs = 0;
  /** The next daily or weekly calendar boundary (calendar time), cached between looks. */
  private nextBoundary = -Infinity;

  constructor(
    readonly data: GameData,
    readonly lc: LocalClock,
    start: number,
    seed: number,
  ) {
    this.start = start;
    this.t = start;
    this.game = new Game(createInitialState(start, lc, seed), { data, lc, now: () => this.t });
    const bus = this.game.bus;
    bus.on('questDone', (e) => {
      if (e.kind === 'milestone') this.mark(e.id as MilestoneId);
    });
    bus.on('goldEarned', (e) => {
      if (e.source === 'quest') this.metrics.goldFromQuests += e.amount;
    });
    bus.on('sold', (e) => {
      const cat = data.items[e.item]?.category;
      if (cat === 'dish') this.metrics.dishGold += e.gold;
      else if (cat === 'drink') this.metrics.drinkGold += e.gold;
      else if (e.item === 'honey')
        this.metrics.honeyGold += e.gold; // v4-03: not the animals' gold
      else if (cat === 'fruit') this.metrics.orchardGold += e.gold;
      else if (cat === 'animal') this.metrics.animalGold += e.gold;
      else if (cat === 'crop') this.metrics.cropGold += e.gold;
    });
    bus.on('harvested', (e) => {
      this.mark('first_harvest');
      // v4-01: which field the crop grew in, valued at its base price (the share of crop gold each field earns).
      const value = e.qty * data.crops[e.crop].basePrice;
      this.metrics.harvestValue += value;
      const field = northFieldOf(e.plot);
      if (field) this.metrics.northValue[field] += value;
    });
    bus.on('served', (e) => {
      this.mark('first_serving');
      this.metrics.restaurantGold += e.gold;
      this.metrics.served += e.qty;
      if (e.special) this.metrics.specialGold += e.gold;
      if (data.items[e.item]?.category === 'drink') this.metrics.drinkGold += e.gold;
    });
    bus.on('restaurantUpgraded', (e) => this.mark(`restaurant_l${e.level}`));
    bus.on('pressUpgraded', (e) => this.mark(`press_l${e.level}`));
    bus.on('drinkPressed', () => {
      this.mark('first_drink');
      this.metrics.drinksPressed += 1;
    });
    bus.on('honeyCollected', (e) => {
      this.mark('first_honey');
      this.metrics.honeyCollected += e.qty;
    });
    bus.on('cooked', (e) => {
      this.metrics.cooked += 1;
      this.mark(`dish_t${e.tier}`);
    });
    bus.on('ate', () => (this.metrics.eaten += 1));
    bus.on('farmLevelUp', (e) => this.mark(`farm_level_${e.level}`));
    bus.on('levelUp', (e) => this.mark(`${e.skill}_${e.level}`));
    bus.on('bundleCompleted', (e) => this.mark(`bundle_${e.bundle}`));
    bus.on('purchased', (e) => this.mark(`bought_${e.what}`));
    bus.on('placed', (e) => this.mark(`placed_${e.kind}`));
    bus.on('decorPlaced', () => this.mark('first_decor'));
    bus.on('purchased', (e) => e.what.startsWith('sapling_') && this.mark('first_sapling'));
    bus.on('treePlanted', () => this.mark('first_tree'));
    bus.on('treeMatured', () => this.mark('first_mature_tree'));
    bus.on('fruitPicked', () => this.mark('first_fruit'));
    bus.on('produced', (e) => this.mark(e.product === 'milk' ? 'first_milk' : 'first_egg'));
    bus.on('collected', (e) => this.mark(e.product === 'milk' ? 'collected_milk' : 'collected_egg'));
    bus.on('projectStageDone', (e) => {
      this.mark('first_stage');
      if (e.complete) {
        this.mark(`project_${e.project}`);
        this.mark('first_project');
      }
    });
    bus.on('charmChanged', (e) => {
      for (const n of [25, 100]) if (e.to >= n) this.mark(`charm_${n}`);
    });
    bus.on('seasonChanged', (e) => this.mark(`season_${e.season}_${this.state.calendar.maxWeekIndex}`));
  }

  get state(): GameState {
    return this.game.state;
  }

  get playMs(): number {
    return this.metrics.playMs;
  }

  /** Records the first time something happened. */
  mark(key: string): void {
    this.metrics.moments[key] ??= {
      realMs: this.t - this.start,
      playMs: this.metrics.playMs,
      simMs: this.metrics.simMs,
    };
  }

  /** The bot tells the harness that its last look did something useful (for dead time). */
  useful(): void {
    const gap = this.metrics.playMs - this.lastUsefulPlayMs;
    if (gap > DEAD_AFTER_MS) this.metrics.deadMs += gap - DEAD_AFTER_MS;
    if (this.lastUsefulPlayMs < 30 * MIN) {
      this.metrics.longestEarlyWaitMs = Math.max(this.metrics.longestEarlyWaitMs, gap);
    }
    this.lastUsefulPlayMs = this.metrics.playMs;
  }

  /**
   * Plays for `ms` of real time: `look()` runs every `reactionMs`, and between looks the game advances
   * in one exact bulk step (split at every calendar boundary), which is what many 100 ms ticks give.
   */
  play(ms: number, reactionMs: number, look: (run: SimRun) => boolean): void {
    this.lastUsefulPlayMs = this.metrics.playMs; // coming back is not a wait
    const end = this.t + ms;
    while (this.t < end) {
      if (look(this)) this.useful();
      this.advance(Math.min(reactionMs, end - this.t));
    }
    // Close the session: a wait that ran to its end counts too.
    const gap = this.metrics.playMs - this.lastUsefulPlayMs;
    if (gap > DEAD_AFTER_MS) this.metrics.deadMs += gap - DEAD_AFTER_MS;
    this.lastUsefulPlayMs = this.metrics.playMs;
    this.snapshot();
  }

  /** Advances the game by `dt` real ms of play, as `Game.advance` does, in exact bulk steps. */
  advance(dt: number): void {
    const game = this.game;
    let a = this.t;
    const end = this.t + dt;
    while (a < end) {
      const cal = calendarTime(this.state.calendar, a);
      const lc = this.lc;
      if (!(cal < this.nextBoundary)) {
        this.nextBoundary = Math.min(nextDailyBoundary(cal, lc), nextWeeklyBoundary(cal, lc));
      }
      const b = Math.min(end, a + (this.nextBoundary - cal));
      const events: GameEvent[] = [];
      processCalendar(this.state, this.data, lc, cal, events);
      const ctx = makeContext(this.state, this.data, buildCalendar(cal, this.state.calendar, lc), events);
      this.countBuffs(b - a);
      if (this.state.ranch.buildings.some((x) => troughIsEmpty(this.state, x)))
        this.metrics.hungryMs += b - a;
      step(this.state, ctx, b - a);
      this.metrics.simMs += b - a;
      this.state.meta.playTimeMs += b - a;
      this.metrics.playMs += b - a;
      this.t = b;
      game.bus.emitAll(events);
      a = b;
    }
    const events: GameEvent[] = [];
    processCalendar(this.state, this.data, this.lc, calendarTime(this.state.calendar, this.t), events);
    game.bus.emitAll(events);
  }

  /**
   * Leaves for `ms` of real time: the game is saved (JSON), and on return loaded and caught up with
   * the offline walk, as the browser does. Returns the simulated ms the absence was worth.
   */
  away(ms: number): number {
    const raw = JSON.stringify(toSaveFile(this.state, this.t));
    this.t += ms;
    const file = parseSave(raw);
    this.game.replaceState(file.state);
    const goldBefore = this.state.stats.lifetimeGold;
    const buffsBefore = this.state.buffs.active.map((b) => ({ type: b.type, left: b.remainingMs }));
    // Moments reached while away are stamped at the return (real time) and at the end of the credited
    // time (simulated time), so the sim clock is moved first.
    const expected = simulatedMsFor(ms);
    this.metrics.simMs += expected;
    const report = this.game.catchUp(file.savedAt, this.t);
    this.metrics.simMs += report.simulatedMs - expected;
    this.metrics.offlineSimMs += report.simulatedMs;
    this.metrics.offlineGold += this.state.stats.lifetimeGold - goldBefore;
    this.metrics.aways.push({
      startMs: this.t - ms - this.start,
      ms,
      gold: this.state.stats.lifetimeGold - goldBefore,
    });
    // Buffs only count down while away (nobody eats), so their uptime is exact.
    let any = 0;
    for (const b of buffsBefore) {
      const used = Math.min(b.left, report.simulatedMs);
      this.metrics.buffMs[b.type] = (this.metrics.buffMs[b.type] ?? 0) + used;
      any = Math.max(any, used);
    }
    this.metrics.buffAnyMs += any;
    return report.simulatedMs;
  }

  /** Waits until the next local time `hour:minute` (at least one minute from now), away from the game. */
  awayUntil(hour: number, minute = 0): void {
    const next = nextLocalTime(this.t + MIN, this.lc, hour, minute);
    this.away(next - this.t);
  }

  private countBuffs(dt: number): void {
    let any = 0;
    for (const b of this.state.buffs.active) {
      const used = Math.min(b.remainingMs, dt);
      this.metrics.buffMs[b.type] = (this.metrics.buffMs[b.type] ?? 0) + used;
      any = Math.max(any, used);
    }
    this.metrics.buffAnyMs += any;
    this.metrics.buffPlayMs += any;
  }

  snapshot(): void {
    const s = this.state;
    this.metrics.snapshots.push({
      realMs: this.t - this.start,
      playMs: this.metrics.playMs,
      simMs: this.metrics.simMs,
      gold: s.gold,
      lifetimeGold: s.stats.lifetimeGold,
      farmLevel: farmLevelOf(s),
      recipesKnown: s.kitchen.known.length,
      plots: plotCount(s),
      milestones: s.progression.milestones.done.length,
      toSpend: toSpend(s, this.data),
      charm: charmOf(s, this.data),
      orchardGold: this.metrics.orchardGold,
      animalGold: this.metrics.animalGold,
      hungryMs: this.metrics.hungryMs,
      parcelSaving: parcelSaving(s, this.data),
      cropGold: this.metrics.cropGold,
      harvestValue: this.metrics.harvestValue,
      northValue: { ...this.metrics.northValue },
      restaurantGold: this.metrics.restaurantGold,
      served: this.metrics.served,
      specialGold: this.metrics.specialGold,
      drinkGold: this.metrics.drinkGold,
      drinksPressed: this.metrics.drinksPressed,
      honeyGold: this.metrics.honeyGold,
      honeyCollected: this.metrics.honeyCollected,
    });
  }
}

/** The price of the cheapest parcel the farm could buy now (every condition met, not owned), or 0. */
function parcelSaving(s: GameState, data: GameData): number {
  let best = 0;
  for (const id of PARCEL_IDS) {
    if (s.land.parcels.includes(id) || !isUnlocked(s, data.parcels[id].requires, data)) continue;
    const price = data.parcels[id].price;
    if (best === 0 || price < best) best = price;
  }
  return best;
}

/** The first moment at or after `t` whose local wall-clock time is `hour:minute`. */
export function nextLocalTime(t: number, lc: LocalClock, hour: number, minute = 0): number {
  const day = localDay(lc, t);
  for (let d = day; d < day + 3; d++) {
    const x = localTimeToEpoch(lc, d, hour, minute);
    if (x >= t) return x;
  }
  throw new Error('no such local time');
}
