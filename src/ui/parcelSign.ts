// A locked parcel's "For sale" sign (GDD §12.1): clicking it offers the parcel when it can be
// bought, or says what it still needs. Buying goes through the `buyParcel` action like Upgrades › Land.

import type { GameState } from '../core/state';
import { GAME_DATA } from '../data';
import type { ParcelId } from '../data/ids';
import type { ActionResult } from '../systems/context';
import { parcelStatus } from '../systems/parcels';
import { unlockHints } from '../systems/unlocks';
import { h } from './dom';
import { showModal } from './modal';

export interface ParcelSignHooks {
  state(): GameState;
  buy(): ActionResult;
  toast(text: string): void;
  /** Opens Upgrades (its Land section lists every parcel). */
  openLand(): void;
}

export function buyParcelDialog(parcel: ParcelId, hooks: ParcelSignHooks): void {
  const def = GAME_DATA.parcels[parcel];
  const state = hooks.state();
  const price = `${def.price.toLocaleString('en-US')}g`;
  if (parcelStatus(state, GAME_DATA, parcel) !== 'available') {
    const needs = unlockHints(state, GAME_DATA, def.requires).join(' ');
    hooks.toast(`For sale: ${def.name}, ${price}. ${def.opens}. ${needs}`.trim());
    return;
  }
  const affordable = state.gold >= def.price;
  showModal({
    title: `For sale: ${def.name}`,
    body: h(
      'div',
      {},
      h('p', { text: def.description }),
      h('p', { text: `${def.opens}. Price: ${price}.` }),
      affordable ? null : h('p', { text: `You have ${state.gold.toLocaleString('en-US')}g.` }),
    ),
    buttons: affordable
      ? [
          { label: 'Not now' },
          {
            label: `Buy · ${price}`,
            primary: true,
            onClick() {
              const r = hooks.buy();
              if (!r.ok) hooks.toast(r.reason);
            },
          },
        ]
      : [
          { label: 'Not now' },
          { label: 'See Land in Upgrades', primary: true, onClick: () => hooks.openLand() },
        ],
  });
}
