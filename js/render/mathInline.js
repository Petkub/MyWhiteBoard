// Inline $...$ math for text strokes. Each formula renders once via MathJax
// (2x supersampled SVG so zoom stays sharp); metrics cache by (size, latex),
// SVG data URLs by (size, color, latex). Text layout uses an estimate until
// the render lands, then onReady (wired to render() in main.js) reflows with
// the real box.

import { renderMathToImage } from './mathjax.js';

const metrics = new Map(); // `${size}|${latex}` -> { w, h } (world units)
const srcs = new Map();    // `${size}|${color}|${latex}` -> svg data URL (null = render failed)
const pending = new Set();

let onReady = () => {};
export function setMathReadyCallback(fn) { onReady = fn; }

// resize drags scale s.size continuously — quantize so the cache stays small
const q = (size) => Math.max(4, Math.round(size));

function kick(latex, size, color) {
  const key = `${size}|${color}|${latex}`;
  if (srcs.has(key) || pending.has(key)) return;
  pending.add(key);
  renderMathToImage(latex, color, size * 2, false)
    .then((r) => { metrics.set(`${size}|${latex}`, { w: r.w / 2, h: r.h / 2 }); srcs.set(key, r.src); })
    .catch(() => { srcs.set(key, null); })
    .finally(() => { pending.delete(key); onReady(); });
}

// Layout hook (engine/text.js#setMathMeasure): world-unit box of one formula.
export function measureMath(latex, size) {
  const sz = q(size);
  const m = metrics.get(`${sz}|${latex}`);
  if (m) return m;
  kick(latex, sz, '#111');
  return { w: Math.max(sz, latex.length * sz * 0.55), h: sz * 1.4 }; // estimate until rendered
}

// Painter hook: the formula's SVG in this stroke's color (null while pending).
export function mathSrc(latex, size, color) {
  const sz = q(size);
  const key = `${sz}|${color}|${latex}`;
  if (!srcs.has(key)) kick(latex, sz, color);
  return srcs.get(key) || null;
}
