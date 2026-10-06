// v2 phase 02: the pure parts of drawing decorations and the town: draw positions and depth order, which
// pieces glow and when, the scene's look (farmhouse style, town stages), what blocks a decoration, the
// Town Square tune and the pref that plays it.

import { describe, expect, it } from 'vitest';
import { THEMES, loopNotes, townSquareKey, themeKey } from '../src/audio/music';
import { DEFAULT_PREFS, sanitizePrefs } from '../src/core/prefs';
import type { PlacedDecor } from '../src/core/state';
import { GAME_DATA } from '../src/data';
import { DECOR } from '../src/data/decor';
import { TOWN_PROJECT_IDS } from '../src/data/ids';
import {
  DECOR_BLOCKED,
  fixedBlockReason,
  WORLD_BOTTOM,
  WORLD_COLS,
  WORLD_LAYOUT,
  WORLD_ROWS,
  WORLD_TOP,
} from '../src/data/world';
import {
  buildDecorDraws,
  decorKey,
  decorPosition,
  glowStrength,
  isLitTime,
  townGlows,
} from '../src/render/decorDraw';
import {
  buildLayout,
  buildZones,
  DEFAULT_LOOK,
  inRect,
  townSiteAt,
  townSiteRect,
  townSpritePos,
  zoneAt,
  groundAt,
} from '../src/render/scene';
import { SPRITES } from '../src/render/sprites';
import { farmhouseSpriteId } from '../src/render/sprites/farmhouse';
import { tintAt } from '../src/render/tint';

const placed = (list: [number, string, number, number, boolean?][]): PlacedDecor[] =>
  list.map(([id, decor, col, row, flipped]) => ({
    id,
    decor: decor as PlacedDecor['decor'],
    at: { col, row },
    ...(flipped ? { flipped: true as const } : {}),
  }));

describe('drawing decorations', () => {
  it('centres a piece on its footprint with its bottom on the footprint’s bottom edge', () => {
    // A 16 × 32 lamp on one tile: bottom on the tile's bottom, taller than the tile.
    expect(decorPosition(DECOR.garden_lamp, 6, 9, 16, 32)).toEqual({ x: 96, y: 10 * 16 - 32 });
    // A 32 × 32 arch over a 2 × 1 footprint.
    expect(decorPosition(DECOR.rose_arch, 6, 9, 32, 32)).toEqual({ x: 96, y: 160 - 32 + 0 });
    // The 32 × 64 windmill over 2 × 2.
    expect(decorPosition(DECOR.windmill, 24, 12, 32, 64)).toEqual({ x: 24 * 16, y: 14 * 16 - 64 });
    // Paths and fences are whole tiles at the tile.
    expect(decorPosition(DECOR.cobble_path, 7, 3, 16, 16)).toEqual({ x: 112, y: 48 });
  });

  it('sorts the draw list by bottom edge, so nearer pieces overlap farther ones', () => {
    const d = buildDecorDraws(
      placed([
        [1, 'garden_lamp', 6, 11],
        [2, 'cobble_path', 6, 9],
        [3, 'stone_well', 24, 9],
      ]),
      DECOR,
    );
    expect(d.map((x) => x.bottom)).toEqual([160, 176, 192]); // the path, the 2 × 2 well, the lamp
    expect(d.map((x) => x.bottom)).toEqual([...d.map((x) => x.bottom)].sort((a, b) => a - b));
  });

  it('chooses the auto-tile sprite by neighbours, and the seasonal sprite by season', () => {
    const d = buildDecorDraws(
      placed([
        [1, 'cobble_path', 6, 9],
        [2, 'cobble_path', 7, 9],
        [3, 'flower_bed', 10, 9],
        [4, 'sandcastle', 12, 9],
      ]),
      DECOR,
    );
    const by = (n: number) => d.find((x) => x.x === n)!;
    expect(by(6 * 16).sprites[1]).toBe('decor_cobble_path_2'); // a neighbour to the east
    expect(by(7 * 16).sprites[1]).toBe('decor_cobble_path_8');
    expect(by(10 * 16).sprites).toEqual([
      'decor_flower_bed_spring',
      'decor_flower_bed_summer',
      'decor_flower_bed_autumn',
      'decor_flower_bed_winter',
    ]);
    expect(by(12 * 16).sprites).toEqual([
      'decor_sandcastle',
      'decor_sandcastle',
      'decor_sandcastle',
      'decor_sandcastle_winter',
    ]);
    for (const x of d) for (const id of x.sprites) expect(SPRITES[id], id).toBeDefined();
  });

  it('knows which pieces glow, where, and which is the windmill', () => {
    const d = buildDecorDraws(
      placed([
        [1, 'garden_lamp', 6, 9],
        [2, 'lantern_string', 8, 9],
        [3, 'windmill', 24, 12],
        [4, 'wooden_bench', 12, 9, true],
      ]),
      DECOR,
    );
    const lamp = d.find((x) => x.glows && x.glowPoints.length === 1)!;
    expect(lamp.glowPoints[0]!.large).toBe(false);
    expect(d.find((x) => x.glowPoints.length === 2)).toBeDefined(); // the lantern string's two ends
    expect(d.find((x) => x.windmill)).toBeDefined();
    expect(d.find((x) => x.flipped)).toBeDefined();
    expect(d.filter((x) => x.glows)).toHaveLength(2);
  });

  it('draws nothing for the farmhouse pieces and keeps a key that changes with every placement change', () => {
    const p = placed([
      [1, 'cobble_path', 6, 9],
      [2, 'cobble_path', 7, 9],
    ]);
    const k = decorKey(p);
    expect(decorKey(p)).toBe(k);
    expect(decorKey([...p, ...placed([[3, 'cobble_path', 8, 9]])])).not.toBe(k);
    expect(
      decorKey(
        placed([
          [1, 'cobble_path', 6, 9],
          [2, 'cobble_path', 7, 10],
        ]),
      ),
    ).not.toBe(k);
    expect(
      decorKey(
        placed([
          [1, 'cobble_path', 6, 9],
          [2, 'cobble_path', 7, 9, true],
        ]),
      ),
    ).not.toBe(k);
    expect(decorKey([])).not.toBe(k);
    expect(
      buildDecorDraws([...p, { id: 9, decor: 'paint_sage', at: { col: 0, row: 0 } }], DECOR),
    ).toHaveLength(2);
  });
});

