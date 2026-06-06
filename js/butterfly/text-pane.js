// A flat "pane" of text the butterfly flies through. Text is rasterized to a
// canvas texture; a custom shader distorts it with expanding ripples and a
// Matrix-style light shimmer wherever the butterfly punches through.

import * as THREE from "three";

const MAX_RIPPLES = 8;

const DEFAULT_LINES = [
  "in the latent space between",
  "one wingbeat and the next",
  "a small blue body carries",
  "a whole field of red —",
  "it slips through the words",
  "and the words remember",
  "the shape of its passing,",
  "rippling outward, shimmering,",
  "before they settle again",
  "into stillness, and wait.",
];

function buildTextTexture(lines, wPx, hPx) {
  const cv = document.createElement("canvas");
  cv.width = wPx;
  cv.height = hPx;
  const ctx = cv.getContext("2d");
  ctx.clearRect(0, 0, wPx, hPx);

  // faint paper panel + frame so there is a "pane" to ripple
  const pad = Math.round(wPx * 0.05);
  const r = Math.round(wPx * 0.03);
  roundRect(ctx, pad, pad, wPx - pad * 2, hPx - pad * 2, r);
  ctx.fillStyle = "rgba(243, 239, 226, 0.42)";
  ctx.fill();
  ctx.lineWidth = Math.max(2, wPx * 0.004);
  ctx.strokeStyle = "rgba(35, 68, 141, 0.45)";
  ctx.stroke();

  // text
  ctx.fillStyle = "#23448d";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const fontSize = Math.round(hPx * 0.052);
  ctx.font = `${fontSize}px "Cormorant Garamond", Georgia, serif`;
  const top = hPx * 0.16;
  const bottom = hPx * 0.84;
  const lineGap = (bottom - top) / (lines.length - 1 || 1);
  lines.forEach((line, i) => {
    ctx.fillText(line, wPx / 2, top + i * lineGap);
  });

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 8;
  return tex;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  #define MAX_RIPPLES ${MAX_RIPPLES}

  uniform sampler2D uMap;
  uniform float uTime;
  uniform float uAspect;       // pane width / height
  uniform vec4  uRipples[MAX_RIPPLES]; // xy = center uv, z = startTime, w = strength
  uniform vec3  uShimmer;      // ring glow colour
  uniform vec3  uSparkle;      // matrix sparkle colour

  varying vec2 vUv;

  const float RING_SPEED = 0.62;  // uv / sec
  const float LIFE       = 1.9;   // sec
  const float BAND       = 0.055; // ring thickness (uv)
  const float WAVE_FREQ  = 70.0;
  const float DISP_SCALE = 0.022;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

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

      vec2 d = uv - rp.xy;
      d.x *= uAspect;            // circular in world space
      float dist = length(d);
      float ringR = age * RING_SPEED;
      float edge = dist - ringR; // 0 on the ring crest
      float bandG = exp(-(edge * edge) / (BAND * BAND));
      float decay = 1.0 - age / LIFE;
      float amp = rp.w * decay;

      // radial displacement (back into uv space)
      vec2 dir = dist > 1e-4 ? d / dist : vec2(0.0);
      dir.x /= uAspect;
      float wave = sin(edge * WAVE_FREQ);
      disp += dir * wave * bandG * amp * DISP_SCALE;

      glow += bandG * amp;

      // matrix-ish twinkle riding just inside the ring
      vec2 cell = floor(uv * 240.0);
      float tw = hash(cell + floor(age * 26.0));
      spark += step(0.86, tw) * bandG * amp;
    }

    glow = clamp(glow, 0.0, 1.4);
    vec4 tex = texture2D(uMap, uv + disp);

    vec3 col = tex.rgb;
    col += uShimmer * glow * 0.85;
    col += uSparkle * spark * 1.3;

    float alpha = clamp(tex.a + glow * 0.7 + spark * 0.9, 0.0, 1.0);
    gl_FragColor = vec4(col, alpha);
  }
`;

export function createTextPane(opts = {}) {
  const width = opts.width ?? 3.4;
  const height = opts.height ?? 4.6;
  const lines = opts.lines ?? DEFAULT_LINES;

  const pxPerUnit = 220;
  const tex = buildTextTexture(
    lines,
    Math.round(width * pxPerUnit),
    Math.round(height * pxPerUnit)
  );

  const ripples = [];
  for (let i = 0; i < MAX_RIPPLES; i++) ripples.push(new THREE.Vector4(0, 0, -100, 0));

  const uniforms = {
    uMap: { value: tex },
    uTime: { value: 0 },
    uAspect: { value: width / height },
    uRipples: { value: ripples },
    uShimmer: { value: new THREE.Color("#bfe6ff") },
    uSparkle: { value: new THREE.Color("#8fffd6") },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const geo = new THREE.PlaneGeometry(width, height, 1, 1);
  const mesh = new THREE.Mesh(geo, mat);

  let time = 0;
  let cursor = 0;

  return {
    object: mesh,
    width,
    height,
    /** local-space half extents for crossing tests */
    bounds: { hw: width / 2, hh: height / 2 },
    update(t) {
      time = t;
      uniforms.uTime.value = t;
    },
    /** u,v in [0,1] across the pane; strength ~ impact energy */
    addRipple(u, v, strength = 1.0) {
      ripples[cursor].set(u, v, time, strength);
      cursor = (cursor + 1) % MAX_RIPPLES;
    },
  };
}
