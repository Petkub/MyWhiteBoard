// Quiz home — sketchbook-desk grid matching the library: Excalifont brand,
// search, multi-select bulk delete, tilted cards with accent-doodle covers,
// ⋯ popover actions (#quizzes route).

import { listQuizzes, createQuiz, renameQuiz, removeQuiz, duplicateQuiz } from './quizLib.js';
import { validQuestions } from './quizModel.js';
import { modalPrompt, modalConfirm } from '../ui/modal.js';
import { goQuiz, goLibrary, goJoin } from '../router.js';
import { toggleTheme, themeLabel } from '../ui/theme.js';
import { playQuiz } from './quizPlay.js';
import { hostQuiz } from './live/host.js';

const icon = (paths, w = 2) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
const ICON_EMPTY = icon('<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>', 1.5);
const ICON_SEARCH = icon('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>');
const ICON_SELECT = icon('<path d="m9 11 3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>');
const BRAND_LINE = '<svg class="lib-brand-line" viewBox="0 0 130 8" fill="none" preserveAspectRatio="none"><path d="M2 5c20-3 38 3 60-1 18-3 42 1 66 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

// Cover accents — the app's own palette, one per card, cycling.
const ACCENTS = ['#d62828', '#1d3fb6', '#2f9e44', '#7048e8', '#e64980'];
// Hand-drawn doodles scattered over the cover (white ink, low opacity).
const DOODLES = `
  <svg class="qh-doodle" viewBox="0 0 200 120" fill="none" stroke="currentColor"
       stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
       preserveAspectRatio="xMidYMid slice">
    <path d="M28 28c0-9 16-9 16 0 0 7-8 6-8 14"/><path d="M36 50h.01" stroke-width="4"/>
    <path d="M146 22l7 8 13-16"/>
    <path d="M22 92q10-12 20 0t20 0t20 0"/>
    <path d="M171 76l3 8 8 3-8 3-3 8-3-8-8-3 8-3z" fill="currentColor" stroke="none"/>
    <circle cx="103" cy="22" r="9"/>
    <path d="M178 38q-12 4-10 16"/>
    <path d="M120 98l16-4M124 106l10-2"/>
  </svg>`;

let mount, grid, countEl, searchEl, selmodeBtn, selbar, selcountEl;
let openPop = null;       // { pop, btn } — one card popover at a time
let query = '';
let selecting = false;    // multi-select mode
const picked = new Set(); // selected quiz ids

export function initQuizHome(rootEl) {
  mount = rootEl;
  mount.className = 'qh';
  mount.innerHTML = `
    <header class="qh-head">
      <button class="lib-ghost qh-back">← Notebooks</button>
      <div class="lib-brand-wrap">
        <span class="lib-brand">Quizzes</span>
        ${BRAND_LINE}
        <span class="lib-count qh-count-line"></span>
      </div>
      <div class="lib-search-wrap qh-search-wrap">
        ${ICON_SEARCH}
        <input class="lib-search qh-search" type="search" placeholder="search quizzes">
      </div>
      <div class="qh-actions">
        <button class="lib-btn lib-btn-primary qh-new">+ Quiz</button>
        <button class="lib-link qh-join">join live →</button>
        <button class="lib-ghost qh-selmode" title="Select multiple quizzes">${ICON_SELECT}<span>select</span></button>
        <button class="lib-ghost lib-iconbtn qh-theme"></button>
      </div>
    </header>
    <main class="qh-grid"></main>
    <div class="lib-selbar qh-selbar" hidden>
      <span class="lib-selcount qh-selcount">0 selected</span>
      <button class="lib-btn qh-sel-del">delete</button>
      <button class="lib-btn qh-sel-cancel">cancel</button>
    </div>`;
  grid = mount.querySelector('.qh-grid');
  countEl = mount.querySelector('.qh-count-line');
  searchEl = mount.querySelector('.qh-search');
  selmodeBtn = mount.querySelector('.qh-selmode');
  selbar = mount.querySelector('.qh-selbar');
  selcountEl = mount.querySelector('.qh-selcount');

  mount.querySelector('.qh-back').addEventListener('click', () => goLibrary());
  mount.querySelector('.qh-new').addEventListener('click', onNew);
  mount.querySelector('.qh-join').addEventListener('click', () => goJoin());
  searchEl.addEventListener('input', (e) => { query = e.target.value; renderQuizHome(); });
  selmodeBtn.addEventListener('click', () => (selecting ? exitSelect() : enterSelect()));
  mount.querySelector('.qh-sel-cancel').addEventListener('click', exitSelect);
  mount.querySelector('.qh-sel-del').addEventListener('click', onDeletePicked);
  const themeBtn = mount.querySelector('.qh-theme');
  const syncTheme = () => { themeBtn.textContent = themeLabel().split(' ')[0]; themeBtn.title = themeLabel(); };
  syncTheme();
  themeBtn.addEventListener('click', () => { toggleTheme(); syncTheme(); });
  document.addEventListener('click', closePop);
}

// ---- multi-select mode ----
function enterSelect() {
  selecting = true;
  picked.clear();
  closePop();
  selmodeBtn.classList.add('active');
  grid.classList.add('selmode');
  updateSelBar();
}

function exitSelect() {
  selecting = false;
  picked.clear();
  selmodeBtn.classList.remove('active');
  grid.classList.remove('selmode');
  grid.querySelectorAll('.lib-card.picked').forEach((c) => c.classList.remove('picked'));
  updateSelBar();
}

