// v2 phase 02: the decoration shop, placement, charm, the farmhouse style and what charm may not touch
// (docs/GDD.md §12.2, BALANCE.md §13.2).

import { describe, expect, it } from 'vitest';
import { applyAction, type Action } from '../src/core/actions';
import type { GameEvent } from '../src/core/events';
import { makeContext } from '../src/core/sim';
import { createInitialState, type GameState } from '../src/core/state';
import { buildCalendar } from '../src/core/time';
import { GAME_DATA } from '../src/data';
import { DECOR_BASE_SLOTS, DECOR_SLOTS_PER_PROJECT, CHARM_PER_PROJECT_STAGE } from '../src/data/balance';
import { DECOR, DECOR_ORDER, DECOR_SETS } from '../src/data/decor';
import { DECOR_IDS, DECOR_SET_IDS, type DecorId } from '../src/data/ids';
import { charmBreakdown, charmOf, nextCharmUnlock } from '../src/systems/charm';
import {
  autotileMask,
  buyDecor,
  decorAt,
  decorPlacementProblem,
  decorStatus,
  decorStock,
  footprintOf,
  tileProblem,
} from '../src/systems/decor';
import { computeModifiers } from '../src/systems/modifiers';
import { unitPrice } from '../src/systems/market';
import { decorSlotCap } from '../src/systems/townProjects';
import { at, NY } from './helpers';

const T = at(NY, 2026, 1, 7, 12);

function farm(gold = 10_000_000): GameState {
  const s = createInitialState(T, NY, 1);
  s.gold = gold;
  return s;
}

function run(s: GameState, action: Action): { ok: boolean; reason?: string; events: GameEvent[] } {
  const events: GameEvent[] = [];
  const ctx = makeContext(s, GAME_DATA, buildCalendar(T, s.calendar, NY), events);
  const r = applyAction(s, ctx, action);
  return { ...r, events };
}

const buy = (s: GameState, id: DecorId, qty = 1) => run(s, { type: 'buyDecor', decor: id, qty });
const place = (s: GameState, id: DecorId, col: number, row: number, flipped?: boolean) =>
  run(s, { type: 'placeDecor', decor: id, col, row, flipped });

/** A free home tile row south of the field and above the river: (6..13, 9). */
const FREE = { col: 6, row: 9 };

function giveCharm(s: GameState, charm: number): void {
  // Finished project stages are 10 charm each: the cleanest way to reach a charm level without placing pieces.
  // (This also opens whatever sets those projects give, which the tests that care set explicitly.)
  let stages = Math.ceil(charm / CHARM_PER_PROJECT_STAGE);
  s.town.projects = {};
  for (const id of Object.keys(GAME_DATA.townProjects) as (keyof typeof GAME_DATA.townProjects)[]) {
    const n = Math.min(stages, GAME_DATA.townProjects[id].stages.length);
    if (n > 0) s.town.projects[id] = { stagesDone: n, gold: 0, items: [] };
    stages -= n;
  }
}

