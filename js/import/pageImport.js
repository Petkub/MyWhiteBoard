// Import a PDF or image as page backgrounds. Each PDF page (or the single
// image) becomes a new notebook page with bgImage set; you annotate on top.
// pdf.js loaded on demand from CDN (keeps the app buildless).

import { PAGE_W } from '../config.js';
import { decode } from '../render/imageCache.js';
import { addPagesAfterCurrent } from '../state.js';
import { readDataURL } from '../export/download.js';

const PDFJS_VER = '4.7.76';
const PDFJS_CDN = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VER}/build/pdf.min.mjs`;
const PDFJS_WORKER = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VER}/build/pdf.worker.min.mjs`;

// Render a PDF/image file into page records (no state mutation). Reusable by
// both the editor (append to current notebook) and the library (new notebook).
export async function renderFileToPages(file, onStatus = () => {}) {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    return renderPdf(file, onStatus);
  }
  const src = await readDataURL(file);
  const { w, h } = await decode(src);
  const ph = Math.round((PAGE_W * h) / w);
  // fixed page size = the imported sheet's size (ph), not infinite
  return [{ bg: 'plain', strokes: [], bgImage: src, bgImageH: ph, ph }];
}

// Editor use: import file and append its pages after the current page.
export async function importFileAsPages(file, onStatus = () => {}) {
  const pages = await renderFileToPages(file, onStatus);
  addPagesAfterCurrent(pages);
  onStatus('saved');
}

async function renderPdf(file, onStatus) {
  onStatus('loading pdf engine…');
  const pdfjs = await import(PDFJS_CDN);
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const data = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    onStatus(`rendering pdf page ${i}/${doc.numPages}…`);
    const page = await doc.getPage(i);
    // Render at ~3x the page's world width (794) so text stays sharp when
    // zoomed in (zoom goes to 6x); cap at 4x pdf scale to bound memory/DB size.
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: Math.min(4, (PAGE_W * 3) / base.width) });
    const cv = document.createElement('canvas');
    cv.width = vp.width; cv.height = vp.height;
    const cctx = cv.getContext('2d');
    // JPEG has no alpha — pre-fill white or transparent PDF areas turn black
    cctx.fillStyle = '#fff';
    cctx.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvasContext: cctx, viewport: vp }).promise;
    const ph = Math.round((PAGE_W * vp.height) / vp.width);
    pages.push({
      bg: 'plain', strokes: [],
      // JPEG ~5-10x smaller than PNG for typical slides/docs; quota-friendly
      bgImage: cv.toDataURL('image/jpeg', 0.85),
      bgImageH: ph,
      ph, // page ends exactly where the PDF page ends
    });
  }
  return pages;
}
