import { describe, expect, it } from 'vitest';
import { Game } from '../src/core/game';
import type { GameEvent } from '../src/core/events';
import type { OfflineReport } from '../src/core/offline';
import { createInitialState, emptyPlot } from '../src/core/state';
import { GAME_DATA } from '../src/data';
import { GREENHOUSE_BASE } from '../src/data/balance';
import { FarmhandVisual } from '../src/render/farmhand';
import { GREENHOUSE_LAYOUT, greenhouseTile, plotIndexAt, plotSprites, tileOfPlot } from '../src/render/scene';
import { SPRITES } from '../src/render/sprites';
import { awayRows, awayTotals } from '../src/ui/awaySummary';
import { at, NY, PROGRESSION_EVENTS } from './helpers';

const grid = { cols: 4, rows: 2 };

describe('greenhouse layout', () => {
  it('fits the 4 × 3 block under the roof, and the first six form a 3 × 2 block', () => {
    expect(new Set(GREENHOUSE_LAYOUT.map(([c, r]) => `${c},${r}`)).size).toBe(12);
    for (const [c, r] of GREENHOUSE_LAYOUT.slice(0, 6)) {
      expect(c).toBeLessThan(3);
      expect(r).toBeLessThan(2);
    }
    for (const [c, r] of GREENHOUSE_LAYOUT) {
      expect(c).toBeLessThan(4);
      expect(r).toBeLessThan(3);
    }
    expect(greenhouseTile(0)).toEqual({ col: 15, row: 2 });
  });

  it('hit-tests greenhouse plots by their own indexes and leaves field plots alone', () => {
    expect(plotIndexAt(grid, 15, 2, 6)).toBe(GREENHOUSE_BASE);
    expect(plotIndexAt(grid, 17, 3, 6)).toBe(GREENHOUSE_BASE + 5);
    expect(plotIndexAt(grid, 18, 2, 6)).toBe(-1); // the seventh plot is not built yet
    expect(plotIndexAt(grid, 18, 2, 12)).toBe(GREENHOUSE_BASE + 6);
    expect(plotIndexAt(grid, 6, 2, 12)).toBe(0);
    expect(tileOfPlot(grid, 5)).toEqual({ col: 7, row: 3 });
    expect(tileOfPlot(grid, GREENHOUSE_BASE + 3)).toEqual(greenhouseTile(3));
  });
});

describe('plot sprites', () => {
  it('draw sprinkler-covered soil wet even when the plot has no water of its own', () => {
    const plots = [emptyPlot('tilled'), emptyPlot('tilled')];
    const out = plotSprites(
      plots,
      () => 0,
      (i) => i === 1,
    );
    expect(out.map((p) => p.soil)).toEqual(['tile_soil_dry', 'tile_soil_wet']);
  });
});

describe('the farmhand figure', () => {
  const run = (v: FarmhandVisual, ms: number): void => {
    for (let t = 0; t <= ms; t += 16) v.update(t);
  };

  it('walks to a job, pops, reports the work and walks home', () => {
    const v = new FarmhandVisual();
    const done: unknown[] = [];
    v.onWork = (j) => done.push(j);
    const start = { x: v.x, y: v.y };
    v.enqueue({ col: 8, row: 3, sprite: 'item_turnip' });
    run(v, 300);
    expect(v.pose).toBe('walk');
    expect(v.x).toBeGreaterThan(start.x);
    run(v, 3000);
    expect(done).toEqual([{ col: 8, row: 3, sprite: 'item_turnip' }]);
    run(v, 6000);
    expect(v.pose).toBe('idle');
    expect(Math.abs(v.x - start.x)).toBeLessThan(1);
  });

  it('never grows a backlog: a flood of jobs keeps only the latest few', () => {
    const v = new FarmhandVisual();
    for (let i = 0; i < 500; i++) v.enqueue({ col: 6 + (i % 8), row: 2 + (i % 5), sprite: null });
    expect(v.pending).toBeLessThanOrEqual(6);
  });

  it('ignores a repeat of a plot already queued', () => {
    const v = new FarmhandVisual();
    v.enqueue({ col: 7, row: 2, sprite: null });
    v.enqueue({ col: 7, row: 2, sprite: null });
    expect(v.pending).toBe(1);
  });
});

