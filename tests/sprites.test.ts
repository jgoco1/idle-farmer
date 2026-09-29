import { describe, expect, it } from 'vitest';
import { KEY_TO_NAME, PALETTE, TRANSPARENT } from '../src/render/palette';
import { ALL_SPRITES, SPRITES } from '../src/render/sprites';

describe('palette', () => {
  it('has the 47 colours of ART_STYLE.md, each with one key', () => {
    expect(Object.keys(PALETTE)).toHaveLength(47);
    expect(Object.keys(KEY_TO_NAME)).toHaveLength(47);
    expect(new Set(Object.values(KEY_TO_NAME)).size).toBe(47);
    for (const hex of Object.values(PALETTE)) expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(TRANSPARENT in KEY_TO_NAME).toBe(false);
  });
});

describe('sprites', () => {
  it('have unique ids', () => {
    expect(Object.keys(SPRITES)).toHaveLength(ALL_SPRITES.length);
  });

  it.each(ALL_SPRITES.map((s) => [s.id, s] as const))(
    '%s uses palette keys only, with equal rows and frames',
    (_id, def) => {
      expect(def.frames.length).toBeGreaterThan(0);
      const h = def.frames[0]!.length;
      const w = def.frames[0]![0]!.length;
      expect(h).toBeGreaterThan(0);
      expect(w % 16 === 0 && h % 16 === 0).toBe(true);
      for (const frame of def.frames) {
        expect(frame).toHaveLength(h);
        for (const row of frame) {
          expect(row).toHaveLength(w);
          for (const ch of row) expect(ch === TRANSPARENT || ch in KEY_TO_NAME, `bad key '${ch}'`).toBe(true);
          expect(row).not.toMatch(/[tT]/); // tints are overlays, never sprite pixels
        }
      }
      if (def.frames.length > 1) expect(def.frameMs).toBeGreaterThan(0);
    },
  );

  it('terrain tiles are 16 × 16 and fully opaque', () => {
    for (const def of ALL_SPRITES.filter((s) => s.id.startsWith('tile_'))) {
      for (const frame of def.frames) {
        expect(frame).toHaveLength(16);
        expect(frame.join('')).not.toContain(TRANSPARENT);
      }
    }
  });

  it('includes everything the phase-01 scene needs', () => {
    for (const id of [
      'tile_grass_a',
      'tile_grass_b',
      'tile_grass_c',
      'tile_soil_dry',
      'tile_soil_wet',
      'tile_water',
      'tile_path',
      'tile_pond_edge_n',
      'tile_pond_corner_nw',
      'obj_fence_h',
      'obj_fence_v',
      'obj_farmhouse',
      'obj_market_stall',
      'obj_tree',
      'obj_flower_a',
      'ui_gold',
      'ui_clock',
      'ui_sun',
      'ui_moon',
    ]) {
      expect(SPRITES[id], id).toBeDefined();
    }
    expect(SPRITES.tile_water!.frames).toHaveLength(2);
    expect(SPRITES.obj_farmhouse!.frames[0]![0]!.length).toBeGreaterThan(16);
  });
});
