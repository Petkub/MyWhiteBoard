// Renders one editable question card (prompt + 2-4 choices, each text/LaTeX/
// image, mark correct, time + points). Bound to a question object; calls
// onChange after every edit (debounced save happens upstream).

import { blankChoice } from './quizModel.js';
import { renderLatex } from './katex.js';
import { LANGS } from './hljs.js';
import { readDataURL } from '../export/download.js';
import { shrinkImage } from './live/protocol.js';

// opts: { index, onChange, onDelete }
export function renderQuestionCard(q, opts) {
  const save = opts.onChange || (() => {});
  const card = el('div', 'qz-qcard');

  const head = el('div', 'qz-qhead');
  head.append(label(`Question ${opts.index + 1}`));
  const tools = el('div', 'qz-qtools');
  if (opts.onMoveUp) tools.append(moveBtn('↑', 'Move up', opts.onMoveUp));
  if (opts.onMoveDown) tools.append(moveBtn('↓', 'Move down', opts.onMoveDown));
  tools.append(
    numField('⏱ time (s)', q.time, 3, 300, (v) => { q.time = v; save(); }),
    numField('★ points', q.points, 0, 5000, (v) => { q.points = v; save(); }),
  );
  if (opts.onDelete) {
    const del = el('button', 'qz-qdel');
    del.textContent = '✕ delete';
    del.addEventListener('click', () => opts.onDelete());
    tools.append(del);
  }
  head.append(tools);
  card.append(head);

  const prompt = el('div', 'qz-question');
  prompt.append(label('Prompt'));
  contentEditor(prompt, q.question, save);
  card.append(prompt);

  const cWrap = el('div', 'qz-choices');
  const rerender = () => { const fresh = renderQuestionCard(q, opts); card.replaceWith(fresh); };
  q.choices.forEach((c, i) => cWrap.append(choiceTile(c, i, q, save, rerender)));
  card.append(cWrap);

  if (q.choices.length < 4) {
    const add = el('button', 'qz-addchoice');
    add.textContent = '＋ add choice';
    add.addEventListener('click', () => { q.choices.push(blankChoice()); save(); rerender(); });
    card.append(add);
  }
  return card;
}

const CHOICE_SHAPES = ['▲', '◆', '●', '■']; // matches qz-c0..c3 / quiz-home covers

function choiceTile(c, i, q, save, rerender) {
  const tile = el('div', `qz-choice qz-c${i}`);
  const top = el('div', 'qz-choice-top');

  if (c.correct) tile.classList.add('is-correct');

  const shape = el('span', 'qz-shape');
  shape.textContent = CHOICE_SHAPES[i] || '●';
  top.append(shape);

  const correct = el('button', 'qz-correct-btn' + (c.correct ? ' on' : ''));
  correct.textContent = c.correct ? '✓ correct' : 'mark correct';
  correct.addEventListener('click', () => {
    q.choices.forEach((x) => (x.correct = false));
    c.correct = true;
    save();
    rerender();
  });
  top.append(correct);

  if (q.choices.length > 2) {
    const del = el('button', 'qz-c-del');
    del.textContent = '✕';
    del.addEventListener('click', () => { q.choices.splice(i, 1); save(); rerender(); });
    top.append(del);
  }
  tile.append(top);
  contentEditor(tile, c, save, rerender);
  return tile;
}

