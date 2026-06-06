#!/usr/bin/env node
// Optimize a 3D Gaussian Splatting .ply for the web:
//   1. strip spherical-harmonics rest coefficients (f_rest_*) — view-dependent
//      shimmer that's invisible on a small, moving butterfly (≈4× smaller)
//   2. (optionally) drop unused vertex normals
//   3. importance-decimate by opacity to a target splat count
// It re-emits the *same* binary encoding for every kept property, so there's
// no risky re-quantization of color / rotation / scale — lowest-risk path.
//
// Usage:
//   node scripts/optimize-splat.mjs input.ply [--out output.ply]
//        [--target 35000] [--keep-sh] [--keep-normals] [--seed 1]
//
// Outputs a reduced binary_little_endian .ply that Spark loads directly.

import fs from "node:fs";
import path from "node:path";

const TYPE_SIZES = {
  char: 1, uchar: 1, int8: 1, uint8: 1,
  short: 2, ushort: 2, int16: 2, uint16: 2,
  int: 4, uint: 4, int32: 4, uint32: 4,
  float: 4, float32: 4,
  double: 8, float64: 8,
};

function parseArgs(argv) {
  const a = { target: 35000, keepSh: false, keepNormals: false, seed: 1, out: null,
              recenter: false, cull: 0 };
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--target") a.target = parseInt(argv[++i], 10);
    else if (t === "--out") a.out = argv[++i];
    else if (t === "--keep-sh") a.keepSh = true;
    else if (t === "--keep-normals") a.keepNormals = true;
    else if (t === "--seed") a.seed = parseInt(argv[++i], 10);
    else if (t === "--recenter") a.recenter = true;
    else if (t === "--cull") a.cull = parseFloat(argv[++i]); // sigma threshold
    else pos.push(t);
  }
  a.input = pos[0];
  return a;
}

