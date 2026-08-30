# Splat / Component Integration Guide

Audience: the agent building the **real** Three.js + [Spark](https://sparkjs.dev) Gaussian-splat
code (`SplatButterfly`) and the ripple-text shader panel (`RippleTextPane`).

The Layout Compositor's scene renderer (`js/scene-renderer.js`, classic script) mounts visual
**components** into a fixed full-viewport layer (`.scene-layer`) based on scene nodes of
`kind: "component"`. This doc explains the seam your code plugs into. You do **not** touch the
renderer, the registry, or the adapter stubs' public shape — you fill in the WebGL internals
behind the lifecycle hooks they already define.

Adapter stubs you are replacing / extending:

- `js/components/splat-butterfly.js` — your `SplatButterfly` goes here.
- `js/components/ripple-text.js` — your `RippleTextPane` goes here.

Shared infra (do **not** change the public API):

- `js/components/registry.js` — `register(def)` / `get(name)` + `window.sceneComponents`.

---

## 1. The component `def` interface

Each component module is an **ES module** that, on import, **self-registers** and
**default-exports** its def:

```js
import { register } from './registry.js';
const def = { name, configSchema, mount, update, destroy };
register(def);
export default def;
```

| Field          | Type                                   | Purpose |
| -------------- | -------------------------------------- | ------- |
| `name`         | `string`                               | Registry key. Matches `node.component` in the scene JSON (`"splat-butterfly"`, `"ripple-text"`). |
| `configSchema` | `Array<FieldSpec>`                     | Drives the editor inspector AND documents every key you read from `ctx.config`. |
| `mount`        | `async (container, ctx) => instance`   | Build your renderer/scene/meshes into `container`; return an opaque instance handle. |
| `update`       | `(instance, ctx) => void`              | Called after **any** transform / breakpoint / config change. |
| `destroy`      | `(instance) => void`                   | Tear everything down (dispose GL, cancel fetches, remove DOM). |

`FieldSpec`:

```js
{ key, label, type: 'number'|'text'|'enum'|'boolean'|'url',
  default, options?: string[], min?, max?, step? }
```

`splat-butterfly` configSchema (keep these keys/types stable — the editor and scene JSON depend
on them):

| key           | type    | default                                   | options                  |
| ------------- | ------- | ----------------------------------------- | ------------------------ |
| `manifest`    | url     | `assets/splats/butterfly/manifest.json`   | —                        |
| `fps`         | number  | `24`                                      | 1..60                    |
| `order`       | enum    | `row`                                     | row / col / custom       |
| `loop`        | enum    | `ping-pong`                               | loop / ping-pong / once  |
| `mode`        | enum    | `flap`                                    | flight / flap / static   |
| `autoRotate`  | boolean | `false`                                   | —                        |
| `lazyLoad`    | boolean | `true`                                    | —                        |
| `scale`       | number  | `1`                                       | 0.05..20                 |
| `orientation` | text    | `upright`                                 | —                        |

---

## 2. The `ctx` object

`ctx` is passed to `mount`, `update`, and is the source of every input you need:

```
ctx = {
  config,            // resolved config object keyed by your configSchema keys
  transform,         // { x, y, w, h, scale, rot, orientation }
  breakpoint,        // 'mobile' | 'tablet' | 'desktop'
  reducedMotion,     // boolean — mirror of prefers-reduced-motion
  helpers,
}
```

`transform` units: `x, y, w, h` are in the renderer's resolved geometry for the active
breakpoint (the renderer positions/sizes the **container** div for you via generated CSS;
`transform` gives you the same numbers so you can size your camera/canvas and place meshes).
`scale` and `rot` (degrees) come from the node placement; `orientation` echoes the config.

`helpers`:

```
helpers = {
  resolveAnchor(anchorSpec): { left, top, width, height } | null,
  pointer(): { x, y },          // last known pointer position (page coords)
  onFrame(cb): () => void,      // register cb(timeMs, dtMs) on the renderer's SHARED rAF;
                                //   returns an UNREGISTER function
  reducedMotion: boolean,
}
```

Use **`helpers.onFrame`** for all per-frame work — do **not** start your own
`requestAnimationFrame` loop. There is exactly one shared rAF; you get its time/dt and you must
keep the returned unregister fn to call in `destroy`.

---

## 3. Renderer lifecycle (how mount/update/destroy fire)

For each `kind: "component"` node the renderer:

1. `await import(node.module)` — your module self-registers via `registry.js`.
2. `def = window.sceneComponents.get(node.component)`.
3. Creates a **mount container** `<div data-node-id=…>` inside `.scene-layer`, positioned and
   sized from the node's per-breakpoint placement (generated CSS). `container` is
   `position: relative`-ish within the absolutely-positioned node element — you can fill it with
   `position:absolute; inset:0`.
4. `instance = await def.mount(container, ctx)`.
5. On **any** scene edit, transform change, or breakpoint switch: `def.update(instance, ctx)`.
   The renderer **guarantees** `update` is called after transform changes — so this is where you
   re-run `mesh.updateGenerator()` (gotcha 2).
6. On removal / scene swap: `def.destroy(instance)`.
7. The shared rAF runs continuously; your `onFrame` callbacks fire every frame until unregistered.

`.scene-layer` is `position:fixed; inset:0; pointer-events:none; z-index:1`. Your canvas
inherits non-interactivity; if you need pointer input, read `helpers.pointer()` (the layer itself
stays click-through so the page text above it stays usable).

---

## 4. Where your code plugs in

### `SplatButterfly` (in `js/components/splat-butterfly.js`)

- **`mount`**: create `THREE.WebGLRenderer` with a `<canvas>` appended to `container`; build a
  `THREE.Scene` + `THREE.PerspectiveCamera` (or ortho); load the manifest, then the `.ply` frames
  via Spark's loader; build one `SplatMesh` per frame; **warm up** (gotcha 1); orient each mesh
  (gotchas 3 + 5); apply the initial transform and call `updateGenerator()` (gotcha 2). Register
  an `onFrame` callback that advances the flipbook and nudges the camera (gotcha 4). Honor
  `config.lazyLoad` (defer frame fetches until first paint / in view) and `reducedMotion` (hold a
  single frame).
- **`update`**: re-apply transform → `mesh.updateGenerator()` on every mesh; re-orient per mesh;
  reconfigure flipbook on `fps`/`mode`/`loop` changes; reload + re-warm-up if `manifest` changed.
- **`destroy`**: unregister the frame cb; `renderer.dispose()`; dispose geometries/textures/
  SplatMeshes; cancel in-flight fetches; remove the canvas.

### `RippleTextPane` (in `js/components/ripple-text.js`)

- A single flat quad whose texture is the rendered `text` (color/fontSize from config). Fragment
  shader applies ripple + shimmer. The ripple is triggered by an **impact point in UV space**:
  map a pointer/scroll event (via `helpers.pointer()` + the panel's screen rect) to UV `[0..1,
  0..1]`, pass it + a start time into uniforms, and animate decaying concentric rings in `onFrame`.
  Pause shimmer under `reducedMotion`.

---

## 5. Asset layout

```
assets/splats/<name>/
  manifest.json        # frame list + metadata
  <frame>.ply          # one Gaussian-splat .ply per flipbook frame
```

`splat-butterfly` defaults to `assets/splats/butterfly/manifest.json`. Suggested manifest shape
(pretty-printed, 2-space indent, trailing newline — matches repo JSON convention):

```json
{
  "name": "butterfly",
  "fps": 24,
  "order": "row",
  "frames": [
    { "file": "frame-000.ply" },
    { "file": "frame-001.ply" }
  ]
}
```

`order` (`row`/`col`/`custom`) lets you describe how frames map to the animation cycle if they
were authored as a grid; `custom` means the `frames[]` order is authoritative.

---

## 6. The five Spark gotchas → lifecycle hooks

| # | Gotcha | Symptom if ignored | Where to handle |
| - | ------ | ------------------ | --------------- |
| 1 | **Warm-up**: pre-render (compile) each frame mesh **once** before flipbook playback. | Swapping frames faster than the GPU compiles a fresh mesh → blank frames. | `mount` → `warmUpFrames()` before the first `onFrame` advance. Re-warm on `manifest` change in `update`. |
| 2 | **`mesh.updateGenerator()` after ANY transform.** Spark caches a generator. | Splats render at the **stale** transform. | `update` → apply transform, then call `updateGenerator()` on every mesh. |
| 3 | **Group rotation is ignored.** Spark ignores a parent `THREE.Group`'s rotation for splat orientation. | Rotation has no visual effect. | Orient **each `SplatMesh` directly** (its own quaternion), never the container group — in `mount` and `update`. |
| 4 | **Sorting only updates when the camera moves.** Depth-sort is lazy. | Popping / wrong draw order on a static camera. | `onFrame` → nudge `camera.position` by a sub-pixel epsilon **every frame** (even when the flipbook is paused/static). |
| 5 | **Orientation convention.** The butterfly's thin axis is **X**. | Renders edge-on / lying flat. | To sit upright: rotate **-90° about Y**, then **180° roll** (about Z). Apply per mesh (see #3); selected by `config.orientation === 'upright'`. |

---

## 7. Environment & graceful fallback

- Requires **WebGL2** and **network access** (to fetch `.ply` frames).
- If WebGL2 is unavailable **or** the manifest/frames fail to load: fall back gracefully — show
  the node's poster image if provided, otherwise hide the component. Never throw out of `mount` in
  a way that breaks the rest of the scene; the renderer wraps imports in `.catch()`, but you
  should still resolve `mount` with a benign instance (or a fallback-rendered one).
- Under **`prefers-reduced-motion`** (`ctx.reducedMotion === true`): pause flight/flap — hold a
  single representative frame. (You may still nudge the camera once after a resize so a re-sort
  happens, then settle.)

---

## 8. Contract checklist (don't break these)

- [ ] Module is an ES module; imports `register` from `./registry.js`.
- [ ] Calls `register(def)` at import time and `export default def`.
- [ ] `def.name` unchanged (`"splat-butterfly"` / `"ripple-text"`).
- [ ] `configSchema` keys/types unchanged (add new keys only additively, with defaults).
- [ ] `mount` is `async`, returns an instance handle; never starts its own rAF (use
      `helpers.onFrame`).
- [ ] `update` re-applies transform and calls `updateGenerator()` (gotcha 2).
- [ ] `destroy` unregisters the frame cb (the fn returned by `onFrame`) and disposes all GL +
      DOM.
- [ ] No global side effects beyond `register()` and `window.sceneComponents` (owned by the
      registry).
```
