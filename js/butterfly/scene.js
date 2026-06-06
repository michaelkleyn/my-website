// Standalone butterfly demo — orchestrates the procedural butterfly + the
// rippling text pane, and runs the flight state machine:
//   flying  -> meanders through 3D space, punching through the text pane
//   perching -> eases toward a resting spot
//   perched -> flaps gently in place until the mouse comes near
//   (mouse proximity re-triggers flight)

import * as THREE from "three";
import { createButterfly } from "./butterfly-model.js";
import { createTextPane } from "./text-pane.js";

const canvas = document.getElementById("scene");
const hudState = document.getElementById("hud-state");

// --- renderer / scene / camera ------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color("#f3efe2");

const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
camera.position.set(0, 0.2, 6.4);
camera.lookAt(0, 0, 0);

// --- lighting ------------------------------------------------------------
scene.add(new THREE.HemisphereLight("#ffffff", "#e6dcc4", 0.85));
const key = new THREE.DirectionalLight("#fff6e8", 1.15);
key.position.set(3, 5, 4);
scene.add(key);
const rim = new THREE.DirectionalLight("#cfe2ff", 0.4);
rim.position.set(-4, 1, -3);
scene.add(rim);

// --- content -------------------------------------------------------------
const pane = createTextPane();
pane.object.position.set(0, 0, 0);
scene.add(pane.object);
const PANE_Z = 0;

const butterfly = createButterfly();
butterfly.object.scale.setScalar(0.62);
scene.add(butterfly.object);

// --- flight state --------------------------------------------------------
const pos = new THREE.Vector3(2.2, 1.2, 1.4);
const vel = new THREE.Vector3(-0.6, 0, -0.4);
const target = new THREE.Vector3();
const prev = pos.clone();
let prevZ = pos.z;

let state = "flying";
let stateTime = 0;
let flyDuration = 11; // seconds before seeking a perch
const perchTarget = new THREE.Vector3();
let bank = 0;
let headingAng = 0;

// reusable math temporaries
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const orienter = new THREE.Object3D();
const qFace = new THREE.Quaternion();
const qBank = new THREE.Quaternion();
const qTarget = new THREE.Quaternion();
const dir = new THREE.Vector3(0, 0, -1);
const restDir = new THREE.Vector3(0, 0.28, 1).normalize();

function faceDir(quat, d) {
  orienter.position.set(0, 0, 0);
  orienter.up.set(0, 1, 0);
  orienter.lookAt(d.x, d.y, d.z); // local +Z faces d
  quat.copy(orienter.quaternion);
}

function pickPerchTarget() {
  // a spot somewhere over the pane, a touch in front of it
  const u = 0.25 + 0.5 * pseudo(stateTime * 1.7);
  const v = 0.3 + 0.45 * pseudo(stateTime * 2.3 + 5.1);
  perchTarget.set(
    (u - 0.5) * pane.width * 0.8,
    (v - 0.5) * pane.height * 0.8,
    0.25
  );
}

// cheap deterministic 0..1 wobble (avoids Math.random, which is unavailable
// in some headless contexts and keeps motion reproducible)
function pseudo(x) {
  return 0.5 + 0.5 * Math.sin(x * 12.9898) * Math.cos(x * 4.1414 + 1.7);
}

// --- mouse ---------------------------------------------------------------
const mouse = new THREE.Vector2(2, 2); // start offscreen
window.addEventListener("pointermove", (e) => {
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -((e.clientY / window.innerHeight) * 2 - 1);
});
window.addEventListener("pointerleave", () => mouse.set(2, 2));

const ndc = new THREE.Vector3();
function mouseNearButterfly() {
  ndc.copy(pos).project(camera);
  const dx = ndc.x - mouse.x;
  const dy = ndc.y - mouse.y;
  return Math.hypot(dx, dy) < 0.22;
}

