// Live game PLAYER — join form (#join route) + thin-client play screens.
// All truth comes from host broadcasts; we send only `hello` and `answer`.

import { renderContent } from '../katex.js';
import { buildTile } from '../tiles.js';
import { validCode } from './protocol.js';
import { openChannel, configured } from './net.js';

const SESS_KEY = 'wb-live-player';
const HOST_GONE_MS = 15_000;

let root = null;       // #livegame
let ch = null;
let st = null;         // { code, id, nick, phase, qIdx, total, roster, myAnswer, deadline }
let tick = null, hostWatch = null, hostMissingSince = 0;
let uiOpen = false;    // join form or player client owns #livegame right now

const div = (cls, html) => { const d = document.createElement('div'); d.className = cls; if (html !== undefined) d.innerHTML = html; return d; };
const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const now = () => Date.now();

// ---------------------------------------------------------------- join form
export function openJoin(prefillCode = '') {
  root = document.getElementById('livegame');
  root.style.display = 'block';
  uiOpen = true;
  let saved = {};
  try { saved = JSON.parse(sessionStorage.getItem(SESS_KEY) || '{}'); } catch { /* corrupt */ }
  root.innerHTML = `
    <div class="lv lv-join">
      <div class="lv-join-card">
        <div class="lv-brand-big">join a quiz</div>
        ${configured() ? '' : '<div class="lv-warn">live play is not configured on this deployment</div>'}
        <label class="lv-label">room code</label>
        <input class="lv-input lv-code" maxlength="6" autocapitalize="characters" spellcheck="false"
               placeholder="ABC123" value="${esc(prefillCode || saved.code || '')}">
        <label class="lv-label">nickname</label>
        <input class="lv-input lv-nick" maxlength="16" placeholder="your name" value="${esc(saved.nick || '')}">
        <div class="lv-err" hidden></div>
        <button class="lv-primary lv-go">join →</button>
        <button class="lv-ghost lv-leave-join">← back to app</button>
      </div>
    </div>`;
  const codeEl = root.querySelector('.lv-code');
  const nickEl = root.querySelector('.lv-nick');
  const err = root.querySelector('.lv-err');
  const go = async () => {
    const code = codeEl.value.trim().toUpperCase();
    const nick = nickEl.value.trim().slice(0, 16);
    if (!validCode(code)) { err.textContent = 'code is 6 letters/numbers'; err.hidden = false; return; }
    if (!nick) { err.textContent = 'pick a nickname'; err.hidden = false; return; }
    err.hidden = true;
    root.querySelector('.lv-go').disabled = true;
    try { await joinGame(code, nick, saved); }
    catch (e) {
      err.textContent = 'could not connect: ' + (e.message || e);
      err.hidden = false;
      root.querySelector('.lv-go').disabled = false;
    }
  };
  root.querySelector('.lv-go').addEventListener('click', go);
  nickEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  codeEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') nickEl.focus(); });
  root.querySelector('.lv-leave-join').addEventListener('click', () => { closePlayer(); location.hash = 'lib'; });
  (prefillCode ? nickEl : codeEl).focus();
}

// ---------------------------------------------------------------- connect
async function joinGame(code, nick, saved) {
  // reuse the saved playerId for the SAME room so a refresh reclaims the score
  const id = (saved.code === code && saved.id) ? saved.id : 'p' + crypto.getRandomValues(new Uint32Array(2)).join('');
  sessionStorage.setItem(SESS_KEY, JSON.stringify({ code, nick, id }));
  st = { code, id, nick, phase: 'lobby', qIdx: -1, total: 0, roster: [], myAnswer: null, deadline: 0, title: '' };
  ch = await openChannel(code, {
    key: id,
    meta: { role: 'player', nick },
    onMessage,
    onPresence: watchHost,
    onStatus: (s) => { if (s === 'SUBSCRIBED') hello(); },
  });
  renderShell();
  renderWait('joined — waiting for the host…');
  startHostWatch();
}

