// Cloud panel — sign in / account view + the list of notebooks stored in
// Supabase ("☁ cloud" in the library header). Pulls overwrite the local copy
// (confirmed when one exists); pushes happen from the notebook card ⋯ menu.
// Own backdrop DOM, reusing the .modal-* styles from ui/modal.js.

import { configured } from './supa.js';
import {
  currentUser, signIn, signUp, signOut,
  listCloud, pullNotebook, deleteCloud,
} from './sync.js';
import { getNotebook, putNotebook } from '../store/db.js';
import { modalConfirm, modalAlert } from '../ui/modal.js';

let backdrop = null;
let onChanged = () => {};

function ensure() {
  if (backdrop) return;
  backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.hidden = true;
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  document.body.appendChild(backdrop);
}

function close() {
  if (!backdrop) return;
  backdrop.hidden = true;
  backdrop.innerHTML = '';
}

export async function openCloudPanel({ onChange } = {}) {
  onChanged = onChange || (() => {});
  if (!configured()) { modalAlert({ title: 'Cloud sync', message: 'Supabase is not configured (js/quiz/live/config.js).' }); return; }
  ensure();
  backdrop.hidden = false;
  const user = await currentUser().catch(() => null);
  user ? renderList(user) : renderLogin();
}

// ---- sign in / sign up ----
function renderLogin(err = '') {
  backdrop.innerHTML = `
    <div class="modal cl-modal">
      <div class="modal-title">☁ Cloud sync</div>
      <div class="modal-msg">One account, all your devices. Notebooks sync only when you push / pull them.</div>
      <div class="modal-label">email</div>
      <input class="modal-input cl-email" type="email" autocomplete="username">
      <div class="modal-label">password</div>
      <input class="modal-input cl-pass" type="password" autocomplete="current-password">
      <div class="cl-err">${err}</div>
      <div class="modal-actions">
        <button class="modal-btn cl-cancel">Close</button>
        <button class="modal-btn cl-signup">Create account</button>
        <button class="modal-btn modal-confirm cl-signin">Sign in</button>
      </div>
    </div>`;
  const $ = (s) => backdrop.querySelector(s);
  const creds = () => ({ email: $('.cl-email').value.trim(), password: $('.cl-pass').value });
  $('.cl-cancel').addEventListener('click', close);
  $('.cl-signin').addEventListener('click', async () => {
    const c = creds();
    if (!c.email || !c.password) return renderLogin('email + password required');
    try { await signIn(c.email, c.password); renderList(await currentUser()); }
    catch (e) { renderLogin(e.message || 'sign in failed'); }
  });
  $('.cl-signup').addEventListener('click', async () => {
    const c = creds();
    if (!c.email || c.password.length < 6) return renderLogin('password: 6+ characters');
    try {
      const instant = await signUp(c.email, c.password);
      if (instant) renderList(await currentUser());
      else renderLogin('check your email to confirm the account, then sign in');
    } catch (e) { renderLogin(e.message || 'sign up failed'); }
  });
  $('.cl-pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('.cl-signin').click(); });
  $('.cl-email').focus();
}

// ---- cloud notebook list ----
async function renderList(user) {
  backdrop.innerHTML = `
    <div class="modal cl-modal">
      <div class="modal-title">☁ Cloud notebooks</div>
      <div class="cl-account"><span class="cl-mail">${esc(user.email || '')}</span>
        <button class="cl-linkbtn cl-signout">sign out</button></div>
      <div class="cl-list"><div class="cl-empty">loading…</div></div>
      <div class="modal-msg">Push a notebook from its ⋯ menu in the library. Pull overwrites the local copy.</div>
      <div class="modal-actions">
        <button class="modal-btn cl-refresh">↻ refresh</button>
        <button class="modal-btn modal-confirm cl-done">Done</button>
      </div>
    </div>`;
  const $ = (s) => backdrop.querySelector(s);
  $('.cl-done').addEventListener('click', close);
  $('.cl-refresh').addEventListener('click', () => renderList(user));
  $('.cl-signout').addEventListener('click', async () => { await signOut(); renderLogin(); });

  const list = $('.cl-list');
  let items;
  try { items = await listCloud(); }
  catch (e) { list.innerHTML = `<div class="cl-empty">failed: ${esc(e.message || 'error')}</div>`; return; }
  if (!items.length) { list.innerHTML = '<div class="cl-empty">nothing pushed yet</div>'; return; }

  list.innerHTML = '';
  for (const it of items) {
    const row = document.createElement('div');
    row.className = 'cl-row';
    row.innerHTML = `
      <div class="cl-meta">
        <div class="cl-title">${esc(it.title || 'Untitled')}</div>
        <div class="cl-sub">${it.pages || '?'} pages · ${fmtBytes(it.bytes)} · ${fmtDate(it.updated)}</div>
      </div>
      <button class="modal-btn cl-pull">⬇ pull</button>
      <button class="modal-btn cl-del" title="delete cloud copy">✕</button>`;
    row.querySelector('.cl-pull').addEventListener('click', async () => {
      const local = await getNotebook(it.id);
      if (local) {
        const ok = await modalConfirm({
          title: 'Overwrite local copy?',
          message: `"${it.title}" exists on this device (local ${fmtDate(local.updated)}, cloud ${fmtDate(it.updated)}). Pull replaces it.`,
          confirmText: 'Pull', danger: local.updated > (it.updated || 0),
        });
        if (!ok) return;
      }
      try {
        const nb = await pullNotebook(it.id);
        await putNotebook(nb); // keep the cloud record's own `updated`
        onChanged();
        row.querySelector('.cl-pull').textContent = '✓ pulled';
      } catch (e) { modalAlert({ title: 'Pull failed', message: e.message || 'error' }); }
    });
    row.querySelector('.cl-del').addEventListener('click', async () => {
      if (!await modalConfirm({ title: 'Delete cloud copy', message: `Remove "${it.title}" from the cloud? Local copies stay.`, confirmText: 'Delete', danger: true })) return;
      try { await deleteCloud(it.id); row.remove(); }
      catch (e) { modalAlert({ title: 'Delete failed', message: e.message || 'error' }); }
    });
    list.appendChild(row);
  }
}

function fmtBytes(b) {
  if (!b) return '?';
  if (b > 1048576) return (b / 1048576).toFixed(1) + ' MB';
  if (b > 1024) return Math.round(b / 1024) + ' KB';
  return b + ' B';
}
function fmtDate(ts) { return ts ? new Date(ts).toLocaleDateString() + ' ' + new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'; }
function esc(s) { return String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])); }
