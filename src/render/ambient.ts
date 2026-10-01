// Ambient life for the scene: butterflies by day, fireflies at night, drifting cloud shadows and
// seasonal air (blossoms, leaves, snow). All cosmetic: a private generator, no game state, and
// nothing is drawn or updated under reduced motion. Coordinates are world pixels. Butterflies,
// fireflies and falling pieces live only in the visible part of the world (`setBounds`): whatever
// the camera leaves behind is moved back into view, so a bigger world costs nothing extra.

import type { SeasonId } from '../data/ids';
import { PALETTE } from './palette';
import { WORLD_H, WORLD_W } from './scene';

export interface AmbientClock {
  hour: number;
  isNight: boolean;
  season: SeasonId;
}

// Creature state lives in Float64Arrays, a few numbers per creature (struct-of-arrays), not in objects with
// number fields: every update writes new doubles, and boxed numbers in objects were per-frame garbage.
const M_X = 0;
const M_Y = 1;
const M_TX = 2;
const M_TY = 3;
const M_PHASE = 4;
const M_SPEED = 5;
const M_STRIDE = 6;

const F_X = 0;
const F_Y = 1;
const F_VY = 2;
const F_SWAY = 3;
const F_PHASE = 4;
const F_STRIDE = 5;

const C_X = 0;
const C_Y = 1;
const C_W = 2;
const C_H = 3;
const C_SPEED = 4;
const C_STRIDE = 5;

/** How many butterflies, fireflies and falling pieces each season shows. */
export const AMBIENT_COUNTS: Record<SeasonId, { butterflies: number; fireflies: number; fall: number }> = {
  spring: { butterflies: 4, fireflies: 8, fall: 12 },
  summer: { butterflies: 3, fireflies: 14, fall: 0 },
  autumn: { butterflies: 1, fireflies: 6, fall: 14 },
  winter: { butterflies: 0, fireflies: 4, fall: 22 },
};

const FALL_COLOR: Record<SeasonId, string> = {
  spring: PALETTE.pink_light,
  summer: PALETTE.white_warm,
  autumn: PALETTE.orange,
  winter: PALETTE.white_warm,
};

/** Cloud shadows drift across the whole world; the few in view are drawn. */
const CLOUDS = 5;

export class Ambient {
  private seed = 0x7a3c19e5;
  /** The visible part of the world (world px), set by the renderer each frame. */
  private bx = 0;
  private by = 0;
  private bw = 320;
  private bh = 192;
  private lastX = Number.NaN;
  private lastY = Number.NaN;
  private lastW = Number.NaN;
  private lastH = Number.NaN;
  private readonly butterflies: Float64Array;
  private readonly fireflies: Float64Array;
  private readonly fallers: Float64Array;
  private readonly clouds: Float64Array;

  constructor(private readonly reduced: () => boolean = () => false) {
    this.butterflies = new Float64Array(4 * M_STRIDE);
    this.fireflies = new Float64Array(14 * M_STRIDE);
    for (let i = 0; i < 4; i++) this.mover(this.butterflies, i, 1.4);
    for (let i = 0; i < 14; i++) this.mover(this.fireflies, i, 0.5);
    this.fallers = new Float64Array(22 * F_STRIDE);
    for (let i = 0; i < 22; i++) {
      const o = i * F_STRIDE;
      this.fallers[o + F_X] = this.rand() * this.bw;
      this.fallers[o + F_Y] = this.rand() * this.bh;
      this.fallers[o + F_VY] = 6 + this.rand() * 8;
      this.fallers[o + F_SWAY] = 3 + this.rand() * 5;
      this.fallers[o + F_PHASE] = this.rand() * 6.28;
    }
    this.clouds = new Float64Array(CLOUDS * C_STRIDE);
    for (let i = 0; i < CLOUDS; i++) {
      const o = i * C_STRIDE;
      this.clouds[o + C_X] = (i * WORLD_W) / CLOUDS + this.rand() * 40;
      this.clouds[o + C_Y] = 20 + ((i * 3) % CLOUDS) * ((WORLD_H - 60) / CLOUDS) + this.rand() * 30;
      this.clouds[o + C_W] = 46 + this.rand() * 34;
      this.clouds[o + C_H] = 14 + this.rand() * 8;
      this.clouds[o + C_SPEED] = 2.5 + this.rand() * 2.5;
    }
  }

  /** Where butterfly `i` is (for tests; allocates). */
  butterflyAt(i: number): { x: number; y: number } {
    return { x: this.butterflies[i * M_STRIDE + M_X]!, y: this.butterflies[i * M_STRIDE + M_Y]! };
  }

