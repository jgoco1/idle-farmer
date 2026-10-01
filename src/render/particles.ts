// A small pooled particle system for the scene (world px). Cosmetic only: it has its own
// generator, never reads or writes game state, and emits nothing at all under reduced motion.
// Kinds: soil puffs, water droplets, leaf bursts, splash ripples, steam, sparkles and pet hearts.
// Coins that fly to the HUD are DOM elements (src/ui/coinFly.ts) because the HUD is outside the canvas.

import { PALETTE } from './palette';

export type ParticleKind = 'soil' | 'droplet' | 'leaf' | 'ripple' | 'steam' | 'sparkle' | 'heart';

interface Particle {
  alive: boolean;
  kind: ParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ay: number;
  age: number; // ms
  life: number; // ms
  size: number;
  color: string;
}

const POOL_SIZE = 320;

interface Recipe {
  count: number;
  life: [number, number];
  speed: [number, number];
  /** Emission direction in radians (0 = right, -π/2 = up) and spread. */
  angle: number;
  spread: number;
  gravity: number; // px / s²
  size: [number, number];
  colors: readonly string[];
}

const RECIPES: Record<ParticleKind, Recipe> = {
  soil: {
    count: 7,
    life: [280, 480],
    speed: [14, 34],
    angle: -Math.PI / 2,
    spread: 2.2,
    gravity: 120,
    size: [2, 3],
    colors: [PALETTE.soil_light, PALETTE.soil_mid, PALETTE.sand_dark],
  },
  droplet: {
    count: 8,
    life: [300, 520],
    speed: [20, 48],
    angle: -Math.PI / 2,
    spread: 1.6,
    gravity: 190,
    size: [1, 2],
    colors: [PALETTE.water_3, PALETTE.water_foam, PALETTE.water_2],
  },
  leaf: {
    count: 9,
    life: [420, 760],
    speed: [22, 52],
    angle: -Math.PI / 2,
    spread: 3.0,
    gravity: 60,
    size: [2, 3],
    colors: [PALETTE.grass_3, PALETTE.leaf_light, PALETTE.grass_2],
  },
  ripple: {
    count: 1,
    life: [650, 650],
    speed: [0, 0],
    angle: 0,
    spread: 0,
    gravity: 0,
    size: [2, 2],
    colors: [PALETTE.water_foam],
  },
  steam: {
    count: 1,
    life: [900, 1400],
    speed: [6, 12],
    angle: -Math.PI / 2,
    spread: 0.5,
    gravity: -6,
    size: [2, 3],
    colors: [PALETTE.white_warm],
  },
  sparkle: {
    count: 18,
    life: [500, 950],
    speed: [24, 70],
    angle: -Math.PI / 2,
    spread: 6.3,
    gravity: 20,
    size: [1, 3],
    colors: [PALETTE.gold, PALETTE.yellow_light, PALETTE.white_warm],
  },
  heart: {
    count: 1,
    life: [900, 900],
    speed: [14, 14],
    angle: -Math.PI / 2,
    spread: 0,
    gravity: 0,
    size: [5, 5],
    colors: [PALETTE.red_light],
  },
};

const HEART = ['.x.x.', 'xxxxx', 'xxxxx', '.xxx.', '..x..'];

export class ParticleSystem {
  private readonly pool: Particle[] = Array.from({ length: POOL_SIZE }, () => ({
    alive: false,
    kind: 'soil' as ParticleKind,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    ay: 0,
    age: 0,
    life: 1,
    size: 1,
    color: '#fff',
  }));
  private seed = 0x51ed270b;

  /** `reduced()` is asked on every emit, so flipping the setting takes effect immediately. */
  constructor(private readonly reduced: () => boolean = () => false) {}

