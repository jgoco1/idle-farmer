// Entry point: pick the platform (src/platform/), read the save and prefs from its storage, catch
// up offline time, and wire the game to the renderer, the UI, the loop, autosave and the platform's
// lifecycle (pause, resume, back). The web build and the app shells (`npm run build:app`) share it.

import { PurchaseGuard } from './ui/purchaseGuard';
import './styles.css';
import { AudioEngine, unlockOnFirstGesture, volumesOf } from './audio/engine';
import { bindAudioEvents } from './audio/events';
import { Music, themeKey, townSquareKey } from './audio/music';
import { Sfx } from './audio/sfx';
import { Game } from './core/game';
import { startLoop } from './core/loop';
import type { OfflineReport } from './core/offline';
import {
  AUTOSAVE_MS,
  CORRUPT_KEY,
  exportSave,
  importSave,
  SaveError,
  SaveSlots,
  saveKeys,
  toSaveFile,
} from './core/save';
import { PREFS_KEY, PrefsStore } from './core/prefs';
import { loadPlatform } from './platform';
import { SyncStore } from './platform/store';
import { goBack, type BackUi } from './ui/back';
import { INSPECT_NONE } from './render/sceneInput';
import { applyFakeInsets } from './ui/safeArea';
import { createInitialState, type Plot } from './core/state';
import { systemLocalClock } from './core/time';
import { GAME_DATA } from './data';
import { TOWN_PROJECT_IDS, type CropId } from './data/ids';
import { applyPaletteCssVars } from './render/palette';
import { Renderer, type DecorGhost, type SceneView } from './render/renderer';
import {
  BIN_TILE,
  PET_TILE,
  PLOT_ORIGIN,
  plotIndexAt,
  plotSpritesInto,
  tileOfPlot,
  trapTile,
  type PlotSprites,
} from './render/scene';
import {
  allPlotIndexes,
  autoToolFor,
  isReady,
  northFieldOf,
  plotAt,
  plotStage,
  type ConcreteTool,
} from './systems/farming';
import {
  areaOf,
  areaOffsets,
  coverageOf,
  objectAt,
  placementProblem,
  plotCoordsOf,
  stockOf,
  type Coverage,
  type PlotCoords,
} from './systems/placement';
import { PlacementMode } from './ui/placement';
import { fishingPanel } from './ui/fishingPanel';
import { expansionFor, isLocationUnlocked } from './systems/locations';
import { unlockHints } from './systems/unlocks';
import { LOCATION_NAMES } from './data/fish';
import { NORTH_FIELD_IDS, type FishLocationId } from './data/ids';
import { computeModifiers } from './systems/modifiers';
import { showAwaySummary, type AwayFarm } from './ui/awaySummary';
import { byId, h } from './ui/dom';
import { bulkPlots, FarmTools } from './ui/farmTools';
import { Hud } from './ui/hud';
import { closeTopModal, showModal } from './ui/modal';
import { PanelManager } from './ui/panel';
import { goldPopupAt } from './ui/goldFx';
import { marketPanel } from './ui/marketPanel';
import { inventoryPanel, settingsPanel, shopPanel, type GameViewHooks } from './ui/panels';
import { goalsPanel } from './ui/goalsPanel';
import { Celebration } from './ui/celebrate';
import { SKILL_NAMES } from './data/skills';
import { kitchenPanel } from './ui/kitchenPanel';
import { upgradesPanel } from './ui/upgradesPanel';
import type { Action } from './core/actions';
import type { ActionResult } from './systems/context';
import { Toasts } from './ui/toast';
import { buildSceneControls } from './ui/sceneControls';
import { PlantMode } from './ui/plantMode';
import { ripeTrees } from './systems/orchard';
import { ranchPanel } from './ui/ranchPanel';
import { restaurantPanel } from './ui/restaurantPanel';
import { MAX_TABLES } from './render/restaurantLife';
import { restaurantBuilt } from './systems/restaurant';
import { pressPanel } from './ui/pressPanel';
import {
  HIVE_FULL,
  HIVE_NONE,
  HIVE_PLAIN,
  MAX_HIVES,
  MAX_PRESSES,
  PRESS_BUSY,
  PRESS_DONE,
  PRESS_IDLE,
} from './render/pressLife';
import { pressBuilt } from './systems/press';
import { hiveOnSpot } from './systems/apiary';
import { BuildMode } from './ui/buildMode';
import { buildingById, ranchOpen, storeCount, storeIsFull, troughIsEmpty, troughSize } from './systems/ranch';
import { BUILDINGS } from './data/animals';
import { WORLD_LAYOUT } from './data/world';
import { DecorateMode } from './ui/decorate';
import { farmhouseSpriteId } from './render/sprites/farmhouse';
import type { SceneLook } from './render/scene';
import { hasCosmetic, hasMusicTrack } from './systems/townProjects';
import { townSiteRect } from './render/scene';
import { EdgePips } from './ui/edgePips';
import type { PipTarget } from './render/pips';
import { buyParcelDialog } from './ui/parcelSign';
import { REGION_NAMES, regionAt } from './data/world';
import { FIELD_BASE, TRAP_CAPACITY } from './data/balance';
import { applyMotionPrefs, isReducedMotion } from './ui/motion';
import { flyCoins } from './ui/coinFly';
import { TutorialOverlay } from './ui/tutorial';
import { isFreshFarm, TutorialFlow } from './ui/tutorialFlow';
import { buildToolbar } from './ui/toolbar';
import { InspectLabel } from './ui/inspectLabel';

applyPaletteCssVars(document.documentElement);

/** The pixel-art splash in index.html fades out once the first frame is on screen. */
function dismissSplash(): void {
  const el = document.getElementById('splash');
  if (!el) return;
  el.classList.add('splash-hide');
  window.setTimeout(() => el.remove(), 500);
}

const lc = systemLocalClock;
const now = (): number => Date.now();

// ---- build flags. `npm run build:app` (mode "app") is the build the native shells load: no debug
// overlay, no service worker, and no e2e hooks unless VITE_E2E=1. Written inline so the bundler drops the dead code.
const params = new URLSearchParams(location.search);
const debugHooks = import.meta.env.DEV || (import.meta.env.MODE !== 'app' && params.has('debug'));
const e2eHooks = import.meta.env.MODE !== 'app' || import.meta.env.VITE_E2E === '1';
// Fake notch insets for checking safe areas in a plain browser (`?debug&insets` or `?debug&insets=44,0,34,0`).
if (debugHooks && params.has('insets')) applyFakeInsets(document.documentElement, params.get('insets'));

// ---- the platform and its storage. Storage is asynchronous on native platforms, the game saves
// synchronously: boot waits here until the save and the prefs are in memory (src/platform/store.ts).
const platform = await loadPlatform();
/** Replaced once the toasts exist; a failed write is reported once, then retried quietly until it works. */
let storageTrouble = (e: unknown, recovered: boolean): void => {
  if (!recovered) console.warn('Saving failed', e);
};
const store = await SyncStore.open(platform.storage, [...saveKeys(platform.olderBackups), PREFS_KEY], {
  onError: (e) => storageTrouble(e, false),
  onRecover: () => storageTrouble(null, true),
});
const slots = new SaveSlots(store, platform.olderBackups);

// ---- preferences (their own key: they belong to the device, not the farm)
const prefs = new PrefsStore(store);
function applyPrefs(): void {
  const p = prefs.value;
  applyMotionPrefs(p, document.documentElement);
  document.documentElement.style.setProperty('--ui-scale', String(p.uiScale));
  engine.setVolumes(volumesOf(p));
  hud.setNumberFormat(p.numberFormat);
}

// ---- audio: procedural Web Audio, created on the first click or key press
const engine = new AudioEngine();
const sfx = new Sfx(engine);
const music = new Music(engine);
unlockOnFirstGesture(engine, document);
music.start();

// ---- load
const loaded = slots.load(now(), lc);
/** While a broken save is on disk, never autosave over it until the player chooses. */
let saveBlocked = loaded.kind === 'error';
const initialFile = loaded.kind === 'error' ? null : loaded.file;
const game = new Game(initialFile?.state ?? createInitialState(now(), lc), { data: GAME_DATA, lc, now });

/** Writes the save to memory at once; the store persists it in the background (and rotates the backups). */
function save(): void {
  if (saveBlocked) return;
  try {
    slots.write(toSaveFile(game.state, now()));
  } catch (e) {
    console.warn('Save failed', e);
  }
}

/** Saves and resolves once it is on the device (pause, the autosave interval, quitting). */
function saveAndFlush(): Promise<boolean> {
  save();
  return store.flush();
}

