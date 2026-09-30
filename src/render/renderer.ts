// Draws the farm scene. Everything is composed at the logical 320 × 192 size on a small frame
// canvas, then copied to the visible canvas at the largest integer scale that fits
// (ART_STYLE.md §3). The renderer only reads state; clicks go out through `onZoneClick`.

import type { Calendar } from '../core/time';
import type { ExpansionId } from '../data/ids';
import { PALETTE } from './palette';
import {
  buildLayout,
  buildZones,
  plotIndexAt,
  plotTile,
  SCENE_H,
  SCENE_W,
  TILE,
  tileAt,
  zoneAt,
  type Grid,
  type PlotSprites,
  type SceneLayout,
  type Zone,
} from './scene';
import { anchoredPosition, spriteFrame } from './spriteCache';
import { spriteDef } from './sprites';
import { tintAt } from './tint';

export interface ZoneClick {
  zone: Zone;
  col: number;
  row: number;
}

/** Pointer input on the plot grid: a press starts a stroke, dragging enters more plots. */
export interface PlotPointer {
  plot: number;
  shiftKey: boolean;
}

export interface RendererOptions {
  canvas: HTMLCanvasElement;
  /** The element whose size the scene fits into. */
  container: HTMLElement;
  /** Clicks on every zone except the plots, which use the stroke callbacks below. */
  onZoneClick(click: ZoneClick): void;
  onPlotDown(p: PlotPointer): void;
  onPlotEnter(p: PlotPointer): void;
  onStrokeEnd(): void;
}

/** A short cosmetic effect: an icon that rises and fades over a plot (render clock only). */
interface Fx {
  sprite: string;
  col: number;
  row: number;
  start: number;
}

const FX_MS = 700;
const FX_RISE_PX = 10;

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

/** Largest integer scale (in device pixels) at which the scene fits the available area. */
export function integerScale(availW: number, availH: number, dpr: number): number {
  return Math.max(1, Math.floor(Math.min((availW * dpr) / SCENE_W, (availH * dpr) / SCENE_H)));
}

