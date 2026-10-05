// Dragging stacks around the Inventory grid (polish after v4-00). A mouse drags as soon as it moves a few
// pixels; a finger first holds still for a moment (a long press), so an ordinary swipe still scrolls the bag
// on a phone. While a stack is held, a copy of its icon follows the pointer and the slot under it is marked;
// letting go over another slot calls `onDrop(from, to)` (the panel dispatches `moveStack`). The grid's slots
// are `.inv-slot` elements with `data-slot` set to their index; empty ones carry `.is-empty`.

/** How far (CSS px) a mouse moves before a press becomes a drag. */
const DRAG_PX = 6;
/** How long a finger holds still before it picks a stack up. */
const LONG_PRESS_MS = 300;
/** How far a finger may wander during that hold before it counts as a scroll. */
const TOUCH_SLOP_PX = 8;

export interface BagDrag {
  /** True while a stack is held: the panel does not rebuild the grid under it. */
  active(): boolean;
  /** Puts a held stack back (the panel closed). */
  cancel(): void;
  /** True once, right after a drag ended, so the click that follows a mouse drag is not a selection. */
  consumeClick(): boolean;
}

interface Press {
  from: number;
  pointerId: number;
  x0: number;
  y0: number;
  touch: boolean;
  timer: number;
  held: boolean;
  source: HTMLElement;
  ghost: HTMLElement | null;
  over: HTMLElement | null;
}

export function attachBagDrag(grid: HTMLElement, onDrop: (from: number, to: number) => void): BagDrag {
  let press: Press | null = null;
  let swallowClick = false;

  const slotAt = (x: number, y: number): HTMLElement | null => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('.inv-slot') ?? null;
    return el && grid.contains(el) ? el : null;
  };

  const mark = (el: HTMLElement | null): void => {
    if (!press || press.over === el) return;
    press.over?.classList.remove('is-drop-target');
    press.over = el && el !== press.source ? el : null;
    press.over?.classList.add('is-drop-target');
  };

  const place = (x: number, y: number): void => {
    if (!press?.ghost) return;
    press.ghost.style.left = `${x}px`;
    press.ghost.style.top = `${y}px`;
  };

  const pickUp = (x: number, y: number): void => {
    if (!press) return;
    press.held = true;
    swallowClick = true;
    press.source.classList.add('is-drag-source');
    const ghost = document.createElement('div');
    ghost.className = 'inv-ghost';
    ghost.setAttribute('aria-hidden', 'true');
    const icon = press.source.querySelector('img');
    if (icon) ghost.append(icon.cloneNode(true));
    document.body.append(ghost);
    press.ghost = ghost;
    place(x, y);
    mark(slotAt(x, y));
  };

  const end = (): void => {
    if (!press) return;
    window.clearTimeout(press.timer);
    press.source.classList.remove('is-drag-source');
    press.over?.classList.remove('is-drop-target');
    press.ghost?.remove();
    press = null;
  };

  grid.addEventListener('pointerdown', (e) => {
    if (press || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const source = (e.target as HTMLElement).closest<HTMLElement>('.inv-slot');
    if (!source || source.classList.contains('is-empty') || !grid.contains(source)) return;
    swallowClick = false;
    const touch = e.pointerType !== 'mouse';
    press = {
      from: Number(source.dataset.slot),
      pointerId: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      touch,
      timer: 0,
      held: false,
      source,
      ghost: null,
      over: null,
    };
    if (touch) {
      const { clientX, clientY } = e;
      press.timer = window.setTimeout(() => {
        if (press && !press.held) pickUp(clientX, clientY);
      }, LONG_PRESS_MS);
    }
  });

  window.addEventListener('pointermove', (e) => {
    if (!press || e.pointerId !== press.pointerId) return;
    if (!press.held) {
      const d = Math.hypot(e.clientX - press.x0, e.clientY - press.y0);
      if (press.touch) {
        if (d > TOUCH_SLOP_PX) end(); // a swipe: let the bag scroll
      } else if (d > DRAG_PX) pickUp(e.clientX, e.clientY);
      return;
    }
    place(e.clientX, e.clientY);
    mark(slotAt(e.clientX, e.clientY));
  });

  window.addEventListener('pointerup', (e) => {
    if (!press || e.pointerId !== press.pointerId) return;
    const held = press.held;
    const from = press.from;
    const target = held ? slotAt(e.clientX, e.clientY) : null;
    end();
    if (target) {
      const to = Number(target.dataset.slot);
      if (to !== from) onDrop(from, to);
    }
  });
  window.addEventListener('pointercancel', (e) => {
    if (press && e.pointerId === press.pointerId) end();
  });

  // A held finger must not scroll the bag, and a long press must not open the browser's menu.
  grid.addEventListener(
    'touchmove',
    (e) => {
      if (press?.held) e.preventDefault();
    },
    { passive: false },
  );
  // The slots' icons are images: the browser's own image drag would cancel the pointer.
  grid.addEventListener('dragstart', (e) => e.preventDefault());
  grid.addEventListener('contextmenu', (e) => {
    if (press) e.preventDefault();
  });

  return {
    active: () => press?.held === true,
    cancel: end,
    consumeClick() {
      const s = swallowClick;
      swallowClick = false;
      return s;
    },
  };
}
