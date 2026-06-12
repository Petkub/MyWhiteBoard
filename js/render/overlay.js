// Overlay layer — live (in-progress) stroke, selection rings, rubber-band box.
// Separate canvas above the committed layer so dragging redraws only this.

import { camera, worldToScreen } from '../viewport/camera.js';
import { curPageOffsetX } from '../state.js';
import { strokeBBox } from '../engine/strokes.js';
import { drawStroke } from './paint.js';

let canvas, ctx, dpr = 1;

export function initOverlay(canvasEl) {
  canvas = canvasEl;
  ctx = canvas.getContext('2d');
  resize();
  window.addEventListener('resize', resize);
}

export function resize() {
  dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(canvas.clientWidth * dpr);
  canvas.height = Math.round(canvas.clientHeight * dpr);
}

function world() {
  ctx.setTransform(camera.scale * dpr, 0, 0, camera.scale * dpr, -camera.x * dpr, -camera.y * dpr);
  // overlay coords are local to the ACTIVE page — shift when it's the right
  // page of a two-page spread
  ctx.translate(curPageOffsetX(), 0);
}

export function clearOverlay() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

export function drawLive(stroke) {
  clearOverlay();
  if (!stroke) return;
  world();
  drawStroke(ctx, stroke);
}

// ---- laser pointer trails (ephemeral, never committed) ----
// trails: [{ color, size, points: [{x, y, t}] }] — alpha/width taper with
// point age so the trail melts away comet-style.
export const LASER_LIFE_MS = 700;

export function drawLaserTrails(trails) {
  clearOverlay();
  if (!trails.length) return;
  world();
  const now = performance.now();
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const tr of trails) {
    ctx.shadowColor = tr.color;
    ctx.strokeStyle = tr.color;
    for (let i = 1; i < tr.points.length; i++) {
      const p0 = tr.points[i - 1], p1 = tr.points[i];
      const a = Math.max(0, 1 - (now - p1.t) / LASER_LIFE_MS);
      if (a <= 0) continue;
      ctx.globalAlpha = a;
      ctx.shadowBlur = 14 * a;
      ctx.lineWidth = Math.max(0.5, tr.size * (0.35 + 0.65 * a));
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    }
    // hot white core at the newest point while the stroke is live
    const last = tr.points[tr.points.length - 1];
    if (tr.live && last) {
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 16;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(last.x, last.y, Math.max(1.2, tr.size * 0.35), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
export const isResizable = (s) => s && (s.tool === 'text' || s.tool === 'image' || s.tool === 'emoji' || s.tool === 'math');

export function handlePoint(b, id) {
  const mx = (b.x1 + b.x2) / 2, my = (b.y1 + b.y2) / 2;
  const m = {
    nw: [b.x1, b.y1], n: [mx, b.y1], ne: [b.x2, b.y1], e: [b.x2, my],
    se: [b.x2, b.y2], s: [mx, b.y2], sw: [b.x1, b.y2], w: [b.x1, my],
  }[id];
  return { x: m[0], y: m[1] };
}

// Rounded rect path with .roundRect fallback for older engines.
function rr(x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

// Two-tone ring: solid white underlay + colored dash on top, so the ring
// stays readable over any ink or background image.
function ring(x, y, w, h, color) {
  const k = camera.scale;
  rr(x, y, w, h, 6 / k);
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 3.5 / k;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5 / k;
  ctx.setLineDash([6 / k, 4 / k]);
  ctx.stroke();
  ctx.setLineDash([]);
}

export function drawSelection(strokes, selected) {
  clearOverlay();
  if (!selected || !selected.size) return;
  world();
  const k = camera.scale;
  const pad = 4 / k;
  for (const i of selected) {
    const s = strokes[i];
    if (!s) continue;
    const b = strokeBBox(s);
    const x = b.x1 - pad, y = b.y1 - pad, w = b.x2 - b.x1 + pad * 2, h = b.y2 - b.y1 + pad * 2;
    ring(x, y, w, h, s.locked ? '#d62828' : '#1d3fb6'); // red = locked
    if (s.locked) {
      // lock badge on the top-right corner
      const r = 8 / k;
      ctx.beginPath();
      ctx.arc(x + w, y, r, 0, Math.PI * 2);
      ctx.fillStyle = '#d62828';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5 / k;
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = `${10 / k}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🔒', x + w, y + 0.5 / k);
    }
  }

  // resize handles for a single, unlocked, resizable selection
  if (selected.size === 1) {
    const s = strokes[[...selected][0]];
    if (isResizable(s) && !s.locked) {
      const b = strokeBBox(s);
      const hb = { x1: b.x1 - pad, y1: b.y1 - pad, x2: b.x2 + pad, y2: b.y2 + pad };
      const hr = 4.5 / k;
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#1d3fb6';
      ctx.lineWidth = 1.5 / k;
      for (const id of HANDLES) {
        const p = handlePoint(hb, id);
        ctx.beginPath();
        ctx.arc(p.x, p.y, hr, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
  }
}

export function drawLassoPath(pts) {
  clearOverlay();
  if (!pts || pts.length < 2) return;
  world();
  const k = camera.scale;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.fillStyle = 'rgba(29,63,182,0.07)';
  ctx.fill();
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 3.5 / k;
  ctx.stroke();
  ctx.strokeStyle = '#1d3fb6';
  ctx.lineWidth = 1.5 / k;
  ctx.setLineDash([6 / k, 4 / k]);
  ctx.stroke();
  ctx.setLineDash([]);
}

export function drawRubber(a, b) {
  clearOverlay();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
  const off = curPageOffsetX();
  const p1 = worldToScreen(a.x + off, a.y), p2 = worldToScreen(b.x + off, b.y);
  const x = Math.min(p1.x, p2.x), y = Math.min(p1.y, p2.y);
  const w = Math.abs(p2.x - p1.x), h = Math.abs(p2.y - p1.y);
  rr(x, y, w, h, 5);
  ctx.fillStyle = 'rgba(29,63,182,0.08)';
  ctx.fill();
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.strokeStyle = '#1d3fb6';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 3]);
  ctx.stroke();
  ctx.setLineDash([]);
}
