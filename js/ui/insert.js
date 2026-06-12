// Insert a raster image as a movable object on the current page, centered in
// the viewport and scaled to fit the page width. Every file-inserted image is
// also saved to the image collection (IndexedDB 'images') for quick re-use.

import { PAGE_W, clamp } from '../config.js';
import { screenToWorld } from '../viewport/camera.js';
import { viewport } from '../render/renderer.js';
import { addStroke, curPageOffsetX } from '../state.js';
import { decode } from '../render/imageCache.js';
import { readDataURL } from '../export/download.js';
import { putImageDb, allImagesDb } from '../store/db.js';

// Place an image src on the page (shared by file insert + collection re-insert).
export async function insertImageSrc(src) {
  const { w: nw, h: nh } = await decode(src);
  const maxW = PAGE_W * 0.8;
  const w = Math.min(nw, maxW);
  const h = (w * nh) / nw;
  const { vw, vh } = viewport();
  const c = screenToWorld(vw / 2, vh / 2);
  c.x -= curPageOffsetX(); // viewport center -> active-page-local x
  const x = clamp(c.x - w / 2, 4, Math.max(4, PAGE_W - w - 4));
  const y = c.y - h / 2;
  addStroke({ tool: 'image', src, x, y, w, h });
}

export async function insertImageFile(file) {
  const src = await readDataURL(file);
  await insertImageSrc(src);
  collectImage(src); // fire-and-forget — insertion never blocks on the library
}

// Save to the collection unless an identical src is already there.
async function collectImage(src) {
  try {
    const all = await allImagesDb();
    if (all.some((r) => r.src === src)) return;
    const { w, h } = await decode(src);
    await putImageDb({ id: 'img' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36), src, w, h, created: Date.now() });
  } catch { /* collection is best-effort */ }
}
