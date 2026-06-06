#!/usr/bin/env node
// Split a single 3DGS .ply that contains many spatially-separated butterflies
// (a "flap-cycle atlas") into one recentered .ply per butterfly = per frame.
//
// Clustering: voxel flood-fill (union-find over occupied voxels, 26-neighbour).
// The voxel size is auto-tuned to land near a target cluster count.
//
// Usage:
//   node scripts/split-splat.mjs input.ply --clusters 24 [--out-dir assets/splats/frames]
//        [--min-splats 200] [--voxel 0.05]   (--voxel overrides auto-tune)
//
// Writes cluster_00.ply … (recentered to origin) + summary.json with each
// cluster's splat count, centroid and bounding-box size.

import fs from "node:fs";
import path from "node:path";

const TYPE_SIZES = {
  char: 1, uchar: 1, int8: 1, uint8: 1, short: 2, ushort: 2, int16: 2,
  uint16: 2, int: 4, uint: 4, int32: 4, uint32: 4, float: 4, float32: 4,
  double: 8, float64: 8,
};

function parseArgs(argv) {
  const a = { clusters: 24, outDir: "assets/splats/frames", minSplats: 200, voxel: 0, grid: null };
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--clusters") a.clusters = parseInt(argv[++i], 10);
    else if (t === "--out-dir") a.outDir = argv[++i];
    else if (t === "--min-splats") a.minSplats = parseInt(argv[++i], 10);
    else if (t === "--voxel") a.voxel = parseFloat(argv[++i]);
    else if (t === "--grid") {
      const m = /^(\d+)x(\d+)$/.exec(argv[++i]);
      if (!m) throw new Error("--grid expects CxR, e.g. 4x5");
      a.grid = { cols: +m[1], rows: +m[2] };
    } else pos.push(t);
  }
  a.input = pos[0];
  return a;
}

// 1-D k-means (Lloyd) — used to find evenly-laid-out grid column/row centers
function kmeans1d(vals, k, iters = 40) {
  const sorted = Float64Array.from(vals).sort();
  let centers = [];
  for (let i = 0; i < k; i++) centers.push(sorted[Math.floor(((i + 0.5) / k) * sorted.length)]);
  for (let it = 0; it < iters; it++) {
    const sum = new Float64Array(k), cnt = new Float64Array(k);
    for (let v = 0; v < vals.length; v++) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < k; c++) { const d = Math.abs(vals[v] - centers[c]); if (d < bd) { bd = d; best = c; } }
      sum[best] += vals[v]; cnt[best]++;
    }
    let moved = 0;
    for (let c = 0; c < k; c++) if (cnt[c]) { const nc = sum[c] / cnt[c]; moved += Math.abs(nc - centers[c]); centers[c] = nc; }
    if (moved < 1e-6) break;
  }
  return centers.sort((p, q) => p - q);
}

const nearest = (v, centers) => {
  let bi = 0, bd = Infinity;
  for (let i = 0; i < centers.length; i++) { const d = Math.abs(v - centers[i]); if (d < bd) { bd = d; bi = i; } }
  return bi;
};

function parseHeader(buf) {
  const text = buf.toString("latin1", 0, Math.min(buf.length, 1 << 16));
  if (text.slice(0, 3) !== "ply") throw new Error("not a .ply file");
  const marker = "end_header\n";
  const end = text.indexOf(marker);
  if (end < 0) throw new Error("no end_header found");
  const headerEnd = end + marker.length;
  const lines = text.slice(0, end).split("\n").map((l) => l.trim());
  let format = null, vertexCount = 0, inVertex = false;
  const props = [];
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
      if (!TYPE_SIZES[type]) throw new Error(`unsupported type: ${type}`);
      props.push({ name, type, size: TYPE_SIZES[type] });
    }
  }
  if (format !== "binary_little_endian")
    throw new Error(`only binary_little_endian supported (got: ${format})`);
  let offset = 0;
  for (const p of props) { p.offset = offset; offset += p.size; }
  return { headerEnd, vertexCount, props, stride: offset };
}

// union-find
function makeUF(n) {
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
  return { find, union };
}

