// Single stroke -> canvas painter. Shared by the committed renderer and the
// live overlay so on-screen ink matches committed ink exactly.
// Assumes the ctx transform is already world->screen (draw in world coords).

import { fountainStroke, buildPolyline } from '../engine/strokes.js';
import { shapePath, isClosed, nodeCenter, nodeRadius } from '../engine/shapes.js';
import { roughDrawable, renderDrawable, drawArrowHead } from '../engine/rough.js';
import { layoutText, fontString, LINE_RATIO } from '../engine/text.js';
import { mathSrc } from './mathInline.js';
import { get as getImage } from './imageCache.js';

export function drawStroke(ctx, s, nodeMap = null) {
  switch (s.tool) {
    case 'pen':
      if (s.style === 'fountain') drawFountain(ctx, s);
      else strokeLine(ctx, buildPolyline(s), s.color, s.size, 1, 'source-over');
      break;
    case 'highlighter':
      strokeLine(ctx, buildPolyline(s), s.color, s.size, 0.4, 'multiply');
      break;
    case 'shape':
      drawShape(ctx, s, nodeMap);
      break;
    case 'image':
    case 'math':
      drawImage(ctx, s);
      break;
    case 'text':
      drawText(ctx, s);
      break;
    case 'emoji':
      ctx.font = `${s.size}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      ctx.fillText(s.char, s.x, s.y);
      ctx.textBaseline = 'alphabetic';
      break;
    default:
      break;
  }
}

function drawShape(ctx, s, nodeMap) {
  if (s.kind === 'edge') { drawEdge(ctx, s, nodeMap); return; }

  // solid fill (behind) for closed shapes when requested
  if (s.filled && isClosed(s.kind)) {
    const d = shapePath(s.kind, s.a, s.b, { cols: s.cols, rows: s.rows });
    ctx.fillStyle = s.color;
    ctx.fill(new Path2D(d));
  }

  // hand-drawn (rough) outline
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineWidth = s.size;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  renderDrawable(ctx, roughDrawable(s));

  // arrowheads
  if (s.kind === 'arrow') {
    const headLen = (s.arrowSize || 14) + s.size * 1.5;
    if (s.arrowEnd !== false) drawArrowHead(ctx, s.a, s.b, headLen, s.color, s.size);
    if (s.arrowStart) drawArrowHead(ctx, s.b, s.a, headLen, s.color, s.size);
  }

  if (s.kind === 'node' && s.label) {
    const cx = (s.a.x + s.b.x) / 2, cy = (s.a.y + s.b.y) / 2;
    ctx.fillStyle = s.color;
    ctx.font = fontString(14);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(s.label, cx, cy);
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }
}

// Edge connects two nodes' rims; skips if either endpoint was erased.
function drawEdge(ctx, s, nodeMap) {
  if (!nodeMap) return;
  const A = nodeMap.get(s.from), B = nodeMap.get(s.to);
  if (!A || !B) return;
  const c1 = nodeCenter(A), c2 = nodeCenter(B);
  const r1 = nodeRadius(A), r2 = nodeRadius(B);
  const dx = c2.x - c1.x, dy = c2.y - c1.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  ctx.strokeStyle = s.color;
  ctx.lineWidth = s.size;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(c1.x + ux * r1, c1.y + uy * r1);
  ctx.lineTo(c2.x - ux * r2, c2.y - uy * r2);
  ctx.stroke();
}

function drawImage(ctx, s) {
  const img = getImage(s.src);
  if (img) ctx.drawImage(img, s.x, s.y, s.w, s.h);
  else {
    // placeholder while decoding
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.05)';
    ctx.fillRect(s.x, s.y, s.w, s.h);
    ctx.restore();
  }
}

// Text with inline $...$ math: words fillText'd, math spans drawn as cached
// MathJax SVGs (light box placeholder while the render/decode is in flight —
// mathInline's onReady and imageCache's ready callback both trigger repaints).
function drawText(ctx, s) {
  const { lines } = layoutText(s.text, s.size, s.w);
  ctx.fillStyle = s.color;
  ctx.font = fontString(s.size);
  ctx.textBaseline = 'top';
  for (const L of lines) {
    const textTop = s.y + L.y + (L.h - s.size * LINE_RATIO) / 2; // center text runs in a math-tall line
    for (const it of L.items) {
      if (it.kind === 'math') {
        const src = mathSrc(it.latex, s.size, s.color);
        const img = src && getImage(src);
        const my = s.y + L.y + (L.h - it.h) / 2;
        if (img) ctx.drawImage(img, s.x + it.x, my, it.w, it.h);
        else {
          ctx.save();
          ctx.globalAlpha = 0.12;
          ctx.fillRect(s.x + it.x, my, it.w, it.h);
          ctx.restore();
        }
      } else if (it.kind === 'word') {
        ctx.fillText(it.str, s.x + it.x, textTop);
      }
    }
  }
  ctx.textBaseline = 'alphabetic';
}

// Variable-width fountain: each segment is a round-capped capsule; overlapping
// round caps blend at joints -> smooth curves, no barbs at sharp turns.
function drawFountain(ctx, s) {
  const fs = fountainStroke(s);
  if (!fs) return;
  const { center, widths } = fs;
  ctx.fillStyle = s.color;
  ctx.strokeStyle = s.color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (center.length === 1) {
    ctx.beginPath();
    ctx.arc(center[0].x, center[0].y, Math.max(0.4, widths[0] / 2), 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  for (let i = 0; i < center.length - 1; i++) {
    ctx.beginPath();
    ctx.moveTo(center[i].x, center[i].y);
    ctx.lineTo(center[i + 1].x, center[i + 1].y);
    ctx.lineWidth = (widths[i] + widths[i + 1]) / 2;
    ctx.stroke();
  }
}

function strokeLine(ctx, d, color, size, alpha, comp) {
  if (!d) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = comp;
  ctx.strokeStyle = color;
  ctx.lineWidth = size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke(new Path2D(d));
  ctx.restore();
}
