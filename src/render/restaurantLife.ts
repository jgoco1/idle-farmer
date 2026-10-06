// Life at The Bramble Table (GDD §13.4, ART_STYLE.md §7.3): the inn, its terrace tables and the diners who
// come and go. Everything here is **render only**: it reads the level and the menu it is handed, owns a
// private generator (never `rngState`), changes no game state and sends nothing back. By day a diner walks
// up the north road to each table that has something on the menu, sits and eats, and leaves when the table
// serves (`served`), and the next one comes along; at night everyone dines inside by lamplight, so the
// terrace is empty and the windows glow. Under reduced motion diners simply sit at their tables. Numbers
// live in typed arrays, the draw order is an insertion sort into preallocated arrays, and nothing is
// allocated per frame.

import { WORLD_LAYOUT } from '../data/world';
import { overlaps, type Rect } from './camera';
import { PALETTE } from './palette';
import { spriteFrame, spriteFrameAt, spriteFrameOffset } from './spriteCache';
import {
  DINER_SPRITE_IDS,
  RESTAURANT_CHIMNEY,
  RESTAURANT_LANTERN,
  RESTAURANT_WINDOWS,
} from './sprites/restaurant';

const TILE = 16;
/** What `bottomAt` returns past the last item. */
export const NO_MORE = 0x7fffffff;
/** Tables on the terrace: the site's width (four from the levels, a fifth from the Press House bundle). */
export const MAX_TABLES = 5;

const SITE = WORLD_LAYOUT.restaurantSite;
/** The inn's sprite: 80 × 64, its bottom on the footprint's bottom edge (the terrace row is the site's last). */
const INN_W = 80;
const INN_H = 64;
const INN_X = SITE.col * TILE + ((SITE.cols * TILE - INN_W) >> 1);
const TERRACE_ROW = SITE.row + SITE.rows - 1;
const INN_BOTTOM = TERRACE_ROW * TILE;
const INN_Y = INN_BOTTOM - INN_H;
/** Where diners come from and go to: the north road just below the site, on the lane. */
const ROAD_X = WORLD_LAYOUT.northRoadCol * TILE + 8;
const LANE_Y = (TERRACE_ROW + 1) * TILE + 12;
const EXIT_Y = LANE_Y + 2 * TILE;
const SPEED = 18; // px / s

// Per-diner numbers (Float64Array stride); diner i belongs to table i.
const D_X = 0;
const D_Y = 1;
const D_TIMER = 2; // ms until something happens (an arrival, a glance)
const D_PHASE = 3; // animation offset, ms
const D_LEG = 4; // 0 on the lane, 1 up to (or down from) the table
const D_STRIDE = 5;

const S_NONE = 0;
const S_ARRIVE = 1;
const S_SEATED = 2;
const S_LEAVE = 3;

/** What the renderer is handed each frame (read only). */
export interface RestaurantView {
  level: number; // 0 = not built
  tables: number; // menu slots
  /** 1 while a table has something to serve (parallel to the menu, `tables` long). */
  serving: Uint8Array;
}

export class RestaurantLife {
  private seed = 0x1b873593;
  private readonly d = new Float64Array(MAX_TABLES * D_STRIDE);
  private readonly state = new Int8Array(MAX_TABLES);
  private readonly look = new Int8Array(MAX_TABLES);
  private level = 0;
  private tables = 0;
  private readonly serving = new Uint8Array(MAX_TABLES);
  private night = false;
  private readonly order = new Int32Array(2 + 2 * MAX_TABLES);
  private readonly keys = new Int32Array(2 + 2 * MAX_TABLES);
  private n = 0;

  constructor(private readonly reduced: () => boolean = () => false) {}

