# MyWhiteBoard

Goodnotes-style handwriting whiteboard. Vanilla JS + ES modules, **no build step**.
Hybrid render (Canvas 2D committed layer + overlay), infinite-vertical pages,
IndexedDB autosave. Stroke math (fountain-pen ribbon, smoothing, eraser hit-test)
ported clean from the mySlideMaker draw-tool.

## Run

```bash
python3 -m http.server 8000
# open http://localhost:8000
```
Any static server works (no bundler, no deps).

## Phase 1 (this scaffold)

- **Canvas:** one notebook, pages of fixed A4 width (794px) + infinite vertical height.
- **Tools:** pen (fountain / ballpoint), highlighter, eraser (stroke), shape (line/rect/circle/triangle), select (move + rubber-band), hand (pan).
- **Backgrounds:** plain / grid / dotted / lined (per page).
- **Input (hybrid, Q5-C):** pen inks (pressure→width); mouse inks on desktop; touch pans (1 finger) / pinch-zooms (2 finger) and never inks; palm rejected while a finger is down.
- **Navigation:** vertical scroll = infinite page; horizontal flick (when zoomed out) or ← / → = flip page.
- **Persistence:** debounced autosave to IndexedDB (~1s). Undo/redo in-memory, per page, session-only.

### Keyboard

`P` pen · `M` highlighter · `E` eraser · `S` shape · `T` text · `V` select · `L` lasso · `H` pan ·
`←`/`→` page flip · `Del`/`Backspace` delete selection · `Ctrl+Z` undo · `Ctrl+Shift+Z` / `Ctrl+Y` redo · hold `Space` to pan with mouse · `Ctrl+wheel` zoom.

## Architecture

```
js/
  config.js            constants + per-tool defaults
  state.js             notebook/page/tool state, per-page undo/redo
  engine/strokes.js    fountain ribbon, Catmull-Rom resample, bbox  (ported math)
  engine/eraser.js     segment-distance hit-test (erase + select)
  engine/shapes.js     shape path-data generation
  viewport/camera.js   world<->screen, pan/zoom/fit
  render/paint.js      single-stroke painter (shared by both layers)
  render/renderer.js   committed layer + page background + culling
  render/overlay.js    live stroke, selection rings, rubber-band
  input/pointer.js     pointer routing (pen/mouse/touch), gestures, palm reject
  store/db.js          IndexedDB
  store/autosave.js    debounce
  ui/toolbar.js        toolbar DOM
  main.js              wiring
```

## Phase 2 (done)

- **Library home** (`#lib`): notebook grid w/ live thumbnails, folders sidebar, tags, live search (title + #tag). Create / rename / tag / move / duplicate / delete notebooks; create / delete folders.
- **Multi-notebook** model in IndexedDB (db v2: `notebooks` + `folders` stores). Hash router switches `#lib` ⇄ `#nb/<id>`.
- **Export:** PNG (current page), multi-page PDF (whole notebook, jsPDF via CDN), `.whiteboard` JSON export + import. Buttons in editor toolbar + per-card in library.
- Editable notebook title in the toolbar; autosave writes the open notebook record.

## Phase 3 (done)

- **Text boxes** — `T` tool: tap to place a floating textarea, type (auto-wrap + auto-grow), Esc/blur commits to a `text` stroke. Tap existing text to re-edit.
- **Image insert** — `img` button: pick a raster image, dropped centered + fit to page width as a movable `image` object (select to move, Del to delete).
- **PDF / image page import** — `import pg`: a PDF becomes one annotatable page per PDF page (pdf.js via CDN); an image becomes one page. Drawn as `bgImage` behind your ink; exports include it.
- **Lasso** — `L` tool: freeform-polygon select (point-in-polygon on stroke centers).
- **Shape extras** — `grid` (N×N) and `node` (labeled circle) added to the shape picker.
- **Delete** — `Delete` / `Backspace` removes the current selection.
- **PWA** — installable (manifest + maskable icon), offline via service worker (stale-while-revalidate app shell; CDN libs network-only).

## Roadmap (future)

- Image/text resize handles, node tree-pull auto-edges, cloud sync, multi-select across pages, dark mode.

## Module map (P2/P3 additions)

```
js/router.js               hash routing  #lib <-> #nb/<id>
js/library/{library,libraryView}.js   notebook+folder model + home DOM
js/render/exporter.js      offscreen page rasterizer (camera-free)
js/render/imageCache.js    async image decode cache
js/export/{png,pdf,json,download}.js  exporters
js/engine/text.js          text wrap + measure
js/ui/textEditor.js        floating textarea editor
js/ui/insert.js            image-as-object insert
js/import/pageImport.js    PDF / image -> pages (pdf.js CDN)
manifest.webmanifest sw.js icon.svg   PWA
```

## Notes / known P1 limits

- Touch-only devices (no stylus) can't ink — by design (Q5-C: finger = pan). Pen or mouse required to draw.
- Shapes limited to primitives; grid/node deferred to P3.
- Single notebook (`default`); multi-notebook library is P2.
