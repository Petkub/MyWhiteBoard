// Floating zoom controls, bottom-left of the stage: − / % / + step the zoom
// about the viewport center, % resets to 100%, ⛶ re-fits the page to the
// screen (fitPage — whole page for fixed heights, width-fit for infinite).

import { camera, zoomAt, fitPage, resetTop } from '../viewport/camera.js';
import { viewport } from '../render/renderer.js';

const STEP = 1.25;

let pctEl = null;
let onChange = () => {};

const FOCUS_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
  <path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9"/><path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9"/>
  <path d="M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15"/><path d="M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/>
</svg>`;

export function initZoomHud(stage, changed) {
  onChange = changed || (() => {});
  const hud = document.createElement('div');
  hud.className = 'zoom-hud';
  hud.innerHTML = `
    <button class="zh-btn zh-out" title="zoom out">−</button>
    <button class="zh-pct" title="reset to 100%">100%</button>
    <button class="zh-btn zh-in" title="zoom in">+</button>
    <span class="zh-sep"></span>
    <button class="zh-btn zh-focus" title="fit page to screen">${FOCUS_ICON}</button>`;
  pctEl = hud.querySelector('.zh-pct');

  const center = () => { const { vw, vh } = viewport(); return { vw, vh, cx: vw / 2, cy: vh / 2 }; };
  const apply = () => { syncZoomHud(); onChange(); };

  hud.querySelector('.zh-out').addEventListener('click', () => {
    const { cx, cy } = center(); zoomAt(cx, cy, 1 / STEP); apply();
  });
  hud.querySelector('.zh-in').addEventListener('click', () => {
    const { cx, cy } = center(); zoomAt(cx, cy, STEP); apply();
  });
  pctEl.addEventListener('click', () => {
    const { cx, cy } = center(); zoomAt(cx, cy, 1 / camera.scale); apply();
  });
  hud.querySelector('.zh-focus').addEventListener('click', () => {
    const { vw, vh } = viewport();
    fitPage(vw, vh); resetTop(vw, vh); apply();
  });

  stage.append(hud);
  syncZoomHud();
}

export function syncZoomHud() {
  if (pctEl) pctEl.textContent = `${Math.round(camera.scale * 100)}%`;
}
