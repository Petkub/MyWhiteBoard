// Shape path generation. Returns an SVG 'd' string for a shape between
// anchor a and drag-point b. P1 primitives: line, rect, circle, triangle.

export function shapePath(kind, a, b, opt = {}) {
  switch (kind) {
    case 'line':
      return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
    case 'rect': {
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
      const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
      return `M ${x} ${y} h ${w} v ${h} h ${-w} Z`;
    }
    case 'circle': {
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      const rx = Math.abs(b.x - a.x) / 2, ry = Math.abs(b.y - a.y) / 2;
      // ellipse via two arcs
      return `M ${cx - rx} ${cy} a ${rx} ${ry} 0 1 0 ${rx * 2} 0 a ${rx} ${ry} 0 1 0 ${-rx * 2} 0 Z`;
    }
    case 'triangle': {
      const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x);
      const yb = Math.max(a.y, b.y), yt = Math.min(a.y, b.y);
      return `M ${(x1 + x2) / 2} ${yt} L ${x2} ${yb} L ${x1} ${yb} Z`;
    }
    case 'diamond': {
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      const x1 = Math.min(a.x, b.x), y1 = Math.min(a.y, b.y);
      const x2 = Math.max(a.x, b.x), y2 = Math.max(a.y, b.y);
      return `M ${cx} ${y1} L ${x2} ${cy} L ${cx} ${y2} L ${x1} ${cy} Z`;
    }
    case 'grid': {
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
      const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
      const cols = Math.max(1, opt.cols || 4);
      const rows = Math.max(1, opt.rows || 4);
      let d = `M ${x} ${y} h ${w} v ${h} h ${-w} Z`;
      for (let i = 1; i < cols; i++) { const gx = x + (w * i) / cols; d += ` M ${gx} ${y} V ${y + h}`; }
      for (let j = 1; j < rows; j++) { const gy = y + (h * j) / rows; d += ` M ${x} ${gy} H ${x + w}`; }
      return d;
    }
    case 'node': {
      // circle node sized by drag radius
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      const r = Math.max(14, Math.hypot(b.x - a.x, b.y - a.y) / 2);
      return `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0 Z`;
    }
    default:
      return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
  }
}

export const isClosed = (kind) => kind !== 'line' && kind !== 'edge' && kind !== 'arrow';

// ---- tree-node helpers (kind 'node' + connecting 'edge') ----
export const nodeCenter = (s) => ({ x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 });
export const nodeRadius = (s) => Math.max(14, Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) / 2);

// Topmost node whose rim band (radius ± tol) contains p, else null.
export function nodeAtRim(strokes, p, tol = 16) {
  for (let i = strokes.length - 1; i >= 0; i--) {
    const s = strokes[i];
    if (s.tool !== 'shape' || s.kind !== 'node') continue;
    const c = nodeCenter(s), r = nodeRadius(s);
    const d = Math.hypot(p.x - c.x, p.y - c.y);
    if (d >= r - tol && d <= r + tol) return s;
  }
  return null;
}

// Build id->node lookup for the current page (edges resolve endpoints through it).
export function nodeMapOf(strokes) {
  const m = new Map();
  for (const s of strokes) if (s.tool === 'shape' && s.kind === 'node' && s.id) m.set(s.id, s);
  return m;
}
