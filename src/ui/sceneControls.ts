// Zoom and pan buttons for the scene on small screens: a 2× zoom inside the scrollable scene area,
// and a pan switch so one finger can move the view instead of using a farm tool.

import type { Renderer } from '../render/renderer';
import { h } from './dom';

export function buildSceneControls(host: HTMLElement, renderer: Renderer): void {
  const zoom = h('button', {
    type: 'button',
    class: 'scene-btn',
    'aria-pressed': 'false',
    'aria-label': 'Zoom the farm in',
    title: 'Zoom in or out',
    text: '🔍',
  });
  const pan = h('button', {
    type: 'button',
    class: 'scene-btn',
    'aria-pressed': 'false',
    'aria-label': 'Drag to move the view',
    title: 'Drag to move the view (turn off to use your tools)',
    text: '✋',
    hidden: true,
  });
  zoom.addEventListener('click', () => {
    const zoomed = renderer.zoom === 1;
    renderer.setViewZoom(zoomed ? 2 : 1);
    zoom.setAttribute('aria-pressed', String(zoomed));
    zoom.setAttribute('aria-label', zoomed ? 'Zoom the farm out' : 'Zoom the farm in');
    pan.hidden = !zoomed;
    if (!zoomed) {
      renderer.panMode = false;
      pan.setAttribute('aria-pressed', 'false');
    }
  });
  pan.addEventListener('click', () => {
    renderer.panMode = !renderer.panMode;
    pan.setAttribute('aria-pressed', String(renderer.panMode));
  });
  host.append(h('div', { class: 'scene-controls', role: 'group', 'aria-label': 'View' }, zoom, pan));
}