  private rand(): number {
    this.seed = (this.seed + 0x6d2b79f5) | 0;
    let t = this.seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  private seatX(i: number): number {
    return (SITE.col + i) * TILE + 13;
  }

  private static readonly SEAT_Y = TERRACE_ROW * TILE + 13;

  sync(view: RestaurantView): void {
    this.level = view.level;
    this.tables = Math.min(MAX_TABLES, view.tables);
    for (let i = 0; i < MAX_TABLES; i++) this.serving[i] = i < this.tables ? (view.serving[i] ?? 0) : 0;
  }

  /** A table served a dish: its diner finishes and leaves, and the next one comes along (cosmetic). */
  served(slot: number): void {
    if (slot < 0 || slot >= MAX_TABLES || this.reduced()) return;
    if (this.state[slot] === S_SEATED) this.leave(slot);
  }

  private leave(i: number): void {
    this.state[i] = S_LEAVE;
    this.d[i * D_STRIDE + D_LEG] = 1;
  }

  private place(i: number, seated: boolean): void {
    const o = i * D_STRIDE;
    this.look[i] = Math.floor(this.rand() * DINER_SPRITE_IDS.length);
    this.d[o + D_PHASE] = Math.floor(this.rand() * 800);
    if (seated) {
      this.d[o + D_X] = this.seatX(i);
      this.d[o + D_Y] = RestaurantLife.SEAT_Y;
      this.state[i] = S_SEATED;
    } else {
      this.d[o + D_X] = ROAD_X;
      this.d[o + D_Y] = EXIT_Y;
      this.d[o + D_LEG] = 0;
      this.state[i] = S_ARRIVE;
    }
  }

  /** Moves a diner toward (tx, ty) by `step` px; true once there. */
  private walk(o: number, tx: number, ty: number, step: number): boolean {
    const dx = tx - this.d[o + D_X]!;
    const dy = ty - this.d[o + D_Y]!;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= step) {
      this.d[o + D_X] = tx;
      this.d[o + D_Y] = ty;
      return true;
    }
    this.d[o + D_X] = this.d[o + D_X]! + (dx / dist) * step;
    this.d[o + D_Y] = this.d[o + D_Y]! + (dy / dist) * step;
    return false;
  }

  update(dtMs: number, night: boolean): void {
    this.night = night;
    const reduced = this.reduced();
    const dt = Math.min(dtMs, 100);
    const step = (SPEED * dt) / 1000;
    for (let i = 0; i < MAX_TABLES; i++) {
      const o = i * D_STRIDE;
      const wanted = this.level > 0 && this.serving[i] === 1 && !night;
      const st = this.state[i]!;
      if (reduced) {
        // Still life: a seated diner at every serving table by day, nobody walking.
        if (wanted && st !== S_SEATED) this.place(i, true);
        else if (!wanted) this.state[i] = S_NONE;
        continue;
      }
      if (st === S_NONE) {
        if (!wanted) {
          this.d[o + D_TIMER] = 0;
          continue;
        }
        if (this.d[o + D_TIMER]! <= 0) this.d[o + D_TIMER] = 600 + this.rand() * 4000; // stagger arrivals
        this.d[o + D_TIMER] = this.d[o + D_TIMER]! - dt;
        if (this.d[o + D_TIMER]! <= 0) this.place(i, false);
      } else if (st === S_ARRIVE) {
        if (!wanted) {
          this.leave(i);
          continue;
        }
        // Up the road to the lane, along it to the table's column, then up to the seat.
        const leg = this.d[o + D_LEG]!;
        if (leg === 0 && this.walk(o, ROAD_X, LANE_Y, step)) this.d[o + D_LEG] = 2;
        else if (leg === 2 && this.walk(o, this.seatX(i), LANE_Y, step)) this.d[o + D_LEG] = 3;
        else if (leg === 3 && this.walk(o, this.seatX(i), RestaurantLife.SEAT_Y, step))
          this.state[i] = S_SEATED;
      } else if (st === S_SEATED) {
        if (!wanted) this.leave(i);
      } else if (st === S_LEAVE) {
        // Down from the table to the lane, along it to the road, and away down the road.
        const leg = this.d[o + D_LEG]!;
        if (leg === 1 && this.walk(o, this.d[o + D_X]!, LANE_Y, step)) this.d[o + D_LEG] = 2;
        else if (leg === 2 && this.walk(o, ROAD_X, LANE_Y, step)) this.d[o + D_LEG] = 3;
        else if (leg === 3 && this.walk(o, ROAD_X, EXIT_Y, step)) {
          this.state[i] = S_NONE;
          this.d[o + D_TIMER] = 0;
        }
      }
    }
  }

  // ---- drawing

  private count_ = 0;

  private put(code: number, key: number): void {
    let j = this.count_++;
    while (j > 0 && this.keys[j - 1]! > key) {
      this.keys[j] = this.keys[j - 1]!;
      this.order[j] = this.order[j - 1]!;
      j--;
    }
    this.keys[j] = key;
    this.order[j] = code;
  }

  /** Sorts the inn, its tables and the diners by their bottom edge. Call once a frame before `bottomAt` / `draw`. */
  prepare(): number {
    this.count_ = 0;
    if (this.level > 0) {
      this.put(0, INN_BOTTOM * 2);
      for (let i = 0; i < this.tables; i++) this.put(1 + i, (INN_BOTTOM + TILE) * 2 - 1);
      for (let i = 0; i < MAX_TABLES; i++)
        if (this.state[i] !== S_NONE) this.put(8 + i, Math.round(this.d[i * D_STRIDE + D_Y]!) * 2);
    }
    this.n = this.count_;
    return this.n;
  }

