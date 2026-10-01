import { describe, expect, it } from 'vitest';
import type { Plot } from '../src/core/state';
import {
  buildLayout,
  buildZones,
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
} from '../src/render/scene';
import { SPRITES } from '../src/render/sprites';
import { tintAt } from '../src/render/tint';
import { START_GRID } from '../src/data/balance';

describe('scene layout', () => {
  it('is a 36 × 22 world of 16 px tiles whose home region is the 20 × 12 v1 scene', () => {
    expect([WORLD_W, WORLD_H]).toEqual([576, 352]);
    expect([HOME_W, HOME_H]).toEqual([320, 192]);
    const layout = buildLayout(START_GRID);
    expect(layout.ground).toHaveLength(22);
    for (const row of layout.ground) {
      expect(row).toHaveLength(36);
      for (const id of row) expect(SPRITES[id], id).toBeDefined();
    }
    for (const o of layout.objects) expect(SPRITES[o.sprite], o.sprite).toBeDefined();
  });

  it('draws the start plots as tilled soil at (6,2), 4 × 2', () => {
    const { ground } = buildLayout(START_GRID);
    expect(ground[2]![6]).toBe('tile_soil_dry');
    expect(ground[3]![9]).toBe('tile_soil_dry');
    expect(ground[4]![9]).not.toBe('tile_soil_dry');
    expect(ground[2]![10]).not.toBe('tile_soil_dry');
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
    expect(ground[2]![6]).toBe('tile_soil_dry');
    expect(ground[7]![13]).toBe('tile_soil_dry');
    expect(ground[9]![14]).toBe('tile_path');
    expect(ground[11]![10]).toBe('tile_river');
    expect(ground[10]![15]).toBe('tile_path'); // the landing
    expect(ground[11]![17]).toBe('tile_sea');
    expect(ground[8]![2]).toBe('tile_water');
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
