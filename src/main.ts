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
import { BIN_TILE, plotSprites } from './render/scene';
import { autoToolFor, isReady, plotStage, type ConcreteTool } from './systems/farming';
import { computeModifiers } from './systems/modifiers';
import { showAwaySummary } from './ui/awaySummary';
import { byId, h } from './ui/dom';
import { FarmTools } from './ui/farmTools';
import { Hud } from './ui/hud';
import { showModal } from './ui/modal';
import { PanelManager } from './ui/panel';
import { goldPopupAt } from './ui/goldFx';
import { marketPanel } from './ui/marketPanel';
import { inventoryPanel, settingsPanel, shopPanel, STUB_PANELS, type GameViewHooks } from './ui/panels';
import { upgradesPanel } from './ui/upgradesPanel';
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
  mods: () => computeModifiers(game.state, GAME_DATA),
};
const stubPanel = (id: string) => STUB_PANELS.find((d) => d.id === id)!;
// Registration order is the toolbar order.
panels.register(inventoryPanel(view));
panels.register(shopPanel({ ...view, buySeeds: (crop, qty) => game.dispatch({ type: 'buySeeds', crop, qty }) }));
panels.register(
  marketPanel({
    ...view,
    sell: (item, qty) => game.dispatch({ type: 'sell', item, qty }),
    ship: (item, qty) => game.dispatch({ type: 'ship', item, qty }),
    unship: (item) => game.dispatch({ type: 'unship', item }),
  }),
);
panels.register(stubPanel('kitchen'));
panels.register(stubPanel('fishing'));
panels.register(
  upgradesPanel({
    ...view,
    buyExpansion: (id) => game.dispatch({ type: 'buyExpansion', id }),
    buyUpgrade: (id) => game.dispatch({ type: 'buyUpgrade', id }),
  }),
);
panels.register(stubPanel('goals'));
panels.register(
  settingsPanel({
    getVolume: () => game.state.settings.masterVolume,
    setVolume: (value) => void game.dispatch({ type: 'setMasterVolume', value }),
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
  toasts.show(`The Shipping Bin was collected: ${e.items} item${e.items === 1 ? '' : 's'} for ${e.gold}g.`, 'good');
});
game.bus.on('purchased', (e) => {
  if (e.what in GAME_DATA.expansions) toasts.show('The farm grows! New soil is waiting to be tilled.', 'good');
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

// ---- scene
const renderer = new Renderer({
  canvas: byId<HTMLCanvasElement>('scene-canvas'),
  container: byId('scene'),
  onZoneClick({ zone }) {
    switch (zone.id) {
      case 'farmhouse':
        return panels.open('kitchen');
      case 'pond':
        return panels.open('fishing');
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
        return toasts.show('Tall reeds hide a river bank. Maybe later…');
      case 'dock':
        return toasts.show('An old dock, too rickety to use for now.');
    }
  },
  onPlotDown({ plot, shiftKey }) {
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
function readyPlots(): number {
  return game.state.farm.plots.filter((p) => isReady(p, GAME_DATA)).length;
}
function onResume(report: OfflineReport): void {
  save();
  if (report.showSummary) showAwaySummary(report, readyPlots());
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
    renderer.render(
      performance.now(),
      cal,
      plotSprites(game.state.farm.plots, (p) => plotStage(p, GAME_DATA)),
    );
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
