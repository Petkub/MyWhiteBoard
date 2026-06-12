// Toolbar UI — core drawing controls stay on the bar; secondary controls
// (title, background, insert, export, library) live in a ☰ dropdown so the bar
// never overflows. Pure DOM; styled by css/app.css (mySlideMaker identity).

import { COLORS, SHAPES, BACKGROUNDS, EMOJIS } from '../config.js';
import {
  state, curTool, setTool, setColor, setSize, setBackground, setPageHeight,
  undoAction, redoAction, flipPage, addPage, removePage, clearPage, curPage, toRecord,
  toggleLockSelection, saveToolPrefs, toggleSpread, toggleBookmark,
} from '../state.js';
import { togglePagesPanel, refreshPagesPanel } from './pagesPanel.js';
import { goLibrary } from '../router.js';
import { panBy, fitWidth, resetTop } from '../viewport/camera.js';
import { render, viewport } from '../render/renderer.js';
import { clearOverlay } from '../render/overlay.js';
import { flush as flushSave } from '../store/autosave.js';
import { exportPagePNG } from '../export/png.js';
import { exportNotebookPDF } from '../export/pdf.js';
import { exportNotebookJSON } from '../export/json.js';
import { insertImageFile, insertImageSrc } from './insert.js';
import { allImagesDb, deleteImageDb } from '../store/db.js';
import { importFileAsPages } from '../import/pageImport.js';
import { refreshCursor } from '../input/pointer.js';
import { modalAlert, modalConfirm } from './modal.js';
import { updateTabTitle } from './tabs.js';
import { toggleTheme, themeLabel } from './theme.js';

// Lucide-style stroke icons (inline SVG, no dependency).
const svg = (paths) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

const ICONS = {
  pen: svg('<path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/>'),
  highlighter: svg('<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>'),
  eraser: svg('<path d="m7 21-4.3-4.3a2 2 0 0 1 0-2.8l9.6-9.6a2 2 0 0 1 2.8 0l5.6 5.6a2 2 0 0 1 0 2.8L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>'),
  shape: svg('<rect x="3" y="3" width="8" height="8" rx="1"/><circle cx="17.5" cy="6.5" r="3.5"/><path d="M6.5 13 3 21h7z"/><path d="M14 14h7v7h-7z"/>'),
  text: svg('<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>'),
  select: svg('<path d="M4 4l7.5 16 2.2-6.3L20 11.5z"/>'),
  lasso: svg('<path d="M7 22a5 5 0 0 1-2-4"/><path d="M7 16.9c1 .4 2 .7 3 .9"/><path d="M3.3 14A6.8 6.8 0 0 1 2 10c0-4.4 4.5-8 10-8s10 3.6 10 8-4.5 8-10 8c-1 0-2 0-3-.3"/><circle cx="5" cy="16" r="2"/>'),
  hand: svg('<path d="M18 11V6a2 2 0 0 0-4 0"/><path d="M14 10V4a2 2 0 0 0-4 0v2"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.3l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15"/>'),
  emoji: svg('<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>'),
  math: svg('<path d="M18 7V5a1 1 0 0 0-1-1H6.5a.5.5 0 0 0-.4.8l4.5 6.2a1 1 0 0 1 0 1.2l-4.5 6.2a.5.5 0 0 0 .4.8H17a1 1 0 0 0 1-1v-2"/>'),
};

const LOCK_ICON = svg('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>');
const MENU_ICON = svg('<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/>');
const UNDO_ICON = svg('<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>');
const REDO_ICON = svg('<path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"/>');
const BOOK_ICON = svg('<path d="M2 4h6a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H2z"/><path d="M22 4h-6a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h7z"/>');
const PAGES_ICON = svg('<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/><rect x="14" y="16" width="7" height="5" rx="1"/>');

