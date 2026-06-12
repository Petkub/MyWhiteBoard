// Pointer routing — the input brain. Hybrid model (Q5-C):
//   pen  -> inks       (pressure -> width)
//   mouse-> inks       (unless hand tool / space held -> pans)
//   touch-> gestures   (1 finger pan + flip, 2 finger pinch-zoom); never inks.
// Palm rejection: an incoming touch cancels any in-progress ink stroke.

import { FLICK_FLIP_PX, PAGE_W, clamp } from '../config.js';
import { camera, screenToWorld, worldToScreen, panBy, zoomAt } from '../viewport/camera.js';
import {
  state, curTool, curStrokes, curPage, clone, addStroke, recordUndo, mutate,
  flipPage, spreadPages, setPageQuiet, curPageOffsetX, SPREAD_GAP,
} from '../state.js';
import { nodeAtRim, nodeCenter, nodeRadius } from '../engine/shapes.js';
import { strokeBBox } from '../engine/strokes.js';
import { eraseAt, strokeIndexAt, isScribble } from '../engine/eraser.js';
import { render } from '../render/renderer.js';
import {
  drawLive, clearOverlay, drawSelection, drawRubber, drawLassoPath,
  drawLaserTrails, LASER_LIFE_MS, LASER_HOLD_FADE_MS, HANDLES, handlePoint, isResizable,
} from '../render/overlay.js';

let el = null;
let spaceDown = false;
let textHandler = () => {};        // wired by main -> opens text editor at a world point
let mathHandler = () => {};        // wired by main -> opens math (LaTeX) editor

export function setTextHandler(fn) { textHandler = fn; }
export function setMathHandler(fn) { mathHandler = fn; }

// Wired by main: repositions floating DOM editors (text/math) after pan/zoom.
let cameraChanged = () => {};
export function setCameraChangeHandler(fn) { cameraChanged = fn; }

// Overlay pixels (selection rings, handles) bake the camera transform at draw
// time — every camera move must repaint them or they drift off the strokes.
function afterCameraChange() {
  if (!ink.active) drawSelection(curStrokes(), state.selected);
  cameraChanged();
}

const ink = { active: false, stroke: null, filtered: null, pull: null, straight: false };
const sel = { mode: null, start: null, undoSnap: null };
const resize = { active: false, handle: null, stroke: null, startStroke: null, startBBox: null, undoSnap: null };
const lasso = { pts: null };
const erase = { active: false, undoSnap: null, changed: false };
const gesture = { pointers: new Map(), mode: null, lastMid: null, lastDist: 0, startX: 0, startY: 0 };

// Laser pointer — ephemeral trails animated by a rAF loop until they fade.
const laser = { trails: [], cur: null, raf: 0 };

function laserFrame() {
  const now = performance.now();
  for (const tr of laser.trails) {
    if (!tr.live && tr.mode !== 'hold') tr.points = tr.points.filter((p) => now - p.t < LASER_LIFE_MS);
  }
  laser.trails = laser.trails.filter((tr) => tr.live ||
    (tr.mode === 'hold' ? now - tr.released < LASER_HOLD_FADE_MS : tr.points.length > 1));
  if (!laser.trails.length) {
    laser.raf = 0;
    clearOverlay();
    return;
  }
  drawLaserTrails(laser.trails);
  laser.raf = requestAnimationFrame(laserFrame);
}

let cursorEl = null;
const RING_TOOLS = new Set(['eraser', 'highlighter', 'pen', 'laser']);

