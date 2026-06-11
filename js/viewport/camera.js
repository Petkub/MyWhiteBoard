// Viewport camera — maps world (page) coords <-> screen px.
//   screen = world * scale - cam        (cam in screen px)
// Vertical-infinite page: pan y freely; horizontal centered unless zoomed.

import { PAGE_W, MIN_SCALE, MAX_SCALE, clamp } from '../config.js';

export const camera = { x: 0, y: 0, scale: 1 };

export function screenToWorld(sx, sy) {
  return { x: (sx + camera.x) / camera.scale, y: (sy + camera.y) / camera.scale };
}
export function worldToScreen(wx, wy) {
  return { x: wx * camera.scale - camera.x, y: wy * camera.scale - camera.y };
}

// World width of the visible page layout — wired by main.js so two-page
// spread mode widens fit/centering. Defaults to a single page.
let worldW = () => PAGE_W;
export function setWorldWidth(fn) { worldW = fn; }

// Center the visible page layout horizontally in a viewport of width vw.
export function centerH(vw) {
  camera.x = (worldW() / 2) * camera.scale - vw / 2;
}

// Wired by main.js so fixed-size pages stop scrolling past the paper edge.
// pageH() -> fixed page height in world px or null (infinite);
// viewH() -> stage height in screen px.
let pageH = () => null, viewH = () => 0;
export function setCameraBounds(phFn, vhFn) { pageH = phFn; vhFn && (viewH = vhFn); }

function clampVertical() {
  const top = -200; // small overscroll at top
  if (camera.y < top) camera.y = top;
  const ph = pageH();
  if (ph) {
    const maxY = Math.max(top, ph * camera.scale - viewH() + 200);
    if (camera.y > maxY) camera.y = maxY;
  }
}

// Pan content by pointer delta (dx,dy in screen px).
export function panBy(dx, dy) {
  camera.x -= dx;
  camera.y -= dy;
  clampVertical();
}

// Zoom about a screen anchor, keeping the world point under it fixed.
export function zoomAt(sx, sy, factor) {
  const w = screenToWorld(sx, sy);
  camera.scale = clamp(camera.scale * factor, MIN_SCALE, MAX_SCALE);
  camera.x = w.x * camera.scale - sx;
  camera.y = w.y * camera.scale - sy;
  clampVertical();
}

// Scale so the visible page layout fits the viewport (never upscale past 1).
export function fitWidth(vw) {
  camera.scale = clamp(vw / (worldW() + 48), MIN_SCALE, 1);
}

export function resetTop(vw) {
  camera.y = -24; // small top gutter
  centerH(vw);
}