const TOOLS = [
  ['pen', 'Pen (P)'],
  ['highlighter', 'Highlighter (M)'],
  ['eraser', 'Eraser (E)'],
  ['shape', 'Shape (S)'],
  ['text', 'Text (T)'],
  ['math', 'Math / LaTeX'],
  ['select', 'Select (V)'],
  ['lasso', 'Lasso (L)'],
  ['hand', 'Pan (H)'],
];

let root, refs = {};

// User-added swatches, persisted across sessions. Added/removed via the
// color popover (+ swatch); the fixed COLORS palette can't be removed.
const CUSTOM_KEY = 'wb-custom-colors';
const MAX_CUSTOM = 8;
let customColors = [];
try { customColors = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]'); } catch { /* defaults */ }
if (!Array.isArray(customColors)) customColors = [];

function saveCustomColors() {
  try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(customColors)); } catch { /* quota — skip */ }
}

function renderSwatches() {
  refs.colors.innerHTML = '';
  [...COLORS, ...customColors].forEach((c) => {
    const b = document.createElement('button');
    b.className = 'tb-swatch';
    b.dataset.color = c;
    b.style.background = c;
    b.title = c;
    b.addEventListener('click', () => { setColor(c); syncColors(); });
    refs.colors.appendChild(b);
  });
  const add = document.createElement('button');
  add.className = 'tb-swatch tb-swatch-add';
  add.title = 'Add / manage colors';
  add.textContent = '+';
  add.addEventListener('click', (e) => { e.stopPropagation(); toggleColorPop(); });
  refs.colors.appendChild(add);
}

// ---- color popover (add / remove custom swatches) ----
const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const normHex = (h) => {
  h = h.trim().toLowerCase();
  if (!h.startsWith('#')) h = '#' + h;
  if (!HEX_RE.test(h)) return null;
  if (h.length === 4) h = '#' + [...h.slice(1)].map((ch) => ch + ch).join('');
  return h;
};

// ---- image collection popover (re-insert / remove saved images) ----
function toggleImagePop() { refs.imgPop.hidden ? openImagePop() : (refs.imgPop.hidden = true); }

async function openImagePop() {
  refs.imgPop.hidden = false;
  const grid = refs.ilGrid;
  grid.innerHTML = '';
  let imgs = [];
  try { imgs = (await allImagesDb()).sort((a, b) => (b.created || 0) - (a.created || 0)); } catch { /* db */ }
  refs.ilCount.textContent = String(imgs.length);
  if (!imgs.length) {
    const hint = document.createElement('span');
    hint.className = 'tb-cp-hint';
    hint.textContent = 'images you insert appear here';
    grid.appendChild(hint);
    return;
  }
  for (const r of imgs) {
    const item = document.createElement('span');
    item.className = 'tb-il-item';
    const b = document.createElement('button');
    b.className = 'tb-il-thumb';
    b.title = 'Insert on this page';
    const im = document.createElement('img');
    im.src = r.src;
    im.loading = 'lazy';
    b.appendChild(im);
    b.addEventListener('click', async () => {
      refs.imgPop.hidden = true;
      closeMenu();
      try { await insertImageSrc(r.src); }
      catch (err) { modalAlert({ title: 'Insert failed', message: err.message }); }
    });
    const x = document.createElement('button');
    x.className = 'tb-cp-x';
    x.title = 'Remove from collection';
    x.textContent = '✕';
    x.addEventListener('click', async (e) => {
      e.stopPropagation();
      try { await deleteImageDb(r.id); } catch { /* db */ }
      openImagePop(); // rebuild
    });
    item.append(b, x);
    grid.appendChild(item);
  }
}

function toggleColorPop() { refs.colorPop.hidden ? openColorPop() : closeColorPop(); }
function closeColorPop() { refs.colorPop.hidden = true; }
function openColorPop() {
  const c = normHex(curTool().color || '') || '#1d3fb6';
  refs.cpWell.value = c;
  refs.cpHex.value = c;
  refs.colorPop.hidden = false;
  syncColorPop();
}

