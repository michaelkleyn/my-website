// Water — a ripple simulation the fish drive, painted as brush strokes along the ripple contours.
import { brush } from './brush.js';
import { P } from './config.js';
import { Painter } from './painter.js';
import { PondFlow } from './pond-flow.js';
import { clone, clamp, rand, mulberry, wrapAngle } from './util.js';

export var Water = {
  cols: 0, rows: 0, cell: 8, cur: null, prev: null, damp: null, layers: [], lastPaint: 0, acc: 0, obs: null, dist: null,
  pond: null, pondDirty: true, W: 0, H: 0, glW: 0, glH: 0, res: 0.5, maskC: null, tmpC: null,

  resize: function (W, H) {
    this.W = W; this.H = H; this.cell = P.rippleDetail;
    this.cols = Math.ceil(W / this.cell) + 2; this.rows = Math.ceil(H / this.cell) + 2;
    var n = this.cols * this.rows;
    this.cur = new Float32Array(n); this.prev = new Float32Array(n); this.damp = new Float32Array(n);
    this.rebuildDamping();
    this.res = Math.min(0.5, Painter.MAXW / W, Painter.MAXH / H);
    this.glW = Math.max(64, Math.round(W * this.res)); this.glH = Math.max(64, Math.round(H * this.res));
    this.layers = []; this.pond = null; this.pondDirty = true; this.obs = null; this.dist = null;
    this.maskC = document.createElement('canvas'); this.maskC.width = this.glW; this.maskC.height = this.glH;
    this.tmpC = document.createElement('canvas'); this.tmpC.width = this.glW; this.tmpC.height = this.glH;
  },

  /** Per-cell damping: rippleLife → 0.97…0.999, easing to absorbing near the edges so ripples never echo off the screen. */
  rebuildDamping: function () {
    var base = 0.97 + 0.029 * clamp(P.rippleLife, 0, 1), cols = this.cols, rows = this.rows, E = 7;
    for (var y = 0; y < rows; y++) for (var x = 0; x < cols; x++) {
      var e = Math.min(x, y, cols - 1 - x, rows - 1 - y);
      this.damp[y * cols + x] = e >= E ? base : base * (0.82 + 0.18 * e / E);
    }
  },

  /** Push the surface at (x, y) px with a soft round kernel; radius r in cells. */
  disturb: function (x, y, amp, r) {
    if (!this.cur) return;
    var c = this.cell, cx = Math.round(x / c) + 1, cy = Math.round(y / c) + 1, R = r || 1, obs = this.obs;
    for (var j = -R; j <= R; j++) for (var i = -R; i <= R; i++) {
      var xx = cx + i, yy = cy + j;
      if (xx < 1 || yy < 1 || xx >= this.cols - 1 || yy >= this.rows - 1) continue;
      if (obs && obs[yy * this.cols + xx]) continue;
      var d = Math.hypot(i, j); if (d > R + 0.5) continue;
      this.cur[yy * this.cols + xx] += amp * 0.5 * (1 + Math.cos(Math.PI * d / (R + 1)));
    }
  },

  /** Obstacle mask (1 = solid) + a distance field in cells, so fish can steer around it and waves reflect off it. */
  setObstacle: function (mask) {
    this.obs = mask; if (!mask) { this.dist = null; return; }
    var cols = this.cols, rows = this.rows, d = new Float32Array(cols * rows), INF = 1e6;
    for (var i = 0; i < d.length; i++) d[i] = mask[i] ? 0 : INF;
    for (var y = 1; y < rows; y++) for (var x = 1; x < cols; x++) { var i2 = y * cols + x; d[i2] = Math.min(d[i2], d[i2 - 1] + 1, d[i2 - cols] + 1, d[i2 - cols - 1] + 1.414, (x < cols - 1 ? d[i2 - cols + 1] + 1.414 : INF)); }
    for (var y2 = rows - 2; y2 >= 0; y2--) for (var x2 = cols - 2; x2 >= 0; x2--) { var i3 = y2 * cols + x2; d[i3] = Math.min(d[i3], d[i3 + 1] + 1, d[i3 + cols] + 1, d[i3 + cols + 1] + 1.414, (x2 > 0 ? d[i3 + cols - 1] + 1.414 : INF)); }
    this.dist = d;
    if (mask) for (var k = 0; k < mask.length; k++) if (mask[k]) { this.cur[k] = 0; this.prev[k] = 0; }
  },
  /** distance (px) from a tank point to the nearest obstacle cell; large when there is none */
  sampleDist: function (x, y) {
    if (!this.dist) return 1e6;
    var fx = x / this.cell + 1, fy = y / this.cell + 1, cols = this.cols, rows = this.rows;
    var x0 = clamp(Math.floor(fx), 0, cols - 2), y0 = clamp(Math.floor(fy), 0, rows - 2), tx = clamp(fx - x0, 0, 1), ty = clamp(fy - y0, 0, 1), i = y0 * cols + x0, d = this.dist;
    return ((d[i] * (1 - tx) + d[i + 1] * tx) * (1 - ty) + (d[i + cols] * (1 - tx) + d[i + cols + 1] * tx) * ty) * this.cell;
  },
  /** unit vector pointing away from the obstacle */
  distGrad: function (x, y) {
    var e = this.cell * 1.5, gx = this.sampleDist(x + e, y) - this.sampleDist(x - e, y), gy = this.sampleDist(x, y + e) - this.sampleDist(x, y - e), m = Math.hypot(gx, gy);
    return m > 1e-6 ? [gx / m, gy / m] : [0, -1];
  },

  /** Advance at a fixed rate (rippleSpeed steps/s) so ripples travel the same on any machine. */
  advance: function (dt) {
    this.acc += dt;
    var steps = Math.min(4, Math.floor(this.acc * P.rippleSpeed)); if (steps <= 0) return;
    this.acc -= steps / P.rippleSpeed;
    for (var k = 0; k < steps; k++) this.step();
  },
  step: function () {
    var cols = this.cols, rows = this.rows, cur = this.cur, prev = this.prev, damp = this.damp, obs = P.journalBounce ? this.obs : null;
    for (var y = 1; y < rows - 1; y++) {
      var o = y * cols;
      for (var x = 1; x < cols - 1; x++) {
        var i = o + x;
        if (obs && obs[i]) { prev[i] = 0; continue; }   // solid: the surface is pinned here, so waves reflect
        prev[i] = ((cur[i - 1] + cur[i + 1] + cur[i - cols] + cur[i + cols]) * 0.5 - prev[i]) * damp[i];
      }
    }
    var t = this.cur; this.cur = this.prev; this.prev = t;
  },

  /** Ink the wavefronts: trace the zero-level line of every ripple ring once, painted with p5.brush into a fresh layer. */
  paint: function (now) {
    if (!Painter.ok || !this.cur) return;
    var cols = this.cols, rows = this.rows, h = this.cur, cell = this.cell, res = this.res;
    var maxMag = 0, seeds = [];
    for (var y = 1; y < rows - 1; y++) for (var x = 1; x < cols - 1; x++) {
      var i = y * cols + x, gx = h[i + 1] - h[i - 1], gy = h[i + cols] - h[i - cols], m = Math.hypot(gx, gy);
      if (m > maxMag) maxMag = m;
      if (m > 0.003 && (h[i] * h[i + 1] <= 0 || h[i] * h[i + cols] <= 0)) seeds.push([x, y, m]);   // a zero crossing: the wavefront
    }
    if (!seeds.length || maxMag < 0.008) return;
    var thr = (1 - clamp(P.inkDetail, 0, 1)) * 0.5 * maxMag;
    seeds = seeds.filter(function (c) { return c[2] > thr; });
    seeds.sort(function (a, b) { return b[2] - a[2]; });
    if (!seeds.length) return;
    var gl = Painter.gl;
    brush.clear();
    brush.push(); brush.translate(-gl.width / 2, -gl.height / 2); brush.scale(res);
    brush.noFill(); brush.noHatch(); brush.noField();
    var used = new Uint8Array(cols * rows);
    function sampleH(fx, fy) {
      var x0 = Math.floor(fx), y0 = Math.floor(fy); if (x0 < 1 || y0 < 1 || x0 >= cols - 2 || y0 >= rows - 2) return null;
      var tx = fx - x0, ty = fy - y0, i = y0 * cols + x0;
      return (h[i] * (1 - tx) + h[i + 1] * tx) * (1 - ty) + (h[i + cols] * (1 - tx) + h[i + cols + 1] * tx) * ty;
    }
    function grad(fx, fy) {
      var x0 = Math.floor(fx), y0 = Math.floor(fy); if (x0 < 1 || y0 < 1 || x0 >= cols - 2 || y0 >= rows - 2) return null;
      var tx = fx - x0, ty = fy - y0, i = y0 * cols + x0;
      var g = function (j) { return h[j + 1] - h[j - 1]; }, gv = function (j) { return h[j + cols] - h[j - cols]; };
      var gx = (g(i) * (1 - tx) + g(i + 1) * tx) * (1 - ty) + (g(i + cols) * (1 - tx) + g(i + cols + 1) * tx) * ty;
      var gy = (gv(i) * (1 - tx) + gv(i + 1) * tx) * (1 - ty) + (gv(i + cols) * (1 - tx) + gv(i + cols + 1) * tx) * ty;
      return [gx, gy, Math.hypot(gx, gy)];
    }
    // follow the zero-level line from a seed in both directions, pulling back onto it each step (Newton)
    function trace(sx, sy) {
      var out = [], stepLen = 0.5, maxSteps = 700;
      for (var dir = -1; dir <= 1; dir += 2) {
        var x = sx, y = sy, pts = [];
        for (var n = 0; n < maxSteps; n++) {
          var g = grad(x, y); if (!g || g[2] < thr * 0.4) break;
          x += (-g[1] / g[2]) * stepLen * dir; y += (g[0] / g[2]) * stepLen * dir;
          var hh = sampleH(x, y), g2 = grad(x, y); if (hh === null || !g2 || g2[2] < 1e-6) break;
          var k = hh / (g2[2] * g2[2]); x -= g2[0] * k; y -= g2[1] * k;
          var ci = Math.round(y) * cols + Math.round(x); if (ci < 0 || ci >= used.length) break;
          if (used[ci] && n > 4) { pts.push([x, y, g2[2]]); break; }      // closed the ring, or met another line
          used[ci] = 1; pts.push([x, y, g2[2]]);
          if (n > 12 && Math.hypot(x - sx, y - sy) < 0.7) break;
        }
        if (dir < 0) { pts.reverse(); out = pts; out.push([sx, sy, grad(sx, sy) ? grad(sx, sy)[2] : thr]); } else out = out.concat(pts);
      }
      return out;
    }
    var strokes = [], drawn = 0, life = P.inkLife * 1000;
    for (var q = 0; q < seeds.length && drawn < P.inkStrokes; q++) {
      var c = seeds[q];
      if (used[c[1] * cols + c[0]]) continue;
      var pts = trace(c[0], c[1]);
      if (pts.length < 8) continue;
      var n = pts.length, spl = [], path = [], cum = [0], len = 0;
      for (var k2 = 0; k2 < n; k2++) {
        var u = k2 / (n - 1), taper = 0.35 + 0.65 * Math.sin(Math.PI * u), pr = taper * (0.45 + 0.9 * Math.min(1, pts[k2][2] / maxMag));
        var px = (pts[k2][0] - 1) * cell, py = (pts[k2][1] - 1) * cell;
        spl.push([px, py, pr]); path.push([px * res, py * res]);
        if (k2) { len += Math.hypot(path[k2][0] - path[k2 - 1][0], path[k2][1] - path[k2 - 1][1]); cum.push(len); }
      }
      brush.set(P.inkBrush, P.inkColor, P.inkWeight); brush.spline(spl, 0.3);
      strokes.push({ path: path, cum: cum, len: len, mw: (6 + 4 * P.inkWeight) * res * 2, delay: Math.random() * P.inkEvery * 0.8,
                     dur: Math.max(80, (len / res) / P.inkPenSpeed * 1000), hold: life * 0.55, fade: Math.max(1, life * 0.45) });
      drawn++;
    }
    brush.noStroke(); brush.pop();
    if (!strokes.length) return;
    brush.render();
    var c2 = document.createElement('canvas'); c2.width = this.glW; c2.height = this.glH;
    var ctx = c2.getContext('2d'); ctx.drawImage(gl, 0, 0, this.glW, this.glH, 0, 0, this.glW, this.glH);
    Painter.knockOutWhite(ctx, 0, 0, this.glW, this.glH);
    this.layers.push({ canvas: c2, t0: now, strokes: strokes }); if (this.layers.length > 8) this.layers.shift();
  },

  /** Draw the live layers: each line is revealed along its path by a growing mask, held, then faded. */
  drawLayers: function (ctx, now, fullW, H) {
    var mctx = this.maskC.getContext('2d'), tctx = this.tmpC.getContext('2d'), glW = this.glW, glH = this.glH;
    for (var li = this.layers.length - 1; li >= 0; li--) {
      var L = this.layers[li];
      var age = now - L.t0, alive = false, any = false;
      mctx.setTransform(1, 0, 0, 1, 0, 0); mctx.clearRect(0, 0, glW, glH); mctx.lineCap = 'round'; mctx.lineJoin = 'round'; mctx.strokeStyle = '#000';
      for (var si = 0; si < L.strokes.length; si++) {
        var st = L.strokes[si], t = age - st.delay;
        if (t < 0) { alive = true; continue; }
        var p = Math.min(1, t / st.dur), post = t - st.dur;
        var a = post < st.hold ? 1 : 1 - (post - st.hold) / st.fade;
        if (a <= 0) continue;
        alive = true; any = true;
        mctx.globalAlpha = a; mctx.lineWidth = st.mw;
        var target = p * st.len, path = st.path, cum = st.cum;
        mctx.beginPath(); mctx.moveTo(path[0][0], path[0][1]);
        for (var k = 1; k < path.length; k++) {
          if (cum[k] <= target) { mctx.lineTo(path[k][0], path[k][1]); continue; }
          var f = (target - cum[k - 1]) / Math.max(1e-6, cum[k] - cum[k - 1]);
          mctx.lineTo(path[k - 1][0] + (path[k][0] - path[k - 1][0]) * f, path[k - 1][1] + (path[k][1] - path[k - 1][1]) * f);
          break;
        }
        mctx.stroke();
      }
      if (!alive) { this.layers.splice(li, 1); continue; }
      if (!any) continue;
      tctx.setTransform(1, 0, 0, 1, 0, 0); tctx.globalCompositeOperation = 'source-over'; tctx.clearRect(0, 0, glW, glH);
      tctx.drawImage(L.canvas, 0, 0); tctx.globalCompositeOperation = 'destination-in'; tctx.drawImage(this.maskC, 0, 0);
      ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = P.inkOpacity;
      ctx.drawImage(this.tmpC, 0, 0, fullW, H);
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  },

  /** The pond itself: soft watercolour clouds bent by the built-in 'seabed' field, painted once, then kept moving by PondFlow. */
  paintPond: function () {
    if (!Painter.ok) return;
    var gl = Painter.gl;
    brush.clear();
    brush.push(); brush.translate(-gl.width / 2, -gl.height / 2); brush.scale(this.res);
    brush.noStroke(); brush.noHatch();
    brush.field('seabed');
    brush.fill(P.pondColor, 90); brush.fillBleed(0.7, 'out'); brush.fillTexture(0.9, 0.35, true);
    var W = this.W, H = this.H, r = mulberry(P.seed * 7 + 99);
    for (var i = 0; i < 4; i++) {
      var cx = r() * W, cy = r() * H, rx = (0.35 + r() * 0.35) * W, ry = (0.3 + r() * 0.35) * H;
      brush.beginShape(0.6);
      for (var k = 0; k < 14; k++) { var a = (k / 14) * Math.PI * 2, rr = 0.75 + 0.5 * r(); brush.vertex(cx + Math.cos(a) * rx * rr, cy + Math.sin(a) * ry * rr); }
      brush.endShape(true);
    }
    brush.noField(); brush.noFill();
    brush.pop(); brush.render();
    var c2 = document.createElement('canvas'); c2.width = this.glW; c2.height = this.glH;
    var ctx = c2.getContext('2d'); ctx.drawImage(gl, 0, 0, this.glW, this.glH, 0, 0, this.glW, this.glH);
    Painter.knockOutWhite(ctx, 0, 0, this.glW, this.glH);
    this.pond = c2; this.pondDirty = false;
    PondFlow.setTexture(c2);
  },
};