// ---- UI
const toasts = new Toasts(byId('toasts'));
storageTrouble = (e, recovered) => {
  if (recovered) return toasts.show('Saving works again.', 'good');
  console.warn('Saving failed', e);
  toasts.showKept(
    'Your farm could not be saved on this device. The game keeps trying; export your save in Settings to be safe.',
    'warn',
  );
};
const hud = new Hud(byId('hud'));
applyPrefs();
prefs.onChange(applyPrefs);
const panels = new PanelManager(byId('panel-host'));
const view: GameViewHooks = {
  data: GAME_DATA,
  state: () => game.state,
  calendar: () => game.calendar(),
  mods: () => computeModifiers(game.state, GAME_DATA, game.calendar().season),
};
const placement = new PlacementMode(() => syncPlacement());
const startPlacement = placement.start.bind(placement);
placement.start = (kind) => {
  decorate.stop();
  plant.stop();
  build.stop();
  startPlacement(kind);
};
/** Set from Settings: the Town Square tune plays now, whatever the rotation says. */
let townTuneNow = false;
/** Keeps a double click on a buy button from buying twice (the button is rebuilt for the next level). */
const guard = new PurchaseGuard(() => performance.now());
// Registration order is the toolbar order.
/** Dispatch with the few sounds that belong to an action rather than an event (cooking, casting, reeling). */
let lastReelTick = 0;
const dispatch = (action: Action): ActionResult => {
  const phaseBefore = game.state.fishing.session?.phase;
  const r = game.dispatch(action);
  if (!r.ok) return r;
  if (action.type === 'cook') sfx.play('sizzle');
  if (action.type === 'fishTick') {
    const session = game.state.fishing.session;
    if (phaseBefore === 'charging' && session?.phase === 'waiting')
      sfx.play('cast', { amount: session.power });
    else if (session?.phase === 'reeling' && performance.now() - lastReelTick > 230) {
      lastReelTick = performance.now();
      sfx.play('reel');
    }
  }
  return r;
};
panels.register(inventoryPanel({ ...view, dispatch }));
panels.register(
  shopPanel({
    ...view,
    buySeeds: (crop, qty) => guard.run(`seeds:${crop}`, () => game.dispatch({ type: 'buySeeds', crop, qty })),
    buyRecipe: (recipe) => guard.run(`recipe:${recipe}`, () => game.dispatch({ type: 'buyRecipe', recipe })),
    trees: {
      buySapling: (fruit, qty) =>
        guard.run(`sapling:${fruit}`, () => game.dispatch({ type: 'buySapling', fruit, qty })),
      startPlanting: (fruit) => {
        panels.close();
        plant.start(fruit);
      },
      pickTree: (id) => game.dispatch({ type: 'pickTree', id }),
      startMove: (id) => {
        panels.close();
        plant.startMove(id);
      },
      removeTree: (id) => game.dispatch({ type: 'removeTree', id }),
    },
    decor: {
      buyDecor: (decor, qty) =>
        guard.run(`decor:${decor}:${qty}`, () => game.dispatch({ type: 'buyDecor', decor, qty })),
      styleFarmhouse: (paint, roof, loft) => game.dispatch({ type: 'styleFarmhouse', paint, roof, loft }),
      adoptCat: (cat) => guard.run(`cat:${cat}`, () => game.dispatch({ type: 'adoptCat', cat })),
      chooseCat: (cat) => game.dispatch({ type: 'chooseCat', cat }),
      startDecorate: (id) => {
        panels.close();
        placement.stop();
        decorate.start(id);
      },
    },
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
panels.register(
  kitchenPanel({
    ...view,
    dispatch,
    sort: { get: () => prefs.value.kitchenSort, set: (mode) => prefs.set('kitchenSort', mode) },
    favourites: {
      get: () => prefs.value.kitchenFavourites,
      set: (list) => prefs.set('kitchenFavourites', list),
    },
  }),
);
const fishing = fishingPanel({
  ...view,
  bus: game.bus,
  dispatch,
  lockedHint(location) {
    const exp = expansionFor(GAME_DATA, location);
    if (!exp) return '';
    const needs = unlockHints(game.state, GAME_DATA, exp.requires).join(' ');
    return `${LOCATION_NAMES[location]}: ${exp.name}, ${exp.price.toLocaleString('en-US')}g in Upgrades. ${needs}`.trim();
  },
});
panels.register(fishing.def);
panels.register(
  ranchPanel({
    ...view,
    dispatch,
    startBuild: (kind) => {
      panels.close();
      build.start(kind);
    },
    startMove: (id) => {
      panels.close();
      build.startMove(id);
    },
  }),
);
panels.register(restaurantPanel({ ...view, dispatch }));
panels.register(
  pressPanel({
    ...view,
    dispatch,
    sort: { get: () => prefs.value.kitchenSort, set: (mode) => prefs.set('kitchenSort', mode) },
    favourites: {
      get: () => prefs.value.kitchenFavourites,
      set: (list) => prefs.set('kitchenFavourites', list),
    },
  }),
);
panels.register(
  upgradesPanel({
    ...view,
    buyExpansion: (id) => guard.run(`expansion:${id}`, () => game.dispatch({ type: 'buyExpansion', id })),
    buyUpgrade: (id) => guard.run(`upgrade:${id}`, () => game.dispatch({ type: 'buyUpgrade', id })),
    buyParcel: (parcel) => guard.run(`parcel:${parcel}`, () => game.dispatch({ type: 'buyParcel', parcel })),
    place: (kind) => {
      panels.close();
      placement.start(kind);
    },
    setAutoSell: (item, on) => game.dispatch({ type: 'setAutoSell', item, on }),
    setSeedOrderReserve: (pct) => game.dispatch({ type: 'setSeedOrderReserve', pct }),
    setSeedOrderCrop: (crop, on) => game.dispatch({ type: 'setSeedOrderCrop', crop, on }),
  }),
);
const goals = goalsPanel({
  ...view,
  dispatch,
  donateProject: (project, gold, item, qty) =>
    guard.run(`project:${project}:${gold !== undefined ? 'gold' : item}`, () =>
      game.dispatch({ type: 'donateProject', project, gold, item, qty }),
    ),
  placeGolden: () => {
    panels.close();
    decorate.stop();
    placement.start('golden_scarecrow');
  },
});
panels.register(goals.def);
panels.register(
  settingsPanel({
    prefs,
    replayTutorial() {
      panels.close();
      tutorial.start();
    },
    getRelaxedFishing: () => game.state.settings.relaxedFishing,
    setRelaxedFishing: (on) => void game.dispatch({ type: 'setRelaxedFishing', on }),
    exportSave: () => exportSave(toSaveFile(game.state, now())),
    downloadSave: () =>
      void platform.exportFile('hearthfield-idle-save.txt', exportSave(toSaveFile(game.state, now()))),
    quit: platform.quit
      ? () => {
          const quit = platform.quit!;
          void saveAndFlush().then(() => quit());
        }
      : null,
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
    townTuneOwned: () => hasMusicTrack(game.state, GAME_DATA, 'town_square'),
    playTownTune(on) {
      townTuneNow = on;
    },
    hardReset() {
      slots.clear();
      game.replaceState(createInitialState(now(), lc));
      saveBlocked = false;
      save();
      panels.close();
      toasts.show('A fresh start. Welcome to your new farm!', 'good');
      prefs.set('tutorial', 'pending');
      tutorial.start();
    },
  }),
);
hud.settingsButton.addEventListener('click', () => panels.toggle('settings'));
hud.levelButton.addEventListener('click', () => panels.toggle('goals'));
const toolbar = buildToolbar(byId('toolbar'), panels);
const celebration = new Celebration(byId('scene'));
const decorate: DecorateMode = new DecorateMode({
  data: GAME_DATA,
  state: () => game.state,
  dispatch,
  toast: (text, tone = 'info') => toasts.show(text, tone),
  setMode(on) {
    renderer.decorateMode = on;
    if (on) placement.stop();
  },
  setGhost: (g: DecorGhost | null) => renderer.setDecorGhost(g),
  onChange: (on) => controls.setDecorating(on),
});
// Planting and moving a tree share Decorate mode's click routing and ghost (the renderer sends the clicks here).
const plant: PlantMode = new PlantMode({
  data: GAME_DATA,
  state: () => game.state,
  dispatch,
  toast: (text, tone = 'info') => toasts.show(text, tone),
  setMode(on) {
    renderer.decorateMode = on;
  },
  setGhost: (g: DecorGhost | null) => renderer.setDecorGhost(g),
  showOrchard() {
    const r = GAME_DATA.parcels.orchard.rect;
    renderer.panToTile(r.col + Math.floor(r.cols / 2), r.row + Math.floor(r.rows / 2));
  },
  onStart() {
    decorate.stop();
    placement.stop();
  },
});
// Building (and moving) the coop, barn and silo shares the same routing and ghost (v2 phase 04).
const build: BuildMode = new BuildMode({
  data: GAME_DATA,
  state: () => game.state,
  dispatch,
  toast: (text, tone = 'info') => toasts.show(text, tone),
  setMode(on) {
    renderer.decorateMode = on;
  },
  setGhost: (g: DecorGhost | null) => renderer.setDecorGhost(g),
  showYard() {
    const r = GAME_DATA.parcels.yard.rect;
    renderer.panToTile(r.col + Math.floor(r.cols / 2), r.row + Math.floor(r.rows / 2));
  },
  onStart() {
    decorate.stop();
    plant.stop();
    placement.stop();
  },
});
const startDecorating = decorate.start.bind(decorate);
decorate.start = (select) => {
  plant.stop();
  build.stop();
  startDecorating(select);
};
const startPlanting = plant.start.bind(plant);
plant.start = (fruit) => {
  build.stop();
  startPlanting(fruit);
};
const startMoving = plant.startMove.bind(plant);
plant.startMove = (id) => {
  build.stop();
  startMoving(id);
};
const tools = new FarmTools(byId('toolbar'), view, {
  get: () => prefs.value.paint,
  set: (on) => prefs.set('paint', on),
});
tools.onBulk = useOnField;

// ---- layout: panels sit between the real HUD and toolbar heights (they change with UI size and phone width)
function trackHeights(): void {
  const set = (): void => {
    const root = document.documentElement.style;
    root.setProperty('--hud-h', `${byId('hud').offsetHeight}px`);
    root.setProperty('--toolbar-h', `${byId('toolbar').offsetHeight}px`);
  };
  const ro = new ResizeObserver(set);
  ro.observe(byId('hud'));
  ro.observe(byId('toolbar'));
  set();
}
trackHeights();

// ---- sound: every click, every panel, and (below) every game event
document.addEventListener('click', (e) => {
  const btn = e.target instanceof Element ? e.target.closest('button') : null;
  if (btn && !btn.disabled) sfx.play('click');
});
panels.onChange((open) => sfx.play(open ? 'panelOpen' : 'panelClose'));
/** Offline catch-up flushes its events through the bus too; it stays quiet and unadorned. */
const quiet = (): boolean => game.replaying;
bindAudioEvents(game.bus, sfx, quiet);

/**
 * A toast about something at world tile (col, row): when that tile is out of view it says where
 * ("→ Hilltop Orchard") and clicking it pans there (GDD §12.1).
 */
function toastAt(text: string, tone: 'info' | 'good' | 'warn', col: number, row: number): void {
  if (renderer.isTileVisible(col, row)) return toasts.show(text, tone);
  const region = regionAt(col, row);
  const where = region ? ` → ${REGION_NAMES[region]}` : '';
  toasts.show(`${text}${where}`, tone, () => renderer.panToTile(col, row));
}

// ---- juice: particles at the spot an event happened (cosmetic; the renderer owns them)
const PX = 16; // a tile in logical scene pixels
const WATER_SPOT: Record<FishLocationId, { col: number; row: number }> = {
  pond: { col: 3, row: 9 },
  river: { col: 10, row: 11 },
  ocean: { col: 17, row: 11 },
};
function plotPx(plot: number): { x: number; y: number } {
  const t = tileOfPlot(game.state.farm.grid, plot);
  return { x: t.col * PX + PX / 2, y: t.row * PX + PX / 2 };
}
function burstOnPlots(kind: 'soil' | 'droplet' | 'leaf', plots: number[]): void {
  if (quiet()) return;
  for (const p of plots.slice(0, 6)) {
    const at = plotPx(p);
    renderer.particles.emit(kind, at.x, kind === 'droplet' ? at.y - 4 : at.y, plots.length > 3 ? 0.6 : 1);
  }
}
game.bus.on('tilled', (e) => e.auto || burstOnPlots('soil', e.plots));
game.bus.on('watered', (e) => e.auto || burstOnPlots('droplet', e.plots));
game.bus.on('harvested', (e) => e.auto || burstOnPlots('leaf', [e.plot]));
const ripple = (location: FishLocationId): void => {
  if (quiet()) return;
  const at = WATER_SPOT[location];
  renderer.particles.emit('ripple', at.col * PX + PX / 2, at.row * PX + PX / 2);
};
game.bus.on('bite', (e) => ripple(e.location));
game.bus.on('escaped', (e) => ripple(e.location));
game.bus.on('caught', (e) => {
  if (quiet() || e.viaTrap) return;
  ripple(e.location);
  const fish = GAME_DATA.fish[e.catch as keyof typeof GAME_DATA.fish];
  if (fish?.rarity === 'legendary') {
    renderer.shake(performance.now());
    const at = WATER_SPOT[e.location];
    renderer.particles.emit('sparkle', at.col * PX + PX / 2, at.row * PX + PX / 2);
  }
});
const sparkleBurst = (): void => {
  if (quiet()) return;
  renderer.particles.emit('sparkle', 160, 70, 1.4);
};
game.bus.on('levelUp', sparkleBurst);
game.bus.on('farmLevelUp', sparkleBurst);
game.bus.on('sold', (e) => {
  if (quiet() || e.via !== 'market') return;
  flyCoins(renderer.tileClientCenter(16, 7), hud.goldElement, e.gold);
});
game.bus.on('binCollected', (e) => {
  if (quiet() || !renderer.isTileVisible(BIN_TILE.col, BIN_TILE.row)) return;
  flyCoins(renderer.tileClientCenter(BIN_TILE.col, BIN_TILE.row), hud.goldElement, e.gold);
});
let petted = 0;
function petTheCat(): void {
  sfx.play('pet');
  const at = { x: PET_TILE.col * PX + PX / 2, y: PET_TILE.row * PX };
  for (let i = 0; i < 3; i++)
    window.setTimeout(() => renderer.particles.emit('heart', at.x + (i - 1) * 4, at.y - i * 3), i * 160);
  if (petted++ % 6 === 0) toasts.show('The farm cat purrs in its sleep.', 'good');
}

// ---- the ranch (v2 phase 04): petting, and the toasts, sounds and little effects for what the animals do
let pettedAnimals = 0;
const headPt = { x: 0, y: 0 };
/** Click a hen or a cow: hearts and a cluck or a moo. Cosmetic only: nothing changes in the game, and skipping it costs nothing. */
function petAnimal(id: number): void {
  const a = game.state.ranch.animals.find((x) => x.id === id);
  if (!a || !renderer.ranch.headOf(id, headPt)) return;
  sfx.play(a.kind === 'cow' ? 'moo' : 'cluck');
  const at = { x: headPt.x, y: headPt.y };
  for (let i = 0; i < 3; i++)
    window.setTimeout(() => renderer.particles.emit('heart', at.x + (i - 1) * 4, at.y - i * 3), i * 160);
  if (pettedAnimals++ % 5 === 0)
    toasts.show(a.kind === 'cow' ? `${a.name} gives a happy, low moo.` : `${a.name} clucks happily.`, 'good');
}
const yardPoint = (): { col: number; row: number } => {
  const r = GAME_DATA.parcels.yard.rect;
  return { col: r.col + Math.floor(r.cols / 2), row: r.row + Math.floor(r.rows / 2) };
};
const buildingTile = (id: number): { col: number; row: number } => {
  const b = buildingById(game.state, id);
  return b ? { col: b.at.col, row: b.at.row } : yardPoint();
};
game.bus.on('buildingBuilt', (e) => {
  if (quiet()) return;
  const at = buildingTile(e.id);
  const def = GAME_DATA.buildings[e.building];
  toasts.show(
    `The ${def.name.toLowerCase()} is up!${def.houses ? ' Buy an animal and fill the trough in the Ranch panel.' : ''}`,
    'good',
  );
  const w = def.footprint;
  for (let i = 0; i < 6; i++)
    renderer.particles.emit(
      'leaf',
      (at.col + ((i % 3) + 0.5) * (w.cols / 3)) * PX,
      (at.row + w.rows - 0.3) * PX,
      1,
    );
  panels.open('ranch');
});
game.bus.on('buildingUpgraded', (e) => {
  if (quiet()) return;
  const at = buildingTile(e.id);
  toasts.show(
    `The ${GAME_DATA.buildings[e.building].name.toLowerCase()} is bigger now (level ${e.level}).`,
    'good',
  );
  renderer.particles.emit('sparkle', (at.col + 1.5) * PX, (at.row + 1) * PX, 1);
});
game.bus.on('animalBought', (e) => {
  if (quiet()) return;
  const a = game.state.ranch.animals.find((x) => x.id === e.id);
  if (a) toasts.show(`${a.name} the ${GAME_DATA.animals[e.animal].name.toLowerCase()} has moved in.`, 'good');
});
// A production cycle fired: the building's animals walk to the trough and eat (cosmetic).
game.bus.on('produced', (e) => {
  if (!quiet()) renderer.ranch.eatAt(e.building);
});
game.bus.on('collected', (e) => {
  if (quiet() || e.auto) return;
  const at = buildingTile(e.building);
  renderer.addTileFx(at.col + 1, at.row, `item_${e.product}`, performance.now());
  toasts.show(`+${e.qty} ${GAME_DATA.items[e.product]!.name}${e.shipped > 0 ? ' (shipped)' : ''}`, 'good');
});
let lastHungryToast = -1e9;
game.bus.on('troughEmpty', (e) => {
  if (catchingUp() || performance.now() - lastHungryToast < 30_000) return;
  lastHungryToast = performance.now();
  const at = buildingTile(e.building);
  toastAt(
    e.animal === 'cow' ? 'The cows would love some hay.' : 'The hens would love some feed.',
    'info',
    at.col,
    at.row,
  );
});

// ---- the restaurant (v4 phase 02): toasts for building it and for a table that has served everything
const restaurantTile = (): { col: number; row: number } => {
  const site = WORLD_LAYOUT.restaurantSite;
  return { col: site.col + 2, row: site.row + 2 };
};
game.bus.on('restaurantBuilt', () => {
  if (quiet()) return;
  const at = restaurantTile();
  toasts.show(`${GAME_DATA.restaurant.name} is open! Put some dishes on the menu.`, 'good');
  for (let i = 0; i < 8; i++)
    renderer.particles.emit('leaf', (at.col - 2 + (i % 5) + 0.5) * PX, (at.row + 1.5) * PX, 1);
});
game.bus.on('restaurantUpgraded', (e) => {
  if (quiet()) return;
  const at = restaurantTile();
  toasts.show(
    `${GAME_DATA.restaurant.name} is bigger now (level ${e.level}): another table on the terrace.`,
    'good',
  );
  renderer.particles.emit('sparkle', (at.col + 0.5) * PX, at.row * PX, 1);
});
game.bus.on('served', (e) => {
  if (quiet()) return;
  const site = WORLD_LAYOUT.restaurantSite;
  renderer.restaurant.served(e.slot);
  if (renderer.isTileVisible(site.col + e.slot, site.row + site.rows - 1))
    renderer.addTileFx(site.col + e.slot, site.row + site.rows - 1, 'ui_gold', performance.now());
});
game.bus.on('menuEmpty', (e) => {
  if (catchingUp()) return;
  const at = restaurantTile();
  toastAt(
    `Table ${e.slot + 1} has served all its ${GAME_DATA.items[e.item]?.name.toLowerCase() ?? 'dishes'}.`,
    'info',
    at.col,
    at.row,
  );
});

// ---- the Press House and the apiary (v4 phase 03): toasts for building, a press that rests, a new hive
const pressTile = (): { col: number; row: number } => {
  const site = WORLD_LAYOUT.pressSite;
  return { col: site.col + 2, row: site.row + 2 };
};
game.bus.on('pressBuilt', () => {
  if (quiet()) return;
  const at = pressTile();
  toasts.show(
    `The ${GAME_DATA.press.name} is built! Start a drink in a press, and buy a hive or two.`,
    'good',
  );
  for (let i = 0; i < 8; i++)
    renderer.particles.emit('leaf', (at.col - 2 + (i % 4) + 0.5) * PX, (at.row + 1.5) * PX, 1);
});
game.bus.on('pressUpgraded', (e) => {
  if (quiet()) return;
  const at = pressTile();
  toasts.show(
    `The ${GAME_DATA.press.name} is bigger now (level ${e.level}): another press in the yard.`,
    'good',
  );
  renderer.particles.emit('sparkle', (at.col + 0.5) * PX, at.row * PX, 1);
});
game.bus.on('hiveBought', (e) => {
  if (quiet()) return;
  const spot = WORLD_LAYOUT.hiveSpots[e.spot]!;
  renderer.particles.emit('sparkle', (spot.col + 0.5) * PX, spot.row * PX, 1);
});
game.bus.on('pressStopped', (e) => {
  if (catchingUp()) return;
  const at = pressTile();
  toastAt(
    e.reason === 'full'
      ? `Press ${e.slot + 1} is full of ${GAME_DATA.recipes[e.recipe].name}. Collect it to keep pressing.`
      : `Press ${e.slot + 1} is resting: the bag is out of ingredients for ${GAME_DATA.recipes[e.recipe].name}.`,
    'info',
    at.col,
    at.row,
  );
});

// ---- first-time tutorial: plots → seeds → water → harvest → sell → shop, then the milestones take over
const tutorial = new TutorialFlow();
const tutorialRects = {
  rectOf(target: string): DOMRect | null {
    switch (target) {
      case 'plots': {
        const g = game.state.farm.grid;
        return renderer.tileRectClient(PLOT_ORIGIN.col, PLOT_ORIGIN.row, g.cols, g.rows);
      }
      case 'auto-tool':
        return document.querySelector('[data-tool="auto"]')?.getBoundingClientRect() ?? null;
      case 'market-button':
        return document.querySelector('[data-panel-button="market"]')?.getBoundingClientRect() ?? null;
      case 'shop-button':
        return document.querySelector('[data-panel-button="shop"]')?.getBoundingClientRect() ?? null;
      case 'goals-button':
        return document.querySelector('[data-panel-button="goals"]')?.getBoundingClientRect() ?? null;
    }
    return null;
  },
};
const tutorialOverlay = new TutorialOverlay(byId('scene'), tutorial, tutorialRects);
for (const type of ['planted', 'watered', 'harvested', 'sold'] as const)
  game.bus.on(type, (e) => {
    if ('auto' in e && e.auto) return;
    tutorial.signal({ kind: 'event', type });
  });
panels.onChange((open) => open && tutorial.signal({ kind: 'panel', id: open }));
tutorial.onChange(() => {
  if (tutorial.status === 'finished') {
    prefs.set('tutorial', 'done');
    toolbar.nudge('goals');
  } else if (tutorial.status === 'skipped') prefs.set('tutorial', 'skipped');
});
/** A fresh farm gets the tutorial once; a save with progress never sees it unasked. */
function maybeStartTutorial(): void {
  if (saveBlocked) return;
  if (prefs.value.tutorial === 'pending' && isFreshFarm(game.state)) tutorial.start();
  else if (prefs.value.tutorial === 'pending') prefs.set('tutorial', 'done');
}

game.bus.on('notify', (e) => toasts.show(e.text, e.tone));
game.bus.on('recipeLearned', (e) => {
  // The two starter drinks come with the Press House, whose own toast says so (v4-03).
  if (e.how === 'press') return;
  const where = GAME_DATA.recipes[e.recipe].station === 'press' ? 'the Press House' : 'the Kitchen';
  toasts.show(`New recipe: ${GAME_DATA.recipes[e.recipe].name}! Find it in ${where}.`, 'good');
});
game.bus.on('cooked', (e) => {
  const name = GAME_DATA.recipes[e.recipe].name;
  toastAt(`${name} is ready${e.hearty ? ' and extra hearty' : ''}! It is in your bag.`, 'good', 2, 2);
});
game.bus.on('buffExpired', (e) => toasts.show(`${GAME_DATA.buffs[e.buff].name} has worn off.`));

// ---- progression feedback: toasts, a burst of confetti and a pulse on the button of whatever just opened
/** Offline catch-up flushes its events through the bus too: the away summary lists progression, so no toast per event. */
const catchingUp = (): boolean => game.replaying;
game.bus.on('levelUp', (e) => {
  if (catchingUp()) return;
  const perk = GAME_DATA.perks.find((p) => p.skill === e.skill && p.level === e.level);
  toasts.showKept(`${SKILL_NAMES[e.skill]} level ${e.level}!${perk ? ` ${perk.text}.` : ''}`, 'good');
  celebration.burst('level');
});
game.bus.on(
  'farmLevelUp',
  (e) => catchingUp() || toasts.showKept(`Farm Level ${e.level}! Your farm is growing.`, 'good'),
);
game.bus.on('questDone', (e) => {
  if (catchingUp()) return;
  const reward = e.rewards ? ` Reward: ${e.rewards}.` : '';
  if (e.kind === 'milestone') {
    const flavor = GAME_DATA.milestones.find((m) => m.id === e.id)?.flavor ?? '';
    toasts.showKept(`Milestone: ${e.title}. ${flavor}${reward}`, 'good');
  } else {
    toasts.showKept(`Goal complete: ${e.title}!${reward}`, 'good');
  }
  celebration.burst('goal');
});
game.bus.on('bundleCompleted', (e) => {
  if (catchingUp()) return;
  const b = GAME_DATA.bundles[e.bundle];
  toasts.showKept(`${b.name} bundle complete! ${b.rewardText}.`, 'good');
  celebration.burst('big');
});
game.bus.on('unlocked', (e) => {
  if (catchingUp()) {
    if (e.panel) toolbar.nudge(e.panel); // the buttons still pulse
    return;
  }
  toasts.showKept(e.what, 'good');
  if (e.panel) toolbar.nudge(e.panel);
});
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
  if (renderer.isTileVisible(BIN_TILE.col, BIN_TILE.row)) {
    const at = renderer.tileClientCenter(BIN_TILE.col, BIN_TILE.row);
    goldPopupAt(e.gold, at.x, at.y);
  }
  toastAt(
    `The Shipping Bin was collected: ${e.items} item${e.items === 1 ? '' : 's'} for ${e.gold}g.`,
    'good',
    BIN_TILE.col,
    BIN_TILE.row,
  );
});
game.bus.on('seedsOrdered', (e) => {
  toasts.show(
    `Seed Order: ${e.qty} ${GAME_DATA.crops[e.crop].name.toLowerCase()} seeds for ${e.gold.toLocaleString('en-US')}g.`,
    'info',
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
  } else if (e.what in GAME_DATA.parcels) {
    // parcelBought has the toast.
  } else if (e.what in GAME_DATA.decor) {
    // The Decor tab reports what was bought.
  } else if (e.what in GAME_DATA.upgrades) {
    toasts.show(`${GAME_DATA.upgrades[e.what as keyof typeof GAME_DATA.upgrades]!.name} upgraded!`, 'good');
  }
});
// The farmhand: its sprite walks to the plots the tick-based logic just worked on (cosmetic only).
game.bus.on('planted', (e) => {
  if (!e.auto) return;
  for (const p of e.plots) {
    const t = tileOfPlot(game.state.farm.grid, p);
    renderer.farmhand.enqueue({ ...t, sprite: null, area: northFieldOf(p) ?? 'home' });
  }
});
// Traps: what a click or the Trap Collector took out of them.
game.bus.on('trapCollected', (e) => {
  const at = WATER_SPOT[e.location];
  toastAt(
    `Collected ${e.items} item${e.items === 1 ? '' : 's'} from the ${e.location} traps.`,
    'good',
    at.col,
    at.row,
  );
});
// The orchard (v2 phase 03): fruit picked, trees planted, trees turning mature, fruit ripening overnight.
function spotTile(treeId: number): { col: number; row: number } {
  const t = game.state.orchard.trees.find((x) => x.id === treeId);
  const s = WORLD_LAYOUT.treeSpots[t?.spot ?? 0]!;
  return { col: s.col, row: s.row };
}
game.bus.on('fruitPicked', (e) => {
  if (quiet()) return;
  const at = spotTile(e.tree);
  if (e.auto) {
    renderer.farmhand.enqueue({ col: at.col, row: at.row + 2, sprite: `item_${e.fruit}` });
    return;
  }
  renderer.addTileFx(at.col, at.row - 1, `item_${e.fruit}`, performance.now());
  toasts.show(`+${e.qty} ${GAME_DATA.items[e.fruit]!.name}${e.shipped > 0 ? ' (shipped)' : ''}`, 'good');
});
game.bus.on('treePlanted', (e) => {
  if (quiet()) return;
  const t = GAME_DATA.trees[e.tree];
  toasts.show(
    `A ${t.name.toLowerCase()} tree is planted. It will be mature in ${t.matureDays} days, even while you are away.`,
    'good',
  );
});
game.bus.on('treeMatured', (e) => {
  if (catchingUp()) return;
  const at = spotTile(e.id);
  toastAt(`Your ${GAME_DATA.trees[e.tree].name.toLowerCase()} tree is mature!`, 'good', at.col, at.row);
  if (!quiet()) renderer.particles.emit('sparkle', (at.col + 1) * PX, (at.row + 1) * PX, 1);
});
let lastFruitToast = -1e9;
game.bus.on('fruitGrown', (e) => {
  if (catchingUp() || performance.now() - lastFruitToast < 5000) return;
  lastFruitToast = performance.now();
  const at = spotTile(e.tree);
  toastAt('Fruit is ripe in the orchard.', 'good', at.col, at.row);
});
// A parcel is bought: the overgrowth goes in a puff of leaves and the camera shows the new land.
game.bus.on('parcelBought', (e) => {
  const def = GAME_DATA.parcels[e.parcel];
  const r = def.rect;
  if (!quiet()) {
    for (let i = 0; i < 9; i++) {
      const x = (r.col + ((i % 3) + 0.5) * (r.cols / 3)) * PX;
      const y = (r.row + (Math.floor(i / 3) + 0.5) * (r.rows / 3)) * PX;
      renderer.particles.emit('leaf', x, y, 1.4);
    }
    renderer.panToTile(r.col + Math.floor(r.cols / 2), r.row + Math.floor(r.rows / 2));
  }
  toasts.showKept(
    def.field
      ? `${def.name} is yours! The brambles are cleared: ${def.opens.toLowerCase()} waits for the hoe.`
      : `${def.name} is yours! The brambles are cleared. ${def.opens}, later on.`,
    'good',
  );
});
// A town project stage is finished: the town changes, with a flourish, and the camera shows it.
game.bus.on('projectStageDone', (e) => {
  const def = GAME_DATA.townProjects[e.project];
  const site = townSiteRect(e.project);
  if (!quiet()) {
    for (let i = 0; i < 12; i++)
      renderer.particles.emit(
        'sparkle',
        (site.col + ((i % 4) + 0.5) * (site.cols / 4)) * PX,
        (site.row + (Math.floor(i / 4) + 0.5) * (site.rows / 3)) * PX,
        1,
      );
    renderer.panToTile(site.col + Math.floor(site.cols / 2), site.row + Math.floor(site.rows / 2));
    celebration.burst('big');
  }
  const stage = def.stages[e.stage - 1]!;
  toasts.showKept(
    e.complete
      ? `${def.name} is finished! ${def.rewardText}.`
      : `${def.name}: ${stage.sceneChange}. Charm +10.`,
    'good',
  );
});
// New decoration pieces open as charm rises past their thresholds.
game.bus.on('charmChanged', (e) => {
  if (quiet() || e.to <= e.from) return;
  const opened = Object.values(GAME_DATA.decor).filter((d) =>
    d.unlock.some((c) => c.kind === 'charm' && c.amount > e.from && c.amount <= e.to),
  );
  if (opened.length > 0)
    toasts.show(`Charm ${e.to}! New in the Decor shop: ${opened.map((d) => d.name).join(', ')}.`, 'good');
});
// Live panels (Inventory, Shop, Market) follow the state; refreshed at most once per frame.
let panelsDirty = false;
game.bus.onAny(() => (panelsDirty = true));

// ---- farming clicks: a click picks the tool (Auto resolves from the plot) and applies it; Shift-click
// applies it to the whole field. A drag pans the camera instead (v2), so it never runs a tool, unless Paint is on
// or Alt is held (v2-05): then a drag that starts on a plot paints the tool along the stroke.
let stroke: { tool: ConcreteTool; seed: CropId | null } | null = null;
const strokeHarvest = new Map<CropId, number>();
let strokeFull = false;

game.bus.on('harvested', (e) => {
  if (e.auto) {
    const t = tileOfPlot(game.state.farm.grid, e.plot);
    renderer.farmhand.enqueue({ ...t, sprite: `item_${e.crop}`, area: northFieldOf(e.plot) ?? 'home' });
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

/**
 * A click (or the press that starts a paint stroke) on a plot: Auto resolves the tool from that plot, which then
 * holds for the whole stroke, as in v1. Returns whether a stroke started (false: placement, or nothing to do).
 */
function startStroke(plot: number, shiftKey: boolean): boolean {
  if (placement.kind) {
    placeAt(plot);
    return false;
  }
  const seed = tools.seed;
  const tool =
    tools.tool === 'auto'
      ? autoToolFor(game.state, GAME_DATA, game.calendar().season, plot, seed)
      : tools.tool;
  if (tool === null) {
    // Nothing obvious to do: let the action explain why (e.g. "growing, 1m left").
    const r = game.dispatch({ type: 'useTool', tool: 'auto', plots: [plot], seed });
    if (!r.ok) toasts.show(r.reason);
    return false;
  }
  stroke = { tool, seed };
  const all = bulkPlots(game.state, plot); // Shift-click: the clicked field (v4-01)
  usePlotTool(shiftKey ? [plot, ...all.filter((i) => i !== plot)] : [plot], true);
  return true;
}

/** Harvest all / Water all: the Shift-click action on every open field, with the same toasts (v2-06, v4-01). */
function useOnField(tool: 'hand' | 'water'): void {
  if (placement.kind) return;
  const r = game.dispatch({ type: 'useTool', tool, plots: bulkPlots(game.state), seed: null });
  if (!r.ok) toasts.show(r.reason);
  else if (tool === 'water')
    toasts.show(
      Object.keys(game.state.farm.north).length > 0
        ? 'Every field is watered.'
        : 'The whole field is watered.',
      'good',
    );
  flushStrokeToasts();
}

function endStroke(): void {
  stroke = null;
  flushStrokeToasts();
}

function usePlotTool(plots: number[], first: boolean): void {
  if (!stroke) return;
  const r = game.dispatch({ type: 'useTool', tool: stroke.tool, plots, seed: stroke.seed });
  if (!r.ok && first) toasts.show(r.reason);
}

// ---- placement mode: click a plot to place, a placed object to pick it up
const placeScratch: PlotCoords = { field: null, col: 0, row: 0 };
const previewScratch: PlotCoords = { field: null, col: 0, row: 0 };
function placeAt(plot: number): void {
  const kind = placement.kind;
  const at = placeScratch;
  if (!kind || !plotCoordsOf(game.state, plot, at)) return;
  const field = at.field ?? undefined;
  const there = objectAt(game.state, at.col, at.row, field);
  const r = there
    ? game.dispatch({ type: 'pickUp', id: there.id })
    : game.dispatch(
        field
          ? { type: 'place', kind, col: at.col, row: at.row, field }
          : { type: 'place', kind, col: at.col, row: at.row },
      );
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
  // The renderer asks with world tiles; a tile is a placement spot if it is a plot of the home field or an owned
  // north field (v4-01), never the greenhouse.
  const at = previewScratch;
  const spot = (c: number, r: number): boolean =>
    plotCoordsOf(st, plotIndexAt(st.farm.grid, c, r, 0, st.land.parcels), at);
  renderer.setPreview({
    offsets,
    validAt: (c, r) => {
      if (!spot(c, r)) return false;
      const field = at.field ?? undefined;
      return (
        !!objectAt(st, at.col, at.row, field) || placementProblem(st, kind, at.col, at.row, field) === null
      );
    },
    isPlot: spot,
  });
}

// ---- scene
/** What the town and the farmhouse look like, reused every frame (the renderer compares it without allocating). */
const look: { farmhouse: string; stages: Record<string, number>; restaurant: number; press: number } = {
  farmhouse: 'obj_farmhouse',
  stages: {},
  restaurant: 0,
  press: 0,
};
let lookPaint: string | null = null;
let lookRoof: string | null = null;
let lookLoft = false;
function updateLook(): SceneLook {
  const s = game.state;
  const f = s.decor.farmhouse;
  if (f.paint !== lookPaint || f.roof !== lookRoof || f.loft !== lookLoft) {
    lookPaint = f.paint;
    lookRoof = f.roof;
    lookLoft = f.loft;
    look.farmhouse = farmhouseSpriteId(f.paint, f.roof, f.loft);
  }
  for (let i = 0; i < TOWN_PROJECT_IDS.length; i++) {
    const id = TOWN_PROJECT_IDS[i]!;
    look.stages[id] = s.town.projects[id]?.stagesDone ?? 0;
  }
  look.restaurant = s.restaurant.level;
  look.press = s.press.level;
  return look as SceneLook;
}
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
      case 'pet':
        return petTheCat();
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
      case 'board':
        return panels.open('goals');
      case 'restaurant':
        return panels.open('restaurant');
      case 'press': {
        // A press in the yard with finished drinks: collect them; anywhere else, the panel (v4-03).
        const site = WORLD_LAYOUT.pressSite;
        const slot = col - site.col;
        const p = row === site.row + site.rows - 1 ? game.state.press.slots[slot] : undefined;
        if (p && p.done > 0) {
          const r = game.dispatch({ type: 'collectPress', slot });
          if (!r.ok) toasts.show(r.reason, 'warn');
          return;
        }
        return panels.open('press');
      }
      case 'apiary': {
        // A hive with honey: collect it; an empty spot or an empty hive opens the Apiary card.
        const spot = WORLD_LAYOUT.hiveSpots.findIndex((t) => t.col === col && t.row === row);
        const hive = spot >= 0 ? hiveOnSpot(game.state, spot) : undefined;
        if (hive && hive.honey > 0) {
          const r = game.dispatch({ type: 'collectHive', hive: hive.id });
          if (!r.ok) toasts.show(r.reason, 'warn');
          return;
        }
        panels.open('press');
        return;
      }
    }
  },
  onPlotClick({ plot, shiftKey }) {
    if (!startStroke(plot, shiftKey)) return;
    endStroke();
  },
  // v2-05 Paint mode (a pref) or Alt-drag: the press on a plot uses the tool there, the drag along the stroke.
  onPaintStart({ plot, shiftKey }) {
    if (placement.kind) return false; // placing a sprinkler: presses stay clicks and pans
    startStroke(plot, shiftKey);
    return true;
  },
  onPaintPlot(plot) {
    usePlotTool([plot], false);
  },
  onPaintEnd: endStroke,
  onTownClick(project) {
    goals.showTown();
    panels.open('goals');
    toasts.show(`${GAME_DATA.townProjects[project].name}: see the Town tab.`);
  },
  onDecorClick(col, row) {
    if (build.on) build.click(col, row);
    else if (plant.on) plant.click(col, row);
    else decorate.click(col, row);
  },
  onAnimalClick: petAnimal,
  onBuildingClick(id) {
    const b = buildingById(game.state, id);
    if (b && BUILDINGS[b.kind].houses && storeCount(b) > 0) {
      const r = game.dispatch({ type: 'collectBuilding', building: id });
      if (!r.ok) toasts.show(r.reason, 'warn');
    } else panels.open('ranch');
  },
  onTreeClick(id) {
    const r = game.dispatch({ type: 'pickTree', id });
    if (!r.ok) toasts.show(r.reason, 'warn');
  },
  onSignClick(parcel) {
    buyParcelDialog(parcel, {
      state: () => game.state,
      buy: () => guard.run(`parcel:${parcel}`, () => game.dispatch({ type: 'buyParcel', parcel })),
      toast: (text) => toasts.show(text),
      openLand: () => panels.open('upgrades'),
    });
  },
  onCameraRest(cam) {
    prefs.set('camera', cam);
  },
});
renderer.reducedMotion = isReducedMotion;
renderer.restoreCamera(prefs.value.camera);
renderer.paintMode = prefs.value.paint;
prefs.onChange((p) => {
  renderer.paintMode = p.paint;
  tools.paintButton?.setAttribute('aria-pressed', String(p.paint));
});
const controls = buildSceneControls(byId('scene'), renderer, () => decorate.toggle());
renderer.setScene(game.state.farm.grid, game.state.expansions, game.state.land.parcels, updateLook());
const pips = new EdgePips(byId('scene'), renderer);
const pipTargets: PipTarget[] = [];
/** Off-screen things that want the player (GDD §12.1): ready crops, full traps, a dish left on the stove. */
function updatePips(): void {
  const s = game.state;
  pipTargets.length = 0;
  for (let i = 0; i < s.farm.plots.length; i++)
    if (isReady(s.farm.plots[i]!, GAME_DATA))
      pipTargets.push({ kind: 'crop', ...tileOfPlot(s.farm.grid, i) });
  for (let i = 0; i < s.farm.greenhouse.length; i++)
    if (isReady(s.farm.greenhouse[i]!, GAME_DATA))
      pipTargets.push({ kind: 'crop', ...tileOfPlot(s.farm.grid, 1000 + i) });
  for (const f of NORTH_FIELD_IDS) {
    const plots = s.farm.north[f]?.plots ?? [];
    for (let i = 0; i < plots.length; i++)
      if (isReady(plots[i]!, GAME_DATA))
        pipTargets.push({ kind: 'crop', ...tileOfPlot(s.farm.grid, FIELD_BASE[f] + i) });
  }
  for (const t of s.fishing.traps) {
    const n = t.contents.reduce((a, c) => a + c.qty, 0);
    if (n >= TRAP_CAPACITY) pipTargets.push({ kind: 'trap', ...trapTile(t.location, t.slot) });
  }
  if (s.kitchen.queue.some((j) => j.remainingMs <= 0)) pipTargets.push({ kind: 'dish', col: 2, row: 2 });
  for (const t of ripeTrees(s)) {
    const spot = WORLD_LAYOUT.treeSpots[t.spot]!;
    pipTargets.push({ kind: 'tree', col: spot.col, row: spot.row });
  }
  for (const b of s.ranch.buildings) {
    if (!GAME_DATA.buildings[b.kind].houses) continue;
    if (storeIsFull(GAME_DATA, b)) pipTargets.push({ kind: 'store', col: b.at.col, row: b.at.row });
    if (troughIsEmpty(s, b)) pipTargets.push({ kind: 'trough', col: b.at.col, row: b.at.row });
  }
  // The restaurant (v4-02): a table that has served everything it held.
  if (s.restaurant.menu.some((m) => m.item !== null && m.qty === 0)) {
    const site = WORLD_LAYOUT.restaurantSite;
    pipTargets.push({ kind: 'menu', col: site.col + 2, row: site.row + 2 });
  }
  // The Press House and the apiary (v4-03): finished drinks waiting, and a full hive.
  if (s.press.slots.some((p) => p.done > 0)) {
    const site = WORLD_LAYOUT.pressSite;
    pipTargets.push({ kind: 'drink', col: site.col + 1, row: site.row + site.rows - 1 });
  }
  for (const hv of s.apiary.hives) {
    if (hv.honey < GAME_DATA.hive.store) continue;
    const spot = WORLD_LAYOUT.hiveSpots[hv.spot]!;
    pipTargets.push({ kind: 'hive', col: spot.col, row: spot.row });
  }
  pips.update(pipTargets);
}
window.setInterval(updatePips, 250);

