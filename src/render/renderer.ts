// Draws the farm scene. Everything is composed at the logical 320 × 192 size on a small frame
// canvas, then copied to the visible canvas at the largest integer scale that fits
// (ART_STYLE.md §3). The renderer only reads state; clicks go out through `onZoneClick`.

import type { Calendar } from '../core/time';
import { PALETTE } from './palette';
import {
  buildLayout,
  buildZones,
  SCENE_H,
  SCENE_W,
  TILE,
  tileAt,
  zoneAt,
  type Grid,
  type SceneLayout,
  type Zone,
} from './scene';
import { spriteFrame } from './spriteCache';
import { tintAt } from './tint';

export interface ZoneClick {
  zone: Zone;
  col: number;
  row: number;
}

export interface RendererOptions {
  canvas: HTMLCanvasElement;
  /** The element whose size the scene fits into. */
  container: HTMLElement;
  onZoneClick(click: ZoneClick): void;
}

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
  private hover: { col: number; row: number } | null = null;
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

    this.canvas.addEventListener('pointermove', (e) => this.setHover(this.toTile(e)));
    this.canvas.addEventListener('pointerleave', () => this.setHover(null));
    this.canvas.addEventListener('click', (e) => {
      const t = this.toTile(e);
      if (!t) return;
      const zone = zoneAt(this.zones, t.col, t.row);
      if (zone) opts.onZoneClick({ zone, col: t.col, row: t.row });
    });
  }

  /** Rebuilds the static layer when the plot grid changes (expansions, from phase 03). */
  setGrid(grid: Grid): void {
    if (grid.cols === this.grid.cols && grid.rows === this.grid.rows) return;
    this.grid = { cols: grid.cols, rows: grid.rows };
    this.layout = buildLayout(this.grid);
    this.zones = buildZones(this.grid);
    const g = context2d(this.ground);
    g.clearRect(0, 0, SCENE_W, SCENE_H);
    this.layout.ground.forEach((line, row) =>
      line.forEach((sprite, col) => g.drawImage(spriteFrame(sprite), col * TILE, row * TILE)),
    );
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

  render(timeMs: number, calendar: Calendar): void {
    const f = this.fctx;
    f.globalCompositeOperation = 'source-over';
    f.globalAlpha = 1;
    f.drawImage(this.ground, 0, 0);
    for (const a of this.layout.animated)
      f.drawImage(spriteFrame(a.sprite, timeMs), a.col * TILE, a.row * TILE);
    // phase 02: draw crops on plots here, between the ground and the objects.
    for (const o of this.layout.objects) f.drawImage(spriteFrame(o.sprite, timeMs), o.x, o.y);

    this.drawTint(calendar);
    this.drawHover();

    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(this.frame, 0, 0, this.canvas.width, this.canvas.height);
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