export class Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly frame: HTMLCanvasElement;
  private readonly fctx: CanvasRenderingContext2D;
  private readonly ground: HTMLCanvasElement;
  private layout!: SceneLayout;
  private zones: Zone[] = [];
  private grid: Grid = { cols: 0, rows: 0 };
  private sceneKey = '';
  private hover: { col: number; row: number } | null = null;
  private stroke: { pointerId: number; lastPlot: number } | null = null;
  private fx: Fx[] = [];
  private scale = 1;
  private readonly resizeObserver: ResizeObserver;

  constructor(private readonly opts: RendererOptions) {
    this.canvas = opts.canvas;
    this.ctx = context2d(this.canvas);
    this.frame = document.createElement('canvas');
    this.frame.width = SCENE_W;
    this.frame.height = SCENE_H;
    this.fctx = context2d(this.frame);
    this.ground = document.createElement('canvas');
    this.ground.width = SCENE_W;
    this.ground.height = SCENE_H;

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(opts.container);
    this.resize();

    this.canvas.addEventListener('pointerdown', (e) => this.pointerDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.pointerMove(e));
    this.canvas.addEventListener('pointerup', (e) => this.endStroke(e));
    this.canvas.addEventListener('pointercancel', (e) => this.endStroke(e));
    this.canvas.addEventListener('pointerleave', () => this.setHover(null));
    this.canvas.addEventListener('click', (e) => {
      const t = this.toTile(e);
      if (!t) return;
      const zone = zoneAt(this.zones, t.col, t.row);
      if (zone && zone.id !== 'plots') opts.onZoneClick({ zone, col: t.col, row: t.row });
    });
  }

  private plotAt(e: MouseEvent): number {
    const t = this.toTile(e);
    return t ? plotIndexAt(this.grid, t.col, t.row) : -1;
  }

  private pointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    const plot = this.plotAt(e);
    if (plot < 0) return;
    e.preventDefault();
    this.stroke = { pointerId: e.pointerId, lastPlot: plot };
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events (tests) have no active pointer to capture.
    }
    this.opts.onPlotDown({ plot, shiftKey: e.shiftKey });
  }

  private pointerMove(e: PointerEvent): void {
    this.setHover(this.toTile(e));
    if (!this.stroke || e.pointerId !== this.stroke.pointerId) return;
    const plot = this.plotAt(e);
    if (plot < 0 || plot === this.stroke.lastPlot) return;
    this.stroke.lastPlot = plot;
    this.opts.onPlotEnter({ plot, shiftKey: e.shiftKey });
  }

  private endStroke(e: PointerEvent): void {
    if (!this.stroke || e.pointerId !== this.stroke.pointerId) return;
    this.stroke = null;
    this.opts.onStrokeEnd();
  }

  /** Shows `sprite` rising out of plot `index` (e.g. the harvested item). Cosmetic only. */
  addPlotFx(index: number, sprite: string, timeMs: number): void {
    if (index < 0 || index >= this.grid.cols * this.grid.rows) return;
    this.fx.push({ sprite, ...plotTile(this.grid, index), start: timeMs });
  }

  /** Rebuilds the static layer when the plot grid or the bought expansions change. */
  setScene(grid: Grid, expansions: readonly ExpansionId[] = []): void {
    const key = `${grid.cols}x${grid.rows}|${expansions.join(',')}`;
    if (key === this.sceneKey) return;
    this.sceneKey = key;
    this.grid = { cols: grid.cols, rows: grid.rows };
    this.layout = buildLayout(this.grid, expansions);
    this.zones = buildZones(this.grid);
    const g = context2d(this.ground);
    g.clearRect(0, 0, SCENE_W, SCENE_H);
    this.layout.ground.forEach((line, row) =>
      line.forEach((sprite, col) => g.drawImage(spriteFrame(sprite), col * TILE, row * TILE)),
    );
  }

  /** Viewport (client) coordinates of the centre of scene tile (col, row), for DOM effects. */
  tileClientCenter(col: number, row: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: rect.left + ((col + 0.5) * TILE * rect.width) / SCENE_W,
      y: rect.top + ((row + 0.5) * TILE * rect.height) / SCENE_H,
    };
  }

  get currentScale(): number {
    return this.scale;
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const { clientWidth: w, clientHeight: h } = this.opts.container;
    this.scale = integerScale(w, h, dpr);
    this.canvas.width = SCENE_W * this.scale;
    this.canvas.height = SCENE_H * this.scale;
    this.canvas.style.width = `${(SCENE_W * this.scale) / dpr}px`;
    this.canvas.style.height = `${(SCENE_H * this.scale) / dpr}px`;
    this.ctx.imageSmoothingEnabled = false; // resizing resets context state
  }

  render(timeMs: number, calendar: Calendar, plots: readonly PlotSprites[]): void {
    const f = this.fctx;
    f.globalCompositeOperation = 'source-over';
    f.globalAlpha = 1;
    f.drawImage(this.ground, 0, 0);
    for (const a of this.layout.animated)
      f.drawImage(spriteFrame(a.sprite, timeMs), a.col * TILE, a.row * TILE);
    this.drawPlots(plots, timeMs);
    for (const o of this.layout.objects) f.drawImage(spriteFrame(o.sprite, timeMs), o.x, o.y);

    this.drawTint(calendar);
    this.drawFx(timeMs);
    this.drawHover();

    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(this.frame, 0, 0, this.canvas.width, this.canvas.height);
  }

  /** Per-plot soil (dry, wet or untilled) and the crop growing on it. */
  private drawPlots(plots: readonly PlotSprites[], timeMs: number): void {
    const f = this.fctx;
    plots.forEach((p, i) => {
      const { col, row } = plotTile(this.grid, i);
      f.drawImage(spriteFrame(p.soil), col * TILE, row * TILE);
      if (p.crop) {
        const pos = anchoredPosition(spriteDef(p.crop), col, row, TILE);
        // Offset the animation per plot so ready crops don't all twinkle in unison.
        f.drawImage(spriteFrame(p.crop, timeMs + i * 137), pos.x, pos.y);
      }
    });
  }

  private drawFx(timeMs: number): void {
    const f = this.fctx;
    this.fx = this.fx.filter((e) => timeMs - e.start < FX_MS);
    for (const e of this.fx) {
      const t = Math.max(0, timeMs - e.start) / FX_MS;
      f.globalAlpha = 1 - t * t;
      f.drawImage(spriteFrame(e.sprite), e.col * TILE, e.row * TILE - Math.round(t * FX_RISE_PX) - 4);
    }
    f.globalAlpha = 1;
  }

  private drawTint(calendar: Calendar): void {
    const { night, dusk } = tintAt(calendar.hour, calendar.minute);
    const f = this.fctx;
    if (dusk > 0) {
      f.globalCompositeOperation = 'soft-light';
      f.globalAlpha = dusk;
      f.fillStyle = PALETTE.dusk_tint;
      f.fillRect(0, 0, SCENE_W, SCENE_H);
    }
    if (night > 0) {
      f.globalCompositeOperation = 'multiply';
      f.globalAlpha = night;
      f.fillStyle = PALETTE.night_tint;
      f.fillRect(0, 0, SCENE_W, SCENE_H);
    }
    f.globalCompositeOperation = 'source-over';
    f.globalAlpha = 1;
  }

  private drawHover(): void {
    if (!this.hover) return;
    const f = this.fctx;
    const zone = zoneAt(this.zones, this.hover.col, this.hover.row);
    if (zone && zone.id !== 'plots') {
      const r = zone.rect;
      f.globalAlpha = 0.35;
      f.strokeStyle = PALETTE.white_warm;
      f.lineWidth = 1;
      f.strokeRect(r.col * TILE + 0.5, r.row * TILE + 0.5, r.cols * TILE - 1, r.rows * TILE - 1);
    }
    f.globalAlpha = zone ? 0.9 : 0.45;
    f.strokeStyle = PALETTE.white_warm;
    f.lineWidth = 1;
    f.strokeRect(this.hover.col * TILE + 0.5, this.hover.row * TILE + 0.5, TILE - 1, TILE - 1);
    f.globalAlpha = 1;
  }

  private setHover(t: { col: number; row: number } | null): void {
    this.hover = t;
    this.canvas.style.cursor = t && zoneAt(this.zones, t.col, t.row) ? 'pointer' : 'default';
  }

  /** Pointer position → tile, using the canvas' on-screen size (works at any scale). */
  private toTile(e: MouseEvent): { col: number; row: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const x = ((e.clientX - rect.left) * SCENE_W) / rect.width;
    const y = ((e.clientY - rect.top) * SCENE_H) / rect.height;
    return tileAt(x, y);
  }

  destroy(): void {
    this.resizeObserver.disconnect();
  }
}
