// Eating a dish from the UI: asks before it would replace a running buff (GDD §7), otherwise
// eats at once. The rules are in src/systems/buffs.ts; this only adds the confirmation.

import type { Action } from '../core/actions';
import type { GameState } from '../core/state';
import type { GameData } from '../data';
import type { DishId } from '../data/ids';
import type { ActionResult } from '../systems/context';
import { planEat } from '../systems/buffs';
import { formatCountdown } from './buffBar';
import { h } from './dom';
import { showModal } from './modal';

export interface EatHooks {
  data: GameData;
  state(): GameState;
  dispatch(action: Action): ActionResult;
}

/** Eats one `dish` (from the hearty stack when `hearty`). `done` gets the result once it is known. */
export function eatWithConfirm(
  hooks: EatHooks,
  dish: DishId,
  hearty: boolean,
  done: (r: ActionResult | null) => void,
): void {
  const plan = planEat(hooks.state(), hooks.data, dish);
  if (plan.kind !== 'replace') {
    done(hooks.dispatch({ type: 'eat', dish, hearty }));
    return;
  }
  const old = hooks.data.buffs[plan.existing.type].name;
  const next = hooks.data.buffs[hooks.data.recipes[dish].buff].name;
  showModal({
    title: 'Replace a buff?',
    body: h('p', {
      text: `All your buff slots are in use. Eating ${hooks.data.recipes[dish].name} would replace ${old} (${formatCountdown(plan.existing.remainingMs)} left) with ${next}.`,
    }),
    buttons: [
      {
        label: `Replace ${old}`,
        primary: true,
        onClick: () => done(hooks.dispatch({ type: 'eat', dish, hearty, replace: true })),
      },
      { label: 'Keep it', onClick: () => done(null) },
    ],
  });
}
