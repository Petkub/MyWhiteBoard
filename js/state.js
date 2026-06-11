// App state — notebook (pages of strokes), active tool, per-page undo/redo.
// Mutations route through helpers so render + autosave fire consistently.

import { TOOL_DEFAULTS, clamp, PAGE_W } from './config.js';

export const clone = (o) => JSON.parse(JSON.stringify(o));

// Per-tool user preferences persisted to localStorage. Only these fields are
// saved/restored — min/max/step/stabilize etc. always come from TOOL_DEFAULTS
// so tuning defaults later isn't masked by stale saved values.
const PREF_KEY = 'wb-tools';
const PREF_FIELDS = ['color', 'size', 'style', 'taper', 'kind', 'filled',
  'cols', 'rows', 'arrowStart', 'arrowEnd', 'arrowSize', 'char'];

function loadToolPrefs(tools) {
  try {
    const saved = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
    for (const [name, t] of Object.entries(tools)) {
      const s = saved[name];
      if (!s) continue;
      for (const k of PREF_FIELDS) if (k in s && k in t && t[k] !== null) t[k] = s[k];
      if ('size' in t && t.min != null) t.size = clamp(t.size, t.min, t.max);
    }
  } catch { /* corrupt prefs — fall back to defaults */ }
  return tools;
}

export function saveToolPrefs() {
  const out = {};
  for (const [name, t] of Object.entries(state.tools)) {
    const o = {};
    for (const k of PREF_FIELDS) if (k in t && t[k] !== null) o[k] = t[k];
    out[name] = o;
  }
  try { localStorage.setItem(PREF_KEY, JSON.stringify(out)); } catch { /* quota — skip */ }
}

const SPREAD_KEY = 'wb-spread';

export const state = {
  tool: 'pen',
  tools: loadToolPrefs(clone(TOOL_DEFAULTS)),
  spread: localStorage.getItem(SPREAD_KEY) === '1', // two-page book view
  // open notebook metadata
  notebookId: null,
  title: 'Untitled',
  tags: [],
  folderId: null,
  created: 0,
  // open notebook content
  pages: [{ bg: 'grid', strokes: [] }],
  current: 0,
  selected: new Set(),
  undo: {},   // undo[pageIdx] = [snapshot,...]
  redo: {},   // redo[pageIdx] = [snapshot,...]
  // wired by main.js:
  onMutate: () => {},   // -> render + schedule autosave
  onPageChange: () => {},
  onPageQuiet: () => {}, // page switch within a spread (no camera reset)
};

// ---------------------------------------------------------------- spread view
// Two-page "book" mode: pages are shown in fixed pairs (even index on the
// left, odd on the right). The active page keeps page-local coordinates;
// the right page is rendered translated by PAGE_W + SPREAD_GAP.
export const SPREAD_GAP = 24;

export function toggleSpread() {
  state.spread = !state.spread;
  try { localStorage.setItem(SPREAD_KEY, state.spread ? '1' : '0'); } catch { /* quota */ }
}

// Visible pair as [leftIdx, rightIdx|null]; single mode -> [current, null].
export function spreadPages() {
  if (!state.spread) return [state.current, null];
  const left = state.current - (state.current % 2);
  return [left, left + 1 < state.pages.length ? left + 1 : null];
}

// World-x offset of the ACTIVE page (0 = left/single, PAGE_W+gap = right).
export function curPageOffsetX() {
  return (state.spread && state.current % 2) ? PAGE_W + SPREAD_GAP : 0;
}

// Total world width of the visible page layout (camera fit/centering).
export function spreadWorldWidth() {
  return state.spread ? PAGE_W * 2 + SPREAD_GAP : PAGE_W;
}

// Fixed height bound for the visible pages: max of the pair, or null
// (infinite) if any visible page is infinite.
export function spreadPh() {
  const [l, r] = spreadPages();
  const lp = state.pages[l]?.ph || null;
  if (r === null) return lp;
  const rp = state.pages[r]?.ph || null;
  return (lp && rp) ? Math.max(lp, rp) : null;
}

// Page navigation that respects the book metaphor: single mode steps one
// page, spread mode flips to the previous/next pair.
export function flipPage(dir) {
  if (!state.spread) { goToPage(state.current + dir); return; }
  const li = state.current - (state.current % 2);
  const target = li + dir * 2;
  if (target >= 0 && target < state.pages.length) goToPage(target);
}

// Switch the active page within the visible spread — no camera reset.
export function setPageQuiet(i) {
  if (i === state.current || i < 0 || i >= state.pages.length) return;
  state.current = i;
  state.selected.clear();
  state.onPageQuiet();
}

// Load a notebook record into the live editor state.
export function loadInto(nb) {
  state.notebookId = nb.id;
  state.title = nb.title || 'Untitled';
  state.tags = nb.tags || [];
  state.folderId = nb.folderId ?? null;
  state.created = nb.created || Date.now();
  state.pages = nb.pages?.length ? nb.pages : [{ bg: 'grid', strokes: [] }];
  state.current = Math.min(nb.current || 0, state.pages.length - 1);
  state.selected.clear();
  state.undo = {}; state.redo = {};
}

