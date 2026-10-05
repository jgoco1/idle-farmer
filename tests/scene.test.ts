import { describe, expect, it } from 'vitest';
import type { Plot } from '../src/core/state';
import {
  buildLayout,
  buildZones,
  fenceRect,
  pathFor,
  plotIndexAt,
  plotSprites,
  tileOfPlot,
  forSaleSignAt,
  HOME_H,
  HOME_W,
  sceneryFor,
  tileAt,
  WORLD_H,
  WORLD_W,
  zoneAt,
  groundAt,
  WORLD_Y0,
  WORLD_Y1,
} from '../src/render/scene';
import { SPRITES } from '../src/render/sprites';
import { tintAt } from '../src/render/tint';
import { START_GRID } from '../src/data/balance';

describe('scene layout', () => {
  it('is a 36 × 36 world of 16 px tiles (rows −14 … 21) whose home region is the 20 × 12 v1 scene', () => {
    expect([WORLD_W, WORLD_H]).toEqual([576, 576]);
    expect([WORLD_Y0, WORLD_Y1]).toEqual([-224, 352]);
    expect([HOME_W, HOME_H]).toEqual([320, 192]);
    const layout = buildLayout(START_GRID);
    expect(layout.ground).toHaveLength(36);
    for (const row of layout.ground) {
      expect(row).toHaveLength(36);
      for (const id of row) expect(SPRITES[id], id).toBeDefined();
    }
    for (const o of layout.objects) expect(SPRITES[o.sprite], o.sprite).toBeDefined();
  });

  it('draws the start plots as tilled soil at (6,2), 4 × 2', () => {
    const { ground } = buildLayout(START_GRID);
    expect(groundAt(ground, 6, 2)).toBe('tile_soil_dry');
    expect(groundAt(ground, 9, 3)).toBe('tile_soil_dry');
    expect(groundAt(ground, 9, 4)).not.toBe('tile_soil_dry');
    expect(groundAt(ground, 10, 2)).not.toBe('tile_soil_dry');
  });

  it('animates the pond water and the sea, nothing else in home', () => {
    const { animated } = buildLayout(START_GRID);
    const home = animated.filter((a) => a.col < 20 && a.row < 12);
    expect(home.filter((a) => a.sprite === 'tile_water')).toHaveLength(4); // the pond's middle
    expect(
      home
        .filter((a) => a.sprite === 'tile_sea')
        .map((a) => `${a.col},${a.row}`)
        .sort(),
    ).toEqual(['16,10', '16,11', '17,10', '17,11', '18,10', '18,11', '19,10', '19,11'].sort());
    expect(animated.some((a) => a.sprite === 'tile_sea' && a.row === 21 && a.col === 35)).toBe(true);
  });

  it('keeps every v1 tile of the home region as v1 drew it, the two documented changes aside', () => {
    const { ground } = buildLayout({ cols: 8, rows: 6 }, [
      'farm_1',
      'farm_2',
      'farm_3',
      'farm_4',
      'river',
      'ocean',
    ]);
    expect(groundAt(ground, 6, 2)).toBe('tile_soil_dry');
    expect(groundAt(ground, 13, 7)).toBe('tile_soil_dry');
    expect(groundAt(ground, 14, 9)).toBe('tile_path');
    expect(groundAt(ground, 10, 11)).toBe('tile_river');
    expect(groundAt(ground, 15, 10)).toBe('tile_path'); // the landing
    expect(groundAt(ground, 17, 11)).toBe('tile_sea');
    expect(groundAt(ground, 2, 8)).toBe('tile_water');
  });

  it('overgrows locked parcels with a "For sale" sign, and clears them once bought', () => {
    const at = (parcels: Parameters<typeof sceneryFor>[1]) =>
      sceneryFor([], parcels).filter((d) => d.col >= 21 && d.row <= 6);
    expect(at([]).some((d) => d.sprite === 'obj_for_sale' && d.col === 21 && d.row === 3)).toBe(true);
    expect(at([]).filter((d) => d.sprite === 'obj_tall_grass').length).toBeGreaterThan(5);
    expect(at(['orchard'])).toEqual([]);
    expect(forSaleSignAt([], 21, 3)).toBe('orchard');
    expect(forSaleSignAt(['orchard'], 21, 3)).toBeNull();
    expect(forSaleSignAt([], 21, 11)).toBe('yard');
    expect(forSaleSignAt([], 21, 17)).toBe('meadow');
    expect(forSaleSignAt([], 5, 5)).toBeNull();
  });
});

