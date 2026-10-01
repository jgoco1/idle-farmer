// Decorate mode (GDD §12.2): a toggle in the scene controls switches clicks from farm tools to decorating.
// Pick a piece from the stock tray, see a grid-snapped ghost (green where it can stand, red with the reason
// as a tooltip where it cannot), click to place; click a placed piece to pick it up (it follows the pointer
// and keeps its place until dropped), click a free tile to drop it there, or pick it back into the stock.
// F flips a piece whose sprite allows it. All rules are in src/systems/decor.ts; this only sends actions.

import type { Action } from '../core/actions';
import type { GameState } from '../core/state';
import type { GameData } from '../data';
import { DECOR_IDS, type DecorId } from '../data/ids';
import type { DecorGhost } from '../render/renderer';
import { spriteDataUrl } from '../render/spriteCache';
import type { ActionResult } from '../systems/context';
import { decorAt, decorPlacementProblem, decorStock, slotsUsed } from '../systems/decor';
import { decorSlotCap } from '../systems/townProjects';
import { h } from './dom';

export interface DecorateHooks {
  data: GameData;
  state(): GameState;
  dispatch(action: Action): ActionResult;
  toast(text: string, tone?: 'info' | 'good' | 'warn'): void;
  /** Tells the renderer: Decorate mode on or off. */
  setMode(on: boolean): void;
  setGhost(g: DecorGhost | null): void;
  /** Called after the mode changes, so the scene button can show its pressed state. */
  onChange(on: boolean): void;
}

export class DecorateMode {
  on = false;
  /** The piece chosen from the tray (to place), or null. */
  selected: DecorId | null = null;
  flipped = false;
  /** The id of a placed piece being moved, or null. */
  holding: number | null = null;
  private readonly tray: HTMLElement;
  private readonly status: HTMLElement;
  private readonly pieces: HTMLElement;
  private signature = '';
  private problem: ((col: number, row: number) => string | null) | null = null;

  constructor(private readonly hooks: DecorateHooks) {
    this.status = h('span', { class: 'decor-status', role: 'status' });
    this.pieces = h('div', { class: 'decor-tray-pieces', role: 'listbox', 'aria-label': 'Decoration stock' });
    const flip = h('button', {
      type: 'button',
      class: 'btn btn-small',
      'data-decor-flip': '',
      text: 'Flip (F)',
    });
    flip.addEventListener('click', () => this.flip());
    const pick = h('button', {
      type: 'button',
      class: 'btn btn-small',
      'data-decor-pickup': '',
      text: 'Pick up (Del)',
    });
    pick.addEventListener('click', () => this.pickUp());
    const done = h('button', { type: 'button', class: 'btn btn-small btn-primary', text: 'Done' });
    done.addEventListener('click', () => this.stop());
    this.tray = h(
      'div',
      { class: 'decor-tray', hidden: true, 'data-testid': 'decor-tray' },
      h('div', { class: 'decor-tray-head' }, this.status, flip, pick, done),
      this.pieces,
    );
    document.body.append(this.tray);
    document.addEventListener('keydown', (e) => this.key(e));
  }

  /** Why the piece in hand cannot stand at (col, row), or null (for the tooltip over a red footprint). */
  problemAt(col: number, row: number): string | null {
    return this.problem ? this.problem(col, row) : null;
  }

  start(select?: DecorId): void {
    this.on = true;
    this.holding = null;
    this.selected = select ?? this.selected;
    this.tray.hidden = false;
    this.hooks.setMode(true);
    this.hooks.onChange(true);
    this.refresh(true);
  }

  stop(): void {
    this.on = false;
    this.selected = null;
    this.holding = null;
    this.tray.hidden = true;
    this.hooks.setMode(false);
    this.hooks.setGhost(null);
    this.hooks.onChange(false);
  }

  toggle(): void {
    if (this.on) this.stop();
    else this.start();
  }

