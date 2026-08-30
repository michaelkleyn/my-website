// Journal — the compiled object (boulder, notebook layers, page-turn rocks) as DOM over the pond, an obstacle for the
// simulation, and the page-turn player. The school (for the world origin) and the drawings are injected.
import { P } from './config.js';
import { createEmitter } from './emitter.js';
import { Water } from './water.js';
import { clamp } from './util.js';

var school = null;      // injected by init({ school })
var Drawings = null;    // injected by setDrawings()

export var Journal = {
  D: null, root: null, anim: null, under: null, nb: null, pageLayer: null, propEls: {}, props: [], PAD: [0, 0], FW: 0, FH: 0,
  seq: null, cur: 0, playing: false, dir: 1, t: 0, last: 0, arranging: false, arrSel: null, obstacleDirty: true, ready: false,

  init: function (D, opts) {
    opts = opts || {}; school = opts.school || school;
    if (!D) return;
    this.D = D; var self = this;
    this.root = opts.root || this.root;
    this.anim = document.createElement('div'); this.anim.className = 'journal-anim'; this.root.appendChild(this.anim);
    this.under = document.createElement('div'); this.under.className = 'junder'; this.under.style.position = 'absolute'; this.under.style.width = D.W + 'px'; this.under.style.height = D.H + 'px'; this.under.style.zIndex = '0'; this.anim.appendChild(this.under);
    this.nb = document.createElement('div'); this.nb.className = 'jnb'; this.nb.style.position = 'absolute'; this.nb.style.width = D.W + 'px'; this.nb.style.height = D.H + 'px'; this.nb.style.zIndex = '1'; this.anim.appendChild(this.nb);
    D.notebook.forEach(function (p) {
      var el = document.createElement('div'); el.className = 'jlayer' + (p.blend === 'multiply' ? ' multiply' : ''); el.style.zIndex = String(p.z);
      el.style.transform = 'translate(' + p.bbox[0] + 'px,' + p.bbox[1] + 'px)'; el.style.width = p.bbox[2] + 'px'; el.style.height = p.bbox[3] + 'px';
      var im = document.createElement('img'); im.src = p.src; im.alt = p.name; im.draggable = false; el.appendChild(im); self.nb.appendChild(el);
    });
    this.pageLayer = document.createElement('div'); this.pageLayer.style.position = 'absolute'; this.pageLayer.style.inset = '0'; this.pageLayer.style.zIndex = '50'; this.nb.appendChild(this.pageLayer);
    this.props = D.props.map(function (p) { return JSON.parse(JSON.stringify(p)); });
    this.applyProps(P.journalProps);
    this.props.forEach(function (p) {
      var el = document.createElement('div'); el.className = 'jprop' + (p.action ? ' button' : ''); el.dataset.name = p.name; el.style.zIndex = p.layer === 'under' ? '0' : '80';
      var im = document.createElement('img'); im.src = p.src; im.alt = p.name; im.draggable = false; el.appendChild(im);
      (p.layer === 'under' ? self.under : self.nb).appendChild(el); self.propEls[p.name] = el;
      el.addEventListener('click', function () { if (self.arranging) return; if (p.action === 'forward') self.turn(1); else if (p.action === 'back') self.turn(-1); });
      var lx, ly;
      el.addEventListener('pointerdown', function (e) { if (!self.arranging || e.button !== 0) return; e.preventDefault(); e.stopPropagation(); self.arrSel = p; el.setPointerCapture(e.pointerId); lx = e.clientX; ly = e.clientY; self.fillArr(); });
      el.addEventListener('pointermove', function (e) { if (!self.arranging || self.arrSel !== p || !el.hasPointerCapture(e.pointerId)) return; var k = P.journalScale; p.x = Math.round(p.x + (e.clientX - lx) / k); p.y = Math.round(p.y + (e.clientY - ly) / k); lx = e.clientX; ly = e.clientY; self.propsChanged(); });
    });
    // drag the notebook to move the whole object
    var nx, ny;
    this.nb.addEventListener('pointerdown', function (e) { if (!self.arranging || e.button !== 0 || e.target.closest('.jprop')) return; e.preventDefault(); self.arrSel = 'journal'; self.nb.setPointerCapture(e.pointerId); nx = e.clientX; ny = e.clientY; self.fillArr(); });
    this.nb.addEventListener('pointermove', function (e) { if (!self.arranging || self.arrSel !== 'journal' || !self.nb.hasPointerCapture(e.pointerId)) return; P.journalX += (e.clientX - nx) / school.fullW; P.journalY += (e.clientY - ny) / school.H; nx = e.clientX; ny = e.clientY; self.layout(); refreshInputs(); });
    this.seq = D.sequences[0];
    this.ready = true;
    this.refit(); this.layout(); this.showIdle();
  },
  applyProps: function (list) {
    var self = this; (list || []).forEach(function (q) { var p = self.props.filter(function (x) { return x.name === q.name; })[0]; if (p) { p.x = q.x; p.y = q.y; p.s = q.s; p.r = q.r; } });
  },
  exportProps: function () { return this.props.map(function (p) { return { name: p.name, x: p.x, y: p.y, s: p.s, r: p.r }; }); },
  propsChanged: function () { P.journalProps = this.exportProps(); this.placeProps(); this.refit(); this.fillArr(); this.emit('props'); if (Drawings) Drawings.markDirty(); },
  refit: function () {
    var D = this.D, minX = 0, minY = 0, maxX = D.W, maxY = D.H, m = 24;
    this.props.forEach(function (p) { var e = Math.hypot(p.w * p.s, p.h * p.s) / 2; minX = Math.min(minX, p.x - e); minY = Math.min(minY, p.y - e); maxX = Math.max(maxX, p.x + e); maxY = Math.max(maxY, p.y + e); });
    this.PAD = [Math.ceil(Math.max(0, -minX) + m), Math.ceil(Math.max(0, -minY) + m)];
    this.FW = Math.ceil(maxX + this.PAD[0] + m); this.FH = Math.ceil(maxY + this.PAD[1] + m);
    this.anim.style.width = this.FW + 'px'; this.anim.style.height = this.FH + 'px';
    this.under.style.left = this.nb.style.left = this.PAD[0] + 'px'; this.under.style.top = this.nb.style.top = this.PAD[1] + 'px';
    this.placeProps(); this.layout();
  },
  placeProps: function () {
    var self = this;
    this.props.forEach(function (p) { var el = self.propEls[p.name]; if (!el) return; var w = p.w * p.s, h = p.h * p.s; el.style.width = w + 'px'; el.style.height = h + 'px'; el.style.transform = 'translate(' + (p.x - w / 2) + 'px,' + (p.y - h / 2) + 'px) rotate(' + p.r + 'deg)'; });
  },
  /** top-left of the object in tank px */
  origin: function () { var k = P.journalScale; return [school.ox + P.journalX * school.fullW - this.FW * k / 2, school.oy + P.journalY * school.H - this.FH * k / 2]; },
  layout: function () {
    if (!this.ready) return;
    var o = this.origin();
    this.anim.style.transform = 'translate(' + o[0] + 'px,' + o[1] + 'px) scale(' + P.journalScale + ')';
    this.root.style.display = P.journalOn ? '' : 'none';
    this.obstacleDirty = true;
  },
  /** Rasterise the under-layer props (the boulder) into the water grid → obstacle mask. */
  rebuildObstacle: function () {
    this.obstacleDirty = false;
    if (!this.ready || !P.journalOn || !Water.cols) { Water.setObstacle(null); return; }
    var cols = Water.cols, rows = Water.rows, cell = Water.cell, c = document.createElement('canvas'); c.width = cols; c.height = rows;
    var ctx = c.getContext('2d'), o = this.origin(), k = P.journalScale, self = this, any = false;
    this.props.forEach(function (p) {
      if (p.layer !== 'under') return; var el = self.propEls[p.name], im = el && el.querySelector('img'); if (!im || !im.complete || !im.naturalWidth) return;
      any = true;
      var cx = o[0] - school.ox + (self.PAD[0] + p.x) * k, cy = o[1] - school.oy + (self.PAD[1] + p.y) * k, w = p.w * p.s * k, h = p.h * p.s * k;
      ctx.save(); ctx.translate((cx / cell) + 1, (cy / cell) + 1); ctx.rotate(p.r * Math.PI / 180); ctx.drawImage(im, -w / 2 / cell, -h / 2 / cell, w / cell, h / cell); ctx.restore();
    });
    if (!any) { Water.setObstacle(null); this.obstacleDirty = true; return; }   // image not decoded yet — try again next frame
    var d = ctx.getImageData(0, 0, cols, rows).data, mask = new Uint8Array(cols * rows);
    for (var i = 0; i < mask.length; i++) mask[i] = d[i * 4 + 3] > 90 ? 1 : 0;
    Water.setObstacle(mask);
  },
  // ---- page turn
  showStep: function (i) {
    var self = this, D = this.D, poolIdx = 0; this.cur = i; this.pageLayer.innerHTML = '';
    this.seq.steps[i].items.slice().sort(function (a, b) { return a.z - b.z; }).forEach(function (inst) {
      var it = D.items[inst.item]; if (!it) return;
      var el = document.createElement('div'); el.className = 'jpage'; var w = it.w * inst.s, h = it.h * inst.s;
      el.style.width = w + 'px'; el.style.height = h + 'px'; el.style.zIndex = String(100 + inst.z); el.style.opacity = inst.o;
      el.style.transform = 'translate(' + (inst.x - w / 2) + 'px,' + (inst.y - h / 2) + 'px) rotate(' + inst.r + 'deg) scale(' + (inst.mx ? -1 : 1) + ',' + (inst.my ? -1 : 1) + ')';
      var sp = (Drawings && Drawings.journalDrawn()) ? Drawings.poseSprites[inst.item] : null;
      var pd = sp ? Drawings.pool[poolIdx] : null;
      if (pd && pd.ok) {   // hatched page that the spotlight can reveal
        poolIdx++;
        pd.el.style.cssText = el.style.cssText; pd.el.style.position = 'absolute';
        pd.setSources(sp, Drawings.poseImgs[inst.item] || pd.img);
        self.pageLayer.appendChild(pd.el);
        return;
      }
      if (sp) { var cv = document.createElement('canvas'); cv.width = sp.width; cv.height = sp.height; cv.getContext('2d').drawImage(sp, 0, 0); cv.style.cssText = 'display:block;width:100%;height:100%;'; el.appendChild(cv); }
      else { var im = document.createElement('img'); im.src = it.src; im.alt = inst.item; el.appendChild(im); }
      self.pageLayer.appendChild(el);
    });
  },
  showIdle: function () { this.pageLayer.innerHTML = ''; },
  turn: function (d) {
    if (this.playing || !this.seq) return;
    this.dir = d; this.playing = true; this.t = 0; this.last = performance.now();
    var el = this.propEls[d > 0 ? 'rock-right' : 'rock-left']; if (el) { el.classList.add('pressed'); setTimeout(function () { el.classList.remove('pressed'); }, 160); }
    this.showStep(d > 0 ? 0 : this.seq.steps.length - 1);
  },
  tick: function (now) {
    if (!this.playing) return;
    this.t += now - this.last; this.last = now;
    var d = this.seq.steps[this.cur].dur;
    if (this.t >= d) { this.t -= d; var next = this.cur + this.dir; if (next < 0 || next >= this.seq.steps.length) { this.playing = false; this.showIdle(); return; } this.showStep(next); }
  },
  // ---- arrange UI
  setArrange: function (on) { this.arranging = on; this.root.classList.toggle('arrange', on); this.emit('arrange', on); if (on && !this.arrSel) this.arrSel = this.props[0]; this.fillArr(); },
  /** The panel mirrors the selection; it listens to 'select'. */
  fillArr: function () { if (!this.arranging) return; var sel = this.arrSel; if (!sel) return; this.emit('select', sel); },

};

var journalBus = createEmitter();
Journal.on = journalBus.on; Journal.off = journalBus.off; Journal.emit = journalBus.emit;
Journal.setDrawings = function (d) { Drawings = d; };
