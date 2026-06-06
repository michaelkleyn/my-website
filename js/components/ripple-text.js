/**
 * ripple-text — REAL Three.js implementation (ES module).
 *
 * A flat quad carrying rendered text as a texture; a fragment shader applies a
 * Matrix-style ripple + shimmer radiating from impact points expressed in UV
 * space. Impacts come from the pointer (helpers.pointer) and — via the shared
 * scene bus — from other components (e.g. the butterfly punching through the
 * text). Conforms to the component host contract (configSchema + mount/update/
 * destroy + onFrame). See docs/SPLAT-INTEGRATION.md.
 */

import { register } from './registry.js';
import * as THREE from 'three';

const COMPONENT_NAME = 'ripple-text';
const MAX_RIPPLES = 8;

const configSchema = [
  { key: 'text', label: 'Text', type: 'text', default: 'ripple' },
  { key: 'color', label: 'Color', type: 'text', default: '#23448d' },
  { key: 'fontSize', label: 'Font size (px)', type: 'number', default: 48, min: 8, max: 400, step: 1 },
];

function withDefaults(config) {
  const out = {};
  for (const f of configSchema) out[f.key] = f.default;
  if (config && typeof config === 'object') {
    for (const k of Object.keys(config)) if (config[k] !== undefined) out[k] = config[k];
  }
  return out;
}

// Shared, additive cross-component channel so the butterfly (or anything) can
// fire ripples by page coordinates. Components self-register their panels.
const bus = (window.__rippleTextBus = window.__rippleTextBus || {
  panels: new Set(),
  // impact(pageX, pageY, strength): route to any panel under that point.
  impact(pageX, pageY, strength) {
    this.panels.forEach((p) => p._impactPage(pageX, pageY, strength == null ? 1 : strength));
  },
});

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const FRAG = /* glsl */ `
  precision highp float;
  #define MAX_RIPPLES ${MAX_RIPPLES}
  uniform sampler2D uMap;
  uniform float uTime;
  uniform float uAspect;
  uniform vec4 uRipples[MAX_RIPPLES]; // xy=center uv, z=startTime, w=strength
  uniform vec3 uShimmer;
  uniform vec3 uSparkle;
  varying vec2 vUv;

  const float RING_SPEED = 0.62;
  const float LIFE = 1.9;
  const float BAND = 0.055;
  const float WAVE_FREQ = 70.0;
  const float DISP_SCALE = 0.022;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453123); }

  void main() {
    vec2 uv = vUv;
    vec2 disp = vec2(0.0);
    float glow = 0.0;
    float spark = 0.0;
    for (int i = 0; i < MAX_RIPPLES; i++) {
      vec4 rp = uRipples[i];
      if (rp.w <= 0.001) continue;
      float age = uTime - rp.z;
      if (age < 0.0 || age > LIFE) continue;
      vec2 d = uv - rp.xy; d.x *= uAspect;
      float dist = length(d);
      float ringR = age * RING_SPEED;
      float edge = dist - ringR;
      float bandG = exp(-(edge*edge)/(BAND*BAND));
      float decay = 1.0 - age / LIFE;
      float amp = rp.w * decay;
      vec2 dir = dist > 1e-4 ? d / dist : vec2(0.0);
      dir.x /= uAspect;
      disp += dir * sin(edge * WAVE_FREQ) * bandG * amp * DISP_SCALE;
      glow += bandG * amp;
      vec2 cell = floor(uv * 240.0);
      spark += step(0.86, hash(cell + floor(age * 26.0))) * bandG * amp;
    }
    glow = clamp(glow, 0.0, 1.4);
    vec4 tex = texture2D(uMap, uv + disp);
    vec3 col = tex.rgb + uShimmer * glow * 0.85 + uSparkle * spark * 1.3;
    float alpha = clamp(tex.a + glow * 0.7 + spark * 0.9, 0.0, 1.0);
    gl_FragColor = vec4(col, alpha);
  }
`;

function buildTextTexture(cfg, wPx, hPx) {
  const cv = document.createElement('canvas');
  cv.width = Math.max(2, wPx);
  cv.height = Math.max(2, hPx);
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = cfg.color || '#23448d';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lines = String(cfg.text == null ? '' : cfg.text).split('\n');
  const fs = cfg.fontSize || 48;
  ctx.font = `${fs}px "Cormorant Garamond", Georgia, serif`;
  const lh = fs * 1.25;
  const top = cv.height / 2 - (lines.length - 1) * lh / 2;
  lines.forEach((ln, i) => ctx.fillText(ln, cv.width / 2, top + i * lh));
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 4;
  return tex;
}