  /** Cosmetic mulberry32; deliberately not `src/core/rng.ts`. */
  private rand(): number {
    this.seed = (this.seed + 0x6d2b79f5) | 0;
    let t = this.seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  get aliveCount(): number {
    let n = 0;
    for (let i = 0; i < this.pool.length; i++) if (this.pool[i]!.alive) n++;
    return n;
  }

  /** Emits a burst at logical scene pixel (x, y). Returns how many particles were made. */
  emit(kind: ParticleKind, x: number, y: number, scale = 1): number {
    if (this.reduced()) return 0;
    const r = RECIPES[kind];
    const count = Math.max(1, Math.round(r.count * scale));
    let made = 0;
    for (let i = 0; i < count; i++) {
      const p = this.pool.find((q) => !q.alive);
      if (!p) break; // pool exhausted: drop the extras, never allocate
      const ang = r.angle + (this.rand() - 0.5) * r.spread;
      const speed = r.speed[0] + this.rand() * (r.speed[1] - r.speed[0]);
      p.alive = true;
      p.kind = kind;
      p.x = x + (kind === 'ripple' || kind === 'heart' ? 0 : (this.rand() - 0.5) * 6);
      p.y = y;
      p.vx = Math.cos(ang) * speed;
      p.vy = Math.sin(ang) * speed;
      p.ay = r.gravity;
      p.age = 0;
      p.life = r.life[0] + this.rand() * (r.life[1] - r.life[0]);
      p.size = Math.round(r.size[0] + this.rand() * (r.size[1] - r.size[0]));
      p.color = r.colors[Math.floor(this.rand() * r.colors.length)] ?? PALETTE.white_warm;
      made++;
    }
    return made;
  }

  update(dtMs: number): void {
    const dt = Math.min(dtMs, 100) / 1000;
    // Indexed loops: this runs every frame, and an array iterator is garbage the GC has to collect.
    for (let i = 0; i < this.pool.length; i++) {
      const p = this.pool[i]!;
      if (!p.alive) continue;
      p.age += dtMs;
      if (p.age >= p.life) {
        p.alive = false;
        continue;
      }
      p.vy += p.ay * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  /** Draws the live particles; with `view` (world px), only those inside it. */
  draw(f: CanvasRenderingContext2D, view?: { x: number; y: number; w: number; h: number }): void {
    for (let i = 0; i < this.pool.length; i++) {
      const p = this.pool[i]!;
      if (!p.alive) continue;
      if (view && (p.x < view.x - 8 || p.y < view.y - 8 || p.x > view.x + view.w + 8 || p.y > view.y + view.h + 8))
        continue;
      const t = p.age / p.life;
      f.globalAlpha = p.kind === 'steam' ? 0.6 * (1 - t) : 1 - t * t;
      f.fillStyle = p.color;
      const x = Math.round(p.x);
      const y = Math.round(p.y);
      if (p.kind === 'ripple') {
        // An expanding pixel ring (flattened, as seen from above at an angle).
        const rx = 2 + Math.round(t * 7);
        const ry = 1 + Math.round(t * 3);
        f.fillRect(x - rx, y, 1, 1);
        f.fillRect(x + rx, y, 1, 1);
        f.fillRect(x - (rx >> 1), y - ry, rx, 1);
        f.fillRect(x - (rx >> 1), y + ry, rx, 1);
      } else if (p.kind === 'heart') {
        HEART.forEach((row, ry) =>
          [...row].forEach((ch, rx) => ch === 'x' && f.fillRect(x - 2 + rx, y - 2 + ry, 1, 1)),
        );
      } else if (p.kind === 'sparkle') {
        const s = t < 0.5 ? p.size : Math.max(1, p.size - 1);
        f.fillRect(x, y - s, 1, s * 2 + 1);
        f.fillRect(x - s, y, s * 2 + 1, 1);
      } else {
        f.fillRect(x, y, p.size, p.size);
      }
    }
    f.globalAlpha = 1;
  }

  clear(): void {
    for (let i = 0; i < this.pool.length; i++) this.pool[i]!.alive = false;
  }
}
