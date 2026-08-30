# Journal trace pipeline

Turns a photo of the traveler's journal into paintable objects for `lab/journal-trace.html`.

1. `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt`
2. SAM ViT-B checkpoint (375 MB): `curl -L -o sam_vit_b_01ec64.pth https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth`
3. `python segment.py data/journal-ref.jpg seg sam_vit_b_01ec64.pth` — automatic masks + `seg/overlay.png` / `seg/grid.png` to review
4. Edit `SPEC` / `OCCLUDE` in `extract2.py` (which auto masks or box/point/negative prompts make each object, what lies on top of it,
   and whether it is `flat` (rectified through a 4-corner homography) / `rect` (straight outline)); per-object tuning lives in `overrides.json`
   (`k` colours, `lines` density, `erode`, `flatten` lighting, `ms` mean-shift, edge thresholds, `smooth`, `paint` overrides passed to the lab). Then
   `python extract2.py data/journal-ref.jpg seg sam_vit_b_01ec64.pth data overrides.json` — writes `data/objects.json` (center/rot/outline/colour layers/edge lines per object), `data/crops/`, `data/masks-overlay.png`.
   (`extract.py` is the first, un-rectified version.)
5. `python gen-lab.py` — embeds `data/objects.json` + `data/ref-720.jpg` into `../journal-trace.html`
6. Review loop: `node sprites.mjs "http://127.0.0.1:8765/lab/journal-trace.html?objects=a,b" out/` paints headlessly and exports each sprite;
   `python review.py data/crops out/ review.png` makes a source-vs-painted contact sheet. Adjust `overrides.json`, repeat.

The lab paints every recipe once with p5.brush (standalone build) and lays the pieces out where they sit in the photo.

## Journal base (illustrated journal → layers)

`data/journal2.png` is the blank illustrated journal. `python journal-parts.py data/journal2.png seg2 sam_vit_b_01ec64.pth data/parts2`
(after `segment.py` has produced `seg2/masks.npz` for it) cuts it into `data/parts2/*.png` RGBA layers — shadow, cover (leather continued under the
pages), block (page stack), page-left, page-right, stitches — plus `parts.json` (bbox + z) and review sheets. `python gen-builder.py` embeds them
(downscaled ×0.75) into `../journal-builder.html`, the layered builder page: drag/lift/explode layers, drop any image onto the table to add a piece.

## Page-turn poses + sequencer

`python turns.py sam_vit_b_01ec64.pth data/turns data/turns/sheet1.png … sheet4.png` cuts each 3×2 sprite sheet into `data/turns/items/sN-M.png`
(SAM box prompt per cell, positive points on the paper, negative points on the cell's corners/edges; box mask unioned only for paper-toned pixels)
and writes `items.json` + `contact.png`. `python gen-sequencer.py` embeds the notebook layers (×0.75) and the 24 items into
`../page-turn-sequencer.html`: named sequences (saved in the browser, export/import JSON), steps with hold times, per-page x/y/scale/rotation/mirror/
opacity/z, duplicate, copy-to-next-step, swap image, onion skin, playback. Coordinates are notebook space so sequences can be merged with the notebook later.

## Compiled journal → Boids Lab

`python gen-journal.py` builds the compiled journal data (notebook layers, the page poses the sequences use, `data/props/props.json` placement,
`data/sequences/*.json`) and writes both `../turn-player.html` and the `<script id="journal-data">` block inside `../boids-lab.html`.
In the Boids Lab the Journal group places the object on the pond; the boulder (any prop with `layer: "under"`) is rasterised into the
ripple grid as an obstacle — fish steer around it, waves reflect off it. Arrange mode there edits the same props; `journalProps` in the
lab's Config JSON overrides `props.json` at runtime.

## Leave a fish (visitor fish in the pond)

The paper button at the bottom right of the Boids Lab opens a card where a visitor designs a small fish and releases it into the pond;
the pond paints it with the same brushes as the school. Designs (~200 bytes) live in `PondStore` — this browser's storage in the lab,
or a Postgres/PostgREST table on the site. Policy, wiring and the SQL are in `../pond/README.md` and `../pond/pond_fish.sql`.

## Book mode (the pond drawn on a journal's pages)

`book-pages.py <sam ckpt> data/book/book.png data/book` segments the two pages of the big journal photo with SAM (box + point prompts,
negatives along the spine and on the cover; each page is then its convex hull, cut at the spine line) and writes `pages.png`
(0 / 128 left / 255 right), `pages-overlay.png` to review, `book.jpg` (the embeddable photo) and `book.json` (bboxes, spine x, gap,
surround colour). `gen-book.py` injects photo + masks into `../boids-lab.html` as `<script id="book-data">`.
In the lab (Book group) the pond is drawn into a world the size of the page spread and multiplied onto the photo through the page
mask — the ink takes the paper's shading and grain, and stops at the page edges; the spine band is left out so fish pass under it.
The mask is live-editable: spine band / inset / feather sliders over a distance field of the SAM pages, plus a soft brush (paint in /
erase, undo, reset) whose strokes are a separate layer saved into the config as `bookMask`; "Copy final mask PNG" exports the
composed mask at photo resolution for production.


## Where things live now (redesign branch)

The lab is no longer one file. `lab/boids-lab.html` is a ~150-line page that loads `css/pond.css` + `css/lab.css`, the vendored
`js/vendor/p5.brush-2.2.2.js`, and the module entry `js/lab/main.js` (parity hooks + `createPond` + `mountPanel`). The pond itself is
`js/pond/*` (`pond.js` = `createPond`, `boot.js` = `bootPond` for the site, `assets.js` = loaders), the panel is `js/lab/panel.js`
(+ `panel-dom.js` markup template), the visitor card is `js/pond/visitors/*`.

Assets are files under `assets/pond/`: `journal/journal.json` (+ `notebook/`, `items/`, `props/`, `hatch/`), `book/book.json`
(+ `book.webp`, `pages.png`), `pond.config.json` (the site's config — the panel's **Save to site** writes it through the dev
server's `POST /__editor/pond`), and `atlas/<key>.{json,webp}` (pre-rendered fish atlas; used only while the config still hashes
to `<key>`).

- `gen-journal.py [--sources <pond-sources backup>] [--out assets/pond/journal]` and `gen-book.py` now emit those files (the PNG
  sources are not in git: they are backed up in `assets/_unshipped/pond-sources/` of the main checkout).
- `npm run dev` → http://127.0.0.1:5173/lab/boids-lab.html (design mode); `lab/site-test.html` boots the pond the way the site will.
- `npm run build:lab` → `dist/lab.html`, one self-contained file (esbuild bundle + inlined assets) for the claude.ai artifact.
- `node scripts/pond/render-atlas.mjs` (dev server running) → `assets/pond/atlas/<key>.*`.
- `node scripts/pond/shot.mjs <url> <out> [--ready expr] [--post expr]` — the headless Chrome driver used for every check.
