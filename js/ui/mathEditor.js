// Floating LaTeX editor for the math tool. Type LaTeX with a live KaTeX
// preview; on commit, MathJax renders it to a crisp SVG dropped on the page as
// a 'math' object (scalable like an image, re-editable via the latex it stores).

import { camera, worldToScreen } from '../viewport/camera.js';
import { state, curStrokes, curTool, addStroke, clone, recordUndo, curPageOffsetX } from '../state.js';
import { renderLatex } from '../quiz/katex.js';
import { renderMathToImage } from '../render/mathjax.js';
import { render } from '../render/renderer.js';
import { clearOverlay } from '../render/overlay.js';
import { strokeBBox } from '../engine/strokes.js';
import { modalAlert } from './modal.js';

let stage, box = null, editing = null, anchor = null, color = '#111', size = 30;

// Quick-insert chips — [label, snippet]; caret lands inside the first {}.
const SNIPPETS = [
  ['x²', '^{2}'], ['x₂', '_{2}'], ['√', '\\sqrt{}'], ['a/b', '\\frac{}{}'],
  ['π', '\\pi '], ['∑', '\\sum_{i=1}^{n}'], ['∫', '\\int_{a}^{b}'],
  ['≤', '\\le '], ['≠', '\\ne '], ['→', '\\to '], ['()', '\\left(\\right)'],
];

export function initMathEditor(stageEl) { stage = stageEl; }
export const isMathEditing = () => box !== null;

// Re-anchor the open editor after a camera pan/zoom (wired via pointer.js).
export function syncMathEditor() {
  if (!box || !anchor) return;
  const scr = worldToScreen(anchor.x + curPageOffsetX(), anchor.y);
  box.style.left = scr.x + 'px';
  box.style.top = scr.y + 'px';
}

export function openMathEditor(world) {
  cancel();
  const strokes = curStrokes();
  let idx = -1;
  for (let i = strokes.length - 1; i >= 0; i--) {
    const s = strokes[i];
    if (s.tool !== 'math') continue;
    const b = strokeBBox(s);
    if (world.x >= b.x1 && world.x <= b.x2 && world.y >= b.y1 && world.y <= b.y2) { idx = i; break; }
  }
  if (idx >= 0) {
    const s = strokes[idx];
    editing = { idx }; anchor = { x: s.x, y: s.y }; color = s.color; size = s.size;
    spawn(s.latex || '');
  } else {
    const t = curTool();
    editing = null; anchor = { x: world.x, y: world.y }; color = t.color; size = t.size;
    spawn('');
  }
}

function spawn(initial) {
  box = document.createElement('div');
  box.className = 'math-editor';
  const scr = worldToScreen(anchor.x + curPageOffsetX(), anchor.y);
  box.style.left = scr.x + 'px';
  box.style.top = scr.y + 'px';
  box.innerHTML = `
    <div class="math-head">
      <span class="math-title">∑ math</span>
      <span class="math-hint">Ctrl+Enter inserts · Esc cancels</span>
    </div>
    <div class="math-snips"></div>
    <textarea class="math-input" placeholder="LaTeX  e.g.  \\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}"></textarea>
    <div class="math-preview"></div>
    <div class="math-actions"><button class="math-cancel">Cancel</button><button class="math-ok">Insert</button></div>`;
  stage.appendChild(box);
  const ta = box.querySelector('.math-input');
  const prev = box.querySelector('.math-preview');
  const snips = box.querySelector('.math-snips');
  SNIPPETS.forEach(([label, snip]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'math-snip';
    b.textContent = label;
    b.title = snip.trim();
    b.addEventListener('click', () => {
      const s = ta.selectionStart, e = ta.selectionEnd;
      ta.value = ta.value.slice(0, s) + snip + ta.value.slice(e);
      const brace = snip.indexOf('{}');
      const pos = s + (brace >= 0 ? brace + 1 : snip.length);
      ta.selectionStart = ta.selectionEnd = pos;
      ta.focus();
      ta.dispatchEvent(new Event('input'));
    });
    snips.append(b);
  });
  ta.value = initial;
  if (initial) renderLatex(prev, initial);
  ta.addEventListener('input', () => { if (ta.value) renderLatex(prev, ta.value); else prev.innerHTML = ''; });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commit(); }
  });
  box.querySelector('.math-ok').addEventListener('click', commit);
  box.querySelector('.math-cancel').addEventListener('click', cancel);
  requestAnimationFrame(() => ta.focus());
}

async function commit() {
  if (!box) return;
  const ta = box.querySelector('.math-input');
  const val = ta.value.trim();
  const ed = editing, an = anchor, col = color, sz = size;
  cancel();

  const strokes = curStrokes();
  if (!val) { // empty -> delete if editing
    if (ed && strokes[ed.idx]?.tool === 'math') { const snap = clone(strokes); strokes.splice(ed.idx, 1); recordUndo(snap); }
    return;
  }
  let img;
  try { img = await renderMathToImage(val, col, sz); }
  catch (e) { modalAlert({ title: 'Math render failed', message: String(e.message || e) }); return; }

  if (ed && strokes[ed.idx]?.tool === 'math') {
    const snap = clone(strokes);
    const s = strokes[ed.idx];
    s.latex = val; s.color = col; s.src = img.src; s.w = img.w; s.h = img.h;
    recordUndo(snap);
  } else {
    addStroke({ tool: 'math', latex: val, color: col, size: sz, x: an.x, y: an.y, w: img.w, h: img.h, src: img.src });
  }
  clearOverlay();
  render();
}

function cancel() {
  if (!box) return;
  box.remove(); box = null; editing = null; anchor = null;
}
