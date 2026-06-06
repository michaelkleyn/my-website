// Butterfly flap player — loads the 20 split frames and plays them as an
// animation cycle so we can (a) lock the correct frame order and (b) dial in
// the upright orientation. This is the base the dissolve transition builds on.
//
// Controls:
//   space        play / pause
//   1 / 2        order: row-major / column-major
//   r            reverse the order
//   p            ping-pong the cycle (A→Z→A)
//   [ / ]        slower / faster
//   ← / →        step one frame (when paused)
//   i k / j l / u o   nudge orientation (X / Y / Z); x logs current euler
//   o b          toggle orbit controls / background

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";

const canvas = document.getElementById("scene");
const hud = document.getElementById("hud");

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color("#f3efe2");

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.01, 100);
camera.position.set(0, 0, 1.8);

const spark = new SparkRenderer({ renderer });
scene.add(spark);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enabled = true; // look around while it plays
// gentle auto-orbit: lets you see it from all sides, and keeps the camera
// moving so Spark re-sorts the splats every frame (a static camera renders
// nothing on load). Drag to take over; it resumes when you let go.
controls.autoRotate = true;
controls.autoRotateSpeed = 1.2;

// Per-mesh orientation. Spark does NOT propagate a parent Group's rotation to
// the splat transforms, so each SplatMesh is oriented directly. Thin axis of a
// frame is X → -90° about Y faces the dorsal surface to the camera; a 180° roll
// about the view axis makes it right-side up. Tune with i/k/j/l/u/o, flip w/ v.
// TripoSplat frames: dorsal faces +X, head already +Y up → just -90° about Y
// to turn the dorsal side toward the camera. (Press v to flip if needed.)
const orient = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -Math.PI / 2, 0));
const _axis = new THREE.Vector3();
const _dq = new THREE.Quaternion();
function applyOrient() {
  meshes.forEach((m) => {
    if (!m) return;
    m.quaternion.copy(orient);
    m.updateGenerator?.(); // Spark must re-register after a transform change
  });
}
function nudge(ax, ay, az) {
  _axis.set(ax, ay, az).normalize();
  _dq.setFromAxisAngle(_axis, 0.05);
  orient.premultiply(_dq); // rotate about world axis
  applyOrient();
}

let manifest = [];
let meshes = []; // index-aligned with manifest
let loadedCount = 0;

// playback state
let order = "row"; // row | col
let reverse = false;
let pingpong = false;
let playing = true;
let fps = 4; // keyframe advance rate (loop speed)
let acc = 0;
let cursor = 0; // index into the current sequence
let dirn = 1;
let ready = false; // becomes true after warm-up
let interp = true; // continuous interpolation between keyframes (vs hard cuts)
let phaseTime = 0; // position along the play order, in "frames"
let blendWidth = 1.6; // interpolation width: 1 = adjacent cross-fade, >1 = softer / more blended
let playOrder = []; // mesh indices in cycle order (handles loop / ping-pong)
const smoothstep = (x) => x * x * (3 - 2 * x);
// raised-cosine blend kernel over normalized distance x in [0,1)
const blendKernel = (x) => (x < 1 ? 0.5 * (1 + Math.cos(Math.PI * x)) : 0);
const meshW = []; // reused per-frame weight accumulator

function sequence() {
  const idx = manifest.map((_, i) => i);
  idx.sort((a, b) => {
    const A = manifest[a], B = manifest[b];
    return order === "row" ? A.row - B.row || A.col - B.col : A.col - B.col || A.row - B.row;
  });
  return reverse ? idx.reverse() : idx;
}
let seq = [];

// rebuild the play order from the current sort/options
function rebuild() {
  seq = sequence();
  playOrder = pingpong ? seq.concat(seq.slice(1, -1).reverse()) : seq.slice();
  if (playOrder.length === 0) playOrder = seq.slice();
  phaseTime = 0;
  cursor = 0;
}

function showOnly(meshIndex) {
  meshes.forEach((m, i) => {
    if (!m) return;
    m.visible = i === meshIndex;
    if (i === meshIndex) m.opacity = 1;
  });
  const m = meshes[meshIndex];
  if (m) m.updateGenerator?.(); // Spark renders the mesh once re-registered while visible
}

// Weighted multi-frame interpolation: each mesh's global opacity comes from a
// smooth blend kernel centered on the current phase (meshW). Wider blendWidth =
// more frames contribute = softer, more interpolated motion. Newly-visible
// meshes get a one-time updateGenerator (Spark needs it); opacity auto-detected.
function applyWeights() {
  for (let idx = 0; idx < meshes.length; idx++) {
    const m = meshes[idx];
    if (!m) continue;
    const w = meshW[idx] || 0;
    const want = w > 0.004;
    if (want && !m.visible) { m.visible = true; m.updateGenerator?.(); }
    else if (!want && m.visible) { m.visible = false; }
    if (want) m.opacity = Math.min(1, w * 1.25); // slight boost so it stays solid
  }
}