function addCustomColor() {
  const c = normHex(refs.cpHex.value) || refs.cpWell.value;
  if (!c) return;
  if (!COLORS.includes(c) && !customColors.includes(c)) {
    customColors = [c, ...customColors].slice(0, MAX_CUSTOM);
    saveCustomColors();
    renderSwatches();
  }
  setColor(c);
  syncColors();
  syncColorPop();
}

function removeCustomColor(c) {
  customColors = customColors.filter((x) => x !== c);
  saveCustomColors();
  renderSwatches();
  syncColors();
  syncColorPop();
}

// Rebuild the "your colors" grid inside the popover.
function syncColorPop() {
  if (refs.colorPop.hidden) return;
  const grid = refs.cpGrid;
  grid.innerHTML = '';
  if (!customColors.length) {
    const hint = document.createElement('span');
    hint.className = 'tb-cp-hint';
    hint.textContent = 'no custom colors yet';
    grid.appendChild(hint);
  }
  customColors.forEach((c) => {
    const item = document.createElement('span');
    item.className = 'tb-cp-item';
    const b = document.createElement('button');
    b.className = 'tb-swatch';
    b.style.background = c;
    b.title = c;
    b.classList.toggle('active', curTool().color === c);
    b.addEventListener('click', () => { setColor(c); syncColors(); syncColorPop(); });
    const x = document.createElement('button');
    x.className = 'tb-cp-x';
    x.title = `Remove ${c}`;
    x.textContent = '✕';
    x.addEventListener('click', () => removeCustomColor(c));
    item.append(b, x);
    grid.appendChild(item);
  });
  refs.cpCount.textContent = `${customColors.length} / ${MAX_CUSTOM}`;
}

