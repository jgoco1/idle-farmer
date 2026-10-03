// The platform layer (v3 phase 00): the synchronous store over async storage, the web adapter,
// platform detection, save backups, the back order and the fake insets.

import { describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '../src/audio/engine';
import {
  BACKUP_KEY,
  OLDER_BACKUP_SPACING_MS,
  SAVE_KEY,
  SaveSlots,
  backupKeys,
  saveKeys,
  toSaveFile,
  type SaveStorage,
} from '../src/core/save';
import { PREFS_KEY, PrefsStore } from '../src/core/prefs';
import { createInitialState } from '../src/core/state';
import { detectKind } from '../src/platform';
import { SyncStore } from '../src/platform/store';
import type { PlatformStorage } from '../src/platform/types';
import { createWebPlatform, webStorage, type WebHost } from '../src/platform/web';
import { goBack, type BackUi } from '../src/ui/back';
import { FAKE_INSETS, parseInsets } from '../src/ui/safeArea';
import { asContext, FakeAudioContext } from './helpers-audio';
import { at, HOUR, NY } from './helpers';

const T0 = at(NY, 2026, 3, 2, 10);

/** Lets every pending promise callback run. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

/** An in-memory platform storage whose reads and writes can be held, failed and counted. */
class FakeStorage implements PlatformStorage {
  readonly data = new Map<string, string>();
  inFlight = 0;
  maxInFlight = 0;
  writes: [string, string | null][] = [];
  failWrites = 0;
  holdReads: Promise<void> | null = null;
  readFails = new Set<string>();
  /** When set, each write waits for this before finishing. */
  gate: (() => Promise<void>) | null = null;

  constructor(initial: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(initial)) this.data.set(k, v);
  }
  async read(key: string): Promise<string | null> {
    if (this.holdReads) await this.holdReads;
    if (this.readFails.has(key)) throw new Error('disk on fire');
    return this.data.get(key) ?? null;
  }
  private async op(key: string, value: string | null): Promise<void> {
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      if (this.gate) await this.gate();
      else await Promise.resolve();
      if (this.failWrites > 0) {
        this.failWrites--;
        throw new Error('quota exceeded');
      }
      this.writes.push([key, value]);
      if (value === null) this.data.delete(key);
      else this.data.set(key, value);
    } finally {
      this.inFlight--;
    }
  }
  write(key: string, text: string): Promise<void> {
    return this.op(key, text);
  }
  remove(key: string): Promise<void> {
    return this.op(key, null);
  }
}

/** Manual timers for the retry delay. */
function manualTimers(): {
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(h: unknown): void;
  pending: { fn: () => void; ms: number }[];
  fire(): void;
} {
  const pending: { fn: () => void; ms: number }[] = [];
  return {
    pending,
    setTimer(fn, ms) {
      const t = { fn, ms };
      pending.push(t);
      return t;
    },
    clearTimer(h) {
      const i = pending.indexOf(h as { fn: () => void; ms: number });
      if (i >= 0) pending.splice(i, 1);
    },
    fire() {
      const t = pending.shift();
      t?.fn();
    },
  };
}

