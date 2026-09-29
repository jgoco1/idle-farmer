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
import { applyPaletteCssVars } from './render/palette';
import { Renderer } from './render/renderer';
import { plotIndexAt } from './render/scene';
import { showAwaySummary } from './ui/awaySummary';
import { byId, h } from './ui/dom';
import { Hud } from './ui/hud';
import { showModal } from './ui/modal';
import { PanelManager } from './ui/panel';
import { settingsPanel, STUB_PANELS } from './ui/panels';
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
for (const def of STUB_PANELS) panels.register(def);
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
        save();
        if (report.showSummary) showAwaySummary(report);
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

game.bus.on('notify', (e) => toasts.show(e.text, e.tone));
game.bus.on('seasonChanged', (e) =>
  toasts.show(`${e.season[0]?.toUpperCase()}${e.season.slice(1)} has arrived!`, 'good'),
);

// ---- scene
const renderer = new Renderer({
  canvas: byId<HTMLCanvasElement>('scene-canvas'),
  container: byId('scene'),
  onZoneClick({ zone, col, row }) {
    switch (zone.id) {
      case 'farmhouse':
        return panels.open('kitchen');
      case 'pond':
        return panels.open('fishing');
      case 'market':
        return panels.open('market');
      case 'plots': {
        const r = game.dispatch({ type: 'plotClicked', plot: plotIndexAt(GAME_DATA.startGrid, col, row) });
        if (!r.ok) toasts.show(r.reason);
        return;
      }
      case 'greenhouse':
        return toasts.show('An empty lot. Something could be built here one day.');
      case 'river':
        return toasts.show('Tall reeds hide a river bank. Maybe later…');
      case 'dock':
        return toasts.show('An old dock, too rickety to use for now.');
    }
  },
});
renderer.setGrid(GAME_DATA.startGrid);

// ---- offline catch-up for the time since the last save
function onResume(report: OfflineReport): void {
  save();
  if (report.showSummary) showAwaySummary(report);
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
    renderer.render(performance.now(), cal);
    hud.update(game.state, cal);
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