describe('hit-testing', () => {
  const zones = buildZones(START_GRID);

  it('maps tiles to the zones of GDD §5', () => {
    expect(zoneAt(zones, 6, 2)?.id).toBe('plots');
    expect(zoneAt(zones, 9, 3)?.id).toBe('plots');
    expect(zoneAt(zones, 10, 3)).toBeNull();
    expect(zoneAt(zones, 1, 1)?.id).toBe('farmhouse');
    expect(zoneAt(zones, 4, 3)?.id).toBe('farmhouse');
    expect(zoneAt(zones, 2, 9)?.id).toBe('pond');
    expect(zoneAt(zones, 16, 7)?.id).toBe('market');
    expect(zoneAt(zones, 18, 4)?.id).toBe('greenhouse');
    expect(zoneAt(zones, 10, 11)?.id).toBe('river');
    expect(zoneAt(zones, 19, 10)?.id).toBe('dock');
    expect(zoneAt(zones, 0, 0)).toBeNull();
    expect(zoneAt(zones, 4, 16)?.id).toBe('board');
    expect(zoneAt(zones, 25, 10)).toBeNull(); // the paddock is not a zone
  });

  it('gives row-major plot indexes', () => {
    expect(plotIndexAt(START_GRID, 6, 2)).toBe(0);
    expect(plotIndexAt(START_GRID, 9, 2)).toBe(3);
    expect(plotIndexAt(START_GRID, 6, 3)).toBe(4);
    expect(plotIndexAt(START_GRID, 5, 2)).toBe(-1);
  });

  it('converts world pixels to world tiles', () => {
    expect(tileAt(0, 0)).toEqual({ col: 0, row: 0 });
    expect(tileAt(319.9, 191.9)).toEqual({ col: 19, row: 11 });
    expect(tileAt(320, 10)).toEqual({ col: 20, row: 0 });
    expect(tileAt(575.9, 351.9)).toEqual({ col: 35, row: 21 });
    expect(tileAt(576, 10)).toBeNull();
    expect(tileAt(-1, 10)).toBeNull();
  });
});

describe('day/night tint', () => {
  it('is clear by day and darkest at midnight', () => {
    expect(tintAt(12, 0)).toEqual({ night: 0, dusk: 0 });
    expect(tintAt(0, 0).night).toBeCloseTo(0.55);
    expect(tintAt(20, 0).night).toBe(0);
    expect(tintAt(22, 0).night).toBeCloseTo(0.275);
    expect(tintAt(6, 0).night).toBe(0);
  });

  it('glows at dusk and dawn', () => {
    expect(tintAt(19, 15).dusk).toBeCloseTo(0.25);
    expect(tintAt(6, 45).dusk).toBeCloseTo(0.25);
    expect(tintAt(18, 29).dusk).toBe(0);
    expect(tintAt(7, 30).dusk).toBe(0);
  });
});

describe('plot sprites (phase 02)', () => {
  it('maps plot state to soil and crop sprites', () => {
    const plots: Plot[] = [
      { state: 'untilled', crop: null, growthMs: 0, harvests: 0, waterMsLeft: 0 },
      { state: 'tilled', crop: null, growthMs: 0, harvests: 0, waterMsLeft: 0 },
      { state: 'tilled', crop: null, growthMs: 0, harvests: 0, waterMsLeft: 5 },
      { state: 'planted', crop: 'melon', growthMs: 0, harvests: 0, waterMsLeft: 0 },
      { state: 'dead', crop: null, growthMs: 0, harvests: 0, waterMsLeft: 0 },
    ];
    expect(plotSprites(plots, () => 3)).toEqual([
      { soil: 'tile_soil_untilled', crop: null },
      { soil: 'tile_soil_dry', crop: null },
      { soil: 'tile_soil_wet', crop: null },
      { soil: 'tile_soil_dry', crop: 'crop_melon_3' },
      { soil: 'tile_soil_dry', crop: 'crop_dead' },
    ]);
  });

  it('places plots row-major from the grid origin', () => {
    expect(tileOfPlot({ cols: 4, rows: 2 }, 0)).toEqual({ col: 6, row: 2 });
    expect(tileOfPlot({ cols: 4, rows: 2 }, 5)).toEqual({ col: 7, row: 3 });
    expect(plotIndexAt({ cols: 4, rows: 2 }, 7, 3)).toBe(5);
  });
});

