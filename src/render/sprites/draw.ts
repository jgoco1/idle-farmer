// A tiny drawing kit for the v2 sprites (ART_STYLE.md §6): a character canvas with filled shapes, so
// large pieces (the town's buildings, the decoration sets) are written as a few shapes rather than
// thousands of characters. It makes the same kind of grid every hand-written sprite is, palette keys
// only, and the sprite tests check the result like any other sprite.

import { outlined } from './types';

export class Pix {
  private readonly g: string[][];

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.g = Array.from({ length: h }, () => Array.from({ length: w }, () => '.'));
  }

  set(x: number, y: number, ch: string): this {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.g[y]![x] = ch;
    return this;
  }

  get(x: number, y: number): string {
    return this.g[y]?.[x] ?? '.';
  }

  rect(x: number, y: number, w: number, h: number, ch: string): this {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, ch);
    return this;
  }

  /** A 1 px border of `ch` around the rectangle (no fill). */
  frame(x: number, y: number, w: number, h: number, ch: string): this {
    this.hline(x, y, w, ch)
      .hline(x, y + h - 1, w, ch)
      .vline(x, y, h, ch)
      .vline(x + w - 1, y, h, ch);
    return this;
  }

  hline(x: number, y: number, len: number, ch: string): this {
    return this.rect(x, y, len, 1, ch);
  }

  vline(x: number, y: number, len: number, ch: string): this {
    return this.rect(x, y, 1, len, ch);
  }

  line(x0: number, y0: number, x1: number, y1: number, ch: string): this {
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    let x = x0;
    let y = y0;
    for (;;) {
      this.set(x, y, ch);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
    return this;
  }

  /** A filled ellipse centred on (cx, cy) (centres may be half-integers for even sizes). */
  ellipse(cx: number, cy: number, rx: number, ry: number, ch: string): this {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const nx = (x - cx) / (rx + 0.35);
        const ny = (y - cy) / (ry + 0.35);
        if (nx * nx + ny * ny <= 1) this.set(x, y, ch);
      }
    return this;
  }

  /** A rectangle shaded from the top-left: light on its top and left edges, dark on its bottom and right. */
  shaded(x: number, y: number, w: number, h: number, base: string, light: string, dark: string): this {
    this.rect(x, y, w, h, base);
    this.hline(x, y, w, light).vline(x, y, h, light);
    this.hline(x, y + h - 1, w, dark).vline(x + w - 1, y, h, dark);
    this.set(x, y + h - 1, base).set(x + w - 1, y, base);
    return this;
  }

  /** Draws `rows` with its top-left at (x, y); `.` is transparent. */
  paste(rows: readonly string[], x: number, y: number): this {
    rows.forEach((row, j) =>
      [...row].forEach((ch, i) => {
        if (ch !== '.') this.set(x + i, y + j, ch);
      }),
    );
    return this;
  }

  /** Replaces one key with another everywhere. */
  swap(from: string, to: string): this {
    for (const row of this.g) for (let i = 0; i < row.length; i++) if (row[i] === from) row[i] = to;
    return this;
  }

  /** The grid as rows. */
  rows(): string[] {
    return this.g.map((r) => r.join(''));
  }

  /** The grid with a 1 px `k` outline ring around every shape (author the fills at least 1 px inside the edge). */
  outlinedRows(): string[] {
    return outlined(this.rows());
  }
}

/** Rows of sprite `rows`, mirrored left to right. */
export function mirrored(rows: readonly string[]): string[] {
  return rows.map((r) => [...r].reverse().join(''));
}

/** The rows of `a` with every opaque pixel of `b` drawn over it (same size). */
export function overlay(a: readonly string[], b: readonly string[]): string[] {
  return a.map((row, y) =>
    [...row].map((ch, x) => (b[y]?.[x] && b[y]![x] !== '.' ? b[y]![x]! : ch)).join(''),
  );
}
