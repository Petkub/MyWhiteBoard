// Floating textarea editor for text boxes. Opens at a world point; on commit
// writes a 'text' stroke (or edits the one tapped). Positioned via the camera.

import { camera, worldToScreen } from '../viewport/camera.js';
import { state, curStrokes, curTool, addStroke, clone, recordUndo, curPageOffsetX } from '../state.js';
import { textHeight, editorFont, halfLeading } from '../engine/text.js';
import { render } from '../render/renderer.js';
import { clearOverlay } from '../render/overlay.js';

const DEFAULT_W = 320;
let stage, ta = null, editing = null; // editing = { idx } or null (new)
let startX = 0, startY = 0, startW = DEFAULT_W, color = '#111', size = 20;
let openedAt = 0;
let lastScale = 1; // camera scale the textarea was last laid out at

const BORDER = 1.5; // keep in sync with .text-editor border width

export function initTextEditor(stageEl) { stage = stageEl; }

export function openTextEditor(world) {
  commit(); // close any open editor first

  // edit existing text under the point?
  const strokes = curStrokes();
  let idx = -1;
  for (let i = strokes.length - 1; i >= 0; i--) {
    const s = strokes[i];
    if (s.tool !== 'text') continue;
    const h = textHeight(s.text, s.size, s.w);
    if (world.x >= s.x && world.x <= s.x + s.w && world.y >= s.y && world.y <= s.y + h) { idx = i; break; }
  }

  if (idx >= 0) {
    const s = strokes[idx];
    editing = { idx };
    startX = s.x; startY = s.y; startW = s.w; color = s.color; size = s.size;
    spawn(s.text);
  } else {
    editing = null;
    const t = curTool();
    startX = world.x; startY = world.y; startW = DEFAULT_W; color = t.color; size = t.size;
    spawn('');
  }
}

function spawn(initial) {
  ta = document.createElement('textarea');
  ta.className = 'text-editor';
  ta.value = initial;
  ta.placeholder = 'type… ($x^2$ = math)';
  const scr = worldToScreen(startX + curPageOffsetX(), startY);
  const px = size * camera.scale;
  lastScale = camera.scale;
  Object.assign(ta.style, {
    // compensate border + line-box half-leading so glyphs sit exactly where
    // the canvas painter will draw them on commit
    left: scr.x - BORDER + 'px',
    top: scr.y - BORDER - halfLeading(px) + 'px',
    width: startW * camera.scale + 'px',
    font: editorFont(px), // explicit line-height — plain shorthand resets it to 'normal'
    color,
    caretColor: color,
  });
  stage.appendChild(ta);
  openedAt = performance.now();
  autosize();
  // re-wrap height when the user drags the width handle
  let lastW = ta.getBoundingClientRect().width;
  ta._ro = new ResizeObserver((entries) => {
    const w = entries[0].contentRect.width;
    if (Math.abs(w - lastW) > 0.5) { lastW = w; autosize(); }
  });
  ta._ro.observe(ta);
  ta.addEventListener('input', autosize);
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); discard(); }                       // cancel
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commit(); } // done
  });
  ta.addEventListener('blur', onBlur);
  requestAnimationFrame(() => ta && ta.focus());
}

function autosize() {
  if (!ta) return;
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
}

// The click that spawns the editor triggers a spurious blur right after focus.
// Re-grab focus if blur fires too soon; commit only on a genuine later blur.
function onBlur() {
  if (ta && performance.now() - openedAt < 300) { ta.focus(); return; }
  commit();
}

// Re-anchor the open textarea after a camera pan/zoom (wired via pointer.js)
// — otherwise the box drifts off the page point it's editing.
export function syncTextEditor() {
  if (!ta) return;
  // preserve any drag-resize: current width back to world units at the OLD scale
  const wWorld = Math.max(40, ta.getBoundingClientRect().width / lastScale);
  const px = size * camera.scale;
  const scr = worldToScreen(startX + curPageOffsetX(), startY);
  ta.style.left = scr.x - BORDER + 'px';
  ta.style.top = scr.y - BORDER - halfLeading(px) + 'px';
  ta.style.width = wWorld * camera.scale + 'px';
  ta.style.font = editorFont(px);
  lastScale = camera.scale;
  autosize();
}

// Esc — close without writing anything (new box: dropped; existing: unchanged).
function discard() {
  if (!ta) return;
  const node = ta;
  ta = null;
  node._ro?.disconnect();
  node.removeEventListener('blur', onBlur);
  node.remove();
  editing = null;
  clearOverlay();
  render();
}

function commit() {
  if (!ta) return;
  const val = ta.value;
  const node = ta;
  // capture the (possibly drag-resized) width in world units
  const wWorld = Math.max(40, node.getBoundingClientRect().width / camera.scale);
  ta = null;
  node._ro?.disconnect();
  node.removeEventListener('blur', onBlur);
  node.remove();

  const strokes = curStrokes();
  if (editing) {
    const s = strokes[editing.idx];
    if (!s) { editing = null; return; }
    if (val === s.text && Math.abs(wWorld - s.w) < 1) { editing = null; render(); return; }
    const snap = clone(strokes);
    if (val.trim() === '') strokes.splice(editing.idx, 1);
    else { s.text = val; s.w = wWorld; }
    recordUndo(snap);
  } else if (val.trim() !== '') {
    addStroke({ tool: 'text', x: startX, y: startY, w: wWorld, text: val, size, color });
  }
  editing = null;
  clearOverlay();
  render();
}

export const isEditing = () => ta !== null;