describe('lamps glow from dusk to dawn', () => {
  it('lit from 18:30 to 07:30', () => {
    expect(isLitTime(12, 0)).toBe(false);
    expect(isLitTime(18, 29)).toBe(false);
    expect(isLitTime(18, 30)).toBe(true);
    expect(isLitTime(23, 59)).toBe(true);
    expect(isLitTime(0, 0)).toBe(true);
    expect(isLitTime(7, 29)).toBe(true);
    expect(isLitTime(7, 30)).toBe(false);
  });

  it('the halo is 0 by day, gentle at dusk and full at midnight, following the night tint', () => {
    const at = (h: number, m = 0): number => {
      const t = tintAt(h, m);
      return glowStrength(t.night, t.dusk);
    };
    expect(at(12)).toBe(0);
    expect(at(19, 15)).toBeGreaterThan(0);
    expect(at(19, 15)).toBeLessThan(0.36);
    expect(at(0)).toBeCloseTo(1, 5);
    expect(at(22)).toBeGreaterThan(at(20, 30));
  });

  it('the lit town: bridge lanterns, bakery and hall windows, the bandstand, the lighthouse lamp', () => {
    expect(townGlows('old_bridge', 3)).toHaveLength(3);
    expect(townGlows('old_bridge', 2)).toHaveLength(0); // only the railings and lanterns glow
    expect(townGlows('lighthouse', 3)[0]!.large).toBe(true);
    expect(townGlows('community_hall', 4).length).toBeGreaterThan(1);
    expect(townGlows('community_hall', 3)).toHaveLength(0);
    expect(townGlows('fountain', 3)).toHaveLength(0);
  });
});

describe('the scene look', () => {
  it('draws the farmhouse style the farm has, and a loft rises one tile with its bottom where it was', () => {
    const plain = buildLayout({ cols: 4, rows: 2 }).objects.find((o) => o.sprite === 'obj_farmhouse')!;
    const id = farmhouseSpriteId('paint_sage', 'roof_slate', true);
    const loft = buildLayout({ cols: 4, rows: 2 }, [], [], { farmhouse: id, stages: {} }).objects.find(
      (o) => o.sprite === id,
    )!;
    expect(plain.y + plain.h).toBe(4 * 16);
    expect(loft.y + loft.h).toBe(plain.y + plain.h);
    expect(loft.h).toBe(plain.h + 16);
    expect(loft.x).toBe(plain.x);
    expect(
      buildLayout({ cols: 4, rows: 2 }, [], [], { farmhouse: id, stages: {} }).objects.some(
        (o) => o.sprite === 'obj_farmhouse',
      ),
    ).toBe(false);
  });

  it('shows each town site as its ruin, and each stage once done, at the site', () => {
    const ruins = buildLayout({ cols: 4, rows: 2 }, [], [], DEFAULT_LOOK).objects.map((o) => o.sprite);
    for (const id of TOWN_PROJECT_IDS) expect(ruins).toContain(`obj_${id}_0`);
    const look = { farmhouse: 'obj_farmhouse', stages: { old_bridge: 2, community_hall: 4 } };
    const built = buildLayout({ cols: 4, rows: 2 }, [], [], look).objects;
    expect(built.map((o) => o.sprite)).toContain('obj_old_bridge_2');
    expect(built.map((o) => o.sprite)).not.toContain('obj_old_bridge_0');
    const hall = built.find((o) => o.sprite === 'obj_community_hall_4')!;
    const r = townSiteRect('community_hall');
    expect(hall.x).toBe(r.col * 16);
    expect(hall.y + hall.h).toBe((r.row + r.rows) * 16);
    expect(townSpritePos('bakery', 64)).toEqual({ x: 16, y: (14 + 3) * 16 - 64 });
  });

  it('finds a project by any tile of its site, including the bridge', () => {
    expect(townSiteAt(17, 12)).toBe('old_bridge');
    expect(townSiteAt(2, 15)).toBe('bakery');
    expect(townSiteAt(7, 16)).toBe('fountain');
    expect(townSiteAt(11, 15)).toBe('community_hall');
    expect(townSiteAt(3, 18)).toBe('bandstand');
    expect(townSiteAt(13, 19)).toBe('lighthouse');
    expect(townSiteAt(8, 5)).toBeNull();
  });
});

