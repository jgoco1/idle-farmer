// The scene label for a tree or an animal (v2-03 trees, v2-05 animals and touch). Under a mouse it follows the
// hovered tree or animal; on a touch screen the first tap on one sets the renderer's `inspected` target and the
// label shows until the next tap elsewhere or a pan (the second tap picks or pets). A small parchment DOM label
// placed through the camera helpers (a native `title` does not show on touch screens or in screenshots).
//
// Per frame it compares a few numbers and does no string work unless the target, its numbers or its place changed.

import type { GameState } from '../core/state';
import { formatDuration } from '../core/time';
import type { GameData } from '../data';
import { WORLD_LAYOUT } from '../data/world';
import type { Renderer } from '../render/renderer';
import { INSPECT_ANIMAL, INSPECT_NONE, INSPECT_TREE } from '../render/sceneInput';
import type { Modifiers } from '../systems/modifiers';
import { daysToMature, treeAtTile, treeStage } from '../systems/orchard';
import { buildingById, levelDef, msToNextProduct, storeCount, storeSize, troughSize } from '../systems/ranch';
import { h } from './dom';

const KIND_NONE = 0;
const KIND_TREE = 1;
const KIND_ANIMAL = 2;

/** Room (CSS px) the label needs above its anchor; with less it goes below. */
const ROOM_ABOVE = 110;

export interface InspectLabelDeps {
  host: HTMLElement;
  renderer: Renderer;
  data: GameData;
  state(): GameState;
  mods(): Modifiers;
}

export class InspectLabel {
  readonly el: HTMLElement;
  private kind = KIND_NONE;
  private id = -1;
  private sig = -1;
  private x = Number.NaN;
  private y = Number.NaN;
  private readonly head = { x: 0, y: 0 };
  private touch = false;

  constructor(private readonly deps: InspectLabelDeps) {
    this.el = h('div', { class: 'tree-tip', role: 'tooltip', hidden: true, 'data-testid': 'tree-tip' });
    deps.host.append(this.el);
  }

  /** Hides the label until the next hover or tap finds something (Decorate, planting and building modes). */
  hide(): void {
    if (this.kind === KIND_NONE) return;
    this.kind = KIND_NONE;
    this.id = -1;
    this.el.hidden = true;
  }

  /** Runs every frame. `dayIndex` is the calendar's (a tree's age and stage depend on it). */
  update(dayIndex: number): void {
    const r = this.deps.renderer;
    const state = this.deps.state();
    let kind = KIND_NONE;
    let id = -1;
    const picked = r.inspected;
    if (picked.kind === INSPECT_TREE) {
      kind = KIND_TREE;
      id = picked.id;
    } else if (picked.kind === INSPECT_ANIMAL) {
      kind = KIND_ANIMAL;
      id = picked.id;
    } else {
      const animal = r.hoverAnimal();
      if (animal >= 0) {
        kind = KIND_ANIMAL;
        id = animal;
      } else {
        const hover = r.hoverTile;
        const tree = hover ? treeAtTile(state, hover.col, hover.row) : undefined;
        if (tree) {
          kind = KIND_TREE;
          id = tree.id;
        }
      }
    }
    this.touch = picked.kind !== INSPECT_NONE;
    if (kind === KIND_TREE) this.showTree(state, id, dayIndex);
    else if (kind === KIND_ANIMAL) this.showAnimal(state, id);
    else this.hide();
  }

  private retarget(kind: number, id: number): void {
    if (this.kind === kind && this.id === id) return;
    this.kind = kind;
    this.id = id;
    this.sig = -1;
    this.x = Number.NaN;
  }

