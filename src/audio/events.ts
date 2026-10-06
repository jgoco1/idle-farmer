// Connects game events to sound effects. Audio is an event listener: systems never know about it.
// Offline catch-up flushes its events through the same bus, so `quiet()` mutes those.

import type { EventBus } from '../core/events';
import type { Sfx } from './sfx';

export function bindAudioEvents(bus: EventBus, sfx: Sfx, quiet: () => boolean): () => void {
  const off: (() => void)[] = [];
  const on = <T extends Parameters<EventBus['on']>[0]>(
    type: T,
    fn: Parameters<typeof bus.on<T>>[1],
  ): void => {
    off.push(bus.on(type, (e) => (quiet() ? undefined : fn(e))));
  };
  on('tilled', (e) => e.auto || sfx.play('hoe'));
  on('watered', (e) => e.auto || sfx.play('water'));
  on('planted', (e) => e.auto || sfx.play('plant'));
  on('harvested', (e) => e.auto || sfx.play('harvest'));
  on('sold', (e) => e.via === 'market' && sfx.play('coin', { amount: e.gold }));
  on('binCollected', (e) => sfx.play('coin', { amount: e.gold }));
  on('served', (e) => sfx.play('coin', { amount: e.gold })); // the restaurant's takings (v4-02)
  on('purchased', () => sfx.play('purchase'));
  on('bite', () => sfx.play('bite'));
  on('escaped', () => sfx.play('escape'));
  on('caught', (e) => {
    if (!e.viaTrap) sfx.play('catch');
  });
  on('trapCollected', () => sfx.play('harvest'));
  on('fruitPicked', (e) => e.auto || sfx.play('harvest'));
  on('treePlanted', () => sfx.play('plant'));
  // The ranch: a cluck or a moo when a batch is ready, and a collect sound when the player takes it (the Collecting
  // Basket is quiet, like the farmhand).
  on('produced', (e) => sfx.play(e.product === 'milk' ? 'moo' : 'cluck'));
  on('collected', (e) => e.auto || sfx.play('collect'));
  on('animalBought', (e) => sfx.play(e.animal === 'cow' ? 'moo' : 'cluck'));
  on('cooked', () => sfx.play('dishReady'));
  on('ate', () => sfx.play('eat'));
  on('buffStarted', () => sfx.play('buff'));
  on('levelUp', () => sfx.play('levelUp'));
  on('farmLevelUp', () => sfx.play('levelUp'));
  on('questDone', () => sfx.play('goal'));
  on('recipeLearned', () => sfx.play('goal'));
  on('bundleCompleted', () => sfx.play('levelUp'));
  return () => off.forEach((fn) => fn());
}
