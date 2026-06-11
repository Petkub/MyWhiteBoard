// Debounced autosave — writes the open notebook to IndexedDB ~1s after change.

import { AUTOSAVE_MS } from '../config.js';
import { state, toRecord } from '../state.js';
import { saveNotebookRecord } from '../library/library.js';

let timer = null;
let statusEl = null;

export function bindStatus(el) { statusEl = el; }
function status(text) { if (statusEl) statusEl.textContent = text; }

export function schedule() {
  if (!state.notebookId) return;
  status('editing…');
  clearTimeout(timer);
  timer = setTimeout(flush, AUTOSAVE_MS);
}

export async function flush() {
  clearTimeout(timer);
  if (!state.notebookId) return;
  status('saving…');
  try {
    await saveNotebookRecord(toRecord());
    status('saved');
  } catch (e) {
    status('save failed');
    console.error('[autosave]', e);
  }
}
