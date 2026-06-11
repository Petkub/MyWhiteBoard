// Library home screen — "sketchbook desk": folder divider-tabs, tilted
// notebook-cover cards with a ⋯ popover for actions, search, CRUD.

import {
  listNotebooks, listFolders, createNotebook, createNotebookFromPages, createFolder, removeFolder,
  renameNotebook, removeNotebook, duplicateNotebook, moveNotebook,
  setNotebookTags, loadNotebookRecord, search,
} from './library.js';
import { PAGE_W } from '../config.js';
import { renderFileToPages } from '../import/pageImport.js';
import { renderPageToCanvas } from '../render/exporter.js';
import { exportPagePNG } from '../export/png.js';
import { exportNotebookPDF } from '../export/pdf.js';
import { exportNotebookJSON, importNotebookJSON } from '../export/json.js';
import { goEditor, goQuizzes, goJoin } from '../router.js';
import { modalPrompt, modalConfirm, modalAlert, modalChoose, modalNewNotebook } from '../ui/modal.js';
import { toggleTheme, themeLabel } from '../ui/theme.js';
import { removeTab } from '../ui/tabs.js';

const icon = (paths, w = 2) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
const ICON_SEARCH = icon('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>');
const ICON_FOLDER = icon('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>');
const ICON_ALL = icon('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>');
const ICON_EMPTY = icon('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M9 7h6"/><path d="M9 11h4"/>', 1.5);
const BRAND_LINE = '<svg class="lib-brand-line" viewBox="0 0 130 8" fill="none" preserveAspectRatio="none"><path d="M2 5c20-3 38 3 60-1 18-3 42 1 66 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const ICON_IMPORT = icon('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>');
const ICON_SELECT = icon('<path d="m9 11 3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>');

let mount, els = {};
let activeFolder = null; // null = All
let query = '';
let openPop = null;      // { pop, btn } — one card popover at a time
let selecting = false;   // multi-select mode
const picked = new Set(); // selected notebook ids

export function initLibrary(rootEl) {
  mount = rootEl;
  mount.className = 'lib';
  mount.innerHTML = `
    <header class="lib-head">
      <div class="lib-brand-wrap">
        <span class="lib-brand">MyWhiteBoard</span>
        ${BRAND_LINE}
        <span class="lib-count"></span>
      </div>
      <div class="lib-search-wrap">
        ${ICON_SEARCH}
        <input class="lib-search" type="search" placeholder="search title or #tag">
      </div>
      <div class="lib-actions">
        <button class="lib-btn lib-btn-primary lib-new">+ Notebook</button>
        <span class="lib-impwrap">
          <button class="lib-ghost lib-importmenu">${ICON_IMPORT}<span>import</span><span class="lib-caret">▾</span></button>
          <div class="lib-pop lib-importpop" hidden>
            <button class="lib-imp-pdf">notebook from PDF / image</button>
            <button class="lib-imp-json">open .whiteboard file</button>
          </div>
        </span>
        <button class="lib-ghost lib-selmode" title="Select multiple notebooks">${ICON_SELECT}<span>select</span></button>
        <button class="lib-link lib-quizzes">Quizzes →</button>
        <button class="lib-link lib-joinlive">join live →</button>
        <button class="lib-ghost lib-iconbtn lib-theme"></button>
        <input type="file" class="lib-file" accept=".whiteboard,.json" hidden>
        <input type="file" class="lib-pdffile" accept="application/pdf,image/*" hidden>
      </div>
    </header>
    <div class="lib-body">
      <aside class="lib-folders"></aside>
      <main class="lib-grid"></main>
    </div>
    <div class="lib-selbar" hidden>
      <span class="lib-selcount">0 selected</span>
      <button class="lib-btn lib-sel-move">move to folder</button>
      <button class="lib-btn lib-sel-del">delete</button>
      <button class="lib-btn lib-sel-cancel">cancel</button>
    </div>`;

  els = {
    search: mount.querySelector('.lib-search'),
    count: mount.querySelector('.lib-count'),
    folders: mount.querySelector('.lib-folders'),
    grid: mount.querySelector('.lib-grid'),
    file: mount.querySelector('.lib-file'),
    pdffile: mount.querySelector('.lib-pdffile'),
    selmode: mount.querySelector('.lib-selmode'),
    selbar: mount.querySelector('.lib-selbar'),
    selcount: mount.querySelector('.lib-selcount'),
  };

  els.search.addEventListener('input', (e) => { query = e.target.value; renderGrid(); });
  mount.querySelector('.lib-new').addEventListener('click', onNewNotebook);
  els.file.addEventListener('change', onImport);
  els.pdffile.addEventListener('change', onFromPdf);
  mount.querySelector('.lib-quizzes').addEventListener('click', () => goQuizzes());
  mount.querySelector('.lib-joinlive').addEventListener('click', () => goJoin());
  const themeBtn = mount.querySelector('.lib-theme');
  const syncTheme = () => { themeBtn.textContent = themeLabel().split(' ')[0]; themeBtn.title = themeLabel(); };
  syncTheme();
  themeBtn.addEventListener('click', () => { toggleTheme(); syncTheme(); });

  // import dropdown (PDF/image pages vs .whiteboard file)
  const impBtn = mount.querySelector('.lib-importmenu');
  const impPop = mount.querySelector('.lib-importpop');
  const closeImp = () => { impPop.hidden = true; impBtn.classList.remove('active'); };
  impBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    impPop.hidden = !impPop.hidden;
    impBtn.classList.toggle('active', !impPop.hidden);
  });
  impPop.addEventListener('click', (e) => e.stopPropagation());
  mount.querySelector('.lib-imp-pdf').addEventListener('click', () => { closeImp(); els.pdffile.click(); });
  mount.querySelector('.lib-imp-json').addEventListener('click', () => { closeImp(); els.file.click(); });
  document.addEventListener('click', () => { closePop(); closeImp(); });

  els.selmode.addEventListener('click', () => (selecting ? exitSelect() : enterSelect()));
  mount.querySelector('.lib-sel-cancel').addEventListener('click', exitSelect);
  mount.querySelector('.lib-sel-move').addEventListener('click', onMovePicked);
  mount.querySelector('.lib-sel-del').addEventListener('click', onDeletePicked);
}

