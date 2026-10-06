// The Press House yard and the apiary (GDD §13.5–13.6, ART_STYLE.md §7.2–7.3): the Press House at its level,
// one press station per slot in the yard below it (idle, turning while it presses, a bottle on it when a
// drink is done), the beehives on their spots (a honey drip when full, straw and snow in winter) and the
// bees around them. Everything here is **render only**: it reads the view it is handed, changes no game
// state and sends nothing back. Bees are a few dots per hive by day, none at night or in winter; their
// paths are a pure function of the render clock and a per-hive phase (no generator, no state), and under
// reduced motion there are none. Nothing is allocated per frame.

import { WORLD_LAYOUT } from '../data/world';
import { overlaps, type Rect } from './camera';
import { PALETTE } from './palette';
import { spriteFrame, spriteFrameAt } from './spriteCache';
import { PRESS_HOUSE_WINDOWS } from './sprites/press';

const TILE = 16;
/** What `bottomAt` returns past the last item. */
export const PRESS_NO_MORE = 0x7fffffff;
/** Press stations in the yard: the site's width (four from the levels). */
export const MAX_PRESSES = 4;
/** Hive spots in the apiary. */
export const MAX_HIVES = WORLD_LAYOUT.hiveSpots.length;
/** Bees drawn around each hive by day. */
const BEES_PER_HIVE = 3;

const SITE = WORLD_LAYOUT.pressSite;
/** The house: 64 × 64, bottom-centre on its footprint (the site's top four rows; the yard is the last). */
const HOUSE_W = 64;
const HOUSE_H = 64;
const YARD_ROW = SITE.row + SITE.rows - 1;
const HOUSE_X = SITE.col * TILE + ((SITE.cols * TILE - HOUSE_W) >> 1);
const HOUSE_BOTTOM = YARD_ROW * TILE;
const HOUSE_Y = HOUSE_BOTTOM - HOUSE_H;
/** A press station: 16 × 32, bottom-centre on its yard tile. */
const PRESS_H = 32;

/** Slot looks in the view. */
export const PRESS_IDLE = 0;
export const PRESS_BUSY = 1;
export const PRESS_DONE = 2;
/** Hive looks in the view, by spot. */
export const HIVE_NONE = 0;
export const HIVE_PLAIN = 1;
export const HIVE_FULL = 2;

/** What the renderer is handed each frame (read only). */
export interface PressView {
  level: number; // 0 = not built
  presses: number; // press slots
  /** PRESS_IDLE / PRESS_BUSY / PRESS_DONE per slot (`presses` long). */
  slot: Uint8Array;
  /** HIVE_NONE / HIVE_PLAIN / HIVE_FULL per hive spot. */
  hive: Uint8Array;
}

export class PressLife {
  private level = 0;
  private presses = 0;
  private readonly slot = new Uint8Array(MAX_PRESSES);
  private readonly hive = new Uint8Array(MAX_HIVES);
  private night = false;
  private readonly order = new Int32Array(1 + MAX_PRESSES + MAX_HIVES);
  private readonly keys = new Int32Array(1 + MAX_PRESSES + MAX_HIVES);
  private n = 0;
  private count_ = 0;

  constructor(private readonly reduced: () => boolean = () => false) {}

  sync(view: PressView): void {
    this.level = view.level;
    this.presses = Math.min(MAX_PRESSES, view.presses);
    for (let i = 0; i < MAX_PRESSES; i++) this.slot[i] = i < this.presses ? (view.slot[i] ?? 0) : 0;
    for (let i = 0; i < MAX_HIVES; i++) this.hive[i] = view.hive[i] ?? 0;
  }

  update(night: boolean): void {
    this.night = night;
  }

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

