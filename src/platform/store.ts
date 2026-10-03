// A synchronous store over the platform's asynchronous storage (v3 phase 00, requirement 2).
// The game saves synchronously: `setItem` updates an in-memory copy at once and persists it in
// the background. Boot `open()`s the store, which waits for every key it will ever read, so the
// game is never created before its save is in memory. Writes are serialised (never two in flight)
// and coalesce per key, so a burst of saves persists only the last one. A write that fails is kept,
// retried with a growing delay and reported once until a write succeeds again; it is never dropped.
// It satisfies `SaveStorage`, so `loadGame`, `SaveSlots` and `PrefsStore` use it unchanged.

import type { SaveStorage } from '../core/save';
import type { PlatformStorage } from './types';

export interface StoreOptions {
  /** Called once when persisting starts failing (the game shows a toast); not again until a write succeeds. */
  onError?(error: unknown): void;
  /** Called when writes succeed again after a failure. */
  onRecover?(): void;
  /** First retry delay; it doubles up to `maxRetryMs`. */
  retryMs?: number;
  maxRetryMs?: number;
  /** Injectable timers for tests. */
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(handle: unknown): void;
}

export const RETRY_MS = 2_000;
export const MAX_RETRY_MS = 60_000;

export class SyncStore implements SaveStorage {
  private readonly mem = new Map<string, string>();
  /** Keys whose boot read failed: reading them throws (so `loadGame` reports it) until they are written. */
  private readonly unreadable = new Map<string, Error>();
  /** Latest unpersisted value per key (null = remove), in the order they were last set. */
  private readonly pending = new Map<string, string | null>();
  private running: Promise<boolean> | null = null;
  private failing = false;
  private retryDelay: number;
  private retryHandle: unknown = null;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  private constructor(
    private readonly storage: PlatformStorage,
    private readonly opts: StoreOptions,
  ) {
    this.retryDelay = opts.retryMs ?? RETRY_MS;
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  /** Reads `keys` from storage into memory. Resolves only when every read has finished. */
  static async open(
    storage: PlatformStorage,
    keys: readonly string[],
    opts: StoreOptions = {},
  ): Promise<SyncStore> {
    const store = new SyncStore(storage, opts);
    const results = await Promise.allSettled(keys.map((k) => storage.read(k)));
    results.forEach((r, i) => {
      const key = keys[i]!;
      if (r.status === 'rejected') {
        store.unreadable.set(key, r.reason instanceof Error ? r.reason : new Error(String(r.reason)));
      } else if (r.value !== null) store.mem.set(key, r.value);
    });
    return store;
  }

  getItem(key: string): string | null {
    const err = this.unreadable.get(key);
    if (err) throw err;
    return this.mem.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.mem.set(key, value);
    this.queue(key, value);
  }

  removeItem(key: string): void {
    this.mem.delete(key);
    this.queue(key, null);
  }

  /** True while something is waiting to be persisted. */
  get dirty(): boolean {
    return this.pending.size > 0 || this.running !== null;
  }

  /**
   * Persists everything set so far and resolves when it is on storage: true, or false if a write
   * failed (it stays queued and will be retried). Call on pause, on the autosave interval and before quitting.
   */
  async flush(): Promise<boolean> {
    for (;;) {
      if (this.running) {
        if (!(await this.running)) return false;
        continue;
      }
      if (this.pending.size === 0) return true;
      this.kick();
    }
  }

  private queue(key: string, value: string | null): void {
    this.unreadable.delete(key);
    // Re-insert so the queue follows the order of the latest sets (a backup before the save that replaces it).
    this.pending.delete(key);
    this.pending.set(key, value);
    this.kick();
  }

  private kick(): void {
    if (this.running) return;
    if (this.retryHandle !== null) {
      this.clearTimer(this.retryHandle);
      this.retryHandle = null;
    }
    this.running = this.drain().then((ok) => {
      this.running = null;
      return ok;
    });
  }

  private async drain(): Promise<boolean> {
    while (this.pending.size > 0) {
      const [key, value] = this.pending.entries().next().value as [string, string | null];
      this.pending.delete(key);
      try {
        if (value === null) await this.storage.remove(key);
        else await this.storage.write(key, value);
      } catch (e) {
        // Keep the value unless a newer one was set while this write was in flight (the newer one wins).
        if (!this.pending.has(key)) {
          const rest = [...this.pending];
          this.pending.clear();
          this.pending.set(key, value);
          for (const [k, v] of rest) this.pending.set(k, v);
        }
        if (!this.failing) {
          this.failing = true;
          this.opts.onError?.(e);
        }
        this.scheduleRetry();
        return false;
      }
      if (this.failing) {
        this.failing = false;
        this.retryDelay = this.opts.retryMs ?? RETRY_MS;
        this.opts.onRecover?.();
      }
    }
    return true;
  }

  private scheduleRetry(): void {
    if (this.retryHandle !== null) return;
    const delay = this.retryDelay;
    this.retryDelay = Math.min(this.retryDelay * 2, this.opts.maxRetryMs ?? MAX_RETRY_MS);
    this.retryHandle = this.setTimer(() => {
      this.retryHandle = null;
      this.kick();
    }, delay);
  }
}
