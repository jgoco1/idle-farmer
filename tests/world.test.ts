// v2 phase 01: the world layout, the camera, culling, edge pips, land parcels and the camera prefs.

import { describe, expect, it } from 'vitest';
import { applyAction } from '../src/core/actions';
import type { GameEvent } from '../src/core/events';
import { PrefsStore, sanitizePrefs } from '../src/core/prefs';
import { makeContext } from '../src/core/sim';
import { createInitialState, type GameState } from '../src/core/state';
import { buildCalendar } from '../src/core/time';
import { TOWN_PROJECT_SCALE } from '../src/data/balance';
import { GAME_DATA } from '../src/data';
import { PARCEL_IDS } from '../src/data/ids';
import {
  HOME_RECT,
  regionAt,
  WORLD_BOTTOM,
  WORLD_COLS,
  WORLD_LAYOUT,
  WORLD_ROWS,
  WORLD_TOP,
} from '../src/data/world';
import {
  CHUNK_COLS,
  CHUNK_ROWS,
  clampCamera,
  defaultCamera,
  defaultZoom,
  DRAG_THRESHOLD_PX,
  easeToward,
  panBy,
  PressGesture,
  screenToWorld,
  visibleChunks,
  visibleRect,
  worldToScreen,
  zoomAt,
  zoomLimits,
  type Camera,
  type Viewport,
} from '../src/render/camera';
import { edgePips } from '../src/render/pips';
import {
  buildLayout,
  buildZones,
  groundAt,
  TILE,
  WORLD_H,
  WORLD_W,
  WORLD_Y0,
  WORLD_Y1,
  zoneAt,
} from '../src/render/scene';
import { buyParcel, nextParcel, parcelStatus } from '../src/systems/parcels';
import { at, NY, setFarmLevel } from './helpers';

const CREATED = at(NY, 2026, 1, 7, 10);
const desktop: Viewport = { w: 1280, h: 640, dpr: 1 };
const phone: Viewport = { w: 360, h: 560, dpr: 1 };

describe('the world layout (DATA_SCHEMAS §9.3)', () => {
  it('is 36 × 36 (rows −14 … 21) with the v1 scene at (0, 0)', () => {
    expect([WORLD_COLS, WORLD_ROWS, WORLD_TOP, WORLD_BOTTOM]).toEqual([36, 36, -14, 22]);
    expect(HOME_RECT).toEqual({ col: 0, row: 0, cols: 20, rows: 12 });
    expect(regionAt(0, 0)).toBe('home');
    expect(regionAt(19, 11)).toBe('home');
    expect(regionAt(20, 5)).toBe('lanes');
    expect(regionAt(25, 3)).toBe('orchard');
    expect(regionAt(25, 10)).toBe('yard');
    expect(regionAt(25, 18)).toBe('meadow');
    expect(regionAt(5, 17)).toBe('town');
    expect(regionAt(17, 16)).toBe('sea');
    expect(regionAt(36, 0)).toBeNull();
    expect(regionAt(0, WORLD_TOP - 1)).toBeNull();
    expect(regionAt(0, WORLD_BOTTOM)).toBeNull();
    expect(regionAt(0, WORLD_TOP)).not.toBeNull();
  });

  it('keeps regions apart and inside the world, signs and tree spots inside their parcels', () => {
    const rects = WORLD_LAYOUT.regions.map((r) => r.rect);
    for (const r of rects) {
      expect(r.col + r.cols).toBeLessThanOrEqual(WORLD_COLS);
      expect(r.row).toBeGreaterThanOrEqual(WORLD_TOP);
      expect(r.row + r.rows).toBeLessThanOrEqual(WORLD_BOTTOM);
    }
    for (let c = 0; c < WORLD_COLS; c++)
      for (let r = WORLD_TOP; r < WORLD_BOTTOM; r++) {
        const n = WORLD_LAYOUT.regions.filter(
          (g) =>
            c >= g.rect.col &&
            c < g.rect.col + g.rect.cols &&
            r >= g.rect.row &&
            r < g.rect.row + g.rect.rows,
        ).length;
        expect(n, `${c},${r}`).toBeLessThanOrEqual(1);
      }
    for (const id of PARCEL_IDS)
      expect(regionAt(WORLD_LAYOUT.forSaleSigns[id].col, WORLD_LAYOUT.forSaleSigns[id].row)).toBe(id);
    expect(WORLD_LAYOUT.treeSpots).toHaveLength(10);
    for (const t of WORLD_LAYOUT.treeSpots) {
      expect(regionAt(t.col, t.row)).toBe('orchard');
      expect(regionAt(t.col + 1, t.row + 1)).toBe('orchard');
    }
    // Lanes are drawn as paths and never overlap a parcel.
    const ground = buildLayout(GAME_DATA.startGrid).ground;
    for (const l of WORLD_LAYOUT.lanes) {
      expect(groundAt(ground, l.col, l.row), `${l.col},${l.row}`).toBe('tile_path');
      expect(['home', 'lanes', 'town']).toContain(regionAt(l.col, l.row));
    }
  });

  it('parcels in the data match the layout and BALANCE §13.1, §14.1', () => {
    expect(PARCEL_IDS.map((id) => GAME_DATA.parcels[id].price)).toEqual([
      30_000, 150_000, 500_000, 1_500_000, 2_400_000,
    ]);
    expect(GAME_DATA.parcels.north_fields.field).toBe('north_fields');
    expect(GAME_DATA.parcels.terraces.field).toBe('terraces');
    for (const id of PARCEL_IDS)
      expect(GAME_DATA.parcels[id].rect).toEqual(WORLD_LAYOUT.regions.find((r) => r.id === id)!.rect);
  });
});