describe('the decoration data (BALANCE.md §13.2)', () => {
  it('has the 32 pieces of three sets: Cottage 12, Seaside 10, Harvest Fair 10', () => {
    expect(DECOR_IDS).toHaveLength(32);
    expect(Object.keys(DECOR)).toHaveLength(32);
    for (const [set, n] of [
      ['cottage', 12],
      ['seaside', 10],
      ['harvest_fair', 10],
    ] as const)
      expect(Object.values(DECOR).filter((d) => d.set === set)).toHaveLength(n);
    expect(DECOR_ORDER).toEqual(DECOR_IDS);
  });

  it('each set has one path, one fence, at least one lamp that glows, and a big showpiece', () => {
    for (const set of DECOR_SET_IDS) {
      const pieces = Object.values(DECOR).filter((d) => d.set === set);
      expect(
        pieces.filter((d) => d.autotile === 'path'),
        set,
      ).toHaveLength(1);
      expect(
        pieces.filter((d) => d.autotile === 'fence'),
        set,
      ).toHaveLength(1);
      expect(pieces.filter((d) => d.glows).length, set).toBeGreaterThanOrEqual(1);
      expect(Math.max(...pieces.map((d) => d.price)), set).toBeGreaterThanOrEqual(250_000);
    }
  });

  it('prices, charm and counted copies follow the price bands', () => {
    for (const d of Object.values(DECOR)) {
      if (d.kind !== 'place') {
        expect(d.counted).toBe(1);
        expect(d.size).toEqual({ cols: 0, rows: 0 });
        continue;
      }
      if (d.autotile) {
        expect(d.price).toBeGreaterThanOrEqual(300);
        expect(d.price).toBeLessThanOrEqual(1_200);
        expect(d.charm).toBe(1);
        expect(d.counted).toBe(20);
      } else if (d.price < 20_000 && !d.glows) {
        expect(d.charm).toBeLessThanOrEqual(3);
      }
      expect(d.sprite).toBe(`decor_${d.id}`);
    }
  });

  it('the catalogue costs what the doc says: one of each, and the counted copies', () => {
    const one = (set: string): number =>
      Object.values(DECOR)
        .filter((d) => d.set === set)
        .reduce((n, d) => n + d.price, 0);
    expect(one('cottage')).toBe(979_800);
    expect(one('seaside')).toBe(488_500);
    expect(one('harvest_fair')).toBe(855_000);
    const catalogue = (set: string): number =>
      Object.values(DECOR)
        .filter((d) => d.set === set)
        .reduce((n, d) => {
          if (d.autotile === 'path') return n + 40 * d.price;
          if (d.autotile === 'fence') return n + 30 * d.price;
          if (d.kind !== 'place') return n + d.price;
          return n + d.counted * d.price;
        }, 0);
    expect(catalogue('cottage') + catalogue('seaside') + catalogue('harvest_fair')).toBe(
      1_074_000 + 692_000 + 1_007_000,
    );
  });

  it('maximum charm is 332 from pieces and farmhouse, 190 from 19 project stages: 522', () => {
    const per = (set: string): number =>
      Object.values(DECOR)
        .filter((d) => d.set === set)
        .reduce((n, d) => {
          if (d.kind === 'place') return n + d.charm * d.counted;
          return n;
        }, 0);
    // The farmhouse counts one paint, one roof and the loft: 5 + 8 + 20.
    expect(per('cottage') + 33).toBe(114);
    expect(per('seaside')).toBe(106);
    expect(per('harvest_fair')).toBe(112);
    const stages = Object.values(GAME_DATA.townProjects).reduce((n, p) => n + p.stages.length, 0);
    expect(stages).toBe(19);
    expect(114 + 106 + 112 + stages * CHARM_PER_PROJECT_STAGE).toBe(522);
  });

  it('the set names and unlocks', () => {
    expect(DECOR_SETS.cottage.unlock).toEqual([]);
    expect(DECOR_SETS.seaside.unlock).toEqual([{ kind: 'townProject', id: 'old_bridge' }]);
    expect(DECOR_SETS.harvest_fair.unlock).toEqual([{ kind: 'townProject', id: 'bakery' }]);
  });
});

