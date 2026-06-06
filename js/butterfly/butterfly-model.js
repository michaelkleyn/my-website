// Procedural 3D vector butterfly — monarch-style wings built from vector
// silhouettes + a procedurally drawn vein / dot / margin pattern, a blue
// spindle body and curved antennae. Wings flap by pivoting at the body axis.
//
// Coordinate convention (butterfly local space):
//   +Z = head / forward,  -Z = tail
//   +Y = up
//   +X = left wing span,  -X = right wing span
// Wing meshes are authored in a 2D shape plane (x = span outward from body,
// y = chord where +y points toward the tail) then laid flat with rot.x = -PI/2.

import * as THREE from "three";

// --- palette -------------------------------------------------------------
export const COLORS = {
  wing: "#e74e4d",       // red wing field
  wingRoot: "#ef5f50",   // lighter near the body
  wingTip: "#d23f3e",    // deeper red toward the margin
  marking: "#23448d",    // blue veins / body
  outline: "#0b388b",    // darker blue outline + margin band
  dot: "#f3efe2",        // light marginal dots (paper cream)
  body: "#23448d",
  bodyDark: "#1a3163",
};

// --- wing silhouettes (left side; x >= 0 spans outward) -------------------
// Path ops: ["M", x, y] | ["C", c1x,c1y, c2x,c2y, x,y]. +y = toward tail.
const FOREWING_PATH = [
  ["M", 0.0, -0.12],
  ["C", 0.30, -0.44, 0.66, -0.60, 0.98, -0.58], // costa out to a broad apex
  ["C", 1.16, -0.56, 1.21, -0.34, 1.10, -0.15], // rounded apex
  ["C", 1.00, 0.0, 0.80, 0.12, 0.58, 0.16], // outer margin (gentle scallop)
  ["C", 0.36, 0.19, 0.14, 0.13, 0.0, 0.06], // trailing edge back to root
];
const HINDWING_PATH = [
  ["M", 0.0, 0.0],
  ["C", 0.24, -0.02, 0.50, 0.06, 0.69, 0.24], // leading edge outward
  ["C", 0.88, 0.43, 0.94, 0.65, 0.81, 0.83], // rounded outer margin
  ["C", 0.71, 0.97, 0.52, 1.02, 0.35, 0.93], // bottom curve
  ["C", 0.21, 0.85, 0.11, 0.64, 0.06, 0.42], // inner margin
  ["C", 0.02, 0.26, 0.0, 0.12, 0.0, 0.0],
];

function applyPathToShape(shape, path) {
  for (const seg of path) {
    if (seg[0] === "M") shape.moveTo(seg[1], seg[2]);
    else shape.bezierCurveTo(seg[1], seg[2], seg[3], seg[4], seg[5], seg[6]);
  }
  shape.closePath();
}

function applyPathToCtx(ctx, path, map) {
  for (const seg of path) {
    if (seg[0] === "M") {
      const p = map(seg[1], seg[2]);
      ctx.moveTo(p.x, p.y);
    } else {
      const c1 = map(seg[1], seg[2]);
      const c2 = map(seg[3], seg[4]);
      const p = map(seg[5], seg[6]);
      ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, p.x, p.y);
    }
  }
  ctx.closePath();
}