describe('the field fence and the home path', () => {
  const SIZES = [
    { grid: { cols: 4, rows: 2 }, ex: [] },
    { grid: { cols: 4, rows: 3 }, ex: ['farm_1'] },
    { grid: { cols: 5, rows: 4 }, ex: ['farm_1', 'farm_2'] },
    { grid: { cols: 6, rows: 5 }, ex: ['farm_1', 'farm_2', 'farm_3'] },
    { grid: { cols: 8, rows: 6 }, ex: ['farm_1', 'farm_2', 'farm_3', 'farm_4'] },
  ] as const;
  const FENCE = /^obj_fence_/;

  it('closes the ring at every size: corner posts, rails, sides and a gate where the path meets it', () => {
    for (const { grid, ex } of SIZES) {
      const f = fenceRect(grid);
      const right = f.col + f.cols - 1;
      const bottom = f.row + f.rows - 1;
      const at = new Map<string, string>();
      for (const o of buildLayout(grid, ex).objects)
        if (FENCE.test(o.sprite)) {
          const key = `${o.x / 16},${o.y / 16}`;
          expect(at.has(key), `${grid.cols}×${grid.rows} ${key} twice`).toBe(false);
          at.set(key, o.sprite);
        }
      expect(at.size).toBe(2 * f.cols + 2 * (f.rows - 2));
      expect(at.get(`${f.col},${f.row}`)).toBe('obj_fence_nw');
      expect(at.get(`${right},${f.row}`)).toBe('obj_fence_ne');
      expect(at.get(`${f.col},${bottom}`)).toBe('obj_fence_sw');
      expect(at.get(`${right},${bottom}`)).toBe('obj_fence_se');
      const gates = pathFor(grid).gates;
      for (const g of gates) expect(at.get(`${g.col},${g.row}`)).toBe(g.sprite);
      expect(gates.length).toBe(grid.rows > 2 ? 2 : 0);
    }
  });

  it('runs from the farmhouse door to the bin at every size, never under the fence or the field', () => {
    for (const { grid, ex } of SIZES) {
      const name = `${grid.cols}×${grid.rows}`;
      const { tiles, gates } = pathFor(grid);
      const f = fenceRect(grid);
      const ground = buildLayout(grid, ex).ground;
      const inside = (c: number, r: number): boolean =>
        c >= f.col && c < f.col + f.cols && r >= f.row && r < f.row + f.rows;
      for (const [c, r] of tiles) {
        expect(inside(c, r), `${name} ${c},${r}`).toBe(false);
        expect(groundAt(ground, c, r), `${name} ${c},${r}`).toBe('tile_path');
      }
      for (const g of gates) expect(groundAt(ground, g.col, g.row)).toBe('tile_path');
      // Walk the path (through its gates and across the field) from the door to the tile beside the lane.
      const open = new Set([...tiles.map(([c, r]) => `${c},${r}`), ...gates.map((g) => `${g.col},${g.row}`)]);
      for (let r = f.row + 1; r < f.row + f.rows - 1; r++)
        for (let c = f.col + 1; c < f.col + f.cols - 1; c++) open.add(`${c},${r}`);
      const seen = new Set(['2,4']);
      const queue = [[2, 4]];
      while (queue.length > 0) {
        const [c, r] = queue.shift()!;
        for (const [dc, dr] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const k = `${c! + dc!},${r! + dr!}`;
          if (open.has(k) && !seen.has(k)) {
            seen.add(k);
            queue.push([c! + dc!, r! + dr!]);
          }
        }
      }
      expect(seen.has('17,9'), name).toBe(true);
      expect(groundAt(ground, 18, 9)).toBe('tile_path'); // the lane carries on from there
      // Every path tile is part of that one route (no stubs cut off by the field).
      for (const [c, r] of tiles) expect(seen.has(`${c},${r}`), `${name} ${c},${r}`).toBe(true);
    }
  });
});
