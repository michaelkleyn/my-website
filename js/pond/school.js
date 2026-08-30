// School — boids over sprites: the simulation, the residents, and the frame composition (into the book's world in
// book mode). The panel width is an injected inset; the root gets the .book class.
import { P } from './config.js';
import { Painter } from './painter.js';
import { Water } from './water.js';
import { Book } from './book.js';
import { PondFlow } from './pond-flow.js';
import { Journal } from './journal.js';
import { rand, clamp, wrapAngle } from './util.js';

export var POSE_SEQ = [1, 0, 1, 2];

export function School(canvas, opts) {
  opts = opts || {}; this.insets = opts.insets || { right: 0 }; this.root = opts.root || document.body;
  this.canvas = canvas;
  this.ctx = canvas.getContext('2d');
  this.atlas = null;
  this.fish = [];
  this.residents = [];   // visitor fish: same boids, each with its own painted sprite
  this.W = 0; this.H = 0; this.fullW = 0; this.dpr = 1;
  this.cw = 0; this.ch = 0; this.ox = 0; this.oy = 0;   // canvas size and the world's origin on it (book mode)
  this.target = { x: 0, y: 0 };
  this.retargetIn = 0;
  this.pointer = { x: -1e4, y: -1e4, on: false };
  this.resize();
  this.sync();
  this.retarget();
  for (var i = 0; i < 240; i++) this.step(1 / 30); // let the school form before the first frame
}

School.prototype.resize = function () {
  this.dpr = Math.min(window.devicePixelRatio || 1, 2);
  var panelW = (this.insets && this.insets.right) || 0;
  var oldW = this.W, oldH = this.H;
  this.cw = window.innerWidth; this.ch = window.innerHeight;
  this.root.classList.toggle('book', Book.active());
  if (Book.active()) {   // the world is the page spread of the journal
    Book.layout(this.cw - panelW, this.ch);
    var wr = Book.world; this.ox = wr.x; this.oy = wr.y; this.W = Math.max(64, Math.round(wr.w)); this.H = Math.max(64, Math.round(wr.h)); this.fullW = this.W;
  } else { this.ox = 0; this.oy = 0; this.W = this.cw - panelW; this.H = this.ch; this.fullW = this.cw; }
  this.canvas.width = Math.round(this.cw * this.dpr);
  this.canvas.height = Math.round(this.ch * this.dpr);
  if (oldW && oldH && (oldW !== this.W || oldH !== this.H)) {   // keep everyone where they were, relative to the world
    var kx = this.W / oldW, ky = this.H / oldH;
    this.fish.concat(this.residents || []).forEach(function (f) { f.x *= kx; f.y *= ky; });
  }
  Water.resize(this.fullW, this.H); Journal.obstacleDirty = true;
};
/** screen px → world px */
School.prototype.toWorld = function (x, y) { return [x - this.ox, y - this.oy]; };

School.prototype.spawn = function (i) {
  var f = this.fish[Math.floor(Math.random() * this.fish.length)];
  return {
    x: f ? f.x + rand(-140, 140) : this.W * rand(0.2, 0.8),
    y: f ? f.y + rand(-140, 140) : this.H * rand(0.2, 0.8),
    heading: f ? f.heading + rand(-0.5, 0.5) : rand(-Math.PI, Math.PI),
    speed: P.speed, sizeNorm: Math.random(), variant: i, phase: Math.random(), wander: 0, alpha: 0,
    turn: 0, env: 1, coasting: false, coastT: rand(0, 6), rippleRoll: Math.random(), lastBeat: 0, surfRun: null,
    // per-fish motion personality, scaled live by motionVariety
    mj: { amp: rand(-1, 1), head: rand(-1, 1), len: rand(-1, 1), prof: rand(-1, 1), hz: rand(-1, 1) },
  };
};

/** Match fish count / variants to P without disturbing the ones already swimming. */
School.prototype.sync = function () {
  var n = P.count, nV = clamp(P.variants, 1, 9);
  while (this.fish.length < n) this.fish.push(this.spawn(this.fish.length));
  if (this.fish.length > n) this.fish.length = n;
  for (var i = 0; i < this.fish.length; i++) this.fish[i].variant = i % nV;
};

