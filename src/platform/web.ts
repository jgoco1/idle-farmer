// The browser platform: localStorage (falling back to memory when it is blocked, as v1 did),
// visibilitychange / pagehide for pause and resume, downloads for export. No back button.

import type { Platform, PlatformStorage } from './types';

/** The parts of `window` the web platform uses, so tests can hand it a fake. */
export interface WebHost {
  readonly localStorage: Storage;
  readonly document: Pick<Document, 'hidden' | 'addEventListener' | 'createElement' | 'body'>;
  addEventListener(type: 'pagehide' | 'pageshow', fn: (e: Event) => void): void;
}

/** localStorage when it works, otherwise a Map that lasts as long as the page (private modes, blocked storage). */
export function webStorage(
  host: Pick<WebHost, 'localStorage'>,
): PlatformStorage & { readonly persistent: boolean } {
  let ls: Storage | null = null;
  try {
    ls = host.localStorage;
    ls.getItem('probe');
  } catch {
    ls = null;
  }
  if (ls) {
    const s = ls;
    return {
      persistent: true,
      read: async (key) => s.getItem(key),
      write: async (key, text) => s.setItem(key, text),
      remove: async (key) => s.removeItem(key),
    };
  }
  const mem = new Map<string, string>();
  return {
    persistent: false,
    read: async (key) => mem.get(key) ?? null,
    write: async (key, text) => void mem.set(key, text),
    remove: async (key) => void mem.delete(key),
  };
}

/** A tiny listener set; `on` returns its own unsubscribe. */
function listeners<F extends (...args: never[]) => unknown>(): { on(fn: F): () => void; all(): F[] } {
  const set = new Set<F>();
  return {
    on(fn) {
      set.add(fn);
      return () => void set.delete(fn);
    },
    all: () => [...set],
  };
}

export function createWebPlatform(host: WebHost = window): Platform {
  const pause = listeners<() => void>();
  const resume = listeners<() => void>();
  // Pause and resume alternate: a hidden tab that is then closed fires visibilitychange and pagehide, but pauses once.
  let paused = false;
  const doPause = (): void => {
    if (paused) return;
    paused = true;
    pause.all().forEach((fn) => fn());
  };
  const doResume = (): void => {
    if (!paused) return;
    paused = false;
    resume.all().forEach((fn) => fn());
  };
  host.document.addEventListener('visibilitychange', () => (host.document.hidden ? doPause() : doResume()));
  host.addEventListener('pagehide', doPause);
  // A page restored from the back/forward cache comes back without a visibilitychange.
  host.addEventListener('pageshow', () => {
    if (!host.document.hidden) doResume();
  });

  return {
    kind: 'web',
    storage: webStorage(host),
    olderBackups: 0,
    onPause: pause.on,
    onResume: resume.on,
    onBack: () => () => undefined,
    quit: null,
    async exportFile(name, text) {
      const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
      const a = host.document.createElement('a');
      a.href = url;
      a.download = name;
      host.document.body.append(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
    achievements: null,
  };
}
