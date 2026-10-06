// The farmhand's on-screen figure. Purely cosmetic: the game logic harvests and plants in one tick,
// and this sprite merely wanders to the plots those events name, on the render clock. It never
// blocks or drives anything; a flood of events (an offline catch-up) only trims its queue.
//
// v4-01 (GDD §13.3): with north fields the figure works one field at a time, the one it is in first.
// Between fields it never walks through a fence: out through the field's gate, along its path to the
// north road, up or down the road, and in through the next field's gate, trotting at twice its
// walking speed on those connecting paths. It rests by the gate of the field it worked last. The
// waypoints are data (`WORLD_LAYOUT.northFields`, the home path's gates from `pathFor`).

import type { NorthFieldId } from '../data/ids';
import { WORLD_LAYOUT } from '../data/world';
import { pathFor, TILE, type Grid } from './scene';

/** Where a job is: the home farm (field, greenhouse and orchard, with no fence between) or a north field. */
export type FarmArea = 'home' | NorthFieldId;

export type FarmhandJob = { col: number; row: number; sprite: string | null; area?: FarmArea };

const SPEED_PX_PER_S = 56;
/** On the paths between fields the farmhand trots. */
const TROT = 2;
const WORK_MS = 320;
const MAX_QUEUE = 6;
/** Where the farmhand waits at home: on the grass left of the fence (tile (4,4)). */
export const REST_TILE = { col: 4, row: 4 } as const;

export type FarmhandPose = 'walk' | 'idle' | 'pop';

type Point = { x: number; y: number };

/** The feet position on a tile. */
function feet(col: number, row: number): Point {
  return { x: col * TILE + TILE / 2, y: (row + 1) * TILE - 2 };
}

/** From inside an area out to the north road (in walking order); reversed, the way in. */
function exitRoute(area: FarmArea, grid: Grid): Point[] {
  const road = WORLD_LAYOUT.northRoadCol;
  if (area !== 'home') {
    const n = WORLD_LAYOUT.northFields[area];
    // The first plot inside the gate, the gate, its path and the road: straight lines that never clip the fence.
    const inside = { col: n.gate.col - 1, row: n.gate.row };
    return [inside, n.gate, ...n.path, { col: road, row: n.gate.row }].map((t) => feet(t.col, t.row));
  }
  // Home: out through the home fence's east gate (or past it while the field is small), down the path
  // to the Shipping Bin and along the lane to the road.
  const east = pathFor(grid).gates.find((g) => g.col > REST_TILE.col);
  const tiles: { col: number; row: number }[] = !east
    ? [
        { col: 14, row: 5 },
        { col: 14, row: 9 },
      ]
    : east.sprite === 'obj_fence_gate_h'
      ? [east, { col: east.col, row: 9 }]
      : [east, { col: 14, row: east.row }, { col: 14, row: 9 }];
  tiles.push({ col: road, row: 9 });
  return tiles.map((t) => feet(t.col, t.row));
}

export class FarmhandVisual {
  /** Feet position in scene pixels. */
  x = REST_TILE.col * TILE + TILE / 2;
  y = (REST_TILE.row + 1) * TILE - 2;
  facingLeft = false;
  pose: FarmhandPose = 'idle';
  /** The area the figure is in (it rests by this area's gate). */
  area: FarmArea = 'home';
  private queue: FarmhandJob[] = [];
  private working: { job: FarmhandJob; left: number } | null = null;
  private last: number | null = null;
  /** Waypoints still to walk between areas (built once per change of area, never per frame). */
  private route: Point[] = [];
  /** In a north field: waiting outside its gate (at its rest tile) rather than among the plots. */
  private outside = false;
  private grid: Grid = { cols: 4, rows: 2 };

  /** Called when a job is finished (the harvest pop), so the renderer can show the item rising. */
  onWork: ((job: FarmhandJob) => void) | null = null;

  /** The home field's size (its gates move as it grows). */
  setGrid(grid: Grid): void {
    this.grid = grid;
  }

  enqueue(job: FarmhandJob): void {
    if (this.queue.some((j) => j.col === job.col && j.row === job.row)) return;
    this.queue.push(job);
    if (this.queue.length > MAX_QUEUE) this.queue.shift();
  }

  get pending(): number {
    return this.queue.length + (this.working ? 1 : 0);
  }

  /** Whether the figure is on its way between two areas. */
  get travelling(): boolean {
    return this.route.length > 0;
  }

  private moveTo(tx: number, ty: number, dt: number, speed = 1): boolean {
    const dx = tx - this.x;
    const dy = ty - this.y;
    const dist = Math.hypot(dx, dy);
    const step = (SPEED_PX_PER_S * speed * dt) / 1000;
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

  /** Plans the walk from the current area to `to`: out to the road, along it, and in. */
  private travel(to: FarmArea): void {
    // Waiting outside a gate already: the first two waypoints (inside the gate, the gate) are behind it.
    const out = exitRoute(this.area, this.grid).slice(this.outside ? 2 : 0);
    const back = exitRoute(to, this.grid).reverse();
    this.route = [...out, ...back];
    this.area = to;
    this.outside = false;
  }

  /** In or out through the gate of the north field it is in (`out`: to its rest tile on the path). */
  private throughGate(out: boolean): void {
    if (this.area === 'home') return;
    const n = WORLD_LAYOUT.northFields[this.area];
    const inside = feet(n.gate.col - 1, n.gate.row);
    const gate = feet(n.gate.col, n.gate.row);
    this.route = out ? [inside, gate, feet(n.rest.col, n.rest.row)] : [gate, inside];
    this.outside = out;
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
    if (this.route.length > 0) {
      this.pose = 'walk';
      const p = this.route[0]!;
      if (this.moveTo(p.x, p.y, dt, TROT)) this.route.shift();
      return;
    }
    // One field at a time: the jobs in the area it is in first, then the oldest job elsewhere.
    let k = 0;
    while (k < this.queue.length && (this.queue[k]!.area ?? 'home') !== this.area) k++;
    if (k === this.queue.length) k = 0;
    const job = this.queue[k];
    if (job) {
      const area = job.area ?? 'home';
      if (area !== this.area) {
        this.travel(area);
        return;
      }
      if (this.outside) {
        this.throughGate(false);
        return;
      }
      this.pose = 'walk';
      const tx = job.col * TILE + TILE / 2;
      const ty = (job.row + 1) * TILE - 2;
      if (this.moveTo(tx, ty, dt)) {
        this.queue.splice(k, 1);
        this.working = { job, left: WORK_MS };
      }
      return;
    }
    if (this.area !== 'home' && !this.outside) {
      this.throughGate(true);
      return;
    }
    const rest = this.area === 'home' ? REST_TILE : WORLD_LAYOUT.northFields[this.area].rest;
    const hx = rest.col * TILE + TILE / 2;
    const hy = (rest.row + 1) * TILE - 2;
    this.pose = this.moveTo(hx, hy, dt) ? 'idle' : 'walk';
  }

  /** Forgets everything (the farmhand was not hired, or the save changed). */
  reset(): void {
    this.queue = [];
    this.working = null;
    this.route = [];
    this.area = 'home';
    this.outside = false;
    this.x = REST_TILE.col * TILE + TILE / 2;
    this.y = (REST_TILE.row + 1) * TILE - 2;
    this.pose = 'idle';
  }
}
