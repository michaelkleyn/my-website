/**
 * splat-butterfly — REAL Three.js + Spark implementation (ES module).
 *
 * Fills in the adapter seam documented in docs/SPLAT-INTEGRATION.md: a Gaussian-
 * splat butterfly flipbook (one SplatMesh per wingbeat frame) with weighted
 * multi-frame interpolation, plus a `flight` mode that flies the butterfly along
 * a path (default: a circle). Honors the five Spark gotchas (warm-up, transform
 * /updateGenerator, per-mesh orientation, camera-nudge sorting, orientation
 * convention) and the mount/update/destroy + onFrame contract.
 */

import { register } from './registry.js';
import * as THREE from 'three';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';

const COMPONENT_NAME = 'splat-butterfly';
const DEFAULT_MANIFEST = 'assets/splats/butterfly/manifest.json';
const CAM_DIST = 4;

const configSchema = [
  { key: 'manifest', label: 'Manifest URL', type: 'url', default: DEFAULT_MANIFEST },
  { key: 'fps', label: 'Frames / sec', type: 'number', default: 12, min: 1, max: 60, step: 1 },
  { key: 'order', label: 'Frame order', type: 'enum', default: 'custom', options: ['row', 'col', 'custom'] },
  { key: 'loop', label: 'Loop mode', type: 'enum', default: 'ping-pong', options: ['loop', 'ping-pong', 'once'] },
  { key: 'mode', label: 'Animation mode', type: 'enum', default: 'flap', options: ['flight', 'flap', 'static'] },
  { key: 'autoRotate', label: 'Auto-rotate', type: 'boolean', default: false },
  { key: 'lazyLoad', label: 'Lazy load', type: 'boolean', default: true },
  { key: 'scale', label: 'Scale', type: 'number', default: 1, min: 0.05, max: 20, step: 0.05 },
  { key: 'orientation', label: 'Orientation', type: 'enum', default: 'upright',
    options: ['upright', 'face-path', 'tilt', 'free'] },
  // --- flight (additive; defaults keep existing behaviour) -----------------
  { key: 'blend', label: 'Interp blend', type: 'number', default: 1.6, min: 1, max: 4, step: 0.1 },
  { key: 'flightSpeed', label: 'Flight speed', type: 'number', default: 0.13, min: 0.01, max: 2, step: 0.01 },
  { key: 'pathRadius', label: 'Path radius', type: 'number', default: 1.0, min: 0.1, max: 3, step: 0.05 },
  // JSON array of {x,y,z} control points (screen-normalized); empty = circle. (Phase B)
  { key: 'flightPath', label: 'Flight path (JSON)', type: 'text', default: '' },
];

function withDefaults(config) {
  const out = {};
  for (const f of configSchema) out[f.key] = f.default;
  if (config && typeof config === 'object') {
    for (const k of Object.keys(config)) if (config[k] !== undefined) out[k] = config[k];
  }
  return out;
}

// --- math helpers --------------------------------------------------------
const blendKernel = (x) => (x < 1 ? 0.5 * (1 + Math.cos(Math.PI * x)) : 0);

// Orientation for these TripoSplat frames: thin axis is X; -90° about Y turns
// the dorsal side to the camera, head already up. (gotcha 5; applied per mesh.)
function baseOrientQuat(orientation) {
  const q = new THREE.Quaternion();
  switch (orientation) {
    case 'free':                                              // keyframe rotations are absolute
      q.identity(); break;
    case 'tilt':                                              // 3/4 downward tilt — dynamic look
      q.setFromEuler(new THREE.Euler(0.6, -Math.PI / 2, 0)); break;
    case 'face-path':                                         // base upright; heading roll added in flight
    case 'upright':
    default:
      q.setFromEuler(new THREE.Euler(0, -Math.PI / 2, 0));    // dorsal to camera, head up
  }
  return q;
}

// Cache the WebGL2 probe and release its context — creating a probe context per
// mount (under editor churn) otherwise leaks GL contexts toward the ~16 limit.
let _webgl2 = null;
function hasWebGL2() {
  if (_webgl2 !== null) return _webgl2;
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    _webgl2 = !!gl;
    if (gl) {
      const ext = gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
    }
  } catch (e) {
    _webgl2 = false;
  }
  return _webgl2;
}

