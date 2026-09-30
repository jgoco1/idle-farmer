import { describe, expect, it } from 'vitest';
import {
  decodeBase64,
  encodeBase64,
  exportSave,
  importSave,
  loadGame,
  migrate,
  migrations,
  parseSave,
  SAVE_KEY,
  SAVE_VERSION,
  SaveError,
  toSaveFile,
  validateState,
  writeSave,
  type Migration,
  type SaveStorage,
} from '../src/core/save';
import { createInitialState } from '../src/core/state';
import { computeSeasonEpoch } from '../src/core/time';
import fixtureV1 from './fixtures/save-v1.json';
import fixtureV2 from './fixtures/save-v2.json';
import fixture from './fixtures/save-v3.json';
import { at, NY } from './helpers';

const FIXTURE_TEXT = JSON.stringify(fixture);

function memoryStorage(initial: Record<string, string> = {}): SaveStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe('save file', () => {
  it('is at version 3 (phase 03) with one migration per older version', () => {
    expect(SAVE_VERSION).toBe(3);
    expect(Object.keys(migrations)).toEqual(['1', '2']);
    expect(SAVE_KEY).toBe('hearthfield-idle/save');
  });

  it('the v3 fixture loads unchanged', () => {
    const file = parseSave(FIXTURE_TEXT);
    expect(file).toEqual(fixture);
  });

  it('the fixture has exactly the shape of a new state (bump SAVE_VERSION if this fails)', () => {
    // Arrays and id-keyed records (market items, upgrades) are compared by the shape of their entries.
    const RECORDS = new Set(['market.items', 'upgrades']);
    const keys = (o: object, path = ''): string[] => {
      const out = new Set<string>();
      const children: [string, unknown][] =
        Array.isArray(o) || RECORDS.has(path)
          ? Object.values(o).map((v): [string, unknown] => ['*', v])
          : Object.entries(o);
      for (const [k, v] of children) {
        const p = path ? `${path}.${k}` : k;
        out.add(p);
        if (v && typeof v === 'object') for (const c of keys(v, p)) out.add(c);
      }
      return [...out].sort();
    };
    const fresh = createInitialState(0, NY);
    fresh.upgrades.backpack = 1; // a new save owns no upgrades yet, so give the record an entry
    fresh.shippingBin.items.push({ item: 'turnip', qty: 1 });
    fresh.expansions.push('farm_1');
    expect(keys(fixture.state)).toEqual(keys(fresh));
  });

  it('the fixture calendar is consistent with the time rules', () => {
    expect(computeSeasonEpoch(fixture.state.calendar.createdAt, NY)).toBe(fixture.state.calendar.seasonEpoch);
  });

  it('round-trips through JSON', () => {
    const file = parseSave(FIXTURE_TEXT);
    const again = parseSave(JSON.stringify(toSaveFile(file.state, file.savedAt)));
    expect(again).toEqual(file);
  });

  it('never saves the debug time warp', () => {
    const s = createInitialState(at(NY, 2026, 1, 7), NY, 1);
    s.clock.speed = 60;
    const file = toSaveFile(s, 123);
    expect(file.state.clock.speed).toBe(1);
    expect(s.clock.speed).toBe(60);
    expect(file.savedAt).toBe(123);
    expect(file.state.meta.lastSavedAt).toBe(123);
  });

  it('validates a new state', () => {
    expect(validateState(createInitialState(0, NY))).toBeNull();
    expect(validateState({ ...createInitialState(0, NY), gold: 'lots' })).toBe('bad gold');
  });

  it('rejects damaged farm and inventory data', () => {
    const s = createInitialState(0, NY);
    const bad = (mutate: (x: ReturnType<typeof createInitialState>) => void): string | null => {
      const c = structuredClone(s);
      mutate(c);
      return validateState(c);
    };
    expect(bad((c) => c.farm.plots.pop())).toBe('bad plots');
    expect(bad((c) => (c.farm.plots[0]!.state = 'ready' as never))).toBe('bad plot state');
    expect(bad((c) => (c.farm.plots[0]!.growthMs = 1.5))).toBe('bad plot timers');
    expect(bad((c) => (c.farm.plots[0]!.state = 'planted'))).toBe('bad plot crop');
    expect(bad((c) => (c.inventory.slots[0] = { item: 'turnip', qty: 0 }))).toBe('bad inventory slot');
    expect(bad((c) => delete (c as Partial<typeof c>).inventory)).toBe('bad inventory');
    expect(bad((c) => (c.gold = 1.5))).toBe('bad gold');
    expect(bad((c) => (c.market.items.turnip = { demand: 'high' as never, lastSoldSimMs: -1, history: [] }))).toBe(
      'bad market item',
    );
    expect(bad((c) => (c.shippingBin.msToPickup = 0))).toBe('bad shipping bin');
    expect(bad((c) => (c.stats.lifetimeGold = NaN))).toBe('bad stats');
    expect(bad((c) => (c.upgrades.backpack = 'x' as never))).toBe('bad upgrades');
  });
});

describe('export and import', () => {
  it('base64 is UTF-8 safe', () => {
    const text = 'Café · 🌱 · ≈≈';
    expect(decodeBase64(encodeBase64(text))).toBe(text);
  });

  it('an exported save imports back identically', () => {
    const file = parseSave(FIXTURE_TEXT);
    const b64 = exportSave(file);
    expect(b64).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(importSave(`  ${b64}\n`)).toEqual(file);
  });

  it('rejects text that is not a save', () => {
    expect(() => importSave('not base64 at all!')).toThrow(SaveError);
    expect(() => importSave(encodeBase64('{"hello":1}'))).toThrow(SaveError);
  });
});

