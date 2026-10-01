// Life in the Old Paddock (GDD §12.4, ART_STYLE.md §6.4): the coop, barn and silo, their troughs, and the
// hens and cows that wander in front of them. Everything here is **render only**: it reads the buildings
// and animals it is handed, owns a private generator (never `rngState`), changes no game state, and sends
// nothing back. Wandering animals peck and graze, walk to the trough when a production cycle fires, and
// sleep next to their building at night. Their numbers live in typed arrays (a struct-of-arrays, like
// `ambient.ts`), the draw order is an insertion sort into preallocated arrays, and nothing is allocated
// per frame.

import type { AnimalState, BuildingState } from '../core/state';
import { ANIMALS, BUILDINGS } from '../data/animals';
import type { BuildingId } from '../data/ids';
import { WORLD_LAYOUT } from '../data/world';
import { overlaps, type Rect } from './camera';
import { PALETTE } from './palette';
import { spriteFrame, spriteFrameAt, spriteFrameOffset } from './spriteCache';
import { BARN_SPRITE_IDS, COOP_SPRITE_IDS, SILO_SPRITE_IDS, TROUGH_SPRITE_IDS } from './sprites/ranch';

const TILE = 16;
const SHADOW = PALETTE.outline;
/** What `bottomAt` returns past the last item. */
export const NO_MORE = 0x7fffffff;
const MAX_ANIMALS = 32;
const MAX_BUILDINGS = 3;

// Per-animal numbers (Float64Array stride).
const A_X = 0; // feet, world px
const A_Y = 1;
const A_TX = 2;
const A_TY = 3;
const A_TIMER = 4; // ms left in the current activity
const A_FACE = 5; // -1 faces left (the art), 1 faces right
const A_PHASE = 6; // animation offset, ms
const A_STRIDE = 7;

const S_IDLE = 0;
const S_WALK = 1;
const S_EAT = 2;
const S_SLEEP = 3;

const KIND_HEN = 0;
const KIND_COW = 1;

const HEN_SPEED = 15; // px / s
const COW_SPEED = 8;

const HEN_IDLE = 'animal_chicken_idle';
const HEN_WALK = 'animal_chicken_walk';
const HEN_EAT = 'animal_chicken_eat';
const HEN_SLEEP = 'animal_chicken_sleep';
const COW_IDLE = 'animal_cow_idle';
const COW_WALK = 'animal_cow_walk';
const COW_EAT = 'animal_cow_eat';
const COW_SLEEP = 'animal_cow_sleep';

const BUILDING_SPRITES: Readonly<Record<BuildingId, readonly string[]>> = {
  coop: COOP_SPRITE_IDS,
  barn: BARN_SPRITE_IDS,
  silo: SILO_SPRITE_IDS,
};

const YARD = WORLD_LAYOUT.regions.find((r) => r.id === 'yard')!.rect;
const YARD_BOTTOM = (YARD.row + YARD.rows) * TILE;

/** What the renderer is handed each frame (the arrays are the game state's own, read only). */
export interface RanchView {
  buildings: readonly BuildingState[];
  animals: readonly AnimalState[];
  /** 0 empty, 1 some, 2 full: how full each building's trough is (parallel to `buildings`). */
  troughLevel: readonly number[];
}

export class RanchLife {
  private seed = 0x3c6ef372;
  private readonly a = new Float64Array(MAX_ANIMALS * A_STRIDE);
  private readonly id = new Int32Array(MAX_ANIMALS).fill(-1);
  private readonly kind = new Int8Array(MAX_ANIMALS);
  private readonly home = new Int32Array(MAX_ANIMALS); // the building's index in `buildings`
  private readonly slot = new Int32Array(MAX_ANIMALS); // which of its building's animals this is (for bed spots)
  private readonly state = new Int8Array(MAX_ANIMALS);
  /** After walking to the trough, eat for this long (0 = just wander). */
  private readonly eatAfter = new Float64Array(MAX_ANIMALS);
  private count = 0;
  private sig = Number.NaN;
  private buildings: readonly BuildingState[] = [];
  private troughs: readonly number[] = [];
  // The draw order: item codes sorted by their bottom edge (see `prepare`).
  private readonly order = new Int32Array(MAX_ANIMALS + 2 * MAX_BUILDINGS);
  private readonly keys = new Int32Array(MAX_ANIMALS + 2 * MAX_BUILDINGS);
  private n = 0;
  private night = false;

