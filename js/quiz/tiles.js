// Choice-tile builder shared by solo play (quizPlay.js) and live multiplayer
// (live/player.js, live/host.js). One source for the app-accent palette +
// shape badges so every play surface matches the editor's .qz-c0..c3 order.

import { renderContent } from './katex.js';

export const TILE_COLORS = ['#d62828', '#1d3fb6', '#7048e8', '#2f9e44'];
export const TILE_SHAPES = ['▲', '◆', '●', '■'];

// Build one .qp-tile for choice content `c` at index `i`.
// opts: { onPick(tileEl), onZoom(content, color), delayMs }
export function buildTile(c, i, opts = {}) {
  const t = document.createElement('div');
  t.className = 'qp-tile';
  t.style.background = TILE_COLORS[i % TILE_COLORS.length];
  t.style.setProperty('--d', `${opts.delayMs ?? i * 70}ms`);
  const shape = document.createElement('span');
  shape.className = 'qp-shape';
  shape.textContent = TILE_SHAPES[i % TILE_SHAPES.length];
  t.append(shape);
  const body = document.createElement('div');
  body.className = 'qp-tile-body';
  renderContent(body, c);
  t.append(body);
  if (opts.onZoom) {
    const zoom = document.createElement('button');
    zoom.className = 'qp-zoom';
    zoom.title = 'Zoom';
    zoom.textContent = '⤢';
    zoom.addEventListener('click', (e) => { e.stopPropagation(); opts.onZoom(c, TILE_COLORS[i % TILE_COLORS.length]); });
    t.append(zoom);
  }
  if (opts.onPick) t.addEventListener('click', () => opts.onPick(t));
  return t;
}
