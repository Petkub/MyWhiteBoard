# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

MyWhiteBoard — a Goodnotes-style handwriting whiteboard **plus a standalone Kahoot-style quiz tool**. Vanilla JS, **ES modules, no build step, no framework**. Stroke math (fountain-pen nib model, smoothing, eraser hit-test) was ported clean from a separate slide-maker draw-tool. Whiteboard and quizzes are **separate subsystems** (different IndexedDB stores, different routes) that share the modal/theme/font infrastructure.

## Run / test

```bash
./run.sh            # serves on http://localhost:8000 (python3 / npx serve / php, whichever exists)
./run.sh 3000       # custom port
```

- **Must** be served over http (ES modules + IndexedDB need an http origin; `file://` won't work).
- There is **no build, lint, or test suite**. Validate JS with `node --check <file>` per module.
- After editing, the standard sanity check is: `for f in $(find js -name '*.js'); do node --check "$f"; done` plus a manual reload in the browser.
- `node --check` only catches **syntax** — it will NOT catch a missing/renamed named export (import resolves to `undefined`, fails at runtime). After cross-module changes, also grep that each `import { X }` target actually `export`s `X`.
- There is **no headless browser here** — UI / IndexedDB / canvas behavior can only be verified by the user reloading (they must **hard-reload**, `Ctrl+Shift+R`, since CSS/modules are HTTP-cached). Say so rather than claiming it works.

## Service worker — important

`sw.js` is a **self-unregistering kill-switch**, and it is intentionally NOT registered (`main.js` boot). A caching SW previously served stale modules during iteration and could not be bypassed by hard-refresh. Do not re-add a caching service worker for local development. Only add a **versioned, network-first** SW for a real deployment.

## Architecture

Single-page app with **four** views toggled by a hash router; `js/main.js` is the only entry point and owns `route()` / `show()` (it shows/hides four top-level `<div>`s):
- `#lib` → **library** (notebook home, `#library`)
- `#nb/<id>` → **editor** (canvas, `#editor` which also holds `#tabbar` + `#toolbar` + `#stage`)
- `#quizzes` → **quiz home** (`#quizhome`)
- `#quiz/<id>` → **quiz editor** (`#quizedit`)

Open notebooks appear as **tabs** (`ui/tabs.js`, `#tabbar` above the toolbar) — browser-style strip, persisted in localStorage `wb-tabs`. `#toolbar` is offset to `top:38px`, `#stage` to `top:90px` to make room.

### Data model (one notebook)

```
notebook = { id, title, folderId, tags[], created, updated, current, pages[] }
page     = { bg, strokes[], ph?, bgImage?, bgImageH?, bookmark? }
           // bg: plain|grid|dotted|lined; bgImage = imported PDF/image
           // ph: fixed page height in world px (1123=A4, 794=1:1, 447=16:9) or
           //     null = infinite vertical scroll. PDF/image imports set ph =
           //     bgImageH so the paper ends exactly where the sheet ends.
           //     ph bounds: renderer paper rect, camera pan (setCameraBounds in
           //     main.js), ink (pointer.js clampToPage), exports (exact height).
stroke   = one of:
  pen/highlighter : { tool, color, size, style, taper, sharpness, points:[{x,y,t,p}] }
  shape           : { tool:'shape', kind, color, size, filled, cols, rows, seed, arrowStart, arrowEnd, arrowSize, a, b }
                    // kind: line|arrow|rect|circle|triangle|diamond|grid|node|edge
                    // shapes render hand-drawn via rough.js (engine/rough.js, vendored MIT);
                    // `seed` keeps the sketch stable across re-renders
  node            : shape + { id, label? }     edge: { kind:'edge', from:<nodeId>, to:<nodeId> }
  image           : { tool:'image', src, x, y, w, h }
  text            : { tool:'text', x, y, w, text, size, color }   // Excalifont (vendored), falls back to Inter
                    // Typst-style inline math: $...$ spans in `text` render as
                    // MathJax SVG boxes inline (render/mathInline.js cache);
                    // source stays plain text — the editor shows `$x^2$`, the
                    // canvas shows the rendered formula
  emoji           : { tool:'emoji', char, x, y, size }
  math            : { tool:'math', latex, color, size, x, y, w, h, src }
                    // LaTeX -> MathJax SVG data-URL (render/mathjax.js, vendored offline);
                    // behaves like an image (x,y,w,h,src) but stores latex for re-editing
```

Holding **Shift** while drawing pen/highlighter constrains to a straight line (start→cursor); holding Shift while drawing a shape equal-aspect-locks it (square/circle). The fountain pen width is a **broad-nib angle model** (`engine/strokes.js#fountainStroke`) — thick perpendicular to the nib, thin parallel — so straight lines keep full nib character.

All stroke coordinates are **world/page coordinates** (page is fixed `PAGE_W=794` wide, infinite vertical height). `locked: true` makes a stroke immune to move/erase/delete.

### Module map

```
config.js          constants + per-tool defaults (TOOL_DEFAULTS, COLORS, PAGE_W, clamp)
state.js           THE central store: open notebook, tool, per-page undo/redo, selection.
                   Mutations go through mutate()/addStroke()/recordUndo(); they call
                   state.onMutate (render + autosave) and state.onPageChange (wired in main.js).
                   Per-tool user prefs persist to localStorage 'wb-tools' (whitelisted
                   fields only — min/max/step/stabilize always come from TOOL_DEFAULTS).
router.js          hash routing: #lib, #nb/<id>, #quizzes, #quiz/<id>
engine/strokes.js  fountainStroke() (broad-nib width), resampleCenterline (Catmull-Rom),
                   smoothing, strokeBBox. PORTED MATH — change carefully.
engine/shapes.js   shape path-data; node/edge helpers (nodeCenter/Radius/AtRim/MapOf)
engine/rough.js    hand-drawn shape rendering via rough.js (vendored); roughDrawable()/
                   renderDrawable()/drawArrowHead(). Seeded per shape for stability.
engine/eraser.js   segment-distance hit-test (eraser + select)
engine/text.js     text layout: tokenize (words / spaces / $...$ math spans) +
                   greedy wrap + height. layoutText() returns positioned items
                   per line (math spans = unbreakable words that grow line
                   height); shared by paint + textHeight so bbox matches paint.
                   Math box sizes come via setMathMeasure hook (wired in
                   main.js to render/mathInline.js — engine stays import-pure).
render/mathInline.js inline-math cache: measureMath(latex,size) metrics +
                   mathSrc(latex,size,color) SVG data URL (2x supersampled,
                   inline display mode, size quantized to ints so resize drags
                   don't flood the cache). Estimate until MathJax lands, then
                   setMathReadyCallback -> render() reflows.
viewport/camera.js world<->screen transform; pan/zoom/fit (camera is a shared singleton).
                   setCameraBounds (wired in main.js) clamps vertical pan/zoom to the
                   page bottom when the current page has a fixed height (page.ph).
                   fitPage(vw,vh): fixed-ph pages (PDF/image imports, A4/1:1/16:9)
                   contain-fit the whole page on screen (min of width/height fit),
                   vertically centered by resetTop(vw,vh); infinite pages fall back
                   to fitWidth. Called on route open, page change (fixed pages only),
                   window resize, spread toggle, page-size pick.
render/paint.js    drawStroke(ctx, s, nodeMap) — single source of truth for how every
                   stroke type paints. Shared by committed layer, live overlay, and export.
render/renderer.js committed layer: page bg + strokes, viewport culling, edge-under-node pass
render/overlay.js  live (in-progress) stroke, selection rings, rubber-band, lasso
render/exporter.js offscreen, camera-free page rasterizer (used by PNG/PDF export)
render/imageCache.js async image decode cache (drawStroke gets null until decoded)
render/mathjax.js  LaTeX -> standalone SVG via MathJax (vendored, classic <script>)
input/pointer.js   THE input brain (see below)
store/db.js        IndexedDB v5: stores `notebooks`, `folders`, `quizzes`,
                   `images` ({id,src,w,h,created,folderId|null}) + `imgfolders`
                   ({id,name,created}) — the user-curated image collection
store/autosave.js  debounced save of the open notebook
library/*.js        notebook+folder CRUD model + library home DOM ("sketchbook desk"
                    UI: tilted cards w/ ⋯ popover, folder divider-tabs w/ counts +
                    "+" add, import ▾ dropdown, multi-select mode for bulk move /
                    delete, Excalifont headers). createNotebook(title, folderId,
                    { bg, ph }) seeds the first page.
export/*.js         PNG / PDF (jsPDF via CDN) / .whiteboard JSON
import/pageImport.js PDF/image -> pages. renderFileToPages() returns page records
                   (library: new notebook); importFileAsPages() appends to current.
                   Pages get ph = bgImageH (fixed paper = sheet size). PDFs raster
                   at ~3x the 794 world width (cap 4x pdf scale) so zoom stays sharp
                   — resolution is baked at import time. PDF pages store as JPEG
                   0.85 (white pre-fill — JPEG has no alpha), ~5-10x smaller than
                   the old PNG; direct image imports keep the original file bytes.
cloud/*.js         sync-lite: MANUAL push/pull of notebook records to a private
                   Supabase Storage bucket 'notebooks' (same project/keys as live
                   quiz, separate lazy client in supa.js that persists the auth
                   session). sync.js: email+password auth + <uid>/<id>.json per
                   notebook + <uid>/index.json (id -> title/updated/pages/bytes)
                   so listing needs no downloads; last push wins, pull overwrites
                   local (confirmed if a local copy exists). cloudUI.js: ☁ cloud
                   panel (library header) = login / cloud list; push lives in the
                   notebook card ⋯ menu. Bucket + RLS policies are created by
                   hand in the Supabase dashboard (see cloud/sync.js header).
ui/toolbar.js      editor toolbar. Main bar is layout-STABLE and center-clustered
                   (left: ☰ + undo/redo · center: tools tray + swatches + size
                   slider · right: pages + status, balanced by two .tb-spacer).
                   Swatch "+" opens the .tb-colorpop popover (color well + hex
                   field + "+ add"; "your colors" grid with hover-✕ remove;
                   localStorage 'wb-custom-colors', max 8 — no right-click
                   gestures). Per-tool options live in the floating .tb-sub bar
                   (centered under the bar); ☰ menu holds title / paper tiles /
                   page-size picker (sets page.ph) / insert / export / clear +
                   delete page. .tb-sub, .tb-menu and .tb-colorpop are wired
                   inside .tb then reparented LAST.
ui/tabs.js         notebook tab strip (open set + active, persisted to localStorage).
                   Fixed 160px tabs, per-id accent stripe, library button first,
                   whole tab clicks, middle-click closes, active tab merges into
                   the cream toolbar (margin-bottom -2px over the strip border).
ui/pagesPanel.js   pages drawer: bottom film-strip of page thumbnails (slides
                   up; opened from the toolbar .tb-pages-btn chip = grid icon +
                   counter). Tilted sheets, click jumps, hover actions ⚑/✕,
                   ⚑ toggles page.bookmark (red ribbon + "⚑ bookmarks" filter),
                   ✕ deletes (state.removePage: resets the index-keyed
                   undo/redo stacks, NOT undoable; last page is blanked instead
                   of removed). Closes on outside click except clicks inside
                   .modal-backdrop; active sheet auto-scrolled into view.
ui/textEditor.js   floating, width-resizable <textarea> for text boxes
ui/mathEditor.js   floating LaTeX editor (KaTeX live preview -> MathJax SVG object)
ui/insert.js       insert image as a movable object (insertImageFile/
                   insertImageSrc — inserting does NOT touch the collection).
                   addImagesToCollection(files, folderId) is the only writer.
                   The tools-tray image button (.tb-imglib-btn, not a drawing
                   tool) and the ☰ insert row's "🖼 collection" both open the
                   .tb-imgpop manager: folder chips ("all" + folders + "+ folder",
                   hover-✕ deletes folder and unfiles its images), "+" tile
                   uploads into the active folder, thumb = insert, 📁 = move
                   via modalChoose, hover-✕ = remove. Wired in .tb, reparented
                   LAST like the other popovers; outside-click close ignores
                   .modal-backdrop clicks.
ui/zoomHud.js      floating zoom controls bottom-left of #stage: −/+ step zoom
                   (×1.25 about viewport center), % label resets to 100%, ⛶
                   focus re-runs fitPage+resetTop. syncZoomHud() refreshes the %
                   label — called from the pointer camera-change handler and
                   every fitPage call site (route, page change, resize, spread
                   toggle, page-size pick).
ui/modal.js        promise-based modals (modalPrompt/Confirm/Alert/Choose/NewNotebook)
                   — use these, NOT native prompt()/confirm()/alert().
                   modalNewNotebook returns { title, bg, ph } for createNotebook opts.
ui/theme.js        light/dark theme: sets data-theme on <html>, persists to localStorage
quiz/*.js          QUIZ SUBSYSTEM (see below)
```

### Quiz subsystem (`js/quiz/*`, separate from notebooks)

A quiz is a standalone document in its own IndexedDB store (`quizzes`): `{ id, title, questions:[ {question, choices[2-4], time, points} ] }`. Each question/choice content block holds any of **text / latex / code(+lang) / image** (`quizModel.js#blankContent`).
- `quizModel.js` — model + validity helpers (`questionValid`/`hasContent`). `quizLib.js` — CRUD on the `quizzes` store.
- `quizHome.js` (`#quizzes`) — cards with accent-colored doodle covers, ⋯ popover, a ▶ play button (calls `playQuiz` directly), title search, and a multi-select mode for bulk delete (reuses the library's `.lib-selbar` / `.picked` styles; `.qh-grid.selmode` hides per-card actions). `quizEditorView.js` (`#quiz/<id>`) — **paged** editor (one question at a time, numbered nav + ↑/↓ reorder); debounced-saves; nav pills go dashed while a question isn't playable (live-refreshed in place, no rebuild).
- `questionForm.js` — renders one editable question card. Each content block is **tabbed** (text/math/code/image — one kind visible, green dot = kind holds content, switching never deletes); correct answer = pill toggle button (white ring on the tile).
- `quizPlay.js` — fullscreen solo play-through: timer (+numeric countdown, red <25%), speed-scaled score, per-tile/question zoom, fits one screen. Choice tiles are red/blue/purple/green (app accents, **not** Kahoot's) with ▲◆●■ badges — same order as the editor's `.qz-c0..c3`.
- `katex.js` (LaTeX preview + quiz render) and `hljs.js` (code highlight + language label) are **CDN-lazy, quiz-only**.
- `tiles.js` — shared choice-tile builder (`buildTile`, `TILE_COLORS`, `TILE_SHAPES`) used by solo play AND live multiplayer.
Reached via "Quizzes →" in the library header; quiz home has "← Notebooks".

### Live multiplayer (`js/quiz/live/*`, up to 30 players + host)

Internet play over **Supabase Realtime** (broadcast + presence; SDK CDN-lazy from `net.js`). **Host-browser-authoritative**: host runs the timer, validates answers (deadline + 500ms grace, first answer locks), scores with the solo speed curve; players send only `hello` and `answer {q, c}`. One channel per room: `quiz:<6-char code>` (alphabet excludes 0/O/1/I).
- `config.js` — `SUPABASE_URL`/`SUPABASE_ANON_KEY` (anon key is public by design; placeholders until filled) + `MAX_PLAYERS=30`.
- `protocol.js` — code gen, **`sanitizeQuestion` strips `correct` flags before anything hits the wire** (players must never receive answers; `reveal` carries correct indices), `shrinkImage` (≤1024px JPEG; also used by `questionForm.js` at insert time), `questionForWire` re-compresses to fit broadcast payload caps, `csvFromGame`.
- `host.js` — state machine lobby→question→reveal(auto on timeout/all-answered)→leaderboard→podium (other transitions host-clicked); sessionStorage snapshot `wb-live-host` after each phase → `resumeHostIfAny()` (called in `main.js` boot) survives host tab reload; QR code CDN-lazy; CSV export on podium. Entry: "host live" in quiz-card ⋯ popover + "📡 Host live" in the quiz editor head.
- `player.js` — `#join`/`#join/<CODE>` route (join form: code + nickname) + thin-client screens; `wb-live-player` sessionStorage lets a refresh reclaim the same playerId/score; "host left" banner after 15s presence absence; `closePlayer()` no-ops unless the player UI owns `#livegame` (host shares the container).
- `#livegame` is a fixed fullscreen overlay div in `index.html` (like `#quizplay`), shown via inline display. `sync` broadcasts (on every join/subscribe/phase change) make all screens idempotently re-renderable mid-game. Every player sees the full question on their own device (no projector mode); the host doesn't play.

### Rendering pipeline (two canvases)

`#committed` (under, `pointer-events:none`) holds finished strokes; `#overlay` (top) takes all input and shows the live stroke + selection. Both apply the same `camera` transform. `render/paint.js#drawStroke` is shared by both layers **and** the exporter — so on-screen ink always matches committed ink and exports. When adding a new stroke type you must handle it in **five** places: `paint.js#drawStroke` (draw), `strokes.js#strokeBBox` (cull/select), `eraser.js#strokeHitsPoint` (erase/select), and `pointer.js` (`translateSelected` + `strokeCenter`). Miss one and the type draws but can't be moved/erased/selected.

**Two-page spread (book view).** `state.spread` (localStorage `wb-spread`; book-icon toggle in the toolbar pages group) shows fixed pairs — even index left, odd right, `SPREAD_GAP=24` between. Stroke coords stay **active-page-local everywhere**; only edges translate: `renderer.js#drawPageAt` draws each page of the pair under `ctx.translate(dx,0)`, `overlay.js#world()` adds `ctx.translate(curPageOffsetX(),0)`, `pointer.js#toWorld` subtracts `curPageOffsetX()` from input, and `textEditor`/`mathEditor`/`insert` add/subtract it when crossing world↔screen. Tapping the inactive page of the pair activates it via `setPageQuiet` (`state.onPageQuiet` — render + syncPages, **no camera reset**). Page nav goes through `state.flipPage(dir)` (step 1 single / pair-aligned 2 in spread). Camera fit/centering reads width from the `setWorldWidth` provider (`spreadWorldWidth()`), vertical clamp from `spreadPh()` (max of pair, null if either infinite). In spread mode ink x is clamped to `[0, PAGE_W]` so strokes can't cross the gap. Adding spread-offset-sensitive code? Grep `curPageOffsetX` first.

### Input model (`input/pointer.js`)

Hybrid, by `pointerType`:
- **pen** → inks (pressure→width). **mouse** → inks (unless `hand` tool, Space held, or middle button → pan). **touch** → gestures only (1-finger pan + horizontal-flick page-flip when zoomed out; 2-finger pinch-zoom), never inks. An incoming touch cancels an in-progress stroke (palm rejection).
- **Laser pointer** (`laser` tool, K): ephemeral glow on the overlay, two styles in its .tb-sub (persisted via `style` pref): **hold** (default — stroke stays at full alpha while drawing, whole stroke fades `LASER_HOLD_FADE_MS=450` after release) and **trail** (comet — points expire `LASER_LIFE_MS=700` after drawn). rAF loop `pointer.js#laserFrame` + `overlay.js#drawLaserTrails`. Never committed: no stroke record, no undo, no autosave, nothing in paint.js/bbox/eraser.
- Tools: pen, highlighter, eraser (geometric stroke hit-test), shape (picker kinds: line/arrow/rect/circle/grid/node — triangle/diamond exist in code but are dropped from the picker), text (taps open `ui/textEditor.js`), math (taps open `ui/mathEditor.js`), select (tap/rubber-band move + lock), lasso (point-in-polygon select + lock), hand. (The emoji tool was removed; `emoji` rendering is kept so old objects survive.)
- Node **tree-pull**: with shape=node, dragging from an existing node's rim spawns a child node + connecting edge.
- **Scratch-to-erase** (pen, default on, "⌫ scratch" chip in the pen sub-bar, pref `pen.scratch`): at commit, `eraser.js#isScribble` (path/diag ≥ 3, ≥ 5 sharp reversals, ≥ 12 pts) turns a pen scribble into an erase of whatever it touches (`eraseAt` along the path, undoable via recordUndo). Over empty paper the scribble commits as normal ink. Shift-straight strokes never scratch.
- A DOM brush-ring cursor shows eraser/highlighter/pen size on the page.
- **Clipboard** (`state.js`): Ctrl+C/X/V/D on the selection — internal, session-only, page-local coords (paste works cross-page, +16px offset, pasted copies unlocked + selected, node ids regenerated with edges remapped/dropped). Ctrl+V with an EMPTY stroke clipboard falls through to the window `paste` event, which inserts an OS-clipboard image (screenshot paste) via `insertImageFile`.
- `text`/`math` are single-tap placements (no drag; re-tap to edit). `lock` is tool-agnostic — toggles `locked` on `state.selected` (red ring); shown for select **and** lasso. After a mutation, `main.js#reflectSelection` redraws rings for select+lasso.
- **Resize handles**: selecting a single `text`/`image`/`math`/`emoji` draws 8 handles (`overlay.js#isResizable`/`handlePoint`, `pointer.js#applyResize`). Text side-edges = width, corners/vertical = font scale; image/math corners keep aspect.

### Theming

All UI color/font comes from CSS variables in `css/theme.css`. The **Inter** font is the UI font (`--font-ui`; `--font-mono` is a legacy alias pointing at it — there is no monospace any more). **Excalifont** (vendored handwriting font) is the display font for headings/brands/titles across library, quiz screens, modals, and toolbar accents. Dark theme is `:root[data-theme="dark"]` overriding the same variables (plus `color-scheme: dark` so UA form controls/scrollbars follow); `--ink-strong` (#000 light / #fff dark) is the hover-darken for ink-filled buttons. `ui/theme.js` toggles `data-theme` on `<html>` and persists to localStorage, applied in `main.js` boot. **Dark theme styles the app shell + desk only — the page paper is canvas-drawn white (`renderer.js`/`exporter.js` hardcode `#fff`), kept white so ink stays visible and exports are theme-independent.** Don't drive page/ink colors from the theme.

### Undo / persistence

Per-page in-memory undo/redo stacks in `state.js` (session-only, reset on reload). Autosave is debounced (~1s) and writes the whole open-notebook record to IndexedDB. Image inserts and stroke edits are undoable; PDF/image page imports are not.

localStorage keys: `wb-theme` (light/dark), `wb-tabs` (open notebook tabs + active), `wb-tools` (per-tool prefs), `wb-custom-colors` (user swatches, max 8).

## Conventions

- Match the existing style: ES module `import`/`export`, arrow fns, `const`/`let` (no `var`), `el.append()`, template literals, semicolons.
- Keep it dependency-free at runtime. Two strategies for the few libs used:
  - **Vendored** (offline): `assets/vendor/rough.esm.js` (hand-drawn shapes), `assets/vendor/mathjax-tex-svg.js` (LaTeX→SVG, loaded as a classic `<script>` by `render/mathjax.js`), and the text fonts `assets/fonts/Excalifont-Regular.woff2` (Latin) + `Itim-{thai,latin}.woff2` (Thai handwriting, `@font-face` w/ unicode-range in `theme.css`).
  - **CDN, on-demand only** (never core): jsPDF (`export/pdf.js`), pdf.js (`import/pageImport.js`), KaTeX (`quiz/katex.js` — quiz LaTeX preview only) , highlight.js (`quiz/hljs.js`). Loaded lazily; never make core drawing depend on the network.
- Coordinates passed around are world coordinates unless a variable is explicitly a screen/local one.
- `engine/strokes.js` and `engine/shapes.js` carry the ported geometry; the pixel-eraser clip mode from the original is the only part not yet ported.

### Gotchas that have bitten (do not repeat)
- **`el.style.display = ''` does NOT show** an element whose stylesheet sets `display:none` — clearing the inline style falls back to the `none` rule. Set an explicit value (`'block'`/`'flex'`).
- **The `hidden` attribute loses to any author `display` rule.** A class with `display:flex` keeps a `hidden` element visible. Always pair: `.foo[hidden] { display: none; }` (see `.lib-pop[hidden]`).
- **Reparenting a node invalidates `parent.querySelector` scope.** Wire all event listeners while the node is still under the queried root, then move it (e.g. the ☰ dropdown + `.tb-sub` are built in `.tb`, wired, then appended to `#toolbar` last).
- **Independent CSS transform properties (`translate`/`rotate`/`scale`) compose BEFORE the `transform` property.** Mixing a `scale` class with inline `transform: translate(...)` scales the translation → element jumps. Position with the `translate` *property* instead (see `.brush-cursor`).
- **Equal-specificity CSS overrides follow source order**, not authoring intent — the `.lib-importpop` anchor was silently beaten by the later `.lib-pop` rule; scope overrides (`.lib-impwrap .lib-importpop`) when reusing a styled class.
- Selection rings/handles draw on a **4px-padded bbox** (`overlay.js`); `pointer.js#handleAt` pads identically — change both together or handle grab zones drift at zoom.
- `image`/`math`/`emoji` strokes share the same `{x,y,w,h|size,src}` shape — most pointer/bbox/paint branches treat them together; keep that grouping when extending.