export function buildToolbar(mount) {
  root = document.createElement('div');
  root.className = 'tb';
  root.innerHTML = `
    <button class="tb-burger" title="Menu">☰</button>
    <div class="tb-sep"></div>
    <div class="tb-group">
      <button class="tb-chip tb-undo" title="Undo (Ctrl+Z)">undo</button>
      <button class="tb-chip tb-redo" title="Redo (Ctrl+Shift+Z)">redo</button>
    </div>
    <div class="tb-spacer"></div>
    <div class="tb-group tb-tools"></div>
    <div class="tb-sep"></div>
    <div class="tb-group tb-colors"></div>
    <div class="tb-sep"></div>
    <span class="tb-size">size
      <input type="range" class="tb-size-r" min="1" max="40" step="1">
      <span class="tb-size-val">3</span>
    </span>
    <div class="tb-spacer"></div>
    <div class="tb-group tb-pages">
      <button class="tb-chip tb-prev" title="Prev page (←)">‹</button>
      <button class="tb-chip tb-pages-btn" title="All pages">${PAGES_ICON}<span class="tb-page-counter">1 / 1</span></button>
      <button class="tb-chip tb-next" title="Next page (→)">›</button>
      <button class="tb-chip tb-addpage" title="Add page">+ page</button>
      <button class="tb-chip tb-bookmark" title="Bookmark this page">⚑</button>
      <button class="tb-chip tb-spread" title="Two-page view (book)">${BOOK_ICON}</button>
    </div>
    <span class="tb-status">saved</span>

    <div class="tb-sub" hidden>
      <span class="tb-sub-label"></span>
      <div class="tb-group tb-penstyle">
        <button data-style="fountain" class="tb-chip">fountain</button>
        <button data-style="ballpoint" class="tb-chip">ballpoint</button>
      </div>
      <div class="tb-group tb-shapes"></div>
      <div class="tb-group tb-shapeopts">
        <button class="tb-chip tb-fill" title="Fill shape">fill</button>
        <span class="tb-step tb-cols">cols
          <button class="tb-step-b" data-dim="cols" data-d="-1">−</button>
          <span class="tb-cols-v">4</span>
          <button class="tb-step-b" data-dim="cols" data-d="1">+</button></span>
        <span class="tb-step tb-rows">rows
          <button class="tb-step-b" data-dim="rows" data-d="-1">−</button>
          <span class="tb-rows-v">4</span>
          <button class="tb-step-b" data-dim="rows" data-d="1">+</button></span>
        <button class="tb-chip tb-arrow-start" title="Arrowhead at start">◂ start</button>
        <button class="tb-chip tb-arrow-end" title="Arrowhead at end">end ▸</button>
        <span class="tb-step tb-arrowsize">head
          <button class="tb-step-b" data-arrow="-2" data-d="-1">−</button>
          <span class="tb-arrowsize-v">14</span>
          <button class="tb-step-b" data-arrow="2" data-d="1">+</button></span>
      </div>
      <div class="tb-group tb-selectopts">
        <button class="tb-chip tb-lock" title="Lock / unlock selection">🔒 lock</button>
      </div>
      <div class="tb-group tb-emojiopts"></div>
    </div>

    <div class="tb-menu" hidden>
      <div class="tb-mtop">
        <button class="tb-mitem tb-lib">☰ Library</button>
        <button class="tb-mitem tb-theme"></button>
      </div>
      <div class="tb-msec">notebook</div>
      <div class="tb-mrow"><span class="tb-mlabel">title</span>
        <input type="text" class="tb-title" placeholder="Untitled"></div>
      <div class="tb-mrow"><span class="tb-mlabel">paper</span>
        <div class="tb-bgpick">${BACKGROUNDS.map((b) => `<button class="tb-bgtile" data-bg="${b}" title="${b}"></button>`).join('')}</div></div>
      <div class="tb-mrow"><span class="tb-mlabel">size</span>
        <div class="tb-sizepick">
          <button class="tb-chip" data-ph="0" title="Endless vertical page">∞ scroll</button>
          <button class="tb-chip" data-ph="1123" title="A4 portrait">A4</button>
          <button class="tb-chip" data-ph="794" title="Square">1:1</button>
          <button class="tb-chip" data-ph="447" title="Slide / widescreen">16:9</button>
        </div></div>
      <div class="tb-msec">insert</div>
      <div class="tb-mrow">
        <button class="tb-chip tb-img">image</button>
        <button class="tb-chip tb-imglib">🖼 collection</button>
        <button class="tb-chip tb-importpage">PDF / image pages</button></div>
      <div class="tb-msec">export</div>
      <div class="tb-mrow">
        <button class="tb-chip tb-png">PNG</button>
        <button class="tb-chip tb-pdf">PDF</button>
        <button class="tb-chip tb-json">JSON</button></div>
      <div class="tb-msec">page</div>
      <div class="tb-mrow">
        <button class="tb-chip tb-clear danger" title="Clear this page">✕ clear page</button>
        <button class="tb-chip tb-delpage danger" title="Delete this page">🗑 delete page</button></div>
      <input type="file" class="tb-imgfile" accept="image/*" hidden>
      <input type="file" class="tb-pagefile" accept="application/pdf,image/*" hidden>
    </div>

    <div class="tb-imgpop" hidden>
      <div class="tb-cp-head">
        <span class="tb-cp-title">image collection</span>
        <span class="tb-cp-count tb-il-count"></span>
        <button class="tb-cp-close tb-il-close" title="Close">✕</button>
      </div>
      <div class="tb-il-grid"></div>
    </div>

    <div class="tb-colorpop" hidden>
      <div class="tb-cp-head">
        <span class="tb-cp-title">custom colors</span>
        <span class="tb-cp-count"></span>
        <button class="tb-cp-close" title="Close">✕</button>
      </div>
      <div class="tb-cp-pick">
        <input type="color" class="tb-cp-well" title="Pick a color">
        <input type="text" class="tb-cp-hex" maxlength="7" spellcheck="false" placeholder="#1d3fb6">
        <button class="tb-chip tb-cp-add">+ add</button>
      </div>
      <div class="tb-cp-grid"></div>
    </div>
  `;
  mount.appendChild(root);

  refs = {
    burger: root.querySelector('.tb-burger'),
    menu: root.querySelector('.tb-menu'),
    sub: root.querySelector('.tb-sub'),
    subLabel: root.querySelector('.tb-sub-label'),
    title: root.querySelector('.tb-title'),
    tools: root.querySelector('.tb-tools'),
    colors: root.querySelector('.tb-colors'),
    imgPop: root.querySelector('.tb-imgpop'),
    ilGrid: root.querySelector('.tb-il-grid'),
    ilCount: root.querySelector('.tb-il-count'),
    colorPop: root.querySelector('.tb-colorpop'),
    cpWell: root.querySelector('.tb-cp-well'),
    cpHex: root.querySelector('.tb-cp-hex'),
    cpGrid: root.querySelector('.tb-cp-grid'),
    cpCount: root.querySelector('.tb-cp-count'),
    sizeBox: root.querySelector('.tb-size'),
    sizeR: root.querySelector('.tb-size-r'),
    sizeVal: root.querySelector('.tb-size-val'),
    penstyle: root.querySelector('.tb-penstyle'),
    shapes: root.querySelector('.tb-shapes'),
    selectopts: root.querySelector('.tb-selectopts'),
    emojiopts: root.querySelector('.tb-emojiopts'),
    shapeopts: root.querySelector('.tb-shapeopts'),
    fill: root.querySelector('.tb-fill'),
    colsBox: root.querySelector('.tb-cols'),
    rowsBox: root.querySelector('.tb-rows'),
    colsV: root.querySelector('.tb-cols-v'),
    rowsV: root.querySelector('.tb-rows-v'),
    arrowStart: root.querySelector('.tb-arrow-start'),
    arrowEnd: root.querySelector('.tb-arrow-end'),
    arrowSizeBox: root.querySelector('.tb-arrowsize'),
    arrowSizeV: root.querySelector('.tb-arrowsize-v'),
    bgPick: root.querySelector('.tb-bgpick'),
    sizePick: root.querySelector('.tb-sizepick'),
    counter: root.querySelector('.tb-page-counter'),
    bookmark: root.querySelector('.tb-bookmark'),
    status: root.querySelector('.tb-status'),
  };

  refs.burger.innerHTML = MENU_ICON;
  root.querySelector('.tb-lock').innerHTML = `${LOCK_ICON}<span>lock</span>`;
  root.querySelector('.tb-undo').innerHTML = UNDO_ICON;
  root.querySelector('.tb-redo').innerHTML = REDO_ICON;

  TOOLS.forEach(([id, title]) => {
    const b = document.createElement('button');
    b.className = 'tb-tool';
    b.dataset.tool = id;
    b.title = title;
    b.innerHTML = ICONS[id];
    b.addEventListener('click', () => { setTool(id); syncTool(); });
    refs.tools.appendChild(b);
  });

  renderSwatches();
  // color popover: well <-> hex stay in sync; Enter or "+ add" commits
  refs.colorPop.addEventListener('click', (e) => e.stopPropagation());
  refs.cpWell.addEventListener('input', () => { refs.cpHex.value = refs.cpWell.value; });
  refs.cpHex.addEventListener('input', () => {
    const c = normHex(refs.cpHex.value);
    if (c) refs.cpWell.value = c;
  });
  refs.cpHex.addEventListener('keydown', (e) => { if (e.key === 'Enter') addCustomColor(); });
  root.querySelector('.tb-cp-add').addEventListener('click', addCustomColor);
  root.querySelector('.tb-cp-close').addEventListener('click', closeColorPop);
  document.addEventListener('click', (e) => {
    if (!refs.colorPop.hidden && !refs.colorPop.contains(e.target)) closeColorPop();
  });

  SHAPES.forEach((k) => {
    const b = document.createElement('button');
    b.className = 'tb-chip tb-shape';
    b.dataset.kind = k;
    b.textContent = k;
    b.addEventListener('click', () => { curTool().kind = k; saveToolPrefs(); syncShapes(); });
    refs.shapes.appendChild(b);
  });

  EMOJIS.forEach((ch) => {
    const b = document.createElement('button');
    b.className = 'tb-emoji';
    b.dataset.char = ch;
    b.textContent = ch;
    b.addEventListener('click', () => { state.tools.emoji.char = ch; saveToolPrefs(); syncEmoji(); });
    refs.emojiopts.appendChild(b);
  });

  refs.sizeR.addEventListener('input', () => {
    const t = curTool();
    if (!('size' in t)) return;
    const v = Number(refs.sizeR.value);
    setSize(v);
    refs.sizeVal.textContent = v;
    refreshCursor();
  });
  refs.penstyle.querySelectorAll('[data-style]').forEach((b) =>
    b.addEventListener('click', () => { curTool().style = b.dataset.style; saveToolPrefs(); syncPenStyle(); }));

  refs.fill.addEventListener('click', () => { const t = curTool(); t.filled = !t.filled; saveToolPrefs(); syncShapeOpts(); });
  refs.shapeopts.querySelectorAll('.tb-step-b[data-dim]').forEach((b) =>
    b.addEventListener('click', () => {
      const t = curTool();
      const dim = b.dataset.dim;
      t[dim] = Math.max(1, Math.min(20, (t[dim] || 4) + Number(b.dataset.d)));
      saveToolPrefs();
      syncShapeOpts();
    }));
  refs.arrowStart.addEventListener('click', () => { const t = curTool(); t.arrowStart = !t.arrowStart; saveToolPrefs(); syncShapeOpts(); });
  refs.arrowEnd.addEventListener('click', () => { const t = curTool(); t.arrowEnd = !t.arrowEnd; saveToolPrefs(); syncShapeOpts(); });
  refs.shapeopts.querySelectorAll('.tb-step-b[data-arrow]').forEach((b) =>
    b.addEventListener('click', () => {
      const t = curTool();
      t.arrowSize = Math.max(6, Math.min(40, (t.arrowSize || 14) + Number(b.dataset.arrow)));
      saveToolPrefs();
      syncShapeOpts();
    }));
  refs.bgPick.querySelectorAll('.tb-bgtile').forEach((b) =>
    b.addEventListener('click', () => { setBackground(b.dataset.bg); syncPages(); }));
  refs.sizePick.querySelectorAll('[data-ph]').forEach((b) =>
    b.addEventListener('click', () => {
      setPageHeight(Number(b.dataset.ph));
      panBy(0, 0);        // re-clamp camera if we're now past the page bottom
      state.onMutate();
      syncPages();
    }));
  root.querySelector('.tb-lock').addEventListener('click', toggleLockSelection);
  root.querySelector('.tb-undo').addEventListener('click', undoAction);
  root.querySelector('.tb-redo').addEventListener('click', redoAction);
  root.querySelector('.tb-prev').addEventListener('click', () => flipPage(-1));
  root.querySelector('.tb-next').addEventListener('click', () => flipPage(1));
  root.querySelector('.tb-addpage').addEventListener('click', () => addPage());
  root.querySelector('.tb-pages-btn').addEventListener('click', (e) => { e.stopPropagation(); togglePagesPanel(); });
  refs.bookmark.addEventListener('click', () => { toggleBookmark(); syncPages(); });
  const spreadBtn = root.querySelector('.tb-spread');
  spreadBtn.classList.toggle('active', state.spread);
  spreadBtn.addEventListener('click', () => {
    toggleSpread();
    spreadBtn.classList.toggle('active', state.spread);
    const vw = viewport().vw;
    fitWidth(vw); resetTop(vw);
    render(); clearOverlay(); syncPages();
  });
  root.querySelector('.tb-clear').addEventListener('click', async () => {
    closeMenu();
    if (await modalConfirm({ title: 'Clear page', message: 'Erase everything on this page? (undoable with Ctrl+Z)', confirmText: 'Clear', danger: true })) clearPage();
  });
  root.querySelector('.tb-delpage').addEventListener('click', async () => {
    closeMenu();
    const p = curPage();
    const hasInk = p.strokes.length > 0 || p.bgImage;
    if (!hasInk || await modalConfirm({ title: 'Delete page', message: `Delete page ${state.current + 1}? Its ink is lost (not undoable).`, confirmText: 'Delete', danger: true })) removePage();
  });

  // ---- menu ----
  refs.burger.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(); });
  document.addEventListener('click', (e) => {
    if (!refs.menu.hidden && !refs.menu.contains(e.target) && !refs.burger.contains(e.target)) closeMenu();
  });
  refs.menu.addEventListener('click', (e) => e.stopPropagation());

  refs.title.addEventListener('input', (e) => { state.title = e.target.value; updateTabTitle(state.notebookId, e.target.value); state.onMutate(); });
  root.querySelector('.tb-lib').addEventListener('click', async () => { closeMenu(); await flushSave(); goLibrary(); });
  const themeBtn = root.querySelector('.tb-theme');
  themeBtn.textContent = themeLabel();
  themeBtn.addEventListener('click', () => { toggleTheme(); themeBtn.textContent = themeLabel(); });
  root.querySelector('.tb-png').addEventListener('click', () => exportPagePNG(curPage(), state.title, state.current + 1));
  root.querySelector('.tb-pdf').addEventListener('click', () => exportNotebookPDF(state.pages, state.title, (s) => { refs.status.textContent = s; }));
  root.querySelector('.tb-json').addEventListener('click', () => exportNotebookJSON(toRecord()));

  const imgFile = root.querySelector('.tb-imgfile');
  const pageFile = root.querySelector('.tb-pagefile');
  root.querySelector('.tb-img').addEventListener('click', () => imgFile.click());
  root.querySelector('.tb-imglib').addEventListener('click', (e) => { e.stopPropagation(); closeMenu(); toggleImagePop(); });
  root.querySelector('.tb-il-close').addEventListener('click', () => { refs.imgPop.hidden = true; });
  refs.imgPop.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', (e) => {
    if (!refs.imgPop.hidden && !refs.imgPop.contains(e.target)) refs.imgPop.hidden = true;
  });
  root.querySelector('.tb-importpage').addEventListener('click', () => pageFile.click());
  imgFile.addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = ''; closeMenu();
    if (f) { try { await insertImageFile(f); } catch (err) { modalAlert({ title: 'Insert failed', message: err.message }); } }
  });
  pageFile.addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = ''; closeMenu();
    if (f) { try { await importFileAsPages(f, (s) => { refs.status.textContent = s; }); } catch (err) { modalAlert({ title: 'Import failed', message: err.message }); } }
  });

  syncAll();

  // Reparent dropdown + contextual sub-bar out of the horizontally-scrolling .tb
  // so they aren't clipped. Done LAST: all root.querySelector wiring above needs
  // them still inside root.
  mount.appendChild(refs.sub);
  mount.appendChild(refs.menu);
  mount.appendChild(refs.colorPop);
  mount.appendChild(refs.imgPop);
}

