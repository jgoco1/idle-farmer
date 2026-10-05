// v4 phase 01: the north band and its two fields (GDD §13.1–13.3, DATA_SCHEMAS §10.2–10.3, BALANCE §14.1).

import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../src/core/events';
import { runOffline } from '../src/core/offline';
import { makeContext, processCalendar, step } from '../src/core/sim';
import { createInitialState, emptyPlot, type GameState } from '../src/core/state';
import { buildCalendar } from '../src/core/time';
import { applyAction } from '../src/core/actions';
import { GAME_DATA } from '../src/data';
import { FIELD_BASE, GREENHOUSE_BASE } from '../src/data/balance';
import { NORTH_FIELD_IDS, seedOf, type CropId, type NorthFieldId, type UpgradeId } from '../src/data/ids';
import {
  DECOR_BLOCKED,
  fixedBlockReason,
  northFenceRect,
  regionAt,
  WORLD_BOTTOM,
  WORLD_COLS,
  WORLD_LAYOUT,
  WORLD_TOP,
} from '../src/data/world';
import { clampCamera, visibleChunks, visibleRect } from '../src/render/camera';
import {
  buildLayout,
  forSaleSignAt,
  groundAt,
  plotIndexAt,
  tileAt,
  tileOfPlot,
  TILE,
  WORLD_Y0,
} from '../src/render/scene';
import { planPlanter } from '../src/systems/automation';
import { decorPlacementProblem, tileProblem } from '../src/systems/decor';
import {
  allPlotIndexes,
  expandToolArea,
  fieldOf,
  isGreenhouseIndex,
  lastPlanted,
  newNorthField,
  plotAt,
  plotCount,
  plotWatered,
  useTool,
  witherOutOfSeasonCrops,
} from '../src/systems/farming';
import { addItem, countItem } from '../src/systems/inventory';
import { buyParcel } from '../src/systems/parcels';
import { coverageOf, occupiedPlots, placeObject, placementProblem } from '../src/systems/placement';
import { buildingPlacementProblem } from '../src/systems/ranch';
import { orderedCrops } from '../src/systems/seedOrder';
import { bulkPlots } from '../src/ui/farmTools';
import { at, DATA_NO_PERKS, HOUR, NY, setFarmLevel } from './helpers';

const CREATED = at(NY, 2026, 1, 7, 10); // Wednesday, spring
const SEC = 1000;
const MIN = 60 * SEC;

function farmAt(t = CREATED): GameState {
  const s = createInitialState(CREATED, NY, 1);
  processCalendar(s, GAME_DATA, NY, t, []);
  return s;
}

function ctxAt(s: GameState, events: GameEvent[] = [], t = CREATED) {
  return makeContext(s, GAME_DATA, buildCalendar(t, s.calendar, NY), events);
}

/** Owns a north field (parcel and plots), as buying it does; every plot tilled when `tilled`. */
function ownNorth(s: GameState, field: NorthFieldId, tilled = true): void {
  if (!s.land.parcels.includes(field)) s.land.parcels.push(field);
  s.farm.north[field] = newNorthField(field);
  if (tilled) for (const p of s.farm.north[field].plots) Object.assign(p, emptyPlot('tilled'));
}

function own(s: GameState, levels: Partial<Record<UpgradeId, number>>): void {
  Object.assign(s.upgrades, levels);
  if (levels.farmhand)
    s.automation.farmhandCooldownMs =
      GAME_DATA.upgrades.farmhand!.effect[levels.farmhand]!.intervalSec! * SEC;
}

function stock(s: GameState, crop: CropId, qty: number): void {
  if (s.inventory.stackSize < qty) s.inventory.stackSize = qty;
  expect(addItem(s.inventory, seedOf(crop), qty)).toBe(true);
}

const N = FIELD_BASE.north_fields;
const T = FIELD_BASE.terraces;

