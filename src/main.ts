// Browser entry point: load the save, catch up offline time, and wire the game to the renderer,
// the UI, the loop and autosave.

import './styles.css';
import { Game } from './core/game';
import { startLoop } from './core/loop';
import type { OfflineReport } from './core/offline';
import {
  AUTOSAVE_MS,
  clearSave,
  exportSave,
  importSave,
  loadGame,
  SaveError,
  toSaveFile,
  writeSave,
  type SaveStorage,
} from './core/save';
import { createInitialState } from './core/state';
import { systemLocalClock } from './core/time';
import { GAME_DATA } from './data';
import type { CropId } from './data/ids';
import { applyPaletteCssVars } from './render/palette';
import { Renderer } from './render/renderer';
import { BIN_TILE, PLOT_ORIGIN, plotSprites, tileOfPlot, trapTile } from './render/scene';
import {
  allPlotIndexes,
  autoToolFor,
  isReady,
  plotAt,
  plotStage,
  type ConcreteTool,
} from './systems/farming';
import { areaOf, areaOffsets, inGrid, objectAt, placementProblem, stockOf } from './systems/placement';
import { PlacementMode } from './ui/placement';
import { fishingPanel } from './ui/fishingPanel';
import { expansionFor, isLocationUnlocked } from './systems/locations';
import { trapItemCount } from './systems/traps';
import { unlockHints } from './systems/unlocks';
import { LOCATION_NAMES } from './data/fish';
import type { FishLocationId } from './data/ids';
import { computeModifiers } from './systems/modifiers';
import { showAwaySummary, type AwayFarm } from './ui/awaySummary';
import { byId, h } from './ui/dom';
import { FarmTools } from './ui/farmTools';
import { Hud } from './ui/hud';
import { showModal } from './ui/modal';
import { PanelManager } from './ui/panel';
import { goldPopupAt } from './ui/goldFx';
import { marketPanel } from './ui/marketPanel';
import { inventoryPanel, settingsPanel, shopPanel, STUB_PANELS, type GameViewHooks } from './ui/panels';
import { kitchenPanel } from './ui/kitchenPanel';
import { upgradesPanel } from './ui/upgradesPanel';
import type { Action } from './core/actions';
import type { ActionResult } from './systems/context';
import { Toasts } from './ui/toast';
import { buildToolbar } from './ui/toolbar';

applyPaletteCssVars(document.documentElement);

const lc = systemLocalClock;
const now = (): number => Date.now();

function safeStorage(): SaveStorage {
  try {
    const s = window.localStorage;
    s.getItem('probe');
    return s;
  } catch {
    const mem = new Map<string, string>();
    return {
      getItem: (k) => mem.get(k) ?? null,
      setItem: (k, v) => void mem.set(k, v),
      removeItem: (k) => void mem.delete(k),
    };
  }
}
const storage = safeStorage();

// ---- load
const loaded = loadGame(storage, now(), lc);
/** While a broken save is on disk, never autosave over it until the player chooses. */
let saveBlocked = loaded.kind === 'error';
const initialFile = loaded.kind === 'error' ? null : loaded.file;
const game = new Game(initialFile?.state ?? createInitialState(now(), lc), { data: GAME_DATA, lc, now });

function save(): void {
  if (saveBlocked) return;
  try {
    writeSave(storage, toSaveFile(game.state, now()));
  } catch (e) {
    console.warn('Save failed', e);
  }
}

