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

// Greedy word-wrap to width w (world units). Honors explicit newlines.
export function wrapText(text, size, w) {
  const c = ctx();
  c.font = fontString(size);
  const lines = [];
  for (const para of String(text).split('\n')) {
    if (para === '') { lines.push(''); continue; }
    const words = para.split(/(\s+)/);
    let line = '';
    for (const word of words) {
      const test = line + word;
      if (c.measureText(test).width > w && line) { lines.push(line.replace(/\s+$/, '')); line = word.replace(/^\s+/, ''); }
      else line = test;
    }
    lines.push(line);
  }
  return lines;
}

export function textHeight(text, size, w) {
  return wrapText(text, size, w).length * size * LINE_RATIO + size * 0.4;
}
