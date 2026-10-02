// The Fishing panel (GDD §6.4): a little pond with a bobber, the cast-and-reel minigame, the Fish
// Collection and the Traps tab. All rules live in src/systems/fishing.ts; this file renders the
// session and forwards input as `fishStart` / `fishTick` actions. Input works with a mouse, touch
// (one big button) and the Space bar. The minigame only runs while the panel is open.

import type { EventBus } from '../core/events';
import type { GameState } from '../core/state';
import type { GameData } from '../data';
import { CAST_POWER_GOOD } from '../data/balance';
import { FISH_LOCATIONS, LOCATION_NAMES } from '../data/fish';
import { FISH_IDS, type FishId, type FishLocationId } from '../data/ids';
import { spriteDataUrl, spriteFrame } from '../render/spriteCache';
import type { Action } from '../core/actions';
import type { ActionResult } from '../systems/context';
import { catchTable, localHour } from '../systems/fishing';
import { isLocationUnlocked, trapsAt } from '../systems/locations';
import { trapCapacity, trapItemCount } from '../systems/traps';
import { capitalize } from '../core/time';
import { h } from './dom';
import type { PanelDef } from './panel';
import type { GameViewHooks } from './panels';

export interface FishingHooks extends GameViewHooks {
  bus: EventBus;
  dispatch(action: Action): ActionResult;
  /** Where a locked location is bought, for the hint under its button. */
  lockedHint(location: FishLocationId): string;
}

const STAGE_TILES_W = 8;
const STAGE_TILES_H = 4;
const STAGE_W = STAGE_TILES_W * 16;
const STAGE_H = STAGE_TILES_H * 16;
const SPLASH_MS = 440;

type Tab = 'fish' | 'traps' | 'collection';

const WATER_TILE: Record<FishLocationId, string> = {
  pond: 'tile_water',
  river: 'tile_river',
  ocean: 'tile_sea',
};

const RARITY_LABEL = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  legendary: 'Legendary',
} as const;

export interface FishingPanel {
  def: PanelDef;
  /** Chooses the location the panel opens on (the scene's water zones call this before opening it). */
  showLocation(location: FishLocationId): void;
}

/**
 * The Fish Collection: a summary line and a card per fish (a silhouette and "???" until it is
 * caught). Shared by the Fishing panel's Collection tab and the Goals panel's Fish tab.
 */
export function renderFishCollection(
  summary: HTMLElement,
  grid: HTMLElement,
  st: GameState,
  data: GameData,
): void {
  const log = st.fishing.collection;
  const caught = FISH_IDS.filter((f) => log[f]).length;
  summary.textContent = `${caught} of ${FISH_IDS.length} fish found.`;
  grid.replaceChildren(
    ...FISH_IDS.map((id) => {
      const f = data.fish[id];
      const e = log[id];
      return h(
        'div',
        { class: `fish-card${e ? '' : ' is-unknown'}`, 'data-fish': id },
        h('img', {
          class: `pixel${e ? '' : ' silhouette'}`,
          alt: '',
          width: 32,
          height: 32,
          src: spriteDataUrl(`item_${id}`),
        }),
        h('span', { class: 'fish-card-name', text: e ? f.name : '???' }),
        h('span', {
          class: 'seed-note',
          text: e
            ? `${RARITY_LABEL[f.rarity]} · ${LOCATION_NAMES[f.location]}`
            : `${LOCATION_NAMES[f.location]}`,
        }),
        e
          ? h('span', {
              class: 'seed-note',
              text: `First: ${e.firstCaughtAt} · Best: ${e.bestSizeCm} cm · ×${e.count}`,
            })
          : null,
      );
    }),
  );
}

