// The first-time tutorial as a small state machine, with no DOM: plots → seeds → water → harvest →
// sell → shop, then a hand-over to the milestone chain. It advances on signals (game events, a panel
// opening, or the Next button). Signals that happened earlier count: if the player waters before we
// ask, the water step is skipped when its turn comes.

import type { GameState } from '../core/state';
import type { PanelId } from '../data/ids';

export type TutorialStepId = 'plots' | 'seeds' | 'water' | 'harvest' | 'sell' | 'shop' | 'done';
export type TutorialEvent = 'planted' | 'watered' | 'harvested' | 'sold';
export type TutorialSignal =
  { kind: 'next' } | { kind: 'event'; type: TutorialEvent } | { kind: 'panel'; id: PanelId };

export type TutorialTarget = 'plots' | 'auto-tool' | 'market-button' | 'shop-button' | 'goals-button';

export interface TutorialStep {
  id: TutorialStepId;
  title: string;
  text: string;
  /** The signal that completes the step; null means the player presses Next. */
  needs: string | null;
  target: TutorialTarget;
}

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: 'plots',
    title: 'Your plots',
    text: 'Welcome to your farm! The brown squares are plots. Seeds grow in tilled soil, and the farm grows with you.',
    needs: null,
    target: 'plots',
  },
  {
    id: 'seeds',
    title: 'Plant seeds',
    text: 'With the Auto tool selected, click a tilled plot to plant your turnip seeds. Drag across several plots to plant them all.',
    needs: 'event:planted',
    target: 'plots',
  },
  {
    id: 'water',
    title: 'Water them',
    text: 'Crops grow twice as fast when watered. Click the planted plot again, or choose the Can, to water it.',
    needs: 'event:watered',
    target: 'plots',
  },
  {
    id: 'harvest',
    title: 'Harvest',
    text: 'A ready crop sparkles. Turnips take about two minutes. Click the sparkling plot to pick it.',
    needs: 'event:harvested',
    target: 'plots',
  },
  {
    id: 'sell',
    title: 'Sell',
    text: 'Open the Market (or click the stall) and sell your turnips for gold.',
    needs: 'event:sold',
    target: 'market-button',
  },
  {
    id: 'shop',
    title: 'Visit the Shop',
    text: 'Spend your gold on more seeds in the Shop. Every harvest buys a little more farm.',
    needs: 'panel:shop',
    target: 'shop-button',
  },
  {
    id: 'done',
    title: 'You are all set',
    text: 'The Goals panel has a chain of milestones that will guide you from here. Have fun, and come back whenever you like!',
    needs: null,
    target: 'goals-button',
  },
];

export type TutorialStatus = 'idle' | 'running' | 'finished' | 'skipped';

const keyOf = (s: TutorialSignal): string | null =>
  s.kind === 'event' ? `event:${s.type}` : s.kind === 'panel' ? `panel:${s.id}` : null;

export class TutorialFlow {
  private idx = 0;
  private state: TutorialStatus = 'idle';
  private seen = new Set<string>();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly steps: readonly TutorialStep[] = TUTORIAL_STEPS) {}

  get status(): TutorialStatus {
    return this.state;
  }

  get index(): number {
    return this.idx;
  }

  get step(): TutorialStep | null {
    return this.state === 'running' ? (this.steps[this.idx] ?? null) : null;
  }

  get total(): number {
    return this.steps.length;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Starts (or restarts) from the first step, forgetting what happened before. */
  start(): void {
    this.idx = 0;
    this.seen = new Set();
    this.state = 'running';
    this.emit();
  }

  skip(): void {
    if (this.state !== 'running') return;
    this.state = 'skipped';
    this.emit();
  }

  /** Feeds a signal. Events are remembered while running, so steps done early are skipped later. */
  signal(s: TutorialSignal): void {
    if (this.state !== 'running') return;
    const key = keyOf(s);
    if (key) this.seen.add(key);
    const step = this.steps[this.idx];
    if (!step) return;
    if (s.kind === 'next' ? step.needs === null : key === step.needs) this.advance();
  }

  private advance(): void {
    this.idx++;
    // Skip over steps the player has already done.
    for (;;) {
      const step = this.steps[this.idx];
      if (!step) {
        this.state = 'finished';
        break;
      }
      if (step.needs && this.seen.has(step.needs)) this.idx++;
      else break;
    }
    this.emit();
  }

  private emit(): void {
    this.listeners.forEach((fn) => fn());
  }
}

/** A brand-new farm: nothing harvested, sold or finished yet. Only these get the tutorial unasked. */
export function isFreshFarm(state: GameState): boolean {
  return (
    state.stats.cropsHarvested === 0 &&
    state.stats.lifetimeGold === 0 &&
    state.stats.fishCaught === 0 &&
    state.progression.milestones.done.length === 0
  );
}
