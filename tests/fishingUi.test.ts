import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../src/core/events';
import type { OfflineReport } from '../src/core/offline';
import { START_GRID } from '../src/data/balance';
import { FISH_IDS, JUNK_IDS } from '../src/data/ids';
import {
  buildLayout,
  buildZones,
  inRect,
  LOCATION_ZONE,
  TRAP_TILES,
  trapTile,
  groundAt,
} from '../src/render/scene';
import { ALL_SPRITES, SPRITES } from '../src/render/sprites';
import { awayRows, awayTotals } from '../src/ui/awaySummary';

const zones = buildZones(START_GRID);
const zoneOf = (id: string) => zones.find((z) => z.id === id)!;

describe('fishing scenery', () => {
  it('shows nothing of the river or the dock until they are bought (the sea itself is always there since v2)', () => {
    const plain = buildLayout(START_GRID, []);
    const home = plain.objects.filter((o) => o.x < 320 && o.y < 192).map((o) => o.sprite);
    const sprites = new Set([...plain.ground.flat(), ...home]);
    for (const id of ['tile_river', 'obj_bridge', 'obj_dock']) {
      expect(sprites.has(id), id).toBe(false);
    }
    expect(home).toContain('obj_for_sale'); // the dock's sign on the shore
    expect(home.filter((s) => s === 'obj_dock_post')).toHaveLength(0);
    expect(groundAt(plain.ground, 8, 11)).not.toBe('tile_river');
    expect(groundAt(plain.ground, 17, 11)).toBe('tile_sea');
  });

  it('River Access lays a river along the bottom edge with a bridge', () => {
    const layout = buildLayout(START_GRID, ['river']);
    for (let col = 7; col <= 13; col++) {
      expect(groundAt(layout.ground, col, 10), `bank ${col}`).toBe('tile_pond_edge_n');
      expect(groundAt(layout.ground, col, 11), `current ${col}`).toBe('tile_river');
    }
    expect(groundAt(layout.ground, 6, 10)).toBe('tile_pond_corner_nw');
    expect(groundAt(layout.ground, 14, 11)).toBe('tile_pond_edge_e');
    expect(layout.animated.filter((a) => a.sprite === 'tile_river')).toHaveLength(7);
    expect(layout.objects.filter((o) => o.sprite === 'obj_bridge')).toHaveLength(2);
    expect(groundAt(layout.ground, 15, 11)).not.toBe('tile_sea'); // the dock is not there yet
  });

  it('the Old Dock adds sea tiles, planks and posts in the bottom-right corner', () => {
    const layout = buildLayout(START_GRID, ['river', 'ocean']);
    for (let col = 16; col <= 19; col++) {
      expect(groundAt(layout.ground, col, 10)).toBe('tile_sea');
      expect(groundAt(layout.ground, col, 11)).toBe('tile_sea');
    }
    expect(groundAt(layout.ground, 15, 10)).toBe('tile_path');
    expect(layout.objects.filter((o) => o.sprite === 'obj_dock')).toHaveLength(3);
    // Two dock posts, plus the two end posts of the broken Old Bridge on the inlet (row 12).
    expect(layout.objects.filter((o) => o.sprite === 'obj_dock_post' && o.y < 192)).toHaveLength(2);
    expect(layout.objects.some((o) => o.sprite === 'obj_for_sale' && o.x === 15 * 16)).toBe(false);
    expect(layout.animated.filter((a) => a.sprite === 'tile_sea').length).toBeGreaterThan(0);
  });

  it('every location has a clickable water zone, and its trap spots float inside it on water', () => {
    expect(LOCATION_ZONE).toEqual({ pond: 'pond', river: 'river', ocean: 'dock', lake: 'lake' });
    const layout = buildLayout(START_GRID, ['river', 'ocean', 'lake']);
    const water = new Set(['tile_water', 'tile_river', 'tile_sea', 'tile_lake_a', 'tile_lake_b']);
    for (const loc of ['pond', 'river', 'ocean', 'lake'] as const) {
      expect(TRAP_TILES[loc]).toHaveLength(3); // two, and a third once the Pond Fish bundle is done
      for (const t of TRAP_TILES[loc]) {
        expect(inRect(zoneOf(LOCATION_ZONE[loc]).rect, t.col, t.row), `${loc} ${t.col},${t.row}`).toBe(true);
        expect(water.has(groundAt(layout.ground, t.col, t.row)), `${loc} ${t.col},${t.row}`).toBe(true);
        expect(
          layout.objects.some(
            (o) => o.x === t.col * 16 && o.y === t.row * 16 && o.sprite !== 'obj_dock_post',
          ),
        ).toBe(false);
      }
      expect(trapTile(loc, 1)).toEqual(TRAP_TILES[loc][1]);
    }
  });
});

describe('fishing sprites', () => {
  it('every fish and junk item has an icon, and no two look alike', () => {
    const looks = new Set<string>();
    for (const id of [...FISH_IDS, ...JUNK_IDS]) {
      const def = SPRITES[`item_${id}`];
      expect(def, id).toBeDefined();
      expect(def!.frames[0]).toHaveLength(16);
      looks.add(def!.frames[0]!.join(''));
    }
    expect(looks.size).toBe(25); // v4-04: the lake's six
  });

  it('has the trap, bobber, bite bubble, splash, river, sea, bridge, dock and rod', () => {
    for (const id of [
      'obj_fish_trap',
      'obj_fish_trap_full',
      'obj_bobber',
      'obj_bobber_dip',
      'ui_bite',
      'fx_splash',
      'tile_river',
      'tile_sea',
      'obj_bridge',
      'obj_dock',
      'obj_dock_post',
      'ui_tool_rod',
    ]) {
      expect(SPRITES[id], id).toBeDefined();
    }
    expect(SPRITES.fx_splash!.frames.length).toBeGreaterThanOrEqual(3);
    expect(SPRITES.obj_fish_trap!.frames.length).toBe(2); // calm ripples
    expect(SPRITES.obj_fish_trap!.frames[0]).not.toEqual(SPRITES.obj_fish_trap_full!.frames[0]);
    expect(SPRITES.tile_river!.frames.length).toBeGreaterThan(1);
    expect(ALL_SPRITES.filter((s) => s.id.startsWith('item_')).length).toBeGreaterThan(30);
  });
});

describe('the away summary and traps', () => {
  const report = (events: GameEvent[]): OfflineReport => ({
    awayMs: 8 * 3_600_000,
    simulatedMs: 8 * 3_600_000,
    dayStarts: 0,
    seasonChanges: [],
    events,
    showSummary: true,
  });

  it('counts what the traps caught while away', () => {
    const events: GameEvent[] = [
      { type: 'caught', catch: 'bluegill', sizeCm: 12, location: 'pond', viaTrap: true },
      { type: 'caught', catch: 'old_boot', sizeCm: 0, location: 'pond', viaTrap: true },
      { type: 'caught', catch: 'koi', sizeCm: 40, location: 'pond', viaTrap: false },
    ];
    expect(awayTotals(report(events)).trapCatches).toBe(2);
    const rows = awayRows(report(events), { readyPlots: 0, dryPlots: 0 });
    expect(rows).toEqual([
      { icon: 'obj_fish_trap_full', text: 'Your traps caught 2 things from the water.' },
    ]);
    expect(awayRows(report([]), { readyPlots: 0, dryPlots: 0 })).toEqual([]);
  });
});