describe('buying and owning decorations', () => {
  it('buys several of a piece into the stock, for gold, not the bag', () => {
    const s = farm();
    const bag = JSON.stringify(s.inventory);
    const r = buy(s, 'cobble_path', 12);
    expect(r.ok).toBe(true);
    expect(s.gold).toBe(10_000_000 - 12 * 300);
    expect(s.decor.owned.cobble_path).toBe(12);
    expect(decorStock(s, GAME_DATA, 'cobble_path')).toBe(12);
    expect(JSON.stringify(s.inventory)).toBe(bag);
    expect(r.events).toContainEqual({ type: 'purchased', what: 'cobble_path', gold: 3_600 });
  });

  it('refuses without the gold, with a bad quantity and for unknown pieces', () => {
    const s = farm(1_000);
    expect(buy(s, 'cobble_path', 4).ok).toBe(false);
    expect(buy(s, 'cobble_path', 3).ok).toBe(true);
    expect(buy(s, 'cobble_path', 0).ok).toBe(false);
    expect(buy(s, 'cobble_path', 1.5).ok).toBe(false);
    expect(buy(s, 'nonsense' as DecorId).ok).toBe(false);
    expect(s.gold).toBe(100);
  });

  it('pieces open by charm once their set is open, and say why not', () => {
    const s = farm();
    expect(decorStatus(s, GAME_DATA, 'cobble_path').unlocked).toBe(true);
    expect(decorStatus(s, GAME_DATA, 'garden_lamp')).toEqual({ unlocked: false, hint: 'Reach charm 10.' });
    const before = s.gold;
    expect(buy(s, 'garden_lamp').ok).toBe(false);
    expect(s.gold).toBe(before);
    giveCharm(s, 10);
    expect(decorStatus(s, GAME_DATA, 'garden_lamp').unlocked).toBe(true);
    expect(buy(s, 'garden_lamp').ok).toBe(true);
  });

  it('opens at the doc’s thresholds: 10, 25, 50, 80, 100, 120, 175', () => {
    const levels = new Set<number>();
    for (const d of Object.values(DECOR))
      for (const c of d.unlock) if (c.kind === 'charm') levels.add(c.amount);
    expect([...levels].sort((a, b) => a - b)).toEqual([10, 25, 50, 80, 100, 120, 175]);
    const s = farm();
    expect(nextCharmUnlock(s, GAME_DATA)).toEqual({
      amount: 10,
      pieces: ['garden_lamp', 'wooden_bench', 'paint_sage'],
    });
    giveCharm(s, 40);
    expect(nextCharmUnlock(s, GAME_DATA)?.amount).toBe(50);
  });

  it('other sets stay closed until their project is finished', () => {
    const s = farm();
    const r = buy(s, 'plank_path');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('Mend the Old Bridge');
    s.town.projects.old_bridge = { stagesDone: 3, gold: 0, items: [] };
    expect(buy(s, 'plank_path').ok).toBe(true);
    expect(buy(s, 'brick_path').ok).toBe(false);
    s.town.projects.bakery = { stagesDone: 3, gold: 0, items: [] };
    expect(buy(s, 'brick_path').ok).toBe(true);
  });

  it('farmhouse pieces are owned once', () => {
    const s = farm();
    giveCharm(s, 30);
    expect(buy(s, 'paint_sage').ok).toBe(true);
    expect(buy(s, 'paint_sage').ok).toBe(false);
    expect(buy(s, 'paint_sky', 2).ok).toBe(false);
    expect(s.decor.owned.paint_sage).toBe(1);
  });

  it('buying places nothing and changes nothing else', () => {
    const s = farm();
    const events: GameEvent[] = [];
    const ctx = makeContext(s, GAME_DATA, buildCalendar(T, s.calendar, NY), events);
    expect(buyDecor(s, ctx, 'picket_fence', 2).ok).toBe(true);
    expect(s.decor.placed).toEqual([]);
    expect(s.decor.farmhouse).toEqual({ paint: null, roof: null, loft: false });
  });
});

