// Picks the platform at boot. Native shells announce themselves: the desktop shell (v3-02) injects
// `window.__HEARTHFIELD_SHELL__ = { kind: 'desktop' }` before the page loads, and the mobile apps
// (v3-01) run inside Capacitor, whose own global says which OS it is. All detection stays in this
// file. The web adapter is part of every build (it also serves any webview without an adapter); each
// native adapter is a dynamic import() so the web bundle never contains another platform's code.

import type { Platform, PlatformKind } from './types';
import { createWebPlatform } from './web';

export type { Platform, PlatformKind, PlatformStorage, Achievements } from './types';

/** What the shells put on `globalThis`. */
export interface ShellGlobals {
  __HEARTHFIELD_SHELL__?: { kind?: unknown };
  Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string };
}

/** Which platform this page runs on, from the globals a shell injects. Anything unknown is the web. */
export function detectKind(g: ShellGlobals): PlatformKind {
  const shell = g.__HEARTHFIELD_SHELL__?.kind;
  if (shell === 'desktop' || shell === 'android' || shell === 'ios') return shell;
  const cap = g.Capacitor;
  if (cap?.isNativePlatform?.()) {
    const os = cap.getPlatform?.();
    if (os === 'android' || os === 'ios') return os;
  }
  return 'web';
}

/**
 * Adapter loaders by kind. v3-01 and v3-02 add theirs here (`() => import('./capacitor')…`); until
 * then a shell that announces itself gets the web adapter, which works in any webview.
 */
const LOADERS: Partial<Record<PlatformKind, () => Promise<Platform>>> = {};

export async function loadPlatform(g: ShellGlobals = globalThis as ShellGlobals): Promise<Platform> {
  const load = LOADERS[detectKind(g)];
  if (load) return load();
  return createWebPlatform();
}
