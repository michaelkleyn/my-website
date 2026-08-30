// Designer — the visitor-facing "Leave a fish" card: a live painted preview, a few honest controls, a name, release.
import { P } from '../config.js';
import { Painter } from '../painter.js';
import { DESIGN_STYLES, normalizeDesign } from '../design.js';
import { Residents } from '../residents.js';
import { PondStore } from '../store.js';
import { Visitors } from './visitors-ui.js';
import { createEmitter } from '../emitter.js';
import { rand, mixHex, cleanName } from '../util.js';

var root = typeof document !== 'undefined' ? document : null, school = null;
var $ = function (s) { return root.querySelector(s); };

export var SWATCHES = {
  body: ['#fff1e8', '#ffd4c4', '#ff9878', '#ff5722', '#ffd166', '#f6efe6', '#9dd1e3', '#78c0e0', '#c9d3da', '#2b3a48'],
  mark: ['#ff5722', '#c2472a', '#ff7f5c', '#2b2b2b', '#ffb020', '#3f8fb5', '#1f4f6b', '#8a3d22'],
  ink: ['#2b3a48', '#1b2631', '#4a4a4a', '#3d5166', '#1f4f6b', '#5b3a29', '#7a2f2f', '#2f5d50'],
};

export var Designer = {
  el: null, d: null, name: '', timer: 0, open: false, body: '#fff1e8', mark: '#ff5722', ink: '#2b3a48',
  init: function (opts) {
    opts = opts || {}; root = opts.root || root; school = opts.school || school;
    var self = this;
    this.el = $('#designer');
    this.d = this.random();
    $('#btn-leave').addEventListener('click', function () { self.show(); });
    $('#fd-close').addEventListener('click', function () { self.hide(); });
    this.el.addEventListener('click', function (e) { if (e.target === self.el) self.hide(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && self.open) self.hide(); });
    $('#fd-shuffle').addEventListener('click', function () { self.d.seed = Math.floor(Math.random() * 10000); self.changed(); });
    $('#fd-name').addEventListener('input', function () { self.name = this.value; });
    $('#fd-name').addEventListener('keydown', function (e) { if (e.key === 'Enter') self.release(); });
    $('#fd-release').addEventListener('click', function () { self.release(); });
  },
  /** A pleasant starting point, so the card never opens on a blank. */
  random: function (styleToo) {
    var pick = function (a) { return a[Math.floor(Math.random() * a.length)]; };
    var style = styleToo ? pick(DESIGN_STYLES) : 'koi';
    this.body = pick(SWATCHES.body.slice(0, 6)); this.mark = pick(SWATCHES.mark.slice(0, 4)); this.ink = pick(SWATCHES.ink);
    var d = { style: style, len: rand(0.3, 0.7), belly: rand(0.3, 0.7), tail: rand(0.3, 0.7), fin: rand(0.3, 0.7), size: rand(0.3, 0.75),
              pattern: style === 'koi' ? pick(['kohaku', 'sanke', 'tancho', 'showa', 'plain', 'asagi', 'bekko']) : 'plain',
              markScale: rand(0.9, 1.5), markDensity: rand(0.8, 1.3), seed: Math.floor(Math.random() * 10000) };
    d.colors = this.colorsFor(style, style === 'koi' ? this.body : this.ink, this.mark);
    return normalizeDesign(d);
  },
  /** The 5-colour palette row [wash, glaze, line, mark, sumi] from the one or two colours a visitor picks. */
  colorsFor: function (style, body, mark) {
    if (style === 'koi') return [body, mixHex(body, mark, 0.15), mixHex(mark, '#2b1a10', 0.45), mark, '#2b2b2b'];
    return [body, body, mixHex(body, '#000000', 0.35), body, body];
  },
  show: function () {
    this.open = true; this.el.hidden = false; $('#fd-err').textContent = '';
    $('#fd-name').value = this.name; $('.fd-preview').style.background = P.paper;
    Visitors.refresh(); this.build(); this.changed(true);
  },
  hide: function () { this.open = false; this.el.hidden = true; clearTimeout(this.timer); },
  build: function () {
    var self = this, d = this.d, box = $('#fd-controls'); box.innerHTML = '';
    var sec = function (t) { var h = document.createElement('div'); h.className = 'fd-section'; h.textContent = t; box.appendChild(h); };
    var chips = function (opts, cur, on) {
      var w = document.createElement('div'); w.className = 'fd-chips';
      opts.forEach(function (o) { var b = document.createElement('button'); b.type = 'button'; b.className = 'fd-chip' + (o[0] === cur ? ' active' : ''); b.textContent = o[1]; b.addEventListener('click', function () { on(o[0]); }); w.appendChild(b); });
      box.appendChild(w);
    };
    var slider = function (label, key, min, max, step) {
      var row = document.createElement('div'); row.className = 'fd-ctl';
      var l = document.createElement('label'); l.textContent = label; var i = document.createElement('input'); i.type = 'range'; i.min = min; i.max = max; i.step = step; i.value = d[key];
      i.id = 'fd-' + key; l.htmlFor = i.id; i.addEventListener('input', function () { d[key] = parseFloat(i.value); self.changed(); });
      row.appendChild(l); row.appendChild(i); box.appendChild(row);
    };
    var swatches = function (label, list, cur, on) {
      var row = document.createElement('div'); row.className = 'fd-ctl'; var l = document.createElement('label'); l.textContent = label; row.appendChild(l);
      var w = document.createElement('div'); w.className = 'fd-swatches';
      list.forEach(function (c) { var b = document.createElement('button'); b.type = 'button'; b.className = 'fd-swatch' + (c === cur ? ' active' : ''); b.style.background = c; b.title = c; b.setAttribute('aria-label', label + ' ' + c); b.addEventListener('click', function () { on(c); }); w.appendChild(b); });
      var custom = document.createElement('input'); custom.type = 'color'; custom.value = cur; custom.title = 'Any colour'; custom.setAttribute('aria-label', label + ', any colour');
      custom.addEventListener('input', function () { on(custom.value, true); }); w.appendChild(custom);
      row.appendChild(w); box.appendChild(row);
    };
    sec('Style');
    chips([['koi', 'Watercolour koi'], ['minnow', 'Ink minnow'], ['pencil', 'Pencil study']], d.style, function (v) {
      d.style = v; d.colors = self.colorsFor(v, v === 'koi' ? self.body : self.ink, self.mark); self.build(); self.changed();
    });
    sec('Shape');
    slider('Length', 'len', 0, 1, 0.01); slider('Belly', 'belly', 0, 1, 0.01); slider('Tail', 'tail', 0, 1, 0.01); slider('Fins', 'fin', 0, 1, 0.01); slider('Size in pond', 'size', 0, 1, 0.01);
    sec('Colours');
    if (d.style === 'koi') {
      swatches('Body', SWATCHES.body, d.colors[0], function (c, quiet) { self.body = c; d.colors = self.colorsFor('koi', c, d.colors[3]); if (!quiet) self.build(); self.changed(); });
      swatches('Markings', SWATCHES.mark, d.colors[3], function (c, quiet) { self.mark = c; d.colors = self.colorsFor('koi', d.colors[0], c); if (!quiet) self.build(); self.changed(); });
      sec('Markings');
      chips([['plain', 'none'], ['kohaku', 'Kohaku'], ['sanke', 'Sanke'], ['showa', 'Showa'], ['bekko', 'Bekko'], ['tancho', 'Tancho'], ['asagi', 'Asagi']], d.pattern, function (v) { d.pattern = v; self.build(); self.changed(); });
      if (d.pattern !== 'plain') { slider('Patch size', 'markScale', 0.5, 2, 0.05); slider('How many', 'markDensity', 0.3, 2, 0.05); }
    } else {
      swatches('Ink', SWATCHES.ink, d.colors[0], function (c, quiet) { self.ink = c; d.colors = self.colorsFor(d.style, c); if (!quiet) self.build(); self.changed(); });
    }
  },
  changed: function (now) {
    clearTimeout(this.timer); var self = this;
    $('#fd-painting').hidden = false;
    this.timer = setTimeout(function () { self.paint(); }, now ? 0 : 250);
  },
  paint: function () {
    if (!Painter.ok || !this.open) return;
    var self = this;
    if (Painter.painting || !school.atlas) { this.timer = setTimeout(function () { self.paint(); }, 250); return; }   // let the atlas finish first
    var sp = Residents.paint(this.d);
    var c = $('#fd-preview'), ctx = c.getContext('2d');
    var dpr = Math.min(window.devicePixelRatio || 1, 2), k = Math.min(270 / sp.cellW, 190 / sp.cellH);
    c.width = Math.round(sp.cellW * k * dpr); c.height = Math.round(sp.cellH * k * dpr);
    c.style.width = Math.round(sp.cellW * k) + 'px'; c.style.height = Math.round(sp.cellH * k) + 'px';
    ctx.drawImage(sp.canvas, 0, 0, c.width, c.height);
    $('#fd-painting').hidden = true;
  },
  release: function () {
    var self = this, btn = $('#fd-release'), err = $('#fd-err');
    var name = cleanName($('#fd-name').value);
    if (!name) { err.textContent = 'Give it a name first.'; $('#fd-name').focus(); return; }
    if (btn.disabled) return;
    btn.disabled = true; err.textContent = '';
    PondStore.leave(name, this.d).then(function (rec) {
      btn.disabled = false;
      school.residents.forEach(function (f) { if (f.res.mine && f.res.id !== rec.id) f.res.gone = true; });   // the earlier one swims off
      rec.mine = true;
      Residents.add(rec, { enter: true });
      Residents.trim();
      self.hide(); self.name = ''; self.d = self.random();
      Visitors.refresh();
      self.emit('status', '“' + rec.name + '” released into the pond.');
    }).catch(function (e) { btn.disabled = false; err.textContent = (e && e.message) || 'The pond is not reachable right now.'; });
  },
};

var designerBus = createEmitter();
Designer.on = designerBus.on; Designer.off = designerBus.off; Designer.emit = designerBus.emit;
