// The active-link dot: a p5.brush ink blot. On navigation a painter drags the brush to the next link,
// the trail thinning out behind, and a fresh blot lands.
(function () {
  var nav = document.querySelector('.nav');
  var links = Array.from(nav.querySelectorAll('a'));
  var sections = links.map(function (a) { return document.querySelector(a.hash); });
  var COLOR = '#fe5252', R = 6, LAG = 0.4, DUR = 180, RAIL = 46;   // rail: dot centre sits RAIL px off the widest link
  var dpr = Math.min(devicePixelRatio || 1, 2), S = dpr * 2;   // brush paints at 2x for texture, overlay at dpr

  function idx(hash) {
    var i = links.findIndex(function (a) { return a.hash === hash; });
    if (i < 0) {   // a row's hash (a project, a piece of art): the section that row lives in
      var row = hash && document.querySelector('.rows a[href="' + hash + '"]');
      i = row ? sections.indexOf(row.closest('section')) : -1;
    }
    return Math.max(0, i);
  }
  function mark(i) {
    links.forEach(function (a, j) { if (j === i) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    sections.forEach(function (s, j) { if (s) s.hidden = j !== i; });   // subpages share the nav but not the sections
  }

  // ---- brush setup: one WebGL canvas p5.brush paints into, copied out as needed ----
  var gl = document.createElement('canvas'), overlay = document.createElement('canvas'), ctx, ow, oh, dotX;
  if (!window.brush || !gl.getContext('webgl2')) { mark(idx(location.hash)); addEventListener('hashchange', function () { mark(idx(location.hash)); }); return; }

  function size() {
    // the rail hugs the widest link, not the nav box (the nav is as wide as the name)
    var edge = Math.min.apply(null, links.map(function (a) { return a.offsetLeft; }));
    ow = nav.offsetWidth + 72; oh = nav.offsetHeight + 12; dotX = edge - RAIL + 60;   // overlay hangs 60px past the nav's left edge, and 12px past its right and bottom for the underlines' bleed
    overlay.style.left = '-60px';
    overlay.width = ow * dpr; overlay.height = oh * dpr;
    overlay.style.width = ow + 'px'; overlay.style.height = oh + 'px';
    gl.width = ow * S; gl.height = oh * S;
    brush.load(gl);
    ctx = overlay.getContext('2d'); ctx.scale(dpr, dpr);
    // warm-up: p5.brush's first real fill and first real stroke each render nothing; get them out of the way
    strokeAlong(wobble(0, oh)); blotAt(dotX, oh / 2); strokeAlong(wobble(oh, 0));
  }
  function linkY(i) { return links[i].offsetTop + links[i].offsetHeight / 2; }
  // p5.brush's origin sits at the canvas centre
  function bx(x) { return x * S - gl.width / 2; }
  function by(y) { return y * S - gl.height / 2; }
  function paint(fn) {
    brush.clear(); brush.seed(Math.random() * 1e6);
    // brush.clear() leaves (1,1,1,0), which copies out as opaque white; wipe to true transparent
    var g = gl.getContext('webgl2'); g.bindFramebuffer(g.FRAMEBUFFER, null); g.clearColor(0, 0, 0, 0); g.clear(g.COLOR_BUFFER_BIT | g.DEPTH_BUFFER_BIT);
    brush.noStroke(); brush.noFill(); brush.noHatch(); brush.noField();
    fn();
    brush.noStroke(); brush.noFill();
    brush.render();
    var c = document.createElement('canvas'); c.width = gl.width; c.height = gl.height;
    c.getContext('2d').drawImage(gl, 0, 0);
    return c;
  }
  function blotAt(x, y) {
    return paint(function () {
      brush.fill(COLOR, 255); brush.fillBleed(0.08, 'out'); brush.fillTexture(0.15, 0.2);
      brush.circle(bx(x), by(y), R * S); brush.circle(bx(x), by(y), R * S * 0.9);
    });
  }
  function strokeAlong(pts) {
    return paint(function () {
      brush.set('marker', COLOR, 2.2 * S);
      brush.spline(pts.map(function (p) { return [bx(p[0]), by(p[1])]; }), 0.4);
    });
  }
  function draw(img, alpha) {
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.drawImage(img, 0, 0, gl.width, gl.height, 0, 0, ow, oh);
    ctx.globalAlpha = 1;
  }
  function drawScaled(img, x, y, s) {   // blot sprite scaled about (x, y)
    if (s <= 0) return;
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.translate(-x, -y); draw(img); ctx.restore();
  }

  // ---- the trip ----
  var cur, blot, anim = null;
  function settle(i) { cur = i; blot = blotAt(dotX, linkY(i)); ctx.clearRect(0, 0, ow, oh); draw(blot); }

  function wobble(y0, y1) {
    var n = 6, pts = [];
    for (var k = 0; k <= n; k++) {
      var t = k / n, w = (k === 0 || k === n) ? 0 : (Math.random() - 0.5) * 12;
      pts.push([dotX + w, y0 + (y1 - y0) * t]);
    }
    return pts;
  }
  function at(pts, t) {   // point at parameter t along the control polyline
    var f = t * (pts.length - 1), k = Math.min(pts.length - 2, Math.floor(f)), u = f - k;
    return [pts[k][0] + (pts[k + 1][0] - pts[k][0]) * u, pts[k][1] + (pts[k + 1][1] - pts[k][1]) * u];
  }
  function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

  function travel(to) {
    if (to === cur) return;
    var from = cur, pts = wobble(linkY(from), linkY(to)), stroke = strokeAlong(pts);
    var oldBlot = blot, newBlot = blotAt(dotX, linkY(to)), y0 = linkY(from), y1 = linkY(to);
    cur = to; blot = newBlot;
    var t0 = performance.now();
    cancelAnimationFrame(anim);
    (function frame(now) {
      var u = Math.min(1 + LAG, (now - t0) / DUR * (1 + LAG));
      var head = ease(Math.min(1, u)), tail = ease(Math.max(0, u - LAG));
      ctx.clearRect(0, 0, ow, oh);
      // the trail: the pre-painted stroke, masked to the stretch between tail and head
      draw(stroke);
      ctx.globalCompositeOperation = 'destination-in';
      ctx.beginPath(); ctx.lineWidth = 16; ctx.lineCap = ctx.lineJoin = 'round';
      var p = at(pts, tail); ctx.moveTo(p[0], p[1]);
      for (var k = 1; k < pts.length; k++) { if (k / (pts.length - 1) > tail && k / (pts.length - 1) < head) ctx.lineTo(pts[k][0], pts[k][1]); }
      p = at(pts, head); ctx.lineTo(p[0], p[1]); ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
      // lift off at the start, land at the end
      drawScaled(oldBlot, dotX, y0, 1 - Math.min(1, u / 0.5));
      drawScaled(newBlot, dotX, y1, Math.max(0, (u - 1) / LAG));
      if (u < 1 + LAG) anim = requestAnimationFrame(frame); else { ctx.clearRect(0, 0, ow, oh); draw(newBlot); }
    })(t0);
  }

  // ---- the hover underline: the same marker, drawn under the link left to right, lifted right to left ----
  var under = document.createElement('canvas'), uctx, strokes = [], hover = -1, reveal = 0, uanim = null;
  function underlines() {
    under.width = overlay.width; under.height = overlay.height; under.style.cssText = overlay.style.cssText;
    uctx = under.getContext('2d'); uctx.scale(dpr, dpr);
    strokes = links.map(function (a) {   // one hand-drawn stroke per link, a little wobble in the line, painted once
      var x0 = a.offsetLeft + 60, x1 = x0 + a.offsetWidth, y = a.offsetTop + a.offsetHeight + 1, pts = [];
      for (var k = 0; k <= 4; k++) pts.push([x0 + (x1 - x0) * k / 4, y + (k === 0 || k === 4 ? 0 : (Math.random() - 0.5) * 2)]);
      return { x0: x0, w: x1 - x0, img: strokeAlong(pts) };
    });
  }
  function drawUnder() {
    uctx.clearRect(0, 0, ow, oh);
    if (hover < 0 || reveal <= 0) return;
    var st = strokes[hover];
    var t = 1 - Math.pow(1 - reveal, 3);   // ease-out: the pen moves fast off the mark and slows into the end of the word
    uctx.save(); uctx.beginPath(); uctx.rect(st.x0 - 6, 0, (st.w + 12) * t, oh); uctx.clip();
    uctx.globalAlpha = 1; uctx.drawImage(st.img, 0, 0, gl.width, gl.height, 0, 0, ow, oh); uctx.restore();
  }
  function underFrame() {   // reveal runs to 1 while hovered (a pen drawing left to right), back to 0 when not (lifted, quicker)
    var to = hover < 0 ? 0 : 1, step = 16.7 / (to ? 320 : 160);
    reveal = to > reveal ? Math.min(to, reveal + step) : Math.max(to, reveal - step);
    drawUnder();
    if (reveal !== to) uanim = requestAnimationFrame(underFrame); else uanim = null;
  }
  links.forEach(function (a, i) {
    a.addEventListener('pointerenter', function () { hover = i; if (!uanim) uanim = requestAnimationFrame(underFrame); });
    a.addEventListener('pointerleave', function () { if (hover === i) { hover = -1; if (!uanim) uanim = requestAnimationFrame(underFrame); } });
  });

  overlay.className = under.className = 'dot';
  nav.classList.add('has-brush'); nav.appendChild(overlay); nav.appendChild(under);
  size(); underlines(); brush.angleMode && brush.angleMode(brush.DEGREES);
  mark(idx(location.hash)); settle(idx(location.hash));
  addEventListener('hashchange', function () { var i = idx(location.hash); mark(i); travel(i); });
  addEventListener('resize', function () { cancelAnimationFrame(anim); size(); settle(cur); underlines(); drawUnder(); });

})();
