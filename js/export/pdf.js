// Multi-page PDF export — one PDF page per notebook page, sized to content.
// jsPDF loaded on demand from CDN (keeps the app buildless).

import { PAGE_W } from '../config.js';
import { renderPageToCanvas, prepareImages } from '../render/exporter.js';
import { safeName } from './download.js';

const JSPDF_CDN = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm';

export async function exportNotebookPDF(pages, title, onStatus = () => {}) {
  onStatus('loading pdf engine…');
  await prepareImages(pages);
  const { jsPDF } = await import(JSPDF_CDN);
  let pdf = null;
  for (let i = 0; i < pages.length; i++) {
    onStatus(`rendering page ${i + 1}/${pages.length}…`);
    const cv = renderPageToCanvas(pages[i], 2);
    const w = PAGE_W, h = cv.height / 2; // scale=2 -> page units
    const img = cv.toDataURL('image/png');
    if (i === 0) pdf = new jsPDF({ unit: 'px', format: [w, h], compress: true });
    else pdf.addPage([w, h]);
    pdf.addImage(img, 'PNG', 0, 0, w, h);
  }
  pdf.save(`${safeName(title)}.pdf`);
  onStatus('saved');
}