describe('sprites of phase 04', () => {
  it('include the placed objects, the farmhand and the greenhouse roof', () => {
    for (const id of [
      'obj_sprinkler',
      'obj_scarecrow',
      'char_farmhand_walk',
      'char_farmhand_idle',
      'char_farmhand_pop',
      'obj_greenhouse_roof',
    ]) {
      expect(SPRITES[id], id).toBeDefined();
    }
    expect(SPRITES.char_farmhand_walk!.frames.length).toBeGreaterThanOrEqual(2);
    expect(SPRITES.char_farmhand_walk!.frames.length).toBeLessThanOrEqual(4);
    expect(SPRITES.obj_sprinkler!.frames.length).toBeGreaterThan(2); // idle, then a spray
  });
});

describe('the away summary rows', () => {
  const report = (events: GameEvent[]): OfflineReport => ({
    awayMs: 3 * 3_600_000,
    simulatedMs: 3 * 3_600_000,
    dayStarts: 0,
    seasonChanges: [],
    events,
    showSummary: true,
  });

  it('lists crops harvested, items shipped, gold earned and plots left dry, with icons', () => {
    const events: GameEvent[] = [
      { type: 'harvested', crop: 'turnip', qty: 30, plot: 0, auto: true, shipped: 30 },
      { type: 'harvested', crop: 'potato', qty: 10, plot: 1, auto: true, shipped: 10 },
      { type: 'binCollected', gold: 900, items: 40 },
      { type: 'goldEarned', amount: 900, source: 'sale' },
    ];
    const rows = awayRows(report(events), { readyPlots: 0, dryPlots: 3 });
    expect(rows.map((r) => r.icon)).toEqual(['item_turnip', 'obj_shipping_bin', 'ui_gold', 'tile_soil_dry']);
    expect(rows[0]!.text).toBe('40 crops harvested (30 Turnip and 1 other kind).');
    expect(rows[1]!.text).toBe('40 items shipped.');
    expect(rows[2]!.text).toBe('900g earned.');
    expect(rows[3]!.text).toBe('3 plots are dry and growing slowly.');
    expect(awayTotals(report(events))).toMatchObject({ harvestedTotal: 40, shipped: 40, gold: 900 });
    for (const r of rows) expect(SPRITES[r.icon], r.icon).toBeDefined();
  });

  it('collapses to no rows when nothing happened', () => {
    expect(awayRows(report([]), { readyPlots: 0, dryPlots: 0 })).toEqual([]);
  });
});

describe('actions', () => {
  it('place, pick up and toggle the Auto-Seller through dispatch', () => {
    const start = at(NY, 2026, 1, 7, 10);
    const game = new Game(createInitialState(start, NY, 1), { data: GAME_DATA, lc: NY, now: () => start });
    const events: GameEvent[] = [];
    game.bus.onAny((e) => events.push(e));
    game.state.upgrades.sprinkler = 1;
    expect(game.dispatch({ type: 'place', kind: 'sprinkler', col: 1, row: 0 }).ok).toBe(true);
    expect(game.isPlotWatered(0)).toBe(true);
    expect(game.isPlotWatered(3)).toBe(false);
    expect(game.dispatch({ type: 'pickUp', id: 1 }).ok).toBe(true);
    expect(game.isPlotWatered(0)).toBe(false);
    expect(events.filter((e) => !PROGRESSION_EVENTS.includes(e.type)).map((e) => e.type)).toEqual([
      'placed',
      'pickedUp',
    ]);
    expect(game.dispatch({ type: 'setAutoSell', item: 'turnip', on: false }).ok).toBe(true);
    expect(game.state.autoSell.turnip).toBe(false);
    expect(game.dispatch({ type: 'setAutoSell', item: 'seed_turnip', on: true }).ok).toBe(false);
  });
});