/** A visitor's fish. Loaded ones slip in beside the school; a newly released one surfaces in open water with a splash. */
School.prototype.spawnResident = function (rec, opts) {
  var f = this.spawn(0);
  f.variant = 0; f.res = rec; f.sprite = null; f.stale = false; f.alpha = 0; f.sizeNorm = rec.design.size; f.spot = 0; f.hover = 0;
  if (opts && opts.enter) {
    var best = null;
    for (var t = 0; t < 24; t++) {
      var x = rand(this.W * 0.2, this.W * 0.8), y = rand(this.H * 0.18, this.H * 0.75), dd = Water.sampleDist(x, y);
      if (!best || dd > best.d) best = { x: x, y: y, d: dd };
      if (dd > P.journalAvoid + 140) break;
    }
    f.x = best.x; f.y = best.y; f.heading = rand(-Math.PI, Math.PI); f.speed = P.speed * 0.6;
    if (P.waterOn) Water.disturb(f.x, f.y, 1.4, 3);
    f.spot = 7;
  }
  return f;
};
School.prototype.findResident = function (id) {
  for (var i = 0; i < this.residents.length; i++) if (this.residents[i].res.id === id && !this.residents[i].res.gone) return this.residents[i];
  return null;
};
/** Point at a resident for a few seconds: a dashed ring, its name, a ripple. */
School.prototype.spotlight = function (id) {
  var f = this.findResident(id); if (!f) return null;
  f.spot = 6; if (P.waterOn) Water.disturb(f.x, f.y, 0.9, 3);
  return f;
};

School.prototype.retarget = function () {
  this.target.x = rand(this.W * 0.15, this.W * 0.85);
  this.target.y = rand(this.H * 0.15, this.H * 0.85);
  this.retargetIn = rand(12, 24);
};