// Resolve a manifest URL to a base dir for the frame .ply files.
function dirOf(url) {
  const i = url.lastIndexOf('/');
  return i >= 0 ? url.slice(0, i + 1) : '';
}

// --- flight path ---------------------------------------------------------
const DEPTH_SCALE = 0.6;

// Map node-box-normalized coords (u,v in [0,1] across the box, depth in [-1,1])
// to a world point on the z=0 plane (+ depth in z), via the component camera.
// The editor authors paths in this space so they line up with the on-screen box.
function worldFromNorm(camera, u, v, depth, out) {
  const targetZ = (depth || 0) * DEPTH_SCALE;
  // unproject the screen point, then intersect the camera ray with the ACTUAL
  // depth plane z=targetZ (not z=0 then override) so the point projects back to
  // exactly (u,v) under perspective and stays glued to the drawn spline.
  out.set(u * 2 - 1, 1 - v * 2, 0.5).unproject(camera);
  const dz = out.z - camera.position.z;
  const t = dz !== 0 ? (targetZ - camera.position.z) / dz : 0;
  return out.set(
    camera.position.x + (out.x - camera.position.x) * t,
    camera.position.y + (out.y - camera.position.y) * t,
    targetZ
  );
}

// Build a closed Catmull-Rom curve from the authored flightPath, or null (=>
// circle). Also caches per-point rotation quaternions + scales for keyframing.
function buildCurve(inst) {
  inst.curve = null;
  inst.pathPoints = null;
  inst.pathQuats = null;
  const raw = inst.config && inst.config.flightPath;
  if (!raw) return;
  let pts;
  try { pts = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return; }
  if (!Array.isArray(pts) || pts.length < 2) return;
  const world = pts.map((p) => worldFromNorm(
    inst.camera,
    p.u != null ? p.u : p.x,
    p.v != null ? p.v : p.y,
    p.depth != null ? p.depth : (p.z || 0),
    new THREE.Vector3()
  ));
  // centripetal: passes through every control point WITHOUT the overshoot/loops
  // of uniform catmull-rom, so the butterfly hugs the drawn path instead of
  // bulging outside it. getPoint(i/N) still lands exactly on control point i
  // (closed curve uses uniform t->segment mapping), so keyframes stay aligned.
  inst.curve = new THREE.CatmullRomCurve3(world, true, 'centripetal');
  inst.pathPoints = pts;
  inst.pathQuats = pts.map((p) => {
    const r = p.rot || {};
    const d = Math.PI / 180;
    return new THREE.Quaternion().setFromEuler(
      new THREE.Euler((r.x || 0) * d, (r.y || 0) * d, (r.z || 0) * d));
  });
}

// position along the flight loop at phase in [0,1): custom spline or default
// circle. Uses natural param (getPoint) for the spline so keyframes (point i at
// t=i/N) stay aligned with the geometry.
function pathPoint(inst, t, out) {
  if (inst.curve) return inst.curve.getPoint(((t % 1) + 1) % 1, out);
  const a = t * Math.PI * 2, r = inst.config.pathRadius || 1;
  return out.set(Math.cos(a) * r, Math.sin(a) * r * 0.62, Math.sin(a * 2) * 0.45);
}

// Interpolate per-keyframe rotation (slerp) + scale (lerp) between adjacent
// control points at phase t. Returns the scale multiplier; writes rot to outQuat.
function keyframeAt(inst, t, outQuat) {
  const qs = inst.pathQuats, pts = inst.pathPoints;
  if (!qs || !qs.length) { outQuat.identity(); return 1; }
  const N = qs.length;
  const f = ((((t % 1) + 1) % 1)) * N;
  const i0 = Math.floor(f) % N;
  const i1 = (i0 + 1) % N;
  const frac = f - Math.floor(f);
  outQuat.copy(qs[i0]).slerp(qs[i1], frac);
  const s0 = pts[i0].scale != null ? pts[i0].scale : 1;
  const s1 = pts[i1].scale != null ? pts[i1].scale : 1;
  return s0 + (s1 - s0) * frac;
}