describe('coordinates: the world grows north (DATA_SCHEMAS §10.2)', () => {
  it('tileAt and regionAt work on negative rows, and nothing exists above the tree line', () => {
    expect(tileAt(0, -0.5)).toEqual({ col: 0, row: -1 });
    expect(tileAt(5 * TILE + 3, WORLD_Y0)).toEqual({ col: 5, row: WORLD_TOP });
    expect(tileAt(0, WORLD_Y0 - 0.01)).toBeNull();
    expect(regionAt(3, -5)).toBe('north_fields');
    expect(regionAt(3, -10)).toBe('terraces');
    expect(regionAt(25, -4)).toBe('northroad');
    expect(regionAt(25, -10)).toBe('woods');
    expect(regionAt(20, -5)).toBe('lanes'); // the north road
    expect(regionAt(5, -1)).toBe('lanes'); // the hedge row
    expect(regionAt(5, WORLD_TOP - 1)).toBeNull();
  });

  it('every tile of the north band belongs to exactly one region or the lanes, and the old world is unchanged', () => {
    for (let row = WORLD_TOP; row < 0; row++)
      for (let col = 0; col < WORLD_COLS; col++) expect(regionAt(col, row), `${col},${row}`).not.toBeNull();
    expect(regionAt(0, 0)).toBe('home');
    expect(regionAt(25, 3)).toBe('orchard');
  });

  it('the blocked-tile key stays unique for negative rows', () => {
    const keys = new Set<number>();
    for (let row = WORLD_TOP; row < WORLD_BOTTOM; row++)
      for (let col = 0; col < WORLD_COLS; col++) keys.add(row * WORLD_COLS + col);
    expect(keys.size).toBe(WORLD_COLS * (WORLD_BOTTOM - WORLD_TOP));
    // The hedge at (35, -1)'s neighbour in the key space is not mistaken for anything at row 0.
    expect(fixedBlockReason(19, -1)).toMatch(/hedge/);
    expect(fixedBlockReason(0, 0)).toBeNull();
  });

  it('decorations go on owned north parcels only, never on a field, path, hedge, lane, the road or the woods', () => {
    const s = farmAt();
    expect(tileProblem(s, GAME_DATA, 2, -4)).toMatch(/North Fields/);
    ownNorth(s, 'north_fields');
    expect(tileProblem(s, GAME_DATA, 2, -4)).toBeNull();
    expect(tileProblem(s, GAME_DATA, 8, -4)).toMatch(/field/); // a plot
    expect(tileProblem(s, GAME_DATA, 5, -7)).toMatch(/field/); // the fence ring
    expect(tileProblem(s, GAME_DATA, 16, -5)).toMatch(/path/);
    expect(tileProblem(s, GAME_DATA, 3, -1)).toMatch(/hedge/);
    expect(tileProblem(s, GAME_DATA, 20, -4)).toMatch(/Lanes/);
    expect(tileProblem(s, GAME_DATA, 24, -4)).toMatch(/north road/);
    expect(tileProblem(s, GAME_DATA, 24, -10)).toMatch(/woods/);
    expect(tileProblem(s, GAME_DATA, 3, WORLD_TOP)).toMatch(/forest/);
    expect(tileProblem(s, GAME_DATA, 3, WORLD_TOP - 1)).toMatch(/edge of the world/);
    expect(tileProblem(s, GAME_DATA, 3, -10)).toMatch(/Upper Terraces/);
    s.decor.owned.garden_lamp = 1;
    expect(decorPlacementProblem(s, GAME_DATA, 'garden_lamp', 2, -4)).toBeNull();
    const r = applyAction(s, ctxAt(s), { type: 'placeDecor', decor: 'garden_lamp', col: 2, row: -4 });
    expect(r.ok).toBe(true);
    expect(s.decor.placed.at(-1)!.at).toEqual({ col: 2, row: -4 });
  });

  it('ranch buildings stay in the Old Paddock: a north tile is refused', () => {
    const s = farmAt();
    s.land.parcels.push('orchard', 'yard');
    ownNorth(s, 'north_fields');
    expect(buildingPlacementProblem(s, GAME_DATA, 'coop', 1, -6)).toMatch(/Old Paddock/);
  });

  it('chunks above row 0 are drawn when the view is there, and the camera stops at the tree line', () => {
    const view = { w: 360, h: 560, dpr: 1 };
    const cam = clampCamera({ x: 100, y: -1000, zoom: 2 }, view);
    const v = visibleRect(cam, view);
    expect(v.y).toBeCloseTo(WORLD_Y0);
    expect(visibleChunks(v)).toContain(0);
    expect(visibleChunks({ x: 0, y: -10, w: 8, h: 4 })).toEqual([0]); // y −224 … 32 is chunk row 0
    expect(visibleChunks({ x: 0, y: 40, w: 8, h: 4 })).toEqual([3]);
  });
});