  constructor(private readonly reduced: () => boolean = () => false) {}

  private rand(): number {
    this.seed = (this.seed + 0x6d2b79f5) | 0;
    let t = this.seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // ---- keeping the visual animals in step with the game's

  /** Integer signature of what is there: rebuilt slots only when it changes. */
  private signature(view: RanchView): number {
    let s = view.buildings.length;
    for (let i = 0; i < view.buildings.length; i++) {
      const b = view.buildings[i]!;
      s = (Math.imul(s, 31) + b.id * 7 + b.at.col * 13 + b.at.row * 17 + b.level) | 0;
    }
    for (let i = 0; i < view.animals.length; i++) {
      const an = view.animals[i]!;
      s = (Math.imul(s, 31) + an.id * 11 + an.building) | 0;
    }
    return s;
  }

  private buildingIndex(buildings: readonly BuildingState[], id: number): number {
    for (let i = 0; i < buildings.length; i++) if (buildings[i]!.id === id) return i;
    return -1;
  }

  /** Where animal `slot` of building `b` beds down: in front of the building, spread along it. */
  private bedSpot(b: BuildingState, kind: number, slot: number, out: 'x' | 'y'): number {
    const def = BUILDINGS[b.kind];
    const bottom = (b.at.row + def.footprint.rows) * TILE;
    if (kind === KIND_HEN) {
      return out === 'x'
        ? b.at.col * TILE + 6 + (slot % 6) * 7
        : Math.min(YARD_BOTTOM - 2, bottom + 6 + Math.floor(slot / 6) * 5);
    }
    return out === 'x'
      ? b.at.col * TILE + 12 + (slot % 3) * 18
      : Math.min(YARD_BOTTOM - 2, bottom + 12 + Math.floor(slot / 3) * 3);
  }

  sync(view: RanchView): void {
    this.buildings = view.buildings;
    this.troughs = view.troughLevel;
    const sig = this.signature(view);
    if (sig === this.sig) return;
    this.sig = sig;
    // Keep the animals already here (by id), add the new ones, drop the gone ones. Animals are only ever added
    // at the end of the game's list, so an old animal's slot is never to the left of its new one.
    let n = 0;
    const perBuilding = this.perBuilding;
    perBuilding.fill(0);
    for (let i = 0; i < view.animals.length && n < MAX_ANIMALS; i++) {
      const an = view.animals[i]!;
      const bi = this.buildingIndex(view.buildings, an.building);
      if (bi < 0 || bi >= MAX_BUILDINGS) continue;
      let at = -1;
      for (let k = 0; k < this.count; k++) if (this.id[k] === an.id) at = k;
      const o = n * A_STRIDE;
      const kindNow = an.kind === 'cow' ? KIND_COW : KIND_HEN;
      if (at >= 0) {
        const oo = at * A_STRIDE;
        const st = this.state[at]!;
        const ea = this.eatAfter[at]!;
        for (let f = 0; f < A_STRIDE; f++) this.a[o + f] = this.a[oo + f]!;
        this.state[n] = st;
        this.eatAfter[n] = ea;
      } else {
        const b = view.buildings[bi]!;
        const sl = perBuilding[bi]!;
        this.a[o + A_X] = this.bedSpot(b, kindNow, sl, 'x');
        this.a[o + A_Y] = this.bedSpot(b, kindNow, sl, 'y');
        this.a[o + A_TX] = this.a[o + A_X]!;
        this.a[o + A_TY] = this.a[o + A_Y]!;
        this.a[o + A_TIMER] = 400 + this.rand() * 2000;
        this.a[o + A_FACE] = this.rand() < 0.5 ? -1 : 1;
        this.a[o + A_PHASE] = Math.floor(this.rand() * 900);
        this.state[n] = S_IDLE;
        this.eatAfter[n] = 0;
      }
      this.id[n] = an.id;
      this.kind[n] = kindNow;
      this.home[n] = bi;
      this.slot[n] = perBuilding[bi]!;
      perBuilding[bi] = perBuilding[bi]! + 1;
      n++;
    }
    for (let k = n; k < MAX_ANIMALS; k++) this.id[k] = -1;
    this.count = n;
  }

  private readonly perBuilding = new Int32Array(MAX_BUILDINGS + 1);
  // ---- behaviour

  /** A production cycle fired in `buildingId`: its animals walk to the trough and eat (cosmetic). */
  eatAt(buildingId: number): void {
    if (this.reduced() || this.night) return;
    const bi = this.buildingIndex(this.buildings, buildingId);
    if (bi < 0) return;
    const b = this.buildings[bi]!;
    const t = this.troughPoint(b);
    for (let i = 0; i < this.count; i++) {
      if (this.home[i] !== bi || this.state[i] === S_SLEEP) continue;
      const o = i * A_STRIDE;
      this.a[o + A_TX] = t.x + (this.rand() - 0.5) * 8;
      this.a[o + A_TY] = t.y + this.rand() * 3;
      this.state[i] = S_WALK;
      this.eatAfter[i] = 1400 + this.rand() * 900;
    }
  }

  private readonly pt = { x: 0, y: 0 };

  private troughPoint(b: BuildingState): { x: number; y: number } {
    const fp = BUILDINGS[b.kind].footprint;
    this.pt.x = (b.at.col + fp.cols) * TILE + 8;
    this.pt.y = (b.at.row + fp.rows) * TILE + 1;
    return this.pt;
  }

  /** Picks a point to wander to in front of the animal's building. */
  private wanderTarget(i: number): void {
    const b = this.buildings[this.home[i]!]!;
    const fp = BUILDINGS[b.kind].footprint;
    const o = i * A_STRIDE;
    const bottom = (b.at.row + fp.rows) * TILE;
    const x0 = b.at.col * TILE - 4;
    const x1 = (b.at.col + fp.cols + 1) * TILE + 8;
    const cow = this.kind[i] === KIND_COW;
    const y0 = bottom + (cow ? 8 : 3);
    const y1 = Math.max(y0, Math.min(YARD_BOTTOM - 1, bottom + (cow ? 18 : 14)));
    this.a[o + A_TX] = x0 + this.rand() * (x1 - x0);
    this.a[o + A_TY] = y0 + this.rand() * (y1 - y0);
  }

  update(dtMs: number, night: boolean): void {
    this.night = night;
    if (this.count === 0 || this.reduced()) return;
    const dt = Math.min(dtMs, 100);
    for (let i = 0; i < this.count; i++) {
      const o = i * A_STRIDE;
      const b = this.buildings[this.home[i]!];
      if (!b) continue;
      const hen = this.kind[i] === KIND_HEN;
      let st = this.state[i]!;
      if (night) {
        if (st !== S_SLEEP) {
          this.a[o + A_TX] = this.bedSpot(b, this.kind[i]!, this.slot[i]!, 'x');
          this.a[o + A_TY] = this.bedSpot(b, this.kind[i]!, this.slot[i]!, 'y');
          this.eatAfter[i] = 0;
          if (st !== S_WALK) {
            st = S_WALK;
            this.state[i] = S_WALK;
          }
        }
      } else if (st === S_SLEEP) {
        st = S_IDLE;
        this.state[i] = S_IDLE;
        this.a[o + A_TIMER] = 500 + this.rand() * 3000; // they wake up one by one
      }
      if (st === S_WALK) {
        const dx = this.a[o + A_TX]! - this.a[o + A_X]!;
        const dy = this.a[o + A_TY]! - this.a[o + A_Y]!;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const step = ((hen ? HEN_SPEED : COW_SPEED) * dt) / 1000;
        if (dist <= step) {
          this.a[o + A_X] = this.a[o + A_TX]!;
          this.a[o + A_Y] = this.a[o + A_TY]!;
          if (night) {
            this.state[i] = S_SLEEP;
          } else if (this.eatAfter[i]! > 0) {
            this.state[i] = S_EAT;
            this.a[o + A_TIMER] = this.eatAfter[i]!;
            this.eatAfter[i] = 0;
            this.a[o + A_FACE] = -1;
          } else {
            this.state[i] = S_IDLE;
            this.a[o + A_TIMER] = 800 + this.rand() * 3200;
          }
        } else {
          this.a[o + A_X] = this.a[o + A_X]! + (dx / dist) * step;
          this.a[o + A_Y] = this.a[o + A_Y]! + (dy / dist) * step;
          if (Math.abs(dx) > 0.5) this.a[o + A_FACE] = dx < 0 ? -1 : 1;
        }
      } else if (st !== S_SLEEP) {
        this.a[o + A_TIMER] = this.a[o + A_TIMER]! - dt;
        if (this.a[o + A_TIMER]! <= 0) {
          const roll = this.rand();
          if (st === S_EAT || roll < 0.5) {
            this.wanderTarget(i);
            this.state[i] = S_WALK;
          } else if (roll < 0.78) {
            this.state[i] = S_EAT; // peck or graze where they stand
            this.a[o + A_TIMER] = 1500 + this.rand() * 2500;
          } else {
            this.state[i] = S_IDLE;
            this.a[o + A_TIMER] = 1000 + this.rand() * 3000;
            if (this.rand() < 0.3) this.a[o + A_FACE] = -this.a[o + A_FACE]!;
          }
        }
      }
    }
  }

  // ---- hit-testing

  /** The id of the animal under world point (x, y), or -1. Hens are 12 × 12 px, cows 26 × 22, around their feet. */
  animalAt(x: number, y: number): number {
    let best = -1;
    let bestY = -1;
    for (let i = 0; i < this.count; i++) {
      const o = i * A_STRIDE;
      const hen = this.kind[i] === KIND_HEN;
      const hw = hen ? 6 : 13;
      const h = hen ? 12 : 22;
      const ax = this.a[o + A_X]!;
      const ay = this.a[o + A_Y]!;
      if (x >= ax - hw && x <= ax + hw && y >= ay - h && y <= ay + 1 && ay > bestY) {
        best = this.id[i]!;
        bestY = ay;
      }
    }
    return best;
  }

  /** The id of the building whose sprite (footprint, roof rows above) or trough covers tile (col, row), or -1. */
  buildingAt(col: number, row: number): number {
    for (let i = 0; i < this.buildings.length; i++) {
      const b = this.buildings[i]!;
      const def = BUILDINGS[b.kind];
      const fp = def.footprint;
      const top = b.at.row - (b.kind === 'silo' ? 2 : 1);
      if (col >= b.at.col && col < b.at.col + fp.cols && row >= top && row < b.at.row + fp.rows) return b.id;
      if (def.houses && col === b.at.col + fp.cols && row === b.at.row + fp.rows - 1) return b.id;
    }
    return -1;
  }

  /** The animal's head, in world px (where hearts rise), or false when it is gone. */
  headOf(animalId: number, out: { x: number; y: number }): boolean {
    for (let i = 0; i < this.count; i++) {
      if (this.id[i] !== animalId) continue;
      const o = i * A_STRIDE;
      out.x = this.a[o + A_X]! + this.a[o + A_FACE]! * (this.kind[i] === KIND_COW ? 7 : 3);
      out.y = this.a[o + A_Y]! - (this.kind[i] === KIND_COW ? 18 : 10);
      return true;
    }
    return false;
  }

  /** Whether an animal of this id is currently asleep (petting a sleeper is allowed; it just gets a heart). */
  isAsleep(animalId: number): boolean {
    for (let i = 0; i < this.count; i++) if (this.id[i] === animalId) return this.state[i] === S_SLEEP;
    return false;
  }

  // ---- drawing

  private count_ = 0;

  /** Inserts an item into the draw order, keeping it sorted by whole-pixel bottom edge (no closure: nothing is allocated). */
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

  /** Sorts everything that stands in the yard by its bottom edge. Call once a frame before `bottomAt` / `draw`. */
  prepare(): number {
    this.count_ = 0;
    for (let i = 0; i < this.buildings.length && i < MAX_BUILDINGS; i++) {
      const b = this.buildings[i]!;
      const fp = BUILDINGS[b.kind].footprint;
      const bottom = (b.at.row + fp.rows) * TILE;
      this.put(i, bottom * 2);
      if (BUILDINGS[b.kind].houses) this.put(8 + i, bottom * 2 - 1); // the trough sorts just behind its building
    }
    for (let i = 0; i < this.count; i++) this.put(16 + i, Math.round(this.a[i * A_STRIDE + A_Y]!) * 2);
    this.n = this.count_;
    return this.n;
  }

  /** The bottom edge of the k-th item in draw order, in half pixels (a whole number: nothing boxed per call); `NO_MORE` past the end. */
  bottomAt(k: number): number {
    return k < this.n ? this.keys[k]! : NO_MORE;
  }

  /** Draws the k-th item in draw order. */
  draw(
    f: CanvasRenderingContext2D,
    k: number,
    timeMs: number,
    vis: Rect,
    winter: boolean,
    lit: boolean,
  ): void {
    const code = this.order[k]!;
    if (code < 8) {
      const b = this.buildings[code]!;
      const fp = BUILDINGS[b.kind].footprint;
      const img = spriteFrameAt(BUILDING_SPRITES[b.kind][b.level - 1]!, lit ? 1 : 0, winter);
      const x = (b.at.col * TILE + ((fp.cols * TILE - img.width) >> 1)) | 0;
      const y = ((b.at.row + fp.rows) * TILE - img.height) | 0;
      if (overlaps(vis, x, y, img.width, img.height)) f.drawImage(img, x, y);
      return;
    }
    if (code < 16) {
      const bi = code - 8;
      const b = this.buildings[bi]!;
      const fp = BUILDINGS[b.kind].footprint;
      const x = (b.at.col + fp.cols) * TILE;
      const y = (b.at.row + fp.rows - 1) * TILE;
      if (overlaps(vis, x, y, TILE, TILE))
        f.drawImage(spriteFrame(TROUGH_SPRITE_IDS[this.troughs[bi] ?? 0]!), x, y);
      return;
    }
    const i = code - 16;
    const o = i * A_STRIDE;
    const hen = this.kind[i] === KIND_HEN;
    const w = hen ? 16 : 32;
    const half = w >> 1;
    // Whole pixels throughout (and whole-number arguments): a fresh double per call is garbage in a frame.
    const ax = Math.round(this.a[o + A_X]!) | 0;
    const ay = Math.round(this.a[o + A_Y]!) | 0;
    if (!overlaps(vis, ax - half, ay - w, w, w + 1)) return;
    const st = this.state[i]!;
    const id = hen
      ? st === S_SLEEP
        ? HEN_SLEEP
        : st === S_WALK
          ? HEN_WALK
          : st === S_EAT
            ? HEN_EAT
            : HEN_IDLE
      : st === S_SLEEP
        ? COW_SLEEP
        : st === S_WALK
          ? COW_WALK
          : st === S_EAT
            ? COW_EAT
            : COW_IDLE;
    const img = this.reduced()
      ? spriteFrameAt(id, 0)
      : spriteFrameOffset(id, timeMs, this.a[o + A_PHASE]! | 0);
    const dx = ax - half;
    const dy = ay - w;
    // a soft ground shadow under the feet
    f.globalAlpha = 0.25;
    f.fillStyle = SHADOW;
    f.fillRect(ax - (hen ? 4 : 10), ay - 1, hen ? 8 : 20, 2);
    f.globalAlpha = 1;
    if (this.a[o + A_FACE]! > 0) {
      f.save();
      f.translate(dx + w, dy);
      f.scale(-1, 1);
      f.drawImage(img, 0, 0);
      f.restore();
    } else f.drawImage(img, dx, dy);
  }

  /** Lit windows: world positions of each building's window, for the night halo (null past the last). */
  windowOf(bi: number, out: { x: number; y: number }): boolean {
    const b = this.buildings[bi];
    if (!b || b.kind === 'silo') return false;
    const fp = BUILDINGS[b.kind].footprint;
    const top = (b.at.row + fp.rows) * TILE - (b.kind === 'coop' ? 48 : 64);
    out.x = b.at.col * TILE + (b.kind === 'coop' ? (b.level === 1 ? 31 : 25) : 23);
    out.y = top + (b.kind === 'coop' ? 29 : 40);
    return true;
  }

  get buildingCount(): number {
    return this.buildings.length;
  }

  /** Where animals of a given kind exist in the yard (for tests). */
  get animalCount(): number {
    return this.count;
  }

  /** The animal's feet position (for tests). */
  positionOf(animalId: number): { x: number; y: number } | null {
    for (let i = 0; i < this.count; i++)
      if (this.id[i] === animalId) return { x: this.a[i * A_STRIDE + A_X]!, y: this.a[i * A_STRIDE + A_Y]! };
    return null;
  }
}

/** For documentation and tests: the animals' definitions drive the per-kind look; nothing else is read from data. */
export const RANCH_ANIMAL_KINDS = Object.keys(ANIMALS);
