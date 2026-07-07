// Text layout — wrap a text record to its box width, measure height.
// Shared by the canvas painter, bbox/hit-test, and the DOM editor.

// Excalifont covers Latin only; 'Itim' (handwriting Thai+Latin) handles Thai
// and other Excalifont-missing glyphs, then Inter as a final fallback.
const FONT = "'Excalifont', 'Itim', 'Inter', system-ui, sans-serif";
export const LINE_RATIO = 1.35;

let measureCtx = null;
function ctx() {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  return measureCtx;
}

export function fontString(size) { return `${size}px ${FONT}`; }

// Font shorthand for the DOM editor: WITH explicit line-height. Assigning the
// plain shorthand resets line-height to 'normal', silently diverging from the
// LINE_RATIO the canvas painter uses — text would shift on commit.
export function editorFont(size) { return `${size}px/${LINE_RATIO} ${FONT}`; }

// Half-leading of one line box (screen px): browsers center glyphs inside the
// line box; canvas textBaseline='top' draws from the glyph-box top. The DOM
// editor offsets its top by this so editing and committed text line up.
export function halfLeading(sizePx) {
  const c = ctx();
  c.font = fontString(sizePx);
  const m = c.measureText('Mg');
  const fa = m.fontBoundingBoxAscent ?? sizePx * 0.8;
  const fd = m.fontBoundingBoxDescent ?? sizePx * 0.2;
  return Math.max(0, (sizePx * LINE_RATIO - (fa + fd)) / 2);
}

// ---- inline math ($...$ spans render as MathJax SVG boxes) ----
// Measure hook wired by main.js to render/mathInline.js#measureMath; the
// default estimate keeps this module dependency-free (engine stays pure).
let mathMeasure = (latex, size) => ({ w: Math.max(size, latex.length * size * 0.55), h: size * 1.4 });
export function setMathMeasure(fn) { mathMeasure = fn; }

// One paragraph -> tokens: words / whitespace runs / atomic math spans.
// `$...$` must be non-empty and stay on one line; unmatched `$` is literal.
function tokenize(para, size) {
  const c = ctx();
  c.font = fontString(size);
  const toks = [];
  for (const part of para.split(/(\$[^$\n]+\$)/)) {
    if (!part) continue;
    if (part.length > 2 && part.startsWith('$') && part.endsWith('$')) {
      const latex = part.slice(1, -1);
      const m = mathMeasure(latex, size);
      toks.push({ kind: 'math', latex, w: m.w, h: m.h });
    } else {
      for (const piece of part.split(/(\s+)/)) {
        if (!piece) continue;
        toks.push({ kind: /^\s+$/.test(piece) ? 'space' : 'word', str: piece, w: c.measureText(piece).width });
      }
    }
  }
  return toks;
}

// Greedy word-wrap to width w (world units). Honors explicit newlines; math
// spans wrap as unbreakable words and grow their line's height when taller
// than a text line. Returns positioned items (x within the box, y per line).
// Shared by the canvas painter and textHeight so bbox always matches paint.
export function layoutText(text, size, w) {
  const lineH0 = size * LINE_RATIO;
  const lines = [];
  for (const para of String(text).split('\n')) {
    let items = [], x = 0, h = lineH0;
    const flush = () => {
      while (items.length && items[items.length - 1].kind === 'space') items.pop();
      lines.push({ items, h });
      items = []; x = 0; h = lineH0;
    };
    for (const t of tokenize(para, size)) {
      if (t.kind !== 'space' && x + t.w > w && items.length) flush();
      if (t.kind === 'space' && !items.length) continue; // no leading space after a wrap
      const item = { ...t, x };
      items.push(item);
      x += t.w;
      if (t.kind === 'math') h = Math.max(h, t.h + size * 0.15);
    }
    flush();
  }
  let y = 0;
  for (const L of lines) { L.y = y; y += L.h; }
  return { lines, height: y + size * 0.4 };
}

export function textHeight(text, size, w) {
  return layoutText(text, size, w).height;
}