describe('SyncStore (async storage under a synchronous game)', () => {
  it('boot waits for the reads, then serves them synchronously', async () => {
    const disk = new FakeStorage({ [SAVE_KEY]: 'farm', [PREFS_KEY]: '{"uiScale":2}' });
    let release!: () => void;
    disk.holdReads = new Promise((r) => (release = r));
    let opened: SyncStore | null = null;
    void SyncStore.open(disk, [SAVE_KEY, PREFS_KEY, BACKUP_KEY]).then((s) => (opened = s));
    await settle();
    expect(opened).toBeNull(); // the game cannot be created yet
    release();
    await settle();
    const store = opened as unknown as SyncStore;
    expect(store.getItem(SAVE_KEY)).toBe('farm');
    expect(store.getItem(BACKUP_KEY)).toBeNull();
    expect(new PrefsStore(store).value.uiScale).toBe(2);
  });

  it('a key whose read failed throws when read (so loading reports it) until it is written', async () => {
    const disk = new FakeStorage();
    disk.readFails.add(SAVE_KEY);
    const store = await SyncStore.open(disk, [SAVE_KEY]);
    expect(() => store.getItem(SAVE_KEY)).toThrow('disk on fire');
    store.setItem(SAVE_KEY, 'new');
    expect(store.getItem(SAVE_KEY)).toBe('new');
  });

  it('a burst of saves leaves the last state, with never two writes in flight', async () => {
    const disk = new FakeStorage();
    const store = await SyncStore.open(disk, [SAVE_KEY]);
    for (let i = 1; i <= 50; i++) {
      store.setItem(SAVE_KEY, `save ${i}`);
      store.setItem(PREFS_KEY, `prefs ${i}`);
      if (i % 7 === 0) await Promise.resolve();
    }
    expect(store.getItem(SAVE_KEY)).toBe('save 50'); // the memory copy is current at once
    expect(await store.flush()).toBe(true);
    expect(disk.data.get(SAVE_KEY)).toBe('save 50');
    expect(disk.data.get(PREFS_KEY)).toBe('prefs 50');
    expect(disk.maxInFlight).toBe(1);
    expect(disk.writes.length).toBeLessThan(100); // coalesced, not one write per save
    expect(store.dirty).toBe(false);
  });

  it('writes keys in the order they were last set (the backup before the save that replaces it)', async () => {
    const disk = new FakeStorage();
    const store = await SyncStore.open(disk, []);
    store.setItem('a', '1'); // starts writing at once
    store.setItem('b', '1');
    store.setItem('c', '1');
    store.setItem('b', '2'); // moves behind c, and b = 1 is never written
    await store.flush();
    expect(disk.writes).toEqual([
      ['a', '1'],
      ['c', '1'],
      ['b', '2'],
    ]);
    disk.writes = [];
    let open!: () => void;
    disk.gate = () => new Promise((r) => (open = r));
    store.setItem('x', '1'); // in flight
    store.setItem('y', '1');
    store.setItem('z', '1');
    store.setItem('y', '2');
    disk.gate = null;
    open();
    await store.flush();
    expect(disk.writes).toEqual([
      ['x', '1'],
      ['z', '1'],
      ['y', '2'],
    ]);
  });

  it('a failed write is kept, reported once, retried with a growing delay, and never dropped', async () => {
    const disk = new FakeStorage();
    const timers = manualTimers();
    const onError = vi.fn();
    const onRecover = vi.fn();
    const store = await SyncStore.open(disk, [SAVE_KEY], { onError, onRecover, retryMs: 1000, ...timers });
    disk.failWrites = 3;
    store.setItem(SAVE_KEY, 'v1');
    await settle();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(disk.data.has(SAVE_KEY)).toBe(false);
    expect(timers.pending.map((t) => t.ms)).toEqual([1000]);
    store.setItem(SAVE_KEY, 'v2'); // a newer save retries at once, and still fails
    await settle();
    expect(onError).toHaveBeenCalledTimes(1); // reported once, not on every attempt
    expect(timers.pending.map((t) => t.ms)).toEqual([2000]);
    expect(await store.flush()).toBe(false); // flush tries once more and says it failed
    expect(timers.pending.map((t) => t.ms)).toEqual([4000]);
    timers.fire(); // the retry succeeds
    await settle();
    expect(disk.data.get(SAVE_KEY)).toBe('v2');
    expect(onRecover).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    // A new failure after a recovery is news again.
    disk.failWrites = 1;
    store.setItem(SAVE_KEY, 'v3');
    await settle();
    expect(onError).toHaveBeenCalledTimes(2);
    expect(timers.pending.map((t) => t.ms)).toEqual([1000]); // the delay starts over
    expect(await store.flush()).toBe(true);
    expect(disk.data.get(SAVE_KEY)).toBe('v3');
  });

  it('a failed write does not overwrite a newer value set while it was in flight', async () => {
    const disk = new FakeStorage();
    const timers = manualTimers();
    const store = await SyncStore.open(disk, [], { ...timers });
    let open!: () => void;
    disk.gate = () => new Promise((r) => (open = r));
    disk.failWrites = 1;
    store.setItem(SAVE_KEY, 'old');
    store.setItem(SAVE_KEY, 'new');
    disk.gate = null;
    open();
    expect(await store.flush()).toBe(false); // 'old' failed
    expect(await store.flush()).toBe(true);
    expect(disk.data.get(SAVE_KEY)).toBe('new');
    expect(disk.writes).toEqual([[SAVE_KEY, 'new']]);
  });

  it('removes keys too', async () => {
    const disk = new FakeStorage({ k: 'v' });
    const store = await SyncStore.open(disk, ['k']);
    store.removeItem('k');
    expect(store.getItem('k')).toBeNull();
    await store.flush();
    expect(disk.data.has('k')).toBe(false);
  });
});

