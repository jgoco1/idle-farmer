import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PREFS,
  formatNumber,
  loadPrefs,
  PREFS_KEY,
  PrefsStore,
  reducedMotion,
  sanitizePrefs,
} from '../src/core/prefs';
import { createInitialState } from '../src/core/state';
import { Ambient, AMBIENT_COUNTS } from '../src/render/ambient';
import { PALETTE } from '../src/render/palette';
import { ParticleSystem } from '../src/render/particles';
import { buildZones, PET_TILE, zoneAt } from '../src/render/scene';
import { coinCount } from '../src/ui/coinFly';
import { isFreshFarm, TUTORIAL_STEPS, TutorialFlow } from '../src/ui/tutorialFlow';
import { at, NY } from './helpers';

function memory(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe('settings persistence', () => {
  it('starts with quiet music and everything else on', () => {
    expect(DEFAULT_PREFS.music).toBeLessThan(DEFAULT_PREFS.sfx);
    expect(DEFAULT_PREFS.muted).toBe(false);
    expect(loadPrefs(memory())).toEqual(DEFAULT_PREFS);
  });

  it('writes every change under its own key and reads it back', () => {
    const storage = memory();
    const store = new PrefsStore(storage);
    store.set('master', 0.3);
    store.set('sfx', 0.6);
    store.set('music', 0.1);
    store.set('muted', true);
    store.set('motion', 'reduce');
    store.set('uiScale', 1.5);
    store.set('numberFormat', 'short');
    expect(storage.map.has(PREFS_KEY)).toBe(true);
    expect(new PrefsStore(storage).value).toEqual({
      ...DEFAULT_PREFS,
      master: 0.3,
      sfx: 0.6,
      music: 0.1,
      muted: true,
      motion: 'reduce',
      uiScale: 1.5,
      numberFormat: 'short',
    });
  });

  it('notifies listeners and lets them unsubscribe', () => {
    const store = new PrefsStore(memory());
    const seen: number[] = [];
    const off = store.onChange((p) => seen.push(p.master));
    store.set('master', 0.5);
    off();
    store.set('master', 0.9);
    expect(seen).toEqual([0.5]);
  });

  it('repairs garbage instead of trusting it', () => {
    expect(
      sanitizePrefs({
        master: 7,
        sfx: 'loud',
        uiScale: 3,
        motion: 'sometimes',
        numberFormat: 1,
        tutorial: 'x',
      }),
    ).toEqual({ ...DEFAULT_PREFS, master: 1 });
    const storage = memory();
    storage.setItem(PREFS_KEY, '{not json');
    expect(loadPrefs(storage)).toEqual(DEFAULT_PREFS);
    expect(sanitizePrefs(null)).toEqual(DEFAULT_PREFS);
  });

  it('never throws when storage is broken', () => {
    const broken = {
      getItem: () => {
        throw new Error('no');
      },
      setItem: () => {
        throw new Error('no');
      },
      removeItem: () => undefined,
    };
    const store = new PrefsStore(broken);
    expect(() => store.set('master', 0.2)).not.toThrow();
    expect(store.value.master).toBe(0.2);
  });

  it('is independent of the farm save: a new farm keeps the prefs and changes no save shape', () => {
    const state = createInitialState(at(NY, 2025, 3, 1, 12), NY);
    expect(Object.keys(state.settings).sort()).toEqual(['masterVolume', 'relaxedFishing']);
  });
});

describe('reduced motion', () => {
  it('follows the system on auto and the player otherwise', () => {
    expect(reducedMotion({ motion: 'auto' }, true)).toBe(true);
    expect(reducedMotion({ motion: 'auto' }, false)).toBe(false);
    expect(reducedMotion({ motion: 'reduce' }, false)).toBe(true);
    expect(reducedMotion({ motion: 'full' }, true)).toBe(false);
  });

  it('emits no particles at all when reduced, and follows the setting live', () => {
    let reduced = true;
    const ps = new ParticleSystem(() => reduced);
    expect(ps.emit('soil', 10, 10)).toBe(0);
    expect(ps.emit('sparkle', 10, 10)).toBe(0);
    expect(ps.aliveCount).toBe(0);
    reduced = false;
    expect(ps.emit('soil', 10, 10)).toBeGreaterThan(0);
    expect(ps.aliveCount).toBeGreaterThan(0);
  });

  it('ambient creatures and falling pieces vanish under reduced motion', () => {
    let reduced = true;
    const a = new Ambient(() => reduced);
    const noon = { hour: 12, isNight: false, season: 'spring' as const };
    expect(a.visible(noon)).toEqual({ butterflies: 0, fireflies: 0, fall: 0, clouds: 0 });
    reduced = false;
    expect(a.visible(noon).butterflies).toBe(AMBIENT_COUNTS.spring.butterflies);
  });
});

describe('particles', () => {
  it('lives and dies, and never grows past its pool', () => {
    const ps = new ParticleSystem();
    for (let i = 0; i < 200; i++) ps.emit('sparkle', 50, 50, 3);
    expect(ps.aliveCount).toBeLessThanOrEqual(320);
    for (let i = 0; i < 30; i++) ps.update(100);
    expect(ps.aliveCount).toBe(0);
  });

  it('has a recipe for every kind the game uses', () => {
    const ps = new ParticleSystem();
    for (const kind of ['soil', 'droplet', 'leaf', 'ripple', 'steam', 'sparkle', 'heart'] as const)
      expect(ps.emit(kind, 20, 20)).toBeGreaterThan(0);
  });

  it('does not touch the game RNG: the state is unchanged by emitting', () => {
    const state = createInitialState(at(NY, 2025, 3, 1, 12), NY);
    const before = state.rngState;
    new ParticleSystem().emit('leaf', 1, 1);
    new Ambient().update(100, { hour: 12, isNight: false, season: 'spring' });
    expect(state.rngState).toBe(before);
  });
});

describe('ambient life', () => {
  const clock = (hour: number, season: 'spring' | 'winter' | 'summer' | 'autumn') => ({
    hour,
    isNight: hour >= 20 || hour < 6,
    season,
  });

  it('butterflies by day, fireflies at night, never both', () => {
    const a = new Ambient();
    const day = a.visible(clock(12, 'summer'));
    const night = a.visible(clock(22, 'summer'));
    expect(day.butterflies).toBeGreaterThan(0);
    expect(day.fireflies).toBe(0);
    expect(night.butterflies).toBe(0);
    expect(night.fireflies).toBeGreaterThan(0);
    expect(a.visible(clock(6, 'summer')).butterflies).toBe(0); // dawn: still quiet
  });

  it('winter has snow but no butterflies, and clouds only drift by day', () => {
    const a = new Ambient();
    expect(a.visible(clock(12, 'winter')).butterflies).toBe(0);
    expect(a.visible(clock(12, 'winter')).fall).toBeGreaterThan(0);
    expect(a.visible(clock(12, 'spring')).clouds).toBeGreaterThan(0);
    expect(a.visible(clock(23, 'spring')).clouds).toBe(0);
  });

  it('keeps every creature inside the scene while it moves', () => {
    const a = new Ambient();
    for (let i = 0; i < 600; i++) a.update(50, clock(12, 'spring'));
    const creatures = (a as unknown as { butterflies: { x: number; y: number }[] }).butterflies;
    for (const c of creatures) {
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.x).toBeLessThanOrEqual(320);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeLessThanOrEqual(192);
    }
  });

  it('the farm cat is a clickable zone beside the farmhouse', () => {
    const zones = buildZones({ cols: 4, rows: 2 });
    expect(zoneAt(zones, PET_TILE.col, PET_TILE.row)?.id).toBe('pet');
    expect(zoneAt(zones, 2, 2)?.id).toBe('farmhouse');
  });
});