  private key(e: KeyboardEvent): void {
    if (!this.on) return;
    const t = e.target;
    if (t instanceof Element && t.closest('input, textarea, select, .panel-host, .modal, [role="dialog"]'))
      return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === 'f') {
      e.preventDefault();
      this.flip();
    } else if (k === 'Delete' || k === 'Backspace' || k === 'x') {
      e.preventDefault();
      this.pickUp();
    } else if (k === 'Escape') {
      e.preventDefault();
      if (this.holding !== null || this.selected) {
        this.holding = null;
        this.selected = null;
        this.refresh(true);
      } else this.stop();
    }
  }

  /** The piece the ghost shows: the one in hand, or the one chosen from the tray. */
  private current(): { id: DecorId; moving: number | undefined } | null {
    const s = this.hooks.state();
    if (this.holding !== null) {
      const p = s.decor.placed.find((x) => x.id === this.holding);
      if (p) return { id: p.decor, moving: p.id };
      this.holding = null;
    }
    return this.selected ? { id: this.selected, moving: undefined } : null;
  }

  flip(): void {
    const cur = this.current();
    if (!cur || !this.hooks.data.decor[cur.id].flips) {
      this.hooks.toast('That piece cannot be flipped.');
      return;
    }
    this.flipped = !this.flipped;
    if (cur.moving !== undefined) {
      const p = this.hooks.state().decor.placed.find((x) => x.id === cur.moving)!;
      this.hooks.dispatch({
        type: 'moveDecor',
        id: p.id,
        col: p.at.col,
        row: p.at.row,
        flipped: this.flipped,
      });
    }
    this.refresh(true);
  }

  pickUp(): void {
    if (this.holding === null) {
      this.hooks.toast('Click a placed piece first, then pick it up.');
      return;
    }
    const r = this.hooks.dispatch({ type: 'pickUpDecor', id: this.holding });
    if (!r.ok) this.hooks.toast(r.reason, 'warn');
    this.holding = null;
    this.refresh(true);
  }

  /** A click on world tile (col, row) while Decorate mode is on. */
  click(col: number, row: number): void {
    const s = this.hooks.state();
    const data = this.hooks.data;
    if (this.holding !== null) {
      const r = this.hooks.dispatch({ type: 'moveDecor', id: this.holding, col, row, flipped: this.flipped });
      if (!r.ok) this.hooks.toast(r.reason, 'warn');
      else this.holding = null;
      this.refresh(true);
      return;
    }
    const there = decorAt(s, data, col, row);
    if (there && !this.selected) {
      this.holding = there.id;
      this.flipped = there.flipped === true;
      this.refresh(true);
      return;
    }
    if (!this.selected) {
      if (there) return;
      this.hooks.toast('Choose a piece from the tray, or click a placed one to move it.');
      return;
    }
    if (there) {
      // With a piece chosen, a click on a placed one picks that one up instead.
      this.selected = null;
      this.holding = there.id;
      this.flipped = there.flipped === true;
      this.refresh(true);
      return;
    }
    const r = this.hooks.dispatch({
      type: 'placeDecor',
      decor: this.selected,
      col,
      row,
      flipped: this.flipped,
    });
    if (!r.ok) this.hooks.toast(r.reason, 'warn');
    else if (decorStock(this.hooks.state(), data, this.selected) <= 0) this.selected = null;
    this.refresh(true);
  }

  /** Rebuilds the tray when the stock changed, and keeps the ghost current. `force` redraws regardless. */
  refresh(force = false): void {
    if (!this.on) return;
    const s = this.hooks.state();
    const data = this.hooks.data;
    const stock = DECOR_IDS.filter((id) => data.decor[id].kind === 'place' && decorStock(s, data, id) > 0);
    if (this.selected && !stock.includes(this.selected)) this.selected = null;
    const sig = `${stock.map((id) => `${id}${decorStock(s, data, id)}`).join(',')}|${this.selected}|${this.holding}|${slotsUsed(s)}`;
    const cur = this.current();
    if (force || sig !== this.signature) {
      this.signature = sig;
      const chips = stock.map((id) => {
        const def = data.decor[id];
        const b = h(
          'button',
          {
            type: 'button',
            class: `decor-chip${this.selected === id ? ' is-active' : ''}`,
            role: 'option',
            'aria-selected': String(this.selected === id),
            'data-decor-chip': id,
            title: `${def.name} · charm ${def.charm}`,
          },
          h('img', { class: 'pixel', alt: '', src: spriteDataUrl(def.sprite) }),
          h('span', { class: 'decor-chip-count', text: String(decorStock(s, data, id)) }),
        );
        b.addEventListener('click', () => {
          this.selected = this.selected === id ? null : id;
          this.holding = null;
          this.flipped = false;
          this.refresh(true);
        });
        return b;
      });
      this.pieces.replaceChildren(
        ...(chips.length > 0
          ? chips
          : [h('span', { class: 'muted', text: 'Nothing in stock: buy pieces in the Shop, under Decor.' })]),
      );
    }
    const cap = decorSlotCap(s, data);
    this.status.textContent = cur
      ? `${this.holding !== null ? 'Moving' : 'Placing'} ${data.decor[cur.id].name} · click a free tile${this.holding !== null ? '' : ' · click a placed piece to move it'}`
      : `Decorate · ${slotsUsed(s)} / ${cap} slots · pick a piece below, or click a placed one to move it`;
    if (!cur) {
      this.problem = null;
      this.hooks.setGhost(null);
    } else {
      const def = data.decor[cur.id];
      const moving = cur.moving;
      this.problem = (col, row) => decorPlacementProblem(this.hooks.state(), data, cur.id, col, row, moving);
      this.hooks.setGhost({
        cols: def.size.cols,
        rows: def.size.rows,
        sprite: def.sprite,
        flipped: this.flipped && def.flips === true,
        problemAt: this.problem,
      });
    }
  }
}