describe('the web adapter', () => {
  function fakeHost(ls: () => Storage): WebHost & { fire(type: string): void; hidden: boolean } {
    const handlers = new Map<string, ((e: Event) => void)[]>();
    const on = (type: string, fn: (e: Event) => void): void =>
      void handlers.set(type, [...(handlers.get(type) ?? []), fn]);
    const host = {
      hidden: false,
      get localStorage() {
        return ls();
      },
      document: {
        get hidden() {
          return host.hidden;
        },
        addEventListener: on,
      } as unknown as WebHost['document'],
      addEventListener: on,
      fire(type: string) {
        for (const fn of handlers.get(type) ?? []) fn(new Event(type));
      },
    };
    return host;
  }

  function memoryLocalStorage(): Storage {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    } as Storage;
  }

  it('uses localStorage when it works', async () => {
    const ls = memoryLocalStorage();
    const s = webStorage({ localStorage: ls });
    expect(s.persistent).toBe(true);
    await s.write('k', 'v');
    expect(ls.getItem('k')).toBe('v');
    expect(await s.read('k')).toBe('v');
    await s.remove('k');
    expect(await s.read('k')).toBeNull();
  });

  it('falls back to memory when localStorage is blocked', async () => {
    const blocked = (): Storage => {
      throw new DOMException('denied', 'SecurityError');
    };
    const s = webStorage(fakeHost(blocked));
    expect(s.persistent).toBe(false);
    expect(await s.read(SAVE_KEY)).toBeNull();
    await s.write(SAVE_KEY, 'farm');
    expect(await s.read(SAVE_KEY)).toBe('farm');
    await s.remove(SAVE_KEY);
    expect(await s.read(SAVE_KEY)).toBeNull();
  });

  it('also falls back when localStorage exists but throws on use', async () => {
    const broken = { getItem: () => { throw new Error('no'); } } as unknown as Storage; // prettier-ignore
    expect(webStorage({ localStorage: broken }).persistent).toBe(false);
  });

  it('pauses on hide or pagehide once, and resumes when visible again', () => {
    const host = fakeHost(memoryLocalStorage);
    const p = createWebPlatform(host);
    expect(p.kind).toBe('web');
    expect(p.quit).toBeNull();
    expect(p.achievements).toBeNull();
    expect(p.olderBackups).toBe(0);
    const log: string[] = [];
    p.onPause(() => log.push('pause'));
    const off = p.onResume(() => log.push('resume'));
    host.hidden = true;
    host.fire('visibilitychange');
    host.fire('pagehide'); // closing a hidden tab: still one pause
    host.hidden = false;
    host.fire('visibilitychange');
    host.fire('pageshow'); // already resumed
    host.fire('pagehide');
    host.fire('pageshow'); // back from the back/forward cache
    expect(log).toEqual(['pause', 'resume', 'pause', 'resume']);
    off();
    host.fire('pagehide');
    host.fire('pageshow');
    expect(log).toEqual(['pause', 'resume', 'pause', 'resume', 'pause']);
    expect(p.onBack(() => true)).toBeTypeOf('function'); // a no-op on the web
  });
});

