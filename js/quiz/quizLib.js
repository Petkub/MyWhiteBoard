// Quiz document CRUD (separate IndexedDB store from notebooks).

import { getQuizDb, putQuizDb, deleteQuizDb, allQuizzesDb } from '../store/db.js';
import { blankQuizDoc } from './quizModel.js';

const now = () => Date.now();

export async function createQuiz(title = 'Untitled quiz') {
  const q = blankQuizDoc(title);
  await putQuizDb(q);
  return q;
}

export const loadQuiz = (id) => getQuizDb(id);
export const listQuizzes = () => allQuizzesDb();
export const removeQuiz = (id) => deleteQuizDb(id);

export async function saveQuiz(doc) {
  doc.updated = now();
  await putQuizDb(doc);
}

export async function renameQuiz(id, title) {
  const q = await getQuizDb(id);
  if (!q) return;
  q.title = title; q.updated = now();
  await putQuizDb(q);
}

export async function duplicateQuiz(id) {
  const q = await getQuizDb(id);
  if (!q) return null;
  const copy = JSON.parse(JSON.stringify(q));
  copy.id = (crypto.randomUUID ? crypto.randomUUID() : 'q-' + Date.now());
  copy.title = q.title + ' copy';
  copy.created = copy.updated = now();
  await putQuizDb(copy);
  return copy;
}
