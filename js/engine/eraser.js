// Geometric eraser + select hit-testing. Operates on stored vector points,
// NOT DOM nodes (hybrid canvas render has no per-stroke DOM).

// Squared distance from point p to segment a-b.
export function segDistSq(a, b, p) {
  const vx = b.x - a.x, vy = b.y - a.y;
  const wx = p.x - a.x, wy = p.y - a.y;
  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return wx * wx + wy * wy;
  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) { const dx = p.x - b.x, dy = p.y - b.y; return dx * dx + dy * dy; }
  const t = c1 / c2;
  const px = a.x + t * vx, py = a.y + t * vy;
  const dx = p.x - px, dy = p.y - py;
  return dx * dx + dy * dy;
}

// Does eraser circle (center p, radius r) touch stroke s?
export function strokeHitsPoint(s, p, r) {
  if (s.tool === 'image' || s.tool === 'math') {
    return p.x >= s.x - r && p.x <= s.x + s.w + r && p.y >= s.y - r && p.y <= s.y + s.h + r;
  }
  if (s.tool === 'emoji') {
    return p.x >= s.x - r && p.x <= s.x + s.size + r && p.y >= s.y - r && p.y <= s.y + s.size + r;
  }
  if (s.tool === 'text') {
    const h = (s.size || 16) * 1.4 * Math.max(1, String(s.text || '').split('\n').length);
    return p.x >= s.x - r && p.x <= s.x + s.w + r && p.y >= s.y - r && p.y <= s.y + h + r;
  }
  if (s.tool === 'shape') {
    if (s.kind === 'edge') return false; // erase a node to remove its edges
    const x1 = Math.min(s.a.x, s.b.x), y1 = Math.min(s.a.y, s.b.y);
    const x2 = Math.max(s.a.x, s.b.x), y2 = Math.max(s.a.y, s.b.y);
    return p.x >= x1 - r && p.x <= x2 + r && p.y >= y1 - r && p.y <= y2 + r;
  }
  const tol = r + (s.size || 0) / 2, tol2 = tol * tol;
  const pts = s.points;
  if (!pts || !pts.length) return false;
  if (pts.length === 1) {
    const dx = pts[0].x - p.x, dy = pts[0].y - p.y;
    return dx * dx + dy * dy <= tol2;
  }
  for (let i = 0; i < pts.length - 1; i++) {
    if (segDistSq(pts[i], pts[i + 1], p) <= tol2) return true;
  }
  return false;
}

// Remove every unlocked stroke the eraser touches. Returns true if any removed.
export function eraseAt(strokes, p, r) {
  let removed = false;
  for (let i = strokes.length - 1; i >= 0; i--) {
    if (strokes[i].locked) continue;
    if (strokeHitsPoint(strokes[i], p, r)) { strokes.splice(i, 1); removed = true; }
  }
  return removed;
}

// Topmost stroke index whose ink passes within `tol` of point p (select tap).
export function strokeIndexAt(strokes, p, tol = 8) {
  for (let i = strokes.length - 1; i >= 0; i--) {
    if (strokeHitsPoint(strokes[i], p, tol)) return i;
  }
  return -1;
}