  private rand(): number {
    this.seed = (this.seed + 0x6d2b79f5) | 0;
    let t = this.seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  private mover(a: Float64Array, i: number, speed: number): void {
    const o = i * M_STRIDE;
    const x = this.rand() * this.bw;
    const y = 16 + this.rand() * (this.bh - 32);
    a[o + M_X] = x;
    a[o + M_Y] = y;
    a[o + M_TX] = x;
    a[o + M_TY] = y;
    a[o + M_PHASE] = this.rand() * 6.28;
    a[o + M_SPEED] = speed * (0.7 + this.rand() * 0.6);
  }

  /** The visible part of the world in world px (clamped to the world). Called before `update`. */
  setBounds(x: number, y: number, w: number, h: number): void {
    if (x === this.lastX && y === this.lastY && w === this.lastW && h === this.lastH) return;
    this.lastX = x;
    this.lastY = y;
    this.lastW = w;
    this.lastH = h;
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    this.bx = x0;
    this.by = y0;
    this.bw = Math.max(32, Math.min(WORLD_W, x + w) - x0);
    this.bh = Math.max(32, Math.min(WORLD_H, y + h) - y0);
  }

  /**
   * Whether the creature at `a[o]` (x) and `a[o + 1]` (y) is more than `margin` outside the view. It reads the array
   * itself and takes only whole numbers, so calling it per creature per frame boxes no doubles.
   */
  private outsideAt(a: Float64Array, o: number, margin: number): boolean {
    return (
      a[o]! < this.bx - margin ||
      a[o + 1]! < this.by - margin ||
      a[o]! > this.bx + this.bw + margin ||
      a[o + 1]! > this.by + this.bh + margin
    );
  }

  /** Puts a mover the camera left behind back somewhere in view. */
  private reseat(a: Float64Array, o: number): void {
    const x = this.bx + 4 + this.rand() * (this.bw - 8);
    const y = this.by + 12 + this.rand() * (this.bh - 20);
    a[o + M_X] = a[o + M_TX] = x;
    a[o + M_Y] = a[o + M_TY] = y;
  }

  /** Butterflies fly in daylight (07:00–19:00), fireflies when it is night on the local clock. */
  visible(clock: AmbientClock): { butterflies: number; fireflies: number; fall: number; clouds: number } {
    // Asked several times a frame: filled into one reused object (copy it to keep it).
    const v = this.vis;
    if (this.reduced()) {
      v.butterflies = v.fireflies = v.fall = v.clouds = 0;
      return v;
    }
    const c = AMBIENT_COUNTS[clock.season];
    const day = !clock.isNight && clock.hour >= 7 && clock.hour < 19;
    v.butterflies = day ? c.butterflies : 0;
    v.fireflies = clock.isNight ? c.fireflies : 0;
    v.fall = c.fall;
    v.clouds = clock.isNight ? 0 : CLOUDS;
    return v;
  }

  private readonly vis = { butterflies: 0, fireflies: 0, fall: 0, clouds: 0 };

  /** Frame time and the current group's speed factor, as fields so `wander` takes no double arguments. */
  private dt = 0;
  private rate = 1;

  private wander(a: Float64Array, o: number): void {
    const dx = a[o + M_TX]! - a[o + M_X]!;
    const dy = a[o + M_TY]! - a[o + M_Y]!;
    if (dx * dx + dy * dy < 4) {
      a[o + M_TX] = Math.min(
        this.bx + this.bw - 4,
        Math.max(this.bx + 4, a[o + M_X]! + (this.rand() - 0.5) * 70),
      );
      a[o + M_TY] = Math.min(
        this.by + this.bh - 8,
        Math.max(this.by + 12, a[o + M_Y]! + (this.rand() - 0.5) * 50),
      );
    }
    const len = Math.hypot(dx, dy) || 1;
    const k = a[o + M_SPEED]! * this.rate * this.dt * 20;
    a[o + M_X] = a[o + M_X]! + (dx / len) * k;
    a[o + M_Y] = a[o + M_Y]! + (dy / len) * k;
    a[o + M_PHASE] = a[o + M_PHASE]! + this.dt * 9;
  }

  update(dtMs: number, clock: AmbientClock): void {
    if (this.reduced()) return;
    const dt = Math.min(dtMs, 100) / 1000;
    this.dt = dt;
    const vis = this.visible(clock);
    this.rate = 1;
    for (let i = 0; i < vis.butterflies; i++) {
      const o = i * M_STRIDE;
      if (this.outsideAt(this.butterflies, o, 24)) this.reseat(this.butterflies, o);
      this.wander(this.butterflies, o);
    }
    this.rate = 0.5;
    for (let i = 0; i < vis.fireflies; i++) {
      const o = i * M_STRIDE;
      if (this.outsideAt(this.fireflies, o, 24)) this.reseat(this.fireflies, o);
      this.wander(this.fireflies, o);
    }
    const fa = this.fallers;
    for (let i = 0; i < vis.fall; i++) {
      const o = i * F_STRIDE;
      fa[o + F_Y] = fa[o + F_Y]! + fa[o + F_VY]! * dt;
      fa[o + F_PHASE] = fa[o + F_PHASE]! + dt * 1.6;
      fa[o + F_X] = fa[o + F_X]! + Math.sin(fa[o + F_PHASE]!) * fa[o + F_SWAY]! * dt;
      const below = fa[o + F_Y]! > this.by + this.bh + 2;
      if (below || this.outsideAt(fa, o, 24)) {
        fa[o + F_Y] = below ? this.by - 2 : this.by + this.rand() * this.bh;
        fa[o + F_X] = this.bx + this.rand() * this.bw;
      }
    }
    const ca = this.clouds;
    for (let i = 0; i < CLOUDS; i++) {
      const o = i * C_STRIDE;
      ca[o + C_X] = ca[o + C_X]! + ca[o + C_SPEED]! * dt;
      if (ca[o + C_X]! > WORLD_W + 10) ca[o + C_X] = -ca[o + C_W]! - 10;
    }
  }

  /** Soft cloud shadows on the ground (draw before the objects). */
  drawShadows(f: CanvasRenderingContext2D, clock: AmbientClock): void {
    const n = this.visible(clock).clouds;
    if (n === 0) return;
    f.fillStyle = PALETTE.outline;
    f.globalAlpha = 0.13;
    const ca = this.clouds;
    for (let i = 0; i < n; i++) {
      const o = i * C_STRIDE;
      const w = ca[o + C_W]!;
      const cx = ca[o + C_X]! + w / 2;
      const cy = ca[o + C_Y]! + ca[o + C_H]! / 2;
      const gone =
        cx < this.bx - w || cy < this.by - w || cx > this.bx + this.bw + w || cy > this.by + this.bh + w;
      if (!gone) ellipse(f, ca, o);
    }
    f.globalAlpha = 1;
  }

  /** Butterflies and the season's falling pieces (draw before the tint). */
  drawAir(f: CanvasRenderingContext2D, clock: AmbientClock): void {
    const vis = this.visible(clock);
    f.fillStyle = FALL_COLOR[clock.season];
    const size = clock.season === 'winter' ? 1 : 2;
    for (let i = 0; i < vis.fall; i++) {
      const o = i * F_STRIDE;
      f.fillRect(Math.round(this.fallers[o + F_X]!), Math.round(this.fallers[o + F_Y]!), size, size);
    }
    for (let i = 0; i < vis.butterflies; i++) {
      const o = i * M_STRIDE;
      const phase = this.butterflies[o + M_PHASE]!;
      const x = Math.round(this.butterflies[o + M_X]!);
      const y = Math.round(this.butterflies[o + M_Y]! + Math.sin(phase * 0.5) * 2);
      const flap = Math.sin(phase * 2) > 0;
      f.fillStyle = WINGS[i % WINGS.length] ?? PALETTE.yellow;
      f.fillRect(x - (flap ? 2 : 1), y, flap ? 2 : 1, 2);
      f.fillRect(x + 1, y, flap ? 2 : 1, 2);
      f.fillStyle = PALETTE.outline;
      f.fillRect(x, y, 1, 2);
    }
  }

  /** Fireflies glow above the night tint, so they are drawn after it. */
  drawGlow(f: CanvasRenderingContext2D, timeMs: number, clock: AmbientClock): void {
    const n = this.visible(clock).fireflies;
    for (let i = 0; i < n; i++) {
      const o = i * M_STRIDE;
      const x = Math.round(this.fireflies[o + M_X]!);
      const y = Math.round(this.fireflies[o + M_Y]!);
      const blink = 0.35 + 0.65 * Math.max(0, Math.sin(timeMs / 420 + this.fireflies[o + M_PHASE]! * 3));
      f.globalAlpha = 0.25 * blink;
      f.fillStyle = PALETTE.yellow_light;
      f.fillRect(x - 1, y - 1, 3, 3);
      f.globalAlpha = blink;
      f.fillStyle = PALETTE.yellow_light;
      f.fillRect(x, y, 1, 1);
    }
    f.globalAlpha = 1;
  }
}

const WINGS = [PALETTE.yellow, PALETTE.pink, PALETTE.water_3, PALETTE.orange_light];

function ellipse(f: CanvasRenderingContext2D, a: Float64Array, o: number): void {
  const w = a[o + C_W]!;
  const x = a[o + C_X]!;
  const y = a[o + C_Y]!;
  const rows = Math.round(a[o + C_H]!);
  for (let r = 0; r < rows; r++) {
    const t = (r / (rows - 1)) * 2 - 1;
    const half = Math.round((w / 2) * Math.sqrt(1 - t * t));
    f.fillRect(Math.round(x + w / 2 - half), Math.round(y + r), half * 2, 1);
  }
}
