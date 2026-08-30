// Book — the pond drawn on the pages of a journal photo, multiplied through an editable page mask (pages only:
// fish pass under the spine). The mask = SAM pages → inset/feather via a distance field → spine band → brush edits.
import { P } from './config.js';
import { createEmitter } from './emitter.js';

export var Book = {
  D: null, ready: false, img: null, imgReady: false,
  MW: 0, MH: 0, R: 0.5,       // mask working resolution: R × the photo
  dist: null,                 // signed distance to the SAM page edge, in mask px (positive inside)
  edits: null,                // brush layer, −1..1 (added to the geometric mask)
  maskC: null, tintC: null, maskDirty: true, editsUrl: '',
  fit: { s: 1, x: 0, y: 0 }, world: { x: 0, y: 0, w: 1, h: 1 }, bbox: [0, 0, 1, 1],
  worldC: null, editing: false, stroke: null, undo: [], brushPos: null, spineX: 0,

  init: function (D, opts) {
    opts = opts || {}; this.canvas = opts.canvas || this.canvas;
    if (!D || !D.src) return;
    var self = this; this.D = D;
    this.MW = Math.round(D.W * this.R); this.MH = Math.round(D.H * this.R);
    this.bbox = [Math.min(D.left[0], D.right[0]), Math.min(D.left[1], D.right[1]), Math.max(D.left[2], D.right[2]), Math.max(D.left[3], D.right[3])];
    this.maskC = document.createElement('canvas'); this.maskC.width = this.MW; this.maskC.height = this.MH;
    this.tintC = document.createElement('canvas'); this.tintC.width = this.MW; this.tintC.height = this.MH;
    this.edits = new Float32Array(this.MW * this.MH);
    var pages = new Image();
    pages.onload = function () {
      var c = document.createElement('canvas'); c.width = self.MW; c.height = self.MH; var cx = c.getContext('2d');
      cx.drawImage(pages, 0, 0, self.MW, self.MH);
      var d = cx.getImageData(0, 0, self.MW, self.MH).data, inside = new Uint8Array(self.MW * self.MH);
      for (var i = 0; i < inside.length; i++) inside[i] = d[i * 4] > 64 ? 1 : 0;
      self.dist = self.signedDistance(inside);
      self.maybeReady();
      self.maskDirty = true;
      self.syncFromP();
    };
    pages.src = D.pages;
    this.img = new Image();
    this.img.onload = function () { self.imgReady = true; self.maybeReady(); };
    this.img.src = D.src;
  },
  /** 'ready' fires once, when both the photo and the page mask have decoded — in either order (URLs load in any order). */
  maybeReady: function () { if (this.imgReady && this.dist && !this.ready) { this.ready = true; this.emit('ready'); } },
  active: function () { return this.ready && !!this.dist && P.bookOn; },

  /** Fit the photo into the tank area (contain × zoom, shifted), and place the page spread as the world. */
  layout: function (areaW, areaH) {
    var D = this.D, s = Math.min(areaW / D.W, areaH / D.H) * P.bookZoom;
    var x = (areaW - D.W * s) / 2 + P.bookX * areaW, y = (areaH - D.H * s) / 2 + P.bookY * areaH;
    this.fit = { s: s, x: x, y: y };
    var b = this.bbox;
    this.world = { x: x + b[0] * s, y: y + b[1] * s, w: (b[2] - b[0]) * s, h: (b[3] - b[1]) * s };
    this.spineX = D.spine + P.bookSpineShift;
  },
  toPhoto: function (x, y) { var f = this.fit; return [(x - f.x) / f.s, (y - f.y) / f.s]; },

  /** Two-pass chamfer distance, inside and outside, → signed distance in mask px. */
  signedDistance: function (inside) {
    var W = this.MW, H = this.MH, n = W * H;
    function dt(mask) {   // distance to the nearest mask==1 pixel, for every pixel
      var d = new Float32Array(n), INF = 1e6, i, x, y;
      for (i = 0; i < n; i++) d[i] = mask[i] ? 0 : INF;
      for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
        i = y * W + x; if (d[i] === 0) continue; var v = d[i];
        if (x > 0) v = Math.min(v, d[i - 1] + 1);
        if (y > 0) { v = Math.min(v, d[i - W] + 1); if (x > 0) v = Math.min(v, d[i - W - 1] + 1.414); if (x < W - 1) v = Math.min(v, d[i - W + 1] + 1.414); }
        d[i] = v;
      }
      for (y = H - 1; y >= 0; y--) for (x = W - 1; x >= 0; x--) {
        i = y * W + x; if (d[i] === 0) continue; var u = d[i];
        if (x < W - 1) u = Math.min(u, d[i + 1] + 1);
        if (y < H - 1) { u = Math.min(u, d[i + W] + 1); if (x < W - 1) u = Math.min(u, d[i + W + 1] + 1.414); if (x > 0) u = Math.min(u, d[i + W - 1] + 1.414); }
        d[i] = u;
      }
      return d;
    }
    var outside = new Uint8Array(n); for (var k = 0; k < n; k++) outside[k] = inside[k] ? 0 : 1;
    var toOut = dt(outside), toIn = dt(inside), sd = new Float32Array(n);
    for (var j = 0; j < n; j++) sd[j] = inside[j] ? toOut[j] : -toIn[j];
    return sd;
  },

  /** The final mask: pages inset/feathered, minus the spine band, plus the brush layer. Also the tint overlay. */
  rebuildMask: function () {
    this.maskDirty = false;
    if (!this.dist) return;
    var W = this.MW, H = this.MH, R = this.R, dist = this.dist, E = this.edits;
    var inset = P.bookInset * R, feather = Math.max(0.5, P.bookFeather * R);
    var sx = this.spineX * R, half = P.bookSpineWidth * R / 2, soft = Math.max(0.5, P.bookSpineSoft * R);
    var mctx = this.maskC.getContext('2d'), tctx = this.tintC.getContext('2d');
    var mi = mctx.createImageData(W, H), ti = tctx.createImageData(W, H), md = mi.data, td = ti.data;
    var smooth = function (t) { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
    for (var y = 0, i = 0; y < H; y++) for (var x = 0; x < W; x++, i++) {
      var g = smooth((dist[i] - inset) / feather + 0.5);
      var band = smooth((Math.abs(x - sx) - half) / soft);
      var v = g * band + E[i]; v = v < 0 ? 0 : v > 1 ? 1 : v;
      var o = i * 4;
      md[o] = md[o + 1] = md[o + 2] = 255; md[o + 3] = Math.round(v * 255);
      var near = dist[i] > -40 * R;   // tint only around the pages, not the whole cover
      td[o] = 255; td[o + 1] = 87; td[o + 2] = 34; td[o + 3] = near ? Math.round((1 - v) * 255) : 0;
    }
    mctx.putImageData(mi, 0, 0); tctx.putImageData(ti, 0, 0);
  },

  worldCtx: function (W, H, dpr) {
    if (!this.worldC) this.worldC = document.createElement('canvas');
    var pw = Math.round(W * dpr), ph = Math.round(H * dpr);
    if (this.worldC.width !== pw || this.worldC.height !== ph) { this.worldC.width = pw; this.worldC.height = ph; }
    return this.worldC.getContext('2d');
  },

  /** Screen = surround + photo + (world × mask) multiplied onto the pages; then the mask tint and the brush cursor. */
  compose: function (ctx, sc) {
    var dpr = sc.dpr, D = this.D, f = this.fit, wc = this.worldC, R = this.R, b = this.bbox;
    if (this.maskDirty) this.rebuildMask();
    var wctx = wc.getContext('2d');
    wctx.setTransform(dpr, 0, 0, dpr, 0, 0); wctx.globalAlpha = 1; wctx.globalCompositeOperation = 'destination-in';
    wctx.drawImage(this.maskC, b[0] * R, b[1] * R, (b[2] - b[0]) * R, (b[3] - b[1]) * R, 0, 0, sc.W, sc.H);
    wctx.globalCompositeOperation = 'source-over';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = P.paper; ctx.fillRect(0, 0, sc.cw, sc.ch);   // the journal is a cut-out: it sits on the tank's paper
    ctx.drawImage(this.img, f.x, f.y, D.W * f.s, D.H * f.s);
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(wc, 0, 0, wc.width, wc.height, sc.ox, sc.oy, sc.W, sc.H);
    ctx.globalCompositeOperation = 'source-over';
    if (P.bookShowMask || this.editing) { ctx.globalAlpha = 0.38; ctx.drawImage(this.tintC, f.x, f.y, D.W * f.s, D.H * f.s); ctx.globalAlpha = 1; }
    if (this.editing && this.brushPos) {
      var r = P.bookBrushSize * f.s / 2, erase = this.tool() === 'erase';
      ctx.beginPath(); ctx.arc(this.brushPos[0], this.brushPos[1], r, 0, Math.PI * 2);
      ctx.strokeStyle = erase ? '#ff5722' : '#2b3a48'; ctx.lineWidth = 1.5; ctx.setLineDash(erase ? [4, 4] : []); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(this.brushPos[0], this.brushPos[1], Math.max(1, r * (1 - P.bookBrushSoft)), 0, Math.PI * 2); ctx.strokeStyle = 'rgba(43,58,72,0.35)'; ctx.lineWidth = 1; ctx.stroke();
    }
  },

  // ---- brush
  toolName: 'paint',
  setTool: function (t) { this.toolName = t; },
  tool: function () { var t = this.toolName; return this.altHeld ? (t === 'erase' ? 'paint' : 'erase') : t; },
  setEditing: function (on) {
    this.editing = on; if (this.canvas) this.canvas.classList.toggle('editing', on); this.emit('editing', on);
    if (!on) { this.brushPos = null; this.stroke = null; }
  },
  pointer: function (e, kind) {
    var tank = this.canvas; if (!tank) return;
    this.brushPos = [e.clientX, e.clientY]; this.altHeld = !!e.altKey;
    if (kind === 'down' && e.button === 0) {
      this.undo.push(new Float32Array(this.edits)); if (this.undo.length > 12) this.undo.shift();
      this.stroke = { last: null, tool: this.tool() }; try { tank.setPointerCapture(e.pointerId); } catch (x) { /* synthetic pointer */ }
      this.stamp(e.clientX, e.clientY);
    } else if (kind === 'move' && this.stroke) {
      this.stamp(e.clientX, e.clientY);
    } else if (kind === 'up' && this.stroke) {
      this.stroke = null; try { if (tank.hasPointerCapture(e.pointerId)) tank.releasePointerCapture(e.pointerId); } catch (x) { /* synthetic pointer */ }
      this.saveEdits();
    }
  },
  /** Stamp soft discs from the last point to (x, y) (screen px) into the edits layer. */
  stamp: function (x, y) {
    var p = this.toPhoto(x, y), R = this.R, s = this.stroke, r = Math.max(1, P.bookBrushSize * R / 2), soft = P.bookBrushSoft;
    var px = p[0] * R, py = p[1] * R, from = s.last || [px, py], steps = Math.max(1, Math.ceil(Math.hypot(px - from[0], py - from[1]) / Math.max(1, r / 3)));
    for (var k = 1; k <= steps; k++) this.disc(from[0] + (px - from[0]) * k / steps, from[1] + (py - from[1]) * k / steps, r, soft, s.tool === 'erase');
    s.last = [px, py]; this.maskDirty = true;
  },
  disc: function (cx, cy, r, soft, erase) {
    var W = this.MW, H = this.MH, E = this.edits, core = r * (1 - soft), edge = Math.max(0.5, r - core);
    var x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(W - 1, Math.ceil(cx + r)), y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(H - 1, Math.ceil(cy + r));
    for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) {
      var d = Math.hypot(x - cx, y - cy); if (d > r) continue;
      var t = d <= core ? 1 : 1 - (d - core) / edge; t = t * t * (3 - 2 * t);
      var i = y * W + x;
      if (erase) { if (-t < E[i]) E[i] = -t; } else if (t > E[i]) E[i] = t;
    }
  },
  undoStroke: function () { if (!this.undo.length) return; this.edits = this.undo.pop(); this.maskDirty = true; this.saveEdits(); },
  reset: function () { this.undo.push(new Float32Array(this.edits)); this.edits.fill(0); this.maskDirty = true; this.saveEdits(); },
  /** The edits layer → a small PNG in the config (so a mask travels with a preset / pasted JSON). */
  saveEdits: function () {
    var W = this.MW, H = this.MH, E = this.edits, any = false;
    for (var i = 0; i < E.length; i++) if (E[i] !== 0) { any = true; break; }
    if (!any) { this.editsUrl = ''; P.bookMask = ''; this.emit('edits', ''); return; }
    var c = document.createElement('canvas'); c.width = W; c.height = H; var cx = c.getContext('2d'), im = cx.createImageData(W, H), d = im.data;
    for (var j = 0; j < E.length; j++) { var v = Math.round(128 + E[j] * 127); d[j * 4] = d[j * 4 + 1] = d[j * 4 + 2] = v; d[j * 4 + 3] = 255; }
    cx.putImageData(im, 0, 0);
    this.editsUrl = P.bookMask = c.toDataURL('image/png'); this.emit('edits', this.editsUrl);
  },
  /** After P changes (preset, pasted JSON): load its brush edits if they differ from what is shown. */
  syncFromP: function () {
    var self = this, url = P.bookMask || '';
    if (!this.edits || url === this.editsUrl) { this.maskDirty = true; return; }
    this.editsUrl = url;
    if (!url) { this.edits.fill(0); this.maskDirty = true; return; }
    var im = new Image();
    im.onload = function () {
      var c = document.createElement('canvas'); c.width = self.MW; c.height = self.MH; var cx = c.getContext('2d');
      cx.drawImage(im, 0, 0, self.MW, self.MH); var d = cx.getImageData(0, 0, self.MW, self.MH).data;
      for (var i = 0; i < self.edits.length; i++) self.edits[i] = (d[i * 4] - 128) / 127;
      self.maskDirty = true;
    };
    im.src = url;
  },
  /** The final mask (pages, spine band, brush) as a full-resolution PNG data URL — for production. */
  exportMask: function () {
    if (this.maskDirty) this.rebuildMask();
    var c = document.createElement('canvas'); c.width = this.D.W; c.height = this.D.H; var cx = c.getContext('2d');
    cx.fillStyle = '#000'; cx.fillRect(0, 0, c.width, c.height); cx.drawImage(this.maskC, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  },
};

var bookBus = createEmitter();
Book.on = bookBus.on; Book.off = bookBus.off; Book.emit = bookBus.emit;
