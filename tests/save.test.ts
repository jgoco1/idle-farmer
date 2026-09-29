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
import fixture from './fixtures/save-v1.json';
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
  it('starts at version 1 with no migrations yet', () => {
    expect(SAVE_VERSION).toBe(1);
    expect(Object.keys(migrations)).toEqual([]);
    expect(SAVE_KEY).toBe('hearthfield-idle/save');
  });

  it('the v1 fixture loads unchanged', () => {
    const file = parseSave(FIXTURE_TEXT);
    expect(file).toEqual(fixture);
  });

  it('the fixture has exactly the shape of a new state (bump SAVE_VERSION if this fails)', () => {
    const keys = (o: object): string[] =>
      Object.entries(o)
        .flatMap(([k, v]) => (v && typeof v === 'object' ? [k, ...keys(v).map((c) => `${k}.${c}`)] : [k]))
        .sort();
    expect(keys(fixture.state)).toEqual(keys(createInitialState(0, NY)));
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
    state: { ...structuredClone(fixture.state), settings: undefined, gold: undefined, coins: 7 },
  };
  const table: Record<number, Migration> = {
    0: (old) => {
      const { coins, ...rest } = old;
      return { ...rest, gold: coins, settings: { masterVolume: 0.8 } };
    },
  };

  it('applies migrations in order up to the target version', () => {
    const file = migrate(v0, table, 1);
    expect(file.version).toBe(1);
    expect(file.savedAt).toBe(42);
    expect(file.state.gold).toBe(7);
    expect(file.state.settings).toEqual({ masterVolume: 0.8 });
    expect('coins' in file.state).toBe(false);
    expect(validateState(file.state)).toBeNull();
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
    const storage = memoryStorage({ [SAVE_KEY]: '{"version":1,"state":{' });
    const r = loadGame(storage, 1000, NY);
    expect(r.kind).toBe('error');
    expect(r.kind === 'error' && r.raw).toBe('{"version":1,"state":{');
    expect(storage.data.get(SAVE_KEY)).toBe('{"version":1,"state":{');
  });

  it('writes what it loads', () => {
    const storage = memoryStorage();
    const file = parseSave(FIXTURE_TEXT);
    writeSave(storage, file);
    const r = loadGame(storage, 0, NY);
    expect(r.kind === 'loaded' && r.file).toEqual(file);
  });
});
