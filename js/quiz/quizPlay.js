// Solo quiz play-through. Runs every valid quiz page in the open notebook as a
// Kahoot-style sequence: big question, colored choice tiles, countdown timer,
// speed-scaled scoring, reveal, final score. Single device (Phase A).

import { questionValid, hasContent } from './quizModel.js';
import { renderContent } from './katex.js';
import { buildTile, TILE_COLORS as COLORS } from './tiles.js';
import { modalAlert } from '../ui/modal.js';

let overlay, stage;
let list = [], idx = 0, score = 0, correctCount = 0, timer = null;

export function initQuizPlay(overlayEl) {
  overlay = overlayEl;
  overlay.innerHTML = '<button class="qp-close" title="Exit">✕</button><div class="qp-stage"></div>';
  stage = overlay.querySelector('.qp-stage');
  overlay.querySelector('.qp-close').addEventListener('click', close);
}

// Play a quiz document (its valid questions).
export function playQuiz(doc) {
  list = (doc.questions || []).filter(questionValid);
  if (!list.length) { modalAlert({ title: 'Nothing to play', message: 'This quiz has no question with a marked correct answer yet.' }); return; }
  idx = 0; score = 0; correctCount = 0;
  overlay.hidden = false;
  renderQuestion();
}

function close() {
  clearInterval(timer); timer = null;
  overlay.hidden = true;
  overlay.querySelector('.qp-zoom-layer')?.remove();
  stage.innerHTML = '';
}

function renderQuestion() {
  const q = list[idx];
  const choices = q.choices.filter(hasContent);
  overlay.querySelector('.qp-zoom-layer')?.remove();
  stage.innerHTML = '';

  const bar = div('qp-bar');
  const fill = div('qp-bar-fill');
  bar.append(fill);
  stage.append(bar);

  const head = div('qp-head');
  head.innerHTML = `
    <span class="qp-pill">${idx + 1} / ${list.length}</span>
    <span class="qp-time">${q.time}s</span>
    <span class="qp-pill qp-score">★ ${score}</span>`;
  stage.append(head);
  const timeEl = head.querySelector('.qp-time');

  const qBox = div('qp-question');
  renderContent(qBox, q.question);
  const qzoom = document.createElement('button');
  qzoom.className = 'qp-zoom qp-zoom-q'; qzoom.title = 'Zoom'; qzoom.textContent = '⤢';
  qzoom.addEventListener('click', () => openZoom(q.question, '#ffffff'));
  qBox.append(qzoom);
  stage.append(qBox);

  const grid = div('qp-choices');
  const tiles = choices.map((c, i) => {
    const t = buildTile(c, i, {
      onZoom: openZoom,
      onPick: (tileEl) => answer(c, tiles, choices, tileEl),
    });
    grid.append(t);
    return t;
  });
  stage.append(grid);

  // countdown
  const total = q.time * 1000;
  const start = Date.now();
  clearInterval(timer);
  timer = setInterval(() => {
    const left = Math.max(0, total - (Date.now() - start));
    fill.style.width = (left / total * 100) + '%';
    timeEl.textContent = Math.ceil(left / 1000) + 's';
    const low = left / total < 0.25;
    fill.classList.toggle('low', low);
    timeEl.classList.toggle('low', low);
    if (left <= 0) { clearInterval(timer); timer = null; answer(null, tiles, choices, null); }
  }, 80);
  fill.dataset.start = start;
  fill.dataset.total = total;
}

function answer(chosen, tiles, choices, tileEl) {
  if (overlay.dataset.locked === '1') return;
  overlay.dataset.locked = '1';
  clearInterval(timer); timer = null;

  const q = list[idx];
  const fill = stage.querySelector('.qp-bar-fill');
  const remaining = Math.max(0, Number(fill.dataset.total) - (Date.now() - Number(fill.dataset.start)));
  const frac = remaining / Number(fill.dataset.total);

  const correct = chosen && chosen.correct;
  if (correct) { score += Math.round(q.points * (0.5 + 0.5 * frac)); correctCount++; }

  // reveal: correct tiles green, chosen-wrong red, others dim
  choices.forEach((c, i) => {
    const t = tiles[i];
    if (c.correct) t.classList.add('qp-correct');
    else if (t === tileEl) t.classList.add('qp-wrong');
    else t.classList.add('qp-dim');
  });

  const next = div('qp-next');
  next.innerHTML = `<div class="qp-verdict ${correct ? 'ok' : 'no'}">${correct ? 'Correct! +' + Math.round(q.points * (0.5 + 0.5 * frac)) : (chosen ? 'Wrong' : 'Time up')}</div>`;
  const btn = document.createElement('button');
  btn.className = 'qp-next-btn';
  btn.textContent = idx + 1 < list.length ? 'Next →' : 'See results';
  btn.addEventListener('click', () => { overlay.dataset.locked = '0'; idx++; idx < list.length ? renderQuestion() : renderResult(); });
  next.append(btn);
  stage.append(next);
}

function renderResult() {
  const max = list.reduce((s, q) => s + q.points, 0);
  const pct = Math.round((correctCount / list.length) * 100);
  stage.innerHTML = '';
  const box = div('qp-result');
  box.innerHTML = `<div class="qp-result-title">Final score</div>
    <div class="qp-result-score">${score}</div>
    <div class="qp-result-stats">
      <span class="qp-pill">${correctCount} / ${list.length} correct</span>
      <span class="qp-pill">${pct}%</span>
      <span class="qp-pill">max ${max}</span>
    </div>`;
  const again = document.createElement('button');
  again.className = 'qp-next-btn';
  again.textContent = 'Play again';
  again.addEventListener('click', () => { idx = 0; score = 0; correctCount = 0; renderQuestion(); });
  const done = document.createElement('button');
  done.className = 'qp-next-btn qp-ghost';
  done.textContent = 'Close';
  done.addEventListener('click', close);
  box.append(again, done);
  stage.append(box);
}

// Enlarge one choice's content (read code/image) without answering.
function openZoom(c, color) {
  let layer = overlay.querySelector('.qp-zoom-layer');
  if (!layer) { layer = div('qp-zoom-layer'); overlay.append(layer); }
  layer.innerHTML = '';
  const close = document.createElement('button');
  close.className = 'qp-zoom-close'; close.textContent = '✕';
  close.addEventListener('click', () => layer.remove());
  const card = div('qp-zoom-card');
  card.style.borderColor = color;
  renderContent(card, c);
  layer.append(close, card);
  layer.addEventListener('click', (e) => { if (e.target === layer) layer.remove(); });
}

function div(cls) { const d = document.createElement('div'); d.className = cls; return d; }