describe('the north layout (GDD §13.2)', () => {
  it('has the two fields, their fences, gates and paths to the north road, inside their parcels', () => {
    for (const f of NORTH_FIELD_IDS) {
      const n = WORLD_LAYOUT.northFields[f];
      const fence = northFenceRect(f);
      for (let r = fence.row; r < fence.row + fence.rows; r++)
        for (let c = fence.col; c < fence.col + fence.cols; c++) expect(regionAt(c, r)).toBe(f);
      expect(n.gate.col).toBe(fence.col + fence.cols - 1);
      expect(n.path[0]).toEqual({ col: n.gate.col + 1, row: n.gate.row });
      expect(n.path.at(-1)!.col + 1).toBe(WORLD_LAYOUT.northRoadCol);
      expect(n.rest).toEqual(n.path[0]);
      expect(regionAt(WORLD_LAYOUT.forSaleSigns[f].col, WORLD_LAYOUT.forSaleSigns[f].row)).toBe(f);
    }
    expect(WORLD_LAYOUT.northFields.north_fields.grid).toEqual({ cols: 8, rows: 4 });
    expect(WORLD_LAYOUT.northFields.terraces.grid).toEqual({ cols: 8, rows: 3 });
    expect(WORLD_LAYOUT.hiveSpots).toHaveLength(6);
    for (const h of WORLD_LAYOUT.hiveSpots) expect(regionAt(h.col, h.row)).toBe('northroad');
  });

  it('draws an owned field: soil plots, the fence ring with corners, one gate in the east rail, a path to the road', () => {
    for (const f of NORTH_FIELD_IDS) {
      const locked = buildLayout({ cols: 8, rows: 6 }, ['farm_4'], ['orchard', 'yard']);
      const owned = buildLayout(
        { cols: 8, rows: 6 },
        ['farm_4'],
        ['orchard', 'yard', 'north_fields', 'terraces'],
      );
      const n = WORLD_LAYOUT.northFields[f];
      const fence = northFenceRect(f);
      const at = (o: { x: number; y: number }) => `${o.x / TILE},${o.y / TILE}`;
      const fenceSprites = new Map(
        owned.objects.filter((o) => o.sprite.startsWith('obj_fence')).map((o) => [at(o), o.sprite]),
      );
      const right = fence.col + fence.cols - 1;
      const bottom = fence.row + fence.rows - 1;
      expect(fenceSprites.get(`${fence.col},${fence.row}`)).toBe('obj_fence_nw');
      expect(fenceSprites.get(`${right},${fence.row}`)).toBe('obj_fence_ne');
      expect(fenceSprites.get(`${fence.col},${bottom}`)).toBe('obj_fence_sw');
      expect(fenceSprites.get(`${right},${bottom}`)).toBe('obj_fence_se');
      expect(fenceSprites.get(`${n.gate.col},${n.gate.row}`)).toBe('obj_fence_gate_v');
      for (let c = n.origin.col; c < n.origin.col + n.grid.cols; c++)
        for (let r = n.origin.row; r < n.origin.row + n.grid.rows; r++) {
          expect(groundAt(owned.ground, c, r)).toBe('tile_soil_dry');
          expect(fenceSprites.has(`${c},${r}`)).toBe(false);
        }
      for (const t of n.path) expect(groundAt(owned.ground, t.col, t.row)).toBe('tile_path');
      expect(groundAt(owned.ground, n.gate.col, n.gate.row)).toBe('tile_path');
      // Before it is bought: no fence, no soil, a "For sale" sign and overgrowth.
      expect(locked.objects.some((o) => o.sprite.startsWith('obj_fence') && o.y / TILE === fence.row)).toBe(
        false,
      );
      expect(groundAt(locked.ground, n.origin.col, n.origin.row)).not.toBe('tile_soil_dry');
      const sign = WORLD_LAYOUT.forSaleSigns[f];
      expect(forSaleSignAt(['orchard', 'yard'], sign.col, sign.row)).toBe(f);
      expect(forSaleSignAt(['north_fields', 'terraces'], sign.col, sign.row)).toBeNull();
    }
  });

  it('blocks every field tile, its fence ring and path, the hedges and the tree line for decorations', () => {
    for (const f of NORTH_FIELD_IDS) {
      const fence = northFenceRect(f);
      for (let r = fence.row; r < fence.row + fence.rows; r++)
        for (let c = fence.col; c < fence.col + fence.cols; c++)
          expect(fixedBlockReason(c, r), `${c},${r}`).not.toBeNull();
      for (const t of WORLD_LAYOUT.northFields[f].path)
        expect(fixedBlockReason(t.col, t.row)).toMatch(/path/);
    }
    for (const h of WORLD_LAYOUT.hedges)
      for (let c = h.col; c < h.col + h.cols; c++) expect(fixedBlockReason(c, h.row)).not.toBeNull();
    for (let c = 0; c < WORLD_COLS; c++) expect(fixedBlockReason(c, WORLD_TOP)).not.toBeNull();
    for (const { rect } of DECOR_BLOCKED) expect(rect.row).toBeGreaterThanOrEqual(WORLD_TOP);
  });

  it('draws the north scenery: the tree line, pines, hedges in four seasons, the lake and two empty lots', () => {
    const layout = buildLayout({ cols: 4, rows: 2 });
    const sprites = layout.objects.map((o) => o.sprite);
    expect(sprites.filter((s) => s === 'obj_lot_sign')).toHaveLength(2);
    expect(sprites).toContain('obj_jetty');
    const hedges = layout.objects.filter((o) => o.sprite.startsWith('obj_hedge'));
    expect(hedges).toHaveLength(40);
    expect(hedges[0]!.seasonal).toEqual([
      'obj_hedge_spring',
      'obj_hedge',
      'obj_hedge_autumn',
      'obj_hedge_winter',
    ]);
    const line = layout.objects.filter((o) => o.y + o.h === (WORLD_TOP + 1) * TILE);
    expect(line.length).toBeGreaterThanOrEqual(WORLD_COLS - 4);
    const pines = layout.objects.filter((o) => o.sprite.startsWith('obj_pine'));
    expect(pines.every((o) => o.seasonal?.[3]?.endsWith('_winter'))).toBe(true);
    const lake = WORLD_LAYOUT.lake;
    expect(groundAt(layout.ground, lake.col + 2, lake.row + 1)).toMatch(/^tile_lake_[ab]$/);
    expect(groundAt(layout.ground, lake.col, lake.row)).toBe('tile_lake_corner_nw');
    expect(layout.animated.some((a) => a.row < 0 && a.sprite.startsWith('tile_lake'))).toBe(true);
    expect(groundAt(layout.ground, 24, -10)).toMatch(/^tile_woods_/);
    expect(groundAt(layout.ground, 24, -4)).toBe('tile_soil_untilled'); // the restaurant's lot
    expect(groundAt(layout.ground, 20, -10)).toBe('tile_path'); // the north road
  });
});

