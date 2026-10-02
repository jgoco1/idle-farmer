// Draws the world through the camera (GDD §12.1, ART_STYLE.md §6). Everything is composed in world
// pixels on a world-sized frame canvas, but only the part in view is drawn (ground chunks, objects,
// plots, particles and ambient life are culled), and that part is copied to the visible canvas at the
// camera's integer zoom. The renderer only reads state; clicks go out through the callbacks, and a
// press that moves more than a few pixels is a pan, never a click.

import type { PlacedDecor, PlacedObject, TreeState } from '../core/state';
import { TREES } from '../data/trees';
import { fruitLevel, TREE_SPRITE_IDS } from './sprites/trees';
import { stageForAge } from '../systems/orchard';
import { DECOR } from '../data/decor';
import { TOWN_PROJECT_IDS, type TownProjectId } from '../data/ids';
import { WORLD_LAYOUT } from '../data/world';
import {
  buildDecorDraws,
  decorKey,
  glowStrength,
  isLitTime,
  SEASON_INDEX,
  townGlows,
  type DecorDraw,
  type GlowPoint,
} from './decorDraw';
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
  DEFAULT_LOOK,
  forSaleSignAt,
  GREENHOUSE_ROOF_TILE,
  PET_TILE,
  plotIndexAt,
  tileOfPlot,
  TILE,
  tileAt,
  townSiteAt,
  townSpritePos,
  WORLD_H,
  WORLD_W,
  zoneAt,
  type Grid,
  type PlotSprites,
  type SceneLayout,
  type SceneLook,
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
import { RanchLife, type RanchView } from './ranchLife';
import { anchoredPosition, spriteFrame, spriteFrameAt, spriteFrameOffset } from './spriteCache';
import { spriteDef } from './sprites';
import { tintAt } from './tint';

/** The tree spots in drawing order (nearer, lower spots on top), as indexes into the layout's spots. */
const SPOT_ORDER: readonly number[] = WORLD_LAYOUT.treeSpots
  .map((s, i) => ({ i, bottom: (s.row + 2) * 16, col: s.col }))
  .sort((a, b) => a.bottom - b.bottom || a.col - b.col)
  .map((s) => s.i);
const TREE_W = 32;
const TREE_H = 48;

/** The tree whose sprite covers tile (col, row): its 2 × 2 spot and the tile of canopy above it. */
function treeAtTileIn(trees: readonly TreeState[], col: number, row: number): TreeState | null {
  for (let i = 0; i < trees.length; i++) {
    const t = trees[i]!;
    const s = WORLD_LAYOUT.treeSpots[t.spot]!;
    if (col >= s.col && col < s.col + 2 && row >= s.row - 1 && row < s.row + 2) return t;
  }
  return null;
}

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
  /** A click on a fruit tree (v2 phase 03). */
  onTreeClick?(id: number): void;
  /** A click on a hen or a cow, with the world point under the pointer (v2 phase 04: petting). */
  onAnimalClick?(id: number): void;
  /** A click on a coop, barn, silo or trough (v2 phase 04). */
  onBuildingClick?(id: number): void;
  /** A click on a town project's site (v2 phase 02). */
  onTownClick?(project: TownProjectId): void;
  /** While Decorate mode is on, every click on the world arrives here instead (v2 phase 02). */
  onDecorClick?(col: number, row: number): void;
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
  /** The decorations standing on the land (v2 phase 02). */
  decor: readonly PlacedDecor[];
  /** The orchard's trees (v2 phase 03); their stage comes from the calendar's day index. */
  trees: readonly TreeState[];
  /** The coop, barn and silo and the animals in the Old Paddock (v2 phase 04). */
  ranch: RanchView;
  /** The cosmetic rewards of finished town projects. */
  cosmetics: { bakerySmoke: boolean; band: boolean; lighthouseBeam: boolean; festival: boolean };
  /** Sprite of the farm cat napping by the door (`CatDef.sprite` of the chosen cat). */
  cat: string;
}