describe('placement', () => {
  it('stands a piece from the stock on a free tile, and the stock goes down', () => {
    const s = farm();
    buy(s, 'cobble_path', 2);
    const r = place(s, 'cobble_path', FREE.col, FREE.row);
    expect(r.ok).toBe(true);
    expect(s.decor.placed).toEqual([{ id: 1, decor: 'cobble_path', at: FREE }]);
    expect(decorStock(s, GAME_DATA, 'cobble_path')).toBe(1);
    expect(r.events.map((e) => e.type)).toContain('decorPlaced');
    expect(place(s, 'cobble_path', FREE.col + 1, FREE.row).ok).toBe(true);
    expect(s.decor.placed.map((p) => p.id)).toEqual([1, 2]);
    expect(place(s, 'cobble_path', FREE.col + 2, FREE.row).ok).toBe(false); // out of stock
  });

  it('needs the footprint to be free: 2 × 1 and 2 × 2 pieces cover every tile', () => {
    const s = farm();
    buy(s, 'flower_bed', 2);
    expect(place(s, 'flower_bed', 6, 9).ok).toBe(true);
    expect(decorAt(s, GAME_DATA, 7, 9)?.decor).toBe('flower_bed'); // the second tile
    expect(place(s, 'flower_bed', 7, 9).ok).toBe(false); // overlaps the first
    expect(place(s, 'flower_bed', 8, 9).ok).toBe(true);
    expect(footprintOf(DECOR.stone_well, 3, 4)).toEqual([
      { col: 3, row: 4 },
      { col: 4, row: 4 },
      { col: 3, row: 5 },
      { col: 4, row: 5 },
    ]);
  });

  it('refuses plots, the fence ring, water, buildings, paths, traps and the field at its full size', () => {
    const s = farm();
    buy(s, 'cobble_path', 40);
    const bad: [number, number, RegExp][] = [
      [6, 2, /field/], // a plot
      [13, 7, /field/], // a plot only a later expansion opens
      [5, 4, /field/], // the fence ring
      [2, 2, /farmhouse/],
      [2, 0, /farmhouse/], // above the farmhouse (the loft)
      [2, 8, /pond/],
      [8, 10, /river/],
      [17, 10, /dock/], // the dock and its trap spots
      [16, 7, /market/],
      [18, 7, /Bin/],
      [17, 3, /greenhouse/],
      [8, 5, /path/],
      [16, 9, /path/],
      [20, 4, /Lanes/],
      [18, 9, /Lanes/],
      [5, 3, /cat/],
      [3, 14, /town/],
      [17, 15, /sea|town|inlet|Lanes/],
    ];
    for (const [c, r, why] of bad) {
      const p = decorPlacementProblem(s, GAME_DATA, 'cobble_path', c, r);
      expect(p, `${c},${r}`).toMatch(why);
      expect(place(s, 'cobble_path', c, r).ok).toBe(false);
    }
    expect(s.decor.placed).toEqual([]);
    expect(tileProblem(s, GAME_DATA, -1, 0)).toMatch(/edge/);
    expect(tileProblem(s, GAME_DATA, 36, 3)).toMatch(/edge/);
  });

  it('refuses locked parcels, and allows an owned one except its tree spots', () => {
    const s = farm();
    buy(s, 'cobble_path', 5);
    expect(place(s, 'cobble_path', 24, 3).reason).toMatch(/Hilltop Orchard/);
    s.land.parcels.push('orchard');
    expect(place(s, 'cobble_path', 24, 3).ok).toBe(true); // between the two rows of trees
    expect(place(s, 'cobble_path', 22, 1).reason).toMatch(/tree spot/);
    expect(place(s, 'cobble_path', 23, 2).reason).toMatch(/tree spot/);
    expect(place(s, 'cobble_path', 25, 24).ok).toBe(false);
    // The paddock stays locked.
    expect(place(s, 'cobble_path', 30, 10).reason).toMatch(/Old Paddock/);
  });

  it('the meadow’s beach is open to the Seaside pieces once the meadow is bought', () => {
    const s = farm();
    s.town.projects.old_bridge = { stagesDone: 3, gold: 0, items: [] };
    buy(s, 'sandcastle', 2);
    expect(place(s, 'sandcastle', 25, 19).reason).toMatch(/Seaside Meadow/);
    s.land.parcels.push('orchard', 'yard', 'meadow');
    expect(place(s, 'sandcastle', 25, 19).ok).toBe(true);
    expect(place(s, 'sandcastle', 25, 20).ok).toBe(false); // the sea
  });

  it('a 2 × 2 needs all four tiles inside the rules, and no piece goes on top of another', () => {
    const s = farm();
    s.land.parcels.push('orchard', 'yard');
    s.town.projects.bakery = { stagesDone: 3, gold: 0, items: [] };
    giveCharm(s, 120);
    buy(s, 'stone_well', 2);
    expect(place(s, 'stone_well', 20, 9).ok).toBe(false); // half on a lane
    expect(place(s, 'stone_well', 25, 3).ok).toBe(false); // the orchard's rows between trees are one tile high
    expect(place(s, 'stone_well', 22, 9).ok).toBe(true);
    expect(place(s, 'stone_well', 23, 10).reason).toMatch(/already there/); // overlaps the well
    expect(place(s, 'stone_well', 24, 9).ok).toBe(true);
    expect(decorAt(s, GAME_DATA, 23, 10)?.id).toBe(1);
  });

  it('flips only the pieces whose sprite allows it', () => {
    const s = farm();
    giveCharm(s, 30);
    buy(s, 'wooden_bench');
    buy(s, 'flower_bed');
    expect(place(s, 'wooden_bench', 6, 9, true).ok).toBe(true);
    expect(s.decor.placed[0]!.flipped).toBe(true);
    expect(place(s, 'flower_bed', 8, 9, true).ok).toBe(true);
    expect(s.decor.placed[1]!.flipped).toBeUndefined();
  });

  it('has a cap on placed pieces: 100, and 40 more for each of four finished projects', () => {
    expect(DECOR_BASE_SLOTS).toBe(100);
    expect(DECOR_SLOTS_PER_PROJECT).toBe(40);
    const s = farm();
    expect(decorSlotCap(s, GAME_DATA)).toBe(100);
    for (const id of ['old_bridge', 'fountain', 'bandstand', 'lighthouse'] as const)
      s.town.projects[id] = { stagesDone: 3, gold: 0, items: [] };
    expect(decorSlotCap(s, GAME_DATA)).toBe(260);
    s.town.projects.bakery = { stagesDone: 3, gold: 0, items: [] };
    expect(decorSlotCap(s, GAME_DATA)).toBe(260); // the bakery gives a set, not slots
    // And the 101st piece is refused.
    const t = farm();
    t.land.parcels.push('orchard', 'yard', 'meadow');
    buy(t, 'cobble_path', 101);
    let placed = 0;
    for (let row = 0; row < 22 && placed < 100; row++)
      for (let col = 21; col < 36 && placed < 100; col++)
        if (place(t, 'cobble_path', col, row).ok) placed += 1;
    expect(placed).toBe(100);
    for (let row = 0; row < 22; row++)
      for (let col = 21; col < 36; col++) {
        const r = place(t, 'cobble_path', col, row);
        if (r.reason?.match(/slot/)) {
          expect(t.decor.placed).toHaveLength(100);
          return;
        }
      }
    throw new Error('the cap never stopped a placement');
  });

  it('farmhouse pieces are not placed', () => {
    const s = farm();
    giveCharm(s, 30);
    buy(s, 'paint_sage');
    expect(place(s, 'paint_sage', 6, 9).reason).toMatch(/farmhouse/);
  });
});

