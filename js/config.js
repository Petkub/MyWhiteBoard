// Global constants + per-tool defaults. Single source of truth.

export const PAGE_W = 794;          // fixed A4-ish width @96dpi. Height infinite.
export const PAGE_PAD_TOP = 48;     // first-line gutter
export const MIN_SCALE = 0.2;
export const MAX_SCALE = 6;
export const AUTOSAVE_MS = 1000;    // debounce after last stroke
export const FLICK_FLIP_PX = 80;    // horizontal swipe distance to flip page
export const DB_NAME = 'mywhiteboard';
export const DB_VERSION = 4; // v4: + images store (inserted-image collection)

export const COLORS = ['#111111', '#d62828', '#1d3fb6', '#2f9e44', '#7048e8', '#e64980'];

export const BACKGROUNDS = ['plain', 'grid', 'dotted', 'lined'];

// Per-tool defaults — each tool keeps own settings.
// stabilize 0..0.95 (higher = smoother lag); sharpness 0..1 (0 soft curves, 1 polyline)
export const TOOL_DEFAULTS = {
  pen: {
    color: '#111111', size: 3, min: 0.5, max: 12, step: 0.5,
    stabilize: 0.65, sharpness: 0.28, style: 'fountain', taper: 0.7,
  },
  highlighter: {
    color: '#fde047', size: 18, min: 6, max: 48, step: 1,
    stabilize: 0.3, sharpness: 0.3,
  },
  eraser: {
    color: null, size: 16, min: 6, max: 60, step: 1, mode: 'stroke',
  },
  shape: {
    color: '#111111', size: 2.5, min: 1, max: 10, step: 0.5,
    kind: 'rect', filled: false,
    cols: 4, rows: 4,        // grid
    arrowStart: false, arrowEnd: true, arrowSize: 14,  // arrow heads
  },
  text: {
    color: '#111111', size: 20, min: 10, max: 72, step: 1,
  },
  emoji: {
    size: 44, min: 16, max: 200, step: 4, char: '😀',
  },
  math: {
    color: '#111111', size: 30, min: 14, max: 120, step: 2,
  },
  select: { color: null, size: 1 },
  lasso: { color: null, size: 1 },
};

export const EMOJIS = [
  '😀', '😂', '😍', '😎', '🤔', '😭', '👍', '🙌', '🎉', '❤️',
  '⭐', '🔥', '✅', '❌', '❓', '❗', '💡', '📌', '✏️', '🚀',
  '💯', '⚡', '🌟', '🧠', '📈', '🎯', '🔑', '⏰', '☑️', '➡️',
];

export const SHAPES = ['line', 'arrow', 'rect', 'circle', 'grid', 'node'];

export function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
