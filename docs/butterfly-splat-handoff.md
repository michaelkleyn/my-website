# Butterfly splat — handoff for the website-element / media editor

## What it is
An animated **3D Gaussian-splat butterfly** for the personal website. It's a
monarch (red `#E74E4D`, blue `#23448D`, dark-blue wing outline `#0B388B`) rendered
as fuzzy volumetric "splats" rather than polygons. The wingbeat is a **frame-based
splat animation**: a set of per-pose splat clouds played in sequence like a 3D
flipbook.

The eventual full experience (not all wired yet):
- butterfly **flies around** the page in 3D,
- **punches through a "text pane"** (a flat panel of text) — at the entry/exit
  point the text **ripples** outward with a **Matrix-style light shimmer**,
- eventually **perches and flaps in place**,
- **re-launches** when the mouse comes near.

## Tech stack (important: differs from the rest of the site)
- **Three.js `0.180`** + **`@sparkjsdev/spark` `2.1.0`** (a Gaussian-splat
  renderer for Three.js), loaded via an **ESM import map from CDN**. No build step.
- The rest of the site uses anime.js + plain scripts on older Three; the splat
  pages carry their **own import map**, so keep them isolated or reconcile the
  Three version if combining.
- Requires **WebGL2** and **internet** (CDN for three + spark + the splat files
  are local).

Import map used:
```html
<script type="importmap">{ "imports": {
  "three": "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js",
  "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/",
  "@sparkjsdev/spark": "https://sparkjs.dev/releases/spark/2.1.0/spark.module.js"
}}</script>
```

## Assets
- The artist supplied **one `.ply`** containing the whole flap cycle as a spatial
  atlas (all ~20 poses laid out in a 4×5 grid in one cloud), 262k splats, ~18 MB.
  → `assets/splats/atlas.ply`
- A script **splits it into 20 recentered per-frame `.ply` files**
  → `assets/splats/frames/cell_r{row}_c{col}.ply`
- An **optimized** set (drop normals + decimate to ~5.6k splats/frame) →
  `assets/splats/frames_opt/…`, **~6 MB total** for all 20 frames (was 17 MB).
- `assets/splats/manifest.json` — ordered list of frames `[{file,row,col}]`.
- Frames are **independently reconstructed** (each pose was image→splat), so there
  is **no point-to-point correspondence** between frames. → transitions must be
  **cross-fade / dissolve**, NOT vertex morphing.

## Files (in this worktree / branch `feature/butterfly-3d`)
- `frames.html` + `js/splat/frames.js` — the **flap player** (the core reusable
  splat-animation component; orbit + order/fps controls).
- `splat.html` + `js/splat/viewer.js` — a single-splat **inspector** (orbit,
  splat count, bbox, orientation flip) for validating assets.
- `scripts/split-splat.mjs` — splits an atlas `.ply` into per-frame clouds
  (`--grid 4x5` or voxel flood-fill clustering).
- `scripts/optimize-splat.mjs` — strips spherical-harmonics + decimates a `.ply`.
- `butterfly.html` + `js/butterfly/*` — an **earlier procedural-mesh** version of
  the butterfly with the **flight + text-pane ripple** scene already built. The
  splat will replace the mesh as the flying object; the ripple/flight logic is
  reusable (`text-pane.js`, flight state machine in `scene.js`).

## How the splat element renders (and the gotchas an editor MUST respect)
These are non-obvious Spark behaviors we hit; bake them into any element wrapper:

1. **Warm-up before fast playback.** Spark compiles a per-mesh "generator" the
   first time each `SplatMesh` actually renders. If you swap frames faster than
   that first compile, frames render **blank**. Fix: at load, briefly show each
   frame once (calling `mesh.updateGenerator()`) so all are compiled, *then* play.
2. **Re-register on transform change.** After setting a `SplatMesh`'s
   position/rotation/scale, call `mesh.updateGenerator()` or it won't update.
3. **Spark ignores a parent `Group`'s rotation.** Orient each `SplatMesh`
   **directly** (set its own quaternion), not via a wrapping group.
4. **Sorting updates on camera movement.** A fully static camera can render
   nothing on first frames. Keep the camera (or splats) moving, or force an
   update. The player uses a gentle `OrbitControls.autoRotate` which doubles as
   the "look around it" feature.
5. **Orientation:** each frame's thin axis is **X**; to face the dorsal side at
   the camera, rotate **-90° about Y** then **180° about the view axis** (right-
   side up). This is tunable; current default lives in `js/splat/frames.js`.
6. **Visibility:** only one frame is "current" at a time (others `visible=false`).
   Two simultaneously visible during a dissolve transition (planned).

## Config knobs a wrapping "element" should expose
- `frames` / `manifest` URL (which splat set)
- `fps`, `order` (row-major | column-major | custom sequence), `loop`
  (loop | ping-pong), `reverse`
- `scale`, `position`, base `orientation`
- background color (page uses cream `#f3efe2`)
- mode: `flap-in-place` (current) vs `flight` (planned) vs `static`
- `autoRotate` on/off
- lazy-load (recommended — splats are heavier than img/video; ~6 MB here)

## Current state
- ✅ Atlas split → 20 clean centered frames; optimized to ~6 MB.
- ✅ Flap player renders + plays + orbits (warm-up fix in place).
- ⏳ Frame **order** being confirmed by the artist (sprite-sheet reading order is
  the default guess).
- ⏳ **Dissolve / scatter-reform** transition between frames (planned; needs
  Spark's dyno/objectModifier shader-graph for GPU displacement + opacity).
- ⏳ **Integration** into the flight + text-pane-ripple scene.

## For the editor specifically
Treat this as **two composable elements**:
1. **SplatButterfly** — a canvas/Three layer that plays a frame set with the
   config above. Self-contained; can live on its own canvas or share a scene.
2. **RippleTextPane** — a flat text panel with a ripple+shimmer shader (already
   prototyped in `js/butterfly/text-pane.js`), triggered by an impact point in
   UV space. Reusable independent of the butterfly.

Key constraints for embedding: WebGL2 + CDN access, the Spark warm-up/refresh
rules above, and lazy-loading the `.ply` set after the page is interactive.
