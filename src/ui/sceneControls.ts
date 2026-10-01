// The scene's view buttons (GDD §12.1): Home glides back to the default view, and + / − zoom one
// integer step around the view's centre. Dragging, pinching, the wheel and the keys move the camera
// too (in the renderer); these buttons are for anyone without a wheel or a second finger.

import type { Renderer } from '../render/renderer';
import { h } from './dom';

export interface SceneControls {
  /** The Decorate toggle (v2 phase 02); `setDecorating` shows its pressed state. */
  setDecorating(on: boolean): void;
}

export function buildSceneControls(
  host: HTMLElement,
  renderer: Renderer,
  onDecorate: () => void = () => {},
): SceneControls {
  const button = (label: string, text: string, title: string, onClick: () => void): HTMLButtonElement => {
    const b = h('button', { type: 'button', class: 'scene-btn', 'aria-label': label, title, text });
    b.addEventListener('click', onClick);
    return b;
  };
  const decorate = button('Decorate', '🎨', 'Decorate the farm: place and move decorations', onDecorate);
  decorate.dataset.testid = 'decorate-toggle';
  decorate.setAttribute('aria-pressed', 'false');
  host.append(
    h(
      'div',
      { class: 'scene-controls', role: 'group', 'aria-label': 'View' },
      decorate,
      button('Back to the farm', '🏠', 'Back to the farm (H)', () => renderer.home()),
      button('Zoom in', '+', 'Zoom in (+, wheel, pinch or double-click open ground)', () =>
        renderer.zoomStep(1),
      ),
      button('Zoom out', '−', 'Zoom out (−, wheel or pinch)', () => renderer.zoomStep(-1)),
    ),
  );
  return {
    setDecorating(on) {
      decorate.setAttribute('aria-pressed', String(on));
    },
  };
}
