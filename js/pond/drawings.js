// Drawings — the rock, the page-turn rocks and the journal as crosshatch drawings painted by p5.brush from hatch
// recipes, with the real image revealed through a dissolving spotlight under the pointer (one WebGL2 program each).
import { brush } from './brush.js';
import { P } from './config.js';
import { Painter } from './painter.js';
import { Journal } from './journal.js';
import { Book } from './book.js';
import { clamp } from './util.js';

export var DrawShader = {
  vs: '#version 300 es\nin vec2 p; out vec2 v; void main(){ v = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }',
  fs: '#version 300 es\nprecision highp float; in vec2 v; out vec4 o; uniform sampler2D hatch; uniform sampler2D orig; uniform vec2 mouse; uniform float radius; uniform float feather; uniform float dissolve; uniform float reveal; uniform float t; uniform float aspect;\n' +
    'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n' +
    'float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); float a = hash(i), b = hash(i + vec2(1, 0)), c = hash(i + vec2(0, 1)), d = hash(i + vec2(1, 1)); return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }\n' +
    'float fbm(vec2 p){ return noise(p) * 0.55 + noise(p * 2.3 + 1.7) * 0.3 + noise(p * 5.1 + 4.2) * 0.15; }\n' +
    'void main(){ vec2 uv = vec2(v.x, 1.0 - v.y); vec2 d = (uv - mouse) * vec2(1.0, 1.0 / aspect); float dist = length(d);\n' +
    '  float n = fbm(uv * vec2(14.0, 14.0 / aspect) + vec2(t * 0.12, -t * 0.09));\n' +
    '  float edge = (radius - dist) / max(feather, 0.002) + (n - 0.5) * dissolve * 2.0;\n' +
    '  float m = clamp(edge, 0.0, 1.0) * reveal;\n' +
    '  o = mix(texture(hatch, uv), texture(orig, uv), m); }',
};

/** One hatched drawing with a spotlight: a container element holding the real image and a WebGL canvas that blends the
 *  painted crosshatch with the original under the pointer. */
export function Drawing(opts) {
  this.name = opts.name; this.el = opts.el; this.img = opts.img; this.recipe = opts.recipe; this.enabled = opts.enabled; this.onActive = opts.onActive || function () {};
  this.displayScale = opts.displayScale || function () { return 1; };   // recipe px → screen px, so hatch spacing can be set in screen px
  this.canvas = null; this.gl = null; this.prog = null; this.texH = null; this.texO = null; this.u = {}; this.ok = false; this.sprite = null; this.dirty = true;
  this.reveal = 0; this.hover = false; this.mouse = [0.5, 0.5]; this.rectW = 1; this.origUploaded = false; this.needsFrame = false; this.active = false;
  var c = document.createElement('canvas'); c.width = this.recipe ? this.recipe.w : 2; c.height = this.recipe ? this.recipe.h : 2; c.style.cssText = 'display:none;width:100%;height:100%;position:absolute;left:0;top:0;';
  this.el.appendChild(c); this.canvas = c;
  var gl = c.getContext('webgl2', { premultipliedAlpha: true, alpha: true }); if (!gl) return;
  function sh(type, src) { var h = gl.createShader(type); gl.shaderSource(h, src); gl.compileShader(h); if (!gl.getShaderParameter(h, gl.COMPILE_STATUS)) { console.error(gl.getShaderInfoLog(h)); return null; } return h; }
  var v = sh(gl.VERTEX_SHADER, DrawShader.vs), f = sh(gl.FRAGMENT_SHADER, DrawShader.fs); if (!v || !f) return;
  var prog = gl.createProgram(); gl.attachShader(prog, v); gl.attachShader(prog, f); gl.linkProgram(prog); if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.error(gl.getProgramInfoLog(prog)); return; }
  gl.useProgram(prog);
  var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  var loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  var self = this; ['hatch', 'orig', 'mouse', 'radius', 'feather', 'dissolve', 'reveal', 't', 'aspect'].forEach(function (n) { self.u[n] = gl.getUniformLocation(prog, n); });
  function tex() { var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); return t; }
  this.texH = tex(); this.texO = tex(); this.gl = gl; this.prog = prog; this.ok = true;
}
Drawing.prototype.upload = function (t, src) { var gl = this.gl; gl.bindTexture(gl.TEXTURE_2D, t); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src); };
/** Paint a crosshatch recipe with p5.brush on the shared paint canvas → RGBA canvas (white knocked out, paper body added).
 *  displayScale = recipe px → screen px, so hatch spacing and weight come out in screen pixels. */
