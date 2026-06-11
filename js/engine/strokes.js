// Stroke geometry — ported math from the slide-maker draw-tool (clean rewrite).
// Builds the fountain-pen ribbon outline + resampled centerline. Pure functions:
// world-coordinate points in, SVG path-data ('d') strings out (used by Path2D).

import { clamp } from '../config.js';
import { textHeight } from './text.js';

// Catmull-Rom resample at fixed arc-length step. sharpness 0 = soft, 1 = polyline.
export function resampleCenterline(pts, sharpness, step = 2.0) {
  if (pts.length < 2) return pts.slice();
  const k = (1 - clamp(sharpness, 0, 1)) * (2 / 3);
  const out = [{ x: pts[0].x, y: pts[0].y, t: pts[0].t, p: pts[0].p }];
  let leftover = 0;

  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) * k, c1y = p1.y + (p2.y - p0.y) * k;
    const c2x = p2.x - (p3.x - p1.x) * k, c2y = p2.y - (p3.y - p1.y) * k;
    const chord = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const samples = Math.max(2, Math.ceil(chord / step) * 2);
    let prev = { x: p1.x, y: p1.y };
    for (let j = 1; j <= samples; j++) {
      const u = j / samples;
      const x = bez(p1.x, c1x, c2x, p2.x, u);
      const y = bez(p1.y, c1y, c2y, p2.y, u);
      leftover += Math.hypot(x - prev.x, y - prev.y);
      if (leftover >= step) {
        out.push({ x, y, t: lerp(p1.t || 0, p2.t || 0, u), p: lerp(p1.p || 0, p2.p || 0, u) });
        leftover = 0;
      }
      prev = { x, y };
    }
  }
  const last = pts[pts.length - 1];
  out.push({ x: last.x, y: last.y, t: last.t, p: last.p });
  return out;
}

function bez(p0, p1, p2, p3, u) {
  const v = 1 - u;
  return v * v * v * p0 + 3 * v * v * u * p1 + 3 * v * u * u * p2 + u * u * u * p3;
}
function lerp(a, b, u) { return a + (b - a) * u; }

function computeVelocities(pts) {
  const v = new Array(pts.length).fill(0);
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x, dy = pts[i].y - pts[i - 1].y;
    const dt = Math.max(1, (pts[i].t || 0) - (pts[i - 1].t || 0));
    v[i] = Math.hypot(dx, dy) / dt;
  }
  v[0] = v[1] || 0;
  return v;
}

function smoothArray(arr, window) {
  const out = new Array(arr.length);
  const r = Math.floor(window / 2);
  for (let i = 0; i < arr.length; i++) {
    let sum = 0, count = 0;
    for (let j = i - r; j <= i + r; j++) {
      if (j >= 0 && j < arr.length) { sum += arr[j]; count++; }
    }
    out[i] = sum / count;
  }
  return out;
}

// Light Laplacian smoothing of point positions (endpoints fixed). Kills the
// jitter that makes the ribbon look faceted.
function smoothPositions(pts, passes) {
  for (let k = 0; k < passes; k++) {
    const c = pts.map((p) => ({ x: p.x, y: p.y }));
    for (let i = 1; i < pts.length - 1; i++) {
      pts[i].x = (c[i - 1].x + c[i].x * 2 + c[i + 1].x) / 4;
      pts[i].y = (c[i - 1].y + c[i].y * 2 + c[i + 1].y) / 4;
    }
  }
}

// Fountain stroke geometry: smoothed centerline + per-sample width.
// Rendered by paint.js as a round-capped capsule chain (no barbs, smooth joins).
export function fountainStroke(s) {
  const raw = s.points;
  if (!raw.length) return null;
  const base = s.size;
  if (raw.length === 1) {
    return { center: [{ x: raw[0].x, y: raw[0].y }], widths: [Math.max(0.8, base)] };
  }

  const center = resampleCenterline(raw, s.sharpness ?? 0.3, 1.6);
  if (center.length < 2) return { center: [center[0]], widths: [base] };
  smoothPositions(center, 3);

  const n = center.length;
  // Broad-nib model: width depends on stroke direction vs a fixed nib edge.
  // Strokes perpendicular to the nib are thick; parallel are thin. Deterministic
  // and smooth (no velocity noise) -> real italic/fountain thick-thin contrast.
  const NIB = -Math.PI / 4;                 // nib edge orientation (~45°, italic)
  const sinN = Math.sin(NIB), cosN = Math.cos(NIB);
  const thinW = base * 0.28, thickW = base * 1.6;
  const taper = clamp(s.taper ?? 0.7, 0, 1);
  const K = 3;                               // tangent window (smooths direction)
  const widths = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = center[Math.max(0, i - K)], b = center[Math.min(n - 1, i + K)];
    const tx = b.x - a.x, ty = b.y - a.y;
    const len = Math.hypot(tx, ty) || 1;
    const ux = tx / len, uy = ty / len;
    const contrast = Math.abs(ux * sinN - uy * cosN); // |sin(angle - nib)|: 0 thin, 1 thick
    let w = thinW + (thickW - thinW) * contrast;
    const pr = center[i].p || 0;
    if (pr > 0) w = thinW + (thickW - thinW) * pr;     // pressure overrides if a real pen
    const taperRange = Math.min(8, Math.floor(n * 0.14));
    if (taperRange > 0) {
      const tEnd = Math.min(clamp(i / taperRange, 0, 1), clamp((n - 1 - i) / taperRange, 0, 1));
      w *= 1 - taper * (1 - tEnd);
    }
    widths[i] = Math.max(0.2, w);
  }
  // gentle width smoothing to erase residual facets (keeps overall contrast)
  const smoothed = smoothArray(widths, 5);
  return { center, widths: smoothed };
}

// Plain polyline 'd' through resampled centerline (ballpoint / highlighter).
export function buildPolyline(s) {
  const pts = resampleCenterline(s.points, s.sharpness ?? 0.3, 2.0);
  if (!pts.length) return '';
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) d += ` L ${pts[i].x} ${pts[i].y}`;
  return d;
}

// Axis-aligned bbox of a stroke (for viewport culling + select hit-test).
export function strokeBBox(s) {
  if (s.tool === 'image' || s.tool === 'math') {
    return { x1: s.x, y1: s.y, x2: s.x + s.w, y2: s.y + s.h };
  }
  if (s.tool === 'emoji') {
    return { x1: s.x, y1: s.y, x2: s.x + s.size, y2: s.y + s.size };
  }
  if (s.tool === 'text') {
    const h = textHeight(s.text, s.size, s.w);
    return { x1: s.x, y1: s.y, x2: s.x + s.w, y2: s.y + h };
  }
  if (s.tool === 'shape') {
    if (s.kind === 'edge') return { x1: 0, y1: 0, x2: 0, y2: 0 }; // resolved at draw time
    const pad = (s.size || 1) + 2;
    return {
      x1: Math.min(s.a.x, s.b.x) - pad, y1: Math.min(s.a.y, s.b.y) - pad,
      x2: Math.max(s.a.x, s.b.x) + pad, y2: Math.max(s.a.y, s.b.y) + pad,
    };
  }
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const p of s.points) {
    if (p.x < x1) x1 = p.x; if (p.y < y1) y1 = p.y;
    if (p.x > x2) x2 = p.x; if (p.y > y2) y2 = p.y;
  }
  const pad = (s.size || 1) + 2;
  return { x1: x1 - pad, y1: y1 - pad, x2: x2 + pad, y2: y2 + pad };
}