export function fishingPanel(hooks: FishingHooks): FishingPanel {
  let location: FishLocationId = 'pond';
  let tab: Tab = 'fish';
  let refreshAll: (() => void) | null = null;

  const def: PanelDef = {
    id: 'fishing',
    wide: true,
    title: 'Fishing',
    icon: '🎣',
    live: true,
    build(body) {
      // ---- tabs
      const tabs = h('div', { class: 'fish-tabs', role: 'tablist' });
      const tabButtons = new Map<Tab, HTMLButtonElement>();
      const sections = new Map<Tab, HTMLElement>();
      const addTab = (id: Tab, label: string): void => {
        const b = h('button', {
          type: 'button',
          class: 'btn btn-small',
          role: 'tab',
          'data-tab': id,
          text: label,
        });
        b.addEventListener('click', () => {
          tab = id;
          showTab();
          refresh();
        });
        tabButtons.set(id, b);
        tabs.append(b);
      };
      addTab('fish', 'Fishing');
      addTab('traps', 'Traps');
      addTab('collection', 'Collection');

      // ---- fishing tab: location buttons, the pond, the reel bar, the action button
      const locRow = h('div', {
        class: 'btn-row fish-locations',
        role: 'group',
        'aria-label': 'Where to fish',
      });
      const locHint = h('p', { class: 'muted fish-hint' });
      const now = h('p', { class: 'muted fish-now' });
      const canvas = h('canvas', {
        class: 'fish-stage pixel',
        width: STAGE_W,
        height: STAGE_H,
        'aria-hidden': 'true',
      });
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      const status = h('p', { class: 'fish-status', role: 'status', 'aria-live': 'polite' });
      const zone = h('div', { class: 'reel-zone' });
      const marker = h('div', { class: 'reel-marker' });
      const track = h('div', { class: 'reel-track', 'aria-hidden': 'true' }, zone, marker);
      const meterFill = h('div', { class: 'reel-meter-fill' });
      const meter = h('div', { class: 'reel-meter', 'aria-hidden': 'true' }, meterFill);
      const reel = h('div', { class: 'reel' }, track, meter);
      const action = h('button', {
        type: 'button',
        class: 'btn btn-primary fish-action',
        'data-role': 'cast',
        text: 'Hold to cast',
      });
      const putAway = h('button', { type: 'button', class: 'btn btn-small', text: 'Put the rod away' });
      const result = h('div', { class: 'fish-result', 'aria-live': 'polite' });
      const help = h('p', {
        class: 'muted',
        text: 'Hold the button (or Space) to charge a cast, release to throw. When the ! appears, hold to reel: keep the marker inside the glowing zone until the meter fills.',
      });
      const fishSection = h(
        'div',
        { class: 'fish-section' },
        locRow,
        locHint,
        now,
        canvas,
        status,
        reel,
        h('div', { class: 'btn-row' }, action, putAway),
        result,
        help,
      );
      sections.set('fish', fishSection);

      // ---- traps and collection tabs
      const trapList = h('div', { class: 'crate-list fish-traps' });
      const trapMsg = h('p', { class: 'form-msg', role: 'status' });
      sections.set('traps', h('div', { class: 'fish-section' }, trapList, trapMsg));
      const collectionSummary = h('p', { class: 'muted' });
      const collectionGrid = h('div', { class: 'fish-collection' });
      sections.set('collection', h('div', { class: 'fish-section' }, collectionSummary, collectionGrid));

      body.append(tabs, ...sections.values());

      const showTab = (): void => {
        for (const [id, el] of sections) el.hidden = id !== tab;
        for (const [id, b] of tabButtons) {
          b.setAttribute('aria-selected', String(id === tab));
          b.classList.toggle('is-active', id === tab);
        }
      };

      // ---- input: pointer on the button, Space anywhere in the panel
      let holding = false;
      let armed = true; // a new cast needs a fresh press, so holding through a catch does not recast
      const setHold = (on: boolean): void => {
        holding = on;
        if (!on) armed = true;
        action.classList.toggle('is-held', on);
      };
      action.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        try {
          action.setPointerCapture(e.pointerId);
        } catch {
          // Synthetic events have no active pointer to capture.
        }
        setHold(true);
      });
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
        action.addEventListener(ev, () => setHold(false));
      }
      action.addEventListener('contextmenu', (e) => e.preventDefault());
      const panelOpen = (): boolean => body.isConnected && body.offsetParent !== null && tab === 'fish';
      const typing = (t: EventTarget | null): boolean =>
        t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;
      document.addEventListener('keydown', (e) => {
        if (e.code !== 'Space' || !panelOpen() || typing(e.target)) return;
        e.preventDefault();
        if (!e.repeat) setHold(true);
      });
      document.addEventListener('keyup', (e) => {
        if (e.code === 'Space' && holding) setHold(false);
      });
      window.addEventListener('blur', () => setHold(false));
      putAway.addEventListener('click', () => {
        hooks.dispatch({ type: 'fishCancel' });
        lastResult = null;
        refresh();
      });

      // ---- events: what the last cast ended in, and a splash on the pond
      type Result = { text: string; icon: string | null; isNew: boolean } | null;
      let lastResult = null as Result;
      let splashAt = -Infinity;
      let splashX = STAGE_W / 2;
      hooks.bus.on('caught', (e) => {
        if (e.viaTrap) return;
        const item = hooks.data.items[e.catch];
        const isNew =
          e.catch in hooks.data.fish && hooks.state().fishing.collection[e.catch as FishId]?.count === 1;
        const size = e.sizeCm > 0 ? ` (${e.sizeCm} cm)` : '';
        lastResult = {
          text: `You caught ${item?.name ?? e.catch}${size}!`,
          icon: item?.sprite ?? null,
          isNew,
        };
        splashAt = performance.now();
      });
      hooks.bus.on('escaped', () => {
        lastResult = {
          text: 'It got away. Fish are never lost for long; cast again.',
          icon: null,
          isNew: false,
        };
        splashAt = performance.now();
      });

      // ---- rendering
      const drawStage = (t: number): void => {
        const st = hooks.state();
        const s = st.fishing.session;
        const water = WATER_TILE[s?.location ?? location];
        for (let ty = 0; ty < STAGE_TILES_H; ty++) {
          for (let tx = 0; tx < STAGE_TILES_W; tx++) {
            const sprite = ty === 0 ? (tx % 2 ? 'tile_grass_b' : 'tile_grass_a') : water;
            ctx.drawImage(spriteFrame(sprite, t), tx * 16, ty * 16);
          }
        }
        ctx.drawImage(spriteFrame('tile_path'), 0, 16);
        ctx.drawImage(spriteFrame('tile_path'), 16, 16);
        ctx.drawImage(spriteFrame('ui_tool_rod'), 4, 0);
        if (s && s.phase !== 'charging') {
          const bx = 40 + Math.round(s.power * 64);
          const by = 40;
          splashX = bx;
          const biting = s.phase === 'bite' || s.phase === 'reeling';
          // The line, from the rod tip to the float.
          ctx.strokeStyle = '#fff4dc';
          ctx.globalAlpha = 0.8;
          ctx.beginPath();
          ctx.moveTo(19, 3);
          ctx.quadraticCurveTo((19 + bx) / 2, biting ? 24 : 12, bx, by - 3);
          ctx.stroke();
          ctx.globalAlpha = 1;
          ctx.drawImage(spriteFrame(biting ? 'obj_bobber_dip' : 'obj_bobber', t), bx - 8, by - 8);
          if (s.phase === 'bite') ctx.drawImage(spriteFrame('ui_bite', t), bx - 8, by - 26);
        } else if (s) {
          // Charging: a power bar over the water.
          ctx.fillStyle = '#2b1d1a';
          ctx.fillRect(28, 52, 74, 6);
          ctx.fillStyle = s.power >= 0.8 ? '#f2c14e' : '#fff4dc';
          ctx.fillRect(29, 53, Math.round(72 * s.power), 4);
        }
        if (t - splashAt < SPLASH_MS) {
          ctx.drawImage(spriteFrame('fx_splash', t - splashAt), splashX - 8, 32);
        }
      };

      const paint = (): void => {
        const st = hooks.state();
        const s = st.fishing.session;
        const r = s?.reel ?? null;
        reel.style.visibility = r ? 'visible' : 'hidden';
        if (r) {
          zone.style.left = `${(r.zoneCenter - r.zoneWidth / 2) * 100}%`;
          zone.style.width = `${r.zoneWidth * 100}%`;
          marker.style.left = `${r.marker * 100}%`;
          meterFill.style.width = `${r.meter * 100}%`;
          const inside = Math.abs(r.marker - r.zoneCenter) <= r.zoneWidth / 2;
          marker.classList.toggle('in-zone', inside);
        }
        const label = !s
          ? 'Hold to cast'
          : s.phase === 'charging'
            ? 'Release to cast'
            : s.phase === 'waiting'
              ? 'Waiting…'
              : s.phase === 'bite'
                ? 'Hold to reel in!'
                : 'Hold to reel';
        if (action.textContent !== label) action.textContent = label;
        putAway.hidden = !s;
        const text = !s
          ? 'The water is calm. Hold the button to cast.'
          : s.phase === 'charging'
            ? s.power >= CAST_POWER_GOOD
              ? 'A strong cast! Release to throw.'
              : 'Charging your cast… release to throw.'
            : s.phase === 'waiting'
              ? 'Waiting for a bite…'
              : s.phase === 'bite'
                ? 'A bite! Hold to reel it in!'
                : 'Keep the marker inside the zone!';
        if (status.textContent !== text) status.textContent = text;
        canvas.dataset.phase = s?.phase ?? 'idle';
      };

      let last = performance.now();
      const frame = (t: number): void => {
        requestAnimationFrame(frame);
        const dt = Math.min(100, Math.max(0, t - last));
        last = t;
        if (!panelOpen()) {
          holding = false;
          return;
        }
        const st = hooks.state();
        if (!st.fishing.session) {
          if (holding && armed && isLocationUnlocked(st, location)) {
            armed = false;
            const r = hooks.dispatch({ type: 'fishStart', location });
            if (!r.ok) status.textContent = r.reason;
            else lastResult = null;
          }
        } else {
          location = st.fishing.session.location;
          hooks.dispatch({ type: 'fishTick', holding, dtMs: dt });
        }
        paint();
        drawStage(t);
        renderResult();
      };
      requestAnimationFrame(frame);

      let shownResult: Result | undefined;
      const renderResult = (): void => {
        if (shownResult === lastResult) return;
        shownResult = lastResult;
        result.replaceChildren();
        if (!lastResult) return;
        const r = lastResult;
        result.append(
          ...(r.icon
            ? [h('img', { class: 'pixel', alt: '', width: 32, height: 32, src: spriteDataUrl(r.icon) })]
            : []),
          h('span', { text: r.text }),
          ...(r.isNew ? [h('strong', { class: 'fish-new', text: ' New for your collection!' })] : []),
        );
      };

      // ---- the parts that follow game state (rebuilt on refresh; the button and stage are not)
      const refresh = (): void => {
        const st = hooks.state();
        const cal = hooks.calendar();
        if (st.fishing.session) location = st.fishing.session.location;

        locRow.replaceChildren(
          ...FISH_LOCATIONS.map((l) => {
            const open = isLocationUnlocked(st, l);
            const b = h('button', {
              type: 'button',
              class: `btn btn-small${l === location ? ' is-active' : ''}`,
              'data-location': l,
              'aria-pressed': String(l === location),
              disabled: !open || (!!st.fishing.session && st.fishing.session.location !== l),
              text: `${open ? '' : '🔒 '}${LOCATION_NAMES[l]}`,
            });
            b.addEventListener('click', () => {
              location = l;
              refresh();
            });
            return b;
          }),
        );
        const locked = FISH_LOCATIONS.filter((l) => !isLocationUnlocked(st, l));
        locHint.textContent = locked.length ? locked.map((l) => hooks.lockedHint(l)).join(' ') : '';

        const table = catchTable(hooks.data, {
          location,
          season: cal.season,
          hour: localHour({ calendar: cal }),
          mode: 'active',
          luck: hooks.mods().fishingLuckModifier,
        }).filter((o) => o.id in hooks.data.fish);
        now.textContent = table.length
          ? `Biting now at the ${LOCATION_NAMES[location].toLowerCase()} (${capitalize(cal.season)}): ${table
              .map((o) => hooks.data.fish[o.id as FishId].name)
              .join(', ')}.`
          : `Nothing much is biting at the ${LOCATION_NAMES[location].toLowerCase()} right now.`;

        renderTraps(st);
        renderCollection(st);
        showTab();
      };
      refreshAll = refresh;

      const renderTraps = (st: ReturnType<typeof hooks.state>): void => {
        const rows: HTMLElement[] = [];
        for (const l of FISH_LOCATIONS) {
          for (const trap of trapsAt(st, l)) {
            const n = trapItemCount(trap);
            const summary = trap.contents.length
              ? trap.contents.map((c) => `${c.qty} ${hooks.data.items[c.item]?.name ?? c.item}`).join(', ')
              : 'empty';
            const collect = h('button', {
              type: 'button',
              class: 'btn btn-small btn-primary',
              'data-trap': String(trap.id),
              text: 'Collect',
              disabled: n === 0,
            });
            collect.addEventListener('click', () => {
              const r = hooks.dispatch({ type: 'collectTrap', id: trap.id });
              trapMsg.textContent = r.ok ? 'Collected.' : r.reason;
              trapMsg.className = r.ok ? 'form-msg form-ok' : 'form-msg form-error';
              refresh();
            });
            rows.push(
              h(
                'div',
                { class: 'crate-row upgrade-row', 'data-trap-row': String(trap.id) },
                h('img', {
                  class: 'pixel upgrade-icon',
                  alt: '',
                  width: 24,
                  height: 24,
                  src: spriteDataUrl(n > 0 ? 'obj_fish_trap_full' : 'obj_fish_trap'),
                }),
                h(
                  'div',
                  { class: 'crate-text' },
                  h('span', {
                    text: `${LOCATION_NAMES[l]} trap ${trap.slot + 1} · ${n} / ${trapCapacity(hooks.mods())}`,
                  }),
                  h('span', { class: 'seed-note', text: summary }),
                ),
                h('div', { class: 'btn-row' }, collect),
              ),
            );
          }
        }
        trapList.replaceChildren(
          ...(rows.length
            ? rows
            : [
                h('p', {
                  class: 'muted',
                  text: 'No traps yet. Buy Fish Traps in Upgrades: they fill on their own, even at night.',
                }),
              ]),
          h('p', {
            class: 'muted',
            text: 'Traps catch common and uncommon fish and junk every 3 minutes, at any hour. Click a trap in the scene, or here, to collect.',
          }),
        );
      };

      const renderCollection = (st: ReturnType<typeof hooks.state>): void =>
        renderFishCollection(collectionSummary, collectionGrid, st, hooks.data);

      return { refresh };
    },
  };

  return {
    def,
    showLocation(l) {
      location = l;
      tab = 'fish';
      refreshAll?.();
    },
  };
}