function bbox(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

// Draw the monarch pattern for one wing onto a canvas, aligned to the shape's
// bounding box so the texture lines up 1:1 with the geometry UVs.
function buildWingTexture(shape, box, veinOrigin) {
  const TEX_H = 540;
  const aspect = box.w / box.h;
  const TEX_W = Math.max(64, Math.round(TEX_H * aspect));
  const cv = document.createElement("canvas");
  cv.width = TEX_W;
  cv.height = TEX_H;
  const ctx = cv.getContext("2d");

  // shape-space -> canvas pixels (flip Y so maxY sits at the top row)
  const map = (x, y) => ({
    x: ((x - box.minX) / box.w) * TEX_W,
    y: ((box.maxY - y) / box.h) * TEX_H,
  });
  const unit = TEX_H / box.h; // pixels per shape unit

  const outline = shape.getPoints(160);
  const centroid = outline.reduce(
    (a, p) => ({ x: a.x + p.x / outline.length, y: a.y + p.y / outline.length }),
    { x: 0, y: 0 }
  );

  // 1) red field with a root->tip gradient (built from the outline polyline
  //    so the fill/clip region matches the geometry exactly)
  ctx.beginPath();
  ctx.moveTo(map(outline[0].x, outline[0].y).x, map(outline[0].x, outline[0].y).y);
  for (let i = 1; i < outline.length; i++) {
    const p = map(outline[i].x, outline[i].y);
    ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();

  const gRoot = map(box.minX, centroid.y);
  const gTip = map(box.maxX, centroid.y);
  const grad = ctx.createLinearGradient(gRoot.x, gRoot.y, gTip.x, gTip.y);
  grad.addColorStop(0.0, COLORS.wingRoot);
  grad.addColorStop(0.55, COLORS.wing);
  grad.addColorStop(1.0, COLORS.wingTip);
  ctx.fillStyle = grad;
  ctx.fill();

  // clip to the wing for all interior detail
  ctx.save();
  ctx.clip();

  // 2) veins fanning from the root toward the outer margin
  const outerPts = outline.filter((p) => p.x > box.minX + 0.42 * box.w);
  const veinTargets = [];
  const nVeins = 7;
  for (let i = 0; i < nVeins; i++) {
    const idx = Math.floor((i / (nVeins - 1)) * (outerPts.length - 1));
    veinTargets.push(outerPts[idx]);
  }
  ctx.strokeStyle = COLORS.marking;
  ctx.lineCap = "round";
  const o = map(veinOrigin.x, veinOrigin.y);
  for (const t of veinTargets) {
    const e = map(t.x, t.y);
    // slight curve on each vein for an organic feel
    const mx = (o.x + e.x) / 2 + (e.y - o.y) * 0.06;
    const my = (o.y + e.y) / 2 - (e.x - o.x) * 0.06;
    ctx.lineWidth = unit * 0.024;
    ctx.beginPath();
    ctx.moveTo(o.x, o.y);
    ctx.quadraticCurveTo(mx, my, e.x, e.y);
    ctx.stroke();
  }
  // a couple of cross-veins
  ctx.lineWidth = unit * 0.016;
  for (let i = 1; i < veinTargets.length - 1; i += 2) {
    const a = map(veinTargets[i].x, veinTargets[i].y);
    const b = map(veinTargets[i + 1].x, veinTargets[i + 1].y);
    ctx.beginPath();
    ctx.moveTo(a.x * 0.7 + o.x * 0.3, a.y * 0.7 + o.y * 0.3);
    ctx.lineTo(b.x * 0.7 + o.x * 0.3, b.y * 0.7 + o.y * 0.3);
    ctx.stroke();
  }

  // 3) dark-blue marginal band along the outer edge
  const band = outline.filter((p) => p.x > box.minX + 0.32 * box.w);
  if (band.length > 1) {
    ctx.strokeStyle = COLORS.outline;
    ctx.lineWidth = unit * 0.2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    const s0 = map(band[0].x, band[0].y);
    ctx.moveTo(s0.x, s0.y);
    for (let i = 1; i < band.length; i++) {
      const p = map(band[i].x, band[i].y);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();

    // 4) two staggered rows of light dots riding the margin band
    const step = Math.max(2, Math.floor(band.length / 12));
    for (let i = step; i < band.length - 1; i += step) {
      const p = band[i];
      const inx = centroid.x - p.x;
      const iny = centroid.y - p.y;
      const len = Math.hypot(inx, iny) || 1;
      const dp = map(p.x + (inx / len) * 0.05, p.y + (iny / len) * 0.05);
      ctx.fillStyle = COLORS.dot;
      ctx.beginPath();
      ctx.arc(dp.x, dp.y, unit * 0.03, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();

  // 5) crisp dark-blue outline around the whole wing (geometry clips the
  //    outer half, leaving a clean rim)
  ctx.beginPath();
  ctx.moveTo(map(outline[0].x, outline[0].y).x, map(outline[0].x, outline[0].y).y);
  for (let i = 1; i < outline.length; i++) {
    const p = map(outline[i].x, outline[i].y);
    ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  ctx.strokeStyle = COLORS.outline;
  ctx.lineWidth = unit * 0.08;
  ctx.lineJoin = "round";
  ctx.stroke();

  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildWingMesh(path, veinOrigin) {
  const shape = new THREE.Shape();
  applyPathToShape(shape, path);
  const pts = shape.getPoints(96);
  const box = bbox(pts);

  const geo = new THREE.ShapeGeometry(shape, 36);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    // remap UVs to the bbox (ShapeGeometry uses raw coords by default)
    uv.setXY(i, (x - box.minX) / box.w, (y - box.minY) / box.h);
    // gentle dihedral curve: droop the outer span a touch for a 3D read
    const u = (x - box.minX) / box.w;
    pos.setZ(i, -0.06 * u * u);
  }
  uv.needsUpdate = true;
  pos.needsUpdate = true;
  geo.computeVertexNormals();

  const tex = buildWingTexture(shape, box, veinOrigin);
  // emissiveMap keeps the red/blue saturated regardless of which way a wing
  // faces during the flap; the lit map on top adds soft shading + highlights.
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    emissive: new THREE.Color("#ffffff"),
    emissiveMap: tex,
    emissiveIntensity: 0.55,
    side: THREE.DoubleSide,
    roughness: 0.7,
    metalness: 0.0,
    transparent: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2; // lay flat: shape plane -> XZ, normal -> +Y
  return mesh;
}

function buildBody() {
  const group = new THREE.Group();
  // spindle profile (radius, length) lathed about Y, then stood along Z
  const profile = [
    [0.0, 0.0],
    [0.04, 0.06],
    [0.058, 0.16],
    [0.066, 0.30],
    [0.072, 0.44],
    [0.082, 0.56],
    [0.078, 0.68],
    [0.058, 0.78],
    [0.04, 0.86],
    [0.018, 0.9],
    [0.0, 0.92],
  ].map((p) => new THREE.Vector2(p[0], p[1]));
  const bodyGeo = new THREE.LatheGeometry(profile, 24);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: COLORS.body,
    roughness: 0.55,
    metalness: 0.05,
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.rotation.x = Math.PI / 2; // length (Y) -> world +Z, head toward +Z
  body.position.z = -0.5; // thorax bulge near origin, head pokes forward
  group.add(body);

  // head
  const headMat = new THREE.MeshStandardMaterial({
    color: COLORS.bodyDark,
    roughness: 0.5,
    metalness: 0.05,
  });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.07, 20, 16), headMat);
  head.position.set(0, 0.01, 0.42);
  group.add(head);

  // antennae — thin curved tubes with little club tips
  const antMat = new THREE.MeshStandardMaterial({
    color: COLORS.outline,
    roughness: 0.5,
  });
  for (const sx of [-1, 1]) {
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(sx * 0.02, 0.04, 0.45),
      new THREE.Vector3(sx * 0.06, 0.16, 0.55),
      new THREE.Vector3(sx * 0.12, 0.26, 0.6)
    );
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 16, 0.007, 6, false),
      antMat
    );
    group.add(tube);
    const club = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), antMat);
    club.position.copy(curve.getPoint(1));
    group.add(club);
  }
  return group;
}

