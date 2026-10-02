// v2-05 scene input: tap-to-inspect on touch screens, Paint mode and Alt-drag, the stroke walk, the phone's default
// view and the Paint pref. The renderer feeds pointer events to these rules; e2e/touch.spec.ts drives the real page.

import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, sanitizePrefs } from '../src/core/prefs';
import { defaultCamera, isPhone, visibleRect, type Viewport } from '../src/render/camera';
import { fieldCentre, plotIndexAt, TILE } from '../src/render/scene';
import {
  clearInspected,
  INSPECT_ANIMAL,
  INSPECT_NONE,
  INSPECT_TREE,
  paintArmed,
  PaintStroke,
  tapActs,
  type Inspected,
} from '../src/render/sceneInput';

const phone: Viewport = { w: 390 * 3, h: 700 * 3, dpr: 3 }; // a 390 × 844 phone's scene, at 3×
const desktop: Viewport = { w: 1280, h: 640, dpr: 1 };

describe('tap to inspect (touch)', () => {
  it('the first tap on a tree or an animal only shows its label; the second acts', () => {
    const ins: Inspected = { kind: INSPECT_NONE, id: -1 };
    expect(tapActs(ins, INSPECT_TREE, 3, true)).toBe(false);
    expect(ins).toEqual({ kind: INSPECT_TREE, id: 3 });
    expect(tapActs(ins, INSPECT_TREE, 3, true)).toBe(true); // picks
    expect(ins).toEqual({ kind: INSPECT_TREE, id: 3 }); // and the label stays, showing the picked tree
    // another tree, or an animal with the same id, is a new first tap
    expect(tapActs(ins, INSPECT_TREE, 4, true)).toBe(false);
    expect(tapActs(ins, INSPECT_ANIMAL, 4, true)).toBe(false);
    expect(tapActs(ins, INSPECT_ANIMAL, 4, true)).toBe(true); // pets
    clearInspected(ins); // a pan or a tap elsewhere
    expect(ins).toEqual({ kind: INSPECT_NONE, id: -1 });
    expect(tapActs(ins, INSPECT_ANIMAL, 4, true)).toBe(false);
  });

  it('a mouse click always acts at once (the desktop label comes from hovering)', () => {
    const ins: Inspected = { kind: INSPECT_NONE, id: -1 };
    expect(tapActs(ins, INSPECT_TREE, 1, false)).toBe(true);
    expect(tapActs(ins, INSPECT_ANIMAL, 2, false)).toBe(true);
    expect(ins.kind).toBe(INSPECT_NONE);
  });
});

describe('Paint mode', () => {
  it('a press paints with the toggle on, or with Alt on a mouse; otherwise a drag pans', () => {
    expect(paintArmed(false, 'touch', false, false)).toBe(false); // off: a drag never runs a tool
    expect(paintArmed(false, 'mouse', false, false)).toBe(false);
    expect(paintArmed(true, 'touch', false, false)).toBe(true);
    expect(paintArmed(true, 'mouse', false, false)).toBe(true);
    expect(paintArmed(false, 'mouse', true, false)).toBe(true); // Alt-drag on desktop
    expect(paintArmed(false, 'touch', true, false)).toBe(false); // Alt means nothing to a finger
    expect(paintArmed(true, 'mouse', true, true)).toBe(false); // Decorate, planting and building modes never paint
  });

  it('is off by default and kept in the per-device prefs, not the save', () => {
    expect(DEFAULT_PREFS.paint).toBe(false);
    expect(sanitizePrefs({}).paint).toBe(false);
    expect(sanitizePrefs({ paint: true }).paint).toBe(true);
    expect(sanitizePrefs({ paint: 'yes' }).paint).toBe(false);
  });

  it('a stroke uses the tool once on each plot it crosses, and skips none on a quick drag', () => {
    const grid = { cols: 8, rows: 4 };
    // client px = world px at zoom 1 with the camera at the origin, for this test
    const plotAt = (x: number, y: number): number =>
      plotIndexAt(grid, Math.floor(x / TILE), Math.floor(y / TILE), 0);
    const first = plotAt(6 * TILE + 8, 2 * TILE + 8);
    expect(first).toBe(0);
    const stroke = new PaintStroke(first, 6 * TILE + 8, 2 * TILE + 8);
    const used: number[] = [];
    // one event straight across the row to the last column: every plot in between, once
    stroke.walk(13 * TILE + 8, 2 * TILE + 8, TILE / 2, plotAt, (p) => used.push(p));
    expect(used).toEqual([1, 2, 3, 4, 5, 6, 7]);
    // back over the same plots, then down a row and off the field: only the new plots
    stroke.walk(13 * TILE + 8, 3 * TILE + 8, TILE / 2, plotAt, (p) => used.push(p));
    stroke.walk(20 * TILE, 3 * TILE + 8, TILE / 2, plotAt, (p) => used.push(p));
    expect(used).toEqual([1, 2, 3, 4, 5, 6, 7, 15]);
    expect(stroke.plots).toBe(9);
  });
});

describe('the phone default view (v2-05)', () => {
  it('centres on the plot grid on a narrow phone, and on the home region elsewhere', () => {
    expect(isPhone(phone)).toBe(true);
    const grid = { cols: 4, rows: 2 };
    const field = fieldCentre(grid);
    expect(field).toEqual({ x: 8 * TILE, y: 3 * TILE });
    const cam = defaultCamera(phone, undefined, field);
    // the field's centre is in the middle of the view unless the world's edge stops the camera
    const v = visibleRect(cam, phone);
    expect(field.x).toBeGreaterThanOrEqual(v.x);
    expect(field.x).toBeLessThanOrEqual(v.x + v.w);
    expect(cam.x).toBe(Math.max(v.w / 2, field.x));
    // the whole 4 × 2 field is in view
    expect(v.x).toBeLessThanOrEqual(6 * TILE);
    expect(v.x + v.w).toBeGreaterThanOrEqual(10 * TILE);
    // desktop ignores the focus: the home region's centre, as before
    expect(defaultCamera(desktop, undefined, field)).toEqual(defaultCamera(desktop));
  });

  it('follows the field as it grows (Home goes to the same place)', () => {
    const small = defaultCamera(phone, undefined, fieldCentre({ cols: 4, rows: 2 }));
    const big = defaultCamera(phone, undefined, fieldCentre({ cols: 8, rows: 6 }));
    expect(big.x).toBeGreaterThan(small.x);
    expect(big.zoom).toBe(small.zoom);
    expect(big.x).toBe(fieldCentre({ cols: 8, rows: 6 }).x); // the bigger field's middle, in the middle of the view
  });
});