function toggleMenu() { refs.menu.hidden ? openMenu() : closeMenu(); }
function openMenu() { refs.menu.hidden = false; refs.burger.classList.add('active'); }
function closeMenu() { refs.menu.hidden = true; refs.burger.classList.remove('active'); }

export function statusEl() { return refs.status; }

export function syncAll() { syncTool(); syncColors(); syncPages(); }

function syncTool() {
  refs.tools.querySelectorAll('.tb-tool').forEach((b) =>
    b.classList.toggle('active', b.dataset.tool === state.tool));
  const t = curTool();
  // Size stays in place but dims when the tool has no size — the main bar never reflows.
  const showSize = ['pen', 'highlighter', 'eraser', 'shape', 'text', 'math'].includes(state.tool);
  refs.sizeBox.classList.toggle('disabled', !showSize);
  if (showSize) {
    refs.sizeR.min = t.min ?? 1;
    refs.sizeR.max = t.max ?? 40;
    refs.sizeR.step = t.step ?? 1;
    refs.sizeR.value = t.size;
    refs.sizeVal.textContent = t.size;
  }
  refs.penstyle.style.display = state.tool === 'pen' ? '' : 'none';
  refs.shapes.style.display = state.tool === 'shape' ? '' : 'none';
  refs.emojiopts.style.display = state.tool === 'emoji' ? '' : 'none';
  refs.selectopts.style.display = (state.tool === 'select' || state.tool === 'lasso') ? '' : 'none';
  // Contextual sub-bar only exists for tools that have extra options.
  refs.sub.hidden = !['pen', 'shape', 'select', 'lasso', 'emoji'].includes(state.tool);
  refs.subLabel.textContent = state.tool;
  syncPenStyle(); syncShapes(); syncShapeOpts(); syncEmoji(); syncColors();
  refreshCursor();
}