describe('where decorations may not go', () => {
  it('blocks every home zone, path and fixed scenery tile of the scene at every field size, and the fence ring at full size', () => {
    const sizes = [
      { grid: { cols: 4, rows: 2 }, ex: [] },
      { grid: { cols: 4, rows: 3 }, ex: ['farm_1'] },
      { grid: { cols: 5, rows: 4 }, ex: ['farm_1', 'farm_2'] },
      { grid: { cols: 6, rows: 5 }, ex: ['farm_1', 'farm_2', 'farm_3'] },
      { grid: { cols: 8, rows: 6 }, ex: ['farm_1', 'farm_2', 'farm_3', 'farm_4'] },
    ] as const;
    for (const { grid, ex } of sizes) {
      const layout = buildLayout(grid, [...ex, 'river', 'ocean']);
      const zones = buildZones(grid);
      for (let row = 0; row < 12; row++)
        for (let col = 0; col < 20; col++) {
          const tile = groundAt(layout.ground, col, row);
          const zone = zoneAt(zones, col, row);
          const blocked = fixedBlockReason(col, row) !== null;
          if (zone || !tile.startsWith('tile_grass'))
            expect(blocked, `${grid.cols}×${grid.rows} ${col},${row} ${tile} ${zone?.id}`).toBe(true);
        }
    }
    // The fence ring (one tile around the 8 × 6 field).
    for (let col = 5; col <= 14; col++)
      for (const row of [1, 8]) expect(fixedBlockReason(col, row), `${col},${row}`).not.toBeNull();
    for (let row = 1; row <= 8; row++)
      for (const col of [5, 14]) expect(fixedBlockReason(col, row)).not.toBeNull();
  });

  it('blocks the lanes, the tree spots and nothing else in the orchard; and has free tiles to decorate', () => {
    for (const t of WORLD_LAYOUT.lanes) expect(fixedBlockReason(t.col, t.row)).not.toBeNull();
    for (const s of WORLD_LAYOUT.treeSpots) {
      expect(fixedBlockReason(s.col, s.row)).toMatch(/tree spot/);
      expect(fixedBlockReason(s.col + 1, s.row + 1)).toMatch(/tree spot/);
    }
    let free = 0;
    for (let row = WORLD_TOP; row < WORLD_BOTTOM; row++)
      for (let col = 0; col < WORLD_COLS; col++) if (!fixedBlockReason(col, row)) free++;
    expect(free).toBeGreaterThan(300);
    expect(DECOR_BLOCKED.every((b) => b.why.length > 5)).toBe(true);
  });

  it('every decoration blocked rectangle lies inside the world', () => {
    for (const { rect } of DECOR_BLOCKED) {
      expect(inRect({ col: 0, row: WORLD_TOP, cols: WORLD_COLS, rows: WORLD_ROWS }, rect.col, rect.row)).toBe(
        true,
      );
      expect(rect.col + rect.cols).toBeLessThanOrEqual(WORLD_COLS);
      expect(rect.row + rect.rows).toBeLessThanOrEqual(WORLD_BOTTOM);
    }
  });
});

describe('the Town Square tune', () => {
  it('has its own theme in the same shape as the seasons, and plays day and night', () => {
    const t = THEMES.town_square;
    expect(t.melody[0]).toHaveLength(32);
    expect(t.melody[1]).toHaveLength(32);
    expect(t.progression).toHaveLength(4);
    expect(loopNotes(t, false, 0).length).toBeGreaterThan(10);
    expect(loopNotes(t, true, 0).length).toBeGreaterThan(5);
    expect(townSquareKey(false)).toBe('town_square-day');
    expect(townSquareKey(true)).toBe('town_square-night');
    expect(themeKey('spring', false)).toBe('spring-day');
  });

  it('is a pref, on by default, kept per device and sanitised', () => {
    expect(DEFAULT_PREFS.townTune).toBe(true);
    expect(sanitizePrefs({ townTune: false }).townTune).toBe(false);
    expect(sanitizePrefs({ townTune: 'no' }).townTune).toBe(true);
    expect(GAME_DATA.townProjects.bandstand.rewards).toContainEqual({
      kind: 'musicTrack',
      id: 'town_square',
    });
  });
});
