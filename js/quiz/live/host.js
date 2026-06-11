// Live game HOST — authoritative state machine + control-room UI.
// The host's browser owns the timer, validates answers, computes scores.
// Players are thin clients fed by broadcast messages (see protocol.js).
//
// Phases: lobby -> question -> reveal -> leaderboard -> ... -> podium.
// Reveal fires automatically when the timer ends or everyone answered;
// every other transition is the host pressing "next".

import { validQuestions } from '../quizModel.js';
import { renderContent } from '../katex.js';
import { buildTile } from '../tiles.js';
import { genCode, questionForWire, correctSet, csvFromGame } from './protocol.js';
import { openChannel, configured } from './net.js';
import { MAX_PLAYERS } from './config.js';
import { loadQuiz } from '../quizLib.js';
import { modalAlert, modalConfirm } from '../../ui/modal.js';
import { downloadBlob, safeName } from '../../export/download.js';

const SNAP_KEY = 'wb-live-host';
const GRACE_MS = 500;
const QR_SDK = 'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/+esm';

let root = null;        // #livegame
let ch = null;          // channel handle
let g = null;           // game state
let tick = null;        // countdown interval

const now = () => Date.now();
const div = (cls, html) => { const d = document.createElement('div'); d.className = cls; if (html !== undefined) d.innerHTML = html; return d; };

// ---------------------------------------------------------------- lifecycle
export async function hostQuiz(doc) {
  if (!configured()) {
    modalAlert({ title: 'Live not configured', message: 'Fill in js/quiz/live/config.js with your Supabase URL + anon key first.' });
    return;
  }
  const questions = validQuestions(doc);
  if (!questions.length) {
    modalAlert({ title: 'Nothing to host', message: 'This quiz has no question with a marked correct answer yet.' });
    return;
  }
  await startGame({
    code: genCode(), quizId: doc.id, title: doc.title, questions,
    phase: 'lobby', qIdx: -1, players: new Map(),
  });
}

// Resume a host session after a tab reload (called once at boot).
export async function resumeHostIfAny() {
  let snap = null;
  try { snap = JSON.parse(sessionStorage.getItem(SNAP_KEY) || 'null'); } catch { /* corrupt */ }
  if (!snap || !configured()) return;
  const doc = await loadQuiz(snap.quizId).catch(() => null);
  if (!doc) { sessionStorage.removeItem(SNAP_KEY); return; }
  const questions = validQuestions(doc);
  await startGame({
    code: snap.code, quizId: doc.id, title: doc.title, questions,
    phase: snap.phase === 'question' ? 'reveal' : snap.phase, // mid-question timing is lost — land on reveal
    qIdx: snap.qIdx,
    players: new Map(snap.players.map((p) => [p.id, p])),
    resumed: true,
  });
}

async function startGame(state) {
  g = {
    ...state,
    answers: new Map(),   // current question: playerId -> {choice, ms}
    qStart: 0, deadline: 0, wireQ: null,
  };
  root = document.getElementById('livegame');
  root.style.display = 'block';
  root.innerHTML = '';
  renderShell();
  setStatus('connecting…');
  try {
    ch = await openChannel(g.code, {
      key: 'host',
      meta: { role: 'host' },
      onMessage,
      onPresence: syncRoster,
      // fires before `ch` is assigned on the FIRST subscribe (broadcastSync
      // no-ops then); real purpose is resync after auto-RE-subscribes.
      onStatus: (s) => { if (s === 'SUBSCRIBED') { setStatus(''); broadcastSync(); } },
    });
    setStatus('');
    broadcastSync(); // initial state announcement — ch is assigned now
  } catch (e) {
    modalAlert({ title: 'Connection failed', message: String(e.message || e) });
    closeHost();
    return;
  }
  if (g.phase === 'lobby') renderLobby();
  else if (g.phase === 'reveal') { computeRevealFromAnswers(); renderReveal(); broadcastSync(); }
  else if (g.phase === 'leaderboard') { renderLeaderboard(); broadcastSync(); }
  else if (g.phase === 'podium') { renderPodium(); broadcastSync(); }
  snapshot();
}