// ---- multi-select mode ----
function enterSelect() {
  selecting = true;
  picked.clear();
  closePop();
  els.selmode.classList.add('active');
  els.grid.classList.add('selmode');
  updateSelBar();
}

function exitSelect() {
  selecting = false;
  picked.clear();
  els.selmode.classList.remove('active');
  els.grid.classList.remove('selmode');
  els.grid.querySelectorAll('.lib-card.picked').forEach((c) => c.classList.remove('picked'));
  updateSelBar();
}

function updateSelBar() {
  els.selbar.hidden = !selecting;
  els.selcount.textContent = `${picked.size} selected`;
}

function togglePick(id, cardEl) {
  if (picked.has(id)) picked.delete(id);
  else picked.add(id);
  cardEl.classList.toggle('picked', picked.has(id));
  updateSelBar();
}

async function onMovePicked() {
  if (!picked.size) return;
  const folders = await listFolders();
  const options = [{ label: 'All (no folder)', value: null }, ...folders.map((f) => ({ label: f.name, value: f.id }))];
  const choice = await modalChoose({ title: `Move ${picked.size} notebook${picked.size === 1 ? '' : 's'}`, options });
  if (choice === undefined) return;
  await Promise.all([...picked].map((id) => moveNotebook(id, choice)));
  exitSelect();
  refreshLibrary();
}

async function onDeletePicked() {
  if (!picked.size) return;
  const n = picked.size;
  const ok = await modalConfirm({
    title: 'Delete notebooks',
    message: `Delete ${n} notebook${n === 1 ? '' : 's'}? This can't be undone.`,
    confirmText: 'Delete', danger: true,
  });
  if (!ok) return;
  await Promise.all([...picked].map((id) => removeNotebook(id)));
  picked.forEach((id) => removeTab(id));
  exitSelect();
  refreshLibrary();
}

function closePop() {
  if (!openPop) return;
  openPop.pop.remove();
  openPop.btn.classList.remove('open');
  openPop = null;
}

async function onFromPdf(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const title = file.name.replace(/\.[^.]+$/, '') || 'Imported';
  const status = els.search;
  const prev = status.placeholder;
  status.placeholder = 'importing PDF…';
  try {
    const pages = await renderFileToPages(file, (s) => { status.placeholder = s; });
    const nb = await createNotebookFromPages(title, pages, activeFolder);
    goEditor(nb.id);
  } catch (err) {
    status.placeholder = prev;
    modalAlert({ title: 'PDF import failed', message: err.message });
  }
}