describe('detectKind', () => {
  it('is the web unless a shell announces itself', () => {
    expect(detectKind({})).toBe('web');
    expect(detectKind({ __HEARTHFIELD_SHELL__: { kind: 'desktop' } })).toBe('desktop');
    expect(detectKind({ __HEARTHFIELD_SHELL__: { kind: 'toaster' } })).toBe('web');
    expect(detectKind({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' } })).toBe(
      'android',
    );
    expect(detectKind({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' } })).toBe('ios');
    // Capacitor's web build (not native) is still the web.
    expect(detectKind({ Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' } })).toBe(
      'web',
    );
  });
});

describe('save backups', () => {
  function memory(initial: Record<string, string> = {}): SaveStorage & { data: Map<string, string> } {
    const data = new Map(Object.entries(initial));
    return {
      data,
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => void data.set(k, v),
      removeItem: (k) => void data.delete(k),
    };
  }
  const fileAt = (t: number, gold = 60) => {
    const state = createInitialState(T0, NY, 1);
    state.gold = gold;
    return toSaveFile(state, t);
  };

  it('lists the keys it reads', () => {
    expect(backupKeys(0)).toEqual([BACKUP_KEY]);
    expect(backupKeys(3)).toEqual([BACKUP_KEY, `${SAVE_KEY}.bak2`, `${SAVE_KEY}.bak3`, `${SAVE_KEY}.bak4`]);
    expect(backupKeys(9)).toHaveLength(4);
    expect(saveKeys(0)).toEqual([SAVE_KEY, BACKUP_KEY, `${SAVE_KEY}.bak-at`]);
  });

  it('keeps the previous good save as save.bak', () => {
    const disk = memory();
    const slots = new SaveSlots(disk);
    expect(slots.load(T0, NY).kind).toBe('new');
    slots.write(fileAt(T0, 100));
    expect(disk.data.has(BACKUP_KEY)).toBe(false); // nothing to keep yet
    const first = disk.data.get(SAVE_KEY);
    slots.write(fileAt(T0 + 1000, 200));
    expect(disk.data.get(BACKUP_KEY)).toBe(first);
    slots.write(fileAt(T0 + 2000, 300));
    expect(JSON.parse(disk.data.get(BACKUP_KEY)!).state.gold).toBe(200);
    expect(JSON.parse(disk.data.get(SAVE_KEY)!).state.gold).toBe(300);
  });

  it('rotates only after a save that validates', () => {
    const disk = memory();
    const slots = new SaveSlots(disk);
    slots.load(T0, NY);
    slots.write(fileAt(T0, 100));
    slots.write(fileAt(T0 + 1000, 200)); // bak = 100
    const bad = fileAt(T0 + 2000, -5); // negative gold does not validate
    slots.write(bad);
    expect(JSON.parse(disk.data.get(BACKUP_KEY)!).state.gold).toBe(100); // not rotated
    expect(JSON.parse(disk.data.get(SAVE_KEY)!).state.gold).toBe(-5); // still written: progress is not dropped
    slots.write(fileAt(T0 + 3000, 400));
    // The invalid save is never moved into the backup.
    expect(JSON.parse(disk.data.get(BACKUP_KEY)!).state.gold).toBe(100);
  });

  it('never rotates a save that failed to load into the backup', () => {
    const good = JSON.stringify(fileAt(T0, 100));
    const disk = memory({ [SAVE_KEY]: '{"version":13,"state":{', [BACKUP_KEY]: good });
    const slots = new SaveSlots(disk);
    expect(slots.load(T0, NY).kind).toBe('error');
    expect(disk.data.get(SAVE_KEY)).toBe('{"version":13,"state":{'); // untouched
    slots.write(fileAt(T0 + 1000, 500)); // the player chose: the broken text is not a backup
    expect(disk.data.get(BACKUP_KEY)).toBe(good);
  });

  it('offers the backup when the main save is corrupt, newest that loads first', () => {
    const disk = memory({
      [SAVE_KEY]: 'garbage',
      [BACKUP_KEY]: 'also garbage',
      [`${SAVE_KEY}.bak2`]: JSON.stringify(fileAt(T0, 222)),
    });
    expect(new SaveSlots(disk, 0).loadBackup()).toBeNull(); // the web keeps only save.bak
    const found = new SaveSlots(disk, 3).loadBackup();
    expect(found?.key).toBe(`${SAVE_KEY}.bak2`);
    expect(found?.file.state.gold).toBe(222);
    expect(disk.data.get(SAVE_KEY)).toBe('garbage'); // looking changes nothing
  });

  it('keeps up to 3 older backups on native platforms, spaced an hour apart', () => {
    const disk = memory();
    const slots = new SaveSlots(disk, 3);
    slots.load(T0, NY);
    const goldOf = (k: string): number | null =>
      disk.data.has(k) ? (JSON.parse(disk.data.get(k)!).state.gold as number) : null;
    let t = T0;
    let g = 0;
    const write = (): void => slots.write(fileAt((t += 15_000), ++g));
    write(); // 1
    write(); // 2, bak 1
    write(); // 3, bak 2, bak2 1 (the first move)
    expect([goldOf(SAVE_KEY), goldOf(BACKUP_KEY), goldOf(`${SAVE_KEY}.bak2`)]).toEqual([3, 2, 1]);
    for (let i = 0; i < 10; i++) write(); // autosaves within the hour: older backups stay
    expect(goldOf(`${SAVE_KEY}.bak2`)).toBe(1);
    expect(goldOf(BACKUP_KEY)).toBe(12);
    t += OLDER_BACKUP_SPACING_MS;
    write(); // 14: the chain moves
    expect([goldOf(BACKUP_KEY), goldOf(`${SAVE_KEY}.bak2`), goldOf(`${SAVE_KEY}.bak3`)]).toEqual([13, 12, 1]);
    for (let i = 0; i < 4; i++) {
      t += HOUR;
      write();
    }
    expect(goldOf(`${SAVE_KEY}.bak4`)).not.toBeNull();
    expect(disk.data.has(`${SAVE_KEY}.bak5`)).toBe(false);
  });

  it('a hard reset clears the save and every backup', () => {
    const disk = memory();
    const slots = new SaveSlots(disk, 3);
    slots.load(T0, NY);
    for (let i = 0; i < 5; i++) slots.write(fileAt(T0 + i * HOUR * 2, i + 1));
    slots.clear();
    expect([...disk.data.keys()]).toEqual([]);
  });

  it('works over the async store end to end: the backup survives a corrupt save on disk', async () => {
    const disk = new FakeStorage();
    let store = await SyncStore.open(disk, saveKeys(0));
    let slots = new SaveSlots(store);
    slots.load(T0, NY);
    slots.write(fileAt(T0, 100));
    slots.write(fileAt(T0 + 1000, 200));
    await store.flush();
    disk.data.set(SAVE_KEY, '{"truncated'); // the main save is damaged on disk
    store = await SyncStore.open(disk, saveKeys(0));
    slots = new SaveSlots(store);
    expect(slots.load(T0 + 2000, NY).kind).toBe('error');
    expect(slots.loadBackup()?.file.state.gold).toBe(100);
  });
});

describe('the back order', () => {
  /** A stand-in for the UI: a stack of what is open. */
  function ui(open: {
    modal?: 'dismissible' | 'fixed';
    mode?: boolean;
    panel?: boolean;
    label?: boolean;
  }): BackUi & {
    log: string[];
  } {
    const log: string[] = [];
    const s = { ...open };
    return {
      log,
      closeModal() {
        if (!s.modal) return false;
        if (s.modal === 'dismissible') {
          log.push('modal');
          delete s.modal;
        }
        return true;
      },
      leaveMode() {
        if (!s.mode) return false;
        log.push('mode');
        s.mode = false;
        return true;
      },
      closePanel() {
        if (!s.panel) return false;
        log.push('panel');
        s.panel = false;
        return true;
      },
      clearLabel() {
        if (!s.label) return false;
        log.push('label');
        s.label = false;
        return true;
      },
    };
  }

  it('closes a modal, then leaves a mode, then closes the panel, then hides a label, then reports false', () => {
    const u = ui({ modal: 'dismissible', mode: true, panel: true, label: true });
    expect([goBack(u), goBack(u), goBack(u), goBack(u), goBack(u)]).toEqual([true, true, true, true, false]);
    expect(u.log).toEqual(['modal', 'mode', 'panel', 'label']);
  });

  it('a tap-to-inspect label alone is one step back', () => {
    const u = ui({ label: true });
    expect([goBack(u), goBack(u)]).toEqual([true, false]);
  });

  it('a modal that must be answered keeps the back button', () => {
    const u = ui({ modal: 'fixed', panel: true });
    expect(goBack(u)).toBe(true);
    expect(goBack(u)).toBe(true);
    expect(u.log).toEqual([]);
  });

  it('with nothing open, the shell decides', () => {
    expect(goBack(ui({}))).toBe(false);
  });
});

describe('fake insets', () => {
  it('parse in CSS order with defaults', () => {
    expect(parseInsets('')).toEqual(FAKE_INSETS);
    expect(FAKE_INSETS).toEqual({ top: 44, right: 0, bottom: 34, left: 0 });
    expect(parseInsets('0,47,21,47')).toEqual({ top: 0, right: 47, bottom: 21, left: 47 });
    expect(parseInsets('x,-3,9999')).toEqual(FAKE_INSETS);
  });
});

describe('audio on pause and resume', () => {
  it('suspends a running context and resumes it', () => {
    const ctx = new FakeAudioContext();
    const engine = new AudioEngine(() => asContext(ctx));
    engine.suspend(); // nothing yet: no context before the first gesture
    engine.tryResume();
    expect(ctx.suspended + ctx.resumed).toBe(0);
    engine.unlock();
    expect(ctx.state).toBe('running');
    engine.suspend();
    expect(ctx.state).toBe('suspended');
    engine.tryResume();
    expect(ctx.state).toBe('running');
  });
});
