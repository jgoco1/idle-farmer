// The farmhand's on-screen figure. Purely cosmetic: the game logic harvests and plants in one tick,
// and this sprite merely wanders to the plots those events name, on the render clock. It never
// blocks or drives anything; a flood of events (an offline catch-up) only trims its queue.

import { TILE } from './scene';

export type FarmhandJob = { col: number; row: number; sprite: string | null };

const SPEED_PX_PER_S = 56;
const WORK_MS = 320;
const MAX_QUEUE = 6;
/** Where the farmhand waits: on the grass left of the fence (tile (4,4)). */
export const REST_TILE = { col: 4, row: 4 } as const;

export type FarmhandPose = 'walk' | 'idle' | 'pop';

export class FarmhandVisual {
  /** Feet position in scene pixels. */
  x = REST_TILE.col * TILE + TILE / 2;
  y = (REST_TILE.row + 1) * TILE - 2;
  facingLeft = false;
  pose: FarmhandPose = 'idle';
  private queue: FarmhandJob[] = [];
  private working: { job: FarmhandJob; left: number } | null = null;
  private last: number | null = null;

  /** Called when a job is finished (the harvest pop), so the renderer can show the item rising. */
  onWork: ((job: FarmhandJob) => void) | null = null;

  enqueue(job: FarmhandJob): void {
    if (this.queue.some((j) => j.col === job.col && j.row === job.row)) return;
    this.queue.push(job);
    if (this.queue.length > MAX_QUEUE) this.queue.shift();
  }

  get pending(): number {
    return this.queue.length + (this.working ? 1 : 0);
  }

  private moveTo(tx: number, ty: number, dt: number): boolean {
    const dx = tx - this.x;
    const dy = ty - this.y;
    const dist = Math.hypot(dx, dy);
    const step = (SPEED_PX_PER_S * dt) / 1000;
    if (dist <= step) {
      this.x = tx;
      this.y = ty;
      return true;
    }
    this.x += (dx / dist) * step;
    this.y += (dy / dist) * step;
    if (Math.abs(dx) > 0.5) this.facingLeft = dx < 0;
    return false;
  }

  /** Advances the figure to render time `timeMs`. */
  update(timeMs: number): void {
    const dt = this.last === null ? 0 : Math.min(200, Math.max(0, timeMs - this.last));
    this.last = timeMs;
    if (this.working) {
      this.pose = 'pop';
      this.working.left -= dt;
      if (this.working.left <= 0) {
        this.onWork?.(this.working.job);
        this.working = null;
      }
      return;
    }
    const job = this.queue[0];
    if (job) {
      this.pose = 'walk';
      const tx = job.col * TILE + TILE / 2;
      const ty = (job.row + 1) * TILE - 2;
      if (this.moveTo(tx, ty, dt)) {
        this.queue.shift();
        this.working = { job, left: WORK_MS };
      }
      return;
    }
    const home = { x: REST_TILE.col * TILE + TILE / 2, y: (REST_TILE.row + 1) * TILE - 2 };
    this.pose = this.moveTo(home.x, home.y, dt) ? 'idle' : 'walk';
  }

  /** Forgets everything (the farmhand was not hired, or the save changed). */
  reset(): void {
    this.queue = [];
    this.working = null;
    this.x = REST_TILE.col * TILE + TILE / 2;
    this.y = (REST_TILE.row + 1) * TILE - 2;
    this.pose = 'idle';
  }
}