// --- flight update -------------------------------------------------------
function updateFlight(dt, t) {
  stateTime += dt;
  prev.copy(pos);

  if (state === "flying") {
    // smooth roaming target (Lissajous) that keeps crossing the pane plane
    const tt = t;
    target.set(
      2.0 * Math.sin(tt * 0.43) + 0.6 * Math.sin(tt * 0.91 + 1.2),
      1.0 * Math.sin(tt * 0.51 + 2.0) + 0.5 * Math.sin(tt * 0.27),
      1.5 * Math.sin(tt * 0.37 + 0.5)
    );
    steer(dt, 3.0, 3.4, 0.95);
    butterfly.setFlap(14 + 2 * Math.sin(t * 5.0), 1.0);

    if (stateTime > flyDuration) {
      state = "perching";
      stateTime = 0;
      pickPerchTarget();
    }
  } else if (state === "perching") {
    target.copy(perchTarget);
    steer(dt, 2.4, 2.2, 0.9);
    const d = pos.distanceTo(perchTarget);
    const ease = THREE.MathUtils.clamp(d / 1.2, 0.0, 1.0);
    butterfly.setFlap(7 + 7 * ease, 0.55 + 0.45 * ease);
    if (d < 0.16 && vel.length() < 0.45) {
      state = "perched";
      stateTime = 0;
      vel.multiplyScalar(0.0);
    }
  } else if (state === "perched") {
    vel.multiplyScalar(0.82); // settle
    pos.addScaledVector(vel, dt);
    // gentle, slightly irregular resting flap
    const amt = 0.22 + 0.26 * (0.5 + 0.5 * Math.sin(t * 1.6));
    butterfly.setFlap(3.0, amt);
    if (mouseNearButterfly() && stateTime > 0.6) {
      // take off away from the cursor, with an upward kick
      ndc.copy(pos).project(camera);
      const away = new THREE.Vector3(ndc.x - mouse.x, ndc.y - mouse.y, 0);
      vel.set(away.x, Math.abs(away.y) + 0.6, 0.4).normalize().multiplyScalar(2.6);
      state = "flying";
      stateTime = 0;
      flyDuration = 9 + 6 * pseudo(t);
    }
  }

  pos.addScaledVector(vel, dt * (state === "perched" ? 0 : 1));
  butterfly.object.position.copy(pos);

  // --- orientation ---
  if (vel.lengthSq() > 1e-4 && state !== "perched") {
    dir.copy(vel).normalize();
  }
  if (state === "perched" || state === "perching") {
    // ease toward a resting, viewer-facing pose
    faceDir(qTarget, restDir);
    butterfly.object.quaternion.slerp(qTarget, 1 - Math.pow(0.001, dt));
  } else {
    // bank into the turn
    const ang = Math.atan2(vel.x, vel.z);
    let turn = ang - headingAng;
    while (turn > Math.PI) turn -= Math.PI * 2;
    while (turn < -Math.PI) turn += Math.PI * 2;
    headingAng = ang;
    const targetBank = THREE.MathUtils.clamp(-turn * 6.0, -0.7, 0.7);
    bank += (targetBank - bank) * Math.min(1, dt * 4);

    faceDir(qFace, dir);
    qBank.setFromAxisAngle(Z_AXIS, bank);
    qTarget.copy(qFace).multiply(qBank);
    butterfly.object.quaternion.slerp(qTarget, 1 - Math.pow(0.0001, dt));
  }

  // --- pane crossing -> ripple ---
  detectCrossing();
  prevZ = pos.z;
}

function steer(dt, accel, maxSpeed, damp) {
  const toT = target.clone().sub(pos);
  vel.addScaledVector(toT, accel * dt);
  vel.multiplyScalar(damp);
  const sp = vel.length();
  if (sp > maxSpeed) vel.multiplyScalar(maxSpeed / sp);
}

function detectCrossing() {
  const a = prevZ - PANE_Z;
  const b = pos.z - PANE_Z;
  if (a === 0 || b === 0 || a * b > 0) return; // no sign change
  const tt = a / (a - b); // fraction along the segment where z == PANE_Z
  const cx = prev.x + (pos.x - prev.x) * tt;
  const cy = prev.y + (pos.y - prev.y) * tt;
  const u = cx / pane.width + 0.5;
  const v = cy / pane.height + 0.5;
  if (u < 0 || u > 1 || v < 0 || v > 1) return; // missed the pane
  const speed = vel.length();
  const strength = THREE.MathUtils.clamp(speed / 2.6, 0.45, 1.25);
  pane.addRipple(u, v, strength);
}

// --- resize / loop -------------------------------------------------------
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

// debug turntable for tuning the model: open butterfly.html#pose
const DEBUG_POSE = location.hash.includes("pose");
// expose internals for ad-hoc tweaking from the console
window.__bf = { THREE, scene, camera, butterfly, pane, renderer };

const clock = new THREE.Clock();
function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.getElapsedTime();

  if (DEBUG_POSE) {
    butterfly.object.position.set(0, 0, 2.4);
    butterfly.object.scale.setScalar(1.05);
    butterfly.object.quaternion.identity();
    // flat dorsal view so the wing art reads; #pose-spin for a turntable,
    // #pose-flap to watch the flap
    const spin = location.hash.includes("spin") ? t * 0.4 : 0;
    butterfly.object.rotation.set(Math.PI / 2, spin, 0);
    if (location.hash.includes("flap")) butterfly.setFlap(5, 0.9);
    else butterfly.setFlap(0, 0); // hold wings spread flat
    butterfly.update(dt);
    pane.update(t);
    if (hudState) hudState.textContent = "pose";
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
    return;
  }

  updateFlight(dt, t);
  butterfly.update(dt);
  pane.update(t);

  if (hudState) hudState.textContent = state;
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();
