// Pages drawer — film-strip of page thumbnails sliding up from the bottom of
// the editor. Click a sheet to jump, ⚑ bookmark (red ribbon + filter),
// ✕ delete, dashed + tile adds. Opened from the toolbar pages chip.

import { state, goToPage, addPage, removePage, toggleBookmark } from '../state.js';
import { renderPageToCanvas, prepareImages } from '../render/exporter.js';
import { modalConfirm } from './modal.js';

let drawer = null, strip = null, flagFilter = false;

const pagesBtn = () => document.querySelector('.tb-pages-btn');

export const isPagesPanelOpen = () => !!drawer;

export function togglePagesPanel() { drawer ? closePagesPanel() : openPagesPanel(); }

export function closePagesPanel() {
  if (!drawer) return;
  const el = drawer;
  drawer = null; strip = null;
  pagesBtn()?.classList.remove('active');
  document.removeEventListener('click', onDocClick);
  el.classList.remove('open');                    // slide down…
  setTimeout(() => el.remove(), 240);             // …then drop from the DOM
}

export async function openPagesPanel() {
  if (drawer) return;
  const host = document.getElementById('editor');
  drawer = document.createElement('div');
  drawer.className = 'pages-drawer';
  drawer.innerHTML = `
    <div class="pd-head">
      <span class="pd-title">pages</span>
      <span class="pd-count"></span>
      <span class="pd-spacer"></span>
      <button class="pd-filter" title="Show bookmarked pages only">⚑ bookmarks</button>
      <button class="pd-close" title="Close">✕</button>
    </div>
    <div class="pd-strip"></div>`;
  drawer.addEventListener('click', (e) => e.stopPropagation());
  strip = drawer.querySelector('.pd-strip');
  const filterBtn = drawer.querySelector('.pd-filter');
  filterBtn.classList.toggle('active', flagFilter);
  filterBtn.addEventListener('click', () => {
    flagFilter = !flagFilter;
    filterBtn.classList.toggle('active', flagFilter);
    rebuild();
  });
  drawer.querySelector('.pd-close').addEventListener('click', closePagesPanel);
  host.appendChild(drawer);
  pagesBtn()?.classList.add('active');
  requestAnimationFrame(() => drawer && drawer.classList.add('open')); // slide up
  document.addEventListener('click', onDocClick);
  await prepareImages(state.pages); // decode bg/object images for thumbnails
  rebuild();
}

// Re-render the strip in place (called on page mutations while open).
export function refreshPagesPanel() {
  if (drawer) rebuild();
}

function onDocClick(e) {
  // clicks inside the drawer or a modal (delete confirm) don't dismiss
  if (drawer && !drawer.contains(e.target) && !e.target.closest('.modal-backdrop')) closePagesPanel();
}

function rebuild() {
  if (!strip) return;
  strip.innerHTML = '';
  drawer.querySelector('.pd-count').textContent = `· ${state.pages.length}`;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let activeCard = null, shown = 0;
  state.pages.forEach((p, i) => {
    if (flagFilter && !p.bookmark) return;
    shown++;
    const el = card(p, i, dpr);
    if (i === state.current) activeCard = el;
    strip.appendChild(el);
  });
  if (flagFilter && !shown) {
    const empty = document.createElement('div');
    empty.className = 'pd-empty';
    empty.textContent = 'no bookmarks yet — ⚑ a page to pin it here';
    strip.appendChild(empty);
  }
  if (!flagFilter) {
    const add = document.createElement('button');
    add.className = 'pd-add';
    add.title = 'Add page after current';
    add.innerHTML = '<span>+</span>';
    add.addEventListener('click', () => { addPage(); });
    strip.appendChild(add);
  }
  // keep the active sheet in view
  if (activeCard) {
    const x = activeCard.offsetLeft - (strip.clientWidth - activeCard.clientWidth) / 2;
    strip.scrollLeft = Math.max(0, x);
  }
}

function card(p, i, dpr) {
  const el = document.createElement('div');
  el.className = 'pd-card' + (i === state.current ? ' active' : '') + (p.bookmark ? ' flagged' : '');
  el.style.setProperty('--tilt', `${(((i % 5) - 2) * 0.5).toFixed(2)}deg`);

  const sheet = document.createElement('div');
  sheet.className = 'pd-sheet';
  // thumbnails share the strip height (120 CSS px), so scale by world HEIGHT;
  // endless pages only rasterize their top (A4-ish band)
  const worldH = p.ph || 1123;
  const cv = renderPageToCanvas(p, (120 * dpr) / worldH, worldH);
  cv.className = 'pd-thumb';
  sheet.appendChild(cv);

  if (p.bookmark) {
    const rib = document.createElement('span');
    rib.className = 'pd-ribbon';
    sheet.appendChild(rib);
  }

  const actions = document.createElement('div');
  actions.className = 'pd-actions';
  const flag = document.createElement('button');
  flag.className = 'pd-flag' + (p.bookmark ? ' on' : '');
  flag.title = p.bookmark ? 'Remove bookmark' : 'Bookmark page';
  flag.textContent = '⚑';
  flag.addEventListener('click', (e) => { e.stopPropagation(); toggleBookmark(i); rebuild(); });
  const del = document.createElement('button');
  del.className = 'pd-del';
  del.title = 'Delete page';
  del.textContent = '✕';
  del.addEventListener('click', async (e) => {
    e.stopPropagation();
    const hasInk = p.strokes.length > 0 || p.bgImage;
    if (hasInk && !(await modalConfirm({
      title: 'Delete page',
      message: `Delete page ${i + 1}? Its ink is lost (not undoable).`,
      confirmText: 'Delete', danger: true,
    }))) return;
    removePage(i);
  });
  actions.append(flag, del);
  sheet.appendChild(actions);
  sheet.addEventListener('click', () => { if (i !== state.current) goToPage(i); });
  el.appendChild(sheet);

  const label = document.createElement('div');
  label.className = 'pd-label';
  label.textContent = i + 1;
  el.appendChild(label);
  return el;
}
