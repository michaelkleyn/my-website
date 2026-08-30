// Painter — p5.brush standalone, one WebGL2 canvas reused for every sprite, the fish atlas and the water layers.
import { brush } from './brush.js';
import { Shapes } from './shapes.js';
import { styleFor, variantParams } from './style.js';
import { PATTERNS, bodySpace } from './markings.js';
import { clone, clamp, mulberry } from './util.js';

export var paintTarget = null;
export function loadTarget(c) { if (paintTarget !== c) { brush.load(c); paintTarget = c; } }

export var Painter = {
  gl: null, ok: false, painting: false, scaleApplied: 1, job: 0,
  MAXW: 1536, MAXH: 1024,   // shared by the fish atlas rows and the water layers (one target, never switched)

  init: function () {
    if (!brush) return false;
    var c = document.createElement('canvas');
    c.width = this.MAXW; c.height = this.MAXH;
    try {
      if (!c.getContext('webgl2')) return false;
      brush.load(c); paintTarget = c;
      brush.angleMode(brush.DEGREES);
    } catch (e) { console.error(e); return false; }
    this.gl = c; this.ok = true;
    return true;
  },

  setScale: function (s) {
    if (Math.abs(s - this.scaleApplied) < 1e-6) return;
    brush.scaleBrushes(s / this.scaleApplied);
    this.scaleApplied = s;
  },

  /** Atlas cell = bounding box of every variant (and every pose, in poses mode) plus a paint margin. */
  geometry: function (P) {
    var S = Shapes[P.kind], xs = [], ys = [];
    var nV = clamp(P.variants, 1, 9), poses = P.animMode === 'poses' ? 3 : 1;
    var bends = poses === 3 ? [-1, 0, 1] : [0];
    var push = function (p) { xs.push(p[0]); ys.push(p[1]); };
    for (var v = 0; v < nV; v++) {
      var Pv = variantParams(P, v);
      bends.forEach(function (b) {
        S.body(Pv, b).forEach(push);
        var d = S.dorsal(Pv); if (d) d.forEach(push);
        S.fins(Pv, b).forEach(function (sp) { sp.forEach(push); });
      });
    }
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    var m = 26 + 6 * P.brushScale;
    var cellW = Math.ceil(maxX - minX + 2 * m), cellH = Math.ceil(maxY - minY + 2 * m);
    var fit = Math.min(1, this.MAXW / (cellW * poses), this.MAXH / cellH);
    return { cellW: Math.floor(cellW * fit), cellH: Math.floor(cellH * fit), fit: fit, poses: poses,
             ox: (-minX + m) * fit, oy: (-minY + m) * fit, margin: m * fit, bodyW: (maxX - minX) * fit };
  },

  paintOne: function (P, colors, bend, seed, pattern, variantSeed) {
    var S = Shapes[P.kind], c0 = colors[0], c1 = colors[1], c2 = colors[2];
    brush.seed(seed); brush.noiseSeed(seed);
    brush.noField(); brush.noHatch(); brush.noStroke(); brush.noFill();

    var body = S.body(P, bend);
    if (P.washOn) {
      brush.fill(c0, P.washOpacity);
      brush.fillBleed(P.bleed, P.bleedDir);
      brush.fillTexture(P.texture, P.border, P.scatter);
      shape(body, P.curvature);
    }
    var marks = [];
    if (P.markingsOn && pattern && pattern !== 'plain' && PATTERNS[pattern]) {
      var bs = bodySpace(body, S.bodyRange(P));
      marks = PATTERNS[pattern](bs, mulberry(variantSeed), P);
      marks.forEach(function (mk) {
        brush.fill(colors[mk.color], clamp(P.markOpacity * mk.op, 0, 255));
        brush.fillBleed(P.markBleed, 'in');
        brush.fillTexture(P.texture * 0.8, P.border * 0.8, false);
        shape(mk.pts, mk.curv);
      });
    }
    if (P.glazeOn) {
      brush.fill(c1, P.glazeOpacity);
      brush.fillBleed(P.glazeBleed, 'in');
      brush.fillTexture(P.texture * 0.7, P.border * 0.7, false);
      shape(S.back(P, bend), Math.min(1, P.curvature + 0.05));
    }
    if (marks.net) { // Asagi: reticulated scales on the back
      brush.noStroke(); brush.noFill();
      brush.hatchStyle('2H', c2, 0.45);
      brush.hatch(Math.max(3, P.hatchDist * 0.8), 42, { rand: 0.1 });
      brush.polygon(S.back(P, bend));
      brush.hatch(Math.max(3, P.hatchDist * 0.8), -42, { rand: 0.1 });
      brush.polygon(S.back(P, bend));
      brush.noHatch();
    }
    var dorsal = S.dorsal(P);
    if (dorsal) {
      if (P.washOn) { brush.fill(c1, P.glazeOn ? P.glazeOpacity * 0.75 : P.washOpacity * 0.5); brush.fillBleed(0.2, 'out'); brush.fillTexture(0.3, 0.3, false); }
      else brush.noFill();
      if (P.outlineOn) brush.set(P.outlineBrush === 'charcoal' ? 'charcoal' : '2H', c2, P.outlineWeight * 0.8); else brush.noStroke();
      shape(dorsal, 0.3);
      brush.noFill();
    }
    if (P.hatchOn) {
      brush.noStroke(); brush.noFill();
      brush.hatchStyle(P.hatchBrush, c2, P.hatchWeight);
      brush.hatch(P.hatchDist, S.hatchAngle(P, bend), { rand: P.hatchRand, gradient: 0.3 });
      var region = P.hatchRegion === 'tail' ? S.tail(P, bend) : P.hatchRegion === 'back' ? S.back(P, bend) : body;
      brush.polygon(region);
      brush.noHatch();
    }
    if (P.outlineOn) {
      brush.noFill();
      if (P.wiggle > 0) brush.wiggle(P.wiggle);
      brush.set(P.outlineBrush, c2, P.outlineWeight);
      shape(body, P.curvature);
      brush.noField();
    }
    if (P.finsOn) {
      brush.set(P.outlineOn ? P.outlineBrush : 'HB', c2, (P.outlineOn ? P.outlineWeight : 1) * 0.8);
      S.fins(P, bend).forEach(function (sp) { brush.spline(sp, 0.6); });
    }
    var line = S.line(P, bend);
    if (P.lineOn && line) {
      brush.set('2H', c2, 0.75);
      brush.spline(line, 0.5);
    }
    if (P.eyeOn) {
      var e = S.eye(P);
      brush.set('rotring', '#2b2b2b', 0.9);
      brush.fill('#2b2b2b', 235); brush.fillBleed(0.05, 'out'); brush.fillTexture(0, 0, false);
      brush.circle(e[0], e[1], P.eyeSize);
      brush.noFill();
    }
    brush.noStroke(); brush.noFill(); brush.noHatch(); brush.noField();

    function shape(pts, curv) {
      brush.beginShape(curv);
      for (var i = 0; i < pts.length; i++) brush.vertex(pts[i][0], pts[i][1]);
      brush.endShape(true);
    }
  },

  /** p5.brush composites over white with a hard 0/255 coverage alpha. Un-composite from white:
   *  darkness → alpha, pure white → transparent (the transparent-watercolour model). Also scrubs
   *  the (255,255,255,0) pixels the GPU canvas path would otherwise draw as additive white. */
  knockOutWhite: function (ctx, x, y, w, h) {
    var img = ctx.getImageData(x, y, w, h), d = img.data;
    for (var i = 0; i < d.length; i += 4) {
      var a = d[i + 3];
      if (a === 0) continue;
      var r = d[i], gg = d[i + 1], b = d[i + 2];
      var al = 255 - Math.min(r, gg, b);
      if (al === 0) { d[i + 3] = 0; continue; }
      var k = 255 / al;
      d[i] = 255 - (255 - r) * k; d[i + 1] = 255 - (255 - gg) * k; d[i + 2] = 255 - (255 - b) * k;
      d[i + 3] = (al * a) / 255;
    }
    ctx.putImageData(img, x, y);
  },

  /** Cell geometry for one explicit fish (no variant jitter): body + dorsal + fins plus the paint margin. */
  spriteGeometry: function (Pv) {
    var S = Shapes[Pv.kind], xs = [], ys = [];
    var push = function (p) { xs.push(p[0]); ys.push(p[1]); };
    S.body(Pv, 0).forEach(push);
    var d = S.dorsal(Pv); if (d) d.forEach(push);
    S.fins(Pv, 0).forEach(function (sp) { sp.forEach(push); });
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs), minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    var m = 26 + 6 * Pv.brushScale;
    var cellW = Math.ceil(maxX - minX + 2 * m), cellH = Math.ceil(maxY - minY + 2 * m);
    var fit = Math.min(1, this.MAXW / cellW, this.MAXH / cellH);
    return { cellW: Math.floor(cellW * fit), cellH: Math.floor(cellH * fit), fit: fit, ox: (-minX + m) * fit, oy: (-minY + m) * fit, margin: m * fit, bodyW: (maxX - minX) * fit };
  },

  /** Paints one fish (a visitor's design) into its own canvas, synchronously — the same pipeline as an atlas row,
   *  and the result has the same fields as an atlas, so the school draws it with the same strip warp. */
  paintSprite: function (Pv, colors, pattern, seed) {
    var g = this.spriteGeometry(Pv);
    var c = document.createElement('canvas'); c.width = g.cellW; c.height = g.cellH;
    var ctx = c.getContext('2d');
    this.setScale(Pv.brushScale);
    loadTarget(this.gl);
    brush.clear();
    brush.push();
    brush.translate(-this.gl.width / 2, -this.gl.height / 2);
    brush.translate(g.ox, g.oy);
    brush.scale(g.fit);
    this.paintOne(Pv, colors, 0, seed, pattern, seed * 7919 + 1);
    brush.pop();
    brush.render();
    ctx.drawImage(this.gl, 0, 0, g.cellW, g.cellH, 0, 0, g.cellW, g.cellH);
    this.knockOutWhite(ctx, 0, 0, g.cellW, g.cellH);
    return { canvas: c, cellW: g.cellW, cellH: g.cellH, poses: 1, variants: 1, ox: g.ox, oy: g.oy, margin: g.margin, bodyW: g.bodyW };
  },

  /** Paints a full atlas for P (variants × poses). Progressive; cancels any earlier job. */
  paintAtlas: function (P, onProgress, onDone) {
    var self = this, job = ++this.job;
    this.painting = true;
    var g = this.geometry(P);
    var nV = clamp(P.variants, 1, 9);
    var atlas = document.createElement('canvas');
    atlas.width = g.cellW * g.poses; atlas.height = g.cellH * nV;
    var actx = atlas.getContext('2d');
    var Pc = clone(P);
    var v = 0, t0 = performance.now();
    this.setScale(P.brushScale);

    function step() {
      if (job !== self.job) return; // superseded
      var st = styleFor(Pc, v), Pv = variantParams(Pc, v);
      loadTarget(self.gl);
      brush.clear();
      brush.push();
      brush.translate(-self.gl.width / 2, -self.gl.height / 2);
      for (var p = 0; p < g.poses; p++) {
        brush.push();
        brush.translate(p * g.cellW + g.ox, g.oy);
        brush.scale(g.fit);
        self.paintOne(Pv, st.params.palette[st.row], g.poses === 3 ? p - 1 : 0, Pc.seed * 1000 + v * 100 + p * 17, st.params.patterns[st.row], Pc.seed * 7919 + v * 104729 + 1);
        brush.pop();
      }
      brush.pop();
      brush.render();
      actx.drawImage(self.gl, 0, 0, g.cellW * g.poses, g.cellH, 0, v * g.cellH, g.cellW * g.poses, g.cellH);
      self.knockOutWhite(actx, 0, v * g.cellH, g.cellW * g.poses, g.cellH);
      v++;
      onProgress(v, nV);
      if (v < nV) setTimeout(step, 16);
      else { self.painting = false; onDone({ canvas: atlas, cellW: g.cellW, cellH: g.cellH, poses: g.poses, variants: nV,
                    ox: g.ox, oy: g.oy, margin: g.margin, bodyW: g.bodyW, ms: Math.round(performance.now() - t0) }); }
    }
    setTimeout(step, 0);
  },
};