describe('the camera (GDD §12.1)', () => {
  it('defaults to the v1 scale on the home region, and to its height on a phone', () => {
    expect(defaultZoom(desktop)).toBe(3); // min(1280 / 320, 640 / 192) = 3.3
    expect(defaultZoom({ w: 2560, h: 1280, dpr: 2 })).toBe(6);
    expect(defaultZoom(phone)).toBe(2); // 560 / 192 = 2.9, and at least 2
    expect(defaultZoom({ w: 1080, h: 1680, dpr: 3 })).toBe(8); // 1680 / 192 = 8.75
    expect(defaultZoom({ w: 360, h: 300, dpr: 1 })).toBe(2); // never below 2 CSS px on a phone
    const cam = defaultCamera(desktop);
    expect(cam.zoom).toBe(3);
    // The view shows the whole home region, clamped against the world's left and top edges.
    const v = visibleRect(cam, desktop);
    expect(v.x).toBeCloseTo(0);
    expect(v.y).toBeCloseTo(0);
    expect(v.w).toBeGreaterThanOrEqual(320);
    expect(v.h).toBeGreaterThanOrEqual(192);
  });

  it('only uses integer zoom levels, from 1× to the default + 2 (at least 3×)', () => {
    expect(zoomLimits(desktop)).toEqual({ min: 1, max: 5 });
    expect(zoomLimits({ w: 330, h: 200, dpr: 1 })).toEqual({ min: 1, max: 4 }); // phone: default 2
    expect(zoomLimits({ w: 700, h: 200, dpr: 1 })).toEqual({ min: 1, max: 3 });
    const cam = defaultCamera(desktop);
    zoomAt(cam, desktop, 2.6, 0, 0);
    expect(cam.zoom).toBe(3);
    zoomAt(cam, desktop, 99, 0, 0);
    expect(cam.zoom).toBe(5);
    zoomAt(cam, desktop, -4, 0, 0);
    expect(cam.zoom).toBe(1);
  });

  it('converts world to screen and back', () => {
    const cam: Camera = { x: 300, y: 200, zoom: 3 };
    const s = worldToScreen(cam, desktop, 300, 200);
    expect(s).toEqual({ x: 640, y: 320 });
    expect(worldToScreen(cam, desktop, 310, 190)).toEqual({ x: 670, y: 290 });
    for (const [x, y] of [
      [0, 0],
      [123.5, 77],
      [575, 351],
    ] as const) {
      const p = worldToScreen(cam, desktop, x, y);
      const w = screenToWorld(cam, desktop, p.x, p.y);
      expect(w.x).toBeCloseTo(x);
      expect(w.y).toBeCloseTo(y);
    }
  });

  it('clamps at the world edges, and centres a world smaller than the view', () => {
    const cam = clampCamera({ x: -500, y: 9999, zoom: 3 }, desktop);
    const v = visibleRect(cam, desktop);
    expect(v.x).toBeCloseTo(0);
    expect(v.y + v.h).toBeCloseTo(WORLD_Y1);
    // v4: the view travels north up to the tree line, not past it.
    const north = visibleRect(clampCamera({ x: 300, y: -9999, zoom: 3 }, desktop), desktop);
    expect(north.y).toBeCloseTo(WORLD_Y0);
    const right = panBy({ x: 300, y: 200, zoom: 3 }, desktop, -1e6, 0);
    expect(visibleRect(right, desktop).x + visibleRect(right, desktop).w).toBeCloseTo(WORLD_W);
    // 1× on a wide screen: the whole world fits and is centred.
    const out = clampCamera({ x: 10, y: 10, zoom: 1 }, desktop);
    expect(out).toEqual({ x: WORLD_W / 2, y: (WORLD_Y0 + WORLD_Y1) / 2, zoom: 1 });
    expect(WORLD_H).toBe(WORLD_Y1 - WORLD_Y0);
  });

  it('zooms around a point: the world pixel under the cursor stays under it', () => {
    const cam: Camera = { x: 288, y: 176, zoom: 2 };
    const before = screenToWorld(cam, desktop, 900, 200);
    zoomAt(cam, desktop, 3, 900, 200);
    expect(cam.zoom).toBe(3);
    const after = screenToWorld(cam, desktop, 900, 200);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('eases toward a target, or jumps there under reduced motion', () => {
    const cam: Camera = { x: 0, y: 0, zoom: 3 };
    const target: Camera = { x: 100, y: 50, zoom: 3 };
    expect(easeToward(cam, target, 16, false)).toBe(false);
    expect(cam.x).toBeGreaterThan(0);
    expect(cam.x).toBeLessThan(100);
    for (let i = 0; i < 200 && !easeToward(cam, target, 16, false); i++);
    expect(cam).toEqual(target);
    const c2: Camera = { x: 0, y: 0, zoom: 3 };
    expect(easeToward(c2, target, 16, true)).toBe(true);
    expect(c2).toEqual(target);
  });
});

describe('pan versus click', () => {
  it('a press that stays within the threshold is a click; one that moves further is a pan and never a click', () => {
    const g = new PressGesture();
    g.down(100, 100);
    expect(g.move(103, 102)).toBe(false);
    expect(g.up()).toBe(true);

    g.down(100, 100);
    expect(g.move(100 + DRAG_THRESHOLD_PX + 1, 100)).toBe(true);
    // Coming back to the start does not turn the pan back into a click.
    expect(g.move(100, 100)).toBe(true);
    expect(g.up()).toBe(false);

    g.down(10, 10);
    g.cancel(); // a second finger: a pinch
    expect(g.up()).toBe(false);
  });

  it('a drag over the field leaves every plot as it was (no action is dispatched)', () => {
    // The renderer only calls onPlotClick when `up()` says click; check the contract end to end.
    const g = new PressGesture();
    let clicks = 0;
    g.down(0, 0);
    for (let x = 0; x <= 60; x += 5) g.move(x, x / 2);
    if (g.up()) clicks++;
    expect(clicks).toBe(0);
  });
});

describe('viewport culling', () => {
  it('draws only the ground chunks the view overlaps', () => {
    // v4: chunks are anchored at the world's top (y −224), 3 × 3 of them.
    expect([CHUNK_COLS, CHUNK_ROWS]).toEqual([3, 3]);
    // The default desktop view (home spans x 0–320, y 0–192) straddles chunk rows 0 (y −224…32) and 1.
    expect(visibleChunks(visibleRect(defaultCamera(desktop), desktop))).toEqual([0, 1, 3, 4]);
    // A small view in the middle of the bottom-right chunk.
    expect(visibleChunks({ x: 530, y: 300, w: 20, h: 20 })).toEqual([8]);
    // A view across the chunk corner at (256, 32).
    expect(visibleChunks({ x: 250, y: 22, w: 20, h: 20 })).toEqual([0, 1, 3, 4]);
    // Above row 0: the north band is in chunk row 0.
    expect(visibleChunks({ x: 10, y: -200, w: 20, h: 20 })).toEqual([0]);
    // The whole world.
    expect(visibleChunks({ x: -100, y: -300, w: 900, h: 800 })).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    // The output array is reused.
    const out: number[] = [9, 9, 9];
    expect(visibleChunks({ x: 0, y: 40, w: 10, h: 10 }, out)).toBe(out);
    expect(out).toEqual([3]);
  });
});

describe('edge pips', () => {
  const view = { x: 0, y: 0, w: 320, h: 192 };

  it('point at the nearest off-screen target of each kind, none for what is in view', () => {
    const pips = edgePips(
      [
        { kind: 'crop', col: 5, row: 5 }, // in view
        { kind: 'crop', col: 30, row: 3 },
        { kind: 'crop', col: 25, row: 3 }, // nearer
        { kind: 'trap', col: 17, row: 20 },
      ],
      view,
    );
    expect(pips.map((p) => [p.kind, p.col, p.row, p.side])).toEqual([
      ['crop', 25, 3, 'right'],
      ['trap', 17, 20, 'bottom'],
    ]);
    for (const p of pips) {
      expect(p.x).toBeGreaterThanOrEqual(view.x);
      expect(p.x).toBeLessThanOrEqual(view.x + view.w);
      expect(p.y).toBeGreaterThanOrEqual(view.y);
      expect(p.y).toBeLessThanOrEqual(view.y + view.h);
    }
    expect(edgePips([{ kind: 'dish', col: 2, row: 2 }], view)).toEqual([]);
  });

  it('show at most four, nearest first, and sit on the side the target is', () => {
    const left = edgePips([{ kind: 'dish', col: 2, row: 5 }], { x: 200, y: 0, w: 320, h: 192 });
    expect(left[0]!.side).toBe('left');
    const top = edgePips([{ kind: 'trap', col: 20, row: 0 }], { x: 200, y: 200, w: 320, h: 120 });
    expect(top[0]!.side).toBe('top');
    expect(top[0]!.y).toBeCloseTo(200 + 12);
    expect(TILE).toBe(16);
  });
});

describe('land parcels (BALANCE §13.1)', () => {
  function farm(): GameState {
    return createInitialState(CREATED, NY, 1);
  }
  const ctx = (s: GameState, events: GameEvent[] = []) =>
    makeContext(s, GAME_DATA, buildCalendar(CREATED, s.calendar, NY), events);

  it('are bought in order, with the farm level and expansion conditions', () => {
    const s = farm();
    expect(nextParcel(s)).toBe('orchard');
    expect(parcelStatus(s, GAME_DATA, 'orchard')).toBe('locked');
    s.gold = 1_000_000;
    expect(buyParcel(s, ctx(s), 'orchard')).toEqual({
      ok: false,
      reason: expect.stringMatching(/Farm Level 5/),
    });
    setFarmLevel(s, 5);
    expect(buyParcel(s, ctx(s), 'orchard')).toEqual({ ok: false, reason: 'Needs “Old Orchard Plot” first.' });
    s.expansions.push('farm_1', 'farm_2', 'farm_3');
    expect(parcelStatus(s, GAME_DATA, 'orchard')).toBe('available');
    expect(buyParcel(s, ctx(s), 'yard')).toEqual({ ok: false, reason: 'Buy the Hilltop Orchard first.' });
    const events: GameEvent[] = [];
    expect(buyParcel(s, ctx(s, events), 'orchard').ok).toBe(true);
    expect(s.gold).toBe(1_000_000 - 30_000);
    expect(s.land.parcels).toEqual(['orchard']);
    expect(events).toContainEqual({ type: 'parcelBought', parcel: 'orchard' });
    expect(events).toContainEqual({ type: 'purchased', what: 'orchard', gold: 30_000 });
    expect(buyParcel(s, ctx(s), 'orchard')).toEqual({
      ok: false,
      reason: 'Hilltop Orchard is already yours.',
    });
    expect(parcelStatus(s, GAME_DATA, 'yard')).toBe('locked'); // Farm Level 7
    setFarmLevel(s, 7);
    expect(buyParcel(s, ctx(s), 'yard').ok).toBe(true);
    expect(buyParcel(s, ctx(s), 'meadow').ok).toBe(true);
    expect(s.land.parcels).toEqual(['orchard', 'yard', 'meadow']);
    expect(s.gold).toBe(1_000_000 - 680_000);
    // v4-01: the North Fields need the Back Forty and Farm Level 7; the Upper Terraces need them and Farm Level 8.
    expect(nextParcel(s)).toBe('north_fields');
    s.gold = 10_000_000;
    expect(buyParcel(s, ctx(s), 'north_fields').ok).toBe(false);
    s.expansions.push('farm_4');
    expect(buyParcel(s, ctx(s), 'terraces').ok).toBe(false);
    expect(buyParcel(s, ctx(s), 'north_fields').ok).toBe(true);
    expect(parcelStatus(s, GAME_DATA, 'terraces')).toBe('locked');
    setFarmLevel(s, 8);
    expect(buyParcel(s, ctx(s), 'terraces').ok).toBe(true);
    expect(nextParcel(s)).toBeNull();
    expect(s.gold).toBe(10_000_000 - 3_900_000);
  });

  it('need the gold, and go through dispatch as the buyParcel action', () => {
    const s = farm();
    setFarmLevel(s, 5);
    s.expansions.push('farm_1', 'farm_2', 'farm_3');
    s.gold = 29_999;
    expect(applyAction(s, ctx(s), { type: 'buyParcel', parcel: 'orchard' })).toEqual({
      ok: false,
      reason: 'You need 30,000g for that.',
    });
    s.gold = 30_000;
    expect(applyAction(s, ctx(s), { type: 'buyParcel', parcel: 'orchard' }).ok).toBe(true);
    expect(s.gold).toBe(0);
  });

  it('a bought parcel loses its overgrowth and sign, and changes no zone', () => {
    const before = buildLayout(GAME_DATA.startGrid, [], []);
    const after = buildLayout(GAME_DATA.startGrid, [], ['orchard']);
    const inOrchard = (o: { x: number; y: number }) => o.x >= 21 * 16 && o.y < 7 * 16;
    expect(before.objects.filter(inOrchard).some((o) => o.sprite === 'obj_tall_grass')).toBe(true);
    expect(
      after.objects
        .filter(inOrchard)
        .some((o) => o.sprite === 'obj_tall_grass' || o.sprite === 'obj_for_sale'),
    ).toBe(false);
    expect(zoneAt(buildZones(GAME_DATA.startGrid), 25, 3)).toBeNull();
  });
});

describe('camera prefs (DATA_SCHEMAS §9.7)', () => {
  it('keep a valid camera and drop anything else to the default view', () => {
    expect(sanitizePrefs({}).camera).toBeNull();
    expect(sanitizePrefs({ camera: { x: 100, y: 50.5, zoom: 3 } }).camera).toEqual({
      x: 100,
      y: 50.5,
      zoom: 3,
    });
    for (const bad of [
      { x: 1, y: 2, zoom: 2.5 },
      { x: 1, y: 2, zoom: 0 },
      { x: 1, y: 2, zoom: 17 },
      { x: Number.NaN, y: 2, zoom: 2 },
      { x: '1', y: 2, zoom: 2 },
      'camera',
    ])
      expect(sanitizePrefs({ camera: bad }).camera).toBeNull();
  });

  it('live in prefs, never in the game state', () => {
    const data = new Map<string, string>();
    const store = new PrefsStore({
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => void data.set(k, v),
      removeItem: (k) => void data.delete(k),
    });
    store.set('camera', { x: 300, y: 100, zoom: 4 });
    expect(
      new PrefsStore({ getItem: (k) => data.get(k) ?? null, setItem: () => {}, removeItem: () => {} }).value
        .camera,
    ).toEqual({
      x: 300,
      y: 100,
      zoom: 4,
    });
    expect(JSON.stringify(createInitialState(CREATED, NY, 1))).not.toMatch(/camera|zoom/);
  });
});

describe('gold still to spend (BALANCE §13.4, simulator)', () => {
  it('counts v1, the land, decorations (2,773,000) and the town projects, less what the farm owns', async () => {
    const { catalogueParts, catalogueTotal, toSpend } = await import('../scripts/sim/catalogue');
    const parts = catalogueParts(GAME_DATA);
    expect(parts.parcels).toBe(680_000 + 3_900_000); // v4-01: the North Fields and the Upper Terraces
    expect(parts.decor).toBe(2_773_000);
    // v2-04: every building level (955,000), 12 hens and 6 cows (108,000), the Collecting Basket (50,000) and the two building cards (27,000).
    expect(parts.ranch).toBe(1_140_000);
    expect(parts.projects).toBe(Math.round(8_500_000 * TOWN_PROJECT_SCALE));
    expect(parts.v1).toBeGreaterThan(560_000); // ≈ 590,000: 538,000 before v2-06 plus the Seed Order's 4,000 + 12,000 + 36,000
    expect(parts.v1).toBeLessThan(620_000 + 90_300); // v4-01: sprinklers 13–16 and scarecrows 5–6 add 90,300
    const s = createInitialState(CREATED, NY, 1);
    expect(toSpend(s, GAME_DATA)).toBe(catalogueTotal(GAME_DATA) - 0);
    s.land.parcels.push('orchard');
    s.expansions.push('farm_1');
    expect(toSpend(s, GAME_DATA)).toBe(catalogueTotal(GAME_DATA) - 30_000 - 400);
    // Bought decorations count (up to the counted copies), and donated gold counts as bought.
    s.decor.owned.cobble_path = 100; // 40 count
    s.decor.owned.windmill = 1;
    s.town.projects.old_bridge = { stagesDone: 1, gold: 5_000, items: [] };
    const bridge = Math.round(60_000 * TOWN_PROJECT_SCALE) + 5_000;
    expect(toSpend(s, GAME_DATA)).toBe(
      catalogueTotal(GAME_DATA) - 30_000 - 400 - 40 * 300 - 450_000 - bridge,
    );
  });
});