function syncEmoji() {
  const ch = state.tools.emoji.char;
  refs.emojiopts.querySelectorAll('.tb-emoji').forEach((b) =>
    b.classList.toggle('active', b.dataset.char === ch));
}

const FILLABLE = new Set(['rect', 'circle', 'triangle', 'diamond', 'node']);

function syncShapeOpts() {
  const isShape = state.tool === 'shape';
  refs.shapeopts.style.display = isShape ? '' : 'none';
  if (!isShape) return;
  const t = curTool();
  const fillable = FILLABLE.has(t.kind);
  refs.fill.style.display = fillable ? '' : 'none';
  refs.fill.classList.toggle('active', fillable && !!t.filled);
  const isGrid = t.kind === 'grid';
  refs.colsBox.style.display = isGrid ? '' : 'none';
  refs.rowsBox.style.display = isGrid ? '' : 'none';
  if (isGrid) { refs.colsV.textContent = t.cols ?? 4; refs.rowsV.textContent = t.rows ?? 4; }

  const isArrow = t.kind === 'arrow';
  refs.arrowStart.style.display = isArrow ? '' : 'none';
  refs.arrowEnd.style.display = isArrow ? '' : 'none';
  refs.arrowSizeBox.style.display = isArrow ? '' : 'none';
  if (isArrow) {
    refs.arrowStart.classList.toggle('active', !!t.arrowStart);
    refs.arrowEnd.classList.toggle('active', t.arrowEnd !== false);
    refs.arrowSizeV.textContent = t.arrowSize ?? 14;
  }
}