export function initInput(overlayCanvas) {
  el = overlayCanvas;
  el.style.touchAction = 'none';
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
  el.addEventListener('wheel', onWheel, { passive: false });
  el.addEventListener('contextmenu', (e) => e.preventDefault()); // right-click stays inert
  // brush-size ring cursor (shows actual eraser/highlighter/pen size on paper)
  cursorEl = document.createElement('div');
  cursorEl.className = 'brush-cursor';
  cursorEl.hidden = true;
  el.parentElement.appendChild(cursorEl);
  el.addEventListener('pointermove', (e) => updateCursor(localXY(e), e.pointerType));
  el.addEventListener('pointerdown', (e) => updateCursor(localXY(e), e.pointerType));
  el.addEventListener('pointerleave', hideCursor);
  // squeeze the ring slightly while the pen is down
  el.addEventListener('pointerdown', () => cursorEl.classList.add('down'));
  el.addEventListener('pointerup', () => cursorEl.classList.remove('down'));
  el.addEventListener('pointercancel', () => cursorEl.classList.remove('down'));
  el.addEventListener('pointerleave', () => cursorEl.classList.remove('down'));
  window.addEventListener('keydown', (e) => { if (e.code === 'Space') spaceDown = true; });
  window.addEventListener('keyup', (e) => { if (e.code === 'Space') spaceDown = false; });
}

// Position + size the ring to the current tool's diameter (world size * zoom).
function updateCursor(s, pointerType) {
  if (pointerType === 'touch' || !RING_TOOLS.has(state.tool)) { hideCursor(); return; }
  const d = Math.max(4, curTool().size * camera.scale);
  cursorEl.style.width = cursorEl.style.height = d + 'px';
  // independent `translate` property, NOT transform: the .down squeeze uses the
  // independent `scale` property, which would multiply a transform-translate
  // and shift the ring; translate+scale compose around the element center.
  cursorEl.style.translate = `${s.x - d / 2}px ${s.y - d / 2}px`;
  // ring shows the actual ink color (+faint fill); eraser stays neutral dashed
  const col = state.tool === 'eraser' ? null : (curTool().color || null);
  cursorEl.style.borderColor = col || 'rgba(0,0,0,0.6)';
  cursorEl.style.color = col || 'rgba(0,0,0,0.6)';            // center dot via currentColor
  cursorEl.style.background = col ? col + '1f' : '';          // ~12% alpha tint
  cursorEl.classList.toggle('dashed', state.tool === 'eraser');
  cursorEl.hidden = false;
  cursorEl._last = s;
  el.style.cursor = 'none';
}

function hideCursor() {
  if (cursorEl) cursorEl.hidden = true;
  if (el) el.style.cursor = 'crosshair';
}

// Re-evaluate ring when tool/size changes without pointer movement.
export function refreshCursor() {
  if (!cursorEl || cursorEl.hidden) return;
  if (!RING_TOOLS.has(state.tool)) { hideCursor(); return; }
  const m = cursorEl._last;
  if (m) updateCursor(m, 'mouse');
}

