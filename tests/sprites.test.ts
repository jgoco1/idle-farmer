import { describe, expect, it } from 'vitest';
import { KEY_TO_NAME, PALETTE, TRANSPARENT } from '../src/render/palette';
import { ALL_SPRITES, SPRITES } from '../src/render/sprites';
import { CROP_IDS } from '../src/data/ids';
import { ITEMS } from '../src/data/items';
import { DECOR } from '../src/data/decor';
import { DECOR_IDS, TOWN_PROJECT_IDS } from '../src/data/ids';
import { TOWN_PROJECTS } from '../src/data/townProjects';
import { farmhouseSpriteId } from '../src/render/sprites/farmhouse';
import { townSpriteId } from '../src/render/sprites/town';
import { snowdusted } from '../src/render/sprites/types';

describe('palette', () => {
  it('has the 49 colours of ART_STYLE.md (47 plus lamp_glow and slate), each with one key', () => {
    expect(Object.keys(PALETTE)).toHaveLength(49);
    expect(Object.keys(KEY_TO_NAME)).toHaveLength(49);
    expect(new Set(Object.values(KEY_TO_NAME)).size).toBe(49);
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
      if (def.frames.length > 1 && !def.lit) expect(def.frameMs).toBeGreaterThan(0);
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

describe('farming sprites (phase 02)', () => {
  it('every crop has 5 stages, a sparkling ready stage, an item icon and a seed packet', () => {
    for (const id of CROP_IDS) {
      for (let stage = 0; stage < 5; stage++) {
        const def = SPRITES[`crop_${id}_${stage}`];
        expect(def, `crop_${id}_${stage}`).toBeDefined();
        expect(def!.anchor).toBe('bottom-center');
      }
      const ready = SPRITES[`crop_${id}_4`]!;
      expect(ready.frames).toHaveLength(2);
      expect(ready.frameMs).toBe(400);
      expect(ready.frames[0]).not.toEqual(ready.frames[1]);
      expect(SPRITES[`item_${id}`], `item_${id}`).toBeDefined();
      expect(SPRITES[`item_seed_${id}`], `item_seed_${id}`).toBeDefined();
    }
    for (const id of [
      'crop_dead',
      'tile_soil_untilled',
      'ui_tool_auto',
      'ui_tool_hoe',
      'ui_tool_water',
      'ui_tool_hand',
    ]) {
      expect(SPRITES[id], id).toBeDefined();
    }
  });

  it('near-ready and ready stages differ, and crops look different from each other', () => {
    const readies = new Set<string>();
    for (const id of CROP_IDS) {
      expect(SPRITES[`crop_${id}_3`]!.frames[0]).not.toEqual(SPRITES[`crop_${id}_4`]!.frames[0]);
      readies.add(SPRITES[`crop_${id}_4`]!.frames[0]!.join(''));
      readies.add(SPRITES[`item_${id}`]!.frames[0]!.join(''));
    }
    expect(readies.size).toBe(CROP_IDS.length * 2);
  });

  it('every item has a sprite', () => {
    for (const def of Object.values(ITEMS)) expect(SPRITES[def.sprite], def.sprite).toBeDefined();
  });
});

describe('decoration, town and lighting sprites (v2 phase 02)', () => {
  const size = (id: string): [number, number] => {
    const f = SPRITES[id]!.frames[0]!;
    return [f[0]!.length, f.length];
  };

  it('every piece has its sprite, sized for its footprint', () => {
    for (const id of DECOR_IDS) {
      const d = DECOR[id];
      if (d.kind !== 'place') continue;
      const sprite = SPRITES[d.sprite];
      expect(sprite, d.sprite).toBeDefined();
      const [w, h] = size(d.sprite);
      expect(w, id).toBe(d.size.cols * 16);
      expect(h % 16, id).toBe(0);
      expect(h, id).toBeGreaterThanOrEqual(d.size.rows * 16);
    }
  });

  it('paths and fences come in all 16 neighbour masks, each different from a lone piece', () => {
    for (const id of DECOR_IDS) {
      const d = DECOR[id];
      if (!d.autotile) continue;
      const seen = new Set<string>();
      for (let mask = 0; mask < 16; mask++) {
        const s = SPRITES[`decor_${id}_${mask}`];
        expect(s, `${id} ${mask}`).toBeDefined();
        seen.add(s!.frames[0]!.join(''));
      }
      expect(seen.size, id).toBe(16);
      expect(SPRITES[`decor_${id}`]!.frames[0]).toEqual(SPRITES[`decor_${id}_10`]!.frames[0]);
    }
  });

  it('a path tile joins the tile beside it: the edge pixels of joined sides line up', () => {
    const east = SPRITES.decor_cobble_path_2!.frames[0]!;
    const west = SPRITES.decor_cobble_path_8!.frames[0]!;
    for (let y = 1; y <= 14; y++) {
      expect(east[y]![15], `east edge ${y}`).not.toBe('.');
      expect(west[y]![0], `west edge ${y}`).not.toBe('.');
    }
    // An unjoined side keeps clear of the tile's edge, so a lone path tile is a rounded patch.
    for (let y = 0; y < 16; y++) expect(SPRITES.decor_cobble_path_0!.frames[0]![y]![0]).toBe('.');
  });

  it('lamps, lanterns and harbour lamps have a day frame and a lit frame that differ', () => {
    for (const id of DECOR_IDS) {
      const d = DECOR[id];
      if (!d.glows) continue;
      const s = SPRITES[d.sprite]!;
      expect(s.lit, id).toBe(true);
      expect(s.frames, id).toHaveLength(2);
      expect(s.frames[0], id).not.toEqual(s.frames[1]);
      expect(s.frames[1]!.join(''), id).toMatch(/a/); // a lamp_glow pixel in the lit frame
      expect(s.frames[0]!.join(''), id).not.toMatch(/a/);
    }
  });

  it('seasonal pieces have a sprite for each season that differs', () => {
    for (const id of DECOR_IDS) {
      const d = DECOR[id];
      if (!d.seasonal) continue;
      const looks = new Set(
        (['spring', 'summer', 'autumn', 'winter'] as const).map((s) =>
          (SPRITES[`${d.sprite}_${s}`] ?? SPRITES[d.sprite]!).frames[0]!.join(''),
        ),
      );
      expect(looks.size, id).toBeGreaterThanOrEqual(2);
    }
    expect(SPRITES.decor_flower_bed_winter!.frames[0]).not.toEqual(
      SPRITES.decor_flower_bed_spring!.frames[0],
    );
    expect(SPRITES.decor_sandcastle_winter!.frames[0]).not.toEqual(SPRITES.decor_sandcastle!.frames[0]);
  });

  it('the windmill is 32 × 64 with separate two-frame sails (1,200 ms)', () => {
    expect(size('decor_windmill')).toEqual([32, 64]);
    expect(SPRITES.decor_windmill_sails!.frames).toHaveLength(2);
    expect(SPRITES.decor_windmill_sails!.frameMs).toBe(1200);
  });

  it('every town project has a ruin and a sprite for each stage, the site’s size plus a tile of height', () => {
    for (const id of TOWN_PROJECT_IDS) {
      const def = TOWN_PROJECTS[id];
      const looks = new Set<string>();
      for (let stage = 0; stage <= def.stages.length; stage++) {
        const sprite = SPRITES[townSpriteId(id, stage)];
        expect(sprite, `${id} ${stage}`).toBeDefined();
        const [w, h] = size(sprite!.id);
        expect(w, id).toBe(def.site.cols * 16);
        expect(h, id).toBe((def.site.rows + 1) * 16);
        looks.add(sprite!.frames[0]!.join(''));
      }
      expect(looks.size, id).toBe(def.stages.length + 1); // every stage looks different
    }
    expect(SPRITES.obj_fountain_3!.frames).toHaveLength(2);
    expect(SPRITES.obj_fountain_3!.frameMs).toBe(400);
  });

  it('the farmhouse has a sprite for every paint, roof and loft; the loft is a tile taller', () => {
    expect(farmhouseSpriteId(null, null, false)).toBe('obj_farmhouse');
    expect(farmhouseSpriteId('paint_sage', 'roof_slate', true)).toBe('obj_farmhouse_sage_slate_loft');
    for (const paint of ['red', 'sage', 'sky'])
      for (const roof of ['tile', 'thatch', 'slate'])
        for (const loft of ['', '_loft']) {
          const id =
            paint === 'red' && roof === 'tile' && loft === ''
              ? 'obj_farmhouse'
              : `obj_farmhouse_${paint}_${roof}${loft}`;
          const [w, h] = size(id);
          expect(w).toBe(64);
          expect(h).toBe(loft ? 64 : 48);
        }
    expect(SPRITES.obj_farmhouse_sage_tile!.frames[0]).not.toEqual(SPRITES.obj_farmhouse!.frames[0]);
  });

  it('the night halos are made of lamp_glow only', () => {
    for (const id of ['fx_glow_small', 'fx_glow_large']) {
      const rows = SPRITES[id]!.frames[0]!;
      expect(rows.join('').replace(/[.a]/g, '')).toBe('');
      expect(rows.join('')).toMatch(/a/);
    }
    expect(size('fx_glow_small')).toEqual([16, 16]);
    expect(size('fx_glow_large')).toEqual([32, 32]);
  });

  it('snow dusts the top edge of a sprite and nothing else', () => {
    const rows = ['....', '.kk.', '.RR.', '.RR.'];
    expect(snowdusted(rows)).toEqual(['....', '.kk.', '.ww.', '.RR.']);
    expect(snowdusted(['kkkk', 'RRRR'])).toEqual(['kkkk', 'wwwR']);
  });
});