  private showTree(state: GameState, id: number, dayIndex: number): void {
    const tree = state.orchard.trees.find((t) => t.id === id);
    if (!tree) return this.hide();
    this.retarget(KIND_TREE, id);
    const sig = tree.fruit * 1000 + (dayIndex % 1000) + (this.touch ? 0.5 : 0);
    if (sig !== this.sig) {
      this.sig = sig;
      const data = this.deps.data;
      const def = data.trees[tree.tree];
      const stage = treeStage(data, tree, dayIndex);
      const left = daysToMature(data, tree, dayIndex);
      const growth =
        stage === 'mature'
          ? 'Mature'
          : `${stage === 'sapling' ? 'Sapling' : 'Young'}, ${left} day${left === 1 ? '' : 's'} until mature`;
      const act = this.touch ? 'tap again to pick' : 'click to pick';
      this.el.replaceChildren(
        h('strong', { text: `${def.name} tree · ${growth}` }),
        h('span', { text: `Bears in ${def.seasons.join(' and ')}` }),
        h('span', { text: `Fruit ${tree.fruit} / ${def.fruitCap}${tree.fruit > 0 ? ` · ${act}` : ''}` }),
      );
    }
    const spot = WORLD_LAYOUT.treeSpots[tree.spot]!;
    const r = this.deps.renderer;
    const above = r.tileClientCenter(spot.col + 1, spot.row - 1);
    if (this.place(above.x, above.y)) return;
    const below = r.tileClientCenter(spot.col + 1, spot.row + 2);
    this.placeAt(below.x, below.y, true);
  }

  private showAnimal(state: GameState, id: number): void {
    const animal = state.ranch.animals.find((a) => a.id === id);
    const b = animal ? buildingById(state, animal.building) : undefined;
    if (!animal || !b || !this.deps.renderer.ranch.headOf(id, this.head)) return this.hide();
    this.retarget(KIND_ANIMAL, id);
    const data = this.deps.data;
    const def = data.animals[animal.kind];
    const trough = troughSize(state, data, b);
    const stored = storeCount(b);
    const cap = storeSize(data, b);
    const next = msToNextProduct(data, b, this.deps.mods().animalSpeedModifier);
    const secs = Math.ceil(next / 1000);
    // Whole seconds of the countdown, the trough and the store: the text changes at most once a second.
    const sig = ((secs * 1000 + b.trough) * 1000 + stored) * 2 + (this.touch ? 1 : 0);
    if (sig !== this.sig) {
      this.sig = sig;
      const product = data.items[def.product]!.name.toLowerCase();
      const products = def.product === 'milk' ? 'milk' : `${product}s`;
      const home = data.buildings[b.kind].name.toLowerCase();
      const status =
        b.trough <= 0
          ? `The ${def.plural.toLowerCase()} would love some feed`
          : stored >= cap
            ? `The store is full: collect the ${products}`
            : `Next ${products} in ${formatDuration(next)}`;
      this.el.replaceChildren(
        h('strong', { text: `${animal.name} · ${def.name.toLowerCase()}` }),
        h('span', { text: `Lives in the ${home} (level ${b.level}, ${levelDef(data, b).capacity} places)` }),
        h('span', { text: `Trough ${b.trough} / ${trough} · store ${stored} / ${cap}` }),
        h('span', { text: `${status} · ${this.touch ? 'tap again to pet' : 'click to pet'}` }),
      );
    }
    const at = this.deps.renderer.worldToClient(this.head.x, this.head.y - 4);
    if (!this.place(at.x, at.y)) this.placeAt(at.x, at.y + 28, true);
  }

  /** Puts the label above a client point if there is room; false when there is not. */
  private place(clientX: number, clientY: number): boolean {
    const box = this.deps.host.getBoundingClientRect();
    if (clientY - box.top <= ROOM_ABOVE) return false;
    this.placeAt(clientX, clientY, false);
    return true;
  }

  private placeAt(clientX: number, clientY: number, below: boolean): void {
    const box = this.deps.host.getBoundingClientRect();
    const x = Math.round(clientX - box.left);
    const y = Math.round(clientY - box.top);
    if (x !== this.x || y !== this.y) {
      this.x = x;
      this.y = y;
      this.el.classList.toggle('is-below', below);
      this.el.style.left = `${x}px`;
      this.el.style.top = `${y}px`;
    }
    this.el.hidden = false;
  }
}
