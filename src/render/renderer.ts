// Draws the world through the camera (GDD §12.1, ART_STYLE.md §6). Everything is composed in world
// pixels on a world-sized frame canvas, but only the part in view is drawn (ground chunks, objects,
// plots, particles and ambient life are culled), and that part is copied to the visible canvas at the
// camera's integer zoom. The renderer only reads state; clicks go out through the callbacks, and a
// press that moves more than a few pixels is a pan, never a click.

import type { PlacedObject } from '../core/state';
import type { Calendar } from '../core/time';
import type { Offset } from '../systems/placement';
import { Ambient } from './ambient';
import { FarmhandVisual } from './farmhand';
import { ParticleSystem } from './particles';
import type { ExpansionId, ParcelId } from '../data/ids';
import { PALETTE } from './palette';
import {
  buildLayout,
  buildZones,
  forSaleSignAt,
  GREENHOUSE_ROOF_TILE,
  PET_TILE,
  plotIndexAt,
  tileOfPlot,
  TILE,
  tileAt,
  WORLD_H,
  WORLD_W,
  zoneAt,
  type Grid,
  type PlotSprites,
  type SceneLayout,
  type Zone,
} from './scene';
import {
  CHUNK_COLS,
  CHUNK_PX,
  CHUNK_ROWS,
  CHUNK_TILES,
  clampCamera,
  defaultCamera,
  easeToward,
  overlaps,
  panBy,
  PressGesture,
  screenToWorld,
  visibleChunks,
  visibleRect,
  worldToScreen,
  zoomAt,
  type Camera,
  type Rect,
  type Viewport,
} from './camera';
import { anchoredPosition, spriteFrame } from './spriteCache';
import { spriteDef } from './sprites';
import { tintAt } from './tint';

export interface ZoneClick {
  zone: Zone;
  col: number;
  row: number;
}

/** A click on a plot (Shift applies the tool to the whole field). */
export interface PlotPointer {
  plot: number;
  shiftKey: boolean;
}

export interface RendererOptions {
  canvas: HTMLCanvasElement;
  /** The element whose size the scene fills. */
  container: HTMLElement;
  /** Clicks on every zone except the plots. */
  onZoneClick(click: ZoneClick): void;
  onPlotClick(p: PlotPointer): void;
  /** A click on a locked parcel's "For sale" sign. */
  onSignClick(parcel: ParcelId): void;
  /** The camera came to rest somewhere new (null: back at the default view). For prefs. */
  onCameraRest?(cam: Camera | null): void;
}

/** Everything the renderer needs from the game state each frame. */
/** Top-left of the steam sprite above the farmhouse chimney (chimney top at x 59–68, y 16). */
const CHIMNEY_STEAM = { x: 56, y: 0 } as const;

export interface SceneView {
  plots: readonly PlotSprites[];
  greenhouse: readonly PlotSprites[];
  placed: readonly PlacedObject[];
  farmhand: boolean;
  /** Fish traps floating at the water, with whether each one has something to collect. */
  traps: readonly { col: number; row: number; full: boolean }[];
  /** Something is cooking: steam curls from the farmhouse chimney. */
  cooking: boolean;
}

/** The range preview while placing: the offsets around the hovered plot, and whether the spot is valid. */
export interface PlacementPreview {
  offsets: readonly Offset[];
  validAt(col: number, row: number): boolean;
  /** Plot (col, row) of the field → true if it is a plot (for clipping the preview). */
  isPlot(col: number, row: number): boolean;
}

/** A short cosmetic effect: an icon that rises and fades over a plot (render clock only). */
interface Fx {
  sprite: string;
  col: number;
  row: number;
  start: number;
}

const FX_MS = 700;

const byRow = (a: PlacedObject, b: PlacedObject): number => a.at.row - b.at.row;
/** A number that changes when any placed object's row changes (a move within the field). */
function rowsKey(placed: readonly PlacedObject[]): number {
  let k = placed.length;
  for (let i = 0; i < placed.length; i++) k = (k * 31 + placed[i]!.at.row * 7 + placed[i]!.id) | 0;
  return k;
}
const FX_RISE_PX = 10;

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

/** A ground chunk: the cached tiles of one CHUNK_TILES × CHUNK_TILES square, and its winter snow. */
interface Chunk {
  ground: HTMLCanvasElement;
  snow: HTMLCanvasElement;
  key: string;
}

/** Keys that pan the camera, by direction. */
const PAN_KEYS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  a: [-1, 0],
  d: [1, 0],
  w: [0, -1],
  s: [0, 1],
};
/** Held keys pan this many tiles a second (after a first one-tile step). */
const KEY_PAN_TILES_PER_S = 10;
const KEY_HOLD_MS = 220;
const DOUBLE_TAP_MS = 350;
/** Trackpad deltas are summed; this much is one zoom step, and a pause ends the gesture. */
const WHEEL_STEP = 40;
const WHEEL_GESTURE_GAP_MS = 180;
const PINCH_STEP = 1.3;