// Spark compiles a generator the first time each mesh renders; do all 20 up
// front (briefly showing each) so playback can swap frames without the
// first-compile hitch that otherwise leaves rapidly-swapped frames blank.
async function warmup() {
  const waitFrames = (n) =>
    new Promise((res) => {
      let k = 0;
      const tick = () => (++k > n ? res() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    });
  for (let i = 0; i < meshes.length; i++) {
    const m = meshes[i];
    if (!m) continue;
    meshes.forEach((x, j) => { if (x) x.visible = j === i; });
    m.updateGenerator?.();
    await waitFrames(3);
  }
  meshes.forEach((m) => m && (m.visible = false));
  cursor = 0;
  ready = true;
}

function currentFrameLabel() {
  const m = manifest[seq[cursor]];
  return m ? `r${m.row}c${m.col}` : "—";
}

function updateHud() {
  hud.innerHTML =
    `flap player  ·  loaded <b>${loadedCount}/${manifest.length}</b>` +
    `\norder: <b>${order}-major</b>${reverse ? " (rev)" : ""}${pingpong ? " ping-pong" : ""}` +
    `\nframe: <b>${cursor + 1}/${seq.length}</b>  (${currentFrameLabel()})   ${playing ? "▶" : "❚❚"}  speed ${fps.toFixed(1)}  ·  <b>${interp ? `interp ×${blendWidth.toFixed(1)}` : "cut"}</b>` +
    `\nspace play · t interp · [ ] speed · , . blend · 1/2 order · r rev · p ping · v flip`;
}

async function load() {
  const res = await fetch("assets/splats/manifest.json", { cache: "no-store" });
  manifest = await res.json();
  meshes = new Array(manifest.length).fill(null);
  rebuild();
  updateHud();

  manifest.forEach((f, i) => {
    const mesh = new SplatMesh({
      url: f.file,
      onLoad: () => {
        loadedCount++;
        mesh.visible = false;
        mesh.quaternion.copy(orient);
        mesh.updateGenerator?.(); // register with Spark so it renders when shown
        updateHud();
        if (loadedCount === manifest.length) warmup();
      },
    });
    meshes[i] = mesh;
    scene.add(mesh);
  });
}

function step(n) {
  if (seq.length === 0) return;
  if (pingpong) {
    cursor += n * dirn;
    if (cursor >= seq.length) { cursor = seq.length - 2; dirn = -1; }
    else if (cursor < 0) { cursor = 1; dirn = 1; }
  } else {
    cursor = (cursor + n * dirn + seq.length) % seq.length;
  }
  showOnly(seq[cursor]);
  updateHud();
}

window.addEventListener("keydown", (e) => {
  const k = e.key;
  if (k === " ") { playing = !playing; }
  else if (k === "1") { order = "row"; rebuild(); }
  else if (k === "2") { order = "col"; rebuild(); }
  else if (k === "r") { reverse = !reverse; rebuild(); }
  else if (k === "p") { pingpong = !pingpong; dirn = 1; rebuild(); }
  else if (k === "t") { interp = !interp; curA = curB = -1; } // toggle interpolation
  else if (k === "[") { fps = Math.max(0.5, +(fps * 0.8).toFixed(2)); }       // slower
  else if (k === "]") { fps = Math.min(40, +(fps * 1.25).toFixed(2)); }       // faster
  else if (k === ",") { blendWidth = Math.max(1.0, +(blendWidth - 0.2).toFixed(2)); } // less blend
  else if (k === ".") { blendWidth = Math.min(4.0, +(blendWidth + 0.2).toFixed(2)); } // more blend
  else if (k === "ArrowRight") { playing = false; interp = false; step(1); }
  else if (k === "ArrowLeft") { playing = false; interp = false; step(-1); }
  else if (k === "i") nudge(1, 0, 0);
  else if (k === "k") nudge(-1, 0, 0);
  else if (k === "j") nudge(0, 1, 0);
  else if (k === "l") nudge(0, -1, 0);
  else if (k === "u") nudge(0, 0, 1);
  else if (k === "o") nudge(0, 0, -1);
  else if (k === "v") { _dq.setFromAxisAngle(_axis.set(0, 0, 1), Math.PI); orient.premultiply(_dq); applyOrient(); }
  else if (k === "x") { const e = new THREE.Euler().setFromQuaternion(orient); console.log("orient euler:", e.x.toFixed(3), e.y.toFixed(3), e.z.toFixed(3)); }
  updateHud();
});

window.addEventListener("resize", () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

window.__frames = { scene, camera, orient, get meshes() { return meshes; }, get seq() { return seq; } };

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  if (ready && playOrder.length) {
    if (interp) {
      const L = playOrder.length;
      if (playing) phaseTime += dt * fps;
      const phase = ((phaseTime % L) + L) % L;
      cursor = Math.round(phase) % L;
      // accumulate a smooth, normalized blend weight per mesh (circular)
      for (let i = 0; i < meshes.length; i++) meshW[i] = 0;
      let sum = 0;
      for (let pos = 0; pos < L; pos++) {
        let d = Math.abs(pos - phase);
        d = Math.min(d, L - d); // wrap-around distance
        sum += blendKernel(d / blendWidth);
      }
      if (sum > 0) {
        for (let pos = 0; pos < L; pos++) {
          let d = Math.abs(pos - phase);
          d = Math.min(d, L - d);
          meshW[playOrder[pos]] += blendKernel(d / blendWidth) / sum;
        }
      }
      applyWeights();
    } else if (playing) {
      acc += dt;
      if (acc >= 1 / fps) { acc = 0; step(1); }
    }
  }
  controls.update();
  renderer.render(scene, camera);
});

load();