function closeHost() {
  clearInterval(tick); tick = null;
  ch?.leave(); ch = null;
  sessionStorage.removeItem(SNAP_KEY);
  if (root) { root.style.display = 'none'; root.innerHTML = ''; }
  g = null;
}

function snapshot() {
  if (!g) return;
  try {
    sessionStorage.setItem(SNAP_KEY, JSON.stringify({
      code: g.code, quizId: g.quizId, phase: g.phase, qIdx: g.qIdx,
      players: [...g.players.values()],
    }));
  } catch { /* quota */ }
}

// ---------------------------------------------------------------- messages
function onMessage(m) {
  if (!g || !m || !m.t) return;
  if (m.t === 'hello') onHello(m);
  else if (m.t === 'answer') onAnswer(m);
}

function onHello(m) {
  if (!m.id || !m.nick) return;
  let p = g.players.get(m.id);
  if (!p) {
    if (g.players.size >= MAX_PLAYERS) { ch.send({ t: 'rejected', id: m.id, reason: 'room full' }); return; }
    // unique nickname: clash -> -2, -3…
    let nick = String(m.nick).trim().slice(0, 16) || 'player';
    const taken = new Set([...g.players.values()].map((x) => x.nick));
    let n = 2, base = nick;
    while (taken.has(nick)) nick = `${base}-${n++}`;
    p = { id: m.id, nick, score: 0, correct: 0, answers: {} };
    g.players.set(m.id, p);
  }
  snapshot();
  broadcastSync();          // doubles as the join ack (carries roster + phase)
  if (g.phase === 'lobby') renderLobby(); else syncRosterUI();
}

function onAnswer(m) {
  if (g.phase !== 'question') return;
  const p = g.players.get(m.id);
  if (!p || m.q !== g.qIdx) return;
  if (g.answers.has(m.id)) return;                       // first answer locks
  const ms = now() - g.qStart;
  if (now() > g.deadline + GRACE_MS) return;             // too late
  const choice = Number(m.c);
  if (!Number.isInteger(choice) || choice < 0 || choice >= g.wireQ.choices.length) return;
  g.answers.set(m.id, { choice, ms });
  updateAnswerCount();
  // everyone in -> end early
  if (g.answers.size >= g.players.size && g.players.size > 0) endQuestion();
}

// sync carries everything a (re)joining client needs to land mid-game
function broadcastSync() {
  if (!ch || !g) return;
  ch.send({
    t: 'sync',
    phase: g.phase, q: g.qIdx, total: g.questions.length,
    roster: rosterPayload(),
    question: g.phase === 'question' ? g.wireQ : null,
    remaining: g.phase === 'question' ? Math.max(0, g.deadline - now()) : 0,
    reveal: g.phase === 'reveal' || g.phase === 'leaderboard' ? g.lastReveal : null,
    title: g.title,
  });
}

const rosterPayload = () =>
  [...g.players.values()]
    .sort((a, b) => b.score - a.score)
    .map((p, i) => ({ id: p.id, nick: p.nick, score: p.score, correct: p.correct, rank: i + 1 }));

// ---------------------------------------------------------------- phases
async function startQuestion(i) {
  g.qIdx = i;
  g.phase = 'question';
  g.answers = new Map();
  const q = g.questions[i];
  setStatus('preparing question…');
  g.wireQ = await questionForWire(q);   // sanitized: no correct flags
  setStatus('');
  g.qStart = now();
  g.deadline = g.qStart + q.time * 1000;
  ch.send({ t: 'question_start', q: i, total: g.questions.length, question: g.wireQ });
  renderQuestionCtl();
  snapshot();
  clearInterval(tick);
  tick = setInterval(() => {
    const left = g.deadline - now();
    updateTimerUI(Math.max(0, left));
    if (left <= -GRACE_MS) endQuestion();
  }, 100);
}

function endQuestion() {
  if (g.phase !== 'question') return;
  clearInterval(tick); tick = null;
  g.phase = 'reveal';
  computeRevealFromAnswers(true);
  ch.send({ t: 'reveal', q: g.qIdx, ...g.lastReveal, roster: rosterPayload() });
  renderReveal();
  snapshot();
}

