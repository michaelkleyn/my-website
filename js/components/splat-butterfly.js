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
  { key: 'orientation', label: 'Orientation', type: 'text', default: 'upright' },
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
  q.setFromEuler(new THREE.Euler(0, -Math.PI / 2, 0));
  return q;
}

function hasWebGL2() {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch (e) {
    return false;
  }
}

// Resolve a manifest URL to a base dir for the frame .ply files.
function dirOf(url) {
  const i = url.lastIndexOf('/');
  return i >= 0 ? url.slice(0, i + 1) : '';
}

// --- flight path ---------------------------------------------------------
// phase in [0,1) around the loop -> world position + heading-derived roll.
function flightAt(phase, radius) {
  const a = phase * Math.PI * 2;
  const x = Math.cos(a) * radius;
  const y = Math.sin(a) * radius * 0.62;        // gentle ellipse (more horizontal)
  const z = Math.sin(a * 2) * 0.45;             // weave toward/away (depth)
  return { x, y, z, a };
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
  const w = Math.max(1, inst.container.clientWidth || 300);
  const h = Math.max(1, inst.container.clientHeight || 300);
  inst.renderer.setSize(w, h, false);
  inst.camera.aspect = w / h;
  inst.camera.updateProjectionMatrix();
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

  // gotcha 4: nudge camera every frame so Spark re-sorts (even when paused).
  const nx = Math.sin(timeMs * 0.0017) * 0.0009;
  inst.camera.position.set(nx, 0, CAM_DIST);
  inst.camera.lookAt(0, 0, 0);

  if (!inst.ready) { inst.renderer.render(inst.scene, inst.camera); return; }

  const paused = inst.ctx.reducedMotion || cfg.mode === 'static';
  const N = inst.order.length;

  // build a play sequence for the flap (loop / ping-pong)
  const loop = cfg.loop;
  const L = loop === 'ping-pong' && N > 2 ? N * 2 - 2 : N;

  if (!paused) inst.flapPhase += dt * (cfg.fps || 12);
  let phase = ((inst.flapPhase % L) + L) % L;

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

  // flight transform (position + banking roll), shared by all visible meshes
  let px = 0, py = 0, pz = 0;
  const q = inst._q;
  q.copy(inst.baseQuat);
  if (cfg.mode === 'flight') {
    if (!paused) inst.flightPhase += dt * (cfg.flightSpeed || 0.13);
    const fp = ((inst.flightPhase % 1) + 1) % 1;
    const p = flightAt(fp, cfg.pathRadius || 1);
    const pAhead = flightAt((fp + 0.01) % 1, cfg.pathRadius || 1);
    px = p.x; py = p.y; pz = p.z;
    const vx = pAhead.x - p.x;
    const bank = THREE.MathUtils.clamp(-vx * 7, -0.5, 0.5); // lean into the turn
    inst._qb.setFromAxisAngle(inst._zAxis, bank);
    q.premultiply(inst._qb);
    // punch-through: when the path crosses the text plane (z=0), fire a ripple
    // at the butterfly's screen position; the bus routes it to any panel there.
    if (!paused && inst.prevZ * pz < 0 && window.__rippleTextBus) {
      const pg = projectToPage(inst, px, py, 0);
      window.__rippleTextBus.impact(pg.x, pg.y, 1.1);
    }
    inst.prevZ = pz;
  }
  if (cfg.autoRotate) {
    inst._qb.setFromAxisAngle(inst._yAxis, timeMs * 0.0004);
    q.multiply(inst._qb);
  }

  // apply: visibility (updateGenerator only on hidden->visible), opacity, transform
  const s = cfg.scale || 1;
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

const def = {
  name: COMPONENT_NAME,
  configSchema,

  async mount(container, ctx) {
    const config = withDefaults(ctx.config);
    if (!hasWebGL2()) return mountFallback(container, 'no-webgl2');

    const canvas = document.createElement('canvas');
    Object.assign(canvas.style, {
      position: 'absolute', inset: '0', width: '100%', height: '100%',
      display: 'block', pointerEvents: 'none',
    });
    container.appendChild(canvas);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0); // transparent — page shows through

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
    camera.position.set(0, 0, CAM_DIST);
    const spark = new SparkRenderer({ renderer });
    scene.add(spark);

    const inst = {
      container, canvas, renderer, scene, camera, spark,
      config, ctx,
      meshes: [], order: [], weight: [],
      baseQuat: baseOrientQuat(config.orientation),
      ready: false, disposed: false,
      flapPhase: 0, flightPhase: 0, lastT: 0, prevZ: 0,
      unframe: null, sizeRO: null,
      _q: new THREE.Quaternion(), _qb: new THREE.Quaternion(),
      _zAxis: new THREE.Vector3(0, 0, 1), _yAxis: new THREE.Vector3(0, 1, 0),
    };
    sizeRenderer(inst);
    if (typeof ResizeObserver !== 'undefined') {
      inst.sizeRO = new ResizeObserver(() => sizeRenderer(inst));
      inst.sizeRO.observe(container);
    }

    loadFrames(inst)
      .then(() => { inst.weight = inst.meshes.map(() => 0); return warmUp(inst); })
      .then(() => { if (!inst.disposed) inst.ready = true; })
      .catch((err) => { console.warn('[splat-butterfly] load failed', err); });

    if (ctx.helpers && typeof ctx.helpers.onFrame === 'function') {
      inst.unframe = ctx.helpers.onFrame((t) => tick(inst, t));
    }
    return inst;
  },

  update(instance, ctx) {
    if (!instance || instance.fallback) return;
    const prevManifest = instance.config && instance.config.manifest;
    instance.config = withDefaults(ctx.config);
    instance.ctx = ctx;
    instance.baseQuat = baseOrientQuat(instance.config.orientation);
    sizeRenderer(instance);
    // re-orient + re-register every mesh after transform/config change (gotcha 2/3)
    const s = instance.config.scale || 1;
    instance.meshes.forEach((m) => {
      if (!m) return;
      m.quaternion.copy(instance.baseQuat);
      m.scale.setScalar(s);
      m.updateGenerator?.();
    });
    // manifest changed -> reload + re-warm
    if (instance.config.manifest !== prevManifest) {
      instance.ready = false;
      instance.meshes.forEach((m) => { if (m) { instance.scene.remove(m); m.dispose?.(); } });
      instance.meshes = [];
      loadFrames(instance)
        .then(() => { instance.weight = instance.meshes.map(() => 0); return warmUp(instance); })
        .then(() => { if (!instance.disposed) instance.ready = true; })
        .catch((err) => console.warn('[splat-butterfly] reload failed', err));
    }
  },

  destroy(instance) {
    if (!instance) return;
    instance.disposed = true;
    if (typeof instance.unframe === 'function') { instance.unframe(); instance.unframe = null; }
    if (instance.sizeRO) { try { instance.sizeRO.disconnect(); } catch (e) { /* noop */ } instance.sizeRO = null; }
    if (instance.meshes) {
      instance.meshes.forEach((m) => { if (m) { try { instance.scene.remove(m); m.dispose?.(); } catch (e) { /* noop */ } } });
      instance.meshes = [];
    }
    if (instance.renderer) { try { instance.renderer.dispose(); } catch (e) { /* noop */ } }
    if (instance.canvas && instance.canvas.parentNode) instance.canvas.parentNode.removeChild(instance.canvas);
    if (instance.box && instance.box.parentNode) instance.box.parentNode.removeChild(instance.box);
  },
};

register(def);
export default def;