function localXY(e) {
  const r = el.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

// Screen -> ACTIVE-page-local world coords (subtracts the spread offset when
// the active page is the right page of a two-page spread).
function toWorld(s) {
  const w = screenToWorld(s.x, s.y);
  w.x -= curPageOffsetX();
  return w;
}

// Fixed-size pages (page.ph) stop ink at the paper edge, like real paper.
// In spread mode ink also stops at the side edges so it can't cross the gap.
function clampToPage(w) {
  const ph = curPage().ph;
  if (ph) w.y = clamp(w.y, 0, ph);
  if (state.spread) w.x = clamp(w.x, 0, PAGE_W);
  return w;
}

// In spread mode, a pen/mouse press on the inactive page of the pair makes it
// the active page (like touching the other page of an open book).
function pickSpreadPage(s) {
  if (!state.spread) return;
  const [li, ri] = spreadPages();
  if (ri === null) return;
  const wx = screenToWorld(s.x, s.y).x;
  const target = wx >= PAGE_W + SPREAD_GAP / 2 ? ri : li;
  if (target !== state.current) setPageQuiet(target);
}

function isInkInput(e) {
  if (state.tool === 'hand') return false;
  if (e.pointerType === 'pen') return true;
  if (e.pointerType === 'mouse') return !spaceDown && e.button === 0; // only left inks (middle = pan, right = nothing)
  return false; // touch -> gesture
}

// ----------------------------------------------------------------- pointer down
function onDown(e) {
  if (e.pointerType === 'mouse' && e.button === 2) return; // right-click: inert on the canvas
  const s = localXY(e);
  if (isInkInput(e)) {
    if (gesture.pointers.size) return; // gesture owns the surface
    el.setPointerCapture(e.pointerId);
    pickSpreadPage(s);
    startInk(e, s);
  } else {
    if (e.pointerType === 'mouse' && e.button === 1) e.preventDefault(); // kill middle-click autoscroll
    if (ink.active) cancelInk();       // palm rejection
    el.setPointerCapture(e.pointerId);
    gesture.pointers.set(e.pointerId, s);
    syncGesture();
  }
}

function startInk(e, s) {
  const w = clampToPage(toWorld(s));
  w.t = e.timeStamp; w.p = e.pressure || 0;
  const t = curTool();

  if (state.tool === 'laser') {
    laser.cur = { color: t.color, size: t.size, mode: t.style === 'hold' ? 'hold' : 'trail', live: true, points: [{ x: w.x, y: w.y, t: performance.now() }] };
    laser.trails.push(laser.cur);
    ink.active = true;
    if (!laser.raf) laser.raf = requestAnimationFrame(laserFrame);
    return; // ephemeral — never committed, no undo, no autosave
  }

  if (state.tool === 'text') {
    textHandler({ x: w.x, y: w.y });
    return; // single tap; no drag
  }

  if (state.tool === 'emoji') {
    addStroke({ tool: 'emoji', char: t.char, x: w.x - t.size / 2, y: w.y - t.size / 2, size: t.size });
    return; // single tap; no drag
  }

  if (state.tool === 'math') {
    mathHandler({ x: w.x, y: w.y });
    return; // single tap opens the LaTeX editor
  }

  if (state.tool === 'lasso') {
    lasso.pts = [{ x: w.x, y: w.y }];
    if (!e.shiftKey) state.selected.clear();
    ink.active = true;
    return;
  }

  if (state.tool === 'select') {
    // resize-handle grab on a single resizable selection
    const hit = handleAt(s);
    if (hit) {
      const st = curStrokes()[[...state.selected][0]];
      resize.active = true;
      resize.handle = hit;
      resize.stroke = st;
      resize.startStroke = clone(st);
      resize.startBBox = strokeBBox(st);
      resize.undoSnap = clone(curStrokes());
      ink.active = true;
      return;
    }
    const idx = strokeIndexAt(curStrokes(), w, 8 / camera.scale);
    sel.start = w;
    sel.undoSnap = null;
    if (idx >= 0) {
      if (!e.shiftKey && !state.selected.has(idx)) state.selected.clear();
      state.selected.add(idx);
      sel.mode = 'move';
      drawSelection(curStrokes(), state.selected);
    } else {
      if (!e.shiftKey) state.selected.clear();
      sel.mode = 'rubber';
    }
    ink.active = true;
    return;
  }

  if (state.tool === 'eraser') {
    erase.active = true;
    erase.undoSnap = clone(curStrokes());
    erase.changed = eraseAt(curStrokes(), w, t.size);
    if (erase.changed) render();
    ink.active = true;
    return;
  }

  if (state.tool === 'shape') {
    // node tree-pull: drag from an existing node's rim -> spawn child + edge
    if (t.kind === 'node') {
      const parent = nodeAtRim(curStrokes(), w, 16 / camera.scale);
      if (parent) {
        ink.pull = parent;
        const c = nodeCenter(parent);
        ink.stroke = { tool: 'shape', kind: 'line', color: t.color, size: t.size, a: { x: c.x, y: c.y }, b: w };
        ink.active = true;
        drawLive(ink.stroke);
        return;
      }
    }
    ink.stroke = {
      tool: 'shape', kind: t.kind, color: t.color, size: t.size, filled: t.filled,
      cols: t.cols, rows: t.rows,
      arrowStart: t.arrowStart, arrowEnd: t.arrowEnd, arrowSize: t.arrowSize,
      seed: 1 + Math.floor(Math.random() * 1e6),
      a: w, b: w,
    };
    if (t.kind === 'node') ink.stroke.id = genId();
    ink.active = true;
    drawLive(ink.stroke);
    return;
  }

  // pen / highlighter
  ink.stroke = {
    tool: state.tool, color: t.color, size: t.size,
    style: t.style, taper: t.taper, sharpness: t.sharpness,
    points: [w],
  };
  ink.filtered = { x: w.x, y: w.y };
  ink.active = true;
  drawLive(ink.stroke);
}

// ----------------------------------------------------------------- pointer move
function onMove(e) {
  const s = localXY(e);
  if (gesture.pointers.has(e.pointerId)) {
    gesture.pointers.set(e.pointerId, s);
    moveGesture();
    return;
  }
  if (!ink.active) return;
  const w = clampToPage(toWorld(s));

  if (state.tool === 'laser') {
    laser.cur?.points.push({ x: w.x, y: w.y, t: performance.now() });
    return; // rAF loop paints
  }

  if (state.tool === 'lasso') {
    lasso.pts.push({ x: w.x, y: w.y });
    drawLassoPath(lasso.pts);
    return;
  }

  if (state.tool === 'select') {
    if (resize.active) {
      applyResize(w);
      render();
      drawSelection(curStrokes(), state.selected);
    } else if (sel.mode === 'move') {
      const dx = w.x - sel.start.x, dy = w.y - sel.start.y;
      if (!sel.undoSnap) sel.undoSnap = clone(curStrokes());
      translateSelected(dx, dy);
      sel.start = w;
      render();
      drawSelection(curStrokes(), state.selected);
    } else {
      drawRubber(sel.start, w);
    }
    return;
  }

  if (state.tool === 'eraser') {
    const t = curTool();
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of events) {
      const ls = localXY(ev);
      const p = toWorld(ls);
      if (eraseAt(curStrokes(), p, t.size)) erase.changed = true;
    }
    render();
    return;
  }

  if (state.tool === 'shape') {
    ink.stroke.b = e.shiftKey ? squareLock(ink.stroke.a, w) : w;
    drawLive(ink.stroke);
    return;
  }

  // shift = straight line from the start point to the cursor (Photoshop-style)
  if (e.shiftKey) {
    const start = ink.stroke.points[0];
    ink.stroke.points = [start, { x: w.x, y: w.y, t: e.timeStamp, p: e.pressure || 0 }];
    ink.straight = true;
    ink.stroke.straight = true;          // render as a clean uniform-width line
    ink.filtered = { x: w.x, y: w.y };   // keep EMA synced if shift is released mid-stroke
    drawLive(ink.stroke);
    return;
  }
  ink.straight = false;
  ink.stroke.straight = false;

  // freehand: stabilize via EMA, decimate tiny moves
  const a = curTool().stabilize || 0;
  const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  for (const ev of events) {
    const ls = localXY(ev);
    const raw = clampToPage(toWorld(ls));
    const f = ink.filtered;
    f.x = f.x * a + raw.x * (1 - a);
    f.y = f.y * a + raw.y * (1 - a);
    const last = ink.stroke.points[ink.stroke.points.length - 1];
    const dx = f.x - last.x, dy = f.y - last.y;
    if (dx * dx + dy * dy < 0.25 / (camera.scale * camera.scale)) continue;
    ink.stroke.points.push({ x: f.x, y: f.y, t: ev.timeStamp, p: ev.pressure || 0 });
  }
  drawLive(ink.stroke);
}