/** The decoration being placed or moved in Decorate mode: its footprint, a ghost sprite and why a tile is refused. */
export interface DecorGhost {
  cols: number;
  rows: number;
  /** Sprite id drawn translucently at the hovered tile (null: just the footprint). */
  sprite: string | null;
  flipped: boolean;
  /** Why the piece cannot stand with its top-left at (col, row), or null when it can. */
  problemAt(col: number, row: number): string | null;
  /** Where the piece lands when the pointer is on (col, row), for things with fixed spots (trees); null = nowhere. */
  snap?(col: number, row: number): { col: number; row: number } | null;
  /** Faint outlines of every place it could go (the free tree spots). */
  markers?: readonly { col: number; row: number; cols: number; rows: number }[];
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
/** The festival lights hang between two poles in the town square (Community Hall reward). */
const FESTIVAL_POLES = [5, 11] as const;
const FESTIVAL_ROW = 18;

const byRow = (a: PlacedObject, b: PlacedObject): number => a.at.row - b.at.row;
/** A number that changes when any placed object's row changes (a move within the field). */
function rowsKey(placed: readonly PlacedObject[]): number {
  let k = placed.length;
  for (let i = 0; i < placed.length; i++) k = (k * 31 + placed[i]!.at.row * 7 + placed[i]!.id) | 0;
  return k;
}
const FX_RISE_PX = 10;
/** The halo of a lit coop or barn window (one object, never rebuilt per frame). */
const WINDOW_GLOW: GlowPoint = { dx: 0, dy: 0, large: false };

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
  /** The planted trees by spot index (rebuilt each frame in place) and the list the last frame drew, for clicks. */
  private readonly spotTree: (TreeState | null)[] = WORLD_LAYOUT.treeSpots.map(() => null);
  private treeList: readonly TreeState[] = [];
  private preview: PlacementPreview | null = null;
  private greenhousePlots = 0;
  private look: SceneLook = DEFAULT_LOOK;
  private readonly lookStages: number[] = TOWN_PROJECT_IDS.map(() => 0);
  private lookFarmhouse = '';
  private decorDraws: DecorDraw[] = [];
  private decorSig = Number.NaN;
  /** Decorate mode (v2): clicks go to `onDecorClick`, and the ghost follows the pointer. */
  decorateMode = false;
  private ghost: DecorGhost | null = null;
  /** How many glowing pieces and lights the last frame lit (for tests). */
  lightsLit = 0;
  private night = 0;
  private dusk = 0;
  private smokeClock = 0;
  private noteClock = 0;
  readonly farmhand = new FarmhandVisual();
  /** Returns true when motion should be reduced (Settings → Motion, or the system preference). */
  reducedMotion: () => boolean = () => false;
  readonly particles = new ParticleSystem(() => this.reducedMotion());
  readonly ambient = new Ambient(() => this.reducedMotion());
  /** The Old Paddock's buildings, troughs and wandering animals (render only; v2 phase 04). */
  readonly ranch = new RanchLife(() => this.reducedMotion());
  private readonly ranchPt = { x: 0, y: 0 };
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
  /** Held pan keys and when each went down (parallel arrays: iterated every frame while a key is held, so no Map iterator). */
  private readonly heldKeys: string[] = [];
  private readonly heldSince: number[] = [];

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
    document.addEventListener('keyup', (e) =>
      this.releaseKey(e.key.length === 1 ? e.key.toLowerCase() : e.key),
    );
    window.addEventListener('blur', () => {
      this.heldKeys.length = 0;
      this.heldSince.length = 0;
    });
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
    if (this.decorateMode) {
      if (t) this.opts.onDecorClick?.(t.col, t.row);
      return;
    }
    if (t) {
      // Animals first (petting), then trees, then buildings (the hit-testing order of DATA_SCHEMAS.md §9.3).
      const s = this.toScreen(clientX, clientY);
      const w = screenToWorld(this.cam, this.view, s.x, s.y, this.ptScratch);
      const animal = this.ranch.animalAt(w.x, w.y);
      if (animal >= 0 && this.opts.onAnimalClick) return this.opts.onAnimalClick(animal);
      const tree = treeAtTileIn(this.treeList, t.col, t.row);
      if (tree && this.opts.onTreeClick) return this.opts.onTreeClick(tree.id);
      const building = this.ranch.buildingAt(t.col, t.row);
      if (building >= 0 && this.opts.onBuildingClick) return this.opts.onBuildingClick(building);
      const plot = plotIndexAt(this.grid, t.col, t.row, this.greenhousePlots);
      if (plot >= 0) return this.opts.onPlotClick({ plot, shiftKey });
      const zone = zoneAt(this.zones, t.col, t.row);
      if (zone && zone.id !== 'plots') return this.opts.onZoneClick({ zone, col: t.col, row: t.row });
      const site = townSiteAt(t.col, t.row);
      if (site && this.opts.onTownClick) return this.opts.onTownClick(site);
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
      if (!e.repeat && !this.heldKeys.includes(key)) {
        this.heldKeys.push(key);
        this.heldSince.push(performance.now());
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
  private releaseKey(key: string): void {
    const i = this.heldKeys.indexOf(key);
    if (i < 0) return;
    this.heldKeys.splice(i, 1);
    this.heldSince.splice(i, 1);
  }

  /** Held pan keys keep the camera moving smoothly (after their first one-tile step). */
  private keyPan(dtMs: number, nowMs: number): void {
    if (this.heldKeys.length === 0) return;
    let dx = 0;
    let dy = 0;
    for (let i = 0; i < this.heldKeys.length; i++) {
      if (nowMs - this.heldSince[i]! < KEY_HOLD_MS) continue;
      const dir = PAN_KEYS[this.heldKeys[i]!];
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
    if (this.resting && this.heldKeys.length === 0) return; // nothing moves: no work, no garbage
    this.keyPan(dtMs, nowMs);
    const arrived = easeToward(this.cam, this.target, dtMs, this.reducedMotion());
    if (
      arrived &&
      !this.resting &&
      !this.press.active &&
      this.pointers.size === 0 &&
      this.heldKeys.length === 0
    ) {
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

  /** Turns Decorate mode on or off; the ghost follows the pointer while it is on. */
  setDecorGhost(g: DecorGhost | null): void {
    this.ghost = g;
  }

  /** Sprite ids of the scene's fixed objects (for e2e: what the town looks like now). */
  layoutSpriteIds(): string[] {
    return this.layout.objects.map((o) => o.sprite);
  }

  /** The tile under the pointer, or null (for tooltips in Decorate mode). */
  get hoverTile(): Readonly<{ col: number; row: number }> | null {
    return this.hover;
  }

  /** Rebuilds the static layer when the plot grid, the bought expansions or the owned parcels change. */
  setScene(
    grid: Grid,
    expansions: readonly ExpansionId[] = [],
    parcels: readonly ParcelId[] = [],
    look: SceneLook = DEFAULT_LOOK,
  ): void {
    // Called every frame: compare without building the key string unless something may have changed.
    let lookSame = look.farmhouse === this.lookFarmhouse;
    for (let i = 0; lookSame && i < TOWN_PROJECT_IDS.length; i++)
      lookSame = (look.stages[TOWN_PROJECT_IDS[i]!] ?? 0) === this.lookStages[i];
    if (
      grid.cols === this.grid.cols &&
      grid.rows === this.grid.rows &&
      expansions.length === this.sceneExpansions &&
      parcels.length === this.sceneParcels &&
      lookSame
    )
      return;
    this.sceneExpansions = expansions.length;
    this.sceneParcels = parcels.length;
    this.lookFarmhouse = look.farmhouse;
    for (let i = 0; i < TOWN_PROJECT_IDS.length; i++)
      this.lookStages[i] = look.stages[TOWN_PROJECT_IDS[i]!] ?? 0;
    this.look = { farmhouse: look.farmhouse, stages: { ...look.stages } };
    const key = `${grid.cols}x${grid.rows}|${expansions.join(',')}|${parcels.join(',')}|${look.farmhouse}|${this.lookStages.join('')}`;
    if (key === this.sceneKey) return;
    this.sceneKey = key;
    this.grid = { cols: grid.cols, rows: grid.rows };
    this.owned = [...parcels];
    this.layout = buildLayout(this.grid, expansions, parcels, this.look);
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
    this.ranch.sync(view.ranch);
    this.ranch.update(dtMs, calendar.isNight);
    this.particles.update(dtMs);
    if (view.cooking && !this.reducedMotion()) {
      this.steamClock += dtMs;
      if (this.steamClock > 380) {
        this.steamClock = 0;
        this.particles.emit(
          'steam',
          CHIMNEY_STEAM.x + 11,
          CHIMNEY_STEAM.y + 18 - (this.lookFarmhouse.endsWith('_loft') ? TILE : 0),
        );
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
    // Objects and decorations, merged by their bottom edge so nearer things overlap farther ones.
    const dk = decorKey(view.decor);
    if (dk !== this.decorSig) {
      this.decorSig = dk;
      this.decorDraws = buildDecorDraws(view.decor, DECOR);
    }
    const decor = this.decorDraws;
    const trees = view.trees;
    this.treeList = trees;
    for (let i = 0; i < this.spotTree.length; i++) this.spotTree[i] = null;
    for (let i = 0; i < trees.length; i++) this.spotTree[trees[i]!.spot] = trees[i]!;
    let ti = 0;
    const season = SEASON_INDEX[calendar.season];
    const lit = isLitTime(calendar.hour, calendar.minute);
    let drawn = 0;
    let di = 0;
    let ri = 0;
    const ranchN = this.ranch.prepare();
    for (let i = 0; i < objects.length; i++) {
      const o = objects[i]!;
      const bottom = o.y + o.h;
      while (ri < ranchN && this.ranch.bottomAt(ri) < bottom * 2)
        this.ranch.draw(f, ri++, timeMs, vis, winter, lit);
      while (di < decor.length && decor[di]!.bottom < bottom)
        this.drawDecor(decor[di++]!, season, winter, lit, vis, timeMs);
      while (ti < SPOT_ORDER.length && (WORLD_LAYOUT.treeSpots[SPOT_ORDER[ti]!]!.row + 2) * TILE < bottom)
        this.drawTree(this.spotTree[SPOT_ORDER[ti++]!], season, calendar.dayIndex, vis);
      if (!overlaps(vis, o.x, o.y, o.w, o.h)) continue;
      f.drawImage(spriteFrame(o.sprite, timeMs), o.x, o.y);
      drawn++;
    }
    while (di < decor.length) this.drawDecor(decor[di++]!, season, winter, lit, vis, timeMs);
    while (ti < SPOT_ORDER.length)
      this.drawTree(this.spotTree[SPOT_ORDER[ti++]!], season, calendar.dayIndex, vis);
    while (ri < ranchN) this.ranch.draw(f, ri++, timeMs, vis, winter, lit);
    this.objectsDrawn = drawn;
    this.drawTownLife(view, calendar, timeMs, vis, dtMs);
    if (view.cooking)
      f.drawImage(
        spriteFrame('fx_steam', timeMs),
        CHIMNEY_STEAM.x,
        CHIMNEY_STEAM.y - (this.lookFarmhouse.endsWith('_loft') ? TILE : 0),
      );
    f.drawImage(
      spriteFrame(view.cat, this.reducedMotion() ? 0 : timeMs),
      PET_TILE.col * TILE,
      PET_TILE.row * TILE,
    );
    this.drawTraps(view.traps, timeMs);
    this.drawPlaced(view.placed, timeMs);
    this.drawFarmhand(view.farmhand, timeMs);

    this.ambient.drawAir(f, aclock);
    this.particles.draw(f, vis);
    this.drawTint(calendar, x0, y0, x1 - x0, y1 - y0);
    this.drawLights(view, vis, lit, timeMs);
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

  /** One fruit tree: its stage's sprite (a mature one in the season's look) with the fruit hanging on it. */
  private drawTree(t: TreeState | null | undefined, season: number, dayIndex: number, vis: Rect): void {
    if (!t) return;
    const spot = WORLD_LAYOUT.treeSpots[t.spot]!;
    const x = spot.col * TILE;
    const y = (spot.row + 2) * TILE - TREE_H;
    if (!overlaps(vis, x, y, TREE_W, TREE_H)) return;
    const def = TREES[t.tree];
    const ids = TREE_SPRITE_IDS[def.fruit];
    const stage = stageForAge(def, dayIndex - t.plantedDay);
    const f = this.fctx;
    if (stage === 'sapling') return void f.drawImage(spriteFrame(ids.sapling), x, y);
    if (stage === 'young') return void f.drawImage(spriteFrame(ids.young), x, y);
    f.drawImage(spriteFrameAt(ids.mature[season]!, 0), x, y);
    if (t.fruit > 0) f.drawImage(spriteFrame(ids.fruit[fruitLevel(t.fruit, def.fruitCap)]), x, y);
  }

  /** Shows `sprite` rising out of a tile (the picked fruit). Cosmetic only. */
  addTileFx(col: number, row: number, sprite: string, timeMs: number): void {
    this.fx.push({ sprite, col, row, start: timeMs });
  }

  /** One decoration: its season's sprite (lit frame at night, snow-dusted in winter), mirrored if flipped, and a windmill's sails. */
  private drawDecor(
    d: DecorDraw,
    season: number,
    winter: boolean,
    lit: boolean,
    vis: Rect,
    timeMs: number,
  ): void {
    if (!overlaps(vis, d.x, d.y - 4, d.w, d.h + 4)) return;
    const f = this.fctx;
    const img = spriteFrameAt(d.sprites[season]!, d.glows && lit ? 1 : 0, winter);
    if (d.flipped) {
      f.save();
      f.translate(d.x + d.w, d.y);
      f.scale(-1, 1);
      f.drawImage(img, 0, 0);
      f.restore();
    } else f.drawImage(img, d.x, d.y);
    if (d.windmill)
      f.drawImage(spriteFrame('decor_windmill_sails', this.reducedMotion() ? 0 : timeMs), d.x, d.y - 1);
  }

  /** The finished projects' touches: the bakery's morning smoke, the Saturday band and the festival lights (day side). */
  private drawTownLife(view: SceneView, calendar: Calendar, timeMs: number, vis: Rect, dtMs: number): void {
    const f = this.fctx;
    const c = view.cosmetics;
    if (c.festival) {
      for (const col of FESTIVAL_POLES) {
        const pos = anchoredPosition(spriteDef('obj_lights_pole'), col, FESTIVAL_ROW, TILE, this.posScratch);
        if (overlaps(vis, pos.x, pos.y, 16, 32)) f.drawImage(spriteFrame('obj_lights_pole'), pos.x, pos.y);
      }
      for (let col = FESTIVAL_POLES[0] + 1; col < FESTIVAL_POLES[1]; col++) {
        const y = (FESTIVAL_ROW + 1) * TILE - 32;
        if (overlaps(vis, col * TILE, y, TILE, TILE))
          f.drawImage(spriteFrame('obj_lights_string'), col * TILE, y);
      }
    }
    const reduced = this.reducedMotion();
    if (c.band && calendar.weekday === 6 && calendar.hour >= 17 && calendar.hour < 22) {
      const at = townSpritePos('bandstand', 48);
      const bx = at.x + 8;
      const by = at.y + 17;
      if (overlaps(vis, bx, by, 32, 16)) {
        f.drawImage(spriteFrame('fx_band', reduced ? 0 : timeMs), bx, by);
        this.noteClock += dtMs;
        if (this.noteClock > 700) {
          this.noteClock = 0;
          this.particles.emit('note', bx + 6 + ((timeMs / 700) % 4) * 7, by + 2);
        }
      }
    }
    if (c.bakerySmoke && calendar.hour >= 6 && calendar.hour < 11 && !reduced) {
      const at = townSpritePos('bakery', 64);
      if (overlaps(vis, at.x, at.y, 48, 64)) {
        this.smokeClock += dtMs;
        if (this.smokeClock > 450) {
          this.smokeClock = 0;
          this.particles.emit('steam', at.x + 34, at.y + 8);
        }
      }
    }
  }

  /** Warm halos over everything lit, after the night tint (ART_STYLE.md §6.5); a steady glow under reduced motion. */
  private drawLights(view: SceneView, vis: Rect, litTime: boolean, timeMs: number): void {
    this.lightsLit = 0;
    const strength = glowStrength(this.night, this.dusk);
    if (strength <= 0) return;
    const f = this.fctx;
    const flicker = this.reducedMotion() ? 1 : 0.94 + 0.06 * Math.sin(timeMs / 280);
    f.globalCompositeOperation = 'lighter';
    f.globalAlpha = strength * 0.8 * flicker;
    const decor = this.decorDraws;
    if (litTime) {
      for (let i = 0; i < decor.length; i++) {
        const d = decor[i]!;
        if (!d.glows || !overlaps(vis, d.x - 16, d.y - 16, d.w + 32, d.h + 32)) continue;
        for (let k = 0; k < d.glowPoints.length; k++) this.halo(d.x, d.y, d.glowPoints[k]!);
      }
    }
    if (litTime) {
      // Lit windows of the coop and barn: a smaller, fainter halo than a lamp's.
      f.globalAlpha = strength * 0.5 * flicker;
      for (let i = 0; i < this.ranch.buildingCount; i++) {
        if (!this.ranch.windowOf(i, this.ranchPt)) continue;
        if (!overlaps(vis, this.ranchPt.x - 16, this.ranchPt.y - 16, 32, 32)) continue;
        this.halo(this.ranchPt.x, this.ranchPt.y, WINDOW_GLOW);
      }
      f.globalAlpha = strength * 0.8 * flicker;
    }
    for (let i = 0; i < TOWN_PROJECT_IDS.length; i++) {
      const id = TOWN_PROJECT_IDS[i]!;
      const pts = townGlows(id, this.lookStages[i]!);
      if (pts.length === 0) continue;
      const rows = id === 'old_bridge' ? 2 : id === 'community_hall' ? 4 : id === 'bandstand' ? 3 : 4;
      const at = townSpritePos(id, rows * TILE);
      if (!overlaps(vis, at.x - 16, at.y - 16, 96, 96)) continue;
      for (let k = 0; k < pts.length; k++) this.halo(at.x, at.y, pts[k]!);
    }
    if (view.cosmetics.festival) {
      for (let col = FESTIVAL_POLES[0] + 1; col < FESTIVAL_POLES[1]; col++) {
        const x = col * TILE;
        const y = (FESTIVAL_ROW + 1) * TILE - 32;
        if (overlaps(vis, x - 8, y - 8, 32, 32)) this.halo(x, y, { dx: 8, dy: 6, large: false });
      }
    }
    const lighthouse = this.lookStages[TOWN_PROJECT_IDS.indexOf('lighthouse')]!;
    if (view.cosmetics.lighthouseBeam && lighthouse >= 3 && this.night > 0.02)
      this.drawBeam(timeMs, strength);
    f.globalAlpha = 1;
    f.globalCompositeOperation = 'source-over';
  }

  private halo(x: number, y: number, p: GlowPoint): void {
    const img = spriteFrame(p.large ? 'fx_glow_large' : 'fx_glow_small');
    this.fctx.drawImage(img, Math.round(x + p.dx - img.width / 2), Math.round(y + p.dy - img.height / 2));
    this.lightsLit++;
  }

  /** The lighthouse beam: a thin wedge turning once every 8 s, clipped to the sea; still, pointing out to sea, under reduced motion. */
  private drawBeam(timeMs: number, strength: number): void {
    const f = this.fctx;
    const at = townSpritePos('lighthouse', 64);
    const cx = at.x + 16;
    const cy = at.y + 7;
    const angle = this.reducedMotion() ? 0 : (timeMs / 8000) * Math.PI * 2;
    f.save();
    f.beginPath();
    for (const r of WORLD_LAYOUT.sea) f.rect(r.col * TILE, r.row * TILE, r.cols * TILE, r.rows * TILE);
    f.clip();
    f.globalAlpha = strength * 0.28;
    f.fillStyle = PALETTE.lamp_glow;
    f.beginPath();
    f.moveTo(cx, cy);
    f.lineTo(cx + Math.cos(angle - 0.09) * 150, cy + Math.sin(angle - 0.09) * 150);
    f.lineTo(cx + Math.cos(angle + 0.09) * 150, cy + Math.sin(angle + 0.09) * 150);
    f.closePath();
    f.fill();
    f.restore();
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
        f.drawImage(spriteFrameOffset(p.crop, timeMs, i * 137), pos.x + dx, pos.y);
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

  /** The piece being placed: its footprint (green if it can stand there, red if not) and a translucent ghost. */
  private drawGhost(): void {
    const g = this.ghost;
    const h = this.hover;
    if (!g || !h) return;
    const f = this.fctx;
    if (g.markers) {
      f.globalAlpha = 0.5;
      f.strokeStyle = PALETTE.white_warm;
      for (let i = 0; i < g.markers.length; i++) {
        const m = g.markers[i]!;
        f.strokeRect(m.col * TILE + 0.5, m.row * TILE + 0.5, m.cols * TILE - 1, m.rows * TILE - 1);
      }
    }
    const at = g.snap ? g.snap(h.col, h.row) : h;
    if (!at) return void (f.globalAlpha = 1);
    const ok = g.problemAt(at.col, at.row) === null;
    f.globalAlpha = 0.35;
    f.fillStyle = ok ? PALETTE.grass_3 : PALETTE.red;
    f.fillRect(at.col * TILE, at.row * TILE, g.cols * TILE, g.rows * TILE);
    f.globalAlpha = 0.9;
    f.strokeStyle = ok ? PALETTE.white_warm : PALETTE.red_light;
    f.strokeRect(at.col * TILE + 0.5, at.row * TILE + 0.5, g.cols * TILE - 1, g.rows * TILE - 1);
    if (g.sprite) {
      const img = spriteFrame(g.sprite);
      const x = at.col * TILE + Math.round((g.cols * TILE - img.width) / 2);
      const y = (at.row + g.rows) * TILE - img.height;
      f.globalAlpha = ok ? 0.7 : 0.4;
      if (g.flipped) {
        f.save();
        f.translate(x + img.width, y);
        f.scale(-1, 1);
        f.drawImage(img, 0, 0);
        f.restore();
      } else f.drawImage(img, x, y);
    }
    f.globalAlpha = 1;
  }

  private drawPreview(): void {
    this.drawGhost();
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
    this.night = night;
    this.dusk = dusk;
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
    const clickable =
      t &&
      (zoneAt(this.zones, t.col, t.row) ||
        forSaleSignAt(this.owned, t.col, t.row) ||
        treeAtTileIn(this.treeList, t.col, t.row));
    this.canvas.style.cursor = clickable ? 'pointer' : 'grab';
  }

  destroy(): void {
    this.resizeObserver.disconnect();
  }
}