const hello = () => ch?.send({ t: 'hello', id: st.id, nick: st.nick });

export function closePlayer() {
  if (!uiOpen) return; // never clobber a HOST session sharing #livegame
  uiOpen = false;
  clearInterval(tick); tick = null;
  clearInterval(hostWatch); hostWatch = null;
  ch?.leave(); ch = null;
  st = null;
  if (root) { root.style.display = 'none'; root.innerHTML = ''; }
}

// ---------------------------------------------------------------- host watch
function watchHost(presence) {
  const hostThere = Object.values(presence || {}).some((arr) => arr.some((m) => m.role === 'host'));
  hostMissingSince = hostThere ? 0 : (hostMissingSince || now());
}

function startHostWatch() {
  clearInterval(hostWatch);
  hostMissingSince = 0;
  hostWatch = setInterval(() => {
    if (st && hostMissingSince && now() - hostMissingSince > HOST_GONE_MS) {
      clearInterval(hostWatch); hostWatch = null;
      renderGone('the host left the game');
    }
  }, 2000);
}

// ---------------------------------------------------------------- messages
function onMessage(m) {
  if (!st || !m || !m.t) return;
  switch (m.t) {
    case 'rejected':
      if (m.id === st.id) renderGone(m.reason === 'room full' ? 'room is full (30 players)' : 'join rejected');
      break;
    case 'sync': applySync(m); break;
    case 'question_start': startQuestion(m); break;
    case 'reveal': showReveal(m); break;
    case 'leaderboard': st.roster = m.roster; st.phase = 'leaderboard'; renderBoard('leaderboard', m.roster.slice(0, 5)); break;
    case 'podium': st.roster = m.roster; st.phase = 'podium'; renderBoard('🏆 final standings', m.roster, true); break;
    case 'game_over': renderGone('the host closed the room'); break;
  }
}

function applySync(m) {
  st.total = m.total; st.title = m.title || '';
  st.roster = m.roster || [];
  if (m.phase === 'question' && m.question && m.q !== st.qIdx) {
    startQuestion({ q: m.q, total: m.total, question: m.question, remaining: m.remaining });
  } else if (m.phase === 'lobby') {
    st.phase = 'lobby';
    renderWait(`in the lobby — ${st.roster.length} player${st.roster.length === 1 ? '' : 's'} (you: ${esc(st.nick)})`);
  } else if (m.phase === 'reveal' && m.reveal) {
    showReveal({ q: m.q, ...m.reveal, roster: m.roster });
  } else if (m.phase === 'leaderboard') {
    renderBoard('leaderboard', st.roster.slice(0, 5));
  } else if (m.phase === 'podium') {
    renderBoard('🏆 final standings', st.roster, true);
  }
}

// ---------------------------------------------------------------- screens
function renderShell() {
  root.innerHTML = `
    <div class="lv lv-player">
      <div class="lv-top">
        <span class="lv-brand">${esc(st.nick)}</span>
        <span class="lv-code-chip">room <b>${st.code}</b></span>
        <span class="qp-pill lv-myscore">★ 0</span>
        <span class="lv-spacer"></span>
        <button class="lv-ghost lv-leave">leave</button>
      </div>
      <div class="lv-stage"></div>
    </div>`;
  root.querySelector('.lv-leave').addEventListener('click', () => { closePlayer(); location.hash = 'lib'; });
}

const stage = () => root.querySelector('.lv-stage');

function myScore() {
  const me = st.roster.find((p) => p.id === st.id);
  return me ? me.score : 0;
}
function myRank() {
  const me = st.roster.find((p) => p.id === st.id);
  return me ? me.rank : null;
}
function syncScoreChip() {
  const el = root.querySelector('.lv-myscore');
  if (el) el.textContent = '★ ' + myScore();
}

function renderWait(msg) {
  stage().innerHTML = '';
  stage().append(div('lv-wait', esc(msg)));
}