describe('picking up and moving', () => {
  it('a picked-up piece returns to the stock and nothing is lost', () => {
    const s = farm();
    buy(s, 'cobble_path', 1);
    place(s, 'cobble_path', 6, 9);
    expect(decorStock(s, GAME_DATA, 'cobble_path')).toBe(0);
    const r = run(s, { type: 'pickUpDecor', id: 1 });
    expect(r.ok).toBe(true);
    expect(s.decor.placed).toEqual([]);
    expect(decorStock(s, GAME_DATA, 'cobble_path')).toBe(1);
    expect(s.decor.owned.cobble_path).toBe(1);
    expect(r.events.map((e) => e.type)).toContain('decorPickedUp');
    expect(run(s, { type: 'pickUpDecor', id: 1 }).ok).toBe(false);
  });

  it('moves a piece to another tile (it never blocks itself) and keeps its id', () => {
    const s = farm();
    buy(s, 'flower_bed', 2);
    place(s, 'flower_bed', 6, 9);
    place(s, 'flower_bed', 9, 9);
    expect(run(s, { type: 'moveDecor', id: 1, col: 7, row: 9 }).ok).toBe(true); // overlaps its old self
    expect(s.decor.placed[0]).toEqual({ id: 1, decor: 'flower_bed', at: { col: 7, row: 9 } });
    expect(run(s, { type: 'moveDecor', id: 1, col: 8, row: 9 }).reason).toMatch(/already there/); // meets the second
    expect(run(s, { type: 'moveDecor', id: 1, col: 5, row: 9 }).ok).toBe(true); // (5,9) is free: only rows 1–8 are the ring
    expect(run(s, { type: 'moveDecor', id: 1, col: 2, row: 9 }).ok).toBe(false); // the pond
    expect(s.decor.placed[0]!.at).toEqual({ col: 5, row: 9 });
    expect(run(s, { type: 'moveDecor', id: 99, col: 5, row: 9 }).ok).toBe(false);
  });

  it('moving does not need stock or a free slot', () => {
    const s = farm();
    buy(s, 'cobble_path', 1);
    place(s, 'cobble_path', 6, 9);
    expect(decorStock(s, GAME_DATA, 'cobble_path')).toBe(0);
    expect(run(s, { type: 'moveDecor', id: 1, col: 7, row: 9 }).ok).toBe(true);
  });

  it('can flip a piece as it moves', () => {
    const s = farm();
    giveCharm(s, 20);
    buy(s, 'wooden_bench');
    place(s, 'wooden_bench', 6, 9);
    run(s, { type: 'moveDecor', id: 1, col: 6, row: 9, flipped: true });
    expect(s.decor.placed[0]!.flipped).toBe(true);
    run(s, { type: 'moveDecor', id: 1, col: 6, row: 9, flipped: false });
    expect(s.decor.placed[0]!.flipped).toBeUndefined();
  });
});