// ---- UI
const toasts = new Toasts(byId('toasts'));
const hud = new Hud(byId('hud'));
const panels = new PanelManager(byId('panel-host'));
const view: GameViewHooks = {
  data: GAME_DATA,
  state: () => game.state,
  calendar: () => game.calendar(),
  mods: () => computeModifiers(game.state, GAME_DATA, game.calendar().season),
};
const placement = new PlacementMode(() => syncPlacement());
const stubPanel = (id: string) => STUB_PANELS.find((d) => d.id === id)!;
// Registration order is the toolbar order.
const dispatch = (action: Action): ActionResult => game.dispatch(action);
panels.register(inventoryPanel({ ...view, dispatch }));
panels.register(
  shopPanel({
    ...view,
    buySeeds: (crop, qty) => game.dispatch({ type: 'buySeeds', crop, qty }),
    buyRecipe: (recipe) => game.dispatch({ type: 'buyRecipe', recipe }),
  }),
);
panels.register(
  marketPanel({
    ...view,
    sell: (item, qty) => game.dispatch({ type: 'sell', item, qty }),
    ship: (item, qty) => game.dispatch({ type: 'ship', item, qty }),
    unship: (item) => game.dispatch({ type: 'unship', item }),
  }),
);
panels.register(kitchenPanel({ ...view, dispatch }));
const fishing = fishingPanel({
  ...view,
  bus: game.bus,
  dispatch: (action) => game.dispatch(action),
  lockedHint(location) {
    const exp = expansionFor(GAME_DATA, location);
    if (!exp) return '';
    const needs = unlockHints(game.state, GAME_DATA, exp.requires).join(' ');
    return `${LOCATION_NAMES[location]}: ${exp.name}, ${exp.price.toLocaleString('en-US')}g in Upgrades. ${needs}`.trim();
  },
});
panels.register(fishing.def);
panels.register(
  upgradesPanel({
    ...view,
    buyExpansion: (id) => game.dispatch({ type: 'buyExpansion', id }),
    buyUpgrade: (id) => game.dispatch({ type: 'buyUpgrade', id }),
    place: (kind) => {
      panels.close();
      placement.start(kind);
    },
    setAutoSell: (item, on) => game.dispatch({ type: 'setAutoSell', item, on }),
  }),
);
panels.register(stubPanel('goals'));
panels.register(
  settingsPanel({
    getVolume: () => game.state.settings.masterVolume,
    setVolume: (value) => void game.dispatch({ type: 'setMasterVolume', value }),
    getRelaxedFishing: () => game.state.settings.relaxedFishing,
    setRelaxedFishing: (on) => void game.dispatch({ type: 'setRelaxedFishing', on }),
    exportSave: () => exportSave(toSaveFile(game.state, now())),
    importSave(text) {
      try {
        const file = importSave(text);
        game.replaceState(file.state);
        saveBlocked = false;
        const report = game.catchUp(file.savedAt, now());
        onResume(report);
        return null;
      } catch (e) {
        return e instanceof SaveError ? e.message : 'That save could not be imported.';
      }
    },
    hardReset() {
      clearSave(storage);
      game.replaceState(createInitialState(now(), lc));
      saveBlocked = false;
      save();
      panels.close();
      toasts.show('A fresh start. Welcome to your new farm!', 'good');
    },
  }),
);
hud.settingsButton.addEventListener('click', () => panels.toggle('settings'));
buildToolbar(byId('toolbar'), panels);
const tools = new FarmTools(byId('toolbar'), view);

game.bus.on('notify', (e) => toasts.show(e.text, e.tone));
game.bus.on('recipeLearned', (e) => {
  toasts.show(`New recipe: ${GAME_DATA.recipes[e.recipe].name}! Find it in the Kitchen.`, 'good');
});
game.bus.on('cooked', (e) => {
  const name = GAME_DATA.recipes[e.recipe].name;
  toasts.show(`${name} is ready${e.hearty ? ' and extra hearty' : ''}! It is in your bag.`, 'good');
});
game.bus.on('buffExpired', (e) => toasts.show(`${GAME_DATA.buffs[e.buff].name} has worn off.`));
game.bus.on('seasonChanged', (e) => {
  const season = `${e.season[0]?.toUpperCase()}${e.season.slice(1)}`;
  toasts.show(`${season} has arrived!`, 'good');
  if (e.withered > 0) {
    toasts.show(
      `${e.withered} crop${e.withered === 1 ? '' : 's'} withered with the change of season.`,
      'warn',
    );
  }
});
// The Shipping Bin pickup: "+N" over the bin in the scene, and a toast.
game.bus.on('binCollected', (e) => {
  const at = renderer.tileClientCenter(BIN_TILE.col, BIN_TILE.row);
  goldPopupAt(e.gold, at.x, at.y);
  toasts.show(
    `The Shipping Bin was collected: ${e.items} item${e.items === 1 ? '' : 's'} for ${e.gold}g.`,
    'good',
  );
});
game.bus.on('purchased', (e) => {
  if (e.what in GAME_DATA.expansions) {
    const exp = GAME_DATA.expansions[e.what as keyof typeof GAME_DATA.expansions];
    toasts.show(
      exp.kind === 'fishing'
        ? `${exp.name}: the ${LOCATION_NAMES[exp.location as FishLocationId].toLowerCase()} is open for fishing!`
        : 'The farm grows! New soil is waiting to be tilled.',
      'good',
    );
  } else if (e.what === 'fish_trap')
    toasts.show('A fish trap bobs on the water. It fills on its own.', 'good');
  else if (e.what === 'sprinkler' || e.what === 'scarecrow') {
    toasts.show(`${GAME_DATA.upgrades[e.what]!.name} bought. Click a plot to put it down.`, 'good');
    panels.close(); // clear the way to the field
    placement.start(e.what);
  } else if (e.what in GAME_DATA.upgrades) {
    toasts.show(`${GAME_DATA.upgrades[e.what as keyof typeof GAME_DATA.upgrades]!.name} upgraded!`, 'good');
  }
});
// The farmhand: its sprite walks to the plots the tick-based logic just worked on (cosmetic only).
game.bus.on('planted', (e) => {
  if (!e.auto) return;
  for (const p of e.plots) {
    const t = tileOfPlot(game.state.farm.grid, p);
    renderer.farmhand.enqueue({ ...t, sprite: null });
  }
});
// Traps: what a click or the Trap Collector took out of them.
game.bus.on('trapCollected', (e) => {
  toasts.show(`Collected ${e.items} item${e.items === 1 ? '' : 's'} from the ${e.location} traps.`, 'good');
});
// Live panels (Inventory, Shop, Market) follow the state; refreshed at most once per frame.
let panelsDirty = false;
game.bus.onAny(() => (panelsDirty = true));

