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

// Scratch-out gesture detector (GoodNotes-style scribble-to-erase).
// A scribble is: enough points, path much longer than its bbox diagonal
// (dense back-and-forth), and several sharp direction reversals.
export function isScribble(pts) {
  if (!pts || pts.length < 12) return false;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, len = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    if (i) len += Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y);
  }
  const diag = Math.hypot(maxX - minX, maxY - minY);
  if (diag < 8) return false;          // a dot / tap
  if (len / diag < 3) return false;    // not dense enough to be a scratch
  // sharp reversals between denoised direction samples (segments >= 3px)
  let turns = 0, ax = 0, ay = 0, px = pts[0].x, py = pts[0].y, have = false;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - px, dy = pts[i].y - py;
    if (dx * dx + dy * dy < 9) continue;
    if (have) {
      const dot = ax * dx + ay * dy;
      const cos = dot / (Math.hypot(ax, ay) * Math.hypot(dx, dy));
      if (cos < -0.5) turns++;         // > ~120° turn = reversal
    }
    ax = dx; ay = dy; px = pts[i].x; py = pts[i].y; have = true;
  }
  return turns >= 5;
}

// Topmost stroke index whose ink passes within `tol` of point p (select tap).
export function strokeIndexAt(strokes, p, tol = 8) {
  for (let i = strokes.length - 1; i >= 0; i--) {
    if (strokeHitsPoint(strokes[i], p, tol)) return i;
  }
  return -1;
}