// ---- offline catch-up for the time since the last save
function awayFarm(): AwayFarm {
  const all = allPlotIndexes(game.state).map((i) => plotAt(game.state, i)!);
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
if (initialFile && loaded.kind === 'loaded') {
  // Timed for the phase-09 budget (8 h away < 100 ms); visible in the browser's performance panel.
  performance.mark('hearthfield:catch-up:start');
  const report = game.catchUp(initialFile.savedAt, now());
  performance.measure('hearthfield:catch-up', 'hearthfield:catch-up:start');
  onResume(report);
} else save();
maybeStartTutorial();

if (loaded.kind === 'error') {
  const box = h('textarea', { class: 'save-text', readonly: true, rows: 4, 'aria-label': 'Raw save' });
  box.value = loaded.raw;
  /** The previous good save (save.bak, then older ones on native platforms), if one loads. */
  const backup = slots.loadBackup();
  /** Keep the broken text under another key before anything takes the slot. */
  const keepBroken = (): void => {
    try {
      store.setItem(CORRUPT_KEY, loaded.raw);
    } catch {
      // Storage full: the download button was the other way out.
    }
  };
  const backupText = backup
    ? `A backup from ${new Date(backup.file.savedAt).toLocaleString()} opens fine: load it to carry on from there.`
    : 'Download or copy the text below to keep a backup, then start a new farm.';
  showModal({
    title: 'Oh no, your save would not open',
    dismissible: false,
    body: h(
      'div',
      {},
      h('p', { text: loaded.message }),
      h('p', {
        text: `Nothing has been changed or deleted. ${backupText} The old save stays in place until you choose.`,
      }),
      box,
    ),
    buttons: [
      {
        label: 'Download the raw save',
        // Saves the raw text as a file, so even a broken save can be kept or repaired by hand.
        onClick: () => (void platform.exportFile('hearthfield-idle-save-backup.txt', loaded.raw), false),
      },
      ...(backup
        ? [
            {
              label: 'Load the backup',
              primary: true,
              onClick() {
                keepBroken();
                saveBlocked = false;
                game.replaceState(backup.file.state);
                onResume(game.catchUp(backup.file.savedAt, now()));
              },
            },
          ]
        : []),
      {
        label: 'Start a new farm',
        primary: !backup,
        onClick() {
          keepBroken();
          saveBlocked = false;
          game.replaceState(createInitialState(now(), lc));
          save();
          maybeStartTutorial();
        },
      },
    ],
  });
}

// ---- the scene view, rebuilt in place every frame (no per-frame allocation: see docs/PROGRESS.md phase 09)
const view$: SceneView = {
  plots: [],
  greenhouse: [],
  north: [],
  placed: [],
  farmhand: false,
  traps: [],
  cooking: false,
  decor: [],
  trees: [],
  ranch: { buildings: [], animals: [], troughLevel: [] },
  restaurant: { level: 0, tables: 0, serving: new Uint8Array(MAX_TABLES) },
  press: { level: 0, presses: 0, slot: new Uint8Array(MAX_PRESSES), hive: new Uint8Array(MAX_HIVES) },
  cosmetics: { bakerySmoke: false, band: false, lighthouseBeam: false, festival: false },
  cat: GAME_DATA.cats.cat_tabby.sprite,
};
const plotsView: PlotSprites[] = [];
const greenhouseView: PlotSprites[] = [];
const northViews: PlotSprites[][] = NORTH_FIELD_IDS.map(() => []);
const noPlots: readonly Plot[] = [];
/** Per north field: a plot is wet from the can or a sprinkler of that field (made once, not per frame). */
const northWetAt = NORTH_FIELD_IDS.map((f) => (i: number): boolean => {
  const plot = game.state.farm.north[f]?.plots[i];
  return (plot?.waterMsLeft ?? 0) > 0 || coverage?.byField[f]?.sprinkled[i] === 1;
});
const trapsView: { col: number; row: number; full: boolean }[] = [];
const troughLevels: number[] = [];
let coverage: Coverage | null = null;
const stageOf = (p: Plot): number => plotStage(p, GAME_DATA);
const wetAt = (i: number): boolean => {
  const plot = game.state.farm.plots[i]!;
  return plot.waterMsLeft > 0 || coverage?.sprinkled[i] === 1;
};
const alwaysWet = (): boolean => true;
// A plot's sprite only changes when the simulation ticks (10 a second) or something happened (any event, or a
// different state after an import), so the per-plot sprite list is rebuilt then, not on all 60 frames a second.
let plotsDirty = true;
let plotsTick = -1;
let plotsState: object | null = null;
game.bus.onAny(() => (plotsDirty = true));
function sceneView(): SceneView {
  const s = game.state;
  coverage = coverageOf(s, GAME_DATA);
  if (plotsDirty || game.tickCount !== plotsTick || s !== plotsState) {
    plotsDirty = false;
    plotsTick = game.tickCount;
    plotsState = s;
    view$.plots = plotSpritesInto(plotsView, s.farm.plots, stageOf, wetAt);
    view$.greenhouse = plotSpritesInto(greenhouseView, s.farm.greenhouse, stageOf, alwaysWet);
    for (let k = 0; k < NORTH_FIELD_IDS.length; k++)
      plotSpritesInto(
        northViews[k]!,
        s.farm.north[NORTH_FIELD_IDS[k]!]?.plots ?? noPlots,
        stageOf,
        northWetAt[k],
      );
    view$.north = northViews;
    // How full each trough looks (0 empty, 1 some, 2 full): needs the bundle bonus, so it is worked out here, not per frame.
    troughLevels.length = s.ranch.buildings.length;
    for (let i = 0; i < s.ranch.buildings.length; i++) {
      const b = s.ranch.buildings[i]!;
      const size = troughSize(s, GAME_DATA, b);
      troughLevels[i] = b.trough <= 0 || size <= 0 ? 0 : b.trough * 2 > size ? 2 : 1;
    }
  }
  view$.ranch.buildings = s.ranch.buildings;
  view$.ranch.animals = s.ranch.animals;
  view$.ranch.troughLevel = troughLevels;
  const inn = view$.restaurant;
  inn.level = s.restaurant.level;
  inn.tables = Math.min(MAX_TABLES, s.restaurant.menu.length);
  for (let i = 0; i < inn.tables; i++) inn.serving[i] = s.restaurant.menu[i]!.qty > 0 ? 1 : 0;
  const yard = view$.press;
  yard.level = s.press.level;
  yard.presses = Math.min(MAX_PRESSES, s.press.slots.length);
  for (let i = 0; i < yard.presses; i++) {
    const p = s.press.slots[i]!;
    yard.slot[i] = p.remainingMs > 0 ? PRESS_BUSY : p.done > 0 ? PRESS_DONE : PRESS_IDLE;
  }
  yard.hive.fill(HIVE_NONE);
  for (let i = 0; i < s.apiary.hives.length; i++) {
    const hv = s.apiary.hives[i]!;
    yard.hive[hv.spot] = hv.honey >= GAME_DATA.hive.store ? HIVE_FULL : HIVE_PLAIN;
  }
  view$.placed = s.placed;
  view$.farmhand = (s.upgrades.farmhand ?? 0) > 0;
  trapsView.length = s.fishing.traps.length;
  for (let i = 0; i < s.fishing.traps.length; i++) {
    const t = s.fishing.traps[i]!;
    const tile = trapTile(t.location, t.slot);
    const e = (trapsView[i] ??= { col: 0, row: 0, full: false });
    e.col = tile.col;
    e.row = tile.row;
    e.full = t.contents.length > 0;
  }
  view$.traps = trapsView;
  view$.cooking = false;
  for (const j of s.kitchen.queue) if (j.remainingMs > 0) view$.cooking = true;
  view$.decor = s.decor.placed;
  view$.trees = s.orchard.trees;
  const cos = view$.cosmetics;
  cos.bakerySmoke = hasCosmetic(s, GAME_DATA, 'bakerySmoke');
  cos.band = hasCosmetic(s, GAME_DATA, 'bandSaturday');
  cos.lighthouseBeam = hasCosmetic(s, GAME_DATA, 'lighthouseBeam');
  cos.festival = hasCosmetic(s, GAME_DATA, 'festivalLights');
  view$.cat = GAME_DATA.cats[s.cats.active].sprite;
  return view$;
}

// ---- the tree and animal label (v2-03 trees, v2-05 animals and touch): src/ui/inspectLabel.ts
const label = new InspectLabel({
  host: byId('scene'),
  renderer,
  data: GAME_DATA,
  state: () => game.state,
  mods: () => computeModifiers(game.state, GAME_DATA, game.calendar().season),
});

// ---- loop and autosave
let splashGone = false;
let lastTheme: ReturnType<typeof themeKey> | null = null;
const loop = startLoop(game, {
  render() {
    const cal = game.calendar();
    const town =
      townTuneNow ||
      (prefs.value.townTune && hasMusicTrack(game.state, GAME_DATA, 'town_square') && cal.hour % 3 === 2);
    const theme = town ? townSquareKey(cal.isNight) : themeKey(cal.season, cal.isNight);
    if (theme !== lastTheme) {
      lastTheme = theme;
      music.setTheme(theme);
    }
    tutorialOverlay.update();
    renderer.setScene(game.state.farm.grid, game.state.expansions, game.state.land.parcels, updateLook());
    renderer.render(performance.now(), cal, sceneView());
    if (placement.kind) syncPlacement();
    if (decorate.on) {
      decorate.refresh();
      const hover = renderer.hoverTile;
      const why = hover ? decorate.problemAt(hover.col, hover.row) : null;
      const canvas = byId<HTMLCanvasElement>('scene-canvas');
      if (canvas.title !== (why ?? '')) canvas.title = why ?? '';
    }
    if (!decorate.on && !plant.on && !build.on) label.update(cal.dayIndex);
    else label.hide();
    hud.update(game.state, cal);
    tools.update();
    toolbar.setVisible('ranch', ranchOpen(game.state));
    toolbar.setVisible('restaurant', restaurantBuilt(game.state));
    toolbar.setVisible('press', pressBuilt(game.state));
    if (panelsDirty) {
      panelsDirty = false;
      panels.refreshOpen();
    }
    panels.tickOpen(performance.now());
    if (!splashGone) {
      splashGone = true;
      dismissSplash();
    }
  },
  onResume,
});
window.setInterval(() => void saveAndFlush(), AUTOSAVE_MS);
window.addEventListener('beforeunload', save);

// ---- lifecycle (v3 phase 00). Pause: save and flush, stop the loop, suspend audio. Resume: the
// offline catch-up (the loop calls onResume, as returning to a tab always did), then audio, at
// once where the platform allows it and otherwise on the next tap or key (mobile rules).
platform.onPause(() => {
  loop.pause();
  void saveAndFlush();
  engine.suspend();
});
platform.onResume(() => {
  loop.resume();
  engine.tryResume();
  unlockOnFirstGesture(engine, document);
});

// ---- back: Escape on the web, the Android back button or a gamepad B in the shells, all in one order
// (src/ui/back.ts): a modal (or the seed picker), then Decorate / plant / build / placement mode (or a Paint
// stroke), then the panel, then a tap-to-inspect label.
const backUi: BackUi = {
  closeModal: () => closeTopModal() || tools.closePickerIfOpen(),
  leaveMode() {
    if (stroke) {
      endStroke(); // the rest of the drag does nothing (usePlotTool needs a stroke); the release ends it again
      return true;
    }
    if (decorate.back()) return true;
    for (const mode of [plant, build]) {
      if (mode.on) {
        mode.stop();
        return true;
      }
    }
    if (!placement.kind) return false;
    placement.stop();
    return true;
  },
  closePanel() {
    if (!panels.current) return false;
    panels.close();
    return true;
  },
  clearLabel() {
    if (renderer.inspected.kind === INSPECT_NONE) return false;
    renderer.clearInspect();
    return true;
  },
};
const back = (): boolean => goBack(backUi);
document.addEventListener(
  'keydown',
  (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented || !back()) return;
    e.preventDefault();
    e.stopPropagation();
  },
  true,
);
platform.onBack(back);