// tiny deterministic PRNG so runs are reproducible
function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parseHeader(buf) {
  const text = buf.toString("latin1", 0, Math.min(buf.length, 1 << 16));
  const marker = "end_header\n";
  const end = text.indexOf(marker);
  if (text.slice(0, 3) !== "ply") throw new Error("not a .ply file");
  if (end < 0) throw new Error("no end_header found (file truncated?)");
  const headerEnd = end + marker.length;
  const lines = text.slice(0, end).split("\n").map((l) => l.trim());

  let format = null;
  let vertexCount = 0;
  const props = []; // {name, type, size}
  let inVertex = false;
  for (const line of lines) {
    if (line.startsWith("format ")) format = line.split(/\s+/)[1];
    else if (line.startsWith("element ")) {
      const [, name, count] = line.split(/\s+/);
      inVertex = name === "vertex";
      if (inVertex) vertexCount = parseInt(count, 10);
    } else if (line.startsWith("property ") && inVertex) {
      const parts = line.split(/\s+/);
      const type = parts[1];
      const name = parts[parts.length - 1];
      const size = TYPE_SIZES[type];
      if (!size) throw new Error(`unsupported property type: ${type}`);
      props.push({ name, type, size });
    }
  }
  if (format !== "binary_little_endian")
    throw new Error(`only binary_little_endian supported (got: ${format})`);

  let offset = 0;
  for (const p of props) {
    p.offset = offset;
    offset += p.size;
  }
  const stride = offset;
  return { headerEnd, vertexCount, props, stride };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) {
    console.error("usage: node scripts/optimize-splat.mjs input.ply [--out out.ply] [--target 35000]");
    process.exit(1);
  }
  const buf = fs.readFileSync(args.input);
  const { headerEnd, vertexCount, props, stride } = parseHeader(buf);

  const byName = Object.fromEntries(props.map((p) => [p.name, p]));
  const opacityProp = byName.opacity;
  const xP = byName.x, yP = byName.y, zP = byName.z;
  const opacityAt = (b) =>
    opacityProp ? 1 / (1 + Math.exp(-buf.readFloatLE(b + opacityProp.offset))) : 1;

  // choose which properties to keep
  const isSh = (n) => /^f_rest_\d+/.test(n);
  const isNormal = (n) => n === "nx" || n === "ny" || n === "nz";
  const keepProps = props.filter((p) => {
    if (!args.keepSh && isSh(p.name)) return false;
    if (!args.keepNormals && isNormal(p.name)) return false;
    return true;
  });
  const outStride = keepProps.reduce((s, p) => s + p.size, 0);

  // body bounds
  const bodyStart = headerEnd;
  const expected = bodyStart + vertexCount * stride;
  if (expected > buf.length)
    throw new Error(`file too short: expected ${expected} bytes, have ${buf.length}`);

  // centroid + spread over reasonably-opaque splats, for recenter + outlier cull
  let cenX = 0, cenY = 0, cenZ = 0, oc = 0;
  for (let i = 0; i < vertexCount; i++) {
    const b = bodyStart + i * stride;
    if (opacityAt(b) > 0.2) {
      cenX += buf.readFloatLE(b + xP.offset);
      cenY += buf.readFloatLE(b + yP.offset);
      cenZ += buf.readFloatLE(b + zP.offset);
      oc++;
    }
  }
  if (oc) { cenX /= oc; cenY /= oc; cenZ /= oc; }
  let cull2 = Infinity;
  if (args.cull > 0) {
    let vsum = 0;
    for (let i = 0; i < vertexCount; i++) {
      const b = bodyStart + i * stride;
      if (opacityAt(b) > 0.2) {
        const dx = buf.readFloatLE(b + xP.offset) - cenX;
        const dy = buf.readFloatLE(b + yP.offset) - cenY;
        const dz = buf.readFloatLE(b + zP.offset) - cenZ;
        vsum += dx * dx + dy * dy + dz * dz;
      }
    }
    const sigma = oc ? Math.sqrt(vsum / oc) : 0;
    cull2 = (args.cull * sigma) ** 2; // squared distance threshold
  }

  // importance score per splat (sigmoid of stored opacity logit); cull outliers
  const rand = mulberry32(args.seed);
  const scores = new Float64Array(vertexCount);
  let scoreSum = 0;
  let culled = 0;
  for (let i = 0; i < vertexCount; i++) {
    const b = bodyStart + i * stride;
    let s = opacityAt(b) + 0.04; // floor so faint edge splats aren't all culled
    if (args.cull > 0) {
      const dx = buf.readFloatLE(b + xP.offset) - cenX;
      const dy = buf.readFloatLE(b + yP.offset) - cenY;
      const dz = buf.readFloatLE(b + zP.offset) - cenZ;
      if (dx * dx + dy * dy + dz * dz > cull2) { s = 0; culled++; } // drop floaters
    }
    scores[i] = s;
    scoreSum += s;
  }

  // keep-probability so the expected kept count ≈ target
  const target = Math.min(args.target, vertexCount);
  const keepIdx = [];
  if (target >= vertexCount) {
    for (let i = 0; i < vertexCount; i++) keepIdx.push(i);
  } else {
    const k = (target * vertexCount) / scoreSum; // scale factor
    for (let i = 0; i < vertexCount; i++) {
      const p = Math.min(1, (scores[i] * k) / vertexCount);
      if (rand() < p) keepIdx.push(i);
    }
  }

  // write reduced .ply
  const headerLines = [
    "ply",
    "format binary_little_endian 1.0",
    `comment optimized by optimize-splat.mjs (target ${target}, sh ${args.keepSh})`,
    `element vertex ${keepIdx.length}`,
    ...keepProps.map((p) => `property ${p.type} ${p.name}`),
    "end_header",
    "",
  ].join("\n");
  const headerBuf = Buffer.from(headerLines, "latin1");

  const outBody = Buffer.allocUnsafe(keepIdx.length * outStride);
  let w = 0;
  for (const i of keepIdx) {
    const base = bodyStart + i * stride;
    for (const p of keepProps) {
      if (args.recenter && (p.name === "x" || p.name === "y" || p.name === "z")) {
        const c = p.name === "x" ? cenX : p.name === "y" ? cenY : cenZ;
        outBody.writeFloatLE(buf.readFloatLE(base + p.offset) - c, w);
      } else {
        buf.copy(outBody, w, base + p.offset, base + p.offset + p.size);
      }
      w += p.size;
    }
  }

  const outPath =
    args.out ||
    args.input.replace(/\.ply$/i, "") + `.opt.ply`;
  fs.writeFileSync(outPath, Buffer.concat([headerBuf, outBody]));

  const mb = (n) => (n / (1024 * 1024)).toFixed(2) + " MB";
  const inSize = buf.length;
  const outSize = headerBuf.length + outBody.length;
  console.log(`${path.basename(args.input)} -> ${path.basename(outPath)}`);
  console.log(`  splats:   ${vertexCount.toLocaleString()} -> ${keepIdx.length.toLocaleString()}` +
    (args.cull > 0 ? `  (culled ${culled.toLocaleString()} outliers)` : "") +
    (args.recenter ? "  [recentered]" : ""));
  console.log(`  props:    ${props.length} -> ${keepProps.length}  (stride ${stride} -> ${outStride} bytes)`);
  console.log(`  size:     ${mb(inSize)} -> ${mb(outSize)}  (${(100 * outSize / inSize).toFixed(1)}%)`);
}

main();