function renderGone(msg) {
  clearInterval(tick); tick = null;
  stage().innerHTML = '';
  const box = div('lv-wait lv-gone');
  box.append(div('lv-h1', esc(msg)));
  const b = document.createElement('button');
  b.className = 'lv-primary';
  b.textContent = 'leave';
  b.addEventListener('click', () => { closePlayer(); location.hash = 'lib'; });
  box.append(b);
  stage().append(box);
}

function startQuestion(m) {
  st.phase = 'question';
  st.qIdx = m.q;
  st.myAnswer = null;
  const q = m.question;
  const durMs = (m.remaining !== undefined && m.remaining > 0) ? m.remaining : q.time * 1000;
  st.deadline = now() + durMs;

  const s = stage();
  s.innerHTML = '';
  const bar = div('qp-bar'); const fill = div('qp-bar-fill'); bar.append(fill); s.append(bar);
  const head = div('qp-head');
  head.innerHTML = `<span class="qp-pill">${m.q + 1} / ${m.total}</span><span class="qp-time">${Math.ceil(durMs / 1000)}s</span>`;
  s.append(head);
  const timeEl = head.querySelector('.qp-time');
  const qBox = div('qp-question');
  renderContent(qBox, q.question);
  s.append(qBox);

  const grid = div('qp-choices');
  const tiles = q.choices.map((c, i) => {
    const t = buildTile(c, i, {
      onPick: () => {
        if (st.myAnswer !== null || now() > st.deadline) return;
        st.myAnswer = i;
        ch.send({ t: 'answer', id: st.id, q: st.qIdx, c: i });
        tiles.forEach((x, xi) => x.classList.toggle('qp-dim', xi !== i));
        t.classList.add('lv-picked');
        s.append(div('lv-wait lv-locked', 'answer locked — waiting for everyone…'));
      },
    });
    grid.append(t);
    return t;
  });
  s.append(grid);

  const total = durMs;
  clearInterval(tick);
  tick = setInterval(() => {
    const left = Math.max(0, st.deadline - now());
    fill.style.width = (left / total * 100) + '%';
    timeEl.textContent = Math.ceil(left / 1000) + 's';
    const low = left / total < 0.25;
    fill.classList.toggle('low', low);
    timeEl.classList.toggle('low', low);
    if (left <= 0) {
      clearInterval(tick); tick = null;
      if (st.myAnswer === null) stage().append(div('lv-wait lv-locked', "time's up — waiting for results…"));
    }
  }, 80);
}

function showReveal(m) {
  clearInterval(tick); tick = null;
  st.phase = 'reveal';
  if (m.roster) st.roster = m.roster;
  syncScoreChip();
  const mine = st.myAnswer;
  const ok = mine !== null && (m.correct || []).includes(mine);
  const s = stage();
  s.innerHTML = '';
  const box = div('lv-verdict-box');
  box.append(div(`qp-verdict ${ok ? 'ok' : 'no'}`, ok ? 'Correct!' : (mine === null ? 'No answer' : 'Wrong')));
  if (myRank()) box.append(div('qp-pill', `you're #${myRank()} · ★ ${myScore()}`));
  box.append(div('lv-wait', 'waiting for the host…'));
  s.append(box);
}

function renderBoard(title, rows, isFinal = false) {
  syncScoreChip();
  const s = stage();
  s.innerHTML = '';
  s.append(div('lv-h1', title));
  const list = div('lv-board' + (isFinal ? ' lv-podium' : ''));
  rows.forEach((p) => {
    list.append(div('lv-row' + (p.id === st.id ? ' me' : '') + (isFinal && p.rank <= 3 ? ` lv-top${p.rank}` : ''),
      `<span class="lv-rank">#${p.rank}</span><span class="lv-nick">${esc(p.nick)}</span><span class="lv-pts">${p.score}</span>`));
  });
  s.append(list);
  if (myRank() && !rows.some((p) => p.id === st.id)) {
    s.append(div('qp-pill', `you're #${myRank()} · ★ ${myScore()}`));
  }
  if (!isFinal) s.append(div('lv-wait', 'waiting for the host…'));
}