// ---- farming strokes: a press picks the tool (Auto resolves from the first plot) and a drag
// applies the same tool to every plot it crosses. Shift-click applies it to the whole field.
let stroke: { tool: ConcreteTool; seed: CropId | null } | null = null;
const strokeHarvest = new Map<CropId, number>();
let strokeFull = false;

game.bus.on('harvested', (e) => {
  if (e.auto) {
    const t = tileOfPlot(game.state.farm.grid, e.plot);
    renderer.farmhand.enqueue({ ...t, sprite: `item_${e.crop}` });
    return;
  }
  strokeHarvest.set(e.crop, (strokeHarvest.get(e.crop) ?? 0) + e.qty);
  renderer.addPlotFx(e.plot, `item_${e.crop}`, performance.now());
});
game.bus.on('inventoryFull', () => (strokeFull = true));

function flushStrokeToasts(): void {
  if (strokeHarvest.size > 0) {
    const parts = [...strokeHarvest].map(([crop, n]) => `+${n} ${GAME_DATA.crops[crop].name}`);
    toasts.show(parts.join(', '), 'good');
  }
  if (strokeFull) toasts.show('Your bag is full. Some crops are waiting in the ground.', 'warn');
  strokeHarvest.clear();
  strokeFull = false;
}

function usePlotTool(plots: number[], first: boolean): void {
  if (!stroke) return;
  const r = game.dispatch({ type: 'useTool', tool: stroke.tool, plots, seed: stroke.seed });
  if (!r.ok && first) toasts.show(r.reason);
}

// ---- placement mode: click a plot to place, a placed object to pick it up
function placeAt(plot: number): void {
  const kind = placement.kind;
  if (!kind || plot < 0 || plot >= game.state.farm.plots.length) return;
  const { cols } = game.state.farm.grid;
  const col = plot % cols;
  const row = Math.floor(plot / cols);
  const there = objectAt(game.state, col, row);
  const r = there
    ? game.dispatch({ type: 'pickUp', id: there.id })
    : game.dispatch({ type: 'place', kind, col, row });
  if (!r.ok) toasts.show(r.reason, 'warn');
  syncPlacement();
}

function syncPlacement(): void {
  const kind = placement.kind;
  if (!kind) {
    renderer.setPreview(null);
    return;
  }
  const st = game.state;
  placement.describe(stockOf(st, kind));
  const offsets = areaOffsets(areaOf(st, GAME_DATA, kind));
  renderer.setPreview({
    offsets,
    validAt: (c, r) =>
      inGrid(st, c, r) && (!!objectAt(st, c, r) || placementProblem(st, kind, c, r) === null),
    isPlot: (c, r) => inGrid(st, c - PLOT_ORIGIN.col, r - PLOT_ORIGIN.row),
  });
}

