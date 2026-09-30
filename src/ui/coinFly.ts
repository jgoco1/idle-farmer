// Coins that fly from where gold was earned to the HUD gold counter. DOM-only and cosmetic (the HUD
// is outside the canvas); skipped entirely under reduced motion.

import { spriteDataUrl } from '../render/spriteCache';
import { h } from './dom';
import { isReducedMotion } from './motion';

/** More gold, more coins: 1 for small sales up to 8. Pure, for tests. */
export function coinCount(gold: number): number {
  return Math.max(1, Math.min(8, Math.round(Math.log10(Math.max(1, gold)) * 2.2)));
}

export function flyCoins(from: { x: number; y: number }, to: HTMLElement, gold: number): number {
  if (isReducedMotion() || typeof document === 'undefined') return 0;
  const target = to.getBoundingClientRect();
  const tx = target.left + target.width / 2;
  const ty = target.top + target.height / 2;
  const n = coinCount(gold);
  for (let i = 0; i < n; i++) {
    const coin = h('img', {
      class: 'pixel coin-fly',
      alt: '',
      'aria-hidden': 'true',
      width: 16,
      height: 16,
      src: spriteDataUrl('ui_gold'),
    });
    coin.style.left = `${from.x - 8}px`;
    coin.style.top = `${from.y - 8}px`;
    document.body.append(coin);
    const hop = -20 - (i % 3) * 8;
    const dx = tx - from.x;
    const dy = ty - from.y;
    const anim = coin.animate(
      [
        { transform: 'translate(0, 0) scale(0.6)', opacity: 0 },
        { transform: `translate(${dx * 0.08}px, ${hop}px) scale(1)`, opacity: 1, offset: 0.25 },
        { transform: `translate(${dx}px, ${dy}px) scale(0.7)`, opacity: 0.9 },
      ],
      { duration: 650 + i * 40, delay: i * 55, easing: 'cubic-bezier(0.5, 0, 0.8, 0.5)', fill: 'both' },
    );
    anim.onfinish = () => coin.remove();
    window.setTimeout(() => coin.remove(), 2000);
  }
  return n;
}