School.prototype.step = function (dt) {
  var fish = this.residents.length ? this.fish.concat(this.residents) : this.fish, n = fish.length;
  var R2 = P.neighborRadius * P.neighborRadius;
  var W = this.W, H = this.H, M = P.edgeMargin;
  var wrap = P.edgeMode === 'wrap';
  this.retargetIn -= dt;
  if (this.retargetIn <= 0) this.retarget();
  var ptr = this.pointer, PR2 = P.mouseRadius * P.mouseRadius, mv = P.motionVariety;

  for (var i = 0; i < n; i++) {
    var f = fish[i];
    var size = P.sizeMin + f.sizeNorm * (P.sizeMax - P.sizeMin);
    var base = P.speed * (1.25 - 0.5 * f.sizeNorm);
    var ax = 0, ay = 0, alx = 0, aly = 0, cx = 0, cy = 0, cnt = 0, sx = 0, sy = 0;
    var sep = P.separationRadius * (0.5 + size / 120), S2 = sep * sep;

    for (var j = 0; j < n; j++) {
      if (j === i) continue;
      var g = fish[j];
      var dx = g.x - f.x, dy = g.y - f.y, d2 = dx * dx + dy * dy;
      if (d2 > R2 || d2 === 0) continue;
      cnt++;
      alx += Math.cos(g.heading); aly += Math.sin(g.heading);
      cx += g.x; cy += g.y;
      if (d2 < S2) { sx -= dx / d2; sy -= dy / d2; }
    }
    if (cnt) {
      ax += (alx / cnt) * P.alignment; ay += (aly / cnt) * P.alignment;
      ax += (cx / cnt - f.x) * P.cohesion; ay += (cy / cnt - f.y) * P.cohesion;
    }
    ax += sx * P.separation; ay += sy * P.separation;

    f.wander += rand(-1, 1) * dt * 2.5; f.wander *= 0.98;
    ax += Math.cos(f.heading + f.wander) * P.wander;
    ay += Math.sin(f.heading + f.wander) * P.wander;

    if (P.roam) { ax += (this.target.x - f.x) * P.roamPull; ay += (this.target.y - f.y) * P.roamPull; }

    if (!wrap) {
      if (f.x < M) ax += (M - f.x) * 1.4;
      if (f.x > W - M) ax -= (f.x - (W - M)) * 1.4;
      if (f.y < M) ay += (M - f.y) * 1.4;
      if (f.y > H - M) ay -= (f.y - (H - M)) * 1.4;
    }

    var nearPtr = false;
    if (ptr.on && P.mouse !== 'none') {
      var pdx = f.x - ptr.x, pdy = f.y - ptr.y, pd2 = pdx * pdx + pdy * pdy;
      if (pd2 < PR2 && pd2 > 1) {
        nearPtr = true;
        var pd = Math.sqrt(pd2), kq = (1 - pd / P.mouseRadius);
        var kk = P.mouse === 'flee' ? 900 * kq : -220 * kq;
        ax += pdx / pd * kk; ay += pdy / pd * kk;
      }
    }

    // steer around the boulder (the journal's obstacle), and never sit inside it
    if (P.journalOn && Water.dist && P.journalAvoid > 0) {
      var od = Water.sampleDist(f.x, f.y), R = P.journalAvoid + size * 0.5;
      if (od < R) {
        var og = Water.distGrad(f.x, f.y), ok = 1 - od / R;
        ax += og[0] * 1600 * ok; ay += og[1] * 1600 * ok;
        if (od < 6) { f.x += og[0] * 6; f.y += og[1] * 6; }
      }
    }

    // Fish turn rather than slide: convert the wish into a bounded heading change.
    var vx = Math.cos(f.heading) * f.speed + ax * dt;
    var vy = Math.sin(f.heading) * f.speed + ay * dt;
    var want = Math.atan2(vy, vx);
    var delta = wrapAngle(want - f.heading);
    var maxTurn = P.turnRate * dt;
    if (delta > maxTurn) delta = maxTurn; else if (delta < -maxTurn) delta = -maxTurn;
    f.heading += delta;
    f.turn += ((dt > 0 ? delta / dt : 0) - f.turn) * Math.min(1, dt * 6); // smoothed angular velocity

    // Burst & coast: beat for a while, then glide with the tail nearly still.
    if (P.coastOn) {
      f.coastT -= dt;
      if (f.coastT <= 0) {
        f.coasting = !f.coasting;
        f.coastT = f.coasting ? P.coastLen * rand(0.6, 1.4) : P.coastEvery * rand(0.5, 1.5);
      }
    } else f.coasting = false;
    f.env += ((f.coasting ? 0.12 : 1) - f.env) * Math.min(1, dt * 3);

    // Tail beat drives a small speed pulse; sharper turns slow the fish down.
    var hz = P.tailHz * (1 + mv * 0.3 * f.mj.hz) * (1.25 - 0.5 * f.sizeNorm);
    f.phase += dt * hz * (0.6 + 0.4 * f.speed / base) * (0.35 + 0.65 * f.env);
    var pulse = 0.85 + 0.3 * Math.max(0, Math.sin(f.phase * Math.PI * 2)) * f.env;
    var fleeBoost = (nearPtr && P.mouse === 'flee') ? 1.6 : 1;
    var targetSpeed = base * pulse * fleeBoost * (0.5 + 0.5 * f.env) * (1 - 0.35 * Math.min(1, Math.abs(delta) / (maxTurn || 1)));
    f.speed += (targetSpeed - f.speed) * Math.min(1, dt * 4);

    f.x += Math.cos(f.heading) * f.speed * dt;
    f.y += Math.sin(f.heading) * f.speed * dt;

    if (wrap) {
      var mw = size;
      if (f.x < -mw) f.x += W + 2 * mw; else if (f.x > W + mw) f.x -= W + 2 * mw;
      if (f.y < -mw) f.y += H + 2 * mw; else if (f.y > H + mw) f.y -= H + 2 * mw;
    }

    var visible = f.res ? (f.sprite && !f.res.gone ? 1 : 0) : (this.atlas ? 1 : 0);
    f.alpha += (visible - f.alpha) * Math.min(1, dt * 1.2);
    if (f.spot > 0) f.spot -= dt;

    // sources: a share of the fish ripple the surface — one pulse per tail beat (none while coasting), and now and then a short surface run
    if (P.waterOn && f.rippleRoll < P.rippleFishPct / 100 && f.alpha > 0.5) {
      var beatIdx = Math.floor(f.phase);
      if (beatIdx !== f.lastBeat) {
        f.lastBeat = beatIdx;
        if (f.env > 0.5 && P.rippleBeat > 0) {
          Water.disturb(f.x - Math.cos(f.heading) * size * 0.45, f.y - Math.sin(f.heading) * size * 0.45,
            P.rippleBeat * 0.55 * (0.5 + 0.5 * f.sizeNorm) * Math.min(1.5, f.speed / base), 2);
        }
      }
      var tnow = performance.now();
      if (!f.surfRun && P.rippleSurfacing > 0 && Math.random() < (P.rippleSurfacing / 100) * dt) f.surfRun = { until: tnow + 2000 * rand(0.7, 1.3) };
      if (f.surfRun) {
        if (tnow > f.surfRun.until) f.surfRun = null;
        else Water.disturb(f.x + Math.cos(f.heading) * size * 0.45, f.y + Math.sin(f.heading) * size * 0.45, P.rippleBeat * 0.12 * dt * 60, 1);
      }
    }
  }
  if (this.residents.length) this.residents = this.residents.filter(function (f) { return !(f.res.gone && f.alpha < 0.02); });
  if (P.waterOn) Water.advance(dt);
};

