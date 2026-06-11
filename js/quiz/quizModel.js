// Quiz document model. A quiz is a standalone document (its own library +
// IndexedDB store) holding a title + an ordered list of questions. Each question
// has 2-4 choices; every content block (question / choice) can carry text,
// LaTeX, and an image — rendered stacked in that order.

export const blankContent = () => ({ text: '', latex: '', code: '', lang: '', image: null });
export const blankChoice = () => ({ ...blankContent(), correct: false });

export function blankQuestion() {
  return {
    question: blankContent(),
    choices: [blankChoice(), blankChoice(), blankChoice(), blankChoice()],
    time: 20,        // seconds
    points: 1000,    // max points (scaled by speed)
  };
}

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'q-' + Date.now() + '-' + Math.floor(performance.now()));

export function blankQuizDoc(title = 'Untitled quiz') {
  const t = Date.now();
  return { id: uid(), title, created: t, updated: t, questions: [blankQuestion()] };
}

export const hasContent = (c) => !!(c && (c.text || c.latex || c.code || c.image));

// A question is playable if the prompt has content, >=2 choices have content,
// and at least one filled choice is marked correct.
export function questionValid(q) {
  if (!q || !hasContent(q.question)) return false;
  const filled = q.choices.filter(hasContent);
  return filled.length >= 2 && q.choices.some((c) => c.correct && hasContent(c));
}

export const validQuestions = (doc) => (doc.questions || []).filter(questionValid);
