// Entry point — boots editor + library, routes between them via hash.

import {
  state, setTool, undoAction, redoAction, flipPage, loadInto, deleteSelected,
  copySelection, cutSelection, pasteClipboard, duplicateSelection, hasClipboard,
} from './state.js';
import { insertImageFile } from './ui/insert.js';
import { initQuizPlay, playQuiz } from './quiz/quizPlay.js';
import { openJoin, closePlayer } from './quiz/live/player.js';
import { hostQuiz, resumeHostIfAny } from './quiz/live/host.js';
import { initQuizHome, renderQuizHome } from './quiz/quizHome.js';
import { initQuizEdit, openQuizEditorView, flush as flushQuiz } from './quiz/quizEditorView.js';
import { initRenderer, render, viewport, resize as resizeRenderer } from './render/renderer.js';
import { initOverlay, drawSelection, clearOverlay, resize as resizeOverlay } from './render/overlay.js';
import { initInput, setTextHandler, setMathHandler, setCameraChangeHandler } from './input/pointer.js';
import { initTextEditor, openTextEditor, isEditing, syncTextEditor } from './ui/textEditor.js';
import { initMathEditor, openMathEditor, isMathEditing, syncMathEditor } from './ui/mathEditor.js';
import { setReadyCallback } from './render/imageCache.js';
import { resetTop, fitWidth, setCameraBounds, setWorldWidth } from './viewport/camera.js';
import { spreadPh, spreadWorldWidth } from './state.js';
import { flush as flushSave, bindStatus, schedule as scheduleSave } from './store/autosave.js';
import { buildToolbar, statusEl, syncPages, syncAll } from './ui/toolbar.js';
import { initLibrary, refreshLibrary } from './library/libraryView.js';
import { loadNotebookRecord } from './library/library.js';
import { currentRoute, onRouteChange, goLibrary, goEditor, goQuizzes } from './router.js';
import { applyTheme } from './ui/theme.js';
import { initTabs, openTab, removeTab, getTabs } from './ui/tabs.js';

const SHORTCUTS = {
  KeyP: 'pen', KeyM: 'highlighter', KeyE: 'eraser', KeyS: 'shape',
  KeyT: 'text', KeyV: 'select', KeyL: 'lasso', KeyH: 'hand',
};

let editorEl, libraryEl, quizHomeEl, quizEditEl;

async function boot() {
  applyTheme();
  editorEl = document.getElementById('editor');
  libraryEl = document.getElementById('library');
  quizHomeEl = document.getElementById('quizhome');
  quizEditEl = document.getElementById('quizedit');

  initRenderer(document.getElementById('committed'));
  initOverlay(document.getElementById('overlay'));
  initInput(document.getElementById('overlay'));
  buildToolbar(document.getElementById('toolbar'));
  bindStatus(statusEl());
  initLibrary(libraryEl);
  initTextEditor(document.getElementById('stage'));
  setTextHandler(openTextEditor);
  initMathEditor(document.getElementById('stage'));
  setMathHandler(openMathEditor);
  setCameraChangeHandler(() => { syncTextEditor(); syncMathEditor(); });
  setReadyCallback(() => render()); // async image decode -> repaint
  const stageEl = document.getElementById('stage');
  setCameraBounds(() => spreadPh(), () => stageEl.clientHeight);
  setWorldWidth(() => spreadWorldWidth());
  initQuizPlay(document.getElementById('quizplay'));
  initQuizHome(quizHomeEl);
  initQuizEdit(quizEditEl, { onPlay: playQuiz, onHost: hostQuiz, onBack: goQuizzes });
  initTabs(document.getElementById('tabbar'), {
    onSelect: (id) => { id ? goEditor(id) : goLibrary(); },
    onClose: (id) => {
      const rest = removeTab(id);
      if (id === state.notebookId) (rest.length ? goEditor(rest[rest.length - 1].id) : goLibrary());
    },
  });

  // drop tabs whose notebook no longer exists (deleted in a past session)
  for (const t of getTabs().slice()) {
    if (!(await loadNotebookRecord(t.id))) removeTab(t.id);
  }

  state.onMutate = () => { render(); reflectSelection(); scheduleSave(); };
  state.onPageChange = () => { resetTop(viewport().vw); render(); clearOverlay(); syncPages(); };
  state.onPageQuiet = () => { render(); clearOverlay(); syncPages(); }; // spread-page switch


  bindKeys();
  window.addEventListener('beforeunload', () => { flushSave(); flushQuiz(); });
  onRouteChange(route);
  await route();
  resumeHostIfAny(); // host tab reloaded mid-game -> rejoin room + resync

  // canvas text uses Excalifont (Latin) + Itim (Thai); repaint once decoded
  if (document.fonts && document.fonts.load) {
    Promise.allSettled([
      document.fonts.load('20px Excalifont'),
      document.fonts.load('20px Itim'),
      document.fonts.load('20px Itim', 'ก'),
    ]).then(() => render());
  }

  // NOTE: service worker intentionally NOT registered. A caching SW serves
  // stale modules during local iteration and can't be bypassed by hard-refresh.
  // sw.js is now a kill-switch that evicts any previously-installed SW.
  // Re-add a versioned, network-first SW only for a real deployment.
}

