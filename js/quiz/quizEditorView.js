// Full quiz-document editor: title + ordered question cards + add/play/back.
// Loads a quiz by id, edits in memory, debounced-saves to the quizzes store.

import { loadQuiz, saveQuiz } from './quizLib.js';
import { blankQuestion, questionValid } from './quizModel.js';
import { renderQuestionCard } from './questionForm.js';

let panel = null, onPlay = () => {}, onHost = () => {}, onBack = () => {};
let doc = null, timer = null, statusEl = null, active = 0;

export function initQuizEdit(panelEl, hooks) {
  panel = panelEl;
  onPlay = hooks.onPlay || (() => {});
  onHost = hooks.onHost || (() => {});
  onBack = hooks.onBack || (() => {});
}

export function currentQuiz() { return doc; }

export async function openQuizEditorView(id) {
  doc = await loadQuiz(id);
  if (!doc) { onBack(); return; }
  active = 0;
  render();
}

function scheduleSave() {
  if (statusEl) statusEl.textContent = 'editing…';
  clearTimeout(timer);
  timer = setTimeout(flush, 800);
}

export async function flush() {
  clearTimeout(timer);
  if (!doc) return;
  if (statusEl) statusEl.textContent = 'saving…';
  await saveQuiz(doc);
  if (statusEl) statusEl.textContent = 'saved';
}

function render() {
  panel.innerHTML = '';

  const head = document.createElement('div');
  head.className = 'qe-head';
  const back = btn('← quizzes', 'qe-back', async () => { await flush(); onBack(); });
  const title = document.createElement('input');
  title.className = 'qe-title';
  title.value = doc.title;
  title.placeholder = 'Quiz title';
  title.addEventListener('input', () => { doc.title = title.value; scheduleSave(); });
  statusEl = document.createElement('span');
  statusEl.className = 'qe-status';
  statusEl.textContent = 'saved';
  const play = btn('▶ Play', 'qe-play', async () => { await flush(); onPlay(doc); });
  const host = btn('📡 Host live', 'qe-play qe-host', async () => { await flush(); onHost(doc); });
  head.append(back, title, statusEl, play, host);
  panel.append(head);

  const nav = document.createElement('div');
  nav.className = 'qe-nav';
  panel.append(nav);

  const list = document.createElement('div');
  list.className = 'qe-list';
  panel.append(list);
  renderList(list, nav);
}

function move(dir, list, nav) {
  const j = active + dir;
  if (j < 0 || j >= doc.questions.length) return;
  const [q] = doc.questions.splice(active, 1);
  doc.questions.splice(j, 0, q);
  active = j;
  scheduleSave();
  renderList(list, nav);
}

// Paged editor: render only the active question; nav switches pages.
function renderList(list, nav) {
  const n = doc.questions.length;
  active = Math.max(0, Math.min(active, n - 1));
  const q = doc.questions[active];

  list.innerHTML = '';
  list.append(renderQuestionCard(q, {
    index: active,
    onChange: () => { scheduleSave(); refreshNavValidity(nav); },
    onMoveUp: active > 0 ? () => move(-1, list, nav) : null,
    onMoveDown: active < n - 1 ? () => move(1, list, nav) : null,
    onDelete: n > 1
      ? () => { doc.questions.splice(active, 1); if (active >= doc.questions.length) active = doc.questions.length - 1; scheduleSave(); renderList(list, nav); }
      : null,
  }));

  // navigation strip — one pill per question; dashed = not yet playable
  nav.innerHTML = '';
  doc.questions.forEach((qq, i) => {
    const b = document.createElement('button');
    b.className = 'qe-navq' + (i === active ? ' active' : '') + (questionValid(qq) ? '' : ' incomplete');
    b.textContent = i + 1;
    b.title = qq.question?.text ? qq.question.text.slice(0, 40) : `Question ${i + 1}`;
    b.addEventListener('click', () => { active = i; renderList(list, nav); });
    nav.append(b);
  });
  const addNav = document.createElement('button');
  addNav.className = 'qe-navq qe-navadd'; addNav.textContent = '＋';
  addNav.title = 'Add question';
  addNav.addEventListener('click', () => { doc.questions.push(blankQuestion()); active = doc.questions.length - 1; scheduleSave(); renderList(list, nav); });
  nav.append(addNav);
}

// Re-check pill validity classes in place — no rebuild, keeps input focus.
function refreshNavValidity(nav) {
  nav.querySelectorAll('.qe-navq:not(.qe-navadd)').forEach((b, i) => {
    const qq = doc.questions[i];
    if (qq) b.classList.toggle('incomplete', !questionValid(qq));
  });
}

function btn(text, cls, fn) {
  const b = document.createElement('button');
  b.className = cls; b.textContent = text;
  b.addEventListener('click', fn);
  return b;
}
