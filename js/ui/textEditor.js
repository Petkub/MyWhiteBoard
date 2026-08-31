// Floating textarea editor for text boxes. Opens at a world point; on commit
// writes a 'text' stroke (or edits the one tapped). Positioned via the camera.

import { camera, worldToScreen } from '../viewport/camera.js';
import { state, curStrokes, curTool, addStroke, clone, recordUndo, curPageOffsetX } from '../state.js';
import { editorFont, halfLeading, autoTextWidth, hitTextLine } from '../engine/text.js';
import { clamp } from '../config.js';
import { render } from '../render/renderer.js';
import { clearOverlay } from '../render/overlay.js';

const MIN_W = 24;   // world px — enough room for a caret on an empty box
const MAX_W = 6000; // safety cap on an auto-growing single line
let stage, ta = null, editing = null; // editing = { idx } or null (new)
let startX = 0, startY = 0, startW = MIN_W, color = '#111', size = 20;
let autoW = true;        // true = box hugs its content (grows as you type, wraps only on Enter)
let settingWidth = false; // guards the ResizeObserver: true while WE are setting ta.style.width
let openedAt = 0;
let lastScale = 1; // camera scale the textarea was last laid out at

const BORDER = 1.5; // keep in sync with .text-editor border width

export function initTextEditor(stageEl) { stage = stageEl; }

export function openTextEditor(world) {
  commit(); // close any open editor first

  // Edit existing text under the point? Tight per-line hit-test — a tap in
  // the blank space past a short line (inside its box but off its glyphs)
  // starts a new box instead of reopening this one.
  const strokes = curStrokes();
  let idx = -1;
  for (let i = strokes.length - 1; i >= 0; i--) {
    const s = strokes[i];
    if (s.tool === 'text' && hitTextLine(s, world)) { idx = i; break; }
  }

  if (idx >= 0) {
    const s = strokes[idx];
    editing = { idx };
    startX = s.x; startY = s.y; startW = s.w; color = s.color; size = s.size;
    autoW = s.autoW === true;
    spawn(s.text);
  } else {
    editing = null;
    const t = curTool();
    startX = world.x; startY = world.y; startW = MIN_W; color = t.color; size = t.size;
    autoW = true; // new boxes grow with content by default — drag the handle to fix a wrap width
    spawn('');
  }
}

function measureAutoWidth(text) {
  return clamp(autoTextWidth(text, size), MIN_W, MAX_W);
}

function spawn(initial) {
  ta = document.createElement('textarea');
  ta.className = 'text-editor';
  ta.value = initial;
  ta.placeholder = 'type… ($x^2$ = math)';
  const scr = worldToScreen(startX + curPageOffsetX(), startY);
  const px = size * camera.scale;
  const w0 = autoW ? measureAutoWidth(initial) : startW;
  lastScale = camera.scale;
  Object.assign(ta.style, {
    // compensate border + line-box half-leading so glyphs sit exactly where
    // the canvas painter will draw them on commit
    left: scr.x - BORDER + 'px',
    top: scr.y - BORDER - halfLeading(px) + 'px',
    width: w0 * camera.scale + 'px',
    font: editorFont(px), // explicit line-height — plain shorthand resets it to 'normal'
    color,
    caretColor: color,
    whiteSpace: autoW ? 'pre' : 'pre-wrap', // auto: never let the browser wrap out from under our width
  });
  stage.appendChild(ta);
  openedAt = performance.now();
  settingWidth = true;
  autosize();
  // Width changes come from two sources: our own autosize() (autoW) and the
  // user dragging the native corner resize handle. The observer can't tell
  // them apart except by this flag — autosize() sets it right before it
  // touches style.width, so a callback that finds it already false is a
  // genuine user drag, which locks in a fixed wrap width from here on.
  let lastW = ta.getBoundingClientRect().width;
  ta._ro = new ResizeObserver((entries) => {
    const w = entries[0].contentRect.width;
    if (settingWidth) { settingWidth = false; lastW = w; return; }
    if (Math.abs(w - lastW) > 0.5) {
      lastW = w;
      if (autoW) { autoW = false; ta.style.whiteSpace = 'pre-wrap'; }
      autosize(); // re-wrap height at the newly fixed width
    }
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
  if (autoW) {
    settingWidth = true;
    ta.style.width = measureAutoWidth(ta.value) * camera.scale + 'px';
  }
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
  const px = size * camera.scale;
  const scr = worldToScreen(startX + curPageOffsetX(), startY);
  ta.style.left = scr.x - BORDER + 'px';
  ta.style.top = scr.y - BORDER - halfLeading(px) + 'px';
  ta.style.font = editorFont(px);
  if (!autoW) {
    // fixed width: preserve the drag-resized width in world units across the zoom change
    const wWorld = Math.max(MIN_W, ta.getBoundingClientRect().width / lastScale);
    settingWidth = true;
    ta.style.width = wWorld * camera.scale + 'px';
  }
  lastScale = camera.scale;
  autosize(); // autoW: recomputes width too; either way, rewraps height at the new font px
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
  const finalAutoW = autoW;
  // capture the (possibly drag-resized, or auto-fit) width in world units
  const wWorld = Math.max(MIN_W, node.getBoundingClientRect().width / camera.scale);
  ta = null;
  node._ro?.disconnect();
  node.removeEventListener('blur', onBlur);
  node.remove();

  const strokes = curStrokes();
  if (editing) {
    const s = strokes[editing.idx];
    if (!s) { editing = null; return; }
    if (val === s.text && Math.abs(wWorld - s.w) < 1 && !!s.autoW === finalAutoW) { editing = null; render(); return; }
    const snap = clone(strokes);
    if (val.trim() === '') strokes.splice(editing.idx, 1);
    else { s.text = val; s.w = wWorld; s.autoW = finalAutoW; }
    recordUndo(snap);
  } else if (val.trim() !== '') {
    addStroke({ tool: 'text', x: startX, y: startY, w: wWorld, text: val, size, color, autoW: finalAutoW });
  }
  editing = null;
  clearOverlay();
  render();
}

export const isEditing = () => ta !== null;