export async function refreshLibrary() {
  await renderFolders();
  await renderGrid();
}

async function onNewNotebook() {
  const res = await modalNewNotebook({ value: 'Untitled' });
  if (!res) return;
  const nb = await createNotebook(res.title || 'Untitled', activeFolder, { bg: res.bg, ph: res.ph });
  goEditor(nb.id);
}

async function onNewFolder() {
  const name = await modalPrompt({ title: 'New folder', label: 'Name', value: 'New folder', confirmText: 'Create' });
  if (!name) return;
  await createFolder(name);
  renderFolders();
}

async function onImport(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try { await importNotebookJSON(file); refreshLibrary(); }
  catch (err) { modalAlert({ title: 'Import failed', message: err.message }); }
}

async function renderFolders() {
  const [folders, nbs] = await Promise.all([listFolders(), listNotebooks()]);
  const countOf = (id) => (id === null ? nbs.length : nbs.filter((n) => n.folderId === id).length);
  const tabs = [{ id: null, name: 'All' }, ...folders];
  els.folders.innerHTML = `
    <p class="lib-folders-label">folders
      <button class="lib-folder-add" title="New folder">＋</button>
    </p>`;
  els.folders.querySelector('.lib-folder-add').addEventListener('click', onNewFolder);
  for (const f of tabs) {
    const b = document.createElement('button');
    b.className = 'lib-folder' + (activeFolder === f.id ? ' active' : '');
    b.innerHTML = `${f.id === null ? ICON_ALL : ICON_FOLDER}<span class="lib-folder-name">${escape(f.name)}</span><span class="lib-folder-count">${countOf(f.id)}</span>`;
    b.addEventListener('click', () => { activeFolder = f.id; renderFolders(); renderGrid(); });
    if (f.id !== null) {
      const x = document.createElement('span');
      x.className = 'lib-folder-del'; x.textContent = '×'; x.title = 'Delete folder';
      x.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const ok = await modalConfirm({ title: 'Delete folder', message: `Delete "${f.name}"? Its notebooks move to All.`, confirmText: 'Delete', danger: true });
        if (!ok) return;
        const all = await listNotebooks();
        await Promise.all(all.filter((n) => n.folderId === f.id).map((n) => moveNotebook(n.id, null)));
        await removeFolder(f.id);
        if (activeFolder === f.id) activeFolder = null;
        refreshLibrary();
      });
      b.appendChild(x);
    }
    els.folders.appendChild(b);
  }
}

async function renderGrid() {
  closePop();
  let nbs = await search(query);
  if (activeFolder !== null) nbs = nbs.filter((n) => n.folderId === activeFolder);
  nbs.sort((a, b) => (b.updated || 0) - (a.updated || 0));
  els.count.textContent = `${nbs.length} notebook${nbs.length === 1 ? '' : 's'}`;
  els.grid.innerHTML = '';

  const plus = document.createElement('button');
  plus.className = 'lib-newcard';
  plus.innerHTML = '<span class="lib-newcard-plus">+</span><span>new notebook</span>';
  plus.addEventListener('click', onNewNotebook);
  els.grid.appendChild(plus);

  if (!nbs.length) {
    const empty = document.createElement('div');
    empty.className = 'lib-empty';
    empty.innerHTML = `${ICON_EMPTY}<span>${query ? 'nothing matches that search' : 'empty desk — start a notebook'}</span>`;
    els.grid.appendChild(empty);
    return;
  }
  nbs.forEach((nb, i) => els.grid.appendChild(card(nb, i)));
}

