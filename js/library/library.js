// Library model — notebook + folder CRUD, search. Talks to db.js.
// A notebook record holds metadata + its pages. The *open* notebook lives in
// state.js; this module manages the whole collection.

import {
  getNotebook, putNotebook, deleteNotebook, allNotebooks,
  putFolder, deleteFolder, allFolders,
} from '../store/db.js';

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.floor(performance.now()));
const now = () => Date.now();

// opts: { bg: 'plain'|'grid'|'dotted'|'lined', ph: number|null } first-page setup
export function blankNotebook(title = 'Untitled', folderId = null, opts = {}) {
  const t = now();
  return {
    id: uid(), title, folderId, tags: [],
    created: t, updated: t,
    pages: [{ bg: opts.bg || 'grid', ph: opts.ph || null, strokes: [] }], current: 0,
  };
}

export async function createNotebook(title, folderId = null, opts = {}) {
  const nb = blankNotebook(title, folderId, opts);
  await putNotebook(nb);
  return nb;
}

// Create a notebook from prebuilt page records (PDF/image import in the library).
export async function createNotebookFromPages(title, pages, folderId = null) {
  const nb = blankNotebook(title, folderId);
  if (pages && pages.length) nb.pages = pages;
  await putNotebook(nb);
  return nb;
}

export async function saveNotebookRecord(nb) {
  nb.updated = now();
  await putNotebook(nb);
}

export const loadNotebookRecord = (id) => getNotebook(id);

export async function renameNotebook(id, title) {
  const nb = await getNotebook(id);
  if (!nb) return;
  nb.title = title; nb.updated = now();
  await putNotebook(nb);
}

export async function setNotebookTags(id, tags) {
  const nb = await getNotebook(id);
  if (!nb) return;
  nb.tags = tags; nb.updated = now();
  await putNotebook(nb);
}

export async function moveNotebook(id, folderId) {
  const nb = await getNotebook(id);
  if (!nb) return;
  nb.folderId = folderId; nb.updated = now();
  await putNotebook(nb);
}

export const removeNotebook = (id) => deleteNotebook(id);

export async function duplicateNotebook(id) {
  const nb = await getNotebook(id);
  if (!nb) return null;
  const copy = JSON.parse(JSON.stringify(nb));
  copy.id = uid(); copy.title = nb.title + ' copy';
  copy.created = copy.updated = now();
  await putNotebook(copy);
  return copy;
}

// ---- folders ----
export async function createFolder(name, parentId = null) {
  const f = { id: uid(), name, parentId, created: now() };
  await putFolder(f);
  return f;
}
export const removeFolder = (id) => deleteFolder(id);
export const listFolders = () => allFolders();
export const listNotebooks = () => allNotebooks();

// ---- search ----
// Matches title or any tag (case-insensitive). Empty query = all.
export async function search(query) {
  const all = await allNotebooks();
  const q = query.trim().toLowerCase();
  if (!q) return all;
  return all.filter((nb) =>
    nb.title.toLowerCase().includes(q) ||
    (nb.tags || []).some((t) => t.toLowerCase().includes(q)));
}
