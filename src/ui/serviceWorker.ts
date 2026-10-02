// Registers the hand-written service worker (scripts/build/sw.js) on the Pages build only (v3 phase 00).
// A new version installs in the background and waits; the game never reloads by itself. When one is
// waiting, `onUpdate` shows a toast whose click (after saving) activates it and reloads; otherwise
// it takes over on the next launch.

export function registerServiceWorker(url: string, onUpdate: (reload: () => void) => void): void {
  if (!('serviceWorker' in navigator)) return;
  const sw = navigator.serviceWorker;
  let reloading = false;
  const offer = (worker: ServiceWorker): void =>
    onUpdate(() => {
      sw.addEventListener('controllerchange', () => {
        if (reloading) return;
        reloading = true;
        location.reload();
      });
      worker.postMessage('skipWaiting');
    });
  sw.register(url)
    .then((reg) => {
      // Only an update is news: the first install has no controller yet.
      if (reg.waiting && sw.controller) offer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && sw.controller) offer(worker);
        });
      });
    })
    .catch((e: unknown) => console.warn('Offline support is unavailable', e));
}
