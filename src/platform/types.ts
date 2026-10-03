// The platform layer (v3 phase 00): everything that differs between the web page, the mobile apps
// (v3-01) and the desktop app (v3-02) sits behind this one interface, chosen at boot in index.ts.
// Only src/main.ts talks to it; systems and src/core/ never see the platform.

export type PlatformKind = 'web' | 'android' | 'ios' | 'desktop';

/** Asynchronous key/value storage (localStorage on the web; files or native preferences in the shells). */
export interface PlatformStorage {
  /** The stored text, or null when the key has never been written. Rejects when storage is unreadable. */
  read(key: string): Promise<string | null>;
  write(key: string, text: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** A seam for Steam achievements (v3-02). Null where there are none. */
export interface Achievements {
  unlock(id: string): void;
}

export interface Platform {
  readonly kind: PlatformKind;
  readonly storage: PlatformStorage;
  /**
   * Save backups older than `save.bak` (requirement 2): 0 on the web, where storage is small and
   * shared with the page, up to 3 on native platforms.
   */
  readonly olderBackups: number;
  /** The app is backgrounded, minimised, or the screen locks. Returns an unsubscribe function. */
  onPause(fn: () => void): () => void;
  /** The app is in front again. Returns an unsubscribe function. */
  onResume(fn: () => void): () => void;
  /**
   * The Android back button or a gamepad B. `fn` returns whether the game handled it; when it did
   * not, the shell minimises the app (Android) or asks to quit (desktop). A no-op on the web, where
   * Escape does the same job through the keyboard.
   */
  onBack(fn: () => boolean): () => void;
  /** Quits the app, or null where quitting isn't a thing (web, iOS). Flush saves before calling it. */
  readonly quit: (() => Promise<void>) | null;
  /** Hands a text file to the player: a download on the web, a share sheet or save dialog in the shells. */
  exportFile(name: string, text: string): Promise<void>;
  readonly achievements: Achievements | null;
  // Safe-area insets are not part of the interface: every platform reports them to CSS through
  // env(safe-area-inset-*), which src/styles.css reads (with a debug override, see main.ts).
}