describe('auto-tiling', () => {
  it('a path or fence joins its same-id neighbours: N 1, E 2, S 4, W 8', () => {
    const s = farm();
    buy(s, 'cobble_path', 4);
    for (const c of [7, 8, 9]) place(s, 'cobble_path', c, 9);
    const p = s.decor.placed;
    expect(autotileMask(p, 'cobble_path', 7, 9)).toBe(2); // a neighbour to the east
    expect(autotileMask(p, 'cobble_path', 8, 9)).toBe(2 | 8); // both sides
    expect(autotileMask(p, 'cobble_path', 9, 9)).toBe(8);
    expect(autotileMask(p, 'cobble_path', 20, 9)).toBe(0);
  });

  it('recalculates when a neighbour is placed, moved or picked up, and never joins a different piece', () => {
    const s = farm();
    buy(s, 'cobble_path', 4);
    buy(s, 'picket_fence', 2);
    place(s, 'cobble_path', 7, 9);
    expect(autotileMask(s.decor.placed, 'cobble_path', 7, 9)).toBe(0);
    place(s, 'cobble_path', 8, 9); // id 2
    expect(autotileMask(s.decor.placed, 'cobble_path', 7, 9)).toBe(2);
    place(s, 'picket_fence', 9, 9);
    expect(autotileMask(s.decor.placed, 'cobble_path', 8, 9)).toBe(8); // the fence does not join the path
    expect(autotileMask(s.decor.placed, 'picket_fence', 9, 9)).toBe(0);
    run(s, { type: 'moveDecor', id: 2, col: 12, row: 9 });
    expect(autotileMask(s.decor.placed, 'cobble_path', 7, 9)).toBe(0);
    run(s, { type: 'pickUpDecor', id: 1 });
    expect(autotileMask(s.decor.placed, 'cobble_path', 12, 9)).toBe(0);
  });

  it('joins in every direction (a plus makes 15 at its middle)', () => {
    const s = farm();
    s.land.parcels.push('orchard', 'yard');
    buy(s, 'cobble_path', 5);
    for (const [c, r] of [
      [24, 11],
      [23, 12],
      [24, 12],
      [25, 12],
      [24, 13],
    ] as const)
      expect(place(s, 'cobble_path', c, r).ok).toBe(true);
    expect(autotileMask(s.decor.placed, 'cobble_path', 24, 12)).toBe(15);
    expect(autotileMask(s.decor.placed, 'cobble_path', 24, 11)).toBe(4);
    expect(autotileMask(s.decor.placed, 'cobble_path', 23, 12)).toBe(2);
  });
});