// Public factory ----------------------------------------------------------
export function createButterfly() {
  const root = new THREE.Group();

  const body = buildBody();
  root.add(body);

  // wing pivots hinge at the body axis (origin); right side mirrors via scale
  const leftPivot = new THREE.Group();
  const rightPivot = new THREE.Group();
  rightPivot.scale.x = -1;

  leftPivot.add(buildWingMesh(FOREWING_PATH, { x: 0.04, y: -0.02 }));
  const lh = buildWingMesh(HINDWING_PATH, { x: 0.05, y: 0.06 });
  lh.position.y = -0.008; // tuck the hindwing just under the forewing
  leftPivot.add(lh);

  rightPivot.add(buildWingMesh(FOREWING_PATH, { x: 0.04, y: -0.02 }));
  const rh = buildWingMesh(HINDWING_PATH, { x: 0.05, y: 0.06 });
  rh.position.y = -0.008;
  rightPivot.add(rh);

  root.add(leftPivot);
  root.add(rightPivot);

  // flap state
  let flapPhase = 0;
  const state = {
    flapSpeed: 12, // radians/sec of phase advance
    flapAmount: 1.0, // 0..1 scales the up/down sweep
    restAngle: -0.12, // small resting dihedral when "closed"/perched
  };

  function setFlap(speed, amount) {
    if (speed != null) state.flapSpeed = speed;
    if (amount != null) state.flapAmount = amount;
  }

  function update(dt) {
    flapPhase += dt * state.flapSpeed;
    // raised-cosine sweep: 0 (down/level) .. ~75deg up
    const s = (1 - Math.cos(flapPhase)) * 0.5; // 0..1
    const angle = state.restAngle + s * 1.35 * state.flapAmount;
    leftPivot.rotation.z = angle;
    rightPivot.rotation.z = -angle;
    // subtle body bob synced to the flap
    body.position.y = Math.sin(flapPhase) * 0.01 * state.flapAmount;
  }

  return {
    object: root,
    update,
    setFlap,
    state,
    get flapPhase() {
      return flapPhase;
    },
  };
}
