// IndexedDB persistence (v2).
//   store 'notebooks' keyPath id: { id, title, folderId, tags[], created, updated, pages[], current }
//   store 'folders'   keyPath id: { id, name, parentId, created }

import { DB_NAME, DB_VERSION } from '../config.js';

let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (!db.objectStoreNames.contains('notebooks')) {
        db.createObjectStore('notebooks', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('folders')) {
        db.createObjectStore('folders', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('quizzes')) {
        db.createObjectStore('quizzes', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('images')) {
        db.createObjectStore('images', { keyPath: 'id' }); // inserted-image collection
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function run(store, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const os = tx.objectStore(store);
    const req = fn(os);
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
  }));
}

// ---- notebooks ----
export const getNotebook = (id) => run('notebooks', 'readonly', (os) => os.get(id));
export const putNotebook = (nb) => run('notebooks', 'readwrite', (os) => os.put(nb));
export const deleteNotebook = (id) => run('notebooks', 'readwrite', (os) => os.delete(id));
export const allNotebooks = () => run('notebooks', 'readonly', (os) => os.getAll());

// ---- folders ----
export const putFolder = (f) => run('folders', 'readwrite', (os) => os.put(f));
export const deleteFolder = (id) => run('folders', 'readwrite', (os) => os.delete(id));
export const allFolders = () => run('folders', 'readonly', (os) => os.getAll());

// ---- images (collection of inserted images) ----
// record: { id, src, w, h, created }
export const putImageDb = (r) => run('images', 'readwrite', (os) => os.put(r));
export const deleteImageDb = (id) => run('images', 'readwrite', (os) => os.delete(id));
export const allImagesDb = () => run('images', 'readonly', (os) => os.getAll());

// ---- quizzes ----
export const getQuizDb = (id) => run('quizzes', 'readonly', (os) => os.get(id));
export const putQuizDb = (q) => run('quizzes', 'readwrite', (os) => os.put(q));
export const deleteQuizDb = (id) => run('quizzes', 'readwrite', (os) => os.delete(id));
export const allQuizzesDb = () => run('quizzes', 'readonly', (os) => os.getAll());