function rebuildTexture(inst) {
  const w = Math.max(2, inst.container.clientWidth || 300);
  const h = Math.max(2, inst.container.clientHeight || 150);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  inst.renderer.setSize(w, h, false);
  if (inst.uniforms.uMap.value) inst.uniforms.uMap.value.dispose();
  inst.uniforms.uMap.value = buildTextTexture(inst.config, w * dpr, h * dpr);
  inst.uniforms.uAspect.value = w / h;
}

function tick(inst, timeMs) {
  if (inst.disposed) return;
  inst.uniforms.uTime.value = timeMs / 1000;
  inst.renderer.render(inst.scene, inst.camera);
}

const def = {
  name: COMPONENT_NAME,
  configSchema,

  async mount(container, ctx) {
    const config = withDefaults(ctx.config);
    const canvas = document.createElement('canvas');
    Object.assign(canvas.style, {
      position: 'absolute', inset: '0', width: '100%', height: '100%',
      display: 'block', pointerEvents: 'none',
    });
    container.appendChild(canvas);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    const camera = new THREE.Camera(); // full-screen quad uses clip-space directly

    const ripples = [];
    for (let i = 0; i < MAX_RIPPLES; i++) ripples.push(new THREE.Vector4(0, 0, -100, 0));
    const uniforms = {
      uMap: { value: null },
      uTime: { value: 0 },
      uAspect: { value: 1 },
      uRipples: { value: ripples },
      uShimmer: { value: new THREE.Color('#bfe6ff') },
      uSparkle: { value: new THREE.Color('#8fffd6') },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms, vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, depthTest: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    scene.add(quad);

    const inst = {
      container, canvas, renderer, scene, camera, quad, uniforms, ripples,
      config, ctx, cursor: 0, disposed: false, unframe: null, sizeRO: null,
    };

    // ring-buffer ripple spawn (uv in [0,1])
    inst._addRipple = (u, v, strength) => {
      if (inst.ctx.reducedMotion) return;
      if (u < 0 || u > 1 || v < 0 || v > 1) return;
      inst.ripples[inst.cursor].set(u, v, inst.uniforms.uTime.value, strength || 1);
      inst.cursor = (inst.cursor + 1) % MAX_RIPPLES;
    };
    // map page coords to this panel's UV, then spawn
    inst._impactPage = (pageX, pageY, strength) => {
      const r = inst.container.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const u = (pageX - (r.left + window.scrollX)) / r.width;
      const v = 1 - (pageY - (r.top + window.scrollY)) / r.height; // flip for texture
      inst._addRipple(u, v, strength);
    };

    rebuildTexture(inst);
    if (typeof ResizeObserver !== 'undefined') {
      inst.sizeRO = new ResizeObserver(() => rebuildTexture(inst));
      inst.sizeRO.observe(container);
    }

    // pointer-driven ripples (throttled by movement); .scene-layer is
    // click-through so we read the shared pointer rather than DOM events.
    inst._lastSpawn = 0;
    inst._onMove = (e) => {
      const now = performance.now();
      if (now - inst._lastSpawn < 90) return;
      inst._lastSpawn = now;
      inst._impactPage(e.clientX, e.clientY, 0.7);
    };
    window.addEventListener('pointermove', inst._onMove, { passive: true });

    bus.panels.add(inst);
    if (ctx.helpers && typeof ctx.helpers.onFrame === 'function') {
      inst.unframe = ctx.helpers.onFrame((t) => tick(inst, t));
    }
    return inst;
  },

  update(instance, ctx) {
    if (!instance || !instance.renderer) return;
    instance.config = withDefaults(ctx.config);
    instance.ctx = ctx;
    rebuildTexture(instance);
  },

  destroy(instance) {
    if (!instance) return;
    instance.disposed = true;
    if (typeof instance.unframe === 'function') { instance.unframe(); instance.unframe = null; }
    if (instance._onMove) window.removeEventListener('pointermove', instance._onMove);
    if (instance.sizeRO) { try { instance.sizeRO.disconnect(); } catch (e) { /* noop */ } }
    if (bus.panels) bus.panels.delete(instance);
    if (instance.uniforms && instance.uniforms.uMap.value) instance.uniforms.uMap.value.dispose();
    if (instance.quad) { instance.quad.geometry.dispose(); instance.quad.material.dispose(); }
    if (instance.renderer) { try { instance.renderer.dispose(); } catch (e) { /* noop */ } }
    if (instance.canvas && instance.canvas.parentNode) instance.canvas.parentNode.removeChild(instance.canvas);
  },
};

register(def);
export default def;
