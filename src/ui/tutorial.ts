// The tutorial overlay: a parchment card over the scene with the current step, a Skip button, and a
// pulsing ring around whatever the step is about. The logic is in tutorialFlow.ts; this only draws.

import { h } from './dom';
import type { TutorialFlow, TutorialTarget } from './tutorialFlow';

export interface TutorialView {
  /** Where to draw the ring, in viewport pixels; null hides it. */
  rectOf(target: TutorialTarget): DOMRect | null;
}

export class TutorialOverlay {
  private readonly card: HTMLElement;
  private readonly ring: HTMLElement;
  private readonly title: HTMLElement;
  private readonly text: HTMLElement;
  private readonly count: HTMLElement;
  private readonly next: HTMLButtonElement;
  private readonly skip: HTMLButtonElement;

  constructor(
    host: HTMLElement,
    private readonly flow: TutorialFlow,
    private readonly view: TutorialView,
  ) {
    this.title = h('h3', { class: 'tutorial-title' });
    this.text = h('p', { class: 'tutorial-text' });
    this.count = h('span', { class: 'tutorial-count' });
    this.next = h('button', { type: 'button', class: 'btn btn-primary', text: 'Next' });
    this.skip = h('button', { type: 'button', class: 'btn', text: 'Skip tutorial' });
    this.card = h(
      'section',
      {
        class: 'tutorial-card',
        role: 'region',
        'aria-label': 'Tutorial',
        'aria-live': 'polite',
        hidden: true,
      },
      this.count,
      this.title,
      this.text,
      h('div', { class: 'btn-row' }, this.next, this.skip),
    );
    this.ring = h('div', { class: 'tutorial-ring', 'aria-hidden': 'true', hidden: true });
    host.append(this.card);
    document.body.append(this.ring);
    this.next.addEventListener('click', () => flow.signal({ kind: 'next' }));
    this.skip.addEventListener('click', () => flow.skip());
    flow.onChange(() => this.render());
    this.render();
  }

  private render(): void {
    const step = this.flow.step;
    this.card.hidden = !step;
    document.body.classList.toggle('tutorial-on', !!step);
    if (!step) {
      this.ring.hidden = true;
      return;
    }
    this.count.textContent = `Step ${this.flow.index + 1} of ${this.flow.total}`;
    this.title.textContent = step.title;
    this.text.textContent = step.text;
    this.next.hidden = step.needs !== null;
    this.next.textContent = step.id === 'done' ? 'Finish' : 'Next';
    this.update();
  }

  /** Keeps the ring on its target as the window or scene moves (call every frame). */
  update(): void {
    const step = this.flow.step;
    if (!step) return;
    const r = this.view.rectOf(step.target);
    this.ring.hidden = !r || r.width === 0;
    if (!r) return;
    const pad = 4;
    Object.assign(this.ring.style, {
      left: `${r.left - pad}px`,
      top: `${r.top - pad}px`,
      width: `${r.width + pad * 2}px`,
      height: `${r.height + pad * 2}px`,
    });
  }
}