// Serialize the open editor state back to a notebook record.
export function toRecord() {
  return {
    id: state.notebookId,
    title: state.title,
    folderId: state.folderId,
    tags: state.tags,
    created: state.created,
    pages: state.pages,
    current: state.current,
  };
}

export const curTool = () => state.tools[state.tool];
export const curPage = () => state.pages[state.current];
export const curStrokes = () => curPage().strokes;

function snapshot() {
  const i = state.current;
  (state.undo[i] ??= []).push(clone(curStrokes()));
  if (state.undo[i].length > 200) state.undo[i].shift();
  state.redo[i] = [];
}

// Run a mutation with undo capture + change notification.
export function mutate(fn) {
  snapshot();
  fn();
  state.onMutate();
}

export function addStroke(s) {
  mutate(() => curStrokes().push(s));
}

// For mutations done in-place outside mutate() (erase, drag-move): pass the
// pre-mutation snapshot so undo can restore it.
export function recordUndo(prevStrokes) {
  const i = state.current;
  (state.undo[i] ??= []).push(prevStrokes);
  if (state.undo[i].length > 200) state.undo[i].shift();
  state.redo[i] = [];
  state.onMutate();
}

export function undoAction() {
  const i = state.current;
  const u = state.undo[i];
  if (!u || !u.length) return;
  (state.redo[i] ??= []).push(JSON.parse(JSON.stringify(curStrokes())));
  curPage().strokes = u.pop();
  state.selected.clear();
  state.onMutate();
}

export function redoAction() {
  const i = state.current;
  const r = state.redo[i];
  if (!r || !r.length) return;
  (state.undo[i] ??= []).push(JSON.parse(JSON.stringify(curStrokes())));
  curPage().strokes = r.pop();
  state.selected.clear();
  state.onMutate();
}

export function deleteSelected() {
  if (!state.selected.size) return;
  const ss = curStrokes();
  const idxs = [...state.selected].filter((i) => ss[i] && !ss[i].locked).sort((a, b) => b - a);
  state.selected.clear();
  if (!idxs.length) return;
  mutate(() => { for (const i of idxs) curStrokes().splice(i, 1); });
}

// Lock selection if any is unlocked, else unlock all. Locked strokes can't be
// moved, erased, or deleted.
export function toggleLockSelection() {
  if (!state.selected.size) return;
  const ss = curStrokes();
  const lock = [...state.selected].some((i) => ss[i] && !ss[i].locked);
  mutate(() => { for (const i of state.selected) if (ss[i]) ss[i].locked = lock; });
}

export function setTool(t) {
  if (t === state.tool) return;
  state.tool = t;
  state.selected.clear();
}

export function setColor(c) {
  const tool = curTool();
  if ('color' in tool && tool.color !== null) { tool.color = c; saveToolPrefs(); }
}

export function setSize(v) {
  const tool = curTool();
  if ('size' in tool) { tool.size = v; saveToolPrefs(); }
}

// Wipe every stroke on the current page (undoable).
export function clearPage() {
  if (!curStrokes().length) return;
  state.selected.clear();
  mutate(() => { curStrokes().length = 0; });
}

export function setBackground(bg) {
  curPage().bg = bg;
  state.onMutate();
}

// Fixed page height in world px (e.g. 1123 = A4 portrait), or null = infinite.
export function setPageHeight(ph) {
  curPage().ph = ph || null;
  state.onMutate();
}

export function goToPage(i) {
  if (i < 0 || i >= state.pages.length) return;
  state.current = i;
  state.selected.clear();
  state.onPageChange();
}

export function addPage(after = state.current) {
  state.pages.splice(after + 1, 0, { bg: curPage().bg, ph: curPage().ph || null, strokes: [] });
  goToPage(after + 1);
}

// Remove a page. The last remaining page is replaced by a blank one instead.
// Per-page undo/redo stacks are index-keyed, so they reset (like page imports,
// page removal itself is not undoable).
export function removePage(i = state.current) {
  if (i < 0 || i >= state.pages.length) return;
  if (state.pages.length === 1) {
    const p = state.pages[0];
    state.pages[0] = { bg: p.bg, ph: p.ph || null, strokes: [] };
  } else {
    state.pages.splice(i, 1);
    if (state.current > i) state.current -= 1;
    state.current = Math.min(state.current, state.pages.length - 1);
  }
  state.undo = {}; state.redo = {};
  state.selected.clear();
  state.onPageChange();
  state.onMutate(); // schedule autosave
}

// Bookmark flag on a page — persists with the notebook record.
export function toggleBookmark(i = state.current) {
  const p = state.pages[i];
  if (!p) return;
  p.bookmark = !p.bookmark;
  state.onMutate();
}

// Insert one or more prebuilt pages after the current page (PDF/image import).
export function addPagesAfterCurrent(newPages) {
  if (!newPages.length) return;
  state.pages.splice(state.current + 1, 0, ...newPages);
  goToPage(state.current + 1);
  state.onMutate();
}
