// Insert a raster image as a movable object on the current page, centered in
// the viewport and scaled to fit the page width.

import { PAGE_W, clamp } from '../config.js';
import { screenToWorld } from '../viewport/camera.js';
import { viewport } from '../render/renderer.js';
import { addStroke, curPageOffsetX } from '../state.js';
import { decode } from '../render/imageCache.js';
import { readDataURL } from '../export/download.js';

export async function insertImageFile(file) {
  const src = await readDataURL(file);
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