/** True when a key press belongs to a text field, a panel or a dialog rather than the scene. */
function typingOrInPanel(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('input, textarea, select, [contenteditable="true"]')) return true;
  return !!target.closest('.panel-host, .modal, [role="dialog"]');
}

export class Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  /** The world composed in world pixels; only the part in view is drawn each frame. */
  private readonly frame: HTMLCanvasElement;
  private readonly fctx: CanvasRenderingContext2D;
  private readonly chunks: Chunk[] = [];
  private readonly chunkList: number[] = [];
  /** How many ground chunks the last frame drew (culling check for tests). */
  chunksDrawn = 0;
  /** How many layout objects the last frame drew. */
  objectsDrawn = 0;
  private layout!: SceneLayout;
  private zones: Zone[] = [];
  private grid: Grid = { cols: 0, rows: 0 };
  private sceneKey = '';
  private sceneExpansions = -1;
  private sceneParcels = -1;
  private owned: readonly ParcelId[] = [];
  // Scratch objects reused every frame, so drawing allocates nothing (no garbage-collection stutter).
  private readonly tileScratch = { col: 0, row: 0 };
  private readonly posScratch = { x: 0, y: 0 };
  private readonly ptScratch = { x: 0, y: 0 };
  private readonly placedScratch: PlacedObject[] = [];
  private placedRows = 0;
  private readonly aclock: { hour: number; isNight: boolean; season: Calendar['season'] } = {
    hour: 0,
    isNight: false,
    season: 'spring',
  };
  private hover: { col: number; row: number } | null = null;
  private fx: Fx[] = [];
  private preview: PlacementPreview | null = null;
  private greenhousePlots = 0;
  readonly farmhand = new FarmhandVisual();
  /** Returns true when motion should be reduced (Settings → Motion, or the system preference). */
  reducedMotion: () => boolean = () => false;
  readonly particles = new ParticleSystem(() => this.reducedMotion());
  readonly ambient = new Ambient(() => this.reducedMotion());
  private shakeUntil = 0;
  private steamClock = 0;
  private lastTime = 0;
  private readonly resizeObserver: ResizeObserver;

  // ---- camera
  readonly view: Viewport = { w: 1, h: 1, dpr: 1 };
  /** Where the camera is now, and where it is gliding to. */
  readonly cam: Camera = { x: 0, y: 0, zoom: 1 };
  private readonly target: Camera = { x: 0, y: 0, zoom: 1 };
  /** True while the camera shows (or glides to) the default view; it then follows resizes. */
  private atDefault = true;
  private resting = true;
  private readonly visible: Rect = { x: 0, y: 0, w: 0, h: 0 };

  // ---- input
  private readonly pointers = new Map<number, { x: number; y: number; type: string }>();
  private readonly press = new PressGesture();
  private pressId = -1;
  private lastX = 0;
  private lastY = 0;
  private pinchDist = 0;
  private lastEmptyTap = { t: -1e9, x: 0, y: 0 };
  private wheelSum = 0;
  private wheelStepped = false;
  private wheelLast = 0;
  private readonly keysHeld = new Map<string, number>();

  constructor(private readonly opts: RendererOptions) {
    this.canvas = opts.canvas;
    this.ctx = context2d(this.canvas);
    this.frame = document.createElement('canvas');
    this.frame.width = WORLD_W;
    this.frame.height = WORLD_H;
    this.fctx = context2d(this.frame);
    for (let i = 0; i < CHUNK_COLS * CHUNK_ROWS; i++) {
      const c = i % CHUNK_COLS;
      const r = Math.floor(i / CHUNK_COLS);
      const w = Math.min(CHUNK_PX, WORLD_W - c * CHUNK_PX);
      const h = Math.min(CHUNK_PX, WORLD_H - r * CHUNK_PX);
      const ground = document.createElement('canvas');
      const snow = document.createElement('canvas');
      ground.width = snow.width = w;
      ground.height = snow.height = h;
      this.chunks.push({ ground, snow, key: '' });
    }

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(opts.container);
    this.resize();

    this.canvas.addEventListener('pointerdown', (e) => this.pointerDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.pointerMove(e));
    this.canvas.addEventListener('pointerup', (e) => this.pointerUp(e, true));
    this.canvas.addEventListener('pointercancel', (e) => this.pointerUp(e, false));
    this.canvas.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse' && !this.press.active) this.setHover(null);
    });
    this.canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('keydown', (e) => this.keyDown(e));
    document.addEventListener('keyup', (e) => this.keysHeld.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key));
    window.addEventListener('blur', () => this.keysHeld.clear());
    this.farmhand.onWork = (job) => {
      if (job.sprite) this.fx.push({ sprite: job.sprite, col: job.col, row: job.row, start: this.lastTime });
    };
  }

  // ---- camera control

  /** Starts from a remembered camera (prefs), or the default view when null. */
  restoreCamera(cam: Camera | null): void {
    if (!cam) {
      this.atDefault = true;
      defaultCamera(this.view, this.cam);
    } else {
      this.atDefault = false;
      this.cam.x = cam.x;
      this.cam.y = cam.y;
      this.cam.zoom = cam.zoom;
      clampCamera(this.cam, this.view);
    }
    this.syncTarget();
  }

  private syncTarget(): void {
    this.target.x = this.cam.x;
    this.target.y = this.cam.y;
    this.target.zoom = this.cam.zoom;
  }

  private moved(): void {
    this.atDefault = false;
    this.resting = false;
  }

  /** Glides back to the default view (the Home button and the H key). */
  home(): void {
    defaultCamera(this.view, this.target);
    this.cam.zoom = this.target.zoom;
    clampCamera(this.cam, this.view);
    this.atDefault = true;
    this.resting = false;
  }

  /** Glides so world tile (col, row) is in the middle of the view (a pip, a toast, a new parcel). */
  panToTile(col: number, row: number, instant = false): void {
    this.target.x = (col + 0.5) * TILE;
    this.target.y = (row + 0.5) * TILE;
    this.target.zoom = this.cam.zoom;
    clampCamera(this.target, this.view);
    if (instant) {
      this.cam.x = this.target.x;
      this.cam.y = this.target.y;
    }
    this.moved();
  }

  /** One zoom step in (+1) or out (−1) around a screen point (device px), or the view's centre. */
  zoomStep(step: number, sx = this.view.w / 2, sy = this.view.h / 2): void {
    zoomAt(this.cam, this.view, this.cam.zoom + step, sx, sy);
    this.syncTarget();
    this.moved();
  }

  /** The world rectangle in view (world px). Updated every frame; read it, don't keep it. */
  get viewRect(): Readonly<Rect> {
    return visibleRect(this.cam, this.view, this.visible);
  }

  /** Whether any part of world tile (col, row) is in view. */
  isTileVisible(col: number, row: number): boolean {
    return overlaps(this.viewRect, col * TILE, row * TILE, TILE, TILE);
  }

  /** Centre of tile (col, row) in world pixels. */
  static tileCenterPx(col: number, row: number): { x: number; y: number } {
    return { x: col * TILE + TILE / 2, y: row * TILE + TILE / 2 };
  }

  /** Viewport (client) coordinates of a world pixel. */
  worldToClient(wx: number, wy: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const p = worldToScreen(this.cam, this.view, wx, wy, this.ptScratch);
    const k = rect.width / this.view.w;
    return { x: rect.left + p.x * k, y: rect.top + p.y * k };
  }

  /** Viewport (client) coordinates of the centre of world tile (col, row), for DOM effects. */
  tileClientCenter(col: number, row: number): { x: number; y: number } {
    return this.worldToClient((col + 0.5) * TILE, (row + 0.5) * TILE);
  }

  /** Viewport rectangle covering `cols × rows` tiles from (col, row), for overlays such as the tutorial ring. */
  tileRectClient(col: number, row: number, cols: number, rows: number): DOMRect {
    const a = this.worldToClient(col * TILE, row * TILE);
    const b = this.worldToClient((col + cols) * TILE, (row + rows) * TILE);
    return new DOMRect(a.x, a.y, b.x - a.x, b.y - a.y);
  }

  /** Device pixels per logical pixel. */
  get currentScale(): number {
    return this.cam.zoom;
  }

  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const { clientWidth: w, clientHeight: h } = this.opts.container;
    this.view.w = Math.max(1, Math.round(w * dpr));
    this.view.h = Math.max(1, Math.round(h * dpr));
    this.view.dpr = dpr;
    this.canvas.width = this.view.w;
    this.canvas.height = this.view.h;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.imageSmoothingEnabled = false; // resizing resets context state
    if (this.atDefault) {
      defaultCamera(this.view, this.cam);
      defaultCamera(this.view, this.target);
    } else {
      clampCamera(this.cam, this.view);
      clampCamera(this.target, this.view);
    }
  }

  // ---- input

  /** Client point → canvas device pixel. */
  private toScreen(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const k = rect.width > 0 ? this.view.w / rect.width : 1;
    this.ptScratch.x = (clientX - rect.left) * k;
    this.ptScratch.y = (clientY - rect.top) * k;
    return this.ptScratch;
  }

  /** Client point → world tile, or null outside the world. */
  private tileAtClient(clientX: number, clientY: number): { col: number; row: number } | null {
    const s = this.toScreen(clientX, clientY);
    const w = screenToWorld(this.cam, this.view, s.x, s.y, this.ptScratch);
    return tileAt(w.x, w.y);
  }

  private pointerDown(e: PointerEvent): void {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events (tests) have no active pointer to capture.
    }
    if (this.pointers.size === 1) {
      e.preventDefault();
      this.press.down(e.clientX, e.clientY);
      this.pressId = e.pointerId;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    } else if (this.pointers.size === 2) {
      // A second finger: a pinch (and a two-finger pan), never a click.
      this.press.cancel();
      this.pinchDist = this.pinchSpan();
      this.pinchMid(this.ptScratch);
      this.lastX = this.ptScratch.x;
      this.lastY = this.ptScratch.y;
    }
  }

  private pinchSpan(): number {
    let ax = 0;
    let ay = 0;
    let i = 0;
    let d = 0;
    for (const p of this.pointers.values()) {
      if (i === 0) {
        ax = p.x;
        ay = p.y;
      } else if (i === 1) d = Math.hypot(p.x - ax, p.y - ay);
      i++;
    }
    return d;
  }

  private pinchMid(out: { x: number; y: number }): { x: number; y: number } {
    let x = 0;
    let y = 0;
    let n = 0;
    for (const p of this.pointers.values()) {
      if (n < 2) {
        x += p.x;
        y += p.y;
      }
      n++;
    }
    out.x = x / 2;
    out.y = y / 2;
    return out;
  }

  private pointerMove(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    if (!p) {
      if (e.pointerType === 'mouse') this.setHover(this.tileAtClient(e.clientX, e.clientY));
      return;
    }
    p.x = e.clientX;
    p.y = e.clientY;
    const k = this.view.dpr;
    if (this.pointers.size >= 2) {
      const mid = this.pinchMid({ x: 0, y: 0 });
      panBy(this.cam, this.view, (mid.x - this.lastX) * k, (mid.y - this.lastY) * k);
      this.lastX = mid.x;
      this.lastY = mid.y;
      const d = this.pinchSpan();
      if (this.pinchDist > 0 && (d / this.pinchDist > PINCH_STEP || this.pinchDist / d > PINCH_STEP)) {
        const s = this.toScreen(mid.x, mid.y);
        zoomAt(this.cam, this.view, this.cam.zoom + (d > this.pinchDist ? 1 : -1), s.x, s.y);
        this.pinchDist = d;
      }
      this.syncTarget();
      this.moved();
      return;
    }
    if (e.pointerId !== this.pressId) return;
    if (this.press.move(e.clientX, e.clientY)) {
      panBy(this.cam, this.view, (e.clientX - this.lastX) * k, (e.clientY - this.lastY) * k);
      this.syncTarget();
      this.moved();
      this.setHover(null);
      this.canvas.style.cursor = 'grabbing';
    } else if (e.pointerType === 'mouse') this.setHover(this.tileAtClient(e.clientX, e.clientY));
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  }

  private pointerUp(e: PointerEvent, released: boolean): void {
    if (!this.pointers.delete(e.pointerId)) return;
    if (this.pointers.size === 1) {
      // One finger of a pinch lifted: the other carries on panning from where it is.
      for (const p of this.pointers.values()) {
        this.lastX = p.x;
        this.lastY = p.y;
      }
      return;
    }
    if (this.pointers.size > 0) return;
    const wasPress = e.pointerId === this.pressId;
    this.pressId = -1;
    const click = this.press.up();
    if (e.pointerType === 'mouse') this.setHover(this.tileAtClient(e.clientX, e.clientY));
    if (wasPress && click && released) this.click(e.clientX, e.clientY, e.shiftKey, e.timeStamp);
  }

  /** A press that never became a pan: plots, zones, signs, or (twice on open ground) a zoom in. */
  private click(clientX: number, clientY: number, shiftKey: boolean, time: number): void {
    const t = this.tileAtClient(clientX, clientY);
    if (t) {
      const plot = plotIndexAt(this.grid, t.col, t.row, this.greenhousePlots);
      if (plot >= 0) return this.opts.onPlotClick({ plot, shiftKey });
      const zone = zoneAt(this.zones, t.col, t.row);
      if (zone && zone.id !== 'plots') return this.opts.onZoneClick({ zone, col: t.col, row: t.row });
      const sign = forSaleSignAt(this.owned, t.col, t.row);
      if (sign) return this.opts.onSignClick(sign);
    }
    const last = this.lastEmptyTap;
    if (time - last.t < DOUBLE_TAP_MS && Math.hypot(clientX - last.x, clientY - last.y) < 24) {
      const s = this.toScreen(clientX, clientY);
      this.zoomStep(1, s.x, s.y);
      last.t = -1e9;
      return;
    }
    last.t = time;
    last.x = clientX;
    last.y = clientY;
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    const now = e.timeStamp;
    if (now - this.wheelLast > WHEEL_GESTURE_GAP_MS) {
      this.wheelSum = 0;
      this.wheelStepped = false;
    }
    this.wheelLast = now;
    if (this.wheelStepped) return; // one step per gesture
    this.wheelSum += e.deltaMode === 0 ? e.deltaY : e.deltaY * 40;
    if (Math.abs(this.wheelSum) < WHEEL_STEP) return;
    this.wheelStepped = true;
    const s = this.toScreen(e.clientX, e.clientY);
    this.zoomStep(this.wheelSum < 0 ? 1 : -1, s.x, s.y);
  }

  private keyDown(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey || typingOrInPanel(e.target)) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const dir = PAN_KEYS[key];
    if (dir) {
      e.preventDefault();
      if (!e.repeat && !this.keysHeld.has(key)) {
        this.keysHeld.set(key, performance.now());
        this.target.x = this.cam.x + dir[0] * TILE;
        this.target.y = this.cam.y + dir[1] * TILE;
        this.target.zoom = this.cam.zoom;
        clampCamera(this.target, this.view);
        this.moved();
      }
      return;
    }
    if (key === 'h' || key === 'Home') {
      e.preventDefault();
      this.home();
    } else if (key === '+' || key === '=') {
      e.preventDefault();
      this.zoomStep(1);
    } else if (key === '-' || key === '_') {
      e.preventDefault();
      this.zoomStep(-1);
    }
  }

  /** Held pan keys keep the camera moving smoothly (after their first one-tile step). */
  private keyPan(dtMs: number, nowMs: number): void {
    if (this.keysHeld.size === 0) return;
    let dx = 0;
    let dy = 0;
    for (const [key, since] of this.keysHeld) {
      if (nowMs - since < KEY_HOLD_MS) continue;
      const dir = PAN_KEYS[key];
      if (!dir) continue;
      dx += dir[0];
      dy += dir[1];
    }
    if (dx === 0 && dy === 0) return;
    const step = (KEY_PAN_TILES_PER_S * TILE * dtMs) / 1000;
    this.cam.x += dx * step;
    this.cam.y += dy * step;
    clampCamera(this.cam, this.view);
    this.syncTarget();
    this.moved();
  }

  /** The camera eases toward its target on the render clock (at once under reduced motion). */
  private stepCamera(dtMs: number, nowMs: number): void {
    this.keyPan(dtMs, nowMs);
    const arrived = easeToward(this.cam, this.target, dtMs, this.reducedMotion());
    if (arrived && !this.resting && !this.press.active && this.pointers.size === 0 && this.keysHeld.size === 0) {
      this.resting = true;
      this.opts.onCameraRest?.(this.atDefault ? null : { x: this.cam.x, y: this.cam.y, zoom: this.cam.zoom });
    }
  }

  // ---- scene

  /** Shows `sprite` rising out of plot `index` (e.g. the harvested item). Cosmetic only. */
  addPlotFx(index: number, sprite: string, timeMs: number): void {
    if (index < 0 || (index < 1000 && index >= this.grid.cols * this.grid.rows)) return;
    this.fx.push({ sprite, ...tileOfPlot(this.grid, index), start: timeMs });
  }

  /** The range preview shown around the hovered tile while placing an object (null = none). */
  setPreview(p: PlacementPreview | null): void {
    this.preview = p;
  }

  /** Rebuilds the static layer when the plot grid, the bought expansions or the owned parcels change. */
  setScene(grid: Grid, expansions: readonly ExpansionId[] = [], parcels: readonly ParcelId[] = []): void {
    // Called every frame: compare without building the key string unless something may have changed.
    if (
      grid.cols === this.grid.cols &&
      grid.rows === this.grid.rows &&
      expansions.length === this.sceneExpansions &&
      parcels.length === this.sceneParcels
    )
      return;
    this.sceneExpansions = expansions.length;
    this.sceneParcels = parcels.length;
    const key = `${grid.cols}x${grid.rows}|${expansions.join(',')}|${parcels.join(',')}`;
    if (key === this.sceneKey) return;
    this.sceneKey = key;
    this.grid = { cols: grid.cols, rows: grid.rows };
    this.owned = [...parcels];
    this.layout = buildLayout(this.grid, expansions, parcels);
    this.zones = buildZones(this.grid);
    this.buildChunks();
  }

  /** Redraws the ground chunks whose tiles changed (each chunk caches its ground and winter snow). */
  private buildChunks(): void {
    const ground = this.layout.ground;
    for (let i = 0; i < this.chunks.length; i++) {
      const chunk = this.chunks[i]!;
      const c0 = (i % CHUNK_COLS) * CHUNK_TILES;
      const r0 = Math.floor(i / CHUNK_COLS) * CHUNK_TILES;
      const rows = ground.slice(r0, r0 + CHUNK_TILES).map((line) => line.slice(c0, c0 + CHUNK_TILES));
      const key = rows.map((line) => line.join(',')).join('|');
      if (key === chunk.key) continue;
      chunk.key = key;
      const g = context2d(chunk.ground);
      const sn = context2d(chunk.snow);
      g.clearRect(0, 0, chunk.ground.width, chunk.ground.height);
      sn.clearRect(0, 0, chunk.snow.width, chunk.snow.height);
      rows.forEach((line, row) =>
        line.forEach((sprite, col) => {
          g.drawImage(spriteFrame(sprite), col * TILE, row * TILE);
          // Winter snow covers open grass only: plots, crops and objects are drawn over or away from it.
          if (!sprite.startsWith('tile_grass')) return;
          sn.globalAlpha = 0.62;
          sn.fillStyle = PALETTE.white_warm;
          sn.fillRect(col * TILE, row * TILE, TILE, TILE);
          sn.globalAlpha = 1;
          sn.fillStyle = PALETTE.water_foam;
          for (const [dx, dy] of [
            [3, 4],
            [10, 2],
            [7, 10],
            [13, 13],
            [2, 12],
          ] as const)
            sn.fillRect(col * TILE + dx, row * TILE + dy, 2, 1);
        }),
      );
    }
  }

  /** A gentle 2 px screen shake for `ms` (legendary catches only). Skipped under reduced motion. */
  shake(timeMs: number, ms = 450): void {
    if (this.reducedMotion()) return;
    this.shakeUntil = timeMs + ms;
  }

  render(timeMs: number, calendar: Calendar, view: SceneView): void {
    const f = this.fctx;
    const dtMs = this.lastTime > 0 ? Math.min(250, timeMs - this.lastTime) : 0;
    this.lastTime = timeMs;
    this.stepCamera(dtMs, timeMs);
    const vis = visibleRect(this.cam, this.view, this.visible);
    // The frame region to compose: whole world pixels covering the view, inside the world.
    const x0 = Math.max(0, Math.floor(vis.x));
    const y0 = Math.max(0, Math.floor(vis.y));
    const x1 = Math.min(WORLD_W, Math.ceil(vis.x + vis.w));
    const y1 = Math.min(WORLD_H, Math.ceil(vis.y + vis.h));
    const aclock = this.aclock;
    aclock.hour = calendar.hour;
    aclock.isNight = calendar.isNight;
    aclock.season = calendar.season;
    this.ambient.setBounds(vis.x, vis.y, vis.w, vis.h);
    this.ambient.update(dtMs, aclock);
    this.particles.update(dtMs);
    if (view.cooking && !this.reducedMotion()) {
      this.steamClock += dtMs;
      if (this.steamClock > 380) {
        this.steamClock = 0;
        this.particles.emit('steam', CHIMNEY_STEAM.x + 11, CHIMNEY_STEAM.y + 18);
      }
    }
    this.greenhousePlots = view.greenhouse.length;
    f.globalCompositeOperation = 'source-over';
    f.globalAlpha = 1;
    f.save();
    f.beginPath();
    f.rect(x0, y0, x1 - x0, y1 - y0);
    f.clip();

    // Ground: only the cached chunks in view.
    const winter = calendar.season === 'winter';
    const list = visibleChunks(vis, this.chunkList);
    for (let i = 0; i < list.length; i++) {
      const idx = list[i]!;
      const chunk = this.chunks[idx]!;
      const cx = (idx % CHUNK_COLS) * CHUNK_PX;
      const cy = Math.floor(idx / CHUNK_COLS) * CHUNK_PX;
      f.drawImage(chunk.ground, cx, cy);
      if (winter) f.drawImage(chunk.snow, cx, cy);
    }
    this.chunksDrawn = list.length;
    const { animated, objects } = this.layout;
    for (let i = 0; i < animated.length; i++) {
      const a = animated[i]!;
      if (!overlaps(vis, a.col * TILE, a.row * TILE, TILE, TILE)) continue;
      f.drawImage(spriteFrame(a.sprite, timeMs), a.col * TILE, a.row * TILE);
    }
    this.ambient.drawShadows(f, aclock);
    this.drawPlots(view.plots, timeMs, false);
    if (view.greenhouse.length > 0) {
      f.drawImage(
        spriteFrame('obj_greenhouse_roof'),
        GREENHOUSE_ROOF_TILE.col * TILE,
        GREENHOUSE_ROOF_TILE.row * TILE,
      );
      this.drawPlots(view.greenhouse, timeMs, true);
    }
    let drawn = 0;
    for (let i = 0; i < objects.length; i++) {
      const o = objects[i]!;
      if (!overlaps(vis, o.x, o.y, o.w, o.h)) continue;
      f.drawImage(spriteFrame(o.sprite, timeMs), o.x, o.y);
      drawn++;
    }
    this.objectsDrawn = drawn;
    if (view.cooking) f.drawImage(spriteFrame('fx_steam', timeMs), CHIMNEY_STEAM.x, CHIMNEY_STEAM.y);
    f.drawImage(
      spriteFrame('obj_cat_sleep', this.reducedMotion() ? 0 : timeMs),
      PET_TILE.col * TILE,
      PET_TILE.row * TILE,
    );
    this.drawTraps(view.traps, timeMs);
    this.drawPlaced(view.placed, timeMs);
    this.drawFarmhand(view.farmhand, timeMs);

    this.ambient.drawAir(f, aclock);
    this.particles.draw(f, vis);
    this.drawTint(calendar, x0, y0, x1 - x0, y1 - y0);
    this.ambient.drawGlow(f, timeMs, aclock);
    this.drawFx(timeMs);
    this.drawHover();
    this.drawPreview();
    f.restore();

    // Copy the composed region to the screen at the camera's integer zoom.
    const c = this.ctx;
    const z = this.cam.zoom;
    c.imageSmoothingEnabled = false;
    let ox = 0;
    let oy = 0;
    if (timeMs < this.shakeUntil) {
      ox = Math.round(Math.sin(timeMs / 23) * 2 * z);
      oy = Math.round(Math.cos(timeMs / 31) * 2 * z);
    }
    const dx = Math.round((x0 - vis.x) * z) + ox;
    const dy = Math.round((y0 - vis.y) * z) + oy;
    const dw = (x1 - x0) * z;
    const dh = (y1 - y0) * z;
    if (dx > 0 || dy > 0 || dx + dw < this.view.w || dy + dh < this.view.h) {
      c.fillStyle = PALETTE.grass_dark; // letterbox: the world is smaller than the view
      c.fillRect(0, 0, this.view.w, this.view.h);
    }
    if (x1 > x0 && y1 > y0) c.drawImage(this.frame, x0, y0, x1 - x0, y1 - y0, dx, dy, dw, dh);
  }

  /** Per-plot soil (dry, wet or untilled) and the crop growing on it. */
  private drawPlots(plots: readonly PlotSprites[], timeMs: number, greenhouse: boolean): void {
    const f = this.fctx;
    for (let i = 0; i < plots.length; i++) {
      const p = plots[i]!;
      const { col, row } = tileOfPlot(this.grid, greenhouse ? 1000 + i : i, this.tileScratch);
      f.drawImage(spriteFrame(p.soil), col * TILE, row * TILE);
      if (p.crop) {
        const pos = anchoredPosition(spriteDef(p.crop), col, row, TILE, this.posScratch);
        // A ready crop (stage 4) wobbles when hovered; it also twinkles, so colour is never the only cue.
        const hovered = this.hover?.col === col && this.hover.row === row;
        const wobble = hovered && p.crop.endsWith('_4') && !this.reducedMotion();
        const dx = wobble ? Math.round(Math.sin(timeMs / 55)) : 0;
        // Offset the animation per plot so ready crops don't all twinkle in unison.
        f.drawImage(spriteFrame(p.crop, timeMs + i * 137), pos.x + dx, pos.y);
      }
    }
  }

  /** Sprinklers and scarecrows, bottom rows last so nearer ones overlap farther ones. */
  private drawPlaced(placed: readonly PlacedObject[], timeMs: number): void {
    const f = this.fctx;
    // Re-sorted only when something was placed, moved or picked up.
    const sorted = this.placedScratch;
    let same = sorted.length === placed.length;
    for (let i = 0; same && i < placed.length; i++) same = sorted.includes(placed[i]!);
    if (!same || this.placedRows !== rowsKey(placed)) {
      sorted.length = 0;
      for (let i = 0; i < placed.length; i++) sorted.push(placed[i]!);
      sorted.sort(byRow);
      this.placedRows = rowsKey(placed);
    }
    for (let i = 0; i < sorted.length; i++) {
      const o = sorted[i]!;
      const id =
        o.kind === 'sprinkler'
          ? 'obj_sprinkler'
          : o.kind === 'golden_scarecrow'
            ? 'obj_golden_scarecrow'
            : 'obj_scarecrow';
      const { col, row } = tileOfPlot(this.grid, o.at.row * this.grid.cols + o.at.col, this.tileScratch);
      const pos = anchoredPosition(spriteDef(id), col, row, TILE, this.posScratch);
      // Offset each object's animation so a field of sprinklers doesn't spray in unison.
      f.drawImage(spriteFrame(id, timeMs + o.id * 331), pos.x, pos.y);
    }
  }

  /** Traps bob calmly on the water (offset per trap so they do not ripple in unison). */
  private drawTraps(traps: SceneView['traps'], timeMs: number): void {
    const f = this.fctx;
    for (let i = 0; i < traps.length; i++) {
      const t = traps[i]!;
      const id = t.full ? 'obj_fish_trap_full' : 'obj_fish_trap';
      f.drawImage(spriteFrame(id, timeMs + i * 290), t.col * TILE, t.row * TILE);
    }
  }

  private drawFarmhand(hired: boolean, timeMs: number): void {
    if (!hired) {
      this.farmhand.reset();
      return;
    }
    const fh = this.farmhand;
    fh.update(timeMs);
    const id =
      fh.pose === 'walk'
        ? 'char_farmhand_walk'
        : fh.pose === 'pop'
          ? 'char_farmhand_pop'
          : 'char_farmhand_idle';
    const sprite = spriteFrame(id, timeMs);
    const f = this.fctx;
    const x = Math.round(fh.x - 8);
    const y = Math.round(fh.y) - 15;
    if (fh.facingLeft) {
      f.save();
      f.translate(x + 16, y);
      f.scale(-1, 1);
      f.drawImage(sprite, 0, 0);
      f.restore();
    } else f.drawImage(sprite, x, y);
  }

  private drawPreview(): void {
    const p = this.preview;
    const h = this.hover;
    if (!p || !h) return;
    const f = this.fctx;
    const ok = p.validAt(h.col, h.row);
    f.globalAlpha = 0.35;
    f.fillStyle = ok ? PALETTE.water_3 : PALETTE.red;
    for (const [dc, dr] of p.offsets) {
      const c = h.col + dc;
      const r = h.row + dr;
      if (p.isPlot(c, r)) f.fillRect(c * TILE, r * TILE, TILE, TILE);
    }
    f.globalAlpha = ok ? 0.9 : 0.6;
    f.strokeStyle = ok ? PALETTE.white_warm : PALETTE.red_light;
    f.strokeRect(h.col * TILE + 1.5, h.row * TILE + 1.5, TILE - 3, TILE - 3);
    f.globalAlpha = 1;
  }

  private drawFx(timeMs: number): void {
    const f = this.fctx;
    let kept = 0;
    for (let i = 0; i < this.fx.length; i++)
      if (timeMs - this.fx[i]!.start < FX_MS) this.fx[kept++] = this.fx[i]!;
    this.fx.length = kept;
    for (let i = 0; i < kept; i++) {
      const e = this.fx[i]!;
      const t = Math.max(0, timeMs - e.start) / FX_MS;
      f.globalAlpha = 1 - t * t;
      const img = spriteFrame(e.sprite);
      // Squash and stretch: the popped item squashes flat, springs tall, then settles.
      const k = this.reducedMotion() ? 0 : Math.sin(Math.min(1, t * 2.4) * Math.PI * 2) * (1 - t);
      const w = Math.round(img.width * (1 - 0.3 * k));
      const hgt = Math.round(img.height * (1 + 0.3 * k));
      const baseY = e.row * TILE - Math.round(t * FX_RISE_PX) - 4 + img.height;
      f.drawImage(img, e.col * TILE + Math.round((img.width - w) / 2), baseY - hgt, w, hgt);
    }
    f.globalAlpha = 1;
  }

  /** The day/night tint over the part of the world in view. */
  private drawTint(calendar: Calendar, x: number, y: number, w: number, h: number): void {
    const { night, dusk } = tintAt(calendar.hour, calendar.minute);
    const f = this.fctx;
    if (dusk > 0) {
      f.globalCompositeOperation = 'soft-light';
      f.globalAlpha = dusk;
      f.fillStyle = PALETTE.dusk_tint;
      f.fillRect(x, y, w, h);
    }
    if (night > 0) {
      f.globalCompositeOperation = 'multiply';
      f.globalAlpha = night;
      f.fillStyle = PALETTE.night_tint;
      f.fillRect(x, y, w, h);
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
    if (t && this.hover && t.col === this.hover.col && t.row === this.hover.row) return;
    this.hover = t ? { col: t.col, row: t.row } : null;
    const clickable = t && (zoneAt(this.zones, t.col, t.row) || forSaleSignAt(this.owned, t.col, t.row));
    this.canvas.style.cursor = clickable ? 'pointer' : 'grab';
  }

  destroy(): void {
    this.resizeObserver.disconnect();
  }
}
