// Hash router — five views:
//   #lib            library home (notebooks)
//   #nb/<id>        notebook editor
//   #quizzes        quiz home
//   #quiz/<id>      quiz editor
//   #join[/CODE]    join a live quiz (player side)

export function currentRoute() {
  const h = location.hash.replace(/^#/, '');
  if (h.startsWith('nb/')) return { view: 'editor', id: decodeURIComponent(h.slice(3)) };
  if (h.startsWith('quiz/')) return { view: 'quiz', id: decodeURIComponent(h.slice(5)) };
  if (h === 'quizzes') return { view: 'quizzes' };
  if (h === 'join' || h.startsWith('join/')) return { view: 'join', code: decodeURIComponent(h.slice(5)) };
  return { view: 'library' };
}

export const goLibrary = () => { location.hash = 'lib'; };
export const goEditor = (id) => { location.hash = 'nb/' + encodeURIComponent(id); };
export const goQuizzes = () => { location.hash = 'quizzes'; };
export const goQuiz = (id) => { location.hash = 'quiz/' + encodeURIComponent(id); };
export const goJoin = (code) => { location.hash = 'join' + (code ? '/' + encodeURIComponent(code) : ''); };
export const onRouteChange = (cb) => window.addEventListener('hashchange', cb);
