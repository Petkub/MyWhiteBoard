// Offscreen page rasterizer — renders one page (background + strokes) to a
// fresh canvas in pure page coordinates (no viewport camera). Used by PNG/PDF.

import { PAGE_W, clamp } from '../config.js';
import { strokeBBox } from '../engine/strokes.js';
import { nodeMapOf } from '../engine/shapes.js';
import { drawStroke } from './paint.js';
import { get as getImage, decode } from './imageCache.js';

const PAD = 40;
const MIN_H = 600;

// Bottom-most inked y on a page (page top is 0).
export function pageContentHeight(page) {
  let maxY = page.bgImage ? (page.bgImageH || PAGE_W) : 0;
  for (const s of page.strokes) {
    const b = strokeBBox(s);
    if (b.y2 > maxY) maxY = b.y2;
  }
  return Math.max(MIN_H, Math.ceil(maxY + PAD));
}

// Pre-decode every image a page references so the sync rasterizer can draw them.
export async function prepareImages(pages) {
  const srcs = new Set();
  for (const p of pages) {
    if (p.bgImage) srcs.add(p.bgImage);
    for (const s of p.strokes) if ((s.tool === 'image' || s.tool === 'math') && s.src) srcs.add(s.src);
  }
  await Promise.all([...srcs].map((src) => decode(src).catch(() => {})));
}

// maxH (world px) caps the rendered height — thumbnails only need the top of
// a page, and long pages would otherwise allocate huge canvases.
export function renderPageToCanvas(page, scale = 2, maxH = Infinity) {
  // fixed-size pages export at exactly their size; infinite pages crop to content
  const h = Math.min(page.ph || pageContentHeight(page), maxH);
  const cv = document.createElement('canvas');
  cv.width = Math.round(PAGE_W * scale);
  cv.height = Math.round(h * scale);
  const ctx = cv.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.imageSmoothingQuality = 'high';

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, PAGE_W, h);
  if (page.bgImage) {
    const img = getImage(page.bgImage);
    if (img) ctx.drawImage(img, 0, 0, PAGE_W, page.bgImageH || PAGE_W);
  } else {
    drawBackground(ctx, page.bg, h);
  }

  const nodeMap = nodeMapOf(page.strokes);
  for (const s of page.strokes) if (s.tool === 'shape' && s.kind === 'edge') drawStroke(ctx, s, nodeMap);
  for (const s of page.strokes) if (!(s.tool === 'shape' && s.kind === 'edge')) drawStroke(ctx, s, nodeMap);
  return cv;
}

function drawBackground(ctx, bg, h) {
  if (bg === 'plain') return;
  const gap = 28;
  if (bg === 'lined') {
    ctx.strokeStyle = '#cdd7e5'; ctx.lineWidth = 1;
    for (let y = gap; y <= h; y += gap) hline(ctx, y);
    ctx.strokeStyle = '#f2b8b8';
    ctx.beginPath(); ctx.moveTo(56, 0); ctx.lineTo(56, h); ctx.stroke();
  } else if (bg === 'grid') {
    ctx.strokeStyle = '#dde6f0'; ctx.lineWidth = 1;
    for (let y = gap; y <= h; y += gap) hline(ctx, y);
    for (let x = gap; x < PAGE_W; x += gap) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  } else if (bg === 'dotted') {
    ctx.fillStyle = '#c4cedd';
    const r = clamp(1.1, 0.6, 2);
    for (let y = gap; y <= h; y += gap)
      for (let x = gap; x < PAGE_W; x += gap) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
  }
}

function hline(ctx, y) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(PAGE_W, y); ctx.stroke(); }