// cluster splats into voxels of size v, flood-fill, return {labels, nClusters}
function cluster(xs, ys, zs, n, v, minSplats) {
  const key = (ix, iy, iz) => `${ix},${iy},${iz}`;
  const voxOf = new Map(); // key -> voxel index
  const voxCoord = [];
  const splatVox = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const ix = Math.floor(xs[i] / v), iy = Math.floor(ys[i] / v), iz = Math.floor(zs[i] / v);
    const k = key(ix, iy, iz);
    let vi = voxOf.get(k);
    if (vi === undefined) { vi = voxCoord.length; voxOf.set(k, vi); voxCoord.push([ix, iy, iz]); }
    splatVox[i] = vi;
  }
  const uf = makeUF(voxCoord.length);
  for (let vi = 0; vi < voxCoord.length; vi++) {
    const [ix, iy, iz] = voxCoord[vi];
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          if (dx === 0 && dy === 0 && dz === 0) continue;
          const nj = voxOf.get(key(ix + dx, iy + dy, iz + dz));
          if (nj !== undefined) uf.union(vi, nj);
        }
  }
  // map roots -> dense cluster ids; count splats per cluster
  const rootCount = new Map();
  const splatRoot = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const r = uf.find(splatVox[i]);
    splatRoot[i] = r;
    rootCount.set(r, (rootCount.get(r) || 0) + 1);
  }
  const bigRoots = [...rootCount.entries()].filter(([, c]) => c >= minSplats).map(([r]) => r);
  const rootToId = new Map(bigRoots.map((r, idx) => [r, idx]));
  const labels = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const id = rootToId.get(splatRoot[i]);
    if (id !== undefined) labels[i] = id;
  }
  return { labels, nClusters: bigRoots.length };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) {
    console.error("usage: node scripts/split-splat.mjs input.ply --clusters 24");
    process.exit(1);
  }
  const buf = fs.readFileSync(args.input);
  const { headerEnd, vertexCount, props, stride } = parseHeader(buf);
  const byName = Object.fromEntries(props.map((p) => [p.name, p]));
  for (const n of ["x", "y", "z"]) if (!byName[n]) throw new Error(`missing property ${n}`);

  // read positions
  const xs = new Float32Array(vertexCount), ys = new Float32Array(vertexCount), zs = new Float32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    const base = headerEnd + i * stride;
    xs[i] = buf.readFloatLE(base + byName.x.offset);
    ys[i] = buf.readFloatLE(base + byName.y.offset);
    zs[i] = buf.readFloatLE(base + byName.z.offset);
  }

  // bbox + diagonal for voxel scale
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < vertexCount; i++) {
    if (xs[i] < minX) minX = xs[i]; if (xs[i] > maxX) maxX = xs[i];
    if (ys[i] < minY) minY = ys[i]; if (ys[i] > maxY) maxY = ys[i];
    if (zs[i] < minZ) minZ = zs[i]; if (zs[i] > maxZ) maxZ = zs[i];
  }
  const diag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ);

  // pick voxel size: explicit, or auto-tune toward target cluster count
  let result;
  let gridNames = null;
  if (args.grid) {
    // grid mode: find column (X) and row (Z) centers from opaque splats,
    // then assign every splat to its nearest cell — robust for a lattice
    const OP = byName.opacity;
    const sx = [], sz = [];
    const pick = Math.max(1, Math.floor(vertexCount / 40000));
    for (let i = 0; i < vertexCount; i += pick) {
      let a = 1;
      if (OP) a = 1 / (1 + Math.exp(-buf.readFloatLE(headerEnd + i * stride + OP.offset)));
      if (a > 0.25) { sx.push(xs[i]); sz.push(zs[i]); }
    }
    const colC = kmeans1d(sx, args.grid.cols);
    const rowC = kmeans1d(sz, args.grid.rows);
    console.log(`columns X: ${colC.map((v) => v.toFixed(3)).join(", ")}`);
    console.log(`rows    Z: ${rowC.map((v) => v.toFixed(3)).join(", ")}`);
    const labels = new Int32Array(vertexCount);
    for (let i = 0; i < vertexCount; i++)
      labels[i] = nearest(zs[i], rowC) * args.grid.cols + nearest(xs[i], colC);
    gridNames = [];
    for (let r = 0; r < args.grid.rows; r++)
      for (let c = 0; c < args.grid.cols; c++) gridNames.push({ r, c });
    result = { v: 0, labels, nClusters: args.grid.cols * args.grid.rows };
  } else if (args.voxel > 0) {
    result = { v: args.voxel, ...cluster(xs, ys, zs, vertexCount, args.voxel, args.minSplats) };
    console.log(`voxel ${args.voxel.toFixed(4)} -> ${result.nClusters} clusters`);
  } else {
    let lo = diag / 800, hi = diag / 12, best = null;
    console.log(`auto-tuning voxel for ~${args.clusters} clusters (diag ${diag.toFixed(3)})…`);
    for (let it = 0; it < 16; it++) {
      const v = Math.sqrt(lo * hi);
      const c = cluster(xs, ys, zs, vertexCount, v, args.minSplats);
      console.log(`  voxel ${v.toFixed(4)} -> ${c.nClusters} clusters`);
      if (!best || Math.abs(c.nClusters - args.clusters) < Math.abs(best.nClusters - args.clusters))
        best = { v, ...c };
      if (c.nClusters === args.clusters) { best = { v, ...c }; break; }
      // bigger voxel => fewer clusters
      if (c.nClusters > args.clusters) lo = v; else hi = v;
    }
    result = best;
    console.log(`chosen voxel ${result.v.toFixed(4)} -> ${result.nClusters} clusters`);
  }

  // gather splat indices per cluster
  const groups = Array.from({ length: result.nClusters }, () => []);
  for (let i = 0; i < vertexCount; i++) if (result.labels[i] >= 0) groups[result.labels[i]].push(i);

  // header for recentered output (same props)
  const propLines = props.map((p) => `property ${p.type} ${p.name}`);
  fs.mkdirSync(args.outDir, { recursive: true });

  const summary = [];
  groups.forEach((idxs, gi) => {
    if (idxs.length === 0) return;
    const g = gridNames ? gridNames[gi] : null;
    // centroid
    let cx = 0, cy = 0, cz = 0;
    for (const i of idxs) { cx += xs[i]; cy += ys[i]; cz += zs[i]; }
    cx /= idxs.length; cy /= idxs.length; cz /= idxs.length;
    let bx0 = Infinity, by0 = Infinity, bz0 = Infinity, bx1 = -Infinity, by1 = -Infinity, bz1 = -Infinity;

    const body = Buffer.allocUnsafe(idxs.length * stride);
    let w = 0;
    for (const i of idxs) {
      const base = headerEnd + i * stride;
      buf.copy(body, w, base, base + stride);
      // recenter x,y,z in the copied row
      body.writeFloatLE(xs[i] - cx, w + byName.x.offset);
      body.writeFloatLE(ys[i] - cy, w + byName.y.offset);
      body.writeFloatLE(zs[i] - cz, w + byName.z.offset);
      w += stride;
      bx0 = Math.min(bx0, xs[i]); bx1 = Math.max(bx1, xs[i]);
      by0 = Math.min(by0, ys[i]); by1 = Math.max(by1, ys[i]);
      bz0 = Math.min(bz0, zs[i]); bz1 = Math.max(bz1, zs[i]);
    }
    const name = g
      ? `cell_r${g.r}_c${g.c}.ply`
      : `cluster_${String(gi).padStart(2, "0")}.ply`;
    const header = [
      "ply", "format binary_little_endian 1.0",
      `comment recentered ${g ? `cell r${g.r} c${g.c}` : `cluster ${gi}`} from ${path.basename(args.input)}`,
      `element vertex ${idxs.length}`, ...propLines, "end_header", "",
    ].join("\n");
    fs.writeFileSync(path.join(args.outDir, name), Buffer.concat([Buffer.from(header, "latin1"), body]));
    summary.push({
      file: name, splats: idxs.length,
      ...(g ? { row: g.r, col: g.c } : {}),
      centroid: [+cx.toFixed(4), +cy.toFixed(4), +cz.toFixed(4)],
      size: [+(bx1 - bx0).toFixed(4), +(by1 - by0).toFixed(4), +(bz1 - bz0).toFixed(4)],
    });
  });

  summary.sort((a, b) => a.file.localeCompare(b.file));
  fs.writeFileSync(path.join(args.outDir, "summary.json"), JSON.stringify(summary, null, 2));

  console.log(`\nwrote ${summary.length} clusters to ${args.outDir}/`);
  for (const s of summary)
    console.log(`  ${s.file}  splats ${String(s.splats).padStart(7)}  centroid [${s.centroid.join(", ")}]  size [${s.size.join(", ")}]`);
}

main();
