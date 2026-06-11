// Lazy KaTeX loader (CDN, on-demand — quiz is not core drawing, so network is
// allowed here like jsPDF/pdf.js). Loads CSS + the ESM module once, then renders
// LaTeX into a target element. Also renders a stacked content block (text +
// latex + image), shared by the quiz editor preview and the play view.

import { highlight } from './hljs.js';

const VER = '0.16.11';
const CSS = `https://cdn.jsdelivr.net/npm/katex@${VER}/dist/katex.min.css`;
const MJS = `https://cdn.jsdelivr.net/npm/katex@${VER}/dist/katex.mjs`;

let katexP = null;

function ensureKatex() {
  if (katexP) return katexP;
  if (!document.querySelector('link[data-katex]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = CSS;
    link.dataset.katex = '1';
    document.head.appendChild(link);
  }
  katexP = import(MJS).then((m) => m.default || m).catch(() => null);
  return katexP;
}

export async function renderLatex(el, tex) {
  el.textContent = tex; // fallback until katex resolves
  const katex = await ensureKatex();
  if (!katex) return;
  try { katex.render(tex, el, { throwOnError: false, displayMode: true }); }
  catch { el.textContent = tex; }
}

// Render a content block { text, latex, image } into `el` (cleared first).
export function renderContent(el, c) {
  el.innerHTML = '';
  if (!c) return;
  if (c.text) {
    const p = document.createElement('div');
    p.className = 'qc-text';
    p.textContent = c.text;
    el.appendChild(p);
  }
  if (c.latex) {
    const m = document.createElement('div');
    m.className = 'qc-latex';
    el.appendChild(m);
    renderLatex(m, c.latex);
  }
  if (c.code) {
    const wrap = document.createElement('div');
    wrap.className = 'qc-codewrap';
    const lbl = document.createElement('span');
    lbl.className = 'qc-lang';
    lbl.textContent = c.lang || 'code';
    const pre = document.createElement('pre');
    pre.className = 'qc-code';
    const code = document.createElement('code');
    pre.appendChild(code);
    wrap.append(lbl, pre);
    el.appendChild(wrap);
    highlight(code, c.code, c.lang).then((detected) => {
      if (!c.lang && detected) lbl.textContent = detected;
    });
  }
  if (c.image) {
    const img = document.createElement('img');
    img.className = 'qc-img';
    img.src = c.image;
    el.appendChild(img);
  }
}
