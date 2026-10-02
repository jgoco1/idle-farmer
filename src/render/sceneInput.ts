// Scene input rules added in v2-05, kept pure so they can be tested without a DOM (the renderer feeds them pointer
// events): tap-to-inspect on touch screens, when a press paints instead of panning, and the walk of a paint stroke.

/** What a touch tap is inspecting: the first tap on a tree or an animal shows its label, the second acts. */
export const INSPECT_NONE = 0;
export const INSPECT_TREE = 1;
export const INSPECT_ANIMAL = 2;
export type InspectKind = typeof INSPECT_NONE | typeof INSPECT_TREE | typeof INSPECT_ANIMAL;

export interface Inspected {
  kind: InspectKind;
  /** The tree's or the animal's id (-1 with nothing). */
  id: number;
}

/**
 * A tap or click on a tree or an animal. A mouse click always acts (desktop labels come from hovering). A touch tap
 * on something not yet inspected only selects it for its label and returns false; a second tap on the same thing
 * returns true, and it stays selected so its label keeps showing what changed.
 */
export function tapActs(inspected: Inspected, kind: InspectKind, id: number, touch: boolean): boolean {
  if (!touch) return true;
  if (inspected.kind === kind && inspected.id === id) return true;
  inspected.kind = kind;
  inspected.id = id;
  return false;
}

export function clearInspected(inspected: Inspected): void {
  inspected.kind = INSPECT_NONE;
  inspected.id = -1;
}

/**
 * Whether a one-pointer press may start a paint stroke: Paint mode is on, or (on desktop) Alt is held. Never in
 * Decorate, planting or building mode, which route every press to placement.
 */
export function paintArmed(
  paintMode: boolean,
  pointerType: string,
  altKey: boolean,
  decorateMode: boolean,
): boolean {
  if (decorateMode) return false;
  return paintMode || (pointerType === 'mouse' && altKey);
}

/**
 * One paint stroke: the plots it has used, so each gets the tool once, and the last pointer position. `walk` steps
 * along the segment to the new position at most `stepPx` apart, so a quick drag skips no plot between two events.
 */
export class PaintStroke {
  private readonly visited = new Set<number>();
  private x = 0;
  private y = 0;

  constructor(firstPlot: number, x: number, y: number) {
    this.visited.add(firstPlot);
    this.x = x;
    this.y = y;
  }

  walk(
    x: number,
    y: number,
    stepPx: number,
    plotAt: (x: number, y: number) => number,
    onPlot: (plot: number) => void,
  ): void {
    const dist = Math.hypot(x - this.x, y - this.y);
    const steps = Math.max(1, Math.ceil(dist / Math.max(1, stepPx)));
    for (let i = 1; i <= steps; i++) {
      const plot = plotAt(this.x + ((x - this.x) * i) / steps, this.y + ((y - this.y) * i) / steps);
      if (plot < 0 || this.visited.has(plot)) continue;
      this.visited.add(plot);
      onPlot(plot);
    }
    this.x = x;
    this.y = y;
  }

  get plots(): number {
    return this.visited.size;
  }
}