export function paintRecipe(h, displayScale, opt) {
  if (!Painter.ok) return null;
  opt = opt || {};
  var gl = Painter.gl, s = Math.min(1, (gl.width - 40) / h.w, (gl.height - 40) / h.h);
  var ds = Math.max(0.02, displayScale * s), k = 1 / ds, wgt = clamp(P.rockWeight * 0.35 * k, 0.3, 4) * (opt.weight || 1);
  var spacingMul = P.rockSpacing * (opt.spacing || 1), angleOff = P.rockAngle + (opt.angleOffset || 0), body = opt.body === false ? 0 : P.rockBody;
  brush.clear();
  brush.push(); brush.translate(-gl.width / 2, -gl.height / 2); brush.translate(20, 20); brush.scale(s);
  brush.noFill(); brush.noStroke(); brush.noField(); brush.noHatch();
  var nb = Math.min(P.rockBands, h.bands.length);
  for (var i = 0; i < nb; i++) {
    var b = h.bands[i];
    brush.hatchStyle(P.rockBrush, P.rockInk, wgt * (1 + 0.12 * i));
    brush.hatch(Math.max(2, b.dist * spacingMul * k * 0.5), b.angle + angleOff, { rand: P.rockRand });
    b.polys.forEach(function (poly) { brush.polygon(poly); });
    brush.noHatch();
  }
  brush.set(P.rockBrush, P.rockInk, wgt * 1.1); (h.lines || []).forEach(function (l) { brush.spline(l, 0.2); });
  if (h.outline && h.outline.length > 2) {
    brush.wiggle(1); brush.set(P.rockBrush, P.rockInk, wgt * 1.5);
    brush.beginShape(0.1); h.outline.forEach(function (q) { brush.vertex(q[0], q[1]); }); brush.endShape(true); brush.noField();
  }
  brush.noStroke(); brush.pop(); brush.render();
  var w = Math.round(h.w * s), hh = Math.round(h.h * s);
  var c = document.createElement('canvas'); c.width = w; c.height = hh; var ctx = c.getContext('2d');
  ctx.drawImage(gl, 20, 20, w, hh, 0, 0, w, hh); Painter.knockOutWhite(ctx, 0, 0, w, hh);
  if (body > 0 && h.outline && h.outline.length > 2) {
    var c2 = document.createElement('canvas'); c2.width = w; c2.height = hh; var x2 = c2.getContext('2d');
    x2.fillStyle = 'rgba(251,249,244,' + body + ')'; x2.beginPath();
    h.outline.forEach(function (q, i) { if (i) x2.lineTo(q[0] * s, q[1] * s); else x2.moveTo(q[0] * s, q[1] * s); }); x2.closePath(); x2.fill();
    x2.drawImage(c, 0, 0); c = c2;
  }
  return c;
}
/** 'light' | 'dark' — the page the drawings are sitting on. */
function themeName() { return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'; }

/** Paint this drawing for one theme into its cache. Night = the pen work only: no paper body, no cast
 *  shadow. Painting a recipe is expensive (p5.brush hatches every band), so it is cached per theme and
 *  a theme flip becomes a texture swap — see Drawings.setTheme / the idle prewarm in paintDirty. */
Drawing.prototype.paintFor = function (theme) {
  var dark = theme === 'dark';
  var c = paintRecipe(this.recipe, this.displayScale(), dark ? { body: false } : null); if (!c) return null;
  if (!dark && this.shadowRecipe && P.shadowOn && P.shadowStrength > 0) {
    var sh = paintRecipe(this.shadowRecipe, this.displayScale(), { spacing: P.shadowSpacing, angleOffset: P.shadowAngle - 30, body: false, weight: 0.9 });
    if (sh) {
      var out = document.createElement('canvas'); out.width = c.width; out.height = c.height; var ctx = out.getContext('2d');
      var s = c.width / this.recipe.w, cx = c.width / 2, cy = c.height / 2;
      ctx.globalAlpha = P.shadowStrength;
      ctx.translate(cx + P.shadowX * s, cy + P.shadowY * s); ctx.scale(P.shadowSpread, P.shadowSpread); ctx.translate(-cx, -cy);
      ctx.drawImage(sh, 0, 0); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
      ctx.drawImage(c, 0, 0); c = out;
    }
  }
  (this.cache || (this.cache = {}))[theme] = c;
  return c;
};
/** Show an already-painted sprite: a texture upload, cheap enough to do mid-click. */
Drawing.prototype.show = function (c) {
  this.sprite = c; this.dirty = false;
  if (this.ok) { this.upload(this.texH, c); this.needsFrame = true; }
};
Drawing.prototype.paint = function () {
  var theme = themeName(), c = (this.cache && this.cache[theme]) || this.paintFor(theme);
  if (c) this.show(c);
};
/** Swap what this drawing shows (used by the page-turn pool): a hatched sprite and the real image it hides. */
Drawing.prototype.setSources = function (sprite, img) {
  if (!this.ok) return;
  this.sprite = sprite; this.dirty = false; this.img = img;
  this.canvas.width = sprite.width; this.canvas.height = sprite.height;
  this.upload(this.texH, sprite);
  if (img.complete && img.naturalWidth) { this.upload(this.texO, img); this.origUploaded = true; } else this.origUploaded = false;
  this.needsFrame = true;
};
Drawing.prototype.setPointer = function (x, y) {
  var r = this.el.getBoundingClientRect(); if (!r.width) return;
  this.rectW = r.width; this.mouse = [(x - r.left) / r.width, (y - r.top) / r.height];
  var pad = P.spotRadius; this.hover = x > r.left - pad && x < r.right + pad && y > r.top - pad && y < r.bottom + pad;
};
Drawing.prototype.tick = function (now, dt) {
  var drawn = !!(this.enabled() && this.sprite && this.ok);
  if (drawn !== this.active) { this.active = drawn; this.onActive(drawn); }
  this.img.style.display = drawn ? 'none' : ''; this.canvas.style.display = drawn ? '' : 'none';
  if (!drawn) return;
  if (!this.origUploaded && this.img.complete && this.img.naturalWidth) { this.upload(this.texO, this.img); this.origUploaded = true; this.needsFrame = true; }
  var target = this.hover && this.origUploaded ? 1 : 0, before = this.reveal;
  this.reveal += (target - this.reveal) * Math.min(1, dt * P.spotSpeed); if (Math.abs(this.reveal - target) < 0.002) this.reveal = target;
  if (this.needsFrame || this.reveal > 0 || before > 0) this.render(now / 1000);
};
Drawing.prototype.render = function (tSec) {
  var gl = this.gl, u = this.u, w = this.canvas.width, h = this.canvas.height; this.needsFrame = false;
  gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.useProgram(this.prog);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texH); gl.uniform1i(u.hatch, 0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.texO); gl.uniform1i(u.orig, 1);
  gl.uniform2f(u.mouse, this.mouse[0], this.mouse[1]); gl.uniform1f(u.radius, P.spotRadius / this.rectW); gl.uniform1f(u.feather, P.spotFeather / this.rectW);
  gl.uniform1f(u.dissolve, P.spotDissolve); gl.uniform1f(u.reveal, this.reveal); gl.uniform1f(u.t, tSec); gl.uniform1f(u.aspect, w / h);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
};