  /** The bottom edge of the k-th item in draw order, in half pixels; `NO_MORE` past the end. */
  bottomAt(k: number): number {
    return k < this.n ? this.keys[k]! : NO_MORE;
  }

  draw(
    f: CanvasRenderingContext2D,
    k: number,
    timeMs: number,
    vis: Rect,
    winter: boolean,
    lit: boolean,
  ): void {
    const code = this.order[k]!;
    if (code === 0) {
      if (!overlaps(vis, INN_X, INN_Y, INN_W, INN_H)) return;
      f.drawImage(spriteFrameAt(INN_SPRITES[this.level - 1]!, lit ? 1 : 0, winter), INN_X, INN_Y);
      return;
    }
    if (code < 8) {
      const i = code - 1;
      const x = (SITE.col + i) * TILE;
      if (!overlaps(vis, x, INN_BOTTOM, TILE, TILE)) return;
      f.drawImage(spriteFrame(this.serving[i] === 1 ? 'obj_table_dish' : 'obj_table'), x, INN_BOTTOM);
      return;
    }
    const i = code - 8;
    const o = i * D_STRIDE;
    const x = Math.round(this.d[o + D_X]!) | 0;
    const y = Math.round(this.d[o + D_Y]!) | 0;
    if (!overlaps(vis, x - 8, y - 16, 16, 17)) return;
    const st = this.state[i]!;
    const ids = DINER_SPRITE_IDS[this.look[i]!]!;
    const reduced = this.reduced();
    const id = st === S_SEATED ? (reduced ? ids.sit : ids.eat) : ids.walk;
    const img = reduced ? spriteFrameAt(id, 0) : spriteFrameOffset(id, timeMs, this.d[o + D_PHASE]! | 0);
    f.globalAlpha = 0.25;
    f.fillStyle = PALETTE.outline;
    f.fillRect(x - 3, y - 1, 6, 2);
    f.globalAlpha = 1;
    // Walking east along the lane toward a table flips the left-facing art.
    if (st === S_ARRIVE && this.d[o + D_LEG] === 2) {
      f.save();
      f.translate(x + 8, y - 16);
      f.scale(-1, 1);
      f.drawImage(img, 0, 0);
      f.restore();
    } else f.drawImage(img, x - 8, y - 16);
  }

  // ---- lights, steam and tests

  /** World position of lit window `w` of the inn (for the night halos); false past the last. */
  windowOf(w: number, out: { x: number; y: number }): boolean {
    const list = this.level > 0 ? RESTAURANT_WINDOWS[this.level - 1]! : null;
    const p = list?.[w];
    if (!p) return false;
    out.x = INN_X + p.dx;
    out.y = INN_Y + p.dy;
    return true;
  }

  /** The lantern by the door, in world px; false before it is built. */
  lanternAt(out: { x: number; y: number }): boolean {
    if (this.level <= 0) return false;
    out.x = INN_X + RESTAURANT_LANTERN.dx;
    out.y = INN_Y + RESTAURANT_LANTERN.dy;
    return true;
  }

  /** The kitchen chimney's top, in world px, while any table serves (steam rises); false otherwise. */
  steamAt(out: { x: number; y: number }): boolean {
    if (this.level <= 0) return false;
    let any = false;
    for (let i = 0; i < this.tables; i++) if (this.serving[i] === 1) any = true;
    if (!any) return false;
    out.x = INN_X + RESTAURANT_CHIMNEY.dx;
    out.y = INN_Y + RESTAURANT_CHIMNEY.dy;
    return true;
  }

  /** The inn's sprite rectangle in world px (hit-testing and tests). */
  static readonly innRect = { x: INN_X, y: INN_Y, w: INN_W, h: INN_H } as const;

  /** Diners on the terrace or on their way (for tests). */
  get dinerCount(): number {
    let n = 0;
    for (let i = 0; i < MAX_TABLES; i++) if (this.state[i] !== S_NONE) n++;
    return n;
  }

  /** Diners sitting at a table (for tests). */
  get seatedCount(): number {
    let n = 0;
    for (let i = 0; i < MAX_TABLES; i++) if (this.state[i] === S_SEATED) n++;
    return n;
  }

  get isNight(): boolean {
    return this.night;
  }
}

const INN_SPRITES: readonly string[] = ['obj_restaurant_1', 'obj_restaurant_2', 'obj_restaurant_3'];
