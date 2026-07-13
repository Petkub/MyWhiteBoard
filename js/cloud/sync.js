// Cloud sync-lite: MANUAL push/pull of whole notebook records to a private
// Supabase Storage bucket ('notebooks'). One JSON file per notebook at
// <uid>/<notebookId>.json plus <uid>/index.json (id -> {title, updated,
// pages}) so the cloud list shows titles without downloading every notebook.
// No auto-sync, no merge — last push wins; pull overwrites the local copy.

import { supa } from './supa.js';

const BUCKET = 'notebooks';
const nbPath = (uid, id) => `${uid}/${id}.json`;
const ixPath = (uid) => `${uid}/index.json`;

// ---- auth ----
export async function currentUser() {
  const sb = await supa();
  return (await sb.auth.getSession()).data.session?.user || null;
}

export async function signIn(email, password) {
  const sb = await supa();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

// Returns true when a session exists right away (email confirmation off);
// false means Supabase sent a confirmation email first.
export async function signUp(email, password) {
  const sb = await supa();
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) throw error;
  return !!data.session;
}

export async function signOut() {
  const sb = await supa();
  await sb.auth.signOut();
}

// ---- storage ----
async function requireUser() {
  const user = await currentUser();
  if (!user) throw new Error('not signed in');
  return user;
}

async function readIndex(sb, uid) {
  const { data, error } = await sb.storage.from(BUCKET).download(ixPath(uid));
  if (error) return {}; // no index yet
  try { return JSON.parse(await data.text()); } catch { return {}; }
}

async function writeIndex(sb, uid, ix) {
  const blob = new Blob([JSON.stringify(ix)], { type: 'application/json' });
  const { error } = await sb.storage.from(BUCKET).upload(ixPath(uid), blob, { upsert: true, contentType: 'application/json' });
  if (error) throw error;
}

export async function pushNotebook(nb) {
  const sb = await supa();
  const user = await requireUser();
  const blob = new Blob([JSON.stringify(nb)], { type: 'application/json' });
  const { error } = await sb.storage.from(BUCKET).upload(nbPath(user.id, nb.id), blob, { upsert: true, contentType: 'application/json' });
  if (error) throw error;
  const ix = await readIndex(sb, user.id);
  ix[nb.id] = { title: nb.title, updated: nb.updated, pages: nb.pages.length, bytes: blob.size };
  await writeIndex(sb, user.id, ix);
}

// -> [{ id, title, updated, pages, bytes }] newest first
export async function listCloud() {
  const sb = await supa();
  const user = await requireUser();
  const ix = await readIndex(sb, user.id);
  return Object.entries(ix)
    .map(([id, m]) => ({ id, ...m }))
    .sort((a, b) => (b.updated || 0) - (a.updated || 0));
}

export async function pullNotebook(id) {
  const sb = await supa();
  const user = await requireUser();
  const { data, error } = await sb.storage.from(BUCKET).download(nbPath(user.id, id));
  if (error) throw error;
  return JSON.parse(await data.text());
}

export async function deleteCloud(id) {
  const sb = await supa();
  const user = await requireUser();
  const { error } = await sb.storage.from(BUCKET).remove([nbPath(user.id, id)]);
  if (error) throw error;
  const ix = await readIndex(sb, user.id);
  delete ix[id];
  await writeIndex(sb, user.id, ix);
}
