// Cloud sync: notebook records in a private Supabase Storage bucket
// ('notebooks'), split per page so auto-sync only uploads what changed:
//   <uid>/<nbid>/meta.json   title/updated/pageCount/pageRevs (content hashes)
//   <uid>/<nbid>/p<i>.json   one page record each
//   <uid>/index.json         id -> {title, updated, pages, bytes} for lists
// Legacy single-file <uid>/<nbid>.json (first sync-lite version) still pulls;
// the next push migrates it to the split layout. Last push wins; pull
// overwrites local. Bucket + RLS policies are created by hand in the
// Supabase dashboard (per-uid folder policies for authenticated users).

import { supa } from './supa.js';

const BUCKET = 'notebooks';
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

// ---- helpers ----
async function requireUser() {
  const user = await currentUser();
  if (!user) throw new Error('not signed in');
  return user;
}

async function readJson(sb, path) {
  const { data, error } = await sb.storage.from(BUCKET).download(path);
  if (error) return null;
  try { return JSON.parse(await data.text()); } catch { return null; }
}

async function writeJson(sb, path, str) {
  const blob = new Blob([str], { type: 'application/json' });
  const { error } = await sb.storage.from(BUCKET).upload(path, blob, { upsert: true, contentType: 'application/json' });
  if (error) throw error;
}

const readIndex = async (sb, uid) => (await readJson(sb, ixPath(uid))) || {};
const writeIndex = (sb, uid, ix) => writeJson(sb, ixPath(uid), JSON.stringify(ix));

// djb2 over the page JSON — cheap content rev for skip-unchanged uploads
function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) >>> 0;
  return h.toString(36) + s.length.toString(36);
}

// ---- push / pull / list / delete ----
export async function pushNotebook(nb) {
  const sb = await supa();
  const user = await requireUser();
  const base = `${user.id}/${nb.id}`;
  const prev = (await readJson(sb, `${base}/meta.json`)) || {};
  const prevRevs = prev.pageRevs || [];
  const pageJsons = nb.pages.map((p) => JSON.stringify(p));
  const revs = pageJsons.map(hash);
  let bytes = 0;
  for (let i = 0; i < pageJsons.length; i++) {
    bytes += pageJsons[i].length;
    if (revs[i] !== prevRevs[i]) await writeJson(sb, `${base}/p${i}.json`, pageJsons[i]);
  }
  const stale = [];
  for (let i = pageJsons.length; i < (prev.pageCount || 0); i++) stale.push(`${base}/p${i}.json`);
  stale.push(`${user.id}/${nb.id}.json`); // legacy single-file copy, if any
  await sb.storage.from(BUCKET).remove(stale);
  await writeJson(sb, `${base}/meta.json`, JSON.stringify({
    id: nb.id, title: nb.title, folderId: nb.folderId ?? null, tags: nb.tags || [],
    created: nb.created, updated: nb.updated, current: nb.current || 0,
    pageCount: nb.pages.length, pageRevs: revs,
  }));
  const ix = await readIndex(sb, user.id);
  ix[nb.id] = { title: nb.title, updated: nb.updated, pages: nb.pages.length, bytes };
  await writeIndex(sb, user.id, ix);
}

export async function pullNotebook(id) {
  const sb = await supa();
  const user = await requireUser();
  const meta = await readJson(sb, `${user.id}/${id}/meta.json`);
  if (meta) {
    const pages = await Promise.all(
      Array.from({ length: meta.pageCount }, (_, i) => readJson(sb, `${user.id}/${id}/p${i}.json`)));
    if (pages.some((p) => !p)) throw new Error('cloud copy incomplete');
    return {
      id: meta.id, title: meta.title, folderId: meta.folderId, tags: meta.tags,
      created: meta.created, updated: meta.updated, current: meta.current, pages,
    };
  }
  const legacy = await readJson(sb, `${user.id}/${id}.json`);
  if (!legacy) throw new Error('not found in cloud');
  return legacy;
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

// Cloud `updated` for one notebook (0 = not in cloud). One tiny download.
export async function cloudUpdated(id) {
  const sb = await supa();
  const user = await currentUser();
  if (!user) return 0;
  const ix = await readIndex(sb, user.id);
  return ix[id]?.updated || 0;
}

export async function deleteCloud(id) {
  const sb = await supa();
  const user = await requireUser();
  const { data } = await sb.storage.from(BUCKET).list(`${user.id}/${id}`, { limit: 1000 });
  const paths = (data || []).map((f) => `${user.id}/${id}/${f.name}`);
  paths.push(`${user.id}/${id}.json`); // legacy
  await sb.storage.from(BUCKET).remove(paths);
  const ix = await readIndex(sb, user.id);
  delete ix[id];
  await writeIndex(sb, user.id, ix);
}