// Project a world point in the butterfly's scene to page coordinates, so the
// shared ripple bus can route an impact to whatever text panel sits under it.
const _proj = new THREE.Vector3();
function projectToPage(inst, x, y, z) {
  _proj.set(x, y, z).project(inst.camera);
  const r = inst.canvas.getBoundingClientRect();
  return {
    x: r.left + window.scrollX + (_proj.x * 0.5 + 0.5) * r.width,
    y: r.top + window.scrollY + (-_proj.y * 0.5 + 0.5) * r.height,
  };
}

// --- sizing --------------------------------------------------------------
function sizeRenderer(inst) {
  // Full-viewport: the butterfly's world spans the page, not the node box.
  const w = Math.max(1, window.innerWidth);
  const h = Math.max(1, window.innerHeight);
  inst.renderer.setSize(w, h, false);
  inst.camera.aspect = w / h;
  inst.camera.updateProjectionMatrix();
  buildCurve(inst); // flight path maps through the camera; rebuild on aspect change
}

// --- frame loading + warm-up --------------------------------------------
async function loadFrames(inst) {
  const url = inst.config.manifest || DEFAULT_MANIFEST;
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error('manifest ' + res.status);
  const manifest = await res.json();
  const base = dirOf(url);
  const frames = Array.isArray(manifest.frames) ? manifest.frames : [];
  if (!frames.length) throw new Error('manifest has no frames');

  inst.meshes = frames.map(() => null);
  await Promise.all(frames.map((f, i) => new Promise((resolve) => {
    const mesh = new SplatMesh({
      url: base + f.file,
      onLoad: () => {
        mesh.visible = false;
        mesh.quaternion.copy(inst.baseQuat);
        mesh.scale.setScalar(inst.config.scale || 1);
        mesh.updateGenerator?.();
        resolve();
      },
    });
    inst.meshes[i] = mesh;
    inst.scene.add(mesh);
  })));

  // play order (custom = manifest order); loop / ping-pong handled in tick
  inst.order = inst.meshes.map((_, i) => i);
}