// Score the collected answers (apply=true) or just rebuild the reveal payload
// after a host resume (answers were lost with the tab — counts go empty).
function computeRevealFromAnswers(apply = false) {
  const q = g.questions[g.qIdx] || g.questions[0];
  const correct = [...correctSet(q)];
  const counts = new Array((g.wireQ?.choices.length) || q.choices.length).fill(0);
  if (apply) {
    for (const [pid, a] of g.answers) {
      const p = g.players.get(pid);
      if (!p) continue;
      counts[a.choice]++;
      const ok = correct.includes(a.choice);
      const frac = Math.max(0, 1 - a.ms / (q.time * 1000));
      const delta = ok ? Math.round(q.points * (0.5 + 0.5 * frac)) : 0; // same curve as solo play
      if (ok) { p.score += delta; p.correct++; }
      p.answers[g.qIdx] = { ok, delta, choice: a.choice };
    }
  }
  g.lastReveal = { correct, counts };
}

function nextPhase() {
  if (g.phase === 'lobby') { startQuestion(0); return; }
  if (g.phase === 'reveal') {
    g.phase = 'leaderboard';
    ch.send({ t: 'leaderboard', roster: rosterPayload(), q: g.qIdx, total: g.questions.length });
    renderLeaderboard();
    snapshot();
    return;
  }
  if (g.phase === 'leaderboard') {
    if (g.qIdx + 1 < g.questions.length) startQuestion(g.qIdx + 1);
    else {
      g.phase = 'podium';
      ch.send({ t: 'podium', roster: rosterPayload() });
      renderPodium();
      snapshot();
    }
  }
}

// ---------------------------------------------------------------- UI
function renderShell() {
  root.innerHTML = `
    <div class="lv lv-host">
      <div class="lv-top">
        <span class="lv-brand">live · ${escapeHtml(g.title)}</span>
        <span class="lv-code-chip">room <b>${g.code}</b></span>
        <span class="lv-status"></span>
        <span class="lv-spacer"></span>
        <button class="lv-ghost lv-end">end game</button>
      </div>
      <div class="lv-stage"></div>
    </div>`;
  root.querySelector('.lv-end').addEventListener('click', async () => {
    if (await modalConfirm({ title: 'End game', message: 'Close the room for all players?', confirmText: 'End', danger: true })) {
      ch?.send({ t: 'game_over' });
      closeHost();
    }
  });
}

const stage = () => root.querySelector('.lv-stage');
const setStatus = (s) => { const el = root?.querySelector('.lv-status'); if (el) el.textContent = s; };

function syncRoster() { /* presence: roster UI only; membership truth = hello */ if (g?.phase === 'lobby') renderLobby(); }
function syncRosterUI() { const el = stage().querySelector('.lv-count'); if (el) el.textContent = `${g.players.size} player${g.players.size === 1 ? '' : 's'}`; }

function renderLobby() {
  const s = stage();
  s.innerHTML = '';
  const joinUrl = `${location.origin}${location.pathname}#join/${g.code}`;
  const box = div('lv-lobby');
  box.append(div('lv-h1', 'waiting for players…'));
  const codeEl = div('lv-bigcode', g.code);
  box.append(codeEl);
  const link = div('lv-joinlink');
  link.innerHTML = `<a href="${joinUrl}" target="_blank" rel="noopener">${joinUrl}</a>`;
  box.append(link);
  const qr = div('lv-qr');
  box.append(qr);
  drawQR(qr, joinUrl);
  box.append(div('lv-count', `${g.players.size} player${g.players.size === 1 ? '' : 's'}`));
  const roster = div('lv-roster');
  for (const p of g.players.values()) roster.append(div('lv-nick', escapeHtml(p.nick)));
  box.append(roster);
  const start = button('start game →', 'lv-primary', nextPhase);
  start.disabled = g.players.size === 0;
  box.append(start);
  s.append(box);
}

async function drawQR(el, text) {
  try {
    const QR = await import(QR_SDK);
    const cv = document.createElement('canvas');
    await (QR.toCanvas || QR.default?.toCanvas)(cv, text, { width: 180, margin: 1 });
    el.append(cv);
  } catch { /* QR is sugar — the link above still works */ }
}