function updateSelBar() {
  selbar.hidden = !selecting;
  selcountEl.textContent = `${picked.size} selected`;
}

function togglePick(id, cardEl) {
  if (picked.has(id)) picked.delete(id);
  else picked.add(id);
  cardEl.classList.toggle('picked', picked.has(id));
  updateSelBar();
}

async function onDeletePicked() {
  if (!picked.size) return;
  const n = picked.size;
  const ok = await modalConfirm({
    title: 'Delete quizzes',
    message: `Delete ${n} quiz${n === 1 ? '' : 'zes'}? This can't be undone.`,
    confirmText: 'Delete', danger: true,
  });
  if (!ok) return;
  await Promise.all([...picked].map((id) => removeQuiz(id)));
  exitSelect();
  renderQuizHome();
}

function closePop() {
  if (!openPop) return;
  openPop.pop.remove();
  openPop.btn.classList.remove('open');
  openPop = null;
}

async function onNew() {
  const title = await modalPrompt({ title: 'New quiz', label: 'Title', value: 'Untitled quiz', confirmText: 'Create' });
  if (title === null) return;
  const q = await createQuiz(title || 'Untitled quiz');
  goQuiz(q.id);
}

export async function renderQuizHome() {
  closePop();
  let quizzes = (await listQuizzes()).sort((a, b) => (b.updated || 0) - (a.updated || 0));
  countEl.textContent = `${quizzes.length} quiz${quizzes.length === 1 ? '' : 'zes'}`;
  const q = query.trim().toLowerCase();
  if (q) quizzes = quizzes.filter((x) => (x.title || '').toLowerCase().includes(q));
  grid.innerHTML = '';

  if (!q) {
    const plus = document.createElement('button');
    plus.className = 'lib-newcard qh-newcard';
    plus.innerHTML = '<span class="lib-newcard-plus">+</span><span>new quiz</span>';
    plus.addEventListener('click', onNew);
    grid.appendChild(plus);
  }

  if (!quizzes.length) {
    const empty = document.createElement('div');
    empty.className = 'lib-empty';
    empty.innerHTML = `${ICON_EMPTY}<span>${q ? 'nothing matches the search' : 'no quizzes yet — make one'}</span>`;
    grid.appendChild(empty);
    return;
  }
  quizzes.forEach((qz, i) => grid.appendChild(card(qz, i)));
}

function card(q, i) {
  const el = document.createElement('div');
  el.className = 'lib-card qh-card' + (picked.has(q.id) ? ' picked' : '');
  el.style.setProperty('--tilt', `${(((i % 5) - 2) * 0.4).toFixed(2)}deg`);
  el.style.setProperty('--d', `${Math.min(i, 12) * 35}ms`);

  const openOrPick = () => (selecting ? togglePick(q.id, el) : goQuiz(q.id));

  const valid = validQuestions(q).length;
  const cover = document.createElement('div');
  cover.className = 'qh-cover';
  cover.title = selecting ? 'Select quiz' : 'Edit quiz';
  cover.style.background = ACCENTS[i % ACCENTS.length];
  cover.innerHTML = `${DOODLES}<span class="qh-qcount">${q.questions.length}</span>`;
  cover.addEventListener('click', openOrPick);
  el.appendChild(cover);

  const meta = document.createElement('div');
  meta.className = 'lib-meta';
  meta.innerHTML = `
    <div class="lib-title">${escape(q.title)}</div>
    <div class="lib-sub">${q.questions.length} question${q.questions.length === 1 ? '' : 's'} · ${valid} playable</div>
    <div class="lib-sub">${fmt(q.updated)}</div>`;
  meta.addEventListener('click', openOrPick);
  el.appendChild(meta);

  const foot = document.createElement('div');
  foot.className = 'lib-card-foot';
  const play = document.createElement('button');
  play.className = 'qh-play';
  play.textContent = '▶ play';
  if (valid) {
    play.addEventListener('click', (e) => { e.stopPropagation(); playQuiz(q); });
  } else {
    play.classList.add('disabled');
    play.title = 'No playable questions yet';
  }
  const kebab = document.createElement('button');
  kebab.className = 'lib-kebab';
  kebab.title = 'Quiz actions';
  kebab.textContent = '⋯';
  kebab.addEventListener('click', (e) => {
    e.stopPropagation();
    if (openPop && openPop.btn === kebab) { closePop(); return; }
    closePop();
    const pop = buildPop(q);
    el.appendChild(pop);
    kebab.classList.add('open');
    openPop = { pop, btn: kebab };
  });
  foot.append(play, kebab);
  el.appendChild(foot);
  return el;
}

function buildPop(q) {
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
    item('edit', () => goQuiz(q.id)),
    item('host live', () => hostQuiz(q)),
    item('rename', async () => { const t = await modalPrompt({ title: 'Rename quiz', label: 'Title', value: q.title, confirmText: 'Rename' }); if (t !== null) { await renameQuiz(q.id, t); renderQuizHome(); } }),
    item('duplicate', async () => { await duplicateQuiz(q.id); renderQuizHome(); }),
    div(),
    item('delete', async () => { if (await modalConfirm({ title: 'Delete quiz', message: `Delete "${q.title}"?`, confirmText: 'Delete', danger: true })) { await removeQuiz(q.id); renderQuizHome(); } }, 'danger'),
  );
  return pop;
}

function fmt(ts) {
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