function syncColors() {
  const c = curTool().color;
  refs.colors.querySelectorAll('.tb-swatch').forEach((b) =>
    b.classList.toggle('active', b.dataset.color === c));
  syncColorPop(); // keep the popover's active ring fresh (no-op when hidden)
}

function syncPenStyle() {
  const st = curTool().style;
  refs.penstyle.querySelectorAll('[data-style]').forEach((b) =>
    b.classList.toggle('active', b.dataset.style === st));
}

function syncShapes() {
  const k = curTool().kind;
  refs.shapes.querySelectorAll('.tb-shape').forEach((b) =>
    b.classList.toggle('active', b.dataset.kind === k));
  syncShapeOpts();
}

export function syncPages() {
  refs.counter.textContent = `${state.current + 1} / ${state.pages.length}`;
  refs.bookmark.classList.toggle('active', !!curPage().bookmark);
  refreshPagesPanel();
  refs.bgPick.querySelectorAll('.tb-bgtile').forEach((b) =>
    b.classList.toggle('active', b.dataset.bg === curPage().bg));
  const ph = curPage().ph || 0;
  refs.sizePick.querySelectorAll('[data-ph]').forEach((b) =>
    b.classList.toggle('active', Number(b.dataset.ph) === ph));
  if (document.activeElement !== refs.title) refs.title.value = state.title;
}