function renderQuestionCtl() {
  const s = stage();
  s.innerHTML = '';
  const q = g.wireQ;
  const head = div('lv-qhead');
  head.innerHTML = `
    <span class="qp-pill">${g.qIdx + 1} / ${g.questions.length}</span>
    <span class="qp-time lv-time">${Math.ceil((g.deadline - now()) / 1000)}s</span>
    <span class="qp-pill lv-anscount">0 / ${g.players.size} answered</span>
    <button class="lv-ghost lv-skip">end question now</button>`;
  s.append(head);
  head.querySelector('.lv-skip').addEventListener('click', endQuestion);
  const qBox = div('qp-question lv-qbox');
  renderContent(qBox, q.question);
  s.append(qBox);
  // full choice tiles like the players see — read-only; counts stay hidden
  // until reveal (this screen may be on a projector)
  const grid = div('qp-choices lv-static');
  q.choices.forEach((c, i) => grid.append(buildTile(c, i, {})));
  s.append(grid);
}

function updateTimerUI(leftMs) {
  const el = stage().querySelector('.lv-time');
  if (el) {
    el.textContent = Math.ceil(leftMs / 1000) + 's';
    el.classList.toggle('low', leftMs < (g.questions[g.qIdx].time * 1000) * 0.25);
  }
}

function updateAnswerCount() {
  const el = stage().querySelector('.lv-anscount');
  if (el) el.textContent = `${g.answers.size} / ${g.players.size} answered`;
}

function renderReveal() {
  const s = stage();
  s.innerHTML = '';
  s.append(div('lv-h1', `answers — question ${g.qIdx + 1}`));
  if (g.wireQ) {
    const qBox = div('qp-question lv-qbox');
    renderContent(qBox, g.wireQ.question);
    s.append(qBox);
  }
  const counts = g.lastReveal?.counts || [];
  const grid = div('qp-choices lv-static');
  (g.wireQ?.choices || []).forEach((c, i) => {
    const t = buildTile(c, i, {});
    t.classList.add(g.lastReveal?.correct.includes(i) ? 'qp-correct' : 'qp-dim');
    const badge = div('lv-count-badge', String(counts[i] || 0));
    t.append(badge);
    grid.append(t);
  });
  s.append(grid);
  s.append(button('leaderboard →', 'lv-primary', nextPhase));
}

function renderLeaderboard() {
  const s = stage();
  s.innerHTML = '';
  s.append(div('lv-h1', 'leaderboard'));
  const list = div('lv-board');
  rosterPayload().slice(0, 5).forEach((p) => {
    list.append(div('lv-row', `<span class="lv-rank">#${p.rank}</span><span class="lv-nick">${escapeHtml(p.nick)}</span><span class="lv-pts">${p.score}</span>`));
  });
  s.append(list);
  const last = g.qIdx + 1 >= g.questions.length;
  s.append(button(last ? 'final results →' : `question ${g.qIdx + 2} →`, 'lv-primary', nextPhase));
}

function renderPodium() {
  const s = stage();
  s.innerHTML = '';
  s.append(div('lv-h1', '🏆 final standings'));
  const list = div('lv-board lv-podium');
  rosterPayload().forEach((p) => {
    list.append(div('lv-row' + (p.rank <= 3 ? ` lv-top${p.rank}` : ''),
      `<span class="lv-rank">#${p.rank}</span><span class="lv-nick">${escapeHtml(p.nick)}</span><span class="lv-pts">${p.score}</span>`));
  });
  s.append(list);
  const row = div('lv-actions');
  row.append(
    button('export CSV', 'lv-ghost', () => {
      const csv = csvFromGame(g.players, g.questions.length);
      downloadBlob(new Blob([csv], { type: 'text/csv' }), `${safeName(g.title)}-results.csv`);
    }),
    button('close room', 'lv-primary', () => { ch?.send({ t: 'game_over' }); closeHost(); }),
  );
  s.append(row);
}

function button(label, cls, fn) {
  const b = document.createElement('button');
  b.className = cls;
  b.textContent = label;
  b.addEventListener('click', fn);
  return b;
}

function escapeHtml(s) { return String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])); }
