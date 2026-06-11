// LaTeX -> standalone SVG (MathJax, vendored offline). Used to place math as a
// crisp, scalable image object on the canvas. fontCache:'none' makes each SVG
// self-contained so it serializes to a data URL that drawImage can render.

const SRC = 'assets/vendor/mathjax-tex-svg.js';
let ready = null;

function ensure() {
  if (ready) return ready;
  // combined tex-svg bundle already includes base+ams; no loader -> no network
  window.MathJax = {
    tex: { inlineMath: [['$', '$']] },
    svg: { fontCache: 'none' },
    startup: { typeset: false },
    options: { enableAssistiveMml: false },
  };
  ready = new Promise((resolve, reject) => {
    const sc = document.createElement('script');
    sc.src = SRC; sc.async = true;
    sc.onload = () => window.MathJax.startup.promise.then(() => resolve(window.MathJax)).catch(() => resolve(window.MathJax));
    sc.onerror = reject;
    document.head.appendChild(sc);
  });
  return ready;
}

// Render LaTeX to { src (svg data URL), w, h } at the given pixel font size.
export async function renderMathToImage(latex, color = '#111', fontPx = 30) {
  const MJ = await ensure();
  const node = MJ.tex2svg(latex, { display: true });
  const svg = node.querySelector('svg');
  if (!svg) throw new Error('render failed');
  svg.style.color = color; // paths use fill="currentColor"

  const probe = document.createElement('div');
  probe.style.cssText = `position:absolute;left:-9999px;top:0;font-size:${fontPx}px;`;
  probe.appendChild(svg);
  document.body.appendChild(probe);
  const rect = svg.getBoundingClientRect();
  const w = Math.max(8, Math.ceil(rect.width)) || fontPx * 4;
  const h = Math.max(8, Math.ceil(rect.height)) || fontPx * 2;
  svg.setAttribute('width', w);
  svg.setAttribute('height', h);
  const xml = new XMLSerializer().serializeToString(svg);
  probe.remove();

  const src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
  return { src, w, h };
}
