// .whiteboard JSON export / import — backup + transfer between devices.

import { downloadBlob, safeName } from './download.js';
import { putNotebook } from '../store/db.js';

const FORMAT = 'mywhiteboard/v1';
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now());

export function exportNotebookJSON(record) {
  const doc = { format: FORMAT, exported: Date.now(), notebook: record };
  const blob = new Blob([JSON.stringify(doc)], { type: 'application/json' });
  downloadBlob(blob, `${safeName(record.title)}.whiteboard`);
}

// Parse a .whiteboard file -> persisted notebook record (fresh id). Returns it.
export async function importNotebookJSON(file) {
  const text = await file.text();
  const doc = JSON.parse(text);
  const nb = doc.notebook || doc; // tolerate a bare notebook record
  if (!nb.pages) throw new Error('not a whiteboard file');
  const t = Date.now();
  const record = {
    id: uid(),
    title: (nb.title || 'Imported') ,
    folderId: nb.folderId ?? null,
    tags: nb.tags || [],
    created: t, updated: t,
    pages: nb.pages,
    current: nb.current || 0,
  };
  await putNotebook(record);
  return record;
}