describe('charm (derived, never stored)', () => {
  it('counts only the first few copies of a piece, so variety beats spam', () => {
    const s = farm();
    expect(charmOf(s, GAME_DATA)).toBe(0);
    buy(s, 'cobble_path', 25);
    s.land.parcels.push('orchard', 'yard', 'meadow');
    let placed = 0;
    for (let row = 12; row < 15 && placed < 25; row++)
      for (let col = 21; col < 36 && placed < 25; col++) if (place(s, 'cobble_path', col, row).ok) placed++;
    expect(placed).toBe(25);
    // 25 cobbles stand, but only 20 count, at 1 charm each.
    expect(charmOf(s, GAME_DATA)).toBe(20);
    expect(charmBreakdown(s, GAME_DATA)).toEqual({ pieces: 20, farmhouse: 0, projects: 0, total: 20 });
  });

  it('is capped per piece: 4 flower beds are worth 9, not 12', () => {
    const s = farm();
    s.land.parcels.push('orchard', 'yard', 'meadow');
    buy(s, 'flower_bed', 4);
    let n = 0;
    for (let c = 22; c < 36 && n < 4; c += 3) if (place(s, 'flower_bed', c, 12).ok) n++;
    expect(n).toBe(4);
    expect(charmOf(s, GAME_DATA)).toBe(9);
  });

  it('pieces in the stock count nothing, and picking one up takes its charm away', () => {
    const s = farm();
    buy(s, 'flower_bed', 3);
    expect(charmOf(s, GAME_DATA)).toBe(0);
    place(s, 'flower_bed', 6, 9);
    expect(charmOf(s, GAME_DATA)).toBe(3);
    run(s, { type: 'pickUpDecor', id: 1 });
    expect(charmOf(s, GAME_DATA)).toBe(0);
  });

  it('the applied farmhouse paint, roof and loft count once each; the default look counts 0', () => {
    const s = farm();
    giveCharm(s, 30);
    s.town.projects = {};
    expect(charmOf(s, GAME_DATA)).toBe(0);
    s.decor.owned = { paint_sage: 1, paint_sky: 1, roof_thatch: 1, roof_slate: 1, farmhouse_loft: 1 };
    run(s, { type: 'styleFarmhouse', paint: 'paint_sage' });
    expect(charmOf(s, GAME_DATA)).toBe(5);
    run(s, { type: 'styleFarmhouse', paint: 'paint_sky', roof: 'roof_slate', loft: true });
    expect(charmOf(s, GAME_DATA)).toBe(5 + 8 + 20);
    run(s, { type: 'styleFarmhouse', paint: null, roof: null, loft: false });
    expect(charmOf(s, GAME_DATA)).toBe(0);
  });

  it('each finished project stage adds 10', () => {
    const s = farm();
    expect(charmOf(s, GAME_DATA)).toBe(0);
    s.town.projects.old_bridge = { stagesDone: 2, gold: 5, items: [] };
    s.town.projects.fountain = { stagesDone: 1, gold: 0, items: [] };
    expect(charmOf(s, GAME_DATA)).toBe(30);
  });

  it('reports charmChanged from the actions that change it', () => {
    const s = farm();
    buy(s, 'flower_bed', 1);
    const placed = place(s, 'flower_bed', 6, 9);
    expect(placed.events).toContainEqual({ type: 'charmChanged', from: 0, to: 3 });
    const up = run(s, { type: 'pickUpDecor', id: 1 });
    expect(up.events).toContainEqual({ type: 'charmChanged', from: 3, to: 0 });
    const moved =
      (buy(s, 'flower_bed'),
      place(s, 'flower_bed', 6, 9),
      run(s, { type: 'moveDecor', id: 2, col: 8, row: 9 }));
    expect(moved.events.map((e) => e.type)).not.toContain('charmChanged');
  });

  it('touches no price, growth or timer: placing every piece and finishing every project leaves computeModifiers alone', () => {
    const s = farm(1e12);
    const before = JSON.stringify(
      (['spring', 'summer', 'autumn', 'winter'] as const).map((season) =>
        computeModifiers(s, GAME_DATA, season),
      ),
    );
    const prices = (['turnip', 'wheat', 'koi'] as const).map((i) =>
      unitPrice(s, GAME_DATA, computeModifiers(s, GAME_DATA, 'spring'), i),
    );
    s.land.parcels.push('orchard', 'yard', 'meadow');
    for (const id of Object.keys(GAME_DATA.townProjects) as (keyof typeof GAME_DATA.townProjects)[])
      s.town.projects[id] = { stagesDone: GAME_DATA.townProjects[id].stages.length, gold: 0, items: [] };
    for (const id of DECOR_IDS) buy(s, id, DECOR[id].kind === 'place' ? 40 : 1);
    run(s, { type: 'styleFarmhouse', paint: 'paint_sky', roof: 'roof_slate', loft: true });
    let placed = 0;
    for (const id of DECOR_IDS) {
      if (DECOR[id].kind !== 'place') continue;
      outer: for (let row = 0; row < 22; row++)
        for (let col = 0; col < 36; col++)
          if (place(s, id, col, row).ok) {
            placed++;
            break outer;
          }
    }
    expect(placed).toBeGreaterThan(15);
    expect(charmOf(s, GAME_DATA)).toBeGreaterThan(300);
    const after = JSON.stringify(
      (['spring', 'summer', 'autumn', 'winter'] as const).map((season) =>
        computeModifiers(s, GAME_DATA, season),
      ),
    );
    expect(after).toBe(before);
    expect(
      (['turnip', 'wheat', 'koi'] as const).map((i) =>
        unitPrice(s, GAME_DATA, computeModifiers(s, GAME_DATA, 'spring'), i),
      ),
    ).toEqual(prices);
    // And it is a pure function of the state: nothing about charm is stored.
    expect(Object.keys(s)).not.toContain('charm');
    expect(JSON.stringify(s)).not.toMatch(/"charm"/);
  });
});