// Spark compiles a generator the first time each mesh renders; pre-warm so
// rapid frame swaps don't blank. (gotcha 1)
async function warmUp(inst) {
  const waitFrames = (n) => new Promise((res) => {
    let k = 0;
    const tick = () => (++k > n ? res() : requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  });
  for (let i = 0; i < inst.meshes.length; i++) {
    if (inst.disposed) return;
    const m = inst.meshes[i];
    if (!m) continue;
    inst.meshes.forEach((x, j) => { if (x) x.visible = j === i; });
    m.updateGenerator?.();
    inst.renderer.render(inst.scene, inst.camera);
    await waitFrames(2);
  }
  inst.meshes.forEach((m) => m && (m.visible = false));
}

// --- per-frame update ----------------------------------------------------
function tick(inst, timeMs) {
  if (inst.disposed || !inst.renderer) return;
  const cfg = inst.config;
  const dt = inst.lastT ? Math.min((timeMs - inst.lastT) / 1000, 0.05) : 0;
  inst.lastT = timeMs;

  if (!inst.ready) { inst.renderer.render(inst.scene, inst.camera); return; }

  const paused = inst.ctx.reducedMotion || cfg.mode === 'static';
  const N = inst.order.length;

  // build a play sequence for the flap (loop / ping-pong)
  const loop = cfg.loop;
  const L = loop === 'ping-pong' && N > 2 ? N * 2 - 2 : N;

  if (!paused) inst.flapPhase += dt * (cfg.fps || 12);
  // 'once' clamps at the final frame (and holds); loop / ping-pong wrap.
  const phase = loop === 'once'
    ? Math.min(inst.flapPhase, L - 1)
    : ((inst.flapPhase % L) + L) % L;

  // weighted multi-frame blend (interpolation) -> per-mesh opacity weight
  const blend = Math.max(1, cfg.blend || 1.6);
  for (let i = 0; i < inst.meshes.length; i++) inst.weight[i] = 0;
  let sum = 0;
  const seqAt = (pos) => (loop === 'ping-pong' && N > 2)
    ? inst.order[pos < N ? pos : 2 * N - 2 - pos]
    : inst.order[((pos % N) + N) % N];
  for (let pos = 0; pos < L; pos++) {
    let d = Math.abs(pos - phase);
    if (loop !== 'once') d = Math.min(d, L - d); // wrap for looping modes
    sum += blendKernel(d / blend);
  }
  if (sum > 0) {
    for (let pos = 0; pos < L; pos++) {
      let d = Math.abs(pos - phase);
      if (loop !== 'once') d = Math.min(d, L - d);
      const w = blendKernel(d / blend) / sum;
      if (w > 0) inst.weight[seqAt(pos)] += w;
    }
  }

  // flight transform (position + orientation + scale), shared by all visible meshes
  let px = 0, py = 0, pz = 0;
  let frameScale = cfg.scale || 1;
  const q = inst._q;
  q.copy(inst.baseQuat);
  if (cfg.mode === 'flight') {
    if (!paused) inst.flightPhase += dt * (cfg.flightSpeed || 0.13);
    const fp = ((inst.flightPhase % 1) + 1) % 1;
    pathPoint(inst, fp, inst._p);
    pathPoint(inst, (fp + 0.02) % 1, inst._pa);
    px = inst._p.x; py = inst._p.y; pz = inst._p.z;
    // normalized heading so bank/heading don't depend on sample step or point density
    let vx = inst._pa.x - inst._p.x;
    let vy = inst._pa.y - inst._p.y;
    const vlen = Math.hypot(vx, vy);
    if (vlen > 1e-5) { vx /= vlen; vy /= vlen; } else { vx = 0; vy = 0; }
    if (cfg.orientation === 'face-path') {
      const head = Math.atan2(vy, vx) - Math.PI / 2; // head points along travel
      inst._qb.setFromAxisAngle(inst._zAxis, head);
      q.premultiply(inst._qb);
    } else if (cfg.orientation !== 'free') {
      const bank = THREE.MathUtils.clamp(-vx * 0.6, -0.5, 0.5); // lean into the turn
      inst._qb.setFromAxisAngle(inst._zAxis, bank);
      q.premultiply(inst._qb);
    }
    // 'free' => no auto-bank; only base + authored keyframe rotation applies
    // per-keyframe rotation (slerp) + scale (lerp) between control points
    if (inst.curve) {
      frameScale *= keyframeAt(inst, fp, inst._qk);
      q.multiply(inst._qk);
    }
  }
  if (cfg.autoRotate) {
    inst._qb.setFromAxisAngle(inst._yAxis, timeMs * 0.0004);
    q.multiply(inst._qb);
  }

  // Ripple on ENTERING a registered text panel — a screen-space test (works for
  // any drawn path regardless of depth), with a cooldown so it fires once per
  // pass instead of every frame while overlapping. Flight-only: in flap/static
  // px/py/pz stay at the origin and would fire a spurious fixed-point ripple.
  if (!paused && cfg.mode === 'flight') {
    const bus = inst.ctx.helpers && inst.ctx.helpers.bus;
    if (bus) {
      const pg = projectToPage(inst, px, py, pz);
      const over = bus.hitTest(pg.x, pg.y);
      const now = timeMs / 1000;
      if (over && !inst.wasOverPanel && now - inst.lastRipple > 0.45) {
        bus.impact(pg.x, pg.y, 1.1);
        inst.lastRipple = now;
      }
      inst.wasOverPanel = over;
    }
  }

  // apply: visibility (updateGenerator only on hidden->visible), opacity, transform
  const s = frameScale;
  for (let idx = 0; idx < inst.meshes.length; idx++) {
    const m = inst.meshes[idx];
    if (!m) continue;
    const w = inst.weight[idx];
    const want = w > 0.004;
    if (want && !m.visible) { m.visible = true; m.updateGenerator?.(); } // gotcha 1/2
    else if (!want && m.visible) { m.visible = false; }
    if (want) {
      m.opacity = Math.min(1, w * 1.25);     // auto-detected by Spark
      m.position.set(px, py, pz);            // object transform: auto-detected
      m.quaternion.copy(q);                  // gotcha 3: per-mesh, not group
      if (m.scale.x !== s) m.scale.setScalar(s);
    }
  }

  inst.renderer.render(inst.scene, inst.camera);
}

// --- graceful fallback ---------------------------------------------------
function mountFallback(container, reason) {
  const box = document.createElement('div');
  Object.assign(box.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
  box.setAttribute('data-component', COMPONENT_NAME);
  box.setAttribute('data-fallback', reason || '');
  container.appendChild(box);
  return { fallback: true, box, unframe: null, disposed: false };
}

// Tear down a live GL instance that has FAILED (load/reload error) and swap in a
// fallback. Marks it disposed + removes listeners so a later resize/update can't
// touch a null renderer, and stores the fallback box so destroy() cleans it up.
// Shared by the mount and reload failure paths; idempotent (guards on disposed).
function failGL(inst, reason) {
  if (!inst || inst.disposed) return;
  inst.disposed = true;
  if (typeof inst.unframe === 'function') { inst.unframe(); inst.unframe = null; }
  if (inst._onResize) { window.removeEventListener('resize', inst._onResize); inst._onResize = null; }
  if (inst._onCtxLost && inst.canvas) { inst.canvas.removeEventListener('webglcontextlost', inst._onCtxLost); inst._onCtxLost = null; }
  if (inst.meshes) { inst.meshes.forEach((m) => { if (m) { try { inst.scene.remove(m); m.dispose?.(); } catch (e) { /* noop */ } } }); inst.meshes = []; }
  if (inst.spark) { try { inst.scene.remove(inst.spark); inst.spark.dispose?.(); } catch (e) { /* noop */ } inst.spark = null; }
  if (inst.renderer) { try { inst.renderer.dispose(); } catch (e) { /* noop */ } inst.renderer = null; }
  if (inst.canvas && inst.canvas.parentNode) inst.canvas.parentNode.removeChild(inst.canvas);
  inst.canvas = null;
  if (inst.container) { inst.fallback = true; inst.box = mountFallback(inst.container, reason).box; }
}

const def = {
  name: COMPONENT_NAME,
  configSchema,

  async mount(container, ctx) {
    const config = withDefaults(ctx.config);
    if (!hasWebGL2()) return mountFallback(container, 'no-webgl2');

    const canvas = document.createElement('canvas');
    // Full-viewport, fixed: the butterfly roams the whole page and is NOT clipped
    // to the node box (the box is just the editor's selection anchor; size is the
    // `scale` config, the route is `flightPath`).
    // CRITICAL: do NOT append into `container` — the node container carries a CSS
    // transform (from its placement), and a transformed ancestor becomes the
    // containing block for position:fixed, which would offset this canvas by the
    // box's transform (so the butterfly drifts off the drawn path, and the drift
    // changes when the box moves/scales). Mount into the non-transformed
    // .scene-layer (the container's parent) so `fixed` is truly viewport-relative.
    Object.assign(canvas.style, {
      position: 'fixed', left: '0', top: '0', width: '100vw', height: '100vh',
      display: 'block', pointerEvents: 'none',
    });
    (container.parentNode || document.body).appendChild(canvas);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0); // transparent — page shows through

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
    camera.position.set(0, 0, CAM_DIST);
    camera.lookAt(0, 0, 0); // set once; Spark's SparkRenderer.autoUpdate re-sorts each frame
    const spark = new SparkRenderer({ renderer });
    scene.add(spark);

    const inst = {
      container, canvas, renderer, scene, camera, spark,
      config, ctx,
      meshes: [], order: [], weight: [],
      baseQuat: baseOrientQuat(config.orientation),
      ready: false, disposed: false, _loadGen: 0,
      flapPhase: 0, flightPhase: 0, lastT: 0,
      wasOverPanel: false, lastRipple: 0,
      unframe: null, _onResize: null,
      curve: null, pathPoints: null, pathQuats: null,
      _p: new THREE.Vector3(), _pa: new THREE.Vector3(),
      _q: new THREE.Quaternion(), _qb: new THREE.Quaternion(), _qk: new THREE.Quaternion(),
      _zAxis: new THREE.Vector3(0, 0, 1), _yAxis: new THREE.Vector3(0, 1, 0),
    };
    sizeRenderer(inst);
    inst._onResize = () => sizeRenderer(inst);
    window.addEventListener('resize', inst._onResize);
    inst._onCtxLost = (e) => { e.preventDefault(); inst.ready = false; }; // keep restorable, stop ticking
    canvas.addEventListener('webglcontextlost', inst._onCtxLost, false);

    loadFrames(inst)
      .then(() => { inst.weight = inst.meshes.map(() => 0); return warmUp(inst); })
      .then(() => { if (!inst.disposed) inst.ready = true; })
      .catch((err) => {
        console.warn('[splat-butterfly] load failed', err);
        failGL(inst, 'load-failed'); // disposes + removes listeners + shows fallback
      });

    if (ctx.helpers && typeof ctx.helpers.onFrame === 'function') {
      inst.unframe = ctx.helpers.onFrame((t) => tick(inst, t));
    }
    return inst;
  },

  update(instance, ctx) {
    // No-op on a torn-down/failed instance (renderer null) — the editor fast path
    // (fastUpdate -> updateComponents -> update) must not deref a dead renderer.
    if (!instance || instance.fallback || instance.disposed || !instance.renderer) return;
    const prevManifest = instance.config && instance.config.manifest;
    instance.config = withDefaults(ctx.config);
    instance.ctx = ctx;
    instance.baseQuat = baseOrientQuat(instance.config.orientation);
    instance.wasOverPanel = false; // path/mode may have changed; re-arm the entry test
    sizeRenderer(instance);
    // re-orient + re-register every mesh after transform/config change (gotcha 2/3)
    const s = instance.config.scale || 1;
    instance.meshes.forEach((m) => {
      if (!m) return;
      m.quaternion.copy(instance.baseQuat);
      m.scale.setScalar(s);
      m.updateGenerator?.();
    });
    // manifest changed -> reload + re-warm (guarded so rapid edits / failures are safe)
    if (instance.config.manifest !== prevManifest) {
      instance.ready = false;
      instance.meshes.forEach((m) => { if (m) { instance.scene.remove(m); m.dispose?.(); } });
      instance.meshes = [];
      const gen = ++instance._loadGen;
      loadFrames(instance)
        .then(() => {
          if (instance.disposed || gen !== instance._loadGen) return; // superseded by a newer reload
          instance.weight = instance.meshes.map(() => 0);
          return warmUp(instance);
        })
        .then(() => { if (!instance.disposed && gen === instance._loadGen) instance.ready = true; })
        .catch((err) => {
          console.warn('[splat-butterfly] reload failed', err);
          if (!instance.disposed && gen === instance._loadGen) failGL(instance, 'reload-failed');
        });
    }
  },

  destroy(instance) {
    if (!instance) return;
    instance.disposed = true;
    if (typeof instance.unframe === 'function') { instance.unframe(); instance.unframe = null; }
    if (instance._onResize) { window.removeEventListener('resize', instance._onResize); instance._onResize = null; }
    if (instance._onCtxLost && instance.canvas) { instance.canvas.removeEventListener('webglcontextlost', instance._onCtxLost); instance._onCtxLost = null; }
    if (instance.meshes) {
      instance.meshes.forEach((m) => { if (m) { try { instance.scene.remove(m); m.dispose?.(); } catch (e) { /* noop */ } } });
      instance.meshes = [];
    }
    // dispose the SparkRenderer (its GL resources) BEFORE the WebGLRenderer
    if (instance.spark) { try { instance.scene.remove(instance.spark); instance.spark.dispose?.(); } catch (e) { /* noop */ } instance.spark = null; }
    if (instance.renderer) { try { instance.renderer.dispose(); } catch (e) { /* noop */ } instance.renderer = null; }
    if (instance.canvas && instance.canvas.parentNode) instance.canvas.parentNode.removeChild(instance.canvas);
    if (instance.box && instance.box.parentNode) instance.box.parentNode.removeChild(instance.box);
  },
};

register(def);
export default def;