// Tabbed content editor: one tab per content kind (text / math / code / image).
// Only the active kind's inputs show; a dot on the tab marks kinds that hold
// content. Switching tabs never deletes data.
function contentEditor(parent, c, save, rerender) {
  // -- text --
  const secText = el('div', 'qz-sec');
  const text = document.createElement('textarea');
  text.className = 'qz-text'; text.placeholder = 'text'; text.value = c.text || ''; text.rows = 1;
  text.addEventListener('input', () => { c.text = text.value; autosize(text); save(); syncDots(); });
  secText.append(text);

  // -- math --
  const secMath = el('div', 'qz-sec');
  const latex = document.createElement('input');
  latex.className = 'qz-latex'; latex.placeholder = 'LaTeX  e.g.  x^2 + 2x + 1'; latex.value = c.latex || '';
  const prev = el('div', 'qz-latex-prev');
  if (c.latex) renderLatex(prev, c.latex);
  latex.addEventListener('input', () => {
    c.latex = latex.value;
    if (latex.value) renderLatex(prev, latex.value); else prev.innerHTML = '';
    save(); syncDots();
  });
  secMath.append(latex, prev);

  // -- code --
  const secCode = el('div', 'qz-sec');
  const langRow = el('div', 'qz-langrow');
  const langSel = document.createElement('select');
  langSel.className = 'qz-lang';
  LANGS.forEach((l) => { const o = document.createElement('option'); o.value = l; o.textContent = l || 'auto-detect'; langSel.appendChild(o); });
  langSel.value = c.lang || '';
  langSel.addEventListener('change', () => { c.lang = langSel.value; save(); });
  langRow.append(spanLabel('language'), langSel);
  const code = document.createElement('textarea');
  code.className = 'qz-code'; code.placeholder = 'code block (monospace, keeps indentation)';
  code.value = c.code || ''; code.rows = 1; code.spellcheck = false;
  code.addEventListener('input', () => { c.code = code.value; autosize(code); save(); syncDots(); });
  code.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const s = code.selectionStart, en = code.selectionEnd;
    code.value = code.value.slice(0, s) + '  ' + code.value.slice(en);
    code.selectionStart = code.selectionEnd = s + 2;
    c.code = code.value; autosize(code); save(); syncDots();
  });
  secCode.append(langRow, code);

  // -- image --
  const secImg = el('div', 'qz-sec');
  const row = el('div', 'qz-img-row');
  const btn = el('button', 'qz-img-btn');
  btn.textContent = c.image ? 'change image' : '＋ image';
  const file = document.createElement('input');
  file.type = 'file'; file.accept = 'image/*'; file.hidden = true;
  const thumb = document.createElement('img');
  thumb.className = 'qz-img-thumb';
  if (c.image) thumb.src = c.image; else thumb.style.display = 'none';
  btn.addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const f = file.files[0]; file.value = '';
    if (!f) return;
    // downscale on insert: keeps IndexedDB lean AND live broadcasts under
    // the payload cap (raw phone photos are 3-10MB of base64)
    c.image = await shrinkImage(await readDataURL(f));
    thumb.src = c.image; thumb.style.display = '';
    btn.textContent = 'change image'; save();
    if (rerender) rerender();
  });
  row.append(btn, thumb);
  if (c.image) {
    const rm = el('button', 'qz-img-rm');
    rm.textContent = 'remove';
    rm.addEventListener('click', () => { c.image = null; save(); if (rerender) rerender(); });
    row.append(rm);
  }
  secImg.append(row, file);

  // -- tabs --
  const KINDS = [
    ['text', secText, () => !!c.text],
    ['math', secMath, () => !!c.latex],
    ['code', secCode, () => !!c.code],
    ['image', secImg, () => !!c.image],
  ];
  const tabs = el('div', 'qz-tabs');
  const tabBtns = new Map();
  const setActive = (key) => {
    for (const [k, sec] of KINDS.map(([k, s]) => [k, s])) {
      sec.hidden = k !== key;
      tabBtns.get(k).classList.toggle('active', k === key);
    }
    // autosize needs visible textareas
    requestAnimationFrame(() => {
      if (key === 'text') autosize(text);
      if (key === 'code') autosize(code);
    });
  };
  const syncDots = () => {
    for (const [k, , has] of KINDS) tabBtns.get(k).classList.toggle('has', has());
  };
  for (const [k] of KINDS) {
    const b = el('button', 'qz-tab');
    b.type = 'button';
    b.innerHTML = `${k}<span class="qz-tab-dot"></span>`;
    b.addEventListener('click', () => setActive(k));
    tabBtns.set(k, b);
    tabs.append(b);
  }
  parent.append(tabs, secText, secMath, secCode, secImg);
  syncDots();
  setActive((KINDS.find(([, , has]) => has()) || KINDS[0])[0]);
}

function el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }
function label(t) { const e = el('div', 'qz-label'); e.textContent = t; return e; }
function spanLabel(t) { const e = el('span', 'qz-sublabel'); e.textContent = t; return e; }
function moveBtn(glyph, title, fn) {
  const b = el('button', 'qz-move'); b.textContent = glyph; b.title = title;
  b.addEventListener('click', fn);
  return b;
}
function autosize(t) { t.style.height = 'auto'; t.style.height = Math.max(36, t.scrollHeight) + 'px'; }
function numField(name, val, min, max, onChange) {
  const l = document.createElement('label'); l.className = 'qz-num';
  l.append(document.createTextNode(name + ' '));
  const inp = document.createElement('input');
  inp.type = 'number'; inp.min = min; inp.max = max; inp.value = val;
  inp.addEventListener('change', () => onChange(Math.max(min, Math.min(max, Number(inp.value) || min))));
  l.append(inp);
  return l;
}
