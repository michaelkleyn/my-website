// Splat inspector — loads a Gaussian-splat .ply/.spz with Spark and lets us
// orbit it, so we can validate each supplied frame's scale / orientation /
// centering before wiring up the animation.
//
// URL params:
//   ?src=assets/splats/frame_00.ply     load a single splat
//   ?frames=a.ply,b.ply,c.ply           load several; ←/→ to step, space autoplay
//   (default) tries assets/splats/manifest.json, else the Spark sample butterfly

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";

const SAMPLE = "https://sparkjs.dev/assets/splats/butterfly.spz";
const canvas = document.getElementById("scene");
const hud = document.getElementById("hud");

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color("#f3efe2");

const camera = new THREE.PerspectiveCamera(
  55,
  window.innerWidth / window.innerHeight,
  0.01,
  1000
);
camera.position.set(0, 0, 3);

const spark = new SparkRenderer({ renderer });
scene.add(spark);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

scene.add(new THREE.AxesHelper(1));
const grid = new THREE.GridHelper(4, 8, 0x88aacc, 0xcdc8b8);
grid.material.opacity = 0.35;
grid.material.transparent = true;
scene.add(grid);

// upright correction commonly needed for 3DGS exports (180° about X)
const FLIPS = [
  new THREE.Quaternion(1, 0, 0, 0), // 180° X (Spark sample default)
  new THREE.Quaternion(0, 0, 0, 1), // identity
  new THREE.Quaternion(0, 1, 0, 0), // 180° Y
  new THREE.Quaternion(0, 0, 1, 0), // 180° Z
];
let flipIndex = 0;

let frames = [];
let current = null;
let index = 0;
let autoplay = false;
let autoTimer = 0;
const AUTO_INTERVAL = 0.18;

async function resolveSources() {
  const p = new URLSearchParams(location.search);
  if (p.get("src")) return [p.get("src")];
  if (p.get("frames")) return p.get("frames").split(",").map((s) => s.trim());
  try {
    const res = await fetch("assets/splats/manifest.json", { cache: "no-store" });
    if (res.ok) {
      const m = await res.json();
      if (Array.isArray(m) && m.length) return m;
      if (m.frames && m.frames.length) return m.frames;
    }
  } catch (e) {
    /* no manifest — fall through */
  }
  return [SAMPLE];
}

function describe(mesh, src) {
  let n = 0;
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  try {
    mesh.forEachSplat((i, center) => {
      min.min(center);
      max.max(center);
      n++;
    });
  } catch (e) {
    n = mesh.packedSplats?.numSplats ?? -1;
  }
  const size = max.clone().sub(min);
  const center = max.clone().add(min).multiplyScalar(0.5);
  return { n, size, center, src };
}

function fitCamera(info) {
  if (!isFinite(info.size.length()) || info.size.length() === 0) return;
  const c = info.center.clone().applyQuaternion(FLIPS[flipIndex]);
  const radius = Math.max(info.size.x, info.size.y, info.size.z) * 1.4 + 0.001;
  controls.target.copy(c);
  camera.position.set(c.x, c.y, c.z + radius);
  camera.near = radius / 100;
  camera.far = radius * 100;
  camera.updateProjectionMatrix();
  controls.update();
}

function showFrame(i, fit = false) {
  frames.forEach((f, k) => {
    if (f.mesh) f.mesh.visible = k === i;
  });
  index = i;
  const f = frames[i];
  if (f && f.mesh) {
    f.mesh.quaternion.copy(FLIPS[flipIndex]);
    if (fit && f.info) fitCamera(f.info);
    current = f;
    updateHud();
  }
}

function updateHud() {
  const f = frames[index];
  const info = f?.info;
  hud.innerHTML =
    `splat inspector  ·  frame <b>${index + 1}/${frames.length}</b>` +
    (autoplay ? "  (autoplay)" : "") +
    `\nsrc: ${shorten(f?.src)}` +
    (info
      ? `\nsplats: <b>${info.n.toLocaleString()}</b>` +
        `\nsize:  ${fmt(info.size)}` +
        `\ncenter:${fmt(info.center)}`
      : "\n(loading…)") +
    `\nflip[f]: ${flipIndex}   keys: ←/→ step · space autoplay · f flip`;
}

const fmt = (v) => `${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)}`;
const shorten = (s) => (s && s.length > 52 ? "…" + s.slice(-50) : s || "—");

async function loadAll() {
  const sources = await resolveSources();
  frames = sources.map((src) => ({ src, mesh: null, info: null }));
  updateHud();

  sources.forEach((src, i) => {
    const mesh = new SplatMesh({
      url: src,
      onLoad: () => {
        mesh.quaternion.copy(FLIPS[flipIndex]);
        frames[i].info = describe(mesh, src);
        if (i === 0) showFrame(0, true);
        else updateHud();
        console.log(`[splat] loaded ${src}`, frames[i].info);
      },
    });
    mesh.visible = i === 0;
    frames[i].mesh = mesh;
    scene.add(mesh);
  });
}

window.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight") showFrame((index + 1) % frames.length);
  else if (e.key === "ArrowLeft") showFrame((index - 1 + frames.length) % frames.length);
  else if (e.key === " ") {
    autoplay = !autoplay;
    updateHud();
  } else if (e.key === "f") {
    flipIndex = (flipIndex + 1) % FLIPS.length;
    showFrame(index, true);
  }
});

window.addEventListener("resize", () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  if (autoplay && frames.length > 1) {
    autoTimer += dt;
    if (autoTimer >= AUTO_INTERVAL) {
      autoTimer = 0;
      showFrame((index + 1) % frames.length);
    }
  }
  controls.update();
  renderer.render(scene, camera);
});

// expose for console poking
window.__splat = { scene, camera, renderer, spark, get frames() { return frames; } };

loadAll();