// ------------------------------------------------------------------- pointer up
function onUp(e) {
  if (gesture.pointers.has(e.pointerId)) {
    endGesturePointer(e);
    return;
  }
  if (!ink.active) return;
  releaseInk(e);
}

function releaseInk(e) {
  const s = localXY(e);
  const w = clampToPage(toWorld(s));

  if (state.tool === 'laser') {
    if (laser.cur) { laser.cur.live = false; laser.cur.released = performance.now(); }
    laser.cur = null;
    ink.active = false;
    return;
  }

  if (state.tool === 'lasso') {
    finalizeLasso(lasso.pts);
    lasso.pts = null;
    drawSelection(curStrokes(), state.selected);
    ink.active = false;
    return;
  }

  if (state.tool === 'select') {
    if (resize.active) {
      recordUndo(resize.undoSnap);
      resize.active = false; resize.handle = null; resize.stroke = null;
      drawSelection(curStrokes(), state.selected);
    } else if (sel.mode === 'rubber') {
      finalizeRubber(sel.start, w, e.shiftKey);
      drawSelection(curStrokes(), state.selected);
    } else if (sel.mode === 'move' && sel.undoSnap) {
      recordUndo(sel.undoSnap);
    }
    sel.mode = null; sel.undoSnap = null;
    ink.active = false;
    return;
  }

  if (state.tool === 'eraser') {
    if (erase.changed) recordUndo(erase.undoSnap);
    erase.active = false; erase.changed = false; erase.undoSnap = null;
    ink.active = false;
    return;
  }

  if (state.tool === 'shape') {
    if (ink.pull) {
      finishPull(ink.pull, w);
      ink.pull = null; ink.stroke = null; ink.active = false;
      clearOverlay(); render();
      return;
    }
    const a = ink.stroke.a, b = e.shiftKey ? squareLock(a, w) : w;
    if (Math.hypot(b.x - a.x, b.y - a.y) >= 4 / camera.scale) {
      ink.stroke.b = b;
      addStroke(ink.stroke);
    }
    clearOverlay(); render();
    ink.stroke = null; ink.active = false;
    return;
  }

  // pen / highlighter
  if (ink.straight) {
    ink.stroke.points = [ink.stroke.points[0], { x: w.x, y: w.y, t: e.timeStamp, p: e.pressure || 0 }];
  } else {
    ink.stroke.points.push({ x: w.x, y: w.y, t: e.timeStamp, p: e.pressure || 0 });
  }
  // scratch-to-erase: a pen scribble over existing ink deletes it instead of
  // committing; over empty paper it just inks (no accidental no-ops)
  if (state.tool === 'pen' && curTool().scratch !== false && !ink.straight && isScribble(ink.stroke.points)) {
    const snap = clone(curStrokes());
    const r = Math.max(4, ink.stroke.size);
    let changed = false;
    for (const p of ink.stroke.points) if (eraseAt(curStrokes(), p, r)) changed = true;
    if (changed) {
      recordUndo(snap); // also re-renders + autosaves
      clearOverlay();
      ink.stroke = null; ink.filtered = null; ink.active = false;
      return;
    }
  }
  if (ink.stroke.points.length) addStroke(ink.stroke);
  clearOverlay(); render();
  ink.stroke = null; ink.filtered = null; ink.active = false;
}