// ---- the installable web app: a service worker on the Pages build only (never in the shells or dev)
if (import.meta.env.PROD && import.meta.env.MODE !== 'app') {
  void import('./ui/serviceWorker').then(({ registerServiceWorker }) =>
    registerServiceWorker(`${import.meta.env.BASE_URL}sw.js`, (reload) =>
      toasts.show('A new version is ready, reload to update.', 'info', () => {
        void saveAndFlush().then(reload);
      }),
    ),
  );
}

// ---- dev helpers: `?debug` on the Pages build, always in dev, never in the app build
if (debugHooks) {
  void import('./ui/debug').then(({ installDebugOverlay }) =>
    installDebugOverlay({
      game,
      fps: () => loop.fps,
      onOffline: onResume,
      toggleInsets: () => applyFakeInsets(document.documentElement, undefined),
    }),
  );
}

if (e2eHooks) exposeHooks();

/** Exposed for the e2e tests and manual poking in the console (never in the app build unless VITE_E2E=1). */
function exposeHooks(): void {
  (window as unknown as { __game: Game }).__game = game;
  /**
   * e2e hook for the camera: the client position of a world tile (after panning it into view if it
   * is not), so specs never depend on where the camera starts.
   */
  (window as unknown as { __view: unknown }).__view = {
    tileClient(col: number, row: number): { x: number; y: number; visible: boolean } {
      const at = renderer.tileClientCenter(col, row);
      return { ...at, visible: renderer.isTileVisible(col, row) };
    },
    showTile(col: number, row: number): void {
      renderer.panToTile(col, row, true);
    },
    camera: () => ({ ...renderer.cam, default: prefs.value.camera === null }),
    chunksDrawn: () => renderer.chunksDrawn,
    objectsDrawn: () => renderer.objectsDrawn,
    home: () => renderer.home(),
    /** Lamps and lights the last frame lit (night halos). */
    lightsLit: () => renderer.lightsLit,
    decorMode: () => decorate.on,
    sceneSprites: () => renderer.layoutSpriteIds(),
    /** The farmhand figure: its feet in world px and the field it is in (v4-01, e2e). */
    farmhand: () => ({ x: renderer.farmhand.x, y: renderer.farmhand.y, area: renderer.farmhand.area }),
    /** Where an animal's feet are in world px (e2e: click an animal). */
    animalAt: (id: number) => renderer.ranch.positionOf(id),
    /** Building mode (e2e). */
    buildMode: () => build.on,
    /** What a touch tap is inspecting, and whether a paint stroke is under way (v2-05, e2e). */
    inspected: () => ({ ...renderer.inspected }),
    painting: () => renderer.isPainting,
    /** Diners at the restaurant (v4-02, e2e): on the terrace or on their way, and seated. */
    diners: () => ({ count: renderer.restaurant.dinerCount, seated: renderer.restaurant.seatedCount }),
    /** Time passes away from the game (e2e: the offline catch-up and its away summary, like returning to the tab). */
    awayFor: (ms: number) => onResume(game.debugFakeOffline(ms)),
    /** World px → client point (e2e: tap an animal where it stands now). */
    worldClient: (x: number, y: number) => renderer.worldToClient(x, y),
  };
}