School.prototype.draw = function () {
  var screen = this.ctx, dpr = this.dpr, book = Book.active();
  var ctx = book ? Book.worldCtx(this.W, this.H, dpr) : screen;
  this.ctx = ctx;   // drawSpine draws through this.ctx
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = book ? '#ffffff' : P.paper;   // on paper, white is the paper
  ctx.fillRect(0, 0, this.fullW, this.H);
  if (P.waterOn && P.pondOn) {
    if (Water.pondDirty && this.atlas && !Painter.painting) Water.paintPond();
    if (Water.pond) {
      var moving = (P.pondFlow > 0 || P.pondSwirl > 0 || P.pondBreathe > 0) ? PondFlow.render(performance.now() / 1000) : null;
      ctx.globalAlpha = P.pondOpacity; ctx.drawImage(moving || Water.pond, 0, 0, this.fullW, this.H); ctx.globalAlpha = 1;
    }
  }
  var atlas = this.atlas;
  if (!atlas && !this.residents.length) { this.ctx = screen; if (book) Book.compose(screen, this); return; }

  var order = (this.residents.length ? this.fish.concat(this.residents) : this.fish).slice().sort(function (a, b) { return a.sizeNorm - b.sizeNorm; });
  var mv = P.motionVariety;
  for (var i = 0; i < order.length; i++) {
    var f = order[i];
    if (f.alpha < 0.01) continue;
    var A = f.res ? f.sprite : atlas;      // a resident carries its own painting
    if (!A) continue;
    var cw = A.cellW, ch = A.cellH;
    var size = P.sizeMin + f.sizeNorm * (P.sizeMax - P.sizeMin);
    var k = size / A.bodyW;                 // atlas px → screen px (drawn body length = size)
    var w = cw * k, h = ch * k;
    var row = f.res ? 0 : f.variant % A.variants;
    var flip = Math.cos(f.heading) < 0;
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(f.heading);
    if (flip) ctx.scale(1, -1);             // keep the belly down when swimming left
    ctx.globalAlpha = f.alpha * (P.alphaFar + (P.alphaNear - P.alphaFar) * f.sizeNorm);
    ctx.globalCompositeOperation = P.blend;

    if (A.poses === 3) {
      var pose = POSE_SEQ[Math.floor(f.phase * 4) & 3];
      ctx.drawImage(A.canvas, pose * cw, row * ch, cw, ch, -A.ox * k, -A.oy * k, w, h);
    } else {
      this.drawSpine(f, A, row, k, w, h, flip, mv);
    }
    ctx.restore();
  }

  if (P.waterOn && Water.layers.length) Water.drawLayers(ctx, performance.now(), this.fullW, this.H);
  if (this.residents.length) this.drawLabels(ctx, performance.now());

  if (P.showAtlas && atlas) {
    var s = Math.min(0.6, (this.H - 40) / atlas.canvas.height, (this.W - 60) / atlas.canvas.width);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillRect(12, 12, atlas.canvas.width * s + 12, atlas.canvas.height * s + 12);
    ctx.drawImage(atlas.canvas, 18, 18, atlas.canvas.width * s, atlas.canvas.height * s);
  }
  this.ctx = screen;
  if (book) Book.compose(screen, this);
};

