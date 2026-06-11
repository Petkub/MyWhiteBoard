// Committed-layer renderer. Draws page background + all committed strokes that
// intersect the viewport (bbox culling). Redrawn on stroke commit / pan / zoom.

import { PAGE_W, clamp } from '../config.js';
import { camera, screenToWorld } from '../viewport/camera.js';
import { state, spreadPages, SPREAD_GAP } from '../state.js';
import { strokeBBox } from '../engine/strokes.js';
import { nodeMapOf } from '../engine/shapes.js';
import { drawStroke } from './paint.js';
import { get as getImage } from './imageCache.js';

let canvas, ctx, dpr = 1, vw = 0, vh = 0;

export function initRenderer(canvasEl) {
  canvas = canvasEl;
  ctx = canvas.getContext('2d');
  resize();
  window.addEventListener('resize', () => { resize(); render(); });
}

export function viewport() { return { vw, vh }; }

export function resize() {
  dpr = window.devicePixelRatio || 1;
  vw = canvas.clientWidth;
  vh = canvas.clientHeight;
  canvas.width = Math.round(vw * dpr);
  canvas.height = Math.round(vh * dpr);
}

export function render() {
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // world -> device px
  ctx.setTransform(camera.scale * dpr, 0, 0, camera.scale * dpr, -camera.x * dpr, -camera.y * dpr);
  ctx.imageSmoothingQuality = 'high';

  const topLeft = screenToWorld(0, 0);
  const botRight = screenToWorld(vw, vh);
  // spread mode draws the visible pair (left at 0, right translated);
  // single mode is the degenerate case (right = null).
  const [li, ri] = spreadPages();
  drawPageAt(state.pages[li], 0, li === state.current, topLeft, botRight);
  if (ri !== null) drawPageAt(state.pages[ri], PAGE_W + SPREAD_GAP, ri === state.current, topLeft, botRight);
}

// Draw one page (paper + strokes) translated to world-x `dx`.
function drawPageAt(page, dx, active, tl, br) {
  ctx.save();
  ctx.translate(dx, 0);
  const view = { x1: tl.x - dx, y1: tl.y, x2: br.x - dx, y2: br.y };
  drawPaper(page, view, active);

  const strokes = page.strokes;
  const nodeMap = nodeMapOf(strokes);
  // pass 1: edges (always, under everything else); pass 2: everything else with culling
  for (const s of strokes) {
    if (s.tool === 'shape' && s.kind === 'edge') drawStroke(ctx, s, nodeMap);
  }
  for (const s of strokes) {
    if (s.tool === 'shape' && s.kind === 'edge') continue;
    const b = strokeBBox(s);
    if (b.x2 < view.x1 || b.x1 > view.x2 || b.y2 < view.y1 || b.y1 > view.y2) continue;
    drawStroke(ctx, s, nodeMap);
  }
  ctx.restore();
}

function drawPaper(page, view, active) {
  // page sheet (white) — x in [0,PAGE_W]; y bounded when page.ph is set
  // (fixed page size), otherwise unbounded: paint just the visible band.
  const ph = page.ph || null;
  const yTop = ph ? 0 : Math.max(view.y1, -40);
  const yBot = ph ? ph : view.y2 + 40;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, yTop, PAGE_W, yBot - yTop);

  // page edge: crisp ink outline for fixed pages, subtle shadow for infinite;
  // the inactive page of a spread gets a lighter edge so the active one reads.
  ctx.save();
  ctx.strokeStyle = ph
    ? (active ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.20)')
    : (active ? 'rgba(0,0,0,0.10)' : 'rgba(0,0,0,0.06)');
  ctx.lineWidth = (ph ? 1.5 : 1) / camera.scale;
  ctx.strokeRect(0, yTop, PAGE_W, yBot - yTop);
  ctx.restore();

  if (page.bgImage) {
    const img = getImage(page.bgImage);
    if (img) ctx.drawImage(img, 0, 0, PAGE_W, page.bgImageH || PAGE_W);
  } else {
    drawBackground(page.bg, yTop, yBot);
  }
}

function drawBackground(bg, yTop, yBot) {
  if (bg === 'plain') return;
  const gap = 28;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, yTop, PAGE_W, yBot - yTop);
  ctx.clip();
  const startY = Math.floor(yTop / gap) * gap;

  if (bg === 'lined') {
    ctx.strokeStyle = '#cdd7e5';
    ctx.lineWidth = 1 / camera.scale;
    for (let y = startY; y <= yBot; y += gap) line(0, y, PAGE_W, y);
    ctx.strokeStyle = '#f2b8b8';
    ctx.beginPath(); ctx.moveTo(56, yTop); ctx.lineTo(56, yBot); ctx.stroke();
  } else if (bg === 'grid') {
    ctx.strokeStyle = '#dde6f0';
    ctx.lineWidth = 1 / camera.scale;
    for (let y = startY; y <= yBot; y += gap) line(0, y, PAGE_W, y);
    for (let x = 0; x <= PAGE_W; x += gap) line(x, yTop, x, yBot);
  } else if (bg === 'dotted') {
    ctx.fillStyle = '#c4cedd';
    const r = clamp(1.1 / camera.scale, 0.6, 2);
    for (let y = startY; y <= yBot; y += gap) {
      for (let x = gap; x < PAGE_W; x += gap) {
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
  ctx.restore();
}

function line(x1, y1, x2, y2) {
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
}
