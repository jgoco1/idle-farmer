// The reusable panel: a parchment body in a wood frame with a title bar and a close button.
// One panel is open at a time. ESC or the ✕ closes it; its toolbar button toggles it. Focus moves
// into the panel on open and back to whatever opened it on close.
//
// To add a panel: add its id to PanelId (src/data/ids.ts) and a PanelDef in src/ui/panels.ts.

import type { PanelId } from '../data/ids';
import { FOCUSABLE, h } from './dom';

export interface PanelDef {
  id: PanelId;
  title: string;
  icon: string; // short glyph for the toolbar button
  /** Builds the body once; `refresh` (optional) runs each time the panel opens. */
  build(body: HTMLElement): { refresh?(): void } | void;
  /** Hidden from the toolbar (e.g. Settings, which has its own HUD button). */
  toolbar?: boolean;
  /** Re-run `refresh` while open when the game state changes (Inventory, Shop). */
  live?: boolean;
  /** Also re-run `refresh` this often while open (the Market, whose prices drift every tick). */
  refreshMs?: number;
}

interface PanelEntry {
  def: PanelDef;
  root: HTMLElement;
  refresh?: () => void;
}

export class PanelManager {
  private readonly panels = new Map<PanelId, PanelEntry>();
  private openId: PanelId | null = null;
  private lastTimedRefresh = 0;
  private returnFocus: HTMLElement | null = null;
  private readonly listeners = new Set<(id: PanelId | null) => void>();

  constructor(private readonly host: HTMLElement) {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.openId && !e.defaultPrevented) {
        e.preventDefault();
        this.close();
      }
    });
  }

  register(def: PanelDef): void {
    const titleId = `panel-title-${def.id}`;
    const close = h('button', {
      class: 'panel-close',
      type: 'button',
      'aria-label': `Close ${def.title}`,
      text: '✕',
    });
    const body = h('div', { class: 'panel-body' });
    const root = h(
      'section',
      {
        class: 'panel',
        role: 'dialog',
        'aria-labelledby': titleId,
        'data-panel': def.id,
        tabindex: -1,
        hidden: true,
      },
      h('header', { class: 'panel-header' }, h('h2', { id: titleId, text: def.title }), close),
      body,
    );
    close.addEventListener('click', () => this.close());
    this.host.append(root);
    const built = def.build(body) ?? undefined;
    this.panels.set(def.id, { def, root, refresh: built?.refresh });
  }

  get current(): PanelId | null {
    return this.openId;
  }

  defs(): PanelDef[] {
    return [...this.panels.values()].map((p) => p.def);
  }

  onChange(fn: (id: PanelId | null) => void): void {
    this.listeners.add(fn);
  }

  open(id: PanelId): void {
    const entry = this.panels.get(id);
    if (!entry) return;
    if (this.openId === id) return;
    if (this.openId) this.hide(this.openId);
    else this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.openId = id;
    entry.refresh?.();
    entry.root.hidden = false;
    this.host.classList.add('has-panel');
    const first = entry.root.querySelector<HTMLElement>(`.panel-body ${FOCUSABLE}`);
    (first ?? entry.root).focus();
    this.emit();
  }

  /** Refreshes the open panel if it shows live game state. */
  refreshOpen(): void {
    const entry = this.openId ? this.panels.get(this.openId) : undefined;
    if (entry?.def.live) entry.refresh?.();
  }

  /** Runs the open panel's timed refresh when it is due (call every frame). */
  tickOpen(timeMs: number): void {
    const entry = this.openId ? this.panels.get(this.openId) : undefined;
    const every = entry?.def.refreshMs;
    if (!entry || !every || timeMs - this.lastTimedRefresh < every) return;
    this.lastTimedRefresh = timeMs;
    entry.refresh?.();
  }

  toggle(id: PanelId): void {
    if (this.openId === id) this.close();
    else this.open(id);
  }

  close(): void {
    if (!this.openId) return;
    this.hide(this.openId);
    this.openId = null;
    this.host.classList.remove('has-panel');
    this.returnFocus?.focus();
    this.returnFocus = null;
    this.emit();
  }

  private hide(id: PanelId): void {
    const entry = this.panels.get(id);
    if (entry) entry.root.hidden = true;
  }

  private emit(): void {
    this.listeners.forEach((fn) => fn(this.openId));
  }
}
