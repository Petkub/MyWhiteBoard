// Insert a raster image as a movable object on the current page, centered in
// the viewport and scaled to fit the page width. The image COLLECTION is
// user-curated: images are added to it explicitly (collection popover's
// "+ add"), never as a side effect of inserting onto a page.

import { PAGE_W, clamp } from '../config.js';
import { screenToWorld } from '../viewport/camera.js';
import { viewport } from '../render/renderer.js';
import { addStroke, curPageOffsetX } from '../state.js';
import { decode } from '../render/imageCache.js';
import { readDataURL } from '../export/download.js';
import { putImageDb, allImagesDb } from '../store/db.js';

// Place an image src on the page (file insert + collection re-insert).
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
  await insertImageSrc(await readDataURL(file));
}

// Add files to the collection (optionally into a folder). Exact-duplicate
// srcs are skipped. Returns the number actually added.
export async function addImagesToCollection(files, folderId = null) {
  const existing = new Set((await allImagesDb()).map((r) => r.src));
  let added = 0;
  for (const f of files) {
    const src = await readDataURL(f);
    if (existing.has(src)) continue;
    existing.add(src);
    const { w, h } = await decode(src);
    await putImageDb({
      id: 'img' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36),
      src, w, h, created: Date.now(), folderId,
    });
    added++;
  }
  return added;
}