function cancelInk() {
  if (laser.cur) { laser.cur.live = false; laser.cur.released = performance.now(); laser.cur = null; }
  ink.active = false; ink.stroke = null; ink.filtered = null; ink.pull = null; ink.straight = false;
  sel.mode = null; sel.undoSnap = null;
  resize.active = false; resize.handle = null; resize.stroke = null;
  erase.active = false; erase.changed = false;
  clearOverlay();
}

// Equal-aspect lock (shift): snap drag point so |dx| == |dy| (square/circle).
function squareLock(a, w) {
  const dx = w.x - a.x, dy = w.y - a.y;
  const m = Math.max(Math.abs(dx), Math.abs(dy));
  return { x: a.x + (dx < 0 ? -m : m), y: a.y + (dy < 0 ? -m : m) };
}

const genId = () => 'n' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

// Spawn a child node at `end` (if dragged far enough past the rim) + connect it.
function finishPull(parent, end) {
  const c = nodeCenter(parent), r = nodeRadius(parent);
  if (Math.hypot(end.x - c.x, end.y - c.y) < r + 24 / camera.scale) return; // too short -> cancel
  const childR = r;
  const child = {
    tool: 'shape', kind: 'node', id: genId(),
    color: parent.color, size: parent.size, filled: parent.filled,
    a: { x: end.x - childR, y: end.y }, b: { x: end.x + childR, y: end.y },
  };
  mutate(() => {
    if (!parent.id) parent.id = genId(); // legacy node without id
    const ss = curStrokes();
    ss.push({ tool: 'shape', kind: 'edge', color: parent.color, size: parent.size, from: parent.id, to: child.id });
    ss.push(child);
  });
}