/** Visitor fish get a hand-lettered label: while spotlit (just released, or "find my fish"), and under the pointer. */
School.prototype.drawLabels = function (ctx, now) {
  var ptr = this.pointer, hoverOn = P.visitorHover && ptr.on;
  ctx.globalCompositeOperation = 'source-over';
  for (var i = 0; i < this.residents.length; i++) {
    var f = this.residents[i]; if (f.alpha < 0.05) continue;
    var size = P.sizeMin + f.sizeNorm * (P.sizeMax - P.sizeMin), r = size * 0.62;
    if (hoverOn) { var dx = f.x - ptr.x, dy = f.y - ptr.y; if (dx * dx + dy * dy < r * r) f.hover = now; }
    var a = Math.max(f.spot > 0 ? Math.min(1, f.spot) : 0, f.hover ? clamp(1 - (now - f.hover - 500) / 600, 0, 1) : 0);
    if (a <= 0) continue;
    ctx.globalAlpha = a * f.alpha * 0.9;
    ctx.strokeStyle = '#2b3a48'; ctx.lineWidth = 1.1; ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.ellipse(f.x, f.y, r, r * 0.8, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    ctx.font = 'italic 600 16px "Cormorant Garamond", Georgia, serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillStyle = '#2b3a48';
    ctx.fillText(f.res.name + (f.res.mine ? ' · your fish' : ''), f.x, f.y + r * 0.8 + 6);
  }
  ctx.globalAlpha = 1;
};

/** Strip-warp: slice the painting along the body and ride each strip on a travelling wave
 *  (amplitude growing head→tail), plus a C-bend into turns. u = 0 at the nose, 1 at the tail tip. */
School.prototype.drawSpine = function (f, A, row, k, w, h, flip, mv) {
  var ctx = this.ctx, cw = A.cellW, ch = A.cellH;
  var N = clamp(Math.round(w / 8), 6, 22);
  var sw = cw / N;
  var amp = P.waveAmp * (1 + mv * 0.4 * f.mj.amp);
  var head = P.headAmp * (1 + mv * 0.6 * f.mj.head);
  var lam = P.waveLen * (1 + mv * 0.3 * f.mj.len);
  var prof = P.waveProfile * (1 + mv * 0.5 * f.mj.prof);
  var env = f.env;
  var ph = f.phase * Math.PI * 2;
  var bend = clamp(f.turn / (P.turnRate || 1), -1, 1) * P.turnBend * (flip ? -1 : 1);
  var bodyLen = A.bodyW * k;
  var dy = function (u) {
    var a = head + (amp - head) * Math.pow(u, prof);
    return bodyLen * (a * env * Math.sin((u / lam) * Math.PI * 2 - ph) + 0.22 * bend * u * u);
  };
  for (var i = 0; i < N; i++) {
    var xc = (i + 0.5) * sw;                                        // atlas px inside the cell
    var u = clamp((A.margin + A.bodyW - xc) / A.bodyW, 0, 1);
    var y0 = dy(u), yb = dy(clamp(u + 0.02, 0, 1)), ya = dy(clamp(u - 0.02, 0, 1));
    var ang = Math.atan2(-(yb - ya), 0.04 * bodyLen);                // spine slope; x increases as u decreases
    ctx.save();
    ctx.translate((xc - A.ox) * k, y0);
    ctx.rotate(ang);
    ctx.drawImage(A.canvas, i * sw, row * ch, sw, ch, -sw * k / 2 - 0.4, -A.oy * k, sw * k + 0.8, h);
    ctx.restore();
  }
};
