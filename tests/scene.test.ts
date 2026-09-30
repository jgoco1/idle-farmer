import { describe, expect, it } from 'vitest';
import type { Plot } from '../src/core/state';
import { integerScale } from '../src/render/renderer';
import {
  buildLayout,
  buildZones,
  plotIndexAt,
  plotSprites,
  plotTile,
  SCENE_COLS,
  SCENE_H,
  SCENE_ROWS,
  SCENE_W,
  tileAt,
  zoneAt,
} from '../src/render/scene';
import { SPRITES } from '../src/render/sprites';
import { tintAt } from '../src/render/tint';
import { START_GRID } from '../src/data/balance';

describe('scene layout', () => {
  it('is 20 × 12 tiles of 16 px', () => {
    expect([SCENE_W, SCENE_H]).toEqual([320, 192]);
    const layout = buildLayout(START_GRID);
    expect(layout.ground).toHaveLength(SCENE_ROWS);
    for (const row of layout.ground) {
      expect(row).toHaveLength(SCENE_COLS);
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

  it('animates the pond water', () => {
    const { animated } = buildLayout(START_GRID);
    expect(animated.length).toBeGreaterThan(0);
    expect(animated.every((a) => a.col >= 1 && a.col <= 4 && a.row >= 7 && a.row <= 10)).toBe(true);
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
  });

  it('gives row-major plot indexes', () => {
    expect(plotIndexAt(START_GRID, 6, 2)).toBe(0);
    expect(plotIndexAt(START_GRID, 9, 2)).toBe(3);
    expect(plotIndexAt(START_GRID, 6, 3)).toBe(4);
    expect(plotIndexAt(START_GRID, 5, 2)).toBe(-1);
  });

  it('converts logical pixels to tiles', () => {
    expect(tileAt(0, 0)).toEqual({ col: 0, row: 0 });
    expect(tileAt(319.9, 191.9)).toEqual({ col: 19, row: 11 });
    expect(tileAt(320, 10)).toBeNull();
    expect(tileAt(-1, 10)).toBeNull();
  });
});

describe('integer scaling', () => {
  it('picks the largest whole scale that fits, never below 1', () => {
    expect(integerScale(1280, 700, 1)).toBe(3);
    expect(integerScale(360, 500, 1)).toBe(1);
    expect(integerScale(360, 500, 3)).toBe(3);
    expect(integerScale(200, 100, 1)).toBe(1);
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
    expect(plotTile({ cols: 4, rows: 2 }, 0)).toEqual({ col: 6, row: 2 });
    expect(plotTile({ cols: 4, rows: 2 }, 5)).toEqual({ col: 7, row: 3 });
    expect(plotIndexAt({ cols: 4, rows: 2 }, 7, 3)).toBe(5);
  });
});
