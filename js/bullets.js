// The site's bullets, drawn with p5.brush in the ink, like the nav dot. Two kinds, one meaning each:
//   stroke  a short brush stroke: a plain list item (.prose ul > li, .plain > li)
//   ring    one brush circle: a decision (.calls > li)
// A few variants of each are painted once per page load (random seed, so no two pages match) onto small canvases and
// shared; each bullet picks one. The CSS draws the glyphs (○ –) until this runs, and keeps them if canvas or WebGL is missing.
// The bullets are ::before boxes holding an image, so the list semantics are untouched and they are invisible to screen readers.
// Loads after dot.js: it borrows p5.brush's canvas once the page has settled, then hands it back (window.reclaimBrush).
(function () {
  var html = document.documentElement;
  var kinds = {
    stroke: '.prose ul:not(.rows) > li, .plain > li',
    ring: '.calls > li'
  };
  var VARIANTS = 4, BOX = 16;   // css px square per bullet
  var dpr = Math.min(devicePixelRatio || 1, 2), S = dpr * 2;   // brush paints at 2x for texture, bullets are stored at dpr

  function go() {
    if (!window.brush || !window.reclaimBrush) return;   // no brush (or no WebGL): the glyphs stay
    var gl = document.createElement('canvas');
    if (!gl.getContext('webgl2')) return;
    var ink = getComputedStyle(html).getPropertyValue('--ink').trim() || '#1d4a9e';
    gl.width = gl.height = BOX * S;
    brush.load(gl);
    function bx(x) { return x * S - gl.width / 2; }   // p5.brush's origin is the canvas centre
    function by(y) { return y * S - gl.height / 2; }
    function jig(a) { return (Math.random() - 0.5) * 2 * a; }
    function paint(fn) {
      brush.clear(); brush.seed(Math.random() * 1e6);
      var g = gl.getContext('webgl2'); g.bindFramebuffer(g.FRAMEBUFFER, null); g.clearColor(0, 0, 0, 0); g.clear(g.COLOR_BUFFER_BIT | g.DEPTH_BUFFER_BIT);
      brush.noStroke(); brush.noFill(); brush.noHatch(); brush.noField();
      fn();
      brush.noStroke(); brush.noFill();
      brush.render();
      var c = document.createElement('canvas'); c.width = c.height = BOX * dpr;
      c.getContext('2d').drawImage(gl, 0, 0, gl.width, gl.height, 0, 0, c.width, c.height);
      return c;
    }
    var draw = {
      stroke: function () {   // a short level pen stroke with a little wobble (the nav's marker is too soft at this size)
        brush.set('pen', ink, 1.9 * S);
        var pts = [];
        for (var k = 0; k <= 3; k++) pts.push([bx(2 + 12 * k / 3), by(8 + (k === 0 || k === 3 ? jig(0.3) : jig(0.8)))]);
        brush.spline(pts, 0.5);
      },
      ring: function () {   // one pen circle, drawn as a hand would: a slightly uneven loop whose end overshoots its start
        brush.set('pen', ink, 1.5 * S);
        brush.noFill();
        var cx = 8 + jig(0.3), cy = 8 + jig(0.3), R = 4.2 + jig(0.3), a0 = Math.random() * Math.PI * 2, pts = [];
        for (var k = 0; k <= 9; k++) {
          var a = a0 + k / 8.4 * Math.PI * 2, d = R * (1 + jig(0.07) + k * 0.006);
          pts.push([bx(cx + Math.cos(a) * d), by(cy + Math.sin(a) * d)]);
        }
        brush.spline(pts, 0.8);
      }
    };
    // warm-up: p5.brush's first real fill and first real stroke each render nothing; get them out of the way
    paint(draw.stroke); paint(draw.ring);

    Object.keys(kinds).forEach(function (kind) {
      var els = document.querySelectorAll(kinds[kind]);
      if (!els.length) return;
      var urls = [];
      for (var v = 0; v < VARIANTS; v++) urls.push('url(' + paint(draw[kind]).toDataURL() + ')');
      var off = Math.floor(Math.random() * VARIANTS);
      els.forEach(function (el, i) { el.style.setProperty('--bul', urls[(i + off) % VARIANTS]); });
    });
    window.reclaimBrush();
    html.classList.add('bullets');
  }

  // after the frame and the nav: once everything has loaded and the main thread is idle
  function later() { if (window.requestIdleCallback) requestIdleCallback(go, { timeout: 2000 }); else setTimeout(go, 200); }
  if (document.readyState === 'complete') later(); else addEventListener('load', later);
})();