describe('north fields: plot addressing (DATA_SCHEMAS §10.3)', () => {
  it('maps every plot index to its tile and back, in every field', () => {
    const s = farmAt();
    ownNorth(s, 'north_fields');
    ownNorth(s, 'terraces');
    const grid = { cols: 8, rows: 6 };
    const owned = ['north_fields', 'terraces'];
    for (const f of NORTH_FIELD_IDS) {
      const n = WORLD_LAYOUT.northFields[f];
      for (let i = 0; i < n.grid.cols * n.grid.rows; i++) {
        const index = FIELD_BASE[f] + i;
        const t = tileOfPlot(grid, index);
        expect(t).toEqual({ col: n.origin.col + (i % 8), row: n.origin.row + Math.floor(i / 8) });
        expect(plotIndexAt(grid, t.col, t.row, 0, owned)).toBe(index);
        expect(plotIndexAt(grid, t.col, t.row, 0, [])).toBe(-1); // not owned: not a plot
        expect(fieldOf(index)).toBe(f);
        expect(plotAt(s, index)).toBe(s.farm.north[f]!.plots[i]);
      }
    }
    expect(fieldOf(0)).toBe('home');
    expect(fieldOf(GREENHOUSE_BASE + 3)).toBe('greenhouse');
    expect(isGreenhouseIndex(N)).toBe(false);
    expect(plotIndexAt(grid, 15, -5, 0, owned)).toBe(-1); // the path
    // Home and greenhouse indexes do not move.
    expect(tileOfPlot(grid, 9)).toEqual({ col: 7, row: 3 });
    expect(plotIndexAt(grid, 7, 3, 0, owned)).toBe(9);
  });

  it('lists home, the greenhouse, then the owned north fields in order', () => {
    const s = farmAt();
    expect(allPlotIndexes(s)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    ownNorth(s, 'terraces');
    ownNorth(s, 'north_fields');
    const all = allPlotIndexes(s);
    expect(all).toHaveLength(8 + 32 + 24);
    expect(all.slice(8, 10)).toEqual([N, N + 1]);
    expect(all.at(-1)).toBe(T + 23);
    expect(plotCount(s)).toBe(64);
  });

  it('buying a north field brings its plots in, untilled, with the overgrowth gone', () => {
    const s = farmAt();
    s.land.parcels.push('orchard', 'yard');
    s.expansions.push('farm_1', 'farm_2', 'farm_3', 'farm_4');
    setFarmLevel(s, 7);
    s.gold = 2_000_000;
    const events: GameEvent[] = [];
    expect(buyParcel(s, ctxAt(s, events), 'north_fields').ok).toBe(true);
    expect(s.farm.north.north_fields!.plots).toHaveLength(32);
    expect(s.farm.north.north_fields!.plots.every((p) => p.state === 'untilled')).toBe(true);
    expect(s.farm.north.north_fields!.lastPlantedCrop.every((c) => c === null)).toBe(true);
    expect(events).toContainEqual({ type: 'northFieldBought', field: 'north_fields' });
    // The milestone (no farm points): 50,000 gold.
    const gold = s.gold;
    step(s, ctxAt(s), 1000);
    expect(s.progression.milestones.done).toContain('m24_north_field');
    expect(s.gold).toBeGreaterThanOrEqual(gold + 50_000);
  });
});

describe('north fields: every tool (GDD §13.3)', () => {
  it('Hoe, Seeds, Can and Hand work on north plots, and an area tool never jumps the fence', () => {
    const s = farmAt();
    ownNorth(s, 'north_fields', false);
    s.upgrades.hoe = 3; // 25 plots
    s.upgrades.watering_can = 2; // 9 plots
    expect(useTool(s, ctxAt(s), 'hoe', [N], null).ok).toBe(true);
    const tilled = s.farm.north.north_fields!.plots.filter((p) => p.state === 'tilled').length;
    expect(tilled).toBe(9); // a 5 × 5 square at the corner, clipped to the field: 3 × 3
    expect(s.farm.plots.every((p, i) => p.state === (i % 4 < 2 ? 'tilled' : 'untilled'))).toBe(true); // home untouched
    // The area of a plot on the field's right edge stays in the field.
    const edge = expandToolArea(s, [N + 7], 9);
    expect(edge.every((i) => fieldOf(i) === 'north_fields')).toBe(true);
    expect(edge.sort((a, b) => a - b)).toEqual([N + 6, N + 7, N + 14, N + 15]);
    stock(s, 'turnip', 20);
    expect(useTool(s, ctxAt(s), 'seeds', [N, N + 1], 'turnip').ok).toBe(true);
    expect(lastPlanted(s, N)).toBe('turnip');
    expect(s.lastPlantedCrop.every((c) => c === null)).toBe(true); // the home memory is untouched
    expect(useTool(s, ctxAt(s), 'water', [N], null).ok).toBe(true);
    expect(plotWatered(s, GAME_DATA, N)).toBe(true);
    s.farm.north.north_fields!.plots[0]!.growthMs = 120_000;
    const before = countItem(s.inventory, 'turnip');
    expect(useTool(s, ctxAt(s), 'hand', [N], null).ok).toBe(true);
    expect(countItem(s.inventory, 'turnip')).toBe(before + 1);
    // Auto picks the obvious tool on a north plot too.
    expect(useTool(s, ctxAt(s), 'auto', [N + 31], 'turnip').ok).toBe(true);
    expect(s.farm.north.north_fields!.plots[31]!.state).toBe('tilled');
  });

  it('Shift-click covers the clicked field; Harvest all and Water all cover every open field, never the greenhouse', () => {
    const s = farmAt();
    ownNorth(s, 'north_fields');
    ownNorth(s, 'terraces');
    s.farm.greenhouse = [emptyPlot('tilled')];
    expect(bulkPlots(s, N + 5)).toEqual(Array.from({ length: 32 }, (_, i) => N + i));
    expect(bulkPlots(s, T)).toEqual(Array.from({ length: 24 }, (_, i) => T + i));
    expect(bulkPlots(s, 3)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    const all = bulkPlots(s);
    expect(all).toHaveLength(8 + 32 + 24);
    expect(all.some(isGreenhouseIndex)).toBe(false);
    const r = useTool(s, ctxAt(s), 'water', all, null);
    expect(r.ok).toBe(true);
    expect(s.farm.north.terraces!.plots.every((p) => p.waterMsLeft > 0)).toBe(true);
  });

  it('crops out of season wither in the north fields too', () => {
    const s = farmAt();
    ownNorth(s, 'north_fields');
    Object.assign(s.farm.north.north_fields!.plots[3]!, { state: 'planted', crop: 'turnip', growthMs: 0 });
    expect(witherOutOfSeasonCrops(s, ctxAt(s), 'summer')).toBe(1);
    expect(s.farm.north.north_fields!.plots[3]!.state).toBe('dead');
  });
});

describe('north fields: sprinklers and scarecrows', () => {
  it('stand on north plots and cover only their own field', () => {
    const s = farmAt();
    ownNorth(s, 'north_fields');
    own(s, { sprinkler: 2, scarecrow: 1, sprinkler_tech: 2 }); // a 5 × 5 square
    expect(placementProblem(s, 'sprinkler', 1, 1, 'terraces')).toBe('That is not a plot.'); // not owned
    expect(placementProblem(s, 'sprinkler', 8, 0, 'north_fields')).toBe('That is not a plot.');
    const events: GameEvent[] = [];
    expect(placeObject(s, ctxAt(s, events), 'sprinkler', 1, 1, 'north_fields').ok).toBe(true);
    expect(events).toContainEqual({
      type: 'placed',
      kind: 'sprinkler',
      col: 1,
      row: 1,
      field: 'north_fields',
    });
    // The same (col, row) in the home field is a different plot.
    expect(placeObject(s, ctxAt(s), 'sprinkler', 1, 1).ok).toBe(true);
    expect(occupiedPlots(s)).toEqual(new Set([N + 9, 5]));
    const cov = coverageOf(s, GAME_DATA)!;
    expect(cov.byField.north_fields!.sprinkled[0]).toBe(1);
    expect(cov.byField.north_fields!.sprinkled[3 * 8 + 3]).toBe(1);
    expect(cov.byField.north_fields!.sprinkled[3 * 8 + 4]).toBe(0);
    expect(plotWatered(s, GAME_DATA, N)).toBe(true);
    expect(plotWatered(s, GAME_DATA, N + 4)).toBe(false);
    expect(cov.byField.terraces).toBeUndefined();
    // A tool on the plot a sprinkler stands on says so.
    expect(useTool(s, ctxAt(s), 'hoe', [N + 9], null)).toEqual({
      ok: false,
      reason: 'A sprinkler stands here. Pick it up from placement mode to use this plot.',
    });
    // The place action takes the field.
    expect(
      applyAction(s, ctxAt(s), { type: 'place', kind: 'scarecrow', col: 6, row: 2, field: 'north_fields' })
        .ok,
    ).toBe(true);
    expect(coverageOf(s, GAME_DATA)!.byField.north_fields!.bonus[2 * 8 + 7]).toBeGreaterThan(0);
  });
});

describe('north fields: automation', () => {
  it('the farmhand harvests north plots and the planter replants them from their own memory', () => {
    const s = farmAt();
    s.inventory.slots = s.inventory.slots.map(() => null);
    ownNorth(s, 'north_fields');
    ownNorth(s, 'terraces');
    own(s, { farmhand: 5, seed_planter: 1 });
    for (const [f, crop] of [
      ['north_fields', 'potato'],
      ['terraces', 'turnip'],
    ] as const) {
      const field = s.farm.north[f]!;
      field.plots[2] = {
        state: 'planted',
        crop,
        growthMs: GAME_DATA.crops[crop].growSec * 1000,
        harvests: 0,
        waterMsLeft: 0,
      };
      field.lastPlantedCrop[2] = crop;
    }
    stock(s, 'potato', 5);
    stock(s, 'turnip', 5);
    const events: GameEvent[] = [];
    step(s, ctxAt(s, events), 10 * SEC);
    const harvested = events
      .filter((e) => e.type === 'harvested')
      .map((e) => e.type === 'harvested' && e.plot);
    expect(harvested).toEqual([N + 2, T + 2]);
    expect(s.farm.north.north_fields!.plots[2]!.crop).toBe('potato'); // replanted with its own crop
    expect(s.farm.north.terraces!.plots[2]!.crop).toBe('turnip');
    expect(events.every((e) => e.type !== 'harvested' || e.auto)).toBe(true);
  });

  it('the planter fills and tills north plots (level 3) and never plants out of season', () => {
    const s = farmAt();
    s.inventory.slots = s.inventory.slots.map(() => null);
    ownNorth(s, 'north_fields', false);
    own(s, { farmhand: 5, seed_planter: 3 });
    stock(s, 'turnip', 50);
    stock(s, 'wheat', 50); // summer and autumn only
    const jobs = planPlanter(s, ctxAt(s), 20, []);
    const north = jobs.filter((j) => fieldOf(j.index) === 'north_fields');
    expect(north.length).toBeGreaterThan(0);
    expect(north.every((j) => j.crop === 'turnip' && j.till)).toBe(true);
  });

  it('Seed Order buys for crops last planted in any field', () => {
    const s = farmAt();
    ownNorth(s, 'north_fields');
    s.farm.north.north_fields!.lastPlantedCrop[4] = 'potato';
    expect(orderedCrops(s, ctxAt(s))).toContain('potato');
  });

  it('one big step equals many small ones with a north field in use (farmhand, planter, sprinkler, Auto-Seller)', () => {
    const make = (): GameState => {
      const s = farmAt();
      s.inventory.slots = s.inventory.slots.map(() => null);
      ownNorth(s, 'north_fields');
      own(s, { farmhand: 3, seed_planter: 2, auto_seller: 2, sprinkler: 1 });
      placeObject(s, ctxAt(s), 'sprinkler', 2, 1, 'north_fields');
      stock(s, 'turnip', 300);
      stock(s, 'potato', 300);
      const f = s.farm.north.north_fields!;
      f.lastPlantedCrop.fill('turnip');
      for (let i = 0; i < 8; i++) f.lastPlantedCrop[i] = 'potato';
      for (let i = 16; i < 32; i++) f.plots[i]!.waterMsLeft = HOUR;
      return s;
    };
    const noPerks = (s: GameState) =>
      makeContext(s, DATA_NO_PERKS, buildCalendar(CREATED, s.calendar, NY), []);
    const big = make();
    const small = make();
    step(big, noPerks(big), 3 * HOUR);
    const ctx = noPerks(small);
    for (let t = 0; t < 3 * HOUR; t += 100) step(small, ctx, 100);
    expect(big.farm.north).toEqual(small.farm.north);
    expect(big.stats).toEqual(small.stats);
    expect(big.gold).toBe(small.gold);
    expect(big.rngState).toBe(small.rngState);
    expect(big.stats.cropsHarvested).toBeGreaterThan(100);
  });

  it('the offline walk gives the same farm in one go or in pieces', () => {
    const make = (): GameState => {
      const s = farmAt();
      s.inventory.slots = s.inventory.slots.map(() => null);
      ownNorth(s, 'north_fields');
      ownNorth(s, 'terraces');
      own(s, { farmhand: 5, seed_planter: 3, auto_seller: 2 });
      stock(s, 'turnip', 900);
      return s;
    };
    const a = make();
    const b = structuredClone(a);
    runOffline(a, GAME_DATA, NY, CREATED, CREATED + 6 * HOUR);
    for (let i = 0; i < 72; i++)
      runOffline(b, GAME_DATA, NY, CREATED + i * 5 * MIN, CREATED + (i + 1) * 5 * MIN);
    expect(a.farm.north).toEqual(b.farm.north);
    expect(a.gold).toBe(b.gold);
    expect(a.stats.cropsHarvested).toBe(b.stats.cropsHarvested);
    expect(countItem(a.inventory, 'seed_turnip')).toBe(0); // every seed went into the fields
    expect(a.stats.cropsHarvested).toBeGreaterThan(800);
  });

  it('an 8 hour catch-up with every field automated stays within the 100 ms budget (median of five)', () => {
    const make = (): GameState => {
      const s = farmAt();
      s.inventory.slots = s.inventory.slots.map(() => null);
      s.farm.grid = { cols: 8, rows: 6 };
      s.farm.plots = Array.from({ length: 48 }, () => emptyPlot('tilled'));
      s.farm.greenhouse = Array.from({ length: 12 }, () => emptyPlot('tilled'));
      s.lastPlantedCrop = Array.from({ length: 60 }, (_, i) => (['turnip', 'potato'] as const)[i % 2]!);
      ownNorth(s, 'north_fields');
      ownNorth(s, 'terraces');
      for (const f of NORTH_FIELD_IDS)
        s.farm.north[f]!.lastPlantedCrop = s.farm.north[f]!.plots.map(
          (_, i) => (['turnip', 'potato'] as const)[i % 2]!,
        );
      own(s, { farmhand: 5, seed_planter: 3, auto_seller: 2, sprinkler: 6, sprinkler_tech: 2 });
      for (const [c, r, f] of [
        [2, 2, undefined],
        [5, 3, undefined],
        [2, 1, 'north_fields'],
        [5, 2, 'north_fields'],
        [2, 1, 'terraces'],
        [5, 1, 'terraces'],
      ] as const)
        expect(placeObject(s, ctxAt(s), 'sprinkler', c, r, f).ok).toBe(true);
      stock(s, 'turnip', 4000);
      stock(s, 'potato', 4000);
      return s;
    };
    const times: number[] = [];
    let harvested = 0;
    for (let run = 0; run < 6; run++) {
      const s = make();
      const t0 = performance.now();
      runOffline(s, GAME_DATA, NY, CREATED, CREATED + 8 * HOUR);
      if (run > 0) times.push(performance.now() - t0); // the first run warms the JIT up
      harvested = s.stats.cropsHarvested;
    }
    times.sort((a, b) => a - b);
    expect(harvested).toBeGreaterThan(1000);
    expect(times[Math.floor(times.length / 2)]!, times.join()).toBeLessThan(100);
  });
});