function card(nb, i) {
  const el = document.createElement('div');
  el.className = 'lib-card';
  // gentle per-card tilt + staggered entry; both straighten/settle on hover
  el.style.setProperty('--tilt', `${(((i % 5) - 2) * 0.4).toFixed(2)}deg`);
  el.style.setProperty('--d', `${Math.min(i, 12) * 35}ms`);

  const thumb = document.createElement('div');
  thumb.className = 'lib-thumb';
  try {
    // Render at the card's on-screen pixel density (capped at 2x) so covers
    // stay sharp; cap world height — the thumb only shows the top of page 1.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cv = renderPageToCanvas(nb.pages[0], (300 * dpr) / PAGE_W, 700);
    cv.className = 'lib-thumb-cv';
    thumb.appendChild(cv);
  } catch { /* ignore thumb errors */ }
  const open = document.createElement('span');
  open.className = 'lib-open';
  open.textContent = 'open →';
  thumb.appendChild(open);
  el.appendChild(thumb);

  const meta = document.createElement('div');
  meta.className = 'lib-meta';
  meta.innerHTML = `
    <div class="lib-title">${escape(nb.title)}</div>
    <div class="lib-tags">${(nb.tags || []).map((t) => `<span class="lib-tag">#${escape(t)}</span>`).join('')}</div>`;
  el.appendChild(meta);

  if (picked.has(nb.id)) el.classList.add('picked');
  const openOrPick = () => (selecting ? togglePick(nb.id, el) : goEditor(nb.id));
  thumb.addEventListener('click', openOrPick);
  meta.addEventListener('click', openOrPick);

  const foot = document.createElement('div');
  foot.className = 'lib-card-foot';
  const sub = document.createElement('span');
  sub.className = 'lib-sub';
  sub.textContent = `${nb.pages.length} ${nb.pages.length === 1 ? 'page' : 'pages'} · ${fmtDate(nb.updated)}`;
  const kebab = document.createElement('button');
  kebab.className = 'lib-kebab';
  kebab.title = 'Notebook actions';
  kebab.textContent = '⋯';
  kebab.addEventListener('click', (e) => {
    e.stopPropagation();
    if (openPop && openPop.btn === kebab) { closePop(); return; }
    closePop();
    const pop = buildPop(nb);
    el.appendChild(pop);
    kebab.classList.add('open');
    openPop = { pop, btn: kebab };
  });
  foot.append(sub, kebab);
  el.appendChild(foot);
  return el;
}

function buildPop(nb) {
  const pop = document.createElement('div');
  pop.className = 'lib-pop';
  pop.addEventListener('click', (e) => e.stopPropagation());
  const item = (label, fn, cls = '') => {
    const b = document.createElement('button');
    if (cls) b.className = cls;
    b.textContent = label;
    b.addEventListener('click', () => { closePop(); fn(); });
    return b;
  };
  const div = () => {
    const d = document.createElement('div');
    d.className = 'lib-pop-div';
    return d;
  };
  pop.append(
    item('rename', async () => { const t = await modalPrompt({ title: 'Rename notebook', label: 'Title', value: nb.title, confirmText: 'Rename' }); if (t !== null) { await renameNotebook(nb.id, t); renderGrid(); } }),
    item('tags', async () => { const t = await modalPrompt({ title: 'Edit tags', label: 'Comma-separated', value: (nb.tags || []).join(', '), placeholder: 'math, exam' }); if (t !== null) { await setNotebookTags(nb.id, t.split(',').map((s) => s.trim()).filter(Boolean)); renderGrid(); } }),
    item('move to folder', () => moveDialog(nb)),
    item('duplicate', async () => { await duplicateNotebook(nb.id); refreshLibrary(); }),
    div(),
    item('export PNG', async () => { const r = await loadNotebookRecord(nb.id); exportPagePNG(r.pages[0], r.title, 1); }),
    item('export PDF', async () => { const r = await loadNotebookRecord(nb.id); exportNotebookPDF(r.pages, r.title); }),
    item('export JSON', async () => { const r = await loadNotebookRecord(nb.id); exportNotebookJSON(r); }),
    div(),
    item('delete', async () => { if (await modalConfirm({ title: 'Delete notebook', message: `Delete "${nb.title}"? This can't be undone.`, confirmText: 'Delete', danger: true })) { await removeNotebook(nb.id); removeTab(nb.id); refreshLibrary(); } }, 'danger'),
  );
  return pop;
}

async function moveDialog(nb) {
  const folders = await listFolders();
  const options = [{ label: 'All (no folder)', value: null }, ...folders.map((f) => ({ label: f.name, value: f.id }))];
  const choice = await modalChoose({ title: 'Move to folder', options });
  if (choice === undefined) return; // dismissed
  await moveNotebook(nb.id, choice);
  refreshLibrary();
}

function fmtDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const now = new Date();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (d.toDateString() === now.toDateString()) return `today ${hm}`;
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return `yesterday ${hm}`;
  const days = Math.floor((now - d) / 86400000);
  if (days < 7) return `${days}d ago`;
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
}

function escape(s) { return String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])); }