// ----------------------------------------------------------------- resize helpers
// Which handle (if any) is under screen point `s`, for a single resizable selection.
function handleAt(s) {
  if (state.selected.size !== 1) return null;
  const stroke = curStrokes()[[...state.selected][0]];
  if (!isResizable(stroke) || stroke.locked) return null;
  // match the 4px ring padding the overlay draws handles on
  const pad = 4 / camera.scale;
  const b0 = strokeBBox(stroke);
  const b = { x1: b0.x1 - pad, y1: b0.y1 - pad, x2: b0.x2 + pad, y2: b0.y2 + pad };
  const off = curPageOffsetX();
  for (const id of HANDLES) {
    const wp = handlePoint(b, id);
    const sp = worldToScreen(wp.x + off, wp.y);
    if (Math.hypot(sp.x - s.x, sp.y - s.y) <= 11) return id;
  }
  return null;
}

function applyResize(p) {
  const s = resize.stroke, ss = resize.startStroke, sb = resize.startBBox, h = resize.handle;
  let x1 = sb.x1, y1 = sb.y1, x2 = sb.x2, y2 = sb.y2;
  const minW = 20, minH = 12;
  if (h.includes('e')) x2 = Math.max(x1 + minW, p.x);
  if (h.includes('w')) x1 = Math.min(x2 - minW, p.x);
  if (h.includes('s')) y2 = Math.max(y1 + minH, p.y);
  if (h.includes('n')) y1 = Math.min(y2 - minH, p.y);
  const nw = x2 - x1, nh = y2 - y1;

  if (s.tool === 'image' || s.tool === 'math') {
    if (h.length === 2) { // corner -> keep aspect (by width)
      const ar = (sb.x2 - sb.x1) / (sb.y2 - sb.y1) || 1;
      const w2 = nw, h2 = w2 / ar;
      s.w = w2; s.h = h2;
      s.x = h.includes('w') ? sb.x2 - w2 : sb.x1;
      s.y = h.includes('n') ? sb.y2 - h2 : sb.y1;
    } else { s.x = x1; s.y = y1; s.w = nw; s.h = nh; }
  } else if (s.tool === 'emoji') {
    const size = Math.max(8, (h === 'n' || h === 's') ? nh : nw);
    s.size = size;
    s.x = h.includes('w') ? sb.x2 - size : sb.x1;
    s.y = h.includes('n') ? sb.y2 - size : sb.y1;
  } else { // text: side handles = width, vertical/corner = scale font
    if (h === 'e') { s.x = sb.x1; s.w = nw; }
    else if (h === 'w') { s.x = x1; s.w = nw; }
    else {
      const f = clamp(nh / (sb.y2 - sb.y1), 0.15, 15);
      s.size = Math.max(6, ss.size * f);
      if (h.length === 2) s.w = Math.max(20, ss.w * f);
      s.x = h.includes('w') ? x1 : sb.x1;
      s.y = h.includes('n') ? y1 : sb.y1;
    }
  }
}

// ----------------------------------------------------------------- select helpers
function translateSelected(dx, dy) {
  const strokes = curStrokes();
  for (const i of state.selected) {
    const s = strokes[i];
    if (!s || s.locked) continue;
    if (s.tool === 'shape' && s.kind === 'edge') {
      continue; // edges follow their nodes automatically
    } else if (s.tool === 'shape') {
      s.a.x += dx; s.a.y += dy; s.b.x += dx; s.b.y += dy;
    } else if (s.tool === 'image' || s.tool === 'text' || s.tool === 'emoji' || s.tool === 'math') {
      s.x += dx; s.y += dy;
    } else {
      for (const p of s.points) { p.x += dx; p.y += dy; }
    }
  }
}

