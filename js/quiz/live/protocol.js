// Live-game protocol helpers: room codes, wire-safe question payloads
// (correct flags STRIPPED — players must never receive answers), image
// downscaling, CSV results. Pure functions, no network.

import { hasContent } from '../quizModel.js';

// Room code: 6 chars, unambiguous alphabet (no 0/O/1/I).
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function genCode() {
  let c = '';
  const buf = new Uint8Array(6);
  crypto.getRandomValues(buf);
  for (const b of buf) c += ALPHABET[b % ALPHABET.length];
  return c;
}

export const validCode = (s) => /^[A-Z2-9]{6}$/.test(String(s || '').trim().toUpperCase());

// Indices of correct choices (among the content-bearing ones, play order).
export function correctSet(q) {
  const out = new Set();
  q.choices.filter(hasContent).forEach((c, i) => { if (c.correct) out.add(i); });
  return out;
}

// Question payload for the wire: visible choices only, NO `correct` flags.
export function sanitizeQuestion(q) {
  const strip = (c) => ({ text: c.text || '', latex: c.latex || '', code: c.code || '', lang: c.lang || '', image: c.image || null });
  return {
    question: strip(q.question),
    choices: q.choices.filter(hasContent).map(strip),
    time: q.time,
    points: q.points,
  };
}

// Downscale a dataURL image (max edge, JPEG). Used at editor-insert time and
// as a send-time fallback for old quizzes. Returns original on any failure
// or when already small.
export async function shrinkImage(dataURL, maxEdge = 1024, quality = 0.82) {
  try {
    if (!dataURL || !dataURL.startsWith('data:image')) return dataURL;
    if (dataURL.length < 120_000) return dataURL; // ~90KB binary — fine as-is
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataURL; });
    const k = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(img.naturalWidth * k));
    cv.height = Math.max(1, Math.round(img.naturalHeight * k));
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    const out = cv.toDataURL('image/jpeg', quality);
    return out.length < dataURL.length ? out : dataURL;
  } catch { return dataURL; }
}

// Wire-ready question: sanitized + every image shrunk hard enough to fit a
// broadcast message (re-compress pass if the payload is still too big).
export async function questionForWire(q) {
  const s = sanitizeQuestion(q);
  const blocks = [s.question, ...s.choices];
  for (const b of blocks) if (b.image) b.image = await shrinkImage(b.image);
  let size = JSON.stringify(s).length;
  if (size > 220_000) { // broadcast payload safety margin
    for (const b of blocks) if (b.image) b.image = await shrinkImage(b.image, 640, 0.6);
    size = JSON.stringify(s).length;
    if (size > 220_000) for (const b of blocks) if (b.image) b.image = null; // last resort
  }
  return s;
}

// CSV results: one row per player, one column per question.
export function csvFromGame(players, questionCount) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['nickname', 'score', 'correct', ...Array.from({ length: questionCount }, (_, i) => `q${i + 1}`)];
  const rows = [...players.values()]
    .sort((a, b) => b.score - a.score)
    .map((p) => [
      esc(p.nick), p.score, p.correct,
      ...Array.from({ length: questionCount }, (_, i) => {
        const a = p.answers[i];
        return a === undefined ? '' : (a.ok ? `+${a.delta}` : 'x');
      }),
    ].join(','));
  return [head.join(','), ...rows].join('\n');
}