/** All the drawings on the journal object: the boulder, the two arrow rocks, and the notebook as one flattened drawing. */
export var Drawings = {
  items: [],
  init: function () {
    var self = this, D = Journal.D; if (!D) return;
    Journal.props.forEach(function (p) {
      if (!p.hatch) return;
      var el = Journal.propEls[p.name], img = el && el.querySelector('img'); if (!img) return;
      self.items.push(new Drawing({ name: p.name, el: el, img: img, recipe: p.hatch, enabled: p.layer === 'under' ? function () { return P.rockOn; } : function () { return P.rockOnArrows; },
        displayScale: function () { return P.journalScale * p.s * (Book.active() ? Book.fit.s : 1); } }));
    });
    if (D.journalHatch) {
      var jh = D.journalHatch, el = document.createElement('div'); el.className = 'jlayer jhatch'; el.style.zIndex = '6';
      el.style.transform = 'translate(0px,0px)'; el.style.width = jh.w + 'px'; el.style.height = jh.h + 'px';
      var im = document.createElement('img'); im.src = jh.src; im.alt = 'journal'; im.draggable = false; el.appendChild(im);
      Journal.nb.appendChild(el);
      var realLayers = Array.prototype.filter.call(Journal.nb.querySelectorAll('.jlayer'), function (l) { return !l.classList.contains('jhatch'); });   // shadow included: the drawing hatches its own
      // page-turn pool: two reusable drawings that take each step's pose (hatched sprite + real image) as textures
      Object.keys(D.items).forEach(function (n) { var im2 = new Image(); im2.src = D.items[n].src; self.poseImgs[n] = im2; });
      for (var k = 0; k < 2; k++) {
        var pel = document.createElement('div'); pel.className = 'jpage';
        var pim = document.createElement('img'); pim.alt = 'page'; pim.draggable = false; pel.appendChild(pim);
        self.pool.push(new Drawing({ name: 'pose' + k, el: pel, img: pim, recipe: null, enabled: function () { return P.rockOnJournal; } }));
      }
      var jd = new Drawing({ name: 'journal', el: el, img: im, recipe: jh.recipe, enabled: function () { return P.rockOnJournal; }, displayScale: function () { return P.journalScale * (Book.active() ? Book.fit.s : 1); },
        onActive: function (on) { realLayers.forEach(function (l) { l.style.visibility = on ? 'hidden' : ''; }); el.style.display = on ? '' : 'none'; } });
      jd.shadowRecipe = jh.shadow || null; self.items.push(jd);
      el.style.display = 'none';
    }
    this.setTheme();   // bind poseSprites to this theme's map
  },
  poseSprites: {}, poseCache: {}, poseImgs: {}, pool: [], lastPointer: null,   // poseSprites = poseCache[current theme]
  /** The page-turn poses drawn the same way (one sprite each), used while the journal is drawn. */
  /** One page-turn pose, painted for a theme into that theme's map. */
  paintPose: function (name, theme) {
    var map = this.poseCache[theme] || (this.poseCache[theme] = {});
    map[name] = paintRecipe(Journal.D.items[name].hatch, P.journalScale * 1.2 * (Book.active() ? Book.fit.s : 1), theme === 'dark' ? { body: false } : null);
  },
  /** One paint per frame: what's showing first, then the other theme's copies so a toggle costs nothing. */
  paintDirty: function () {
    var theme = themeName(), other = theme === 'dark' ? 'light' : 'dark', i, j, names;
    for (i = 0; i < this.items.length; i++) { var d = this.items[i]; if (d.dirty && d.enabled()) { d.paint(); return true; } }
    if (P.rockOnJournal && Journal.D) {
      names = Object.keys(Journal.D.items);
      for (j = 0; j < names.length; j++) if (Journal.D.items[names[j]].hatch && !this.poseSprites[names[j]]) { this.paintPose(names[j], theme); return true; }
    }
    for (i = 0; i < this.items.length; i++) { var d2 = this.items[i]; if (d2.recipe && d2.enabled() && !(d2.cache && d2.cache[other])) { d2.paintFor(other); return true; } }
    if (P.rockOnJournal && Journal.D) {
      var om = this.poseCache[other] || (this.poseCache[other] = {});
      names = Object.keys(Journal.D.items);
      for (j = 0; j < names.length; j++) if (Journal.D.items[names[j]].hatch && !om[names[j]]) { this.paintPose(names[j], other); return true; }
    }
    return false;
  },
  /** Theme flip: show each cached sprite (a texture upload), repaint only what the prewarm hasn't reached. */
  setTheme: function () {
    var theme = themeName();
    this.poseSprites = this.poseCache[theme] || (this.poseCache[theme] = {});
    this.items.forEach(function (d) { var c = d.cache && d.cache[theme]; if (c) d.show(c); else d.dirty = true; });
  },
  markDirty: function () {
    this.items.forEach(function (d) { d.dirty = true; d.cache = null; });
    this.poseCache = {}; this.poseSprites = this.poseCache[themeName()] = {};
  },
  journalDrawn: function () { var j = this.items.filter(function (d) { return d.name === 'journal'; })[0]; return !!(j && j.active); },
  setPointer: function (x, y) { this.lastPointer = [x, y]; },
  tick: function (now, dt) {
    var lp = this.lastPointer;   // re-evaluate every frame: the journal (and a turning page) can move under a still pointer
    this.items.forEach(function (d) { if (lp) d.setPointer(lp[0], lp[1]); d.tick(now, dt); });
    this.pool.forEach(function (d) { if (!d.el.isConnected || !d.sprite) return; if (lp) d.setPointer(lp[0], lp[1]); d.tick(now, dt); });
  },
};