function finalizeRubber(a, b, additive) {
  if (!additive) state.selected.clear();
  const x1 = Math.min(a.x, b.x), y1 = Math.min(a.y, b.y);
  const x2 = Math.max(a.x, b.x), y2 = Math.max(a.y, b.y);
  const strokes = curStrokes();
  for (let i = 0; i < strokes.length; i++) {
    const s = strokes[i];
    const c = strokeCenter(s);
    if (c.x >= x1 && c.x <= x2 && c.y >= y1 && c.y <= y2) state.selected.add(i);
  }
}

function finalizeLasso(poly) {
  if (!poly || poly.length < 3) return;
  const strokes = curStrokes();
  for (let i = 0; i < strokes.length; i++) {
    if (pointInPoly(strokeCenter(strokes[i]), poly)) state.selected.add(i);
  }
}

function pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    const hit = ((yi > pt.y) !== (yj > pt.y)) &&
      (pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi);
    if (hit) inside = !inside;
  }
  return inside;
}

function strokeCenter(s) {
  if (s.tool === 'shape' && s.kind === 'edge') return { x: -1e9, y: -1e9 }; // never box-select edges
  if (s.tool === 'shape') return { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 };
  if (s.tool === 'image' || s.tool === 'text' || s.tool === 'emoji' || s.tool === 'math') return { x: s.x + (s.w || s.size || 0) / 2, y: s.y + ((s.h || s.size || 0) / 2) };
  let sx = 0, sy = 0;
  for (const p of s.points) { sx += p.x; sy += p.y; }
  return { x: sx / s.points.length, y: sy / s.points.length };
}

// ----------------------------------------------------------------- gestures
function syncGesture() {
  const n = gesture.pointers.size;
  const pts = [...gesture.pointers.values()];
  if (n === 1) {
    gesture.mode = 'pan';
    gesture.lastMid = { ...pts[0] };
    gesture.startX = pts[0].x; gesture.startY = pts[0].y;
  } else if (n >= 2) {
    gesture.mode = 'pinch';
    gesture.lastMid = mid(pts[0], pts[1]);
    gesture.lastDist = dist(pts[0], pts[1]);
  }
}

function moveGesture() {
  const pts = [...gesture.pointers.values()];
  if (gesture.mode === 'pan' && pts.length === 1) {
    const m = pts[0];
    panBy(m.x - gesture.lastMid.x, m.y - gesture.lastMid.y);
    gesture.lastMid = { ...m };
    render();
    afterCameraChange();
  } else if (gesture.mode === 'pinch' && pts.length >= 2) {
    const m = mid(pts[0], pts[1]), d = dist(pts[0], pts[1]);
    if (gesture.lastDist > 0) zoomAt(m.x, m.y, d / gesture.lastDist);
    panBy(m.x - gesture.lastMid.x, m.y - gesture.lastMid.y);
    gesture.lastMid = m; gesture.lastDist = d;
    render();
    afterCameraChange();
  }
}

function endGesturePointer(e) {
  const start = { x: gesture.startX, y: gesture.startY };
  const last = gesture.pointers.get(e.pointerId);
  gesture.pointers.delete(e.pointerId);
  el.releasePointerCapture?.(e.pointerId);

  // horizontal flick -> flip page (touch only; mouse-pan never flips)
  if (e.pointerType === 'touch' && gesture.mode === 'pan' && camera.scale <= 1.001 && last) {
    const dx = last.x - start.x, dy = last.y - start.y;
    if (Math.abs(dx) > FLICK_FLIP_PX && Math.abs(dx) > Math.abs(dy) * 1.5) {
      flipPage(dx < 0 ? 1 : -1);
    }
  }
  if (gesture.pointers.size === 0) { gesture.mode = null; }
  else syncGesture();
}

function onWheel(e) {
  e.preventDefault();
  const s = localXY(e);
  if (e.ctrlKey) {
    zoomAt(s.x, s.y, e.deltaY < 0 ? 1.1 : 1 / 1.1);
  } else {
    panBy(-e.deltaX, -e.deltaY);
  }
  render();
  afterCameraChange();
}

const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