describe('number format', () => {
  it('prints full numbers or 1.2K / 3.4M', () => {
    expect(formatNumber(1234, 'full')).toBe('1,234');
    expect(formatNumber(1234, 'short')).toBe('1.2K');
    expect(formatNumber(999, 'short')).toBe('999');
    expect(formatNumber(3_400_000, 'short')).toBe('3.4M');
    expect(formatNumber(12_000, 'short')).toBe('12K');
    expect(formatNumber(250_000, 'short')).toBe('250K');
    expect(formatNumber(5_600_000_000, 'short')).toBe('5.6B');
    expect(formatNumber(0, 'short')).toBe('0');
  });
});

describe('coin fly', () => {
  it('sends more coins for more gold, from 1 to 8', () => {
    expect(coinCount(1)).toBe(1);
    expect(coinCount(50)).toBeGreaterThanOrEqual(3);
    expect(coinCount(1e9)).toBe(8);
    expect(coinCount(10_000)).toBeGreaterThanOrEqual(coinCount(100));
  });
});

describe('tutorial flow', () => {
  const ev = (type: 'planted' | 'watered' | 'harvested' | 'sold') => ({ kind: 'event', type }) as const;

  it('walks plots → seeds → water → harvest → sell → shop → done', () => {
    expect(TUTORIAL_STEPS.map((s) => s.id)).toEqual([
      'plots',
      'seeds',
      'water',
      'harvest',
      'sell',
      'shop',
      'done',
    ]);
    const f = new TutorialFlow();
    expect(f.status).toBe('idle');
    f.start();
    expect(f.step?.id).toBe('plots');
    f.signal(ev('planted')); // not yet: the first step is "Next"
    expect(f.step?.id).toBe('plots');
    f.signal({ kind: 'next' });
    expect(f.step?.id).toBe('water'); // planting was already done, so seeds is skipped
    f.signal(ev('watered'));
    expect(f.step?.id).toBe('harvest');
    f.signal(ev('sold')); // out of order: remembered
    f.signal(ev('harvested'));
    expect(f.step?.id).toBe('shop'); // sell was already done
    f.signal({ kind: 'panel', id: 'goals' });
    expect(f.step?.id).toBe('shop'); // the wrong panel does nothing
    f.signal({ kind: 'panel', id: 'shop' });
    expect(f.step?.id).toBe('done');
    f.signal({ kind: 'next' });
    expect(f.status).toBe('finished');
    expect(f.step).toBeNull();
  });

  it('Next does not skip a step that waits for the player to act', () => {
    const f = new TutorialFlow();
    f.start();
    f.signal({ kind: 'next' });
    expect(f.step?.id).toBe('seeds');
    f.signal({ kind: 'next' });
    expect(f.step?.id).toBe('seeds');
  });

  it('can be skipped at any step, and then ignores signals', () => {
    const f = new TutorialFlow();
    f.start();
    f.signal({ kind: 'next' });
    f.skip();
    expect(f.status).toBe('skipped');
    f.signal(ev('planted'));
    expect(f.status).toBe('skipped');
    expect(f.step).toBeNull();
  });

  it('replays from the start and forgets earlier signals', () => {
    const f = new TutorialFlow();
    f.start();
    f.signal(ev('planted'));
    f.skip();
    f.start();
    expect(f.step?.id).toBe('plots');
    f.signal({ kind: 'next' });
    expect(f.step?.id).toBe('seeds');
  });

  it('tells its listeners about every change', () => {
    const f = new TutorialFlow();
    let n = 0;
    f.onChange(() => n++);
    f.start();
    f.signal({ kind: 'next' });
    f.skip();
    expect(n).toBe(3);
  });

  it('only a fresh farm gets the tutorial unasked', () => {
    const state = createInitialState(at(NY, 2025, 3, 1, 12), NY);
    expect(isFreshFarm(state)).toBe(true);
    state.stats.cropsHarvested = 1;
    expect(isFreshFarm(state)).toBe(false);
  });

  it('every step names a target the page has', () => {
    for (const s of TUTORIAL_STEPS)
      expect(['plots', 'auto-tool', 'market-button', 'shop-button', 'goals-button']).toContain(s.target);
  });
});

describe('page metadata', () => {
  const html = readFileSync('index.html', 'utf8');
  const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8')) as Record<string, unknown>;

  it('has a title, a theme colour, a favicon and a manifest link', () => {
    expect(html).toMatch(/<title>Hearthfield Idle<\/title>/);
    expect(html).toContain(`name="theme-color" content="${PALETTE.wood_mid}"`);
    expect(html).toMatch(/rel="icon"/);
    expect(html).toMatch(/rel="manifest"/);
  });

  it('every colour written in index.html is a palette colour', () => {
    const palette = new Set<string>(Object.values(PALETTE));
    for (const hex of html.match(/#[0-9a-f]{6}\b/gi) ?? []) expect(palette.has(hex.toLowerCase())).toBe(true);
  });

  it('the manifest is installable and matches the theme', () => {
    expect(manifest.display).toBe('standalone');
    expect(manifest.theme_color).toBe(PALETTE.wood_mid);
    expect(manifest.background_color).toBe(PALETTE.grass_dark);
    const icons = manifest.icons as { sizes: string }[];
    expect(icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
  });

  it('registers no service worker', () => {
    expect(html).not.toMatch(/serviceWorker/);
  });
});