describe('migrations', () => {
  // A fake old format: version 0 had no settings and called gold "coins".
  const v0 = {
    version: 0,
    savedAt: 42,
    state: { ...structuredClone(fixtureV1.state), settings: undefined, gold: undefined, coins: 70 },
  };
  const table: Record<number, Migration> = {
    ...migrations,
    0: (old) => {
      const { coins, ...rest } = old;
      return { ...rest, gold: coins, settings: { masterVolume: 0.8 } };
    },
  };

  it('applies migrations in order up to the target version', () => {
    const file = migrate(v0, table);
    expect(file.version).toBe(SAVE_VERSION);
    expect(file.savedAt).toBe(42);
    expect(file.state.gold).toBe(70);
    expect(file.state.settings).toEqual({ masterVolume: 0.8 });
    expect('coins' in file.state).toBe(false);
    expect(validateState(file.state)).toBeNull();
  });

  it('migrates a phase-01 (v1) save into a valid current save', () => {
    const file = parseSave(JSON.stringify(fixtureV1));
    expect(file.version).toBe(SAVE_VERSION);
    expect(file.savedAt).toBe(fixtureV1.savedAt);
    const s = file.state;
    // Everything from v1 is kept.
    expect(s.clock).toEqual(fixtureV1.state.clock);
    expect(s.calendar).toEqual(fixtureV1.state.calendar);
    expect(s.rngState).toBe(fixtureV1.state.rngState);
    expect(s.settings).toEqual(fixtureV1.state.settings);
    expect(s.meta).toEqual(fixtureV1.state.meta);
    // The new fields match a brand-new farm: starting gold, 4 × 2 plots (left half tilled), 6 turnip seeds.
    const fresh = createInitialState(0, NY);
    expect(s.gold).toBe(60);
    expect(s.farm).toEqual(fresh.farm);
    expect(s.inventory).toEqual(fresh.inventory);
    expect(s.stats).toEqual(fresh.stats);
    expect(s.farm.plots.map((p) => p.state)).toEqual([
      'tilled',
      'tilled',
      'untilled',
      'untilled',
      'tilled',
      'tilled',
      'untilled',
      'untilled',
    ]);
  });

  it('migrates a phase-02 (v2) save into a valid phase-03 save with default market values', () => {
    const file = parseSave(JSON.stringify(fixtureV2));
    expect(file.version).toBe(3);
    const s = file.state;
    // Everything from v2 is kept.
    const { state: old } = fixtureV2;
    expect(s.clock).toEqual(old.clock);
    expect(s.calendar).toEqual(old.calendar);
    expect(s.rngState).toBe(old.rngState);
    expect(s.gold).toBe(old.gold);
    expect(s.farm).toEqual(old.farm);
    expect(s.inventory).toEqual(old.inventory);
    // Every item is at demand 1.0 (no entries), no specials until the next 06:00, an empty bin.
    expect(s.market).toEqual({ items: {}, specials: [] });
    expect(s.shippingBin).toEqual({ items: [], msToPickup: 3_600_000 });
    expect(s.expansions).toEqual([]);
    expect(s.stats).toEqual({ lifetimeGold: 0, goldToday: 0, cropsHarvested: 0, itemsShipped: 0, daysPassed: 0 });
    expect(s.upgrades).toEqual({});
    expect(validateState(s)).toBeNull();
  });

  it('keeps gold a v1 save somehow already had', () => {
    const rich = { ...fixtureV1, state: { ...fixtureV1.state, gold: 500 } };
    expect(parseSave(JSON.stringify(rich)).state.gold).toBe(500);
  });

  it('fails clearly when a migration is missing', () => {
    expect(() => migrate(v0, {}, 1)).toThrow('No migration from save version 0');
  });

  it('refuses a save from a newer version', () => {
    expect(() => migrate({ version: SAVE_VERSION + 1, state: fixture.state })).toThrow(/newer version/);
  });
});

describe('loading from storage', () => {
  it('creates a new game when there is no save', () => {
    const r = loadGame(memoryStorage(), 1000, NY);
    expect(r.kind).toBe('new');
  });

  it('loads a stored save', () => {
    const storage = memoryStorage({ [SAVE_KEY]: FIXTURE_TEXT });
    const r = loadGame(storage, 1000, NY);
    expect(r.kind === 'loaded' && r.file.state.clock.simMs).toBe(5432100);
  });

  it('reports a broken save and leaves it untouched', () => {
    const storage = memoryStorage({ [SAVE_KEY]: '{"version":2,"state":{' });
    const r = loadGame(storage, 1000, NY);
    expect(r.kind).toBe('error');
    expect(r.kind === 'error' && r.raw).toBe('{"version":2,"state":{');
    expect(storage.data.get(SAVE_KEY)).toBe('{"version":2,"state":{');
  });

  it('writes what it loads', () => {
    const storage = memoryStorage();
    const file = parseSave(FIXTURE_TEXT);
    writeSave(storage, file);
    const r = loadGame(storage, 0, NY);
    expect(r.kind === 'loaded' && r.file).toEqual(file);
  });
});
