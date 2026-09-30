// Ambient life for the scene: butterflies by day, fireflies at night, drifting cloud shadows and
// seasonal air (blossoms, leaves, snow). All cosmetic: a private generator, no game state, and
// nothing is drawn or updated under reduced motion. Logical coordinates are scene pixels (320 × 192).

import type { SeasonId } from '../data/ids';
import { PALETTE } from './palette';
import { SCENE_H, SCENE_W } from './scene';

export interface AmbientClock {
  hour: number;
  isNight: boolean;
  season: SeasonId;
}

interface Mover {
  x: number;
  y: number;
  tx: number;
  ty: number;
  phase: number;
  speed: number;
}

interface Faller {
  x: number;
  y: number;
  vy: number;
  sway: number;
  phase: number;
}

interface Cloud {
  x: number;
  y: number;
  w: number;
  h: number;
  speed: number;
}

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

export class Ambient {
  private seed = 0x7a3c19e5;
  private readonly butterflies: Mover[];
  private readonly fireflies: Mover[];
  private readonly fallers: Faller[];
  private readonly clouds: Cloud[];

  constructor(private readonly reduced: () => boolean = () => false) {
    this.butterflies = Array.from({ length: 4 }, () => this.mover(1.4));
    this.fireflies = Array.from({ length: 14 }, () => this.mover(0.5));
    this.fallers = Array.from({ length: 22 }, () => ({
      x: this.rand() * SCENE_W,
      y: this.rand() * SCENE_H,
      vy: 6 + this.rand() * 8,
      sway: 3 + this.rand() * 5,
      phase: this.rand() * 6.28,
    }));
    this.clouds = Array.from({ length: 3 }, (_, i) => ({
      x: (i * SCENE_W) / 3 + this.rand() * 40,
      y: 20 + this.rand() * (SCENE_H - 60),
      w: 46 + this.rand() * 34,
      h: 14 + this.rand() * 8,
      speed: 2.5 + this.rand() * 2.5,
    }));
  }

  private rand(): number {
    this.seed = (this.seed + 0x6d2b79f5) | 0;
    let t = this.seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  private mover(speed: number): Mover {
    const x = this.rand() * SCENE_W;
    const y = 16 + this.rand() * (SCENE_H - 32);
    return { x, y, tx: x, ty: y, phase: this.rand() * 6.28, speed: speed * (0.7 + this.rand() * 0.6) };
  }

  /** Butterflies fly in daylight (07:00–19:00), fireflies when it is night on the local clock. */
  visible(clock: AmbientClock): { butterflies: number; fireflies: number; fall: number; clouds: number } {
    if (this.reduced()) return { butterflies: 0, fireflies: 0, fall: 0, clouds: 0 };
    const c = AMBIENT_COUNTS[clock.season];
    const day = !clock.isNight && clock.hour >= 7 && clock.hour < 19;
    return {
      butterflies: day ? c.butterflies : 0,
      fireflies: clock.isNight ? c.fireflies : 0,
      fall: c.fall,
      clouds: clock.isNight ? 0 : 3,
    };
  }

  update(dtMs: number, clock: AmbientClock): void {
    if (this.reduced()) return;
    const dt = Math.min(dtMs, 100) / 1000;
    const vis = this.visible(clock);
    const wander = (m: Mover, rate: number): void => {
      const dx = m.tx - m.x;
      const dy = m.ty - m.y;
      if (dx * dx + dy * dy < 4) {
        m.tx = Math.min(SCENE_W - 4, Math.max(4, m.x + (this.rand() - 0.5) * 70));
        m.ty = Math.min(SCENE_H - 8, Math.max(12, m.y + (this.rand() - 0.5) * 50));
      }
      const len = Math.hypot(dx, dy) || 1;
      m.x += (dx / len) * m.speed * rate * dt * 20;
      m.y += (dy / len) * m.speed * rate * dt * 20;
      m.phase += dt * 9;
    };
    for (let i = 0; i < vis.butterflies; i++) wander(this.butterflies[i]!, 1);
    for (let i = 0; i < vis.fireflies; i++) wander(this.fireflies[i]!, 0.5);
    for (let i = 0; i < vis.fall; i++) {
      const p = this.fallers[i]!;
      p.y += p.vy * dt;
      p.phase += dt * 1.6;
      p.x += Math.sin(p.phase) * p.sway * dt;
      if (p.y > SCENE_H + 2) {
        p.y = -2;
        p.x = this.rand() * SCENE_W;
      }
    }
    for (const c of this.clouds) {
      c.x += c.speed * dt;
      if (c.x > SCENE_W + 10) c.x = -c.w - 10;
    }
  }

  /** Soft cloud shadows on the ground (draw before the objects). */
  drawShadows(f: CanvasRenderingContext2D, clock: AmbientClock): void {
    const n = this.visible(clock).clouds;
    if (n === 0) return;
    f.fillStyle = PALETTE.outline;
    f.globalAlpha = 0.13;
    for (let i = 0; i < n; i++) ellipse(f, this.clouds[i]!);
    f.globalAlpha = 1;
  }

  /** Butterflies and the season's falling pieces (draw before the tint). */
  drawAir(f: CanvasRenderingContext2D, clock: AmbientClock): void {
    const vis = this.visible(clock);
    f.fillStyle = FALL_COLOR[clock.season];
    for (let i = 0; i < vis.fall; i++) {
      const p = this.fallers[i]!;
      f.fillRect(
        Math.round(p.x),
        Math.round(p.y),
        clock.season === 'winter' ? 1 : 2,
        clock.season === 'winter' ? 1 : 2,
      );
    }
    const wings = [PALETTE.yellow, PALETTE.pink, PALETTE.water_3, PALETTE.orange_light];
    for (let i = 0; i < vis.butterflies; i++) {
      const b = this.butterflies[i]!;
      const x = Math.round(b.x);
      const y = Math.round(b.y + Math.sin(b.phase * 0.5) * 2);
      const flap = Math.sin(b.phase * 2) > 0;
      f.fillStyle = wings[i % wings.length] ?? PALETTE.yellow;
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
      const m = this.fireflies[i]!;
      const blink = 0.35 + 0.65 * Math.max(0, Math.sin(timeMs / 420 + m.phase * 3));
      f.globalAlpha = 0.25 * blink;
      f.fillStyle = PALETTE.yellow_light;
      f.fillRect(Math.round(m.x) - 1, Math.round(m.y) - 1, 3, 3);
      f.globalAlpha = blink;
      f.fillStyle = PALETTE.yellow_light;
      f.fillRect(Math.round(m.x), Math.round(m.y), 1, 1);
    }
    f.globalAlpha = 1;
  }
}

function ellipse(f: CanvasRenderingContext2D, c: Cloud): void {
  const rows = Math.round(c.h);
  for (let r = 0; r < rows; r++) {
    const t = (r / (rows - 1)) * 2 - 1;
    const half = Math.round((c.w / 2) * Math.sqrt(1 - t * t));
    f.fillRect(Math.round(c.x + c.w / 2 - half), Math.round(c.y + r), half * 2, 1);
  }
}
