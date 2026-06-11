// Image cache — decodes data-URL/blob images once, keyed by src string.
// drawStroke() calls get(); if not yet decoded it returns null and schedules
// a redraw via the onReady callback registered here.

const cache = new Map();   // src -> { img, ready }
let onReady = () => {};

export function setReadyCallback(cb) { onReady = cb; }

export function get(src) {
  let entry = cache.get(src);
  if (entry) return entry.ready ? entry.img : null;
  entry = { img: new Image(), ready: false };
  cache.set(src, entry);
  entry.img.onload = () => { entry.ready = true; onReady(); };
  entry.img.onerror = () => { entry.ready = false; };
  entry.img.src = src;
  return null;
}

// Decode and return natural size (for placing a newly inserted image).
export function decode(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      cache.set(src, { img, ready: true });
      resolve({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.onerror = reject;
    img.src = src;
  });
}
