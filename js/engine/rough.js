// Hand-drawn (Excalidraw-style) shape rendering via rough.js (vendored, MIT).
// Produces a deterministic sketchy outline per shape (seeded so it doesn't
// jitter between frames), rendered op-by-op into our canvas ctx (transform-safe).

import rough from '../../assets/vendor/rough.esm.js';
import { nodeCenter, nodeRadius } from './shapes.js';

const gen = rough.generator();

const opts = (s) => ({
  seed: (s.seed || 1) >>> 0,
  roughness: 1.0,
  bowing: 1.2,
  strokeWidth: s.size,
  stroke: s.color,
  disableMultiStrokeFill: true,
});

function roundRectPath(x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  const x2 = x + w, y2 = y + h;
  return `M ${x + r} ${y} L ${x2 - r} ${y} A ${r} ${r} 0 0 1 ${x2} ${y + r} `
    + `L ${x2} ${y2 - r} A ${r} ${r} 0 0 1 ${x2 - r} ${y2} `
    + `L ${x + r} ${y2} A ${r} ${r} 0 0 1 ${x} ${y2 - r} `
    + `L ${x} ${y + r} A ${r} ${r} 0 0 1 ${x + r} ${y} Z`;
}

// Returns a rough.js drawable (outline only) for a shape kind.
export function roughDrawable(s) {
  const a = s.a, b = s.b, o = opts(s);
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
  const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
  switch (s.kind) {
    case 'rect':
      return gen.path(roundRectPath(x, y, w, h, Math.min(18, w / 5, h / 5)), o);
    case 'circle':
      return gen.ellipse(cx, cy, w, h, o);
    case 'triangle':
      return gen.linearPath([[cx, y], [x + w, y + h], [x, y + h], [cx, y]], o);
    case 'diamond':
      return gen.linearPath([[cx, y], [x + w, cy], [cx, y + h], [x, cy], [cx, y]], o);
    case 'grid':
      return gen.path(gridPath(x, y, w, h, s.cols || 4, s.rows || 4), o);
    case 'node': {
      const r = nodeRadius(s), c = nodeCenter(s);
      return gen.circle(c.x, c.y, r * 2, o);
    }
    case 'line':
    case 'arrow':
    default:
      return gen.line(a.x, a.y, b.x, b.y, o);
  }
}

function gridPath(x, y, w, h, cols, rows) {
  let d = `M ${x} ${y} h ${w} v ${h} h ${-w} Z`;
  for (let i = 1; i < cols; i++) { const gx = x + (w * i) / cols; d += ` M ${gx} ${y} V ${y + h}`; }
  for (let j = 1; j < rows; j++) { const gy = y + (h * j) / rows; d += ` M ${x} ${gy} H ${x + w}`; }
  return d;
}

// Render a rough drawable's ops into ctx (stroke styling set by caller).
export function renderDrawable(ctx, drawable) {
  for (const set of drawable.sets) {
    if (!set.ops || !set.ops.length) continue;
    ctx.beginPath();
    for (const { op, data } of set.ops) {
      if (op === 'move') ctx.moveTo(data[0], data[1]);
      else if (op === 'lineTo') ctx.lineTo(data[0], data[1]);
      else if (op === 'bcurveTo') ctx.bezierCurveTo(data[0], data[1], data[2], data[3], data[4], data[5]);
    }
    if (set.type === 'fillPath') ctx.fill();
    else ctx.stroke();
  }
}

// Draw a hand-drawn arrowhead (V) at `tip`, pointing away from `from`.
export function drawArrowHead(ctx, from, tip, size, color, lineWidth) {
  const ang = Math.atan2(tip.y - from.y, tip.x - from.x);
  const len = size;
  const spread = Math.PI / 7; // ~26°
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(tip.x - len * Math.cos(ang - spread), tip.y - len * Math.sin(ang - spread));
  ctx.lineTo(tip.x, tip.y);
  ctx.lineTo(tip.x - len * Math.cos(ang + spread), tip.y - len * Math.sin(ang + spread));
  ctx.stroke();
}