  /** Sorts the house, its presses and the hives by their bottom edge. Call once a frame before `bottomAt` / `draw`. */
  prepare(): number {
    this.count_ = 0;
    if (this.level > 0) {
      this.put(0, HOUSE_BOTTOM * 2);
      for (let i = 0; i < this.presses; i++) this.put(1 + i, (YARD_ROW + 1) * TILE * 2 - 1);
    }
    for (let s = 0; s < MAX_HIVES; s++)
      if (this.hive[s] !== HIVE_NONE) this.put(8 + s, (WORLD_LAYOUT.hiveSpots[s]!.row + 1) * TILE * 2 - 1);
    this.n = this.count_;
    return this.n;
  }

  /** The bottom edge of the k-th item in draw order, in half pixels; `PRESS_NO_MORE` past the end. */
  bottomAt(k: number): number {
    return k < this.n ? this.keys[k]! : PRESS_NO_MORE;
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
      if (!overlaps(vis, HOUSE_X, HOUSE_Y, HOUSE_W, HOUSE_H)) return;
      f.drawImage(spriteFrameAt(HOUSE_SPRITES[this.level - 1]!, lit ? 1 : 0, winter), HOUSE_X, HOUSE_Y);
      return;
    }
    if (code < 8) {
      const i = code - 1;
      const x = (SITE.col + i) * TILE;
      const y = (YARD_ROW + 1) * TILE - PRESS_H;
      if (!overlaps(vis, x, y, TILE, PRESS_H)) return;
      const look = this.slot[i]!;
      const id =
        look === PRESS_BUSY ? 'obj_press_busy' : look === PRESS_DONE ? 'obj_press_done' : 'obj_press_idle';
      f.drawImage(
        look === PRESS_BUSY && !this.reduced() ? spriteFrame(id, timeMs) : spriteFrameAt(id, 0, winter),
        x,
        y,
      );
      return;
    }
    const s = code - 8;
    const spot = WORLD_LAYOUT.hiveSpots[s]!;
    const x = spot.col * TILE;
    const y = (spot.row + 1) * TILE - PRESS_H;
    if (!overlaps(vis, x - 8, y - 4, TILE + 16, PRESS_H + 4)) return;
    const id = winter ? 'obj_hive_winter' : this.hive[s] === HIVE_FULL ? 'obj_hive_full' : 'obj_hive';
    f.drawImage(spriteFrameAt(id, 0), x, y);
    if (winter || this.night || this.reduced()) return;
    // Bees: tiny dots looping round the hive's entrance on the render clock (cosmetic, render only).
    const cx = x + 8;
    const cy = y + 20;
    for (let b = 0; b < BEES_PER_HIVE; b++) {
      const t = timeMs / (700 + 170 * b) + s * 1.7 + b * 2.1;
      const bx = Math.round(cx + Math.cos(t) * (6 + 2 * b) + Math.sin(t * 2.3) * 2);
      const by = Math.round(cy + Math.sin(t * 1.4) * (5 + b) - 6);
      f.fillStyle = PALETTE.outline;
      f.fillRect(bx, by, 1, 1);
      f.fillStyle = PALETTE.yellow;
      f.fillRect(bx + 1, by, 1, 1);
    }
  }

  /** World position of lit window `w` of the house (for the night halos); false past the last. */
  windowOf(w: number, out: { x: number; y: number }): boolean {
    const list = this.level > 0 ? PRESS_HOUSE_WINDOWS[this.level - 1]! : null;
    const p = list?.[w];
    if (!p) return false;
    out.x = HOUSE_X + p.dx;
    out.y = HOUSE_Y + p.dy;
    return true;
  }

  /** Bees on screen now (for tests): none at night, in winter or under reduced motion. */
  beesShown(winter: boolean): number {
    if (winter || this.night || this.reduced()) return 0;
    let n = 0;
    for (let s = 0; s < MAX_HIVES; s++) if (this.hive[s] !== HIVE_NONE) n += BEES_PER_HIVE;
    return n;
  }

  /** The house's sprite rectangle in world px (tests). */
  static readonly houseRect = { x: HOUSE_X, y: HOUSE_Y, w: HOUSE_W, h: HOUSE_H } as const;
}

const HOUSE_SPRITES: readonly string[] = ['obj_press_house_1', 'obj_press_house_2', 'obj_press_house_3'];
