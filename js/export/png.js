// PNG export — current page to a raster image.

import { renderPageToCanvas, prepareImages } from '../render/exporter.js';
import { downloadBlob, safeName } from './download.js';

export async function exportPagePNG(page, title, pageNum) {
  await prepareImages([page]);
  const cv = renderPageToCanvas(page, 2);
  cv.toBlob((blob) => {
    if (blob) downloadBlob(blob, `${safeName(title)}-p${pageNum}.png`);
  }, 'image/png');
}