function show(view) {
  editorEl.style.display = view === 'editor' ? '' : 'none';
  libraryEl.style.display = view === 'library' ? '' : 'none';
  quizHomeEl.style.display = view === 'quizzes' ? 'block' : 'none';
  quizEditEl.style.display = view === 'quiz' ? 'block' : 'none';
}

async function route() {
  const r = currentRoute();
  if (r.view !== 'join') closePlayer(); // back-button out of #join closes the overlay
  if (r.view === 'editor' && r.id) {
    const nb = await loadNotebookRecord(r.id);
    if (!nb) { goLibrary(); return; }
    loadInto(nb);
    openTab(nb.id, nb.title || 'Untitled');
    show('editor');
    resizeRenderer(); resizeOverlay();
    fitWidth(viewport().vw); resetTop(viewport().vw);
    render(); clearOverlay(); syncAll();
  } else if (r.view === 'quizzes') {
    await flushSave();
    show('quizzes');
    renderQuizHome();
  } else if (r.view === 'quiz' && r.id) {
    show('quiz');
    openQuizEditorView(r.id);
  } else if (r.view === 'join') {
    await flushSave();
    show('library');           // background view; live overlay sits on top
    openJoin(r.code || '');
  } else {
    await flushSave();
    show('library');
    refreshLibrary();
  }
}

function reflectSelection() {
  if (state.tool !== 'select' && state.tool !== 'lasso') return;
  if (state.selected.size) drawSelection(state.pages[state.current].strokes, state.selected);
  else clearOverlay(); // selection emptied (e.g. delete) — wipe stale rings
}

function bindKeys() {
  window.addEventListener('keydown', (e) => {
    if (editorEl.style.display === 'none') return; // editor only
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
    if (isEditing() || isMathEditing()) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.code === 'KeyZ') { e.preventDefault(); e.shiftKey ? redoAction() : undoAction(); return; }
    if (mod && e.code === 'KeyY') { e.preventDefault(); redoAction(); return; }
    if (mod && e.code === 'KeyC') { if (copySelection()) e.preventDefault(); return; }
    if (mod && e.code === 'KeyX') { if (cutSelection()) e.preventDefault(); return; }
    if (mod && e.code === 'KeyD') { e.preventDefault(); duplicateSelection(); return; }
    if (mod && e.code === 'KeyV') {
      // internal strokes win; with an empty stroke clipboard we let the
      // browser fire the 'paste' event so OS-clipboard images insert below
      if (hasClipboard()) { e.preventDefault(); setTool('select'); syncAll(); pasteClipboard(); }
      return;
    }
    if (mod) return;
    if ((e.code === 'Delete' || e.code === 'Backspace') && state.selected.size) { e.preventDefault(); deleteSelected(); return; }
    if (e.code === 'ArrowLeft') { flipPage(-1); return; }
    if (e.code === 'ArrowRight') { flipPage(1); return; }
    const tool = SHORTCUTS[e.code];
    if (tool) { setTool(tool); syncAll(); }
  });

  // OS-clipboard image -> insert as an image object (screenshots, copied pics)
  window.addEventListener('paste', (e) => {
    if (editorEl.style.display === 'none') return;
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || isEditing() || isMathEditing()) return;
    const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/'));
    if (f) { e.preventDefault(); insertImageFile(f); }
  });

  window.addEventListener('resize', () => {
    if (editorEl.style.display === 'none') return;
    resizeRenderer(); fitWidth(viewport().vw); render();
  });
}

boot();