// ---- scene
const renderer = new Renderer({
  canvas: byId<HTMLCanvasElement>('scene-canvas'),
  container: byId('scene'),
  onZoneClick({ zone, col, row }) {
    // A trap floating on the water: click it to collect.
    const trap = game.state.fishing.traps.find((t) => {
      const at = trapTile(t.location, t.slot);
      return at.col === col && at.row === row;
    });
    if (trap) {
      const r = game.dispatch({ type: 'collectTrap', id: trap.id });
      if (!r.ok) toasts.show(r.reason, 'warn');
      return;
    }
    const openWater = (location: FishLocationId): void => {
      if (isLocationUnlocked(game.state, location)) {
        fishing.showLocation(location);
        panels.open('fishing');
        return;
      }
      const exp = expansionFor(GAME_DATA, location);
      const needs = exp ? unlockHints(game.state, GAME_DATA, exp.requires).join(' ') : '';
      toasts.show(
        exp
          ? `${exp.name}: ${exp.price.toLocaleString('en-US')}g in Upgrades. ${needs}`.trim()
          : 'You cannot fish there yet.',
      );
    };
    switch (zone.id) {
      case 'farmhouse':
        return panels.open('kitchen');
      case 'pond':
        return openWater('pond');
      case 'market':
      case 'bin':
        return panels.open('market');
      case 'plots':
        return; // handled by the stroke callbacks below
      case 'greenhouse':
        return toasts.show(
          game.state.expansions.includes('farm_3')
            ? 'An empty lot. Something could be built here one day.'
            : 'Old trees crowd this lot. The Old Orchard Plot expansion would clear them.',
        );
      case 'river':
        return openWater('river');
      case 'dock':
        return openWater('ocean');
    }
  },
  onPlotDown({ plot, shiftKey }) {
    if (placement.kind) return placeAt(plot);
    const seed = tools.seed;
    const tool =
      tools.tool === 'auto'
        ? autoToolFor(game.state, GAME_DATA, game.calendar().season, plot, seed)
        : tools.tool;
    if (tool === null) {
      // Nothing obvious to do: let the action explain why (e.g. "growing, 1m left").
      const r = game.dispatch({ type: 'useTool', tool: 'auto', plots: [plot], seed });
      if (!r.ok) toasts.show(r.reason);
      return;
    }
    stroke = { tool, seed };
    const all = game.state.farm.plots.map((_, i) => i);
    usePlotTool(shiftKey ? [plot, ...all.filter((i) => i !== plot)] : [plot], true);
  },
  onPlotEnter({ plot }) {
    usePlotTool([plot], false);
  },
  onStrokeEnd() {
    stroke = null;
    flushStrokeToasts();
  },
});
renderer.setScene(game.state.farm.grid, game.state.expansions);

// ---- offline catch-up for the time since the last save
function awayFarm(): AwayFarm {
  const all = [...game.state.farm.plots, ...game.state.farm.greenhouse];
  return {
    readyPlots: all.filter((p) => isReady(p, GAME_DATA)).length,
    dryPlots: allPlotIndexes(game.state).filter((i) => {
      const p = plotAt(game.state, i)!;
      return p.state === 'planted' && !game.isPlotWatered(i);
    }).length,
  };
}
function onResume(report: OfflineReport): void {
  save();
  if (report.showSummary) showAwaySummary(report, awayFarm());
}
if (initialFile && loaded.kind === 'loaded') onResume(game.catchUp(initialFile.savedAt, now()));
else save();

if (loaded.kind === 'error') {
  const box = h('textarea', { class: 'save-text', readonly: true, rows: 4, 'aria-label': 'Raw save' });
  box.value = loaded.raw;
  showModal({
    title: 'Your save could not be loaded',
    dismissible: false,
    body: h(
      'div',
      {},
      h('p', { text: loaded.message }),
      h('p', {
        text: 'Nothing has been overwritten. Copy the text below to keep it, then start a new farm.',
      }),
      box,
    ),
    buttons: [
      {
        label: 'Start a new farm',
        primary: true,
        onClick() {
          saveBlocked = false;
          game.replaceState(createInitialState(now(), lc));
          save();
        },
      },
    ],
  });
}

// ---- loop and autosave
const loop = startLoop(game, {
  render() {
    const cal = game.calendar();
    renderer.setScene(game.state.farm.grid, game.state.expansions);
    renderer.render(performance.now(), cal, {
      plots: plotSprites(
        game.state.farm.plots,
        (p) => plotStage(p, GAME_DATA),
        (i) => game.isPlotWatered(i),
      ),
      greenhouse: plotSprites(
        game.state.farm.greenhouse,
        (p) => plotStage(p, GAME_DATA),
        () => true,
      ),
      placed: game.state.placed,
      farmhand: (game.state.upgrades.farmhand ?? 0) > 0,
      traps: game.state.fishing.traps.map((t) => ({
        ...trapTile(t.location, t.slot),
        full: trapItemCount(t) > 0,
      })),
      cooking: game.state.kitchen.queue.some((j) => j.remainingMs > 0),
    });
    if (placement.kind) syncPlacement();
    hud.update(game.state, cal);
    tools.update();
    if (panelsDirty) {
      panelsDirty = false;
      panels.refreshOpen();
    }
    panels.tickOpen(performance.now());
  },
  onHide: save,
  onResume,
});
window.setInterval(save, AUTOSAVE_MS);
window.addEventListener('beforeunload', save);

// ---- dev helpers: `?debug` in production, always in dev
if (import.meta.env.DEV || new URLSearchParams(location.search).has('debug')) {
  void import('./ui/debug').then(({ installDebugOverlay }) =>
    installDebugOverlay({ game, fps: () => loop.fps, onOffline: onResume }),
  );
}

// Exposed for the e2e smoke test and manual poking in the console.
(window as unknown as { __game: Game }).__game = game;
