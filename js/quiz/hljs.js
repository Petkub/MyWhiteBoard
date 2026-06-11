// Lazy highlight.js loader (CDN, on-demand — like KaTeX). Loads a dark theme
// CSS + the ESM module once, then syntax-highlights a <code> element.

const VER = '11.9.0';
const CSS = `https://cdn.jsdelivr.net/npm/highlight.js@${VER}/styles/github-dark.min.css`;
const MJS = `https://cdn.jsdelivr.net/npm/highlight.js@${VER}/+esm`;

export const LANGS = [
  '', 'javascript', 'typescript', 'python', 'java', 'cpp', 'c', 'csharp',
  'go', 'rust', 'sql', 'html', 'css', 'bash', 'json',
];

let hljsP = null;

function ensure() {
  if (hljsP) return hljsP;
  if (!document.querySelector('link[data-hljs]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = CSS; link.dataset.hljs = '1';
    document.head.appendChild(link);
  }
  hljsP = import(MJS).then((m) => m.default || m).catch(() => null);
  return hljsP;
}

// Highlight `code` into `codeEl`. If lang is set + known, use it; else auto.
// Returns the detected/used language (for a label).
export async function highlight(codeEl, code, lang) {
  codeEl.textContent = code; // fallback until loaded
  const hljs = await ensure();
  if (!hljs) return lang || '';
  codeEl.classList.add('hljs');
  try {
    if (lang && hljs.getLanguage(lang)) {
      codeEl.innerHTML = hljs.highlight(code, { language: lang }).value;
      return lang;
    }
    const r = hljs.highlightAuto(code);
    codeEl.innerHTML = r.value;
    return r.language || '';
  } catch {
    codeEl.textContent = code;
    return lang || '';
  }
}