describe('the farmhouse style', () => {
  it('needs the piece to be owned; applying is free and can be switched back', () => {
    const s = farm();
    expect(run(s, { type: 'styleFarmhouse', paint: 'paint_sage' }).ok).toBe(false);
    giveCharm(s, 30);
    buy(s, 'paint_sage');
    const gold = s.gold;
    expect(run(s, { type: 'styleFarmhouse', paint: 'paint_sage' }).ok).toBe(true);
    expect(s.gold).toBe(gold);
    expect(s.decor.farmhouse).toEqual({ paint: 'paint_sage', roof: null, loft: false });
    expect(run(s, { type: 'styleFarmhouse', paint: null }).ok).toBe(true);
    expect(s.decor.farmhouse.paint).toBeNull();
    expect(run(s, { type: 'styleFarmhouse', loft: true }).ok).toBe(false);
  });

  it('only accepts the right kind of piece for each part', () => {
    const s = farm();
    giveCharm(s, 90);
    buy(s, 'paint_sage');
    buy(s, 'roof_thatch');
    expect(run(s, { type: 'styleFarmhouse', roof: 'paint_sage' }).ok).toBe(false);
    expect(run(s, { type: 'styleFarmhouse', paint: 'roof_thatch' }).ok).toBe(false);
    expect(run(s, { type: 'styleFarmhouse', paint: 'cobble_path' }).ok).toBe(false);
    expect(run(s, { type: 'styleFarmhouse', roof: 'roof_thatch' }).ok).toBe(true);
    expect(s.decor.farmhouse.paint).toBeNull();
  });
});

describe('decorations belong to the player’s own land, never the bag', () => {
  it('a decoration is not an item', () => {
    for (const id of DECOR_IDS) expect(GAME_DATA.items[id as never]).toBeUndefined();
  });
});
