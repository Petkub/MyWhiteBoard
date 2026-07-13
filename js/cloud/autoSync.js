// Auto-sync: signed-in users get hands-free cloud sync of notebooks.
//   push  — debounced (10s quiet) after local edits; also on tab-hide.
//   pull  — opening a notebook fetches the cloud copy when it's newer.
//   live  — Supabase Realtime channel `sync:<uid>` broadcasts pushes, so a
//           second device refreshes: open+clean notebook silently reloads,
//           anything else just refreshes the library grid.
// Conflict rule stays last-write-wins (newest `updated` survives). A dirty
// local notebook is never clobbered by a live event — its own later push
// wins instead. Boot does ZERO network unless a Supabase session token is
// already in localStorage (or the user logs in via the cloud panel).

import { SUPABASE_URL } from '../quiz/live/config.js';
import { supa, configured } from './supa.js';
import { pushNotebook, pullNotebook, cloudUpdated, currentUser } from './sync.js';
import { getNotebook, putNotebook } from '../store/db.js';

const PUSH_DELAY = 10000;
const LS_KEY = 'wb-sync'; // { [nbId]: updated } — last value both sides agreed on

let cb = { openNotebookId: () => null, applyPulled: () => {}, libraryChanged: () => {}, status: () => {} };
let user = null, started = false, ch = null, chUid = null, pushTimer = 0;

let lastSynced = {};
try { lastSynced = JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { /* fresh */ }
const remember = (id, updated) => { lastSynced[id] = updated; localStorage.setItem(LS_KEY, JSON.stringify(lastSynced)); };
export const markSynced = remember; // manual pushes/pulls keep auto-sync honest

export function initAutoSync(callbacks) {
  cb = { ...cb, ...callbacks };
  // supabase-js persists its session under sb-<ref>-auth-token; only wake the
  // SDK when one exists so signed-out users never touch the CDN/network
  const ref = new URL(SUPABASE_URL).hostname.split('.')[0];
  if (configured() && localStorage.getItem(`sb-${ref}-auth-token`)) start();
}

export function notifyLogin() { start(); }
export function notifyLogout() { user = null; closeChannel(); }

async function start() {
  if (started || !configured()) return;
  started = true;
  const sb = await supa();
  user = (await sb.auth.getSession()).data.session?.user || null;
  sb.auth.onAuthStateChange((_ev, session) => {
    user = session?.user || null;
    user ? openChannelFor(user) : closeChannel();
  });
  if (user) openChannelFor(user);
}

function openChannelFor(u) {
  if (chUid === u.id) return;
  closeChannel();
  chUid = u.id;
  supa().then((sb) => {
    ch = sb.channel('sync:' + u.id, { config: { broadcast: { self: false } } });
    ch.on('broadcast', { event: 'nb' }, ({ payload }) => onRemote(payload).catch(() => {}));
    ch.subscribe();
  });
}

function closeChannel() {
  if (ch) { supa().then((sb) => sb.removeChannel(ch)); ch = null; }
  chUid = null;
}

// ---- push (debounced after local edits) ----
export function scheduleCloudPush() {
  if (!user) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { firePush(); }, PUSH_DELAY);
}

async function firePush() {
  clearTimeout(pushTimer);
  const id = cb.openNotebookId();
  if (!user || !id) return;
  const nb = await getNotebook(id);
  if (!nb || (lastSynced[id] || 0) >= nb.updated) return; // nothing new
  cb.status('☁ syncing…');
  try {
    await pushNotebook(nb);
    remember(id, nb.updated);
    ch?.send({ type: 'broadcast', event: 'nb', payload: { id, updated: nb.updated } });
    cb.status('☁ synced');
  } catch {
    cb.status('☁ sync failed');
  }
}

// Tab hidden / closing — best-effort immediate push of pending edits.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && pushTimer) firePush();
});

// ---- pull on open (called from the editor route) ----
// Returns the freshest record: the cloud copy replaces local when strictly
// newer; a locally-newer copy stays (its own push follows).
export async function maybePullNewer(nb) {
  if (!user) return nb;
  try {
    const remote = await cloudUpdated(nb.id);
    if (remote <= (nb.updated || 0)) return nb;
    const full = await pullNotebook(nb.id);
    await putNotebook(full);
    remember(nb.id, full.updated);
    cb.status('☁ pulled');
    return full;
  } catch {
    return nb;
  }
}

// ---- live event from another device ----
async function onRemote({ id }) {
  if (!id) return;
  if (id === cb.openNotebookId()) {
    const local = await getNotebook(id);
    const clean = !local || (lastSynced[id] || 0) >= (local.updated || 0);
    if (!clean) return; // local edits pending — this device's push wins later
    const full = await pullNotebook(id);
    await putNotebook(full);
    remember(id, full.updated);
    cb.applyPulled(full);
  } else {
    cb.libraryChanged();
  }
}

export const syncUser = () => user;
export { currentUser };
